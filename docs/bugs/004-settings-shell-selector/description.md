# Bug Description

## Title
Settings default shell selector does not behave like an editable combobox and does not persist custom shell history

## Status
- open

## Reported Symptoms
- Clicking the selector arrow does not open a usable combobox-style menu.
- The settings UI only uses a plain datalist and does not provide reliable shell selection UX.
- Custom shell values are editable manually, but they are not managed as persistent saved options.

## Expected Behavior
- The settings dialog should always show `pwsh.exe` and `cmd.exe` as built-in options.
- The field should remain manually editable for any custom shell path or executable.
- Saving a custom shell should remember it and show it in the dropdown on future opens.
- Multiple saved custom shell values should be supported.
- Saved custom shell values should have an explicit delete action.

## Actual Behavior
- The field used a plain `input + datalist`, which did not provide a consistent dropdown experience.
- Built-in options did not match the desired defaults.
- Custom shell history was not persisted or removable.

## Reproduction Details
- Open Settings.
- Click the shell dropdown arrow.
- Try to choose or manage saved shell options.

## Affected Area
- `src/TerminalWindowManager.Tauri/src/mainview/*`
- `src/TerminalWindowManager.Tauri/src-tauri/src/*`
- `src/TerminalWindowManager.ElectroBun/src/mainview/*`
- `src/TerminalWindowManager.ElectroBun/src/bun/*`

## Constraints
- Keep manual free-text shell editing.
- Preserve backward compatibility with existing saved settings.
- Support both Tauri and ElectroBun shells.

## Open Questions
- None required for the current repair.
