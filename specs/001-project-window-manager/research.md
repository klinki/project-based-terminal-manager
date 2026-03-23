# Research: Project Window Manager

## Window Hosting and Parenting

- **Decision**: Use Win32 `SetParent` to nest external windows inside the WPF application.
- **Rationale**: `SetParent` is the most reliable way to make an external window act as a child of another window. This allows the Project Manager to control the child's position and visibility relative to its own main pane.
- **Alternatives Considered**: 
    - `HwndHost`: A WPF-native way to host Win32 windows, but it requires more complex lifecycle management for external processes.

## Hiding Managed Applications from OS UI

- **Decision**: Modify the extended window style (`GWL_EXSTYLE`) of the managed application to include `WS_EX_TOOLWINDOW` and ensure its parent is set.
- **Rationale**:
    - `WS_EX_TOOLWINDOW`: Hides the window from the Taskbar and Alt-Tab list.
    - Setting the Project Manager as the parent window also naturally suppresses the Taskbar icon for the child.
- **Alternatives Considered**: 
    - `WS_EX_NOACTIVATE`: Prevents the window from becoming the foreground window, but may interfere with user interaction.

## Window Resizing and Fitting

- **Decision**: Monitor the size of the hosting pane in WPF and use `SetWindowPos` or `MoveWindow` to update the child window's dimensions.
- **Rationale**: External windows don't automatically resize when their parent pane does. Manual orchestration is required.

## Persistence and Inactive States

- **Decision**: Use `System.Text.Json` to save project definitions (paths, names, history).
- **Rationale**: Lightweight, human-readable, and standard for .NET 10 applications.
- **Inactive State**: When an application is closed, we preserve its metadata in the JSON file. Upon relaunching, we create a new process and re-apply the hosting logic.
