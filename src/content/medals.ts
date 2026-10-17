/**
 * Medals (P16): for each prison's ways out, the day by which an escape earns gold, silver or
 * bronze (an escape on that day or before). A medal once earned is kept, whatever comes after.
 * Every way out of every prison has a row (achievementtest checks).
 */
export type Medal = 'gold' | 'silver' | 'bronze';
export const MEDALS: readonly Medal[] = ['gold', 'silver', 'bronze'];

/** prison → route → [gold, silver, bronze] days. */
export const MEDAL_DAYS: Record<string, Record<string, readonly [number, number, number]>> = {
  // (The stowaway's days follow the calendar, P18: a delivery comes once a week, by day 8 at the latest; gold is away with the first, silver the second, bronze the third.)
  // (P24: the bluff wants the phone, its blank card and a guard's uniform; the glider Intellect 80 and the right wind, a day in a few.)
  'center-perks': { fence: [3, 5, 8], tunnel: [2, 4, 7], roof: [3, 5, 8], takeover: [4, 7, 10], stowaway: [8, 15, 22], bluff: [4, 7, 10], glider: [5, 8, 12] },
  'stalag-flucht': { fence: [3, 6, 9], tunnel: [3, 5, 8], roof: [4, 6, 9], takeover: [5, 8, 12], stowaway: [8, 15, 22], glider: [6, 10, 14] },
  shankton: { fence: [4, 7, 10], tunnel: [4, 6, 10], roof: [4, 7, 10], takeover: [6, 9, 13], bluff: [5, 8, 12], glider: [7, 11, 15] },
  'san-pancho': { tunnel: [5, 8, 12], gate: [5, 8, 12], takeover: [7, 10, 14], stowaway: [8, 15, 22] },
  irongate: { raft: [6, 9, 13], helicopter: [7, 10, 14], takeover: [8, 12, 16], stowaway: [8, 15, 22], bluff: [7, 11, 15] },
};

/** The medal an escape on `day` earns (null: too slow for bronze, or no medals there). */
export function medalFor(prison: string, route: string, day: number): Medal | null {
  const row = MEDAL_DAYS[prison]?.[route];
  if (!row) return null;
  const k = row.findIndex((d) => day <= d);
  return k < 0 ? null : MEDALS[k];
}

/** The better of two medals (null below bronze). */
export function betterMedal(a: Medal | null | undefined, b: Medal | null | undefined): Medal | null {
  const rank = (m: Medal | null | undefined) => (m ? MEDALS.indexOf(m) : 3);
  return rank(a) <= rank(b) ? (a ?? null) : (b ?? null);
}
