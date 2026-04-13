import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Electroview } from "./electroview";
import "./style.css";
import type {
	AppState,
	ProjectRecord,
	TerminalActivity,
	TerminalActivityPhase,
	TerminalManagerRpc,
	TerminalProgressInfo,
	TerminalRecord,
	TerminalStatus,
} from "../shared/types";

const rpc = Electroview.defineRPC<TerminalManagerRpc>({
	handlers: {
		requests: {},
		messages: {
			stateChanged: (nextState) => {
				state = nextState;
				reconcileSelection();
				reconcileSidebarState();
				pruneTerminalViews();
				renderTree();
				renderInspector();
				renderStatusBoard();
			},
			terminalOutput: ({ terminalId, dataBase64 }) => {
				const terminalView = ensureTerminalView(terminalId);
				terminalView.terminal.write(decodeBase64(dataBase64));
			},
			terminalStarted: ({ terminalId }) => {
				const terminalView = ensureTerminalView(terminalId);
				terminalView.terminal.focus();
			},
			terminalExit: ({ terminalId, exitCode }) => {
				const terminalView = ensureTerminalView(terminalId);
				terminalView.terminal.writeln(
					`\r\n[session exited with code ${exitCode ?? "unknown"}]`,
				);
				const terminal = state.terminals.find(
					(candidate) => candidate.id === terminalId,
				);
				if (terminal) {
					setStatus(
						`Console '${terminal.name}' exited with code ${exitCode ?? "unknown"}.`,
					);
				}
			},
			terminalError: ({ terminalId, message }) => {
				const terminalView = ensureTerminalView(terminalId);
				terminalView.terminal.writeln(`\r\n[error] ${message}`);
				const terminal = state.terminals.find(
					(candidate) => candidate.id === terminalId,
				);
				if (terminal) {
					setStatus(`Console '${terminal.name}' reported an error.`);
				}
			},
			terminalDiagnosticNotice: ({ terminalId, message }) => {
				const terminalView = ensureTerminalView(terminalId);
				terminalView.terminal.writeln(`\r\n[diagnostic] ${message}`);
				const terminal = state.terminals.find(
					(candidate) => candidate.id === terminalId,
				);
				if (terminal) {
					setStatus(`Console '${terminal.name}': ${message}`);
				}
			},
			terminalProgress: ({ terminalId, progressInfo, activity }) => {
				const terminal = state.terminals.find(
					(candidate) => candidate.id === terminalId,
				);
				if (!terminal) {
					return;
				}

				terminal.progressInfo = progressInfo;
				terminal.activity = activity;
				scheduleProgressRender();
			},
		},
	},
});

const electroview = new Electroview(rpc);
const app = document.getElementById("app");
if (!app) {
	throw new Error("The root app container was not found.");
}

type Selection =
	| { kind: "project"; id: string }
	| { kind: "terminal"; id: string }
	| null;

type TerminalView = {
	terminal: Terminal;
	fitAddon: FitAddon;
	wrapper: HTMLDivElement;
	surface: HTMLDivElement;
};

type SettingsDialogResult = {
	defaultCwd: string;
	defaultShell: string;
	customShells: string[];
};

type AppBuildInfo = {
	version: string;
	buildDate: string;
};

type TitlebarDragState = {
	pointerId: number;
	startX: number;
	startY: number;
};

const BUILT_IN_SHELL_OPTIONS = ["pwsh.exe", "cmd.exe"] as const;
const TITLEBAR_DRAG_THRESHOLD_PX = 4;

let state: AppState = {
	defaults: {
		defaultCwd: "",
		defaultShell: "",
		customShells: [],
	},
	projects: [],
	terminals: [],
	activeTerminalId: null,
};

let selection: Selection = null;
let statusMessage = "Booting Terminal Window Manager Tauri shell...";
let layoutSyncScheduled = false;
let progressRenderScheduled = false;
let editingProjectId: string | null = null;
let editingProjectDraft = "";
let shouldFocusProjectEditor = false;
let editingTerminalId: string | null = null;
let editingTerminalDraft = "";
let shouldFocusTerminalEditor = false;
let activateTerminalAfterRenameId: string | null = null;
const collapsedProjectIds = new Set<string>();
let inspectorCollapsed = false;
let contextMenuState: { kind: "project" | "terminal"; id: string } | null = null;
let pendingConfirmResolve: ((confirmed: boolean) => void) | null = null;
let pendingRenameResolve: ((value: string | null) => void) | null = null;
let pendingSettingsResolve: ((value: SettingsDialogResult | null) => void) | null =
	null;
let appBuildInfo: AppBuildInfo = {
	version: "Unknown",
	buildDate: "",
};
let settingsDialogCustomShells: string[] = [];
let settingsShellMenuOpen = false;
let lastRenderedTreeMarkup = "";
let titlebarDragState: TitlebarDragState | null = null;

const terminalViews = new Map<string, TerminalView>();
const utf8Decoder = new TextDecoder();

function getRendererRpc() {
	const rendererRpc = electroview.rpc;
	if (!rendererRpc) {
		throw new Error("The renderer RPC bridge is not initialized.");
	}

	return rendererRpc;
}

app.innerHTML = `
	<div class="app-shell">
		<header id="titlebar" class="titlebar">
			<div class="titlebar-title">Terminal Window Manager Tauri</div>
			<div class="titlebar-controls">
				<button id="win-minimize" class="titlebar-button" type="button" title="Minimize">
					<svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
				</button>
				<button id="win-maximize" class="titlebar-button" type="button" title="Maximize">
					<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1"><rect x="0.5" y="0.5" width="9" height="9"/></svg>
				</button>
				<button id="win-close" class="titlebar-button titlebar-button-close" type="button" title="Close">
					<svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.2"><line x1="0" y1="0" x2="10" y2="10"/><line x1="10" y1="0" x2="0" y2="10"/></svg>
				</button>
			</div>
		</header>
		<div class="app-body">
		<aside class="sidebar">
			<div class="sidebar-top">
				<div class="sidebar-nav">
					<button id="new-console-button" class="nav-item nav-item-primary">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M4 17 10 11 4 5"></path>
							<path d="M12 19h8"></path>
						</svg>
						<span>New console</span>
					</button>
					<button id="new-project-button" class="nav-item">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
							<path d="M12 11v6"></path>
							<path d="M9 14h6"></path>
						</svg>
						<span>New project</span>
					</button>
				</div>
			</div>

			<div class="sidebar-section-header">
				<span>Projects</span>
				<span id="project-count" class="sidebar-section-count">0</span>
			</div>

			<div class="project-tree">
				<ul id="project-tree" class="tree-root"></ul>
			</div>

			<div class="sidebar-bottom">
				<button id="settings-button" class="nav-item nav-item-footer" type="button">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="3"></circle>
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
					</svg>
					<span>Settings</span>
				</button>
			</div>
		</aside>

		<main class="workspace">
			<section id="inspector-panel" class="inspector-panel">
				<div class="inspector-header">
					<button id="inspector-toggle" class="inspector-toggle" type="button" title="Toggle details">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="6 9 12 15 18 9"></polyline>
						</svg>
					</button>
					<div id="activity-indicator" class="activity-indicator idle" aria-hidden="true"></div>
					<div class="inspector-header-copy">
						<h1 id="selection-title" class="inspector-title">Select a console</h1>
						<p id="selection-subtitle" class="inspector-subtitle">Sessions stay alive once started so you can switch back and forth quickly.</p>
					</div>
					<div class="inspector-header-actions">
						<span id="activity-chip" class="activity-chip idle">Idle</span>
						<button
							id="set-project-default-cwd"
							class="icon-button"
							disabled
							title="Use current console directory as the project default">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M3 7h5l2 2h11v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
								<path d="M12 11v6"></path>
								<path d="m9.5 14.5 2.5 2.5 2.5-2.5"></path>
							</svg>
						</button>
						<button id="restart-terminal" class="icon-button" disabled title="Restart console">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<polyline points="23 4 23 10 17 10"></polyline>
								<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
							</svg>
						</button>
					</div>
				</div>
				<div id="inspector-body" class="inspector-body">
					<div class="inspector-details">
						<dl id="selection-metadata" class="metadata-grid"></dl>
					</div>
					<div class="inspector-status">
						<div class="inspector-status-row">
							<div class="status-copy">
								<span id="activity-title" class="status-heading">Console telemetry inactive</span>
								<span id="activity-detail" class="status-detail">Select a console to inspect live session status.</span>
							</div>
							<span id="activity-updated" class="status-updated">No activity yet</span>
						</div>
						<div class="status-banner" id="status-banner">
							Booting Terminal Window Manager Tauri shell...
						</div>
					</div>
				</div>
			</section>

			<section id="terminal-stage" class="terminal-stage">
				<div id="terminal-empty" class="terminal-stage-empty">
					Choose a console on the left to start a live ConPTY-backed session.
				</div>
				<div id="terminal-stack" class="terminal-stack"></div>
			</section>
		</main>
		</div>

		<div id="sidebar-context-menu" class="context-menu hidden" role="menu" aria-hidden="true"></div>
		<dialog id="confirm-dialog" class="confirm-dialog">
			<form method="dialog" class="confirm-dialog-panel">
				<h3 id="confirm-dialog-title" class="confirm-dialog-title">Confirm action</h3>
				<p id="confirm-dialog-message" class="confirm-dialog-message"></p>
				<div class="confirm-dialog-actions">
					<button id="confirm-dialog-cancel" class="secondary-button" value="cancel">Cancel</button>
					<button id="confirm-dialog-confirm" class="danger-button" value="confirm">Delete</button>
				</div>
			</form>
		</dialog>
		<dialog id="rename-dialog" class="confirm-dialog">
			<form method="dialog" class="confirm-dialog-panel">
				<h3 id="rename-dialog-title" class="confirm-dialog-title">Rename</h3>
				<p id="rename-dialog-message" class="confirm-dialog-message"></p>
				<input id="rename-dialog-input" class="dialog-input" type="text" />
				<div class="confirm-dialog-actions">
					<button class="secondary-button" value="cancel">Cancel</button>
					<button id="rename-dialog-confirm" class="primary-button" value="confirm">Rename</button>
				</div>
			</form>
		</dialog>
		<dialog id="settings-dialog" class="confirm-dialog">
			<form method="dialog" class="confirm-dialog-panel">
				<h3 class="confirm-dialog-title">Settings</h3>
				<p class="confirm-dialog-message">Set the default working directory and shell used for new consoles.</p>
				<label class="settings-field">
					<span class="settings-label">Default working directory</span>
					<input id="settings-dialog-default-cwd" class="dialog-input" type="text" />
				</label>
				<label class="settings-field">
					<span class="settings-label">Default shell</span>
					<div id="settings-shell-combobox" class="settings-shell-combobox">
						<div class="settings-shell-input-row">
							<input
								id="settings-dialog-default-shell"
								class="dialog-input settings-shell-input"
								type="text"
								spellcheck="false"
								autocomplete="off"
								aria-autocomplete="list"
								aria-haspopup="listbox"
								aria-controls="settings-shell-menu"
								aria-expanded="false" />
							<button
								id="settings-shell-toggle"
								class="settings-shell-toggle"
								type="button"
								title="Show shell options"
								aria-label="Show shell options">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="m6 9 6 6 6-6"></path>
								</svg>
							</button>
						</div>
						<div
							id="settings-shell-menu"
							class="settings-shell-menu hidden"
							role="listbox"
							aria-label="Default shell options"></div>
					</div>
					<span class="settings-hint">Choose pwsh.exe, cmd.exe, or type another executable or full path. Saved custom shells appear here and can be removed.</span>
				</label>
				<div class="settings-build-info" aria-label="Build information">
					<div class="settings-build-info-header">Build info</div>
					<dl class="settings-build-info-grid">
						<div class="settings-build-info-item">
							<dt>Version</dt>
							<dd id="settings-build-version">Loading...</dd>
						</div>
						<div class="settings-build-info-item">
							<dt>Built</dt>
							<dd id="settings-build-date">Loading...</dd>
						</div>
					</dl>
				</div>
				<div class="confirm-dialog-actions">
					<button class="secondary-button" value="cancel">Cancel</button>
					<button id="settings-dialog-save" class="primary-button" value="confirm">Save</button>
				</div>
			</form>
		</dialog>
	</div>
`;

