# Terminal Window Manager

This repository currently contains two active desktop shell variants for the same terminal manager concept:

- `src/TerminalWindowManager.ElectroBun`: ElectroBun-based desktop shell.
- `src/TerminalWindowManager.Tauri`: Tauri-based desktop shell.

The repository also contains the original WPF application stack:

- `src/TerminalWindowManager.Core`
- `src/TerminalWindowManager.Terminal`
- `src/TerminalWindowManager.App`

Use the root [build.ps1](build.ps1) script for repeatable builds across the active projects.

## Active Projects

- `src/TerminalWindowManager.Core`: shared models and services for the WPF stack.
- `src/TerminalWindowManager.Terminal`: Windows Terminal integration used by the WPF app.
- `src/TerminalWindowManager.App`: WPF desktop application.
- `src/TerminalWindowManager.ConPTYHost`: shared helper process used by both desktop shell variants to host ConPTY-backed terminal sessions.
- `src/TerminalWindowManager.ElectroBun`: ElectroBun desktop shell.
- `src/TerminalWindowManager.Tauri`: Tauri desktop shell.

## Prerequisites

The active projects are Windows-only. The WPF application and the ConPTY helper target `net10.0-windows`.

- Windows 10 or Windows 11
- .NET 10 SDK
- Bun 1.x
- PowerShell
- Rust toolchain with `cargo` for the Tauri shell

You can verify the required toolchains with:

```powershell
dotnet --version
bun --version
cargo --version
```

## Build

From the repository root:

```powershell
.\build.ps1
```

The default target builds:

- all active `.NET` projects in `Release`
- the ElectroBun web assets and required Debug ConPTY helper
- the Tauri web assets, required Debug ConPTY helper, and a native `cargo check`

### Useful Targets

Build only the active `.NET` projects:

```powershell
.\build.ps1 -Target DotNet
```

Build only the ElectroBun shell:

```powershell
.\build.ps1 -Target ElectroBun
```

Build only the Tauri shell:

```powershell
.\build.ps1 -Target Tauri
```

Create the packaged ElectroBun Windows release build:

```powershell
.\build.ps1 -Target Desktop-ElectroBun
```

Create the packaged Tauri Windows release build:

```powershell
.\build.ps1 -Target Desktop-Tauri
```

`Desktop` remains a temporary alias for `Desktop-ElectroBun`.

Force a clean frontend dependency install before building either shell:

```powershell
.\build.ps1 -Target All -ForceFrontendInstall
```

Build the `.NET` projects in `Debug` instead of `Release`:

```powershell
.\build.ps1 -Target DotNet -Configuration Debug
```

## Output Locations

- WPF app: `src/TerminalWindowManager.App/bin/<Configuration>/net10.0-windows/`
- ConPTY host: `src/TerminalWindowManager.ConPTYHost/bin/<Configuration>/net10.0-windows/`
- ElectroBun helper used during development: `src/TerminalWindowManager.ConPTYHost/bin/Debug/net10.0-windows/`
- Tauri helper used during development: `src/TerminalWindowManager.ConPTYHost/bin/Debug/net10.0-windows/`
- ElectroBun web bundle: `src/TerminalWindowManager.ElectroBun/dist/`
- Tauri web bundle: `src/TerminalWindowManager.Tauri/dist/`
- ElectroBun packaged desktop release: `src/TerminalWindowManager.ElectroBun/artifacts/stable-win-x64-*.zip`
- Tauri packaged desktop release: `src/TerminalWindowManager.Tauri/src-tauri/target/release/bundle/`

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

For HMR-based ElectroBun frontend development:

```powershell
Set-Location .\src\TerminalWindowManager.ElectroBun
bun install
bun run dev:hmr
```

Run the Tauri application in development mode:

```powershell
Set-Location .\src\TerminalWindowManager.Tauri
bun install
bun run dev
```

For HMR-based Tauri frontend development:

```powershell
Set-Location .\src\TerminalWindowManager.Tauri
bun install
bun run dev:hmr
```

## Data Storage

- The WPF application persists its project catalog under `%LOCALAPPDATA%\TerminalWindowManager\projects.json`.
- The ElectroBun application persists its state under the ElectroBun user-data directory as `terminal-metadata.json`.
- The Tauri application persists its state under the Tauri app-data directory as `terminal-metadata.json`.

## Known Constraints

- The repository currently maintains multiple desktop shells for the same product concept.
- `ProjectWindowManager.*` remains in the repository for legacy purposes and is excluded from the active build flow.
- The JavaScript/Tauri shell projects are not solution members in `TerminalWindowManager.slnx`.

## Troubleshooting

If either desktop shell reports that the ConPTY helper executable is missing, rebuild that shell target:

```powershell
.\build.ps1 -Target ElectroBun
.\build.ps1 -Target Tauri
```

If Bun dependencies get out of sync, rerun:

```powershell
.\build.ps1 -Target All -ForceFrontendInstall
```
