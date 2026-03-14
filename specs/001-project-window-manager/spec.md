# Feature Specification: Project Window Manager

**Feature Branch**: `001-project-window-manager`  
**Created**: 2026-03-14  
**Status**: Draft  
**Input**: User description: "We will create a brand new Windows application that takes care of Windows management. Or at least Window management of applications started from the application. It will have project-based structure. It will have left sidebar with directories representing projects and under those project there will be list of running applications. Application window will be on the right side next to the left panel. Clicking on application on a sidebar will switch the actually shown application in the main pane. User can start new applications and create a new projects. Closing an application should not remove it from the project view but should switch it to inactive state. Applications started from our app should not show separate windows in Alt-Tab and should not show icons on taskbar. Project Window Manager"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create Project and Launch Managed Application (Priority: P1)

As a user, I want to create a new project and launch an application within it so that I can organize my workspace by task.

**Why this priority**: This is the core functionality. Without project creation and app launching, the system has no purpose.

**Independent Test**: User creates a "Development" project, selects an executable (e.g., Notepad), and launches it. The Notepad window should appear inside the right pane of the Project Window Manager.

**Acceptance Scenarios**:

1. **Given** the application is open and no projects exist, **When** I click "New Project" and enter "Alpha", **Then** a new directory named "Alpha" appears in the left sidebar.
2. **Given** a project "Alpha" is selected, **When** I choose to "Start Application" and select a valid executable, **Then** the application starts and its window is hosted in the right pane.
3. **Given** a managed application is running, **When** I check the Windows Taskbar or Alt-Tab, **Then** the managed application should NOT be visible there.

---

### User Story 2 - Switching Between Applications (Priority: P2)

As a user, I want to switch between different running applications in the same project by clicking them in the sidebar.

**Why this priority**: Enables multi-tasking within a project, which is a key value proposition of the tool.

**Independent Test**: User launches two applications in one project. Clicking the first should show it in the main pane; clicking the second should replace it with the second app's window.

**Acceptance Scenarios**:

1. **Given** two applications "App A" and "App B" are running in project "Alpha", **When** I click "App A" in the sidebar, **Then** "App A" is shown in the right pane.
2. **Given** "App A" is currently shown, **When** I click "App B" in the sidebar, **Then** "App B" replaces "App A" in the right pane.

---

### User Story 3 - Persistence and Inactive State (Priority: P3)

As a user, I want closed applications to remain in my project list as "inactive" so I can easily relaunch them later.

**Why this priority**: Supports long-term project organization and state recovery.

**Independent Test**: User closes a managed application. The entry in the sidebar should remain but change visual style (e.g., greyed out) to indicate it is inactive.

**Acceptance Scenarios**:

1. **Given** a managed application is running, **When** it is closed (either via the app itself or the manager), **Then** its entry remains in the sidebar project list.
2. **Given** an inactive application in the sidebar, **When** I click it, **Then** the system provides an option to relaunch the application.

---

### Edge Cases

- **Window Resizing**: What happens when the Project Window Manager itself is resized? (Managed apps should likely resize to fit the new pane dimensions).
- **Multiple Monitors**: How does the system handle moving the Manager between monitors?
- **Unresponsive Apps**: How does the Manager handle a managed application that hangs or crashes?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow users to create, name, and delete projects.
- **FR-002**: System MUST allow users to select and launch Windows executables to be managed within a specific project.
- **FR-003**: System MUST capture and host the main window of a managed application within the right-hand pane of the Manager UI.
- **FR-004**: System MUST modify the window style of managed applications to remove them from the Windows Taskbar and Alt-Tab list.
- **FR-005**: System MUST maintain the project-based hierarchy (Project -> Managed Apps) in a sidebar navigation component.
- **FR-006**: System MUST track whether a managed application is currently running (Active) or closed (Inactive).
- **FR-007**: System MUST allow users to switch the currently "focused" application in the right pane via sidebar selection.
- **FR-008**: System MUST allow pop-up windows or dialogs from managed applications to appear as standard floating Windows windows (not embedded in the main pane).

### Key Entities *(include if feature involves data)*

- **Project**: A logical grouping of applications, identified by a name.
- **Managed Application**: An instance of an external program, including its executable path, current state (Active/Inactive), and window handle (HWND) if active.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Managed applications are hidden from Windows Taskbar and Alt-Tab 100% of the time.
- **SC-002**: Switching between two active applications takes less than 500ms.
- **SC-003**: Project structures and application lists are persisted and restored correctly on application restart.
- **SC-004**: Users report that the "embedded" application experience feels seamless and responsive.
