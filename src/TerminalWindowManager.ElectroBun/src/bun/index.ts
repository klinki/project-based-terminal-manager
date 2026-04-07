import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import type {
	AppState,
	ProjectRecord,
	TerminalActivity,
	TerminalActivityPhase,
	TerminalCommandFailure,
	TerminalDiagnosticNoticeMessage,
	TerminalErrorMessage,
	TerminalExitMessage,
	TerminalManagerRpc,
	TerminalRecord,
	TerminalStartedMessage,
} from "../shared/types";
import { AppStateStore } from "./AppStateStore";
import { SessionManager } from "./SessionManager";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const INPUT_SETTLE_MS = 1100;
const OUTPUT_SETTLE_MS = 1600;
const activityTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === "dev") {
		try {
			await fetch(DEV_SERVER_URL, { method: "HEAD" });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
			);
		}
	}

	return "views://mainview/index.html";
}

const stateStore = new AppStateStore();
const state = stateStore.load();

const rpc = BrowserView.defineRPC<TerminalManagerRpc>({
	handlers: {
		requests: {
			getInitialState: () => snapshotState(),

			createProject: ({ name }) => {
				const trimmedName = name.trim();
				if (!trimmedName) {
					throw new Error("Project name cannot be empty.");
				}

				state.projects.push({
					id: crypto.randomUUID(),
					name: trimmedName,
					createdAt: new Date().toISOString(),
				});

				persistState();
				return snapshotState();
			},

			renameProject: ({ projectId, name }) => {
				const project = findProject(projectId);
				const trimmedName = name.trim();
				if (!trimmedName) {
					throw new Error("Project name cannot be empty.");
				}

				project.name = trimmedName;
				persistState();
				return snapshotState();
			},

			deleteProject: async ({ projectId }) => {
				const project = findProject(projectId);
				const projectTerminals = state.terminals.filter(
					(terminal) => terminal.projectId === project.id,
				);

				await Promise.all(
					projectTerminals.map(async (terminal) => {
						clearActivityTimer(terminal.id);
						await sessionManager.stopTerminal(terminal.id);
					}),
				);

				state.projects = state.projects.filter(
					(candidate) => candidate.id !== project.id,
				);
				state.terminals = state.terminals.filter(
					(terminal) => terminal.projectId !== project.id,
				);

				if (
					state.activeTerminalId &&
					projectTerminals.some((terminal) => terminal.id === state.activeTerminalId)
				) {
					state.activeTerminalId = null;
				}

				persistState();
				return snapshotState();
			},

			createTerminal: ({ projectId, name, cwd, shell }) => {
				const project = findProject(projectId);
				const trimmedName = name.trim();
				const trimmedCwd = cwd.trim();
				if (!trimmedName) {
					throw new Error("Terminal name cannot be empty.");
				}

				if (!trimmedCwd) {
					throw new Error("Terminal working directory cannot be empty.");
				}

				state.terminals.push({
					id: crypto.randomUUID(),
					projectId: project.id,
					name: trimmedName,
					cwd: trimmedCwd,
					shell: shell?.trim() || state.defaults.defaultShell,
					status: "stopped",
					activity: createActivity(
						"idle",
						"Not started",
						"Activate this terminal to start a live session.",
						0,
						false,
					),
					lastExitCode: null,
					createdAt: new Date().toISOString(),
					lastStartedAt: null,
					diagnosticLogPath: null,
					lastCommandFailure: null,
					lastSessionFailure: null,
				});

				persistState();
				return snapshotState();
			},

			renameTerminal: ({ terminalId, name }) => {
				const terminal = findTerminal(terminalId);
				const trimmedName = name.trim();
				if (!trimmedName) {
					throw new Error("Terminal name cannot be empty.");
				}

				terminal.name = trimmedName;
				persistState();
				return snapshotState();
			},

			deleteTerminal: async ({ terminalId }) => {
				const terminal = findTerminal(terminalId);
				clearActivityTimer(terminal.id);
				await sessionManager.stopTerminal(terminal.id);

				state.terminals = state.terminals.filter(
					(candidate) => candidate.id !== terminal.id,
				);
				if (state.activeTerminalId === terminal.id) {
					state.activeTerminalId = null;
				}

				persistState();
				return snapshotState();
			},

			activateTerminal: async ({ terminalId, cols, rows }) => {
				const terminal = findTerminal(terminalId);
				state.activeTerminalId = terminal.id;
				updateTerminalActivity(
					terminal.id,
					"working",
					"Starting session",
					"Launching the ConPTY helper and shell.",
					14,
					true,
				);
				persistState();
				await sessionManager.ensureSession(terminal, cols, rows);
				return snapshotState();
			},

			sendInput: async ({ terminalId, data }) => {
				const terminal = findTerminal(terminalId);
				const inputActivity = describeInputActivity(data);
				updateTerminalActivity(
					terminal.id,
					"working",
					inputActivity.summary,
					inputActivity.detail,
					inputActivity.progress,
					true,
				);
				scheduleActivity(terminal.id, INPUT_SETTLE_MS, () => {
					updateTerminalActivity(
						terminal.id,
						"waiting",
						"Waiting for output",
						"The shell accepted input and is waiting to respond.",
						52,
						true,
					);
				});
				await sessionManager.sendInput(terminalId, data);
				return { ok: true };
			},

			resizeTerminal: async ({ terminalId, cols, rows }) => {
				await sessionManager.resizeTerminal(terminalId, cols, rows);
				return { ok: true };
			},

			restartTerminal: async ({ terminalId, cols, rows }) => {
				const terminal = findTerminal(terminalId);
				state.activeTerminalId = terminal.id;
				updateTerminalActivity(
					terminal.id,
					"working",
					"Restarting session",
					"Stopping the current shell and starting a new one.",
					18,
					true,
				);
				persistState();
				await sessionManager.restartSession(terminal, cols, rows);
				return snapshotState();
			},

			updateDefaults: ({ defaultCwd, defaultShell }) => {
				const trimmedCwd = defaultCwd.trim();
				const trimmedShell = defaultShell.trim();

				if (trimmedCwd) {
					state.defaults.defaultCwd = trimmedCwd;
				}

				if (trimmedShell) {
					state.defaults.defaultShell = trimmedShell;
				}

				persistState();
				return snapshotState();
			},

			windowMinimize: () => {
				mainWindow.minimize();
				return { ok: true };
			},

			windowMaximize: () => {
				if (mainWindow.isMaximized()) {
					mainWindow.unmaximize();
				} else {
					mainWindow.maximize();
				}
				return { ok: true };
			},

			windowClose: () => {
				mainWindow.close();
				return { ok: true };
			},
		},
		messages: {},
	},
});

