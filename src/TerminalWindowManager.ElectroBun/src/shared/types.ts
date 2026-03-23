import type { RPCSchema } from "electrobun/bun";

export type TerminalStatus = "stopped" | "starting" | "running" | "exited" | "error";
export type TerminalActivityPhase =
	| "idle"
	| "working"
	| "streaming"
	| "waiting"
	| "attention";

export interface TerminalActivity {
	phase: TerminalActivityPhase;
	summary: string;
	detail: string;
	progress: number;
	isIndeterminate: boolean;
	updatedAt: string;
}

export interface AppDefaults {
	defaultCwd: string;
	defaultShell: string;
}

export interface ProjectRecord {
	id: string;
	name: string;
	createdAt: string;
}

export interface TerminalRecord {
	id: string;
	projectId: string;
	name: string;
	cwd: string;
	shell: string;
	status: TerminalStatus;
	activity: TerminalActivity;
	lastExitCode: number | null;
	createdAt: string;
	lastStartedAt: string | null;
}

export interface AppState {
	defaults: AppDefaults;
	projects: ProjectRecord[];
	terminals: TerminalRecord[];
	activeTerminalId: string | null;
}

export interface TerminalOutputMessage {
	terminalId: string;
	dataBase64: string;
}

export interface TerminalExitMessage {
	terminalId: string;
	exitCode: number | null;
}

export interface TerminalErrorMessage {
	terminalId: string;
	message: string;
}

export type TerminalManagerRpc = {
	bun: RPCSchema<{
		requests: {
			getInitialState: { params: {}; response: AppState };
			createProject: { params: { name: string }; response: AppState };
			renameProject: {
				params: { projectId: string; name: string };
				response: AppState;
			};
			deleteProject: {
				params: { projectId: string };
				response: AppState;
			};
			createTerminal: {
				params: {
					projectId: string;
					name: string;
					cwd: string;
					shell?: string;
				};
				response: AppState;
			};
			renameTerminal: {
				params: { terminalId: string; name: string };
				response: AppState;
			};
			deleteTerminal: {
				params: { terminalId: string };
				response: AppState;
			};
			activateTerminal: {
				params: { terminalId: string; cols: number; rows: number };
				response: AppState;
			};
			sendInput: {
				params: { terminalId: string; data: string };
				response: { ok: boolean };
			};
			resizeTerminal: {
				params: { terminalId: string; cols: number; rows: number };
				response: { ok: boolean };
			};
			restartTerminal: {
				params: { terminalId: string; cols: number; rows: number };
				response: AppState;
			};
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			stateChanged: AppState;
			terminalOutput: TerminalOutputMessage;
			terminalStarted: { terminalId: string };
			terminalExit: TerminalExitMessage;
			terminalError: TerminalErrorMessage;
		};
	}>;
};
