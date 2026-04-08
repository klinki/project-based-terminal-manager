# Bug Status

## Current State
- fixed

## Active Attempt
- `fix-attempt-002.md`

## Last Updated
- 2026-04-08

## Confirmation Date
- 2026-04-08

## Resolution Summary
- The Tauri build now publishes the ConPTY host into bundled resources before packaging, and local desktop package rebuilds include the helper payload in `target/release/resources/TerminalWindowManager.ConPTYHost/`.
- The main Tauri binary is now built as `Windows GUI` instead of `Windows CUI`, so the installed app should no longer keep an empty console window attached.

## Attempt History
- `fix-attempt-001.md` - created
- `fix-attempt-002.md` - created

## State Change Log
- 2026-04-08: bug opened
- 2026-04-08: investigation confirmed the bundled `resources` folder does not contain the ConPTY host executable
- 2026-04-08: fix attempt 001 started
- 2026-04-08: build script updated to stage the ConPTY host publish output into Tauri bundled resources
- 2026-04-08: local cargo and desktop package verification completed; awaiting user confirmation
- 2026-04-08: user reported the rebuilt installed app still opens an empty console window before the GUI appears
- 2026-04-08: fix attempt 002 started to correct the Windows subsystem on the packaged executable
- 2026-04-08: rebuilt package verified with PE subsystem `Windows GUI`; awaiting user confirmation
- 2026-04-08: user confirmed the packaged-app startup fixes

## Notes
- The installed-app error already points at the packaged `resources/TerminalWindowManager.ConPTYHost` location, which makes the packaging gap directly observable.
- The local verification path also covered sandbox-friendly `dotnet publish` environment isolation in `build.rs`.
- The existing release executable header reported subsystem `0x3` (`Windows CUI`) before attempt 002.
