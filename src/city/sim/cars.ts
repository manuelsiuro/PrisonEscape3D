import { STEPS_PER_MINUTE } from '../../sim/tuning';
import { MAP_H, MAP_W } from '../../sim/world/World';
import { CARS } from '../content/loot';
import { DECO } from '../gen/district';
import { streamOf } from '../gen/plan';
import type { City } from './City';
import { noise } from './dead';

/**
 * Cars searched (2.54), a part of the city's simulation. A car or a wreck left on a street or in a
 * car park is a box of its own (its key: 'c' + its first tile), searched from beside either of its
 * tiles like a piece of furniture, with a list of its own (content/loot.ts). One car in a few still
 * has its alarm: searched, it sounds for a while and the dead that aren't after anyone come to it. A
 * small red light on its roof says so beforehand: it can be left alone, or set off on purpose.
 * Which cars, and what is in each, come from the city's seed; the state keeps only the alarm sounding.
 */

const N = MAP_W * MAP_H;

/** The alarm sounding in the district the player is in: none, or [the tile it is heard from, the step it stops]. */
export const freshCars = () => ({ alarm: [] as number[] });

/** Which tiles are a car's or a wreck's (its first tile + 1), worked out when a district is entered. */
export function carsHere(c: City) {
  const d = c.district;
  c.carAt.fill(0);
  for (let i = 0; i < N; i++) {
    if (d.deco[i] !== DECO.CAR && d.deco[i] !== DECO.WRECK) continue;
    c.carAt[i] = i + 1;
    const rest = i + (d.turn[i] ? MAP_W : 1);
    if (rest < N && d.deco[rest] === DECO.PART) c.carAt[rest] = i + 1;
  }
  c.carsRev++;
}

/** The tiles a car stands on (its first, and the rest of it). */
export function carTiles(c: City, first: number): number[] {
  const out = [first];
  for (const t of [first + 1, first + MAP_W]) if (t < N && c.carAt[t] === first + 1) out.push(t);
  return out;
}

export const isWreck = (c: City, first: number) => c.district.deco[first] === DECO.WRECK;

/** Whether a car still has its alarm (never a wreck): from the seed, the district and its tile. */
export const alarmed = (c: City, first: number) =>
  !isWreck(c, first) && streamOf(c.state.seed, 300_000 + c.state.district * N + first)() * CARS.alarmOneIn < 1;

/** The cars of this district whose alarm would still go off (not yet searched): for the view's red lights. */
export function alarmCars(c: City): number[] {
  const out: number[] = [];
  for (let i = 0; i < N; i++) if (c.carAt[i] === i + 1 && alarmed(c, i) && !c.searched(`c${i}`)) out.push(i);
  return out;
}

/** A car searched for the first time: its alarm, if it has one, goes off where the player stands. */
export function carOpened(c: City, first: number) {
  c.carsRev++;
  if (!alarmed(c, first)) return;
  c.state.alarm = [c.tile, c.state.step + CARS.alarmMinutes * STEPS_PER_MINUTE];
  noise(c, c.tile, CARS.alarmReach);
  c.events.push({ type: 'alarm', on: true, tile: first });
}

/** A game minute gone: the alarm is heard again, or stops. */
export function carMinute(c: City) {
  const s = c.state;
  if (!s.alarm.length) return;
  if (s.step >= s.alarm[1]) {
    s.alarm = [];
    return void c.events.push({ type: 'alarm', on: false, tile: -1 });
  }
  noise(c, s.alarm[0], CARS.alarmReach, true);
}

/** A save's alarm made sound before the city is built from it (none: a save from before cars; damaged: none). */
export function soundCars(s: { step?: unknown; alarm?: unknown }) {
  if (s.alarm === undefined) return;
  const a = s.alarm;
  const step = Number.isInteger(s.step) ? (s.step as number) : 0;
  const ok =
    Array.isArray(a) &&
    (a.length === 0 ||
      (a.length === 2 &&
        a.every(Number.isInteger) &&
        a[0] >= 0 &&
        a[0] < N &&
        a[1] >= 0 &&
        a[1] <= step + (CARS.alarmMinutes + 1) * STEPS_PER_MINUTE));
  if (!ok) s.alarm = [];
}
