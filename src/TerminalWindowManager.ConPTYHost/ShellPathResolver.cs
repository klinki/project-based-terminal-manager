namespace TerminalWindowManager.ConPTYHost;

internal static class ShellPathResolver
{
    private static readonly string[] FallbackShells =
    [
        "pwsh.exe",
        "powershell.exe",
        "cmd.exe"
    ];

    public static string Resolve(string? requestedShell)
    {
        if (!string.IsNullOrWhiteSpace(requestedShell))
        {
            var resolvedRequestedShell = ResolveCandidate(requestedShell);
            if (resolvedRequestedShell is not null)
            {
                return resolvedRequestedShell;
            }

            throw new FileNotFoundException(
                $"Shell executable '{requestedShell}' could not be located.");
        }

        foreach (var candidate in FallbackShells)
        {
            var resolvedCandidate = ResolveCandidate(candidate);
            if (resolvedCandidate is not null)
            {
                return resolvedCandidate;
            }
        }

        throw new FileNotFoundException(
            "No supported shell executable was found. Tried pwsh.exe, powershell.exe, and cmd.exe.");
    }

    private static string? ResolveCandidate(string candidate)
    {
        var trimmedCandidate = candidate.Trim().Trim('"');

        if (Path.IsPathRooted(trimmedCandidate) && File.Exists(trimmedCandidate))
        {
            return trimmedCandidate;
        }

        if (trimmedCandidate.Contains(Path.DirectorySeparatorChar) ||
            trimmedCandidate.Contains(Path.AltDirectorySeparatorChar))
        {
            var fullPath = Path.GetFullPath(trimmedCandidate);
            if (File.Exists(fullPath))
            {
                return fullPath;
            }
        }

        var pathValue = Environment.GetEnvironmentVariable("PATH");
        if (!string.IsNullOrWhiteSpace(pathValue))
        {
            foreach (var directory in pathValue.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            {
                var candidatePath = Path.Combine(directory.Trim(), trimmedCandidate);
                if (File.Exists(candidatePath))
                {
                    return candidatePath;
                }
            }
        }

        var system32Path = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            "System32",
            trimmedCandidate);

        return File.Exists(system32Path) ? system32Path : null;
    }
}
