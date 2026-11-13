import { DISTRICTS, ESCAPE_KINDS, KINDS, type DistrictKind } from '../content/districts';
import { mix32, randomFrom } from '../../sim/rng';

/**
 * A city's plan (C1), from its seed alone: a 3 × 3 grid of districts (one of each kind), which
 * neighbours are joined and where their streets cross. Each district is its own 64 × 64 map
 * (city/gen/district.ts); a street that crosses a border does so at the same tiles on both sides
 * (the "lanes": three per column and per row of the grid, shared by every district on it).
 * Pure: the same seed gives the same plan on every device.
 */
export const CITY_W = 3;
export const CITY_H = 3;
export const CITY_N = CITY_W * CITY_H;
/** Streets a district can have each way. */
export const LANES = 3;
/** A street's width in tiles. */
export const ROAD_W = 2;

/** A district's sides, clockwise from the north; `OPPOSITE[s]` faces it. */
export const SIDE = { N: 0, E: 1, S: 2, W: 3 } as const;
export const OPPOSITE = [2, 3, 0, 1] as const;
const DX = [0, 1, 0, -1] as const;
const DZ = [-1, 0, 1, 0] as const;

export interface CityPlan {
  seed: number;
  /** Each district's kind, by its place (gz * 3 + gx), and its name. */
  kinds: DistrictKind[];
  names: string[];
  /** Where the player starts (the suburbs). */
  start: number;
  /** The first tile of each lane's street: north–south streets per grid column, east–west per grid row. */
  lanesX: number[][];
  lanesZ: number[][];
  /** Per district and side: the lanes that cross to the neighbour (bit k = lane k); 0 where the way is sealed. */
  gates: number[][];
  /** The docks' side on the sea (a SIDE), on the city's edge. */
  sea: number;
}

export const districtX = (d: number) => d % CITY_W;
export const districtZ = (d: number) => Math.floor(d / CITY_W);

/** The district past a side (-1: the city's edge). */
export function neighbour(d: number, side: number): number {
  const x = districtX(d) + DX[side];
  const z = districtZ(d) + DZ[side];
  return x < 0 || z < 0 || x >= CITY_W || z >= CITY_H ? -1 : z * CITY_W + x;
}

/** A seeded stream for one purpose (`what`), apart from every other. */
export const streamOf = (seed: number, what: number) => randomFrom(mix32((seed ^ Math.imul(what + 1, 0x9e3779b1)) | 0));

/** `list` shuffled in place by `rnd` (Fisher–Yates). */
export function shuffle<T>(list: T[], rnd: () => number): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function cityPlan(seed: number): CityPlan {
  const rnd = streamOf(seed, 0);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)];
  // Downtown in the middle, the suburbs (the start) in a corner; the three ways out never beside the start.
  const kinds = new Array<DistrictKind>(CITY_N);
  const centre = 4;
  kinds[centre] = 'downtown';
  const start = pick([0, 2, 6, 8]);
  kinds[start] = 'suburbs';
  const beside = [0, 1, 2, 3].map((s) => neighbour(start, s)).filter((d) => d >= 0);
  const calm = shuffle(
    KINDS.filter((k) => k !== 'downtown' && k !== 'suburbs' && !ESCAPE_KINDS.includes(k)),
    rnd,
  );
  for (const d of beside) kinds[d] = calm.pop()!;
  const rest = shuffle([...calm, ...ESCAPE_KINDS], rnd);
  for (let d = 0; d < CITY_N; d++) kinds[d] ??= rest.pop()!;
  // The lanes: three streets each way, a little off the same places in every column and row.
  const lanes = () => [11, 30, 49].map((at) => at + Math.floor(rnd() * 5) - 2);
  const lanesX = Array.from({ length: CITY_W }, lanes);
  const lanesZ = Array.from({ length: CITY_H }, lanes);
  // Which neighbours are joined: a tree over the nine (so every district can be walked to), and half the other borders.
  const borders: Array<[number, number]> = [];
  for (let d = 0; d < CITY_N; d++) for (const s of [SIDE.E, SIDE.S]) if (neighbour(d, s) >= 0) borders.push([d, s]);
  shuffle(borders, rnd);
  const group = Array.from({ length: CITY_N }, (_, d) => d);
  const find = (d: number): number => (group[d] === d ? d : (group[d] = find(group[d])));
  const gates = Array.from({ length: CITY_N }, () => [0, 0, 0, 0]);
  for (const [d, s] of borders) {
    const n = neighbour(d, s);
    const joined = find(d) === find(n);
    if (joined && rnd() < 0.5) continue;
    group[find(d)] = find(n);
    // One street across, or two.
    let mask = 1 << Math.floor(rnd() * LANES);
    if (rnd() < 0.4) mask |= 1 << Math.floor(rnd() * LANES);
    gates[d][s] = mask;
    gates[n][OPPOSITE[s]] = mask;
  }
  const docks = kinds.indexOf('docks');
  const sea = pick([0, 1, 2, 3].filter((s) => neighbour(docks, s) < 0));
  const names = kinds.map((k) => pick(DISTRICTS[k].names));
  return { seed, kinds, names, start, lanesX, lanesZ, gates, sea };
}

/** Whether lane `k` crosses a district's side. */
export const gateOpen = (plan: CityPlan, d: number, side: number, k: number) => ((plan.gates[d][side] >> k) & 1) === 1;

/** The first tile (along the border) of lane `k`'s street on a district's side. */
export const laneAt = (plan: CityPlan, d: number, side: number, k: number) =>
  side === SIDE.N || side === SIDE.S ? plan.lanesX[districtX(d)][k] : plan.lanesZ[districtZ(d)][k];
