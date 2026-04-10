using System.Text;
using TerminalWindowManager.Core.Models;
using TerminalWindowManager.Core.Services;

namespace TerminalWindowManager.Core.Tests;

public sealed class TerminalSequenceParserTests
{
    [Fact]
    public void Parse_StripsValidProgressSequenceAndRaisesEvent()
    {
        var parser = new TerminalSequenceParser();
        TerminalProgressInfo? detected = null;
        parser.ProgressDetected += info => detected = info;

        var output = parser.Parse(Encoding.ASCII.GetBytes($"before\u001b]9;4;1;42\u0007after"));

        Assert.Equal("beforeafter", Encoding.UTF8.GetString(output));
        Assert.Equal(new TerminalProgressInfo(TerminalProgressState.Normal, 42), detected);
    }

    [Fact]
    public void Parse_HandlesFragmentedSequencesAcrossCalls()
    {
        var parser = new TerminalSequenceParser();
        var detected = new List<TerminalProgressInfo>();
        parser.ProgressDetected += info => detected.Add(info);

        var output1 = parser.Parse(Encoding.ASCII.GetBytes("start\u001b]9;4;"));
        var output2 = parser.Parse(Encoding.ASCII.GetBytes("3;0"));
        var output3 = parser.Parse(Encoding.ASCII.GetBytes("\u0007end"));

        Assert.Equal("startend", $"{Encoding.UTF8.GetString(output1)}{Encoding.UTF8.GetString(output2)}{Encoding.UTF8.GetString(output3)}");
        Assert.Equal([new TerminalProgressInfo(TerminalProgressState.Indeterminate, 0)], detected);
    }

    [Fact]
    public void Parse_HandlesMultipleValidSequencesInOneChunk()
    {
        var parser = new TerminalSequenceParser();
        var detected = new List<TerminalProgressInfo>();
        parser.ProgressDetected += info => detected.Add(info);

        var output = parser.Parse(Encoding.ASCII.GetBytes(
            $"a\u001b]9;4;1;10\u0007b\u001b]9;4;4;80\u0007c"));

        Assert.Equal("abc", Encoding.UTF8.GetString(output));
        Assert.Equal(
            [
                new TerminalProgressInfo(TerminalProgressState.Normal, 10),
                new TerminalProgressInfo(TerminalProgressState.Warning, 80)
            ],
            detected);
    }

    [Fact]
    public void Parse_PreservesInvalidSequenceAsPlainOutput()
    {
        var parser = new TerminalSequenceParser();
        var eventRaised = false;
        parser.ProgressDetected += _ => eventRaised = true;
        var original = $"\u001b]9;4;9;10\u0007";

        var output = parser.Parse(Encoding.ASCII.GetBytes(original));

        Assert.False(eventRaised);
        Assert.Equal(original, Encoding.UTF8.GetString(output));
    }

    [Fact]
    public void Parse_SupportsStringTerminator()
    {
        var parser = new TerminalSequenceParser();
        TerminalProgressInfo? detected = null;
        parser.ProgressDetected += info => detected = info;

        var output = parser.Parse(Encoding.ASCII.GetBytes($"x\u001b]9;4;2;100\u001b\\y"));

        Assert.Equal("xy", Encoding.UTF8.GetString(output));
        Assert.Equal(new TerminalProgressInfo(TerminalProgressState.Error, 100), detected);
    }

    [Fact]
    public void FlushPendingOutput_ReturnsIncompleteSequenceBytes()
    {
        var parser = new TerminalSequenceParser();
        _ = parser.Parse(Encoding.ASCII.GetBytes($"\u001b]9;4;1;5"));

        var output = parser.FlushPendingOutput();

        Assert.Equal($"\u001b]9;4;1;5", Encoding.UTF8.GetString(output));
    }
}
