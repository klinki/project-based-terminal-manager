#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(unix)]
    if std::env::args().nth(1).as_deref() == Some("--twm-pty-host") {
        std::process::exit(terminal_window_manager_tauri::pty_host::run());
    }

    terminal_window_manager_tauri::run();
}
