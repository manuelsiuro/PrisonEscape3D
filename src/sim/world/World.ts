import { PROPS, type PropKind } from '../../content/props';
import type { PrisonDef } from '../../content/prisons/types';
import { ZONES, zoneIndex } from '../../content/zones';
import { DAMAGE_SHOWS, KEY, LEGEND, TILE, TILE_INFO, UNDER_LEGEND, VENT_LEGEND } from './tiles';
import { doorOpen } from './doors';
import { JOBS } from '../../content/jobs';
import { OPEN_HOURS } from '../../content/routine';

/** Zones behind doors that open by the hour: where jobs are done (for the Work Period), the sports ground and the garden (P31: OPEN_HOURS). */
const WORK_ZONES = new Set<string>([...Object.values(JOBS).map((j) => j.zone), ...Object.keys(OPEN_HOURS)]);

export const MAP_W = 64;
export const MAP_H = 64;

/** Layers bottom to top (GDD §1.2). Index into World.layers. */
export const LAYER = { UNDER: 0, GROUND: 1, VENTS: 2, ROOF: 3 } as const;

const TILES = MAP_W * MAP_H;

/**
 * One number for a tile on a layer (saves, floor items, damage): the ground floor's tiles
 * keep their plain index (saves from before the layers stay valid), the others follow.
 */
export const placeKey = (layer: number, i: number) => (layer === LAYER.GROUND ? i : (layer + 1) * TILES + i);
export const layerOfKey = (key: number) => (key < TILES ? LAYER.GROUND : Math.floor(key / TILES) - 1);
export const tileOfKey = (key: number) => key % TILES;

/** One floor of the map: a typed array per field, indexed z * MAP_W + x. */
export class Layer {
  readonly kind = new Uint8Array(MAP_W * MAP_H);
  /** The map's own tiles (what a repair puts back). */
  readonly base = new Uint8Array(MAP_W * MAP_H);
  /** Derived: 1 where the player can't stand on this layer. */
  readonly block = new Uint8Array(MAP_W * MAP_H);
  /** Door key color (tiles.ts KEY), 0 elsewhere. */
  readonly key = new Uint8Array(MAP_W * MAP_H);
  /** Zone index (content/zones.ts). */
  readonly zone = new Uint8Array(MAP_W * MAP_H);
}

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
}

/** Map pictures are trimmed of their first and last empty lines; every row must be MAP_W wide. */
export function parseRows(picture: string, legend: Record<string, unknown> = LEGEND): string[] {
  const rows = picture.replace(/^\n+|\n+$/g, '').split('\n');
  if (rows.length !== MAP_H) throw new Error(`map has ${rows.length} rows, expected ${MAP_H}`);
  rows.forEach((r, z) => {
    if (r.length !== MAP_W) throw new Error(`map row ${z} is ${r.length} wide, expected ${MAP_W}`);
    for (let x = 0; x < MAP_W; x++) if (legend[r[x]] === undefined) throw new Error(`unknown map character '${r[x]}' at ${x},${z}`);
  });
  return rows;
}

/**
 * The prison's tiles, zones and furniture. Built from a PrisonDef; changed only by the
 * simulation. `block` (can't walk here) is derived from tiles, props and doors, and
 * recomputed whenever one of those changes.
 */
