# Quickstart: Project Window Manager

## Development Prerequisites

- **IDE**: Visual Studio 2022 (with ".NET desktop development" workload)
- **Runtime**: .NET 10 SDK
- **Platform**: Windows 10/11

## Setup Instructions

1.  **Clone the Repository**:
    ```bash
    git clone [repository-url]
    ```

2.  **Open the Solution**:
    Open `ProjectWindowManager.sln` in Visual Studio.

3.  **Restore Dependencies**:
    The IDE should automatically restore NuGet packages. If not, run:
    ```bash
    dotnet restore
    ```

4.  **Run the Application**:
    Set `ProjectWindowManager.App` as the startup project and press `F5`.

## Usage Guide

1.  **Create a Project**: Click the "+" button in the left sidebar to add a new project.
2.  **Launch an Application**: Select the project, then click "Launch App" and select an executable (e.g., `C:\Windows\System32\notepad.exe`).
3.  **Verify Management**: Note that Notepad is now embedded in the Project Manager window and no longer appears on the Windows Taskbar or in the Alt-Tab list.
4.  **Switching**: Launch another app in the same project and click between them in the sidebar to switch views.
