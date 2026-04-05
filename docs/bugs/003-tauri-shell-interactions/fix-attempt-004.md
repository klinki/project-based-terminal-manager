# Fix Attempt 004

## Status
Completed locally; awaiting user confirmation

## Goal
Make a newly created console activate immediately so it visibly loads instead of waiting for the inline rename flow to complete.

## Relation To Previous Attempts
- This follows the bridge fix that restored project and console creation.
- The remaining issue is now the session activation timing, not the Tauri bridge or permissions.

## Proposed Change
- Activate the newly created console immediately after creating it.
- Keep the inline rename affordance, but do not require rename commit before the shell session starts.

## Risks
- The new console row may still be in inline edit mode while the shell is already active, so the UI needs to keep selection and edit state coherent.

## Expected Verification
- `cargo check` in `src-tauri`
- `bun run build:view`
- `build.ps1 -Target Desktop`
- Manual interaction check for create console and visible shell startup

## Files Or Components Involved
- `src/TerminalWindowManager.ElectroBun/src/mainview/main.ts`

## Implementation Summary
- Changed the new-console flow to activate the console immediately after creation.
- Kept the inline rename state, but no longer require rename commit before the shell session starts.

## Verification Results
- `cargo check` in `src/TerminalWindowManager.ElectroBun/src-tauri` passed.
- `bun run build:view` in `src/TerminalWindowManager.ElectroBun` passed.
- `./build.ps1 -Target Desktop` passed and produced MSI and NSIS bundles.

## Outcome
The console should now visibly load as soon as it is created. Please retest console creation and activation in the desktop app.
