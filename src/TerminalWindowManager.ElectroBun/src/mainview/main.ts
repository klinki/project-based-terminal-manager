import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Electroview } from "electrobun/view";
import "./style.css";
import type {
	AppState,
	ProjectRecord,
	TerminalActivity,
	TerminalActivityPhase,
	TerminalManagerRpc,
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
			},
			terminalError: ({ terminalId, message }) => {
				const terminalView = ensureTerminalView(terminalId);
				terminalView.terminal.writeln(`\r\n[error] ${message}`);
			},
		},
	},
});

const electroview = new Electroview({ rpc });
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

let state: AppState = {
	defaults: {
		defaultCwd: "",
		defaultShell: "",
	},
	projects: [],
	terminals: [],
	activeTerminalId: null,
};

let selection: Selection = null;
let statusMessage = "Booting Terminal Window Manager ElectroBun proof of concept...";
let layoutSyncScheduled = false;

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
		<aside class="sidebar">
			<div class="sidebar-nav">
				<button class="nav-item">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
					<span>New thread</span>
				</button>
				<button class="nav-item">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
					<span>Automations</span>
				</button>
				<button class="nav-item">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
					<span>Skills</span>
				</button>
			</div>

			<div class="sidebar-threads-header">
				<span>Threads</span>
				<div class="threads-actions">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path><line x1="12" y1="11" x2="12" y2="17"></line><line x1="9" y1="14" x2="15" y2="14"></line></svg>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
				</div>
			</div>

			<div class="project-tree">
				<ul id="project-tree" class="tree-root"></ul>
			</div>

			<div class="sidebar-bottom">
				<button class="nav-item">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.8 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 z"></path></svg>
					<span>Settings</span>
				</button>
				<button class="upgrade-btn">Upgrade</button>
			</div>

			<div style="display:none;">
				<input id="project-name" />
				<button id="create-project"></button>
				<input id="terminal-name" />
				<input id="terminal-cwd" />
				<input id="terminal-shell" />
				<button id="create-terminal"></button>
			</div>
		</aside>

		<main class="workspace">
			<section class="panel">
				<div class="panel-content info-card">
					<div>
						<h1 id="selection-title" class="heading">Select a terminal</h1>
						<p id="selection-subtitle" class="subheading">Sessions stay alive once started so you can switch back and forth quickly.</p>
					</div>
					<div class="toolbar">
						<button id="restart-terminal" class="secondary-button" disabled>Restart selected terminal</button>
					</div>
					<dl id="selection-metadata" class="metadata-grid"></dl>
				</div>
			</section>

			<section class="status-board">
				<div class="status-board-main">
					<div id="activity-indicator" class="activity-indicator idle" aria-hidden="true"></div>
					<div class="status-copy">
						<h2 id="activity-title" class="status-heading">Terminal telemetry inactive</h2>
						<p id="activity-detail" class="status-detail">Select a terminal to inspect live session status.</p>
					</div>
					<div class="status-meta">
						<span id="activity-chip" class="activity-chip idle">Idle</span>
						<span id="activity-updated" class="status-updated">No activity yet</span>
					</div>
				</div>
				<div class="status-banner" id="status-banner">
					Booting Terminal Window Manager ElectroBun proof of concept...
				</div>
			</section>

			<section id="terminal-stage" class="terminal-stage">
				<div id="terminal-empty" class="terminal-stage-empty">
					Choose a terminal on the left to start a live ConPTY-backed session.
				</div>
				<div id="terminal-stack" class="terminal-stack"></div>
			</section>
		</main>
	</div>
