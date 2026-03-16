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
    private ManagedTerminalTab? _selectedTab;
    private string _newProjectName = string.Empty;
    private string _newTabName = string.Empty;
    private string _newTabWorkingDirectory;
    private string _newTabProfileName = string.Empty;
    private string _statusMessage = "Create a project, add one or more tab definitions, then launch them into a named Windows Terminal window.";

    public ObservableCollection<TerminalProject> Projects { get; }

    public TerminalProject? SelectedProject
    {
        get => _selectedProject;
        set
        {
            if (!SetProperty(ref _selectedProject, value))
            {
                return;
            }

            SelectedTab = value?.Tabs.OrderBy(tab => tab.TabIndex).FirstOrDefault();
        }
    }

    public ManagedTerminalTab? SelectedTab
    {
        get => _selectedTab;
        set => SetProperty(ref _selectedTab, value);
    }

    public string NewProjectName
    {
        get => _newProjectName;
        set => SetProperty(ref _newProjectName, value);
    }

    public string NewTabName
    {
        get => _newTabName;
        set => SetProperty(ref _newTabName, value);
    }

    public string NewTabWorkingDirectory
    {
        get => _newTabWorkingDirectory;
        set => SetProperty(ref _newTabWorkingDirectory, value);
    }

    public string NewTabProfileName
    {
        get => _newTabProfileName;
        set => SetProperty(ref _newTabProfileName, value);
    }

    public string StatusMessage
    {
        get => _statusMessage;
        set => SetProperty(ref _statusMessage, value);
    }

    public ICommand CreateProjectCommand { get; }
    public ICommand AddTabCommand { get; }
    public ICommand LaunchProjectWindowCommand { get; }
    public ICommand FocusProjectWindowCommand { get; }
    public ICommand LaunchSelectedTabCommand { get; }
    public ICommand LaunchAllTabsCommand { get; }

    public MainViewModel(ProjectCatalogService projectCatalogService, IWindowsTerminalService windowsTerminalService)
    {
        _projectCatalogService = projectCatalogService;
        _windowsTerminalService = windowsTerminalService;
        _newTabWorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        Projects = new ObservableCollection<TerminalProject>(_projectCatalogService.LoadProjects());

        CreateProjectCommand = new RelayCommand(CreateProject, () => !string.IsNullOrWhiteSpace(NewProjectName));
        AddTabCommand = new RelayCommand(AddTab, () => SelectedProject is not null && !string.IsNullOrWhiteSpace(NewTabName) && !string.IsNullOrWhiteSpace(NewTabWorkingDirectory));
        LaunchProjectWindowCommand = new RelayCommand(LaunchProjectWindow, () => SelectedProject is not null);
        FocusProjectWindowCommand = new RelayCommand(FocusProjectWindow, () => SelectedProject is not null);
        LaunchSelectedTabCommand = new RelayCommand(LaunchSelectedTab, () => SelectedProject is not null && SelectedTab is not null);
        LaunchAllTabsCommand = new RelayCommand(LaunchAllTabs, () => SelectedProject is not null && SelectedProject.Tabs.Count > 0);

        SelectedProject = Projects.FirstOrDefault();
    }

    protected override void OnPropertyChanged(string? propertyName = null)
    {
        base.OnPropertyChanged(propertyName);
        CommandManager.InvalidateRequerySuggested();
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
        NewProjectName = string.Empty;
        SaveProjects();
        StatusMessage = $"Created '{project.Name}' with window target '{project.WindowTarget}'.";
    }

    private void AddTab()
    {
        if (SelectedProject is null)
        {
            StatusMessage = "Select a project before adding a tab.";
            return;
        }

        var name = NewTabName.Trim();
        var workingDirectory = NewTabWorkingDirectory.Trim();
        var profileName = NewTabProfileName.Trim();

        if (string.IsNullOrWhiteSpace(name))
        {
            StatusMessage = "Enter a tab name first.";
            return;
        }

        if (!Directory.Exists(workingDirectory))
        {
            StatusMessage = $"The working directory '{workingDirectory}' does not exist.";
            return;
        }

        var tab = new ManagedTerminalTab(
            SelectedProject.Id,
            SelectedProject.Tabs.Count,
            name,
            workingDirectory,
            string.IsNullOrWhiteSpace(profileName) ? null : profileName);

        SelectedProject.Tabs.Add(tab);
        SelectedTab = tab;
        NewTabName = string.Empty;
        NewTabProfileName = string.Empty;
        SaveProjects();
        StatusMessage = $"Added '{tab.Name}' to '{SelectedProject.Name}'.";
    }

    private async void LaunchProjectWindow()
    {
        if (SelectedProject is null)
        {
            StatusMessage = "Select a project before launching it.";
            return;
        }

        await LaunchAsync(async cancellationToken =>
        {
            var hwnd = await _windowsTerminalService.LaunchProjectWindowAsync(SelectedProject, cancellationToken);
            StatusMessage = hwnd != IntPtr.Zero
                ? $"Launched '{SelectedProject.Name}'. Focus will work while this app remembers the window handle."
                : $"Launched '{SelectedProject.Name}', but could not capture the native window handle.";
        });
    }

    private void FocusProjectWindow()
    {
        if (SelectedProject is null)
        {
            StatusMessage = "Select a project before focusing it.";
            return;
        }

        if (_windowsTerminalService.TryFocusProjectWindow(SelectedProject))
        {
            StatusMessage = $"Focused the Windows Terminal window for '{SelectedProject.Name}'.";
        }
        else
        {
            StatusMessage = $"Could not find an open Windows Terminal window for '{SelectedProject.Name}'. Launch it again from this app first.";
        }
    }

    private async void LaunchSelectedTab()
    {
        if (SelectedProject is null || SelectedTab is null)
        {
            StatusMessage = "Select a project tab before launching it.";
            return;
        }

        await LaunchAsync(async cancellationToken =>
        {
            var hwnd = await _windowsTerminalService.LaunchTabAsync(SelectedProject, SelectedTab, cancellationToken);
            StatusMessage = hwnd != IntPtr.Zero
                ? $"Launched '{SelectedTab.Name}' into '{SelectedProject.Name}'."
                : $"Launched '{SelectedTab.Name}', but window handle capture was inconclusive.";

            SaveProjects();
        });
    }

    private async void LaunchAllTabs()
    {
        if (SelectedProject is null)
        {
            StatusMessage = "Select a project before launching its tabs.";
            return;
        }

        if (SelectedProject.Tabs.Count == 0)
        {
            StatusMessage = "Add at least one configured tab before launching the project window.";
            return;
        }

        await LaunchAsync(async cancellationToken =>
        {
            foreach (var tab in SelectedProject.Tabs.OrderBy(tab => tab.TabIndex))
            {
                await _windowsTerminalService.LaunchTabAsync(SelectedProject, tab, cancellationToken);
                await Task.Delay(200, cancellationToken);
            }

            SaveProjects();
            StatusMessage = $"Opened {SelectedProject.Tabs.Count} tab(s) for '{SelectedProject.Name}'. This proof of concept appends tabs; close the project window to reset its layout.";
        });
    }

    private async Task LaunchAsync(Func<CancellationToken, Task> action)
    {
        await _launchLock.WaitAsync();
        try
        {
            await action(CancellationToken.None);
        }
        catch (InvalidOperationException ex)
        {
            StatusMessage = ex.Message;
        }
        finally
        {
            _launchLock.Release();
        }
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