const projectTreeElement = queryHtmlElement<HTMLUListElement>("project-tree");
const projectCount = queryHtmlElement<HTMLElement>("project-count");
const titlebar = queryHtmlElement<HTMLElement>("titlebar");
const newProjectButton =
	queryHtmlElement<HTMLButtonElement>("new-project-button");
const newConsoleButton =
	queryHtmlElement<HTMLButtonElement>("new-console-button");
const selectionTitle = queryHtmlElement<HTMLHeadingElement>("selection-title");
const selectionSubtitle =
	queryHtmlElement<HTMLParagraphElement>("selection-subtitle");
const selectionMetadata =
	queryHtmlElement<HTMLDListElement>("selection-metadata");
const statusBanner = queryHtmlElement<HTMLElement>("status-banner");
const activityIndicator = queryHtmlElement<HTMLElement>("activity-indicator");
const activityTitle = queryHtmlElement<HTMLElement>("activity-title");
const activityDetail = queryHtmlElement<HTMLElement>("activity-detail");
const activityChip = queryHtmlElement<HTMLElement>("activity-chip");
const activityUpdated = queryHtmlElement<HTMLElement>("activity-updated");
const restartTerminalButton =
	queryHtmlElement<HTMLButtonElement>("restart-terminal");
const setProjectDefaultCwdButton =
	queryHtmlElement<HTMLButtonElement>("set-project-default-cwd");
const inspectorPanel = queryHtmlElement<HTMLElement>("inspector-panel");
const inspectorBody = queryHtmlElement<HTMLElement>("inspector-body");
const inspectorToggle = queryHtmlElement<HTMLButtonElement>("inspector-toggle");
const terminalStage = queryHtmlElement<HTMLElement>("terminal-stage");
const terminalEmpty = queryHtmlElement<HTMLDivElement>("terminal-empty");
const terminalStack = queryHtmlElement<HTMLDivElement>("terminal-stack");
const sidebarContextMenu =
	queryHtmlElement<HTMLDivElement>("sidebar-context-menu");
const confirmDialog = queryHtmlElement<HTMLDialogElement>("confirm-dialog");
const confirmDialogTitle =
	queryHtmlElement<HTMLHeadingElement>("confirm-dialog-title");
const confirmDialogMessage =
	queryHtmlElement<HTMLParagraphElement>("confirm-dialog-message");
const confirmDialogConfirm =
	queryHtmlElement<HTMLButtonElement>("confirm-dialog-confirm");
const renameDialog = queryHtmlElement<HTMLDialogElement>("rename-dialog");
const renameDialogTitle =
	queryHtmlElement<HTMLHeadingElement>("rename-dialog-title");
const renameDialogMessage =
	queryHtmlElement<HTMLParagraphElement>("rename-dialog-message");
const renameDialogInput =
	queryHtmlElement<HTMLInputElement>("rename-dialog-input");
const settingsButton =
	queryHtmlElement<HTMLButtonElement>("settings-button");
const settingsDialog =
	queryHtmlElement<HTMLDialogElement>("settings-dialog");
const settingsDialogInputCwd =
	queryHtmlElement<HTMLInputElement>("settings-dialog-default-cwd");
const settingsDialogInputShell =
	queryHtmlElement<HTMLInputElement>("settings-dialog-default-shell");
const settingsShellCombobox =
	queryHtmlElement<HTMLDivElement>("settings-shell-combobox");
const settingsShellToggle =
	queryHtmlElement<HTMLButtonElement>("settings-shell-toggle");
const settingsShellMenu =
	queryHtmlElement<HTMLDivElement>("settings-shell-menu");
const settingsBuildVersion =
	queryHtmlElement<HTMLElement>("settings-build-version");
const settingsBuildDate = queryHtmlElement<HTMLElement>("settings-build-date");
const winMinimize = queryHtmlElement<HTMLButtonElement>("win-minimize");
const winMaximize = queryHtmlElement<HTMLButtonElement>("win-maximize");
const winClose = queryHtmlElement<HTMLButtonElement>("win-close");

const terminalStageResizeObserver = new ResizeObserver(() => {
	scheduleSelectedTerminalLayoutSync();
});
terminalStageResizeObserver.observe(terminalStage);

titlebar.addEventListener("pointerdown", (event) => {
	if (event.button !== 0) {
		return;
	}

	const target = event.target as HTMLElement;
	if (isTitlebarInteractiveTarget(target)) {
		return;
	}

	titlebarDragState = {
		pointerId: event.pointerId,
		startX: event.clientX,
		startY: event.clientY,
	};
});

titlebar.addEventListener("pointermove", (event) => {
	if (!titlebarDragState || titlebarDragState.pointerId !== event.pointerId) {
		return;
	}

	const dragDistance = Math.hypot(
		event.clientX - titlebarDragState.startX,
		event.clientY - titlebarDragState.startY,
	);
	if (dragDistance < TITLEBAR_DRAG_THRESHOLD_PX) {
		return;
	}

	titlebarDragState = null;
	event.preventDefault();
	void getCurrentWindow().startDragging();
});

titlebar.addEventListener("dblclick", (event) => {
	const target = event.target as HTMLElement;
	if (isTitlebarInteractiveTarget(target)) {
		return;
	}

	titlebarDragState = null;
	event.preventDefault();
	void getCurrentWindow().toggleMaximize();
});

titlebar.addEventListener("pointerup", (event) => {
	if (titlebarDragState?.pointerId === event.pointerId) {
		titlebarDragState = null;
	}
});

titlebar.addEventListener("pointercancel", (event) => {
	if (titlebarDragState?.pointerId === event.pointerId) {
		titlebarDragState = null;
	}
});

