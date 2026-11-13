import { KEYS, readJSON, removeKey, writeJSON } from '../game/storage';

/**
 * City Escape's game in progress (C1): one city at a time, in a slot of its own (the prisons' saves
 * never see it). The file carries what the title needs to say where it was left (the district, the day)
 * without the city's code; `snap` is the simulation's (city/sim/City.ts), read by the city's own part.
 */
export interface CitySave {
  v: 1;
  /** When it was written (ms), and the game's version then. */
  at: number;
  game: string;
  /** Where it was left, for the title: the district's name, the day and the minute of the day, how death is taken. */
  name: string;
  day: number;
  minute: number;
  mode: number;
  snap: unknown;
}

/** The city in progress, or null (none, or a file that isn't one). */
export function readCitySave(): CitySave | null {
  const f = readJSON<CitySave | null>(KEYS.citySave, null);
  if (!f || f.v !== 1 || typeof f.name !== 'string' || !Number.isInteger(f.day) || !Number.isInteger(f.minute) || !f.snap) return null;
  return f;
}

export const writeCitySave = (f: CitySave): boolean => writeJSON(KEYS.citySave, f);
export const deleteCitySave = () => removeKey(KEYS.citySave);

/**
 * Whether City Escape shows on the title. Hidden until it's whole (the user's choice, 2026-11-13: each
 * stage is released, the entry shown only with `?city` in the address).
 */
export const cityOn = () => new URLSearchParams(location.search).has('city');
