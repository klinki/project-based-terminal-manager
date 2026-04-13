# Initial Findings

## Confirmed Facts
- The ConPTY helper rejects a non-existent `--cwd` in `CommandLineOptions.Parse`.
- The Tauri backend currently launches the helper with the terminal's stored `cwd` in a single attempt.
- The missing-directory case reaches the backend as a helper `error` event after process start, not as a synchronous `Command::spawn` failure.
- PowerShell sessions emit `cwdChanged` diagnostics after startup, but non-PowerShell shells may not report a replacement CWD automatically.

## Likely Cause
- Startup recovery for stale persisted CWDs is missing from the Tauri backend, so helper validation errors become terminal errors instead of triggering a fallback launch.

## Unknowns
- None that block a targeted backend fix.

## Reproduction Status
- Reproduced by code inspection of the helper argument validation and the Tauri helper startup/error flow.

## Evidence Gathered
- `CommandLineOptions.Parse` throws `DirectoryNotFoundException` when `--cwd` does not exist.
- `SessionManager::spawn_session` always passes `--cwd` using `context.terminal.cwd`.
- `SessionManager::handle_helper_error` currently records the helper error and stops without retrying.