export class World {
  readonly layers = [new Layer(), new Layer(), new Layer(), new Layer()];
  readonly props: Prop[];
  /** Tiles covered by solid props on the ground floor. */
  readonly propSolid = new Uint8Array(MAP_W * MAP_H);
  /** Derived: 1 where the player can't walk on the ground floor right now (the ground layer's block). */
  readonly block: Uint8Array;
  /** Derived: the same for inmates, who never use the player's holes and cut fences. */
  readonly npcBlock = new Uint8Array(MAP_W * MAP_H);
  /** Derived: the same for guards, whose keys open every door (and who keep off damage too). */
  readonly guardBlock = new Uint8Array(MAP_W * MAP_H);
  /** Derived: where the player's own feet are walked by a route (tap to walk): the ground's block, and the minefield (P11) too. */
  readonly routeBlock = new Uint8Array(MAP_W * MAP_H);
  /** Which cell (1–8) each ground tile belongs to, 0 outside cells. */
  readonly cellOf = new Uint8Array(MAP_W * MAP_H);
  /** On door tiles: the cell the door leads into (0 for other doors). */
  readonly doorCell = new Uint8Array(MAP_W * MAP_H);
  /** The tile index of each cell's door, by cell number (index 0 unused). */
  readonly cellDoor: number[] = [-1];
  /** Each cell's bed, by cell number (index 0 unused). */
  readonly cellBed: Array<Prop | undefined> = [undefined];
  /** Bit c set: cell c's door is locked (derived by the simulation from the routine). A bigint: a prison may have any number of cells. */
  lockedCells = 0n;
  /** Bit k set: the player carries a key for color k (tiles.ts KEY), so those doors open for them (derived by the simulation). */
  playerKeys = 0;
  /** 1 on doors in the outer perimeter (beside the road): no key opens them (the takeover does, P7). */
  readonly gate = new Uint8Array(MAP_W * MAP_H);
  /** A takeover (GDD §12): the guards are down, every door and gate opens for the player (derived by the simulation). */
  riot = false;
  /** On door tiles into a job room (GDD §11): the room's zone index (0 for other doors). */
  readonly doorRoom = new Uint8Array(MAP_W * MAP_H);
  /** Bit z set: the job room of zone z stands open (the Work Period, or someone still inside; derived by the simulation). A bigint: zones go past 31. */
  openRooms = 0n;
  /** 1 on water a takeover bridges (Irongate's drawbridge, P12): walkable while `riot`. */
  readonly bridge = new Uint8Array(MAP_W * MAP_H);
  /** Derived: 1 on doors shut for everyone but guards (the prison as built: inmates walk it, guards' eyes stop at it). */
  readonly doorShut = new Uint8Array(MAP_W * MAP_H);
  /** Delivery day (P18): 1 under the vehicle while it's in (solid for everyone, and it stops sight); derived by the simulation. */
  readonly parked = new Uint8Array(MAP_W * MAP_H);
  /** 1 on doors standing open for the delivery while it's in (for everyone); derived by the simulation. */
  readonly propped = new Uint8Array(MAP_W * MAP_H);
  /** Whether the delivery's vehicle is in (what `parked` shows), and whether its doors stand open (while it's in, and after it while the player is still on its side of them). */
  delivering = false;
  private proppedOn = false;
  /** 1 on the ground the delivery's propped doors lead to (from its tail, with them shut): worked out once. */
  private beyondTiles: Uint8Array | null = null;
  /** A door the player picked open (P22): it opens for them as their own key would (-1 none); derived by the simulation. */
  pickedDoor = -1;
  /** 1 on the checkpoint's way out (P24): its gates, and the drawbridge where it comes down for the player too. */
  readonly checkpoint = new Uint8Array(MAP_W * MAP_H);
  /** Waved through the checkpoint (P24): its way out open for the player alone; derived by the simulation. */
  waved = false;
  /** 1 on ground only the checkpoint's way out leads to (Irongate's rock outside the ferry gate, Shankton's gatehouse): worked out once. */
  private beyondGate: Uint8Array | null = null;
  /** 1 on the release's way out (P36): its doors, and the drawbridge where it comes down for the player too. */
  readonly release = new Uint8Array(MAP_W * MAP_H);
  /** Cleared for release (P36): its way out open for the player alone; derived by the simulation. */
  freed = false;
  /** Bumps on any tile change, so caches (paths, meshes) know to refresh. */
  rev = 0;

