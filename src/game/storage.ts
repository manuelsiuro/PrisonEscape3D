/**
 * Every value the game keeps in localStorage, behind one versioned, crash-safe API.
 * Storage can be missing, full or blocked (private windows), so every read falls back and
 * every write reports failure instead of throwing.
 *
 * Rename PREFIX for a new game. When a stored format changes, bump SAVE_VERSION and add a
 * migration below: players keep their progress across updates.
 */
const PREFIX = 'pe3d';

export const KEYS = {
  version: `${PREFIX}.version`,
  // Preferences (kept on reset).
  settings: `${PREFIX}.settings`,
} as const;

export type StorageKey = (typeof KEYS)[keyof typeof KEYS];

/** The keys "Reset progress" wipes. */
export const PROGRESS_KEYS: StorageKey[] = [];

export function readText(key: StorageKey): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeText(key: StorageKey, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: StorageKey) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

/** Parsed JSON, or the fallback when missing, unreadable or of the wrong shape. */
export function readJSON<T>(key: StorageKey, fallback: T): T {
  const raw = readText(key);
  if (raw === null) return fallback;
  try {
    const v = JSON.parse(raw) as unknown;
    // An object fallback only accepts a plain object back (not null, arrays or numbers).
    if (fallback !== null && typeof fallback === 'object' && !Array.isArray(fallback)) {
      return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as T) : fallback;
    }
    return v as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: StorageKey, value: unknown): boolean {
  return writeText(key, JSON.stringify(value));
}

// ------------------------------------------------------------------ versions

export const SAVE_VERSION = 1;

/** MIGRATIONS[n] upgrades saves from version n to n + 1; false means "try again next start". */
const MIGRATIONS: Array<() => boolean> = [
  // 0 → 1: the first stored version; nothing to convert.
  () => true,
];

/** Brings stored data up to SAVE_VERSION; call once at startup. Newer saves are left alone. */
export function migrateStorage(): number {
  let v = Number(readText(KEYS.version) ?? 0) || 0;
  if (v > SAVE_VERSION) return v;
  for (; v < SAVE_VERSION; v++) {
    let ok = true;
    try {
      ok = MIGRATIONS[v]();
    } catch {
      /* a broken old value falls back when read: move on */
    }
    if (!ok) break;
  }
  writeText(KEYS.version, String(v));
  return v;
}
