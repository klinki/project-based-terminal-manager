# Bug Description

## Title
Tauri project default working directory does not reliably apply to project consoles

## Status
- open

## Reported Symptoms
- Setting a project's default CWD in the Tauri UI does not behave as expected.
- At least in the Tauri version, project-level CWD changes appear to be ignored.

## Expected Behavior
- New consoles created in a project should use the project's current default CWD.
- Existing stopped consoles that still inherit the old project/global default should move to the new project default when the project default changes.

## Actual Behavior
- The Tauri frontend chooses and sends a concrete CWD during console creation instead of delegating the decision to the backend.
- Changing the project default only updates the project record; existing project consoles keep their previous stored CWD even when they were still effectively inheriting the old default.

## Reproduction Details
- In Tauri, create or open a project.
- Set a project default CWD from a selected console.
- Create a new console or reuse a stopped console in the project.
- Observe that the resulting console CWD may still reflect the earlier stored value instead of the latest project-level default behavior.

## Affected Area
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts`
- `src/TerminalWindowManager.Tauri/src-tauri/src/backend.rs`

## Constraints
- Do not overwrite explicit per-terminal CWD customizations.
- Do not mutate live running/starting terminals when changing the project default.
- Preserve existing global default behavior when no project default is set.

## Open Questions
- None required for the current repair.
