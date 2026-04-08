# Fix Attempt 001

## Attempt Status
- awaiting_user_confirmation

## Goal
- Deliver an editable shell combobox with built-in shell options, persistent custom history, and delete controls.

## Relation To Previous Attempts
- First attempt.

## Proposed Change
- Extend persisted app defaults with a `customShells` history in both implementations.
- Replace the settings shell datalist with a custom combobox UI.
- Keep `pwsh.exe` and `cmd.exe` pinned as built-in choices.
- Persist user-entered custom shells and allow deleting them from the saved list.

## Risks
- State model changes could break older saved settings if normalization is incomplete.
- The custom dropdown could interfere with existing dialog interactions if event handling is wrong.

## Files And Components
- `src/TerminalWindowManager.Tauri/src/shared/types.ts`
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts`
- `src/TerminalWindowManager.Tauri/src/mainview/style.css`
- `src/TerminalWindowManager.Tauri/src/mainview/electroview.ts`
- `src/TerminalWindowManager.Tauri/src-tauri/src/models.rs`
- `src/TerminalWindowManager.Tauri/src-tauri/src/backend.rs`
- `src/TerminalWindowManager.Tauri/src-tauri/src/lib.rs`
- `src/TerminalWindowManager.ElectroBun/src/shared/types.ts`
- `src/TerminalWindowManager.ElectroBun/src/mainview/main.ts`
- `src/TerminalWindowManager.ElectroBun/src/mainview/style.css`
- `src/TerminalWindowManager.ElectroBun/src/bun/AppStateStore.ts`
- `src/TerminalWindowManager.ElectroBun/src/bun/index.ts`

## Verification Plan
- Compile both TypeScript frontends.
- Compile the Tauri Rust backend.
- Confirm the built-in shell options, custom persistence, and delete controls are wired in both implementations.

## Implementation Summary
- Added `customShells` to persisted defaults and normalized saved values with built-in filtering and deduping.
- Replaced the shell datalist field with a custom editable combobox UI in both frontends.
- Added built-in `pwsh.exe` and `cmd.exe` options, persistent custom entries, and delete controls for saved custom shells.
- Added minor nearby typing fixes so verification could complete cleanly.

## Test Results
- `bun x tsc --noEmit -p src/TerminalWindowManager.Tauri/tsconfig.json` passed.
- `bun x tsc --noEmit -p src/TerminalWindowManager.ElectroBun/tsconfig.json` passed.
- `cargo check --manifest-path src/TerminalWindowManager.Tauri/src-tauri/Cargo.toml` passed.

## Outcome
- Local implementation and compilation checks succeeded. User confirmation is still required.

## Next Step
- Have the user verify the new settings shell selector behavior in the app.

## Remaining Gaps
- No automated UI interaction test covers this settings combobox flow yet.
