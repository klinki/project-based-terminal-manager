# Fix Attempt 002

## Attempt Status
- awaiting-user-confirmation

## Goal
- Stop the TAO Windows dead-character panic without vendoring the full TAO dependency in this repository.

## Relation To Previous Attempts
- Supersedes `fix-attempt-001.md`.
- The first attempt proved that guarding TAO's missing `event_info` branch is the right failure mode, but it implemented the guard by copying all of TAO into `third_party/tao`.

## Proposed Change
- Remove the local `[patch.crates-io]` TAO override and delete `third_party/tao`.
- Add a small Windows-only Tauri window subclass that intercepts `WM_DEADCHAR` and `WM_SYSDEADCHAR`.
- Return `LRESULT(0)` for those messages before TAO receives them. TAO already consumes those messages with `LRESULT(0)`, so this avoids the panic while keeping normal character input in the WebView/terminal path.
- Keep the Tauri dependency update from attempt 001 unless verification shows it causes a regression.

## Risks
- Native TAO window-level dead-key `KeyEvent`s will no longer be emitted for the intercepted dead-character messages.
- The app currently does not consume native TAO dead-key events, but future native shortcuts should account for this guard.
- The guard must be installed on every Tauri window that can receive keyboard messages.

## Files And Components
- `src/TerminalWindowManager.Tauri/src-tauri/Cargo.toml`
- `src/TerminalWindowManager.Tauri/src-tauri/Cargo.lock`
- `src/TerminalWindowManager.Tauri/src-tauri/src/lib.rs`
- `src/TerminalWindowManager.Tauri/src-tauri/src/windows_keyboard_guard.rs`
- `third_party/tao`

## Verification Plan
- Confirm `Cargo.lock` resolves TAO from crates.io rather than `third_party/tao`.
- Run `cargo check` for `src/TerminalWindowManager.Tauri/src-tauri`.
- Run the existing frontend build check for `src/TerminalWindowManager.Tauri`.
- Ask the user to retest the original slash/dead-key scenario in the installed/runtime app.

## Implementation Summary
- Removed the `[patch.crates-io]` TAO path override from the Tauri Rust manifest.
- Deleted the vendored `third_party/tao` source tree.
- Added `windows-sys` as a direct Windows-only dependency for the small Win32 subclass shim.
- Added `windows_keyboard_guard.rs`, which installs a subclass on existing Tauri webview windows and returns `LRESULT(0)` for `WM_DEADCHAR` / `WM_SYSDEADCHAR`.
- Wired the guard into Tauri setup after app logging/session manager initialization.
- Confirmed `Cargo.lock` now resolves `tao 0.35.2` from crates.io with a checksum instead of the local path.

## Test Results
- `cargo check` passed for `src/TerminalWindowManager.Tauri/src-tauri`.
- `cargo tree -i tao --edges normal` shows `tao v0.35.2` resolving from crates.io through `tauri-runtime-wry`.
- `cargo test` passed for `src/TerminalWindowManager.Tauri/src-tauri` with 17 tests.
- `bun run build:view` passed for `src/TerminalWindowManager.Tauri`.

## Outcome
- Local verification passed and the repository no longer carries a full TAO copy.
- The bug remains open until the user confirms the original slash/dead-key crash no longer reproduces in the installed/runtime app.

## Next Step
- Ask the user to retest the original slash/dead-key scenario and confirm whether the crash is resolved.

## Remaining Gaps
- The exact user-level reproduction sequence remains intermittent, so final confirmation still requires user retesting in the original environment.
