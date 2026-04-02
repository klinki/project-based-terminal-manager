import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Utils } from "electrobun/bun";

const ANSI_PATTERN =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI stripping is intentional.
	/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export const MAX_OUTPUT_LINES = 100;
export const RECENT_OUTPUT_EXCERPT_LINES = 20;

export interface SessionDiagnosticsPaths {
	directoryPath: string;
	eventsPath: string;
	powerShellBootstrapPath: string;
}

export interface CommandFailureEvent {
	eventId?: string;
	type: "commandFailed";
	terminalId: string;
	sessionId: string;
	timestamp: string;
	commandText: string;
	exitCode: number | null;
	errorMessage: string | null;
	cwd: string;
}

export function createSessionDiagnosticsPaths(
	terminalId: string,
	sessionId: string,
): SessionDiagnosticsPaths {
	const directoryPath = join(
		Utils.paths.userData,
		"terminal-diagnostics",
		terminalId,
		sessionId,
	);
	mkdirSync(directoryPath, { recursive: true });

	return {
		directoryPath,
		eventsPath: join(directoryPath, "events.jsonl"),
		powerShellBootstrapPath: join(directoryPath, "powershell-bootstrap.ps1"),
	};
}

export function stripAnsi(text: string): string {
	return text.replaceAll(ANSI_PATTERN, "");
}

export function appendOutputChunk(
	lines: string[],
	pendingLine: string,
	chunkText: string,
): {
	lines: string[];
	pendingLine: string;
} {
	const normalizedChunk = stripAnsi(chunkText).replaceAll("\r\n", "\n").replaceAll(
		"\r",
		"\n",
	);
	const combined = `${pendingLine}${normalizedChunk}`;
	const splitLines = combined.split("\n");
	const nextPendingLine = splitLines.pop() ?? "";
	const nextLines = [...lines];

	for (const line of splitLines) {
		nextLines.push(line);
	}

	if (nextLines.length > MAX_OUTPUT_LINES) {
		nextLines.splice(0, nextLines.length - MAX_OUTPUT_LINES);
	}

	return {
		lines: nextLines,
		pendingLine: nextPendingLine,
	};
}

export function createRecentOutputExcerpt(
	lines: string[],
	pendingLine: string,
): string {
	const materializedLines = [...lines];
	const trimmedPendingLine = pendingLine.trim();
	if (trimmedPendingLine.length > 0) {
		materializedLines.push(trimmedPendingLine);
	}

	return materializedLines
		.slice(-RECENT_OUTPUT_EXCERPT_LINES)
		.join("\n")
		.trim();
}

export function createPowerShellBootstrapScript(options: {
	terminalId: string;
	sessionId: string;
	eventsPath: string;
}): string {
	const terminalId = escapePowerShellLiteral(options.terminalId);
	const sessionId = escapePowerShellLiteral(options.sessionId);
	const eventsPath = escapePowerShellLiteral(options.eventsPath);

	return [
		`$script:__twmTerminalId = '${terminalId}'`,
		`$script:__twmSessionId = '${sessionId}'`,
		`$script:__twmEventsPath = '${eventsPath}'`,
		"$script:__twmLastHistoryId = $null",
		"",
		"try {",
		"\t$history = Get-History -Count 1 -ErrorAction Stop",
		"\tif ($history) {",
		"\t\t$script:__twmLastHistoryId = $history.Id",
		"\t}",
		"} catch {",
		"\t$script:__twmLastHistoryId = $null",
		"}",
		"",
		"function global:prompt {",
		"\t$lastSuccess = $?",
		"\t$nativeExitCode = if ($null -ne $global:LASTEXITCODE) { [int]$global:LASTEXITCODE } else { $null }",
		"\t$topError = if ($error.Count -gt 0 -and $null -ne $error[0]) { ($error[0] | Out-String).Trim() } else { $null }",
		"\t$latestHistory = $null",
		"",
		"\ttry {",
		"\t\t$latestHistory = Get-History -Count 1 -ErrorAction Stop",
		"\t} catch {",
		"\t\t$latestHistory = $null",
		"\t}",
		"",
		"\tif ($latestHistory -and $latestHistory.Id -ne $script:__twmLastHistoryId) {",
		"\t\t$script:__twmLastHistoryId = $latestHistory.Id",
		"\t\tif ((-not $lastSuccess) -or ($null -ne $nativeExitCode -and $nativeExitCode -ne 0)) {",
		"\t\t\t$event = @{",
		"\t\t\t\teventId = [guid]::NewGuid().ToString()",
		"\t\t\t\ttype = 'commandFailed'",
		"\t\t\t\tterminalId = $script:__twmTerminalId",
		"\t\t\t\tsessionId = $script:__twmSessionId",
		"\t\t\t\ttimestamp = [DateTimeOffset]::UtcNow.ToString('o')",
		"\t\t\t\tcommandText = $latestHistory.CommandLine",
		"\t\t\t\texitCode = if ($null -ne $nativeExitCode) { $nativeExitCode } else { $null }",
		"\t\t\t\terrorMessage = $topError",
		"\t\t\t\tcwd = (Get-Location).Path",
		"\t\t\t}",
		"",
		"\t\t\t$json = $event | ConvertTo-Json -Compress -Depth 5",
		"\t\t\t$encoding = [System.Text.UTF8Encoding]::new($false)",
		"\t\t\t[System.IO.File]::AppendAllText($script:__twmEventsPath, $json + [Environment]::NewLine, $encoding)",
		"\t\t}",
		"\t}",
		"",
		"\t'PS ' + (Get-Location) + '> '",
		"}",
		"",
		"Set-Location -LiteralPath (Get-Location).Path",
	].join("\n");
}

function escapePowerShellLiteral(value: string): string {
	return value.replaceAll("'", "''");
}
