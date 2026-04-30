// Unified file I/O that does the right thing on every target we ship.
//
//   • Web browser  — uses <a download>/<input type=file> (existing
//                    behaviour; nothing to install or ask permission for).
//   • Tauri desktop — real native Save As / Open dialogs, real fs writes.
//                    Pre-seeds the Save dialog with the OS Downloads
//                    folder so Windows / Linux users get the same
//                    "lands in Downloads" experience as the mobile app,
//                    but can still browse elsewhere.
//   • Capacitor Android — writes to the device's public Downloads/KTurtle
//                    folder via a tiny MediaStore JS bridge installed by
//                    MainActivity.java. That means files show up in the
//                    system Downloads UI and every file manager, exactly
//                    like a browser download. Falls back to the Filesystem
//                    plugin + share sheet when the bridge is missing
//                    (older builds, Android < 10 with no write access).
//                    Opening a .turtle file uses an <input type=file>
//                    picker with accept="*/*" — Android's MIME mapping
//                    has no entry for .turtle, so a stricter accept
//                    string silently hides the files from the picker.
//
// Every function here is async and swallowing/normalising errors — the
// UI never needs to care about the platform.

type Platform = 'web' | 'tauri' | 'capacitor';

let cachedPlatform: Platform | null = null;
function detect(): Platform {
  if (cachedPlatform) return cachedPlatform;
  const w = globalThis as unknown as {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  if (w.__TAURI_INTERNALS__ || w.__TAURI__) {
    cachedPlatform = 'tauri';
  } else if (w.Capacitor?.isNativePlatform?.()) {
    cachedPlatform = 'capacitor';
  } else {
    cachedPlatform = 'web';
  }
  return cachedPlatform;
}

/** User-facing result of a save/export operation. */
export interface SaveResult {
  ok: boolean;
  /** Where the file ended up (best-effort, for "Saved to …" toasts).
   *  On web this is just the filename; the browser decides the folder. */
  path?: string;
  /** Present only when the user cancelled. Distinguished from errors. */
  cancelled?: boolean;
}

// ────────────────────────────────────────────────────────────────────
//  Browser fallback helpers
// ────────────────────────────────────────────────────────────────────

function webDownloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function webDownloadText(text: string, filename: string, mime: string): void {
  webDownloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

function webDownloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ────────────────────────────────────────────────────────────────────
//  Tauri helpers (lazy-loaded — keeps them out of the web bundle on
//  hoisted tree-shakes but still resolves at runtime when present)
// ────────────────────────────────────────────────────────────────────

async function tauriSaveText(
  text: string,
  defaultName: string,
  filters: { name: string; extensions: string[] }[],
): Promise<SaveResult> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeTextFile } = await import('@tauri-apps/plugin-fs');
  const defaultPath = await tauriDefaultSavePath(defaultName);
  const path = await save({ defaultPath, filters });
  if (!path) return { ok: false, cancelled: true };
  await writeTextFile(path, text);
  return { ok: true, path };
}

async function tauriSaveBinary(
  bytes: Uint8Array,
  defaultName: string,
  filters: { name: string; extensions: string[] }[],
): Promise<SaveResult> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const { writeFile } = await import('@tauri-apps/plugin-fs');
  const defaultPath = await tauriDefaultSavePath(defaultName);
  const path = await save({ defaultPath, filters });
  if (!path) return { ok: false, cancelled: true };
  await writeFile(path, bytes);
  return { ok: true, path };
}

/**
 * Resolve a friendly default path for the Save As dialog on Tauri.
 *
 * We pre-seed it with `<user's Downloads>/<filename>` so Windows and
 * Linux users land in the same place Android users do. The dialog
 * still lets them browse to anywhere else, but the default matches the
 * "browser download" mental model.
 *
 * Falls back to just the filename if the path plugin isn't present
 * (older Tauri builds) — the dialog then opens in the user's last
 * chosen directory, which is still a reasonable default.
 */
async function tauriDefaultSavePath(filename: string): Promise<string> {
  try {
    const { downloadDir, join } = await import('@tauri-apps/api/path');
    const dir = await downloadDir();
    return await join(dir, filename);
  } catch {
    return filename;
  }
}

