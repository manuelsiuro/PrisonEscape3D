import { KEYS, PROGRESS_KEYS, readJSON, removeKey, writeJSON } from './storage';

/** Player preferences, saved on this device. New fields get their default automatically. */
export interface Settings {
  /** 0..1 */
  sfxVolume: number;
  /** All sound off (the title's switch); the volume is kept for when it comes back. */
  muted: boolean;
  /** 0..1: the music, under the effects. */
  musicVolume: number;
  /** No camera drift, flashes or animated extras. */
  reducedMotion: boolean;
  /** The camera jolts on blows, breaks and shots. */
  shake: boolean;
  /** First-time tips and the first day's guide. */
  tips: boolean;
  /** Vibrate on the big moments (phones). */
  haptics: boolean;
  /** Language: auto follows the browser. */
  lang: 'auto' | 'en' | 'fr';
  /** Graphics: auto starts from the device and steps down if frames run slow. */
  quality: 'auto' | 'high' | 'low';
  /** Speech bubbles (P13): lots, some (fewer, further apart) or none. */
  chatter: 'lots' | 'some' | 'off';
  /** The murmur of voices under the bubbles. */
  voices: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sfxVolume: 0.8,
  muted: false,
  musicVolume: 0.5,
  reducedMotion: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  shake: true,
  tips: true,
  haptics: true,
  lang: 'auto',
  quality: 'auto',
  chatter: 'lots',
  voices: true,
};

/** Stored settings, each field checked against its default's type (a bad value gets the default). */
export function loadSettings(): Settings {
  const raw = readJSON<Record<string, unknown>>(KEYS.settings, {});
  const s = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) if (typeof raw[k] === typeof v) s[k] = raw[k];
  const out = s as unknown as Settings;
  if (!['auto', 'en', 'fr'].includes(out.lang)) out.lang = 'auto';
  if (!['auto', 'high', 'low'].includes(out.quality)) out.quality = 'auto';
  if (!['lots', 'some', 'off'].includes(out.chatter)) out.chatter = 'lots';
  out.sfxVolume = Math.min(1, Math.max(0, Number.isFinite(out.sfxVolume) ? out.sfxVolume : DEFAULT_SETTINGS.sfxVolume));
  out.musicVolume = Math.min(1, Math.max(0, Number.isFinite(out.musicVolume) ? out.musicVolume : DEFAULT_SETTINGS.musicVolume));
  return out;
}

export function saveSettings(s: Settings) {
  writeJSON(KEYS.settings, s);
}

/** Wipes the game's progress; preferences stay. */
export function resetProgress() {
  for (const k of PROGRESS_KEYS) removeKey(k);
}

/** Forgets the tips already shown (they show again from the next game). */
export function resetTips() {
  removeKey(KEYS.seen);
}

/** One-time things already shown on this device (hints, intro cards), by name. */
export function hasSeen(name: string): boolean {
  return readJSON<string[]>(KEYS.seen, []).includes(name);
}

export function markSeen(name: string) {
  const seen = readJSON<string[]>(KEYS.seen, []);
  if (!Array.isArray(seen) || seen.includes(name)) return;
  writeJSON(KEYS.seen, [...seen, name]);
}
