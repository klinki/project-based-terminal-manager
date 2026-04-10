# Terminal Window Manager

This repository now keeps a single active desktop shell:

- `src/TerminalWindowManager.Tauri`: Tauri-based desktop shell.

Supporting projects:

- `src/TerminalWindowManager.ConPTYHost`: helper process that reads ConPTY output and emits structured terminal events.
- `src/TerminalWindowManager.Core`: shared parser and progress-domain types used by the helper.
- `tests/TerminalWindowManager.Core.Tests`: parser tests.

Use the root [build.ps1](build.ps1) script for repeatable builds.

## Prerequisites

The active desktop path is Windows-only because it depends on ConPTY and the Windows Tauri target.

- Windows 10 or Windows 11
- .NET 10 SDK
- Bun 1.x
- PowerShell
- Rust toolchain with `cargo`

Verify the required toolchains with:

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

- the active `.NET` projects in `Release`
- the Tauri web assets
- the Debug ConPTY helper required during development
- a native `cargo check`

### Useful Targets

Build the active `.NET` projects:

```powershell
.\build.ps1 -Target DotNet
```

Build only the Tauri shell:

```powershell
.\build.ps1 -Target Tauri
```

Create the packaged Tauri Windows release build:

```powershell
.\build.ps1 -Target Desktop-Tauri
```

`Desktop` is an alias for `Desktop-Tauri`.

Force a clean frontend dependency install:

```powershell
.\build.ps1 -Target All -ForceFrontendInstall
```

Build the `.NET` projects in `Debug` instead of `Release`:

```powershell
.\build.ps1 -Target DotNet -Configuration Debug
```

## Output Locations

- ConPTY host: `src/TerminalWindowManager.ConPTYHost/bin/<Configuration>/net10.0-windows/`
- Tauri helper used during development: `src/TerminalWindowManager.ConPTYHost/bin/Debug/net10.0-windows/`
- Tauri web bundle: `src/TerminalWindowManager.Tauri/dist/`
- Tauri packaged desktop release: `src/TerminalWindowManager.Tauri/src-tauri/target/release/bundle/`
- Core test output: `tests/TerminalWindowManager.Core.Tests/bin/<Configuration>/net10.0/`

## Running During Development

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

- The Tauri application persists its state under the Tauri app-data directory as `terminal-metadata.json`.

## Troubleshooting

If the Tauri shell reports that the ConPTY helper executable is missing, rebuild that shell target:

```powershell
.\build.ps1 -Target Tauri
```

If Bun dependencies get out of sync, rerun:

```powershell
.\build.ps1 -Target All -ForceFrontendInstall
```
