# Bug Status

## Current State
- awaiting_user_confirmation

## Active Attempt
- `fix-attempt-001.md`

## Last Updated
- 2026-04-08

## Confirmation Date
- pending

## Resolution Summary
- The Tauri renderer now skips sidebar `innerHTML` replacement when a streamed state update does not change the actual rendered tree markup.

## Attempt History
- `fix-attempt-001.md` - created

## State Change Log
- 2026-04-08: bug opened
- 2026-04-08: investigation confirmed repeated sidebar rerenders during streamed output
- 2026-04-08: fix attempt 001 started
- 2026-04-08: local verification completed; awaiting user confirmation

## Notes
- `bun x tsc --noEmit -p src/TerminalWindowManager.Tauri/tsconfig.json` passed.
