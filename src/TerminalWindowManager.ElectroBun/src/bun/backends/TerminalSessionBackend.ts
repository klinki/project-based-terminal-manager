import type {
	TerminalDiagnosticNoticeMessage,
	TerminalErrorMessage,
	TerminalExitMessage,
	TerminalOutputMessage,
	TerminalRecord,
	TerminalStartedMessage,
} from "../../shared/types";

export type SessionHooks = {
	onOutput(message: TerminalOutputMessage): Promise<void> | void;
	onStarted(message: TerminalStartedMessage): Promise<void> | void;
	onExit(message: TerminalExitMessage): Promise<void> | void;
	onError(message: TerminalErrorMessage): Promise<void> | void;
	onDiagnosticNotice(message: TerminalDiagnosticNoticeMessage): Promise<void> | void;
	onStateChanged(): Promise<void> | void;
};

export interface TerminalSessionBackend {
	ensureSession(
		terminal: TerminalRecord,
		cols: number,
		rows: number,
	): Promise<void>;
	sendInput(terminalId: string, data: string): Promise<void>;
	resizeTerminal(
		terminalId: string,
		cols: number,
		rows: number,
	): Promise<void>;
	restartSession(
		terminal: TerminalRecord,
		cols: number,
		rows: number,
	): Promise<void>;
	stopTerminal(terminalId: string): Promise<void>;
	stopAll(): Promise<void>;
}
