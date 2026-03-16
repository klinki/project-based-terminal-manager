using System.Windows;
using TerminalWindowManager.App.ViewModels;
using TerminalWindowManager.Core.Models;
using TerminalWindowManager.Core.Services;
using TerminalWindowManager.Terminal;

namespace TerminalWindowManager.App;

public partial class MainWindow : Window
{
    private readonly MainViewModel _viewModel;

    public MainWindow()
    {
        InitializeComponent();

        var projectCatalogService = new ProjectCatalogService();
        var windowsTerminalService = new WindowsTerminalService();
        ActiveTerminalHost.TerminalService = windowsTerminalService;

        _viewModel = new MainViewModel(projectCatalogService, windowsTerminalService);
        DataContext = _viewModel;
    }

    private async void ProjectTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
    {
        switch (e.NewValue)
        {
            case TerminalProject project:
                _viewModel.SelectedProject = project;
                break;

            case ManagedTerminalTab terminal:
                var hwnd = await _viewModel.ActivateTerminalAsync(terminal);
                if (hwnd != IntPtr.Zero)
                {
                    ActiveTerminalHost.AttachWindow(hwnd);
                    EmptyFrameMessage.Visibility = Visibility.Collapsed;
                }
                break;
        }
    }

    private async void ReloadSelectedTerminal_Click(object sender, RoutedEventArgs e)
    {
        if (_viewModel.SelectedTerminal is null)
        {
            return;
        }

        var hwnd = await _viewModel.ActivateTerminalAsync(_viewModel.SelectedTerminal);
        if (hwnd != IntPtr.Zero)
        {
            ActiveTerminalHost.AttachWindow(hwnd);
            EmptyFrameMessage.Visibility = Visibility.Collapsed;
        }
    }
}
