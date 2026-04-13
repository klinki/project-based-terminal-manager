# Fix Attempt 001

## Attempt Status
- awaiting user confirmation

## Goal
- Recover terminal startup when the stored CWD was deleted by retrying with the effective project/global default and then with no explicit working directory.

## Relation To Previous Attempts
- First attempt.

## Proposed Change
- Teach the Tauri backend to detect the helper's missing-working-directory startup error and relaunch the same terminal with a bounded fallback sequence.
- Persist the effective startup CWD after a fallback succeeds so later launches do not keep using the deleted path.

## Risks
- Retry detection could accidentally catch unrelated helper errors if the missing-directory match is too broad.
- Updating persisted CWD too early could misrepresent the shell's actual directory if a fallback launch still fails.

## Files And Components
- `src/TerminalWindowManager.Tauri/src-tauri/src/backend.rs`
- `src/TerminalWindowManager.ConPTYHost/Program.cs`

## Verification Plan
- Run `cargo check --manifest-path src/TerminalWindowManager.Tauri/src-tauri/Cargo.toml`.
- Review the helper event/state flow to confirm only the missing-directory startup case retries.

## Implementation Summary
- Added launch-attempt tracking in the Tauri backend so startup knows whether it used the persisted CWD, the effective default CWD, or no explicit CWD.
- Intercepted the helper's missing-working-directory startup error and retried in a bounded order: effective project/global default first when it differs from the missing path, then once more without `--cwd`.
- Extended the helper `started` payload with the effective startup CWD and used it to persist the terminal record away from the deleted path after a successful fallback.
- Added unit coverage for the retry-order decision and missing-directory message parsing.

## Test Results
- `cargo test --manifest-path src/TerminalWindowManager.Tauri/src-tauri/Cargo.toml --lib` passed.
- `dotnet build src/TerminalWindowManager.ConPTYHost/TerminalWindowManager.ConPTYHost.csproj` passed.

## Outcome
- Local fix is in place and both the Rust backend tests and the ConPTY helper build are passing.
- Awaiting user confirmation that deleted persisted CWDs now recover correctly in the app.

## Next Step
- Have the user verify terminal restart behavior when the previously stored working directory has been deleted.

## Remaining Gaps
- No automated end-to-end terminal restart regression test currently exists for this flow.
