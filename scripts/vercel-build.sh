#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Vercel build step. Invoked from vercel.json's buildCommand.
#
# The shape of dist/ we produce:
#   dist/
#   ├── app/              ← the Vite single-file app, plus its public/ assets
#   │   ├── index.html    ← served at /app via rewrite in vercel.json
#   │   ├── fonts/
#   │   └── kturtle-logo.svg
#   ├── about/            ← the marketing landing page (docs/ copied verbatim)
#   │   ├── index.html    ← served at / via rewrite in vercel.json
#   │   └── kturtle-logo.svg
#   └── _install.sh       ← Linux one-line installer
#
# Why this layout instead of keeping the app at dist/index.html:
#   Vercel's static-file resolver runs BEFORE rewrites. If dist/index.html
#   exists, a request to / finds it and returns immediately — the
#   "/ -> /about" rewrite never fires. Tucking the app inside /app/
#   leaves the dist root empty for everything except /_install.sh, so the
#   rewrites take over and the landing page appears at /.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# 1. Build the Vite single-file bundle into dist/
npm run build

# 2. Move the bundle into dist/app/ so / is free for rewrites
mkdir -p dist/app
mv dist/index.html dist/app/index.html

# Move whatever public assets Vite emitted alongside the inlined HTML.
# Singlefile mode still copies public/ verbatim, so we relocate those too.
[ -d dist/fonts ]              && mv dist/fonts              dist/app/fonts
[ -f dist/kturtle-logo.svg ]   && mv dist/kturtle-logo.svg   dist/app/kturtle-logo.svg

# 3. Drop the hand-written landing page into dist/about/
mkdir -p dist/about
cp -r docs/. dist/about/

# 4. Expose the Linux installer at /_install.sh (pretty curl URL)
cp scripts/install-linux.sh dist/_install.sh

echo "dist/ tree:"
ls -la dist/
