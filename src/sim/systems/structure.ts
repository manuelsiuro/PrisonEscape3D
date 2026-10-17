import { itemDef, itemNumber, type ItemDef } from '../../content/items';
import { handlersOf } from './k9';
import { DIR_X, DIR_Z } from '../command';
import { BODY_HALF, CAMERA_REACH, ELECTRIC_HP, FENCE_HP, FLOOR_HP, GRAPNEL_REACH, GRATE_HP, SHARPEN_STROKES, SOIL_HP, UNBRACED_RUN, UNIT, WALL_HP } from '../tuning';
import { isGrate, isSea, isTunnel, TILE, TILE_INFO } from '../world/tiles';
import { LAYER, MAP_H, MAP_W, type World } from '../world/World';
import { placesOf } from '../ai/places';
import { lineOfSight } from '../ai/sight';
import type { Body } from './movement';

/**
 * Layers and destruction (GDD §9): what a tool would strike, what the action button would
 * climb or cover, and the tunnel rules. Pure functions of the world and the player: the
 * simulation applies them, the UI labels the buttons with the same answers.
 */

/**
 * What the use button does with the item in hand: a tool strikes (chip, cut, unscrew, dig,
 * dig up), chocolate is eaten, a cover goes over damage, a brace goes up, a sheet rope
 * takes the player down off a roof, an alarm clock is wound (P14).
 */
export type ToolAction = 'chip' | 'cut' | 'unscrew' | 'dig' | 'digUp' | 'eat' | 'cover' | 'brace' | 'rope' | 'sharpen' | 'grapnel' | 'tape' | 'launch' | 'wind' | 'wash';

/** The actions that strike (and wear down a tile, or sharpen a comb on it); the others happen at one press. */
export const STRIKES: ReadonlySet<ToolAction> = new Set(['chip', 'cut', 'unscrew', 'dig', 'digUp', 'sharpen']);

export interface ToolTarget {
  action: ToolAction;
  layer: number;
  tile: number;
  /** The item in hand can do it (else the button says what is needed). */
  fits: boolean;
  /** Hit points the tile has in all (0: nothing gets through it; strikes only). */
  hp: number;
  /** A grapnel's swing: the fence (or gatehouse roof) tile it hooks (the landing is `tile`). */
  over?: number;
}

/** What the action button does to the structure around the player. */
export type ClimbAction =
  /** Ground → vents through an open grate; vents → ground. */
  | 'climbVent'
  | 'dropDown'
  /** Up the ladder to the roof (from the floor or the vents), and back down to the floor. */
  | 'climbRoof'
  | 'climbDownLadder'
  /** Into a tunnel entrance, and back out. */
  | 'climbDown'
  | 'climbUp'
  /** A cover taken off damage (into the hand). */
  | 'uncover';

export interface ClimbTarget {
  action: ClimbAction;
  /** It's over the player's own tile (a grate overhead), not the one they face: furniture faced wins. */
  overhead?: boolean;
  /** The tile it acts on (the layer is the player's, or the one below for grates). */
  tile: number;
  /** Where the player ends up (cover/uncover/brace: stays). */
  toLayer: number;
  toTile: number;
  /** Covers: the item it takes or gives back. */
  item?: number;
}

