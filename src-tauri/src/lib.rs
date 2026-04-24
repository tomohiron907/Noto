pub mod auth;
pub mod drive;
pub mod sync;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::Manager;

use auth::commands::{auth_restore, auth_sign_out, auth_start};
use sync::commands::{
    sync_create_folder, sync_create_note, sync_delete_folder, sync_delete_note, sync_get_status,
    sync_list_tree, sync_move_note, sync_read_note, sync_trigger, sync_write_note,
};
use sync::engine::SyncDb;

// Maps note_id -> window_label for all open windows
struct WindowNoteState(Mutex<HashMap<String, String>>);

#[tauri::command]
fn set_window_note(
    window: tauri::WebviewWindow,
    state: tauri::State<WindowNoteState>,
    note_id: String,
) {
    let mut map = state.0.lock().unwrap();
    map.retain(|_, label| label != window.label());
    if !note_id.is_empty() {
        map.insert(note_id, window.label().to_string());
    }
}

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

#[cfg(target_os = "macos")]
#[tauri::command]
async fn open_note_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, WindowNoteState>,
    note_id: String,
    note_title: String,
) -> Result<(), String> {
    use tauri::window::{Effect, EffectState, EffectsBuilder};
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    let label = format!("note-{}", note_id);

    if let Some(existing) = app.get_webview_window(&label) {
        existing.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Check if any other window (e.g. main) already has this note open
    let maybe_label = {
        let map = state.0.lock().unwrap();
        map.get(&note_id).cloned()
    };
    if let Some(window_label) = maybe_label {
        if let Some(existing) = app.get_webview_window(&window_label) {
            existing.set_focus().map_err(|e| e.to_string())?;
            return Ok(());
        }
    }

    let url = format!("/?noteId={}", urlencoding::encode(&note_id));
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(&note_title)
        .inner_size(900.0, 700.0)
        .min_inner_size(600.0, 400.0)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .transparent(true)
        .effects(
            EffectsBuilder::new()
                .effect(Effect::Sidebar)
                .state(EffectState::Active)
                .build(),
        )
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn open_note_window(
    _app: tauri::AppHandle,
    _state: tauri::State<'_, WindowNoteState>,
    _note_id: String,
    _note_title: String,
) -> Result<(), String> {
    Ok(())
}

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

            app.manage(WindowNoteState(Mutex::new(HashMap::new())));

            // Initialize SQLite sync DB
            let db_path = app
                .path()
                .app_data_dir()
                .expect("app data dir unavailable")
                .join("noto.db");
            let conn = sync::db::open(&db_path.to_string_lossy()).expect("failed to open sync DB");
            let db_arc = Arc::new(SyncDb {
                conn: std::sync::Mutex::new(conn),
                syncing: std::sync::atomic::AtomicBool::new(false),
                http: reqwest::Client::new(),
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
                // Background sync loop: every 3 seconds
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
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
            open_note_window,
            set_window_note,
        ]);

    #[cfg(not(mobile))]
    let builder = builder.plugin(tauri_plugin_shell::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
