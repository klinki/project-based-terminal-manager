using System.Globalization;
using TerminalWindowManager.Core.Models;

namespace TerminalWindowManager.Core.Services;

public sealed class TerminalSequenceParser
{
    private const byte EscapeByte = 0x1B;
    private const byte OscByte = (byte)']';
    private const byte SemicolonByte = (byte)';';
    private const byte BellByte = 0x07;
    private const byte StringTerminatorByte = (byte)'\\';
    private static readonly byte[] OscProgressPrefix = "9;4;"u8.ToArray();

    private readonly List<byte> _sequenceBuffer = [];
    private readonly List<byte> _stateBuffer = [];
    private readonly List<byte> _progressBuffer = [];
    private ParserState _parserState = ParserState.Idle;
    private int _prefixIndex;

    public event Action<TerminalProgressInfo>? ProgressDetected;

    public byte[] Parse(ReadOnlySpan<byte> input)
    {
        if (input.IsEmpty)
        {
            return [];
        }

        var output = new List<byte>(input.Length);
        foreach (var value in input)
        {
            ProcessByte(value, output);
        }

        return output.ToArray();
    }

    public byte[] FlushPendingOutput()
    {
        if (_sequenceBuffer.Count == 0)
        {
            return [];
        }

        var output = _sequenceBuffer.ToArray();
        ResetParser();
        return output;
    }

    private void ProcessByte(byte value, List<byte> output)
    {
    Reprocess:
        switch (_parserState)
        {
            case ParserState.Idle:
                if (value == EscapeByte)
                {
                    StartSequence();
                    return;
                }

                output.Add(value);
                return;

            case ParserState.ExpectOsc:
                if (value == OscByte)
                {
                    _sequenceBuffer.Add(value);
                    _parserState = ParserState.ExpectPrefix;
                    _prefixIndex = 0;
                    return;
                }

                FlushPending(output);
                goto Reprocess;

            case ParserState.ExpectPrefix:
                if (value == OscProgressPrefix[_prefixIndex])
                {
                    _sequenceBuffer.Add(value);
                    _prefixIndex += 1;
                    if (_prefixIndex == OscProgressPrefix.Length)
                    {
                        _stateBuffer.Clear();
                        _progressBuffer.Clear();
                        _parserState = ParserState.ParseState;
                    }

                    return;
                }

                FlushPending(output);
                goto Reprocess;

            case ParserState.ParseState:
                if (IsAsciiDigit(value))
                {
                    _sequenceBuffer.Add(value);
                    _stateBuffer.Add(value);
                    return;
                }

                if (value == SemicolonByte && _stateBuffer.Count > 0)
                {
                    _sequenceBuffer.Add(value);
                    _parserState = ParserState.ParseProgress;
                    return;
                }

                FlushPending(output);
                goto Reprocess;

            case ParserState.ParseProgress:
                if (IsAsciiDigit(value))
                {
                    _sequenceBuffer.Add(value);
                    _progressBuffer.Add(value);
                    return;
                }

                if (value == BellByte && _progressBuffer.Count > 0)
                {
                    _sequenceBuffer.Add(value);
                    CompleteSequence(output);
                    return;
                }

                if (value == EscapeByte && _progressBuffer.Count > 0)
                {
                    _sequenceBuffer.Add(value);
                    _parserState = ParserState.ExpectStringTerminator;
                    return;
                }

                FlushPending(output);
                goto Reprocess;

            case ParserState.ExpectStringTerminator:
                if (value == StringTerminatorByte)
                {
                    _sequenceBuffer.Add(value);
                    CompleteSequence(output);
                    return;
                }

                FlushPending(output);
                goto Reprocess;

            default:
                ResetParser();
                goto Reprocess;
        }
    }

    private void StartSequence()
    {
        ResetParser();
        _sequenceBuffer.Add(EscapeByte);
        _parserState = ParserState.ExpectOsc;
    }

    private void FlushPending(List<byte> output)
    {
        if (_sequenceBuffer.Count > 0)
        {
            output.AddRange(_sequenceBuffer);
        }

        ResetParser();
    }

    private void CompleteSequence(List<byte> output)
    {
        if (TryCreateProgressInfo(out var progressInfo))
        {
            ProgressDetected?.Invoke(progressInfo);
            ResetParser();
            return;
        }

        FlushPending(output);
    }

    private bool TryCreateProgressInfo(out TerminalProgressInfo progressInfo)
    {
        progressInfo = TerminalProgressInfo.None;

        if (!TryParseAsciiInt(_stateBuffer, out var rawState) ||
            !Enum.IsDefined(typeof(TerminalProgressState), rawState) ||
            !TryParseAsciiInt(_progressBuffer, out var rawProgress) ||
            rawProgress < 0 ||
            rawProgress > 100)
        {
            return false;
        }

        var state = (TerminalProgressState)rawState;
        var normalizedProgress = state switch
        {
            TerminalProgressState.None => 0,
            TerminalProgressState.Indeterminate => 0,
            _ => rawProgress
        };

        progressInfo = new TerminalProgressInfo(state, normalizedProgress);
        return true;
    }

    private static bool TryParseAsciiInt(List<byte> buffer, out int value)
    {
        value = 0;
        if (buffer.Count == 0)
        {
            return false;
        }

        var text = System.Text.Encoding.ASCII.GetString(buffer.ToArray());
        return int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out value);
    }

    private void ResetParser()
    {
        _parserState = ParserState.Idle;
        _prefixIndex = 0;
        _sequenceBuffer.Clear();
        _stateBuffer.Clear();
        _progressBuffer.Clear();
    }

    private static bool IsAsciiDigit(byte value) => value is >= (byte)'0' and <= (byte)'9';

    private enum ParserState
    {
        Idle,
        ExpectOsc,
        ExpectPrefix,
        ParseState,
        ParseProgress,
        ExpectStringTerminator
    }
}
