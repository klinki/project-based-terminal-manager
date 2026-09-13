# Terminal Window Manager

This repository now keeps a single active desktop shell:

- `src/TerminalWindowManager.Tauri`: Tauri-based desktop shell.

Supporting projects:

- `src/TerminalWindowManager.ConPTYHost`: Windows helper process that reads ConPTY output and emits structured terminal events.
- `src/TerminalWindowManager.Core`: shared parser and progress-domain types used by the helper.
- `tests/TerminalWindowManager.Core.Tests`: parser tests.

Use the root [build.ps1](build.ps1) script for repeatable builds.

## Prerequisites

Windows 10/11 and macOS are supported. The macOS port uses the Tauri binary as its terminal host and does not build the Windows-only ConPTY helper.

Common tooling:

- Bun 1.x
- Rust toolchain with `cargo`
- PowerShell 7+ for the root `build.ps1` script

The default `All` target also builds the shared .NET projects and test project, so install the .NET 10 SDK if you use that target. A macOS Tauri-only build does not require the .NET SDK.

On macOS, install the Xcode Command Line Tools if they are not already available:

```sh
xcode-select --install
```

Verify the required toolchains with:

```powershell
dotnet --version
bun --version
cargo --version
pwsh --version
```

## Build

From the repository root:

```powershell
.\build.ps1
```

On macOS, invoke the PowerShell script explicitly from Terminal:

```sh
pwsh -NoProfile -File ./build.ps1
```

The default target builds:

- the active `.NET` projects in `Release` (`TerminalWindowManager.ConPTYHost` is Windows-only)
- the Tauri web assets
- the Debug ConPTY helper required during Windows development
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

Create the packaged Tauri desktop release build for the current platform:

```powershell
.\build.ps1 -Target Desktop-Tauri
```

On macOS, this creates the application bundle without attempting to create a disk image:

```sh
pwsh -NoProfile -File ./build.ps1 -Target Desktop-Tauri
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

- ConPTY host on Windows: `src/TerminalWindowManager.ConPTYHost/bin/<Configuration>/net10.0-windows/`
- Tauri helper used during Windows development: `src/TerminalWindowManager.ConPTYHost/bin/Debug/net10.0-windows/`
- Tauri web bundle: `src/TerminalWindowManager.Tauri/dist/`
- Tauri packaged desktop release: `src/TerminalWindowManager.Tauri/src-tauri/target/release/bundle/`
- Tauri macOS application: `src/TerminalWindowManager.Tauri/src-tauri/target/release/bundle/macos/Terminal Window Manager Tauri.app`
- Core test output: `tests/TerminalWindowManager.Core.Tests/bin/<Configuration>/net10.0/`

## Running During Development

Run the Tauri application in development mode on Windows:

```powershell
Set-Location .\src\TerminalWindowManager.Tauri
bun install
bun run dev
```

On macOS:

```sh
cd src/TerminalWindowManager.Tauri
bun install
bun run dev
```

For HMR-based Tauri frontend development:

```powershell
Set-Location .\src\TerminalWindowManager.Tauri
bun install
bun run dev:hmr
```

On macOS, run the same command from the Tauri directory:

```sh
cd src/TerminalWindowManager.Tauri
bun run dev:hmr
```

To open the packaged macOS application after a `Desktop-Tauri` build:

```sh
open "src/TerminalWindowManager.Tauri/src-tauri/target/release/bundle/macos/Terminal Window Manager Tauri.app"
```

## Data Storage

- The Tauri application persists its state under the Tauri app-data directory as `terminal-metadata.json`.

## Troubleshooting

On Windows, if the Tauri shell reports that the ConPTY helper executable is missing, rebuild that shell target:

```powershell
.\build.ps1 -Target Tauri
```

On macOS the Tauri binary uses a built-in Unix pseudoterminal host instead of the ConPTY helper. The root desktop target therefore builds the `.app` bundle directly; use `bun run tauri build --bundles dmg` from the Tauri directory separately if you also need a DMG.

If Bun dependencies get out of sync, rerun:

```powershell
.\build.ps1 -Target All -ForceFrontendInstall
```
