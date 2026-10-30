/**
 * Where a holiday's decor goes in a prison (P42), worked out from the map alone (no Three.js):
 * garlands on the canteen's walls, a tree or a hose or a barbecue in the open, clear of the
 * ways people walk, the doorways, the fences and the courts. holidaytest checks it on every map.
 */
import { HOLIDAY } from '../content/holidays';
import { floorOf } from '../sim/ai/places';
import { DECOR } from '../content/decor';
import { HEARINGS } from '../content/parole';
import { TILE, TILE_INFO } from '../sim/world/tiles';
import { MAP_H, MAP_W, type World } from '../sim/world/World';
import { chebTiles } from '../sim/world/grid';

/** A canteen table's top (tiles), and a little above it. */
export const TABLE_TOP = 0.52;

/** A little hash for where decor goes (render only: never the sim's dice). */
const hash = (a: number, b = 0) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 1, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x27d4eb2f);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** A piece of a holiday's decor where it goes (tiles; `x1`/`z1` a garland's or a hose's other end, `y` on a table). */
export interface HolidayPiece {
  what: 'garland' | 'basket' | 'parasol' | 'barbecue' | 'hose' | 'lantern' | 'tree' | 'snowman';
  x: number;
  z: number;
  y?: number;
  x1?: number;
  z1?: number;
  /**
   * A garland on a side wall (the west one -1, the east one 1), down column `x` from row `z` to `z1`;
   * else along the north wall of row `z`, from `x` to `x1`. Never on a south wall: the camera sees
   * only its back, and the garland would float across the see-through cut.
   */
  side?: -1 | 1;
  /** A parasol's deckchairs: the way they sit either side of it (radians; none without room). */
  turn?: number;
}

/**
 * Where a holiday's decor goes in a prison (pure, from the map; holidaytest checks every piece in
 * every prison): garlands along the canteen's north wall (its side walls where the north has no
 * room), broken round what hangs there (the menu board, the clock, posters) and where the parole
 * board sits in front of it; Easter's baskets and Halloween's lanterns on its tables; summer's
 * parasols, barbecue and hoses on the sports ground, where the exercise hour and the water fight
 * are; Halloween's lanterns along the yard's walls; Christmas's tree in a corner of the canteen and
 * the snowman out in the yard (where the yard is only a strip, the sports ground too). Nothing
 * stands on furniture, on the prison's own floor decor, on a pastime's ground (the pitch, the
 * track, the hoop's court, the garden, the rat track, the stage), by a doorway or an opening
 * between rooms, in a passage a tile wide or by a fence's wire; nothing by a wall stands just north
 * of a wall (it'd hide it from the camera); parasols keep PARASOL_GAP tiles apart and
 * PARASOL_CLEAR from a doorway, and a hose's jets clear of anything standing.
 */
