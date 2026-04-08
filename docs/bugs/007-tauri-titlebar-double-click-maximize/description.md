# Bug Description

## Title
Tauri custom titlebar does not maximize or restore on double-click

## Status
- fixed

## Reported Symptoms
- Double-clicking the top titlebar area in the Tauri app does not maximize or restore the window.
- Other titlebar gestures still work, including drag and the explicit maximize button.
- After the gesture fix, resizing the window shows white visual artifacts.

## Expected Behavior
- Double-clicking the draggable top-of-window area should toggle maximize and restore, matching normal Windows window behavior.
- Resizing the window should keep the same dark app chrome without white flashes or uncovered native background.

## Actual Behavior
- The custom Tauri titlebar ignores the double-click maximize gesture.
- The titlebar gesture works after the first fix, but native window resize can reveal white artifacts that do not match the app theme.

## Reproduction Details
- Launch the Tauri app on Windows.
- Double-click an empty area in the custom titlebar, away from the window control buttons.

## Affected Area
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts`
- Tauri custom titlebar interaction handling

## Constraints
- Dragging the custom titlebar must continue to work.
- Window-control buttons must remain unaffected.
- Any fix for resize artifacts should preserve the restored titlebar double-click behavior.

## Open Questions
- Whether the built-in Tauri drag region handling is consuming the gesture before the custom `dblclick` handler can run.
- Whether the resize artifacts come from the native window background rather than the webview DOM.