inspectorToggle.addEventListener("click", () => {
	inspectorCollapsed = !inspectorCollapsed;
	inspectorPanel.classList.toggle("collapsed", inspectorCollapsed);
	scheduleSelectedTerminalLayoutSync();
});

settingsButton.addEventListener("click", () => {
	void runUiAction("Settings", openSettingsDialog);
});

settingsDialogInputShell.addEventListener("focus", () => {
	openSettingsShellMenu();
});

settingsDialogInputShell.addEventListener("click", () => {
	openSettingsShellMenu();
});

settingsDialogInputShell.addEventListener("input", () => {
	openSettingsShellMenu();
});

settingsDialogInputShell.addEventListener("keydown", (event) => {
	if (event.key === "ArrowDown") {
		event.preventDefault();
		openSettingsShellMenu();
		return;
	}

	if (event.key === "Escape" && settingsShellMenuOpen) {
		event.preventDefault();
		event.stopPropagation();
		closeSettingsShellMenu();
	}
});

settingsShellToggle.addEventListener("click", (event) => {
	event.preventDefault();
	if (settingsShellMenuOpen) {
		closeSettingsShellMenu();
		return;
	}

	openSettingsShellMenu();
	settingsDialogInputShell.focus();
});

settingsShellMenu.addEventListener("click", (event) => {
	const target = event.target as HTMLElement;
	const removeButton = target.closest<HTMLButtonElement>("[data-custom-shell-delete]");
	if (removeButton) {
		const shell = removeButton.dataset.customShellDelete;
		if (!shell) {
			return;
		}

		settingsDialogCustomShells = settingsDialogCustomShells.filter(
			(candidate) => normalizeShellKey(candidate) !== normalizeShellKey(shell),
		);
		if (normalizeShellKey(settingsDialogInputShell.value) === normalizeShellKey(shell)) {
			settingsDialogInputShell.value = "";
		}
		renderSettingsShellMenu();
		settingsDialogInputShell.focus();
		return;
	}

	const optionButton = target.closest<HTMLButtonElement>("[data-shell-option]");
	if (!optionButton) {
		return;
	}

	const shell = optionButton.dataset.shellOption;
	if (!shell) {
		return;
	}

	settingsDialogInputShell.value = shell;
	closeSettingsShellMenu();
	settingsDialogInputShell.focus();
	settingsDialogInputShell.setSelectionRange(shell.length, shell.length);
});

winMinimize.addEventListener("click", () => {
	void runUiAction("Minimize window", async () => {
		await getCurrentWindow().minimize();
	});
});

winMaximize.addEventListener("click", () => {
	void runUiAction("Toggle maximize", async () => {
		await getCurrentWindow().toggleMaximize();
	});
});

winClose.addEventListener("click", () => {
	void runUiAction("Close window", async () => {
		await getCurrentWindow().close();
	});
});

newProjectButton.addEventListener("click", () => {
	void runUiAction("Create project", createProjectAndBeginRename);
});

newConsoleButton.addEventListener("click", () => {
	void runUiAction("Create console", createConsoleFromSelection);
});

projectTreeElement.addEventListener("click", (event) => {
	const target = event.target as HTMLElement;

	const projectToggleButton = target.closest<HTMLElement>("[data-project-toggle-id]");
	if (projectToggleButton) {
		toggleProjectCollapsed(projectToggleButton.dataset.projectToggleId!);
		return;
	}

	const projectConsoleButton =
		target.closest<HTMLButtonElement>("[data-project-new-console-id]");
	if (projectConsoleButton) {
		void runUiAction("Create console", () =>
			createConsoleFromProject(projectConsoleButton.dataset.projectNewConsoleId!),
		);
		return;
	}

	const terminalButton = target.closest<HTMLButtonElement>("[data-terminal-id]");
	if (terminalButton) {
		void runUiAction("Open console", () =>
			selectTerminal(terminalButton.dataset.terminalId!),
		);
		return;
	}

	const projectButton = target.closest<HTMLButtonElement>("[data-project-id]");
	if (projectButton) {
		selection = { kind: "project", id: projectButton.dataset.projectId! };
		renderTree();
		renderInspector();
		renderStatusBoard();
	}
});

projectTreeElement.addEventListener("dblclick", (event) => {
	const target = event.target as HTMLElement;
	const projectButton = target.closest<HTMLButtonElement>("[data-project-id]");
	if (!projectButton) {
		return;
	}

	const project = findProject(projectButton.dataset.projectId!);
	if (!project) {
		return;
	}

	startEditingProject(project.id, project.name);
});

projectTreeElement.addEventListener("submit", (event) => {
	const target = event.target as HTMLElement;
	const projectForm = target.closest<HTMLFormElement>("[data-project-edit-form]");
	if (projectForm) {
		event.preventDefault();
		void commitProjectRename(projectForm.dataset.projectEditForm!);
		return;
	}

	const terminalForm = target.closest<HTMLFormElement>("[data-terminal-edit-form]");
	if (!terminalForm) {
		return;
	}

	event.preventDefault();
	void commitTerminalRename(terminalForm.dataset.terminalEditForm!);
});

projectTreeElement.addEventListener("input", (event) => {
	const target = event.target as HTMLInputElement;
	if (target.matches("[data-project-edit-input]")) {
		editingProjectDraft = target.value;
		return;
	}

	if (target.matches("[data-terminal-edit-input]")) {
		editingTerminalDraft = target.value;
	}
});

projectTreeElement.addEventListener("keydown", (event) => {
	const target = event.target as HTMLElement;
	if (target.matches("[data-project-edit-input]")) {
		if (event.key === "Escape") {
			event.preventDefault();
			cancelProjectRename();
		}
		return;
	}

	if (target.matches("[data-terminal-edit-input]") && event.key === "Escape") {
		event.preventDefault();
		void cancelTerminalRename();
	}
});

projectTreeElement.addEventListener("focusout", (event) => {
	const target = event.target as HTMLElement;
	if (target.matches("[data-project-edit-input]")) {
		const projectId = (target as HTMLInputElement).dataset.projectEditInput!;
		const nextTarget = event.relatedTarget as Node | null;
		const form = target.closest<HTMLFormElement>("[data-project-edit-form]");
		if (form && nextTarget && form.contains(nextTarget)) {
			return;
		}

		void commitProjectRename(projectId);
		return;
	}

	if (!target.matches("[data-terminal-edit-input]")) {
		return;
	}

	const terminalId = (target as HTMLInputElement).dataset.terminalEditInput!;
	const nextTarget = event.relatedTarget as Node | null;
	const form = target.closest<HTMLFormElement>("[data-terminal-edit-form]");
	if (form && nextTarget && form.contains(nextTarget)) {
		return;
	}

	void commitTerminalRename(terminalId);
});

projectTreeElement.addEventListener("contextmenu", (event) => {
	const target = event.target as HTMLElement;
	const terminalButton = target.closest<HTMLButtonElement>("[data-terminal-id]");
	if (terminalButton) {
		event.preventDefault();
		showContextMenu(
			{ kind: "terminal", id: terminalButton.dataset.terminalId! },
			event.clientX,
			event.clientY,
		);
		return;
	}

	const projectRow = target.closest<HTMLElement>("[data-project-row-id]");
	if (projectRow) {
		event.preventDefault();
		showContextMenu(
			{ kind: "project", id: projectRow.dataset.projectRowId! },
			event.clientX,
			event.clientY,
		);
	}
});

sidebarContextMenu.addEventListener("click", (event) => {
	const target = event.target as HTMLElement;
	const actionButton = target.closest<HTMLButtonElement>("[data-context-action]");
	if (!actionButton || !contextMenuState) {
		return;
	}

	if (actionButton.dataset.contextAction === "rename") {
		if (contextMenuState.kind === "project") {
			void renameProjectFromMenu(contextMenuState.id);
		} else {
			void renameTerminal(contextMenuState.id);
		}
		return;
	}

	if (actionButton.dataset.contextAction === "delete") {
		if (contextMenuState.kind === "project") {
			void deleteProject(contextMenuState.id);
		} else {
			void deleteTerminal(contextMenuState.id);
		}
	}
});

restartTerminalButton.addEventListener("click", async () => {
	const selectedTerminal = getSelectedTerminal();
	if (!selectedTerminal) {
		return;
	}

	const terminalView = ensureTerminalView(selectedTerminal.id);
	showTerminalView(selectedTerminal.id, false);
	terminalView.fitAddon.fit();
	state = await getRendererRpc().proxy.request.restartTerminal({
		terminalId: selectedTerminal.id,
		cols: terminalView.terminal.cols,
		rows: terminalView.terminal.rows,
	});
	renderTree();
	renderInspector();
	renderStatusBoard();
	setStatus(`Restarted '${selectedTerminal.name}'.`);
});

setProjectDefaultCwdButton.addEventListener("click", () => {
	void runUiAction(
		"Set project default directory",
		setProjectDefaultCwdFromSelectedTerminal,
	);
});

window.addEventListener("resize", () => {
	hideContextMenu();
	scheduleSelectedTerminalLayoutSync();
});