export function holidayDecor(w: World, kind: number): HolidayPiece[] {
  const out: HolidayPiece[] = [];
  if (!kind) return out;
  const { things, grounds, edges } = holidayTaken(w);
  // (Out on the floor: on nothing, off the pastimes' ground, clear of the doorways and openings and out of line with them, out of the one-wide passages, off the fences' wire.)
  const ways = lanesOf(w, 0);
  const floorOk = (t: number) => !things.has(t) && !grounds.has(t) && !nearDoor(w, t, 1) && !ways.has(t) && !narrowAt(w, things, t) && !nearFence(w, t);
  const free = (t: number) => floorOk(t) && !edges.has(t);
  const canteen = canteenOf(w, things, grounds);
  const tables = w.props.filter((p) => p.kind === 'table' && w.zoneAt(p.x, p.z) === 'canteen');
  // (Out in the yard; where it has no room, Shankton's strip, the sports ground too.)
  const own = floorOf(w, ['yard']);
  const sports = floorOf(w, ['sports']);
  const near = [-1, 0, 1].flatMap((dz) => [-1, 0, 1].map((dx) => dz * MAP_W + dx)).filter((d) => d !== 0);
  // (Each piece out on the ground keeps the tiles round it to itself.)
  const used = new Set<number>();
  const place = (t: number) => {
    used.add(t);
    for (const d of near) used.add(t + d);
  };
  /** Free tiles of a ground with nothing standing round them (a pitch's paint may be: what spreads over it, a canopy, a snowman's girth, doesn't touch it). */
  const roomOf = (ground: readonly number[]) => {
    const on = new Set(ground);
    return ground.filter((t) => free(t) && !used.has(t) && near.every((d) => on.has(t + d) && !things.has(t + d)));
  };
  /** Free tiles of a ground by its edge: against a wall, or a tile in from a fence (edgeAt). */
  const byWallOf = (ground: readonly number[]) => ground.filter((t) => free(t) && edgeAt(w, t));
  const pick = (list: readonly number[], n: number, salt: number) => {
    const got: number[] = [];
    for (const t of [...list].sort((a, b) => hash(a, salt) - hash(b, salt) || a - b)) {
      if (got.length >= n) break;
      if (!used.has(t)) got.push(t);
    }
    return got;
  };
  /** `n` tiles of a list one at a time, each keeping the tiles round it before the next is picked (never two side by side). */
  const pickPlace = (list: readonly number[], n: number, salt: number) => {
    const got: number[] = [];
    while (got.length < n) {
      const t = pick(list, 1, salt)[0];
      if (t === undefined) break;
      got.push(t);
      place(t);
    }
    return got;
  };
  const yard = roomOf(own).length ? own : floorOf(w, ['yard', 'sports']);
  const at = (t: number) => ({ x: (t % MAP_W) + 0.5, z: Math.floor(t / MAP_W) + 0.5 });
  if (canteen) out.push(...canteen.walls);
  if (kind === HOLIDAY.EASTER) for (const p of tables) out.push({ what: 'basket', x: p.x + p.w / 2, z: p.z + p.d / 2, y: TABLE_TOP });
  else if (kind === HOLIDAY.SUMMER) {
    // (Where the sports ground has no room left by its pitch, track and court, Center Perks', out in the yard by it; well in from a doorway, off the way in.)
    const lanes = lanesOf(w);
    const roomy = (ground: readonly number[]) => roomOf(ground).filter((t) => !nearDoor(w, t, PARASOL_CLEAR) && !lanes.has(t));
    const room = roomy(sports).length ? roomy(sports) : roomy(own);
    const spots: number[] = [];
    for (const t of pick(room, room.length, 11)) {
      if (spots.length >= 3) break;
      if (spots.every((u) => chebTiles(t, u) >= PARASOL_GAP)) spots.push(t);
    }
    for (const t of spots) {
      // (The deckchairs either side, along whichever way has free floor both sides; none where neither has.)
      const turn = free(t + 1) && free(t - 1) ? 0 : free(t + MAP_W) && free(t - MAP_W) ? Math.PI / 2 : undefined;
      out.push({ what: 'parasol', ...at(t), turn });
      place(t);
    }
    const byWall = byWallOf(sports);
    // (A barbecue by the wall, or, where the running track's margin takes the whole wall, Center Perks', at the track's edge.)
    const hoseAt = sports.filter((t) => floorOk(t) && edgeAt(w, t));
    const bbq = pick(byWall, 1, 12)[0] ?? pick(hoseAt, 1, 12)[0];
    if (bbq !== undefined) {
      out.push({ what: 'barbecue', ...at(bbq) });
      place(bbq);
    }
    // (Each hose sprays a short jet, up to HOSE_REACH tiles out from its wall onto the sports ground, its fan clear of anything standing.)
    const onGround = new Set(sports);
    // (A hose by the wall may stand at a pastime's edge too, never on it: its jet points away from the wall.)
    // (Its jets clear of anything standing, and of the parasols, the barbecue and the other hose and the tiles round them.)
    const blocked = (k: number) => things.has(k) || used.has(k);
    const aimed = (list: readonly number[]) => list.filter((t) => hoseAim(w, blocked, onGround, t));
    // (One at a time: the second keeps clear of the first.)
    for (let k = 0; k < 2; k++) {
      const t = pick(aimed(byWall), 1, 13 + k)[0] ?? pick(aimed(hoseAt), 1, 13 + k)[0];
      if (t === undefined) break;
      const { dx, dz, reach } = hoseAim(w, blocked, onGround, t)!;
      const from = at(t);
      out.push({ what: 'hose', ...from, x1: from.x + dx * reach, z1: from.z + dz * reach });
      place(t);
    }
  } else if (kind === HOLIDAY.HALLOWEEN) {
    for (const p of tables) out.push({ what: 'lantern', x: p.x + p.w / 2, z: p.z + p.d / 2, y: TABLE_TOP });
    // (Along the yard's walls; where it has too few free, San Pancho's, the sports ground's too.)
    const got = pickPlace(byWallOf(yard), 4, 14);
    got.push(...pickPlace(byWallOf(floorOf(w, ['yard', 'sports'])), 4 - got.length, 14));
    for (const t of got) out.push({ what: 'lantern', ...at(t) });
  } else if (kind === HOLIDAY.CHRISTMAS) {
    if (canteen?.corner) out.push({ what: 'tree', x: canteen.corner[0], z: canteen.corner[1] });
    else {
      // (A canteen with no room for it anywhere, tables to every wall, San Pancho's: the tree out in the yard, or by the sports ground.)
      const clear = (ground: readonly number[]) => roomOf(ground).filter((u) => !nearDoor(w, u, 2));
      const t = pick(clear(yard), 1, 16)[0] ?? pick(clear(floorOf(w, ['yard', 'sports'])), 1, 16)[0];
      if (t !== undefined) {
        out.push({ what: 'tree', ...at(t) });
        place(t);
      }
    }
    // (The snowman out in the yard; with the tree there already and no more room, on the sports ground.)
    const spot = pick(roomOf(yard), 1, 15)[0] ?? pick(roomOf(floorOf(w, ['yard', 'sports'])), 1, 15)[0];
    if (spot !== undefined) out.push({ what: 'snowman', ...at(spot) });
  }
  return out;
}

