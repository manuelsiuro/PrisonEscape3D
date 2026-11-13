import { PROPS, type PropKind, type PropPlacement } from '../../content/props';
import { MAP_H, MAP_W, neighbours4 } from '../../sim/world/grid';
import { DISTRICTS, isBuilding, type DistrictKind, type LotUse } from '../content/districts';
import { districtX, districtZ, gateOpen, LANES, neighbour, ROAD_W, SIDE, streamOf, type CityPlan } from './plan';

/**
 * One district of a city (C1), generated from the city's plan: a 64 × 64 picture in the prisons'
 * own map characters (so the same World, paths, sight and view take it), its furniture, what stands
 * on its streets, and its lots (each building or open ground, with its use). Streets run along the
 * plan's lanes, so they meet the neighbour's at the border; the blocks between them are filled by the
 * district's kind. Pure: the same plan and place give the same district on every device.
 */

/** What stands on a tile, drawn by the city's view (city/render). Never renumber: the view and tests name them. */
export const DECO = {
  NONE: 0,
  /** The rest of something longer than a tile (a car, the bus): solid, drawn by its first tile. */
  PART: 1,
  CAR: 2,
  WRECK: 3,
  RUBBLE: 4,
  SANDBAGS: 5,
  TREE: 6,
  DEAD_TREE: 7,
  BUSH: 8,
  CRATES: 9,
  DUMPSTER: 10,
  /** The prison bus the player came in on, on its side across the street. */
  BUS: 11,
  BARREL: 12,
  TYRES: 13,
  CONE: 14,
} as const;

/** What nobody walks through, and what nobody sees through. */
const SOLID = new Set<number>([
  DECO.PART,
  DECO.CAR,
  DECO.WRECK,
  DECO.RUBBLE,
  DECO.SANDBAGS,
  DECO.TREE,
  DECO.DEAD_TREE,
  DECO.CRATES,
  DECO.DUMPSTER,
  DECO.BUS,
  DECO.BARREL,
  DECO.TYRES,
]);
const VEIL = new Set<number>([DECO.BUS, DECO.TREE, DECO.CRATES, DECO.DUMPSTER]);
export const decoSolid = (k: number) => SOLID.has(k);

/** A building (its walls' rectangle) or a piece of open ground. */
export interface Lot {
  use: LotUse;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** A building's street doors (tiles). */
  doors: number[];
}

/** Where a street crosses to the next district: its two tiles on the border. */
export interface Gate {
  side: number;
  lane: number;
  tiles: [number, number];
  to: number;
}

export interface District {
  index: number;
  kind: DistrictKind;
  /** The ground floor's picture, in the prisons' map characters (sim/world/tiles.ts). */
  rows: string[];
  props: PropPlacement[];
  /** Per tile: what stands there (DECO), and which way it's turned (0: along x, 1: along z). */
  deco: Uint8Array;
  turn: Uint8Array;
  lots: Lot[];
  /** Per tile: its lot's number + 1 (0: the street). */
  lotAt: Uint8Array;
  gates: Gate[];
  /** Where the player comes to (the start's: beside the bus; elsewhere: the middle of a street). */
  spawn: { x: number; z: number };
}

const N = MAP_W * MAP_H;
const at = (x: number, z: number) => z * MAP_W + x;
/** The sea's depth in tiles on the docks' side. */
const SEA = 7;
/** A lot no wider than this is one building; a wider one is cut in two by an alley. */
const LOT_MAX = 11;
const LOT_MIN = 5;

const FLOOR: Partial<Record<LotUse, string>> = {
  house: 'w',
  shop: ':',
  office: '_',
  warehouse: '_',
  clinic: ':',
  garage: '_',
  station: '_',
  tower: ':',
  factory: '_',
  hospital: ':',
  boathouse: 'w',
  rangers: 'w',
  mall: ':',
  police: '_',
  metro: '_',
};

