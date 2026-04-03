import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
	AppState,
	TerminalDiagnosticNoticeMessage,
	TerminalErrorMessage,
	TerminalExitMessage,
	TerminalManagerRpc,
	TerminalOutputMessage,
	TerminalStartedMessage,
} from "../shared/types";

type MessageHandlers = {
	stateChanged: (nextState: AppState) => void;
	terminalOutput: (message: TerminalOutputMessage) => void;
	terminalStarted: (message: TerminalStartedMessage) => void;
	terminalExit: (message: TerminalExitMessage) => void;
	terminalError: (message: TerminalErrorMessage) => void;
	terminalDiagnosticNotice: (message: TerminalDiagnosticNoticeMessage) => void;
};

type RPCDefinition = {
	handlers: {
		requests: Record<string, never>;
		messages: MessageHandlers;
	};
};

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
				windowMinimize: () => invoke<{ ok: boolean }>("window_minimize"),
				windowMaximize: () => invoke<{ ok: boolean }>("window_maximize"),
				windowClose: () => invoke<{ ok: boolean }>("window_close"),
				stopAllSessions: () => invoke<{ ok: boolean }>("stop_all_sessions"),
			},
		},
	};
}

async function registerMessageHandlers(messages: MessageHandlers): Promise<void> {
	void listen<AppState>("state-changed", (event) => {
		messages.stateChanged(event.payload);
	});
	void listen<TerminalOutputMessage>("terminal-output", (event) => {
		messages.terminalOutput(event.payload);
	});
	void listen<TerminalStartedMessage>("terminal-started", (event) => {
		messages.terminalStarted(event.payload);
	});
	void listen<TerminalExitMessage>("terminal-exit", (event) => {
		messages.terminalExit(event.payload);
	});
	void listen<TerminalErrorMessage>("terminal-error", (event) => {
		messages.terminalError(event.payload);
	});
	void listen<TerminalDiagnosticNoticeMessage>("terminal-diagnostic-notice", (event) => {
		messages.terminalDiagnosticNotice(event.payload);
	});
}

export class Electroview {
	public static defineRPC<T>(definition: RPCDefinition): T {
		void registerMessageHandlers(definition.handlers.messages);
		return createRpcBridge() as T;
	}

	public constructor(public readonly rpc: TerminalManagerRpc) {}
}
