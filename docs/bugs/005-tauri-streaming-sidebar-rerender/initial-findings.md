# Initial Findings

## Confirmed Facts
- The Tauri backend updates terminal activity on each output chunk and emits a fresh `state-changed` snapshot.
- The Tauri renderer handles every `stateChanged` message by calling `renderTree()`.
- `renderTree()` rebuilds the entire sidebar tree with `innerHTML`, replacing hovered and clickable nodes.
- The tree markup for a continuously streaming console is usually unchanged even though the state snapshot is new.

## Likely Cause
- Sidebar DOM churn during live output resets hover state and can interrupt click delivery while the user is trying to switch consoles.

## Unknowns
- Whether any additional backend throttling will still be useful after renderer stabilization.

## Reproduction Status
- Reproduced by code inspection of the Tauri renderer and backend activity update flow.

## Evidence Gathered
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts`
- `src/TerminalWindowManager.Tauri/src-tauri/src/backend.rs`
