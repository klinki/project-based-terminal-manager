# Initial Findings

## Confirmed Facts
- A physical right-click produces `mousedown`/`mouseup` (button 2) plus `contextmenu`, and no `click` — so the menu opens and stays.
- A macOS Ctrl+left-click produces `mousedown`/`mouseup` (button 0) plus `contextmenu` plus a regular `click` (button 0 with `ctrlKey === true`).
- The window `click` handler in `main.ts` unconditionally calls `hideContextMenu()` for clicks outside the menu, so the `click` from the same Ctrl+click gesture dismisses the just-opened menu.
- The same stray `click` also reaches the sidebar `click`/`dblclick` handlers (select/activate/rename) and the sidebar `pointerdown` handler (drag arming).

## Likely Cause
- The gesture layer does not distinguish a simulated right-click from a plain left-click.

## Unknowns
- None; the event flow fully explains the symptom, including why the USB mouse works.

## Reproduction Status
- Reproduced by the reporter in the packaged macOS app; mechanism confirmed by code inspection of the event wiring.

## Evidence Gathered
- `main.ts` window `click` handler (`hideContextMenu()` on any outside click), sidebar `click`/`dblclick`/`pointerdown` handlers with no `ctrlKey` handling.