const ITEM_ID = (id: string) => itemNumber(id);
export const DIRT = ITEM_ID('dirt');
export const WALL_CHUNK = ITEM_ID('wall_chunk');
export const POSTER = ITEM_ID('poster');
export const FAKE_WALL = ITEM_ID('fake_wall');
export const FAKE_FENCE = ITEM_ID('fake_fence');
export const FAKE_VENT = ITEM_ID('fake_vent');
export const BRACE = ITEM_ID('timber_brace');
export const SHEET_ROPE = ITEM_ID('sheet_rope');
export const CHOCOLATE = ITEM_ID('chocolate');
export const GRAPNEL = ITEM_ID('grapnel');
export const RAFT = ITEM_ID('raft');
/** P14: the alarm clock (wound with the use button) and the firecracker (thrown). */
export const ALARM_CLOCK = ITEM_ID('alarm_clock');
export const FIRECRACKER = ITEM_ID('firecracker');
export const SOAP = ITEM_ID('soap');
/** What blinds a camera (GDD §5.6). */
export const LENS_COVERS: ReadonlySet<number> = new Set([ITEM_ID('duct_tape'), ITEM_ID('toothpaste')]);
const PLASTIC_KNIFE = ITEM_ID('plastic_knife');
/** What rubbing on a wall makes of a comb and a toothbrush (GDD §7.3: shivs). */
export const SHIVS: ReadonlyMap<number, number> = new Map([
  [ITEM_ID('plastic_comb'), ITEM_ID('comb_shiv')],
  [ITEM_ID('toothbrush'), ITEM_ID('toothbrush_shiv')],
]);

/** The floors a tunnel can be started through (GDD §9.2: dirt, grass or any non-reinforced floor). */
const DIGGABLE = new Set<number>([TILE.GRASS, TILE.ROAD, TILE.CONCRETE, TILE.TILED, TILE.WOOD, TILE.ASPHALT, TILE.DIRT]);

const tileX = (i: number) => i % MAP_W;
const tileZ = (i: number) => Math.floor(i / MAP_W);
const bodyTile = (b: Body) => Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);

/** The tile straight ahead of a body (its heading snapped to the nearest of the four sides), -1 off the map. */
export function aheadOf(b: Body): number {
  const fx = DIR_X[b.facing] ?? 0;
  const fz = DIR_Z[b.facing] ?? 0;
  const x = Math.floor(b.x / UNIT) + (Math.abs(fx) >= Math.abs(fz) ? Math.sign(fx) : 0);
  const z = Math.floor(b.z / UNIT) + (Math.abs(fx) >= Math.abs(fz) ? 0 : Math.sign(fz));
  return x < 0 || z < 0 || x >= MAP_W || z >= MAP_H ? -1 : z * MAP_W + x;
}

/** Whether a tool does a job: picks chip, shovels dig, the multitool does both, cutters cut, files and screwdrivers (and the plastic knife) unscrew. */
export function toolFits(def: ItemDef | null, action: ToolAction): boolean {
  const kind = def?.tool?.kind;
  if (!kind) return false;
  switch (action) {
    case 'chip':
      return kind === 'chip' || kind === 'multi';
    case 'dig':
    case 'digUp':
      return kind === 'dig' || kind === 'multi';
    case 'cut':
      return kind === 'cut';
    case 'unscrew':
      return kind === 'unscrew' || itemDef(PLASTIC_KNIFE) === def;
    default:
      return false;
  }
}

/** The player's desk, if the tile is under it (a tunnel can start there, GDD §9.3). */
export function underMyDesk(w: World, i: number): boolean {
  return w.cellOf[i] === 1 && w.props.some((p) => p.kind === 'desk' && i >= 0 && tileX(i) >= p.x && tileX(i) < p.x + p.w && tileZ(i) >= p.z && tileZ(i) < p.z + p.d);
}

/** Someone's footprint covers the tile (no digging under people). */
function occupied(i: number, bodies: readonly Body[]): boolean {
  const x0 = tileX(i) * UNIT;
  const z0 = tileZ(i) * UNIT;
  return bodies.some((b) => b.x + BODY_HALF > x0 && b.x - BODY_HALF < x0 + UNIT && b.z + BODY_HALF > z0 && b.z - BODY_HALF < z0 + UNIT);
}

/**
 * Tiles nobody may dig a hole in: where people must be able to stand (beside each bed and
 * desk, outside each cell door, at the ladder's foot, the roll call spots). A hole there would
 * strand a guard's bed check or a sleeper, or the player climbing down.
 */
