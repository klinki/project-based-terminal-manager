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
	customShells: string[];
}

export interface ProjectRecord {
	id: string;
	name: string;
	createdAt: string;
	defaultCwd: string | null;
}

export interface TerminalCommandFailure {
	sessionId: string;
	timestamp: string;
	commandText: string;
	exitCode: number | null;
	errorMessage: string | null;
	cwd: string;
	recentOutputExcerpt: string;
}

export interface TerminalSessionFailure {
	sessionId: string;
	timestamp: string;
	exitCode: number | null;
	message: string;
	shellPath: string;
	shellPid: number | null;
	stderrExcerpt: string | null;
	recentOutputExcerpt: string;
	exceptionType: string | null;
	hresult: number | null;
	win32ErrorCode: number | null;
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
	diagnosticLogPath: string | null;
	lastCommandFailure: TerminalCommandFailure | null;
	lastSessionFailure: TerminalSessionFailure | null;
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

export interface TerminalStartedMessage {
	terminalId: string;
	sessionId: string;
	shellPid: number;
	shellPath: string;
	diagnosticLogPath: string;
	startedAt: string;
}

export interface TerminalExitMessage {
	terminalId: string;
	sessionId: string;
	exitCode: number | null;
	exitedAt: string;
	shellPid: number | null;
	shellPath: string;
	stderrExcerpt: string | null;
	recentOutputExcerpt: string;
}

export interface TerminalErrorMessage {
	terminalId: string;
	sessionId: string | null;
	message: string;
	diagnosticLogPath: string | null;
	exceptionType: string | null;
	hresult: number | null;
	win32ErrorCode: number | null;
	recentOutputExcerpt: string;
}

export interface TerminalDiagnosticNoticeMessage {
	terminalId: string;
	message: string;
}

export type TerminalManagerRpc = {
	proxy: {
		request: {
			getInitialState: (params?: Record<string, never>) => Promise<AppState>;
			createProject: (params: { name: string }) => Promise<AppState>;
			renameProject: (params: {
				projectId: string;
				name: string;
			}) => Promise<AppState>;
			deleteProject: (params: { projectId: string }) => Promise<AppState>;
			createTerminal: (params: {
				projectId: string;
				name: string;
				cwd: string;
				shell?: string;
			}) => Promise<AppState>;
			renameTerminal: (params: {
				terminalId: string;
				name: string;
			}) => Promise<AppState>;
			deleteTerminal: (params: { terminalId: string }) => Promise<AppState>;
			activateTerminal: (params: {
				terminalId: string;
				cols: number;
				rows: number;
			}) => Promise<AppState>;
			sendInput: (params: {
				terminalId: string;
				data: string;
			}) => Promise<{ ok: boolean }>;
			resizeTerminal: (params: {
				terminalId: string;
				cols: number;
				rows: number;
			}) => Promise<{ ok: boolean }>;
			restartTerminal: (params: {
				terminalId: string;
				cols: number;
				rows: number;
			}) => Promise<AppState>;
			updateDefaults: (params: {
				defaultCwd: string;
				defaultShell: string;
				customShells: string[];
			}) => Promise<AppState>;
			setProjectDefaultCwd: (params: {
				projectId: string;
				cwd: string;
			}) => Promise<AppState>;
			windowMinimize: (params: Record<string, never>) => Promise<{ ok: boolean }>;
			windowMaximize: (params: Record<string, never>) => Promise<{ ok: boolean }>;
			windowClose: (params: Record<string, never>) => Promise<{ ok: boolean }>;
			stopAllSessions: (params?: Record<string, never>) => Promise<{ ok: boolean }>;
		};
	};
};

