# Bug Status

## Current State
- awaiting_user_confirmation

## Active Attempt
- `fix-attempt-001.md`

## Last Updated
- 2026-04-08

## Confirmation Date
- pending

## Resolution Summary
- Tauri now delegates new-console CWD resolution to the backend and updates stopped inherited project consoles when the project default CWD changes.

## Attempt History
- `fix-attempt-001.md` - created

## State Change Log
- 2026-04-08: bug opened
- 2026-04-08: investigation confirmed frontend/backend CWD resolution mismatch and stale inherited terminal CWDs
- 2026-04-08: fix attempt 001 started
- 2026-04-08: local verification completed; awaiting user confirmation

## Notes
- `cargo check --manifest-path src/TerminalWindowManager.Tauri/src-tauri/Cargo.toml` passed.
- `bun x tsc --noEmit -p src/TerminalWindowManager.Tauri/tsconfig.json` failed on pre-existing unrelated issues in `electroview.ts`, `main.ts`, and CSS side-effect typing.
