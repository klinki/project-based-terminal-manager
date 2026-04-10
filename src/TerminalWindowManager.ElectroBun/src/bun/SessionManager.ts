import { existsSync, unwatchFile, watchFile } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type {
	TerminalCommandFailure,
	TerminalDiagnosticNoticeMessage,
	TerminalErrorMessage,
	TerminalExitMessage,
	TerminalOutputMessage,
	TerminalProgressInfo,
	TerminalRecord,
	TerminalSessionFailure,
	TerminalStartedMessage,
} from "../shared/types";
import {
	appendOutputChunk,
	type CommandFailureEvent,
	createPowerShellBootstrapScript,
	createRecentOutputExcerpt,
	createSessionDiagnosticsPaths,
	stripAnsi,
} from "./TerminalDiagnostics";

type SessionHooks = {
	onOutput(message: TerminalOutputMessage): Promise<void> | void;
	onStarted(message: TerminalStartedMessage): Promise<void> | void;
	onExit(message: TerminalExitMessage): Promise<void> | void;
	onError(message: TerminalErrorMessage): Promise<void> | void;
	onDiagnosticNotice(message: TerminalDiagnosticNoticeMessage): Promise<void> | void;
	onProgress(message: {
		terminalId: string;
		sessionId: string;
		progressInfo: TerminalProgressInfo;
		occurredAt: string;
	}): Promise<void> | void;
	onStateChanged(): Promise<void> | void;
};

type HelperStartedEvent = {
	type: "started";
	sessionId: string;
	shellPid: number;
	shellPath: string;
	diagnosticLogPath: string;
	startedAt: string;
};

type HelperOutputEvent = {
	type: "output";
	dataBase64: string;
};

type HelperProgressEvent = {
	type: "terminalProgress";
	sessionId: string;
	state: number;
	progress: number;
	occurredAt: string;
};

type HelperExitEvent = {
	type: "exit";
	sessionId: string;
	exitCode: number | null;
	exitedAt: string;
	shellPid: number | null;
	shellPath: string;
	diagnosticLogPath: string;
	stderrExcerpt: string | null;
};

type HelperErrorEvent = {
	type: "error";
	sessionId: string | null;
	message: string;
	diagnosticLogPath: string | null;
	exceptionType: string | null;
	hresult: number | null;
	win32ErrorCode: number | null;
	occurredAt: string;
	shellPath: string | null;
	shellPid: number | null;
};

type HelperEvent =
	| HelperStartedEvent
	| HelperOutputEvent
	| HelperProgressEvent
	| HelperExitEvent
	| HelperErrorEvent;

type LiveSession = {
	terminalId: string;
	sessionId: string;
	child: ChildProcessWithoutNullStreams;
	outputReader: readline.Interface;
	eventsPath: string;
	recentOutputLines: string[];
	pendingOutputLine: string;
	helperStderrLines: string[];
	pendingHelperStderrLine: string;
	diagnosticsReadOffset: number;
	pendingDiagnosticsLine: string;
	diagnosticsReadTask: Promise<void>;
	isStopping: boolean;
	closed: boolean;
	receivedStartedEvent: boolean;
	receivedExitEvent: boolean;
	receivedErrorEvent: boolean;
};

type PersistedDiagnosticEvent =
	| {
			eventId: string;
			type: "sessionStarted";
			terminalId: string;
			sessionId: string;
			timestamp: string;
			shellPath: string;
			shellPid: number;
			diagnosticLogPath: string;
	  }
	| {
			eventId: string;
			type: "sessionExited";
			terminalId: string;
			sessionId: string;
			timestamp: string;
			exitCode: number | null;
			shellPath: string;
			shellPid: number | null;
			diagnosticLogPath: string;
			stderrExcerpt: string | null;
			recentOutputExcerpt: string;
	  }
	| {
			eventId: string;
			type: "sessionError";
			terminalId: string;
			sessionId: string | null;
			timestamp: string;
			message: string;
			shellPath: string | null;
			shellPid: number | null;
			diagnosticLogPath: string | null;
			exceptionType: string | null;
			hresult: number | null;
			win32ErrorCode: number | null;
			stderrExcerpt: string | null;
			recentOutputExcerpt: string;
	  };

