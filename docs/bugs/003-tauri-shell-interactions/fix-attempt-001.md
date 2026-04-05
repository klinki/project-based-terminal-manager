# Fix Attempt 001

## Status
Completed locally; awaiting user confirmation

## Goal
Restore the shell interactions that are currently dead after the ElectroBun to Tauri migration.

## Relation To Previous Attempts
- First attempt for this bug.

## Proposed Change
- Add a custom Tauri permission set for the Rust app commands used by the frontend.
- Add the missing `core:window:allow-start-dragging` permission so the custom titlebar can drag the window.
- Wire the Settings button to an actual settings dialog instead of leaving it inert.
- Persist settings updates through the existing app state model so new consoles can keep using the configured defaults.

## Risks
- Adding the wrong command identifiers would leave the app blocked behind ACL errors.
- The Settings dialog needs to stay simple so it does not introduce another broken flow.

## Expected Verification
- `cargo check` in `src-tauri`
- `bun run build:view`
- `build.ps1 -Target Desktop`
- Manual interaction check for titlebar drag, window controls, new project, new console, and Settings

## Files Or Components Involved
- `src/TerminalWindowManager.ElectroBun/src-tauri/capabilities/default.json`
- `src/TerminalWindowManager.ElectroBun/src-tauri/permissions/*.toml`
- `src/TerminalWindowManager.ElectroBun/src-tauri/src/lib.rs`
- `src/TerminalWindowManager.ElectroBun/src-tauri/src/backend.rs`
- `src/TerminalWindowManager.ElectroBun/src/mainview/main.ts`
- `src/TerminalWindowManager.ElectroBun/src/mainview/electroview.ts`
- `src/TerminalWindowManager.ElectroBun/src/shared/types.ts`

## Implementation Summary
- Added a custom Tauri permission set for the frontend app commands in `src-tauri/permissions/app-commands.toml`.
- Expanded the main window capability to include the app-command set plus the Tauri window permissions needed for dragging and window controls.
- Added `update_defaults` to the Rust backend and exposed it through the Tauri command handler.
- Wired the frontend Settings button to a real dialog that edits the persisted default working directory and shell.
- Kept the rest of the TypeScript UI structure intact.

## Verification Results
- `cargo check` in `src/TerminalWindowManager.ElectroBun/src-tauri` passed.
- `bun run build:view` in `src/TerminalWindowManager.ElectroBun` passed.
- `./build.ps1 -Target Desktop` passed and produced MSI and NSIS bundles.

## Outcome
Local verification passed. The shell still needs a human interaction check in the actual Tauri window to confirm drag, minimize, maximize, new project, new console, and Settings all respond correctly.
