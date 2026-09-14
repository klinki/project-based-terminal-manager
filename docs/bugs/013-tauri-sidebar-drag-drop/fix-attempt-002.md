# Fix Attempt 002

## Attempt Status
- fixed

## Goal
- Replace the HTML5 drag-and-drop implementation with pointer-based dragging that cannot fail the way the native gesture does.

## Relation To Previous Attempts
- Follows attempt 001 (`7b5db90`), which hardened HTML5 DnD but produced no change in the packaged app.

## Investigation That Drove This Decision
- Temporary `dnd-diag` logging (persisted via the existing `log_renderer_event` pipeline, reverted afterwards) was shipped in a diagnostics build.
- Reporter-provided `app.log` showed, across ~10 gestures: `dragstart` fires (target `LI`/`DIV`), then **zero** `dragenter`/`dragover`/`drop` events reach the page — not even at document capture level — before `dragend` fires with drag state intact.
- Ruled out: missing drag state (single writer, proven), propagation stoppers (one unrelated `stopPropagation` in the codebase), Tauri/wry interception on macOS (the `drag_drop_handler` attribute is never installed by Tauri 2.11.2; the override falls through to default WebKit behavior), and the `drag_drop_enabled` config (never consumed on any platform in these versions).
- Separately proven in the harness: replacing the sidebar DOM on every mousemove kills HTML5 drops, so mid-drag re-renders (progress/activity events) were a second, independent drag killer.
- Conclusion: after `dragstart`, the Tauri WebKit webview delivers nothing further to the page for the gesture. Plain pointer events always flow (clicks and selection demonstrably work), so driving the gesture from `pointerdown`/`pointermove`/`pointerup` with coordinate hit-testing is immune to the entire failure class.

## Proposed Change
- Delete the HTML5 handlers (`dragstart`/`dragenter`/`dragover`/`dragleave`/`drop`/`dragend`) and the `draggable` attributes; remove all temporary diagnostics.
- Track the gesture with `pointerdown` (primary button only; inputs, textareas, selects, and the `+` action button excluded so their native behavior is untouched) on the tree, `pointermove`/`pointerup` on `window`.
- Activate past a 5px threshold; hit-test every move with `document.elementFromPoint` (fresh nodes, render-immune); show the same blue drop indicator; reuse the same drop-target resolution (items, list padding, own-project header) and the same `applySidebarDrop` reorder path.
- Swallow the click the browser fires after a pointer drag so a drop does not also select/activate the row.
- Edge auto-scroll for long lists; `Escape`, `pointercancel`, and window `blur` abort the gesture with full cleanup.
- Keep the render-deferral (re-keyed on the pointer drag) so the indicator and hit-test targets stay stable; flush on finish/cancel.
- Grab cursor on rows, grabbing cursor plus text-selection suppression on `body` while dragging, `touch-action: pan-y` on rows.

## Risks
- No native drag image follows the cursor (indicator line, dimmed source row, and grabbing cursor carry the feedback instead).
- A `pointerup` outside the window can be missed; mitigated with `pointercancel`/`blur` cleanup plus stale-state reset on the next `pointerdown`.

## Files And Components
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts`
- `src/TerminalWindowManager.Tauri/src/mainview/style.css`

## Verification Plan
- Headless WebKit harness with real mouse input: project reorder, terminal reorder, plain click still selects, drop outside the tree is a clean no-op with cleanup, drops survive rapid mid-drag re-renders, Escape cancels.
- `tsc` clean, packaged-app confirmation by the reporter.

## Implementation Summary
- Implemented as described; committed as `6c9466f`.

## Test Results
- Harness: 8/8 passed (project drag with indicator/dragging visuals, correct `reorder_projects` payload; plain click selects; outside-drop no-op with cleanup; drop survives mid-drag re-renders; Escape cancels; terminal reorder payload correct).
- Reporter confirmed the fix in the packaged app.

## Outcome
- Fixed.

## Next Step
- None. Cross-project console moves remain intentionally unsupported (backend reorder is per-project).

## Remaining Gaps
- None known. If drag issues recur, the `dnd-diag` logging approach from the investigation can be temporarily re-added; the headless harness lives in `/tmp/dnd` (not committed) and can be rebuilt from this document.
