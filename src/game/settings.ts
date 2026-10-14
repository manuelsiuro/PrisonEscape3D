import { KEYS, PROGRESS_KEYS, readJSON, removeKey, writeJSON } from './storage';

/** Player preferences, saved on this device. New fields get their default automatically. */
export interface Settings {
  /** 0..1 */
  sfxVolume: number;
  /** All sound off (the title's switch); the volume is kept for when it comes back. */
  muted: boolean;
  /** No screen shake or flashes. */
  reducedMotion: boolean;
  /** Vibrate on the big moments (phones). */
  haptics: boolean;
  /** Language: auto follows the browser. */
  lang: 'auto' | 'en' | 'fr';
}

export const DEFAULT_SETTINGS: Settings = {
  sfxVolume: 0.8,
  muted: false,
  reducedMotion: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  haptics: true,
  lang: 'auto',
};

/** Stored settings, each field checked against its default's type (a bad value gets the default). */
export function loadSettings(): Settings {
  const raw = readJSON<Record<string, unknown>>(KEYS.settings, {});
  const s = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) if (typeof raw[k] === typeof v) s[k] = raw[k];
  const out = s as unknown as Settings;
  if (!['auto', 'en', 'fr'].includes(out.lang)) out.lang = 'auto';
  out.sfxVolume = Math.min(1, Math.max(0, Number.isFinite(out.sfxVolume) ? out.sfxVolume : DEFAULT_SETTINGS.sfxVolume));
  return out;
}

export function saveSettings(s: Settings) {
  writeJSON(KEYS.settings, s);
}

/** Wipes the game's progress; preferences stay. */
export function resetProgress() {
  for (const k of PROGRESS_KEYS) removeKey(k);
}
