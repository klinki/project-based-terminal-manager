# Bug Report: Tauri shell interactions are blocked (003-tauri-shell-interactions)

## Status
Open

## Normalized Title
Tauri shell interactions are blocked

## Reported Symptoms
- The custom Tauri window cannot be dragged.
- Maximize and minimize buttons do not work.
- Create project and create console actions do not work.
- Settings does not work.
- It looks like clicking does nothing in the shell.

## Expected Behavior
- The custom chrome should drag the window.
- Window controls should minimize and maximize the app.
- Sidebar actions should create projects and consoles.
- Settings should open a working configuration UI.
- Normal clicks should trigger the expected UI actions.

## Actual Behavior
- The shell renders, but several interactive controls appear dead.
- Project and terminal creation do not complete.
- Titlebar dragging and window controls do not respond.
- The Settings button is present but not wired to any action.

## Reproduction
1. Start the Tauri desktop shell.
2. Try dragging the custom titlebar area.
3. Click maximize or minimize.
4. Click New project or New console.
5. Click Settings.

## Affected Area
- `src/TerminalWindowManager.ElectroBun/src/mainview/main.ts`
- `src/TerminalWindowManager.ElectroBun/src/mainview/electroview.ts`
- `src/TerminalWindowManager.ElectroBun/src-tauri/capabilities/default.json`
- `src/TerminalWindowManager.ElectroBun/src-tauri/src/lib.rs`
- `src/TerminalWindowManager.ElectroBun/src-tauri/src/backend.rs`

## Constraints
- Keep the TypeScript UI structure mostly intact.
- Keep the existing ConPTY helper backend.
- Stay Windows-only for now.

## Open Questions
- Are the app commands being blocked by Tauri capability permissions?
- Does the window need additional Tauri window permissions for dragging?
- Should Settings become a real preferences dialog or a placeholder action?
