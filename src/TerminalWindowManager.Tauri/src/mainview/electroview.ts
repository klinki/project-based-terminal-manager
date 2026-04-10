import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
	AppState,
	TerminalDiagnosticNoticeMessage,
	TerminalErrorMessage,
	TerminalExitMessage,
	TerminalManagerRpc,
	TerminalOutputMessage,
	TerminalProgressMessage,
	TerminalStartedMessage,
} from "../shared/types";

type MessageHandlers = {
	stateChanged: (nextState: AppState) => void;
	terminalOutput: (message: TerminalOutputMessage) => void;
	terminalStarted: (message: TerminalStartedMessage) => void;
	terminalExit: (message: TerminalExitMessage) => void;
	terminalError: (message: TerminalErrorMessage) => void;
	terminalDiagnosticNotice: (message: TerminalDiagnosticNoticeMessage) => void;
	terminalProgress: (message: TerminalProgressMessage) => void;
};

type RPCDefinition = {
	handlers: {
		requests: Record<string, never>;
		messages: MessageHandlers;
	};
};

let messageHandlersReady: Promise<void> = Promise.resolve();

function createRpcBridge(): TerminalManagerRpc {
	return {
		proxy: {
			request: {
				getInitialState: () => invoke<AppState>("get_initial_state"),
				createProject: ({ name }) => invoke<AppState>("create_project", { name }),
				renameProject: ({ projectId, name }) =>
					invoke<AppState>("rename_project", { projectId, name }),
				deleteProject: ({ projectId }) => invoke<AppState>("delete_project", { projectId }),
				createTerminal: ({ projectId, name, cwd, shell }) =>
					invoke<AppState>("create_terminal", {
						projectId,
						name,
						cwd,
						shell,
					}),
				renameTerminal: ({ terminalId, name }) =>
					invoke<AppState>("rename_terminal", { terminalId, name }),
				deleteTerminal: ({ terminalId }) => invoke<AppState>("delete_terminal", { terminalId }),
				activateTerminal: ({ terminalId, cols, rows }) =>
					invoke<AppState>("activate_terminal", { terminalId, cols, rows }),
				sendInput: ({ terminalId, data }) =>
					invoke<{ ok: boolean }>("send_input", { terminalId, data }),
				resizeTerminal: ({ terminalId, cols, rows }) =>
					invoke<{ ok: boolean }>("resize_terminal", { terminalId, cols, rows }),
				restartTerminal: ({ terminalId, cols, rows }) =>
					invoke<AppState>("restart_terminal", { terminalId, cols, rows }),
				updateDefaults: ({ defaultCwd, defaultShell, customShells }) =>
					invoke<AppState>("update_defaults", {
						defaultCwd,
						defaultShell,
						customShells,
					}),
				setProjectDefaultCwd: ({ projectId, cwd }) =>
					invoke<AppState>("set_project_default_cwd", { projectId, cwd }),
				windowMinimize: () => invoke<{ ok: boolean }>("window_minimize"),
				windowMaximize: () => invoke<{ ok: boolean }>("window_maximize"),
				windowClose: () => invoke<{ ok: boolean }>("window_close"),
				stopAllSessions: () => invoke<{ ok: boolean }>("stop_all_sessions"),
			},
		},
	};
}

async function registerMessageHandlers(messages: MessageHandlers): Promise<void> {
	await Promise.all([
		listen<AppState>("state-changed", (event) => {
			messages.stateChanged(event.payload);
		}),
		listen<TerminalOutputMessage>("terminal-output", (event) => {
			messages.terminalOutput(event.payload);
		}),
		listen<TerminalStartedMessage>("terminal-started", (event) => {
			messages.terminalStarted(event.payload);
		}),
		listen<TerminalExitMessage>("terminal-exit", (event) => {
			messages.terminalExit(event.payload);
		}),
		listen<TerminalErrorMessage>("terminal-error", (event) => {
			messages.terminalError(event.payload);
		}),
		listen<TerminalDiagnosticNoticeMessage>("terminal-diagnostic-notice", (event) => {
			messages.terminalDiagnosticNotice(event.payload);
		}),
		listen<TerminalProgressMessage>("terminal-progress", (event) => {
			messages.terminalProgress(event.payload);
		}),
	]);
}

export class Electroview {
	public static defineRPC<T>(definition: RPCDefinition): T {
		messageHandlersReady = registerMessageHandlers(definition.handlers.messages).catch((error) => {
			console.error("Failed to register Tauri event listeners", error);
			throw error;
		});
		return createRpcBridge() as T;
	}

	public static get ready(): Promise<void> {
		return messageHandlersReady;
	}

	public constructor(public readonly rpc: TerminalManagerRpc) {}
}
