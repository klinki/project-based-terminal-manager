//! Native macOS application menu.
//!
//! Mirrors `tauri::menu::Menu::default` (App/File/Edit/View/Window/Help) and
//! adds a standard Preferences item (`Cmd+,`) to the App menu, which the
//! default menu does not provide. The item carries a stable id; selection is
//! forwarded to the frontend as the [`OPEN_SETTINGS_EVENT`] event so the
//! existing settings dialog opens.

use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

/// Menu item id of the Preferences entry in the App menu.
pub const PREFERENCES_MENU_ID: &str = "twm-preferences";

/// Frontend event emitted when the Preferences menu item is selected.
pub const OPEN_SETTINGS_EVENT: &str = "open-settings";

/// Builds the macOS application menu: default menus plus Preferences.
pub fn build_macos_menu<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let package_info = handle.package_info();
    let config = handle.config();
    let about_metadata = AboutMetadata {
        name: Some(package_info.name.clone()),
        version: Some(package_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config.bundle.publisher.clone().map(|publisher| vec![publisher]),
        ..Default::default()
    };

    let app_menu = Submenu::with_items(
        handle,
        package_info.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(handle, None, Some(about_metadata))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItemBuilder::with_id(PREFERENCES_MENU_ID, "Preferences…")
                .accelerator("CmdOrCtrl+,")
                .build(handle)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::services(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, None)?,
            &PredefinedMenuItem::hide_others(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, None)?,
        ],
    )?;
    let file_menu = Submenu::with_items(
        handle,
        "File",
        true,
        &[&PredefinedMenuItem::close_window(handle, None)?],
    )?;
    let edit_menu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, None)?,
            &PredefinedMenuItem::redo(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, None)?,
            &PredefinedMenuItem::copy(handle, None)?,
            &PredefinedMenuItem::paste(handle, None)?,
            &PredefinedMenuItem::select_all(handle, None)?,
        ],
    )?;
    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(handle, None)?],
    )?;
    let window_menu = Submenu::with_id_and_items(
        handle,
        tauri::menu::WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, None)?,
            &PredefinedMenuItem::maximize(handle, None)?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::close_window(handle, None)?,
        ],
    )?;
    let help_menu = Submenu::with_id_and_items(
        handle,
        tauri::menu::HELP_SUBMENU_ID,
        "Help",
        true,
        &[],
    )?;

    Menu::with_items(
        handle,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}
