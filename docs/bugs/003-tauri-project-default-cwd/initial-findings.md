# Initial Findings

## Confirmed Facts
- The Tauri backend already supports project defaults during terminal creation when `cwd` is empty.
- The Tauri frontend currently sends `project.defaultCwd ?? state.defaults.defaultCwd` on every new console creation.
- The `set_project_default_cwd` command is registered and allowed by Tauri permissions.
- Changing the project default only updates `project.default_cwd`; it does not update existing terminal records.

## Likely Cause
- Responsibility for choosing the effective CWD is split between the frontend and backend.
- Existing terminal records retain stale inherited CWD values after the project default changes.

## Unknowns
- User intent for running consoles is not explicit, so the fix should avoid mutating active sessions.

## Reproduction Status
- Reproduced by code inspection of the Tauri create-console and project-default update paths.

## Evidence Gathered
- `createConsoleFromProject` in `src/TerminalWindowManager.Tauri/src/mainview/main.ts` sends a concrete `cwd`.
- `SessionManager::create_terminal` in `src/TerminalWindowManager.Tauri/src-tauri/src/backend.rs` already resolves empty `cwd` using project/global defaults.
- `SessionManager::set_project_default_cwd` only updates the project record and leaves matching terminal records untouched.