/**
 * Where a hose by the wall at tile `t` sprays ([dx, dz] away from the wall, `reach` tiles): the
 * longest jet, 2 to HOSE_REACH tiles, whose whole fan (HOSE_FAN either side, HOSE_SWAY more) passes
 * over open floor with nothing standing on it (`blocked`: furniture, the other summer pieces) and
 * lands on the sports ground; null if none does.
 */
function hoseAim(w: World, blocked: (t: number) => boolean, ground: ReadonlySet<number>, t: number): { dx: number; dz: number; reach: number } | null {
  const x = t % MAP_W;
  const z = Math.floor(t / MAP_W);
  const edge = edgeAt(w, t);
  if (!edge) return null;
  const [dx, dz] = edge;
  const wide = HOSE_FAN + HOSE_SWAY;
  for (let reach = HOSE_REACH; reach >= 2; reach--) {
    if (!ground.has(t + (dz * MAP_W + dx) * reach)) continue;
    let clear = true;
    for (const a of [-wide, 0, wide]) {
      const ex = (dx * Math.cos(a) - dz * Math.sin(a)) * reach;
      const ez = (dx * Math.sin(a) + dz * Math.cos(a)) * reach;
      for (let u = 0.15; u <= 1.001 && clear; u += 0.05) {
        const tx = Math.floor(x + 0.5 + ex * u);
        const tz = Math.floor(z + 0.5 + ez * u);
        const k = tz * MAP_W + tx;
        if (k !== t && (solidAt(w, tx, tz) || blocked(k))) clear = false;
      }
    }
    if (clear) return { dx, dz, reach };
  }
  return null;
}

/** How far a hose's jet reaches from its wall (tiles). */
const HOSE_REACH = 3;
/** A hose's three jets fan out this far either side (radians), and the fan sways this much more. */
export const HOSE_FAN = 0.2;
export const HOSE_SWAY = 0.15;
/** A parasol stands more than this many tiles from a doorway or an opening (its canopy and deckchairs off the way in), and off its lane (lanesOf). */
const PARASOL_CLEAR = 2;
/** The way in through a doorway: this many tiles straight on from it, a tile either side (lanesOf). */
export const LANE = 4;

