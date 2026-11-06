import { KEYS, readJSON, removeKey, writeJSON } from '../game/storage';

/**
 * The frame counter (session 5, the phone performance pass): frames a second, a frame's time, the
 * graphics card's, the quality tier and what's drawn, over the game, to read the game's speed on a
 * real phone. `?perf` in the address turns it on and keeps it on (an installed game opened after
 * shows it too); `?perf=0` turns it off. Its code is fetched only when it's on (perfCounter.ts).
 */
export const perfHook: {
  /** Before a frame's work. */
  begin: (() => void) | null;
  /** After it: the frame's time on the main thread (ms) and the frame's clock. */
  end: ((ms: number, now: number) => void) | null;
} = { begin: null, end: null };

/** Whether the counter is wanted: the address says so (and it's remembered), or it was before. */
export function perfWanted(search = location.search): boolean {
  const asked = new URLSearchParams(search).get('perf');
  if (asked === '0' || asked === 'off') {
    removeKey(KEYS.perf);
    return false;
  }
  if (asked !== null) {
    writeJSON(KEYS.perf, true);
    return true;
  }
  return readJSON<boolean>(KEYS.perf, false) === true;
}

/** Puts the counter up when it's wanted (its code fetched then). */
export function startPerf() {
  if (!perfWanted()) return;
  void import('./perfCounter').then(
    (m) => m.showCounter(),
    () => {},
  );
}
