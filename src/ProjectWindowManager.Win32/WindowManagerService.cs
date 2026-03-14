using System;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Collections.Generic;
using System.Text;
using System.Linq;
using ProjectWindowManager.Core.Interfaces;
using static PInvoke.User32;

namespace ProjectWindowManager.Win32
{
    public class WindowManagerService : IWindowManagerService
    {
        private const int GWL_STYLE = -16;
        private const int GWL_EXSTYLE = -20;
        private const int WS_EX_TOOLWINDOW = 0x00000080;
        
        private const uint WS_POPUP = 0x80000000;
        private const uint WS_CHILD = 0x40000000;
        private const uint WS_CAPTION = 0x00C00000;
        private const uint WS_THICKFRAME = 0x00040000;
        private const uint WS_SYSMENU = 0x00080000;
        private const uint WS_MINIMIZEBOX = 0x00020000;
        private const uint WS_MAXIMIZEBOX = 0x00010000;

        [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);

        [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
        private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out int pvAttribute, int cbAttribute);
        private const int DWMWA_CLOAKED = 14;

        [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Auto)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true, CharSet = System.Runtime.InteropServices.CharSet.Auto)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        public void HostWindow(IntPtr childHwnd, IntPtr parentHwnd)
        {
            if (childHwnd == IntPtr.Zero || parentHwnd == IntPtr.Zero) return;

            string cls = GetClassNameString(childHwnd);
            bool isUwp = cls == "ApplicationFrameWindow";

            // If it's already hosted in THIS parent, don't do it again
            if (GetParent(childHwnd) == parentHwnd) return;

            Console.WriteLine($"[WindowManagerService] Hosting {cls} ({childHwnd}) in {parentHwnd}");

            ShowWindow(childHwnd, WindowShowStyle.SW_HIDE);
            SetParent(childHwnd, parentHwnd);

            uint style = (uint)GetWindowLong(childHwnd, WindowLongIndexFlags.GWL_STYLE);
            if (isUwp)
            {
                style |= WS_CHILD;
                style &= ~WS_POPUP;
            }
            else
            {
                style &= ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU);
                style |= WS_CHILD;
            }
            SetWindowLong(childHwnd, WindowLongIndexFlags.GWL_STYLE, (SetWindowLongFlags)style);

            uint exStyle = (uint)GetWindowLong(childHwnd, WindowLongIndexFlags.GWL_EXSTYLE);
            exStyle |= WS_EX_TOOLWINDOW;
            SetWindowLong(childHwnd, WindowLongIndexFlags.GWL_EXSTYLE, (SetWindowLongFlags)exStyle);

            PInvoke.RECT parentRect;
            GetClientRect(parentHwnd, out parentRect);
            
