# Tauri Crash Reporting

## Summary
- Save path: [implementation-plan.md](implementation-plan.md)
- Artifact type: `implementation-plan.md`
- Add opt-in Sentry reporting for the Tauri desktop shell.
- Preserve the existing local diagnostics files as the primary offline record.
- Avoid sending terminal output, shell command text, or per-session diagnostics to the remote crash-reporting service.

## Selected Approach
- Use Sentry's Rust SDK from the Tauri backend as the single remote transport.
- Capture native Rust panics through Sentry's panic integration.
- Forward renderer errors through the existing `log_renderer_event` command, so renderer exceptions can be reported without a separate browser SDK or WebView network permissions.
- Keep reporting disabled unless a DSN is configured.

Sentry is the best default fit because it has maintained Rust support, desktop-friendly panic capture, issue grouping, release tracking, and Sentry-compatible self-hosting paths. Alternatives such as self-hosted Sentry, GlitchTip, or Bugsink can be evaluated later because they expose compatible DSN-style ingestion, so the app wiring should not need to change.

## Configuration
- Create a Sentry account or use a Sentry-compatible service.
- Create a project for the desktop app. Choose Rust as the platform because this implementation sends events through the Rust SDK.
- Copy the project DSN from Sentry project settings.
- For development runs, set `TWM_SENTRY_DSN` before starting Tauri:

```powershell
$env:TWM_SENTRY_DSN = "<your Sentry DSN>"
$env:TWM_SENTRY_ENVIRONMENT = "development"
Set-Location .\src\TerminalWindowManager.Tauri
bun run dev
```

- For packaged builds, set `TWM_SENTRY_DSN` in the build environment before running the Tauri build command.
- To disable reporting even when a DSN is present, set `TWM_DISABLE_CRASH_REPORTING=1`.
- `SENTRY_DSN` and `SENTRY_ENVIRONMENT` are accepted as fallback environment variable names.

## Privacy And Data Boundaries
- Do not enable `send_default_pii`.
- Do not send terminal output buffers, PowerShell command text, working directories, or per-session diagnostics streams to Sentry.
- Send only native panic events, fatal Tauri runtime exits, and renderer errors that already pass through `reportRendererIssue`.
- Renderer events may include an error message, source label, terminal ID, detail string, and renderer stack string.
- Keep local diagnostics under the Tauri app-data directory for deeper troubleshooting.

## Implementation Changes
- Add the Rust `sentry` dependency to the Tauri backend.
- Add a `crash_reporting` Rust module that:
  - Reads `TWM_SENTRY_DSN` / `SENTRY_DSN`.
  - Applies release and environment metadata.
  - Initializes Sentry after local app logging has installed its panic hook.
  - Maps only `error` and `fatal` events to remote reporting.
  - Adds non-sensitive tags and extras for native and renderer error sources.
- Update Tauri startup to keep the Sentry guard alive for the full app run.
- Update `log_renderer_event` to report renderer errors through Sentry while continuing to write the local app log.
- Update the Tauri runtime error path to report fatal startup/runtime exits.

## Verification Plan
- Run `cargo check` in [src-tauri](../../../src/TerminalWindowManager.Tauri/src-tauri).
- Run `cargo test` in [src-tauri](../../../src/TerminalWindowManager.Tauri/src-tauri).
- Run `bun run build:view` in [TerminalWindowManager.Tauri](../../../src/TerminalWindowManager.Tauri).
- With a real DSN configured, manually trigger a renderer error and confirm it appears in Sentry.
- With a real DSN configured, manually trigger a native Rust panic in a throwaway local build and confirm both the local crash file and Sentry event are created.

## Follow-Up Work
- Add a UI setting for crash-reporting consent and opt-out if this app is distributed beyond personal/internal use.
- Evaluate Sentry minidump support or `tauri-plugin-sentry` if hard native crashes outside Rust panic handling become a priority.
- Add release artifact upload and source map/debug symbol upload once CI publishing is formalized.
