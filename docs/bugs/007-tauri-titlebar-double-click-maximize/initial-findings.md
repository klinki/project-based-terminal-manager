# Initial Findings

## Confirmed Facts
- The Tauri renderer already has a `dblclick` handler on the titlebar that calls `getCurrentWindow().toggleMaximize()`.
- The same titlebar also starts dragging immediately on `pointerdown`.
- The header is additionally marked with `data-tauri-drag-region`.

## Likely Cause
- Drag handling wins too early, so the browser never gets a stable double-click gesture on the titlebar.
- Having both Tauri native drag-region behavior and manual `startDragging()` logic on the same element makes the event flow unreliable for double-click.

## Unknowns
- Whether the native drag region alone, the manual `pointerdown` drag start, or the combination of both is the direct blocker.

## Reproduction Status
- Reproduced by code inspection against the current event wiring.

## Evidence Gathered
- `main.ts` shows `data-tauri-drag-region`, `pointerdown => startDragging()`, and `dblclick => toggleMaximize()` all attached to the same titlebar.
