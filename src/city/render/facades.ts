import * as THREE from 'three';
import { box, type Part } from '../../render/kit';
import { seeThrough } from '../../render/occlusion';
import { mix32 } from '../../sim/rng';
import { MAP_H, MAP_W } from '../../sim/world/grid';
import { TILE } from '../../sim/world/tiles';
import type { World } from '../../sim/world/World';
import { isBuilding, type LotUse } from '../content/districts';
import { WINDOWED } from '../content/light';
import type { District, Lot } from '../gen/district';
import { townOf } from '../town';
import { CITY_TEX } from './cityTex';

/**
 * A city's buildings, dressed as what they are (2.57, the user's "more a city and not the prison"): each
 * lot's walls in its own material and colour (painted boards for a house, render for a shop, sheet metal
 * for a shed, cast panels for an office), its wall tops the colour of its roof, so a block reads from
 * above as a row of different buildings with their roofs off; windows in the faces the camera sees (glass
 * where the rules let the daylight in, boarded or shuttered where they don't), and what stands on a roof's
 * edge. Render only: reads the district, changes nothing; every choice is hashed from the lot's place.
 */
type Style = 'siding' | 'stucco' | 'metal' | 'panel';
interface Look {
  style: Style;
  walls: readonly number[];
  caps: readonly number[];
}
const HOME: Look = {
  style: 'siding',
  walls: [0xe9dfc8, 0xc6d3da, 0xc8d6ba, 0xe3bea9, 0xe6d3a4, 0xcfcac2, 0xd8b3ad, 0xb7c9b6, 0xeee8da],
  caps: [0x935644, 0x687480, 0x7d6048, 0x6c7a60, 0x84483f, 0x625c58],
};
const TRADE: Look = {
  style: 'stucco',
  walls: [0xe6dcc8, 0xdccba6, 0xd2d8d6, 0xdcbca2, 0xc8d6c8, 0xe2d2b8],
  caps: [0x94503f, 0x3f7d76, 0x8b7748, 0x566a8c, 0x7a5a78, 0x5e7a52],
};
const WORK: Look = { style: 'panel', walls: [0xa8b2ba, 0xb6b6ae, 0x98a4b2, 0xbcb2a4], caps: [0x7f858d, 0x8d8a84, 0x6f7781] };
const SHED: Look = { style: 'metal', walls: [0x94685a, 0x7d8d98, 0x889882, 0xa6a298, 0x8c7f6a], caps: [0x6d737a, 0x776a5f, 0x5f666d] };
const LOOKS: Partial<Record<LotUse, Look>> = {
  house: HOME,
  shop: TRADE,
  office: WORK,
  warehouse: SHED,
  garage: SHED,
  clinic: { style: 'stucco', walls: [0xe6e8e6], caps: [0x6aa8a2] },
  // The landmarks, each in its own colours (their models stand on them: render/landmarks.ts).
  station: { style: 'metal', walls: [0xe4e0d8], caps: [0xc97c2e] },
  tower: { style: 'panel', walls: [0x93a3b8], caps: [0x56627a] },
  factory: { style: 'metal', walls: [0x9a6048], caps: [0x5c5551] },
  hospital: { style: 'stucco', walls: [0xeceeed], caps: [0xb9c6cb] },
  boathouse: { style: 'siding', walls: [0xb89466], caps: [0x3f6d88] },
  rangers: { style: 'siding', walls: [0x8fa474], caps: [0x5a4a36] },
  mall: { style: 'stucco', walls: [0xe2d8c0], caps: [0x45a096] },
  police: { style: 'panel', walls: [0x9aa6b8], caps: [0x3f58a0] },
  metro: { style: 'panel', walls: [0xb6b2a6], caps: [0xb39630] },
};
/** A room's walls inside a building: pale plaster, whatever its outside. */
const INNER = 0xe4ded2;
const INNER_CAP = 0xcbc5b9;

const hashOf = (district: District, l: Lot) =>
  mix32(Math.imul(l.x0 + 1, 73856093) ^ Math.imul(l.z0 + 1, 19349663) ^ Math.imul(district.index + 1, 83492791));

