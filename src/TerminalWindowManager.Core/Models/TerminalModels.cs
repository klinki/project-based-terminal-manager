using System.Collections.ObjectModel;
using System.Text;
using System.Text.Json.Serialization;

namespace TerminalWindowManager.Core.Models;

public enum TerminalTabState
{
    Configured,
    Hosted
}

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

public sealed class ManagedTerminalTab : ObservableObject
{
    private TerminalTabState _state = TerminalTabState.Configured;
    private IntPtr _lastKnownWindowHwnd;
    private TerminalProgressState _progressState = TerminalProgressState.None;
    private int _progressValue;

    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ProjectId { get; set; }
    public int TabIndex { get; set; }
    public string Name { get; set; } = string.Empty;
    public string WorkingDirectory { get; set; } = string.Empty;
    public string ProfileName { get; set; } = string.Empty;
    public string WindowTarget { get; set; } = string.Empty;

    public TerminalTabState State
    {
        get => _state;
        set => SetProperty(ref _state, value);
    }

    [JsonIgnore]
    public TerminalProgressState ProgressState
    {
        get => _progressState;
        set
        {
            if (!SetProperty(ref _progressState, value))
            {
                return;
            }

            OnPropertyChanged(nameof(HasVisibleProgress));
            OnPropertyChanged(nameof(IsProgressIndeterminate));
            OnPropertyChanged(nameof(ProgressDisplayText));
        }
    }

    [JsonIgnore]
    public int ProgressValue
    {
        get => _progressValue;
        set
        {
            if (!SetProperty(ref _progressValue, value))
            {
                return;
            }

            OnPropertyChanged(nameof(ProgressDisplayText));
        }
    }

    [JsonIgnore]
    public IntPtr LastKnownWindowHwnd
    {
        get => _lastKnownWindowHwnd;
        set => SetProperty(ref _lastKnownWindowHwnd, value);
    }

    [JsonIgnore]
    public string DisplayLabel => Name;

    [JsonIgnore]
    public bool HasVisibleProgress => ProgressState != TerminalProgressState.None;

    [JsonIgnore]
    public bool IsProgressIndeterminate => ProgressState == TerminalProgressState.Indeterminate;

    [JsonIgnore]
    public string ProgressDisplayText =>
        ProgressState switch
        {
            TerminalProgressState.None => string.Empty,
            TerminalProgressState.Indeterminate => "Working",
            _ => $"{Math.Clamp(ProgressValue, 0, 100)}%"
        };

    public ManagedTerminalTab()
    {
    }

    public ManagedTerminalTab(Guid projectId, int tabIndex, string name, string workingDirectory, string? profileName)
    {
        ProjectId = projectId;
        TabIndex = tabIndex;
        Name = name;
        WorkingDirectory = workingDirectory;
        ProfileName = profileName ?? string.Empty;
        WindowTarget = CreateWindowTarget(name, Id);
    }

    public static string CreateWindowTarget(string name, Guid id)
    {
        var builder = new StringBuilder();
        var previousWasSeparator = false;

        foreach (var character in name.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(character))
            {
                builder.Append(character);
                previousWasSeparator = false;
                continue;
            }

            if (!previousWasSeparator)
            {
                builder.Append('-');
                previousWasSeparator = true;
            }
        }

        var slug = builder.ToString().Trim('-');
        if (string.IsNullOrWhiteSpace(slug))
        {
            slug = "terminal";
        }

        return $"twm-term-{slug}-{id:N}"[..Math.Min(slug.Length + 25, 36)];
    }
}

public sealed class TerminalProject : ObservableObject
{
    private IntPtr _lastKnownWindowHwnd;

    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string WindowTarget { get; set; } = string.Empty;
    public ObservableCollection<ManagedTerminalTab> Tabs { get; set; } = new();

    [JsonIgnore]
    public IntPtr LastKnownWindowHwnd
    {
        get => _lastKnownWindowHwnd;
        set => SetProperty(ref _lastKnownWindowHwnd, value);
    }

    public TerminalProject()
    {
    }

    public TerminalProject(string name)
    {
        Name = name.Trim();
        WindowTarget = CreateWindowTarget(Name, Id);
    }

    public static string CreateWindowTarget(string name, Guid id)
    {
        var builder = new StringBuilder();
        var previousWasSeparator = false;

        foreach (var character in name.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(character))
            {
                builder.Append(character);
                previousWasSeparator = false;
                continue;
            }

            if (!previousWasSeparator)
            {
                builder.Append('-');
                previousWasSeparator = true;
            }
        }

        var slug = builder.ToString().Trim('-');
        if (string.IsNullOrWhiteSpace(slug))
        {
            slug = "project";
        }

        return $"twm-{slug}-{id:N}"[..Math.Min(slug.Length + 20, 28)];
    }
}
