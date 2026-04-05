# Initial Findings

## Confirmed Facts
- The frontend is wired to call Tauri commands for project, terminal, and window actions.
- The current capability file only includes `core:default`.
- Tauri's capability schema says app commands must be listed in capability permissions.
- Tauri's window schema exposes separate permissions for dragging and window actions.
- The Settings button exists in markup but has no click handler in the frontend.

## Likely Cause
- The main window capability is missing explicit permissions for:
  - the custom app commands exposed by the Rust backend
  - `core:window:allow-start-dragging`
- The Settings symptom is a separate frontend issue because the button is not wired at all.

## Unknowns
- Whether any other Tauri permissions are needed beyond the obvious window and app-command entries.
- Whether the shell has additional runtime errors that would show up only when it is launched interactively.

## Reproduction Status
- Static code review completed.
- Local interactive reproduction has not yet been captured in this note.
- Additional runtime investigation suggests the shell helper can emit startup output correctly when run in isolation, so the remaining gap is likely in the app's async event delivery path rather than the ConPTY helper itself.
- The current frontend registers Tauri event listeners via async `listen(...)` calls and does not explicitly await their readiness before the first interactive shell session starts.

## Evidence
- `src/TerminalWindowManager.ElectroBun/src-tauri/capabilities/default.json` only contains `core:default`.
- `src/TerminalWindowManager.ElectroBun/src/mainview/main.ts` registers handlers for project creation and window controls, so the dead behavior is likely not a missing event listener for those actions.
- `src/TerminalWindowManager.ElectroBun/src/mainview/main.ts` has no Settings button handler.
- `src/TerminalWindowManager.ElectroBun/src-tauri/gen/schemas/desktop-schema.json` documents that app commands and window permissions are capability-gated.
- `src/TerminalWindowManager.ConPTYHost` emits a `started` event and startup output immediately when run directly with the same `cwd` and `cmd.exe` shell used by the app.
- `C:\Users\david\AppData\Roaming\dev.projectwm.twm-tauri\terminal-metadata.json` shows the active Tauri terminal stuck in `starting` with no recorded `lastSessionFailure`, so the backend is not completing startup or persisting a launch failure.
- `src/TerminalWindowManager.ElectroBun/src-tauri/src/backend.rs` resolves the ConPTY helper only from `std::env::current_dir()`-relative paths.
- Those helper candidates resolve successfully from the repo root, but all fail when evaluated from `src/TerminalWindowManager.ElectroBun/src-tauri` or packaged bundle directories.
- The Tauri build already bundles `TerminalWindowManager.ConPTYHost.exe` under `src/TerminalWindowManager.ElectroBun/src-tauri/resources/TerminalWindowManager.ConPTYHost`, but the backend does not currently consult Tauri resource paths when resolving the executable.
