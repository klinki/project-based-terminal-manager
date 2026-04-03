use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::diagnostics::{
    append_output_chunk,
    create_power_shell_bootstrap_script,
    create_recent_output_excerpt,
    create_session_diagnostics_paths,
    SessionDiagnosticsPaths,
};
use crate::models::{
    AppState,
    ProjectRecord,
    TerminalActivity,
    TerminalActivityPhase,
    TerminalRecord,
    TerminalSessionFailure,
    TerminalStatus,
};

const INPUT_SETTLE_MS: u64 = 1100;
const OUTPUT_SETTLE_MS: u64 = 1600;
const MAX_HELPER_STDERR_LINES: usize = 40;

#[derive(Debug, Clone)]
pub struct AppStateStore {
    metadata_path: PathBuf,
}

impl AppStateStore {
    pub fn new(metadata_path: PathBuf) -> Self {
        Self { metadata_path }
    }

    pub fn load(&self) -> Result<AppState, String> {
        if !self.metadata_path.exists() {
            return Ok(AppState::create_initial());
        }

        let raw_json = fs::read_to_string(&self.metadata_path).map_err(|error| error.to_string())?;
        let mut state = serde_json::from_str::<AppState>(&raw_json)
            .unwrap_or_else(|_| AppState::create_initial());
        state.normalize_loaded_state();
        Ok(state)
    }

    pub fn save(&self, state: &AppState) -> Result<(), String> {
        if let Some(parent) = self.metadata_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let payload = serde_json::to_string_pretty(&state.persistent_snapshot())
            .map_err(|error| error.to_string())?;
        fs::write(&self.metadata_path, payload).map_err(|error| error.to_string())
    }
}

#[derive(Debug, Clone)]
pub struct SessionManager {
    app_handle: AppHandle,
    state_store: Arc<AppStateStore>,
    state: Arc<Mutex<AppState>>,
    sessions: Arc<Mutex<HashMap<String, Arc<Mutex<LiveSession>>>>>,
    activity_tokens: Arc<Mutex<HashMap<String, u64>>>,
    app_data_dir: PathBuf,
    helper_path: PathBuf,
    helper_candidates: Vec<PathBuf>,
}

impl SessionManager {
    pub fn new(app_handle: AppHandle, metadata_path: PathBuf) -> Result<Self, String> {
        let state_store = Arc::new(AppStateStore::new(metadata_path.clone()));
        let mut state = state_store.load()?;
        state.normalize_loaded_state();

        let app_data_dir = metadata_path
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| "Unable to resolve the Tauri app data directory.".to_string())?;

        let helper_candidates = Self::create_helper_path_candidates();
        let helper_path = helper_candidates
            .iter()
            .find(|candidate| candidate.exists())
            .cloned()
            .unwrap_or_else(|| helper_candidates[0].clone());

