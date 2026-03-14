using System;
using System.Threading.Tasks;

namespace ProjectWindowManager.Core.Interfaces
{
    public interface IWindowManagerService
    {
        /// <summary>
        /// Hosts an existing window inside a parent container.
        /// </summary>
        void HostWindow(IntPtr childHwnd, IntPtr parentHwnd);

        /// <summary>
        /// Restores a hosted window to its original state.
        /// </summary>
        void UnhostWindow(IntPtr childHwnd);

        /// <summary>
        /// Updates the layout of the hosted child window.
        /// </summary>
        void UpdateLayout(IntPtr childHwnd, int x, int y, int width, int height);

        /// <summary>
        /// Launches an application and hosts its main window.
        /// </summary>
        Task<IntPtr> LaunchAndHost(string exePath, IntPtr parentHwnd);
    }
}
