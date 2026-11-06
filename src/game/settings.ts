import { PRISONS } from '../content/prisons';
import { clean, type Bindings } from '../input/bindings';
import { PICKABLE } from './holidays';
import { KEYS, PROGRESS_KEYS, readJSON, removeKey, replayBestKey, writeJSON } from './storage';

/** The interface's sizes on offer (session 9). */
export const UI_SCALES = [1, 1.15, 1.3];
/** The short side the page is never laid out below with the interface scaled, in CSS pixels (the sweep checked it there). */
export const SCALE_FLOOR = 300;

/** The scale for a screen of this size: the pick, capped by the short side (in steps of 5%; app/scale.ts). */
export function fitScale(want: number, width: number, height: number): number {
  // (Sizes rounded first: the window times a scale in single precision read 359.99998 for 360, a step lower.)
  const most = Math.round(Math.min(width, height)) / SCALE_FLOOR;
  return Math.max(1, Math.floor(Math.min(want, most) * 20 + 1e-3) / 20);
}

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
  /** The warden's announcements (P17): all of them (the morning card too), short lines only, or none (the HUD's chip still shows the day). */
  pa: 'full' | 'short' | 'off';
  /** v2.21 (P42): holidays by the calendar (a run begun on one has it), one picked now (`holidayPick`), or none. */
  holidays: 'calendar' | 'pick' | 'off';
  holidayPick: 'easter' | 'summer' | 'halloween' | 'christmas';
  /** Session 9: the interface's size on a phone or tablet (1, 1.15, 1.3; app/scale.ts caps it on a small screen). */
  uiScale: number;
  /** Session 9: the main actions moved off their default keys (input/bindings.ts). */
  keys: Bindings;
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
  pa: 'full',
  holidays: 'calendar',
  holidayPick: 'christmas',
  uiScale: 1,
  keys: {},
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
  if (!['full', 'short', 'off'].includes(out.pa)) out.pa = 'full';
  if (!['calendar', 'pick', 'off'].includes(out.holidays)) out.holidays = 'calendar';
  if (!PICKABLE.includes(out.holidayPick)) out.holidayPick = 'christmas';
  if (!UI_SCALES.includes(out.uiScale)) out.uiScale = 1;
  out.keys = clean(out.keys);
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
  for (const p of PRISONS) removeKey(replayBestKey(p.id));
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
