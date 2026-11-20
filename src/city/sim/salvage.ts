import { DIR_X, DIR_Z } from '../../sim/command';
import { MAP_H, MAP_W } from '../../sim/world/World';
import { isBuilding, type LotUse } from '../content/districts';
import { BLOW } from '../content/dead';
import { cityItem, cityItemNumber } from '../content/items';
import { BREAK_NOISE, BREAK_RATE, SALVAGE, WALL_WORK, type Salvage } from '../content/salvage';
import type { District } from '../gen/district';
import { TUNNEL } from '../gen/tunnel';
import { carTiles, isWreck } from './cars';
import type { City, Stack } from './City';
import { noise } from './dead';
import { notePlaces } from './story';

/**
 * Breaking things (C5, 2.66), a part of the city's simulation: furniture, cars and wrecks, and with a sledgehammer the inner walls
 * of an ordinary building, give way to blows. Begun by the blow's button with none of the dead in reach (what's faced), or by the
 * open piece's own Break; then a blow each `BLOW.every` steps, standing at it, each heard, each costing energy and wearing what
 * strikes, the best thing carried for the stuff it is made of. The work done: furniture is gone (its tiles walked on, what was
 * in it and what it was made of in a pile where it stood), a car or a wreck is stripped (it stays where it is, searched, nothing
 * more to break off it), a wall is a way through. Kept by district in the save: the pieces gone, the cars stripped, the holes.
 */

const N = MAP_W * MAP_H;

/** The buildings whose inner walls may come down: none of the landmarks, nobody's home but the dead's. */
const WALLED: readonly LotUse[] = ['house', 'shop', 'office', 'warehouse', 'clinic', 'garage'];

/** The save's fields (made sound in `soundSalvage`). */
export function freshSalvage() {
  return {
    broken: {} as Record<string, number[]>,
    stripped: {} as Record<string, number[]>,
    holes: {} as Record<string, number[]>,
  };
}

/** A save's fields made sound before the city is built from it. */
export function soundSalvage(st: { broken?: unknown; stripped?: unknown; holes?: unknown }) {
  const lists = (v: unknown, most: number): Record<string, number[]> => {
    const out: Record<string, number[]> = {};
    if (typeof v === 'object' && v && !Array.isArray(v))
      for (const [d, list] of Object.entries(v as Record<string, unknown>))
        if (/^[0-9]$/.test(d) && Array.isArray(list))
          out[d] = [...new Set(list.filter((k): k is number => Number.isInteger(k) && k >= 0 && k < most))];
    return out;
  };
  st.broken = lists(st.broken, 4096);
  st.stripped = lists(st.stripped, N);
  st.holes = lists(st.holes, N);
}

/** A key of work under way: 'b' and the piece's (furniture: its number; 'c' a car's first tile; 'w' a wall's tile). */
export const breakKey = (what: string) => `b${what}`;

/** The buildings (lots) of a district a survivor holds: nothing in them is broken, walls neither. */
export const peopleLots = (c: City, d: number): Set<number> => new Set(c.story.people.filter((p) => p.district === d).map((p) => p.lot));

/**
 * What a piece of furniture of a district breaks into (null: it doesn't, or not now: the story's or a note's, in a survivor's
 * building, gone already).
 */
export function propSalvage(c: City, k: number, d = c.state.district): Salvage | null {
  const dist = c.districtOf(d);
  const p = dist.props[k];
  const sal = p ? SALVAGE[p.kind] : undefined;
  if (!sal || (c.state.broken[d] ?? []).includes(k)) return null;
  if (peopleLots(c, d).has(dist.lotAt[p.z * MAP_W + p.x] - 1)) return null;
  if ([...c.story.things, ...notePlaces(c)].some((sp) => sp.district === d && sp.prop === k)) return null;
  return sal;
}

/** A save's broken pieces kept only where a piece could be broken (a damaged save never hides the story's furniture). */
export function soundBroken(c: City) {
  for (const d of Object.keys(c.state.broken)) {
    const list = c.state.broken[d];
    c.state.broken[d] = [];
    c.state.broken[d] = list.filter((k) => propSalvage(c, k, Number(d)) !== null);
  }
}

/**
 * Whether a tile is an inner wall of an ordinary building, standing between two of its floors (a straight run, not a corner);
 * never in a building a survivor holds (`safe`: their lots).
 */
export function innerWall(dist: District, t: number, safe: ReadonlySet<number> = new Set()): boolean {
  if (dist.index === TUNNEL || t < 0 || t >= N || dist.rows[Math.floor(t / MAP_W)][t % MAP_W] !== '#') return false;
  const lot = dist.lotAt[t];
  if (!lot || safe.has(lot - 1) || !WALLED.includes(dist.lots[lot - 1].use) || !isBuilding(dist.lots[lot - 1].use)) return false;
  const x = t % MAP_W;
  const z = Math.floor(t / MAP_W);
  const floor = (tx: number, tz: number) => {
    if (tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) return false;
    const i = tz * MAP_W + tx;
    const ch = dist.rows[tz][tx];
    return dist.lotAt[i] === lot && ch !== '#' && ch !== 'y';
  };
  return (floor(x - 1, z) && floor(x + 1, z)) || (floor(x, z - 1) && floor(x, z + 1));
}

