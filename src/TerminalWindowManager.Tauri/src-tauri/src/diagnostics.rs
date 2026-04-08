use std::fs::create_dir_all;
use std::io;
use std::path::{Path, PathBuf};

use once_cell::sync::Lazy;
use regex::Regex;

pub const MAX_OUTPUT_LINES: usize = 100;
pub const RECENT_OUTPUT_EXCERPT_LINES: usize = 20;

static ANSI_PATTERN: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])").expect("ANSI stripping regex must compile")
});

#[derive(Debug, Clone)]
pub struct SessionDiagnosticsPaths {
    pub events_path: PathBuf,
    pub power_shell_bootstrap_path: PathBuf,
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