            SetWindowPos(childHwnd, IntPtr.Zero, 0, 0, parentRect.right - parentRect.left, parentRect.bottom - parentRect.top, 
                SetWindowPosFlags.SWP_NOZORDER | SetWindowPosFlags.SWP_FRAMECHANGED | SetWindowPosFlags.SWP_SHOWWINDOW);
        }

        public void UnhostWindow(IntPtr childHwnd)
        {
            if (childHwnd == IntPtr.Zero) return;
            Console.WriteLine($"[WindowManagerService] Unhosting {childHwnd}");
            SetParent(childHwnd, IntPtr.Zero);
            
            uint style = (uint)GetWindowLong(childHwnd, WindowLongIndexFlags.GWL_STYLE);
            style &= ~WS_CHILD;
            style |= (WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU);
            SetWindowLong(childHwnd, WindowLongIndexFlags.GWL_STYLE, (SetWindowLongFlags)style);

            SetWindowPos(childHwnd, IntPtr.Zero, 100, 100, 800, 600, SetWindowPosFlags.SWP_SHOWWINDOW);
        }

        public void UpdateLayout(IntPtr childHwnd, int x, int y, int width, int height)
        {
            if (childHwnd == IntPtr.Zero) return;
            SetWindowPos(childHwnd, IntPtr.Zero, x, y, width, height, SetWindowPosFlags.SWP_NOZORDER | SetWindowPosFlags.SWP_SHOWWINDOW | SetWindowPosFlags.SWP_FRAMECHANGED);
        }

        public async Task<IntPtr> LaunchAndHost(string exePath, IntPtr parentHwnd)
        {
            Console.WriteLine($"[WindowManagerService] Launching: {exePath}");
            
            var psi = new ProcessStartInfo(exePath) { UseShellExecute = true };
            var process = Process.Start(psi);
            if (process == null) return IntPtr.Zero;

            string procName = process.ProcessName;
            int initialPid = process.Id;
            IntPtr hwnd = IntPtr.Zero;

            for (int i = 0; i < 60; i++)
            {
                process.Refresh();
                
                hwnd = process.MainWindowHandle;
                if (hwnd != IntPtr.Zero && IsValidTopLevelWindow(hwnd)) break;

                hwnd = FindWindowByProcessId(initialPid);
                if (hwnd != IntPtr.Zero) break;

                hwnd = FindWindowByProcessName(procName);
                if (hwnd == IntPtr.Zero && procName.Equals("calc", StringComparison.OrdinalIgnoreCase))
                {
                    hwnd = FindWindowByProcessName("CalculatorApp");
                    if (hwnd == IntPtr.Zero) hwnd = FindWindowByProcessName("Calculator");
                }
                
                if (hwnd != IntPtr.Zero) break;

                await Task.Delay(250);
            }

            Console.WriteLine($"[WindowManagerService] Capture HWND result: {hwnd}");
            
            // Note: We return HWND and the caller (MainViewModel) will eventually trigger property change
            // which results in WindowHost.AttachWindow call.
            // BUT, if we want instant hosting, we can call HostWindow here.
            // However, to avoid the double-hosting reported by user, we should be careful.
            
            if (hwnd != IntPtr.Zero && parentHwnd != IntPtr.Zero) 
            {
                HostWindow(hwnd, parentHwnd);
            }
            
            return hwnd;
        }

        private IntPtr FindWindowByProcessId(int processId)
        {
            IntPtr result = IntPtr.Zero;
            EnumWindows((hwnd, lParam) =>
            {
                GetWindowThreadProcessId(hwnd, out int pid);
                if (pid == processId && IsValidTopLevelWindow(hwnd))
                {
                    result = hwnd;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            return result;
        }

        private IntPtr FindWindowByProcessName(string processName)
        {
            var pids = Process.GetProcessesByName(processName).Select(p => p.Id).ToList();
            pids.AddRange(Process.GetProcessesByName("ApplicationFrameHost").Select(p => p.Id));

            IntPtr found = IntPtr.Zero;
            EnumWindows((hwnd, lParam) =>
            {
                GetWindowThreadProcessId(hwnd, out int pid);
                if (pids.Contains(pid) && IsValidTopLevelWindow(hwnd))
                {
                    string cls = GetClassNameString(hwnd);
                    if (cls.Equals("ApplicationFrameWindow"))
                    {
                        var title = new StringBuilder(256);
                        GetWindowText(hwnd, title, 256);
                        string t = title.ToString();
                        
                        if (t.Contains(processName, StringComparison.OrdinalIgnoreCase) || 
                            (processName.Equals("calc", StringComparison.OrdinalIgnoreCase) && t.Contains("Calculator", StringComparison.OrdinalIgnoreCase)))
                        {
                            found = hwnd;
                            return false;
                        }
                        return true; 
                    }
                    found = hwnd;
                    return false;
                }
                return true;
            }, IntPtr.Zero);
            return found;
        }

        private string GetClassNameString(IntPtr hwnd)
        {
            var sb = new StringBuilder(256);
            GetClassName(hwnd, sb, 256);
            return sb.ToString();
        }

        private bool IsValidTopLevelWindow(IntPtr hwnd)
        {
            if (!IsWindowVisible(hwnd)) return false;

            DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out int cloaked, 4);
            if (cloaked != 0) return false;

            if (GetParent(hwnd) != IntPtr.Zero) return false;

            return true;
        }
    }
}