window.addEventListener("click", (event) => {
	const target = event.target as HTMLElement;
	if (!settingsShellCombobox.contains(target)) {
		closeSettingsShellMenu();
	}
	if (sidebarContextMenu.contains(target)) {
		return;
	}

	hideContextMenu();
});

window.addEventListener("blur", () => {
	hideContextMenu();
});

confirmDialog.addEventListener("close", () => {
	const resolver = pendingConfirmResolve;
	pendingConfirmResolve = null;
	if (!resolver) {
		return;
	}

	resolver(confirmDialog.returnValue === "confirm");
});

renameDialog.addEventListener("close", () => {
	const resolver = pendingRenameResolve;
	pendingRenameResolve = null;
	if (!resolver) {
		return;
	}

	resolver(
		renameDialog.returnValue === "confirm" ? renameDialogInput.value.trim() : null,
	);
});

settingsDialog.addEventListener("close", () => {
	closeSettingsShellMenu();
	const resolver = pendingSettingsResolve;
	pendingSettingsResolve = null;
	if (!resolver) {
		return;
	}

	resolver(
		settingsDialog.returnValue === "confirm"
			? {
					defaultCwd: settingsDialogInputCwd.value.trim(),
					defaultShell: settingsDialogInputShell.value.trim(),
					customShells: normalizeCustomShells(
						settingsDialogCustomShells,
						settingsDialogInputShell.value,
					),
				}
			: null,
	);
});

void (async () => {
	try {
		await Electroview.ready;
		await bootstrap();
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		setStatus(`Startup failed: ${message}`);
		throw error;
	}
})();

async function bootstrap(): Promise<void> {
	appBuildInfo = await loadBuildInfo();
	state = await getRendererRpc().proxy.request.getInitialState({});
	reconcileSelection();
	reconcileSidebarState();
	pruneTerminalViews();
	renderTree();
	renderInspector();
	renderStatusBoard();
	setStatus(
		"Create a project, open a console, and click a console to start a live ConPTY-backed session.",
	);
}

function reconcileSelection(): void {
	if (selection?.kind === "terminal") {
		const terminalId = selection.id;
		const exists = state.terminals.some((terminal) => terminal.id === terminalId);
		if (exists) {
			return;
		}
	}

	if (selection?.kind === "project") {
		const projectId = selection.id;
		const exists = state.projects.some((project) => project.id === projectId);
		if (exists) {
			return;
		}
	}

	if (state.activeTerminalId) {
		selection = { kind: "terminal", id: state.activeTerminalId };
		return;
	}

	if (state.projects.length > 0) {
		selection = { kind: "project", id: sortProjects(state.projects)[0]!.id };
		return;
	}

	selection = null;
}

function reconcileSidebarState(): void {
	for (const projectId of [...collapsedProjectIds]) {
		if (!findProject(projectId)) {
			collapsedProjectIds.delete(projectId);
		}
	}

	if (contextMenuState) {
		const stillExists =
			contextMenuState.kind === "project"
				? Boolean(findProject(contextMenuState.id))
				: state.terminals.some((terminal) => terminal.id === contextMenuState?.id);
		if (!stillExists) {
			hideContextMenu();
		}
	}

	if (editingProjectId && !findProject(editingProjectId)) {
		editingProjectId = null;
		editingProjectDraft = "";
		shouldFocusProjectEditor = false;
	}

	if (
		editingTerminalId &&
		!state.terminals.some((terminal) => terminal.id === editingTerminalId)
	) {
		editingTerminalId = null;
		editingTerminalDraft = "";
		shouldFocusTerminalEditor = false;
		activateTerminalAfterRenameId = null;
	}
}

function toggleProjectCollapsed(projectId: string): void {
	if (collapsedProjectIds.has(projectId)) {
		collapsedProjectIds.delete(projectId);
	} else {
		collapsedProjectIds.add(projectId);
	}

	renderTree();
}

function showContextMenu(
	target: { kind: "project" | "terminal"; id: string },
	clientX: number,
	clientY: number,
): void {
	contextMenuState = target;
	const renameLabel =
		target.kind === "project" ? "Rename project" : "Rename console";
	const deleteLabel =
		target.kind === "project" ? "Delete project" : "Delete console";
	sidebarContextMenu.innerHTML = `
		<button type="button" class="context-menu-item" data-context-action="rename">
			${renameLabel}
		</button>
		<button type="button" class="context-menu-item danger" data-context-action="delete">
			${deleteLabel}
		</button>
	`;
	sidebarContextMenu.classList.remove("hidden");
	sidebarContextMenu.setAttribute("aria-hidden", "false");

	const horizontalPadding = 12;
	const verticalPadding = 12;
	const menuWidth = 190;
	const menuHeight = 88;
	sidebarContextMenu.style.left = `${Math.min(clientX, window.innerWidth - menuWidth - horizontalPadding)}px`;
	sidebarContextMenu.style.top = `${Math.min(clientY, window.innerHeight - menuHeight - verticalPadding)}px`;
}

function hideContextMenu(): void {
	contextMenuState = null;
	sidebarContextMenu.classList.add("hidden");
	sidebarContextMenu.setAttribute("aria-hidden", "true");
	sidebarContextMenu.innerHTML = "";
}

async function renameProjectFromMenu(projectId: string): Promise<void> {
	const project = findProject(projectId);
	if (!project) {
		return;
	}

	hideContextMenu();
	const nextName = await showRenameDialog({
		title: "Rename project",
		message: "Choose a new project name.",
		initialValue: project.name,
		confirmLabel: "Rename project",
	});
	if (!nextName || nextName === project.name) {
		return;
	}

	state = await getRendererRpc().proxy.request.renameProject({
		projectId,
		name: nextName,
	});
	renderTree();
	renderInspector();
	renderStatusBoard();
	setStatus(`Project renamed to '${nextName}'.`);
}

async function renameTerminal(terminalId: string): Promise<void> {
	const terminal = state.terminals.find((candidate) => candidate.id === terminalId);
	if (!terminal) {
		return;
	}

	hideContextMenu();
	const nextName = await showRenameDialog({
		title: "Rename console",
		message: "Choose a new console name.",
		initialValue: terminal.name,
		confirmLabel: "Rename console",
	});
	if (!nextName || nextName === terminal.name) {
		return;
	}

	state = await getRendererRpc().proxy.request.renameTerminal({
		terminalId,
		name: nextName,
	});
	renderTree();
	renderInspector();
	renderStatusBoard();
	setStatus(`Console renamed to '${nextName}'.`);
}

async function deleteProject(projectId: string): Promise<void> {
	const project = findProject(projectId);
	if (!project) {
		return;
	}

	const terminalCount = state.terminals.filter(
		(terminal) => terminal.projectId === project.id,
	).length;
	const confirmed = await showConfirmationDialog({
		title: "Delete project?",
		message:
			terminalCount > 0
				? `Delete '${project.name}' and its ${terminalCount} console${terminalCount === 1 ? "" : "s"}? This cannot be undone.`
				: `Delete '${project.name}'? This cannot be undone.`,
		confirmLabel: "Delete project",
	});
	if (!confirmed) {
		return;
	}

	hideContextMenu();
	state = await getRendererRpc().proxy.request.deleteProject({ projectId });
	reconcileSelection();
	reconcileSidebarState();
	pruneTerminalViews();
	renderTree();
	renderInspector();
	renderStatusBoard();
	setStatus(`Deleted project '${project.name}'.`);
}

async function deleteTerminal(terminalId: string): Promise<void> {
	const terminal = state.terminals.find((candidate) => candidate.id === terminalId);
	if (!terminal) {
		return;
	}

	const confirmed = await showConfirmationDialog({
		title: "Delete console?",
		message: `Delete '${terminal.name}' from '${findProject(terminal.projectId)?.name ?? "Unknown project"}'? This cannot be undone.`,
		confirmLabel: "Delete console",
	});
	if (!confirmed) {
		return;
	}

	hideContextMenu();
	state = await getRendererRpc().proxy.request.deleteTerminal({ terminalId });
	reconcileSelection();
	reconcileSidebarState();
	pruneTerminalViews();
	renderTree();
	renderInspector();
	renderStatusBoard();
	setStatus(`Deleted console '${terminal.name}'.`);
}

function showConfirmationDialog(options: {
	title: string;
	message: string;
	confirmLabel: string;
}): Promise<boolean> {
	if (pendingConfirmResolve) {
		pendingConfirmResolve(false);
		pendingConfirmResolve = null;
	}

	confirmDialogTitle.textContent = options.title;
	confirmDialogMessage.textContent = options.message;
	confirmDialogConfirm.textContent = options.confirmLabel;
	confirmDialog.returnValue = "cancel";
	confirmDialog.showModal();
	return new Promise<boolean>((resolve) => {
		pendingConfirmResolve = resolve;
	});
}