  constructor(readonly def: PrisonDef) {
    const g = this.ground;
    this.block = g.block;
    parseRows(def.ground).forEach((row, z) => {
      for (let x = 0; x < MAP_W; x++) {
        const l = LEGEND[row[x]];
        g.kind[z * MAP_W + x] = l.kind;
        g.key[z * MAP_W + x] = l.key ?? KEY.NONE;
      }
    });
    // Tunnels: solid earth until dug (and the prison's boulders, never). Vents: the prison's
    // duct picture. Roofs: over every building (walls and indoor floors), with the ladder's hatch.
    const under = this.layers[LAYER.UNDER];
    under.kind.fill(TILE.SOIL);
    if (def.under) {
      parseRows(def.under, UNDER_LEGEND).forEach((row, z) => {
        for (let x = 0; x < MAP_W; x++) under.kind[z * MAP_W + x] = UNDER_LEGEND[row[x]];
      });
    }
    const vents = this.layers[LAYER.VENTS];
    if (def.vents) {
      parseRows(def.vents, VENT_LEGEND).forEach((row, z) => {
        for (let x = 0; x < MAP_W; x++) vents.kind[z * MAP_W + x] = VENT_LEGEND[row[x]];
      });
    }
    const roof = this.layers[LAYER.ROOF];
    for (let i = 0; i < TILES; i++) {
      const k = g.kind[i];
      if (k !== TILE.EMPTY && !TILE_INFO[k].outdoor) roof.kind[i] = vents.kind[i] === TILE.LADDER ? TILE.LADDER : TILE.ROOF;
    }
    for (const l of this.layers) l.base.set(l.kind);
    // Zones: road is outside, unlisted open ground is the perimeter, unlisted indoor tiles (doors,
    // walls) belong to none; then the rectangles, then the cells.
    for (let i = 0; i < MAP_W * MAP_H; i++) g.zone[i] = zoneIndex(g.kind[i] === TILE.ROAD ? 'outside' : TILE_INFO[g.kind[i]].outdoor ? 'perimeter' : 'none');
    for (const [id, x0, z0, x1, z1] of def.zones) this.fill(g.zone, x0, z0, x1, z1, zoneIndex(id));
    def.cells.forEach(([x0, z0, x1, z1], k) => {
      this.fill(g.zone, x0, z0, x1, z1, zoneIndex(k === 0 ? 'playerCell' : 'inmateCell'));
      this.fill(this.cellOf, x0, z0, x1, z1, k + 1);
    });
    if (def.drawbridge) this.fill(this.bridge, ...def.drawbridge, 1);
    for (const q of def.checkpoint?.gates ?? []) this.checkpoint[q.z * MAP_W + q.x] = 1;
    if (def.checkpoint?.bridge && def.drawbridge) this.fill(this.checkpoint, ...def.drawbridge, 1);
    for (const q of def.comms?.release.gates ?? []) this.release[q.z * MAP_W + q.x] = 1;
    if (def.comms?.release.bridge && def.drawbridge) this.fill(this.release, ...def.drawbridge, 1);
    this.props = def.props.map((p) => ({ kind: p.kind, x: p.x, z: p.z, w: p.w ?? 1, d: p.d ?? 1, rot: p.rot ?? 0 }));
    for (const p of this.props) if (PROPS[p.kind].solid) this.fill(this.propSolid, p.x, p.z, p.x + p.w - 1, p.z + p.d - 1, 1);
    // A cell's door is the door tile next to one of its tiles; its bed the bed inside it.
    def.cells.forEach((_, k) => {
      this.cellDoor.push(-1);
      this.cellBed.push(this.props.find((p) => p.kind === 'bed' && this.cellOf[p.z * MAP_W + p.x] === k + 1));
    });
    for (let z = 1; z < MAP_H - 1; z++) {
      for (let x = 1; x < MAP_W - 1; x++) {
        const i = z * MAP_W + x;
        if (g.kind[i] !== TILE.DOOR) continue;
        const c = Math.max(this.cellOf[i - 1], this.cellOf[i + 1], this.cellOf[i - MAP_W], this.cellOf[i + MAP_W]);
        this.doorCell[i] = c;
        if (c) this.cellDoor[c] = i;
        // Perimeter gates: as the prison lists them, else every door beside the road.
        if (def.gates ? def.gates.some((q) => q.z * MAP_W + q.x === i) : [i - 1, i + 1, i - MAP_W, i + MAP_W].some((j) => g.kind[j] === TILE.ROAD)) this.gate[i] = 1;
        for (const j of [i - 1, i + 1, i - MAP_W, i + MAP_W]) if (WORK_ZONES.has(ZONES[g.zone[j]])) this.doorRoom[i] = g.zone[j];
      }
    }
    this.refreshBlock();
  }