const reservedCache = new WeakMap<World, Set<number>>();
export function reserved(w: World): Set<number> {
  let r = reservedCache.get(w);
  if (r) return r;
  const p = placesOf(w);
  const guardSpots = w.def.guards.flatMap((d) => [...d.beat, ...(d.night ?? []), ...Object.values(d.posts ?? {})]).map((q) => q!.z * MAP_W + q!.x);
  r = new Set<number>(
    [...p.bedside, ...p.deskside, ...p.doorstep, ...p.rollCall.map((q) => q.tile), ...p.guardBeds.map((g) => g.tile), p.infirmary, p.solitary, ladderFootOf(w), ...guardSpots].filter((t) => t >= 0),
  );
  // Either side of every door, and every chokepoint: a hole there would cut people off.
  const base = w.ground.base;
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (base[i] !== TILE.DOOR && base[i] !== TILE.DETECTOR) continue;
    for (const j of [i - 1, i + 1, i - MAP_W, i + MAP_W]) r.add(j);
  }
  for (const i of chokepoints(w)) r.add(i);
  reservedCache.set(w, r);
  return r;
}

/**
 * The tiles whose loss would split the prison's walkable floor in two (articulation points of
 * the map as built, doors open, furniture in place): found once per map, iteratively (Tarjan).
 */
function chokepoints(w: World): number[] {
  const N = MAP_W * MAP_H;
  const base = w.ground.base;
  const open = (i: number) => {
    const k = base[i];
    return (k === TILE.DOOR || !TILE_INFO[k].solid) && !w.propSolid[i];
  };
  const disc = new Int32Array(N).fill(-1);
  const low = new Int32Array(N);
  const parent = new Int32Array(N).fill(-1);
  const next = new Uint8Array(N);
  const cut = new Uint8Array(N);
  let time = 0;
  const neighbour = (i: number, k: number) => {
    const x = i % MAP_W;
    if (k === 0) return x > 0 ? i - 1 : -1;
    if (k === 1) return x < MAP_W - 1 ? i + 1 : -1;
    if (k === 2) return i >= MAP_W ? i - MAP_W : -1;
    return i < N - MAP_W ? i + MAP_W : -1;
  };
  for (let root = 0; root < N; root++) {
    if (!open(root) || disc[root] >= 0) continue;
    let children = 0;
    const stack = [root];
    disc[root] = low[root] = time++;
    while (stack.length) {
      const u = stack[stack.length - 1];
      if (next[u] < 4) {
        const v = neighbour(u, next[u]++);
        if (v < 0 || !open(v)) continue;
        if (disc[v] < 0) {
          parent[v] = u;
          if (u === root) children++;
          disc[v] = low[v] = time++;
          stack.push(v);
        } else if (v !== parent[u]) low[u] = Math.min(low[u], disc[v]);
        continue;
      }
      stack.pop();
      const pu = parent[u];
      if (pu >= 0) {
        low[pu] = Math.min(low[pu], low[u]);
        if (pu !== root && low[u] >= disc[pu]) cut[pu] = 1;
      }
    }
    if (children > 1) cut[root] = 1;
  }
  const out: number[] = [];
  for (let i = 0; i < N; i++) if (cut[i]) out.push(i);
  return out;
}

/** A ground floor tile a tunnel entrance can be dug through (free floor, or under the player's desk); from below (`up`), the minefield's sand too, mine and all (P11). */
export function canDigFloor(w: World, i: number, bodies: readonly Body[], up = false): boolean {
  if (i < 0) return false;
  const k = w.ground.kind[i];
  // Nor over a boulder: there'd be nowhere to go.
  if (!(DIGGABLE.has(k) || (up && k === TILE.MINE)) || reserved(w).has(i) || w.layers[LAYER.UNDER].kind[i] === TILE.BOULDER) return false;
  if (w.propSolid[i] && !underMyDesk(w, i)) return false;
  if (w.props.some((p) => !w.propSolid[i] && tileX(i) >= p.x && tileX(i) < p.x + p.w && tileZ(i) >= p.z && tileZ(i) < p.z + p.d)) return false;
  return !occupied(i, bodies);
}