/** What a building is furnished with (most wanted first; a bed is two tiles long). */
const FURNITURE: Partial<Record<LotUse, readonly PropKind[]>> = {
  house: ['bed', 'desk', 'table', 'shelf', 'toilet', 'chair', 'bin'],
  shop: ['counter', 'shelf', 'shelf', 'freezer', 'counter', 'bin', 'shelf'],
  office: ['desk', 'deskChair', 'shelf', 'desk', 'bin', 'table', 'chair'],
  warehouse: ['shelf', 'crate', 'crate', 'workbench', 'shelf', 'bin', 'crate'],
  clinic: ['bed', 'shelf', 'desk', 'bed', 'toilet', 'bin', 'chair'],
  garage: ['workbench', 'shelf', 'bin', 'crate', 'generator'],
  station: ['counter', 'shelf', 'freezer', 'bin', 'workbench'],
  tower: ['desk', 'deskChair', 'shelf', 'table', 'desk', 'bin', 'chair', 'counter'],
  factory: ['workbench', 'press', 'shelf', 'crate', 'generator', 'crate', 'bin', 'shelf'],
  hospital: ['bed', 'bed', 'shelf', 'desk', 'bed', 'toilet', 'counter', 'freezer', 'bin', 'chair'],
  boathouse: ['workbench', 'shelf', 'crate', 'netFrame', 'bin'],
  rangers: ['desk', 'bed', 'shelf', 'table', 'workbench', 'bin'],
  mall: ['counter', 'shelf', 'shelf', 'freezer', 'counter', 'shelf', 'table', 'bin', 'vending'],
  police: ['desk', 'deskChair', 'shelf', 'bed', 'controlDesk', 'bin', 'bed', 'table'],
  metro: ['counter', 'bench', 'vending', 'bin', 'shelf', 'bench'],
};

/** Most of a landmark's block is its building: up to this many tiles each way. */
const LANDMARK_MAX = 22;

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}
const wide = (r: Rect) => r.x1 - r.x0 + 1;
const deep = (r: Rect) => r.z1 - r.z0 + 1;

