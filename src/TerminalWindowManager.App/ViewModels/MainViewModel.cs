using System.Collections.ObjectModel;
using System.IO;
using System.Windows.Input;
using TerminalWindowManager.Core.Interfaces;
using TerminalWindowManager.Core.Models;
using TerminalWindowManager.Core.Services;

namespace TerminalWindowManager.App.ViewModels;

public sealed class MainViewModel : ObservableObject
{
    private readonly ProjectCatalogService _projectCatalogService;
    private readonly IWindowsTerminalService _windowsTerminalService;
    private readonly SemaphoreSlim _launchLock = new(1, 1);

    private TerminalProject? _selectedProject;
    private ManagedTerminalTab? _selectedTerminal;
    private string _newProjectName = string.Empty;
    private string _newTerminalName = string.Empty;
    private string _newTerminalWorkingDirectory;
    private string _newTerminalProfileName = string.Empty;
    private string _statusMessage = "Create projects, add terminals beneath them, then switch terminals from the tree on the left.";

    public ObservableCollection<TerminalProject> Projects { get; }

    public TerminalProject? SelectedProject
    {
        get => _selectedProject;
        set => SetProperty(ref _selectedProject, value);
    }

    public ManagedTerminalTab? SelectedTerminal
    {
        get => _selectedTerminal;
        set => SetProperty(ref _selectedTerminal, value);
    }

    public string NewProjectName
    {
        get => _newProjectName;
        set => SetProperty(ref _newProjectName, value);
    }

    public string NewTerminalName
    {
        get => _newTerminalName;
        set => SetProperty(ref _newTerminalName, value);
    }

    public string NewTerminalWorkingDirectory
    {
        get => _newTerminalWorkingDirectory;
        set => SetProperty(ref _newTerminalWorkingDirectory, value);
    }

    public string NewTerminalProfileName
    {
        get => _newTerminalProfileName;
        set => SetProperty(ref _newTerminalProfileName, value);
    }

    public string StatusMessage
    {
        get => _statusMessage;
        set => SetProperty(ref _statusMessage, value);
    }

    public ICommand CreateProjectCommand { get; }
    public ICommand AddTerminalCommand { get; }

    public MainViewModel(ProjectCatalogService projectCatalogService, IWindowsTerminalService windowsTerminalService)
    {
        _projectCatalogService = projectCatalogService;
        _windowsTerminalService = windowsTerminalService;
        _newTerminalWorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        Projects = new ObservableCollection<TerminalProject>(_projectCatalogService.LoadProjects());

        foreach (var terminal in Projects.SelectMany(project => project.Tabs).Where(terminal => string.IsNullOrWhiteSpace(terminal.WindowTarget)))
        {
            terminal.WindowTarget = ManagedTerminalTab.CreateWindowTarget(terminal.Name, terminal.Id);
        }

        CreateProjectCommand = new RelayCommand(CreateProject, () => !string.IsNullOrWhiteSpace(NewProjectName));
        AddTerminalCommand = new RelayCommand(AddTerminal, () => SelectedProject is not null && !string.IsNullOrWhiteSpace(NewTerminalName) && !string.IsNullOrWhiteSpace(NewTerminalWorkingDirectory));

        SelectedProject = Projects.FirstOrDefault();
        SelectedTerminal = SelectedProject?.Tabs.OrderBy(tab => tab.TabIndex).FirstOrDefault();
    }

    protected override void OnPropertyChanged(string? propertyName = null)
    {
        base.OnPropertyChanged(propertyName);
        CommandManager.InvalidateRequerySuggested();
    }

    public async Task<IntPtr> ActivateTerminalAsync(ManagedTerminalTab terminal)
    {
        ArgumentNullException.ThrowIfNull(terminal);

        var project = Projects.FirstOrDefault(candidate => candidate.Id == terminal.ProjectId);
        if (project is null)
        {
            StatusMessage = "The selected terminal is no longer attached to a known project.";
            return IntPtr.Zero;
        }

        SelectedProject = project;
        SelectedTerminal = terminal;

        await _launchLock.WaitAsync();
        try
        {
            var hwnd = await _windowsTerminalService.EnsureTerminalWindowAsync(project, terminal, CancellationToken.None);
            if (hwnd == IntPtr.Zero)
            {
                StatusMessage = $"Unable to locate or launch '{terminal.Name}'.";
                return IntPtr.Zero;
            }

            foreach (var candidate in Projects.SelectMany(item => item.Tabs))
            {
                if (!ReferenceEquals(candidate, terminal))
                {
                    candidate.State = TerminalTabState.Configured;
                }
            }

            terminal.State = TerminalTabState.Hosted;
            terminal.LastKnownWindowHwnd = hwnd;
            SaveProjects();
            StatusMessage = $"Showing '{terminal.Name}' from '{project.Name}' inside the Terminal Window Manager frame.";
            return hwnd;
        }
        catch (InvalidOperationException ex)
        {
            StatusMessage = ex.Message;
            return IntPtr.Zero;
        }
        finally
        {
            _launchLock.Release();
        }
    }

    private void CreateProject()
    {
        var name = NewProjectName.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            StatusMessage = "Enter a project name first.";
            return;
        }

        var project = new TerminalProject(name);
        Projects.Add(project);
        SelectedProject = project;
        SelectedTerminal = null;
        NewProjectName = string.Empty;
        SaveProjects();
        StatusMessage = $"Created project '{project.Name}'.";
    }

    private void AddTerminal()
    {
        if (SelectedProject is null)
        {
            StatusMessage = "Select a project before adding a terminal.";
            return;
        }

        var name = NewTerminalName.Trim();
        var workingDirectory = NewTerminalWorkingDirectory.Trim();
        var profileName = NewTerminalProfileName.Trim();

        if (string.IsNullOrWhiteSpace(name))
        {
            StatusMessage = "Enter a terminal name first.";
            return;
        }

        if (!Directory.Exists(workingDirectory))
        {
            StatusMessage = $"The working directory '{workingDirectory}' does not exist.";
            return;
        }

        var terminal = new ManagedTerminalTab(
            SelectedProject.Id,
            SelectedProject.Tabs.Count,
            name,
            workingDirectory,
            string.IsNullOrWhiteSpace(profileName) ? null : profileName);

        SelectedProject.Tabs.Add(terminal);
        SelectedTerminal = terminal;
        NewTerminalName = string.Empty;
        NewTerminalProfileName = string.Empty;
        SaveProjects();
        StatusMessage = $"Added terminal '{terminal.Name}' under '{SelectedProject.Name}'.";
    }

    private void SaveProjects()
    {
        try
        {
            _projectCatalogService.SaveProjects(Projects);
        }
        catch (IOException ex)
        {
            StatusMessage = $"Failed to save Terminal projects: {ex.Message}";
        }
        catch (UnauthorizedAccessException ex)
        {
            StatusMessage = $"Failed to save Terminal projects: {ex.Message}";
        }
    }
}