async function tauriOpenText(
  filters: { name: string; extensions: string[] }[],
): Promise<{ name: string; content: string } | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const { readTextFile } = await import('@tauri-apps/plugin-fs');
  const picked = await open({ multiple: false, directory: false, filters });
  if (!picked || typeof picked !== 'string') return null;
  const content = await readTextFile(picked);
  const name = picked.replace(/^.*[\\/]/, '');
  return { name, content };
}

// ────────────────────────────────────────────────────────────────────
//  Capacitor helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Access the native `window.KTurtleDownloads` bridge installed by
 * MainActivity.java. Present only on Android builds that have the
 * updated native shell; older builds fall through to the Filesystem
 * plugin + share sheet path.
 */
interface KTurtleDownloadsBridge {
  saveText?: (filename: string, mime: string, contents: string) => string | null;
  saveBase64?: (filename: string, mime: string, base64: string) => string | null;
}
function getDownloadsBridge(): KTurtleDownloadsBridge | null {
  const b = (globalThis as unknown as { KTurtleDownloads?: KTurtleDownloadsBridge })
    .KTurtleDownloads;
  return b && (b.saveText || b.saveBase64) ? b : null;
}

async function capSaveText(
  text: string,
  filename: string,
  subdir: string,
): Promise<SaveResult> {
  // Preferred: write straight into the device's public Downloads/KTurtle
  // folder via the native bridge. No permission prompt, no share sheet
  // in the way — the file just appears where a browser download would.
  const bridge = getDownloadsBridge();
  if (bridge?.saveText) {
    const mime = filename.endsWith('.svg') ? 'image/svg+xml' : 'text/plain';
    const uri = bridge.saveText(filename, mime, text);
    if (uri) return { ok: true, path: `Downloads/${subdir}/${filename}` };
  }

  // Fallback: write to the app-scoped Documents folder and offer the
  // share sheet so the user can still get the file off-device.
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const target = `${subdir}/${filename}`;
  await Filesystem.writeFile({
    path: target,
    data: text,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  const uri = await Filesystem.getUri({ path: target, directory: Directory.Documents });
  await tryShare(uri.uri, filename);
  return { ok: true, path: uri.uri };
}

async function capSaveDataUrl(
  dataUrl: string,
  filename: string,
  subdir: string,
): Promise<SaveResult> {
  // data:image/png;base64,XXXX → XXXX
  const base64 = dataUrl.split(',', 2)[1] ?? '';

  // Preferred path: native MediaStore bridge → public Downloads/KTurtle.
  const bridge = getDownloadsBridge();
  if (bridge?.saveBase64) {
    const mime = filename.endsWith('.png') ? 'image/png' : 'application/octet-stream';
    const uri = bridge.saveBase64(filename, mime, base64);
    if (uri) return { ok: true, path: `Downloads/${subdir}/${filename}` };
  }

  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const target = `${subdir}/${filename}`;
  await Filesystem.writeFile({
    path: target,
    data: base64,
    directory: Directory.Documents,
    recursive: true,
  });
  const uri = await Filesystem.getUri({ path: target, directory: Directory.Documents });
  await tryShare(uri.uri, filename);
  return { ok: true, path: uri.uri };
}

async function tryShare(uri: string, title: string): Promise<void> {
  try {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title, url: uri });
  } catch {
    // Share may not be available (older Android / user cancelled);
    // the file is already saved on disk, so we silently succeed.
  }
}

/** Fallback open for Capacitor — uses a hidden file input because
 *  Capacitor has no "pick a document" dialog on its own. */
function webOpenText(accept: string): Promise<{ name: string; content: string } | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const content = await file.text();
      resolve({ name: file.name, content });
    };
    document.body.appendChild(input);
    input.click();
    // Some browsers fire no event if the user cancels; we clean up on
    // next tick after the click finishes.
    setTimeout(() => {
      if (input.parentNode) input.parentNode.removeChild(input);
    }, 60_000);
  });
}