function showRenameDialog(options: {
	title: string;
	message: string;
	initialValue: string;
	confirmLabel: string;
}): Promise<string | null> {
	if (pendingRenameResolve) {
		pendingRenameResolve(null);
		pendingRenameResolve = null;
	}

	renameDialogTitle.textContent = options.title;
	renameDialogMessage.textContent = options.message;
	renameDialogInput.value = options.initialValue;
	const renameDialogConfirm = queryHtmlElement<HTMLButtonElement>(
		"rename-dialog-confirm",
	);
	renameDialogConfirm.textContent = options.confirmLabel;
	renameDialog.returnValue = "cancel";
	renameDialog.showModal();
	requestAnimationFrame(() => {
		renameDialogInput.focus();
		renameDialogInput.select();
	});
	return new Promise<string | null>((resolve) => {
		pendingRenameResolve = resolve;
	});
}

function showSettingsDialog(options: SettingsDialogResult): Promise<SettingsDialogResult | null> {
	if (pendingSettingsResolve) {
		pendingSettingsResolve(null);
		pendingSettingsResolve = null;
	}

	settingsDialogInputCwd.value = options.defaultCwd;
	settingsDialogInputShell.value = options.defaultShell;
	settingsBuildVersion.textContent = appBuildInfo.version;
	settingsBuildDate.textContent = appBuildInfo.buildDate
		? formatBuildDate(appBuildInfo.buildDate)
		: "Unknown";
	settingsDialogCustomShells = normalizeCustomShells(
		options.customShells,
		options.defaultShell,
	);
	renderSettingsShellMenu();
	closeSettingsShellMenu();
	settingsDialog.returnValue = "cancel";
	settingsDialog.showModal();
	requestAnimationFrame(() => {
		settingsDialogInputCwd.focus();
		settingsDialogInputCwd.select();
	});
	return new Promise<SettingsDialogResult | null>(
		(resolve) => {
			pendingSettingsResolve = resolve;
		},
	);
}

function openSettingsShellMenu(): void {
	settingsShellMenuOpen = true;
	settingsShellMenu.classList.remove("hidden");
	settingsDialogInputShell.setAttribute("aria-expanded", "true");
	settingsShellToggle.setAttribute("aria-expanded", "true");
	renderSettingsShellMenu();
}

function closeSettingsShellMenu(): void {
	settingsShellMenuOpen = false;
	settingsShellMenu.classList.add("hidden");
	settingsDialogInputShell.setAttribute("aria-expanded", "false");
	settingsShellToggle.setAttribute("aria-expanded", "false");
}

function renderSettingsShellMenu(): void {
	const filter = normalizeShellKey(settingsDialogInputShell.value);
	const builtInOptions = BUILT_IN_SHELL_OPTIONS.filter((shell) =>
		matchesShellFilter(shell, filter),
	);
	const customOptions = settingsDialogCustomShells.filter((shell) =>
		matchesShellFilter(shell, filter),
	);

	const builtInMarkup = builtInOptions
		.map((shell) => renderShellOptionMarkup(shell, "builtin"))
		.join("");
	const customMarkup = customOptions
		.map((shell) => renderShellOptionMarkup(shell, "custom"))
		.join("");

	settingsShellMenu.innerHTML = `
		<div class="settings-shell-group">
			<div class="settings-shell-group-label">Built-in</div>
			${builtInMarkup || '<div class="settings-shell-empty">No built-in shells match the current filter.</div>'}
		</div>
		<div class="settings-shell-group">
			<div class="settings-shell-group-label">Custom</div>
			${customMarkup || '<div class="settings-shell-empty">Type a shell path or command and save settings to remember it here.</div>'}
		</div>
	`;
}

function renderShellOptionMarkup(
	shell: string,
	source: "builtin" | "custom",
): string {
	if (source === "builtin") {
		return `
			<button
				type="button"
				class="settings-shell-option"
				data-shell-option="${escapeHtmlAttribute(shell)}"
				role="option">
				<span class="settings-shell-option-value">${escapeHtml(shell)}</span>
				<span class="settings-shell-option-kind">Built-in</span>
			</button>
		`;
	}

	return `
		<div class="settings-shell-option-row">
			<button
				type="button"
				class="settings-shell-option"
				data-shell-option="${escapeHtmlAttribute(shell)}"
				role="option">
				<span class="settings-shell-option-value">${escapeHtml(shell)}</span>
				<span class="settings-shell-option-kind">Custom</span>
			</button>
			<button
				type="button"
				class="settings-shell-remove"
				data-custom-shell-delete="${escapeHtmlAttribute(shell)}"
				aria-label="Delete saved shell ${escapeHtmlAttribute(shell)}"
				title="Delete saved shell">
				<span aria-hidden="true">X</span>
			</button>
		</div>
	`;
}

function normalizeCustomShells(
	customShells: string[],
	currentShell = "",
): string[] {
	const normalized = new Map<string, string>();
	const push = (value: string) => {
		const trimmed = value.trim();
		if (!trimmed || isBuiltInShell(trimmed)) {
			return;
		}

		const key = normalizeShellKey(trimmed);
		if (!normalized.has(key)) {
			normalized.set(key, trimmed);
		}
	};

	push(currentShell);
	for (const shell of customShells) {
		push(shell);
	}

	return [...normalized.values()];
}

function matchesShellFilter(shell: string, filter: string): boolean {
	return !filter || normalizeShellKey(shell).includes(filter);
}

function normalizeShellKey(shell: string): string {
	return shell.trim().toLowerCase();
}

function isBuiltInShell(shell: string): boolean {
	const normalized = normalizeShellKey(shell);
	return normalized === "pwsh" ||
		normalized === "pwsh.exe" ||
		normalized === "cmd" ||
		normalized === "cmd.exe";
}

async function runUiAction(actionName: string, action: () => Promise<void>): Promise<void> {
	try {
		await action();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`${actionName} failed`, error);
		setStatus(`${actionName} failed: ${message}`);
	}
}

async function createProjectAndBeginRename(): Promise<void> {
	const placeholderName = getNextProjectPlaceholderName();
	state = await getRendererRpc().proxy.request.createProject({
		name: placeholderName,
	});

	const project = findProjectByNameAndCreatedAt(placeholderName);
	if (!project) {
		throw new Error("The newly created project could not be resolved.");
	}

	selection = { kind: "project", id: project.id };
	startEditingProject(project.id, project.name);
	setStatus(`Created '${project.name}'. Type a project name and press Enter to confirm.`);
}

function startEditingProject(projectId: string, currentName: string): void {
	selection = { kind: "project", id: projectId };
	editingTerminalId = null;
	editingTerminalDraft = "";
	shouldFocusTerminalEditor = false;
	activateTerminalAfterRenameId = null;
	editingProjectId = projectId;
	editingProjectDraft = currentName;
	shouldFocusProjectEditor = true;
	renderTree();
	renderInspector();
	renderStatusBoard();
}

function startEditingTerminal(
	terminalId: string,
	currentName: string,
	options?: { activateOnCommit?: boolean },
): void {
	selection = { kind: "terminal", id: terminalId };
	editingProjectId = null;
	editingProjectDraft = "";
	shouldFocusProjectEditor = false;
	editingTerminalId = terminalId;
	editingTerminalDraft = currentName;
	shouldFocusTerminalEditor = true;
	activateTerminalAfterRenameId = options?.activateOnCommit ? terminalId : null;
	renderTree();
	renderInspector();
	renderStatusBoard();
}

function cancelProjectRename(): void {
	const project = editingProjectId ? findProject(editingProjectId) : undefined;
	editingProjectId = null;
	editingProjectDraft = "";
	shouldFocusProjectEditor = false;
	renderTree();
	if (project) {
		setStatus(`Kept project name '${project.name}'.`);
	}
}

async function commitProjectRename(projectId: string): Promise<void> {
	if (editingProjectId !== projectId) {
		return;
	}

	const project = findProject(projectId);
	if (!project) {
		cancelProjectRename();
		return;
	}

	const finalName = editingProjectDraft.trim() || project.name;
	editingProjectId = null;
	editingProjectDraft = "";
	shouldFocusProjectEditor = false;

	if (finalName !== project.name) {
		state = await getRendererRpc().proxy.request.renameProject({
			projectId,
			name: finalName,
		});
	}

	renderTree();
	renderInspector();
	renderStatusBoard();
	setStatus(`Project renamed to '${finalName}'.`);
}

async function cancelTerminalRename(): Promise<void> {
	const terminal = editingTerminalId
		? state.terminals.find((candidate) => candidate.id === editingTerminalId)
		: undefined;
	const shouldActivate = Boolean(
		terminal && activateTerminalAfterRenameId === terminal.id,
	);
	editingTerminalId = null;
	editingTerminalDraft = "";
	shouldFocusTerminalEditor = false;
	activateTerminalAfterRenameId = null;
	renderTree();
	if (terminal) {
		setStatus(`Kept console name '${terminal.name}'.`);
		if (shouldActivate) {
			await selectTerminal(terminal.id);
		}
	}
}

