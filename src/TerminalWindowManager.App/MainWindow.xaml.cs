using System.Windows;
using TerminalWindowManager.App.ViewModels;
using TerminalWindowManager.Core.Services;
using TerminalWindowManager.Terminal;

namespace TerminalWindowManager.App;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();

        var projectCatalogService = new ProjectCatalogService();
        var windowsTerminalService = new WindowsTerminalService();
        DataContext = new MainViewModel(projectCatalogService, windowsTerminalService);
    }
}