/** Parasols stand this many tiles apart at least (their canopies and deckchairs clear of each other). */
export const PARASOL_GAP = 3;


/**
 * The tiles a holiday's decor keeps off: `things` that stand there (furniture, the prison's own
 * floor decor: plants, bins, the water cooler, trees and bushes, the hoop's pole) and the pastimes'
 * `grounds` (the football pitch, the running track's rectangle, the hoop's tile and its shooting
 * spots, the garden's beds, the rat track and its lanes, the stage and its boards, quiz night's
 * places). Nothing goes on either; what spreads over its neighbours (a canopy, a tree's boughs)
 * may reach over a pitch's paint, never a thing.
 */
function holidayTaken(w: World): { things: Set<number>; grounds: Set<number>; edges: Set<number> } {
  const things = new Set<number>();
  const grounds = new Set<number>();
  const edges = new Set<number>();
  const rect = (out: Set<number>, x: number, z: number, wd: number, d: number) => {
    for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + wd; xx++) if (xx >= 0 && zz >= 0 && xx < MAP_W && zz < MAP_H) out.add(zz * MAP_W + xx);
  };
  for (const p of w.props) rect(things, p.x, p.z, p.w, p.d);
  for (const d of w.def.decor ?? []) if (!DECOR[d.kind].wall) rect(things, d.x, d.z, d.w ?? 1, d.d ?? 1);
  const l = w.def.leisure;
  if (l) {
    rect(grounds, l.pitch.x, l.pitch.z, l.pitch.w, l.pitch.d);
    if (l.track) rect(grounds, l.track.x, l.track.z, l.track.w, l.track.d);
    rect(grounds, l.hoop.x, l.hoop.z, 1, 1);
    for (const sp of l.hoop.spots) rect(grounds, sp.x, sp.z, 1, 1);
    // (The half court's painted surface, as render/Grounds.ts lays it: from behind the rim 5 deep and 5 across.)
    const [cx, cz, cw, cd] = courtRect(l.hoop);
    rect(grounds, cx, cz, cw, cd);
    // (A tile's margin round the track and the court: nothing set down right at their edge, corners included.)
    if (l.track) rect(edges, l.track.x - 1, l.track.z - 1, l.track.w + 2, l.track.d + 2);
    rect(edges, cx - 1, cz - 1, cw + 2, cd + 2);
    rect(grounds, l.garden.x, l.garden.z, l.garden.w, l.garden.d);
    const r = l.race;
    const [dx, dz] = r.dir === 1 ? [1, 0] : r.dir === 5 ? [0, 1] : r.dir === 9 ? [-1, 0] : [0, -1];
    for (let k = 0; k < r.len; k++) for (const side of [-1, 0, 1]) rect(grounds, r.x + dx * k + dz * side, r.z + dz * k + dx * side, 1, 1);
    if (l.stage) rect(grounds, l.stage.x - 1, l.stage.z - 1, 3, 3);
    for (const q of l.quiz?.spots ?? []) rect(grounds, q.x, q.z, 1, 1);
  }
  return { things, grounds, edges };
}

/** The tiles the basketball court's paint covers ([x, z, w, d]): render/Grounds.ts court(), 5 deep from half a tile behind the rim's tile and 5 across. */
export function courtRect(c: { x: number; z: number; face: number }): [number, number, number, number] {
  const [ax, az] = c.face === 1 ? [1, 0] : c.face === 5 ? [0, 1] : c.face === 9 ? [-1, 0] : [0, -1];
  const [sx, sz] = [-az, ax];
  const xs: number[] = [];
  const zs: number[] = [];
  for (const a of [-0.5, 4.5]) for (const s of [-2.5, 2.5]) {
    xs.push(c.x + 0.5 + ax * a + sx * s);
    zs.push(c.z + 0.5 + az * a + sz * s);
  }
  const x0 = Math.floor(Math.min(...xs) + 0.01);
  const z0 = Math.floor(Math.min(...zs) + 0.01);
  return [x0, z0, Math.ceil(Math.max(...xs) - 0.01) - x0, Math.ceil(Math.max(...zs) - 0.01) - z0];
}

