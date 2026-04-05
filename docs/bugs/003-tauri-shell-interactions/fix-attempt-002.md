# Fix Attempt 002

## Status
Completed locally; awaiting user confirmation

## Goal
Fix the remaining shell interaction regressions after the Settings dialog was restored.

## Relation To Previous Attempts
- This attempt follows the first ACL-focused fix.
- The first attempt restored Settings, which confirms the Tauri bridge is working, but the remaining actions still need a more direct runtime path.

## Proposed Change
- Switch the titlebar window controls to Tauri's frontend `getCurrentWindow()` API instead of routing them through a Rust command wrapper.
- Use Tauri's manual drag API for the titlebar so dragging does not depend on the backend window command layer.
- Add explicit `try/catch` handling around project and console creation flows so any silent RPC or state-resolution failures are surfaced in the status banner.

## Risks
- Changing the titlebar behavior may expose differences between Tauri's drag handling and the current CSS-only setup.
- If the create-project/create-console issue is a backend validation bug, the new error reporting will expose it but not fix it on its own.

## Expected Verification
- `cargo check` in `src-tauri`
- `bun run build:view`
- `build.ps1 -Target Desktop`
- Manual interaction check for dragging, minimize/maximize, new project, and new console

## Files Or Components Involved
- `src/TerminalWindowManager.ElectroBun/src/mainview/main.ts`
- `src/TerminalWindowManager.ElectroBun/src/mainview/electroview.ts`
- `src/TerminalWindowManager.ElectroBun/src/shared/types.ts`

## Implementation Summary
- Replaced the titlebar's backend window calls with Tauri frontend window API calls using `getCurrentWindow()`.
- Added manual titlebar drag handling with `startDragging()` and a double-click maximize toggle.
- Wrapped the main shell interactions in `runUiAction()` so any silent failures now surface in the status banner.

## Verification Results
- `cargo check` in `src/TerminalWindowManager.ElectroBun/src-tauri` passed.
- `bun run build:view` in `src/TerminalWindowManager.ElectroBun` passed.
- `./build.ps1 -Target Desktop` passed and produced MSI and NSIS bundles.

## Outcome
Local verification passed. The actual desktop window still needs a user retest for drag, minimize/maximize, project creation, and console creation.
