import { MAP_H, MAP_W } from '../../sim/world/World';
import { isBuilding, type LotUse } from '../content/districts';
import { SEARCHED } from '../content/loot';
import { decoSolid, type District, type Gate } from '../gen/district';
import { CITY_N, gateOpen, LANES, laneAt, neighbour, OPPOSITE, ROAD_W, SIDE, streamOf, type CityPlan } from '../gen/plan';
import { PLACES, TUNNEL } from '../gen/tunnel';
import { BLEED } from '../content/dead';
import { lotPanes } from '../content/windows';
import type { City } from './City';

/**
 * The crowbar and the bolt cutters (2.58), a part of the city's simulation: some buildings are locked
 * (nobody has been in: the dead neither, and what's inside was never picked over) until a crowbar
 * forces a door; where a street runs up to the army's fence on both sides of a border, bolt cutters
 * open a way through, a crossing as any checkpoint is from then on. A city begun before them has no
 * locked building (its `locks` is 0); the fences can be cut in any.
 */
export const TOOLS = {
  /** One building in so many is locked (of those that can be; one at least in a district with three such). */
  lockOneIn: 8,
  /** Steps to force a door, to cut a fence; both are heard as a blow is. */
  forceSteps: 80,
  cutSteps: 100,
  /** A locked building's furniture: this many draws more, and a draw in a thousand that finds nothing. */
  moreDraws: 1,
  emptyDraws: 450,
  /** 2.61: steps to break a chained building's window and climb in; how far it's heard (tiles); what bare hands bleed for it. */
  paneSteps: 24,
  paneNoise: 14,
  paneCut: 6,
} as const;

/** The buildings that may be locked: never a landmark. */
const LOCKABLE: readonly LotUse[] = ['house', 'shop', 'office', 'warehouse', 'clinic', 'garage'];

const N = MAP_W * MAP_H;

export function freshTools() {
  return {
    locks: 1,
    forced: {} as Record<string, number[]>,
    cuts: [] as number[],
    outfit: 0,
    snare: 0,
    bleed: 0,
    panes: {} as Record<string, number[]>,
    rev: CITY_REV,
    cleared: [] as number[],
  };
}

/**
 * 2.64: the rules a city was begun under, so one under way keeps what was drawn for it: 0 before 2.64; 1 a first day that works
 * (boards and bats about, a bat with the radio); 2 (2.66) axes and sledgehammers where they'd be kept.
 */
export const CITY_REV = 2;

/** A save's fields made sound before the city is built from it (one from before them: no locked building). */
export function soundTools(st: {
  locks?: unknown;
  forced?: unknown;
  cuts?: unknown;
  outfit?: unknown;
  snare?: unknown;
  bleed?: unknown;
  panes?: unknown;
  rev?: unknown;
  cleared?: unknown;
}) {
  // (2.65: [the dusk they were put down since, then how many in each place]; anything else, none.)
  const cl = st.cleared;
  st.cleared =
    Array.isArray(cl) && cl.length === PLACES + 1 && cl.every((n) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 1e6)
      ? cl
      : [];
  if (!Number.isInteger(st.rev) || (st.rev as number) < 0 || (st.rev as number) > CITY_REV) st.rev = 0;
  if (st.outfit !== 1) st.outfit = 0;
  if (!Number.isInteger(st.bleed) || (st.bleed as number) < 0 || (st.bleed as number) > BLEED.most) st.bleed = 0;
  const panes: Record<string, number[]> = {};
  if (typeof st.panes === 'object' && st.panes && !Array.isArray(st.panes))
    for (const [d, list] of Object.entries(st.panes as Record<string, unknown>))
      if (/^[0-8]$/.test(d) && Array.isArray(list))
        panes[d] = [...new Set(list.filter((k): k is number => Number.isInteger(k) && k >= 0 && k < N))];
  st.panes = panes;
  if (!Number.isInteger(st.snare) || (st.snare as number) < 0) st.snare = 0;
  if (st.locks !== 1) st.locks = 0;
  const forced: Record<string, number[]> = {};
  if (typeof st.forced === 'object' && st.forced && !Array.isArray(st.forced))
    for (const [d, list] of Object.entries(st.forced as Record<string, unknown>))
      if (/^[0-8]$/.test(d) && Array.isArray(list))
        forced[d] = [...new Set(list.filter((k): k is number => Number.isInteger(k) && k >= 0 && k < 255))];
  st.forced = forced;
  st.cuts = Array.isArray(st.cuts)
    ? [...new Set(st.cuts.filter((k): k is number => Number.isInteger(k) && k >= 0 && k < CITY_N * 4 * LANES))]
    : [];
}

