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
    #[serde(rename = "terminalProgress")]
    TerminalProgress(ProgressEvent),
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
struct ProgressEvent {
    session_id: String,
    state: u32,
    progress: u32,
    occurred_at: String,
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

    let _output_thread = {
        let session_id = options.session_id.clone();
        thread::spawn(move || pump_output(reader, session_id))
    };
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

fn pump_output(mut reader: File, session_id: String) {
    let mut buffer = [0u8; 4096];
    let mut parser = OscProgressParser::new();
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => {
                flush_pending_visible(&mut parser);
                return;
            }
            Ok(bytes_read) => {
                let parsed = parser.parse_chunk(&buffer[..bytes_read]);
                for (state, progress) in parsed.progress_events {
                    let _ = emit_event(&HostEvent::TerminalProgress(ProgressEvent {
                        session_id: session_id.clone(),
                        state,
                        progress,
                        occurred_at: now_iso_string(),
                    }));
                }
                // Parity with Windows ConPTYHost: a chunk containing only
                // OSC 9;4 sequences still forwards progress events but skips
                // the empty output event.
                if !parsed.visible.is_empty() {
                    let data_base64 = base64::engine::general_purpose::STANDARD
                        .encode(&parsed.visible);
                    let _ = emit_event(&HostEvent::Output(OutputEvent { data_base64 }));
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => {
                flush_pending_visible(&mut parser);
                return;
            }
        }
    }
}

fn flush_pending_visible(parser: &mut OscProgressParser) {
    let pending = parser.flush();
    if !pending.is_empty() {
        let data_base64 =
            base64::engine::general_purpose::STANDARD.encode(&pending);
        let _ = emit_event(&HostEvent::Output(OutputEvent { data_base64 }));
    }
}

/// Stateful `ESC ] 9;4;<state>;<progress> (BEL | ESC \)` filter.
///
/// Mirrors `TerminalWindowManager.Core/Services/TerminalSequenceParser.cs`:
/// valid sequences are stripped from visible output and reported as
/// `(state, progress)` events; anything malformed is forwarded untouched.
/// The pending reassembly buffer is bounded by `MAX_PENDING_BYTES` so a
/// split-across-reads prefix retains at most a small tail between reads
/// and adversarial input cannot grow memory without bound.
const OSC_PROGRESS_MAX_PENDING_BYTES: usize = 64;
const OSC_PROGRESS_PREFIX: &[u8] = b"9;4;";
const ESCAPE_BYTE: u8 = 0x1B;
const OSC_BYTE: u8 = b']';
const SEMICOLON_BYTE: u8 = b';';
const BEL_BYTE: u8 = 0x07;
const ST_TERMINATOR_BYTE: u8 = b'\\';

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OscParserState {
    Idle,
    ExpectOsc,
    ExpectPrefix,
    ParseState,
    ParseProgress,
    ExpectStringTerminator,
}

#[derive(Debug, Default)]
struct OscProgressParser {
    state: OscParserState,
    pending: Vec<u8>,
    prefix_index: usize,
    state_digits: Vec<u8>,
    progress_digits: Vec<u8>,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct ParsedChunk {
    visible: Vec<u8>,
    progress_events: Vec<(u32, u32)>,
}

impl Default for OscParserState {
    fn default() -> Self {
        OscParserState::Idle
    }
}

impl OscProgressParser {
    fn new() -> Self {
        Self::default()
    }

    fn parse_chunk(&mut self, input: &[u8]) -> ParsedChunk {
        let mut parsed = ParsedChunk {
            visible: Vec::with_capacity(input.len()),
            progress_events: Vec::new(),
        };
        for &byte in input {
            self.process_byte(byte, &mut parsed.visible, &mut parsed.progress_events);
        }
        parsed
    }

    /// Returns bytes held as an incomplete sequence. A complete caller
    /// forwards them as plain output (parity with `FlushPendingOutput`).
    fn flush(&mut self) -> Vec<u8> {
        if self.pending.is_empty() {
            return Vec::new();
        }
        let pending = std::mem::take(&mut self.pending);
        self.reset();
        pending
    }

