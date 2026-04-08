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
- Replaced the datalist shell field with an editable custom combobox in both UIs and added persisted custom shell history to app defaults.
- Added a follow-up color fix so shared dark-theme dialog headings render with the theme foreground color.

## Attempt History
- `fix-attempt-001.md` - created
- `fix-attempt-002.md` - created

## State Change Log
- 2026-04-08: bug opened
- 2026-04-08: investigation confirmed datalist limitations and missing custom shell persistence
- 2026-04-08: fix attempt 001 started
- 2026-04-08: local verification completed; awaiting user confirmation
- 2026-04-08: user reported dialog heading colors were unreadable in the dark theme
- 2026-04-08: fix attempt 002 started
- 2026-04-08: local verification completed for the dialog heading color fix; awaiting user confirmation
- 2026-04-08: user confirmed the shell selector and dialog color fixes

## Notes
- `bun x tsc --noEmit -p src/TerminalWindowManager.Tauri/tsconfig.json` passed.
- `bun x tsc --noEmit -p src/TerminalWindowManager.ElectroBun/tsconfig.json` passed.
- `cargo check --manifest-path src/TerminalWindowManager.Tauri/src-tauri/Cargo.toml` passed.