/** A doorway (a door, a detector arch, or an opening between two rooms with no door: openingsOf) within this many tiles: kept clear for whoever comes through. */
function nearDoor(w: World, t: number, r: number): boolean {
  const open = openingsOf(w);
  const x0 = t % MAP_W;
  const z0 = Math.floor(t / MAP_W);
  for (let z = z0 - r; z <= z0 + r; z++) {
    for (let x = x0 - r; x <= x0 + r; x++) {
      if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
      const k = w.ground.kind[z * MAP_W + x];
      if (k === TILE.DOOR || k === TILE.DETECTOR || open.has(z * MAP_W + x)) return true;
    }
  }
  return false;
}

const OPENINGS = new WeakMap<World, Set<number>>();

/**
 * The openings between rooms with no door in them (the gaps in a wall's line, up to OPENING_WIDE
 * tiles across, where the floor on one side is another zone's: Irongate's canteen's south opening,
 * Center Perks' yard's ways in): each tile of the gap. A doorway to the decor, like a door.
 */
function openingsOf(w: World): ReadonlySet<number> {
  const had = OPENINGS.get(w);
  if (had) return had;
  const got = new Set<number>();
  const floor = (x: number, z: number) => x >= 0 && z >= 0 && x < MAP_W && z < MAP_H && !TILE_INFO[w.ground.kind[z * MAP_W + x]].solid;
  // (Across the gap: floor both sides, and a zone changing on the way through.)
  const through = (x: number, z: number, ax: number, az: number) => {
    if (!floor(x, z) || !floor(x - ax, z - az) || !floor(x + ax, z + az)) return false;
    const here = w.zoneAt(x, z);
    return w.zoneAt(x - ax, z - az) !== here || w.zoneAt(x + ax, z + az) !== here;
  };
  for (let z = 0; z < MAP_H; z++) {
    for (let x = 0; x < MAP_W; x++) {
      for (const [ax, az] of [[0, 1], [1, 0]]) {
        if (!through(x, z, ax, az)) continue;
        // (Along the wall's line, both ways, to the wall each side.)
        const [px, pz] = [az, ax];
        let a = 0;
        while (a <= OPENING_WIDE && through(x - px * (a + 1), z - pz * (a + 1), ax, az)) a++;
        let b = 0;
        while (b <= OPENING_WIDE && through(x + px * (b + 1), z + pz * (b + 1), ax, az)) b++;
        if (a + b + 1 > OPENING_WIDE) continue;
        if (solidAt(w, x - px * (a + 1), z - pz * (a + 1)) && solidAt(w, x + px * (b + 1), z + pz * (b + 1))) got.add(z * MAP_W + x);
      }
    }
  }
  OPENINGS.set(w, got);
  return got;
}

/**
 * The ways in: from each doorway (a door, a detector arch, an opening) straight on into the room
 * either side, LANE tiles deep (and `wide` tiles either side of it), where people walk in and out
 * and the guide's path runs: nothing stands in line with a doorway, nothing big beside that line.
 */
function lanesOf(w: World, wide: 0 | 1 = 1): ReadonlySet<number> {
  const open = openingsOf(w);
  const got = new Set<number>();
  const floor = (x: number, z: number) => x >= 0 && z >= 0 && x < MAP_W && z < MAP_H && !TILE_INFO[w.ground.kind[z * MAP_W + x]].solid;
  for (let t = 0; t < w.ground.kind.length; t++) {
    const k = w.ground.kind[t];
    if (k !== TILE.DOOR && k !== TILE.DETECTOR && !open.has(t)) continue;
    const x = t % MAP_W;
    const z = Math.floor(t / MAP_W);
    for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!floor(x + ax, z + az) || !floor(x - ax, z - az)) continue;
      for (let d = 1; d <= LANE; d++) for (let j = -wide; j <= wide; j++) {
        const xx = x + ax * d + az * j;
        const zz = z + az * d + ax * j;
        if (floor(xx, zz)) got.add(zz * MAP_W + xx);
      }
    }
  }
  return got;
}

