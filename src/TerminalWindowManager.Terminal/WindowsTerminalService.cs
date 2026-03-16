using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using TerminalWindowManager.Core.Interfaces;
using TerminalWindowManager.Core.Models;

namespace TerminalWindowManager.Terminal;

public sealed class WindowsTerminalService : IWindowsTerminalService
{
    private static readonly HashSet<string> KnownTerminalProcessNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "WindowsTerminal",
        "WindowsTerminalDev",
        "wt"
    };

    public async Task<IntPtr> LaunchProjectWindowAsync(TerminalProject project, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(project);

        var startupTab = project.Tabs.OrderBy(tab => tab.TabIndex).FirstOrDefault();
        var title = startupTab is null ? project.Name : startupTab.Name;

        var before = SnapshotTerminalWindows();
        await RunTerminalCommandAsync(BuildLaunchStartInfo(project.WindowTarget, title, startupTab), cancellationToken);

        var hwnd = await ResolveProjectWindowAsync(before, project, cancellationToken);
        if (hwnd != IntPtr.Zero)
        {
            project.LastKnownWindowHwnd = hwnd;
        }

        if (startupTab is not null)
        {
            startupTab.State = TerminalTabState.Launched;
        }

        return hwnd;
    }

    public async Task<IntPtr> LaunchTabAsync(TerminalProject project, ManagedTerminalTab tab, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(project);
        ArgumentNullException.ThrowIfNull(tab);

        var before = SnapshotTerminalWindows();
        await RunTerminalCommandAsync(BuildLaunchStartInfo(project.WindowTarget, tab.Name, tab), cancellationToken);

        var hwnd = await ResolveProjectWindowAsync(before, project, cancellationToken);
        if (hwnd != IntPtr.Zero)
        {
            project.LastKnownWindowHwnd = hwnd;
        }

        tab.State = TerminalTabState.Launched;
        return hwnd;
    }

    public bool TryFocusProjectWindow(TerminalProject project)
    {
        ArgumentNullException.ThrowIfNull(project);

        if (project.LastKnownWindowHwnd != IntPtr.Zero && IsWindow(project.LastKnownWindowHwnd))
        {
            return BringToFront(project.LastKnownWindowHwnd);
        }

        var recovered = TryFindWindowByProjectHint(project);
        if (recovered == IntPtr.Zero)
        {
            return false;
        }

        project.LastKnownWindowHwnd = recovered;
        return BringToFront(recovered);
    }

    private static ProcessStartInfo BuildLaunchStartInfo(string windowTarget, string title, ManagedTerminalTab? tab)
    {
        var startInfo = new ProcessStartInfo(ResolveTerminalExecutable())
        {
            UseShellExecute = false
        };

        startInfo.ArgumentList.Add("-w");
        startInfo.ArgumentList.Add(windowTarget);
        startInfo.ArgumentList.Add("new-tab");
        startInfo.ArgumentList.Add("--title");
        startInfo.ArgumentList.Add(title);

        if (tab is not null)
        {
            if (!string.IsNullOrWhiteSpace(tab.WorkingDirectory))
            {
                startInfo.ArgumentList.Add("-d");
                startInfo.ArgumentList.Add(tab.WorkingDirectory);
            }

            if (!string.IsNullOrWhiteSpace(tab.ProfileName))
            {
                startInfo.ArgumentList.Add("-p");
                startInfo.ArgumentList.Add(tab.ProfileName);
            }
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

    private static async Task<IntPtr> ResolveProjectWindowAsync(HashSet<IntPtr> before, TerminalProject project, CancellationToken cancellationToken)
    {
        await Task.Delay(350, cancellationToken);

        var after = SnapshotTerminalWindows();
        var newlyCreatedWindow = after.Except(before).FirstOrDefault();
        if (newlyCreatedWindow != IntPtr.Zero)
        {
            return newlyCreatedWindow;
        }

        if (project.LastKnownWindowHwnd != IntPtr.Zero && IsWindow(project.LastKnownWindowHwnd))
        {
            return project.LastKnownWindowHwnd;
        }

        return TryFindWindowByProjectHint(project);
    }

    private static HashSet<IntPtr> SnapshotTerminalWindows()
    {
        var handles = new HashSet<IntPtr>();

        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd) || GetParent(hwnd) != IntPtr.Zero)
            {
                return true;
            }

            GetWindowThreadProcessId(hwnd, out var processId);
            if (!IsKnownTerminalProcess(processId))
            {
                return true;
            }

            handles.Add(hwnd);
            return true;
        }, IntPtr.Zero);

        return handles;
    }

    private static IntPtr TryFindWindowByProjectHint(TerminalProject project)
    {
        IntPtr match = IntPtr.Zero;

        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd) || GetParent(hwnd) != IntPtr.Zero)
            {
                return true;
            }

            GetWindowThreadProcessId(hwnd, out var processId);
            if (!IsKnownTerminalProcess(processId))
            {
                return true;
            }

            var title = GetWindowTitle(hwnd);
            if (title.Contains(project.Name, StringComparison.OrdinalIgnoreCase))
            {
                match = hwnd;
                return false;
            }

            return true;
        }, IntPtr.Zero);

        return match;
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

    private static bool BringToFront(IntPtr hwnd)
    {
        if (IsIconic(hwnd))
        {
            ShowWindow(hwnd, SwRestore);
        }
        else
        {
            ShowWindow(hwnd, SwShow);
        }

        return SetForegroundWindow(hwnd);
    }

    private const int SwShow = 5;
    private const int SwRestore = 9;

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
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);
}