/** The buildings of a district locked when the city began (their lots' numbers), from the seed and where the story's things are. */
export function lockedLots(c: City, d: number): number[] {
  if (!c.state.locks || d === TUNNEL) return [];
  const dist = c.baseOf(d);
  const P = c.story;
  // (Never where the story has something, a note lies, a survivor lives or a way out begins.)
  const taken = new Set<number>();
  const lotOfProp = (prop: number) => dist.lotAt[dist.props[prop].z * MAP_W + dist.props[prop].x] - 1;
  for (const sp of [...P.things, ...P.notes]) if (sp.district === d) taken.add(lotOfProp(sp.prop));
  for (const p of P.people) if (p.district === d) taken.add(p.lot);
  P.wayDistrict.forEach((w, k) => w === d && taken.add(P.wayLot[k]));
  const can: number[] = [];
  dist.lots.forEach((l, k) => {
    if (isBuilding(l.use) && LOCKABLE.includes(l.use) && l.doors.length && !taken.has(k)) can.push(k);
  });
  const n = Math.max(can.length >= 3 ? 1 : 0, Math.floor(can.length / TOOLS.lockOneIn));
  const rnd = streamOf(c.plan.seed, 7700 + d);
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(...can.splice(Math.floor(rnd() * can.length), 1));
  return out.sort((a, b) => a - b);
}

/**
 * 2.59: somebody's clothes, in a house of the district the city starts in (not a chained one, not furniture the story uses):
 * found, the prison's orange comes off. To look at only: nothing in the rules reads it.
 */
export function clothesSpot(c: City): number {
  const d = c.plan.start;
  const dist = c.baseOf(d);
  const shut = new Set(lockedLots(c, d));
  const taken = new Set([...c.story.things, ...c.story.notes].filter((sp) => sp.district === d).map((sp) => sp.prop));
  const can: number[] = [];
  dist.props.forEach((p, k) => {
    const lot = dist.lotAt[p.z * MAP_W + p.x] - 1;
    if (SEARCHED[p.kind] === undefined || p.kind === 'bin' || lot < 0 || dist.lots[lot].use !== 'house' || shut.has(lot) || taken.has(k))
      return;
    can.push(k);
  });
  return can.length ? can[Math.floor(streamOf(c.plan.seed, 9500)() * can.length)] : -1;
}

/** A piece of furniture looked into: the clothes, if they lie there. */
export function foundClothes(c: City, prop: number) {
  const s = c.state;
  if (s.outfit || s.district !== c.plan.start || prop !== c.clothes) return;
  s.outfit = 1;
  c.events.push({ type: 'clothes' });
}

/** A fence cut, as a number: the district it was cut from, the side and the lane. */
export const cutCode = (d: number, side: number, lane: number) => (d * 4 + side) * LANES + lane;

/** The two border tiles of a lane's street on a district's side, and the four street tiles in from them. */
function laneTiles(plan: CityPlan, d: number, side: number, lane: number): { border: [number, number]; inner: number[] } {
  const a = laneAt(plan, d, side, lane);
  const tile = (along: number, depth: number) =>
    side === SIDE.N
      ? depth * MAP_W + along
      : side === SIDE.S
        ? (MAP_H - 1 - depth) * MAP_W + along
        : side === SIDE.W
          ? along * MAP_W + depth
          : along * MAP_W + (MAP_W - 1 - depth);
  const inner: number[] = [];
  for (let depth = 1; depth <= 2; depth++) for (let w = 0; w < ROAD_W; w++) inner.push(tile(a + w, depth));
  return { border: [tile(a, 0), tile(a + 1, 0)], inner };
}

/** A place where the fence can be cut: the side and the lane, its tiles on the border, and the district beyond. */
export interface CutSpot {
  side: number;
  lane: number;
  tiles: [number, number];
  to: number;
}

