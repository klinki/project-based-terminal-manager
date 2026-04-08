# Initial Findings

## Confirmed Facts
- Both Tauri and ElectroBun settings dialogs used a plain `input + datalist` shell field.
- Neither implementation persisted a dedicated custom shell history list.
- Both implementations already persisted `defaultShell`, so extending defaults was the cleanest persistence path.
- The dropdown behavior needed a custom UI component rather than a browser-native datalist.

## Likely Cause
- The original settings field relied on browser-native datalist behavior, which does not provide a reliable combobox-style popup with custom delete controls.
- The persisted defaults model had no place to store multiple saved custom shell values.

## Unknowns
- None that block the fix.

## Reproduction Status
- Reproduced by code inspection of both settings dialogs and persistence models.

## Evidence Gathered
- `src/TerminalWindowManager.Tauri/src/mainview/main.ts`
- `src/TerminalWindowManager.ElectroBun/src/mainview/main.ts`
- `src/TerminalWindowManager.Tauri/src-tauri/src/models.rs`
- `src/TerminalWindowManager.ElectroBun/src/bun/AppStateStore.ts`
