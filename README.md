# KTurtle

A quiet place to draw with code. TurtleScript programming environment
for learners — runs as a website, a desktop app (Windows / Linux), and
an Android app, from one React codebase.

by Narek Balayan

**→ Try it online: [kturtleweb-ten.vercel.app](https://kturtleweb-ten.vercel.app/)**
**→ About & downloads: [kturtleweb-ten.vercel.app/about](https://kturtleweb-ten.vercel.app/about)**

---

## Install

### Linux — one line

```bash
curl -fsSL https://kturtleweb-ten.vercel.app/_install.sh | bash
```

Downloads the latest `.AppImage`, drops it in `~/.local/bin`, registers
a desktop entry so it appears in your app menu. No sudo, no package
manager. Pin a specific version with `KTURTLE_VERSION=v0.1.0` before
the pipe.

On Debian/Ubuntu you can alternatively grab the `.deb` from the
[Releases page](https://github.com/loriberdarmath-ctrl/kturtle/releases/latest)
and `sudo dpkg -i` it.

### Windows

[Download the installer](https://github.com/loriberdarmath-ctrl/kturtle/releases/latest/download/KTurtle-x64-setup.exe)
(NSIS, per-user, no admin) or the
[portable exe](https://github.com/loriberdarmath-ctrl/kturtle/releases/latest/download/KTurtle-portable.exe).

### Android

[Download the APK](https://github.com/loriberdarmath-ctrl/kturtle/releases/latest/download/KTurtle-release.apk)
and sideload it (Android 8+). Enable "install unknown apps" for your
browser first.

---

## Try it online (no install)

### Linux desktop build — in your browser

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/loriberdarmath-ctrl/kturtle)

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
[Releases page](https://github.com/loriberdarmath-ctrl/kturtle/releases).
Each release ships two flavours of every asset: a **versioned** file
(e.g. `KTurtle-v0.1.0-x64-setup.exe`, for provenance) and a
**stable-named** file (e.g. `KTurtle-x64-setup.exe`, which always
resolves to the newest release via
`/releases/latest/download/<name>` — used by the landing page and the
install script).

| Platform | Stable URL (always latest)                  | Notes                              |
|----------|---------------------------------------------|------------------------------------|
| Windows  | `KTurtle-x64-setup.exe`                     | NSIS installer, per-user, no admin |
| Windows  | `KTurtle-portable.exe`                      | Standalone, no install             |
| Linux    | `KTurtle-linux-x86_64.AppImage`             | Chmod +x, double-click             |
| Linux    | `KTurtle-linux-amd64.deb`                   | `sudo dpkg -i` on Debian/Ubuntu    |
| Android  | `KTurtle-release.apk`                       | Sideload on Android 8+             |

CI rebuilds every target on each `v*` tag — see
[Actions](https://github.com/loriberdarmath-ctrl/kturtle/actions).

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
├── docs/                 Landing page (hand-written static HTML)
├── scripts/              Installers + dev helpers (install-linux.sh, etc.)
├── vercel.json           Deploy config: app at /, landing at /about
├── .github/workflows/    CI (cross-platform release builds + Pages)
└── .devcontainer/        Codespaces recipe for Linux testing
```

The Vite build reads `BUILD_TARGET` to switch between single-file web
output and multi-file native output. Everything else — interpreter,
canvas, UI — is identical across targets.

---

## Deploying the web app (Vercel)

The Vercel project is already linked (`.vercel/project.json` is
committed-ish — see below). From this folder:

```bash
npm i -g vercel           # one-time
vercel login              # one-time, use the GitHub account you own the project with
vercel --prod             # ship to kturtleweb-ten.vercel.app
```

The deploy runs `npm run build` (producing the single-file Vite bundle
in `dist/`), then copies `docs/` into `dist/about/` and
`scripts/install-linux.sh` to `dist/_install.sh`. The resulting tree:

```
dist/
├── index.html            # the KTurtle app itself (served at /)
├── about/index.html      # the landing page (served at /about)
├── about/kturtle-logo.svg
└── _install.sh           # served at /_install.sh for curl | bash
```

Preview deploy (every commit gets its own URL without touching prod):

```bash
vercel                    # no --prod flag
```

Git-auto-deploy (optional): connect the GitHub repo to the Vercel
project in the Vercel dashboard → Settings → Git. After that, pushes to
`main` deploy to production automatically.
