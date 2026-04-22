pub mod auth;
pub mod drive;

use auth::commands::{auth_restore, auth_sign_out, auth_start};
use drive::commands::{
    drive_create_folder, drive_delete_note, drive_ensure_folder, drive_list_notes,
    drive_list_tree, drive_move_note, drive_read_note, drive_write_note,
};

#[cfg(target_os = "macos")]
#[tauri::command]
fn set_traffic_lights(window: tauri::WebviewWindow, visible: bool) {
    use objc2_app_kit::{NSWindow, NSWindowButton};
    use tauri::Manager;

    let app = window.app_handle().clone();
    let _ = app.run_on_main_thread(move || {
        let Ok(ptr) = window.ns_window() else { return };
        unsafe {
            let ns_window: &NSWindow = &*(ptr as *const NSWindow);
            for kind in [
                NSWindowButton::CloseButton,
                NSWindowButton::MiniaturizeButton,
                NSWindowButton::ZoomButton,
            ] {
                if let Some(btn) = ns_window.standardWindowButton(kind) {
                    btn.setHidden(!visible);
                }
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn set_traffic_lights(_window: tauri::WebviewWindow, _visible: bool) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    
    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_deep_link::init());
    }
    #[cfg(not(mobile))]
    {
        builder = builder.plugin(tauri_plugin_deep_link::init());
    }

    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|_app| {
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                use tauri::{Emitter, Manager};
                let app_handle = _app.handle().clone();
                _app.deep_link().on_open_url(move |event| {
                    if let Some(url) = event.urls().first() {
                        let _ = app_handle.emit("oauth_callback", url.to_string());
                    }
                });
            }
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                let window = _app.get_webview_window("main").unwrap();
                apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, Some(NSVisualEffectState::Active), None)
                    .expect("apply_vibrancy failed");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth_start,
            auth_restore,
            auth_sign_out,
            drive_ensure_folder,
            drive_list_notes,
            drive_list_tree,
            drive_read_note,
            drive_write_note,
            drive_delete_note,
            drive_create_folder,
            drive_move_note,
            set_traffic_lights,
        ]);

    #[cfg(not(mobile))]
    let builder = builder.plugin(tauri_plugin_shell::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
