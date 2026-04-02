import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

if (process.platform !== "win32") {
	console.log("Skipping Windows ConPTY host build on non-Windows platform.");
	process.exit(0);
}

const projectPath = resolve(
	import.meta.dir,
	"..",
	"..",
	"..",
	"..",
	"TerminalWindowManager.ConPTYHost",
	"TerminalWindowManager.ConPTYHost.csproj",
);

const result = spawnSync(
	"dotnet",
	["build", projectPath, "--configuration", "Debug", "--nologo", "--verbosity", "minimal"],
	{
		stdio: "inherit",
		shell: process.platform === "win32",
	},
);

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}
