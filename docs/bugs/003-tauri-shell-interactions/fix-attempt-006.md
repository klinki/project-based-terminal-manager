# Fix Attempt 006

## Status
Completed locally; awaiting user confirmation

## Goal
Remove the inline console rename focus path from new-console creation so the terminal surface remains the active input target immediately after session startup.

## Relation To Previous Attempts
- Attempt 005 focused on event delivery and bootstrap readiness.
- The remaining user symptom is now less about the shell launch mechanics and more about the console never becoming usable, so this attempt removes a likely focus conflict in the create flow.

## Proposed Change
- Stop entering inline rename mode when a new console is created.
- Keep the console selected and activate the live session immediately.
- Leave renaming available through the existing tree/context-menu interactions.

## Risks
- Users lose the convenience of inline rename on first create, but the shell should be more reliably interactive.
- If the underlying startup event is still missing, this change will only address part of the symptom.

## Expected Verification
- `cargo check` in `src-tauri`
- `bun run build:view`
- `build.ps1 -Target Desktop`
- Manual interaction check for creating a console, seeing the shell prompt, and typing immediately

## Files Or Components Involved
- `src/TerminalWindowManager.ElectroBun/src/mainview/main.ts`

## Implementation Summary
- Removed the automatic inline console rename step from new-console creation.
- New consoles now stay focused on the terminal surface immediately after activation.
- Updated the status message to reflect that the console is ready for input without requiring an inline rename commit.

## Verification Results
- `cargo check` in `src/TerminalWindowManager.ElectroBun/src-tauri` passed.
- `bun run build:view` in `src/TerminalWindowManager.ElectroBun` passed.
- `./build.ps1 -Target Desktop` passed and produced the MSI and NSIS bundles.

## Outcome
The next retest should confirm whether the console now becomes interactive immediately after creation.