export function generateDistrict(plan: CityPlan, d: number): District {
  const kind = plan.kinds[d];
  const spec = DISTRICTS[kind];
  const rnd = streamOf(plan.seed, 100 + d);
  const int = (n: number) => Math.floor(rnd() * n);
  const g: string[] = new Array<string>(N).fill('a');
  const deco = new Uint8Array(N);
  const turn = new Uint8Array(N);
  const lotAt = new Uint8Array(N);
  /** Tiles that must stay open: doors' thresholds, the gates' approaches. */
  const keep = new Uint8Array(N);
  /** Furniture nobody walks through, and every tile a piece stands on (a chair is stepped round, not through a wall of them). */
  const propAt = new Uint8Array(N);
  const taken = new Uint8Array(N);
  const props: PropPlacement[] = [];
  const lots: Lot[] = [];
  const gates: Gate[] = [];
  const set = (x: number, z: number, c: string) => (g[at(x, z)] = c);
  const fill = (r: Rect, c: string) => {
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) g[at(x, z)] = c;
  };
  const walkable = (i: number) => {
    const c = g[i];
    return c !== '#' && c !== '@' && c !== '=' && c !== '~' && !decoSolid(deco[i]) && !propAt[i];
  };

  // ------------------------------------------------------------------ the border and the sea
  const sea = kind === 'docks' ? plan.sea : -1;
  const area: Rect = { x0: 1, z0: 1, x1: MAP_W - 2, z1: MAP_H - 2 };
  for (let s = 0; s < 4; s++) {
    const c = neighbour(d, s) < 0 ? '@' : '=';
    for (let k = 0; k < MAP_W; k++) {
      if (s === SIDE.N) set(k, 0, c);
      else if (s === SIDE.S) set(k, MAP_H - 1, c);
      else if (s === SIDE.W) set(0, k, g[at(0, k)] === '@' ? '@' : c);
      else set(MAP_W - 1, k, g[at(MAP_W - 1, k)] === '@' ? '@' : c);
    }
  }
  // (The city's wall holds the corners where it meets a sector fence.)
  for (const [x, z, a, b] of [
    [0, 0, SIDE.N, SIDE.W],
    [MAP_W - 1, 0, SIDE.N, SIDE.E],
    [0, MAP_H - 1, SIDE.S, SIDE.W],
    [MAP_W - 1, MAP_H - 1, SIDE.S, SIDE.E],
  ] as const)
    if (neighbour(d, a) < 0 || neighbour(d, b) < 0) set(x, z, '@');
  if (sea === SIDE.N) {
    fill({ x0: 0, z0: 0, x1: MAP_W - 1, z1: SEA }, '~');
    area.z0 = SEA + 1;
  } else if (sea === SIDE.S) {
    fill({ x0: 0, z0: MAP_H - 1 - SEA, x1: MAP_W - 1, z1: MAP_H - 1 }, '~');
    area.z1 = MAP_H - 2 - SEA;
  } else if (sea === SIDE.W) {
    fill({ x0: 0, z0: 0, x1: SEA, z1: MAP_H - 1 }, '~');
    area.x0 = SEA + 1;
  } else if (sea === SIDE.E) {
    fill({ x0: MAP_W - 1 - SEA, z0: 0, x1: MAP_W - 1, z1: MAP_H - 1 }, '~');
    area.x1 = MAP_W - 2 - SEA;
  }

  // ------------------------------------------------------------------ the streets
  /** The lanes with a street, each way: every one that crosses a border, and most of the others (two at least). */
  const streets = (a: number, b: number): number[] => {
    const on = Array.from({ length: LANES }, (_, k) => gateOpen(plan, d, a, k) || gateOpen(plan, d, b, k) || rnd() < 0.75);
    for (let k = 0; on.filter(Boolean).length < 2; k++) on[k] = true;
    return on.flatMap((yes, k) => (yes ? [k] : []));
  };
  const lanesX = streets(SIDE.N, SIDE.S);
  const lanesZ = streets(SIDE.W, SIDE.E);
  const roadX = lanesX.map((k) => plan.lanesX[districtX(d)][k]);
  const roadZ = lanesZ.map((k) => plan.lanesZ[districtZ(d)][k]);
  lanesX.forEach((k, n) => {
    const x = roadX[n];
    const north = gateOpen(plan, d, SIDE.N, k);
    const south = gateOpen(plan, d, SIDE.S, k);
    for (let z = north ? 0 : area.z0; z <= (south ? MAP_H - 1 : area.z1); z++) for (let w = 0; w < ROAD_W; w++) set(x + w, z, ',');
    if (north) gates.push({ side: SIDE.N, lane: k, tiles: [at(x, 0), at(x + 1, 0)], to: neighbour(d, SIDE.N) });
    if (south) gates.push({ side: SIDE.S, lane: k, tiles: [at(x, MAP_H - 1), at(x + 1, MAP_H - 1)], to: neighbour(d, SIDE.S) });
    for (let w = 0; w < ROAD_W; w++) {
      if (north) for (let z = 0; z < 4; z++) keep[at(x + w, z)] = 1;
      if (south) for (let z = MAP_H - 4; z < MAP_H; z++) keep[at(x + w, z)] = 1;
    }
  });
  lanesZ.forEach((k, n) => {
    const z = roadZ[n];
    const west = gateOpen(plan, d, SIDE.W, k);
    const east = gateOpen(plan, d, SIDE.E, k);
    for (let x = west ? 0 : area.x0; x <= (east ? MAP_W - 1 : area.x1); x++) for (let w = 0; w < ROAD_W; w++) set(x, z + w, ',');
    if (west) gates.push({ side: SIDE.W, lane: k, tiles: [at(0, z), at(0, z + 1)], to: neighbour(d, SIDE.W) });
    if (east) gates.push({ side: SIDE.E, lane: k, tiles: [at(MAP_W - 1, z), at(MAP_W - 1, z + 1)], to: neighbour(d, SIDE.E) });
    for (let w = 0; w < ROAD_W; w++) {
      if (west) for (let x = 0; x < 4; x++) keep[at(x, z + w)] = 1;
      if (east) for (let x = MAP_W - 4; x < MAP_W; x++) keep[at(x, z + w)] = 1;
    }
  });

  // ------------------------------------------------------------------ the blocks between them
  const cuts = (roads: number[], lo: number, hi: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    let from = lo;
    for (const r of [...roads].sort((a, b) => a - b)) {
      if (r - 1 >= from) out.push([from, r - 1]);
      from = r + ROAD_W;
    }
    if (hi >= from) out.push([from, hi]);
    return out;
  };
  /** Each block's inside (its pavement left round it), the largest first. */
  const blocks: Rect[] = [];
  for (const [z0, z1] of cuts(roadZ, area.z0, area.z1))
    for (const [x0, x1] of cuts(roadX, area.x0, area.x1)) {
      const r = { x0: x0 + 1, z0: z0 + 1, x1: x1 - 1, z1: z1 - 1 };
      if (wide(r) >= LOT_MIN && deep(r) >= LOT_MIN) blocks.push(r);
    }
  const size = (r: Rect) => wide(r) * deep(r);
  const largest = blocks.reduce((best, r, k) => (size(r) > size(blocks[best]) ? k : best), 0);

  const addLot = (use: LotUse, r: Rect): Lot => {
    const lot: Lot = { use, ...r, doors: [] };
    lots.push(lot);
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) lotAt[at(x, z)] = lots.length;
    return lot;
  };

  /** Whether a tile can be stood on without cutting its neighbours off from each other (looked at in its 3 × 3 only: never wrong, at times too careful). */
  const canBlock = (i: number): boolean => {
    if (keep[i] || !walkable(i)) return false;
    const x = i % MAP_W;
    const z = Math.floor(i / MAP_W);
    if (x < 1 || z < 1 || x > MAP_W - 2 || z > MAP_H - 2) return false;
    // The eight round it, clockwise from the north; a corner counts only with an open side next to it.
    const ring = [i - MAP_W, i - MAP_W + 1, i + 1, i + MAP_W + 1, i + MAP_W, i + MAP_W - 1, i - 1, i - MAP_W - 1].map(walkable);
    for (let k = 1; k < 8; k += 2) ring[k] = ring[k] && ring[k - 1] && ring[(k + 1) % 8];
    let runs = 0;
    for (let k = 0; k < 8; k++) if (ring[k] && !ring[(k + 7) % 8]) runs++;
    return runs <= 1;
  };
  const stand = (i: number, what: number, way = 0): boolean => {
    if (!canBlock(i)) return false;
    deco[i] = what;
    turn[i] = way;
    return true;
  };
  /** Something two or three tiles long, along x (`way` 0) or z: all of it or none. */
  const standLong = (i: number, what: number, way: number, len: number): boolean => {
    const step = way ? MAP_W : 1;
    const placed: number[] = [];
    for (let k = 0; k < len; k++) {
      const j = i + k * step;
      if (j >= N || (way === 0 && Math.floor(j / MAP_W) !== Math.floor(i / MAP_W)) || !stand(j, k ? DECO.PART : what, way)) {
        for (const p of placed) deco[p] = DECO.NONE;
        return false;
      }
      placed.push(j);
    }
    return true;
  };

  // ------------------------------------------------------------------ buildings
  /** Inner walls: a room wider than six tiles is cut in two, a gap left in the wall, and each half again. */
  const partition = (r: Rect, floor: string, depth: number) => {
    const w = wide(r);
    const h = deep(r);
    if (depth > 2 || (w < 7 && h < 7) || rnd() < 0.2) return;
    const across = w >= h;
    const span = across ? w : h;
    if (span < 7) return;
    const c = (across ? r.x0 : r.z0) + 3 + int(span - 6);
    const line: number[] = [];
    for (let k = across ? r.z0 : r.x0; k <= (across ? r.z1 : r.x1); k++) line.push(across ? at(c, k) : at(k, c));
    // (Never against a gap already left in the wall it meets.)
    if (line.some((i) => keep[i] || neighbours4(i).some(([j, ok]) => ok && keep[j] && g[j] !== '#'))) return;
    for (const i of line) g[i] = '#';
    const gap = line[1 + int(line.length - 2)];
    g[gap] = rnd() < 0.5 ? 'y' : floor;
    keep[gap] = 1;
    for (const [j, ok] of neighbours4(gap)) if (ok && g[j] !== '#') keep[j] = 1;
    if (across) {
      partition({ ...r, x1: c - 1 }, floor, depth + 1);
      partition({ ...r, x0: c + 1 }, floor, depth + 1);
    } else {
      partition({ ...r, z1: c - 1 }, floor, depth + 1);
      partition({ ...r, z0: c + 1 }, floor, depth + 1);
    }
  };

  const building = (use: LotUse, r: Rect) => {
    const floor = FLOOR[use] ?? '_';
    const lot = addLot(use, r);
    fill(r, '#');
    const inside = { x0: r.x0 + 1, z0: r.z0 + 1, x1: r.x1 - 1, z1: r.z1 - 1 };
    fill(inside, floor);
    partition(inside, floor, 0);
    // Street doors: in a wall with floor behind and open ground before it; a long building has two.
    const spots: number[] = [];
    for (let x = r.x0 + 1; x < r.x1; x++) spots.push(at(x, r.z0), at(x, r.z1));
    for (let z = r.z0 + 1; z < r.z1; z++) spots.push(at(r.x0, z), at(r.x1, z));
    const outOf = (i: number) => {
      const x = i % MAP_W;
      const z = Math.floor(i / MAP_W);
      return z === r.z0 ? i - MAP_W : z === r.z1 ? i + MAP_W : x === r.x0 ? i - 1 : i + 1;
    };
    const good = spots.filter((i) => {
      const out = outOf(i);
      const into = i + (i - out);
      return g[into] === floor && (g[out] === 'a' || g[out] === ',' || g[out] === '.' || g[out] === 'd') && !deco[out];
    });
    const want = wide(r) + deep(r) > 26 ? 2 : 1;
    for (let n = 0; n < want && good.length; n++) {
      // (The second one on another wall where there is one.)
      const first = lot.doors[0];
      const far =
        n && first !== undefined
          ? good.filter((i) => Math.abs((i % MAP_W) - (first % MAP_W)) + Math.abs(Math.floor(i / MAP_W) - Math.floor(first / MAP_W)) > 6)
          : good;
      const list = far.length ? far : good;
      const i = list[int(list.length)];
      g[i] = 'y';
      lot.doors.push(i);
      keep[i] = keep[outOf(i)] = keep[i + (i - outOf(i))] = 1;
      good.splice(good.indexOf(i), 1);
    }
    // Furniture against the walls, most wanted first, about one piece to eight tiles of floor.
    const want2 = FURNITURE[use] ?? [];
    const walls: number[] = [];
    for (let z = inside.z0; z <= inside.z1; z++)
      for (let x = inside.x0; x <= inside.x1; x++) {
        const i = at(x, z);
        if (g[i] === floor && neighbours4(i).some(([j]) => g[j] === '#')) walls.push(i);
      }
    for (let k = walls.length - 1; k > 0; k--) {
      const j = int(k + 1);
      [walls[k], walls[j]] = [walls[j], walls[k]];
    }
    const pieces = Math.max(2, Math.floor((wide(inside) * deep(inside)) / 8));
    for (let n = 0; n < pieces && walls.length; n++) {
      const kindOf = want2[n % Math.max(1, want2.length)];
      if (!kindOf) break;
      for (let tries = 0; tries < 6 && walls.length; tries++) {
        const i = walls.pop()!;
        if (taken[i] || !canBlock(i)) continue;
        const x = i % MAP_W;
        const z = Math.floor(i / MAP_W);
        if (kindOf === 'bed') {
          // (Two tiles, head to the north: the one below must be free floor too.)
          const below = i + MAP_W;
          propAt[i] = 1;
          if (g[below] !== floor || taken[below] || !canBlock(below)) {
            propAt[i] = 0;
            continue;
          }
          propAt[below] = taken[i] = taken[below] = 1;
          props.push({ kind: 'bed', x, z, d: 2 });
        } else {
          taken[i] = 1;
          if (PROPS[kindOf].solid) propAt[i] = 1;
          // (Turned to face into the room: away from the wall behind it.)
          const rot = g[i - MAP_W] === '#' ? 0 : g[i + 1] === '#' ? 1 : g[i + MAP_W] === '#' ? 2 : 3;
          props.push({ kind: kindOf, x, z, rot });
        }
        break;
      }
    }
  };

  /** A lot wider than one building is cut by an alley, and each side again. */
  const lotsOf = (r: Rect, out: Rect[]) => {
    const w = wide(r);
    const h = deep(r);
    if (w > LOT_MAX && w >= h) {
      const c = r.x0 + LOT_MIN + int(w - 2 * LOT_MIN);
      lotsOf({ ...r, x1: c - 1 }, out);
      lotsOf({ ...r, x0: c + 1 }, out);
    } else if (h > LOT_MAX) {
      const c = r.z0 + LOT_MIN + int(h - 2 * LOT_MIN);
      lotsOf({ ...r, z1: c - 1 }, out);
      lotsOf({ ...r, z0: c + 1 }, out);
    } else out.push(r);
  };

  const scatter = (r: Rect, what: readonly number[], share: number) => {
    for (let z = r.z0; z <= r.z1; z++)
      for (let x = r.x0; x <= r.x1; x++) if (rnd() < share) stand(at(x, z), what[int(what.length)], int(2));
  };

  const open = (use: LotUse, r: Rect) => {
    addLot(use, r);
    if (use === 'green') {
      fill(r, '.');
      // (A park's largest greens have a pond.)
      if (kind === 'park' && wide(r) >= 10 && deep(r) >= 10) {
        const cx = r.x0 + Math.floor(wide(r) / 2);
        const cz = r.z0 + Math.floor(deep(r) / 2);
        const rx = 2 + int(2);
        const rz = 2 + int(2);
        for (let z = cz - rz; z <= cz + rz; z++)
          for (let x = cx - rx; x <= cx + rx; x++) if (((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 <= 1) set(x, z, '~');
      }
      scatter(r, [DECO.TREE, DECO.TREE, DECO.DEAD_TREE, DECO.BUSH, DECO.BUSH], 0.1);
    } else if (use === 'parking') {
      // Cars left in rows, every other row a lane.
      for (let z = r.z0; z <= r.z1; z += 3)
        for (let x = r.x0; x + 1 <= r.x1; x += 3) if (rnd() < 0.4) standLong(at(x, z), rnd() < 0.6 ? DECO.CAR : DECO.WRECK, 0, 2);
      scatter(r, [DECO.CONE, DECO.TYRES], 0.02);
    } else if (use === 'yard') {
      fill(r, 'd');
      scatter(r, [DECO.CRATES, DECO.CRATES, DECO.RUBBLE, DECO.TYRES, DECO.BARREL, DECO.DUMPSTER], 0.09);
    } else {
      scatter(r, [DECO.BARREL, DECO.CONE, DECO.RUBBLE, DECO.DEAD_TREE], 0.03);
    }
  };

  const draw = (list: ReadonlyArray<readonly [LotUse, number]>): LotUse => {
    let roll = rnd() * list.reduce((n, [, w]) => n + w, 0);
    for (const [use, w] of list) if ((roll -= w) < 0) return use;
    return list[0][0];
  };

  blocks.forEach((b, k) => {
    if (k === largest) {
      // The landmark: most of the block, ground left open beside it where the block is larger still.
      const r = { ...b, x1: Math.min(b.x1, b.x0 + LANDMARK_MAX - 1), z1: Math.min(b.z1, b.z0 + LANDMARK_MAX - 1) };
      building(spec.landmark, r);
      if (b.x1 - r.x1 >= 3) open('parking', { ...b, x0: r.x1 + 2 });
      if (b.z1 - r.z1 >= 3) open('plaza', { ...b, x1: r.x1, z0: r.z1 + 2 });
      return;
    }
    const use = draw(spec.blocks);
    if (!isBuilding(use)) return open(use, b);
    const parts: Rect[] = [];
    lotsOf(b, parts);
    for (const p of parts) {
      // A house may stand back from one side behind a strip of garden.
      const r = { ...p };
      if (use === 'house' && rnd() < 0.5) {
        const side = int(4);
        const by = 1 + int(2);
        if ((side === 0 || side === 2 ? deep(r) : wide(r)) - by >= LOT_MIN) {
          const yard = { ...r };
          if (side === 0) yard.z1 = (r.z0 += by) - 1;
          else if (side === 2) yard.z0 = (r.z1 -= by) + 1;
          else if (side === 1) yard.x0 = (r.x1 -= by) + 1;
          else yard.x1 = (r.x0 += by) - 1;
          fill(yard, '.');
          scatter(yard, [DECO.BUSH, DECO.DEAD_TREE], 0.12);
        }
      }
      building(use, r);
    }
  });

  // ------------------------------------------------------------------ the docks' piers
  if (sea >= 0) {
    const along = sea === SIDE.N || sea === SIDE.S;
    const span = along ? MAP_W : MAP_H;
    for (let p = 8 + int(6); p < span - 10; p += 12 + int(6)) {
      for (let out = 1; out <= SEA - 2; out++)
        for (let w = 0; w < 2; w++) {
          const q = sea === SIDE.N ? area.z0 - out : sea === SIDE.S ? area.z1 + out : sea === SIDE.W ? area.x0 - out : area.x1 + out;
          const i = along ? at(p + w, q) : at(q, p + w);
          if (g[i] === '~') g[i] = 'P';
        }
    }
  }

  // ------------------------------------------------------------------ the streets' wrecks
  const roads: number[] = [];
  for (let i = 0; i < N; i++) if (g[i] === ',') roads.push(i);
  // The bus, on its side along the middle street nearest the middle of the map, the player beside it.
  let spawn = { x: 32, z: 32 };
  const middle = roads.filter((i) => !keep[i]).sort((a, b) => dist2(a) - dist2(b));
  if (plan.start === d) {
    for (const i of middle) {
      const row = roadZ.includes(Math.floor(i / MAP_W));
      const way = row ? 0 : roadX.includes(i % MAP_W) ? 1 : -1;
      if (way < 0) continue;
      const beside = i + (way ? 1 : MAP_W);
      if (g[beside] !== ',' || !standLong(i, DECO.BUS, way, 3)) continue;
      const here = beside + (way ? MAP_W : 1);
      keep[here] = keep[beside] = 1;
      spawn = { x: here % MAP_W, z: Math.floor(here / MAP_W) };
      break;
    }
  } else if (middle.length) {
    spawn = { x: middle[0] % MAP_W, z: Math.floor(middle[0] / MAP_W) };
    keep[middle[0]] = 1;
  }
  for (const i of roads) {
    if (rnd() * 1000 >= spec.clutter) continue;
    const pick = rnd();
    // (A car lies along its street.)
    const way = roadX.includes(i % MAP_W) || roadX.includes((i % MAP_W) - 1) ? 1 : 0;
    if (pick < 0.45) standLong(i, pick < 0.25 ? DECO.CAR : DECO.WRECK, way, 2);
    else stand(i, pick < 0.65 ? DECO.RUBBLE : pick < 0.78 ? DECO.SANDBAGS : pick < 0.9 ? DECO.TYRES : DECO.CONE, way);
  }
  // A checkpoint's sandbags at each gate, a lane left open.
  for (const gt of gates) {
    const inward = gt.side === SIDE.N ? MAP_W : gt.side === SIDE.S ? -MAP_W : gt.side === SIDE.W ? 1 : -1;
    const i = gt.tiles[int(2)] + inward * 4;
    stand(i, DECO.SANDBAGS, gt.side === SIDE.N || gt.side === SIDE.S ? 0 : 1);
  }

  // ------------------------------------------------------------------ nothing shut in
  // Whatever the dice did, every floor can be walked to: a room found shut in gets a door to the nearest open tile.
  for (let pass = 0; pass < 40; pass++) {
    const seen = reachFrom(at(spawn.x, spawn.z), walkable);
    let fixed = false;
    for (let i = 0; i < N && !fixed; i++) {
      if (seen[i] || !walkable(i)) continue;
      // The wall between it and somewhere reached, opened.
      for (const [w, ok] of neighbours4(i)) {
        if (!ok || g[w] !== '#') continue;
        const beyond = w + (w - i);
        if (beyond < 0 || beyond >= N || !seen[beyond]) continue;
        g[w] = 'y';
        keep[w] = 1;
        fixed = true;
        break;
      }
      if (!fixed) {
        // (Shut in by what stands round it: cleared.)
        for (const [w, ok] of neighbours4(i)) {
          if (!ok || !decoSolid(deco[w])) continue;
          deco[w] = DECO.NONE;
          fixed = true;
          break;
        }
      }
    }
    if (!fixed) break;
  }

  const rows: string[] = [];
  for (let z = 0; z < MAP_H; z++) rows.push(g.slice(z * MAP_W, (z + 1) * MAP_W).join(''));
  return { index: d, kind, rows, props, deco, turn, lots, lotAt, gates, spawn };
}

const dist2 = (i: number) => ((i % MAP_W) - 32) ** 2 + (Math.floor(i / MAP_W) - 32) ** 2;

/** Every tile walked to from one, over `open` tiles. */
export function reachFrom(start: number, open: (i: number) => boolean): Uint8Array {
  const seen = new Uint8Array(N);
  if (!open(start)) return seen;
  seen[start] = 1;
  const queue = [start];
  for (let q = 0; q < queue.length; q++)
    for (const [j, ok] of neighbours4(queue[q]))
      if (ok && !seen[j] && open(j)) {
        seen[j] = 1;
        queue.push(j);
      }
  return seen;
}

/** What stands on a tile and stops sight. */
export const decoVeils = (k: number) => VEIL.has(k);