const MAX_HELPER_STDERR_LINES = 40;

export class SessionManager {
	private readonly helperPathCandidates = this.createHelperPathCandidates();

	private readonly helperPath =
		this.helperPathCandidates.find((candidate) => existsSync(candidate)) ??
		this.helperPathCandidates[0];

	private readonly sessions = new Map<string, LiveSession>();

	constructor(private readonly hooks: SessionHooks) {}

	async ensureSession(
		terminal: TerminalRecord,
		cols: number,
		rows: number,
	): Promise<void> {
		const existing = this.sessions.get(terminal.id);
		if (existing && terminal.status !== "exited" && terminal.status !== "error") {
			await this.resizeTerminal(terminal.id, cols, rows);
			return;
		}

		if (!existsSync(this.helperPath)) {
			throw new Error(
				`ConPTY host executable was not found. Checked: ${this.helperPathCandidates.join(", ")}. Run the helper build first.`,
			);
		}

		const sessionId = crypto.randomUUID();
		const diagnosticsPaths = createSessionDiagnosticsPaths(terminal.id, sessionId);
		await writeFile(diagnosticsPaths.eventsPath, "", "utf8");

		let powerShellBootstrapPath: string | null = null;
		if (this.isPowerShellShell(terminal.shell)) {
			powerShellBootstrapPath = diagnosticsPaths.powerShellBootstrapPath;
			await writeFile(
				powerShellBootstrapPath,
				createPowerShellBootstrapScript({
					terminalId: terminal.id,
					sessionId,
					eventsPath: diagnosticsPaths.eventsPath,
				}),
				"utf8",
			);
		}

		terminal.status = "starting";
		terminal.progressInfo = this.createDefaultProgressInfo();
		terminal.lastStartedAt = new Date().toISOString();
		terminal.lastExitCode = null;
		terminal.diagnosticLogPath = diagnosticsPaths.eventsPath;
		terminal.lastCommandFailure = null;
		terminal.lastSessionFailure = null;
		await this.hooks.onStateChanged();

		const args = [
			"--cwd",
			terminal.cwd,
			"--shell",
			terminal.shell,
			"--cols",
			String(Math.max(20, cols)),
			"--rows",
			String(Math.max(5, rows)),
			"--session-id",
			sessionId,
			"--diagnostics-dir",
			diagnosticsPaths.directoryPath,
		];

		if (powerShellBootstrapPath) {
			args.push("--powershell-bootstrap", powerShellBootstrapPath);
		}

		const child = spawn(this.helperPath, args, {
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});

		const outputReader = readline.createInterface({ input: child.stdout });
		const liveSession: LiveSession = {
			terminalId: terminal.id,
			sessionId,
			child,
			outputReader,
			eventsPath: diagnosticsPaths.eventsPath,
			recentOutputLines: [],
			pendingOutputLine: "",
			helperStderrLines: [],
			pendingHelperStderrLine: "",
			diagnosticsReadOffset: 0,
			pendingDiagnosticsLine: "",
			diagnosticsReadTask: Promise.resolve(),
			isStopping: false,
			closed: false,
			receivedStartedEvent: false,
			receivedExitEvent: false,
			receivedErrorEvent: false,
		};

		this.sessions.set(terminal.id, liveSession);

		watchFile(
			liveSession.eventsPath,
			{ interval: 250, persistent: false },
			() => {
				void this.readDiagnosticsEvents(liveSession, terminal);
			},
		);

		outputReader.on("line", (line) => {
			void this.handleHelperLine(terminal, liveSession, line);
		});

		child.stderr.on("data", (chunk) => {
			this.captureHelperStderr(liveSession, chunk.toString("utf8"));
		});

		child.on("error", (error) => {
			void this.handleChildProcessError(terminal, liveSession, error);
		});

		child.on("exit", (code) => {
			void this.handleChildExit(terminal, liveSession, code);
		});
	}

	async sendInput(terminalId: string, data: string): Promise<void> {
		const session = this.getSessionOrThrow(terminalId);
		session.child.stdin.write(
			`${JSON.stringify({ type: "input", data })}\n`,
			"utf8",
		);
	}

