using System;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;
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

        public ObservableCollection<Project> Projects { get; } = new();

        public Project? SelectedProject
        {
            get => _selectedProject;
            set
            {
                _selectedProject = value;
                OnPropertyChanged();
                // When project changes, clear active application or set to first one
                ActiveApplication = _selectedProject?.Applications.Count > 0 ? _selectedProject.Applications[0] : null;
            }
        }

        public ManagedApplication? ActiveApplication
        {
            get => _activeApplication;
            set
            {
                _activeApplication = value;
                OnPropertyChanged();
            }
        }

        public ICommand CreateProjectCommand { get; }
        public ICommand LaunchAppCommand { get; }
        public ICommand RelaunchAppCommand { get; }

        public MainViewModel(ProjectService projectService, IWindowManagerService windowManagerService)
        {
            _projectService = projectService;
            _windowManagerService = windowManagerService;

            Projects = new ObservableCollection<Project>(_projectService.LoadProjects());

            CreateProjectCommand = new RelayCommand<string>(CreateProject);
            LaunchAppCommand = new RelayCommand<string>(LaunchApp, _ => SelectedProject != null);
            RelaunchAppCommand = new RelayCommand<ManagedApplication>(RelaunchApp, app => app?.State == ApplicationState.Inactive);
        }

        private async void RelaunchApp(ManagedApplication? app)
        {
            if (app == null) return;

            try
            {
                var hwnd = await _windowManagerService.LaunchAndHost(app.ExecutablePath, IntPtr.Zero);
                app.State = ApplicationState.Active;
                app.LastActiveHwnd = hwnd;
                ActiveApplication = app;
                SaveAll();
            }
            catch
            {
                // Handle failure
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
            if (string.IsNullOrWhiteSpace(exePath) || SelectedProject == null) return;

            // 1. Add to collection immediately
            var app = new ManagedApplication(SelectedProject.Id, exePath, System.IO.Path.GetFileNameWithoutExtension(exePath))
            {
                State = ApplicationState.Inactive // Initially inactive
            };
            SelectedProject.Applications.Add(app);
            ActiveApplication = app;
            SaveAll();

            try
            {
                // 2. Start hosting process asynchronously
                var hwnd = await _windowManagerService.LaunchAndHost(exePath, IntPtr.Zero);
                
                if (hwnd != IntPtr.Zero)
                {
                    app.LastActiveHwnd = hwnd;
                    app.State = ApplicationState.Active;
                    
                    // Trigger a refresh of the ActiveApplication property to update the UI
                    if (ActiveApplication == app)
                    {
                        OnPropertyChanged(nameof(ActiveApplication));
                    }
                    SaveAll();
                }
            }
            catch (Exception)
            {
                // Handle or log error
            }
        }

        public void SaveAll()
        {
            _projectService.SaveProjects(new List<Project>(Projects));
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
