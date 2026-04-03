# Terminal Window Manager

This repository currently contains two code paths:

- `TerminalWindowManager.*`: the active implementation.
- `ProjectWindowManager.*`: legacy projects that are not part of the supported build flow.

Use the root `build.ps1` script for repeatable builds of the active projects. The active solution file is `TerminalWindowManager.slnx`.

## Active Projects

- `src/TerminalWindowManager.Core`: shared models and services.
- `src/TerminalWindowManager.Terminal`: Windows Terminal integration used by the WPF app.
- `src/TerminalWindowManager.App`: WPF desktop application.
- `src/TerminalWindowManager.ConPTYHost`: helper process used by the desktop shells to host terminal sessions.
- `src/TerminalWindowManager.ElectroBun`: Tauri desktop UI and xterm.js frontend (the project folder still carries the historical ElectroBun name for now).

## Prerequisites

The active projects are Windows-only.

- Windows 10 or Windows 11
- .NET 10 SDK
- Rust toolchain with `cargo`
- Bun 1.x
- PowerShell

You can verify the required toolchains with:

```powershell
dotnet --version
cargo --version
bun --version
```

## Build

From the repository root:

```powershell
.\build.ps1
```

The default target builds:

- all active `.NET` projects in `Release`
- the ConPTY helper in `Release` and copies it into the Tauri resources directory
- the Tauri frontend bundle into `src/TerminalWindowManager.ElectroBun/dist`

### Useful Targets

Build only the active `.NET` projects:

```powershell
.\build.ps1 -Target DotNet
```

Build only the Tauri frontend and helper resources:

```powershell
.\build.ps1 -Target Tauri
```

Create the packaged Tauri Windows release build:

```powershell
.\build.ps1 -Target Desktop
```

Force a clean frontend dependency install before building Tauri:

```powershell
.\build.ps1 -Target Tauri -ForceFrontendInstall
```

Build the `.NET` projects in `Debug` instead of `Release`:

```powershell
.\build.ps1 -Target DotNet -Configuration Debug
```

## Running During Development

Run the WPF application directly:

```powershell
dotnet run --project .\src\TerminalWindowManager.App\TerminalWindowManager.App.csproj
```

Run the Tauri application in development mode:

```powershell
Set-Location .\src\TerminalWindowManager.ElectroBun
bun install
bun run dev
```

## Output Locations

- WPF app: `src/TerminalWindowManager.App/bin/<Configuration>/net10.0-windows/`
- ConPTY host: `src/TerminalWindowManager.ConPTYHost/bin/<Configuration>/net10.0-windows/`
- Tauri helper resources: `src/TerminalWindowManager.ElectroBun/src-tauri/resources/TerminalWindowManager.ConPTYHost/`
- Tauri web bundle: `src/TerminalWindowManager.ElectroBun/dist/`
- Tauri desktop release bundle: `src/TerminalWindowManager.ElectroBun/src-tauri/target/release/bundle/`

## Data Storage

- The WPF application persists its project catalog under `%LOCALAPPDATA%\TerminalWindowManager\projects.json`.
- The Tauri application persists its state under the Tauri app data directory as `terminal-metadata.json`.

## Known Constraints

- `ProjectWindowManager.*` remains in the repository for legacy purposes and is intentionally excluded from the new build script.
- The root solution file still mixes legacy and active projects.
- No automated test projects were found under `tests`, so the build script currently focuses on restore/build steps only.

## Troubleshooting

If the Tauri app reports that the ConPTY helper executable is missing, rebuild the Tauri target:

```powershell
.\build.ps1 -Target Tauri
```

If Bun dependencies get out of sync, rerun:

```powershell
.\build.ps1 -Target Tauri -ForceFrontendInstall
```
