/**
 * Phone vibration for the big moments (a no-op where the device or browser has none, as on
 * iPhones). Patterns are milliseconds: buzz, pause, buzz… Name them after the game's events.
 */
const PATTERNS = {
  // Pulses under ~25 ms don't spin up many Android motors: nothing is felt. Keep every buzz ≥ 30.
  bell: [30],
  attended: [30, 70, 30],
  missed: [60, 60, 60],
  lockdown: [180, 90, 180, 90, 300],
  /** A tool strike, and the tile giving way. */
  strike: [30],
  giveWay: [50, 50, 50],
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
