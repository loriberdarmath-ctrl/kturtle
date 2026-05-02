// Entry point for the Tauri shell.
//
// We keep this file minimal on purpose -- the entire application is the
// React web app under /src, and Tauri just hands it a native window.
// Anything we'd want here (filesystem access, shell-out, etc.) is
// already provided by the browser APIs the web build uses, so no
// extra IPC commands are necessary.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // --- Linux compatibility shims --------------------------------------
    //
    // WebKitGTK 2.42+ defaults to a DMA-BUF (EGL) renderer. On older Intel
    // GPUs (Haswell, Ivy Bridge) and on systems where the user's graphics
    // stack doesn't expose a usable EGL display over X11, this manifests
    // as:
    //
    //   Could not create default EGL display: EGL_BAD_PARAMETER. Aborting
    //
    // followed by a blank window. Disabling the DMA-BUF renderer makes
    // WebKit fall back to the older GLX / software path, which works on
    // every X11 machine we've seen. The env var is read by WebKitGTK at
    // startup; setting it here (before Tauri spins up the webview) is
    // enough. It is respected on Wayland + modern GPUs too -- they just
    // pick the next best pipeline with no visible regression.
    //
    // We only set it when the user hasn't already exported something
    // explicit, so advanced users can still opt back in to DMA-BUF.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            // SAFETY: we are single-threaded here -- nothing else in the
            // process has started yet (Tauri builder has not run).
            unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1"); }
        }
        // Some drivers also need compositing disabled to avoid a blank
        // canvas on first paint. Harmless everywhere else.
        if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
            unsafe { std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1"); }
        }
        // On pure-X11 systems, force GDK to the X11 backend so that
        // WebKitGTK does not attempt a Wayland connection and fail.
        // No-op on Wayland sessions; user can override by exporting
        // GDK_BACKEND themselves.
        if std::env::var_os("GDK_BACKEND").is_none() {
            unsafe { std::env::set_var("GDK_BACKEND", "x11"); }
        }
    }

    tauri::Builder::default()
        // Dialog + fs power the Save As / Open / Export PNG / Export SVG
        // flows. Everything else (interpreter, canvas, UI) lives in the
        // webview and does not need extra native bridges.
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
