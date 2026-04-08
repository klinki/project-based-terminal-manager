# Fix Attempt 002

## Attempt Status
- fixed

## Goal
- Remove the stray console window from the installed Tauri app by linking the packaged executable as a Windows GUI subsystem binary.

## Relation To Previous Attempts
- Follow-up to `fix-attempt-001.md` after reinstall validation showed the packaged app still started as a console process.
- Attempt 001 fixed missing helper packaging; attempt 002 fixes the subsystem of the main Tauri executable.

## Proposed Change
- Apply `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` to the real binary entrypoint in `src/main.rs`.
- Remove the same attribute from `lib.rs`, where it does not control the final Windows subsystem of the produced executable.

## Risks
- Low risk. The change is limited to Windows release binary metadata and should not affect app logic.

## Files And Components
- `src/TerminalWindowManager.Tauri/src-tauri/src/main.rs`
- `src/TerminalWindowManager.Tauri/src-tauri/src/lib.rs`

## Verification Plan
- Build the Tauri desktop package again.
- Inspect the built `terminal-window-manager-tauri.exe` PE subsystem value.
- Confirm the rebuilt installer succeeds and produces a `Windows GUI` executable instead of `Windows CUI`.

## Implementation Summary
- Moved the Windows subsystem attribute from `lib.rs` to `main.rs`, which is the actual binary entrypoint used for the packaged application.

## Test Results
- `bun run build:desktop` passed and regenerated:
  - `src/TerminalWindowManager.Tauri/src-tauri/target/release/bundle/nsis/Terminal Window Manager Tauri_0.0.1_x64-setup.exe`
  - `src/TerminalWindowManager.Tauri/src-tauri/target/release/bundle/msi/Terminal Window Manager Tauri_0.0.1_x64_en-US.msi`
- The rebuilt `src/TerminalWindowManager.Tauri/src-tauri/target/release/terminal-window-manager-tauri.exe` now reports subsystem `0x2` (`Windows GUI`) instead of `0x3` (`Windows CUI`).

## Outcome
- Local packaging verification succeeded. The rebuilt installer now contains a GUI-subsystem main executable, which stops Windows from opening a stray empty console window for the app process.
- User confirmed the installed app behavior is fixed.

## Next Step
- None.

## Remaining Gaps
- None after user confirmation.