/**
 * What a strike with the held item would hit (GDD §9): the wall, fence or grate ahead, the
 * floor ahead (a shovel digs a tunnel entrance), the earth ahead in a tunnel or the ground
 * above its end. Chocolate in hand is eaten. When something is there but the tool can't do
 * it, the target comes back with `fits` false (the UI says what is needed); null when there
 * is nothing to strike.
 */
export function toolTarget(w: World, layer: number, b: Body, held: number, bodies: readonly Body[], pockets: readonly number[] = []): ToolTarget | null {
  const def = held ? itemDef(held) : null;
  if (held === CHOCOLATE) return { action: 'eat', layer, tile: -1, fits: true, hp: 0 };
  if (held === ALARM_CLOCK) return { action: 'wind', layer, tile: -1, fits: true, hp: 0 };
  // A bar of soap (P19): the player's scent rubbed off.
  if (held === SOAP && handlersOf(w).length) return { action: 'wash', layer, tile: -1, fits: true, hp: 0 };
  const here = bodyTile(b);
  const ahead = aheadOf(b);
  // A comb or toothbrush against a wall: rubbed into a shiv (hp: the strokes it takes).
  if (SHIVS.has(held) && layer === LAYER.GROUND && ahead >= 0) {
    const k = w.ground.kind[ahead];
    if (k === TILE.BRICK || k === TILE.REINFORCED) return { action: 'sharpen', layer, tile: ahead, fits: true, hp: SHARPEN_STROKES };
  }
  const placed = placeTarget(w, layer, here, ahead, held);
  if (placed) return placed;
  // A raft in hand at the end of a pier, the open sea ahead (P12, GDD §4.5): launched, and away.
  if (held === RAFT && layer === LAYER.GROUND && ahead >= 0 && w.ground.kind[here] === TILE.PIER && w.ground.kind[ahead] === TILE.WATER && !w.bridge[ahead]) {
    return { action: 'launch', layer, tile: ahead, fits: true, hp: 0 };
  }
  // A grapnel at a roof's edge, the perimeter fence in reach beyond (GDD §12): a sheet rope in the pockets gets the player down outside.
  if (held === GRAPNEL && layer === LAYER.ROOF) {
    const swing = grapnelSwing(w, b);
    if (swing) return { action: 'grapnel', layer: swing.roof ? LAYER.ROOF : LAYER.GROUND, tile: swing.land, over: swing.fence, hp: 0, fits: pockets.some((v) => (v & 255) === SHEET_ROPE) };
  }
  // Tape or toothpaste under a camera: over its lens.
  if (LENS_COVERS.has(held) && layer === LAYER.GROUND) {
    const cam = cameraInReach(w, b);
    if (cam >= 0) {
      const c = w.def.cameras![cam];
      return { action: 'tape', layer: LAYER.GROUND, tile: c.z * MAP_W + c.x, hp: 0, fits: true };
    }
  }
  const found: ToolTarget[] = [];
  const add = (action: ToolAction, l: number, tile: number, hp: number) => found.push({ action, layer: l, tile, hp, fits: toolFits(def, action) });
  if (layer === LAYER.GROUND) {
    const k = ahead >= 0 ? w.ground.kind[ahead] : TILE.EMPTY;
    if (k === TILE.BRICK || k === TILE.REINFORCED) add('chip', LAYER.GROUND, ahead, k === TILE.REINFORCED ? 0 : WALL_HP);
    if (k === TILE.FENCE || k === TILE.ELECTRIC) add('cut', LAYER.GROUND, ahead, k === TILE.ELECTRIC ? ELECTRIC_HP : FENCE_HP);
    // A ceiling grate overhead or just ahead (from the floor you reach up to it).
    for (const t of [here, ahead]) if (t >= 0 && w.layers[LAYER.VENTS].kind[t] === TILE.GRATE) add('unscrew', LAYER.VENTS, t, GRATE_HP);
    // A shovel in hand: the floor ahead.
    if (toolFits(def, 'dig') && canDigFloor(w, ahead, bodies)) add('dig', LAYER.GROUND, ahead, FLOOR_HP);
  } else if (layer === LAYER.UNDER) {
    const k = ahead >= 0 ? w.layers[LAYER.UNDER].kind[ahead] : TILE.EMPTY;
    if (k === TILE.SOIL && !edge(ahead)) add('dig', LAYER.UNDER, ahead, SOIL_HP);
    // Granite: there, but no tool gets through (hp 0, as reinforced concrete).
    else if (k === TILE.BOULDER) add('dig', LAYER.UNDER, ahead, 0);
    // At the tunnel's end, facing back along it (the earth behind the player): up through the
    // floor above. Never just after breaking through ahead (the tunnel is behind them then),
    // so tapping on at the dig face never surfaces by accident.
    else if (isTunnel(k) && behindIsEarth(w, b) && canDigFloor(w, here, bodies, true) && !underMyDesk(w, here)) add('digUp', LAYER.GROUND, here, FLOOR_HP);
  } else if (layer === LAYER.VENTS) {
    for (const t of [here, ahead]) if (t >= 0 && w.layers[LAYER.VENTS].kind[t] === TILE.GRATE) add('unscrew', LAYER.VENTS, t, GRATE_HP);
  }
  if (!found.length) return null;
  return found.find((f) => f.fits && f.hp > 0) ?? found[0];
}

