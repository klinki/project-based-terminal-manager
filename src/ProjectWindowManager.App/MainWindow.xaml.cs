using System;
using System.Windows;
using System.Threading.Tasks;
using Microsoft.Win32;
using ProjectWindowManager.App.ViewModels;
using ProjectWindowManager.Core.Models;
using ProjectWindowManager.Core.Interfaces;
using ProjectWindowManager.Core.Services;
using ProjectWindowManager.Win32;
using ProjectWindowManager.App.Controls;

namespace ProjectWindowManager.App
{
    public partial class MainWindow : Window
    {
        private readonly IWindowManagerService _windowManagerService;

        public MainWindow()
        {
            InitializeComponent();
            
            _windowManagerService = new WindowManagerService();
            var projectService = new ProjectService();
            var vm = new MainViewModel(projectService, _windowManagerService);
            vm.PropertyChanged += Vm_PropertyChanged;
            DataContext = vm;

            // Ensure the VM knows about our host container
            this.Loaded += (s, e) => {
                vm.HostHwnd = ActiveWindowHost.Handle;
            };
        }

        private async void Vm_PropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
        {
            if (e.PropertyName == nameof(MainViewModel.ActiveApplication))
            {
                await SwitchActiveWindow();
            }
        }

        private async Task SwitchActiveWindow()
        {
            var vm = (MainViewModel)DataContext;
            
            // Give a tiny bit of time for windows to settle if just launched
            await Task.Delay(150);

            if (vm.ActiveApplication?.State == ApplicationState.Active && vm.ActiveApplication.LastActiveHwnd != IntPtr.Zero)
            {
                Console.WriteLine($"[MainWindow] Switching to HWND {vm.ActiveApplication.LastActiveHwnd}");
                ActiveWindowHost.AttachWindow(vm.ActiveApplication.LastActiveHwnd);
            }
            else
            {
                ActiveWindowHost.AttachWindow(IntPtr.Zero);
            }
        }

        private void LaunchApp_Click(object sender, RoutedEventArgs e)
        {
            var openFileDialog = new Microsoft.Win32.OpenFileDialog
            {
                Filter = "Executables (*.exe)|*.exe|All files (*.*)|*.*"
            };

            if (openFileDialog.ShowDialog() == true)
            {
                var vm = (MainViewModel)DataContext;
                vm.LaunchAppCommand.Execute(openFileDialog.FileName);
            }
        }
    }
}
