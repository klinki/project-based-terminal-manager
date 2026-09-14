# Fix Attempt 001

## Attempt Status
- fixed

## Goal
- Make macOS Ctrl+click behave exactly like a physical right-click across the sidebar gesture layer.

## Relation To Previous Attempts
- First and only attempt.

## Proposed Change
- Detect the simulated right-click once, next to the existing `IS_MACOS` flag: `IS_MACOS && event.ctrlKey && event.button === 0`.
- Window `click` handler: skip `hideContextMenu()` for simulated right-clicks (shell-selector dropdown dismissal still runs).
- Sidebar `click`/`dblclick` handlers: ignore simulated right-clicks (no select, activate, or rename).
- Sidebar `pointerdown` (drag arming) and titlebar `pointerdown` (window drag): ignore simulated right-clicks.
- Everything is gated on macOS, so Windows/Linux behavior is byte-for-byte unchanged.

## Risks
- A user legitimately Ctrl+clicking for another purpose on macOS loses nothing: the app defines no Ctrl+click action.
- Ctrl+click no longer dismisses the shell-selector dropdown via the guarded path; the dropdown still closes via its own focus/selection handling.

## Files And Components
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts`

## Verification Plan
- Headless WebKit harness with real Ctrl+click input: menu opens and stays, no selection change, physical right-click and plain click unaffected, Ctrl+drag starts no reorder.
- Negative control: same harness against the pre-fix build must reproduce the instant-close.
- `tsc` clean, packaged-app confirmation by the reporter.

## Implementation Summary
- Implemented as described; committed as `531528b`.

## Test Results
- Harness with fix: 6/6 passed (menu opens, menu stays open after 400ms, no selection, right-click works, plain click selects, Ctrl+drag inert).
- Harness against pre-fix build: all 3 Ctrl+click checks failed (menu already hidden 150ms after opening), confirming the harness reproduces the reported bug.
- Reporter confirmed the fix in the packaged app.

## Outcome
- Fixed.

## Next Step
- None.

## Remaining Gaps
- None known.
