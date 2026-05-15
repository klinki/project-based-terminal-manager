# Sidebar Drag Reorder

## Summary
- Save path: [feature-spec.md](feature-spec.md)
- Artifact type: `feature-spec.md`
- Add drag-and-drop ordering for projects in the sidebar.
- Add drag-and-drop ordering for consoles within a project.
- Persist the user-defined order so the sidebar remains stable across app restarts.

## Problem
Projects and consoles currently render in their stored array order. Users can create, rename, select, and delete them, but cannot rearrange the sidebar once the structure grows. This makes active workflows harder to keep near the top and forces users to recreate items or tolerate a stale order.

## Goals
- Let users reorder projects directly in the project tree.
- Let users reorder consoles directly inside their current project.
- Preserve ordering after state refreshes, renderer restarts, app restarts, and packaged app launches.
- Keep drag interactions compatible with project expand/collapse, selection, context menu, inline rename, and the existing new-console action.
- Avoid changing terminal process lifecycle when a console is moved.

## Non-Goals
- Moving a console from one project to another by drag-and-drop.
- Multi-select reordering.
- Sorting by name, activity, or date as a user-facing mode.
- Cross-window drag-and-drop.
- Reordering via settings screens or a separate management view.

## User Experience
- Users can drag a project row up or down to place it before or after another project.
- Users can drag a console row up or down within the same project to place it before or after another console.
- A dragged item shows a clear drag affordance, and valid drop positions are visually indicated.
- Project drag starts from the project row, but clicking the row still selects the project and clicking the chevron still expands or collapses it.
- Console drag starts from the console row, but clicking the row still activates the console.
- Inline rename mode disables dragging for the item being edited.
- Dropping an item outside a valid target cancels the reorder without changing persisted state.
- Reordering the active project or active console does not change which item is selected or which terminal session is running.
- Empty projects show their existing empty state and do not accept console drops from other projects in this iteration.

## Data And Persistence
- Persist an explicit project ordering field instead of relying on creation timestamps or incidental array position.
- Persist an explicit console ordering field scoped to each project.
- Existing metadata files must migrate without data loss by assigning order values from the current array order.
- New projects and consoles are appended after existing siblings by default.
- Deleting a project or console removes only that record; remaining order values may be normalized during save or load.
- The persisted model remains backward-compatible with metadata that lacks ordering fields.

## Public Interfaces
- Extend the shared project model with an order field, for example `sortOrder`.
- Extend the shared terminal model with an order field, for example `sortOrder`.
- Add backend commands for reorder operations:
  - Reorder projects by ordered project IDs.
  - Reorder consoles within one project by ordered terminal IDs.
- The commands return the updated `AppState` and emit the same state-change flow used by create, rename, and delete operations.

## Validation Rules
- Project reorder requests must contain every existing project ID exactly once.
- Console reorder requests must target one project and contain every terminal ID currently in that project exactly once.
- Unknown IDs, duplicate IDs, missing IDs, or terminals from another project reject the request with a clear error.
- Reorder requests do not create, delete, rename, start, stop, restart, or move terminal sessions.

## Accessibility And Input
- Drag-and-drop must not be the only path for keyboard users.
- Provide keyboard-accessible reorder actions for the selected project or console, such as move up and move down commands in the existing context menu.
- Keyboard reorder actions must obey the same validation and persistence rules as pointer drag-and-drop.
- Visual drag/drop indicators must not be the only status signal; focus and context-menu actions should remain understandable with standard accessible names.

## Acceptance Criteria
- Given three projects, when the user drags the third project above the first project, then the sidebar renders the third project first and the order persists after app restart.
- Given a project with three consoles, when the user drags the last console above the first console in that project, then only that project's console order changes and the order persists after app restart.
- Given a running active console, when the user reorders that console within its project, then the active terminal remains active and the underlying session continues running.
- Given an expanded project, when the user reorders projects, then the project remains expanded after reorder unless it was explicitly collapsed.
- Given a console drop attempt into a different project, then the app cancels the drop and leaves all console project assignments unchanged.
- Given metadata created before this feature, when the app loads it, then projects and consoles appear in the same order they appeared before the feature was added.
- Given a reorder request with duplicate, missing, or unknown IDs, then the backend rejects the request and preserves the previous order.
- Given a keyboard-only user, when they open the context menu for a project or console, then they can move the item up or down among valid siblings.

## Implementation Notes
- Current sidebar rendering is in [main.ts](../../../src/TerminalWindowManager.Tauri/src/mainview/main.ts), with `sortProjects` and `sortTerminals` already isolated as ordering hooks.
- Shared frontend types are in [types.ts](../../../src/TerminalWindowManager.Tauri/src/shared/types.ts).
- Persisted Tauri state models and metadata normalization are in [models.rs](../../../src/TerminalWindowManager.Tauri/src-tauri/src/models.rs).
- Tauri backend state mutations are in [backend.rs](../../../src/TerminalWindowManager.Tauri/src-tauri/src/backend.rs).

## Test Plan
- Add unit coverage for metadata normalization assigning order to old project and terminal records.
- Add backend unit coverage for valid and invalid project reorder requests.
- Add backend unit coverage for valid and invalid console reorder requests within a project.
- Add frontend coverage for rendering user-defined project and console order.
- Manually verify pointer drag-and-drop in the Tauri shell for projects and consoles.
- Manually verify keyboard move up and move down actions from the sidebar context menu.
- Build with `.\build.ps1 -Target Tauri`.

## Assumptions
- "Chats" in the request maps to the app's existing console or terminal records displayed under each project.
- Reordering consoles across projects is intentionally out of scope for the first iteration.
- The persisted order should be authoritative, while creation time remains metadata rather than the default sort key after migration.
