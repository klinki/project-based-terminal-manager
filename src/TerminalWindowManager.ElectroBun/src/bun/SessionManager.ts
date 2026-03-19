import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type {
	TerminalErrorMessage,
	TerminalExitMessage,
	TerminalOutputMessage,
	TerminalRecord,
} from "../shared/types";

type SessionHooks = {
	onOutput(message: TerminalOutputMessage): Promise<void> | void;
	onStarted(terminalId: string): Promise<void> | void;
	onExit(message: TerminalExitMessage): Promise<void> | void;
	onError(message: TerminalErrorMessage): Promise<void> | void;
	onStateChanged(): Promise<void> | void;
};

type HelperEvent =
	| { type: "started"; pid: number }
	| { type: "output"; dataBase64: string }
	| { type: "exit"; exitCode: number | null }
	| { type: "error"; message: string };

type LiveSession = {
	terminalId: string;
	child: ChildProcessWithoutNullStreams;
	outputReader: readline.Interface;
};

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

		terminal.status = "starting";
		terminal.lastStartedAt = new Date().toISOString();
		terminal.lastExitCode = null;
		await this.hooks.onStateChanged();

		const child = spawn(
			this.helperPath,
			[
				"--cwd",
				terminal.cwd,
				"--shell",
				terminal.shell,
				"--cols",
				String(Math.max(20, cols)),
				"--rows",
				String(Math.max(5, rows)),
			],
			{
				stdio: ["pipe", "pipe", "pipe"],
				windowsHide: true,
			},
		);

		const outputReader = readline.createInterface({ input: child.stdout });
		const liveSession: LiveSession = {
			terminalId: terminal.id,
			child,
			outputReader,
		};

		this.sessions.set(terminal.id, liveSession);

		outputReader.on("line", (line) => {
			void this.handleHelperLine(terminal, line);
		});

		child.stderr.on("data", (chunk) => {
			const message = chunk.toString("utf8").trim();
			if (message.length > 0) {
				void this.hooks.onError({ terminalId: terminal.id, message });
			}
		});

		child.on("error", (error) => {
			this.sessions.delete(terminal.id);
			outputReader.close();
			terminal.status = "error";
			void this.hooks.onStateChanged();
			void this.hooks.onError({
				terminalId: terminal.id,
				message: error.message,
			});
		});

		child.on("exit", (code) => {
			this.sessions.delete(terminal.id);
			outputReader.close();
			if (terminal.status !== "exited" || terminal.lastExitCode !== code) {
				terminal.status = "exited";
				terminal.lastExitCode = code;
				void this.hooks.onStateChanged();
				void this.hooks.onExit({
					terminalId: terminal.id,
					exitCode: code,
				});
			}
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

		session.child.stdin.write(`${JSON.stringify({ type: "shutdown" })}\n`, "utf8");
		session.child.stdin.end();
		session.child.kill();
		this.sessions.delete(terminalId);
	}

	private createHelperPathCandidates(): string[] {
		const helperSegments = [
			"TerminalWindowManager.ConPTYHost",
			"bin",
			"Debug",
			"net8.0-windows",
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
		line: string,
	): Promise<void> {
		const payload = JSON.parse(line) as HelperEvent;

		switch (payload.type) {
			case "started":
				terminal.status = "running";
				await this.hooks.onStateChanged();
				await this.hooks.onStarted(terminal.id);
				return;

			case "output":
				await this.hooks.onOutput({
					terminalId: terminal.id,
					dataBase64: payload.dataBase64,
				});
				return;

			case "exit":
				terminal.status = "exited";
				terminal.lastExitCode = payload.exitCode;
				await this.hooks.onStateChanged();
				await this.hooks.onExit({
					terminalId: terminal.id,
					exitCode: payload.exitCode,
				});
				return;

			case "error":
				terminal.status = "error";
				await this.hooks.onStateChanged();
				await this.hooks.onError({
					terminalId: terminal.id,
					message: payload.message,
				});
				return;
		}
	}
}
