/**
 * Phone vibration for the big moments (a no-op where the device or browser has none, as on
 * iPhones). Patterns are milliseconds: buzz, pause, buzz… Name them after the game's events.
 */
const PATTERNS = {
  bell: [10],
  attended: [8, 60, 8],
  missed: [40, 50, 40],
  lockdown: [120, 80, 120, 80, 200],
  /** A tool strike, and the tile giving way. */
  strike: [6],
  giveWay: [25, 40, 25],
} as const;

export type Haptic = keyof typeof PATTERNS;

let on = true;

export function setHaptics(enabled: boolean) {
  on = enabled;
}

export function buzz(kind: Haptic) {
  if (!on || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(PATTERNS[kind] as unknown as number[]);
  } catch {
    /* blocked (no user gesture yet) */
  }
}
