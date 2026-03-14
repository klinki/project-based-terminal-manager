using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace ProjectWindowManager.Core.Models
{
    public enum ApplicationState
    {
        Active,
        Inactive
    }

    public class ManagedApplication : INotifyPropertyChanged
    {
        private ApplicationState _state = ApplicationState.Inactive;
        private IntPtr _lastActiveHwnd = IntPtr.Zero;

        public Guid Id { get; init; } = Guid.NewGuid();
        public Guid ProjectId { get; init; }
        public string ExecutablePath { get; init; } = string.Empty;
        public string DisplayName { get; init; } = string.Empty;

        public ApplicationState State
        {
            get => _state;
            set
            {
                _state = value;
                OnPropertyChanged();
            }
        }

        [System.Text.Json.Serialization.JsonIgnore]
        public IntPtr LastActiveHwnd
        {
            get => _lastActiveHwnd;
            set
            {
                _lastActiveHwnd = value;
                OnPropertyChanged();
            }
        }

        public ManagedApplication() { }

        public ManagedApplication(Guid projectId, string executablePath, string displayName)
        {
            ProjectId = projectId;
            ExecutablePath = executablePath;
            DisplayName = displayName;
        }

        public event PropertyChangedEventHandler? PropertyChanged;
        protected void OnPropertyChanged([CallerMemberName] string? propertyName = null)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }
    }

    public class Project : INotifyPropertyChanged
    {
        public Guid Id { get; init; } = Guid.NewGuid();
        public string Name { get; init; } = string.Empty;
        public ObservableCollection<ManagedApplication> Applications { get; init; } = new();

        public Project() { }

        public Project(string name)
        {
            Name = name;
        }

        public event PropertyChangedEventHandler? PropertyChanged;
        protected void OnPropertyChanged([CallerMemberName] string? propertyName = null)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }
    }
}
