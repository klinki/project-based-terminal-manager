# Bug Description

## Title
Tauri sidebar rerenders during live output and interferes with console switching

## Status
- open

## Reported Symptoms
- When one console is actively streaming output, clicking another console in the left sidebar does not reliably switch to it.
- Hover states in the left sidebar blink while a console is streaming.

## Expected Behavior
- The sidebar should remain stable while telemetry and output events are arriving.
- Hover styles should remain steady while the pointer stays over a sidebar item.
- Clicking another console should activate it even if a different console is currently streaming.

## Actual Behavior
- Streaming output triggers repeated sidebar redraws.
- Sidebar hover state visibly flickers because the hovered DOM nodes are recreated.
- The repeated redraws interfere with click completion when the user tries to switch consoles mid-stream.

## Reproduction Details
- Start a console that continuously prints output.
- Move the pointer over project or console rows in the left sidebar.
- Try to click a different console while output is still arriving.

## Affected Area
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts`

## Constraints
- Keep the existing Tauri state/event model intact for this fix attempt.
- Avoid broad changes to backend session handling unless the renderer fix is insufficient.

## Open Questions
- None required for the current repair.
