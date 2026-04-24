/**
 * Lightweight recent-files registry persisted in localStorage. Mirrors the
 * "Recent Files" entry that KTurtle's File menu exposes — an ordered list
 * of the last N files the user opened or saved, newest first.
 *
 * Entries include the code itself (not just a path) because the web app
 * has no durable filesystem handle to reopen a file by path.
 */
export interface RecentFile {
  /** Display name, e.g. "spiral.turtle" */
  name: string;
  /** Full source */
  code: string;
  /** Unix ms timestamp of last use */
  touchedAt: number;
  /** Cached source byte length (for "12 kB · 42 lines" subtitle) */
  size: number;
  /** Cached line count for the list subtitle */
  lines: number;
}

const KEY = 'kturtle.recentFiles';
const MAX = 12;
/** Skip storage entirely for huge programs so we don't blow out localStorage. */
const MAX_STORED_BYTES = 64 * 1024;

function read(): RecentFile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is RecentFile =>
        x && typeof x.name === 'string' && typeof x.code === 'string' && typeof x.touchedAt === 'number',
    );
  } catch {
    return [];
  }
}

function write(list: RecentFile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Quota exceeded — drop the oldest entries and retry once.
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, Math.max(1, Math.floor(list.length / 2)))));
    } catch {
      /* give up silently */
    }
  }
}

/** Insert or promote `file` to the top of the recent list. */
export function remember(name: string, code: string): void {
  if (code.length > MAX_STORED_BYTES) {
    // Oversized program — only track the name without body so the user
    // can still see it was recently used (click falls through to re-pick).
    const lines = code.split('\n').length;
    const entry: RecentFile = { name, code: '', touchedAt: Date.now(), size: code.length, lines };
    const list = read().filter(f => f.name !== name);
    list.unshift(entry);
    write(list.slice(0, MAX));
    return;
  }
  const lines = code.split('\n').length;
  const entry: RecentFile = { name, code, touchedAt: Date.now(), size: code.length, lines };
  const list = read().filter(f => f.name !== name);
  list.unshift(entry);
  write(list.slice(0, MAX));
}

export function list(): RecentFile[] {
  return read();
}

export function remove(name: string): void {
  write(read().filter(f => f.name !== name));
}

export function clear(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
