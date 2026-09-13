mod backend;
mod crash_dialog;
mod crash_reporting;
mod diagnostics;
mod models;
#[cfg(unix)]
pub mod pty_host;
#[cfg(windows)]
mod windows_keyboard_guard;

use backend::SessionManager;
use tauri::{Manager, RunEvent, State, WebviewWindow, WebviewWindowBuilder};

#[tauri::command]
fn get_initial_state(manager: State<'_, SessionManager>) -> Result<models::AppState, String> {
    Ok(manager.get_initial_state())
}

#[tauri::command]
fn create_project(
    manager: State<'_, SessionManager>,
    name: String,
) -> Result<models::AppState, String> {
    manager.create_project(name)
}

#[tauri::command]
fn rename_project(
    manager: State<'_, SessionManager>,
    project_id: String,
    name: String,
) -> Result<models::AppState, String> {
    manager.rename_project(project_id, name)
}

#[tauri::command]
fn delete_project(
    manager: State<'_, SessionManager>,
    project_id: String,
) -> Result<models::AppState, String> {
    manager.delete_project(project_id)
}

#[tauri::command]
fn reorder_projects(
    manager: State<'_, SessionManager>,
    project_ids: Vec<String>,
) -> Result<models::AppState, String> {
    manager.reorder_projects(project_ids)
}

#[tauri::command]
fn create_terminal(
    manager: State<'_, SessionManager>,
    project_id: String,
    name: String,
    cwd: String,
    shell: Option<String>,
) -> Result<models::AppState, String> {
    manager.create_terminal(project_id, name, cwd, shell)
}

#[tauri::command]
fn rename_terminal(
    manager: State<'_, SessionManager>,
    terminal_id: String,
    name: String,
) -> Result<models::AppState, String> {
    manager.rename_terminal(terminal_id, name)
}

#[tauri::command]
fn delete_terminal(
    manager: State<'_, SessionManager>,
    terminal_id: String,
) -> Result<models::AppState, String> {
    manager.delete_terminal(terminal_id)
}

#[tauri::command]
fn reorder_terminals(
    manager: State<'_, SessionManager>,
    project_id: String,
    terminal_ids: Vec<String>,
) -> Result<models::AppState, String> {
    manager.reorder_terminals(project_id, terminal_ids)
}

#[tauri::command]
fn activate_terminal(
    manager: State<'_, SessionManager>,
    terminal_id: String,
    cols: u32,
    rows: u32,
) -> Result<models::AppState, String> {
    manager.activate_terminal(terminal_id, cols, rows)
}

#[tauri::command]
fn send_input(
    manager: State<'_, SessionManager>,
    terminal_id: String,
    data: String,
) -> Result<serde_json::Value, String> {
    manager.send_input(terminal_id, data)
}

#[tauri::command]
fn resize_terminal(
    manager: State<'_, SessionManager>,
    terminal_id: String,
    cols: u32,
    rows: u32,
) -> Result<serde_json::Value, String> {
    manager.resize_terminal(terminal_id, cols, rows)
}

#[tauri::command]
fn restart_terminal(
    manager: State<'_, SessionManager>,
    terminal_id: String,
    cols: u32,
    rows: u32,
) -> Result<models::AppState, String> {
    manager.restart_terminal(terminal_id, cols, rows)
}

#[tauri::command]
fn update_defaults(
    manager: State<'_, SessionManager>,
    default_cwd: String,
    default_shell: String,
    custom_shells: Vec<String>,
) -> Result<models::AppState, String> {
    manager.update_defaults(default_cwd, default_shell, custom_shells)
}

#[tauri::command]
fn set_project_default_cwd(
    manager: State<'_, SessionManager>,
    project_id: String,
    cwd: String,
) -> Result<models::AppState, String> {
    manager.set_project_default_cwd(project_id, cwd)
}

