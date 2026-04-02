using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace TerminalWindowManager.ConPTYHost;

internal sealed class ConPtySession : IDisposable
{
    private const int ExtendedStartupInfoPresent = 0x00080000;
    private const int StartfUseStdHandles = 0x00000100;
    private const nuint ProcThreadAttributePseudoConsole = 0x00020016;
    private const uint Infinite = 0xFFFFFFFF;
    private const uint StillActive = 259;

    private readonly IntPtr _pseudoConsole;
    private readonly PROCESS_INFORMATION _processInformation;
    private readonly SafeFileHandle _inputWriterHandle;
    private readonly SafeFileHandle _outputReaderHandle;
    private readonly FileStream _inputWriter;
    private readonly FileStream _outputReader;
    private readonly Task _outputPump;
    private readonly Task<int> _exitTask;
    private bool _disposed;

    public ConPtySession(
        string shellPath,
        string? shellArguments,
        string workingDirectory,
        short columns,
        short rows)
    {
        CreatePipePair(out var pseudoConsoleInput, out var inputWriterHandle);
        CreatePipePair(out var outputReaderHandle, out var pseudoConsoleOutput);

        try
        {
            _pseudoConsole = CreatePseudoConsoleHandle(
                pseudoConsoleInput,
                pseudoConsoleOutput,
                columns,
                rows);
        }
        finally
        {
            pseudoConsoleInput.Dispose();
            pseudoConsoleOutput.Dispose();
        }

        _inputWriterHandle = inputWriterHandle;
        _outputReaderHandle = outputReaderHandle;
        _inputWriter = new FileStream(_inputWriterHandle, FileAccess.Write, 4096, false);
        _outputReader = new FileStream(_outputReaderHandle, FileAccess.Read, 4096, false);

        _processInformation = StartProcess(
            shellPath,
            shellArguments,
            workingDirectory,
            _pseudoConsole);
        _outputPump = Task.Run(PumpOutputAsync);
        _exitTask = Task.Run(WaitForExitInternal);
    }

    public int ProcessId => _processInformation.dwProcessId;

    public event Action<byte[]>? OutputReceived;

    public async Task WriteInputAsync(string data, CancellationToken cancellationToken)
    {
        ThrowIfDisposed();

        var bytes = Encoding.UTF8.GetBytes(data);
        await _inputWriter.WriteAsync(bytes, cancellationToken);
        await _inputWriter.FlushAsync(cancellationToken);
    }

    public void Resize(short columns, short rows)
    {
        ThrowIfDisposed();

        var resizeResult = ResizePseudoConsole(_pseudoConsole, new COORD(columns, rows));
        if (resizeResult != 0)
        {
            Marshal.ThrowExceptionForHR(resizeResult);
        }
    }

    public Task<int> WaitForExitAsync() => _exitTask;

    public void Terminate()
    {
        if (_processInformation.hProcess == IntPtr.Zero)
        {
            return;
        }

        if (!GetExitCodeProcess(_processInformation.hProcess, out var exitCode))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        if (exitCode == StillActive &&
            !TerminateProcess(_processInformation.hProcess, 1))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        try
        {
            if (!_exitTask.IsCompleted)
            {
                Terminate();
            }
        }
        finally
        {
            _inputWriter.Dispose();
            _outputReader.Dispose();

            if (_pseudoConsole != IntPtr.Zero)
            {
                ClosePseudoConsole(_pseudoConsole);
            }

            if (_processInformation.hThread != IntPtr.Zero)
            {
                CloseHandle(_processInformation.hThread);
            }

            if (_processInformation.hProcess != IntPtr.Zero)
            {
                CloseHandle(_processInformation.hProcess);
            }

            _disposed = true;
        }
    }

    private async Task PumpOutputAsync()
    {
        var buffer = new byte[4096];

        while (true)
        {
            var bytesRead = await _outputReader.ReadAsync(buffer, CancellationToken.None);
            if (bytesRead == 0)
            {
                return;
            }

            var copy = buffer[..bytesRead].ToArray();
            OutputReceived?.Invoke(copy);
        }
    }

    private int WaitForExitInternal()
    {
        var waitResult = WaitForSingleObject(_processInformation.hProcess, Infinite);
        if (waitResult != 0)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        if (!GetExitCodeProcess(_processInformation.hProcess, out var exitCode))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        return unchecked((int)exitCode);
    }

