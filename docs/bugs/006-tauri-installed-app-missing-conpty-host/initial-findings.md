# Initial Findings

## Confirmed Facts
- The runtime resolver checks the packaged Tauri resource directory first for `TerminalWindowManager.ConPTYHost/TerminalWindowManager.ConPTYHost.exe`.
- `src/TerminalWindowManager.Tauri/src-tauri/resources/TerminalWindowManager.ConPTYHost/` currently contains only `.gitkeep` and `placeholder.txt`.
- `src/TerminalWindowManager.Tauri/src-tauri/build.rs` only called `tauri_build::build()` and did not publish or copy the helper into bundle resources.
- The Tauri package configuration already bundles `resources/`, so anything staged there should ship in the NSIS installer.

## Likely Cause
- The ConPTY host is built for development, but no packaging step stages its publish output into Tauri `resources/` before `tauri build`, leaving the installed app without the helper executable.

## Unknowns
- Whether a full `dotnet publish` output is required at runtime or whether the existing build output would have been sufficient.

## Reproduction Status
- Reproduced by inspection of the packaged-resource path and the current Tauri build pipeline.

## Evidence Gathered
- `tauri.conf.json` bundles `resources/`.
- `build.rs` had no helper staging logic.
- The packaged resource folder only had placeholder files.
- The runtime error path matches the packaged resource location that should contain the helper.
