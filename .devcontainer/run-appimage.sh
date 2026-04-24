#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# One-shot helper for testing the Linux AppImage inside a Codespace.
#
# What it does:
#   1. Finds (or downloads) the newest KTurtle-*.AppImage for this repo.
#      Tries in order:
#        • ./builds/*.AppImage            (if you scp'd it in)
#        • ./*.AppImage                   (same idea)
#        • latest v* release on GitHub    (requires `gh` auth)
#   2. Chmods it executable, then launches it under the VNC desktop.
#
# Run from the Codespace terminal:
#     bash .devcontainer/run-appimage.sh
# then switch to the noVNC browser tab to see the window.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

find_local() {
  # Case-insensitive glob; AppImage extension is canonical but
  # be generous about the prefix.
  shopt -s nullglob nocaseglob
  for candidate in \
      ./builds/*.AppImage \
      ./*.AppImage \
      ./dist-artifacts/*.AppImage; do
    [[ -f "$candidate" ]] && { echo "$candidate"; return 0; }
  done
  return 1
}

APPIMAGE="$(find_local || true)"

if [[ -z "${APPIMAGE}" ]]; then
  echo "No local AppImage found. Trying to grab the latest GitHub release…"
  if ! command -v gh >/dev/null 2>&1; then
    echo "  ✗ gh CLI not installed. Install it or drop the AppImage in ./builds/"
    exit 1
  fi
  # Pull every .AppImage from the newest v* release into ./builds/.
  mkdir -p builds
  gh release download --pattern '*.AppImage' --dir builds/ || {
    echo "  ✗ gh release download failed."
    echo "    Common causes:"
    echo "      • No releases yet on this repo (push a v* tag to create one)."
    echo "      • Not authenticated. Run 'gh auth login' or 'gh auth status'."
    echo "      • The latest release has no *.AppImage asset."
    echo "    Alternative: build locally with"
    echo "      npm ci && npm run tauri:build -- --bundles appimage"
    echo "      cp src-tauri/target/release/bundle/appimage/*.AppImage builds/"
    exit 1
  }
  APPIMAGE="$(find_local)"
fi

echo "→ Launching: ${APPIMAGE}"
chmod +x "${APPIMAGE}"

# DISPLAY is already set by the desktop-lite feature (TigerVNC on :1).
# Explicitly fall back in case something else unset it.
export DISPLAY="${DISPLAY:-:1}"

# --no-sandbox: AppImages on Ubuntu 22.04 fail to sandbox inside
# containers (no userns). Safe here because we're the only user in
# this container.
exec "${APPIMAGE}" --no-sandbox
