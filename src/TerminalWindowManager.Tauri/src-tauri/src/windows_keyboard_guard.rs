use tauri::{Manager, Runtime, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::{
        Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
        WindowsAndMessaging::{WM_DEADCHAR, WM_NCDESTROY, WM_SYSDEADCHAR},
    },
};

const DEAD_KEY_GUARD_SUBCLASS_ID: usize = 0x5457_4d44;

pub fn install_for_existing_windows<R: Runtime>(app: &tauri::App<R>) -> Result<(), String> {
    for window in app.webview_windows().values() {
        install_for_window(window)?;
    }

    Ok(())
}

fn install_for_window<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    let hwnd = window
        .hwnd()
        .map_err(|error| format!("Failed to get native window handle: {error}"))?;
    let installed = unsafe {
        SetWindowSubclass(
            hwnd.0 as HWND,
            Some(dead_key_guard_subclass_proc),
            DEAD_KEY_GUARD_SUBCLASS_ID,
            0,
        )
    };

    if installed == 0 {
        return Err(format!(
            "Failed to install dead-key keyboard guard for window '{}'.",
            window.label()
        ));
    }

    Ok(())
}

unsafe extern "system" fn dead_key_guard_subclass_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _subclass_id: usize,
    _ref_data: usize,
) -> LRESULT {
    if is_dead_char_message(message) {
        return 0;
    }

    let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };

    if message == WM_NCDESTROY {
        unsafe {
            RemoveWindowSubclass(
                hwnd,
                Some(dead_key_guard_subclass_proc),
                DEAD_KEY_GUARD_SUBCLASS_ID,
            );
        }
    }

    result
}

fn is_dead_char_message(message: u32) -> bool {
    matches!(message, WM_DEADCHAR | WM_SYSDEADCHAR)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_dead_character_messages() {
        assert!(is_dead_char_message(WM_DEADCHAR));
        assert!(is_dead_char_message(WM_SYSDEADCHAR));
        assert!(!is_dead_char_message(WM_NCDESTROY));
    }
}
