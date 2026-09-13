use std::backtrace::Backtrace;
use std::fs::{self, create_dir_all, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, Once, OnceLock};

use crate::crash_dialog::{self, CrashDialogContext};
use chrono::Utc;
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{json, Value};

pub const MAX_OUTPUT_LINES: usize = 100;
pub const RECENT_OUTPUT_EXCERPT_LINES: usize = 20;
pub const POSIX_SHELL_HOOK_MAX_BYTES: usize = 16 * 1024;
const APP_LOG_FILE_NAME: &str = "app.log";

static APP_LOG_DIRECTORY: OnceLock<Mutex<PathBuf>> = OnceLock::new();
static MAIN_THREAD_ID: OnceLock<std::thread::ThreadId> = OnceLock::new();
static PANIC_HOOK_INSTALLED: Once = Once::new();

static ANSI_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])").expect("ANSI stripping regex must compile")
});

#[derive(Debug, Clone)]
pub struct SessionDiagnosticsPaths {
    pub events_path: PathBuf,
    pub power_shell_bootstrap_path: PathBuf,
    pub posix_shell_hook_path: PathBuf,
    pub posix_zsh_dotdir_path: PathBuf,
}

pub fn default_app_data_dir(identifier: &str) -> PathBuf {
    let base_directory = std::env::var_os("APPDATA")
        .or_else(|| std::env::var_os("LOCALAPPDATA"))
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    base_directory.join(identifier)
}

pub fn create_app_log_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(APP_LOG_FILE_NAME)
}

pub fn configure_app_logging(app_data_dir: PathBuf) {
    let _ = MAIN_THREAD_ID.get_or_init(|| std::thread::current().id());

    if let Some(directory) = APP_LOG_DIRECTORY.get() {
        if let Ok(mut current_directory) = directory.lock() {
            *current_directory = app_data_dir.clone();
        }
    } else {
        let _ = APP_LOG_DIRECTORY.set(Mutex::new(app_data_dir.clone()));
    }

    PANIC_HOOK_INSTALLED.call_once(|| {
        std::panic::set_hook(Box::new(|panic_info| {
            let app_data_dir = current_app_log_directory();
            let thread_name = std::thread::current()
                .name()
                .map(ToString::to_string)
                .unwrap_or_else(|| "unnamed".to_string());
            let location = panic_info.location().map(|location| {
                format!(
                    "{}:{}:{}",
                    location.file(),
                    location.line(),
                    location.column()
                )
            });
            let payload = extract_panic_payload(panic_info);
            let backtrace = Backtrace::force_capture().to_string();
            let detail = json!({
                "thread": thread_name,
                "location": location,
            });
            let dialog_detail = create_panic_dialog_detail(&thread_name, location.as_deref());
            let detail_text = detail.to_string();

            let _ = append_app_log_entry(
                &app_data_dir,
                "fatal",
                "panic_hook",
                &payload,
                None,
                Some(&detail_text),
                Some(&backtrace),
            );

            let crash_snapshot_path = write_crash_snapshot(
                &app_data_dir,
                "fatal",
                "panic_hook",
                &payload,
                Some(detail),
                Some(&backtrace),
            )
            .ok();

            if is_main_app_thread() {
                crash_dialog::show_once(&CrashDialogContext {
                    message: &payload,
                    detail: Some(&dialog_detail),
                    app_data_dir: &app_data_dir,
                    crash_snapshot_path: crash_snapshot_path.as_deref(),
                });
            }
        }));
    });
}

pub fn append_app_log_entry(
    app_data_dir: &Path,
    level: &str,
    source: &str,
    message: &str,
    terminal_id: Option<&str>,
    detail: Option<&str>,
    stack: Option<&str>,
) -> io::Result<()> {
    create_dir_all(app_data_dir)?;
    let log_path = create_app_log_path(app_data_dir);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)?;

    let entry = json!({
        "timestamp": Utc::now().to_rfc3339(),
        "level": level,
        "source": source,
        "message": message,
        "terminalId": terminal_id,
        "detail": detail,
        "stack": stack,
    });

    writeln!(file, "{}", entry)
}

pub fn create_session_diagnostics_paths(
    app_data_dir: &Path,
    terminal_id: &str,
    session_id: &str,
) -> io::Result<SessionDiagnosticsPaths> {
    let directory_path = app_data_dir
        .join("terminal-diagnostics")
        .join(terminal_id)
        .join(session_id);
    create_dir_all(&directory_path)?;

    Ok(SessionDiagnosticsPaths {
        events_path: directory_path.join("events.jsonl"),
        power_shell_bootstrap_path: directory_path.join("powershell-bootstrap.ps1"),
        posix_shell_hook_path: directory_path.join("posix-shell-hook.sh"),
        posix_zsh_dotdir_path: directory_path.join("zsh-dotdir"),
    })
}

pub fn strip_ansi(text: &str) -> String {
    ANSI_PATTERN.replace_all(text, "").to_string()
}

