// Prevent a Windows console window from appearing behind the app on
// release builds — it's harmless in dev but looks unpolished in a
// distributable .msi.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Thin shim: all the app logic lives in the library crate so it's also
// callable from integration tests / other binaries if we ever need one.
fn main() {
    kturtle_lib::run();
}