/** A district as the generator made it with its inner walls broken through: the floor of the room beside. */
export function withHoles(c: City, base: District): District {
  const holes = c.state.holes[base.index] ?? [];
  if (!holes.length) return base;
  const rows = base.rows.map((r) => r.split(''));
  for (const t of holes) {
    const x = t % MAP_W;
    const z = Math.floor(t / MAP_W);
    const beside = [rows[z][x - 1], rows[z][x + 1], rows[z - 1]?.[x], rows[z + 1]?.[x]].find((ch) => ch && ch !== '#' && ch !== 'y');
    rows[z][x] = beside ?? '_';
  }
  return { ...base, rows: rows.map((r) => r.join('')) };
}

/** A save's holes kept only where an inner wall could be broken (the map changed under an old save, a damaged one). */
export function soundHoles(c: City) {
  for (const d of Object.keys(c.state.holes)) {
    const base = c.baseOf(Number(d));
    const safe = peopleLots(c, Number(d));
    c.state.holes[d] = c.state.holes[d].filter((t) => innerWall(base, t, safe));
  }
}

/** The thing that breaks a stuff best, of what's carried (fists: null), and the work a blow of it does; tired, half. */
export function breaker(c: City, metal: boolean): { arm: Stack | null; rate: number } {
  const side = metal ? 1 : 0;
  let arm: Stack | null = null;
  let rate = BREAK_RATE.fists[side];
  let worth = Infinity;
  for (const st of c.state.inv) {
    const it = cityItem(st[0]);
    if (!it || !st[1]) continue;
    const row = it.smash ?? (it.kind === 'weapon' && it.attack !== undefined ? (it.edge ? 'edge' : 'blunt') : null);
    if (!row) continue;
    const r = BREAK_RATE[row][side];
    // (Of two that break it as well, the one worth less: what doesn't wear, then the weaker weapon.)
    const w = it.wear === undefined ? -1 : (it.attack ?? 0);
    if (r > rate || (r === rate && r > 0 && arm && w < worth)) [arm, rate, worth] = [st, r, w];
  }
  if (c.state.energy <= 0 && rate > 1) rate = Math.floor(rate / 2);
  return { arm, rate };
}

/**
 * What's faced to break ('' nothing): a piece of furniture, a car or a wreck; `walls`, an inner wall too with a sledgehammer carried
 * (only for the action button: a blow swung at the dead before they're in reach never starts on a wall).
 */
export function facedBreak(c: City, walls = false): string {
  const p = c.state.player;
  const here = c.tile;
  // (As the action button takes what's faced: a facing a quarter off an axis faces both of its tiles.)
  const fx = Math.sign(Math.round(((DIR_X[p.facing] ?? 0) / 1024) * 2));
  const fz = Math.sign(Math.round(((DIR_Z[p.facing] ?? 0) / 1024) * 2));
  const ahead: number[] = [];
  if (fx) ahead.push(here + fx);
  if (fz) ahead.push(here + fz * MAP_W);
  for (const t of ahead) {
    if (t < 0 || t >= N || Math.abs((t % MAP_W) - (here % MAP_W)) > 1) continue;
    const k = c.breakAt[t];
    if (k) return breakKey(String(k - 1));
    const car = c.carAt[t];
    if (car && !(c.state.stripped[c.state.district] ?? []).includes(car - 1)) return breakKey(`c${car - 1}`);
    if (walls && c.carried(SLEDGE) && innerWall(c.district, t, c.safeLots)) return breakKey(`w${t}`);
  }
  return '';
}
const SLEDGE = cityItemNumber('sledgehammer');

/** The tiles of what a key of work breaks. */
function tilesOfWork(c: City, key: string): number[] {
  const what = key.slice(1);
  return what.startsWith('c')
    ? carTiles(c, Number(what.slice(1)))
    : what.startsWith('w')
      ? [Number(what.slice(1))]
      : c.tilesOf(Number(what));
}

/** What a key of work is made of (null: nothing to break there now). */
export function workOf(c: City, key: string): { sal: Salvage | null; wall: boolean } | null {
  const what = key.slice(1);
  if (what.startsWith('w')) return innerWall(c.district, Number(what.slice(1)), c.safeLots) ? { sal: null, wall: true } : null;
  if (what.startsWith('c')) {
    const first = Number(what.slice(1));
    if (!c.carAt[first] || (c.state.stripped[c.state.district] ?? []).includes(first)) return null;
    const sal = SALVAGE[isWreck(c, first) ? 'wreck' : 'car'];
    return sal ? { sal, wall: false } : null;
  }
  const sal = propSalvage(c, Number(what));
  return sal ? { sal, wall: false } : null;
}