/**
 * A cover, a brace or a sheet rope in hand (GDD §9.2–9.3, §12): a fake vent cover over an
 * open grate (from below or above), a fake wall block into a hole, a poster over a hole in
 * the player's own cell (elsewhere it wouldn't pass: `fits` false), a fake fence cover over
 * a cut, a brace in the tunnel where the player stands, a rope down off a roof's edge.
 */
function placeTarget(w: World, layer: number, here: number, ahead: number, held: number): ToolTarget | null {
  const vents = w.layers[LAYER.VENTS].kind;
  const at = (action: ToolAction, l: number, tile: number, fits = true): ToolTarget => ({ action, layer: l, tile, fits, hp: 0 });
  const spots = ahead >= 0 && ahead !== here ? [here, ahead] : [here];
  if (held === FAKE_VENT && (layer === LAYER.GROUND || layer === LAYER.VENTS)) {
    for (const t of spots) if (vents[t] === TILE.GRATE_OPEN) return at('cover', LAYER.VENTS, t);
  }
  if (layer === LAYER.GROUND && ahead >= 0) {
    const k = w.ground.kind[ahead];
    if (k === TILE.HOLE && held === FAKE_WALL) return at('cover', LAYER.GROUND, ahead);
    if (k === TILE.HOLE && held === POSTER) return at('cover', LAYER.GROUND, ahead, touchesMyCell(w, ahead));
    if (k === TILE.FENCE_CUT && held === FAKE_FENCE) return at('cover', LAYER.GROUND, ahead);
  }
  if (layer === LAYER.UNDER && held === BRACE && w.layers[LAYER.UNDER].kind[here] === TILE.TUNNEL) return at('brace', LAYER.UNDER, here);
  if (layer === LAYER.ROOF && held === SHEET_ROPE && ahead >= 0 && w.layers[LAYER.ROOF].kind[ahead] === TILE.EMPTY && !w.blocked(tileX(ahead), tileZ(ahead)) && TILE_INFO[w.ground.kind[ahead]].outdoor) {
    return at('rope', LAYER.GROUND, ahead);
  }
  return null;
}

/**
 * A grapnel thrown from a roof's edge (GDD §12): straight ahead over the open ground below,
 * the perimeter fence within reach, and free road just past it to come down on; or a roof
 * standing on the wire to swing across onto (Shankton's gatehouse, GDD §4.3: the sheet
 * rope then gets the player down its far side). Returns the tile hooked and the landing, or null.
 */
