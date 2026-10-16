import { PRISONS } from '../content/prisons';
import type { PrisonDef } from '../content/prisons/types';
import { Sim, type Snapshot } from '../sim/Sim';
import type { Rumor } from '../talk/director';
import { KEYS, readJSON, removeKey, writeJSON, type StorageKey } from './storage';

/**
 * Saved games (GDD §2: sleeping saves progress). A save is the simulation's snapshot (about
 * 5 KB) plus what the load list shows. The run in progress has its own save, written at 08:00,
 * when the player falls asleep in bed, and whenever the game is paused, hidden or left (a
 * phone may close a tab in the background at any time); "Continue" picks it up. Three slots
 * keep games the player saved by hand.
 */
export type SlotId = 'auto' | 1 | 2 | 3;
export const HAND_SLOTS = [1, 2, 3] as const;
export const ALL_SLOTS: readonly SlotId[] = ['auto', ...HAND_SLOTS];

export interface SaveFile {
  v: 1;
  /** The prison (its id), the day and the minute of the day, where the player was (a zone id). */
  prison: string;
  day: number;
  minute: number;
  zone: string;
  /** When it was saved (ms since 1970) and by which version of the game. */
  at: number;
  game: string;
  snap: Snapshot;
  /** Rumors heard (P13, the prisoner's file): kept with the game, optional. */
  rumors?: Rumor[];
}

const KEY_OF: Record<SlotId, StorageKey> = { auto: KEYS.saveAuto, 1: KEYS.save1, 2: KEYS.save2, 3: KEYS.save3 };

/** The save file for a game as it stands now. */
export function saveFileOf(sim: Sim, at: number, game: string, rumors: readonly Rumor[] = []): SaveFile {
  const clock = sim.clock;
  return {
    v: 1,
    prison: sim.prison.id,
    day: clock.day,
    minute: clock.minuteOfDay,
    zone: sim.playerZone,
    at,
    game,
    snap: sim.snapshot(),
    ...(rumors.length ? { rumors: rumors.map((r) => ({ fact: { ...r.fact }, step: r.step })) } : {}),
  };
}

/** Writes a game to a slot; false when storage is full or blocked. */
export function writeSave(slot: SlotId, sim: Sim, game = __APP_VERSION__, rumors: readonly Rumor[] = []): boolean {
  return writeJSON(KEY_OF[slot], saveFileOf(sim, Date.now(), game, rumors));
}

/** A slot's save, or null when it's empty, unreadable or not a save of a known prison. */
export function readSave(slot: SlotId): SaveFile | null {
  const f = readJSON<Partial<SaveFile>>(KEY_OF[slot], {});
  const snap = f.snap as Partial<Snapshot> | undefined;
  const ok =
    f.v === 1 &&
    typeof f.day === 'number' &&
    typeof f.minute === 'number' &&
    typeof f.at === 'number' &&
    typeof f.zone === 'string' &&
    !!snap &&
    typeof snap.state === 'object' &&
    snap.state !== null &&
    typeof snap.state.step === 'number' &&
    !!prisonOf(f.prison);
  if (!ok) return null;
  // Rumors from an older or damaged save: dropped, not trusted.
  if (f.rumors !== undefined && !(Array.isArray(f.rumors) && f.rumors.every((r) => r && typeof r.step === 'number' && typeof r.fact?.kind === 'string' && typeof r.fact.key === 'string'))) delete f.rumors;
  return f as SaveFile;
}

export function deleteSave(slot: SlotId) {
  removeKey(KEY_OF[slot]);
}

export function prisonOf(id: unknown): PrisonDef | undefined {
  return PRISONS.find((p) => p.id === id);
}

/** The game a save holds, ready to play (null if it can't be loaded). */
export function loadSave(f: SaveFile): Sim | null {
  const prison = prisonOf(f.prison);
  if (!prison) return null;
  try {
    const sim = new Sim(prison, 1);
    sim.restore(f.snap);
    return sim;
  } catch {
    return null;
  }
}
