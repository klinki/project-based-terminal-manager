import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Utils } from "electrobun/bun";
import type {
	AppState,
	AppDefaults,
	TerminalActivity,
	TerminalRecord,
} from "../shared/types";

export class AppStateStore {
	private readonly metadataPath = join(
		Utils.paths.userData,
		"terminal-metadata.json",
	);

	load(): AppState {
		mkdirSync(dirname(this.metadataPath), { recursive: true });

		if (!existsSync(this.metadataPath)) {
			return this.createInitialState();
		}

		const rawJson = readFileSync(this.metadataPath, "utf8");
		const parsed = JSON.parse(rawJson) as Partial<AppState>;
		return this.normalizeState(parsed);
	}

	save(state: AppState): void {
		mkdirSync(dirname(this.metadataPath), { recursive: true });
		writeFileSync(
			this.metadataPath,
			JSON.stringify(this.createPersistentSnapshot(state), null, 2),
			"utf8",
		);
	}

	private createInitialState(): AppState {
		return {
			defaults: this.createDefaults(),
			projects: [],
			terminals: [],
			activeTerminalId: null,
		};
	}

	private createDefaults(): AppDefaults {
		return {
			defaultCwd: process.cwd(),
			defaultShell: this.getDefaultShell(),
			customShells: [],
		};
	}

	private normalizeState(parsed: Partial<AppState>): AppState {
		const defaults = {
			...this.createDefaults(),
			...(parsed.defaults ?? {}),
		};
		defaults.customShells = this.normalizeCustomShells(
			defaults.customShells ?? [],
			defaults.defaultShell,
		);

		const terminals = (parsed.terminals ?? []).map((terminal) =>
			this.normalizeTerminal(terminal),
		);

		return {
			defaults,
			projects: (parsed.projects ?? []).map((project) => ({
				id: project.id ?? crypto.randomUUID(),
				name: project.name ?? "Untitled Project",
				createdAt: project.createdAt ?? new Date().toISOString(),
			})),
			terminals,
			activeTerminalId: null,
		};
	}

	private normalizeTerminal(terminal: Partial<TerminalRecord>): TerminalRecord {
		const status =
			terminal.status === "running" || terminal.status === "starting"
				? "stopped"
				: terminal.status ?? "stopped";

		return {
			id: terminal.id ?? crypto.randomUUID(),
			projectId: terminal.projectId ?? "",
			name: terminal.name ?? "Terminal",
			cwd: terminal.cwd ?? process.cwd(),
			shell: terminal.shell || this.getDefaultShell(),
			status,
			activity: this.createDefaultActivity(status),
			lastExitCode: terminal.lastExitCode ?? null,
			createdAt: terminal.createdAt ?? new Date().toISOString(),
			lastStartedAt: terminal.lastStartedAt ?? null,
			diagnosticLogPath: terminal.diagnosticLogPath ?? null,
			lastCommandFailure: terminal.lastCommandFailure ?? null,
			lastSessionFailure: terminal.lastSessionFailure ?? null,
		};
	}

	private createPersistentSnapshot(state: AppState): AppState {
		return {
			...state,
			terminals: state.terminals.map((terminal) => ({
				...terminal,
				activity: this.createDefaultActivity(terminal.status),
			})),
		};
	}

	private getDefaultShell(): string {
		if (process.platform === "win32") {
			return "powershell.exe";
		}

		return process.env["SHELL"] || process.env["COMSPEC"] || "sh";
	}

	private normalizeCustomShells(shells: string[], defaultShell: string): string[] {
		const normalized = new Map<string, string>();
		const push = (value: string) => {
			const trimmed = value.trim();
			if (!trimmed || this.isBuiltInShell(trimmed)) {
				return;
			}

			const key = trimmed.toLowerCase();
			if (!normalized.has(key)) {
				normalized.set(key, trimmed);
			}
		};

		push(defaultShell);
		for (const shell of shells) {
			push(shell);
		}

		return [...normalized.values()];
	}

	private isBuiltInShell(shell: string): boolean {
		const normalized = shell.trim().toLowerCase();
		return normalized === "pwsh" ||
			normalized === "pwsh.exe" ||
			normalized === "cmd" ||
			normalized === "cmd.exe";
	}

	private createDefaultActivity(status: TerminalRecord["status"]): TerminalActivity {
		switch (status) {
			case "starting":
				return {
					phase: "working",
					summary: "Starting session",
					detail: "Launching terminal helper process.",
					progress: 12,
					isIndeterminate: true,
					updatedAt: new Date().toISOString(),
				};

			case "running":
				return {
					phase: "waiting",
					summary: "Ready",
					detail: "Shell is running and waiting for input.",
					progress: 100,
					isIndeterminate: false,
					updatedAt: new Date().toISOString(),
				};

			case "error":
				return {
					phase: "attention",
					summary: "Error",
					detail: "The session reported an error.",
					progress: 100,
					isIndeterminate: false,
					updatedAt: new Date().toISOString(),
				};

			case "exited":
				return {
					phase: "idle",
					summary: "Exited",
					detail: "The session is no longer running.",
					progress: 100,
					isIndeterminate: false,
					updatedAt: new Date().toISOString(),
				};

			default:
				return {
					phase: "idle",
					summary: "Not started",
					detail: "Activate this terminal to start a live session.",
					progress: 0,
					isIndeterminate: false,
					updatedAt: new Date().toISOString(),
				};
		}
	}
}
