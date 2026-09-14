# Bug Description

## Title
macOS Ctrl+click opens the sidebar context menu and closes it right away

## Status
- fixed

## Reported Symptoms
- Ctrl+click (macOS simulated right-click) on a sidebar item flashes the context menu open, then it closes immediately.
- A physical right-click with a USB mouse works fine: the menu opens and stays.

## Expected Behavior
- Ctrl+click behaves exactly like a physical right-click: the context menu opens, stays open, and nothing is selected, renamed, or dragged as a side effect.

## Actual Behavior
- The menu opens via `contextmenu`, then the `click` belonging to the same gesture reaches the window click handler, which calls `hideContextMenu()` and dismisses it instantly.
- The same stray click could additionally select/activate the item, start a rename on double-click, or arm a sidebar drag.

## Reproduction Details
- Launch the Tauri app on macOS.
- Ctrl+click any project or console in the sidebar.

## Affected Area
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts`
- Sidebar gesture handling (click, double-click, pointerdown, window click dismissal)

## Constraints
- Physical right-click behavior must remain unchanged.
- Plain left-click selection/activation must remain unchanged.
- Windows/Linux behavior must remain unchanged (Ctrl+click has no special meaning there).
- Rename editors, dialog buttons, and the shell-selector dropdown must be unaffected.

## Open Questions (answered during investigation)
- Whether the `click` after a macOS Ctrl+click can be distinguished from a plain click (yes: `ctrlKey === true` with `button === 0`, gated on macOS).
