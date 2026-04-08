# Fix Attempt 001

## Attempt Status
- awaiting_user_confirmation

## Goal
- Restore normal Windows maximize and restore behavior on double-clicking the custom Tauri titlebar.

## Relation To Previous Attempts
- First attempt.

## Proposed Change
- Remove the native Tauri drag-region attribute from the titlebar.
- Keep titlebar dragging under app control by starting drag only after a small pointer-move threshold.
- Preserve the existing double-click maximize behavior and clear any pending drag state before toggling maximize.

## Risks
- If the pointer threshold is wrong, drag might feel less responsive than before.
- If drag-state cleanup is incomplete, some titlebar gestures could become sticky.

## Files And Components
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts`

## Verification Plan
- Compile the Tauri frontend.
- Confirm the titlebar still starts dragging after pointer movement.
- Confirm double-click on the titlebar now toggles maximize and restore.

## Implementation Summary
- Replaced immediate drag start on `pointerdown` with a small movement threshold.
- Removed `data-tauri-drag-region` from the custom titlebar so the renderer owns the gesture flow.
- Added helper logic to ignore buttons and other interactive controls when deciding whether the titlebar should drag or toggle maximize.

## Test Results
- Pending.

## Outcome
- Pending.

## Next Step
- Run the Tauri TypeScript check and retest the gesture in the app.

## Remaining Gaps
- Manual in-app confirmation is still required for the exact Windows gesture behavior.