    fn process_byte(&mut self, value: u8, output: &mut Vec<u8>, events: &mut Vec<(u32, u32)>) {
        let mut current = Some(value);
        while let Some(byte) = current {
            current = None;
            // Bound the reassembly tail: if a candidate sequence already
            // holds the maximum, it cannot be a valid short OSC 9;4
            // sequence, so emit it as plain output and re-examine this
            // byte from the idle state. Malformed input is never dropped.
            if self.state != OscParserState::Idle
                && self.pending.len() >= OSC_PROGRESS_MAX_PENDING_BYTES
            {
                self.flush_to_output(output);
                current = Some(byte);
                continue;
            }

            match self.state {
                OscParserState::Idle => {
                    if byte == ESCAPE_BYTE {
                        self.reset();
                        self.pending.push(byte);
                        self.state = OscParserState::ExpectOsc;
                    } else {
                        output.push(byte);
                    }
                }
                OscParserState::ExpectOsc => {
                    if byte == OSC_BYTE {
                        self.pending.push(byte);
                        self.state = OscParserState::ExpectPrefix;
                        self.prefix_index = 0;
                    } else {
                        self.flush_to_output(output);
                        current = Some(byte);
                    }
                }
                OscParserState::ExpectPrefix => {
                    if byte == OSC_PROGRESS_PREFIX[self.prefix_index] {
                        self.pending.push(byte);
                        self.prefix_index += 1;
                        if self.prefix_index == OSC_PROGRESS_PREFIX.len() {
                            self.state_digits.clear();
                            self.progress_digits.clear();
                            self.state = OscParserState::ParseState;
                        }
                    } else {
                        self.flush_to_output(output);
                        current = Some(byte);
                    }
                }
                OscParserState::ParseState => {
                    if is_ascii_digit(byte) {
                        self.pending.push(byte);
                        self.state_digits.push(byte);
                    } else if byte == SEMICOLON_BYTE && !self.state_digits.is_empty() {
                        self.pending.push(byte);
                        self.state = OscParserState::ParseProgress;
                    } else {
                        self.flush_to_output(output);
                        current = Some(byte);
                    }
                }
                OscParserState::ParseProgress => {
                    if is_ascii_digit(byte) {
                        self.pending.push(byte);
                        self.progress_digits.push(byte);
                    } else if byte == BEL_BYTE && !self.progress_digits.is_empty() {
                        self.pending.push(byte);
                        self.complete_sequence(output, events);
                    } else if byte == ESCAPE_BYTE && !self.progress_digits.is_empty() {
                        self.pending.push(byte);
                        self.state = OscParserState::ExpectStringTerminator;
                    } else {
                        self.flush_to_output(output);
                        current = Some(byte);
                    }
                }
                OscParserState::ExpectStringTerminator => {
                    if byte == ST_TERMINATOR_BYTE {
                        self.pending.push(byte);
                        self.complete_sequence(output, events);
                    } else {
                        self.flush_to_output(output);
                        current = Some(byte);
                    }
                }
            }
        }
    }

    fn complete_sequence(&mut self, output: &mut Vec<u8>, events: &mut Vec<(u32, u32)>) {
        match try_create_progress(&self.state_digits, &self.progress_digits) {
            Some((state, progress)) => {
                events.push((state, progress));
                self.reset();
            }
            None => self.flush_to_output(output),
        }
    }

    fn flush_to_output(&mut self, output: &mut Vec<u8>) {
        if !self.pending.is_empty() {
            output.extend_from_slice(&self.pending);
        }
        self.reset();
    }

