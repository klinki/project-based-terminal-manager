# Tasks: Project Window Manager

**Input**: Design documents from `/specs/001-project-window-manager/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Tests are optional and included for core logic verification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Create project solution and directory structure per implementation plan
- [x] T002 Initialize WPF App, Core Library, and Win32 Library projects (.NET 10)
- [x] T003 Configure PInvoke.User32 and other Win32 dependencies in `src/ProjectWindowManager.Win32/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Define `Project` and `ManagedApplication` models in `src/ProjectWindowManager.Core/Models/`
- [x] T005 [P] Define `IWindowManagerService` interface in `src/ProjectWindowManager.Core/Interfaces/`
- [x] T006 Implement `WindowManagerService` with Win32 interop (`SetParent`, `SetWindowLong`) in `src/ProjectWindowManager.Win32/`
- [x] T007 [P] Implement `ProjectService` for JSON persistence in `src/ProjectWindowManager.Core/Services/`

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Create Project and Launch Managed Application (Priority: P1) 🎯 MVP

**Goal**: Create a project and launch an application (e.g., Notepad) inside the manager, hiding it from OS UI.

**Independent Test**: Create a project "Alpha", launch `notepad.exe`, and verify it appears in the right pane and disappears from the Windows Taskbar.

### Implementation for User Story 1

- [x] T008 [P] [US1] Create `MainViewModel` with Project collection in `src/ProjectWindowManager.App/ViewModels/`
- [x] T009 [P] [US1] Implement sidebar UI for Project creation and listing in `src/ProjectWindowManager.App/Views/MainWindow.xaml`
- [x] T010 [US1] Implement `WindowHost` WPF control to wrap HWND hosting in `src/ProjectWindowManager.App/Controls/`
- [x] T011 [US1] Implement "Start Application" command using `IWindowManagerService.LaunchAndHost`
- [x] T012 [US1] Integrate `WindowManagerService` style modifications to hide apps from Taskbar/Alt-Tab

**Checkpoint**: User Story 1 is functional as an MVP.

---

## Phase 4: User Story 2 - Switching Between Applications (Priority: P2)

**Goal**: Switch between different running applications in the same project by clicking them in the sidebar.

**Independent Test**: Launch two apps in one project; clicking each in the sidebar should bring the corresponding window to the front in the main pane.

### Implementation for User Story 2

- [x] T013 [P] [US2] Update `MainViewModel` to track multiple active applications per project
- [x] T014 [US2] Implement sidebar application list for the currently selected project in `src/ProjectWindowManager.App/Views/MainWindow.xaml`
- [x] T015 [US2] Implement switching logic (hide current, show selected) using `WindowManagerService.UpdateLayout`

**Checkpoint**: Multi-application switching is functional.

---

## Phase 5: User Story 3 - Persistence and Inactive State (Priority: P3)

**Goal**: Closed applications remain in project list as "inactive" and can be relaunched.

**Independent Test**: Close a managed app, verify its sidebar entry turns "Inactive", and relaunch it by clicking.

### Implementation for User Story 3

- [x] T016 [P] [US3] Update `ProjectService` to save/load application state and executable paths
- [x] T017 [US3] Implement application exit detection to update state to `Inactive` in `src/ProjectWindowManager.Core/Services/`
- [x] T018 [US3] Add relaunch logic to `MainViewModel` to restart inactive applications

**Checkpoint**: Project state and application persistence are functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T019 Implement window resizing logic to update hosted app bounds via `WindowManagerService.UpdateLayout`
- [x] T020 [P] Implement basic error handling for invalid executable paths or failed window capture
- [x] T021 Final UI polish (active/inactive visual cues, sidebar styling)
- [x] T022 [P] Verify all success criteria from `spec.md`

---

## Dependencies & Execution Order

### Phase Dependencies

1. **Setup (Phase 1)**: No dependencies.
2. **Foundational (Phase 2)**: Depends on Setup.
3. **User Stories (Phases 3-5)**: All depend on Foundational (Phase 2).
   - US1 (P1) is the MVP and should be completed first.
   - US2 (P2) depends on US1 infrastructure but adds multi-app support.
   - US3 (P3) depends on US1/US2 for full state persistence.
4. **Polish (Phase 6)**: Depends on all stories.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Setup + Foundational.
2. Complete User Story 1.
3. **VALIDATE**: Verify single app hosting and Taskbar hiding.

### Incremental Delivery

1. Add US2: Multi-app switching.
2. Add US3: Persistence and relaunching.
3. Final Polish.
