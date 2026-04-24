// Build hook required by Tauri. tauri-build runs the manifest/config
// validation, generates Windows resource data, and emits the link
// metadata the Rust crate needs before compilation.
fn main() {
    tauri_build::build();
}
