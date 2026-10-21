import type { ZoneId } from './zones';

/**
 * The daily schedule (GDD §2.1). Each block starts at `start` (minute of the day) and runs
 * until the next one; Lights Out wraps past midnight to 08:00. A block with zones is
 * mandatory: the player checks in by stepping into one of them at least once during it
 * (GDD §2.2). Missing it costs heat or starts a lockdown. Names go through t() as
 * `routine.<id>`.
 */
export interface RoutineDef {
  id: RoutineId;
  start: number;
  /** Where to be (any one of them); empty for free time. */
  zones: readonly ZoneId[];
  /** What missing it costs: +25% heat, a lockdown, or nothing (Lights Out: guards enforce it, P3). */
  miss: 'heat' | 'lockdown' | null;
}

export type RoutineId =
  | 'rollCall'
  | 'breakfast'
  | 'freeTime'
  | 'work'
  | 'exercise'
  | 'showers'
  | 'dinner'
  | 'eveningFreeTime'
  | 'eveningRollCall'
  | 'lightsOut';

export const ROUTINE: readonly RoutineDef[] = [
  { id: 'rollCall', start: 8 * 60, zones: ['rollCall'], miss: 'lockdown' },
  { id: 'breakfast', start: 9 * 60, zones: ['canteen'], miss: 'heat' },
  { id: 'freeTime', start: 10 * 60, zones: [], miss: null },
  // Mandatory only with a job (P6); until then, more free time.
  { id: 'work', start: 12 * 60, zones: [], miss: null },
  { id: 'exercise', start: 15 * 60, zones: ['gym', 'yard', 'sports'], miss: 'heat' },
  { id: 'showers', start: 16 * 60, zones: ['showers'], miss: 'heat' },
  { id: 'dinner', start: 17 * 60, zones: ['canteen'], miss: 'heat' },
  { id: 'eveningFreeTime', start: 18 * 60, zones: [], miss: null },
  { id: 'eveningRollCall', start: 22 * 60, zones: ['rollCall'], miss: 'lockdown' },
  { id: 'lightsOut', start: 23 * 60, zones: ['playerCell'], miss: null },
];

/**
 * P31: the places outdoors whose gates open by the routine (the sports ground, the garden):
 * the blocks they're open for (never in a lockdown; anyone still inside keeps the gate open
 * until they're out, as a job room's door does). The garden is also the gardener's work room.
 */
export const OPEN_HOURS: Partial<Record<ZoneId, readonly RoutineId[]>> = {
  sports: ['freeTime', 'exercise', 'eveningFreeTime'],
  garden: ['freeTime', 'exercise', 'eveningFreeTime'],
};

/** The block running at a minute of the day (before 08:00 it is still Lights Out). */
export function routineAt(minuteOfDay: number): number {
  let k = ROUTINE.length - 1;
  for (let i = 0; i < ROUTINE.length; i++) if (ROUTINE[i].start <= minuteOfDay) k = i;
  return k;
}

/** When a block ends, as a minute of the day. */
export const routineEnd = (k: number) => ROUTINE[(k + 1) % ROUTINE.length].start;
