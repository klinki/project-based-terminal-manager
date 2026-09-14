# Initial Findings

## Confirmed Facts
- The reorder backend (`reorder_projects`, `reorder_terminals` in `src-tauri/src/backend.rs`) validates the full ordered id set and persists correctly.
- The reorder RPC was unreachable from the frontend: `reorderProjects`/`reorderTerminals` were missing from the `createRpcBridge()` implementation in `electroview.ts`, and all three of `reorder_projects`, `reorder_terminals`, `log_renderer_event` were missing from `commands.allow` in `permissions/app-commands.toml`. Fixed separately in `dde03b9` — after that fix, drops still never landed, so a second, interaction-level defect existed.
- The pure reorder math (`moveIdAroundTarget`) was verified correct over 8 cases with `bun`, including no-op and unknown-id cases.
- The tree markup carries all required drag/drop data attributes, and the `dragover`/`drop` listeners delegate from the never-replaced `#project-tree` element.

## Likely Cause (at the time)
- Either the WebKit drag gesture never reaches the page handlers, or mid-drag tree re-renders destroy the dragged DOM and abort the gesture.

## Unknowns
- Whether `dragstart` fires on `<button draggable="true">` in the Tauri WebKit webview.
- Whether `dragover`/`drop` reach the page after a successful `dragstart`.
- Whether Tauri/wry native drag handling interferes on macOS.

## Reproduction Status
- Reproduced by the reporter in the packaged macOS app (multiple items, within-list drags, ghost follows cursor, green plus badge, no indicator, no error).
- Not reproducible from code inspection alone: the handler wiring, contracts, ACL, and sort comparators all check out.

## Evidence Gathered
- `main.ts` drag handlers (`dragstart`/`dragover`/`dragleave`/`drop`/`dragend`), tree markup attributes, `moveIdAroundTarget` unit behavior, and the compiled `acl-manifests.json` in `target/release/build` (all three commands `ALLOWED`).
- A headless WebKit harness (Playwright + Tauri IPC stub) was built to observe the flow: undisturbed, the full HTML5 chain works in stock WebKit.