    fn reset(&mut self) {
        self.state = OscParserState::Idle;
        self.prefix_index = 0;
        self.pending.clear();
        self.state_digits.clear();
        self.progress_digits.clear();
    }
}

fn is_ascii_digit(value: u8) -> bool {
    value.is_ascii_digit()
}

/// Validates `state` in 0-4 and `progress` in 0-100, normalizing the
/// `None`/`Indeterminate` progress value to 0 like the C# parser and the
/// backend `map_terminal_progress`.
fn try_create_progress(state_digits: &[u8], progress_digits: &[u8]) -> Option<(u32, u32)> {
    let state = parse_ascii_int(state_digits)?;
    let raw_progress = parse_ascii_int(progress_digits)?;
    if state > 4 || raw_progress > 100 {
        return None;
    }
    let progress = match state {
        0 | 3 => 0,
        _ => raw_progress,
    };
    Some((state, progress))
}

fn parse_ascii_int(digits: &[u8]) -> Option<u32> {
    if digits.is_empty() {
        return None;
    }
    let mut value: u32 = 0;
    for &digit in digits {
        if !digit.is_ascii_digit() {
            return None;
        }
        value = value
            .checked_mul(10)?
            .checked_add(u32::from(digit - b'0'))?;
    }
    Some(value)
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

#[cfg(test)]
mod tests {
    use super::*;

    fn bel_sequence(state: &str, progress: &str) -> Vec<u8> {
        let mut bytes = vec![ESCAPE_BYTE, OSC_BYTE];
        bytes.extend_from_slice(b"9;4;");
        bytes.extend_from_slice(state.as_bytes());
        bytes.push(SEMICOLON_BYTE);
        bytes.extend_from_slice(progress.as_bytes());
        bytes.push(BEL_BYTE);
        bytes
    }

    fn st_sequence(state: &str, progress: &str) -> Vec<u8> {
        let mut bytes = vec![ESCAPE_BYTE, OSC_BYTE];
        bytes.extend_from_slice(b"9;4;");
        bytes.extend_from_slice(state.as_bytes());
        bytes.push(SEMICOLON_BYTE);
        bytes.extend_from_slice(progress.as_bytes());
        bytes.push(ESCAPE_BYTE);
        bytes.push(ST_TERMINATOR_BYTE);
        bytes
    }

    #[test]
    fn pty_bel_sequence_yields_progress_and_strips_output() {
        let mut parser = OscProgressParser::new();
        let mut input = b"hello".to_vec();
        input.extend_from_slice(&bel_sequence("1", "50"));
        input.extend_from_slice(b"world");

        let parsed = parser.parse_chunk(&input);

        assert_eq!(parsed.visible, b"helloworld");
        assert_eq!(parsed.progress_events, vec![(1, 50)]);
        assert!(parser.flush().is_empty());
    }

    #[test]
    fn pty_split_sequence_across_chunks_reassembles() {
        let mut parser = OscProgressParser::new();
        let full = bel_sequence("2", "75");
        let split_at = 5;
        let first = parser.parse_chunk(&full[..split_at]);
        // A partial prefix must not leak into visible output yet.
        assert!(first.visible.is_empty());
        assert!(first.progress_events.is_empty());

        let mut visible = first.visible;
        let mut events = first.progress_events;
        let second = parser.parse_chunk(&full[split_at..]);
        visible.extend_from_slice(&second.visible);
        events.extend(second.progress_events);

        assert!(visible.is_empty());
        assert_eq!(events, vec![(2, 75)]);
        assert!(parser.flush().is_empty());
    }

    #[test]
    fn pty_split_sequence_with_surrounding_text_reassembles() {
        let mut parser = OscProgressParser::new();
        let mut first_input = b"hello".to_vec();
        let full = bel_sequence("1", "50");
        first_input.extend_from_slice(&full[..4]);
        let first = parser.parse_chunk(&first_input);
        assert_eq!(first.visible, b"hello");

        let mut second_input = full[4..].to_vec();
        second_input.extend_from_slice(b"world");
        let second = parser.parse_chunk(&second_input);
        assert_eq!(second.visible, b"world");
        assert_eq!(second.progress_events, vec![(1, 50)]);
    }

    #[test]
    fn pty_st_terminator_yields_progress_and_strips_output() {
        let mut parser = OscProgressParser::new();
        let mut input = b"start-".to_vec();
        input.extend_from_slice(&st_sequence("4", "90"));
        input.extend_from_slice(b"-end");

        let parsed = parser.parse_chunk(&input);

        assert_eq!(parsed.visible, b"start--end");
        assert_eq!(parsed.progress_events, vec![(4, 90)]);
    }

    #[test]
    fn pty_indeterminate_progress_normalizes_to_zero() {
        let mut parser = OscProgressParser::new();
        let parsed = parser.parse_chunk(&bel_sequence("3", "25"));
        assert!(parsed.visible.is_empty());
        assert_eq!(parsed.progress_events, vec![(3, 0)]);
    }

    #[test]
    fn pty_malformed_input_passes_through() {
        let mut parser = OscProgressParser::new();
        // Invalid state (9) plus out-of-range progress: must not be dropped.
        let mut invalid = vec![ESCAPE_BYTE, OSC_BYTE];
        invalid.extend_from_slice(b"9;4;9;999");
        invalid.push(BEL_BYTE);
        let parsed = parser.parse_chunk(&invalid);
        assert_eq!(parsed.visible, invalid);
        assert!(parsed.progress_events.is_empty());

        // Non-progress escape sequences (e.g. SGR color) pass through.
        let mut parser = OscProgressParser::new();
        let color = b"\x1b[31mhi\x1b[0m".to_vec();
        let parsed = parser.parse_chunk(&color);
        assert_eq!(parsed.visible, color);
        assert!(parsed.progress_events.is_empty());

        // Truncated candidate with no terminator stays pending until flush,
        // then is forwarded as plain output rather than dropped.
        let mut parser = OscProgressParser::new();
        let partial = b"\x1b]9;4;1;5".to_vec();
        let parsed = parser.parse_chunk(&partial);
        assert!(parsed.visible.is_empty());
        assert_eq!(parser.flush(), partial);
    }

    #[test]
    fn pty_progress_event_json_matches_backend_helper_shape() {
        let event = HostEvent::TerminalProgress(ProgressEvent {
            session_id: "session-1".to_string(),
            state: 1,
            progress: 50,
            occurred_at: "2026-01-01T00:00:00Z".to_string(),
        });
        let value = serde_json::to_value(&event).expect("event serializes");
        assert_eq!(value["type"], "terminalProgress");
        assert_eq!(value["sessionId"], "session-1");
        assert_eq!(value["state"], 1);
        assert_eq!(value["progress"], 50);
        assert_eq!(value["occurredAt"], "2026-01-01T00:00:00Z");
    }

    #[test]
    fn pty_pending_tail_stays_bounded() {
        let mut parser = OscProgressParser::new();
        // Adversarial input: ESC followed by many bytes that never form a
        // valid terminator must not accumulate without bound.
        let mut input = vec![ESCAPE_BYTE, OSC_BYTE];
        input.extend(vec![b'9'; 4096]);
        let parsed = parser.parse_chunk(&input);
        assert!(parsed.progress_events.is_empty());
        // Everything undecided must fit within the small bounded tail plus
        // whatever was just flushed to visible output.
        assert!(parser.pending.len() <= OSC_PROGRESS_MAX_PENDING_BYTES);
        assert_eq!(parsed.visible.len() + parser.pending.len(), input.len());
    }
}
