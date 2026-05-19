# Initial Findings

## Confirmed Facts
- Runtime logs exist under `C:\Users\david\AppData\Roaming\dev.projectwm.twm-tauri`.
- `app.log` contains two fatal panic entries on 2026-05-18 and 2026-05-19.
- Both panic entries point to `tao-0.34.8/src/platform_impl/windows/keyboard.rs:165:49`.
- The failing code handles `WM_DEADCHAR | WM_SYSDEADCHAR` and calls `self.event_info.take().unwrap()`.
- Per-terminal `events.jsonl` files sampled near the crash only contain `cwdChanged` events, so the ConPTY helper is not the apparent crash source.
- WebView2 Crashpad reports are empty, so this does not look like a WebView renderer crash.
- The system culture is `cs-CZ`, and the active user language list includes Czech input method `0405:00000405`.
- The user confirmed the crash does not happen on every `/` press and requires special conditions.
- The user observed two Copilot processes running and the app showing a working state with an indeterminate loading indicator when the crash occurred.
- The app's indeterminate loading indicator is terminal-driven progress state from `OSC 9;4;3;<progress>BEL`, not direct process tracking.
- The backend clears progress on helper exit/error/restart, but not while a still-running command has emitted indeterminate progress.

## Likely Cause
- Windows posts a dead-character keyboard message without the pending TAO `event_info` state that TAO 0.34.8 assumes must exist.
- The unchecked unwrap panics on the UI thread and terminates the app.

## Unknowns
- The exact keyboard layout and modifier state needed to reproduce the user's `/` crash every time.
- Whether the issue reproduces only in the terminal surface or also in ordinary text inputs.
- Whether the crash requires a preceding dead key, AltGr sequence, IME state, or focus transition.
- Whether Copilot's two-process state affects keyboard focus, IME/dead-key message ordering, or only explains why indeterminate progress remained visible.

## Reproduction Status
- Not yet reproduced interactively in this session.
- Existing crash logs are sufficient to identify the panicking dependency path.
- Reproduction should focus on Czech-layout punctuation/dead-key sequences rather than plain US-layout slash entry.
- New reproduction target: run Copilot until the app shows indeterminate progress, confirm the two-process condition if possible, then press `/` in the Copilot prompt using the same keyboard layout/modifier sequence.
- User tried forcing the console into indeterminate progress and pressing `/`; this did not reproduce the crash.

## Evidence Gathered
- Crash snapshots:
  - `C:\Users\david\AppData\Roaming\dev.projectwm.twm-tauri\app-crash-20260518T103922Z.log`
  - `C:\Users\david\AppData\Roaming\dev.projectwm.twm-tauri\app-crash-20260519T124943Z.log`
- Source line:
  - `C:\Users\david\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\tao-0.34.8\src\platform_impl\windows\keyboard.rs`
