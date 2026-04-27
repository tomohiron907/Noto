pub mod assets;
pub mod auth;
pub mod drive;
pub mod sync;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tauri::Manager;

use assets::commands::asset_upload;
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
        .register_asynchronous_uri_scheme_protocol("noto-asset", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri::Manager;

                let uri = request.uri().to_string();
                // Extract drive_id from noto-asset://DRIVE_ID (strip ?w= and other params)
                let drive_id = uri
                    .strip_prefix("noto-asset://")
                    .unwrap_or("")
                    .split('?')
                    .next()
                    .unwrap_or("")
                    .to_string();

                macro_rules! respond_err {
                    ($status:expr) => {{
                        let _ = responder.respond(
                            tauri::http::Response::builder()
                                .status($status)
                                .body(vec![])
                                .unwrap(),
                        );
                        return;
                    }};
                }

                if drive_id.is_empty() {
                    respond_err!(400);
                }

                let cache_path = match app.path().app_data_dir() {
                    Ok(d) => d.join("asset_cache").join(&drive_id),
                    Err(_) => respond_err!(500),
                };

                let (bytes, mime_type) = if cache_path.exists() {
                    let b = tokio::fs::read(&cache_path).await.unwrap_or_default();
                    let db_arc = app.state::<Arc<SyncDb>>();
                    let mime = {
                        let conn = db_arc.conn.lock().unwrap();
                        conn.query_row(
                            "SELECT mime_type FROM asset_cache WHERE drive_id = ?1",
                            rusqlite::params![drive_id],
                            |r| r.get::<_, String>(0),
                        )
                        .unwrap_or_else(|_| "image/png".to_string())
                    };
                    (b, mime)
                } else {
                    // Fetch from Drive
                    let client = match crate::drive::client::DriveClient::new(&app).await {
                        Ok(c) => c,
                        Err(_) => respond_err!(401),
                    };
                    let url = format!(
                        "https://www.googleapis.com/drive/v3/files/{}?alt=media",
                        drive_id
                    );
                    let resp = match client.get(&url).await {
                        Ok(r) => r,
                        Err(_) => respond_err!(502),
                    };
                    let content_type = resp
                        .headers()
                        .get("content-type")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("image/png")
                        .split(';')
                        .next()
                        .unwrap_or("image/png")
                        .trim()
                        .to_string();
                    let b = match resp.bytes().await {
                        Ok(b) => b.to_vec(),
                        Err(_) => respond_err!(502),
                    };
                    if let Some(parent) = cache_path.parent() {
                        let _ = tokio::fs::create_dir_all(parent).await;
                    }
                    let _ = tokio::fs::write(&cache_path, &b).await;
                    let db_arc = app.state::<Arc<SyncDb>>();
                    {
                        let conn = db_arc.conn.lock().unwrap();
                        let _ = conn.execute(
                            "INSERT OR REPLACE INTO asset_cache (drive_id, mime_type, local_path, cached_at) VALUES (?1, ?2, ?3, ?4)",
                            rusqlite::params![
                                drive_id,
                                content_type,
                                cache_path.to_string_lossy().as_ref(),
                                sync::db::now_ms()
                            ],
                        );
                    }
                    (b, content_type)
                };

                let _ = responder.respond(
                    tauri::http::Response::builder()
                        .header("Content-Type", mime_type)
                        .header("Cache-Control", "max-age=86400")
                        .body(bytes)
                        .unwrap(),
                );
            });
        })
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
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("app data dir unavailable: {e}"))?;
            std::fs::create_dir_all(&app_data_dir)
                .map_err(|e| format!("failed to create app data dir: {e}"))?;
            let db_path = app_data_dir.join("noto.db");
            let conn = sync::db::open(&db_path.to_string_lossy())
                .map_err(|e| format!("failed to open sync DB: {e}"))?;
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
            asset_upload,
        ]);

    #[cfg(not(mobile))]
    let builder = builder.plugin(tauri_plugin_shell::init());

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
