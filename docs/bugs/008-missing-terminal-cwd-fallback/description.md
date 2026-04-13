# Bug Description

## Title
Tauri terminal relaunch fails permanently when the persisted working directory was deleted

## Status
- awaiting user confirmation

## Reported Symptoms
- Restarting or activating a stopped terminal can fail with an error like `Working directory 'C:\ai-workspace\project-wm\src\TerminalWindowManager.ElectroBun\src-tauri' does not exist.`
- The app keeps trying the same deleted directory on later launches instead of recovering.

## Expected Behavior
- If the persisted terminal CWD no longer exists, startup should retry with the project's effective default directory when that differs from the deleted path.
- If the effective default directory also cannot be used, startup should retry once more without specifying a working directory.
- After a successful fallback launch, the stored terminal CWD should move away from the deleted path.

## Actual Behavior
- The Tauri backend forwards the terminal's stored CWD directly to the ConPTY helper.
- The helper validates `--cwd`, emits an error for a missing directory, and the terminal remains in an error state with the same stale CWD.

## Reproduction Details
- Create or reuse a terminal whose stored CWD points to a real directory.
- Delete that directory outside the app.
- Restart or activate the terminal.
- Observe that startup fails on the missing directory and later restarts keep retrying the same deleted path.

## Affected Area
- `src/TerminalWindowManager.Tauri/src-tauri/src/backend.rs`
- `src/TerminalWindowManager.ConPTYHost/CommandLineOptions.cs`

## Constraints
- Only retry for the missing-working-directory startup case.
- Keep the ConPTY helper's validation for invalid directories.
- Do not loop indefinitely through retries.

## Open Questions
- None required for the current repair.
