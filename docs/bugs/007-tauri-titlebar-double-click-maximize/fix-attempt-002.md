# Fix Attempt 002

## Attempt Status
- fixed

## Goal
- Remove white resize artifacts that appear in the Tauri window after the titlebar gesture fix.

## Relation To Previous Attempts
- Follow-up to `fix-attempt-001.md`.
- Attempt 001 restored double-click maximize and drag behavior, but user retesting then revealed white flashes during native window resize.

## Proposed Change
- Set the Tauri window `backgroundColor` explicitly to the app's dark shell background.
- Keep the renderer styling unchanged so the native window background and webview background stay visually aligned during resize.

## Risks
- Low risk. The change is limited to Tauri window configuration.
- If the artifacts come from a different layer, this may reduce but not fully eliminate them.

## Files And Components
- `src/TerminalWindowManager.Tauri/src-tauri/tauri.conf.json`

## Verification Plan
- Rebuild the Tauri desktop package to validate the configuration.
- Retest interactive resize in the installed or rebuilt app and look for background flashes.

## Implementation Summary
- Added `backgroundColor: "#0E0E0E"` to the Tauri window definition so the native window background matches the dark app chrome during resize and repaint.

## Test Results
- `bun run build:desktop` passed and regenerated:
  - `src/TerminalWindowManager.Tauri/src-tauri/target/release/bundle/nsis/Terminal Window Manager Tauri_0.0.1_x64-setup.exe`
  - `src/TerminalWindowManager.Tauri/src-tauri/target/release/bundle/msi/Terminal Window Manager Tauri_0.0.1_x64_en-US.msi`
- The Tauri package accepted the new `backgroundColor` window configuration without build errors.

## Outcome
- Local packaging verification succeeded. The rebuilt installers now carry a dark native window background that matches the app shell during resize.
- User confirmed the fix in the app.

## Next Step
- None.

## Remaining Gaps
- None after user confirmation.
