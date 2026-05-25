use std::ffi::CString;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd, RawFd};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use base64::Engine as _;
use chrono::Utc;
use serde::{Deserialize, Serialize};

const MISSING_WORKING_DIRECTORY_PREFIX: &str = "Working directory '";
const MISSING_WORKING_DIRECTORY_SUFFIX: &str = "' does not exist.";

#[derive(Debug, Clone)]
struct HostOptions {
    working_directory: PathBuf,
    shell_path: PathBuf,
    session_id: String,
    diagnostics_log_path: PathBuf,
    power_shell_bootstrap_path: Option<PathBuf>,
    cols: u16,
    rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlMessage {
    #[serde(rename = "type")]
    message_type: String,
    data: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum HostEvent<'a> {
    Started(StartedEvent<'a>),
    Output(OutputEvent),
    Exit(ExitEvent<'a>),
    Error(ErrorEvent<'a>),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartedEvent<'a> {
    session_id: &'a str,
    shell_pid: u32,
    shell_path: &'a str,
    cwd: &'a str,
    diagnostic_log_path: &'a str,
    started_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputEvent {
    data_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitEvent<'a> {
    session_id: &'a str,
    exit_code: Option<i32>,
    exited_at: String,
    shell_pid: Option<u32>,
    shell_path: &'a str,
    diagnostic_log_path: &'a str,
    stderr_excerpt: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorEvent<'a> {
    session_id: Option<&'a str>,
    message: String,
    diagnostic_log_path: Option<&'a str>,
    exception_type: Option<&'a str>,
    hresult: Option<i32>,
    win32_error_code: Option<i32>,
    occurred_at: String,
    shell_path: Option<&'a str>,
    shell_pid: Option<u32>,
}

pub fn run() -> i32 {
    match run_inner() {
        Ok(exit_code) => exit_code,
        Err(error) => {
            let _ = emit_event(&HostEvent::Error(ErrorEvent {
                session_id: None,
                message: error,
                diagnostic_log_path: None,
                exception_type: Some("UnixPtyHostError"),
                hresult: None,
                win32_error_code: None,
                occurred_at: now_iso_string(),
                shell_path: None,
                shell_pid: None,
            }));
            1
        }
    }
}

fn run_inner() -> Result<i32, String> {
    let options = HostOptions::parse(std::env::args().skip(2).collect())?;
    let shell_path_text = options.shell_path.display().to_string();
    let cwd_text = options.working_directory.display().to_string();
    let diagnostics_log_path_text = options.diagnostics_log_path.display().to_string();
    let (master_fd, shell_pid) = spawn_pty(&options)?;
    let master = unsafe { File::from_raw_fd(master_fd) };
    let reader = master.try_clone().map_err(|error| error.to_string())?;
    let writer = Arc::new(Mutex::new(master));

    emit_event(&HostEvent::Started(StartedEvent {
        session_id: &options.session_id,
        shell_pid: shell_pid as u32,
        shell_path: &shell_path_text,
        cwd: &cwd_text,
        diagnostic_log_path: &diagnostics_log_path_text,
        started_at: now_iso_string(),
    }))?;

    let _output_thread = thread::spawn(move || pump_output(reader));
    let control_writer = writer.clone();
    let control_pid = shell_pid;
    let _control_thread =
        thread::spawn(move || process_control_messages(control_writer, control_pid));

    let exit_code = wait_for_child(shell_pid)?;

    emit_event(&HostEvent::Exit(ExitEvent {
        session_id: &options.session_id,
        exit_code: Some(exit_code),
        exited_at: now_iso_string(),
        shell_pid: Some(shell_pid as u32),
        shell_path: &shell_path_text,
        diagnostic_log_path: &diagnostics_log_path_text,
        stderr_excerpt: None,
    }))?;

    Ok(exit_code)
}

impl HostOptions {
    fn parse(args: Vec<String>) -> Result<Self, String> {
        let mut values = std::collections::HashMap::new();
        let mut index = 0;
        while index < args.len() {
            let key = args
                .get(index)
                .ok_or_else(|| "Unexpected end of arguments.".to_string())?;
            if !key.starts_with("--") {
                return Err(format!("Unexpected argument '{}'.", key));
            }
            let value = args
                .get(index + 1)
                .ok_or_else(|| format!("Missing value for argument '{}'.", key))?;
            values.insert(key.trim_start_matches("--").to_string(), value.clone());
            index += 2;
        }

        let working_directory = values
            .get("cwd")
            .filter(|cwd| !cwd.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or(std::env::current_dir().map_err(|error| error.to_string())?);
        if !working_directory.is_dir() {
            return Err(format!(
                "{}{}{}",
                MISSING_WORKING_DIRECTORY_PREFIX,
                working_directory.display(),
                MISSING_WORKING_DIRECTORY_SUFFIX
            ));
        }

        let requested_shell = values.get("shell").map(String::as_str);
        let shell_path = resolve_shell_path(requested_shell)?;
        let session_id = values
            .get("session-id")
            .filter(|session_id| !session_id.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let diagnostics_log_path = values
            .get("events-path")
            .filter(|path| !path.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                working_directory
                    .join(".twm-diagnostics")
                    .join("events.jsonl")
            });
        if let Some(parent) = diagnostics_log_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        let power_shell_bootstrap_path = values
            .get("powershell-bootstrap")
            .filter(|path| !path.trim().is_empty())
            .map(PathBuf::from);
        if let Some(path) = &power_shell_bootstrap_path {
            if !path.is_file() {
                return Err(format!(
                    "PowerShell bootstrap script '{}' could not be located.",
                    path.display()
                ));
            }
        }

        Ok(Self {
            working_directory,
            shell_path,
            session_id,
            diagnostics_log_path,
            power_shell_bootstrap_path,
            cols: parse_dimension(values.get("cols"), 120, 20, 500)?,
            rows: parse_dimension(values.get("rows"), 30, 5, 200)?,
        })
    }
}

fn spawn_pty(options: &HostOptions) -> Result<(RawFd, libc::pid_t), String> {
    let mut master_fd: libc::c_int = -1;
    let mut winsize = libc::winsize {
        ws_row: options.rows,
        ws_col: options.cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };

    let pid = unsafe {
        libc::forkpty(
            &mut master_fd,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut winsize,
        )
    };

    if pid < 0 {
        return Err(io::Error::last_os_error().to_string());
    }

    if pid == 0 {
        exec_shell(options);
    }

    Ok((master_fd, pid))
}

fn exec_shell(options: &HostOptions) -> ! {
    if let Ok(cwd) = CString::new(options.working_directory.as_os_str().as_bytes()) {
        unsafe {
            libc::chdir(cwd.as_ptr());
        }
    }
    let term_name = CString::new("TERM").expect("TERM contained a NUL byte");
    let term_value = CString::new("xterm-256color").expect("TERM value contained a NUL byte");
    unsafe {
        libc::setenv(term_name.as_ptr(), term_value.as_ptr(), 1);
    }

    let shell_path = options.shell_path.display().to_string();
    let mut args = vec![shell_path.clone()];
    if let Some(bootstrap_path) = &options.power_shell_bootstrap_path {
        args.extend([
            "-NoLogo".to_string(),
            "-NoExit".to_string(),
            "-File".to_string(),
            bootstrap_path.display().to_string(),
        ]);
    }

    let c_shell = CString::new(shell_path).expect("shell path contained a NUL byte");
    let c_args = args
        .iter()
        .map(|arg| CString::new(arg.as_str()).expect("shell argument contained a NUL byte"))
        .collect::<Vec<CString>>();
    let mut argv = c_args
        .iter()
        .map(|arg| arg.as_ptr())
        .chain(std::iter::once(std::ptr::null()))
        .collect::<Vec<*const libc::c_char>>();

    unsafe {
        libc::execv(c_shell.as_ptr(), argv.as_mut_ptr());
        libc::_exit(127);
    }
}

fn pump_output(mut reader: File) {
    let mut buffer = [0u8; 4096];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return,
            Ok(bytes_read) => {
                let data_base64 =
                    base64::engine::general_purpose::STANDARD.encode(&buffer[..bytes_read]);
                let _ = emit_event(&HostEvent::Output(OutputEvent { data_base64 }));
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return,
        }
    }
}

fn process_control_messages(writer: Arc<Mutex<File>>, shell_pid: libc::pid_t) {
    let stdin = io::stdin();
    let reader = BufReader::new(stdin.lock());

    for line in reader.lines().map_while(Result::ok) {
        let Ok(message) = serde_json::from_str::<ControlMessage>(&line) else {
            continue;
        };

        match message.message_type.as_str() {
            "input" => {
                if let Some(data) = message.data {
                    if let Ok(mut writer) = writer.lock() {
                        let _ = writer.write_all(data.as_bytes());
                        let _ = writer.flush();
                    }
                }
            }
            "resize" => {
                if let (Some(cols), Some(rows)) = (message.cols, message.rows) {
                    if let Ok(writer) = writer.lock() {
                        resize_pty(&writer, cols.max(20), rows.max(5));
                    }
                }
            }
            "shutdown" => {
                terminate_child(shell_pid);
                return;
            }
            _ => {}
        }
    }
}

fn wait_for_child(pid: libc::pid_t) -> Result<i32, String> {
    loop {
        let mut status = 0;
        let result = unsafe { libc::waitpid(pid, &mut status, 0) };
        if result < 0 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error.to_string());
        }

        if libc::WIFEXITED(status) {
            return Ok(libc::WEXITSTATUS(status));
        }
        if libc::WIFSIGNALED(status) {
            return Ok(128 + libc::WTERMSIG(status));
        }

        thread::sleep(Duration::from_millis(25));
    }
}

fn resize_pty(writer: &File, cols: u16, rows: u16) {
    let winsize = libc::winsize {
        ws_row: rows,
        ws_col: cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    };
    unsafe {
        libc::ioctl(writer.as_raw_fd(), libc::TIOCSWINSZ, &winsize);
    }
}

fn terminate_child(pid: libc::pid_t) {
    unsafe {
        libc::kill(pid, libc::SIGHUP);
        thread::sleep(Duration::from_millis(100));
        libc::kill(pid, libc::SIGTERM);
    }
}

fn resolve_shell_path(requested_shell: Option<&str>) -> Result<PathBuf, String> {
    let fallback_shells = [
        std::env::var("SHELL").ok(),
        Some("/bin/zsh".to_string()),
        Some("/bin/bash".to_string()),
        Some("/bin/sh".to_string()),
    ];

    if let Some(shell) = requested_shell.filter(|shell| !shell.trim().is_empty()) {
        return resolve_shell_candidate(shell)
            .ok_or_else(|| format!("Shell executable '{}' could not be located.", shell.trim()));
    }

    for shell in fallback_shells.into_iter().flatten() {
        if let Some(path) = resolve_shell_candidate(&shell) {
            return Ok(path);
        }
    }

    Err(
        "No supported shell executable was found. Tried SHELL, /bin/zsh, /bin/bash, and /bin/sh."
            .to_string(),
    )
}

fn resolve_shell_candidate(candidate: &str) -> Option<PathBuf> {
    let trimmed = candidate.trim().trim_matches('"');
    if trimmed.is_empty() {
        return None;
    }

    let candidate_path = Path::new(trimmed);
    if candidate_path.is_absolute() && candidate_path.is_file() {
        return Some(candidate_path.to_path_buf());
    }

    if trimmed.contains('/') {
        let full_path = std::env::current_dir().ok()?.join(candidate_path);
        if full_path.is_file() {
            return Some(full_path);
        }
    }

    let path_value = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&path_value) {
        let path = directory.join(trimmed);
        if path.is_file() {
            return Some(path);
        }
    }

    None
}

fn parse_dimension(
    raw_value: Option<&String>,
    default_value: u16,
    minimum: u16,
    maximum: u16,
) -> Result<u16, String> {
    let Some(raw_value) = raw_value.filter(|value| !value.trim().is_empty()) else {
        return Ok(default_value);
    };

    let parsed = raw_value
        .parse::<u16>()
        .map_err(|_| format!("Argument value '{}' must be a valid integer.", raw_value))?;
    Ok(parsed.clamp(minimum, maximum))
}

fn emit_event(event: &HostEvent<'_>) -> Result<(), String> {
    let line = serde_json::to_string(event).map_err(|error| error.to_string())?;
    let stdout = io::stdout();
    let mut lock = stdout.lock();
    writeln!(lock, "{}", line).map_err(|error| error.to_string())?;
    lock.flush().map_err(|error| error.to_string())
}

fn now_iso_string() -> String {
    Utc::now().to_rfc3339()
}
