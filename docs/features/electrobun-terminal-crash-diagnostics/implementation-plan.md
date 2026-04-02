# ElectroBun Terminal Crash Diagnostics

## Summary
- Save path: `docs/features/electrobun-terminal-crash-diagnostics/implementation-plan.md`
- Artifact type: `implementation-plan.md`
- Add ElectroBun-only crash diagnostics for ConPTY-backed terminals.
- Surface diagnostics in both the UI and a persisted per-session log.
- Cover all shell/session exits, and add command-level failure diagnostics for `pwsh` / `powershell.exe` first so cases like Copilot failing inside the shell are visible.

## Implementation Changes
- Create a per-session diagnostics directory under the ElectroBun user-data folder at `terminal-diagnostics/<terminalId>/<sessionId>/`.
- Persist an `events.jsonl` log per session and keep a bounded Bun-side output buffer of the last 100 ANSI-stripped lines for post-mortem excerpts.
- Extend the helper launch contract so Bun passes `sessionId`, diagnostics directory, and an optional PowerShell bootstrap script path to the ConPTY host.
- Enrich helper events so `started` includes session metadata and shell PID, `exit` includes exit timestamp and helper stderr excerpt, and `error` includes structured exception details plus Win32/HRESULT codes when available.
- Add PowerShell bootstrap instrumentation that starts `pwsh` / `powershell.exe` with `-NoLogo -NoExit -File <bootstrap>` and logs only failed commands after each prompt returns.
- Log failed PowerShell commands as JSON objects containing sessionId, terminalId, timestamp, command text from history, `$?`, `$LASTEXITCODE`, current cwd, and the top PowerShell error message when present.
- Leave non-PowerShell shells on session-level diagnostics only; do not try to infer arbitrary descendant-process crashes for `cmd.exe` in v1.
- Add a Bun-side diagnostics watcher that tails `events.jsonl`, updates terminal state immediately, and prints a concise `[diagnostic] ...` note into xterm when a new failure is recorded.
- Update the inspector so each terminal shows `Last failed command`, `Failure time`, `Exit code`, `Error message`, `Recent output excerpt`, and `Diagnostic log path`, while keeping `Last exit code` as the session-level field.

## Public Interfaces / Types
- Extend the shared terminal model with:
  - `TerminalCommandFailure`
  - `TerminalSessionFailure`
  - `diagnosticLogPath`
  - `lastCommandFailure`
  - `lastSessionFailure`
- Update the helper message schema so `started`, `exit`, and `error` carry structured diagnostics metadata instead of only plain exit code or message text.
- Keep existing activation, input, resize, restart, and stop RPCs unchanged.

## Test Plan
- Build with `.\build.ps1 -Target ElectroBun`.
- Verify session-exit diagnostics by running `exit 37` and confirming UI plus `events.jsonl` show exit code, timestamp, shell path, sessionId, and trailing output.
- Verify helper failure reporting with an invalid shell path or invalid working directory.
- Verify PowerShell command failure reporting with `cmd /c exit 5` and `Write-Error "boom"`.
- Reproduce a Copilot failure and confirm the recorded event includes command text, exit code or PowerShell error, timestamp, and recent output excerpt.
- Recheck normal output streaming, resize, restart, and manual shutdown behavior after diagnostics are enabled.

## Assumptions
- v1 collects structured telemetry only; it does not collect crash dumps or Windows Error Reporting artifacts.
- Command-level diagnostics are PowerShell-first and best-effort for commands that return control to the prompt.
- WPF / Windows Terminal hosting stays unchanged in this iteration because that path does not own in-terminal process lifecycle deeply enough for equivalent diagnostics.
