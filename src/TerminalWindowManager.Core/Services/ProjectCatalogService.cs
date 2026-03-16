using System.Text.Json;
using TerminalWindowManager.Core.Models;

namespace TerminalWindowManager.Core.Services;

public sealed class ProjectCatalogService
{
    private readonly JsonSerializerOptions _serializerOptions = new()
    {
        WriteIndented = true
    };

    private readonly string _storagePath;

    public ProjectCatalogService()
    {
        _storagePath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "TerminalWindowManager",
            "projects.json");

        var directory = Path.GetDirectoryName(_storagePath)
                        ?? throw new InvalidOperationException("Unable to determine the TerminalWindowManager storage directory.");

        Directory.CreateDirectory(directory);
    }

    public List<TerminalProject> LoadProjects()
    {
        if (!File.Exists(_storagePath))
        {
            return [];
        }

        try
        {
            var json = File.ReadAllText(_storagePath);
            return JsonSerializer.Deserialize<List<TerminalProject>>(json, _serializerOptions) ?? [];
        }
        catch (IOException ex)
        {
            Console.WriteLine($"[ProjectCatalogService] Failed to read {_storagePath}: {ex.Message}");
            return [];
        }
        catch (JsonException ex)
        {
            Console.WriteLine($"[ProjectCatalogService] Failed to parse {_storagePath}: {ex.Message}");
            return [];
        }
    }

    public void SaveProjects(IEnumerable<TerminalProject> projects)
    {
        var json = JsonSerializer.Serialize(projects, _serializerOptions);
        File.WriteAllText(_storagePath, json);
    }
}