pub fn append_output_chunk(lines: &mut Vec<String>, pending_line: &mut String, chunk_text: &str) {
    let normalized_chunk = strip_ansi(chunk_text)
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let combined = format!("{}{}", pending_line, normalized_chunk);
    let mut split_lines: Vec<String> = combined.split('\n').map(ToString::to_string).collect();
    *pending_line = split_lines.pop().unwrap_or_default();
    lines.extend(split_lines);

    if lines.len() > MAX_OUTPUT_LINES {
        let excess = lines.len() - MAX_OUTPUT_LINES;
        lines.drain(0..excess);
    }
}

pub fn create_recent_output_excerpt(lines: &[String], pending_line: &str) -> String {
    let mut materialized_lines = lines.to_vec();
    let trimmed_pending_line = pending_line.trim();
    if !trimmed_pending_line.is_empty() {
        materialized_lines.push(trimmed_pending_line.to_string());
    }

    materialized_lines
        .into_iter()
        .rev()
        .take(RECENT_OUTPUT_EXCERPT_LINES)
        .collect::<Vec<String>>()
        .into_iter()
        .rev()
        .collect::<Vec<String>>()
        .join("\n")
        .trim()
        .to_string()
}

pub fn write_crash_snapshot(
    app_data_dir: &Path,
    level: &str,
    source: &str,
    message: &str,
    detail: Option<Value>,
    stack: Option<&str>,
) -> io::Result<PathBuf> {
    let crash_snapshot = json!({
        "timestamp": Utc::now().to_rfc3339(),
        "level": level,
        "source": source,
        "message": message,
        "detail": detail,
        "stack": stack,
    });
    let crash_path = create_crash_snapshot_path(app_data_dir);
    let serialized = serde_json::to_string_pretty(&crash_snapshot)
        .unwrap_or_else(|_| "Failed to serialize crash snapshot.".to_string());
    fs::write(&crash_path, serialized)?;
    Ok(crash_path)
}

pub fn create_power_shell_bootstrap_script(
    terminal_id: &str,
    session_id: &str,
    events_path: &Path,
) -> String {
    let terminal_id = escape_power_shell_literal(terminal_id);
    let session_id = escape_power_shell_literal(session_id);
    let events_path = escape_power_shell_literal(&events_path.display().to_string());

    [
        format!("$script:__twmTerminalId = '{}'", terminal_id),
        format!("$script:__twmSessionId = '{}'", session_id),
        format!("$script:__twmEventsPath = '{}'", events_path),
        "$script:__twmLastHistoryId = $null".to_string(),
        "$script:__twmLastReportedCwd = $null".to_string(),
        String::new(),
        "try {".to_string(),
        "\t$history = Get-History -Count 1 -ErrorAction Stop".to_string(),
        "\tif ($history) {".to_string(),
        "\t\t$script:__twmLastHistoryId = $history.Id".to_string(),
        "\t}".to_string(),
        "} catch {".to_string(),
        "\t$script:__twmLastHistoryId = $null".to_string(),
        "}".to_string(),
        String::new(),
        "function global:prompt {".to_string(),
        "\t$lastSuccess = $?".to_string(),
        "\t$nativeExitCode = if ($null -ne $global:LASTEXITCODE) { [int]$global:LASTEXITCODE } else { $null }".to_string(),
        "\t$topError = if ($error.Count -gt 0 -and $null -ne $error[0]) { ($error[0] | Out-String).Trim() } else { $null }".to_string(),
        "\t$latestHistory = $null".to_string(),
        String::new(),
        "\ttry {".to_string(),
        "\t\t$latestHistory = Get-History -Count 1 -ErrorAction Stop".to_string(),
        "\t} catch {".to_string(),
        "\t\t$latestHistory = $null".to_string(),
        "\t}".to_string(),
        String::new(),
        "\t$currentCwd = (Get-Location).Path".to_string(),
        "\tif ($currentCwd -ne $script:__twmLastReportedCwd) {".to_string(),
        "\t\t$script:__twmLastReportedCwd = $currentCwd".to_string(),
        "\t\t$cwdEvent = @{".to_string(),
        "\t\t\teventId = [guid]::NewGuid().ToString()".to_string(),
        "\t\t\ttype = 'cwdChanged'".to_string(),
        "\t\t\tterminalId = $script:__twmTerminalId".to_string(),
        "\t\t\tsessionId = $script:__twmSessionId".to_string(),
        "\t\t\ttimestamp = [DateTimeOffset]::UtcNow.ToString('o')".to_string(),
        "\t\t\tcwd = $currentCwd".to_string(),
        "\t\t}".to_string(),
        String::new(),
        "\t\t$cwdJson = $cwdEvent | ConvertTo-Json -Compress -Depth 5".to_string(),
        "\t\t$encoding = [System.Text.UTF8Encoding]::new($false)".to_string(),
        "\t\t[System.IO.File]::AppendAllText($script:__twmEventsPath, $cwdJson + [Environment]::NewLine, $encoding)".to_string(),
        "\t}".to_string(),
        String::new(),
        "\tif ($latestHistory -and $latestHistory.Id -ne $script:__twmLastHistoryId) {".to_string(),
        "\t\t$script:__twmLastHistoryId = $latestHistory.Id".to_string(),
        "\t\tif ((-not $lastSuccess) -or ($null -ne $nativeExitCode -and $nativeExitCode -ne 0)) {".to_string(),
        "\t\t\t$event = @{".to_string(),
        "\t\t\t\teventId = [guid]::NewGuid().ToString()".to_string(),
        "\t\t\t\ttype = 'commandFailed'".to_string(),
        "\t\t\t\tterminalId = $script:__twmTerminalId".to_string(),
        "\t\t\t\tsessionId = $script:__twmSessionId".to_string(),
        "\t\t\t\ttimestamp = [DateTimeOffset]::UtcNow.ToString('o')".to_string(),
        "\t\t\t\tcommandText = $latestHistory.CommandLine".to_string(),
        "\t\t\t\texitCode = if ($null -ne $nativeExitCode) { $nativeExitCode } else { $null }".to_string(),
        "\t\t\t\terrorMessage = $topError".to_string(),
        "\t\t\t\tcwd = (Get-Location).Path".to_string(),
        "\t\t\t}".to_string(),
        String::new(),
        "\t\t\t$json = $event | ConvertTo-Json -Compress -Depth 5".to_string(),
        "\t\t\t$encoding = [System.Text.UTF8Encoding]::new($false)".to_string(),
        "\t\t\t[System.IO.File]::AppendAllText($script:__twmEventsPath, $json + [Environment]::NewLine, $encoding)".to_string(),
        "\t\t}".to_string(),
        "\t}".to_string(),
        String::new(),
        "\t'PS ' + (Get-Location) + '> '".to_string(),
        "}".to_string(),
        String::new(),
        "Set-Location -LiteralPath (Get-Location).Path".to_string(),
    ]
    .join("\n")
}