export interface Facade {
  style: Style;
  wall: number;
  cap: number;
  /** Its frames, sills and door: the wall's colour, darker. */
  trim: number;
}
export function facadeOf(district: District, lot: number): Facade | null {
  const l = district.lots[lot];
  const look = l && LOOKS[l.use];
  if (!look) return null;
  const h = hashOf(district, l);
  const wall = look.walls[h % look.walls.length];
  return {
    style: look.style,
    wall,
    cap: look.caps[(h >>> 8) % look.caps.length],
    trim: new THREE.Color(wall).multiplyScalar(0.55).getHex(),
  };
}
const outer = (l: Lot, x: number, z: number) => x === l.x0 || x === l.x1 || z === l.z0 || z === l.z1;

/** Which wall tiles are a building's, and what each wears: its faces by material, its top (2.57; `tint`: a colour over the pale texture). */
export function cityWallCells(
  world: World,
): { byStyle: Map<Style, Array<[number, number]>>; tops: Array<[number, number]>; taken: Uint8Array } | null {
  const district = townOf(world);
  if (!district?.lots.length) return null;
  const taken = new Uint8Array(MAP_W * MAP_H);
  const byStyle = new Map<Style, Array<[number, number]>>();
  const tops: Array<[number, number]> = [];
  const looks = district.lots.map((_, k) => facadeOf(district, k));
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const lot = district.lotAt[i] - 1;
    const f = looks[lot];
    if (world.ground.base[i] !== TILE.BRICK || !f) continue;
    taken[i] = 1;
    const out = outer(district.lots[lot], i % MAP_W, Math.floor(i / MAP_W));
    const style = out ? f.style : 'stucco';
    if (!byStyle.has(style)) byStyle.set(style, []);
    byStyle.get(style)!.push([i, out ? f.wall : INNER]);
    tops.push([i, out ? f.cap : INNER_CAP]);
  }
  return { byStyle, tops, taken };
}

/**
 * The walls of a district's buildings: an instanced mesh a material for their faces, one for all their
 * tops, each tile tinted. `taken`: the wall tiles drawn here (the prisons' brick keeps the rest: none,
 * in a district; all, under the city, where nothing is a lot). Null where the world is no district.
 */
export function buildCityWalls(world: World, block: THREE.BufferGeometry): { meshes: THREE.InstancedMesh[]; taken: Uint8Array } | null {
  const cells = cityWallCells(world);
  if (!cells) return null;
  const { byStyle, tops, taken } = cells;
  // (wallBlock's two groups, each its own geometry: a face and a top take different colours.)
  const index = Array.from(block.index!.array);
  const part = (g: { start: number; count: number }) => {
    const geo = block.clone();
    geo.setIndex(index.slice(g.start, g.start + g.count));
    geo.clearGroups();
    return geo;
  };
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  const height = (block.boundingBox ?? block.computeBoundingBox() ?? block.boundingBox)!;
  const y = (height.max.y - height.min.y) / 2;
  const mesh = (geo: THREE.BufferGeometry, map: THREE.Texture, cells: Array<[number, number]>) => {
    const m = new THREE.InstancedMesh(geo, seeThrough(new THREE.MeshStandardMaterial({ map, roughness: 0.9 })), cells.length);
    cells.forEach(([i, tint], k) => {
      m.setMatrixAt(k, matrix.makeTranslation((i % MAP_W) + 0.5, y, Math.floor(i / MAP_W) + 0.5));
      // (A shade of its own a tile, as the floors have: a long wall isn't one printed strip.)
      const v = 0.94 + ((mix32(i * 2654435761) % 1000) / 1000) * 0.08;
      m.setColorAt(k, color.setHex(tint).multiplyScalar(v));
    });
    m.castShadow = m.receiveShadow = true;
    return m;
  };
  const meshes = [...byStyle].map(([style, cells]) => mesh(part(block.groups[0]), CITY_TEX[style](), cells));
  if (tops.length) meshes.push(mesh(part(block.groups[1]), CITY_TEX.cap(), tops));
  return { meshes, taken };
}

