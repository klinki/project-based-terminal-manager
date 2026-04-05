# Fix Attempt 007

## Status
Completed locally; awaiting user confirmation

## Goal
Make the Tauri shell resolve and launch the ConPTY helper reliably outside repo-root runs so new consoles stop hanging in `Starting` and surface a real failure if launch still breaks.

## Relation To Previous Attempts
- Attempts 001-006 focused on permissions, renderer bridge wiring, event readiness, and focus handling.
- The remaining Tauri-specific symptom is now traced to backend helper resolution rather than the frontend interaction layer.

## Proposed Change
- Resolve `TerminalWindowManager.ConPTYHost.exe` from Tauri resource paths first, with dev-path fallbacks kept for local repo runs.
- Preserve additional fallback candidates near the executable for packaged builds.
- Convert helper launch failures into persisted terminal error state instead of leaving the terminal stuck in `starting`.

## Risks
- Resource resolution differs between dev and packaged runs, so the fallback order must stay compatible with both.
- If another startup fault remains after helper resolution, the backend should still emit actionable error detail instead of masking it.

## Expected Verification
- `cargo check` in `src-tauri`
- `bun run build:view`
- `build.ps1 -Target Desktop`
- A focused path-resolution sanity check showing repo-root, `src-tauri`, and packaged-like launch locations can all resolve a helper candidate

## Files Or Components Involved
- `src/TerminalWindowManager.ElectroBun/src-tauri/src/backend.rs`
- `src/TerminalWindowManager.ElectroBun/src-tauri/src/lib.rs`
- `docs/bugs/003-tauri-shell-interactions/initial-findings.md`
- `docs/bugs/003-tauri-shell-interactions/status.md`

## Implementation Summary
- Changed the Tauri backend to resolve `TerminalWindowManager.ConPTYHost.exe` from Tauri resource locations first, with additional executable-directory and repo-layout fallbacks kept for local development.
- Kept the existing dev helper fallbacks, but expanded them to cover `src-tauri`, release-resource, and packaged bundle layouts that do not share the repo-root current directory.
- Added launch-failure persistence so a helper startup error now marks the terminal as `error`, records a `lastSessionFailure`, and emits a terminal error event instead of leaving the session stuck in `starting`.

## Verification Results
- `cargo check` in `src/TerminalWindowManager.ElectroBun/src-tauri` passed.
- `bun run build:view` in `src/TerminalWindowManager.ElectroBun` passed.
- `./build.ps1 -Target Desktop` passed after the backend patch and produced MSI and NSIS bundles.
- Verified that the helper executable exists in all intended resolution locations:
  - `src/TerminalWindowManager.ElectroBun/src-tauri/resources/TerminalWindowManager.ConPTYHost/TerminalWindowManager.ConPTYHost.exe`
  - `src/TerminalWindowManager.ElectroBun/src-tauri/target/release/resources/TerminalWindowManager.ConPTYHost/TerminalWindowManager.ConPTYHost.exe`
  - `src/TerminalWindowManager.ConPTYHost/bin/Release/net10.0-windows/TerminalWindowManager.ConPTYHost.exe`

## Outcome
The Tauri backend should now find the bundled ConPTY helper when launched from `src-tauri` or a packaged release instead of relying on a repo-root working directory. Please retest console creation and interaction in the Tauri desktop app; if startup still fails, the terminal should now surface a concrete error instead of hanging in `Starting`.
