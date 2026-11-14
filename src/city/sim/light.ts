import { findPath } from '../../sim/ai/path';
import { lineOfSight } from '../../sim/ai/sight';
import { DIR_X, DIR_Z } from '../../sim/command';
import { STEPS_PER_MINUTE } from '../../sim/tuning';
import { centerX, centerZ, tileAt } from '../../sim/world/grid';
import { MAP_H, MAP_W } from '../../sim/world/World';
import { cityItemNumber } from '../content/items';
import { LEVEL, LIGHT, LIGHT_KIND } from '../content/light';
import { DECO } from '../gen/district';
import type { City } from './City';
import { ZKIND } from '../content/dead';
import { nightAt, ZED } from './dead';
import { going } from './story';

/**
 * Light and fire (2.52), a part of the city's simulation. What burns where is in the state (by
 * district: a tile, a kind, the step it goes out); which tiles that lights in the district the player
 * is in is worked out from it (`City.lit`) whenever it changes. Everything is lit from the pockets
 * (Use): fuel on a barrel or a generator beside the player, a lantern where they stand, the torch in
 * hand. The dead's side of it is in dead.ts, behind `City.anyLight`: a city with nothing burning
 * plays exactly as it did before.
 */

/** A light: its tile, its kind (LIGHT_KIND), the step it burns out. */
export type Light = [number, number, number];

const N = MAP_W * MAP_H;
const TORCH = cityItemNumber('torch');
const BATTERY = cityItemNumber('battery');
const LANTERN = cityItemNumber('lantern');
const FUEL = cityItemNumber('fuel');

export const freshLight = () => ({ torch: 0, torchOn: 0, lights: {} as Record<string, Light[]> });

/** The lights of the district the player is in (burning or not: `relight` drops the burnt out), read only. */
export const lightsHere = (c: City): readonly Light[] => c.state.lights[c.state.district] ?? [];

/** The torch is lit and in the pockets. */
export const torchLit = (c: City) => c.state.torchOn === 1 && c.state.torch > 0 && c.count(TORCH) > 0;

/** Where the player stands: lit (strong light, or daylight), dim (the torch alone), dark. */
export function lightLevel(c: City): number {
  if (!nightAt(c.minute) || c.lit[c.tile]) return LEVEL.LIT;
  return torchLit(c) ? LEVEL.DIM : LEVEL.DARK;
}

/** Which tiles are lit, worked out afresh (a district entered, a light lit or gone out). */
export function relight(c: City) {
  const s = c.state;
  const list = lightsHere(c).filter((l) => l[2] > s.step);
  s.lights[s.district] = list;
  if (!list.length) delete s.lights[s.district];
  c.lit.fill(0);
  c.anyLight = list.length > 0;
  c.lightsRev++;
  const lotAt = c.district.lotAt;
  for (const [tile, kind] of list) {
    if (kind === LIGHT_KIND.POWER) {
      // (Its building's every lamp: the whole lot.)
      const lot = lotAt[tile];
      if (lot) for (let i = 0; i < N; i++) if (lotAt[i] === lot) c.lit[i] = 1;
      continue;
    }
    const r = kind === LIGHT_KIND.FIRE ? LIGHT.fireReach : LIGHT.lanternReach;
    const x = tile % MAP_W;
    const z = Math.floor(tile / MAP_W);
    for (let tz = Math.max(0, z - r); tz <= Math.min(MAP_H - 1, z + r); tz++)
      for (let tx = Math.max(0, x - r); tx <= Math.min(MAP_W - 1, x + r); tx++) {
        // (A round pool, stopped by walls.)
        if ((tx - x) ** 2 + (tz - z) ** 2 > r * r + r) continue;
        const i = tz * MAP_W + tx;
        if (i === tile || lineOfSight(c.world, centerX(tile), centerZ(tile), centerX(i), centerZ(i))) c.lit[i] = 1;
      }
  }
}

/** The dead that aren't after anyone, caught in a light just lit, leave it for the nearest dark. */
function shoo(c: City) {
  if (going(c) === 1) return;
  for (const z of c.state.zeds) {
    // (A brute doesn't mind it.)
    if (z.mode === ZED.CHASE || z.kind === ZKIND.BRUTE || !c.lit[tileAt(z.body.x, z.body.z)]) continue;
    z.mode = ZED.SEEK;
    z.goal = -3;
    z.path = [];
  }
}

/** The way out of the light for one of the dead sent off by `shoo` (dead.ts asks). */
export const wayToDark = (c: City, from: number): number[] =>
  findPath(c.world, from, (i) => !c.lit[i], -1, 2500, undefined, c.zedGrid) ?? [];

function add(c: City, tile: number, kind: number, minutes: number) {
  const list = (c.state.lights[c.state.district] ??= []);
  // (One more than the most: the oldest goes out, and is said to.)
  if (list.length >= LIGHT.most) {
    const [t, k] = list.shift()!;
    c.events.push({ type: 'burnt', kind: k, tile: t });
  }
  // (Out on a minute's turn, when what burns is looked at: a save loads to the same light.)
  const until = c.state.step + minutes * STEPS_PER_MINUTE;
  list.push([tile, kind, Math.ceil(until / STEPS_PER_MINUTE) * STEPS_PER_MINUTE]);
  relight(c);
  shoo(c);
  c.events.push({ type: 'lit', kind, tile });
}

