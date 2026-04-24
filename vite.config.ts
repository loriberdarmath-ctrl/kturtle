import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
//
// Build targets
// -------------
// We ship THREE flavours of the same React app from one codebase:
//
//   1. `web`     (default) — the site. Single-file HTML, all assets
//                inlined, hosted on GitHub Pages or equivalent.
//
//   2. `native`  — regular multi-file output used by Tauri (desktop)
//                and Capacitor (Android). Singlefile is disabled so
//                the webview can load fonts / SVGs via file://. Base
//                path is './' so relative URLs resolve inside the
//                packaged app regardless of where the browser thinks
//                it is (file://, android-asset://, etc.).
//
// The variant is selected via `BUILD_TARGET`, set by the npm scripts:
//
//     npm run build               -> web       (singlefile)
//     npm run build:native        -> native    (used by Tauri + Capacitor)
//
// Notes on other settings:
//   • target es2019 keeps old-ish phone browsers (iOS 12+, Android
//     Chrome 80+) happy without transpiling down to ES5 — which would
//     bloat the bundle with polyfills for features (spread, async/await,
//     Array.flat, etc.) that every current device has supported for years.
//   • esbuild minifier already removes identifier names + dead branches
//     aggressively. Terser squeezes another few percent but doubles
//     build time; not worth it at our size.
//   • sourcemaps off in prod — they'd triple the bundle and we don't
//     ship a DevTools workflow in production.
//   • `drop: ['console', 'debugger']` strips any stray debug logs
//     without us having to hunt them down.
const target = process.env.BUILD_TARGET === "native" ? "native" : "web";

export default defineConfig({
  // Relative base path on native builds so the shell's webview loads
  // assets via `./foo.woff2` (which works for file://, android-asset://,
  // and any future custom scheme) instead of `/foo.woff2` (which would
  // point at the device root).
  base: target === "native" ? "./" : "/",
  plugins: [
    react(),
    tailwindcss(),
    // Singlefile only on the web build. For native we want a real
    // multi-file dist — the shell app serves assets from disk and the
    // webview caches them normally.
    ...(target === "web" ? [viteSingleFile()] : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: "es2019",
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 4096,
    reportCompressedSize: false,
    // Native builds write to a separate directory so the two outputs
    // can coexist (useful for a one-command "build everything" flow).
    outDir: target === "native" ? "dist-native" : "dist",
    emptyOutDir: true,
  },
  esbuild: {
    drop: ["console", "debugger"],
    legalComments: "none",
  },
});