#[tauri::command]
fn window_minimize(window: WebviewWindow) -> Result<serde_json::Value, String> {
    window.minimize().map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn window_maximize(window: WebviewWindow) -> Result<serde_json::Value, String> {
    // Windows/Linux: toggle the maximized (zoomed) state.
    // macOS: the custom button is hidden in favor of the native traffic
    // lights, where the green button handles fullscreen/zoom natively.
    // toggle_maximize on macOS maps to zoom, so keep the behavior sane
    // if this command is ever invoked there.
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())?;
    } else {
        window.maximize().map_err(|error| error.to_string())?;
    }

    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn window_toggle_fullscreen(window: WebviewWindow) -> Result<serde_json::Value, String> {
    let fullscreen = window.is_fullscreen().map_err(|error| error.to_string())?;
    window
        .set_fullscreen(!fullscreen)
        .map_err(|error| error.to_string())?;

    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn stop_all_sessions(manager: State<'_, SessionManager>) -> Result<serde_json::Value, String> {
    manager.stop_all_sessions()?;
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn log_renderer_event(
    manager: State<'_, SessionManager>,
    level: String,
    source: String,
    message: String,
    terminal_id: Option<String>,
    detail: Option<String>,
    stack: Option<String>,
) -> Result<serde_json::Value, String> {
    crash_reporting::capture_renderer_event(
        &level,
        &source,
        &message,
        terminal_id.as_deref(),
        detail.as_deref(),
        stack.as_deref(),
    );
    manager.log_renderer_event(level, source, message, terminal_id, detail, stack);
    Ok(serde_json::json!({ "ok": true }))
}

#[tauri::command]
fn window_close(
    manager: State<'_, SessionManager>,
    window: WebviewWindow,
) -> Result<serde_json::Value, String> {
    manager.stop_all_sessions()?;
    window.close().map_err(|error| error.to_string())?;
    Ok(serde_json::json!({ "ok": true }))
}

pub fn run() {
    let context = tauri::generate_context!();
    let fallback_app_data_dir =
        diagnostics::default_app_data_dir(context.config().identifier.as_str());
    diagnostics::configure_app_logging(fallback_app_data_dir.clone());
    let _sentry_guard = match crash_reporting::configure() {
        Ok(guard) => guard,
        Err(error) => {
            let _ = diagnostics::append_app_log_entry(
                &fallback_app_data_dir,
                "error",
                "sentry",
                "Crash reporting could not be initialized.",
                None,
                Some(&error),
                None,
            );
            eprintln!(
                "Terminal Window Manager crash reporting disabled: {}",
                error
            );
            None
        }
    };

    let builder = tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            diagnostics::configure_app_logging(app_data_dir.clone());

            let metadata_path = app_data_dir.join("terminal-metadata.json");

            if let Some(parent) = metadata_path.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }

            let session_manager = SessionManager::new(app.handle().clone(), metadata_path)?;
            app.manage(session_manager);

            // The main window is declared with `create: false` in
            // tauri.conf.json so each platform can apply its own chrome here.
            // Windows keeps the frameless custom titlebar; macOS gets native
            // traffic lights via an overlay titlebar instead.
            #[allow(unused_mut)]
            let mut window_config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .ok_or_else(|| "Missing main window configuration.".to_string())?;
            #[cfg(target_os = "macos")]
            {
                window_config.decorations = true;
                window_config.title_bar_style = tauri::TitleBarStyle::Overlay;
                window_config.hidden_title = true;
                window_config.traffic_light_position =
                    Some(tauri::utils::config::LogicalPosition { x: 14.0, y: 16.0 });
            }
            WebviewWindowBuilder::from_config(app.handle(), &window_config)
                .map_err(|error| error.to_string())?
                .build()
                .map_err(|error| error.to_string())?;

            // Native App/Edit/Window/View menus on macOS so standard shortcuts
            // (Cmd+Q/W/M, copy/paste, fullscreen) behave like other Mac apps.
            #[cfg(target_os = "macos")]
            {
                let menu =
                    tauri::menu::Menu::default(app.handle()).map_err(|error| error.to_string())?;
                app.set_menu(menu).map_err(|error| error.to_string())?;
            }

            #[cfg(windows)]
            windows_keyboard_guard::install_for_existing_windows(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_initial_state,
            create_project,
            rename_project,
            delete_project,
            reorder_projects,
            create_terminal,
            rename_terminal,
            delete_terminal,
            reorder_terminals,
            activate_terminal,
            send_input,
            resize_terminal,
            restart_terminal,
            update_defaults,
            set_project_default_cwd,
            window_minimize,
            window_maximize,
            window_toggle_fullscreen,
            stop_all_sessions,
            log_renderer_event,
            window_close,
        ]);

    match builder.build(context) {
        Ok(app) => {
            // Gracefully stop PTY sessions on Cmd+Q / menu Quit, matching the
            // custom close-button path.
            app.run(|app_handle, event| {
                if let RunEvent::ExitRequested { .. } = event {
                    if let Some(manager) = app_handle.try_state::<SessionManager>() {
                        let _ = manager.stop_all_sessions();
                    }
                }
            });
        }
        Err(error) => {
            handle_build_failure(&fallback_app_data_dir, &error.to_string());
        }
    }
}

fn handle_build_failure(fallback_app_data_dir: &std::path::Path, detail: &str) {
    let _ = diagnostics::append_app_log_entry(
        fallback_app_data_dir,
        "fatal",
        "tauri_run",
        "The Tauri runtime exited with an error.",
        None,
        Some(detail),
        None,
    );
    crash_reporting::capture_native_event(
        "fatal",
        "tauri_run",
        "The Tauri runtime exited with an error.",
        Some(detail),
    );
    let crash_snapshot_path = diagnostics::write_crash_snapshot(
        fallback_app_data_dir,
        "fatal",
        "tauri_run",
        "The Tauri runtime exited with an error.",
        Some(serde_json::json!({ "error": detail })),
        None,
    )
    .ok();
    crash_reporting::flush_pending_events(std::time::Duration::from_secs(2));
    crash_dialog::show_once(&crash_dialog::CrashDialogContext {
        message: "The Tauri runtime exited with an error.",
        detail: Some(detail),
        app_data_dir: fallback_app_data_dir,
        crash_snapshot_path: crash_snapshot_path.as_deref(),
    });
    eprintln!("Terminal Window Manager Tauri failed: {}", detail);
}
