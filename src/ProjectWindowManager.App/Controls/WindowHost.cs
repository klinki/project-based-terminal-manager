using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using ProjectWindowManager.Core.Interfaces;
using ProjectWindowManager.Win32;
using static PInvoke.User32;

namespace ProjectWindowManager.App.Controls
{
    public class WindowHost : HwndHost
    {
        private IntPtr _childHwnd = IntPtr.Zero;
        private IntPtr _currentlyHostedHwnd = IntPtr.Zero;
        private IWindowManagerService? _windowManagerService;

        public IWindowManagerService WindowManagerService
        {
            get => _windowManagerService ??= new WindowManagerService();
            set => _windowManagerService = value;
        }

        public WindowHost()
        {
            this.Loaded += (s, e) => {
                if (_childHwnd != IntPtr.Zero) AttachWindow(_childHwnd);
            };
        }

        public void AttachWindow(IntPtr hwnd)
        {
            if (hwnd == _currentlyHostedHwnd && hwnd != IntPtr.Zero) return;

            // Unhost current if exists and changing
            if (_currentlyHostedHwnd != IntPtr.Zero && _currentlyHostedHwnd != hwnd)
            {
                WindowManagerService.UnhostWindow(_currentlyHostedHwnd);
            }

            _childHwnd = hwnd;
            _currentlyHostedHwnd = hwnd;

            if (_childHwnd != IntPtr.Zero && Handle != IntPtr.Zero)
            {
                WindowManagerService.HostWindow(_childHwnd, Handle);
                UpdateChildLayout();
            }
        }

        protected override HandleRef BuildWindowCore(HandleRef hwndParent)
        {
            // Use a specific class name and ensure WS_CLIPCHILDREN is set
            var hwnd = CreateWindowEx(
                0, "static", "WindowHostContainer",
                WindowStyles.WS_CHILD | WindowStyles.WS_VISIBLE | WindowStyles.WS_CLIPCHILDREN,
                0, 0, (int)ActualWidth, (int)ActualHeight,
                hwndParent.Handle, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);

            return new HandleRef(this, hwnd);
        }

        protected override void DestroyWindowCore(HandleRef hwnd)
        {
            if (_childHwnd != IntPtr.Zero)
            {
                WindowManagerService.UnhostWindow(_childHwnd);
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
            if (_childHwnd != IntPtr.Zero && Handle != IntPtr.Zero)
            {
                // Add a small buffer or just use actual size
                WindowManagerService.UpdateLayout(_childHwnd, 0, 0, (int)ActualWidth, (int)ActualHeight);
            }
        }
    }
}