async function commitTerminalRename(terminalId: string): Promise<void> {
	if (editingTerminalId !== terminalId) {
		return;
	}

	const terminal = state.terminals.find((candidate) => candidate.id === terminalId);
	if (!terminal) {
		editingTerminalId = null;
		editingTerminalDraft = "";
		shouldFocusTerminalEditor = false;
		activateTerminalAfterRenameId = null;
		renderTree();
		return;
	}

	const finalName = editingTerminalDraft.trim() || terminal.name;
	const shouldActivate = activateTerminalAfterRenameId === terminal.id;
	editingTerminalId = null;
	editingTerminalDraft = "";
	shouldFocusTerminalEditor = false;
	activateTerminalAfterRenameId = null;

	if (finalName !== terminal.name) {
		state = await getRendererRpc().proxy.request.renameTerminal({
			terminalId,
			name: finalName,
		});
	}

	renderTree();
	renderInspector();
	renderStatusBoard();
	setStatus(`Console renamed to '${finalName}'.`);

	if (shouldActivate) {
		await selectTerminal(terminalId);
	}
}

async function createConsoleFromSelection(): Promise<void> {
	const project = await ensureProjectForConsole();
	await createConsoleFromProject(project.id);
}

async function ensureProjectForConsole(): Promise<ProjectRecord> {
	const selectedProject = getSelectedProject();
	if (selectedProject) {
		return selectedProject;
	}

	const firstProject = sortProjects(state.projects)[0];
	if (firstProject) {
		return firstProject;
	}

	const placeholderName = getNextProjectPlaceholderName();
	state = await getRendererRpc().proxy.request.createProject({
		name: placeholderName,
	});
	const project = findProjectByNameAndCreatedAt(placeholderName);
	if (!project) {
		throw new Error("The auto-created project could not be resolved.");
	}

	selection = { kind: "project", id: project.id };
	setStatus(`Created '${project.name}' to host the new console.`);
	return project;
}

async function createConsoleFromProject(projectId: string): Promise<void> {
	const project = findProject(projectId);
	if (!project) {
		return;
	}

	const name = getNextConsolePlaceholderName(project.id);
	state = await getRendererRpc().proxy.request.createTerminal({
		projectId: project.id,
		name,
		cwd: "",
		shell: state.defaults.defaultShell,
	});

	const terminal = findNewestTerminalForProject(project.id);
	if (!terminal) {
		throw new Error("The newly created console could not be resolved.");
	}

	await selectTerminal(terminal.id);
	setStatus(`Created '${terminal.name}' in '${project.name}'. The console is ready for input.`);
}

async function setProjectDefaultCwdFromSelectedTerminal(): Promise<void> {
	const selectedTerminal = getSelectedTerminal();
	if (!selectedTerminal) {
		return;
	}

	const project = findProject(selectedTerminal.projectId);
	if (!project) {
		return;
	}

	const trimmedCwd = selectedTerminal.cwd.trim();
	if (!trimmedCwd) {
		throw new Error("The selected console does not have a working directory to save.");
	}

	state = await getRendererRpc().proxy.request.setProjectDefaultCwd({
		projectId: project.id,
		cwd: trimmedCwd,
	});
	renderTree();
	renderInspector();
	renderStatusBoard();
	setStatus(`New consoles in '${project.name}' will start in '${trimmedCwd}'.`);
}

async function openSettingsDialog(): Promise<void> {
	const settings = await showSettingsDialog({
		defaultCwd: state.defaults.defaultCwd,
		defaultShell: state.defaults.defaultShell,
		customShells: state.defaults.customShells,
	});

	if (!settings) {
		return;
	}

	state = await getRendererRpc().proxy.request.updateDefaults(settings);
	renderTree();
	renderInspector();
	renderStatusBoard();
	setStatus("Updated default console settings.");
}

async function selectTerminal(terminalId: string): Promise<void> {
	const terminalRecord = state.terminals.find((terminal) => terminal.id === terminalId);
	if (!terminalRecord) {
		return;
	}

	selection = { kind: "terminal", id: terminalRecord.id };
	const terminalView = ensureTerminalView(terminalRecord.id);
	showTerminalView(terminalRecord.id, false);
	terminalView.fitAddon.fit();

	state = await getRendererRpc().proxy.request.activateTerminal({
		terminalId: terminalRecord.id,
		cols: terminalView.terminal.cols,
		rows: terminalView.terminal.rows,
	});

	renderTree();
	renderInspector();
	renderStatusBoard();
	setStatus(`Activated '${terminalRecord.name}'.`);
}

function renderTree(): void {
	projectCount.textContent = String(state.projects.length);

	let nextTreeMarkup: string;
	if (state.projects.length === 0) {
		nextTreeMarkup = `
			<li class="empty-state">
				<div class="empty-state-title">No projects yet</div>
				<div class="empty-state-copy">Create a project to start organizing consoles.</div>
			</li>
		`;
	} else {
		nextTreeMarkup = sortProjects(state.projects)
			.map((project) => {
				const terminals = sortTerminals(
					state.terminals.filter((terminal) => terminal.projectId === project.id),
				);
				const isProjectSelected =
					selection?.kind === "project" && selection.id === project.id;
				const isEditing = editingProjectId === project.id;
				const isCollapsed = collapsedProjectIds.has(project.id);

				const projectLabel = isEditing
					? `
						<div class="tree-project-shell selected">
							<button
								type="button"
								class="tree-project-toggle ${isCollapsed ? "collapsed" : ""}"
								data-project-toggle-id="${project.id}"
								aria-label="${isCollapsed ? "Expand" : "Collapse"} ${escapeHtmlAttribute(project.name)}">
								${chevronIconMarkup()}
							</button>
							${folderIconMarkup()}
							<form class="tree-project-form" data-project-edit-form="${project.id}">
								<input
									class="tree-project-input"
									data-project-edit-input="${project.id}"
									type="text"
									value="${escapeHtmlAttribute(editingProjectDraft)}"
									aria-label="Project name" />
							</form>
							<span class="tree-project-count">${terminals.length}</span>
						</div>
					`
					: `
						<button
							type="button"
							class="tree-project-button ${isProjectSelected ? "active" : ""}"
							data-project-id="${project.id}">
							<span
								class="tree-project-toggle ${isCollapsed ? "collapsed" : ""}"
								data-project-toggle-id="${project.id}"
								role="button"
								tabindex="-1"
								aria-label="${isCollapsed ? "Expand" : "Collapse"} ${escapeHtmlAttribute(project.name)}">
								${chevronIconMarkup()}
							</span>
							${folderIconMarkup()}
							<span class="tree-project-copy">
								<span class="tree-project-title">${escapeHtml(project.name)}</span>
								<span class="tree-project-detail">${formatConsoleCount(terminals.length)}</span>
							</span>
						</button>
					`;

				const terminalsMarkup =
					terminals.length === 0
						? `<li class="tree-empty">No consoles</li>`
						: terminals
								.map(
									(terminal) => {
										const isTerminalEditing = editingTerminalId === terminal.id;
									if (isTerminalEditing) {
										return `
											<li>
												<div class="tree-terminal-shell active">
													<form class="tree-terminal-form" data-terminal-edit-form="${terminal.id}">
															<input
																class="tree-terminal-input"
																data-terminal-edit-input="${terminal.id}"
																type="text"
																value="${escapeHtmlAttribute(editingTerminalDraft)}"
																aria-label="Console name" />
													</form>
													<div class="tree-terminal-meta">
														${renderTerminalProgressMarkup(terminal.progressInfo)}
														<span class="activity-chip compact ${terminal.activity.phase}">${formatActivityPhase(terminal.activity.phase)}</span>
														<span class="tree-terminal-time">${formatRelativeTime(getTerminalRecency(terminal))}</span>
													</div>
												</div>
												</li>
											`;
										}

										return `
											<li>
												<button
													type="button"
													class="tree-terminal-button ${selection?.kind === "terminal" && selection.id === terminal.id ? "active" : ""}"
													data-terminal-id="${terminal.id}">
												<div class="tree-terminal-copy">
													<span class="tree-terminal-title">${escapeHtml(terminal.name)}</span>
													<span class="tree-terminal-detail">${escapeHtml(terminal.activity.summary)}</span>
												</div>
												<div class="tree-terminal-meta">
													${renderTerminalProgressMarkup(terminal.progressInfo)}
													<span class="activity-chip compact ${terminal.activity.phase}">${formatActivityPhase(terminal.activity.phase)}</span>
													<span class="tree-terminal-time">${formatRelativeTime(getTerminalRecency(terminal))}</span>
												</div>
											</button>
											</li>
										`;
									},
								)
								.join("");

				return `
					<li class="tree-node">
						<div class="tree-project-row" data-project-row-id="${project.id}">
							${projectLabel}
							<button
								type="button"
								class="tree-project-action"
								data-project-new-console-id="${project.id}"
								title="New console in ${escapeHtmlAttribute(project.name)}"
								aria-label="New console in ${escapeHtmlAttribute(project.name)}">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M12 5v14"></path>
									<path d="M5 12h14"></path>
								</svg>
							</button>
						</div>
						<ul class="tree-children ${isCollapsed ? "collapsed" : ""}">${terminalsMarkup}</ul>
					</li>
				`;
			})
			.join("");
	}

	if (nextTreeMarkup === lastRenderedTreeMarkup) {
		return;
	}

	projectTreeElement.innerHTML = nextTreeMarkup;
	lastRenderedTreeMarkup = nextTreeMarkup;

	focusProjectEditorIfNeeded();
	focusTerminalEditorIfNeeded();
}

