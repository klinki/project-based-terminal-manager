[CmdletBinding()]
param(
    [ValidateSet("All", "DotNet", "ElectroBun", "Desktop")]
    [string]$Target = "All",

    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    [switch]$ForceFrontendInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSCommandPath
$frontendDir = Join-Path $repoRoot "src\TerminalWindowManager.ElectroBun"
$conPtyHostProject = Join-Path $repoRoot "src\TerminalWindowManager.ConPTYHost\TerminalWindowManager.ConPTYHost.csproj"
$isWindowsHost = ($env:OS -eq "Windows_NT")
if (-not $isWindowsHost) {
    $isWindowsVariable = Get-Variable -Name "IsWindows" -ErrorAction SilentlyContinue
    if ($isWindowsVariable -and $isWindowsVariable.Value -eq $true) {
        $isWindowsHost = $true
    }
}
$dotNetProjects = @(
    Join-Path $repoRoot "src\TerminalWindowManager.Core\TerminalWindowManager.Core.csproj"
    Join-Path $repoRoot "src\TerminalWindowManager.Terminal\TerminalWindowManager.Terminal.csproj"
    $conPtyHostProject
    Join-Path $repoRoot "src\TerminalWindowManager.App\TerminalWindowManager.App.csproj"
)

function Assert-WindowsHost {
    if (-not $isWindowsHost) {
        throw "This target requires Windows because it builds WPF or the Windows ConPTY host."
    }
}

function Assert-CommandAvailable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandName,

        [Parameter(Mandatory = $true)]
        [string]$InstallHint
    )

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "Required command '$CommandName' was not found. $InstallHint"
    }
}

function Assert-PathExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Description
    )

    if (-not (Test-Path -Path $Path)) {
        throw "$Description was not found at '$Path'."
    }
}

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,

        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList,

        [string]$WorkingDirectory = $repoRoot
    )

    Write-Host "==> $FilePath $($ArgumentList -join ' ')" -ForegroundColor Cyan

    Push-Location $WorkingDirectory
    try {
        & $FilePath @ArgumentList
        if ($LASTEXITCODE -ne 0) {
            throw "Command failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Build-DotNetProjects {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BuildConfiguration
    )

    Assert-WindowsHost
    Assert-CommandAvailable -CommandName "dotnet" -InstallHint "Install the .NET 10 SDK and make sure 'dotnet' is on PATH."

    foreach ($project in $dotNetProjects) {
        Assert-PathExists -Path $project -Description "Project file"
        Invoke-ExternalCommand `
            -FilePath "dotnet" `
            -ArgumentList @(
                "build",
                $project,
                "--configuration", $BuildConfiguration,
                "--nologo",
                "--verbosity", "minimal"
            )
    }
}

function Ensure-FrontendDependencies {
    Assert-CommandAvailable -CommandName "bun" -InstallHint "Install Bun 1.x and make sure 'bun' is on PATH."
    Assert-PathExists -Path $frontendDir -Description "ElectroBun project directory"

    $nodeModulesDir = Join-Path $frontendDir "node_modules"
    if ($ForceFrontendInstall -or -not (Test-Path -Path $nodeModulesDir)) {
        Invoke-ExternalCommand -FilePath "bun" -ArgumentList @("install") -WorkingDirectory $frontendDir
        return
    }

    Write-Host "==> Reusing existing frontend dependencies in src\TerminalWindowManager.ElectroBun\node_modules" -ForegroundColor DarkGray
}

function Build-ElectroBunView {
    Ensure-FrontendDependencies

    if ($isWindowsHost) {
        Assert-CommandAvailable -CommandName "dotnet" -InstallHint "Install the .NET 10 SDK and make sure 'dotnet' is on PATH."

        # The ElectroBun Windows backend resolves the helper from bin/Debug/net10.0-windows.
        Invoke-ExternalCommand `
            -FilePath "dotnet" `
            -ArgumentList @(
                "build",
                $conPtyHostProject,
                "--configuration", "Debug",
                "--nologo",
                "--verbosity", "minimal"
            )
    }
    else {
        Write-Host "==> Skipping Windows ConPTY host build on non-Windows platform" -ForegroundColor DarkGray
    }

    Invoke-ExternalCommand -FilePath "bun" -ArgumentList @("run", "build:view") -WorkingDirectory $frontendDir
}

function Build-ElectroBunDesktop {
    Ensure-FrontendDependencies
    if ($isWindowsHost) {
        Assert-CommandAvailable -CommandName "dotnet" -InstallHint "Install the .NET 10 SDK and make sure 'dotnet' is on PATH."
    }
    Invoke-ExternalCommand -FilePath "bun" -ArgumentList @("run", "build:desktop") -WorkingDirectory $frontendDir
}

switch ($Target) {
    "All" {
        Assert-WindowsHost
        Build-DotNetProjects -BuildConfiguration $Configuration
        Build-ElectroBunView
    }

    "DotNet" {
        Assert-WindowsHost
        Build-DotNetProjects -BuildConfiguration $Configuration
    }

    "ElectroBun" {
        Build-ElectroBunView
    }

    "Desktop" {
        Build-ElectroBunDesktop
    }
}

Write-Host ""
Write-Host "Build completed successfully." -ForegroundColor Green
Write-Host "Target: $Target"

if ($Target -eq "All" -or $Target -eq "DotNet") {
    Write-Host "WPF app output: src\TerminalWindowManager.App\bin\$Configuration\net10.0-windows\"
    Write-Host "ConPTY host output: src\TerminalWindowManager.ConPTYHost\bin\$Configuration\net10.0-windows\"
}

if ($Target -eq "All" -or $Target -eq "ElectroBun") {
    if ($isWindowsHost) {
        Write-Host "ElectroBun helper output: src\TerminalWindowManager.ConPTYHost\bin\Debug\net10.0-windows\"
    }
    else {
        Write-Host "ElectroBun macOS/Linux build uses the Bun-native PTY backend at runtime."
    }
    Write-Host "ElectroBun web assets: src\TerminalWindowManager.ElectroBun\dist\"
}

if ($Target -eq "Desktop") {
    if ($isWindowsHost) {
        Write-Host "ElectroBun desktop package: src\TerminalWindowManager.ElectroBun\artifacts\stable-win-x64-*.zip"
    }
    else {
        Write-Host "ElectroBun desktop package: src\TerminalWindowManager.ElectroBun\artifacts\"
    }
}
