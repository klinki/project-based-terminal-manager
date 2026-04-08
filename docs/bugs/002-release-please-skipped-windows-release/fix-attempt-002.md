# Fix Attempt 002

## Status
Implemented and validated on a non-releasable push

## Goal
Make the Windows job run by reading the release-please outputs for the nested ElectroBun package path instead of the unprefixed root outputs.

## Relation To Attempt 001
- Attempt 001 addressed bootstrap state.
- That was insufficient because release-please outputs are path-prefixed for non-root components.

## Proposed Change
- Update the workflow job outputs to read:
  - `src/TerminalWindowManager.ElectroBun--release_created`
  - `src/TerminalWindowManager.ElectroBun--tag_name`
- Keep the Windows job conditional and artifact upload logic otherwise unchanged.

## Risks
- If the output path prefix is mistyped, the release job will still skip the Windows step.
- The workflow should remain compatible with the monorepo component path already used by release-please.

## Verification Plan
- Compare the workflow expression syntax with the official release-please-action docs.
- Push the workflow change and inspect the next GitHub Actions run to confirm `release_created` becomes true.

## Implementation Summary
- Updated the release job to read the nested ElectroBun output keys emitted by release-please.
- Pushed the workflow fix to `main`.

## Verification Results
- GitHub Actions run `23899162272` completed successfully.
- The release-please job found no new commits for `src/TerminalWindowManager.ElectroBun` and skipped the release creation path on this push.
- The Windows job was therefore skipped, which is expected for a push that does not contain releasable package changes.

## Outcome
- The workflow expression bug is fixed.
- A real release validation still requires a releasable commit under `src/TerminalWindowManager.ElectroBun`.
- User confirmed the bug can be considered fixed.
