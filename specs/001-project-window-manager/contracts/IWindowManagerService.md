# Contract: IWindowManagerService

**Interface Definition**: `IWindowManagerService`

## Purpose
This service is responsible for low-level Win32 operations to host, style, and manage external application windows.

## Methods

### `HostWindow(IntPtr childHwnd, IntPtr parentHwnd)`
- **Arguments**:
    - `childHwnd`: Handle of the window to be hosted.
    - `parentHwnd`: Handle of the WPF container to host the child.
- **Action**: Sets the child window as a sub-window of the parent and applies styles to hide it from the Taskbar/Alt-Tab.

### `UnhostWindow(IntPtr childHwnd)`
- **Arguments**:
    - `childHwnd`: Handle of the window to unhost.
- **Action**: Resets the parent of the child window and restores its original styles.

### `UpdateLayout(IntPtr childHwnd, Rect bounds)`
- **Arguments**:
    - `childHwnd`: Handle of the child window.
    - `bounds`: The new position and size.
- **Action**: Resizes and moves the child window to fit the specified bounds.

### `LaunchAndHost(string exePath, IntPtr parentHwnd)`
- **Arguments**:
    - `exePath`: Path to the executable.
    - `parentHwnd`: Handle of the container.
- **Action**: Starts a new process, waits for its main window to appear, and then hosts it.
