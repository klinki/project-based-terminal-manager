# Bug Report: Window Hoisting Issues (001-hoisting)

## Overview
The core functionality of hosting external Windows applications within the manager pane has faced several stability, detection, and rendering challenges. This document tracks the specific failure modes reported and the technical iterations taken to resolve them.

## Reported Bugs

### 1. Failure to Embed (Floating Windows)
- **Status**: Partially Resolved
- **Description**: Applications launch but appear as standard separate top-level windows instead of being contained within the manager's right-hand pane.
- **Root Cause**: Often due to the application's main window not being ready when the manager attempts to capture it, or the window being managed by a wrapper process (like `ApplicationFrameHost.exe` for UWP apps).

### 2. Detection Delays and Missing Entries
- **Status**: Resolved
- **Description**: Significant delay (tens of seconds) before an application appears in the sidebar list. Sometimes the last launched app only appears when a subsequent app is started.
- **Fix**: Refactored `MainViewModel` to add the `ManagedApplication` entry to the UI collection immediately upon selection, performing the hosting asynchronously in the background.

### 3. Window Hijacking
- **Status**: Resolved
- **Description**: Launching a new application (e.g., `charmap.exe`) would occasionally "steal" and host an already existing window of a different process (e.g., `notepad.exe`).
- **Fix**: Implemented strict process-centric matching. The system now uses `GetWindowThreadProcessId` to ensure a window belongs to the correct PID or process tree before attempting to host it.

### 4. UWP and Modern App Compatibility
- **Status**: Ongoing/Improved
- **Description**: Modern apps like `calc.exe` and the new `Notepad` use UWP frameworks that decouple the window from the initial launcher PID.
- **Fix**: Added specialized detection for the `ApplicationFrameWindow` class and used the Desktop Window Manager (DWM) API to filter out "cloaked" (invisible) windows.

### 5. Transition Glitches and "Blinking"
- **Status**: Improved
- **Description**: Windows would appear briefly on the desktop before "snapping" into the manager, or would flash repeatedly when clicked.
- **Fix**: 
    - Moved the `WindowHost` container out of UI templates to ensure HWND stability.
    - Updated the sequence to hide the target window (`SW_HIDE`) immediately upon detection and before reparenting.
    - Added state tracking in `WindowHost` to prevent redundant `SetParent` calls.

### 6. Persistence Serialization Errors
- **Status**: Resolved
- **Description**: The application crashed when saving projects due to `System.IntPtr` serialization failures.
- **Fix**: Added `[JsonIgnore]` to the `LastActiveHwnd` property since window handles are transient and should never be persisted between sessions.

### 7. Duplicate Application Entries
- **Status**: Resolved
- **Description**: Multiple entries for the same application (e.g., two "charmaps") appearing in the sidebar list.
- **Fix**: Added a check in `MainViewModel.LaunchApp` to verify if an app with the same path already exists before adding a new entry. If it exists, the system simply focuses it or relaunches it if inactive.

### 8. Double Launch and Redundant Hosting
- **Status**: **NOT FIXED**
- **Description**: Launching an application (specifically observed with `charmap.exe`) triggers the launch of two process instances. One instance is successfully captured and hosted, while the other remains as a floating window on the desktop.
- **Observed Logs**: Logs show the `HostWindow` sequence executing twice for the same HWND, and `Launching` logs appearing twice in quick succession.
- **Attempted Fixes (Unsuccessful)**:
    - Added a `SemaphoreSlim` (async lock) in `MainViewModel` to serialize launch requests.
    - Added checks in `WindowManagerService` to prevent reparenting a window that is already a child of the host.
    - Optimized property notification triggers to reduce redundant UI updates.
- **Current Theory**: There may be a race condition between the WPF command binding and the async execution, or the `OpenFileDialog` interaction is triggering multiple events in some environments.

## Current State & Remaining Challenges
- **Successes**: "Classic" Win32 apps host reliably once captured. Persistence logic is now stable without serialization errors.
- **Challenges**:
    - **Double Launch**: The system still spawns redundant processes for some classic apps.
    - **UWP Switching**: `calc.exe` and similar apps often lose their hosted state or fail to re-embed correctly when switching focus between applications.

## Technical Fix Summary Table

| Mitigation Strategy | Purpose | Component |
|---------------------|---------|-----------|
| **DWM Cloaking Check** | Filter invisible UWP frames | `WindowManagerService` |
| **Immediate UI Add** | Remove perceived lag | `MainViewModel` |
| **Client Area Sizing** | Fix window clipping/disappearance | `WindowManagerService` |
| **HostHwnd Injection** | Enable hosting at detection time | `MainWindow` / `VM` |
| **Style Scrubbing** | Force child window behavior | `WindowManagerService` |