  get ground(): Layer {
    return this.layers[LAYER.GROUND];
  }

  /** What blocks a route the player is walked along on a layer (tap to walk, the bots): on the ground floor, mines too. */
  routeGrid(layer: number): Uint8Array {
    return layer === LAYER.GROUND ? this.routeBlock : this.layers[layer].block;
  }

  private fill(a: Uint8Array, x0: number, z0: number, x1: number, z1: number, v: number) {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) a[z * MAP_W + x] = v;
  }

  inside(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < MAP_W && z < MAP_H;
  }

  /** The zone name at a ground tile. */
  zoneAt(x: number, z: number): (typeof ZONES)[number] {
    return this.inside(x, z) ? ZONES[this.ground.zone[z * MAP_W + x]] : 'outside';
  }

  /** Locks and unlocks cells (bit c = cell c); recomputes what blocks walking when it changes. */
  setLockedCells(mask: bigint) {
    if (mask === this.lockedCells) return;
    this.lockedCells = mask;
    this.refreshBlock();
  }

  /** The keys the player carries (bit k = color k); doors follow when it changes. */
  setPlayerKeys(mask: number) {
    if (mask === this.playerKeys) return;
    this.playerKeys = mask;
    this.refreshBlock();
  }

  /** A door picked open for the player (P22), or none (-1); doors follow. */
  setPicked(tile: number) {
    if (tile === this.pickedDoor) return;
    this.pickedDoor = tile;
    this.refreshBlock();
  }

  /** Waved through the checkpoint or not (P24); its gates follow. */
  setWaved(on: boolean) {
    if (on === this.waved) return;
    this.waved = on;
    this.refreshBlock();
  }

  /** Cleared for release or not (P36); its doors follow. */
  setFreed(on: boolean) {
    if (on === this.freed) return;
    this.freed = on;
    this.refreshBlock();
  }

  /** The takeover on or over; doors follow. */
  setRiot(on: boolean) {
    if (on === this.riot) return;
    this.riot = on;
    this.refreshBlock();
  }

  /** Opens and shuts job rooms (bit z = zone z); recomputes what blocks walking when it changes. */
  setOpenRooms(mask: bigint) {
    if (mask === this.openRooms) return;
    this.openRooms = mask;
    this.refreshBlock();
  }

  /**
   * The delivery's vehicle in or gone (P18): its bay solid while it's in; its doors propped open
   * while it's in, and after it (that day) for as long as the player is still on its side of
   * them (`keep`: worked out from the state, so a game loaded there is the same; nobody is shut
   * out).
   */
  setDelivery(on: boolean, keep = false) {
    const open = on || keep;
    if (on === this.delivering && open === this.proppedOn) return;
    this.delivering = on;
    this.proppedOn = open;
    this.parked.fill(0);
    this.propped.fill(0);
    const d = this.def.delivery;
    if (on && d) this.fill(this.parked, ...d.bay, 1);
    if (open && d) for (const q of d.open ?? []) this.propped[q.z * MAP_W + q.x] = 1;
    this.refreshBlock();
  }

  /**
   * Whether a ground tile lies past the checkpoint (P24) where nothing but its way out leads
   * back: open ground next to its gates or drawbridge that can't be walked to from its window
   * with them shut (every other door open, as for a key). Waved through and standing there, the
   * player is never shut out.
   */
  pastCheckpoint(tile: number): boolean {
    const c = this.def.checkpoint;
    if (!c) return false;
    this.beyondGate ??= this.beyondWay(this.checkpoint, c.window);
    return this.beyondGate[tile] === 1;
  }

  /**
   * The open ground a way out (its tiles marked in `way`) touches that can't be walked to from
   * `home` with it shut (every other door open, as for a key), short of the road.
   */
  private beyondWay(way: Uint8Array, home: ReadonlyArray<{ x: number; z: number }>): Uint8Array {
    const g = this.ground;
    const walk = (j: number) => (g.kind[j] === TILE.DOOR || !TILE_INFO[g.kind[j]].solid) && !this.propSolid[j] && !way[j];
    const near = (t: number, x = t % MAP_W) =>
      [
        [t - 1, x > 0],
        [t + 1, x < MAP_W - 1],
        [t - MAP_W, t >= MAP_W],
        [t + MAP_W, t < MAP_W * (MAP_H - 1)],
      ] as const;
    // From home, with the way out shut.
    const reach = new Uint8Array(MAP_W * MAP_H);
    const queue = home.map((q) => q.z * MAP_W + q.x);
    for (const t of queue) reach[t] = 1;
    for (let k = 0; k < queue.length; k++) for (const [j, ok] of near(queue[k])) if (ok && !reach[j] && walk(j)) (reach[j] = 1), queue.push(j);
    // What the way out touches that home doesn't reach (short of the road).
    const out = new Uint8Array(MAP_W * MAP_H);
    const more: number[] = [];
    for (let i = 0; i < MAP_W * MAP_H; i++) if (way[i]) for (const [j, ok] of near(i)) if (ok && !reach[j] && !out[j] && walk(j) && ZONES[g.zone[j]] !== 'outside') (out[j] = 1), more.push(j);
    for (let k = 0; k < more.length; k++) for (const [j, ok] of near(more[k])) if (ok && !reach[j] && !out[j] && walk(j) && ZONES[g.zone[j]] !== 'outside') (out[j] = 1), more.push(j);
    return out;
  }

  /** The ground on foot from the player's cell or the road (afoot), and the rev it was worked out at. Not state. */
  private afootTiles: Uint8Array | null = null;
  private afootRev = -1;

  /**
   * Whether a ground tile can be walked to from the player's cell or from the road, as the tiles
   * are now (doors as open, a cut fence a way through; fences, walls and the sea in the way). A
   * glide (P24) never comes down where it's neither: between two fences, say.
   */
  afoot(tile: number): boolean {
    if (!this.afootTiles || this.afootRev !== this.rev) {
      const g = this.ground;
      const seen = this.afootTiles ?? new Uint8Array(MAP_W * MAP_H);
      seen.fill(0);
      const walk = (j: number) => g.kind[j] === TILE.DOOR || !TILE_INFO[g.kind[j]].solid;
      const queue: number[] = [];
      for (let i = 0; i < MAP_W * MAP_H; i++) if ((this.cellOf[i] === 1 || ZONES[g.zone[i]] === 'outside') && walk(i)) (seen[i] = 1), queue.push(i);
      for (let k = 0; k < queue.length; k++) {
        const t = queue[k];
        const x = t % MAP_W;
        for (const [j, ok] of [
          [t - 1, x > 0],
          [t + 1, x < MAP_W - 1],
          [t - MAP_W, t >= MAP_W],
          [t + MAP_W, t < MAP_W * (MAP_H - 1)],
        ] as const)
          if (ok && !seen[j] && walk(j)) (seen[j] = 1), queue.push(j);
      }
      this.afootTiles = seen;
      this.afootRev = this.rev;
    }
    return this.afootTiles[tile] === 1;
  }

  /** Whether a ground tile lies beyond the delivery's propped doors (where only they let the player out). */
  beyond(tile: number): boolean {
    const d = this.def.delivery;
    if (!d?.open?.length) return false;
    if (!this.beyondTiles) {
      // From the tail, over ground that's open with every door shut (the map as built).
      const g = this.ground;
      const seen = new Uint8Array(MAP_W * MAP_H);
      const start = d.tail.z * MAP_W + d.tail.x;
      const queue = [start];
      seen[start] = 1;
      for (let k = 0; k < queue.length; k++) {
        const t = queue[k];
        const x = t % MAP_W;
        for (const [j, ok] of [
          [t - 1, x > 0],
          [t + 1, x < MAP_W - 1],
          [t - MAP_W, t >= MAP_W],
          [t + MAP_W, t < MAP_W * (MAP_H - 1)],
        ] as const) {
          if (!ok || seen[j]) continue;
          const kind = g.kind[j];
          if (kind === TILE.DOOR || TILE_INFO[kind].solid || this.propSolid[j]) continue;
          seen[j] = 1;
          queue.push(j);
        }
      }
      this.beyondTiles = seen;
    }
    return this.beyondTiles[tile] === 1;
  }

  /** Recomputes what blocks walking (call when door rules or tiles change). */
  refreshBlock() {
    const g = this.ground;
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      const k = g.kind[i];
      const room = this.doorRoom[i];
      const shut = k === TILE.DOOR && !this.propped[i] && !doorOpen(g.key[i], this.doorCell[i], this.lockedCells) && !(room && ((this.openRooms >> BigInt(room)) & 1n) === 1n);
      this.doorShut[i] = shut ? 1 : 0;
      // A key of the door's color opens it for the player (never a perimeter gate); in a takeover every door does.
      // (P22: and the door the player picked, as their own key would.)
      // (P24: waved through the checkpoint, its gates open for the player too.)
      // (P36: cleared for release, its doors open for the player too.)
      const waved = (this.waved && this.checkpoint[i] === 1) || (this.freed && this.release[i] === 1);
      const keyed = shut && (this.riot || waved || (!this.gate[i] && (((this.playerKeys >> g.key[i]) & 1) === 1 || i === this.pickedDoor)));
      // The drawbridge (P12) is down while the prison is the inmates' (P24: and for the player waved through).
      const lowered = this.riot && this.bridge[i] === 1;
      const solid = k === TILE.DOOR ? shut && !keyed : TILE_INFO[k].solid && !lowered && !(waved && this.bridge[i]);
      this.block[i] = solid || this.propSolid[i] || this.parked[i] ? 1 : 0;
      // Damage is the player's way: inmates and guards walk the prison as it was built (doors too).
      const damage = DAMAGE_SHOWS.has(k) ? 1 : 0;
      // Nobody walks into a minefield on purpose: inmates, guards, and the player's routes keep out (P11).
      const mine = k === TILE.MINE ? 1 : 0;
      // (The drawbridge lowered for the player alone stays water to everyone else.)
      const own = waved && k !== TILE.DOOR && this.bridge[i] && !lowered ? 1 : 0;
      this.npcBlock[i] = (k === TILE.DOOR ? (shut || this.propSolid[i] ? 1 : 0) : this.block[i] | own) | damage | mine;
      this.guardBlock[i] = (k !== TILE.DOOR && TILE_INFO[k].solid) || this.propSolid[i] || this.parked[i] || damage || mine ? 1 : 0;
      this.routeBlock[i] = this.block[i] | mine;
    }
    for (const l of [this.layers[LAYER.UNDER], this.layers[LAYER.VENTS], this.layers[LAYER.ROOF]]) {
      for (let i = 0; i < TILES; i++) l.block[i] = TILE_INFO[l.kind[i]].solid ? 1 : 0;
    }
    this.rev++;
  }

  /** Changes a tile (digging, chipping, covering, repairs); everything derived follows. */
  setKind(layer: number, i: number, kind: number) {
    if (this.layers[layer].kind[i] === kind) return;
    this.layers[layer].kind[i] = kind;
    this.refreshBlock();
  }

  /** Can't stand on this tile (anything off the map is blocked); the ground floor unless a layer is given. */
  blocked(x: number, z: number, layer: number = LAYER.GROUND): boolean {
    return !this.inside(x, z) || this.layers[layer].block[z * MAP_W + x] === 1;
  }
}
