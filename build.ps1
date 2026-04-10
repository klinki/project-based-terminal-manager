[CmdletBinding()]
param(
    [ValidateSet("All", "DotNet", "Tauri", "Desktop", "Desktop-Tauri")]
    [string]$Target = "All",

    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",

    [switch]$ForceFrontendInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $PSCommandPath
$tauriDir = Join-Path $repoRoot "src\TerminalWindowManager.Tauri"
$conPtyHostProject = Join-Path $repoRoot "src\TerminalWindowManager.ConPTYHost\TerminalWindowManager.ConPTYHost.csproj"
$dotNetProjects = @(
    Join-Path $repoRoot "src\TerminalWindowManager.Core\TerminalWindowManager.Core.csproj"
    $conPtyHostProject
    Join-Path $repoRoot "tests\TerminalWindowManager.Core.Tests\TerminalWindowManager.Core.Tests.csproj"
)

function Assert-WindowsHost {
    if ($env:OS -ne "Windows_NT") {
        throw "The active TerminalWindowManager projects target Windows-only components (ConPTY and the Tauri desktop shell). Run this script on Windows."
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
    param(
        [Parameter(Mandatory = $true)]
        [string]$ProjectDirectory,

        [Parameter(Mandatory = $true)]
        [string]$ProjectLabel
    )

    Assert-CommandAvailable -CommandName "bun" -InstallHint "Install Bun 1.x and make sure 'bun' is on PATH."
    Assert-PathExists -Path $ProjectDirectory -Description "$ProjectLabel project directory"

    $nodeModulesDir = Join-Path $ProjectDirectory "node_modules"
    if ($ForceFrontendInstall -or -not (Test-Path -Path $nodeModulesDir)) {
        Invoke-ExternalCommand -FilePath "bun" -ArgumentList @("install") -WorkingDirectory $ProjectDirectory
        return
    }

    $relativeNodeModulesDir = [System.IO.Path]::GetRelativePath($repoRoot, $nodeModulesDir)
    Write-Host "==> Reusing existing frontend dependencies in $relativeNodeModulesDir" -ForegroundColor DarkGray
}

function Build-TauriShell {
    Assert-CommandAvailable -CommandName "dotnet" -InstallHint "Install the .NET 10 SDK and make sure 'dotnet' is on PATH."
    Assert-CommandAvailable -CommandName "cargo" -InstallHint "Install the Rust toolchain and make sure 'cargo' is on PATH for Tauri builds."
    Ensure-FrontendDependencies -ProjectDirectory $tauriDir -ProjectLabel "Tauri"

    Invoke-ExternalCommand -FilePath "bun" -ArgumentList @("run", "build:host") -WorkingDirectory $tauriDir
    Invoke-ExternalCommand -FilePath "bun" -ArgumentList @("run", "build:view") -WorkingDirectory $tauriDir
    Invoke-ExternalCommand -FilePath "cargo" -ArgumentList @("check", "--manifest-path", "src-tauri/Cargo.toml") -WorkingDirectory $tauriDir
}

function Build-TauriDesktop {
    Assert-CommandAvailable -CommandName "cargo" -InstallHint "Install the Rust toolchain and make sure 'cargo' is on PATH for Tauri builds."
    Ensure-FrontendDependencies -ProjectDirectory $tauriDir -ProjectLabel "Tauri"
    Invoke-ExternalCommand -FilePath "bun" -ArgumentList @("run", "build:desktop") -WorkingDirectory $tauriDir
}

Assert-WindowsHost

switch ($Target) {
    "All" {
        Build-DotNetProjects -BuildConfiguration $Configuration
        Build-TauriShell
    }

    "DotNet" {
        Build-DotNetProjects -BuildConfiguration $Configuration
    }

    "Tauri" {
        Build-TauriShell
    }

    "Desktop" {
        Build-TauriDesktop
    }

    "Desktop-Tauri" {
        Build-TauriDesktop
    }
}

Write-Host ""
Write-Host "Build completed successfully." -ForegroundColor Green
Write-Host "Target: $Target"

if ($Target -eq "All" -or $Target -eq "DotNet") {
    Write-Host "ConPTY host output: src\TerminalWindowManager.ConPTYHost\bin\$Configuration\net10.0-windows\"
    Write-Host "Core test output: tests\TerminalWindowManager.Core.Tests\bin\$Configuration\net10.0\"
}

if ($Target -eq "All" -or $Target -eq "Tauri") {
    Write-Host "Tauri helper output: src\TerminalWindowManager.ConPTYHost\bin\Debug\net10.0-windows\"
    Write-Host "Tauri web assets: src\TerminalWindowManager.Tauri\dist\"
    Write-Host "Tauri native build cache: src\TerminalWindowManager.Tauri\src-tauri\target\"
}

if ($Target -eq "Desktop" -or $Target -eq "Desktop-Tauri") {
    Write-Host "Tauri desktop package: src\TerminalWindowManager.Tauri\src-tauri\target\release\bundle\"
}
