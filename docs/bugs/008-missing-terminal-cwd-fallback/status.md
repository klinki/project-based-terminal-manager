# Bug Status

## Current State
- awaiting user confirmation

## Active Attempt
- `fix-attempt-001.md`

## Last Updated
- 2026-04-10

## Confirmation Date
- 

## Resolution Summary
- Tauri now retries deleted persisted CWD launches with the effective project/global default when it differs, then retries once more without `--cwd`, and stores the effective started CWD.

## Attempt History
- `fix-attempt-001.md` - created

## State Change Log
- 2026-04-10: bug opened
- 2026-04-10: investigation confirmed stale deleted terminal CWDs fail after helper startup and need backend fallback retries
- 2026-04-10: fix attempt 001 started
- 2026-04-10: local verification completed; awaiting user confirmation

## Notes
- `cargo test --manifest-path src/TerminalWindowManager.Tauri/src-tauri/Cargo.toml --lib` passed.
- `dotnet build src/TerminalWindowManager.ConPTYHost/TerminalWindowManager.ConPTYHost.csproj` passed.