/** An opening this many tiles across at most is a way through a wall (wider, two spaces open to each other). */
const OPENING_WIDE = 4;

/** A passage a tile wide (walls, or something standing, either side): nothing set down in it. */
function narrowAt(w: World, things: ReadonlySet<number>, t: number): boolean {
  const x = t % MAP_W;
  const z = Math.floor(t / MAP_W);
  const shut = (xx: number, zz: number) => solidAt(w, xx, zz) || things.has(zz * MAP_W + xx);
  return (shut(x - 1, z) && shut(x + 1, z)) || (shut(x, z - 1) && shut(x, z + 1));
}

/** A fence (its wire, its razor coil) on any tile round this one: decor keeps a tile off. */
function nearFence(w: World, t: number): boolean {
  const x0 = t % MAP_W;
  const z0 = Math.floor(t / MAP_W);
  for (let z = z0 - 1; z <= z0 + 1; z++) {
    for (let x = x0 - 1; x <= x0 + 1; x++) {
      if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
      if (FENCES.has(w.ground.kind[z * MAP_W + x])) return true;
    }
  }
  return false;
}

/**
 * A tile by the edge of a ground, and the way out from it ([dx, dz], away from the edge): against a
 * wall (brick, reinforced: what stands tall) west, east or north of it, or a tile in from a fence
 * (nothing touches the wire); null if neither, or if a wall stands just south of it (from the
 * camera, a wall south of a thing hides it; a fence is seen through).
 */
function edgeAt(w: World, t: number): [number, number] | null {
  const x = t % MAP_W;
  const z = Math.floor(t / MAP_W);
  if (wallAt(w, x, z + 1)) return null;
  if (wallAt(w, x + 1, z)) return [-1, 0];
  if (wallAt(w, x - 1, z)) return [1, 0];
  if (wallAt(w, x, z - 1)) return [0, 1];
  const fence = (xx: number, zz: number) => xx >= 0 && zz >= 0 && xx < MAP_W && zz < MAP_H && FENCES.has(w.ground.kind[zz * MAP_W + xx]);
  if (fence(x + 2, z) && !solidAt(w, x + 1, z)) return [-1, 0];
  if (fence(x - 2, z) && !solidAt(w, x - 1, z)) return [1, 0];
  if (fence(x, z - 2) && !solidAt(w, x, z - 1)) return [0, 1];
  if (fence(x, z + 2) && !solidAt(w, x, z + 1)) return [0, -1];
  return null;
}

const FENCES: ReadonlySet<number> = new Set([TILE.FENCE, TILE.ELECTRIC, TILE.FENCE_CUT, TILE.FENCE_FAKE]);

function solidAt(w: World, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return false;
  return TILE_INFO[w.ground.kind[z * MAP_W + x]].solid;
}

/** A wall that stands tall and hides what's behind it (brick, reinforced, a tower; a fence is seen through). */
function wallAt(w: World, x: number, z: number): boolean {
  if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return false;
  const i = TILE_INFO[w.ground.kind[z * MAP_W + x]];
  return i.solid && i.opaque;
}

/**
 * The canteen: its garlands, runs of its north wall (or, where what hangs there leaves no room,
 * Irongate's with the odd jobs board, of its side walls), broken where something hangs on that
 * wall (a garland never crosses the menu board, the clock, a poster or the odd jobs board) and
 * where the parole board sits in front of it (their heads would cover it); and a tile for the
 * tree: free floor with nothing standing on any tile round it (a plant, the water cooler, a table,
 * the counter), against a wall (a corner first; never just north of one, which would hide it) or
 * else free in the room (clear of the counter's queue), no doorway or opening within two tiles.
 */
