use std::env;
use std::path::PathBuf;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalStatus {
    Stopped,
    Starting,
    Running,
    Exited,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalActivityPhase {
    Idle,
    Working,
    Streaming,
    Waiting,
    Attention,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalProgressState {
    None,
    Normal,
    Error,
    Indeterminate,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalActivity {
    pub phase: TerminalActivityPhase,
    pub summary: String,
    pub detail: String,
    pub progress: u32,
    pub is_indeterminate: bool,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProgressInfo {
    pub state: TerminalProgressState,
    pub value: u32,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppDefaults {
    #[serde(default = "default_cwd")]
    pub default_cwd: String,
    #[serde(default = "default_shell")]
    pub default_shell: String,
    #[serde(default)]
    pub custom_shells: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRecord {
    #[serde(default = "new_uuid_string")]
    pub id: String,
    #[serde(default = "default_project_name")]
    pub name: String,
    #[serde(default = "now_iso_string")]
    pub created_at: String,
    #[serde(default)]
    pub default_cwd: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandFailure {
    pub session_id: String,
    pub timestamp: String,
    pub command_text: String,
    pub exit_code: Option<i32>,
    pub error_message: Option<String>,
    pub cwd: String,
    pub recent_output_excerpt: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionFailure {
    pub session_id: String,
    pub timestamp: String,
    pub exit_code: Option<i32>,
    pub message: String,
    pub shell_path: String,
    pub shell_pid: Option<u32>,
    pub stderr_excerpt: Option<String>,
    pub recent_output_excerpt: String,
    pub exception_type: Option<String>,
    pub hresult: Option<i32>,
    pub win32_error_code: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRecord {
    #[serde(default = "new_uuid_string")]
    pub id: String,
    #[serde(default)]
    pub project_id: String,
    #[serde(default = "default_terminal_name")]
    pub name: String,
    #[serde(default = "default_cwd")]
    pub cwd: String,
    #[serde(default = "default_shell")]
    pub shell: String,
    #[serde(default = "default_terminal_status")]
    pub status: TerminalStatus,
    #[serde(default = "default_idle_activity")]
    pub activity: TerminalActivity,
    #[serde(default = "default_progress_info")]
    pub progress_info: TerminalProgressInfo,
    #[serde(default)]
    pub last_exit_code: Option<i32>,
    #[serde(default = "now_iso_string")]
    pub created_at: String,
    #[serde(default)]
    pub last_started_at: Option<String>,
    #[serde(default)]
    pub diagnostic_log_path: Option<String>,
    #[serde(default)]
    pub last_command_failure: Option<TerminalCommandFailure>,
    #[serde(default)]
    pub last_session_failure: Option<TerminalSessionFailure>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppState {
    #[serde(default)]
    pub defaults: AppDefaults,
    #[serde(default)]
    pub projects: Vec<ProjectRecord>,
    #[serde(default)]
    pub terminals: Vec<TerminalRecord>,
    #[serde(default)]
    pub active_terminal_id: Option<String>,
}

impl AppState {
    pub fn create_initial() -> Self {
        Self {
            defaults: AppDefaults::default(),
            projects: Vec::new(),
            terminals: Vec::new(),
            active_terminal_id: None,
        }
    }

    pub fn persistent_snapshot(&self) -> Self {
        let mut snapshot = self.clone();
        for terminal in &mut snapshot.terminals {
            terminal.activity = TerminalActivity::for_status(terminal.status);
            terminal.progress_info = TerminalProgressInfo::none();
        }

        snapshot
    }

    pub fn normalize_loaded_state(&mut self) {
        if self.defaults.default_cwd.trim().is_empty() {
            self.defaults.default_cwd = default_cwd();
        }
        if self.defaults.default_shell.trim().is_empty() {
            self.defaults.default_shell = default_shell();
        }
        self.defaults.custom_shells = normalize_custom_shells(
            std::mem::take(&mut self.defaults.custom_shells),
            Some(&self.defaults.default_shell),
        );

        for project in &mut self.projects {
            if project.id.trim().is_empty() {
                project.id = new_uuid_string();
            }
            if project.name.trim().is_empty() {
                project.name = default_project_name();
            }
            if project.created_at.trim().is_empty() {
                project.created_at = now_iso_string();
            }
            if project
                .default_cwd
                .as_ref()
                .is_some_and(|cwd| cwd.trim().is_empty())
            {
                project.default_cwd = None;
            }
        }

        for terminal in &mut self.terminals {
            if terminal.id.trim().is_empty() {
                terminal.id = new_uuid_string();
            }
            if terminal.name.trim().is_empty() {
                terminal.name = default_terminal_name();
            }
            if terminal.cwd.trim().is_empty() {
                terminal.cwd = default_cwd();
            }
            if terminal.shell.trim().is_empty() {
                terminal.shell = default_shell();
            }
            if terminal.created_at.trim().is_empty() {
                terminal.created_at = now_iso_string();
            }

            if matches!(
                terminal.status,
                TerminalStatus::Running | TerminalStatus::Starting
            ) {
                terminal.status = TerminalStatus::Stopped;
            }
            terminal.activity = TerminalActivity::for_status(terminal.status);
            terminal.progress_info = TerminalProgressInfo::none();
        }

        self.active_terminal_id = None;
    }
}

impl Default for AppDefaults {
    fn default() -> Self {
        Self {
            default_cwd: default_cwd(),
            default_shell: default_shell(),
            custom_shells: Vec::new(),
        }
    }
}

impl TerminalActivity {
    pub fn for_status(status: TerminalStatus) -> Self {
        let now = now_iso_string();
        match status {
            TerminalStatus::Starting => Self {
                phase: TerminalActivityPhase::Working,
                summary: "Starting session".to_string(),
                detail: "Launching terminal helper process.".to_string(),
                progress: 12,
                is_indeterminate: true,
                updated_at: now,
            },
            TerminalStatus::Running => Self {
                phase: TerminalActivityPhase::Waiting,
                summary: "Ready".to_string(),
                detail: "Shell is running and waiting for input.".to_string(),
                progress: 100,
                is_indeterminate: false,
                updated_at: now,
            },
            TerminalStatus::Error => Self {
                phase: TerminalActivityPhase::Attention,
                summary: "Error".to_string(),
                detail: "The session reported an error.".to_string(),
                progress: 100,
                is_indeterminate: false,
                updated_at: now,
            },
            TerminalStatus::Exited => Self {
                phase: TerminalActivityPhase::Idle,
                summary: "Exited".to_string(),
                detail: "The session is no longer running.".to_string(),
                progress: 100,
                is_indeterminate: false,
                updated_at: now,
            },
            TerminalStatus::Stopped => Self {
                phase: TerminalActivityPhase::Idle,
                summary: "Not started".to_string(),
                detail: "Activate this terminal to start a live session.".to_string(),
                progress: 0,
                is_indeterminate: false,
                updated_at: now,
            },
        }
    }
}

impl TerminalProgressInfo {
    pub fn none() -> Self {
        Self {
            state: TerminalProgressState::None,
            value: 0,
            updated_at: now_iso_string(),
        }
    }
}

impl Default for TerminalActivity {
    fn default() -> Self {
        Self::for_status(TerminalStatus::Stopped)
    }
}

fn default_terminal_status() -> TerminalStatus {
    TerminalStatus::Stopped
}

fn default_idle_activity() -> TerminalActivity {
    TerminalActivity::for_status(TerminalStatus::Stopped)
}

fn default_progress_info() -> TerminalProgressInfo {
    TerminalProgressInfo::none()
}

fn default_project_name() -> String {
    "Untitled Project".to_string()
}

fn default_terminal_name() -> String {
    "Terminal".to_string()
}

fn default_cwd() -> String {
    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .display()
        .to_string()
}

fn default_shell() -> String {
    #[cfg(windows)]
    {
        return "powershell.exe".to_string();
    }

    #[cfg(not(windows))]
    {
        env::var("SHELL")
            .or_else(|_| env::var("COMSPEC"))
            .unwrap_or_else(|_| "sh".to_string())
    }
}

fn normalize_custom_shells(shells: Vec<String>, current_default_shell: Option<&str>) -> Vec<String> {
    let mut normalized = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Some(default_shell) = current_default_shell {
        push_custom_shell(&mut normalized, &mut seen, default_shell);
    }

    for shell in shells {
        push_custom_shell(&mut normalized, &mut seen, &shell);
    }

    normalized
}

fn push_custom_shell(
    normalized: &mut Vec<String>,
    seen: &mut std::collections::HashSet<String>,
    shell: &str,
) {
    let trimmed = shell.trim();
    if trimmed.is_empty() || is_builtin_shell(trimmed) {
        return;
    }

    let key = trimmed.to_ascii_lowercase();
    if seen.insert(key) {
        normalized.push(trimmed.to_string());
    }
}

fn is_builtin_shell(shell: &str) -> bool {
    matches!(shell.trim().to_ascii_lowercase().as_str(), "pwsh" | "pwsh.exe" | "cmd" | "cmd.exe")
}

fn new_uuid_string() -> String {
    Uuid::new_v4().to_string()
}

fn now_iso_string() -> String {
    Utc::now().to_rfc3339()
}
