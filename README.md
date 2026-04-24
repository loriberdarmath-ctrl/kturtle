# KTurtle

A quiet place to draw with code. TurtleScript programming environment
for learners — runs as a website, a desktop app (Windows / Linux), and
an Android app, from one React codebase.

by Narek Balayan

---

## Try it online (no install)

### Linux desktop build — in your browser

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/loriberdarmath-ctrl/Kturtleweb)

Click the badge, wait ~3 min for the Ubuntu container to boot (first time
only; subsequent boots take seconds), then:

1. In the VS Code that opens, wait for the **"Tauri runtime deps
   installed"** message in the terminal.
2. Open the **Ports** panel at the bottom of VS Code. Click the 🌐
   globe icon next to port **6080**.
3. A new browser tab opens with a noVNC login — password is
   **`vscode`**.
4. You're now inside a real Linux desktop. Back in the VS Code
   terminal run:
   ```bash
   bash .devcontainer/run-appimage.sh
   ```
5. Switch to the noVNC tab — the KTurtle window is there, running
   natively on Linux. Draw things.

This spins up Ubuntu 22.04 (same OS the CI Linux builds target), so
what you see here is exactly what a Linux user would see installing
the `.AppImage` or `.deb` on their own machine.

---

## Downloads

Pre-built binaries for every release live on the
[Releases page](https://github.com/loriberdarmath-ctrl/Kturtleweb/releases).

| Platform | File | Notes |
|---|---|---|
| Windows | `KTurtle-*-x64-setup.exe` | NSIS installer, per-user, no admin |
| Windows | `KTurtle-*-portable.exe` | Standalone, no install |
| Linux | `KTurtle-*.AppImage` | Chmod +x, double-click |
| Linux | `KTurtle-*.deb` | `sudo dpkg -i` on Debian/Ubuntu |
| Android | `KTurtle-*-release.apk` | Sideload on Android 8+ |

CI rebuilds every target on each `v*` tag — see
[Actions](https://github.com/loriberdarmath-ctrl/Kturtleweb/actions).

---

## Building from source

See [BUILD.md](./BUILD.md) for the full instructions. TL;DR:

```bash
npm install
npm run dev                # web, hot-reload at :5173
npm run tauri:dev          # desktop (Tauri), native window
npm run android:build      # Android (Capacitor), plugged-in device
```

---

## Repository layout

```
.
├── src/                  React app shared across all targets
├── public/               Static assets (fonts, logo)
├── src-tauri/            Tauri desktop shell (Rust)
├── android/              Capacitor Android project
├── .github/workflows/    CI (cross-platform release builds)
└── .devcontainer/        Codespaces recipe for Linux testing
```

The Vite build reads `BUILD_TARGET` to switch between single-file web
output and multi-file native output. Everything else — interpreter,
canvas, UI — is identical across targets.
