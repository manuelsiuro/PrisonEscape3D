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
  /** Hints and intro cards already shown. */
  seen: `${PREFIX}.seen`,
  // Progress.
  /** Escapes per prison (records.ts): the routes found and the quickest. */
  escapes: `${PREFIX}.escapes`,
  /** Saved games (saves.ts): the run in progress (Continue) and three slots. */
  saveAuto: `${PREFIX}.save.auto`,
  save1: `${PREFIX}.save.1`,
  save2: `${PREFIX}.save.2`,
  save3: `${PREFIX}.save.3`,
  /** Tutorial lessons done (their ids). */
  lessons: `${PREFIX}.lessons`,
  /** P16: lifetime stats (stats.ts), achievements earned (trophies.ts). */
  stats: `${PREFIX}.stats`,
  trophies: `${PREFIX}.trophies`,
  /** P16: your prisoner (prisoner.ts): kept on reset, like the settings. */
  prisoner: `${PREFIX}.prisoner`,
  /** P16: each save's run log (runlog.ts), kept next to it; the last escape's. */
  logAuto: `${PREFIX}.log.auto`,
  log1: `${PREFIX}.log.1`,
  log2: `${PREFIX}.log.2`,
  log3: `${PREFIX}.log.3`,
  replayLast: `${PREFIX}.replay.last`,
} as const;

/** The quickest escape's run log for a prison (P16). */
export const replayBestKey = (prison: string) => `${PREFIX}.replay.best.${prison}` as const;

export type StorageKey = (typeof KEYS)[keyof typeof KEYS] | ReturnType<typeof replayBestKey>;

/** The keys "Reset progress" wipes (and every prison's best replay: resetProgress). */
export const PROGRESS_KEYS: StorageKey[] = [KEYS.escapes, KEYS.saveAuto, KEYS.save1, KEYS.save2, KEYS.save3, KEYS.lessons, KEYS.stats, KEYS.trophies, KEYS.logAuto, KEYS.log1, KEYS.log2, KEYS.log3, KEYS.replayLast];

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

export const SAVE_VERSION = 2;

/** MIGRATIONS[n] upgrades saves from version n to n + 1; false means "try again next start". */
const MIGRATIONS: Array<() => boolean> = [
  // 0 → 1: the first stored version; nothing to convert.
  () => true,
  // 1 → 2 (P16): escape records keep each way out's quickest (and its medal). A prison escaped
  // one way only: that way's quickest is the prison's. Several ways: which was quickest isn't known.
  () => {
    const all = readJSON<Record<string, { routes?: unknown; bestDay?: unknown; bestMinute?: unknown; byRoute?: unknown }>>(KEYS.escapes, {});
    for (const r of Object.values(all)) {
      if (!r || typeof r !== 'object' || r.byRoute) continue;
      const routes = Array.isArray(r.routes) ? r.routes.filter((x): x is string => typeof x === 'string') : [];
      r.byRoute = routes.length === 1 && typeof r.bestDay === 'number' && r.bestDay > 0 ? { [routes[0]]: { day: r.bestDay, minute: r.bestMinute } } : {};
    }
    return writeJSON(KEYS.escapes, all);
  },
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
