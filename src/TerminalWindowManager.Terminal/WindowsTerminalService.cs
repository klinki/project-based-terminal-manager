using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using TerminalWindowManager.Core.Interfaces;
using TerminalWindowManager.Core.Models;

namespace TerminalWindowManager.Terminal;

public sealed class WindowsTerminalService : IWindowsTerminalService
{
    private const int GwlStyle = -16;
    private const int GwlExStyle = -20;
    private const int DwmwaCloaked = 14;
    private const int WsExToolWindow = 0x00000080;

    private const uint WsPopup = 0x80000000;
    private const uint WsChild = 0x40000000;
    private const uint WsCaption = 0x00C00000;
    private const uint WsThickFrame = 0x00040000;
    private const uint WsSysMenu = 0x00080000;
    private const uint WsMinimizeBox = 0x00020000;
    private const uint WsMaximizeBox = 0x00010000;

    private const uint SwpNoZOrder = 0x0004;
    private const uint SwpShowWindow = 0x0040;
    private const uint SwpFrameChanged = 0x0020;

    private static readonly HashSet<string> KnownTerminalProcessNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "WindowsTerminal",
        "WindowsTerminalDev",
        "wt"
    };

    public async Task<IntPtr> EnsureTerminalWindowAsync(TerminalProject project, ManagedTerminalTab terminal, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(project);
        ArgumentNullException.ThrowIfNull(terminal);

        if (terminal.LastKnownWindowHwnd != IntPtr.Zero && IsWindow(terminal.LastKnownWindowHwnd))
        {
            return terminal.LastKnownWindowHwnd;
        }

        var before = SnapshotTerminalWindows();
        await RunTerminalCommandAsync(BuildLaunchStartInfo(terminal), cancellationToken);

        var hwnd = await ResolveTerminalWindowAsync(before, terminal, cancellationToken);
        if (hwnd != IntPtr.Zero)
        {
            terminal.LastKnownWindowHwnd = hwnd;
            terminal.State = TerminalTabState.Hosted;
        }

        return hwnd;
    }

    public void HostWindow(IntPtr childHwnd, IntPtr parentHwnd)
    {
        if (childHwnd == IntPtr.Zero || parentHwnd == IntPtr.Zero)
        {
            return;
        }

        if (GetParent(childHwnd) == parentHwnd)
        {
            return;
        }

        ShowWindow(childHwnd, 0);
        SetParent(childHwnd, parentHwnd);

        var style = unchecked((uint)GetWindowLongPtr(childHwnd, GwlStyle).ToInt64());
        style &= ~(WsPopup | WsCaption | WsThickFrame | WsMinimizeBox | WsMaximizeBox | WsSysMenu);
        style |= WsChild;
        SetWindowLongPtr(childHwnd, GwlStyle, new IntPtr(style));

        var exStyle = unchecked((uint)GetWindowLongPtr(childHwnd, GwlExStyle).ToInt64());
        exStyle |= WsExToolWindow;
        SetWindowLongPtr(childHwnd, GwlExStyle, new IntPtr(exStyle));

        GetClientRect(parentHwnd, out var rect);
        SetWindowPos(
            childHwnd,
            IntPtr.Zero,
            0,
            0,
            rect.Right - rect.Left,
            rect.Bottom - rect.Top,
            SwpNoZOrder | SwpFrameChanged | SwpShowWindow);
    }

    public void UnhostWindow(IntPtr childHwnd)
    {
        if (childHwnd == IntPtr.Zero || !IsWindow(childHwnd))
        {
            return;
        }

        SetParent(childHwnd, IntPtr.Zero);

        var style = unchecked((uint)GetWindowLongPtr(childHwnd, GwlStyle).ToInt64());
        style &= ~WsChild;
        style |= WsPopup | WsCaption | WsThickFrame | WsSysMenu;
        SetWindowLongPtr(childHwnd, GwlStyle, new IntPtr(style));

        ShowWindow(childHwnd, 5);
        SetWindowPos(childHwnd, IntPtr.Zero, 100, 100, 1200, 800, SwpNoZOrder | SwpFrameChanged | SwpShowWindow);
    }

    public void UpdateLayout(IntPtr childHwnd, int x, int y, int width, int height)
    {
        if (childHwnd == IntPtr.Zero || !IsWindow(childHwnd))
        {
            return;
        }

        SetWindowPos(childHwnd, IntPtr.Zero, x, y, width, height, SwpNoZOrder | SwpFrameChanged | SwpShowWindow);
    }

    private static ProcessStartInfo BuildLaunchStartInfo(ManagedTerminalTab terminal)
    {
        var startInfo = new ProcessStartInfo(ResolveTerminalExecutable())
        {
            UseShellExecute = false
        };

        startInfo.ArgumentList.Add("-w");
        startInfo.ArgumentList.Add(terminal.WindowTarget);
        startInfo.ArgumentList.Add("new-tab");
        startInfo.ArgumentList.Add("--title");
        startInfo.ArgumentList.Add(terminal.Name);

        if (!string.IsNullOrWhiteSpace(terminal.WorkingDirectory))
        {
            startInfo.ArgumentList.Add("-d");
            startInfo.ArgumentList.Add(terminal.WorkingDirectory);
        }

        if (!string.IsNullOrWhiteSpace(terminal.ProfileName))
        {
            startInfo.ArgumentList.Add("-p");
            startInfo.ArgumentList.Add(terminal.ProfileName);
        }

        return startInfo;
    }

    private static string ResolveTerminalExecutable()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var windowsAppsPath = Path.Combine(localAppData, "Microsoft", "WindowsApps", "wt.exe");
        return File.Exists(windowsAppsPath) ? windowsAppsPath : "wt.exe";
    }

    private static async Task RunTerminalCommandAsync(ProcessStartInfo startInfo, CancellationToken cancellationToken)
    {
        try
        {
            using var process = Process.Start(startInfo)
                                 ?? throw new InvalidOperationException("Windows Terminal did not start.");

            await process.WaitForExitAsync(cancellationToken);
        }
        catch (Win32Exception ex)
        {
            throw new InvalidOperationException(
                "Unable to launch Windows Terminal. Ensure wt.exe is installed and available on PATH.",
                ex);
        }
    }

    private static async Task<IntPtr> ResolveTerminalWindowAsync(HashSet<IntPtr> before, ManagedTerminalTab terminal, CancellationToken cancellationToken)
    {
        await Task.Delay(350, cancellationToken);

        var after = SnapshotTerminalWindows();
        var newWindow = after.Except(before).FirstOrDefault();
        if (newWindow != IntPtr.Zero)
        {
            return newWindow;
        }

        return TryFindWindowByTerminalHint(terminal);
    }

    private static HashSet<IntPtr> SnapshotTerminalWindows()
    {
        var handles = new HashSet<IntPtr>();

        EnumWindows((hwnd, _) =>
        {
            if (!IsValidTopLevelWindow(hwnd))
            {
                return true;
            }

            handles.Add(hwnd);
            return true;
        }, IntPtr.Zero);

        return handles;
    }

    private static IntPtr TryFindWindowByTerminalHint(ManagedTerminalTab terminal)
    {
        IntPtr match = IntPtr.Zero;

        EnumWindows((hwnd, _) =>
        {
            if (!IsValidTopLevelWindow(hwnd))
            {
                return true;
            }

            var title = GetWindowTitle(hwnd);
            if (title.Contains(terminal.Name, StringComparison.OrdinalIgnoreCase))
            {
                match = hwnd;
                return false;
            }

            return true;
        }, IntPtr.Zero);

        return match;
    }

    private static bool IsValidTopLevelWindow(IntPtr hwnd)
    {
        if (!IsWindowVisible(hwnd) || GetParent(hwnd) != IntPtr.Zero)
        {
            return false;
        }

        DwmGetWindowAttribute(hwnd, DwmwaCloaked, out var cloaked, sizeof(int));
        if (cloaked != 0)
        {
            return false;
        }

        GetWindowThreadProcessId(hwnd, out var processId);
        return IsKnownTerminalProcess(processId);
    }

    private static string GetWindowTitle(IntPtr hwnd)
    {
        var builder = new StringBuilder(512);
        _ = GetWindowText(hwnd, builder, builder.Capacity);
        return builder.ToString();
    }

    private static bool IsKnownTerminalProcess(uint processId)
    {
        try
        {
            using var process = Process.GetProcessById(unchecked((int)processId));
            return KnownTerminalProcessNames.Contains(process.ProcessName);
        }
        catch (ArgumentException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    [DllImport("user32.dll")]
    private static extern bool GetClientRect(IntPtr hWnd, out Rect lpRect);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);
}