// ────────────────────────────────────────────────────────────────────
//  Public API
// ────────────────────────────────────────────────────────────────────

/** Save a .turtle source file. */
export async function saveTurtleFile(
  contents: string,
  suggestedName: string,
): Promise<SaveResult> {
  const filename = suggestedName.endsWith('.turtle') ? suggestedName : `${suggestedName}.turtle`;
  const platform = detect();
  try {
    if (platform === 'tauri') {
      return await tauriSaveText(contents, filename, [
        { name: 'KTurtle files', extensions: ['turtle'] },
        { name: 'All files', extensions: ['*'] },
      ]);
    }
    if (platform === 'capacitor') {
      return await capSaveText(contents, filename, 'KTurtle');
    }
  } catch (err) {
    console.error('saveTurtleFile native path failed, falling back', err);
  }
  webDownloadText(contents, filename, 'text/plain');
  return { ok: true, path: filename };
}

/** Open a .turtle (or .logo / .txt) source file. */
export async function openTurtleFile(): Promise<{ name: string; content: string } | null> {
  const platform = detect();
  try {
    if (platform === 'tauri') {
      return await tauriOpenText([
        { name: 'KTurtle files', extensions: ['turtle', 'logo', 'txt'] },
        { name: 'All files', extensions: ['*'] },
      ]);
    }
  } catch (err) {
    console.error('openTurtleFile native path failed, falling back', err);
  }
  // Capacitor + web both use the browser file input. On Android the
  // MIME database has no entry for the `.turtle` extension, so a
  // strict accept string silently hides those files from the system
  // picker (one of the long-standing WebView quirks). We relax the
  // filter to "any file" on Capacitor and let the user pick, then
  // trust the content itself — `fromKTurtleFile()` gracefully handles
  // non-.turtle text anyway.
  const accept = platform === 'capacitor' ? '*/*' : '.turtle,.logo,.txt,text/plain';
  return webOpenText(accept);
}

/** Export the given SVG text as a file. */
export async function exportSvgFile(
  svg: string,
  suggestedName: string,
): Promise<SaveResult> {
  const filename = suggestedName.endsWith('.svg') ? suggestedName : `${suggestedName}.svg`;
  const platform = detect();
  try {
    if (platform === 'tauri') {
      return await tauriSaveText(svg, filename, [
        { name: 'SVG image', extensions: ['svg'] },
        { name: 'All files', extensions: ['*'] },
      ]);
    }
    if (platform === 'capacitor') {
      return await capSaveText(svg, filename, 'KTurtle');
    }
  } catch (err) {
    console.error('exportSvgFile native path failed, falling back', err);
  }
  webDownloadText(svg, filename, 'image/svg+xml');
  return { ok: true, path: filename };
}

/** Export a canvas PNG (passed as a data: URL). */
export async function exportPngFile(
  dataUrl: string,
  suggestedName: string,
): Promise<SaveResult> {
  const filename = suggestedName.endsWith('.png') ? suggestedName : `${suggestedName}.png`;
  const platform = detect();
  try {
    if (platform === 'tauri') {
      const bytes = dataUrlToBytes(dataUrl);
      return await tauriSaveBinary(bytes, filename, [
        { name: 'PNG image', extensions: ['png'] },
        { name: 'All files', extensions: ['*'] },
      ]);
    }
    if (platform === 'capacitor') {
      return await capSaveDataUrl(dataUrl, filename, 'KTurtle');
    }
  } catch (err) {
    console.error('exportPngFile native path failed, falling back', err);
  }
  webDownloadDataUrl(dataUrl, filename);
  return { ok: true, path: filename };
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Does the current runtime have real native file dialogs?
 *  Useful for "Save As" menu items we want to hide on the web. */
export function hasNativeDialogs(): boolean {
  return detect() === 'tauri';
}

/** True when the app is running inside a native shell (Tauri or
 *  Capacitor). Lets callers suppress browser-only fallback UI. */
export function isNativeShell(): boolean {
  const p = detect();
  return p === 'tauri' || p === 'capacitor';
}
