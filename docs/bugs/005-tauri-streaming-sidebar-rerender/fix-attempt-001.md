# Fix Attempt 001

## Attempt Status
- awaiting_user_confirmation

## Goal
- Stop unnecessary sidebar DOM replacement during live output so hover and console switching remain stable.

## Relation To Previous Attempts
- First attempt.

## Proposed Change
- Cache the most recent sidebar tree markup in the Tauri renderer.
- Skip `innerHTML` replacement when a `stateChanged` snapshot does not materially change the rendered sidebar markup.

## Risks
- If some sidebar state depends on side effects of `renderTree()`, skipping identical redraws could leave that behavior stale.
- This fix does not reduce backend event volume; it only prevents redundant DOM churn in the renderer.

## Files And Components
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts`

## Verification Plan
- Run the Tauri TypeScript compile check.
- Manually verify that the code path now preserves sidebar DOM when the rendered markup is unchanged.

## Implementation Summary
- Added a renderer-side cache for the sidebar tree markup in the Tauri main view.
- Updated `renderTree()` to rebuild the sidebar DOM only when the rendered markup actually changes.
- Kept the existing selection, activity, and backend event flow unchanged so the fix stays narrowly scoped to the sidebar churn.

## Test Results
- `bun x tsc --noEmit -p src/TerminalWindowManager.Tauri/tsconfig.json` passed.

## Outcome
- Local compilation succeeded and the redundant sidebar redraw path is removed. User confirmation is still required for live interaction behavior.

## Next Step
- Have the user verify that sidebar hover stays stable and that switching consoles now works while another console is streaming.

## Remaining Gaps
- Manual app interaction still needs user confirmation.
