using System.ComponentModel;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using TerminalWindowManager.Core.Services;

namespace TerminalWindowManager.ConPTYHost;

internal static class Program
{
    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public static async Task<int> Main(string[] args)
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = Encoding.UTF8;

        var outboundMessages = Channel.CreateUnbounded<object>();
        await using var standardOutput = Console.OpenStandardOutput();
        await using var writer = new StreamWriter(standardOutput, new UTF8Encoding(false))
        {
            AutoFlush = true
        };

        var writerTask = WriteMessagesAsync(outboundMessages.Reader, writer);
        CommandLineOptions? options = null;
        TerminalSequenceParser? sequenceParser = null;

        try
        {
            options = CommandLineOptions.Parse(args);

            using var session = new ConPtySession(
                options.ShellPath,
                BuildShellArguments(options),
                options.WorkingDirectory,
                options.Columns,
                options.Rows);

            sequenceParser = new TerminalSequenceParser();
            sequenceParser.ProgressDetected += info =>
            {
                outboundMessages.Writer.TryWrite(new
                {
                    type = "terminalProgress",
                    sessionId = options.SessionId,
                    state = (int)info.State,
                    progress = info.Value,
                    occurredAt = DateTimeOffset.UtcNow.ToString("O")
                });
            };

            session.OutputReceived += data =>
            {
                var visibleOutput = sequenceParser.Parse(data);
                if (visibleOutput.Length == 0)
                {
                    return;
                }

                outboundMessages.Writer.TryWrite(new
                {
                    type = "output",
                    dataBase64 = Convert.ToBase64String(visibleOutput)
                });
            };

            outboundMessages.Writer.TryWrite(new
            {
                type = "started",
                sessionId = options.SessionId,
                shellPid = session.ProcessId,
                shellPath = options.ShellPath,
                diagnosticLogPath = options.DiagnosticsLogPath,
                startedAt = DateTimeOffset.UtcNow.ToString("O")
            });

            var commandLoopTask = ProcessCommandsAsync(session, outboundMessages.Writer, options);
            var exitTask = session.WaitForExitAsync();

            var completedTask = await Task.WhenAny(commandLoopTask, exitTask);
            if (completedTask == commandLoopTask)
            {
                session.Terminate();
            }

            var exitCode = await exitTask;
            EmitPendingOutput(sequenceParser, outboundMessages.Writer);
            outboundMessages.Writer.TryWrite(new
            {
                type = "exit",
                sessionId = options.SessionId,
                exitCode,
                exitedAt = DateTimeOffset.UtcNow.ToString("O"),
                shellPid = session.ProcessId,
                shellPath = options.ShellPath,
                diagnosticLogPath = options.DiagnosticsLogPath,
                stderrExcerpt = (string?)null
            });

            outboundMessages.Writer.Complete();
            await writerTask;
            return exitCode;
        }
        catch (Exception exception)
        {
            EmitPendingOutput(sequenceParser, outboundMessages.Writer);
            outboundMessages.Writer.TryWrite(CreateErrorEvent(exception, options));
            outboundMessages.Writer.Complete();
            await writerTask;
            return 1;
        }
    }

    private static async Task ProcessCommandsAsync(
        ConPtySession session,
        ChannelWriter<object> outboundMessages,
        CommandLineOptions options)
    {
        using var reader = new StreamReader(
            Console.OpenStandardInput(),
            Encoding.UTF8,
            detectEncodingFromByteOrderMarks: false);

        while (await reader.ReadLineAsync() is { } line)
        {
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            ControlMessage? message;
            try
            {
                message = JsonSerializer.Deserialize<ControlMessage>(line, SerializerOptions);
            }
            catch (JsonException jsonException)
            {
                outboundMessages.TryWrite(new
                {
                    type = "error",
                    sessionId = options.SessionId,
                    message = $"Invalid control message: {jsonException.Message}",
                    diagnosticLogPath = options.DiagnosticsLogPath,
                    exceptionType = typeof(JsonException).FullName,
                    hresult = jsonException.HResult,
                    win32ErrorCode = (int?)null,
                    occurredAt = DateTimeOffset.UtcNow.ToString("O"),
                    shellPath = options.ShellPath,
                    shellPid = (int?)null
                });
                continue;
            }

            if (message is null)
            {
                outboundMessages.TryWrite(new
                {
                    type = "error",
                    sessionId = options.SessionId,
                    message = "Received an empty control message.",
                    diagnosticLogPath = options.DiagnosticsLogPath,
                    exceptionType = typeof(InvalidOperationException).FullName,
                    hresult = (int?)null,
                    win32ErrorCode = (int?)null,
                    occurredAt = DateTimeOffset.UtcNow.ToString("O"),
                    shellPath = options.ShellPath,
                    shellPid = (int?)null
                });
                continue;
            }

            switch (message.Type)
            {
                case "input":
                    if (message.Data is null)
                    {
                        throw new InvalidOperationException(
                            "Input control messages must include a data payload.");
                    }

                    await session.WriteInputAsync(message.Data, CancellationToken.None);
                    break;

                case "resize":
                    if (message.Cols is null || message.Rows is null)
                    {
                        throw new InvalidOperationException(
                            "Resize control messages must include cols and rows.");
                    }

                    session.Resize(message.Cols.Value, message.Rows.Value);
                    break;

                case "shutdown":
                    session.Terminate();
                    return;

                default:
                    throw new InvalidOperationException(
                        $"Unsupported control message type '{message.Type}'.");
            }
        }
    }

    private static async Task WriteMessagesAsync(
        ChannelReader<object> outboundMessages,
        StreamWriter writer)
    {
        await foreach (var message in outboundMessages.ReadAllAsync())
        {
            var line = JsonSerializer.Serialize(message, SerializerOptions);
            await writer.WriteLineAsync(line);
        }
    }

    private static void EmitPendingOutput(
        TerminalSequenceParser? sequenceParser,
        ChannelWriter<object> outboundMessages)
    {
        if (sequenceParser is null)
        {
            return;
        }

        var pendingOutput = sequenceParser.FlushPendingOutput();
        if (pendingOutput.Length == 0)
        {
            return;
        }

        outboundMessages.TryWrite(new
        {
            type = "output",
            dataBase64 = Convert.ToBase64String(pendingOutput)
        });
    }

    private static object CreateErrorEvent(Exception exception, CommandLineOptions? options)
    {
        return new
        {
            type = "error",
            sessionId = options?.SessionId,
            message = exception.Message,
            diagnosticLogPath = options?.DiagnosticsLogPath,
            exceptionType = exception.GetType().FullName,
            hresult = exception.HResult,
            win32ErrorCode = exception is Win32Exception win32Exception
                ? win32Exception.NativeErrorCode
                : (int?)null,
            occurredAt = DateTimeOffset.UtcNow.ToString("O"),
            shellPath = options?.ShellPath,
            shellPid = (int?)null
        };
    }

    private static string? BuildShellArguments(CommandLineOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.PowerShellBootstrapPath))
        {
            return null;
        }

        return $"-NoLogo -NoExit -File {QuoteArgument(options.PowerShellBootstrapPath)}";
    }

    private static string QuoteArgument(string value)
    {
        return $"\"{value.Replace("\"", "\\\"", StringComparison.Ordinal)}\"";
    }
}