    private static PROCESS_INFORMATION StartProcess(
        string shellPath,
        string? shellArguments,
        string workingDirectory,
        IntPtr pseudoConsole)
    {
        var startupInfo = ConfigureProcessThread(pseudoConsole);

        try
        {
            var securityAttributeSize = Marshal.SizeOf<SECURITY_ATTRIBUTES>();
            var processSecurity = new SECURITY_ATTRIBUTES { nLength = securityAttributeSize };
            var threadSecurity = new SECURITY_ATTRIBUTES { nLength = securityAttributeSize };
            var commandLine = BuildCommandLine(shellPath, shellArguments);

            if (!CreateProcess(
                    lpApplicationName: shellPath,
                    lpCommandLine: commandLine,
                    lpProcessAttributes: ref processSecurity,
                    lpThreadAttributes: ref threadSecurity,
                    bInheritHandles: false,
                    dwCreationFlags: ExtendedStartupInfoPresent,
                    lpEnvironment: IntPtr.Zero,
                    lpCurrentDirectory: workingDirectory,
                    lpStartupInfo: ref startupInfo,
                    lpProcessInformation: out var processInformation))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            return processInformation;
        }
        finally
        {
            if (startupInfo.lpAttributeList != IntPtr.Zero)
            {
                DeleteProcThreadAttributeList(startupInfo.lpAttributeList);
                Marshal.FreeHGlobal(startupInfo.lpAttributeList);
            }
        }
    }

    private static string BuildCommandLine(string shellPath, string? shellArguments)
    {
        if (string.IsNullOrWhiteSpace(shellArguments))
        {
            return QuoteArgument(shellPath);
        }

        return $"{QuoteArgument(shellPath)} {shellArguments}";
    }

    private static string QuoteArgument(string value)
    {
        return $"\"{value.Replace("\"", "\\\"", StringComparison.Ordinal)}\"";
    }

    private static STARTUPINFOEX ConfigureProcessThread(IntPtr pseudoConsole)
    {
        var attributeListSize = IntPtr.Zero;
        var success = InitializeProcThreadAttributeList(
            IntPtr.Zero,
            1,
            0,
            ref attributeListSize);

        if (success || attributeListSize == IntPtr.Zero)
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Could not calculate the attribute list size.");
        }

        var startupInfo = new STARTUPINFOEX();
        startupInfo.StartupInfo.cb = Marshal.SizeOf<STARTUPINFOEX>();
        startupInfo.StartupInfo.dwFlags = StartfUseStdHandles;
        startupInfo.lpAttributeList = Marshal.AllocHGlobal(attributeListSize);

        success = InitializeProcThreadAttributeList(
            startupInfo.lpAttributeList,
            1,
            0,
            ref attributeListSize);

        if (!success)
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Could not initialize the attribute list.");
        }

        success = UpdateProcThreadAttribute(
            startupInfo.lpAttributeList,
            0,
            (IntPtr)ProcThreadAttributePseudoConsole,
            pseudoConsole,
            (IntPtr)IntPtr.Size,
            IntPtr.Zero,
            IntPtr.Zero);

        if (!success)
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Could not apply the pseudoconsole attribute.");
        }

        return startupInfo;
    }

    private static IntPtr CreatePseudoConsoleHandle(
        SafeFileHandle inputReadSide,
        SafeFileHandle outputWriteSide,
        short columns,
        short rows)
    {
        var createResult = CreatePseudoConsole(
            new COORD(columns, rows),
            inputReadSide,
            outputWriteSide,
            0,
            out var pseudoConsole);

        if (createResult != 0)
        {
            Marshal.ThrowExceptionForHR(createResult);
        }

        return pseudoConsole;
    }

    private static void CreatePipePair(
        out SafeFileHandle readSide,
        out SafeFileHandle writeSide)
    {
        if (!CreatePipe(out readSide, out writeSide, IntPtr.Zero, 0))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreatePipe(
        out SafeFileHandle hReadPipe,
        out SafeFileHandle hWritePipe,
        IntPtr lpPipeAttributes,
        int nSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateProcessW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(
        string? lpApplicationName,
        string lpCommandLine,
        ref SECURITY_ATTRIBUTES lpProcessAttributes,
        ref SECURITY_ATTRIBUTES lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        [In] ref STARTUPINFOEX lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr lpAttributeList,
        int dwAttributeCount,
        int dwFlags,
        ref IntPtr lpSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr lpAttributeList,
        uint dwFlags,
        IntPtr attribute,
        IntPtr lpValue,
        IntPtr cbSize,
        IntPtr lpPreviousValue,
        IntPtr lpReturnSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int CreatePseudoConsole(
        COORD size,
        SafeFileHandle hInput,
        SafeFileHandle hOutput,
        uint dwFlags,
        out IntPtr phPC);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int ResizePseudoConsole(
        IntPtr hPC,
        COORD size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int ClosePseudoConsole(IntPtr hPC);

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES
    {
        public int nLength;
        public IntPtr lpSecurityDescriptor;
        public int bInheritHandle;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct COORD
    {
        public COORD(short x, short y)
        {
            X = x;
            Y = y;
        }

        public short X;

        public short Y;
    }
}
