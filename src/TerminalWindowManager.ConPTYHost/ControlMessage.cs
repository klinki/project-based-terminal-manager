namespace TerminalWindowManager.ConPTYHost;

internal sealed class ControlMessage
{
    public string Type { get; init; } = string.Empty;

    public string? Data { get; init; }

    public short? Cols { get; init; }

    public short? Rows { get; init; }
}
