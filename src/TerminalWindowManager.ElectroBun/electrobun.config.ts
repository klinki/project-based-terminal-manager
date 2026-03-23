import type { ElectrobunConfig } from "electrobun";
import packageJson from "./package.json";

export default {
	app: {
		name: "Terminal Window Manager ElectroBun",
		identifier: "dev.projectwm.twm-electrobun",
		version: packageJson.version,
	},
	build: {
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
			"../TerminalWindowManager.ConPTYHost/bin/Debug/net10.0-windows":
				"TerminalWindowManager.ConPTYHost/bin/Debug/net10.0-windows",
		},
		watchIgnore: [
			"dist/**",
			"../TerminalWindowManager.ConPTYHost/bin/**",
			"../TerminalWindowManager.ConPTYHost/obj/**",
		],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