export function grapnelSwing(w: World, b: Body): { fence: number; land: number; roof: boolean } | null {
  const fx = DIR_X[b.facing] ?? 0;
  const fz = DIR_Z[b.facing] ?? 0;
  const sx = Math.abs(fx) >= Math.abs(fz) ? Math.sign(fx) : 0;
  const sz = Math.abs(fx) >= Math.abs(fz) ? 0 : Math.sign(fz);
  let x = Math.floor(b.x / UNIT);
  let z = Math.floor(b.z / UNIT);
  const roof = w.layers[LAYER.ROOF].kind;
  // Only from the edge: the tile ahead has no roof.
  if (!w.inside(x + sx, z + sz) || roof[(z + sz) * MAP_W + x + sx] !== TILE.EMPTY) return null;
  for (let k = 1; k <= GRAPNEL_REACH + 1; k++) {
    x += sx;
    z += sz;
    if (!w.inside(x, z)) return null;
    const i = z * MAP_W + x;
    const kind = w.ground.kind[i];
    if (kind === TILE.FENCE || kind === TILE.ELECTRIC || kind === TILE.FENCE_FAKE || kind === TILE.FENCE_CUT) {
      if (k > GRAPNEL_REACH || !w.inside(x + sx, z + sz)) return null;
      const land = (z + sz) * MAP_W + x + sx;
      // Down onto open ground (the road, or between two fences): whether that's out, the escape check says.
      const lk = w.ground.kind[land];
      return TILE_INFO[lk].outdoor && !TILE_INFO[lk].solid && !w.blocked(x + sx, z + sz) ? { fence: i, land, roof: false } : null;
    }
    // A roof standing on the wire (a gatehouse astride the fences), or a landing across a chasm
    // between roofs (Irongate's yard): hooked, and swung across onto it.
    if (roof[i] === TILE.ROOF && k <= GRAPNEL_REACH && (w.zoneAt(x, z) === 'perimeter' || onLanding(w, x, z))) return { fence: i, land: i, roof: true };
    // Over open ground only (no roofs, towers or walls in the way).
    if (roof[i] !== TILE.EMPTY || !TILE_INFO[kind].outdoor || TILE_INFO[kind].solid) return null;
  }
  return null;
}

/** A roof the prison names as a grapnel's landing across a chasm (PrisonDef.landings). */
export const onLanding = (w: World, x: number, z: number) => !!w.def.landings?.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);

/** A tunnel tile under the sea (P12): digging it floods the tunnel (GDD §4.5). */
export const underSea = (w: World, i: number) => i >= 0 && isSea(w.ground.base[i]);

/** The camera the player stands under or beside (-1: none). */
export function cameraInReach(w: World, b: Body): number {
  const cams = w.def.cameras ?? [];
  for (let k = 0; k < cams.length; k++) {
    const dx = Math.abs(cams[k].x * UNIT + UNIT / 2 - b.x);
    const dz = Math.abs(cams[k].z * UNIT + UNIT / 2 - b.z);
    // Within reach, and not through a wall.
    if (Math.max(dx, dz) <= CAMERA_REACH && lineOfSight(w, b.x, b.z, cams[k].x * UNIT + UNIT / 2, cams[k].z * UNIT + UNIT / 2)) return k;
  }
  return -1;
}

/** Whether the tile behind a body (opposite its heading, snapped to a side) is undug earth or the map's edge. */
function behindIsEarth(w: World, b: Body): boolean {
  const fx = DIR_X[b.facing] ?? 0;
  const fz = DIR_Z[b.facing] ?? 0;
  const x = Math.floor(b.x / UNIT) - (Math.abs(fx) >= Math.abs(fz) ? Math.sign(fx) : 0);
  const z = Math.floor(b.z / UNIT) - (Math.abs(fx) >= Math.abs(fz) ? 0 : Math.sign(fz));
  const k = w.inside(x, z) ? w.layers[LAYER.UNDER].kind[z * MAP_W + x] : TILE.SOIL;
  return k === TILE.SOIL || k === TILE.BOULDER;
}

