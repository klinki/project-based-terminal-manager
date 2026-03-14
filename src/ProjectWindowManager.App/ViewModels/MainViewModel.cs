using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ProjectWindowManager.Core.Models;
using ProjectWindowManager.Core.Services;
using ProjectWindowManager.Core.Interfaces;

namespace ProjectWindowManager.App.ViewModels
{
    public class MainViewModel : INotifyPropertyChanged
    {
        private readonly ProjectService _projectService;
        private readonly IWindowManagerService _windowManagerService;
        private Project? _selectedProject;
        private ManagedApplication? _activeApplication;
        private readonly SemaphoreSlim _launchLock = new(1, 1);

        public ObservableCollection<Project> Projects { get; } = new();
        public IntPtr HostHwnd { get; set; } = IntPtr.Zero;

        public Project? SelectedProject
        {
            get => _selectedProject;
            set
            {
                _selectedProject = value;
                OnPropertyChanged();
                // When project changes, clear active application or set to first one
                ActiveApplication = _selectedProject?.Applications.FirstOrDefault();
            }
        }

        public ManagedApplication? ActiveApplication
        {
            get => _activeApplication;
            set
            {
                if (_activeApplication == value) return;
                _activeApplication = value;
                OnPropertyChanged();
            }
        }

        public ICommand CreateProjectCommand { get; }
        public ICommand LaunchAppCommand { get; }
        public ICommand RelaunchAppCommand { get; }
        public ICommand ClearApplicationsCommand { get; }

        public MainViewModel(ProjectService projectService, IWindowManagerService windowManagerService)
        {
            _projectService = projectService;
            _windowManagerService = windowManagerService;

            Projects = new ObservableCollection<Project>(_projectService.LoadProjects());

            CreateProjectCommand = new RelayCommand<string>(CreateProject);
            LaunchAppCommand = new RelayCommand<string>(LaunchApp, _ => SelectedProject != null);
            RelaunchAppCommand = new RelayCommand<ManagedApplication>(RelaunchApp, app => app?.State == ApplicationState.Inactive);
            ClearApplicationsCommand = new RelayCommand<object>(_ => ClearApplications(), _ => SelectedProject != null);
        }

        private void ClearApplications()
        {
            if (SelectedProject == null) return;

            ActiveApplication = null;
            SelectedProject.Applications.Clear();
            SaveAll();
        }

        private async void RelaunchApp(ManagedApplication? app)
        {
            if (app == null || HostHwnd == IntPtr.Zero) return;

            await _launchLock.WaitAsync();
            try
            {
                Console.WriteLine($"[MainViewModel] Relaunching {app.DisplayName}...");
                var hwnd = await _windowManagerService.LaunchAndHost(app.ExecutablePath, HostHwnd);
                if (hwnd != IntPtr.Zero)
                {
                    app.State = ApplicationState.Active;
                    app.LastActiveHwnd = hwnd;
                    ActiveApplication = app;
                    SaveAll();
                }
            }
            finally
            {
                _launchLock.Release();
            }
        }

        private void CreateProject(string? name)
        {
            if (string.IsNullOrWhiteSpace(name)) return;

            var newProject = new Project(name);
            Projects.Add(newProject);
            SaveAll();
            SelectedProject = newProject;
        }

        private async void LaunchApp(string? exePath)
        {
            if (string.IsNullOrWhiteSpace(exePath) || SelectedProject == null || HostHwnd == IntPtr.Zero) return;

            await _launchLock.WaitAsync();
            try
            {
                // 1. Check if already exists in this project
                var existing = SelectedProject.Applications.FirstOrDefault(a => a.ExecutablePath.Equals(exePath, StringComparison.OrdinalIgnoreCase));
                if (existing != null)
                {
                    Console.WriteLine($"[MainViewModel] App already exists: {exePath}");
                    ActiveApplication = existing;
                    if (existing.State == ApplicationState.Inactive)
                    {
                        // We are already inside a lock, so call the inner logic of Relaunch
                        var hwnd = await _windowManagerService.LaunchAndHost(existing.ExecutablePath, HostHwnd);
                        if (hwnd != IntPtr.Zero)
                        {
                            existing.State = ApplicationState.Active;
                            existing.LastActiveHwnd = hwnd;
                            OnPropertyChanged(nameof(ActiveApplication));
                            SaveAll();
                        }
                    }
                    return;
                }

                Console.WriteLine($"[MainViewModel] Launching new app: {exePath}");
                
                // 2. Add to collection immediately
                var app = new ManagedApplication(SelectedProject.Id, exePath, System.IO.Path.GetFileNameWithoutExtension(exePath))
                {
                    State = ApplicationState.Inactive
                };
                SelectedProject.Applications.Add(app);
                ActiveApplication = app;
                SaveAll();

                // 3. Start hosting process asynchronously
                var hwndResult = await _windowManagerService.LaunchAndHost(exePath, HostHwnd);
                
                if (hwndResult != IntPtr.Zero)
                {
                    app.LastActiveHwnd = hwndResult;
                    app.State = ApplicationState.Active;
                    
                    if (ActiveApplication == app)
                    {
                        OnPropertyChanged(nameof(ActiveApplication));
                    }
                    SaveAll();
                }
            }
            finally
            {
                _launchLock.Release();
            }
        }

        public void SaveAll()
        {
            try
            {
                _projectService.SaveProjects(new List<Project>(Projects));
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[MainViewModel] Save failed: {ex.Message}");
            }
        }

        public event PropertyChangedEventHandler? PropertyChanged;

        protected void OnPropertyChanged([CallerMemberName] string? propertyName = null)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }
    }

    public class RelayCommand<T> : ICommand
    {
        private readonly Action<T?> _execute;
        private readonly Predicate<T?>? _canExecute;

        public RelayCommand(Action<T?> execute, Predicate<T?>? canExecute = null)
        {
            _execute = execute ?? throw new ArgumentNullException(nameof(execute));
            _canExecute = canExecute;
        }

        public bool CanExecute(object? parameter) => _canExecute?.Invoke((T?)parameter) ?? true;

        public void Execute(object? parameter) => _execute((T?)parameter);

        public event EventHandler? CanExecuteChanged
        {
            add => CommandManager.RequerySuggested += value;
            remove => CommandManager.RequerySuggested -= value;
        }
    }
}