let mainWindow!: BrowserWindow<typeof rpc>;

function snapshotState(): AppState {
	return structuredClone(state);
}

function getWebviewRpc(): typeof rpc {
	const webviewRpc = mainWindow.webview.rpc;
	if (!webviewRpc) {
		throw new Error("The main webview RPC bridge is not initialized.");
	}

	return webviewRpc;
}

async function pushStateChanged(): Promise<void> {
	await getWebviewRpc().proxy.send.stateChanged(snapshotState());
}

function persistState(): void {
	stateStore.save(state);
}

function findProject(projectId: string): ProjectRecord {
	const project = state.projects.find((candidate) => candidate.id === projectId);
	if (!project) {
		throw new Error(`Project '${projectId}' was not found.`);
	}

	return project;
}

function findTerminal(terminalId: string): TerminalRecord {
	const terminal = state.terminals.find((candidate) => candidate.id === terminalId);
	if (!terminal) {
		throw new Error(`Terminal '${terminalId}' was not found.`);
	}

	return terminal;
}

function createActivity(
	phase: TerminalActivityPhase,
	summary: string,
	detail: string,
	progress: number,
	isIndeterminate: boolean,
): TerminalActivity {
	return {
		phase,
		summary,
		detail,
		progress,
		isIndeterminate,
		updatedAt: new Date().toISOString(),
	};
}

function hasActivityChanged(
	previous: TerminalActivity,
	next: TerminalActivity,
): boolean {
	return (
		previous.phase !== next.phase ||
		previous.summary !== next.summary ||
		previous.detail !== next.detail ||
		previous.progress !== next.progress ||
		previous.isIndeterminate !== next.isIndeterminate
	);
}

function updateTerminalActivity(
	terminalId: string,
	phase: TerminalActivityPhase,
	summary: string,
	detail: string,
	progress: number,
	isIndeterminate: boolean,
): void {
	const terminal = findTerminal(terminalId);
	const previous = terminal.activity;
	const next = createActivity(
		phase,
		summary,
		detail,
		progress,
		isIndeterminate,
	);
	if (!hasActivityChanged(previous, next)) {
		return;
	}

	terminal.activity = next;
	void pushStateChanged();
}

function clearActivityTimer(terminalId: string): void {
	const timer = activityTimers.get(terminalId);
	if (!timer) {
		return;
	}

	clearTimeout(timer);
	activityTimers.delete(terminalId);
}

function scheduleActivity(
	terminalId: string,
	delayMs: number,
	callback: () => void,
): void {
	clearActivityTimer(terminalId);
	const timer = setTimeout(() => {
		activityTimers.delete(terminalId);
		callback();
	}, delayMs);
	activityTimers.set(terminalId, timer);
}

