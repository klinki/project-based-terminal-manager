# Implementation Plan: Project Window Manager

**Branch**: `001-project-window-manager` | **Date**: 2026-03-14 | **Spec**: specs/001-project-window-manager/spec.md
**Input**: Feature specification from `/specs/001-project-window-manager/spec.md`

## Summary

We will build a Windows desktop application that organizes other applications into "Projects". The manager will host external application windows within its own UI, removing them from the system Taskbar and Alt-Tab list to create a focused work environment.

## Technical Context

**Language/Version**: C# / .NET 10  
**Primary Dependencies**: Win32 API (User32.dll), PInvoke.User32  
**Storage**: JSON files (local app data)  
**Testing**: xUnit  
**Target Platform**: Windows 10/11
**Project Type**: Windows Desktop Application (WPF)  
**Performance Goals**: <500ms for application switching; seamless resizing  
**Constraints**: Managed applications MUST be hidden from Taskbar and Alt-Tab  
**Scale/Scope**: Support for multiple projects and dozens of managed applications  

## Constitution Check

*GATE: Passed. Re-checked after Phase 1 design.*

- **Simplicity & Readability**: ✅ The design uses a clean service-based approach (`IWindowManagerService`) to isolate Win32 complexity.
- **Pure Functions & Immutability**: ✅ The `Project` and `ManagedApplication` models are designed as data-only entities, compatible with immutable update patterns in the `ProjectService`.
- **Single Responsibility**: ✅ Concern separation is maintained: Core (Models/Interfaces), App (WPF/UI), and Win32 (Native Interop).

## Project Structure

### Documentation (this feature)

```text
specs/001-project-window-manager/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
src/
├── ProjectWindowManager.App/ (WPF Shell)
│   ├── ViewModels/
│   ├── Views/
│   └── Services/
├── ProjectWindowManager.Core/ (Logic/Models)
│   ├── Models/
│   └── Interfaces/
├── ProjectWindowManager.Win32/ (Native Interop)
└── tests/
    ├── UnitTests/
    └── IntegrationTests/
```

**Structure Decision**: A multi-project solution separating the UI (WPF), Core logic, and Native Win32 interop to ensure Single Responsibility and testability.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Win32 Interop | Necessary for window hosting | No managed .NET API exists for hosting external processes' windows. |
