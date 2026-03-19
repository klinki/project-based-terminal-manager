using System.Text;
using System.Text.Json;
using System.Threading.Channels;

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

        try
        {
            var options = CommandLineOptions.Parse(args);

            using var session = new ConPtySession(
                options.ShellPath,
                options.WorkingDirectory,
                options.Columns,
                options.Rows);

            session.OutputReceived += data =>
            {
                outboundMessages.Writer.TryWrite(new
                {
                    type = "output",
                    dataBase64 = Convert.ToBase64String(data)
                });
            };

            outboundMessages.Writer.TryWrite(new
            {
                type = "started",
                pid = session.ProcessId
            });

            var commandLoopTask = ProcessCommandsAsync(session, outboundMessages.Writer);
            var exitTask = session.WaitForExitAsync();

            var completedTask = await Task.WhenAny(commandLoopTask, exitTask);
            if (completedTask == commandLoopTask)
            {
                session.Terminate();
            }

            var exitCode = await exitTask;
            outboundMessages.Writer.TryWrite(new
            {
                type = "exit",
                exitCode
            });

            outboundMessages.Writer.Complete();
            await writerTask;
            return exitCode;
        }
        catch (Exception exception)
        {
            outboundMessages.Writer.TryWrite(new
            {
                type = "error",
                message = exception.Message
            });
            outboundMessages.Writer.Complete();
            await writerTask;
            return 1;
        }
    }

    private static async Task ProcessCommandsAsync(
        ConPtySession session,
        ChannelWriter<object> outboundMessages)
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
                    message = $"Invalid control message: {jsonException.Message}"
                });
                continue;
            }

            if (message is null)
            {
                outboundMessages.TryWrite(new
                {
                    type = "error",
                    message = "Received an empty control message."
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
}