function canteenOf(w: World, things: ReadonlySet<number>, grounds: ReadonlySet<number>): { walls: HolidayPiece[]; corner: [number, number] | null } | null {
  const tiles: number[] = [];
  for (let z = 0; z < MAP_H; z++) for (let x = 0; x < MAP_W; x++) if (w.zoneAt(x, z) === 'canteen' && !solidAt(w, x, z)) tiles.push(z * MAP_W + x);
  if (!tiles.length) return null;
  // (What hangs on the north wall, the west and the east: the floor tiles in front of it.)
  const hung = new Set<number>();
  const hungWest = new Set<number>();
  const hungEast = new Set<number>();
  for (const d of w.def.decor ?? []) {
    if (!DECOR[d.kind].wall) continue;
    const r = d.rot ?? 0;
    const [dw, dd] = [d.w ?? 1, d.d ?? 1];
    if (r === 0) for (let x = d.x; x < d.x + dw; x++) hung.add(d.z * MAP_W + x);
    if (r === 1) for (let z = d.z; z < d.z + dd; z++) hungWest.add(z * MAP_W + d.x);
    if (r === 3) for (let z = d.z; z < d.z + dd; z++) hungEast.add(z * MAP_W + d.x + dw - 1);
  }
  // (P40's cork board, on the wall its reader faces.)
  const board = w.def.board;
  if (board) ({ 13: hung, 9: hungWest, 1: hungEast } as Record<number, Set<number>>)[board.face]?.add(board.z * MAP_W + board.x);
  // (P39's parole board, seated in the canteen at its hearing: their heads in front of the wall a garland hangs on.)
  const hearing = HEARINGS[w.def.id];
  const heads = new Set(hearing?.zone === 'canteen' ? hearing.board.map((b) => b.z * MAP_W + b.x) : []);
  // (Nor along an opening in the room's walls: no wall there to hang it on, only the way through.)
  const gaps = openingsOf(w);
  const north: HolidayPiece[] = [];
  for (const t of tiles) {
    const [x, z] = [t % MAP_W, Math.floor(t / MAP_W)];
    if (!wallAt(w, x, z - 1) || hung.has(t) || gaps.has(t)) continue;
    const last = north.at(-1);
    if (last && last.z === z && last.x1 === x) last.x1 = x + 1;
    else north.push({ what: 'garland', x, x1: x + 1, z });
  }
  // (The side walls, down each column; never at a corner under what hangs on the north wall.)
  const sides: HolidayPiece[] = [];
  for (const side of [-1, 1] as const) {
    for (const t of [...tiles].sort((a, b) => (a % MAP_W) - (b % MAP_W) || a - b)) {
      const [x, z] = [t % MAP_W, Math.floor(t / MAP_W)];
      if (!wallAt(w, x + side, z) || (side < 0 ? hungWest : hungEast).has(t) || hung.has(t) || gaps.has(t)) continue;
      const last = sides.at(-1);
      if (last && last.side === side && last.x === x && last.z1 === z) last.z1 = z + 1;
      else sides.push({ what: 'garland', x, z, z1: z + 1, side });
    }
  }
  // (A single tile, between a doorway and the board say: left bare. Then broken where the parole board's heads would cover it, what's left either side kept.)
  const long = (g: HolidayPiece) => (g.side ? g.z1! - g.z : g.x1! - g.x) >= 2;
  const walls = (north.filter(long).length ? north.filter(long) : sides.filter(long)).flatMap((g) => {
    const out: HolidayPiece[] = [];
    const [s0, s1] = g.side ? [g.z, g.z1!] : [g.x, g.x1!];
    for (let s = s0; s < s1; s++) {
      if (heads.has(g.side ? s * MAP_W + g.x : g.z * MAP_W + s)) continue;
      const last = out.at(-1);
      if (last && (g.side ? last.z1 : last.x1) === s) {
        if (g.side) last.z1 = s + 1;
        else last.x1 = s + 1;
      } else out.push(g.side ? { ...g, z: s, z1: s + 1 } : { ...g, x: s, x1: s + 1 });
    }
    return out;
  });
  const walled = (t: number) => {
    const [x, z] = [t % MAP_W, Math.floor(t / MAP_W)];
    return [solidAt(w, x - 1, z), solidAt(w, x + 1, z), solidAt(w, x, z - 1), solidAt(w, x, z + 1)].filter(Boolean).length;
  };
  // (Nor under anything hung on a wall, the odd jobs board too, nor at its sides: the boughs and the star would cover it.)
  // (A piece on a north or south wall: its row, a tile either side; on a side wall, its column, a tile above or below.)
  const alongRow = new Set<number>();
  const alongColumn = new Set<number>();
  for (const d of w.def.decor ?? []) {
    if (!DECOR[d.kind].wall) continue;
    const r = d.rot ?? 0;
    for (let z = d.z; z < d.z + (d.d ?? 1); z++) for (let x = d.x; x < d.x + (d.w ?? 1); x++) (r === 0 || r === 2 ? alongRow : alongColumn).add(z * MAP_W + x);
  }
  if (board) (board.face === 1 || board.face === 9 ? alongColumn : alongRow).add(board.z * MAP_W + board.x);
  const byBoard = (t: number) => [-1, 0, 1].some((k) => alongRow.has(t + k) || alongColumn.has(t + k * MAP_W));
  // (Nor under a garland: its boughs stand taller than the string hangs.)
  const underGarland = (t: number) => {
    const [x, z] = [t % MAP_W, Math.floor(t / MAP_W)];
    return walls.some((g) => (g.side ? g.x === x && z >= g.z - 1 && z <= g.z1! : g.z === z && x >= g.x - 1 && x <= g.x1!));
  };
  const bare = (t: number) => !things.has(t) && !grounds.has(t) && !nearDoor(w, t, 2) && !byBoard(t) && !underGarland(t) && !wallAt(w, t % MAP_W, Math.floor(t / MAP_W) + 1);
  // (Nothing standing on any tile round it: its boughs and presents, 0.6 or so out, never touch a table, the counter or a plant.)
  const roomy = (t: number) => [-1, 0, 1].every((dz) => [-1, 0, 1].every((dx) => !things.has(t + dz * MAP_W + dx)));
  // (Out in the room: canteen floor all round, off the pastimes' ground, and out of the way of the queue at a serving counter.)
  const inside = new Set(tiles);
  const queue = new Set<number>();
  for (const p of w.props) {
    if (p.kind !== 'counter' || w.zoneAt(p.x, p.z) !== 'canteen') continue;
    for (let z = p.z - 1; z < p.z + p.d + 1; z++) for (let x = p.x - 1; x < p.x + p.w + 1; x++) queue.add(z * MAP_W + x);
  }
  const doors: number[] = [];
  for (let t = 0; t < w.ground.kind.length; t++) if ((w.ground.kind[t] === TILE.DOOR || w.ground.kind[t] === TILE.DETECTOR || gaps.has(t)) && (inside.has(t) || [1, -1, MAP_W, -MAP_W].some((d) => inside.has(t + d)))) doors.push(t);
  const fromDoors = (t: number) => Math.min(99, ...doors.map((d) => Math.abs((d % MAP_W) - (t % MAP_W)) + Math.abs(Math.floor(d / MAP_W) - Math.floor(t / MAP_W))));
  const middle = (t: number) => !queue.has(t) && [-1, 0, 1].every((dz) => [-1, 0, 1].every((dx) => inside.has(t + dz * MAP_W + dx) && !grounds.has(t + dz * MAP_W + dx)));
  // (A corner with room round it first, then anywhere along a wall; else standing free in the room, nearest the north wall.)
  const c =
    tiles.find((t) => walled(t) >= 2 && bare(t) && roomy(t)) ??
    tiles.find((t) => walled(t) >= 1 && bare(t) && roomy(t)) ??
    tiles
      .filter((t) => walled(t) === 0 && bare(t) && roomy(t) && middle(t))
      // (Nearest the north wall's lights; then as far from a doorway, the way people come and go, as can be.)
      .sort((a, b) => Math.floor(a / MAP_W) - Math.floor(b / MAP_W) || fromDoors(b) - fromDoors(a) || a - b)[0];
  return { walls, corner: c === undefined ? null : [(c % MAP_W) + 0.5, Math.floor(c / MAP_W) + 0.5] };
}
