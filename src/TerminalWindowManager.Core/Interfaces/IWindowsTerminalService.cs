using TerminalWindowManager.Core.Models;

namespace TerminalWindowManager.Core.Interfaces;

public interface IWindowsTerminalService
{
    Task<IntPtr> EnsureTerminalWindowAsync(TerminalProject project, ManagedTerminalTab terminal, CancellationToken cancellationToken = default);
    void HostWindow(IntPtr childHwnd, IntPtr parentHwnd);
    void UnhostWindow(IntPtr childHwnd);
    void UpdateLayout(IntPtr childHwnd, int x, int y, int width, int height);
}
