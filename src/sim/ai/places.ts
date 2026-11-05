import { JOBS } from '../../content/jobs';
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
  /** The canteen's floor along its serving counters, facing them: where a tray is fetched and given back. */
  counters: Spot[];
  /** Tiles under a shower head: `face` as inmates have always faced (north or south), `wall` the way its pipe really is (2.26). */
  showers: Array<Spot & { wall: number }>;
  /** Somewhere to sit in free time (P8+): every chair and yard bench tile, facing its table or the way it's turned. */
  rests: Spot[];
  /** Roll call spots in order (spot k for cell k + 1), facing north. */
  rollCall: Spot[];
  /** Where the warden stands to call each square (2.27), and the way it faces from there. */
  countStops: Spot[];
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
  /** 2.29: the gym's machines: the prop, the tile an inmate uses it from (each its own) and the way it faces there. */
  machines: Array<Spot & { prop: number }>;
  /** 2.31: the library's: where to stand choosing a book, and its public chairs (with the added ones, which `rests` leaves out). */
  shelves: Spot[];
  readSeats: Spot[];
  /** 2.30: each job's stations, where whoever holds it works them from, by the prison's job order. */
  duties: Duty[];
}

/** 2.30: a job's stations, as an inmate works them (null or empty where the room lacks one). */
export interface Duty {
  take: (Spot & { prop: number }) | null;
  machines: Array<Spot & { prop: number }>;
  put: (Spot & { prop: number }) | null;
  /** A janitor's round: corridor tiles, spread out. */
  round: number[];
}

const S = 5;
const N = 13;
const E = 1;
const W = 9;

const MACHINES: readonly string[] = ['weights', 'pullup', 'treadmill', 'mat', 'punchingBag'];

/**
 * Where a machine is used from: on a mat, the mat; else the first free tile round it (from the south, the camera's
 * side, where the model's made to be used from, then its sides, then behind), in its own zone, not another's.
 */
/** The tiles to read a library's shelves from (the kiosk's left to its users), 2.31. */
function shelfSpots(w: World): Spot[] {
  const lib = zoneIndex('library');
  const kiosk = w.def.comms?.kiosk;
  const out: Spot[] = [];
  for (const p of w.props) {
    if (p.kind !== 'shelf' || w.ground.zone[p.z * MAP_W + p.x] !== lib) continue;
    for (let x = p.x; x < p.x + p.w; x++)
      for (const [z, face] of [[p.z + p.d, N], [p.z - 1, S]] as const) {
        const t = z * MAP_W + x;
        if (isFloor(w, x, z) && w.ground.zone[t] === lib && !(kiosk && kiosk.x === x && kiosk.z === z)) out.push({ tile: t, face });
      }
  }
  return out;
}

/** The library's chairs, for anyone to read on (not the librarian's), 2.31. */
function readSeats(w: World): Spot[] {
  const lib = zoneIndex('library');
  return w.props.flatMap((p) => ((p.kind === 'chair' || p.kind === 'readChair') && w.ground.zone[p.z * MAP_W + p.x] === lib ? [{ tile: p.z * MAP_W + p.x, face: facingAt(w, p, p.x, p.z) }] : []));
}

function machineSpots(w: World, free: (t: number) => boolean): Array<Spot & { prop: number }> {
  const out: Array<Spot & { prop: number }> = [];
  w.props.forEach((p, prop) => {
    if (!MACHINES.includes(p.kind)) return;
    const own = p.z * MAP_W + p.x;
    const zone = w.ground.zone[own];
    const open = (t: number) => free(t) && w.ground.zone[t] === zone && !out.some((q) => q.tile === t);
    if (p.kind === 'mat') {
      const t = [...Array(p.w).keys()].map((k) => own + k).find(open);
      if (t !== undefined) out.push({ prop, tile: t, face: E });
      return;
    }
    const round: Spot[] = [];
    for (let x = p.x; x < p.x + p.w; x++) round.push({ tile: (p.z + p.d) * MAP_W + x, face: N });
    for (let z = p.z + p.d - 1; z >= p.z; z--) round.push({ tile: z * MAP_W + p.x - 1, face: E }, { tile: z * MAP_W + p.x + p.w, face: W });
    for (let x = p.x; x < p.x + p.w; x++) round.push({ tile: (p.z - 1) * MAP_W + x, face: S });
    const spot = round.find((q) => open(q.tile));
    if (spot) out.push({ ...spot, prop });
  });
  return out;
}

/** The tiles round a prop to work it from: from the south, the camera's side, then its sides, then behind. */
function roundProp(p: Prop): Spot[] {
  const round: Spot[] = [];
  for (let x = p.x; x < p.x + p.w; x++) round.push({ tile: (p.z + p.d) * MAP_W + x, face: N });
  for (let z = p.z + p.d - 1; z >= p.z; z--) round.push({ tile: z * MAP_W + p.x - 1, face: E }, { tile: z * MAP_W + p.x + p.w, face: W });
  for (let x = p.x; x < p.x + p.w; x++) round.push({ tile: (p.z - 1) * MAP_W + x, face: S });
  return round;
}

