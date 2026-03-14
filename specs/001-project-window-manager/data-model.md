# Data Model: Project Window Manager

## Entities

### Project
Represents a named collection of applications.
- **Id**: `Guid` (Unique identifier)
- **Name**: `string` (User-defined name)
- **Applications**: `List<ManagedApplication>` (Collection of applications in this project)

### ManagedApplication
Represents an instance of an external program.
- **Id**: `Guid` (Unique identifier)
- **ProjectId**: `Guid` (Owner project)
- **ExecutablePath**: `string` (Path to the .exe)
- **DisplayName**: `string` (User-friendly name, e.g., "Notepad")
- **State**: `ApplicationState` (Enum: `Active`, `Inactive`)
- **LastActiveHwnd**: `IntPtr` (Handle to the main window if currently running)

## Enums

### ApplicationState
- **Active**: The process is running and its window is hosted.
- **Inactive**: The process is closed, but its metadata remains in the project.
