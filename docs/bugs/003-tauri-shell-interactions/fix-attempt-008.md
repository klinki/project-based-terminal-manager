# Fix Attempt 008

## Status
Completed locally; awaiting user confirmation

## Goal
Make `npm run start` resolve the ConPTY helper from the repo's Debug output instead of failing when the Tauri dev process starts from `src-tauri`.

## Relation To Previous Attempts
- Attempt 007 fixed packaged/resource-based helper lookup and added launch-failure persistence.
- The remaining gap is specific to Tauri dev mode launched from `npm run start`, where the helper is built in Debug under the repo root but the resolver does not search enough ancestor directories to find it.

## Proposed Change
- Replace the current fixed-depth `current_dir` path guesses with an ancestor walk that searches every parent directory for known resource and ConPTYHost build layouts.
- Keep resource-directory candidates first for packaged runs, while ensuring repo-root `Debug` and `Release` helper outputs are discoverable in dev mode.

## Risks
- The candidate list may grow longer, so duplicate suppression must stay in place to keep diagnostics readable.
- If another dev-only path variant exists, the error message still needs to remain actionable.

## Expected Verification
- `cargo check` in `src-tauri`
- `bun run build:host`
- A focused path-resolution sanity check proving that a `src-tauri` current directory can now resolve the repo-root Debug helper path used by `npm run start`

## Files Or Components Involved
- `src/TerminalWindowManager.ElectroBun/src-tauri/src/backend.rs`
- `docs/bugs/003-tauri-shell-interactions/initial-findings.md`
- `docs/bugs/003-tauri-shell-interactions/status.md`

## Implementation Summary
- Replaced the previous fixed-depth `current_dir` helper guesses with an ancestor walk that searches every parent directory for known Tauri resource layouts and ConPTYHost build outputs.
- Kept bundled-resource candidates first, but added systematic lookup for both `Debug` and `Release` builds and both currently present target frameworks.
- Preserved duplicate suppression so the launch error still reports a stable candidate list instead of repeating the same path shapes.

## Verification Results
- `cargo check` in `src/TerminalWindowManager.ElectroBun/src-tauri` passed.
- `bun run build:host` in `src/TerminalWindowManager.ElectroBun` passed and produced `src/TerminalWindowManager.ConPTYHost/bin/Debug/net10.0-windows/TerminalWindowManager.ConPTYHost.dll`.
- A focused path sanity check starting from `src/TerminalWindowManager.ElectroBun/src-tauri` now resolves all expected repo-root helper outputs, including `src/TerminalWindowManager.ConPTYHost/bin/Debug/net10.0-windows/TerminalWindowManager.ConPTYHost.exe`.

## Outcome
The Tauri dev shell launched via `npm run start` should now be able to find the Debug ConPTY helper built in the repo root instead of failing immediately with a missing executable error. Please retest the dev shell and console creation path.
