using TerminalWindowManager.Core.Models;

namespace TerminalWindowManager.Core.Interfaces;

public interface IWindowsTerminalService
{
    Task<IntPtr> LaunchProjectWindowAsync(TerminalProject project, CancellationToken cancellationToken = default);
    Task<IntPtr> LaunchTabAsync(TerminalProject project, ManagedTerminalTab tab, CancellationToken cancellationToken = default);
    bool TryFocusProjectWindow(TerminalProject project);
}
