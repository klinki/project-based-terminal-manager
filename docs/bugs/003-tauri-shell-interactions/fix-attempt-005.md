# Fix Attempt 005

## Status
Superseded by attempt 006

## Goal
Make shell startup events and output reach the renderer reliably so a newly created console transitions out of `Starting`, shows its prompt/output, and accepts input.

## Relation To Previous Attempts
- Attempts 001-004 fixed the obvious permission, bridge, and activation issues.
- The remaining symptom suggests the shell is launching but the renderer is not seeing the startup event/output path consistently.

## Proposed Change
- Add explicit Tauri event permissions for the window shell to listen for backend events.
- Make the frontend wait for the backend listener registrations to complete before it finishes bootstrapping the interactive shell UI.

## Risks
- If the issue is not event registration or permission related, the change may not address the stuck `Starting` state.
- The added startup wait should stay short and deterministic so it does not make the app feel slower.

## Expected Verification
- `cargo check` in `src-tauri`
- `bun run build:view`
- `build.ps1 -Target Desktop`
- Manual interaction check for creating a console, observing it transition to `Running`, and typing into the shell immediately

## Files Or Components Involved
- `src/TerminalWindowManager.ElectroBun/src-tauri/capabilities/default.json`
- `src/TerminalWindowManager.ElectroBun/src/mainview/electroview.ts`
- `src/TerminalWindowManager.ElectroBun/src/mainview/main.ts`

## Implementation Summary
- Added explicit `core:event:default` to the Tauri capability set so the renderer can receive backend-emitted shell lifecycle events.
- Changed the frontend event bridge to await registration of the Tauri `listen(...)` handlers before completing startup.
- Kept the existing command bridge intact while gating interactive startup on the event listeners being ready.

## Verification Results
- `cargo check` in `src/TerminalWindowManager.ElectroBun/src-tauri` passed.
- `bun run build:view` in `src/TerminalWindowManager.ElectroBun` passed.
- `./build.ps1 -Target Desktop` passed and produced the MSI and NSIS bundles.

## Outcome
The listener-readiness change did not resolve the console hang in the desktop app. The next attempt removes the auto-rename focus path so the terminal itself stays the primary input target.
