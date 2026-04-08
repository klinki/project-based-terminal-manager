# Fix Attempt 002

## Attempt Status
- fixed

## Goal
- Correct dialog heading colors so confirmation and settings dialogs render readable titles in the dark theme.

## Relation To Previous Attempts
- Follow-up to `fix-attempt-001.md` after user retesting found a visual regression in dialog headings.

## Proposed Change
- Set the dialog panel text color explicitly in shared dialog styles.
- Set the dialog heading color explicitly so it does not depend on browser or webview defaults.

## Risks
- Low risk. The change is scoped to shared dialog typography colors.

## Files And Components
- `src/TerminalWindowManager.Tauri/src/mainview/style.css`
- `src/TerminalWindowManager.ElectroBun/src/mainview/style.css`

## Verification Plan
- Compile both frontends.
- Confirm the shared dialog title style now uses the theme foreground color.

## Implementation Summary
- Added `color: var(--text)` to the shared `.confirm-dialog-panel` style in both frontends.
- Added `color: var(--text)` to `.confirm-dialog-title` in both frontends to prevent dark default heading text.

## Test Results
- `bun x tsc --noEmit -p src/TerminalWindowManager.Tauri/tsconfig.json` passed.
- `bun x tsc --noEmit -p src/TerminalWindowManager.ElectroBun/tsconfig.json` passed.

## Outcome
- Local patch applied.
- User confirmed the dialog heading fix in the app.

## Next Step
- None.

## Remaining Gaps
- No automated visual regression test covers dialog text colors.
