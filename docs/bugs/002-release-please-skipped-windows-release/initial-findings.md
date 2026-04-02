# Initial Findings

## Confirmed Facts
- `chattypad` uses release-please successfully with this shape:
  - `release-please-config.json` sets `initial-version` to `0.0.0`.
  - `.release-please-manifest.json` anchors the package at `0.0.0`.
  - The release workflow checks out the release tag in the Windows job.
  - The Windows job uploads packaged artifacts from `artifacts/` matching `stable-win-x64-*`.
- This repo currently differs in bootstrap state:
  - `release-please-config.json` was set to `initial-version: 0.0.1`.
  - `src/TerminalWindowManager.ElectroBun/package.json` and `package-lock.json` were already at `0.0.1`.
  - `.release-please-manifest.json` was empty.

## Likely Cause
- release-please prefixes its outputs for non-root component paths.
- The workflow was reading `steps.release.outputs.release_created` and `steps.release.outputs.tag_name`, which are correct for root packages but not for `src/TerminalWindowManager.ElectroBun`.
- Because of that, the job-level output never received the real values and the Windows build/upload job was skipped.

## Unknowns
- Whether the current bootstrap state also needs to be cleaned up after the output prefix fix, or whether the release-please job will immediately surface the correct `0.0.1` release data on the next run.

## Reproduction Status
- Not reproduced locally through GitHub Actions.
- The skipped job behavior is consistent with `release_created` evaluating to false.