/** The floor a district's open tile wears: tarmac on its streets and car parks, slabs on its pavements, stone on a square. Null: the prisons' own. */
export function cityFloor(world: World, x: number, z: number): THREE.Texture | null {
  const district = townOf(world);
  if (!district?.lots.length) return null;
  const i = z * MAP_W + x;
  const k = world.ground.base[i];
  if (k === TILE.ROAD) return CITY_TEX.road();
  if (k === TILE.DIRT && district.lots[district.lotAt[i] - 1]?.use === 'yard') return CITY_TEX.yard();
  if (k !== TILE.ASPHALT) return null;
  const use = district.lots[district.lotAt[i] - 1]?.use;
  return use === 'parking' ? CITY_TEX.road() : use === 'plaza' ? CITY_TEX.plaza() : CITY_TEX.pavement();
}

/** A street door's leaf and the band across it, by what it opens on: painted wood for a house, glass and steel for a shop, a shed's grey. Null: the prisons' own. */
export function cityDoor(world: World, i: number): { leaf: number; band: number } | null {
  const district = townOf(world);
  if (!district?.lots.length) return null;
  const lot = district.lotAt[i] - 1;
  const f = facadeOf(district, lot);
  if (!f) return null;
  const l = district.lots[lot];
  // (A room's door inside: pale wood.)
  if (!outer(l, i % MAP_W, Math.floor(i / MAP_W))) return { leaf: 0xb89a70, band: 0x8a7350 };
  const h = hashOf(district, l);
  if (f.style === 'siding') return { leaf: [0x7a4a34, 0x3f6a58, 0x8a3a34, 0x39557a, 0x6a5a44][(h >>> 16) % 5], band: 0xd8c9a0 };
  if (f.style === 'metal') return { leaf: 0x8d9299, band: 0x5d6269 };
  return { leaf: 0x7f8f9c, band: f.cap };
}

const GLASS = 0x263442;
const BROKEN = 0x12161b;
const BOARD = 0x8a6a44;
const SHUTTER = 0x7d8288;
const WALL_TOP = 1.4;

/** A window in a wall's face, built looking south (+z) from the tile's middle: its frame and sill, then glass, boards or a shutter. */
function windowParts(kind: 'glass' | 'boards' | 'shutter' | 'band', trim: number, h: number, wide: boolean): Part[] {
  const w = wide ? 0.84 : 0.52;
  const z = 0.5;
  if (kind === 'band')
    return [box(1, 0.34, 0.03, GLASS, 0, 0.62, z), box(1, 0.03, 0.05, trim, 0, 0.59, z), box(1, 0.03, 0.05, trim, 0, 0.96, z)];
  const out: Part[] = [box(w + 0.1, 0.5, 0.03, trim, 0, 0.5, z), box(w + 0.16, 0.04, 0.09, trim, 0, 0.47, z + 0.02)];
  if (kind === 'glass') {
    out.push(box(w, 0.4, 0.045, h & 3 ? GLASS : BROKEN, 0, 0.55, z));
    out.push(box(0.03, 0.4, 0.055, trim, 0, 0.55, z), box(w, 0.03, 0.055, trim, 0, 0.74, z));
    // (A pane left of a broken one, askew.)
    if (!(h & 3)) out.push(box(w * 0.3, 0.16, 0.05, GLASS, -w * 0.3, 0.56, z));
  } else if (kind === 'boards') {
    out.push(box(w, 0.4, 0.04, BROKEN, 0, 0.55, z));
    for (let k = 0; k < 3; k++) {
      const p = box(w + 0.14, 0.09, 0.03, k === 1 ? 0x7a5c3a : BOARD, 0, 0, 0);
      p.rotateZ((((h >>> (k * 3)) & 7) - 3.5) * 0.035);
      p.translate(0, 0.6 + k * 0.13, z + 0.035);
      out.push(p);
    }
  } else {
    out.push(box(w, 0.42, 0.045, SHUTTER, 0, 0.54, z));
    for (let k = 0; k < 4; k++) out.push(box(w, 0.015, 0.055, 0x5f646a, 0, 0.6 + k * 0.09, z));
  }
  return out;
}

