// BandMate Studio — Rust backend (Tauri commands)
//
// Phase 0: scaffold only. The single command exposed here is `greet` so
// the React side can verify the JS↔Rust bridge works end-to-end. Real
// commands (WAV probing, dot_clean wrapper, USB enumeration, file copy
// with progress) get added in Phase 1+.

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! BandMate Studio's Rust backend is alive.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
