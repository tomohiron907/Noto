pub mod auth;
pub mod drive;
pub mod sync;

use std::sync::Arc;

use tauri::Manager;

use auth::commands::{auth_restore, auth_sign_out, auth_start};
use sync::commands::{
    sync_create_folder, sync_create_note, sync_delete_folder, sync_delete_note, sync_get_status,
    sync_list_tree, sync_move_note, sync_read_note, sync_trigger, sync_write_note,
};
use sync::engine::SyncDb;

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
        .setup(|app| {
            #[cfg(any(target_os = "android", target_os = "ios"))]
            {
                use tauri::Emitter;
                use tauri_plugin_deep_link::DeepLinkExt;
                let app_handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    if let Some(url) = event.urls().first() {
                        let _ = app_handle.emit("oauth_callback", url.to_string());
                    }
                });
            }
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                use window_vibrancy::{
                    apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
                };
                let window = app.get_webview_window("main").unwrap();
                apply_vibrancy(
                    &window,
                    NSVisualEffectMaterial::Sidebar,
                    Some(NSVisualEffectState::Active),
                    None,
                )
                .expect("apply_vibrancy failed");
            }

            // Initialize SQLite sync DB
            let db_path = app
                .path()
                .app_data_dir()
                .expect("app data dir unavailable")
                .join("noto.db");
            let conn = sync::db::open(&db_path.to_string_lossy()).expect("failed to open sync DB");
            let db_arc = Arc::new(SyncDb {
                conn: std::sync::Mutex::new(conn),
            });
            app.manage(db_arc.clone());

            // Run initial import + first sync cycle in background
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = sync::engine::initial_import(&app_handle, &db_arc).await {
                    log::warn!("[setup] initial_import failed: {}", e);
                } else {
                    use tauri::Emitter;
                    let _ = app_handle.emit("sync:updated", ());
                }
                // Background sync loop: every 30 seconds
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
                    sync::engine::run_sync_cycle(app_handle.clone(), db_arc.clone()).await;
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth_start,
            auth_restore,
            auth_sign_out,
            sync_list_tree,
            sync_read_note,
            sync_write_note,
            sync_create_note,
            sync_delete_note,
            sync_create_folder,
            sync_delete_folder,
            sync_move_note,
            sync_trigger,
            sync_get_status,
            set_traffic_lights,
        ]);

    #[cfg(not(mobile))]
    let builder = builder.plugin(tauri_plugin_shell::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
