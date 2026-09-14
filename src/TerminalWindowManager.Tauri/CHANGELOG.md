# Changelog

## [0.6.0](https://github.com/klinki/project-based-terminal-manager/compare/v0.5.0...v0.6.0) (2026-09-14)


### Features

* Add bundle copyright and dynamic About dialog year ([620fc93](https://github.com/klinki/project-based-terminal-manager/commit/620fc93104cde7b16cf8d47460a70fe3390128d7))
* Add native macOS crash dialog ([04a5c70](https://github.com/klinki/project-based-terminal-manager/commit/04a5c70fd64c8b6e0e475c457d8641b522fc6dc6))
* Add native macOS window integration ([30471bd](https://github.com/klinki/project-based-terminal-manager/commit/30471bd1758b257099577659e898e2a476dbf6c2))
* Add native Preferences menu item (Cmd+,) on macOS ([325530d](https://github.com/klinki/project-based-terminal-manager/commit/325530d0edc56eee16c18cbbf6e7f4e43d911177))
* Add POSIX shell hooks for cwd tracking and failure detection ([ea2d9a7](https://github.com/klinki/project-based-terminal-manager/commit/ea2d9a7e186e4ad272a3d4037cedc2a7a1285b2c))
* Bounce the Dock icon when a console needs attention ([5b69cc1](https://github.com/klinki/project-based-terminal-manager/commit/5b69cc15f82831d1b04b031a3317d685d9a0b832))
* Confirm before quitting via Cmd+Q or menu Quit ([b9cbf4a](https://github.com/klinki/project-based-terminal-manager/commit/b9cbf4ad6909b2da7f9ccadcf008857b936eafe7))
* Mirror terminal progress to the macOS Dock tile ([f6796ef](https://github.com/klinki/project-based-terminal-manager/commit/f6796efe94166163cd10dbc3b66687e7c784f98f))
* Parse OSC 9;4 progress sequences in Unix PTY host ([ca012c9](https://github.com/klinki/project-based-terminal-manager/commit/ca012c9d56ac8ad0b875283203b76acdb7828761))
* Port Tauri terminal host to macOS ([98a3b48](https://github.com/klinki/project-based-terminal-manager/commit/98a3b488a1882cae61e144e99c80688016872f60))


### Bug Fixes

* Close windows through the backend so sessions stop first ([6cd6c17](https://github.com/klinki/project-based-terminal-manager/commit/6cd6c17a6807d432990402f75c8fac1351481232))
* Harden Unix PTY host diagnostics and shutdown output ([8e185f2](https://github.com/klinki/project-based-terminal-manager/commit/8e185f20689900ad4fc6ed5eb83cebd260f5698f))
* Kill Unix shell process group with SIGKILL escalation ([d3d3bdc](https://github.com/klinki/project-based-terminal-manager/commit/d3d3bdc444999e693d2a34a76b4837c8b24d2434))
* Make sidebar drag-and-drop reliable on macOS ([1e1cc1d](https://github.com/klinki/project-based-terminal-manager/commit/1e1cc1d5dd5e4bcd3a5a0a494c7067f9e82f8964))
* Replace HTML5 sidebar DnD with pointer-based dragging ([9655a9c](https://github.com/klinki/project-based-terminal-manager/commit/9655a9c16db062953ac7933f87dea228ec50e194))
* Restore sidebar reorder and renderer log persistence ([42da9ea](https://github.com/klinki/project-based-terminal-manager/commit/42da9ea0445085552a748d62d5f94bfabbb7515a))
* Treat macOS Ctrl+click as right-click in sidebar gestures ([e7fdabb](https://github.com/klinki/project-based-terminal-manager/commit/e7fdabbfd0ff1cbc694b2ceff140b66d415460c6))

## [0.5.0](https://github.com/klinki/project-based-terminal-manager/compare/v0.4.0...v0.5.0) (2026-05-25)


### Features

* Confirm before closing application ([770e2b0](https://github.com/klinki/project-based-terminal-manager/commit/770e2b02734d42c18b762b78919d2c21a28435bd))

## [0.4.0](https://github.com/klinki/project-based-terminal-manager/compare/v0.3.0...v0.4.0) (2026-05-21)


### Features

* Add opt-in Sentry crash reporting ([4b4a5a3](https://github.com/klinki/project-based-terminal-manager/commit/4b4a5a347cabe67caa15fa9088074ad7ccd26b9f))
* Add sidebar drag reordering ([818747b](https://github.com/klinki/project-based-terminal-manager/commit/818747b31b3712ac680f7e62f775571cbbcc8677))
* Show crash dialog for Tauri failures ([22c805b](https://github.com/klinki/project-based-terminal-manager/commit/22c805b704ce71aced43e6a381710a6149c8e2ca))


### Bug Fixes

* ensure unique console names ([8361e2b](https://github.com/klinki/project-based-terminal-manager/commit/8361e2bbed20cc1590b7f349ca35c678f6a57408))
* **frontend:** Fix terminal decoding and dialog submit ([ea4e159](https://github.com/klinki/project-based-terminal-manager/commit/ea4e1599b589dd724ef350dd00f95226c3b47b12))
* Guard TAO dead-key keyboard panic ([5500b3e](https://github.com/klinki/project-based-terminal-manager/commit/5500b3ef2aab9a38ec35adead212c3ab2d4f9da7))
* reduce terminal output backpressure ([4d5f758](https://github.com/klinki/project-based-terminal-manager/commit/4d5f758769acbcf4f716c4649d34e85b3d61f4c4))
* Refresh Windows PATH for terminal sessions ([815ca6e](https://github.com/klinki/project-based-terminal-manager/commit/815ca6e2c579a1a263b24e5a2a0c8b54ad04eff1))
* Replace vendored TAO keyboard panic guard ([7188329](https://github.com/klinki/project-based-terminal-manager/commit/7188329193640a13a7db60a284638b76ff4aa4a3))

## [0.3.0](https://github.com/klinki/project-based-terminal-manager/compare/v0.2.0...v0.3.0) (2026-04-14)


### Features

* **tauri:** show build version and date in settings ([323a5c1](https://github.com/klinki/project-based-terminal-manager/commit/323a5c1e3171060c9791f316b32843a6116aab86))
* **tauri:** show console progress in Windows taskbar ([98db550](https://github.com/klinki/project-based-terminal-manager/commit/98db5507c32101d72a371dd7ad41a1c8744d7634))


### Bug Fixes

* Harden terminal crash isolation and diagnostics ([18497fb](https://github.com/klinki/project-based-terminal-manager/commit/18497fbca056668d2a479276279392a25eff527b))
* **tauri:** stop dev rebuild loop from helper staging ([9d6795a](https://github.com/klinki/project-based-terminal-manager/commit/9d6795aefbff1c356db94544af88849a94756c2f))

## [0.2.0](https://github.com/klinki/project-based-terminal-manager/compare/v0.1.0...v0.2.0) (2026-04-13)


### Features

* add terminal progress indicator support ([6aa05c0](https://github.com/klinki/project-based-terminal-manager/commit/6aa05c0fbe2eab3c31a57922c2860de1cfba2d80))


### Bug Fixes

* Add persistent shell selector ([9c2b385](https://github.com/klinki/project-based-terminal-manager/commit/9c2b385ee5d9fcfbc88eedf443fa9dee51d4877a))
* Correct dialog heading colors ([0c4e807](https://github.com/klinki/project-based-terminal-manager/commit/0c4e8073c1f43086f5e303e138fea66dff7a0f99))
* **tauri:** bundle conpty host in installer ([7317b22](https://github.com/klinki/project-based-terminal-manager/commit/7317b2285286e9b8793f52d2736b136b021bf57a))
* **tauri:** hide console window for packaged app ([2af7cc1](https://github.com/klinki/project-based-terminal-manager/commit/2af7cc1f8004eaa54ddf88de936344c41a4d94d2))
* **tauri:** Prevent sidebar rerenders during streaming ([66b408f](https://github.com/klinki/project-based-terminal-manager/commit/66b408f48a710e6f8a1a7d2323b6c9822cd3f409))
* **tauri:** recover when terminal cwd is missing ([c7dface](https://github.com/klinki/project-based-terminal-manager/commit/c7dfacec5f6ad4901cb8cfccbabcdd8ffc44a4b7))
* **tauri:** Respect Project Default Cwd ([19b0a97](https://github.com/klinki/project-based-terminal-manager/commit/19b0a97698b7719496cd7df2b8aaecc2253dfc4f))
* **tauri:** restore native titlebar behaviors ([375fa9e](https://github.com/klinki/project-based-terminal-manager/commit/375fa9ed2957f1e73ac1169790ece4ac39273ad4))

## [0.1.0](https://github.com/klinki/project-based-terminal-manager/compare/v0.0.1...v0.1.0) (2026-04-08)


### Features

* **shells:** default to powershell on windows ([038c9e2](https://github.com/klinki/project-based-terminal-manager/commit/038c9e2393118b664be4d787d0c05e537fd75aaa))
* **shells:** split ElectroBun and Tauri projects ([b56fda6](https://github.com/klinki/project-based-terminal-manager/commit/b56fda68f426be83c2ff46dd822f106915bcd787))
* **tauri:** persist terminal cwd state ([c4ae3b8](https://github.com/klinki/project-based-terminal-manager/commit/c4ae3b8010f5092897e33b59c536e925f507ed34))

## Changelog
