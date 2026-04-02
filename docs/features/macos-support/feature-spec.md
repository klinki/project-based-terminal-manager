# macOS Support Feature Spec

## Summary
- Save path: `docs/features/macos-support/feature-spec.md`
- Artifact type: `feature-spec.md`
- Add macOS as the second supported platform by making the ElectroBun app the cross-platform product surface.
- Keep the WPF app and `WindowsTerminalService` Windows-only; do not attempt to port the HWND-hosting model to macOS.
- Scope macOS v1 to app-owned terminal sessions only, with a usable unsigned app first. Apple signing/notarization is a follow-up release track.

## Product Definition
- macOS support means users can run the ElectroBun desktop app on macOS, create projects, create terminals, and run/restart live terminal sessions inside the app with comparable project/session UX to the current ElectroBun Windows experience.
- macOS v1 must not depend on embedding Terminal.app, iTerm, or arbitrary third-party windows.
- The app should detect a reasonable default shell on macOS from the user environment, with `/bin/zsh` as the fallback.
- Windows remains supported through both existing fronts:
  - WPF + Windows Terminal host path stays Windows-only.
  - ElectroBun continues to work on Windows.
- macOS becomes supported only through ElectroBun.

## Key Changes
- Introduce a platform-neutral terminal session backend contract for ElectroBun so the renderer and app state stop depending on a Windows-specific helper shape.
- Split the current helper/backend into:
  - Windows backend: existing ConPTY-based helper.
  - macOS backend: a Unix PTY implementation that owns the shell process and streams input/output/resizes through the same Bun-facing contract.
- Refactor shared models so `TerminalWindowManager.Core` no longer treats native window handles and Windows-specific hosting state as core cross-platform concepts.
- Keep `IWindowsTerminalService`, `WindowsTerminalService`, WPF hosting controls, and any HWND/DLL-import behavior in Windows-only projects.
- Update ElectroBun build/runtime resolution so helper selection is OS-aware instead of hard-coded to `net10.0-windows` output paths.
- Update the build script and packaging flow to support:
  - Windows build path as-is.
  - macOS ElectroBun development and desktop packaging path.
  - CI/build matrix for Windows and macOS.
- Define macOS terminal behavior explicitly:
  - login shell or configured shell path
  - PTY-backed resize/input/output
  - project/session persistence
  - restart/stop behavior
  - existing diagnostics model carried forward where feasible

## Interfaces / Architecture
- Add a platform-neutral session manager contract for ElectroBun with the same logical events on both OSes: `started`, `output`, `exit`, `error`, `diagnostic`.
- Add a backend selection layer in Bun that chooses Windows ConPTY vs macOS Unix PTY by platform.
- Move Windows-only concepts out of shared core interfaces and models:
  - HWND / `IntPtr` window-host state
  - `IWindowsTerminalService` naming and assumptions
  - direct Windows Terminal launch semantics
- Preserve the ElectroBun RPC surface for create/activate/send-input/resize/restart unless a concrete backend mismatch forces a narrow extension.

## Delivery Phases
- Phase 1: portability foundation
  - isolate Windows-only desktop code
  - define cross-platform terminal backend contract
  - make build/package paths OS-aware
- Phase 2: macOS terminal backend
  - implement Unix PTY session ownership
  - wire shell detection, resize, streaming, restart, diagnostics
  - validate Apple Silicon and Intel build/runtime behavior
- Phase 3: supportability
  - add CI coverage, documentation, install/run guidance
  - produce usable unsigned macOS app artifacts
  - defer signing/notarization to a follow-up feature

## Test Plan
- Windows regression:
  - ElectroBun sessions still start, resize, restart, and persist metadata.
  - WPF app still builds and runs on Windows unchanged.
- macOS functional:
  - app launches on macOS and can create/select projects and terminals.
  - terminal session starts with detected shell or `/bin/zsh` fallback.
  - input/output/resize/restart behave correctly in a PTY-backed session.
  - terminal diagnostics still surface exit/error details.
- Build and packaging:
  - Windows build path still succeeds.
  - macOS ElectroBun desktop build succeeds for internal unsigned distribution.
- Compatibility:
  - existing terminal metadata either migrates cleanly or is safely normalized when platform-specific fields are absent.

## Assumptions
- macOS support is an ElectroBun feature, not a WPF port.
- No external-window hosting, no Terminal.app/iTerm embedding, and no arbitrary macOS window management parity in v1.
- Unsigned internal macOS builds are sufficient for the first milestone.
- A Unix PTY backend is required on macOS; the current ConPTY helper architecture is Windows-only and cannot be reused directly.
