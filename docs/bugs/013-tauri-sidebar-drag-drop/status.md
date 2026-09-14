# Bug Status

## Current State
- fixed

## Active Attempt
- `fix-attempt-002.md`

## Last Updated
- 2026-09-14

## Confirmation Date
- 2026-09-14

## Resolution Summary
- The RPC/ACL repair (`dde03b9`) restored the unreachable reorder commands but drops still never landed.
- Attempt 001 (`7b5db90`) hardened the HTML5 implementation (row-level sources, render deferral, drop fallbacks); harness-verified but no change in the packaged app.
- Diagnostics logging in the packaged app proved `dragstart` fires while zero further drag events reach the page.
- Attempt 002 (`6c9466f`) replaced HTML5 DnD with pointer-based dragging; harness-verified 8/8 and reporter-confirmed.

## Attempt History
- `fix-attempt-001.md` - superseded
- `fix-attempt-002.md` - fixed

## State Change Log
- 2026-09-14: bug reported (sidebar drag-and-drop silently never lands on macOS)
- 2026-09-14: investigation found the unreachable reorder RPC layer; fixed via `dde03b9`
- 2026-09-14: pure reorder math verified; handler wiring, contracts, ACL, and sort comparators audited clean
- 2026-09-14: headless WebKit harness built; undisturbed HTML5 flow works in stock WebKit
- 2026-09-14: attempt 001 implemented, harness-verified, shipped; reporter saw no change
- 2026-09-14: diagnostics build proved zero post-`dragstart` delivery in the real app; wry/Tauri native interception ruled out by source audit
- 2026-09-14: rapid mid-drag DOM replacement proven to kill HTML5 drops in the harness (second independent defect)
- 2026-09-14: attempt 002 implemented, harness-verified 8/8, shipped; reporter confirmed the fix

## Notes
- The temporary `dnd-diag` instrumentation was fully reverted; no diagnostics code remains in the tree.
- Related but separate: cross-project console moves are not implemented (frontend rejects them, backend reorder is per-project).