function describeInputActivity(data: string): {
	summary: string;
	detail: string;
	progress: number;
} {
	if (data.includes("\r") || data.includes("\n")) {
		return {
			summary: "Running command",
			detail: "Submitted input to the shell and waiting for output.",
			progress: 44,
		};
	}

	return {
		summary: "Sending input",
		detail: "Forwarding interactive input to the shell.",
		progress: 28,
	};
}

const sessionManager = new SessionManager({
	onOutput: async (message) => {
		updateTerminalActivity(
			message.terminalId,
			"streaming",
			"Streaming output",
			"Receiving live terminal output from the shell.",
			74,
			true,
		);
		scheduleActivity(message.terminalId, OUTPUT_SETTLE_MS, () => {
			const terminal = findTerminal(message.terminalId);
			if (terminal.status !== "running") {
				return;
			}

			updateTerminalActivity(
				message.terminalId,
				"waiting",
				"Ready",
				"Output has settled. The shell is waiting for the next command.",
				100,
				false,
			);
		});
		await getWebviewRpc().proxy.send.terminalOutput(message);
	},
	onStarted: async (message: TerminalStartedMessage) => {
		updateTerminalActivity(
			message.terminalId,
			"waiting",
			"Ready",
			`Shell started successfully (PID ${message.shellPid}) and is waiting for input.`,
			100,
			false,
		);
		await getWebviewRpc().proxy.send.terminalStarted(message);
	},
	onExit: async (message: TerminalExitMessage) => {
		clearActivityTimer(message.terminalId);
		updateTerminalActivity(
			message.terminalId,
			"idle",
			"Session exited",
			describeSessionExit(message),
			100,
			false,
		);
		await getWebviewRpc().proxy.send.terminalExit(message);
		await pushStateChanged();
	},
	onError: async (message: TerminalErrorMessage) => {
		clearActivityTimer(message.terminalId);
		updateTerminalActivity(
			message.terminalId,
			"attention",
			"Session error",
			describeSessionError(message),
			100,
			false,
		);
		await getWebviewRpc().proxy.send.terminalError(message);
		await pushStateChanged();
	},
	onDiagnosticNotice: async (message: TerminalDiagnosticNoticeMessage) => {
		const terminal = findTerminal(message.terminalId);
		updateTerminalActivity(
			message.terminalId,
			"attention",
			"Command failed",
			describeCommandFailure(terminal.lastCommandFailure),
			100,
			false,
		);
		await getWebviewRpc().proxy.send.terminalDiagnosticNotice(message);
		await pushStateChanged();
	},
	onStateChanged: async () => {
		persistState();
		await pushStateChanged();
	},
});

const url = await getMainViewUrl();

mainWindow = new BrowserWindow<typeof rpc>({
	title: "Terminal Window Manager (ElectroBun)",
	url,
	titleBarStyle: "hidden",
	frame: {
		width: 1480,
		height: 920,
		x: 120,
		y: 120,
	},
	rpc,
});

process.on("exit", () => {
	for (const timer of activityTimers.values()) {
		clearTimeout(timer);
	}

	void sessionManager.stopAll();
});

console.log("Terminal Window Manager ElectroBun PoC started.");

function describeSessionExit(message: TerminalExitMessage): string {
	const details = [
		`The shell exited with code ${message.exitCode ?? "unknown"}.`,
	];
	if (message.stderrExcerpt) {
		details.push(`Helper stderr: ${message.stderrExcerpt}`);
	}
	if (message.recentOutputExcerpt) {
		details.push(`Recent output: ${message.recentOutputExcerpt}`);
	}

	return details.join(" ");
}

function describeSessionError(message: TerminalErrorMessage): string {
	const details = [message.message];
	if (message.win32ErrorCode !== null) {
		details.push(`Win32 ${message.win32ErrorCode}.`);
	}
	if (message.hresult !== null) {
		details.push(`HRESULT ${message.hresult}.`);
	}
	if (message.recentOutputExcerpt) {
		details.push(`Recent output: ${message.recentOutputExcerpt}`);
	}

	return details.join(" ");
}

function describeCommandFailure(
	failure: TerminalCommandFailure | null,
): string {
	if (!failure) {
		return "The shell reported a failed command.";
	}

	const details = [
		failure.commandText || "A command failed.",
	];
	if (failure.exitCode !== null) {
		details.push(`Exit ${failure.exitCode}.`);
	}
	if (failure.errorMessage) {
		details.push(failure.errorMessage);
	}

	return details.join(" ");
}
