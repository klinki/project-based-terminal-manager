# Bug Description

## Title
Installed Tauri app cannot find the ConPTY host executable

## Status
- in_progress

## Reported Symptoms
- After installing the Tauri `setup.exe`, the app reports that `TerminalWindowManager.ConPTYHost.exe` was not found.
- The error lists many fallback paths under `%LocalAppData%`, including packaged `resources/TerminalWindowManager.ConPTYHost/...`.

## Expected Behavior
- The installed Tauri app should launch terminals using the bundled ConPTY host helper without requiring a source checkout.

## Actual Behavior
- The packaged application starts, but terminal startup fails immediately because the ConPTY host executable is missing from the installed app payload.

## Reproduction Details
- Build the Tauri installer.
- Install the generated NSIS package.
- Launch the installed application and create or start a terminal.

## Affected Area
- `src/TerminalWindowManager.Tauri/src-tauri/`
- Tauri desktop packaging and bundle resources

## Constraints
- The installed app must work without relying on source-tree fallback paths.
- The fix should cover normal `tauri build` packaging, not only ad-hoc local scripts.

## Open Questions
- Whether packaging should stage only the `.exe` or the full `.NET` publish output needed by the helper.
