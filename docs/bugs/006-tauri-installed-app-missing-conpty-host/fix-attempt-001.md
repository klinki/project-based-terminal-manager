# Fix Attempt 001

## Attempt Status
- awaiting_user_confirmation

## Goal
- Ensure Tauri builds stage the ConPTY host into bundled resources so installed builds can launch terminals.

## Relation To Previous Attempts
- First attempt.

## Proposed Change
- Update the Tauri Rust build script to run `dotnet publish` for `TerminalWindowManager.ConPTYHost`.
- Publish into `src-tauri/resources/TerminalWindowManager.ConPTYHost/` so the existing bundle configuration includes the helper.
- Preserve `.gitkeep` and `placeholder.txt`, but replace any previously generated helper output on each build.

## Risks
- Running `dotnet publish` from `build.rs` adds build-time work to Tauri builds.
- If the publish output is incomplete or staged to the wrong location, the installer could still ship without the helper.

## Files And Components
- `src/TerminalWindowManager.Tauri/src-tauri/build.rs`
- `src/TerminalWindowManager.Tauri/src-tauri/resources/TerminalWindowManager.ConPTYHost/`

## Verification Plan
- Run a Tauri Rust build step so `build.rs` executes.
- Confirm the helper publish output appears under `src-tauri/resources/TerminalWindowManager.ConPTYHost/`.
- Confirm the packaged bundle can now pick up the helper from bundled resources.

## Implementation Summary
- Replaced the trivial Tauri `build.rs` with a staging step that publishes `TerminalWindowManager.ConPTYHost` into `src-tauri/resources/TerminalWindowManager.ConPTYHost/` before the normal Tauri build runs.
- Added cleanup for previously generated helper files while preserving `.gitkeep` and `placeholder.txt`.
- Configured the `dotnet publish` subprocess to use a local CLI home under `src-tauri/target/.dotnet-cli-home` so the build works in restricted environments and does not depend on writable user-profile paths.
- Removed Windows extended-path canonicalization from the helper project path because MSBuild wildcard imports failed against `\\?\` paths.

## Test Results
- `cargo check --manifest-path src/TerminalWindowManager.Tauri/src-tauri/Cargo.toml` passed.
- `Get-ChildItem src/TerminalWindowManager.Tauri/src-tauri/resources/TerminalWindowManager.ConPTYHost` confirmed the staged helper output now includes:
  - `TerminalWindowManager.ConPTYHost.exe`
  - `TerminalWindowManager.ConPTYHost.dll`
  - `TerminalWindowManager.ConPTYHost.deps.json`
  - `TerminalWindowManager.ConPTYHost.runtimeconfig.json`
  - `TerminalWindowManager.ConPTYHost.pdb`
- `bun run build:desktop` passed and regenerated:
  - `src/TerminalWindowManager.Tauri/src-tauri/target/release/bundle/nsis/Terminal Window Manager Tauri_0.0.1_x64-setup.exe`
  - `src/TerminalWindowManager.Tauri/src-tauri/target/release/bundle/msi/Terminal Window Manager Tauri_0.0.1_x64_en-US.msi`
- `target/release/resources/TerminalWindowManager.ConPTYHost/` exists and contains the staged helper files after packaging.

## Outcome
- Local packaging verification succeeded. The installer build now includes the ConPTY host resource payload expected by the runtime path resolver.

## Next Step
- Install the rebuilt NSIS or MSI package and confirm the installed app can start terminals without the missing-host error.

## Remaining Gaps
- User-side confirmation is still needed on the installed app path after reinstalling from the rebuilt package.
