# Bug Status

## Current State
- fixed

## Active Attempt
- `fix-attempt-002.md`

## Last Updated
- 2026-04-08

## Confirmation Date
- 2026-04-08

## Resolution Summary
- Attempt 001 restored titlebar double-click maximize and drag behavior.
- Attempt 002 aligns the native Tauri window background with the app's dark chrome to avoid white resize artifacts.

## Attempt History
- `fix-attempt-001.md` - created
- `fix-attempt-002.md` - created

## State Change Log
- 2026-04-08: bug opened
- 2026-04-08: investigation found overlapping native and manual drag handling on the custom titlebar
- 2026-04-08: fix attempt 001 started
- 2026-04-08: user confirmed the gesture fix and reported white artifacts during window resize
- 2026-04-08: fix attempt 002 started to align the native window background color with the dark app shell
- 2026-04-08: desktop package rebuild passed with the explicit dark window background; awaiting user confirmation
- 2026-04-08: user confirmed the titlebar gesture and resize-artifact fixes

## Notes
- The issue appears limited to the Tauri custom titlebar path.