/** The map's outermost ring can't be dug (there is nothing past it). */
const edge = (i: number) => tileX(i) === 0 || tileZ(i) === 0 || tileX(i) === MAP_W - 1 || tileZ(i) === MAP_H - 1;

const AROUND = [
  [0, 0],
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
] as const;

/**
 * The free floor tile next to a ground tile where someone climbing out stands (-1 for none):
 * the four sides first, then the corners (never through a wall's corner). With `self` the
 * tile itself comes first.
 */
export function besideOnGround(w: World, i: number, bodies: readonly Body[] = [], self = false): number {
  const x = tileX(i);
  const z = tileZ(i);
  const free = (nx: number, nz: number) => w.inside(nx, nz) && !w.blocked(nx, nz);
  for (const [dx, dz] of AROUND) {
    if (!dx && !dz && !self) continue;
    const nx = x + dx;
    const nz = z + dz;
    if (!free(nx, nz)) continue;
    if (dx && dz && (!free(x + dx, z) || !free(x, z + dz))) continue;
    const j = nz * MAP_W + nx;
    if (!occupied(j, bodies)) return j;
  }
  return -1;
}

/** Whether a hole in a wall touches the player's cell (a poster only passes for decoration there). */
export const touchesMyCell = (w: World, i: number) => [i - 1, i + 1, i - MAP_W, i + MAP_W].some((j) => j >= 0 && j < MAP_W * MAP_H && w.cellOf[j] === 1);

/**
 * What the action button would do to the structure around the player: climb (grates, the
 * ladder, tunnel entrances) or take a cover off damage. Checked before furniture and items,
 * so standing on a grate means climbing. (Putting covers on is the use button's: see
 * placeTarget.) `ladderFoot` is where the ladder's floor end is (-1 if the prison has none).
 */
export function climbTarget(w: World, layer: number, b: Body, ladderFoot: number, bodies: readonly Body[]): ClimbTarget | null {
  const here = bodyTile(b);
  const ahead = aheadOf(b);
  const spots = ahead >= 0 && ahead !== here ? [here, ahead] : [here];
  const vents = w.layers[LAYER.VENTS].kind;
  const stay = (action: ClimbAction, tile: number, item?: number): ClimbTarget => ({ action, tile, toLayer: layer, toTile: here, item });
  if (layer === LAYER.GROUND) {
    for (const t of spots) {
      const overhead = t === here;
      if (vents[t] === TILE.GRATE_OPEN) return { action: 'climbVent', tile: t, toLayer: LAYER.VENTS, toTile: t, overhead };
      if (vents[t] === TILE.GRATE_FAKE) return { ...stay('uncover', t, FAKE_VENT), overhead };
    }
    if (ahead < 0) return null;
    const k = w.ground.kind[ahead];
    if (vents[ahead] === TILE.LADDER && w.propSolid[ahead]) return { action: 'climbRoof', tile: ahead, toLayer: LAYER.ROOF, toTile: ahead };
    if (k === TILE.SHAFT && !underMyDesk(w, ahead)) return { action: 'climbDown', tile: ahead, toLayer: LAYER.UNDER, toTile: ahead };
    if (k === TILE.HOLE_POSTER) return stay('uncover', ahead, POSTER);
    if (k === TILE.HOLE_FAKE) return stay('uncover', ahead, FAKE_WALL);
    if (k === TILE.FENCE_FAKE) return stay('uncover', ahead, FAKE_FENCE);
    return null;
  }
  if (layer === LAYER.UNDER) {
    if (w.ground.kind[here] === TILE.SHAFT) {
      const out = underMyDesk(w, here) ? -2 : besideOnGround(w, here, bodies);
      if (out !== -1) return { action: 'climbUp', tile: here, toLayer: LAYER.GROUND, toTile: out };
    }
    return null;
  }
  if (layer === LAYER.VENTS) {
    for (const t of spots) {
      if (vents[t] === TILE.GRATE_OPEN && !w.blocked(tileX(t), tileZ(t)) && !occupied(t, bodies)) return { action: 'dropDown', tile: t, toLayer: LAYER.GROUND, toTile: t };
      if (vents[t] === TILE.GRATE_FAKE) return stay('uncover', t, FAKE_VENT);
      if (vents[t] === TILE.LADDER) return { action: 'climbRoof', tile: t, toLayer: LAYER.ROOF, toTile: t };
    }
    return null;
  }
  if (layer === LAYER.ROOF) {
    for (const t of spots) if (w.layers[LAYER.ROOF].kind[t] === TILE.LADDER && ladderFoot >= 0) return { action: 'climbDownLadder', tile: t, toLayer: LAYER.GROUND, toTile: ladderFoot };
  }
  return null;
}

