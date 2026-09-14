# Fix Attempt 001

## Attempt Status
- superseded

## Goal
- Make the existing HTML5 drag-and-drop implementation robust within its own API.

## Relation To Previous Attempts
- First attempt (after the RPC/ACL repair in `dde03b9`).

## Proposed Change
- Move `draggable="true"` and the drag-id attributes from the row `<button>`s to the row containers (`div.tree-project-row`, terminal `li`), so grabs starting on row padding or the `+` action button initiate an element drag instead of a dead text drag.
- Defer `renderTree()` while a sidebar drag is active and flush on `dragend`, so mid-drag DOM replacement cannot abort the native gesture.
- Resolve drops landing on list padding or a project's own header (move to start/end, append to project) instead of rejecting them.
- Cancel `dragenter` as well as `dragover`.
- Corresponding cursor/dragging-state CSS updates.

## Risks
- Still depends on the WebKit native gesture reaching the page, which was never proven in the real app.

## Files And Components
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts`
- `src/TerminalWindowManager.Tauri/src/mainview/style.css`

## Verification Plan
- Headless WebKit harness: row-grab, header-drop, padding-drop, terminal reorder via real mouse gestures.
- Rebuild the packaged app and confirm with the reporter.

## Implementation Summary
- Implemented as described; committed as `7b5db90`.
- Harness result: all four flows passed in stock WebKit.

## Test Results
- Harness: 4/4 passed. Packaged-app user test: no change — identical symptoms.

## Outcome
- Superseded: hardening the HTML5 implementation was insufficient. The defect is below the DOM API level (see attempt 002).

## Next Step
- Instrument the packaged app to observe which drag events actually reach the page.

## Remaining Gaps
- Root cause of the missing delivery still unknown at this point.
