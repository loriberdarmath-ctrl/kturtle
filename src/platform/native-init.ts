// Native-shell bootstrap.
//
// This module is imported unconditionally by main.tsx; it inspects the
// runtime and quietly opts into platform-specific polish where it's
// available. On a plain web build nothing happens — the Capacitor
// modules still import cleanly but their APIs return early when the
// `capacitor` global isn't present.
//
// Keeping the calls behind a single `if (Capacitor.isNativePlatform())`
// gate means we don't pay the startup cost or pull in native-only
// code paths on the web.

import { Capacitor } from "@capacitor/core";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { App as CapApp } from "@capacitor/app";

export async function initNativeShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  // Paint the status bar to match the app's paper palette and use
  // dark text/icons for the light background. Errors are swallowed
  // because StatusBar isn't present on every Android version; we'd
  // rather ship without it than crash at startup.
  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: "#faf8f4" });
    // Don't overlay the webview on top of the status bar; the app
    // already has its own paper header and we want the two to line up.
    await StatusBar.setOverlaysWebView({ overlay: false });
  } catch {
    /* older Android / status-bar plugin not loaded */
  }

  // Hide the splash once the first React frame has landed. We hook
  // requestAnimationFrame so the splash persists across any async
  // lazy-loaded CSS, not just the initial script parse.
  requestAnimationFrame(() => {
    SplashScreen.hide().catch(() => {});
  });

  // Android back button → close the app if the user is at the "home"
  // state (no modal / dialog open). We can't easily introspect React
  // state from here, so this is deliberately coarse: if the history
  // stack is empty, exit; otherwise go back. Matches how most
  // production Android apps behave.
  CapApp.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      CapApp.exitApp().catch(() => {});
    }
  });
}
