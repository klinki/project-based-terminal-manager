# Terminal Window Manager

This repository currently contains two code paths:

- `TerminalWindowManager.*`: the active implementation.
- `ProjectWindowManager.*`: legacy projects that are not part of the supported build flow.

Use the root `build.ps1` script for repeatable builds of the active projects. The active solution file is `TerminalWindowManager.slnx`.

## Active Projects

- `src/TerminalWindowManager.Core`: shared models and services.
- `src/TerminalWindowManager.Terminal`: Windows Terminal integration used by the WPF app.
- `src/TerminalWindowManager.App`: WPF desktop application.
- `src/TerminalWindowManager.ConPTYHost`: helper process used by the ElectroBun UI to host terminal sessions.
- `src/TerminalWindowManager.ElectroBun`: ElectroBun proof-of-concept desktop UI.

## Prerequisites

The active projects are Windows-only. The WPF application and the ConPTY helper both target `net10.0-windows`.

- Windows 10 or Windows 11
- .NET 10 SDK
- Bun 1.x
- PowerShell

You can verify the two required toolchains with:

```powershell
dotnet --version
bun --version
```

## Build

From the repository root:

```powershell
.\build.ps1
```

The default target builds:

- all active `.NET` projects in `Release`
- the ConPTY helper again in `Debug` for the ElectroBun workflow
- the ElectroBun web assets into `src/TerminalWindowManager.ElectroBun/dist`

The extra `Debug` helper build is intentional. The current ElectroBun session manager resolves the helper from `src/TerminalWindowManager.ConPTYHost/bin/Debug/net10.0-windows/TerminalWindowManager.ConPTYHost.exe`.

### Useful Targets

Build only the active `.NET` projects:

```powershell
.\build.ps1 -Target DotNet
```

Build only the ElectroBun view assets and the required ConPTY helper:

```powershell
.\build.ps1 -Target ElectroBun
```

Create the packaged ElectroBun Windows release build:

```powershell
.\build.ps1 -Target Desktop
```

Force a clean frontend dependency install before building ElectroBun:

```powershell
.\build.ps1 -Target ElectroBun -ForceFrontendInstall
```

Build the `.NET` projects in `Debug` instead of `Release`:

```powershell
.\build.ps1 -Target DotNet -Configuration Debug
```

## Output Locations

- WPF app: `src/TerminalWindowManager.App/bin/<Configuration>/net10.0-windows/`
- ConPTY host: `src/TerminalWindowManager.ConPTYHost/bin/<Configuration>/net10.0-windows/`
- ElectroBun helper used during development: `src/TerminalWindowManager.ConPTYHost/bin/Debug/net10.0-windows/`
- ElectroBun web bundle: `src/TerminalWindowManager.ElectroBun/dist/`
- ElectroBun packaged desktop release: `src/TerminalWindowManager.ElectroBun/artifacts/stable-win-x64-*.zip`

## Running During Development

Run the WPF application directly:

```powershell
dotnet run --project .\src\TerminalWindowManager.App\TerminalWindowManager.App.csproj
```

Run the ElectroBun application in development mode:

```powershell
Set-Location .\src\TerminalWindowManager.ElectroBun
bun install
bun run dev
```

For HMR-based frontend development:

```powershell
Set-Location .\src\TerminalWindowManager.ElectroBun
bun install
bun run dev:hmr
```

## Data Storage

- The WPF application persists its project catalog under `%LOCALAPPDATA%\TerminalWindowManager\projects.json`.
- The ElectroBun application persists its state under the Electrobun user-data directory as `terminal-metadata.json`.

## Known Constraints

- `ProjectWindowManager.*` remains in the repository for legacy purposes and is intentionally excluded from the new build script.
- The root solution file still mixes legacy and active projects.
- No automated test projects were found under `tests`, so the build script currently focuses on restore/build steps only.

## Troubleshooting

If the ElectroBun app reports that the ConPTY helper executable is missing, rebuild the ElectroBun target:

```powershell
.\build.ps1 -Target ElectroBun
```

If Bun dependencies get out of sync, rerun:

```powershell
.\build.ps1 -Target ElectroBun -ForceFrontendInstall
```
