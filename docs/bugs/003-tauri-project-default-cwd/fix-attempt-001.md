# Fix Attempt 001

## Attempt Status
- fixed

## Goal
- Make the Tauri project default CWD reliably affect new project consoles and stopped consoles that still inherit the previous default.

## Relation To Previous Attempts
- First attempt.

## Proposed Change
- Stop hardcoding the console CWD in the Tauri frontend create-console flow and let the backend resolve it.
- When the project default CWD changes, update stopped project terminals that still match the previously inherited project/global default.

## Risks
- Updating terminal records too broadly could overwrite explicitly customized terminal CWDs.
- Updating active terminals could misrepresent the live session’s actual directory.

## Files And Components
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts`
- `src/TerminalWindowManager.Tauri/src-tauri/src/backend.rs`

## Verification Plan
- Run targeted searches to confirm the Tauri create-console flow no longer hardcodes the project/global CWD.
- Run type/build checks for the Tauri frontend and Rust backend if the toolchain is available.

## Implementation Summary
- Changed the Tauri frontend create-console flow to send an empty `cwd`, so the backend remains the single source of truth for project/global default resolution.
- Updated `SessionManager::set_project_default_cwd` to rewrite stopped project terminals whose stored CWD still matched the previously inherited project/global default, while leaving running and explicitly customized terminals unchanged.

## Test Results
- Source inspection confirmed `createConsoleFromProject` now sends `cwd: ""`.
- `cargo check --manifest-path src/TerminalWindowManager.Tauri/src-tauri/Cargo.toml` passed.
- `bun x tsc --noEmit -p src/TerminalWindowManager.Tauri/tsconfig.json` failed on existing unrelated issues:
- `src/TerminalWindowManager.Tauri/src/mainview/electroview.ts(65,5)`: `stopAllSessions` is implemented but missing from the TypeScript RPC type.
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts(5,8)`: CSS side-effect import typing is missing.
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts(696,63)`: an unrelated callsite has a type mismatch.

## Outcome
- Local fix is in place and the Rust backend compiles.
- User confirmed the Tauri app behavior is fixed.

## Next Step
- None.

## Remaining Gaps
- No automated UI-level regression test exists for this workflow yet.
