import * as THREE from 'three';
import type { OutsideWorld } from '../sim/hunt/world';
import { TILE } from '../sim/world/tiles';
import { MAP_W } from '../sim/world/World';
import { box, kitMaterial, merge, paint, type Part } from './kit';
import { seeThrough } from './occlusion';

/**
 * The outside's buildings as buildings (P41 review: they were the prisons' brick blocks, flat grey
 * tops): the picture's `#` tiles cut into rectangles, each a house of the place's own kind, with
 * walls, a roof, windows, a door on the side its road or yard is, a chimney. The Center Perks farm
 * and its barn, the border post's timber huts in the snow, Shankton's sheds of corrugated iron,
 * San Pancho's adobe diner and motel with flat roofs, Irongate's terraces in harbour colours.
 * One-tile strips are garden and yard walls. Render only: the tiles stay the World's brick (solid,
 * opaque) as they were; WorldView leaves the outside's brick to this.
 */

/** A rectangle of building tiles (world tiles, corners included). */
interface Block {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

const WALL = 1.45;
/** A tile's own small number (stable between loads). */
const hash = (i: number, k: number) => {
  let h = Math.imul(i ^ (k * 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/**
 * The picture's building tiles cut into rectangles: houses first (from each free tile in turn, the
 * biggest rectangle at least 2 × 2 that starts there), then what's left as walls (runs along x, then
 * down), so a garden wall's end never takes a house's side with it.
 */
function blocksOf(o: OutsideWorld): Block[] {
  const kind = o.world.ground.base;
  const taken = new Uint8Array(kind.length);
  const free = (x: number, z: number) => x >= o.ox && z >= o.oz && x < o.ox + o.w && z < o.oz + o.h && kind[z * MAP_W + x] === TILE.BRICK && !taken[z * MAP_W + x];
  const out: Block[] = [];
  const take = (b: Block) => {
    for (let r = b.z0; r <= b.z1; r++) for (let c = b.x0; c <= b.x1; c++) taken[r * MAP_W + c] = 1;
    out.push(b);
  };
  for (let z = o.oz; z < o.oz + o.h; z++) {
    for (let x = o.ox; x < o.ox + o.w; x++) {
      if (!free(x, z)) continue;
      let best: Block | null = null;
      let area = 0;
      let x1 = x;
      while (free(x1 + 1, z)) x1++;
      // Each width from the run's full length down: as deep as it goes.
      for (let wx = x1; wx >= x + 1; wx--) {
        let z1 = z;
        const rowFree = (r: number) => {
          for (let c = x; c <= wx; c++) if (!free(c, r)) return false;
          return true;
        };
        while (rowFree(z1 + 1)) z1++;
        const a = (wx - x + 1) * (z1 - z + 1);
        if (z1 > z && a > area) {
          area = a;
          best = { x0: x, z0: z, x1: wx, z1 };
        }
      }
      if (best) take(best);
    }
  }
  for (let z = o.oz; z < o.oz + o.h; z++) {
    for (let x = o.ox; x < o.ox + o.w; x++) {
      if (!free(x, z)) continue;
      let x1 = x;
      while (free(x1 + 1, z)) x1++;
      let z1 = z;
      if (x1 === x) while (free(x, z1 + 1)) z1++;
      take({ x0: x, z0: z, x1, z1 });
    }
  }
  return out;
}

/** A gable roof: a triangular prism `span` wide and `rise` high, `len` long along x, its foot at y, centred on (x, z). */
function gable(span: number, rise: number, len: number, color: number, x: number, y: number, z: number, alongX: boolean): Part {
  const shape = new THREE.Shape([new THREE.Vector2(-span / 2, 0), new THREE.Vector2(span / 2, 0), new THREE.Vector2(0, rise)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  if (alongX) g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  g.clearGroups();
  paint(g, color);
  // The slope away from the sun a shade darker, so the ridge reads from above; the gable ends darker still.
  const n = g.attributes.normal;
  const c = g.attributes.color;
  for (let i = 0; i < n.count; i++) {
    const k = n.getY(i) < 0.1 ? 0.78 : (alongX ? n.getZ(i) : n.getX(i)) < 0 ? 0.8 : 1.04;
    c.setXYZ(i, Math.min(1, c.getX(i) * k), Math.min(1, c.getY(i) * k), Math.min(1, c.getZ(i) * k));
  }
  return g;
}

/** How a place builds (by the prison's look). */
interface Style {
  walls: readonly number[];
  roof: readonly number[];
  trim: number;
  door: number;
  /** Pitched (rise per tile of span) or flat (0: a parapet round a flat roof). */
  pitch: number;
  /** Snow on the roof (the Alps). */
  snow?: boolean;
  /** Corrugated sheds (ribs down the walls, a roller door). */
  shed?: boolean;
  /** Terraces: long rows cut into houses of 2–3 tiles, each its own colour. */
  terrace?: boolean;
}

const STYLES: Record<string, Style> = {
  suburban: { walls: [0xece3cf, 0xe2d6bc, 0xf2eee4], roof: [0x9a4a34, 0x5a5f68, 0x8a5a3c], trim: 0xffffff, door: 0x5a3a26, pitch: 0.55 },
  alpine: { walls: [0x7a5236, 0x8a6040, 0x6e4a30], roof: [0x3e3b3a, 0x4a3f38], trim: 0xe8e2d4, door: 0x3e2a1c, pitch: 0.8, snow: true },
  industrial: { walls: [0x8f979d, 0x7d8a92, 0x9a8f80, 0x6f7d86], roof: [0x5e666d, 0x6a6460], trim: 0xc8ccd0, door: 0x4e555c, pitch: 0.22, shed: true },
  desert: { walls: [0xd8b088, 0xe0bf98, 0xcf9f78], roof: [0xc79c74], trim: 0x8a5a36, door: 0x6a3f24, pitch: 0 },
  island: { walls: [0xe9d8b8, 0xc8dbe6, 0xe6c6c0, 0xd4e2c6, 0xf1e7c9, 0xb9c9d8], roof: [0x4f5863, 0x5a5550, 0x46505a], trim: 0xf6f4ee, door: 0x2f4f6e, pitch: 0.6, terrace: true },
};

/** The houses (one mesh, see-through over the player as trees are) and their windows (lit after dark: `glass` follows the night). */
export function buildHouses(o: OutsideWorld, theme: string): { group: THREE.Group; glass: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: 0x2a3440, roughness: 0.3, metalness: 0.2, emissive: 0xffc878, emissiveIntensity: 0 });
  const st = STYLES[theme] ?? STYLES.suburban;
  const parts: Part[] = [];
  const panes: Part[] = [];
  const lowWalls: Part[] = [];
  const kind = o.world.ground.kind;
  // Which side of a block its road or yard is (a door there): open walkable ground beside it, a road first; the south (the camera's side) when it's a tie.
  const open = (x: number, z: number) => {
    const k = kind[z * MAP_W + x];
    return k === TILE.ROAD || k === TILE.ASPHALT ? 2 : k === TILE.GRASS || k === TILE.DIRT ? 1 : 0;
  };
  const sideScore = (b: Block, side: number) => {
    let s = 0;
    if (side === 0) for (let x = b.x0; x <= b.x1; x++) s += open(x, b.z1 + 1) + open(x, b.z1 + 2);
    if (side === 1) for (let x = b.x0; x <= b.x1; x++) s += open(x, b.z0 - 1) + open(x, b.z0 - 2);
    if (side === 2) for (let z = b.z0; z <= b.z1; z++) s += open(b.x1 + 1, z) + open(b.x1 + 2, z);
    if (side === 3) for (let z = b.z0; z <= b.z1; z++) s += open(b.x0 - 1, z) + open(b.x0 - 2, z);
    return s / (side < 2 ? b.x1 - b.x0 + 1 : b.z1 - b.z0 + 1) + (side === 0 ? 1 : 0);
  };
  for (const b of blocksOf(o)) {
    const w = b.x1 - b.x0 + 1;
    const d = b.z1 - b.z0 + 1;
    if (w === 1 || d === 1) {
      // A garden or yard wall: low, capped.
      const cx = (b.x0 + b.x1 + 1) / 2;
      const cz = (b.z0 + b.z1 + 1) / 2;
      const color = theme === 'desert' ? 0xcfa47c : theme === 'industrial' ? 0x8a8a84 : 0x9c6b52;
      lowWalls.push(box(w - 0.1, 0.9, d - 0.1, color, cx, 0, cz), box(w + 0.02 - 0.1, 0.07, d + 0.02 - 0.1, theme === 'island' ? 0xd8d4cc : 0xb8b2a8, cx, 0.9, cz));
      continue;
    }
    const seed = b.z0 * MAP_W + b.x0;
    const doorSide = [0, 1, 2, 3].reduce((best, s) => (sideScore(b, s) > sideScore(b, best) ? s : best), 0);
    // A long row in a town is a terrace of houses side by side; elsewhere one building.
    const alongX = w >= d;
    const len = alongX ? w : d;
    const units: Array<[number, number]> = [];
    if (st.terrace && len >= 4) {
      let at = 0;
      let k = 0;
      while (at < len) {
        let size = 2 + Math.floor(hash(seed, 20 + k) * 2);
        if (len - at - size === 1) size++;
        if (len - at < size) size = len - at;
        units.push([at, size]);
        at += size;
        k++;
      }
    } else units.push([0, len]);
    // A big building out in the country is a barn (Center Perks), a long one in the yards a warehouse (Shankton: shed already).
    const barn = theme === 'suburban' && w * d >= 20;
    units.forEach(([at, size], k) => {
      const ux0 = alongX ? b.x0 + at : b.x0;
      const uz0 = alongX ? b.z0 : b.z0 + at;
      const uw = alongX ? size : w;
      const ud = alongX ? d : size;
      const cx = ux0 + uw / 2;
      const cz = uz0 + ud / 2;
      const pick = (list: readonly number[], salt: number) => list[Math.floor(hash(seed + k * 7, salt) * list.length)];
      const wallColor = barn ? 0x9b3b2e : pick(st.walls, 1);
      const roofColor = barn ? 0x4e5258 : pick(st.roof, 2);
      const h = WALL + (st.terrace ? (hash(seed + k, 3) - 0.5) * 0.3 : 0) + (st.shed ? 0.25 : 0);
      // The walls, a little in from the tile's edge, and a plinth.
      parts.push(box(uw - 0.08, h, ud - 0.08, wallColor, cx, 0, cz), box(uw - 0.02, 0.12, ud - 0.02, theme === 'alpine' ? 0x8f9196 : 0x8a847a, cx, 0, cz));
      if (st.shed) {
        // Corrugated: ribs down the long faces.
        for (let r = 0.25; r < (alongX ? uw : ud) - 0.1; r += 0.5) {
          if (alongX) parts.push(box(0.05, h - 0.12, 0.03, 0x6e767c, ux0 + r, 0.12, uz0 + ud - 0.03), box(0.05, h - 0.12, 0.03, 0x6e767c, ux0 + r, 0.12, uz0 + 0.03));
          else parts.push(box(0.03, h - 0.12, 0.05, 0x6e767c, ux0 + uw - 0.03, 0.12, uz0 + r), box(0.03, h - 0.12, 0.05, 0x6e767c, ux0 + 0.03, 0.12, uz0 + r));
        }
      }
      // The roof: a gable along the long side with eaves over the walls; flat with a parapet in the desert.
      const span = alongX ? ud : uw;
      if (st.pitch > 0) {
        const rise = Math.min(1.3, span * st.pitch * (barn ? 0.8 : 0.5));
        const long = (alongX ? uw : ud) + (units.length > 1 ? 0.02 : 0.24);
        parts.push(gable(span + 0.3, rise, long, roofColor, cx, h, cz, alongX));
        // A shed's skylights: pale panels down the sunny slope, every other tile.
        if (st.shed) {
          const half = (span + 0.3) / 2;
          const slope = Math.atan2(rise, half);
          for (let r = 1; r < long - 1; r += 2) {
            const g = new THREE.BoxGeometry(alongX ? 0.8 : 0.5, 0.03, alongX ? 0.5 : 0.8);
            if (alongX) g.rotateX(slope);
            else g.rotateZ(-slope);
            const t = half * 0.45;
            const y = h + rise * (1 - t / half) + 0.03;
            g.translate(alongX ? (alongX ? ux0 : cx) + r - (units.length > 1 ? 0 : 0.12) : cx + t, y, alongX ? cz + t : uz0 + r);
            parts.push(paint(g, 0xb8c8d2));
          }
        }
        // The ridge capped.
        parts.push(alongX ? box(long + 0.02, 0.07, 0.14, 0x3a3634, cx, h + rise - 0.05, cz) : box(0.14, 0.07, long + 0.02, 0x3a3634, cx, h + rise - 0.05, cz));
        if (st.snow) parts.push(gable(span + 0.32, rise * 0.45, (alongX ? uw : ud) + 0.26, 0xf2f6fb, cx, h + rise * 0.56, cz, alongX));
        // A chimney on most houses (not sheds or barns).
        if (!st.shed && !barn && hash(seed + k, 4) < 0.75) {
          const off = (hash(seed + k, 5) - 0.5) * (alongX ? uw : ud) * 0.6;
          parts.push(box(0.26, rise + 0.35, 0.26, theme === 'alpine' ? 0x6a6a6e : 0x8a5040, alongX ? cx + off : cx + span * 0.18, h + 0.05, alongX ? cz - span * 0.18 : cz + off));
        }
      } else {
        parts.push(box(uw - 0.08, 0.06, ud - 0.08, roofColor, cx, h, cz));
        for (const [pw, pd, px, pz] of [
          [uw - 0.08, 0.1, cx, uz0 + 0.09],
          [uw - 0.08, 0.1, cx, uz0 + ud - 0.09],
          [0.1, ud - 0.08, ux0 + 0.09, cz],
          [0.1, ud - 0.08, ux0 + uw - 0.09, cz],
        ] as const)
          parts.push(box(pw, 0.2, pd, wallColor, px, h, pz));
        // Roof beams poking out (vigas) along the front, and a water tank or a sign on the biggest.
        for (let r = 0.4; r < uw - 0.2; r += 0.7) parts.push(box(0.08, 0.08, 0.2, 0x7a5232, ux0 + r, h - 0.25, uz0 + ud + 0.02));
        if (uw * ud >= 20) parts.push(box(0.6, 0.5, 0.6, 0x9aa0a6, ux0 + uw - 0.8, h + 0.06, uz0 + 0.8));
      }
      // Windows on each face (a pane in a frame), but not where the door goes; the shed's high strip of them.
      const faces: Array<[number, number, number, number, boolean]> = [
        // [face, from, to, at, alongX]
        [0, ux0, ux0 + uw, uz0 + ud, true],
        [1, ux0, ux0 + uw, uz0, true],
        [2, uz0, uz0 + ud, ux0 + uw, false],
        [3, uz0, uz0 + ud, ux0, false],
      ];
      for (const [face, from, to, at, ax] of faces) {
        // (A terrace's houses have no windows into each other.)
        if (st.terrace && units.length > 1 && ((alongX && face >= 2 && ((face === 2 && k < units.length - 1) || (face === 3 && k > 0))) || (!alongX && face < 2 && ((face === 0 && k < units.length - 1) || (face === 1 && k > 0))))) continue;
        const n = to - from;
        const door = face === doorSide;
        const doorAt = from + n / 2 + (units.length > 1 ? 0 : (hash(seed, 6) - 0.5) * Math.max(0, n - 2) * 0.5);
        const out = face === 0 || face === 2 ? 0.03 : -0.03;
        for (let s = from + 0.5; s < to; s += 1) {
          if (door && Math.abs(s - doorAt) < (barn || st.shed ? 1 : 0.6)) continue;
          const y = st.shed ? h - 0.5 : 0.62;
          const ww = st.shed ? 0.7 : 0.4;
          const wh = st.shed ? 0.22 : 0.42;
          if (ax) {
            panes.push(box(ww, wh, 0.04, 0xffffff, s, y, at + out));
            parts.push(box(ww + 0.1, 0.06, 0.08, st.trim, s, y - 0.06, at + out));
          } else {
            panes.push(box(0.04, wh, ww, 0xffffff, at + out, y, s));
            parts.push(box(0.08, 0.06, ww + 0.1, st.trim, at + out, y - 0.06, s));
          }
          // An upstairs row on a tall terrace house.
          if (st.terrace && ax) panes.push(box(ww * 0.8, wh * 0.7, 0.04, 0xffffff, s, h - 0.42, at + out));
        }
        if (door) {
          const dw = st.shed ? 1.2 : barn ? 1.1 : 0.42;
          const dh = st.shed ? 1.05 : barn ? 1.15 : 0.86;
          const doorColor = st.shed ? 0x5a6066 : barn ? 0xe8e0d0 : st.terrace ? pick([0x2f4f6e, 0x7a2e2a, 0x2e5a3a, 0x3a3a40], 8) : st.door;
          if (ax) parts.push(box(dw, dh, 0.06, doorColor, doorAt, 0.08, at + out), box(dw + 0.12, 0.08, 0.1, st.trim, doorAt, 0.08 + dh, at + out));
          else parts.push(box(0.06, dh, dw, doorColor, at + out, 0.08, doorAt), box(0.1, 0.08, dw + 0.12, st.trim, at + out, 0.08 + dh, doorAt));
          // A step, and in the desert an awning over the door.
          if (ax) parts.push(box(dw + 0.2, 0.06, 0.24, 0x9a968c, doorAt, 0, at + out * 4));
          if (theme === 'desert' && ax) parts.push(box(dw + 1.4, 0.05, 0.6, 0xb5442e, doorAt, dh + 0.25, at + out * 10));
        }
      }
    });
  }
  const mat = seeThrough(kitMaterial.clone(), 0.3);
  if (parts.length) {
    const mesh = new THREE.Mesh(merge(parts), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (lowWalls.length) {
    const mesh = new THREE.Mesh(merge(lowWalls), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (panes.length) group.add(new THREE.Mesh(merge(panes, false), seeThrough(glass, 0.3)));
  return { group, glass };
}
