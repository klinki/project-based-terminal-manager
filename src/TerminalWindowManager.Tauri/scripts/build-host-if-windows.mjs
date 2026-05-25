import { spawnSync } from "node:child_process";
import { platform } from "node:process";

if (platform !== "win32") {
	console.log("Skipping ConPTY helper build: the Tauri binary uses the built-in Unix PTY host on this platform.");
	process.exit(0);
}

const result = spawnSync(
	"dotnet",
	[
		"build",
		"../TerminalWindowManager.ConPTYHost/TerminalWindowManager.ConPTYHost.csproj",
		"-v",
		"minimal",
		"-nologo",
	],
	{ stdio: "inherit" },
);

process.exit(result.status ?? 1);
