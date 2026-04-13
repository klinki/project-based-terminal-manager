using System.Globalization;

namespace TerminalWindowManager.ConPTYHost;

internal sealed record CommandLineOptions(
    string WorkingDirectory,
    string ShellPath,
    string SessionId,
    string DiagnosticsDirectory,
    string DiagnosticsLogPath,
    string? PowerShellBootstrapPath,
    short Columns,
    short Rows)
{
    public static CommandLineOptions Parse(string[] args)
    {
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        for (var index = 0; index < args.Length; index += 2)
        {
            if (!args[index].StartsWith("--", StringComparison.Ordinal))
            {
                throw new ArgumentException($"Unexpected argument '{args[index]}'.");
            }

            if (index + 1 >= args.Length)
            {
                throw new ArgumentException($"Missing value for argument '{args[index]}'.");
            }

            values[args[index][2..]] = args[index + 1];
        }

        var workingDirectory = values.TryGetValue("cwd", out var cwd) && !string.IsNullOrWhiteSpace(cwd)
            ? Path.GetFullPath(cwd)
            : Environment.CurrentDirectory;

        if (!Directory.Exists(workingDirectory))
        {
            throw new DirectoryNotFoundException(
                $"Working directory '{workingDirectory}' does not exist.");
        }

        var shellPath = ShellPathResolver.Resolve(
            values.TryGetValue("shell", out var shell) ? shell : null);
        var sessionId = values.TryGetValue("session-id", out var rawSessionId) &&
            !string.IsNullOrWhiteSpace(rawSessionId)
            ? rawSessionId.Trim()
            : Guid.NewGuid().ToString();
        var diagnosticsLogPath = values.TryGetValue("events-path", out var rawEventsPath) &&
            !string.IsNullOrWhiteSpace(rawEventsPath)
            ? Path.GetFullPath(rawEventsPath)
            : null;
        var diagnosticsDirectory = values.TryGetValue("diagnostics-dir", out var rawDiagnosticsDirectory) &&
            !string.IsNullOrWhiteSpace(rawDiagnosticsDirectory)
            ? Path.GetFullPath(rawDiagnosticsDirectory)
            : diagnosticsLogPath is not null
                ? Path.GetDirectoryName(diagnosticsLogPath)
                : Path.Combine(workingDirectory, ".twm-diagnostics", sessionId);

        if (string.IsNullOrWhiteSpace(diagnosticsDirectory))
        {
            throw new ArgumentException("A valid diagnostics directory could not be resolved.");
        }

        Directory.CreateDirectory(diagnosticsDirectory);

        diagnosticsLogPath ??= Path.Combine(diagnosticsDirectory, "events.jsonl");
        var powerShellBootstrapPath = values.TryGetValue("powershell-bootstrap", out var rawBootstrapPath) &&
            !string.IsNullOrWhiteSpace(rawBootstrapPath)
            ? Path.GetFullPath(rawBootstrapPath)
            : null;

        if (powerShellBootstrapPath is not null && !File.Exists(powerShellBootstrapPath))
        {
            throw new FileNotFoundException(
                $"PowerShell bootstrap script '{powerShellBootstrapPath}' could not be located.");
        }

        return new CommandLineOptions(
            workingDirectory,
            shellPath,
            sessionId,
            diagnosticsDirectory,
            diagnosticsLogPath,
            powerShellBootstrapPath,
            ParseDimension(values, "cols", 120, 20, 500),
            ParseDimension(values, "rows", 30, 5, 200));
    }

    private static short ParseDimension(
        IReadOnlyDictionary<string, string> values,
        string key,
        short defaultValue,
        short minimum,
        short maximum)
    {
        if (!values.TryGetValue(key, out var value) || string.IsNullOrWhiteSpace(value))
        {
            return defaultValue;
        }

        if (!short.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            throw new ArgumentException($"Argument '{key}' must be a valid integer.");
        }

        return short.Clamp(parsed, minimum, maximum);
    }
}
