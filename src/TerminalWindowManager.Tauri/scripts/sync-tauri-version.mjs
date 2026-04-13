import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const projectDir = resolve(import.meta.dirname, "..");
const packageJsonPath = resolve(projectDir, "package.json");
const cargoTomlPath = resolve(projectDir, "src-tauri", "Cargo.toml");
const cargoLockPath = resolve(projectDir, "src-tauri", "Cargo.lock");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const version = typeof packageJson.version === "string" ? packageJson.version : null;

if (!version) {
	throw new Error(`Could not determine the package version from ${packageJsonPath}.`);
}

const cargoToml = readFileSync(cargoTomlPath, "utf8");
const cargoTomlPattern = /^(\[package\]\r?\n(?:.*\r?\n)*?version\s*=\s*")([^"]+)(")$/m;
const cargoTomlMatch = cargoToml.match(cargoTomlPattern);

if (!cargoTomlMatch) {
	throw new Error(`Could not find the [package] version in ${cargoTomlPath}.`);
}

const nextCargoToml = cargoToml.replace(cargoTomlPattern, `$1${version}$3`);

if (nextCargoToml !== cargoToml) {
	writeFileSync(cargoTomlPath, nextCargoToml, "utf8");
}

try {
	const cargoLock = readFileSync(cargoLockPath, "utf8");
	const cargoLockPattern = /(\[\[package\]\]\r?\nname = "terminal-window-manager-tauri"\r?\nversion = ")([^"]+)(")/;
	const nextCargoLock = cargoLock.replace(cargoLockPattern, `$1${version}$3`);

	if (nextCargoLock !== cargoLock) {
		writeFileSync(cargoLockPath, nextCargoLock, "utf8");
	}
}
catch (error) {
	if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
		// Cargo.lock is optional for this sync step.
	}
	else {
		throw error;
	}
}
