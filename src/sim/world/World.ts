import { PROPS, type PropKind } from '../../content/props';
import type { PrisonDef } from '../../content/prisons/types';
import { ZONES, zoneIndex } from '../../content/zones';
import { KEY, LEGEND, TILE, TILE_INFO } from './tiles';
import { doorOpen } from './doors';

export const MAP_W = 64;
export const MAP_H = 64;

/** Layers bottom to top (GDD §1.2). Index into World.layers. */
export const LAYER = { UNDER: 0, GROUND: 1, VENTS: 2, ROOF: 3 } as const;

/** One floor of the map: a typed array per field, indexed z * MAP_W + x. */
export class Layer {
  readonly kind = new Uint8Array(MAP_W * MAP_H);
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
export function parseRows(picture: string): string[] {
  const rows = picture.replace(/^\n+|\n+$/g, '').split('\n');
  if (rows.length !== MAP_H) throw new Error(`map has ${rows.length} rows, expected ${MAP_H}`);
  rows.forEach((r, z) => {
    if (r.length !== MAP_W) throw new Error(`map row ${z} is ${r.length} wide, expected ${MAP_W}`);
    for (let x = 0; x < MAP_W; x++) if (!LEGEND[r[x]]) throw new Error(`unknown map character '${r[x]}' at ${x},${z}`);
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
  /** Derived: 1 where the ground floor can't be walked on right now. */
  readonly block = new Uint8Array(MAP_W * MAP_H);
  /** Derived: the same for guards, whose keys open every door. */
  readonly guardBlock = new Uint8Array(MAP_W * MAP_H);
  /** Which cell (1–8) each ground tile belongs to, 0 outside cells. */
  readonly cellOf = new Uint8Array(MAP_W * MAP_H);
  /** On door tiles: the cell the door leads into (0 for other doors). */
  readonly doorCell = new Uint8Array(MAP_W * MAP_H);
  /** The tile index of each cell's door, by cell number (index 0 unused). */
  readonly cellDoor: number[] = [-1];
  /** Each cell's bed, by cell number (index 0 unused). */
  readonly cellBed: Array<Prop | undefined> = [undefined];
  /** Bit c set: cell c's door is locked (derived by the simulation from the routine). */
  lockedCells = 0;
  /** Bumps on any tile change, so caches (paths, meshes) know to refresh. */
  rev = 0;

  constructor(readonly def: PrisonDef) {
    const g = this.ground;
    parseRows(def.ground).forEach((row, z) => {
      for (let x = 0; x < MAP_W; x++) {
        const l = LEGEND[row[x]];
        g.kind[z * MAP_W + x] = l.kind;
        g.key[z * MAP_W + x] = l.key ?? KEY.NONE;
      }
    });
    // Zones: road is outside, unlisted open ground is the perimeter, unlisted indoor tiles (doors,
    // walls) belong to none; then the rectangles, then the cells.
    for (let i = 0; i < MAP_W * MAP_H; i++) g.zone[i] = zoneIndex(g.kind[i] === TILE.ROAD ? 'outside' : TILE_INFO[g.kind[i]].outdoor ? 'perimeter' : 'none');
    for (const [id, x0, z0, x1, z1] of def.zones) this.fill(g.zone, x0, z0, x1, z1, zoneIndex(id));
    def.cells.forEach(([x0, z0, x1, z1], k) => {
      this.fill(g.zone, x0, z0, x1, z1, zoneIndex(k === 0 ? 'playerCell' : 'inmateCell'));
      this.fill(this.cellOf, x0, z0, x1, z1, k + 1);
    });
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
      }
    }
    this.refreshBlock();
  }

  get ground(): Layer {
    return this.layers[LAYER.GROUND];
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
  setLockedCells(mask: number) {
    if (mask === this.lockedCells) return;
    this.lockedCells = mask;
    this.refreshBlock();
  }

  /** Recomputes what blocks walking (call when door rules or tiles change). */
  refreshBlock() {
    const g = this.ground;
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      const k = g.kind[i];
      const solid = k === TILE.DOOR ? !doorOpen(g.key[i], this.doorCell[i], this.lockedCells) : TILE_INFO[k].solid;
      this.block[i] = solid || this.propSolid[i] ? 1 : 0;
      this.guardBlock[i] = (k !== TILE.DOOR && TILE_INFO[k].solid) || this.propSolid[i] ? 1 : 0;
    }
    this.rev++;
  }

  /** Can't stand on this tile (anything off the map is blocked). */
  blocked(x: number, z: number): boolean {
    return !this.inside(x, z) || this.block[z * MAP_W + x] === 1;
  }
}
