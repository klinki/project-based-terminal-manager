# Fix Attempt 003

## Status
Completed locally; awaiting user confirmation

## Goal
Fix the bridge construction bug that prevented the frontend from reaching the Tauri request handlers.

## Relation To Previous Attempts
- This follows the second attempt, which fixed the window chrome.
- The remaining create-flow error was traced to the bridge object being wrapped incorrectly, not to the backend commands themselves.

## Proposed Change
- Construct `Electroview` with the actual RPC bridge instead of wrapping it in an extra object.
- Keep the existing `proxy.request` call sites intact once the bridge shape matches what the UI expects.

## Risks
- This is a small change, but it touches the root bridge wiring that every Tauri request path depends on.

## Expected Verification
- `cargo check` in `src-tauri`
- `bun run build:view`
- `build.ps1 -Target Desktop`
- Manual interaction check for create project and create console

## Files Or Components Involved
- `src/TerminalWindowManager.ElectroBun/src/mainview/main.ts`

## Implementation Summary
- Fixed the frontend bridge construction so `Electroview` receives the actual RPC bridge instead of `{ rpc }`.
- This restores the `proxy.request` shape expected by the create project and create console flows.

## Verification Results
- `cargo check` in `src/TerminalWindowManager.ElectroBun/src-tauri` passed.
- `bun run build:view` in `src/TerminalWindowManager.ElectroBun` passed.
- `./build.ps1 -Target Desktop` passed and produced MSI and NSIS bundles.

## Outcome
The bridge wiring now matches the runtime shape expected by the UI. Please retest create project and create console in the desktop app.
