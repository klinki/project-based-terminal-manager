# Bug Description

## Title
Sidebar drag-and-drop reorder silently never lands on macOS

## Status
- fixed

## Reported Symptoms
- Dragging a project onto another project (or a console onto another console) in the sidebar does nothing on release.
- While dragging, no blue drop-indicator line ever appears; the cursor shows a green rounded plus instead.
- No error is shown in the status banner; the gesture fails silently.
- Affects both projects and consoles, even when no console is visibly active.

## Expected Behavior
- Dragging a sidebar item shows a drop indicator on valid targets.
- Releasing over a valid target reorders projects, or consoles within their project, and persists the new order.
- Grabs starting anywhere on a row (not just the button text) initiate the drag.

## Actual Behavior
- The native drag session visibly starts (a ghost image follows the cursor), but the page never engages: no indicator, no drop, no error.

## Reproduction Details
- Launch the Tauri app on macOS with at least two projects (or two consoles in one project).
- Drag one sidebar item onto another and release.

## Affected Area
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts`
- `src/TerminalWindowManager.Tauri/src/mainview/style.css`
- Sidebar drag-and-drop interaction handling

## Constraints
- Click selection, double-click rename, context-menu Move up/down, and collapse toggles must keep working.
- Text inputs (rename editors) must remain editable; drags must never start from them.
- No new dependencies; no backend changes required (the reorder commands already existed).

## Open Questions (answered during investigation)
- Whether the reorder backend/ACL layer was at fault (it was broken too, but separately — see `dde03b9`).
- Whether Tauri/wry intercepts page-level drag events on macOS (it does not).
- Whether tree re-renders during the drag abort the gesture (proven: they do under rapid replacement).
