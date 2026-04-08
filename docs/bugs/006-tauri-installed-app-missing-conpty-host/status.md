# Bug Status

## Current State
- awaiting_user_confirmation

## Active Attempt
- `fix-attempt-001.md`

## Last Updated
- 2026-04-08

## Confirmation Date
- pending

## Resolution Summary
- The Tauri build now publishes the ConPTY host into bundled resources before packaging, and local desktop package rebuilds include the helper payload in `target/release/resources/TerminalWindowManager.ConPTYHost/`.

## Attempt History
- `fix-attempt-001.md` - created

## State Change Log
- 2026-04-08: bug opened
- 2026-04-08: investigation confirmed the bundled `resources` folder does not contain the ConPTY host executable
- 2026-04-08: fix attempt 001 started
- 2026-04-08: build script updated to stage the ConPTY host publish output into Tauri bundled resources
- 2026-04-08: local cargo and desktop package verification completed; awaiting user confirmation

## Notes
- The installed-app error already points at the packaged `resources/TerminalWindowManager.ConPTYHost` location, which makes the packaging gap directly observable.
- The local verification path also covered sandbox-friendly `dotnet publish` environment isolation in `build.rs`.