/** The whole work a key takes (the progress ring's measure). */
export const workTotal = (c: City, key: string): number => {
  const w = workOf(c, key);
  return !w ? 1 : w.wall ? WALL_WORK : (w.sal?.work ?? 1);
};

/** Whether the player still stands at what they are breaking (beside it, on any side). */
export function atWork(c: City, key: string): boolean {
  const here = c.tile;
  return tilesOfWork(c, key).some(
    (t) => Math.abs((t % MAP_W) - (here % MAP_W)) + Math.abs(Math.floor(t / MAP_W) - Math.floor(here / MAP_W)) === 1,
  );
}

/** Whether something carried can do a key's work now (the blow's button starts only on what it can break). */
export function canWork(c: City, key: string): boolean {
  const w = workOf(c, key);
  if (!w) return false;
  return w.wall ? c.carried(SLEDGE) > 0 : breaker(c, !!w.sal?.metal).rate > 0;
}

/** Work begun on a key (refused, and said, when nothing carried can break it). */
export function startBreak(c: City, key: string) {
  const s = c.state;
  // (Pressed again while at it: the work goes on.)
  if (s.search === key) return;
  const w = workOf(c, key);
  if (!w || !atWork(c, key)) return;
  const metal = w.wall || !!w.sal?.metal;
  if (w.wall ? !c.carried(SLEDGE) : breaker(c, metal).rate <= 0)
    return void c.events.push({ type: 'refused', why: w.wall ? 'sledge' : 'tooHard' });
  c.close();
  s.search = key;
  // (The first blow at once; the next as a blow comes back.)
  s.searchLeft = 1;
  c.breakLeft = workTotal(c, key);
  c.events.push({ type: 'breaking', key });
}

/** A step of the work: the blow when its moment comes; the work done, what it was. Whether it ended. */
export function breakStep(c: City): boolean {
  const s = c.state;
  if (--s.searchLeft > 0) return false;
  const key = s.search;
  const w = workOf(c, key);
  if (!w) {
    s.search = '';
    return true;
  }
  const metal = w.wall || !!w.sal?.metal;
  const { arm, rate } = w.wall
    ? { arm: c.state.inv.find((st) => st[0] === SLEDGE) ?? null, rate: BREAK_RATE.sledge[1] }
    : breaker(c, metal);
  // (The tool worn out in the middle, and nothing else will do: said.)
  if (rate <= 0 || (w.wall && !arm)) {
    s.search = '';
    c.events.push({ type: 'refused', why: w.wall ? 'sledge' : 'tooHard' });
    return true;
  }
  s.energy = Math.max(0, s.energy - BLOW.energy);
  const tiles = tilesOfWork(c, key);
  const mid = tiles[0];
  noise(c, c.tile, w.wall ? BREAK_NOISE.wall : metal ? BREAK_NOISE.metal : BREAK_NOISE.wood);
  c.struck = arm?.[0] ?? 0;
  c.wearWeapon(arm);
  c.breakLeft -= rate;
  c.events.push({ type: 'chop', tile: mid, metal, item: c.struck });
  if (c.breakLeft > 0) {
    s.searchLeft = BLOW.every;
    return false;
  }
  s.search = '';
  finish(c, key, w.sal, tiles);
  return true;
}

/** The work done. */
function finish(c: City, key: string, sal: Salvage | null, tiles: number[]) {
  const s = c.state;
  const d = s.district;
  const what = key.slice(1);
  if (what.startsWith('w')) {
    (s.holes[d] ??= []).push(tiles[0]);
    c.holed();
    return void c.events.push({ type: 'wrecked', what: 'wall', tile: tiles[0] });
  }
  const car = what.startsWith('c');
  // (What was in it comes out with it: drawn now if it was never looked into, as a search would have.)
  const boxKey = what;
  const inside: Stack[] = [...c.fillBox(boxKey)].filter((st) => st[0]).map((st) => [st[0], st[1]]);
  const gives: Stack[] = (sal?.gives ?? []).map(([id, n]) => [cityItemNumber(id), n]);
  let pile: number;
  if (car) {
    (s.stripped[d] ??= []).push(Number(what.slice(1)));
    // (A car stays where it stands, emptied: what came of it at the player's feet.)
    c.emptyBox(boxKey);
    pile = c.tile;
  } else {
    (s.broken[d] ??= []).push(Number(what));
    c.forgetBox(boxKey);
    // (Where it stood, on its tile beside the player: a bed's far end is out of reach.)
    const here = c.tile;
    pile =
      tiles.find((t) => Math.abs((t % MAP_W) - (here % MAP_W)) + Math.abs(Math.floor(t / MAP_W) - Math.floor(here / MAP_W)) === 1) ??
      tiles[0];
    c.unprop(Number(what));
  }
  for (const [item, n] of [...inside, ...gives]) c.drop(pile, item, n);
  c.events.push({ type: 'wrecked', what: car ? 'car' : 'prop', tile: pile, prop: car ? null : c.district.props[Number(what)].kind });
  c.openPile(pile);
}
