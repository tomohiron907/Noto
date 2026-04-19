pub mod auth;
pub mod drive;

use auth::commands::{auth_restore, auth_sign_out, auth_start};
use drive::commands::{
    drive_delete_note, drive_ensure_folder, drive_list_notes, drive_read_note, drive_write_note,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            auth_start,
            auth_restore,
            auth_sign_out,
            drive_ensure_folder,
            drive_list_notes,
            drive_read_note,
            drive_write_note,
            drive_delete_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
