import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { I18nProvider } from "./i18n/context";
import { initNativeShell } from "./platform/native-init";

// Fire-and-forget native-shell setup. On the web this is an immediate
// no-op; on Android (Capacitor) it paints the status bar, wires up
// the hardware back button, and hides the launch splash once React
// has mounted. Desktop (Tauri) behaves like a plain browser here —
// Tauri's window chrome is handled Rust-side.
initNativeShell();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>
);
