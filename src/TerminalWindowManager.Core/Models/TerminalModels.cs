namespace TerminalWindowManager.Core.Models;

public enum TerminalProgressState
{
    None = 0,
    Normal = 1,
    Error = 2,
    Indeterminate = 3,
    Warning = 4
}

public readonly record struct TerminalProgressInfo(TerminalProgressState State, int Value)
{
    public static TerminalProgressInfo None => new(TerminalProgressState.None, 0);
}
