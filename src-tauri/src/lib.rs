// Entry point for the Tauri shell.
//
// We keep this file minimal on purpose — the entire application is the
// React web app under /src, and Tauri just hands it a native window.
// Anything we'd want here (filesystem access, shell-out, etc.) is
// already provided by the browser APIs the web build uses, so no
// extra IPC commands are necessary.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Dialog + fs power the Save As / Open / Export PNG / Export SVG
        // flows. Everything else (interpreter, canvas, UI) lives in the
        // webview and doesn't need extra native bridges.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
