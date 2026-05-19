# Bug Description

## Title
Slash key can crash the Tauri application

## Status
- awaiting-user-confirmation

## Reported Symptoms
- Typing or pressing `/` sometimes terminates the whole application.
- Existing crash snapshots show a Rust panic on the main thread.
- The crash is intermittent and appears only under special input conditions.
- When the crash happened, two Copilot processes were running and the terminal had set the app into a working state with an indeterminate loading indicator.

## Expected Behavior
- Pressing `/` should either type `/` into the focused terminal/control or be ignored by the focused UI element.
- Keyboard translation failures must not panic the desktop process.

## Actual Behavior
- The app records a fatal panic and exits.
- The panic message is `called Option::unwrap() on a None value`.
- The panic location is `tao-0.34.8/src/platform_impl/windows/keyboard.rs:165:49`.

## Reproduction Details
- Open the Tauri app on Windows.
- Focus a terminal or text-capable control.
- Start Copilot in the terminal and wait until it emits/causes an indeterminate progress/loading state.
- Confirm there are two Copilot processes running if possible.
- Use the Czech input method (`0405:00000405`) or another layout where punctuation/dead-key state affects slash entry.
- Press `/` through the same layout/modifier/dead-key sequence that normally produces it.
- Confirm a new `app-crash-*.log` appears under `%APPDATA%/dev.projectwm.twm-tauri`.

## Affected Area
- Windows desktop keyboard event handling in the Tauri runtime dependency chain.
- Current lockfile resolves `tauri 2.10.3`, `wry 0.54.4`, and `tao 0.34.8`.

## Constraints
- The crash occurs inside a transitive dependency, before application-level keyboard handlers can reliably intercept it.
- A local workaround in frontend `keydown` handlers would not cover all native keyboard messages.

## Open Questions
- Whether the local TAO patch fully resolves the user's original `/` key crash in the installed/runtime app.
- The exact precondition: focused element, active layout, modifiers, Copilot prompt state, and whether a preceding dead key/AltGr sequence is involved.
- Whether the indeterminate progress state is only a coincident Copilot signal or contributes by changing focus/timing around native keyboard messages.