/** Where a district's fence can still be cut: a street up to it on this side and on the neighbour's, clear of what stands on them. */
export function cutSpots(c: City, d: number): CutSpot[] {
  if (d === TUNNEL) return [];
  const out: CutSpot[] = [];
  const clear = (dist: District, tiles: number[]) =>
    tiles.every((i) => dist.rows[Math.floor(i / MAP_W)][i % MAP_W] === ',' && !decoSolid(dist.deco[i]));
  for (let side = 0; side < 4; side++) {
    const to = neighbour(d, side);
    if (to < 0) continue;
    for (let lane = 0; lane < LANES; lane++) {
      if (gateOpen(c.plan, d, side, lane) || isCut(c, d, side, lane)) continue;
      const here = laneTiles(c.plan, d, side, lane);
      const there = laneTiles(c.plan, to, OPPOSITE[side], lane);
      const mine = c.baseOf(d);
      // (The fence itself: not the city's wall, not the sea.)
      if (!here.border.every((i) => mine.rows[Math.floor(i / MAP_W)][i % MAP_W] === '=')) continue;
      if (clear(mine, here.inner) && clear(c.baseOf(to), there.inner)) out.push({ side, lane, tiles: here.border, to });
    }
  }
  return out;
}

/** Whether a district's side is cut at a lane (from either side of the border). */
export function isCut(c: City, d: number, side: number, lane: number): boolean {
  const to = neighbour(d, side);
  return c.state.cuts.includes(cutCode(d, side, lane)) || (to >= 0 && c.state.cuts.includes(cutCode(to, OPPOSITE[side], lane)));
}

/** Whether two districts side by side are joined: by a checkpoint, or by a fence cut. */
export function joined(c: City, d: number, side: number): boolean {
  if (c.plan.gates[d][side]) return true;
  for (let lane = 0; lane < LANES; lane++) if (isCut(c, d, side, lane)) return true;
  return false;
}

/** A district as the generator made it, with the fences cut so far: the street runs through, a crossing like any other. */
export function withCuts(c: City, base: District): District {
  const d = base.index;
  if (d === TUNNEL || !c.state.cuts.length) return base;
  const rows = base.rows.map((r) => r.split(''));
  const gates: Gate[] = [...base.gates];
  for (let side = 0; side < 4; side++) {
    const to = neighbour(d, side);
    if (to < 0) continue;
    for (let lane = 0; lane < LANES; lane++) {
      if (gateOpen(c.plan, d, side, lane) || !isCut(c, d, side, lane)) continue;
      const { border } = laneTiles(c.plan, d, side, lane);
      for (const i of border) rows[Math.floor(i / MAP_W)][i % MAP_W] = ',';
      gates.push({ side, lane, tiles: border, to, cut: true });
    }
  }
  if (gates.length === base.gates.length) return base;
  return { ...base, rows: rows.map((r) => r.join('')), gates };
}

/** A save's cuts kept only where a fence could be cut (the map changed under an old save, a damaged one). */
export function soundCuts(c: City) {
  const all = c.state.cuts;
  c.state.cuts = [];
  for (const code of all) {
    const lane = code % LANES;
    const side = Math.floor(code / LANES) % 4;
    const d = Math.floor(code / LANES / 4);
    if (cutSpots(c, d).some((s) => s.side === side && s.lane === lane)) c.state.cuts.push(code);
  }
}

/** 2.61: per tile of a district, 1 on a window of a building still locked (broken, it is climbed in by: the building forced). */
export function lockedPanes(c: City, d: number, locked: Uint8Array) {
  const out = new Uint8Array(N);
  const dist = c.baseOf(d);
  for (const lot of lockedLots(c, d)) {
    if (!dist.lots[lot].doors.some((i) => locked[i])) continue;
    // (Only glass: boards and shutters are nailed and locked from inside.)
    for (const p of lotPanes(dist, lot)) if (p.look === 'glass' || p.look === 'band') out[p.z * MAP_W + p.x] = 1;
  }
  return out;
}

/** Per tile of a district: 1 where a locked building's door stands still locked. */
export function lockedDoors(c: City, d: number) {
  const out = new Uint8Array(N);
  const forced = c.state.forced[d] ?? [];
  const dist = c.baseOf(d);
  for (const lot of lockedLots(c, d)) if (!forced.includes(lot)) for (const i of dist.lots[lot].doors) out[i] = 1;
  return out;
}
