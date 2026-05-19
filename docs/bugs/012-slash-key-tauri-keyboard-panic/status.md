# Bug Status

## Current State
- awaiting-user-confirmation

## Active Attempt
- `fix-attempt-002.md`

## Last Updated
- 2026-05-19

## Confirmation Date
- Pending user confirmation.

## Resolution Summary
- `fix-attempt-001.md` guarded the TAO panic by vendoring a patched TAO crate. `fix-attempt-002.md` replaced that with an app-level Windows message guard so the repository does not carry a full TAO copy.

## Attempt History
- 2026-05-19: `fix-attempt-001.md` started to update the Tauri/TAO dependency chain.
- 2026-05-19: `fix-attempt-001.md` added a local TAO patch after confirming TAO 0.35.2 still contained the unchecked dead-character unwrap.
- 2026-05-19: `fix-attempt-001.md` aligned frontend Tauri packages with the Rust Tauri version and verified the frontend build.
- 2026-05-19: `fix-attempt-002.md` started to replace the vendored TAO patch with an app-level Windows `WM_DEADCHAR` / `WM_SYSDEADCHAR` guard.
- 2026-05-19: `fix-attempt-002.md` removed the local TAO override, deleted `third_party/tao`, installed the Windows message guard, and passed local build/test verification.

## State Change Log
- 2026-05-19: bug opened after inspecting crash logs for slash-key application exits.
- 2026-05-19: investigation identified a TAO 0.34.8 Windows keyboard panic in `WM_DEADCHAR` handling.
- 2026-05-19: build verification passed with patched TAO; awaiting user reproduction confirmation.
- 2026-05-19: user clarified the crash is intermittent and only occurs under special conditions; local Windows input context is Czech (`0405:00000405`).
- 2026-05-19: user added that the crash happened with two Copilot processes running and an indeterminate working/loading indicator active.
- 2026-05-19: user tried indeterminate progress plus `/`; no crash reproduced.
- 2026-05-19: user rejected duplicating the full TAO dependency in source and requested a more elegant fix plus a more detailed reproduction scenario.
- 2026-05-19: investigation confirmed upstream `tao 0.35.2` still has the unchecked dead-character unwrap, so a pure dependency update is not sufficient.
- 2026-05-19: `fix-attempt-002.md` completed local verification and is awaiting user confirmation against the original intermittent slash/dead-key crash.

## Notes
- Existing logs identify the native panic path, but interactive reproduction still depends on the user's keyboard layout/input state.
- The current patch is intentionally broader than the specific `/` sequence: it prevents any unmatched `WM_DEADCHAR` / `WM_SYSDEADCHAR` message from terminating the process.
- Copilot/progress state is now part of the reproduction profile, but the crash log still points to native TAO keyboard handling rather than the progress parser.
- Indeterminate progress alone is not sufficient to reproduce the crash.
- The current implementation intercepts `WM_DEADCHAR` / `WM_SYSDEADCHAR` at the Tauri window before TAO receives them; TAO continues to resolve from crates.io.
