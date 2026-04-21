pub mod auth;
pub mod drive;

use auth::commands::{auth_restore, auth_sign_out, auth_start};
use drive::commands::{
    drive_delete_note, drive_ensure_folder, drive_list_notes, drive_read_note, drive_write_note,
};

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
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                let window = _app.get_webview_window("main").unwrap();
                apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None)
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
            drive_read_note,
            drive_write_note,
            drive_delete_note,
        ]);

    #[cfg(not(mobile))]
    let builder = builder.plugin(tauri_plugin_shell::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
