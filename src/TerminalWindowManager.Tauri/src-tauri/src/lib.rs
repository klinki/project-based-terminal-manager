mod backend;
mod diagnostics;
mod models;

use backend::SessionManager;
use tauri::{Manager, State, WebviewWindow};

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
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())?;
    } else {
        window.maximize().map_err(|error| error.to_string())?;
    }

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

    let run_result = tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
            diagnostics::configure_app_logging(app_data_dir.clone());

            let metadata_path = app_data_dir.join("terminal-metadata.json");

            if let Some(parent) = metadata_path.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }

            let session_manager = SessionManager::new(app.handle().clone(), metadata_path)?;
            app.manage(session_manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_initial_state,
            create_project,
            rename_project,
            delete_project,
            create_terminal,
            rename_terminal,
            delete_terminal,
            activate_terminal,
            send_input,
            resize_terminal,
            restart_terminal,
            update_defaults,
            set_project_default_cwd,
            window_minimize,
            window_maximize,
            stop_all_sessions,
            log_renderer_event,
            window_close,
        ])
        .run(context);

    if let Err(error) = run_result {
        let detail = error.to_string();
        let _ = diagnostics::append_app_log_entry(
            &fallback_app_data_dir,
            "fatal",
            "tauri_run",
            "The Tauri runtime exited with an error.",
            None,
            Some(&detail),
            None,
        );
        eprintln!("Terminal Window Manager Tauri failed: {}", detail);
    }
}