	async resizeTerminal(
		terminalId: string,
		cols: number,
		rows: number,
	): Promise<void> {
		const session = this.getSessionOrThrow(terminalId);
		session.child.stdin.write(
			`${JSON.stringify({
				type: "resize",
				cols: Math.max(20, cols),
				rows: Math.max(5, rows),
			})}\n`,
			"utf8",
		);
	}

	async restartSession(
		terminal: TerminalRecord,
		cols: number,
		rows: number,
	): Promise<void> {
		await this.stopSession(terminal.id);
		terminal.status = "stopped";
		terminal.lastExitCode = null;
		await this.hooks.onStateChanged();
		await this.ensureSession(terminal, cols, rows);
	}

	async stopTerminal(terminalId: string): Promise<void> {
		await this.stopSession(terminalId);
	}

	async stopAll(): Promise<void> {
		await Promise.all(
			Array.from(this.sessions.keys()).map((terminalId) =>
				this.stopSession(terminalId),
			),
		);
	}

	private async stopSession(terminalId: string): Promise<void> {
		const session = this.sessions.get(terminalId);
		if (!session) {
			return;
		}

		session.isStopping = true;
		session.outputReader.close();
		session.child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`, "utf8");
		session.child.stdin.end();
		session.child.kill();
		this.cleanupSession(session);
	}

	private createHelperPathCandidates(): string[] {
		const helperSegments = [
			"TerminalWindowManager.ConPTYHost",
			"bin",
			"Debug",
			"net10.0-windows",
			"TerminalWindowManager.ConPTYHost.exe",
		];

		return [
			resolve(import.meta.dir, "..", ...helperSegments),
			resolve(import.meta.dir, "..", "..", "..", ...helperSegments),
			resolve(process.cwd(), "..", ...helperSegments),
		];
	}

	private getSessionOrThrow(terminalId: string): LiveSession {
		const session = this.sessions.get(terminalId);
		if (!session) {
			throw new Error(
				`Terminal session '${terminalId}' is not running yet. Activate the session before sending input.`,
			);
		}

		return session;
	}

	private async handleHelperLine(
		terminal: TerminalRecord,
		liveSession: LiveSession,
		line: string,
	): Promise<void> {
		let payload: HelperEvent;
		try {
			payload = JSON.parse(line) as HelperEvent;
		} catch {
			await this.emitSessionError(terminal, liveSession, {
				type: "error",
				sessionId: liveSession.sessionId,
				message: `The ConPTY helper emitted invalid JSON: ${line}`,
				diagnosticLogPath: liveSession.eventsPath,
				exceptionType: "JsonParseError",
				hresult: null,
				win32ErrorCode: null,
				occurredAt: new Date().toISOString(),
				shellPath: terminal.shell,
				shellPid: null,
			});
			return;
		}

		switch (payload.type) {
			case "started":
				liveSession.receivedStartedEvent = true;
				terminal.status = "running";
				terminal.diagnosticLogPath = payload.diagnosticLogPath;
				terminal.progressInfo = this.createDefaultProgressInfo();
				await this.appendDiagnosticEvent(liveSession.eventsPath, {
					eventId: crypto.randomUUID(),
					type: "sessionStarted",
					terminalId: terminal.id,
					sessionId: payload.sessionId,
					timestamp: payload.startedAt,
					shellPath: payload.shellPath,
					shellPid: payload.shellPid,
					diagnosticLogPath: payload.diagnosticLogPath,
				});
				await this.hooks.onStateChanged();
				await this.hooks.onStarted({
					terminalId: terminal.id,
					sessionId: payload.sessionId,
					shellPid: payload.shellPid,
					shellPath: payload.shellPath,
					diagnosticLogPath: payload.diagnosticLogPath,
					startedAt: payload.startedAt,
				});
				return;

			case "output":
				this.captureShellOutput(liveSession, payload.dataBase64);
				await this.hooks.onOutput({
					terminalId: terminal.id,
					dataBase64: payload.dataBase64,
				});
				return;

			case "terminalProgress": {
				if (payload.sessionId !== liveSession.sessionId) {
					return;
				}

				const progressInfo = this.mapProgressInfo(payload);
				if (!progressInfo) {
					return;
				}

				terminal.progressInfo = progressInfo;
				await this.hooks.onProgress({
					terminalId: terminal.id,
					sessionId: payload.sessionId,
					progressInfo,
					occurredAt: payload.occurredAt,
				});
				return;
			}

			case "exit":
				liveSession.receivedExitEvent = true;
				await this.emitSessionExit(terminal, liveSession, payload);
				return;

			case "error":
				liveSession.receivedErrorEvent = true;
				await this.emitSessionError(terminal, liveSession, payload);
				return;
		}
	}

	private async handleChildProcessError(
		terminal: TerminalRecord,
		liveSession: LiveSession,
		error: Error,
	): Promise<void> {
		if (this.sessions.get(terminal.id) !== liveSession) {
			this.cleanupSession(liveSession);
			return;
		}

		if (liveSession.isStopping || liveSession.receivedErrorEvent) {
			this.cleanupSession(liveSession);
			return;
		}

		await this.emitSessionError(terminal, liveSession, {
			type: "error",
			sessionId: liveSession.sessionId,
			message: `The ConPTY helper process failed: ${error.message}`,
			diagnosticLogPath: liveSession.eventsPath,
			exceptionType: error.name,
			hresult: null,
			win32ErrorCode: null,
			occurredAt: new Date().toISOString(),
			shellPath: terminal.shell,
			shellPid: null,
		});
	}

	private async handleChildExit(
		terminal: TerminalRecord,
		liveSession: LiveSession,
		code: number | null,
	): Promise<void> {
		if (this.sessions.get(terminal.id) !== liveSession) {
			this.cleanupSession(liveSession);
			return;
		}

		if (liveSession.isStopping) {
			this.cleanupSession(liveSession);
			return;
		}

		if (liveSession.receivedExitEvent || liveSession.receivedErrorEvent) {
			this.cleanupSession(liveSession);
			return;
		}

		if (liveSession.receivedStartedEvent) {
			await this.emitSessionExit(terminal, liveSession, {
				type: "exit",
				sessionId: liveSession.sessionId,
				exitCode: code,
				exitedAt: new Date().toISOString(),
				shellPid: null,
				shellPath: terminal.shell,
				diagnosticLogPath: liveSession.eventsPath,
				stderrExcerpt: this.getHelperStderrExcerpt(liveSession),
			});
			return;
		}

		await this.emitSessionError(terminal, liveSession, {
			type: "error",
			sessionId: liveSession.sessionId,
			message:
				"The ConPTY helper exited before the shell reported a successful startup.",
			diagnosticLogPath: liveSession.eventsPath,
			exceptionType: "HelperStartupExit",
			hresult: null,
			win32ErrorCode: null,
			occurredAt: new Date().toISOString(),
			shellPath: terminal.shell,
			shellPid: null,
		});
	}

	private async emitSessionExit(
		terminal: TerminalRecord,
		liveSession: LiveSession,
		payload: HelperExitEvent,
	): Promise<void> {
		const recentOutputExcerpt = this.getRecentOutputExcerpt(liveSession);
		const stderrExcerpt =
			payload.stderrExcerpt ?? this.getHelperStderrExcerpt(liveSession);

		terminal.status = "exited";
		terminal.progressInfo = this.createDefaultProgressInfo();
		terminal.lastExitCode = payload.exitCode;
		terminal.lastSessionFailure = {
			sessionId: payload.sessionId,
			timestamp: payload.exitedAt,
			exitCode: payload.exitCode,
			message: `The shell exited with code ${payload.exitCode ?? "unknown"}.`,
			shellPath: payload.shellPath,
			shellPid: payload.shellPid,
			stderrExcerpt,
			recentOutputExcerpt,
			exceptionType: null,
			hresult: null,
			win32ErrorCode: null,
		};

		await this.appendDiagnosticEvent(liveSession.eventsPath, {
			eventId: crypto.randomUUID(),
			type: "sessionExited",
			terminalId: terminal.id,
			sessionId: payload.sessionId,
			timestamp: payload.exitedAt,
			exitCode: payload.exitCode,
			shellPath: payload.shellPath,
			shellPid: payload.shellPid,
			diagnosticLogPath: payload.diagnosticLogPath,
			stderrExcerpt,
			recentOutputExcerpt,
		});

		await this.hooks.onStateChanged();
		await this.hooks.onExit({
			terminalId: terminal.id,
			sessionId: payload.sessionId,
			exitCode: payload.exitCode,
			exitedAt: payload.exitedAt,
			shellPid: payload.shellPid,
			shellPath: payload.shellPath,
			stderrExcerpt,
			recentOutputExcerpt,
		});

		this.cleanupSession(liveSession);
	}

	private async emitSessionError(
		terminal: TerminalRecord,
		liveSession: LiveSession,
		payload: HelperErrorEvent,
	): Promise<void> {
		const recentOutputExcerpt = this.getRecentOutputExcerpt(liveSession);
		const stderrExcerpt = this.getHelperStderrExcerpt(liveSession);
		const sessionFailure: TerminalSessionFailure = {
			sessionId: payload.sessionId ?? liveSession.sessionId,
			timestamp: payload.occurredAt,
			exitCode: null,
			message: payload.message,
			shellPath: payload.shellPath ?? terminal.shell,
			shellPid: payload.shellPid,
			stderrExcerpt,
			recentOutputExcerpt,
			exceptionType: payload.exceptionType,
			hresult: payload.hresult,
			win32ErrorCode: payload.win32ErrorCode,
		};

		terminal.status = "error";
		terminal.progressInfo = this.createDefaultProgressInfo();
		terminal.lastSessionFailure = sessionFailure;

		await this.appendDiagnosticEvent(liveSession.eventsPath, {
			eventId: crypto.randomUUID(),
			type: "sessionError",
			terminalId: terminal.id,
			sessionId: payload.sessionId,
			timestamp: payload.occurredAt,
			message: payload.message,
			shellPath: payload.shellPath,
			shellPid: payload.shellPid,
			diagnosticLogPath: payload.diagnosticLogPath,
			exceptionType: payload.exceptionType,
			hresult: payload.hresult,
			win32ErrorCode: payload.win32ErrorCode,
			stderrExcerpt,
			recentOutputExcerpt,
		});

		await this.hooks.onStateChanged();
		await this.hooks.onError({
			terminalId: terminal.id,
			sessionId: payload.sessionId,
			message: payload.message,
			diagnosticLogPath: payload.diagnosticLogPath,
			exceptionType: payload.exceptionType,
			hresult: payload.hresult,
			win32ErrorCode: payload.win32ErrorCode,
			recentOutputExcerpt,
		});

		this.cleanupSession(liveSession);
	}

	private captureShellOutput(liveSession: LiveSession, dataBase64: string): void {
		const chunkText = Buffer.from(dataBase64, "base64").toString("utf8");
		const outputState = appendOutputChunk(
			liveSession.recentOutputLines,
			liveSession.pendingOutputLine,
			chunkText,
		);
		liveSession.recentOutputLines = outputState.lines;
		liveSession.pendingOutputLine = outputState.pendingLine;
	}

	private captureHelperStderr(liveSession: LiveSession, chunkText: string): void {
		const outputState = appendOutputChunk(
			liveSession.helperStderrLines,
			liveSession.pendingHelperStderrLine,
			chunkText,
		);
		liveSession.helperStderrLines = outputState.lines.slice(-MAX_HELPER_STDERR_LINES);
		liveSession.pendingHelperStderrLine = outputState.pendingLine;
	}

	private getRecentOutputExcerpt(liveSession: LiveSession): string {
		return createRecentOutputExcerpt(
			liveSession.recentOutputLines,
			liveSession.pendingOutputLine,
		);
	}

	private getHelperStderrExcerpt(liveSession: LiveSession): string | null {
		const excerpt = createRecentOutputExcerpt(
			liveSession.helperStderrLines,
			liveSession.pendingHelperStderrLine,
		);
		return excerpt.length > 0 ? excerpt : null;
	}

	private async appendDiagnosticEvent(
		eventsPath: string,
		event: PersistedDiagnosticEvent,
	): Promise<void> {
		try {
			await appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
		} catch (error) {
			console.error("Failed to append diagnostic event.", error);
		}
	}

	private async readDiagnosticsEvents(
		liveSession: LiveSession,
		terminal: TerminalRecord,
	): Promise<void> {
		liveSession.diagnosticsReadTask = liveSession.diagnosticsReadTask.then(async () => {
			if (liveSession.closed) {
				return;
			}

			let buffer: Buffer;
			try {
				buffer = await readFile(liveSession.eventsPath);
			} catch {
				return;
			}

			if (buffer.length < liveSession.diagnosticsReadOffset) {
				liveSession.diagnosticsReadOffset = 0;
				liveSession.pendingDiagnosticsLine = "";
			}

			const nextBuffer = buffer.subarray(liveSession.diagnosticsReadOffset);
			liveSession.diagnosticsReadOffset = buffer.length;
			if (nextBuffer.length === 0) {
				return;
			}

			const text = `${liveSession.pendingDiagnosticsLine}${nextBuffer.toString("utf8")}`;
			const lines = text.split(/\r?\n/u);
			liveSession.pendingDiagnosticsLine = lines.pop() ?? "";

			for (const rawLine of lines) {
				const line = rawLine.trim();
				if (!line) {
					continue;
				}

				let payload: CommandFailureEvent | PersistedDiagnosticEvent;
				try {
					payload = JSON.parse(line) as CommandFailureEvent | PersistedDiagnosticEvent;
				} catch {
					continue;
				}

				if (payload.type !== "commandFailed") {
					continue;
				}

				if (payload.sessionId !== liveSession.sessionId) {
					continue;
				}

				const failure: TerminalCommandFailure = {
					sessionId: payload.sessionId,
					timestamp: payload.timestamp,
					commandText: stripAnsi(payload.commandText),
					exitCode: payload.exitCode,
					errorMessage: payload.errorMessage ? stripAnsi(payload.errorMessage) : null,
					cwd: payload.cwd,
					recentOutputExcerpt: this.getRecentOutputExcerpt(liveSession),
				};

				terminal.lastCommandFailure = failure;
				await this.hooks.onStateChanged();
				await this.hooks.onDiagnosticNotice({
					terminalId: terminal.id,
					message: this.createDiagnosticNoticeMessage(failure),
				});
			}
		});

		await liveSession.diagnosticsReadTask;
	}

	private createDiagnosticNoticeMessage(
		failure: TerminalCommandFailure,
	): string {
		const exitCodeText =
			failure.exitCode === null ? "unknown exit code" : `exit ${failure.exitCode}`;
		const commandText = failure.commandText.replaceAll(/\s+/gu, " ").trim();
		const summary =
			commandText.length > 96
				? `${commandText.slice(0, 93)}...`
				: commandText;
		return `Command failed (${exitCodeText}): ${summary || "unknown command"}`;
	}

	private createDefaultProgressInfo(): TerminalProgressInfo {
		return {
			state: "none",
			value: 0,
			updatedAt: new Date().toISOString(),
		};
	}

	private mapProgressInfo(payload: HelperProgressEvent): TerminalProgressInfo | null {
		const state = this.mapProgressState(payload.state);
		if (!state) {
			return null;
		}

		return {
			state,
			value:
				state === "none" || state === "indeterminate"
					? 0
					: Math.max(0, Math.min(100, payload.progress)),
			updatedAt: payload.occurredAt,
		};
	}

	private mapProgressState(value: number): TerminalProgressInfo["state"] | null {
		switch (value) {
			case 0:
				return "none";
			case 1:
				return "normal";
			case 2:
				return "error";
			case 3:
				return "indeterminate";
			case 4:
				return "warning";
			default:
				return null;
		}
	}

	private cleanupSession(liveSession: LiveSession): void {
		if (liveSession.closed) {
			return;
		}

		liveSession.closed = true;
		unwatchFile(liveSession.eventsPath);
		liveSession.outputReader.close();
		this.sessions.delete(liveSession.terminalId);
	}

	private isPowerShellShell(shell: string): boolean {
		const normalized = shell.trim().toLowerCase();
		return normalized.endsWith("pwsh") ||
			normalized.endsWith("pwsh.exe") ||
			normalized.endsWith("powershell") ||
			normalized.endsWith("powershell.exe");
	}
}
