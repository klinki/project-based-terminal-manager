use std::path::Path;

const WINDOW_TITLE: &str = "Terminal Window Manager Crash Reporter";
const MAIN_INSTRUCTION: &str = "Terminal Window Manager closed unexpectedly.";
const MAX_EXPANDED_INFORMATION_CHARS: usize = 4096;

pub struct CrashDialogContext<'a> {
    pub message: &'a str,
    pub detail: Option<&'a str>,
    pub app_data_dir: &'a Path,
    pub crash_snapshot_path: Option<&'a Path>,
}

pub fn show_once(context: &CrashDialogContext<'_>) {
    #[cfg(windows)]
    windows::show_once(context);

    #[cfg(not(windows))]
    let _ = context;
}

fn create_dialog_content(context: &CrashDialogContext<'_>) -> String {
    if context.crash_snapshot_path.is_some() {
        format!(
            "{}\n\nA crash snapshot was saved before the app exited. You can restart now or open the saved crash location.",
            context.message
        )
    } else {
        format!(
            "{}\n\nThe app saved what diagnostics it could before exiting. You can restart now or open the diagnostics folder.",
            context.message
        )
    }
}

fn build_expanded_information(context: &CrashDialogContext<'_>) -> String {
    let mut sections = vec![format!("Reason: {}", context.message)];

    if let Some(detail) = context.detail.filter(|detail| !detail.trim().is_empty()) {
        sections.push(format!("Details: {}", detail.trim()));
    }

    if let Some(crash_snapshot_path) = context.crash_snapshot_path {
        sections.push(format!("Crash snapshot: {}", crash_snapshot_path.display()));
    }

    sections.push(format!(
        "Diagnostics folder: {}",
        context.app_data_dir.display()
    ));

    truncate_for_dialog(&sections.join("\n\n"), MAX_EXPANDED_INFORMATION_CHARS)
}