        Ok(Self {
            app_handle,
            state_store,
            state: Arc::new(Mutex::new(state)),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            activity_tokens: Arc::new(Mutex::new(HashMap::new())),
            app_data_dir,
            helper_path,
            helper_candidates,
        })
    }

    pub fn get_initial_state(&self) -> AppState {
        self.snapshot_state()
    }

    pub fn create_project(&self, name: String) -> Result<AppState, String> {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err("Project name cannot be empty.".to_string());
        }

        {
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            state.projects.push(ProjectRecord {
                id: new_uuid_string(),
                name: trimmed_name.to_string(),
                created_at: now_iso_string(),
            });
        }

        self.persist_and_emit_state()?;
        Ok(self.snapshot_state())
    }

    pub fn rename_project(&self, project_id: String, name: String) -> Result<AppState, String> {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err("Project name cannot be empty.".to_string());
        }

        {
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            let project = Self::find_project_mut(&mut state, &project_id)?;
            project.name = trimmed_name.to_string();
        }

        self.persist_and_emit_state()?;
        Ok(self.snapshot_state())
    }

    pub fn delete_project(&self, project_id: String) -> Result<AppState, String> {
        let project_terminals = {
            let state = self.state.lock().map_err(|error| error.to_string())?;
            let project = Self::find_project(&state, &project_id)?;
            state
                .terminals
                .iter()
                .filter(|terminal| terminal.project_id == project.id)
                .map(|terminal| terminal.id.clone())
                .collect::<Vec<String>>()
        };

        for terminal_id in project_terminals {
            self.stop_terminal(terminal_id)?;
        }

        {
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            state.projects.retain(|project| project.id != project_id);
            state.terminals.retain(|terminal| terminal.project_id != project_id);
            if state.active_terminal_id.as_ref().is_some_and(|active_terminal_id| {
                !state.terminals.iter().any(|terminal| terminal.id == *active_terminal_id)
            }) {
                state.active_terminal_id = None;
            }
        }

        self.persist_and_emit_state()?;
        Ok(self.snapshot_state())
    }

    pub fn create_terminal(
        &self,
        project_id: String,
        name: String,
        cwd: String,
        shell: Option<String>,
    ) -> Result<AppState, String> {
        let trimmed_name = name.trim();
        let trimmed_cwd = cwd.trim();
        if trimmed_name.is_empty() {
            return Err("Terminal name cannot be empty.".to_string());
        }
        if trimmed_cwd.is_empty() {
            return Err("Terminal working directory cannot be empty.".to_string());
        }

        let (project_id, default_shell) = {
            let state = self.state.lock().map_err(|error| error.to_string())?;
            let project = Self::find_project(&state, &project_id)?;
            (project.id.clone(), state.defaults.default_shell.clone())
        };

        {
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            state.terminals.push(TerminalRecord {
                id: new_uuid_string(),
                project_id,
                name: trimmed_name.to_string(),
                cwd: trimmed_cwd.to_string(),
                shell: shell
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or(default_shell),
                status: TerminalStatus::Stopped,
                activity: TerminalActivity::for_status(TerminalStatus::Stopped),
                last_exit_code: None,
                created_at: now_iso_string(),
                last_started_at: None,
                diagnostic_log_path: None,
                last_command_failure: None,
                last_session_failure: None,
            });
        }

        self.persist_and_emit_state()?;
        Ok(self.snapshot_state())
    }

    pub fn rename_terminal(&self, terminal_id: String, name: String) -> Result<AppState, String> {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err("Terminal name cannot be empty.".to_string());
        }

        {
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            let terminal = Self::find_terminal_mut(&mut state, &terminal_id)?;
            terminal.name = trimmed_name.to_string();
        }

        self.persist_and_emit_state()?;
        Ok(self.snapshot_state())
    }

    pub fn delete_terminal(&self, terminal_id: String) -> Result<AppState, String> {
        self.stop_terminal(terminal_id.clone())?;

        {
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            state.terminals.retain(|terminal| terminal.id != terminal_id);
            if state.active_terminal_id.as_ref() == Some(&terminal_id) {
                state.active_terminal_id = None;
            }
        }

        self.persist_and_emit_state()?;
        Ok(self.snapshot_state())
    }

    pub fn activate_terminal(
        &self,
        terminal_id: String,
        cols: u32,
        rows: u32,
    ) -> Result<AppState, String> {
        {
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            state.active_terminal_id = Some(terminal_id.clone());
        }

        self.ensure_session(&terminal_id, cols, rows)?;
        Ok(self.snapshot_state())
    }

    pub fn send_input(&self, terminal_id: String, data: String) -> Result<Value, String> {
        let input_activity = describe_input_activity(&data);
        self.update_terminal_activity(
            &terminal_id,
            TerminalActivityPhase::Working,
            input_activity.0,
            input_activity.1,
            input_activity.2,
            true,
        )?;

        self.schedule_terminal_activity(
            terminal_id.clone(),
            INPUT_SETTLE_MS,
            TerminalActivityPhase::Waiting,
            "Waiting for output".to_string(),
            "The shell accepted input and is waiting to respond.".to_string(),
            52,
            true,
        );

        let session = self.get_session(&terminal_id)?;
        let stdin = {
            let session_guard = session.lock().map_err(|error| error.to_string())?;
            session_guard.stdin.clone()
        };

        {
            let mut stdin = stdin.lock().map_err(|error| error.to_string())?;
            stdin
                .write_all(format!("{}\n", serde_json::json!({"type": "input", "data": data})).as_bytes())
                .map_err(|error| error.to_string())?;
            stdin.flush().map_err(|error| error.to_string())?;
        }

        Ok(serde_json::json!({ "ok": true }))
    }

    pub fn resize_terminal(&self, terminal_id: String, cols: u32, rows: u32) -> Result<Value, String> {
        let session = self.get_session(&terminal_id)?;
        let stdin = {
            let session_guard = session.lock().map_err(|error| error.to_string())?;
            session_guard.stdin.clone()
        };

        {
            let mut stdin = stdin.lock().map_err(|error| error.to_string())?;
            stdin
                .write_all(format!("{}\n", serde_json::json!({"type": "resize", "cols": cols.max(20), "rows": rows.max(5)})).as_bytes())
                .map_err(|error| error.to_string())?;
            stdin.flush().map_err(|error| error.to_string())?;
        }

        Ok(serde_json::json!({ "ok": true }))
    }

    pub fn restart_terminal(
        &self,
        terminal_id: String,
        cols: u32,
        rows: u32,
    ) -> Result<AppState, String> {
        self.stop_terminal(terminal_id.clone())?;

        {
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            let terminal = Self::find_terminal_mut(&mut state, &terminal_id)?;
            terminal.status = TerminalStatus::Stopped;
            terminal.activity = TerminalActivity::for_status(TerminalStatus::Stopped);
            terminal.last_exit_code = None;
        }

        self.persist_and_emit_state()?;
        self.ensure_session(&terminal_id, cols, rows)?;
        Ok(self.snapshot_state())
    }

    pub fn stop_terminal(&self, terminal_id: String) -> Result<(), String> {
        let session = {
            let sessions = self.sessions.lock().map_err(|error| error.to_string())?;
            sessions.get(&terminal_id).cloned()
        };

        let Some(session) = session else {
            return Ok(());
        };

        {
            let mut live_session = session.lock().map_err(|error| error.to_string())?;
            live_session.is_stopping = true;
            if let Ok(mut stdin) = live_session.stdin.lock() {
                let _ = stdin.write_all(b"{\"type\":\"shutdown\"}\n");
                let _ = stdin.flush();
            }
            let child_lock = live_session.child.lock();
            if let Ok(mut child) = child_lock {
                let _ = child.kill();
            }
        }

        self.cleanup_session(&terminal_id);
        Ok(())
    }

    pub fn stop_all_sessions(&self) -> Result<(), String> {
        let terminal_ids = {
            let sessions = self.sessions.lock().map_err(|error| error.to_string())?;
            sessions.keys().cloned().collect::<Vec<String>>()
        };

        for terminal_id in terminal_ids {
            let _ = self.stop_terminal(terminal_id);
        }

        Ok(())
    }

    fn ensure_session(&self, terminal_id: &str, cols: u32, rows: u32) -> Result<(), String> {
        let existing_session = {
            let sessions = self.sessions.lock().map_err(|error| error.to_string())?;
            sessions.get(terminal_id).cloned()
        };

        if existing_session.is_some() {
            let should_resize = {
                let state = self.state.lock().map_err(|error| error.to_string())?;
                state
                    .terminals
                    .iter()
                    .find(|terminal| terminal.id == terminal_id)
                    .map(|terminal| !matches!(terminal.status, TerminalStatus::Exited | TerminalStatus::Error))
                    .unwrap_or(false)
            };

            if should_resize {
                return self.resize_terminal(terminal_id.to_string(), cols, rows).map(|_| ());
            }
        }
        let terminal_snapshot = {
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            let terminal = Self::find_terminal_mut(&mut state, terminal_id)?;
            let session_id = new_uuid_string();
            let diagnostics_paths = create_session_diagnostics_paths(&self.app_data_dir, terminal_id, &session_id)
                .map_err(|error| error.to_string())?;
            let power_shell_bootstrap_path = if self.is_power_shell_shell(&terminal.shell) {
                let script = create_power_shell_bootstrap_script(terminal_id, &session_id, &diagnostics_paths.events_path);
                fs::write(&diagnostics_paths.power_shell_bootstrap_path, script)
                    .map_err(|error| error.to_string())?;
                Some(diagnostics_paths.power_shell_bootstrap_path.clone())
            } else {
                None
            };

            terminal.status = TerminalStatus::Starting;
            terminal.activity = TerminalActivity::for_status(TerminalStatus::Starting);
            terminal.last_started_at = Some(now_iso_string());
            terminal.last_exit_code = None;
            terminal.diagnostic_log_path = Some(diagnostics_paths.events_path.display().to_string());
            terminal.last_command_failure = None;
            terminal.last_session_failure = None;

            TerminalLaunchContext {
                session_id,
                diagnostics_paths,
                power_shell_bootstrap_path,
                terminal: terminal.clone(),
            }
        };

        {
            let state = self.state.lock().map_err(|error| error.to_string())?;
            self.persist_state_inner(&state)?;
            self.emit_state_changed_snapshot(state.clone());
        }

        self.spawn_session(terminal_snapshot, cols, rows)?;
        Ok(())
    }
    fn spawn_session(&self, context: TerminalLaunchContext, cols: u32, rows: u32) -> Result<(), String> {
        if !self.helper_path.exists() {
            return Err(format!(
                "ConPTY host executable was not found. Checked: {}",
                self.helper_candidates
                    .iter()
                    .map(|candidate| candidate.display().to_string())
                    .collect::<Vec<String>>()
                    .join(", ")
            ));
        }

        let mut command = Command::new(&self.helper_path);
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .args([
                "--cwd",
                &context.terminal.cwd,
                "--shell",
                &context.terminal.shell,
                "--cols",
                &cols.max(20).to_string(),
                "--rows",
                &rows.max(5).to_string(),
                "--session-id",
                &context.session_id,
                "--events-path",
                &context.diagnostics_paths.events_path.display().to_string(),
            ]);

        if let Some(power_shell_bootstrap_path) = &context.power_shell_bootstrap_path {
            command.args(["--powershell-bootstrap", &power_shell_bootstrap_path.display().to_string()]);
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command.spawn().map_err(|error| error.to_string())?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "The ConPTY helper did not expose stdin.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "The ConPTY helper did not expose stdout.".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "The ConPTY helper did not expose stderr.".to_string())?;

        let live_session = Arc::new(Mutex::new(LiveSession {
            session_id: context.session_id.clone(),
            child: Arc::new(Mutex::new(child)),
            stdin: Arc::new(Mutex::new(stdin)),
            recent_output_lines: Vec::new(),
            pending_output_line: String::new(),
            helper_stderr_lines: Vec::new(),
            pending_helper_stderr_line: String::new(),
            is_stopping: false,
            closed: false,
            received_started_event: false,
            received_exit_event: false,
            received_error_event: false,
        }));

        {
            let mut sessions = self.sessions.lock().map_err(|error| error.to_string())?;
            sessions.insert(context.terminal.id.clone(), live_session.clone());
        }

        let manager_for_stdout = self.clone();
        let live_session_for_stdout = live_session.clone();
        let terminal_for_stdout = context.terminal.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        let _ = manager_for_stdout.handle_helper_line(
                            &terminal_for_stdout,
                            &live_session_for_stdout,
                            &line,
                        );
                    }
                    Err(error) => {
                        let _ = manager_for_stdout.handle_child_process_error(
                            &terminal_for_stdout,
                            &live_session_for_stdout,
                            format!("The ConPTY helper emitted unreadable output: {}", error),
                        );
                        break;
                    }
                }
            }
        });

        let live_session_for_stderr = live_session.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        if let Ok(mut session) = live_session_for_stderr.lock() {
                            let mut helper_stderr_lines = std::mem::take(&mut session.helper_stderr_lines);
                            let mut pending_helper_stderr_line = std::mem::take(&mut session.pending_helper_stderr_line);
                            append_output_chunk(
                                &mut helper_stderr_lines,
                                &mut pending_helper_stderr_line,
                                &format!("{}\n", line),
                            );
                            session.helper_stderr_lines = helper_stderr_lines;
                            session.pending_helper_stderr_line = pending_helper_stderr_line;
                            if session.helper_stderr_lines.len() > MAX_HELPER_STDERR_LINES {
                                let excess = session.helper_stderr_lines.len() - MAX_HELPER_STDERR_LINES;
                                session.helper_stderr_lines.drain(0..excess);
                            }
                        }
                    }
                    Err(error) => {
                        eprintln!("Failed to read helper stderr: {}", error);
                        break;
                    }
                }
            }
        });

        let manager_for_exit = self.clone();
        let live_session_for_exit = live_session.clone();
        let terminal_for_exit = context.terminal.clone();
        thread::spawn(move || {
            manager_for_exit.watch_child_exit(live_session_for_exit, terminal_for_exit);
        });

        Ok(())
    }
    fn watch_child_exit(&self, live_session: Arc<Mutex<LiveSession>>, terminal: TerminalRecord) {
        loop {
            let (closed, stopped, received_exit, received_error, child_handle) = {
                let session = match live_session.lock() {
                    Ok(session) => session,
                    Err(error) => {
                        eprintln!("Failed to lock live session: {}", error);
                        return;
                    }
                };
                (
                    session.closed,
                    session.is_stopping,
                    session.received_exit_event,
                    session.received_error_event,
                    session.child.clone(),
                )
            };

            if closed || stopped || received_exit || received_error {
                return;
            }

            let child_exit = {
                let mut child = match child_handle.lock() {
                    Ok(child) => child,
                    Err(error) => {
                        eprintln!("Failed to lock helper child: {}", error);
                        return;
                    }
                };
                child.try_wait()
            };

            match child_exit {
                Ok(Some(code)) => {
                    let _ = self.handle_child_exit(&terminal, &live_session, code.code());
                    return;
                }
                Ok(None) => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(error) => {
                    let _ = self.handle_child_process_error(
                        &terminal,
                        &live_session,
                        format!("The ConPTY helper process failed: {}", error),
                    );
                    return;
                }
            }
        }
    }

    fn handle_helper_line(
        &self,
        terminal: &TerminalRecord,
        live_session: &Arc<Mutex<LiveSession>>,
        line: &str,
    ) -> Result<(), String> {
        let payload = serde_json::from_str::<HelperEvent>(line)
            .map_err(|error| format!("The ConPTY helper emitted invalid JSON: {} ({})", line, error))?;

        match payload {
            HelperEvent::Started(event) => self.handle_helper_started(terminal, live_session, event),
            HelperEvent::Output(event) => self.handle_helper_output(terminal, live_session, event),
            HelperEvent::Exit(event) => self.handle_helper_exit(terminal, live_session, event),
            HelperEvent::Error(event) => self.handle_helper_error(terminal, live_session, event),
        }
    }

    fn handle_helper_started(
        &self,
        terminal: &TerminalRecord,
        live_session: &Arc<Mutex<LiveSession>>,
        event: HelperStartedEvent,
    ) -> Result<(), String> {
        {
            let mut session = live_session.lock().map_err(|error| error.to_string())?;
            session.received_started_event = true;
        }

        {
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            if let Some(record) = state.terminals.iter_mut().find(|candidate| candidate.id == terminal.id) {
                record.status = TerminalStatus::Running;
                record.diagnostic_log_path = Some(event.diagnostic_log_path.clone());
                record.activity = TerminalActivity::for_status(TerminalStatus::Running);
            }
        }

        self.persist_and_emit_state()?;
        self.emit_event("terminal-started", serde_json::json!({
            "terminalId": terminal.id,
            "sessionId": event.session_id,
            "shellPid": event.shell_pid,
            "shellPath": event.shell_path,
            "diagnosticLogPath": event.diagnostic_log_path,
            "startedAt": event.started_at,
        }));
        Ok(())
    }

    fn handle_helper_output(
        &self,
        terminal: &TerminalRecord,
        live_session: &Arc<Mutex<LiveSession>>,
        event: HelperOutputEvent,
    ) -> Result<(), String> {
        {
            let mut session = live_session.lock().map_err(|error| error.to_string())?;
            self.capture_shell_output(&mut session, &event.data_base64);
        }

        self.update_terminal_activity(
            &terminal.id,
            TerminalActivityPhase::Streaming,
            "Streaming output".to_string(),
            "Receiving live terminal output from the shell.".to_string(),
            74,
            true,
        )?;

        self.schedule_terminal_activity(
            terminal.id.clone(),
            OUTPUT_SETTLE_MS,
            TerminalActivityPhase::Waiting,
            "Ready".to_string(),
            "Output has settled. The shell is waiting for the next command.".to_string(),
            100,
            false,
        );

        self.emit_event(
            "terminal-output",
            serde_json::json!({
                "terminalId": terminal.id,
                "dataBase64": event.data_base64,
            }),
        );
        Ok(())
    }

    fn handle_helper_exit(
        &self,
        terminal: &TerminalRecord,
        live_session: &Arc<Mutex<LiveSession>>,
        event: HelperExitEvent,
    ) -> Result<(), String> {
        {
            let mut session = live_session.lock().map_err(|error| error.to_string())?;
            if session.received_exit_event {
                return Ok(());
            }
            session.received_exit_event = true;
        }

        let recent_output_excerpt = self.get_recent_output_excerpt(live_session);
        let stderr_excerpt = {
            let session = live_session.lock().map_err(|error| error.to_string())?;
            event
                .stderr_excerpt
                .clone()
                .or_else(|| self.get_helper_stderr_excerpt_locked(&session))
        };

        {
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            if let Some(record) = state.terminals.iter_mut().find(|candidate| candidate.id == terminal.id) {
                record.status = TerminalStatus::Exited;
                record.activity = TerminalActivity::for_status(TerminalStatus::Exited);
                record.last_exit_code = event.exit_code;
                record.last_session_failure = Some(TerminalSessionFailure {
                    session_id: event.session_id.clone(),
                    timestamp: event.exited_at.clone(),
                    exit_code: event.exit_code,
                    message: format!(
                        "The shell exited with code {}.",
                        event
                            .exit_code
                            .map(|code| code.to_string())
                            .unwrap_or_else(|| "unknown".to_string())
                    ),
                    shell_path: event.shell_path.clone(),
                    shell_pid: event.shell_pid,
                    stderr_excerpt: stderr_excerpt.clone(),
                    recent_output_excerpt: recent_output_excerpt.clone(),
                    exception_type: None,
                    hresult: None,
                    win32_error_code: None,
                });
            }
        }

        self.persist_and_emit_state()?;
        self.emit_event(
            "terminal-exit",
            serde_json::json!({
                "terminalId": terminal.id,
                "sessionId": event.session_id,
                "exitCode": event.exit_code,
                "exitedAt": event.exited_at,
                "shellPid": event.shell_pid,
                "shellPath": event.shell_path,
                "stderrExcerpt": stderr_excerpt,
                "recentOutputExcerpt": recent_output_excerpt,
            }),
        );

        self.cleanup_session(&terminal.id);
        Ok(())
    }

    fn handle_helper_error(
        &self,
        terminal: &TerminalRecord,
        live_session: &Arc<Mutex<LiveSession>>,
        event: HelperErrorEvent,
    ) -> Result<(), String> {
        {
            let mut session = live_session.lock().map_err(|error| error.to_string())?;
            if session.received_error_event {
                return Ok(());
            }
            session.received_error_event = true;
        }

        let recent_output_excerpt = self.get_recent_output_excerpt(live_session);
        let stderr_excerpt = {
            let session = live_session.lock().map_err(|error| error.to_string())?;
            self.get_helper_stderr_excerpt_locked(&session)
        };

        {
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            if let Some(record) = state.terminals.iter_mut().find(|candidate| candidate.id == terminal.id) {
                record.status = TerminalStatus::Error;
                record.last_session_failure = Some(TerminalSessionFailure {
                    session_id: event.session_id.clone().unwrap_or_else(new_uuid_string),
                    timestamp: event.occurred_at.clone(),
                    exit_code: None,
                    message: event.message.clone(),
                    shell_path: event.shell_path.clone().unwrap_or_else(|| terminal.shell.clone()),
                    shell_pid: event.shell_pid,
                    stderr_excerpt: stderr_excerpt.clone(),
                    recent_output_excerpt: recent_output_excerpt.clone(),
                    exception_type: event.exception_type.clone(),
                    hresult: event.hresult,
                    win32_error_code: event.win32_error_code,
                });
                record.activity = TerminalActivity {
                    phase: TerminalActivityPhase::Attention,
                    summary: "Session error".to_string(),
                    detail: self.describe_session_error(&event, stderr_excerpt.clone(), recent_output_excerpt.clone()),
                    progress: 100,
                    is_indeterminate: false,
                    updated_at: now_iso_string(),
                };
            }
        }

        self.persist_and_emit_state()?;
        self.emit_event(
            "terminal-error",
            serde_json::json!({
                "terminalId": terminal.id,
                "sessionId": event.session_id,
                "message": event.message,
                "diagnosticLogPath": event.diagnostic_log_path,
                "exceptionType": event.exception_type,
                "hresult": event.hresult,
                "win32ErrorCode": event.win32_error_code,
                "recentOutputExcerpt": recent_output_excerpt,
            }),
        );

        self.cleanup_session(&terminal.id);
        Ok(())
    }

    fn handle_child_exit(
        &self,
        terminal: &TerminalRecord,
        live_session: &Arc<Mutex<LiveSession>>,
        code: Option<i32>,
    ) -> Result<(), String> {
        let (received_started_event, session_id, stderr_excerpt) = {
            let session = live_session.lock().map_err(|error| error.to_string())?;
            (
                session.received_started_event,
                session.session_id.clone(),
                self.get_helper_stderr_excerpt_locked(&session),
            )
        };

        if received_started_event {
            self.handle_helper_exit(
                terminal,
                live_session,
                HelperExitEvent {
                    session_id,
                    exit_code: code,
                    exited_at: now_iso_string(),
                    shell_pid: None,
                    shell_path: terminal.shell.clone(),
                    diagnostic_log_path: terminal.diagnostic_log_path.clone().unwrap_or_default(),
                    stderr_excerpt,
                },
            )
        } else {
            self.handle_helper_error(
                terminal,
                live_session,
                HelperErrorEvent {
                    session_id: Some(session_id),
                    message: "The ConPTY helper exited before the shell reported a successful startup.".to_string(),
                    diagnostic_log_path: terminal.diagnostic_log_path.clone(),
                    exception_type: Some("HelperStartupExit".to_string()),
                    hresult: None,
                    win32_error_code: None,
                    occurred_at: now_iso_string(),
                    shell_path: Some(terminal.shell.clone()),
                    shell_pid: None,
                },
            )
        }
    }

    fn handle_child_process_error(
        &self,
        terminal: &TerminalRecord,
        live_session: &Arc<Mutex<LiveSession>>,
        message: String,
    ) -> Result<(), String> {
        self.handle_helper_error(
            terminal,
            live_session,
            HelperErrorEvent {
                session_id: None,
                message,
                diagnostic_log_path: terminal.diagnostic_log_path.clone(),
                exception_type: Some("ChildProcessError".to_string()),
                hresult: None,
                win32_error_code: None,
                occurred_at: now_iso_string(),
                shell_path: Some(terminal.shell.clone()),
                shell_pid: None,
            },
        )
    }
    fn capture_shell_output(&self, session: &mut LiveSession, data_base64: &str) {
        let chunk_text = base64::engine::general_purpose::STANDARD
            .decode(data_base64)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .unwrap_or_default();
        append_output_chunk(
            &mut session.recent_output_lines,
            &mut session.pending_output_line,
            &chunk_text,
        );
    }

    fn get_recent_output_excerpt(&self, live_session: &Arc<Mutex<LiveSession>>) -> String {
        let session = match live_session.lock() {
            Ok(session) => session,
            Err(_) => return String::new(),
        };
        create_recent_output_excerpt(&session.recent_output_lines, &session.pending_output_line)
    }

    fn get_helper_stderr_excerpt_locked(&self, session: &LiveSession) -> Option<String> {
        let excerpt = create_recent_output_excerpt(&session.helper_stderr_lines, &session.pending_helper_stderr_line);
        if excerpt.trim().is_empty() {
            None
        } else {
            Some(excerpt)
        }
    }

    fn update_terminal_activity(
        &self,
        terminal_id: &str,
        phase: TerminalActivityPhase,
        summary: String,
        detail: String,
        progress: u32,
        is_indeterminate: bool,
    ) -> Result<(), String> {
        let mut changed = false;
        {
            let mut state = self.state.lock().map_err(|error| error.to_string())?;
            if let Some(terminal) = state.terminals.iter_mut().find(|candidate| candidate.id == terminal_id) {
                let next = TerminalActivity {
                    phase,
                    summary,
                    detail,
                    progress,
                    is_indeterminate,
                    updated_at: now_iso_string(),
                };
                if terminal.activity != next {
                    terminal.activity = next;
                    changed = true;
                }
            } else {
                return Err(format!("Terminal '{}' was not found.", terminal_id));
            }
        }

        if changed {
            self.persist_and_emit_state()?;
        }
        Ok(())
    }

    fn schedule_terminal_activity(
        &self,
        terminal_id: String,
        delay_ms: u64,
        phase: TerminalActivityPhase,
        summary: String,
        detail: String,
        progress: u32,
        is_indeterminate: bool,
    ) {
        let token = {
            let mut tokens = match self.activity_tokens.lock() {
                Ok(tokens) => tokens,
                Err(error) => {
                    eprintln!("Failed to lock activity tokens: {}", error);
                    return;
                }
            };
            let entry = tokens.entry(terminal_id.clone()).or_insert(0);
            *entry += 1;
            *entry
        };

        let manager = self.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(delay_ms));
            let should_apply = {
                let tokens = match manager.activity_tokens.lock() {
                    Ok(tokens) => tokens,
                    Err(error) => {
                        eprintln!("Failed to lock activity tokens: {}", error);
                        return;
                    }
                };
                tokens.get(&terminal_id).copied().unwrap_or_default() == token
            };

            if !should_apply {
                return;
            }

            let _ = manager.update_terminal_activity(&terminal_id, phase, summary, detail, progress, is_indeterminate);
        });
    }

    fn persist_and_emit_state(&self) -> Result<(), String> {
        let snapshot = self.snapshot_state();
        self.state_store.save(&snapshot)?;
        self.emit_state_changed_snapshot(snapshot);
        Ok(())
    }

    fn persist_state_inner(&self, state: &AppState) -> Result<(), String> {
        self.state_store.save(state)
    }

    fn emit_state_changed_snapshot(&self, snapshot: AppState) {
        let _ = self.app_handle.emit("state-changed", snapshot);
    }

    fn emit_event<T: Serialize + Clone>(&self, name: &str, payload: T) {
        let _ = self.app_handle.emit(name, payload);
    }

    fn snapshot_state(&self) -> AppState {
        self.state
            .lock()
            .map(|state| state.clone())
            .unwrap_or_else(|_| AppState::create_initial())
    }

    fn create_helper_path_candidates() -> Vec<PathBuf> {
        let mut candidates = Vec::new();
        if let Ok(current_dir) = std::env::current_dir() {
            candidates.push(current_dir.join("src-tauri/resources/TerminalWindowManager.ConPTYHost/TerminalWindowManager.ConPTYHost.exe"));
            candidates.push(current_dir.join("src/TerminalWindowManager.ConPTYHost/bin/Release/net10.0-windows/TerminalWindowManager.ConPTYHost.exe"));
            candidates.push(current_dir.join("src/TerminalWindowManager.ConPTYHost/bin/Debug/net10.0-windows/TerminalWindowManager.ConPTYHost.exe"));
            if let Some(parent) = current_dir.parent() {
                candidates.push(parent.join("TerminalWindowManager.ConPTYHost/bin/Release/net10.0-windows/TerminalWindowManager.ConPTYHost.exe"));
                candidates.push(parent.join("TerminalWindowManager.ConPTYHost/bin/Debug/net10.0-windows/TerminalWindowManager.ConPTYHost.exe"));
            }
        }

        candidates
    }

    fn find_project<'a>(state: &'a AppState, project_id: &str) -> Result<&'a ProjectRecord, String> {
        state
            .projects
            .iter()
            .find(|project| project.id == project_id)
            .ok_or_else(|| format!("Project '{}' was not found.", project_id))
    }

    fn find_project_mut<'a>(state: &'a mut AppState, project_id: &str) -> Result<&'a mut ProjectRecord, String> {
        state
            .projects
            .iter_mut()
            .find(|project| project.id == project_id)
            .ok_or_else(|| format!("Project '{}' was not found.", project_id))
    }

    fn find_terminal_mut<'a>(state: &'a mut AppState, terminal_id: &str) -> Result<&'a mut TerminalRecord, String> {
        state
            .terminals
            .iter_mut()
            .find(|terminal| terminal.id == terminal_id)
            .ok_or_else(|| format!("Terminal '{}' was not found.", terminal_id))
    }

    fn get_session(&self, terminal_id: &str) -> Result<Arc<Mutex<LiveSession>>, String> {
        let sessions = self.sessions.lock().map_err(|error| error.to_string())?;
        sessions
            .get(terminal_id)
            .cloned()
            .ok_or_else(|| format!("Terminal session '{}' is not running yet. Activate the session before sending input.", terminal_id))
    }

    fn cleanup_session(&self, terminal_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(session) = sessions.remove(terminal_id) {
                if let Ok(mut live_session) = session.lock() {
                    live_session.closed = true;
                }
            }
        }
    }

    fn describe_session_error(
        &self,
        event: &HelperErrorEvent,
        stderr_excerpt: Option<String>,
        recent_output_excerpt: String,
    ) -> String {
        let mut details = vec![event.message.clone()];
        if let Some(shell_pid) = event.shell_pid {
            details.push(format!("PID {}", shell_pid));
        }
        if let Some(stderr_excerpt) = stderr_excerpt {
            if !stderr_excerpt.trim().is_empty() {
                details.push(format!("Helper stderr: {}", stderr_excerpt));
            }
        }
        if !recent_output_excerpt.trim().is_empty() {
            details.push(format!("Recent output: {}", recent_output_excerpt));
        }
        details.join(" ")
    }

    fn is_power_shell_shell(&self, shell: &str) -> bool {
        let normalized = shell.trim().to_lowercase();
        normalized.ends_with("pwsh")
            || normalized.ends_with("pwsh.exe")
            || normalized.ends_with("powershell")
            || normalized.ends_with("powershell.exe")
    }

}
#[derive(Debug)]
struct LiveSession {
    session_id: String,
    child: Arc<Mutex<Child>>,
    stdin: Arc<Mutex<ChildStdin>>,
    recent_output_lines: Vec<String>,
    pending_output_line: String,
    helper_stderr_lines: Vec<String>,
    pending_helper_stderr_line: String,
    is_stopping: bool,
    closed: bool,
    received_started_event: bool,
    received_exit_event: bool,
    received_error_event: bool,
}
#[derive(Debug, Clone)]
struct TerminalLaunchContext {
    session_id: String,
    diagnostics_paths: SessionDiagnosticsPaths,
    power_shell_bootstrap_path: Option<PathBuf>,
    terminal: TerminalRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum HelperEvent {
    Started(HelperStartedEvent),
    Output(HelperOutputEvent),
    Exit(HelperExitEvent),
    Error(HelperErrorEvent),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperStartedEvent {
    session_id: String,
    shell_pid: u32,
    shell_path: String,
    diagnostic_log_path: String,
    started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperOutputEvent {
    data_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperExitEvent {
    session_id: String,
    exit_code: Option<i32>,
    exited_at: String,
    shell_pid: Option<u32>,
    shell_path: String,
    diagnostic_log_path: String,
    stderr_excerpt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperErrorEvent {
    session_id: Option<String>,
    message: String,
    diagnostic_log_path: Option<String>,
    exception_type: Option<String>,
    hresult: Option<i32>,
    win32_error_code: Option<i32>,
    occurred_at: String,
    shell_path: Option<String>,
    shell_pid: Option<u32>,
}

fn new_uuid_string() -> String {
    uuid::Uuid::new_v4().to_string()
}

fn now_iso_string() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn describe_input_activity(data: &str) -> (String, String, u32) {
    if data.contains('\r') || data.contains('\n') {
        (
            "Running command".to_string(),
            "Submitted input to the shell and waiting for output.".to_string(),
            44,
        )
    } else {
        (
            "Sending input".to_string(),
            "Forwarding interactive input to the shell.".to_string(),
            28,
        )
    }
}



