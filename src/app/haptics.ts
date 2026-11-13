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

/** The big moments, felt harder on a pad's motors (out of 1); the rest are a light buzz. */
const STRONG: ReadonlySet<Haptic> = new Set(['lockdown', 'giveWay', 'missed']);

/** A pad's rumble (2.45, set by play/pad.ts while a pad with motors is in hand): ms, the strong motor, the weak one. */
type Rumble = (ms: number, strong: number, weak: number) => void;
let rumble: Rumble | null = null;
export function setRumble(f: Rumble | null) {
  rumble = f;
}
/** Whether a pad that rumbles is in hand (the setting is offered then too). */
export const canRumble = () => rumble !== null;

export function buzz(kind: Haptic) {
  if (!on) return;
  if (rumble) {
    // (The same pattern as the phone's: each buzz at its time; a pad can't queue them itself.)
    const f = rumble;
    const strong = STRONG.has(kind);
    let at = 0;
    PATTERNS[kind].forEach((ms, i) => {
      if (i % 2 === 0) setTimeout(() => f(ms, strong ? 0.8 : 0.25, strong ? 0.6 : 0.5), at);
      at += ms;
    });
  }
  if (typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(PATTERNS[kind] as unknown as number[]);
  } catch {
    /* blocked (no user gesture yet) */
  }
}