/** A barrel or a generator beside the player that a can of fuel would light: the one faced first. */
function fuelled(c: City): { tile: number; kind: number; burning: boolean } | null {
  const here = c.tile;
  const x = here % MAP_W;
  const z = Math.floor(here / MAP_W);
  const f = c.state.player.facing;
  const fx = Math.sign(DIR_X[f] ?? 0);
  const fz = Math.sign(DIR_Z[f] ?? 0);
  const around: Array<[number, number]> = [
    [fx, fz],
    [fx, 0],
    [0, fz],
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
    // (And cornerwise, as a fire cooks.)
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const burning = (tile: number) => lightsHere(c).some((l) => l[0] === tile && l[2] > c.state.step);
  let spent: { tile: number; kind: number; burning: boolean } | null = null;
  for (const [dx, dz] of around) {
    if (!dx && !dz) continue;
    const tx = x + dx;
    const tz = z + dz;
    if (tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) continue;
    const t = tz * MAP_W + tx;
    let found: { tile: number; kind: number } | null = null;
    if (c.district.deco[t] === DECO.BARREL) found = { tile: t, kind: LIGHT_KIND.FIRE };
    else {
      const g = c.district.props.find(
        (p) => p.kind === 'generator' && tx >= p.x && tx < p.x + (p.w ?? 1) && tz >= p.z && tz < p.z + (p.d ?? 1),
      );
      if (g) found = { tile: g.z * MAP_W + g.x, kind: LIGHT_KIND.POWER };
    }
    if (!found) continue;
    if (!burning(found.tile)) return { ...found, burning: false };
    spent ??= { ...found, burning: true };
  }
  return spent;
}

/** One of the pockets' things used as a light (Use): true when it was one, whatever came of it. */
export function useLight(c: City, item: number): boolean {
  const s = c.state;
  if (item === TORCH) {
    if (s.torchOn) {
      s.torchOn = 0;
      c.events.push({ type: 'torch', on: false, spent: false });
      return true;
    }
    if (s.torch <= 0) {
      if (!c.count(BATTERY)) return (c.events.push({ type: 'refused', why: 'noBattery' }), true);
      c.spend(BATTERY, 1);
      s.torch = LIGHT.torchMinutes;
    }
    s.torchOn = 1;
    c.events.push({ type: 'torch', on: true, spent: false });
    return true;
  }
  if (item === LANTERN) {
    const here = c.tile;
    if (lightsHere(c).some((l) => l[0] === here && l[2] > s.step)) return (c.events.push({ type: 'refused', why: 'alreadyLit' }), true);
    c.spend(LANTERN, 1);
    add(c, here, LIGHT_KIND.LANTERN, LIGHT.lanternMinutes);
    return true;
  }
  if (item === FUEL) {
    const at = fuelled(c);
    if (!at) return (c.events.push({ type: 'refused', why: 'noFire' }), true);
    if (at.burning) return (c.events.push({ type: 'refused', why: 'alreadyLit' }), true);
    c.spend(FUEL, 1);
    add(c, at.tile, at.kind, at.kind === LIGHT_KIND.FIRE ? LIGHT.fireMinutes : LIGHT.powerMinutes);
    return true;
  }
  return false;
}

/** A fire burning within a tile of the player: it cooks as a camp stove does. */
export function atFire(c: City): boolean {
  if (!c.anyLight) return false;
  const here = c.tile;
  return lightsHere(c).some(
    (l) =>
      l[1] === LIGHT_KIND.FIRE &&
      l[2] > c.state.step &&
      Math.max(Math.abs((l[0] % MAP_W) - (here % MAP_W)), Math.abs(Math.floor(l[0] / MAP_W) - Math.floor(here / MAP_W))) <= 1,
  );
}

/** A game minute gone: the torch burns down, what has burnt out goes dark. */
export function lightMinute(c: City) {
  const s = c.state;
  if (s.torchOn) {
    // (Dropped, stored or lost in a fall: it's out.)
    if (!c.count(TORCH)) s.torchOn = 0;
    else if (--s.torch <= 0) {
      s.torch = 0;
      s.torchOn = 0;
      c.events.push({ type: 'torch', on: false, spent: true });
    }
  }
  if (!c.anyLight) return;
  const out = lightsHere(c).filter((l) => l[2] <= s.step);
  if (!out.length) return;
  for (const l of out) c.events.push({ type: 'burnt', kind: l[1], tile: l[0] });
  relight(c);
}

/** A save's light fields made sound before the city is built from it (there or not: a save from before them; damaged: none). */
export function soundLight(s: { step?: unknown; torch?: unknown; torchOn?: unknown; lights?: unknown }) {
  // (Nothing burns longer than a generator's can from now.)
  const last = (Number.isInteger(s.step) ? (s.step as number) : 0) + (LIGHT.powerMinutes + 1) * STEPS_PER_MINUTE;
  if (s.torch !== undefined && (!Number.isInteger(s.torch) || (s.torch as number) < 0 || (s.torch as number) > LIGHT.torchMinutes))
    s.torch = 0;
  if (s.torchOn !== undefined) s.torchOn = s.torchOn === 1 && (s.torch as number) > 0 ? 1 : 0;
  if (s.lights === undefined) return;
  const lights = s.lights as Record<string, Light[]>;
  const ok =
    !!lights &&
    typeof lights === 'object' &&
    !Array.isArray(lights) &&
    Object.entries(lights).every(
      ([d, list]) =>
        /^[0-8]$/.test(d) &&
        Array.isArray(list) &&
        list.length <= LIGHT.most &&
        list.every(
          (l) =>
            Array.isArray(l) &&
            l.length === 3 &&
            l.every(Number.isInteger) &&
            l[0] >= 0 &&
            l[0] < N &&
            l[1] >= 0 &&
            l[1] <= 2 &&
            l[2] >= 0 &&
            l[2] <= last,
        ),
    );
  if (!ok) s.lights = {};
}