/** The floor of a zone that hangs together with most of it: furniture can shut off a tile no one could ever reach. */
function mainFloor(w: World, zone: number, free: (t: number) => boolean): Set<number> {
  const seen = new Set<number>();
  let best = new Set<number>();
  for (let t = 0; t < w.ground.zone.length; t++) {
    if (w.ground.zone[t] !== zone || seen.has(t) || !free(t)) continue;
    const part = new Set<number>([t]);
    const open = [t];
    while (open.length) {
      const q = open.pop()!;
      for (const n of [q - 1, q + 1, q - MAP_W, q + MAP_W]) {
        if (n < 0 || n >= w.ground.zone.length || part.has(n) || w.ground.zone[n] !== zone || !free(n)) continue;
        part.add(n);
        open.push(n);
      }
    }
    part.forEach((x) => seen.add(x));
    if (part.size > best.size) best = part;
  }
  return best;
}

/** 2.30: each job's stations and where to work them from, chosen as `jobRooms` chooses them (the first to take from, the last to put on). */
function dutyStops(w: World, free: (t: number) => boolean): Duty[] {
  return w.def.jobs.map(({ id }) => {
    const def = JOBS[id];
    const zone = zoneIndex(def.zone);
    const main = mainFloor(w, zone, free);
    const inRoom = (kind: string | undefined) => w.props.map((p, prop) => ({ p, prop })).filter(({ p }) => p.kind === kind && w.ground.zone[p.z * MAP_W + p.x] === zone);
    const stop = (e: { p: Prop; prop: number } | undefined) => {
      if (!e) return null;
      const spot = roundProp(e.p).find((q) => main.has(q.tile));
      return spot ? { ...spot, prop: e.prop } : null;
    };
    const takes = inRoom(def.take);
    const puts = inRoom(def.put);
    const corridor = zoneIndex('corridor');
    const halls: number[] = [];
    if (def.flow === 'mop') for (let t = 0; t < w.ground.zone.length; t++) if (w.ground.zone[t] === corridor && free(t)) halls.push(t);
    // (Every seventh tile, wherever that falls: spread along the corridors, the same every day.)
    const round = halls.filter((_, k) => k % 7 === 0);
    return { take: stop(takes[0]), machines: inRoom(def.machine).map(stop).filter((q) => !!q), put: stop(puts[puts.length - 1]), round };
  });
}

/** The way the pipe stands from a shower's tile, by the prop's rotation: north, west, south, east. */
const WALL = [13, 9, 5, 1];
const cache = new WeakMap<World, Places>();

/** What changes what's solid (Sim.rules231, as a replay sets it up) has them worked out again. */
export const forgetPlaces = (w: World) => void cache.delete(w);

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
  const showers: Places['showers'] = [];
  const rests: Spot[] = [];
  for (const p of w.props) {
    if (p.kind === 'chair' || p.kind === 'bench' || p.kind === 'bleachers')
      for (let x = p.x; x < p.x + p.w; x++) for (let z = p.z; z < p.z + p.d; z++) rests.push({ tile: z * MAP_W + x, face: facingAt(w, p, x, z) });
    if (p.kind === 'table' && g.zone[p.z * MAP_W + p.x] === canteen) {
      for (let x = p.x; x < p.x + p.w; x++) {
        if (isFloor(w, x, p.z - 1)) seats.push({ tile: (p.z - 1) * MAP_W + x, face: S });
        if (isFloor(w, x, p.z + p.d)) seats.push({ tile: (p.z + p.d) * MAP_W + x, face: N });
      }
    }
    if (p.kind === 'shower') showers.push({ tile: p.z * MAP_W + p.x, face: p.rot === 2 ? N : S, wall: WALL[p.rot ?? 0] });
  }
  const seated = new Set(seats.map((q) => q.tile));
  const counters: Spot[] = [];
  const along = (x: number, z: number, face: number) => {
    const t = z * MAP_W + x;
    if (isFloor(w, x, z) && g.zone[t] === canteen && !seated.has(t)) counters.push({ tile: t, face });
  };
  for (const p of w.props) {
    if (p.kind !== 'counter' || g.zone[p.z * MAP_W + p.x] !== canteen) continue;
    // (Its front and ends: the side behind it, by its turn, is the staff's.)
    for (let x = p.x; x < p.x + p.w; x++) {
      if (p.rot !== 0) along(x, p.z - 1, S);
      if (p.rot !== 2) along(x, p.z + p.d, N);
    }
    for (let z = p.z; z < p.z + p.d; z++) {
      if (p.rot !== 1) along(p.x - 1, z, E);
      if (p.rot !== 3) along(p.x + p.w, z, W);
    }
  }
  const rollCall = w.def.rollCall.map((r) => ({ tile: r.z * MAP_W + r.x, face: N }));
  // (North of the square first: the line faces that way. Nothing else's square, nothing solid.)
  const squares = new Set(rollCall.map((r) => r.tile));
  const countStops = rollCall.map((r) => {
    const free = [[-MAP_W, S], [-1, E], [1, W], [MAP_W, N]].find(([d]) => !squares.has(r.tile + d) && !w.guardBlock[r.tile + d]);
    return free ? { tile: r.tile + free[0], face: free[1] } : { tile: r.tile, face: S };
  });
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
    counters,
    showers,
    rests,
    rollCall,
    countStops,
    bedside,
    deskside,
    doorstep,
    solitary: roomy(w, beside(w, solitaryBed?.p, inZone('solitary')), inZone('solitary')),
    infirmary: roomy(w, beside(w, infirmaryBed?.p, inZone('infirmary')), inZone('infirmary')),
    guardBeds,
    machines: machineSpots(w, (t) => isFloor(w, t % MAP_W, Math.floor(t / MAP_W))),
    shelves: shelfSpots(w),
    readSeats: readSeats(w),
    duties: dutyStops(w, (t) => isFloor(w, t % MAP_W, Math.floor(t / MAP_W))),
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