function renderInspector(): void {
	const selectedProject = getSelectedProject();
	const selectedTerminal = getSelectedTerminal();

	if (selectedTerminal) {
		const failureTime =
			selectedTerminal.lastCommandFailure?.timestamp ??
			selectedTerminal.lastSessionFailure?.timestamp ??
			null;
		const failureExitCode =
			selectedTerminal.lastCommandFailure?.exitCode ??
			selectedTerminal.lastSessionFailure?.exitCode ??
			null;
		const errorMessage =
			selectedTerminal.lastCommandFailure?.errorMessage ??
			selectedTerminal.lastSessionFailure?.message ??
			null;
		const recentOutputExcerpt =
			selectedTerminal.lastCommandFailure?.recentOutputExcerpt ||
			selectedTerminal.lastSessionFailure?.recentOutputExcerpt ||
			"";

		selectionTitle.textContent = selectedTerminal.name;
		selectionSubtitle.textContent = `Project: ${findProject(selectedTerminal.projectId)?.name ?? "Unknown"} | Session state: ${formatStatus(selectedTerminal.status)} | Activity: ${selectedTerminal.activity.summary}`;
		selectionMetadata.innerHTML = `
			<dt>Working directory</dt>
			<dd>${escapeHtml(selectedTerminal.cwd)}</dd>
			<dt>Shell</dt>
			<dd>${escapeHtml(selectedTerminal.shell)}</dd>
			<dt>Project default directory</dt>
			<dd>${escapeHtml(findProject(selectedTerminal.projectId)?.defaultCwd ?? "Uses global default")}</dd>
			<dt>Activity</dt>
			<dd>${escapeHtml(selectedTerminal.activity.detail)}</dd>
			<dt>Progress</dt>
			<dd>${escapeHtml(formatProgressSummary(selectedTerminal.progressInfo))}</dd>
			<dt>Last started</dt>
			<dd>${selectedTerminal.lastStartedAt ? new Date(selectedTerminal.lastStartedAt).toLocaleString() : "Not started yet"}</dd>
			<dt>Last telemetry update</dt>
			<dd>${new Date(selectedTerminal.activity.updatedAt).toLocaleString()}</dd>
			<dt>Last exit code</dt>
			<dd>${selectedTerminal.lastExitCode ?? "N/A"}</dd>
			<dt>Last failed command</dt>
			<dd class="metadata-wrap">${renderOptionalCodeBlock(selectedTerminal.lastCommandFailure?.commandText)}</dd>
			<dt>Failure time</dt>
			<dd>${failureTime ? new Date(failureTime).toLocaleString() : "None recorded"}</dd>
			<dt>Failure exit code</dt>
			<dd>${failureExitCode ?? "N/A"}</dd>
			<dt>Error message</dt>
			<dd class="metadata-wrap">${renderOptionalCodeBlock(errorMessage)}</dd>
			<dt>Recent output excerpt</dt>
			<dd class="metadata-wrap">${renderOptionalCodeBlock(recentOutputExcerpt)}</dd>
			<dt>Diagnostic log path</dt>
			<dd class="metadata-wrap">${renderOptionalCodeBlock(selectedTerminal.diagnosticLogPath)}</dd>
		`;
		restartTerminalButton.disabled = false;
		setProjectDefaultCwdButton.disabled = !selectedTerminal.cwd.trim();
		terminalEmpty.style.display = terminalViews.has(selectedTerminal.id)
			? "none"
			: "flex";
		scheduleSelectedTerminalLayoutSync();
		return;
	}

	if (selectedProject) {
		selectionTitle.textContent = selectedProject.name;
		selectionSubtitle.textContent =
			"Select one of this project's consoles to start or return to a live pseudoterminal session.";
		selectionMetadata.innerHTML = `
			<dt>Created</dt>
			<dd>${new Date(selectedProject.createdAt).toLocaleString()}</dd>
			<dt>Consoles</dt>
			<dd>${state.terminals.filter((terminal) => terminal.projectId === selectedProject.id).length}</dd>
			<dt>Default working directory</dt>
			<dd>${escapeHtml(selectedProject.defaultCwd ?? `Uses global default: ${state.defaults.defaultCwd}`)}</dd>
			<dt>Rename</dt>
			<dd>Double-click the project in the sidebar to rename it.</dd>
			<dt>Persistence</dt>
			<dd>Projects and console definitions are stored. Consoles reopen with their last saved working directory, but live processes are not restored on relaunch.</dd>
		`;
		restartTerminalButton.disabled = true;
		setProjectDefaultCwdButton.disabled = true;
		terminalEmpty.style.display = state.activeTerminalId ? "none" : "flex";
		return;
	}

	selectionTitle.textContent = "Select a console";
	selectionSubtitle.textContent =
		"Each console leaf becomes a live ConPTY session once activated.";
	selectionMetadata.innerHTML = "";
	restartTerminalButton.disabled = true;
	setProjectDefaultCwdButton.disabled = true;
	terminalEmpty.style.display = "flex";
}

function renderStatusBoard(): void {
	const selectedTerminal = getSelectedTerminal();
	const activity = selectedTerminal?.activity ?? createFallbackActivity();

	activityIndicator.className = `activity-indicator ${activity.phase}`;
	activityTitle.textContent = selectedTerminal
		? `${selectedTerminal.name}: ${activity.summary}`
		: activity.summary;
	activityDetail.textContent = selectedTerminal
		? activity.detail
		: "Select a console to see live status and recent activity.";
	activityChip.className = `activity-chip ${activity.phase}`;
	activityChip.textContent = formatActivityPhase(activity.phase);
	activityUpdated.textContent = selectedTerminal
		? `Updated ${formatRelativeTime(activity.updatedAt)}`
		: "No console selected";
	statusBanner.textContent = statusMessage;
	scheduleSelectedTerminalLayoutSync();
}

function pruneTerminalViews(): void {
	const activeTerminalIds = new Set(state.terminals.map((terminal) => terminal.id));
	for (const [terminalId, terminalView] of terminalViews) {
		if (activeTerminalIds.has(terminalId)) {
			continue;
		}

		terminalView.terminal.dispose();
		terminalView.wrapper.remove();
		terminalViews.delete(terminalId);
	}
}

function ensureTerminalView(terminalId: string): TerminalView {
	const existing = terminalViews.get(terminalId);
	if (existing) {
		return existing;
	}

	const wrapper = document.createElement("div");
	wrapper.className = "terminal-pane";
	wrapper.dataset.terminalId = terminalId;

	const surface = document.createElement("div");
	surface.className = "terminal-surface";
	wrapper.append(surface);
	terminalStack.append(wrapper);

	const terminal = new Terminal({
		allowTransparency: false,
		cursorBlink: true,
		fontFamily: 'Cascadia Mono, Consolas, "Courier New", monospace',
		fontSize: 13,
		fontWeight: "400",
		fontWeightBold: "700",
		letterSpacing: 0,
		lineHeight: 1,
		scrollback: 5000,
		theme: {
			background: "#0c0f14",
			foreground: "#e6edf3",
			cursor: "#5ea0ff",
			selectionBackground: "rgba(94, 160, 255, 0.28)",
		},
	});

	const fitAddon = new FitAddon();
	terminal.loadAddon(fitAddon);
	terminal.open(surface);
	terminal.onData((data) => {
		void getRendererRpc().proxy.request.sendInput({ terminalId, data });
	});

	const terminalView: TerminalView = {
		terminal,
		fitAddon,
		wrapper,
		surface,
	};

	terminalViews.set(terminalId, terminalView);
	return terminalView;
}

function showTerminalView(terminalId: string, notifyBackend = true): void {
	for (const [id, terminalView] of terminalViews) {
		terminalView.wrapper.classList.toggle("active", id === terminalId);
	}

	terminalEmpty.style.display = "none";

	const selected = terminalViews.get(terminalId);
	if (!selected) {
		return;
	}

	requestAnimationFrame(() => {
		selected.fitAddon.fit();
		if (notifyBackend) {
			void getRendererRpc().proxy.request.resizeTerminal({
				terminalId,
				cols: selected.terminal.cols,
				rows: selected.terminal.rows,
			});
		}
		selected.terminal.focus();
	});
}

function focusProjectEditorIfNeeded(): void {
	if (!shouldFocusProjectEditor || !editingProjectId) {
		return;
	}

	shouldFocusProjectEditor = false;
	requestAnimationFrame(() => {
		const input = projectTreeElement.querySelector<HTMLInputElement>(
			`[data-project-edit-input="${editingProjectId}"]`,
		);
		if (!input) {
			return;
		}

		input.focus();
		input.select();
	});
}

