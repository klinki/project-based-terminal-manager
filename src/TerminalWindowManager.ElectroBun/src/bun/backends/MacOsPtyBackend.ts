import { appendFile } from "node:fs/promises";
import type { IPty } from "node-pty";
import type {
	TerminalErrorMessage,
	TerminalRecord,
	TerminalSessionFailure,
} from "../../shared/types";
import {
	appendOutputChunk,
	createRecentOutputExcerpt,
	createSessionDiagnosticsPaths,
} from "../TerminalDiagnostics";
import type {
	SessionHooks,
	TerminalSessionBackend,
} from "./TerminalSessionBackend";

type NodePtyModule = typeof import("node-pty");

type LiveSession = {
	terminalId: string;
	sessionId: string;
	pty: IPty;
	eventsPath: string;
	recentOutputLines: string[];
	pendingOutputLine: string;
	isStopping: boolean;
	closed: boolean;
	shellPath: string;
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

export class MacOsPtyBackend implements TerminalSessionBackend {
	private readonly sessions = new Map<string, LiveSession>();
	private nodePtyModulePromise: Promise<NodePtyModule> | null = null;

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

		const sessionId = crypto.randomUUID();
		const diagnosticsPaths = createSessionDiagnosticsPaths(terminal.id, sessionId);
		const shellPath = this.resolveShellPath(terminal.shell);
		const args = this.createShellArgs(shellPath);
		const env = this.createShellEnvironment(terminal);
		const nodePty = await this.getNodePtyModule();

		terminal.status = "starting";
		terminal.lastStartedAt = new Date().toISOString();
		terminal.lastExitCode = null;
		terminal.diagnosticLogPath = diagnosticsPaths.eventsPath;
		terminal.lastCommandFailure = null;
		terminal.lastSessionFailure = null;
		await this.hooks.onStateChanged();

		let pty: IPty;
		try {
			pty = nodePty.spawn(shellPath, args, {
				name: env.TERM,
				cwd: terminal.cwd,
				env,
				cols: Math.max(20, cols),
				rows: Math.max(5, rows),
			});
		} catch (error) {
			await this.emitSessionError(
				terminal,
				null,
				sessionId,
				diagnosticsPaths.eventsPath,
				error instanceof Error ? error : new Error(String(error)),
				shellPath,
			);
			return;
		}

		const liveSession: LiveSession = {
			terminalId: terminal.id,
			sessionId,
			pty,
			eventsPath: diagnosticsPaths.eventsPath,
			recentOutputLines: [],
			pendingOutputLine: "",
			isStopping: false,
			closed: false,
			shellPath,
		};

		this.sessions.set(terminal.id, liveSession);

		await this.appendDiagnosticEvent(liveSession.eventsPath, {
			eventId: crypto.randomUUID(),
			type: "sessionStarted",
			terminalId: terminal.id,
			sessionId,
			timestamp: terminal.lastStartedAt,
			shellPath,
			shellPid: pty.pid,
			diagnosticLogPath: diagnosticsPaths.eventsPath,
		});

		terminal.status = "running";
		await this.hooks.onStateChanged();
		await this.hooks.onStarted({
			terminalId: terminal.id,
			sessionId,
			shellPid: pty.pid,
			shellPath,
			diagnosticLogPath: diagnosticsPaths.eventsPath,
			startedAt: terminal.lastStartedAt ?? new Date().toISOString(),
		});

		pty.onData((data) => {
			this.captureShellOutput(liveSession, data);
			void this.hooks.onOutput({
				terminalId: terminal.id,
				dataBase64: Buffer.from(data, "utf8").toString("base64"),
			});
		});

		pty.onExit(({ exitCode }) => {
			void this.handlePtyExit(terminal, liveSession, exitCode);
		});
	}

	async sendInput(terminalId: string, data: string): Promise<void> {
		const session = this.getSessionOrThrow(terminalId);
		session.pty.write(data);
	}

	async resizeTerminal(
		terminalId: string,
		cols: number,
		rows: number,
	): Promise<void> {
		const session = this.getSessionOrThrow(terminalId);
		session.pty.resize(Math.max(20, cols), Math.max(5, rows));
	}

	async restartSession(
		terminal: TerminalRecord,
		cols: number,
		rows: number,
	): Promise<void> {
		await this.stopTerminal(terminal.id);
		terminal.status = "stopped";
		terminal.lastExitCode = null;
		await this.hooks.onStateChanged();
		await this.ensureSession(terminal, cols, rows);
	}

	async stopTerminal(terminalId: string): Promise<void> {
		const session = this.sessions.get(terminalId);
		if (!session) {
			return;
		}

		session.isStopping = true;
		session.pty.kill();
		this.cleanupSession(session);
	}

	async stopAll(): Promise<void> {
		await Promise.all(
			Array.from(this.sessions.keys()).map((terminalId) =>
				this.stopTerminal(terminalId),
			),
		);
	}

	private async getNodePtyModule(): Promise<NodePtyModule> {
		this.nodePtyModulePromise ??= import("node-pty");
		return this.nodePtyModulePromise;
	}

	private resolveShellPath(configuredShell: string): string {
		const candidate = configuredShell.trim();
		if (candidate) {
			return candidate;
		}

		return process.env["SHELL"] || "/bin/zsh";
	}

	private createShellArgs(shellPath: string): string[] {
		const lowerShellPath = shellPath.toLowerCase();
		if (
			lowerShellPath.endsWith("/zsh") ||
			lowerShellPath.endsWith("/bash") ||
			lowerShellPath.endsWith("/sh")
		) {
			return ["-l"];
		}

		return [];
	}

	private createShellEnvironment(terminal: TerminalRecord): Record<string, string> {
		return {
			...process.env,
			SHELL: this.resolveShellPath(terminal.shell),
			TERM: process.env["TERM"] || "xterm-256color",
			COLORTERM: process.env["COLORTERM"] || "truecolor",
		};
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

	private captureShellOutput(liveSession: LiveSession, chunkText: string): void {
		const outputState = appendOutputChunk(
			liveSession.recentOutputLines,
			liveSession.pendingOutputLine,
			chunkText,
		);
		liveSession.recentOutputLines = outputState.lines;
		liveSession.pendingOutputLine = outputState.pendingLine;
	}

	private async handlePtyExit(
		terminal: TerminalRecord,
		liveSession: LiveSession,
		exitCode: number,
	): Promise<void> {
		if (this.sessions.get(terminal.id) !== liveSession) {
			this.cleanupSession(liveSession);
			return;
		}

		if (liveSession.isStopping) {
			this.cleanupSession(liveSession);
			return;
		}

		const recentOutputExcerpt = createRecentOutputExcerpt(
			liveSession.recentOutputLines,
			liveSession.pendingOutputLine,
		);
		const exitedAt = new Date().toISOString();

		terminal.status = "exited";
		terminal.lastExitCode = exitCode;
		terminal.lastSessionFailure = {
			sessionId: liveSession.sessionId,
			timestamp: exitedAt,
			exitCode,
			message: `The shell exited with code ${exitCode}.`,
			shellPath: liveSession.shellPath,
			shellPid: liveSession.pty.pid,
			stderrExcerpt: null,
			recentOutputExcerpt,
			exceptionType: null,
			hresult: null,
			win32ErrorCode: null,
		};

		await this.appendDiagnosticEvent(liveSession.eventsPath, {
			eventId: crypto.randomUUID(),
			type: "sessionExited",
			terminalId: terminal.id,
			sessionId: liveSession.sessionId,
			timestamp: exitedAt,
			exitCode,
			shellPath: liveSession.shellPath,
			shellPid: liveSession.pty.pid,
			diagnosticLogPath: liveSession.eventsPath,
			stderrExcerpt: null,
			recentOutputExcerpt,
		});

		await this.hooks.onStateChanged();
		await this.hooks.onExit({
			terminalId: terminal.id,
			sessionId: liveSession.sessionId,
			exitCode,
			exitedAt,
			shellPid: liveSession.pty.pid,
			shellPath: liveSession.shellPath,
			stderrExcerpt: null,
			recentOutputExcerpt,
		});

		this.cleanupSession(liveSession);
	}

	private async emitSessionError(
		terminal: TerminalRecord,
		liveSession: LiveSession | null,
		sessionId: string,
		eventsPath: string,
		error: Error,
		shellPath: string,
	): Promise<void> {
		const recentOutputExcerpt = liveSession
			? createRecentOutputExcerpt(
					liveSession.recentOutputLines,
					liveSession.pendingOutputLine,
			  )
			: "";
		const occurredAt = new Date().toISOString();
		const sessionFailure: TerminalSessionFailure = {
			sessionId,
			timestamp: occurredAt,
			exitCode: null,
			message: error.message,
			shellPath,
			shellPid: liveSession?.pty.pid ?? null,
			stderrExcerpt: null,
			recentOutputExcerpt,
			exceptionType: error.name,
			hresult: null,
			win32ErrorCode: null,
		};

		terminal.status = "error";
		terminal.lastSessionFailure = sessionFailure;

		await this.appendDiagnosticEvent(eventsPath, {
			eventId: crypto.randomUUID(),
			type: "sessionError",
			terminalId: terminal.id,
			sessionId,
			timestamp: occurredAt,
			message: error.message,
			shellPath,
			shellPid: liveSession?.pty.pid ?? null,
			diagnosticLogPath: eventsPath,
			exceptionType: error.name,
			hresult: null,
			win32ErrorCode: null,
			stderrExcerpt: null,
			recentOutputExcerpt,
		});

		await this.hooks.onStateChanged();
		await this.hooks.onError({
			terminalId: terminal.id,
			sessionId,
			message: error.message,
			diagnosticLogPath: eventsPath,
			exceptionType: error.name,
			hresult: null,
			win32ErrorCode: null,
			recentOutputExcerpt,
		} satisfies TerminalErrorMessage);

		if (liveSession) {
			this.cleanupSession(liveSession);
		}
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

	private cleanupSession(liveSession: LiveSession): void {
		if (liveSession.closed) {
			return;
		}

		liveSession.closed = true;
		this.sessions.delete(liveSession.terminalId);
	}
}
