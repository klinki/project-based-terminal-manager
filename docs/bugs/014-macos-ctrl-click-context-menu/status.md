# Bug Status

## Current State
- fixed

## Active Attempt
- `fix-attempt-001.md`

## Last Updated
- 2026-09-14

## Confirmation Date
- 2026-09-14

## Resolution Summary
- Attempt 001 detects the macOS simulated right-click and excludes it from menu dismissal, selection, rename, and drag arming; reporter confirmed.

## Attempt History
- `fix-attempt-001.md` - fixed

## State Change Log
- 2026-09-14: bug reported (Ctrl+click flashes the context menu then closes it; USB right-click fine)
- 2026-09-14: event-flow analysis identified the stray `click` dismissing the menu via the window click handler
- 2026-09-14: attempt 001 implemented, harness-verified 6/6 with a failing negative control on the pre-fix build, shipped; reporter confirmed the fix

## Notes
- The issue is macOS-specific by construction (Ctrl+click has no special meaning on other platforms, and the guard is macOS-gated).