function focusTerminalEditorIfNeeded(): void {
	if (!shouldFocusTerminalEditor || !editingTerminalId) {
		return;
	}

	shouldFocusTerminalEditor = false;
	requestAnimationFrame(() => {
		const input = projectTreeElement.querySelector<HTMLInputElement>(
			`[data-terminal-edit-input="${editingTerminalId}"]`,
		);
		if (!input) {
			return;
		}

		input.focus();
		input.select();
	});
}

function getSelectedProject(): ProjectRecord | undefined {
	if (selection?.kind === "project") {
		const projectId = selection.id;
		return state.projects.find((project) => project.id === projectId);
	}

	if (selection?.kind === "terminal") {
		const terminalId = selection.id;
		const terminal = state.terminals.find(
			(candidate) => candidate.id === terminalId,
		);
		return terminal ? findProject(terminal.projectId) : undefined;
	}

	return undefined;
}

function getSelectedTerminal(): TerminalRecord | undefined {
	if (selection?.kind !== "terminal") {
		return undefined;
	}

	const terminalId = selection.id;
	return state.terminals.find((terminal) => terminal.id === terminalId);
}

function findProject(projectId: string): ProjectRecord | undefined {
	return state.projects.find((project) => project.id === projectId);
}

function findNewestTerminalForProject(projectId: string): TerminalRecord | undefined {
	return [...state.terminals]
		.filter((terminal) => terminal.projectId === projectId)
		.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
		[0];
}

function findProjectByNameAndCreatedAt(name: string): ProjectRecord | undefined {
	return [...state.projects]
		.filter((project) => project.name === name)
		.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
		[0];
}

function sortProjects(projects: ProjectRecord[]): ProjectRecord[] {
	return [...projects];
}

function sortTerminals(terminals: TerminalRecord[]): TerminalRecord[] {
	return [...terminals];
}

function getTerminalRecency(terminal: TerminalRecord): number {
	return Math.max(
		Date.parse(terminal.lastStartedAt ?? terminal.createdAt),
		Date.parse(terminal.activity.updatedAt),
		0,
	);
}

function setStatus(message: string): void {
	statusMessage = message;
	renderStatusBoard();
}

function scheduleProgressRender(): void {
	if (progressRenderScheduled) {
		return;
	}

	progressRenderScheduled = true;
	requestAnimationFrame(() => {
		progressRenderScheduled = false;
		renderTree();
		renderInspector();
		renderStatusBoard();
	});
}

function renderTerminalProgressMarkup(progressInfo: TerminalProgressInfo): string {
	if (progressInfo.state === "none") {
		return "";
	}

	const fillWidth = progressInfo.state === "indeterminate"
		? "100%"
		: `${Math.max(0, Math.min(100, progressInfo.value))}%`;

	return `
		<span class="tree-progress tree-progress-${progressInfo.state}" title="${escapeHtmlAttribute(formatProgressSummary(progressInfo))}">
			<span class="tree-progress-track">
				<span class="tree-progress-fill" style="width: ${fillWidth};"></span>
			</span>
			<span class="tree-progress-label">${escapeHtml(formatProgressLabel(progressInfo))}</span>
		</span>
	`;
}

function renderOptionalCodeBlock(value: string | null | undefined): string {
	if (!value || !value.trim()) {
		return "None recorded";
	}

	return `<pre class="metadata-pre">${escapeHtml(value)}</pre>`;
}

async function loadBuildInfo(): Promise<AppBuildInfo> {
	try {
		const response = await fetch("/build-info.json", { cache: "no-store" });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}`);
		}

		const payload = await response.json();
		if (
			typeof payload?.version !== "string" ||
			typeof payload?.buildDate !== "string"
		) {
			throw new Error("Invalid build info payload.");
		}

		return {
			version: payload.version,
			buildDate: payload.buildDate,
		};
	} catch {
		return {
			version: "Unknown",
			buildDate: "",
		};
	}
}

function formatBuildDate(buildDateIso: string): string {
	const date = new Date(buildDateIso);
	if (Number.isNaN(date.getTime())) {
		return buildDateIso;
	}

	return date.toLocaleString(undefined, {
		year: "numeric",
		month: "short",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
		timeZoneName: "short",
	});
}

function scheduleSelectedTerminalLayoutSync(): void {
	if (layoutSyncScheduled) {
		return;
	}

	layoutSyncScheduled = true;
	requestAnimationFrame(() => {
		layoutSyncScheduled = false;

		const selectedTerminal = getSelectedTerminal();
		if (!selectedTerminal) {
			return;
		}

		const terminalView = terminalViews.get(selectedTerminal.id);
		if (!terminalView) {
			return;
		}

		const previousCols = terminalView.terminal.cols;
		const previousRows = terminalView.terminal.rows;
		terminalView.fitAddon.fit();

		if (
			(previousCols !== terminalView.terminal.cols ||
				previousRows !== terminalView.terminal.rows) &&
			(selectedTerminal.status === "running" ||
				selectedTerminal.status === "starting")
		) {
			void getRendererRpc().proxy.request.resizeTerminal({
				terminalId: selectedTerminal.id,
				cols: terminalView.terminal.cols,
				rows: terminalView.terminal.rows,
			});
		}
	});
}

function getNextProjectPlaceholderName(): string {
	return getNextPlaceholderName(
		state.projects.map((project) => project.name),
		"Project",
	);
}

function getNextConsolePlaceholderName(projectId: string): string {
	return getNextPlaceholderName(
		state.terminals
			.filter((terminal) => terminal.projectId === projectId)
			.map((terminal) => terminal.name),
		"Console",
	);
}

function getNextPlaceholderName(existingNames: string[], prefix: string): string {
	const usedNumbers = new Set<number>();
	const matcher = new RegExp(`^${prefix} (\\d+)$`);
	for (const existingName of existingNames) {
		const match = matcher.exec(existingName);
		if (match) {
			usedNumbers.add(Number(match[1]));
		}
	}

	let index = 1;
	while (usedNumbers.has(index)) {
		index += 1;
	}

	return `${prefix} ${index}`;
}

function formatConsoleCount(count: number): string {
	return count === 1 ? "1 console" : `${count} consoles`;
}

function formatStatus(status: TerminalStatus): string {
	return status[0]!.toUpperCase() + status.slice(1);
}

function formatActivityPhase(phase: TerminalActivityPhase): string {
	switch (phase) {
		case "working":
			return "Working";
		case "streaming":
			return "Streaming";
		case "waiting":
			return "Ready";
		case "attention":
			return "Attention";
		default:
			return "Idle";
	}
}

function formatProgressLabel(progressInfo: TerminalProgressInfo): string {
	if (progressInfo.state === "indeterminate") {
		return "Run";
	}

	return `${Math.max(0, Math.min(100, progressInfo.value))}%`;
}

function formatProgressSummary(progressInfo: TerminalProgressInfo): string {
	switch (progressInfo.state) {
		case "normal":
			return `Normal ${progressInfo.value}%`;
		case "error":
			return `Error ${progressInfo.value}%`;
		case "indeterminate":
			return "Indeterminate";
		case "warning":
			return `Warning ${progressInfo.value}%`;
		default:
			return "Hidden";
	}
}

function createFallbackActivity(): TerminalActivity {
	return {
		phase: "idle",
		summary: "Console telemetry inactive",
		detail: "Select a console to inspect live session status.",
		progress: 0,
		isIndeterminate: false,
		updatedAt: new Date().toISOString(),
	};
}

function formatRelativeTime(timestamp: number | string): string {
	const value = typeof timestamp === "string" ? Date.parse(timestamp) : timestamp;
	const elapsedMs = Date.now() - value;
	if (elapsedMs < 5_000) {
		return "just now";
	}

	const elapsedMinutes = Math.round(elapsedMs / 60_000);
	if (elapsedMinutes < 60) {
		return `${elapsedMinutes}m`;
	}

	const elapsedHours = Math.round(elapsedMinutes / 60);
	if (elapsedHours < 24) {
		return `${elapsedHours}h`;
	}

	const elapsedDays = Math.round(elapsedHours / 24);
	if (elapsedDays < 7) {
		return `${elapsedDays}d`;
	}

	const elapsedWeeks = Math.round(elapsedDays / 7);
	return `${elapsedWeeks}w`;
}

function folderIconMarkup(): string {
	return `
		<svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
		</svg>
	`;
}

function chevronIconMarkup(): string {
	return `
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<path d="m9 18 6-6-6-6"></path>
		</svg>
	`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function escapeHtmlAttribute(value: string): string {
	return escapeHtml(value);
}

function decodeBase64(base64: string): string {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}

	return utf8Decoder.decode(bytes);
}

function queryHtmlElement<TElement extends HTMLElement>(id: string): TElement {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Element '${id}' was not found.`);
	}

	return element as TElement;
}

function isTitlebarInteractiveTarget(target: HTMLElement): boolean {
	return Boolean(
		target.closest(".titlebar-controls") ||
			target.closest("button") ||
			target.closest("input") ||
			target.closest("textarea") ||
			target.closest("select") ||
			target.closest("a"),
	);
}