/** What stands on a roof's edge, on the middle of a wall tile's top. */
function roofThing(use: LotUse, h: number): Part[] {
  if (use === 'house' || use === 'rangers' || use === 'boathouse')
    return h & 1
      ? [
          box(0.34, 0.46, 0.34, 0x8a5444, 0, WALL_TOP, 0),
          box(0.42, 0.06, 0.42, 0x5a5350, 0, WALL_TOP + 0.46, 0),
          box(0.2, 0.1, 0.2, 0x2a2624, 0, WALL_TOP + 0.52, 0),
        ]
      : [
          box(0.04, 0.5, 0.04, 0x8b9098, 0, WALL_TOP, 0),
          box(0.5, 0.03, 0.03, 0x8b9098, 0, WALL_TOP + 0.44, 0),
          box(0.34, 0.03, 0.03, 0x8b9098, 0, WALL_TOP + 0.34, 0),
        ];
  if (use === 'warehouse' || use === 'garage' || use === 'factory')
    return [box(0.3, 0.2, 0.3, 0x80868d, 0, WALL_TOP, 0), box(0.4, 0.05, 0.4, 0x5d6269, 0, WALL_TOP + 0.24, 0)];
  // (A cooling unit: its case, its grille, its fan's dark round.)
  return [
    box(0.56, 0.3, 0.44, 0xa4a9af, 0, WALL_TOP, 0),
    box(0.5, 0.02, 0.38, 0x3a3f45, 0, WALL_TOP + 0.3, 0),
    box(0.58, 0.05, 0.46, 0x7d8288, 0, WALL_TOP, 0),
  ];
}

/**
 * The windows of every building's south, east and west faces (the north one is never seen from this
 * camera), a coloured fascia over a shop's front, and a thing or two on each roof's edge. Parts in the
 * district's own space, for one merged mesh.
 */
export function facadeParts(district: District): Part[] {
  const parts: Part[] = [];
  const wallAt = (x: number, z: number) => district.rows[z]?.[x] === '#';
  const place = (made: Part[], x: number, z: number, angle: number) => {
    for (const p of made) {
      if (angle) p.rotateY(angle);
      p.translate(x + 0.5, 0, z + 0.5);
      parts.push(p);
    }
  };
  district.lots.forEach((l, k) => {
    const f = facadeOf(district, k);
    if (!f || !isBuilding(l.use)) return;
    const lh = hashOf(district, l);
    const light = WINDOWED.includes(l.use);
    // (A shop's front: wide panes; an office's: a band of glass along it; a shed's: one small pane in three.)
    const every = f.style === 'metal' ? 3 : 2;
    const kindAt = (h: number) =>
      light ? 'glass' : f.style === 'panel' ? (h & 4 ? 'boards' : 'glass') : f.style === 'metal' ? 'glass' : h & 8 ? 'boards' : 'shutter';
    const face = (x: number, z: number, n: number, angle: number, front: boolean) => {
      if (!wallAt(x, z)) return;
      const h = mix32(lh ^ Math.imul(x * 64 + z + 1, 0x9e3779b1));
      if (f.style === 'panel' && !light) {
        // (An office: glass all along, a pane in six boarded over.)
        place(windowParts(h % 6 ? 'band' : 'boards', f.trim, h, false), x, z, angle);
        return;
      }
      if (n % every !== 1) return;
      place(windowParts(kindAt(h), f.trim, h, front && f.style === 'stucco'), x, z, angle);
    };
    // (Corners keep clear: a pane never wraps one.)
    for (let x = l.x0 + 1; x < l.x1; x++) face(x, l.z1, x - l.x0, 0, true);
    for (let z = l.z0 + 1; z < l.z1; z++) {
      face(l.x1, z, z - l.z0, Math.PI / 2, false);
      face(l.x0, z, z - l.z0, -Math.PI / 2, false);
    }
    // A shop's fascia: a band of its roof's colour along the top of its front.
    if (f.style === 'stucco') {
      const w = l.x1 - l.x0 + 1;
      parts.push(box(w, 0.2, 0.04, f.cap, l.x0 + w / 2, WALL_TOP - 0.24, l.z1 + 1.01));
    }
    // On the roof's edge, along the back wall and at its corners (clear of what the camera looks down into).
    const things = Math.max(1, Math.floor((l.x1 - l.x0) / 5));
    for (let t = 0; t < things; t++) {
      const h = mix32(lh ^ Math.imul(t + 7, 0x85ebca6b));
      const x = l.x0 + 1 + (h % Math.max(1, l.x1 - l.x0 - 1));
      if (wallAt(x, l.z0)) place(roofThing(l.use, h >>> 5), x, l.z0, ((h >>> 9) & 1) * (Math.PI / 2));
    }
  });
  return parts;
}
