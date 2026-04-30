#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# KTurtle — one-line Linux installer
#
# Intended invocation:
#   curl -fsSL https://raw.githubusercontent.com/loriberdarmath-ctrl/kturtle/main/scripts/install-linux.sh | bash
#
# What this script does:
#   1. Grabs the newest KTurtle-*.AppImage from the latest GitHub release
#      (via the /releases/latest/download/ stable URL — no API token needed).
#   2. Drops it into ~/.local/bin/ and chmods +x.
#   3. Extracts the icon + writes a ~/.local/share/applications/kturtle.desktop
#      entry so KTurtle appears in the system app menu and is launchable
#      like any native app (no terminal).
#   4. Refreshes the desktop database so the new entry shows up immediately
#      on most DEs (GNOME, KDE, XFCE, Cinnamon, MATE).
#
# Design choices:
#   • We install to ~/.local/bin, not /usr/local/bin. No sudo required. XDG-
#     standard and on every modern distro's default PATH (systemd's user
#     profile scripts prepend it). If a user's PATH is non-standard, they
#     can still launch via the menu entry or by full path.
#   • We use the "latest" redirect rather than pinning a version so this
#     script never goes stale. Users who want to pin can set KTURTLE_VERSION
#     in their env before piping to bash.
#   • AppImage, not .deb: AppImage runs on every glibc-based distro without
#     asking about package managers or dependency trees. The .deb is still
#     attached to each release for Debian/Ubuntu purists — see the README.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="loriberdarmath-ctrl/kturtle"
APP_NAME="KTurtle"
BIN_DIR="${HOME}/.local/bin"
APP_DIR="${HOME}/.local/share/applications"
ICON_DIR="${HOME}/.local/share/icons/hicolor/256x256/apps"
VERSION="${KTURTLE_VERSION:-latest}"

# Colourised log helpers. Fall back to plain text if the terminal isn't
# a TTY (e.g. when piped through `tee` or a non-interactive shell).
if [[ -t 1 ]]; then
  BOLD="\033[1m"; GREEN="\033[32m"; BLUE="\033[34m"; YELLOW="\033[33m"; RED="\033[31m"; RESET="\033[0m"
else
  BOLD=""; GREEN=""; BLUE=""; YELLOW=""; RED=""; RESET=""
fi

log()   { printf "${BLUE}${BOLD}→${RESET} %s\n" "$*"; }
ok()    { printf "${GREEN}${BOLD}✓${RESET} %s\n" "$*"; }
warn()  { printf "${YELLOW}${BOLD}!${RESET} %s\n" "$*"; }
die()   { printf "${RED}${BOLD}✗${RESET} %s\n" "$*" >&2; exit 1; }

# ── Sanity checks ────────────────────────────────────────────────────────────
command -v curl >/dev/null || die "curl is required (apt/dnf/pacman install curl)"

# FUSE is required by AppImage's self-mount. Detect the most common breakage
# (missing fusermount or fusermount3) early and print actionable advice.
if ! command -v fusermount >/dev/null && ! command -v fusermount3 >/dev/null; then
  warn "FUSE not detected. AppImage won't be able to mount itself."
  warn "On Debian/Ubuntu:  sudo apt install libfuse2"
  warn "On Fedora:         sudo dnf install fuse"
  warn "On Arch:           sudo pacman -S fuse2"
  warn "Continuing anyway — install will succeed, but running may fail."
fi

mkdir -p "${BIN_DIR}" "${APP_DIR}" "${ICON_DIR}"

# ── Download the AppImage ────────────────────────────────────────────────────
# /releases/latest/download/<pattern> is GitHub's "always-newest" URL. It
# 302-redirects to the current release's asset. Pinning a tag is opt-in via
# KTURTLE_VERSION.
if [[ "${VERSION}" == "latest" ]]; then
  URL="https://github.com/${REPO}/releases/latest/download/${APP_NAME}-linux-x86_64.AppImage"
else
  URL="https://github.com/${REPO}/releases/download/${VERSION}/${APP_NAME}-linux-x86_64.AppImage"
fi

TARGET="${BIN_DIR}/${APP_NAME}.AppImage"
log "Downloading ${APP_NAME} ${VERSION} → ${TARGET}"

# -L follow redirects, --fail turns HTTP errors into exit codes,
# --progress-bar gives a lightweight bar instead of the verbose default.
if ! curl -L --fail --progress-bar -o "${TARGET}.tmp" "${URL}"; then
  die "Download failed. Is there a release yet? See https://github.com/${REPO}/releases"
fi
mv "${TARGET}.tmp" "${TARGET}"
chmod +x "${TARGET}"
ok "Installed binary: ${TARGET}"

# ── Extract the icon from inside the AppImage ────────────────────────────────
# AppImages are squashfs archives. `--appimage-extract` unpacks the whole
# tree to ./squashfs-root; we grab the 256×256 icon, then nuke the tree.
# Runs in a tempdir so we don't pollute $PWD.
TMPDIR="$(mktemp -d)"
trap 'rm -rf "${TMPDIR}"' EXIT

if (cd "${TMPDIR}" && "${TARGET}" --appimage-extract >/dev/null 2>&1); then
  ICON_SRC=$(find "${TMPDIR}/squashfs-root" -maxdepth 3 -type f \
    \( -name "${APP_NAME,,}.png" -o -name "kturtle.png" -o -name ".DirIcon" \) \
    | head -n1 || true)
  if [[ -n "${ICON_SRC}" ]]; then
    cp "${ICON_SRC}" "${ICON_DIR}/kturtle.png"
    ok "Installed icon: ${ICON_DIR}/kturtle.png"
  else
    warn "Couldn't find an icon inside the AppImage — menu entry will be iconless."
  fi
else
  warn "AppImage extract failed (FUSE missing?). Menu entry will be iconless."
fi

# ── Write the .desktop entry ─────────────────────────────────────────────────
# Minimal FreeDesktop spec entry. Categories=Education;Development; makes
# KTurtle land in the expected app-menu sections on GNOME/KDE/XFCE.
DESKTOP_FILE="${APP_DIR}/kturtle.desktop"
cat > "${DESKTOP_FILE}" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
GenericName=Turtle Graphics Programming
Comment=A quiet place to draw with code
Exec=${TARGET} %U
Icon=kturtle
Terminal=false
Categories=Education;Development;Graphics;
Keywords=logo;turtle;programming;education;kids;drawing;
StartupWMClass=${APP_NAME}
EOF
chmod +x "${DESKTOP_FILE}"
ok "Installed menu entry: ${DESKTOP_FILE}"

# Refresh the desktop-entry cache so the new launcher shows up without a
# re-login. Silently no-op on systems that don't have update-desktop-database
# (some minimal distros).
if command -v update-desktop-database >/dev/null; then
  update-desktop-database "${APP_DIR}" >/dev/null 2>&1 || true
fi

# ── Final hints ──────────────────────────────────────────────────────────────
printf "\n${GREEN}${BOLD}KTurtle installed.${RESET}\n"
printf "  • Launch from your app menu (search '${APP_NAME}'), or\n"
printf "  • Run directly: ${BOLD}${TARGET}${RESET}\n"

# Warn if ~/.local/bin isn't on PATH. Most distros put it there via
# /etc/profile or systemd, but minimal setups sometimes miss it.
case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *) printf "\n${YELLOW}Note:${RESET} ${BIN_DIR} is not on your PATH.\n"
     printf "  Add to your shell rc:  ${BOLD}export PATH=\"\${HOME}/.local/bin:\${PATH}\"${RESET}\n" ;;
esac
