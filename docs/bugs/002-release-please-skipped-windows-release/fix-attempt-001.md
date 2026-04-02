# Fix Attempt 001

## Status
Completed locally; awaiting user confirmation

## Goal
Make release-please create the initial `0.0.1` release and allow the Windows artifact upload job to run.

## Comparison With `chattypad`
- `chattypad` bootstraps release-please at `0.0.0`, not `0.0.1`.
- `chattypad` keeps `.release-please-manifest.json` at `0.0.0`.
- `chattypad` checks out the release tag in the Windows build job.

## Proposed Change
- Reset the release-please bootstrap in this repo to match the working pattern from `chattypad`.
- Set the package version state back to `0.0.0` so release-please can generate the first `0.0.1` release.
- Update the Windows job to check out the tagged release commit before building the desktop artifact.

## Risks
- Changing the bootstrap version may look like a downgrade in the repo state, but it is required so the first published release becomes `0.0.1`.
- The release build must still read the package version from `package.json`, so the tagged release commit needs to carry the bumped version.

## Verification Plan
- Run the local `.NET` and ElectroBun build targets after the version reset.
- Re-check the workflow against the `chattypad` pattern.

## Implementation Summary
- Reset the release-please bootstrap to `0.0.0`, matching `chattypad`.
- Reset `src/TerminalWindowManager.ElectroBun/package.json` and `package-lock.json` to `0.0.0` so release-please can generate the first `0.0.1` release tag.
- Updated the Windows release job to check out the release tag before building, matching the working `chattypad` workflow.

## Verification Results
- `./build.ps1 -Target DotNet` passed.
- `./build.ps1 -Target Desktop` passed and produced the stable Windows installer artifacts.

## Outcome
- Local verification passed.
- The workflow still needs a GitHub Actions run to confirm that `release_created` becomes true and the Windows upload job executes.