fn escape_power_shell_literal(value: &str) -> String {
    value.replace("'", "''")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PosixShellKind {
    Zsh,
    Bash,
    Sh,
}

pub fn escape_posix_single_quote(value: &str) -> String {
    value.replace('\'', "'\\''")
}

pub fn classify_posix_shell(shell: &str) -> Option<PosixShellKind> {
    let trimmed = shell.trim();
    if trimmed.is_empty() {
        return None;
    }

    let program = if trimmed.starts_with('\'') || trimmed.starts_with('"') {
        let quote = trimmed.chars().next().unwrap_or('"');
        match trimmed[1..].find(quote) {
            Some(end) => trimmed[1..1 + end].trim(),
            None => trimmed
                .trim_matches(|c| c == '\'' || c == '"')
                .trim(),
        }
    } else {
        trimmed
            .split_whitespace()
            .next()
            .unwrap_or("")
            .trim_matches(|c| c == '\'' || c == '"')
            .trim()
    };

    let program = program
        .trim()
        .trim_matches(|c| c == '\'' || c == '"')
        .trim();
    if program.is_empty() {
        return None;
    }

    let base = program
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(program)
        .trim();
    if base.is_empty() {
        return None;
    }

    let mut lower = base.to_ascii_lowercase();
    if let Some(stripped) = lower.strip_suffix(".exe") {
        lower = stripped.to_string();
    }

    match lower.as_str() {
        "zsh" => Some(PosixShellKind::Zsh),
        "bash" => Some(PosixShellKind::Bash),
        "sh" => Some(PosixShellKind::Sh),
        _ => None,
    }
}

pub fn create_posix_bash_sh_hook_script(
    terminal_id: &str,
    session_id: &str,
    events_path: &Path,
) -> String {
    let terminal_id_escaped = escape_posix_single_quote(terminal_id);
    let session_id_escaped = escape_posix_single_quote(session_id);
    let events_path_escaped = escape_posix_single_quote(&events_path.display().to_string());

    let script = [
        "# __TWM POSIX shell hook (bash/sh) - generated, do not edit.".to_string(),
        "# Emits cwdChanged/commandFailed JSONL for session diagnostics (best-effort).".to_string(),
        "# Wiring: sourced via PROMPT_COMMAND chaining snippet and ENV (see pty_host).".to_string(),
        "# (zsh uses precmd_functions via ZDOTDIR shim instead of PROMPT_COMMAND).".to_string(),
        "# NOTE: command text uses `history 1` (not `fc -ln -1`) as the primary source".to_string(),
        "# because on macOS bash 3.2 `fc` evaluated inside PROMPT_COMMAND returns the".to_string(),
        "# PREVIOUS command (proven: failures misattributed one command late), while".to_string(),
        "# `history 1` returns the current one (proven correct incl. exit codes).".to_string(),
        "# `fc -ln -1` is kept only as a fallback when `history 1` yields empty".to_string(),
        "# (shells without the history builtin).".to_string(),
        "case $- in".to_string(),
        "*i*) ;;".to_string(),
        "*) return 0 2>/dev/null || exit 0 ;;".to_string(),
        "esac".to_string(),
        r#"if [ "${__twm_sourced:-0}" = "1" ]; then"#.to_string(),
        "    return 0 2>/dev/null || exit 0".to_string(),
        "fi || true".to_string(),
        "__twm_sourced=1 || true".to_string(),
        format!("__twm_terminal_id='{}'", terminal_id_escaped),
        format!("__twm_session_id='{}'", session_id_escaped),
        format!("__twm_events_default='{}'", events_path_escaped),
        r#"if [ -n "${__TWM_EVENTS_PATH:-}" ]; then"#.to_string(),
        r#"    __twm_events="$__TWM_EVENTS_PATH" || true"#.to_string(),
        "else".to_string(),
        r#"    __twm_events="$__twm_events_default" || true"#.to_string(),
        "fi || true".to_string(),
        r#"__twm_last_cwd="" || true"#.to_string(),
        r#"if [ -z "${__twm_env_sourced:-}" ]; then"#.to_string(),
        "    __twm_env_sourced=1 || true".to_string(),
        r#"    if [ -n "${__TWM_ORIG_ENV:-}" ] && [ -f "$__TWM_ORIG_ENV" ]; then"#.to_string(),
        r#"        . "$__TWM_ORIG_ENV" >/dev/null 2>&1 || true"#.to_string(),
        "    fi || true".to_string(),
        "fi || true".to_string(),
        "__twm_json_escape() {".to_string(),
        r#"    printf '%s' "$1" 2>/dev/null | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' 2>/dev/null | tr '\n' ' ' 2>/dev/null | tr '\t' ' ' 2>/dev/null || true"#.to_string(),
        "}".to_string(),
        "__twm_on_prompt() {".to_string(),
        r#"    __twm_ec="$1" || true"#.to_string(),
        r#"    __twm_cwd="$(pwd 2>/dev/null || printf '%s' "$PWD" 2>/dev/null || true)" || true"#.to_string(),
        r#"    if [ "$__twm_cwd" != "$__twm_last_cwd" ]; then"#.to_string(),
        r#"        __twm_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_cwd_esc="$(__twm_json_escape "$__twm_cwd" 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_tid_esc="$(__twm_json_escape "$__twm_terminal_id" 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_sid_esc="$(__twm_json_escape "$__twm_session_id" 2>/dev/null || true)" || true"#.to_string(),
        r#"        printf '{"eventId":null,"type":"cwdChanged","terminalId":"%s","sessionId":"%s","timestamp":"%s","cwd":"%s"}\n' "$__twm_tid_esc" "$__twm_sid_esc" "$__twm_ts" "$__twm_cwd_esc" >> "$__twm_events" 2>/dev/null || true"#.to_string(),
        r#"        __twm_last_cwd="$__twm_cwd" || true"#.to_string(),
        "    fi || true".to_string(),
        r#"    if [ "$__twm_ec" -ne 0 ] 2>/dev/null; then"#.to_string(),
        r#"        __twm_cmd="$(history 1 2>/dev/null | sed 's/^[[:space:]]*[0-9][0-9]*[[:space:]]*//' 2>/dev/null || true)" || true"#.to_string(),
        r#"        if [ -z "$__twm_cmd" ]; then"#.to_string(),
        r#"            __twm_cmd="$(fc -ln -1 2>/dev/null | sed 's/^[[:space:]]*//' 2>/dev/null || true)" || true"#.to_string(),
        "        fi || true".to_string(),
        r#"        __twm_cmd_esc="$(__twm_json_escape "$__twm_cmd" 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_cwd_esc="$(__twm_json_escape "$__twm_cwd" 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_tid_esc="$(__twm_json_escape "$__twm_terminal_id" 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_sid_esc="$(__twm_json_escape "$__twm_session_id" 2>/dev/null || true)" || true"#.to_string(),
        r#"        printf '{"eventId":null,"type":"commandFailed","terminalId":"%s","sessionId":"%s","timestamp":"%s","commandText":"%s","exitCode":%s,"errorMessage":null,"cwd":"%s"}\n' "$__twm_tid_esc" "$__twm_sid_esc" "$__twm_ts" "$__twm_cmd_esc" "$__twm_ec" "$__twm_cwd_esc" >> "$__twm_events" 2>/dev/null || true"#.to_string(),
        "    fi || true".to_string(),
        r#"    return "$__twm_ec""#.to_string(),
        "}".to_string(),
    ]
    .join("\n");
    debug_assert!(
        script.len() <= POSIX_SHELL_HOOK_MAX_BYTES,
        "bash/sh hook exceeds size cap"
    );
    script
}

pub fn create_posix_zsh_hook_script(
    terminal_id: &str,
    session_id: &str,
    events_path: &Path,
) -> String {
    let terminal_id_escaped = escape_posix_single_quote(terminal_id);
    let session_id_escaped = escape_posix_single_quote(session_id);
    let events_path_escaped = escape_posix_single_quote(&events_path.display().to_string());

    let script = [
        "# __TWM POSIX zsh hook - generated, do not edit.".to_string(),
        "# Emits cwdChanged/commandFailed JSONL via precmd (best-effort).".to_string(),
        "# (bash/sh use PROMPT_COMMAND chaining + ENV instead).".to_string(),
        "# Command text via `fc -ln -1` (VERIFIED correct in zsh precmd via live pty test).".to_string(),
        "case $- in".to_string(),
        "*i*) ;;".to_string(),
        "*) return 0 2>/dev/null || exit 0 ;;".to_string(),
        "esac".to_string(),
        r#"if [ "${__twm_sourced:-0}" = "1" ]; then"#.to_string(),
        "    return 0 2>/dev/null || exit 0".to_string(),
        "fi || true".to_string(),
        "__twm_sourced=1 || true".to_string(),
        format!("__twm_terminal_id='{}'", terminal_id_escaped),
        format!("__twm_session_id='{}'", session_id_escaped),
        format!("__twm_events_default='{}'", events_path_escaped),
        r#"if [ -n "${__TWM_EVENTS_PATH:-}" ]; then"#.to_string(),
        r#"    __twm_events="$__TWM_EVENTS_PATH" || true"#.to_string(),
        "else".to_string(),
        r#"    __twm_events="$__twm_events_default" || true"#.to_string(),
        "fi || true".to_string(),
        r#"__twm_last_cwd="" || true"#.to_string(),
        "__twm_json_escape() {".to_string(),
        r#"    printf '%s' "$1" 2>/dev/null | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' 2>/dev/null | tr '\n' ' ' 2>/dev/null | tr '\t' ' ' 2>/dev/null || true"#.to_string(),
        "}".to_string(),
        "__twm_precmd() {".to_string(),
        "    __twm_ec=$? || true".to_string(),
        r#"    __twm_cwd="$(pwd 2>/dev/null || printf '%s' "$PWD" 2>/dev/null || true)" || true"#.to_string(),
        r#"    if [ "$__twm_cwd" != "$__twm_last_cwd" ]; then"#.to_string(),
        r#"        __twm_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_cwd_esc="$(__twm_json_escape "$__twm_cwd" 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_tid_esc="$(__twm_json_escape "$__twm_terminal_id" 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_sid_esc="$(__twm_json_escape "$__twm_session_id" 2>/dev/null || true)" || true"#.to_string(),
        r#"        printf '{"eventId":null,"type":"cwdChanged","terminalId":"%s","sessionId":"%s","timestamp":"%s","cwd":"%s"}\n' "$__twm_tid_esc" "$__twm_sid_esc" "$__twm_ts" "$__twm_cwd_esc" >> "$__twm_events" 2>/dev/null || true"#.to_string(),
        r#"        __twm_last_cwd="$__twm_cwd" || true"#.to_string(),
        "    fi || true".to_string(),
        r#"    if [ "$__twm_ec" -ne 0 ] 2>/dev/null; then"#.to_string(),
        r#"        __twm_cmd="$(fc -ln -1 2>/dev/null | sed 's/^[[:space:]]*//' 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_cmd_esc="$(__twm_json_escape "$__twm_cmd" 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_cwd_esc="$(__twm_json_escape "$__twm_cwd" 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_tid_esc="$(__twm_json_escape "$__twm_terminal_id" 2>/dev/null || true)" || true"#.to_string(),
        r#"        __twm_sid_esc="$(__twm_json_escape "$__twm_session_id" 2>/dev/null || true)" || true"#.to_string(),
        r#"        printf '{"eventId":null,"type":"commandFailed","terminalId":"%s","sessionId":"%s","timestamp":"%s","commandText":"%s","exitCode":%s,"errorMessage":null,"cwd":"%s"}\n' "$__twm_tid_esc" "$__twm_sid_esc" "$__twm_ts" "$__twm_cmd_esc" "$__twm_ec" "$__twm_cwd_esc" >> "$__twm_events" 2>/dev/null || true"#.to_string(),
        "    fi || true".to_string(),
        r#"    return "$__twm_ec" 2>/dev/null || true"#.to_string(),
        "}".to_string(),
        "# Append to precmd_functions without overwriting existing hooks.".to_string(),
        r#"if [ -z "${precmd_functions[(r)__twm_precmd]:-}" ]; then"#.to_string(),
        "    precmd_functions+=(__twm_precmd) || true".to_string(),
        "fi || true".to_string(),
    ]
    .join("\n");
    debug_assert!(
        script.len() <= POSIX_SHELL_HOOK_MAX_BYTES,
        "zsh hook exceeds size cap"
    );
    script
}

pub fn create_zshrc_shim() -> String {
    let script = [
        "# __TWM zshrc shim - generated, do not edit.".to_string(),
        "# Sources the user's original .zshrc first, then the hook.".to_string(),
        r#"if [ -n "${__twm_zdotdir_shimmed:-}" ]; then"#.to_string(),
        "    return 0 2>/dev/null || exit 0".to_string(),
        "fi || true".to_string(),
        "__twm_zdotdir_shimmed=1 || true".to_string(),
        r#"if [ -n "${__TWM_ORIG_ZDOTDIR:-}" ] && [ "${__TWM_ORIG_ZDOTDIR:-}" != "$ZDOTDIR" ]; then"#.to_string(),
        r#"    if [ -f "$__TWM_ORIG_ZDOTDIR/.zshrc" ]; then"#.to_string(),
        r#"        . "$__TWM_ORIG_ZDOTDIR/.zshrc" >/dev/null 2>&1 || true"#.to_string(),
        "    fi || true".to_string(),
        r#"elif [ -n "${HOME:-}" ] && [ -f "$HOME/.zshrc" ]; then"#.to_string(),
        r#"    . "$HOME/.zshrc" >/dev/null 2>&1 || true"#.to_string(),
        "fi || true".to_string(),
        r#"if [ -n "${__TWM_POSIX_HOOK:-}" ] && [ -f "$__TWM_POSIX_HOOK" ]; then"#.to_string(),
        r#"    . "$__TWM_POSIX_HOOK" >/dev/null 2>&1 || true"#.to_string(),
        "fi || true".to_string(),
    ]
    .join("\n");
    debug_assert!(
        script.len() <= POSIX_SHELL_HOOK_MAX_BYTES,
        "zshrc shim exceeds size cap"
    );
    script
}

pub fn create_zshenv_shim() -> String {
    let script = [
        "# __TWM zshenv shim - generated, do not edit.".to_string(),
        "# Preserves the user's original .zshenv.".to_string(),
        r#"if [ -n "${__twm_zshenv_shimmed:-}" ]; then"#.to_string(),
        "    return 0 2>/dev/null || exit 0".to_string(),
        "fi || true".to_string(),
        "__twm_zshenv_shimmed=1 || true".to_string(),
        r#"if [ -n "${__TWM_ORIG_ZDOTDIR:-}" ] && [ "${__TWM_ORIG_ZDOTDIR:-}" != "$ZDOTDIR" ]; then"#.to_string(),
        r#"    if [ -f "$__TWM_ORIG_ZDOTDIR/.zshenv" ]; then"#.to_string(),
        r#"        . "$__TWM_ORIG_ZDOTDIR/.zshenv" >/dev/null 2>&1 || true"#.to_string(),
        "    fi || true".to_string(),
        r#"elif [ -n "${HOME:-}" ] && [ -f "$HOME/.zshenv" ]; then"#.to_string(),
        r#"    . "$HOME/.zshenv" >/dev/null 2>&1 || true"#.to_string(),
        "fi || true".to_string(),
    ]
    .join("\n");
    debug_assert!(
        script.len() <= POSIX_SHELL_HOOK_MAX_BYTES,
        "zshenv shim exceeds size cap"
    );
    script
}

fn current_app_log_directory() -> PathBuf {
    APP_LOG_DIRECTORY
        .get()
        .and_then(|directory| directory.lock().ok().map(|path| path.clone()))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

fn create_crash_snapshot_path(app_data_dir: &Path) -> PathBuf {
    let timestamp = Utc::now().format("%Y%m%dT%H%M%SZ");
    app_data_dir.join(format!("app-crash-{}.log", timestamp))
}

fn extract_panic_payload(panic_info: &std::panic::PanicHookInfo<'_>) -> String {
    if let Some(message) = panic_info.payload().downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = panic_info.payload().downcast_ref::<String>() {
        message.clone()
    } else {
        "The application panicked with a non-string payload.".to_string()
    }
}

fn create_panic_dialog_detail(thread_name: &str, location: Option<&str>) -> String {
    match location {
        Some(location) => format!("Thread: {thread_name}\nLocation: {location}"),
        None => format!("Thread: {thread_name}"),
    }
}

fn is_main_app_thread() -> bool {
    MAIN_THREAD_ID
        .get()
        .is_some_and(|main_thread_id| *main_thread_id == std::thread::current().id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn sample_events_path() -> PathBuf {
        PathBuf::from("/tmp/twm-events/events.jsonl")
    }

    #[test]
    fn classify_accepts_zsh_bash_sh_variants() {
        assert_eq!(classify_posix_shell("zsh"), Some(PosixShellKind::Zsh));
        assert_eq!(classify_posix_shell("/bin/zsh"), Some(PosixShellKind::Zsh));
        assert_eq!(
            classify_posix_shell("/usr/local/bin/zsh"),
            Some(PosixShellKind::Zsh)
        );
        assert_eq!(classify_posix_shell("ZSH"), Some(PosixShellKind::Zsh));
        assert_eq!(
            classify_posix_shell("\"/bin/zsh\""),
            Some(PosixShellKind::Zsh)
        );
        assert_eq!(classify_posix_shell("'zsh'"), Some(PosixShellKind::Zsh));
        assert_eq!(
            classify_posix_shell("/bin/zsh -i"),
            Some(PosixShellKind::Zsh)
        );

        assert_eq!(classify_posix_shell("bash"), Some(PosixShellKind::Bash));
        assert_eq!(classify_posix_shell("/bin/bash"), Some(PosixShellKind::Bash));
        assert_eq!(
            classify_posix_shell("/usr/local/bin/bash"),
            Some(PosixShellKind::Bash)
        );
        assert_eq!(classify_posix_shell("BASH"), Some(PosixShellKind::Bash));
        assert_eq!(
            classify_posix_shell("'/bin/bash'"),
            Some(PosixShellKind::Bash)
        );
        assert_eq!(
            classify_posix_shell("/bin/bash -l"),
            Some(PosixShellKind::Bash)
        );

        assert_eq!(classify_posix_shell("sh"), Some(PosixShellKind::Sh));
        assert_eq!(classify_posix_shell("/bin/sh"), Some(PosixShellKind::Sh));
        assert_eq!(classify_posix_shell("SH"), Some(PosixShellKind::Sh));
        assert_eq!(classify_posix_shell("\"sh\""), Some(PosixShellKind::Sh));
    }

    #[test]
    fn classify_rejects_non_posix_shells() {
        assert_eq!(classify_posix_shell(""), None);
        assert_eq!(classify_posix_shell("   "), None);
        assert_eq!(classify_posix_shell("pwsh"), None);
        assert_eq!(classify_posix_shell("pwsh.exe"), None);
        assert_eq!(classify_posix_shell("powershell"), None);
        assert_eq!(classify_posix_shell("powershell.exe"), None);
        assert_eq!(
            classify_posix_shell("/usr/local/bin/pwsh"),
            None
        );
        assert_eq!(classify_posix_shell("cmd"), None);
        assert_eq!(classify_posix_shell("cmd.exe"), None);
        assert_eq!(classify_posix_shell("fish"), None);
        assert_eq!(classify_posix_shell("/usr/bin/fish"), None);
        assert_eq!(classify_posix_shell("FISH"), None);
        assert_eq!(classify_posix_shell("python3"), None);
        assert_eq!(classify_posix_shell("nu"), None);
    }

    #[test]
    fn bash_hook_contains_markers_and_guards() {
        let hook =
            create_posix_bash_sh_hook_script("term-1", "sess-1", &sample_events_path());
        assert!(hook.contains("PROMPT_COMMAND"), "missing PROMPT_COMMAND marker");
        assert!(hook.contains("ENV"), "missing ENV marker");
        assert!(hook.contains("precmd"), "missing precmd cross-ref marker");
        assert!(hook.contains("case $-"), "missing non-interactive guard");
        assert!(hook.contains("__twm_sourced"), "missing double-source guard");
        assert!(hook.contains("__twm_last_cwd"), "missing cwd dedup var");
        assert!(hook.contains(">>"), "missing JSONL append");
        assert!(hook.contains("__TWM_ORIG_ENV"), "missing ORIG_ENV preservation");
        assert!(hook.contains("__TWM_EVENTS_PATH"), "missing events env var");
        assert!(hook.contains("|| true"), "missing best-effort guards");
    }

    #[test]
    fn zsh_hook_contains_precmd_and_guards() {
        let hook =
            create_posix_zsh_hook_script("term-1", "sess-1", &sample_events_path());
        assert!(hook.contains("precmd_functions"), "missing precmd_functions");
        assert!(hook.contains("precmd"), "missing precmd marker");
        assert!(hook.contains("PROMPT_COMMAND"), "missing PROMPT_COMMAND cross-ref");
        assert!(hook.contains("ENV"), "missing ENV cross-ref");
        assert!(hook.contains("case $-"), "missing non-interactive guard");
        assert!(hook.contains("__twm_sourced"), "missing double-source guard");
        assert!(hook.contains("__twm_last_cwd"), "missing cwd dedup var");
        assert!(hook.contains(">>"), "missing JSONL append");
        assert!(hook.contains("|| true"), "missing best-effort guards");
        assert!(
            hook.contains("precmd_functions+=(__twm_precmd)"),
            "must append to precmd_functions without overwriting"
        );
        assert!(
            !hook.contains("precmd_functions=(__twm_precmd)"),
            "must never overwrite precmd_functions"
        );
        assert!(
            hook.contains("fc -ln -1"),
            "zsh command text must use fc -ln -1"
        );
    }

    #[test]
    fn hooks_emit_expected_json_field_names() {
        let bash = create_posix_bash_sh_hook_script("t", "s", &sample_events_path());
        let zsh = create_posix_zsh_hook_script("t", "s", &sample_events_path());
        for hook in [&bash, &zsh] {
            for field in [
                "\"eventId\":null",
                "\"type\":\"cwdChanged\"",
                "\"type\":\"commandFailed\"",
                "\"terminalId\"",
                "\"sessionId\"",
                "\"timestamp\"",
                "\"cwd\"",
                "\"commandText\"",
                "\"exitCode\"",
                "\"errorMessage\":null",
            ] {
                assert!(hook.contains(field), "missing JSON field {field}");
            }
        }
    }

    #[test]
    fn quoting_handles_spaces_and_quotes() {
        assert_eq!(escape_posix_single_quote("a'b"), "a'\\''b");
        assert_eq!(escape_posix_single_quote("plain"), "plain");
        assert_eq!(
            escape_posix_single_quote("/tmp/my dir/x"),
            "/tmp/my dir/x"
        );

        let events = PathBuf::from("/tmp/my dir with spaces/events.jsonl");
        let hook = create_posix_bash_sh_hook_script(
            "term id'with\"quotes",
            "sess id'with\"quotes",
            &events,
        );
        assert!(hook.contains("__twm_terminal_id='term id'\\''with\"quotes'"));
        assert!(hook.contains("__twm_session_id='sess id'\\''with\"quotes'"));
        assert!(hook.contains("__twm_events_default='/tmp/my dir with spaces/events.jsonl'"));

        let zsh = create_posix_zsh_hook_script("a'b", "c'd", &events);
        assert!(zsh.contains("__twm_terminal_id='a'\\''b'"));
    }

    #[test]
    fn hooks_stay_small_and_avoid_heavy_tools() {
        let bash = create_posix_bash_sh_hook_script("t", "s", &sample_events_path());
        let zsh = create_posix_zsh_hook_script("t", "s", &sample_events_path());
        let zshrc = create_zshrc_shim();
        let zshenv = create_zshenv_shim();
        for script in [&bash, &zsh, &zshrc, &zshenv] {
            assert!(
                script.len() <= POSIX_SHELL_HOOK_MAX_BYTES,
                "script exceeds cap: {} bytes",
                script.len()
            );
            assert_eq!(POSIX_SHELL_HOOK_MAX_BYTES, 16 * 1024);
            let lower = script.to_lowercase();
            assert!(!lower.contains("python"), "must not use python");
            assert!(!script.contains("jq"), "must not use jq");
        }
    }

    #[test]
    fn zsh_shims_preserve_order_and_guard_recursion() {
        let zshrc = create_zshrc_shim();
        assert!(zshrc.contains("__TWM_ORIG_ZDOTDIR"), "missing orig zdotdir");
        assert!(zshrc.contains("$HOME"), "missing HOME fallback");
        assert!(zshrc.contains(".zshrc"), "missing user rc");
        assert!(
            zshrc.contains("__TWM_POSIX_HOOK"),
            "missing hook sourcing"
        );
        assert!(
            zshrc.contains("__twm_zdotdir_shimmed"),
            "missing anti-recursion guard"
        );
        let rc_pos = zshrc.find(".zshrc").expect("zshrc must mention .zshrc");
        let hook_pos = zshrc
            .find("__TWM_POSIX_HOOK")
            .expect("zshrc must mention hook");
        assert!(
            rc_pos < hook_pos,
            "shim must source user rc before the hook"
        );

        let zshenv = create_zshenv_shim();
        assert!(zshenv.contains(".zshenv"), "missing user zshenv");
        assert!(
            zshenv.contains("__twm_zshenv_shimmed"),
            "missing anti-recursion guard"
        );
        assert!(zshenv.contains("__TWM_ORIG_ZDOTDIR"), "missing orig zdotdir");
    }

    #[test]
    fn session_paths_include_posix_files() {
        let base = std::env::temp_dir().join(format!("twm-diag-test-{}", uuid::Uuid::new_v4()));
        let paths =
            create_session_diagnostics_paths(&base, "term-1", "sess-1").expect("paths create");
        assert_eq!(paths.events_path.file_name().unwrap(), "events.jsonl");
        assert_eq!(
            paths.power_shell_bootstrap_path.file_name().unwrap(),
            "powershell-bootstrap.ps1"
        );
        assert_eq!(
            paths.posix_shell_hook_path.file_name().unwrap(),
            "posix-shell-hook.sh"
        );
        assert_eq!(
            paths.posix_zsh_dotdir_path.file_name().unwrap(),
            "zsh-dotdir"
        );
        assert!(paths.events_path.parent().unwrap().is_dir());
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn bash_hook_uses_history_not_fc_primary() {
        let hook =
            create_posix_bash_sh_hook_script("term-1", "sess-1", &sample_events_path());
        assert!(
            hook.contains("history 1"),
            "bash hook must use `history 1` (fc lags one command on macOS bash 3.2)"
        );
        assert!(
            hook.contains("s/^[[:space:]]*[0-9][0-9]*[[:space:]]*//"),
            "missing history-number stripping sed pattern"
        );
        assert!(hook.contains("fc -ln -1"), "missing fc fallback");
        let history_pos = hook.find("history 1").expect("history 1 present");
        let fc_pos = hook.find("fc -ln -1").expect("fc present");
        assert!(
            history_pos < fc_pos,
            "`history 1` must be primary, `fc -ln -1` only fallback"
        );
        assert!(
            hook.contains("macOS bash 3.2"),
            "missing comment explaining the fc-lag fix"
        );
        assert!(
            hook.contains("return \"$__twm_ec\""),
            "prompt handler must preserve $? via return"
        );
    }
}
