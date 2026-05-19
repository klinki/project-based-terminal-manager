# Fix Attempt 001

## Attempt Status
- awaiting-user-confirmation

## Goal
- Stop `/` or dead-character keyboard messages from crashing the Tauri app.

## Relation To Previous Attempts
- First attempt for this bug.

## Proposed Change
- Update the Rust Tauri dependency so Cargo resolves a newer TAO keyboard implementation instead of `tao 0.34.8`.
- Patch TAO locally if the newer version still contains the unchecked dead-character path.

## Risks
- Tauri minor updates can alter transitive dependencies or generated runtime behavior.
- The JavaScript Tauri API package may also need to remain compatible with the Rust crate version.

## Expected Verification
- `Cargo.lock` no longer resolves `tao 0.34.8`.
- Tauri Rust crate builds successfully.
- The app no longer logs the TAO `keyboard.rs:165:49` panic when the slash/dead-key path is exercised.

## Files Or Components Involved
- `src/TerminalWindowManager.Tauri/src-tauri/Cargo.toml`
- `src/TerminalWindowManager.Tauri/src-tauri/Cargo.lock`

## Actual Implementation Summary
- Updated the Tauri Rust dependency floor to `2.11`.
- Refreshed `Cargo.lock`, which resolved `tauri 2.11.2`, `wry 0.55.1`, and `tao 0.35.2`.
- Updated frontend Tauri packages to match the Rust side: `@tauri-apps/api 2.11.0` and `@tauri-apps/cli 2.11.2`.
- Confirmed TAO 0.35.2 still has the same unchecked `self.event_info.take().unwrap()` in `WM_DEADCHAR | WM_SYSDEADCHAR` handling.
- Vendored TAO 0.35.2 under `third_party/tao` and added a `[patch.crates-io]` override in `src/TerminalWindowManager.Tauri/src-tauri/Cargo.toml`.
- Changed the `WM_DEADCHAR` branch to return no keyboard event when no pending `event_info` exists, matching the existing defensive behavior for unmatched `WM_CHAR` messages.

## Test And Verification Results
- `cargo check` passed for `src/TerminalWindowManager.Tauri/src-tauri`.
- `cargo tree -i tao` confirms the app now builds against `C:\ai-workspace\project-wm\third_party\tao`.
- `bun run build:view` passed for `src/TerminalWindowManager.Tauri`.

## Outcome And Remaining Gaps
- Local build verification passes.
- Needs user confirmation by reproducing the original `/` key path in the running desktop app.