fn truncate_for_dialog(text: &str, max_chars: usize) -> String {
    let char_count = text.chars().count();
    if char_count <= max_chars {
        return text.to_string();
    }

    let truncated = text
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    format!("{}…", truncated.trim_end())
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::panic::{catch_unwind, AssertUnwindSafe};
    use std::process::Command;
    use std::sync::atomic::{AtomicBool, Ordering};

    use windows_sys::Win32::UI::{
        Controls::{
            TaskDialogIndirect, TASKDIALOGCONFIG, TASKDIALOGCONFIG_0, TASKDIALOG_BUTTON,
            TDCBF_CLOSE_BUTTON, TDF_ALLOW_DIALOG_CANCELLATION, TDF_SIZE_TO_CONTENT,
            TDF_USE_COMMAND_LINKS, TD_ERROR_ICON,
        },
        WindowsAndMessaging::{
            MessageBoxW, IDCANCEL, IDCLOSE, IDNO, IDYES, MB_ICONERROR, MB_YESNOCANCEL,
        },
    };

    const BUTTON_RESTART: i32 = 1001;
    const BUTTON_OPEN_LOCATION: i32 = 1002;

    static DIALOG_SHOWN: AtomicBool = AtomicBool::new(false);

    pub(super) fn show_once(context: &CrashDialogContext<'_>) {
        if DIALOG_SHOWN.swap(true, Ordering::SeqCst) {
            return;
        }

        if catch_unwind(AssertUnwindSafe(|| show_dialog_impl(context))).is_err() {
            show_message_box_fallback(context);
        }
    }

    fn show_dialog_impl(context: &CrashDialogContext<'_>) {
        let window_title = wide_null(WINDOW_TITLE);
        let main_instruction = wide_null(MAIN_INSTRUCTION);
        let content = wide_null(&create_dialog_content(context));
        let expanded_information = wide_null(&build_expanded_information(context));
        let show_details = wide_null("Show details");
        let hide_details = wide_null("Hide details");
        let restart_button =
            wide_null("Restart Terminal Window Manager\nLaunch a new app instance now.");
        let open_location_button = wide_null(
            "Open crash location\nOpen the crash snapshot or diagnostics folder in File Explorer.",
        );
        let buttons = [
            TASKDIALOG_BUTTON {
                nButtonID: BUTTON_RESTART,
                pszButtonText: restart_button.as_ptr(),
            },
            TASKDIALOG_BUTTON {
                nButtonID: BUTTON_OPEN_LOCATION,
                pszButtonText: open_location_button.as_ptr(),
            },
        ];
        let config = TASKDIALOGCONFIG {
            cbSize: std::mem::size_of::<TASKDIALOGCONFIG>() as u32,
            dwFlags: TDF_USE_COMMAND_LINKS | TDF_ALLOW_DIALOG_CANCELLATION | TDF_SIZE_TO_CONTENT,
            dwCommonButtons: TDCBF_CLOSE_BUTTON,
            pszWindowTitle: window_title.as_ptr(),
            Anonymous1: TASKDIALOGCONFIG_0 {
                pszMainIcon: TD_ERROR_ICON,
            },
            pszMainInstruction: main_instruction.as_ptr(),
            pszContent: content.as_ptr(),
            cButtons: buttons.len() as u32,
            pButtons: buttons.as_ptr(),
            nDefaultButton: BUTTON_RESTART,
            pszExpandedInformation: expanded_information.as_ptr(),
            pszExpandedControlText: show_details.as_ptr(),
            pszCollapsedControlText: hide_details.as_ptr(),
            ..Default::default()
        };
        let mut selected_button = 0;
        let result = unsafe {
            TaskDialogIndirect(
                &config,
                &mut selected_button,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        };

        if result < 0 {
            show_message_box_fallback(context);
            return;
        }

        match selected_button {
            BUTTON_RESTART => {
                let _ = restart_application();
            }
            BUTTON_OPEN_LOCATION => {
                let _ = open_crash_location(context);
            }
            IDCANCEL | IDCLOSE => {}
            _ => {}
        }
    }

    fn restart_application() -> std::io::Result<()> {
        let current_exe = std::env::current_exe()?;
        let mut command = Command::new(current_exe);
        command.args(std::env::args_os().skip(1));
        let _ = command.spawn()?;
        Ok(())
    }

    fn open_crash_location(context: &CrashDialogContext<'_>) -> std::io::Result<()> {
        let mut command = Command::new("explorer.exe");
        if let Some(crash_snapshot_path) = context.crash_snapshot_path {
            command.arg(format!("/select,{}", crash_snapshot_path.display()));
        } else {
            command.arg(context.app_data_dir);
        }
        let _ = command.spawn()?;
        Ok(())
    }

    fn show_message_box_fallback(context: &CrashDialogContext<'_>) {
        let window_title = wide_null(WINDOW_TITLE);
        let message = wide_null(&create_message_box_content(context));
        let selected_button = unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                message.as_ptr(),
                window_title.as_ptr(),
                MB_YESNOCANCEL | MB_ICONERROR,
            )
        };

        match selected_button {
            IDYES => {
                let _ = restart_application();
            }
            IDNO => {
                let _ = open_crash_location(context);
            }
            IDCANCEL | IDCLOSE => {}
            _ => {}
        }
    }

    fn create_message_box_content(context: &CrashDialogContext<'_>) -> String {
        format!(
            "{}\n\nYes = Restart\nNo = Open crash location\nCancel = Close",
            create_dialog_content(context)
        )
    }

    fn wide_null(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_expanded_information_with_snapshot_path() {
        let context = CrashDialogContext {
            message: "called Option::unwrap() on a None value",
            detail: Some("Thread: main\nLocation: keyboard.rs:165:49"),
            app_data_dir: Path::new(r"C:\Users\david\AppData\Roaming\dev.projectwm.twm-tauri"),
            crash_snapshot_path: Some(Path::new(
                r"C:\Users\david\AppData\Roaming\dev.projectwm.twm-tauri\app-crash-20260519T141707Z.log",
            )),
        };
        let expanded_information = build_expanded_information(&context);

        assert!(expanded_information.contains("Reason: called Option::unwrap() on a None value"));
        assert!(expanded_information.contains("Crash snapshot:"));
        assert!(expanded_information.contains("Diagnostics folder:"));
    }

    #[test]
    fn truncates_expanded_information_to_dialog_limit() {
        let context = CrashDialogContext {
            message: &"x".repeat(MAX_EXPANDED_INFORMATION_CHARS + 128),
            detail: None,
            app_data_dir: Path::new(r"C:\diagnostics"),
            crash_snapshot_path: None,
        };
        let expanded_information = build_expanded_information(&context);

        assert!(expanded_information.chars().count() <= MAX_EXPANDED_INFORMATION_CHARS);
        assert!(expanded_information.ends_with('…'));
    }
}