/** The floor tile in front of the ladder (where climbing down puts the player), -1 without a ladder. */
export function ladderFootOf(w: World): number {
  const vents = w.layers[LAYER.VENTS].kind;
  for (let i = 0; i < MAP_W * MAP_H; i++) if (vents[i] === TILE.LADDER) return besideOnGround(w, i);
  return -1;
}

/**
 * Whether a tunnel tile is held up: within a brace's 3×3 (GDD §9.2), or right under a
 * tunnel entrance (its frame).
 */
export function supported(w: World, i: number): boolean {
  if (w.ground.kind[i] === TILE.SHAFT) return true;
  const under = w.layers[LAYER.UNDER].kind;
  const x = tileX(i);
  const z = tileZ(i);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (w.inside(x + dx, z + dz) && under[(z + dz) * MAP_W + x + dx] === TILE.BRACED) return true;
  return false;
}

/** Whether a newly dug tunnel tile brings down the roof: more than UNBRACED_RUN unsupported tiles joined to it. */
export function cavesIn(w: World, i: number): boolean {
  const under = w.layers[LAYER.UNDER].kind;
  const seen = new Set<number>([i]);
  const queue = [i];
  while (queue.length) {
    const t = queue.pop()!;
    if (supported(w, t)) continue;
    if (seen.size > UNBRACED_RUN + 1) break;
    for (const j of [t - 1, t + 1, t - MAP_W, t + MAP_W]) {
      if (j < 0 || j >= MAP_W * MAP_H || seen.has(j) || !isTunnel(under[j]) || supported(w, j)) continue;
      if (Math.abs(tileX(j) - tileX(t)) > 1) continue;
      seen.add(j);
      queue.push(j);
    }
  }
  return !supported(w, i) && seen.size > UNBRACED_RUN;
}

/** Whether a grate tile of the vents is open, closed or covered (for the render and the rules). */
export const grateAt = (w: World, i: number) => (isGrate(w.layers[LAYER.VENTS].kind[i]) ? w.layers[LAYER.VENTS].kind[i] : 0);

/**
 * The action button's choice between the structure and the furniture in reach: a grate
 * overhead gives way to a piece of furniture the player faces (the toilet beside it). The
 * sim and the button's label both decide through this, so they always agree.
 */
export function preferClimb(climb: ClimbTarget | null, facesFurniture: boolean): ClimbTarget | null {
  return climb?.overhead && facesFurniture ? null : climb;
}

/** Whether the tile ahead of a body is part of a piece of furniture. */
export function facesProp(b: Body, p: { x: number; z: number; w: number; d: number }): boolean {
  const t = aheadOf(b);
  return t >= 0 && tileX(t) >= p.x && tileX(t) < p.x + p.w && tileZ(t) >= p.z && tileZ(t) < p.z + p.d;
}
