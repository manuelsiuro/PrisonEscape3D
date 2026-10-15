import { zoneIndex, type ZoneId } from '../../content/zones';
import { TILE, TILE_INFO } from '../world/tiles';
import { MAP_H, MAP_W, type Prop, type World } from '../world/World';
import { facingAt } from '../systems/rest';

/** A tile to stand on and the direction (1–16) to face there. */
export interface Spot {
  tile: number;
  face: number;
}

/**
 * Where people go in a prison, worked out once from its map and props: free floor per zone,
 * seats at the canteen tables, the shower heads, the roll call spots and a place beside each
 * cell's bed. The routine sends inmates (and bots) to these.
 */
export interface Places {
  /** Free floor tiles (no wall, door or furniture) per zone index. */
  floor: number[][];
  /** Canteen seats, facing their table. */
  seats: Spot[];
  /** Tiles under a shower head, facing the wall. */
  showers: Spot[];
  /** Somewhere to sit in free time (P8+): every chair and yard bench tile, facing its table or the way it's turned. */
  rests: Spot[];
  /** Roll call spots in order (spot k for cell k + 1), facing north. */
  rollCall: Spot[];
  /** Per cell number: the free tile beside its bed (index 0 unused). */
  bedside: number[];
  /** Per cell number: the tile beside its desk (a guard stands there to search it). */
  deskside: number[];
  /** Per cell number: the tile outside its door (a guard looks in from there at night). */
  doorstep: number[];
  /** Where a prisoner sits out solitary, and wakes up in the infirmary (-1 when the prison has none). */
  solitary: number;
  infirmary: number;
  /** Beds in the guard quarters: where off-duty guards sleep (the tile beside each, and its bed). */
  guardBeds: Array<{ tile: number; bed: number }>;
}

const S = 5;
const N = 13;
const cache = new WeakMap<World, Places>();

export function placesOf(w: World): Places {
  let p = cache.get(w);
  if (!p) cache.set(w, (p = build(w)));
  return p;
}

/** A tile anyone can stand on whatever the doors do. */
export function isFloor(w: World, x: number, z: number): boolean {
  if (!w.inside(x, z)) return false;
  const i = z * MAP_W + x;
  const k = w.ground.kind[i];
  return !TILE_INFO[k].solid && k !== TILE.DOOR && k !== TILE.DETECTOR && !w.propSolid[i];
}

function build(w: World): Places {
  const g = w.ground;
  const floor: number[][] = [];
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (!isFloor(w, i % MAP_W, Math.floor(i / MAP_W))) continue;
    (floor[g.zone[i]] ??= []).push(i);
  }
  const canteen = zoneIndex('canteen');
  const seats: Spot[] = [];
  const showers: Spot[] = [];
  const rests: Spot[] = [];
  for (const p of w.props) {
    if (p.kind === 'chair' || p.kind === 'bench')
      for (let x = p.x; x < p.x + p.w; x++) for (let z = p.z; z < p.z + p.d; z++) rests.push({ tile: z * MAP_W + x, face: facingAt(w, p, x, z) });
    if (p.kind === 'table' && g.zone[p.z * MAP_W + p.x] === canteen) {
      for (let x = p.x; x < p.x + p.w; x++) {
        if (isFloor(w, x, p.z - 1)) seats.push({ tile: (p.z - 1) * MAP_W + x, face: S });
        if (isFloor(w, x, p.z + p.d)) seats.push({ tile: (p.z + p.d) * MAP_W + x, face: N });
      }
    }
    if (p.kind === 'shower') showers.push({ tile: p.z * MAP_W + p.x, face: p.rot === 2 ? N : S });
  }
  const rollCall = w.def.rollCall.map((r) => ({ tile: r.z * MAP_W + r.x, face: N }));
  const bedside = [-1];
  const deskside = [-1];
  const doorstep = [-1];
  w.def.cells.forEach((_, k) => {
    const inCell = (i: number) => w.cellOf[i] === k + 1;
    bedside.push(beside(w, w.cellBed[k + 1], inCell));
    deskside.push(beside(w, w.props.find((p) => p.kind === 'desk' && inCell(p.z * MAP_W + p.x)), inCell));
    // The door's neighbour outside the cell.
    const door = w.cellDoor[k + 1];
    let step = -1;
    if (door >= 0) for (const d of [-MAP_W, MAP_W, -1, 1]) if (step < 0 && !inCell(door + d) && isFloor(w, (door + d) % MAP_W, Math.floor((door + d) / MAP_W))) step = door + d;
    doorstep.push(step);
  });
  const bedIn = (zone: string) => {
    const z = zoneIndex(zone as ZoneId);
    return w.props.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === 'bed' && g.zone[p.z * MAP_W + p.x] === z);
  };
  const inZone = (zone: string) => (i: number) => g.zone[i] === zoneIndex(zone as ZoneId);
  const solitaryBed = bedIn('solitary')[0];
  const infirmaryBed = bedIn('infirmary')[0];
  const guardBeds = bedIn('guardQuarters').map(({ p, i }) => ({ tile: beside(w, p, inZone('guardQuarters')), bed: i }));
  return {
    floor,
    seats,
    showers,
    rests,
    rollCall,
    bedside,
    deskside,
    doorstep,
    solitary: roomy(w, beside(w, solitaryBed?.p, inZone('solitary')), inZone('solitary')),
    infirmary: roomy(w, beside(w, infirmaryBed?.p, inZone('infirmary')), inZone('infirmary')),
    guardBeds,
  };
}

/**
 * Near a tile (within a step), the one with the most free floor around it: somewhere to put
 * a player down in the open rather than in a corner against two walls.
 */
function roomy(w: World, tile: number, ok: (i: number) => boolean): number {
  if (tile < 0) return tile;
  const free = (x: number, z: number) => isFloor(w, x, z) && ok(z * MAP_W + x);
  const room = (x: number, z: number) => {
    let n = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && free(x + dx, z + dz)) n++;
    return n;
  };
  const tx = tile % MAP_W;
  const tz = Math.floor(tile / MAP_W);
  let best = tile;
  let bestRoom = room(tx, tz);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!free(tx + dx, tz + dz)) continue;
      const r = room(tx + dx, tz + dz);
      if (r > bestRoom) {
        bestRoom = r;
        best = (tz + dz) * MAP_W + tx + dx;
      }
    }
  }
  return best;
}

/** The free tile next to a piece of furniture closest to its middle, among tiles that pass `ok` (-1 if none). */
function beside(w: World, p: Prop | undefined, ok: (i: number) => boolean): number {
  if (!p) return -1;
  let best = -1;
  let bestD = Infinity;
  const mx = p.x * 2 + p.w;
  const mz = p.z * 2 + p.d;
  for (let z = p.z - 1; z <= p.z + p.d; z++) {
    for (let x = p.x - 1; x <= p.x + p.w; x++) {
      if (!isFloor(w, x, z) || !ok(z * MAP_W + x)) continue;
      const d = Math.abs(x * 2 + 1 - mx) + Math.abs(z * 2 + 1 - mz);
      if (d < bestD) {
        bestD = d;
        best = z * MAP_W + x;
      }
    }
  }
  return best;
}

/** Free floor of several zones, in a stable order. */
export function floorOf(w: World, zones: readonly ZoneId[]): number[] {
  const f = placesOf(w).floor;
  return zones.flatMap((z) => f[zoneIndex(z)] ?? []);
}
