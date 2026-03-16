using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using TerminalWindowManager.Core.Interfaces;

namespace TerminalWindowManager.App.Controls;

public sealed class TerminalWindowHost : HwndHost
{
    private IntPtr _childHwnd;
    private IntPtr _currentlyHostedHwnd;

    public IWindowsTerminalService? TerminalService { get; set; }

    public TerminalWindowHost()
    {
        Loaded += (_, _) =>
        {
            if (_childHwnd != IntPtr.Zero)
            {
                AttachWindow(_childHwnd);
            }
        };
    }

    public void AttachWindow(IntPtr hwnd)
    {
        if (TerminalService is null)
        {
            throw new InvalidOperationException("TerminalService must be assigned before attaching a terminal window.");
        }

        if (_currentlyHostedHwnd != IntPtr.Zero && _currentlyHostedHwnd != hwnd)
        {
            TerminalService.UnhostWindow(_currentlyHostedHwnd);
        }

        _childHwnd = hwnd;
        _currentlyHostedHwnd = hwnd;

        if (_childHwnd != IntPtr.Zero && Handle != IntPtr.Zero)
        {
            TerminalService.HostWindow(_childHwnd, Handle);
            UpdateChildLayout();
        }
    }

    protected override HandleRef BuildWindowCore(HandleRef hwndParent)
    {
        var hwnd = CreateWindowExW(
            0,
            "static",
            "TerminalWindowHost",
            WindowStyles.WsChild | WindowStyles.WsVisible | WindowStyles.WsClipChildren,
            0,
            0,
            (int)Math.Max(1, ActualWidth),
            (int)Math.Max(1, ActualHeight),
            hwndParent.Handle,
            IntPtr.Zero,
            IntPtr.Zero,
            IntPtr.Zero);

        return new HandleRef(this, hwnd);
    }

    protected override void DestroyWindowCore(HandleRef hwnd)
    {
        if (_childHwnd != IntPtr.Zero && TerminalService is not null)
        {
            TerminalService.UnhostWindow(_childHwnd);
        }

        DestroyWindow(hwnd.Handle);
    }

    protected override void OnRenderSizeChanged(SizeChangedInfo sizeInfo)
    {
        base.OnRenderSizeChanged(sizeInfo);
        UpdateChildLayout();
    }

    private void UpdateChildLayout()
    {
        if (_childHwnd != IntPtr.Zero && Handle != IntPtr.Zero && TerminalService is not null)
        {
            TerminalService.UpdateLayout(_childHwnd, 0, 0, (int)ActualWidth, (int)ActualHeight);
        }
    }

    [Flags]
    private enum WindowStyles : uint
    {
        WsChild = 0x40000000,
        WsVisible = 0x10000000,
        WsClipChildren = 0x02000000
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowExW(
        int dwExStyle,
        string lpClassName,
        string lpWindowName,
        WindowStyles dwStyle,
        int x,
        int y,
        int nWidth,
        int nHeight,
        IntPtr hWndParent,
        IntPtr hMenu,
        IntPtr hInstance,
        IntPtr lpParam);

    [DllImport("user32.dll")]
    private static extern bool DestroyWindow(IntPtr hWnd);
}
