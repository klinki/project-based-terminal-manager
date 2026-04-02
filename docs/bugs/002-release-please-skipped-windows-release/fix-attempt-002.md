# Fix Attempt 002

## Status
In progress

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
