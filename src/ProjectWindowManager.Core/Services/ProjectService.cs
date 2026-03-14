using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using ProjectWindowManager.Core.Models;

namespace ProjectWindowManager.Core.Services
{
    public class ProjectService
    {
        private readonly string _storagePath;

        public ProjectService()
        {
            _storagePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ProjectWindowManager", "projects.json");
            EnsureDirectoryExists();
        }

        private void EnsureDirectoryExists()
        {
            var directory = Path.GetDirectoryName(_storagePath);
            if (!Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
            }
        }

        public List<Project> LoadProjects()
        {
            if (!File.Exists(_storagePath))
            {
                return new List<Project>();
            }

            try
            {
                var json = File.ReadAllText(_storagePath);
                return JsonSerializer.Deserialize<List<Project>>(json) ?? new List<Project>();
            }
            catch
            {
                return new List<Project>();
            }
        }

        public void SaveProjects(List<Project> projects)
        {
            try
            {
                var json = JsonSerializer.Serialize(projects, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(_storagePath, json);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error saving projects: {ex.Message}");
            }
        }
    }
}
