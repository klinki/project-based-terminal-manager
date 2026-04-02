import type { TerminalRecord } from "../shared/types";
import { MacOsPtyBackend } from "./backends/MacOsPtyBackend";
import type {
	SessionHooks,
	TerminalSessionBackend,
} from "./backends/TerminalSessionBackend";
import { WindowsConPtyBackend } from "./backends/WindowsConPtyBackend";

export class SessionManager {
	private readonly backend: TerminalSessionBackend;

	constructor(hooks: SessionHooks) {
		this.backend = this.createBackend(hooks);
	}

	async ensureSession(
		terminal: TerminalRecord,
		cols: number,
		rows: number,
	): Promise<void> {
		await this.backend.ensureSession(terminal, cols, rows);
	}

	async sendInput(terminalId: string, data: string): Promise<void> {
		await this.backend.sendInput(terminalId, data);
	}

	async resizeTerminal(
		terminalId: string,
		cols: number,
		rows: number,
	): Promise<void> {
		await this.backend.resizeTerminal(terminalId, cols, rows);
	}

	async restartSession(
		terminal: TerminalRecord,
		cols: number,
		rows: number,
	): Promise<void> {
		await this.backend.restartSession(terminal, cols, rows);
	}

	async stopTerminal(terminalId: string): Promise<void> {
		await this.backend.stopTerminal(terminalId);
	}

	async stopAll(): Promise<void> {
		await this.backend.stopAll();
	}

	private createBackend(hooks: SessionHooks): TerminalSessionBackend {
		if (process.platform === "darwin") {
			return new MacOsPtyBackend(hooks);
		}

		return new WindowsConPtyBackend(hooks);
	}
}