`;

const projectTreeElement = queryHtmlElement<HTMLUListElement>("project-tree");
const projectNameInput = queryHtmlElement<HTMLInputElement>("project-name");
const terminalNameInput = queryHtmlElement<HTMLInputElement>("terminal-name");
const terminalCwdInput = queryHtmlElement<HTMLInputElement>("terminal-cwd");
const terminalShellInput = queryHtmlElement<HTMLInputElement>("terminal-shell");
const createProjectButton = queryHtmlElement<HTMLButtonElement>("create-project");
const createTerminalButton =
	queryHtmlElement<HTMLButtonElement>("create-terminal");
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
const terminalStage = queryHtmlElement<HTMLElement>("terminal-stage");
const terminalEmpty = queryHtmlElement<HTMLDivElement>("terminal-empty");
const terminalStack = queryHtmlElement<HTMLDivElement>("terminal-stack");

const terminalStageResizeObserver = new ResizeObserver(() => {
	scheduleSelectedTerminalLayoutSync();
});
terminalStageResizeObserver.observe(terminalStage);

createProjectButton.addEventListener("click", async () => {
	const name = projectNameInput.value.trim();
	if (!name) {
		setStatus("Enter a project name first.");
		return;
	}

	state = await getRendererRpc().proxy.request.createProject({ name });
	projectNameInput.value = "";
	selection = {
		kind: "project",
		id: state.projects[state.projects.length - 1]!.id,
	};
	renderTree();
	renderInspector();
	renderStatusBoard();
	setStatus(`Created project '${name}'.`);
});

createTerminalButton.addEventListener("click", async () => {
	const selectedProject = getSelectedProject();
	if (!selectedProject) {
		setStatus("Select a project node before creating a terminal.");
		return;
	}

	const name = terminalNameInput.value.trim();
	const cwd = terminalCwdInput.value.trim();
	const shell = terminalShellInput.value.trim();
	if (!name || !cwd) {
		setStatus("Terminal name and working directory are required.");
		return;
	}

	state = await getRendererRpc().proxy.request.createTerminal({
		projectId: selectedProject.id,
		name,
		cwd,
		shell,
	});

	const createdTerminal = [...state.terminals]
		.filter((terminal) => terminal.projectId === selectedProject.id)
		.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
		.at(-1);

	if (createdTerminal) {
		selection = { kind: "terminal", id: createdTerminal.id };
	}

	terminalNameInput.value = "";
	terminalShellInput.value = state.defaults.defaultShell;
	renderTree();
	renderInspector();
	renderStatusBoard();
	setStatus(`Added terminal '${name}' under '${selectedProject.name}'.`);
});

projectTreeElement.addEventListener("click", (event) => {
	const target = event.target as HTMLElement;
	const terminalButton = target.closest<HTMLButtonElement>("[data-terminal-id]");
	if (terminalButton) {
		void selectTerminal(terminalButton.dataset.terminalId!);
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

window.addEventListener("resize", () => {
	const selectedTerminal = getSelectedTerminal();
	if (!selectedTerminal) {
		return;
	}

	queueMicrotask(() => {
		const terminalView = ensureTerminalView(selectedTerminal.id);
		terminalView.fitAddon.fit();
		if (
			selectedTerminal.status === "running" ||
			selectedTerminal.status === "starting"
		) {
			void getRendererRpc().proxy.request.resizeTerminal({
				terminalId: selectedTerminal.id,
				cols: terminalView.terminal.cols,
				rows: terminalView.terminal.rows,
			});
		}
	});
});

bootstrap().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	setStatus(`Startup failed: ${message}`);
	throw error;
});

async function bootstrap(): Promise<void> {
	state = await getRendererRpc().proxy.request.getInitialState({});
	terminalCwdInput.value = state.defaults.defaultCwd;
	terminalShellInput.value = state.defaults.defaultShell;
	reconcileSelection();
	renderTree();
	renderInspector();
	renderStatusBoard();
	setStatus(
		"Create projects, add terminals, and click a terminal to start a live ConPTY-backed session.",
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
		selection = { kind: "project", id: state.projects[0]!.id };
		return;
	}

	selection = null;
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
	if (state.projects.length === 0) {
		projectTreeElement.innerHTML =
			`<li class="empty-note">No projects yet. Create one to begin.</li>`;
		return;
	}

	projectTreeElement.innerHTML = state.projects
		.map((project) => {
			const terminals = state.terminals.filter(
				(terminal) => terminal.projectId === project.id,
			);

			const terminalsMarkup =
				terminals.length === 0
					? `<li class="empty-note">No terminals yet.</li>`
					: terminals
							.map(
								(terminal) => `
									<li>
										<button
											class="tree-terminal-button ${selection?.kind === "terminal" && selection.id === terminal.id ? "active" : ""}"
											data-terminal-id="${terminal.id}">
											<div class="thread-info">
												<span class="thread-title">${escapeHtml(terminal.name)}</span>
												<div class="thread-stats">
													<span class="stat-add">+47</span>
													<span class="stat-remove">-83</span>
												</div>
											</div>
											<div class="thread-time">3h</div>
										</button>
									</li>
								`,
							)
							.join("");

			return `
				<li class="tree-node">
					<button
						class="tree-project-button ${selection?.kind === "project" && selection.id === project.id ? "active" : ""}"
						data-project-id="${project.id}">
						<svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
						<span>${escapeHtml(project.name)}</span>
					</button>
					<ul class="tree-children">${terminalsMarkup}</ul>
				</li>
			`;
		})
		.join("");
}

function renderInspector(): void {
	const selectedProject = getSelectedProject();
	const selectedTerminal = getSelectedTerminal();

	if (selectedTerminal) {
		selectionTitle.textContent = selectedTerminal.name;
		selectionSubtitle.textContent = `Project: ${findProject(selectedTerminal.projectId)?.name ?? "Unknown"} | Session state: ${formatStatus(selectedTerminal.status)} | Activity: ${selectedTerminal.activity.summary}`;
		selectionMetadata.innerHTML = `
			<dt>Working directory</dt>
			<dd>${escapeHtml(selectedTerminal.cwd)}</dd>
			<dt>Shell</dt>
			<dd>${escapeHtml(selectedTerminal.shell)}</dd>
			<dt>Activity</dt>
			<dd>${escapeHtml(selectedTerminal.activity.detail)}</dd>
			<dt>Last started</dt>
			<dd>${selectedTerminal.lastStartedAt ? new Date(selectedTerminal.lastStartedAt).toLocaleString() : "Not started yet"}</dd>
			<dt>Last telemetry update</dt>
			<dd>${new Date(selectedTerminal.activity.updatedAt).toLocaleString()}</dd>
			<dt>Last exit code</dt>
			<dd>${selectedTerminal.lastExitCode ?? "N/A"}</dd>
		`;
		restartTerminalButton.disabled = false;
		terminalEmpty.style.display = terminalViews.has(selectedTerminal.id)
			? "none"
			: "flex";
		return;
	}

	if (selectedProject) {
		selectionTitle.textContent = selectedProject.name;
		selectionSubtitle.textContent =
			"Select one of this project's terminals to start or return to a live pseudoterminal session.";
		selectionMetadata.innerHTML = `
			<dt>Created</dt>
			<dd>${new Date(selectedProject.createdAt).toLocaleString()}</dd>
			<dt>Terminals</dt>
			<dd>${state.terminals.filter((terminal) => terminal.projectId === selectedProject.id).length}</dd>
			<dt>Metadata persistence</dt>
			<dd>Projects and terminal definitions are stored. Live processes are not restored on relaunch.</dd>
		`;
		restartTerminalButton.disabled = true;
		terminalEmpty.style.display = state.activeTerminalId ? "none" : "flex";
		return;
	}

	selectionTitle.textContent = "Select a terminal";
	selectionSubtitle.textContent =
		"Each terminal leaf becomes a live ConPTY session once activated.";
	selectionMetadata.innerHTML = "";
	restartTerminalButton.disabled = true;
	terminalEmpty.style.display = "flex";

	scheduleSelectedTerminalLayoutSync();
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
		: "Select a terminal to see live status and recent activity.";
	activityChip.className = `activity-chip ${activity.phase}`;
	activityChip.textContent = formatActivityPhase(activity.phase);
	activityUpdated.textContent = selectedTerminal
		? `Updated ${formatRelativeTime(activity.updatedAt)}`
		: "No terminal selected";
	statusBanner.textContent = statusMessage;
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

function getSelectedProject(): ProjectRecord | undefined {
	if (selection?.kind === "project") {
		const projectId = selection.id;
		return state.projects.find((project) => project.id === projectId);
	}

	if (selection?.kind === "terminal") {
		const terminalId = selection.id;
		const terminal = state.terminals.find((candidate) => candidate.id === terminalId);
		return terminal
			? state.projects.find((project) => project.id === terminal.projectId)
			: undefined;
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

function setStatus(message: string): void {
	statusMessage = message;
	renderStatusBoard();
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

function createFallbackActivity(): TerminalActivity {
	return {
		phase: "idle",
		summary: "Terminal telemetry inactive",
		detail: "Select a terminal to inspect live session status.",
		progress: 4,
		isIndeterminate: false,
		updatedAt: new Date().toISOString(),
	};
}

function formatRelativeTime(updatedAt: string): string {
	const elapsedMs = Date.now() - Date.parse(updatedAt);
	if (elapsedMs < 5_000) {
		return "just now";
	}

	const elapsedSeconds = Math.round(elapsedMs / 1_000);
	if (elapsedSeconds < 60) {
		return `${elapsedSeconds}s ago`;
	}

	const elapsedMinutes = Math.round(elapsedSeconds / 60);
	return `${elapsedMinutes}m ago`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
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
