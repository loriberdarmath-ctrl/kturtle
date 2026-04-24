import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
// Notes on build settings:
//   • target es2019 keeps old-ish phone browsers (iOS 12+, Android
//     Chrome 80+) happy without transpiling down to ES5 — which would
//     bloat the bundle with polyfills for features (spread, async/await,
//     Array.flat, etc.) that every current device has supported for years.
//   • esbuild minifier is the default and already removes identifier
//     names + dead branches aggressively. Terser squeezes another few
//     percent but doubles build time; not worth it at our size.
//   • sourcemaps off in prod — singlefile already inlines everything,
//     so a sourcemap would triple the shipped file size.
//   • `drop: ['console', 'debugger']` strips any stray debug logs from
//     the production bundle without us having to hunt them down.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
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
  },
  esbuild: {
    drop: ["console", "debugger"],
    legalComments: "none",
  },
});
