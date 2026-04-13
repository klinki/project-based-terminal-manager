import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const projectDir = resolve(import.meta.dirname, "..");
const packageJsonPath = resolve(projectDir, "package.json");
const outputDir = resolve(projectDir, "src", "mainview", "public");
const outputPath = resolve(outputDir, "build-info.json");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const version = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
const buildDate = new Date().toISOString();

const output = `${JSON.stringify(
	{
		version,
		buildDate,
	},
	null,
	2,
)}
`;

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, output, "utf8");
