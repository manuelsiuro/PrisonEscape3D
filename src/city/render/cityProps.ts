import type * as THREE from 'three';
import { box, cyl, merge, type Part } from '../../render/kit';
import { mix32 } from '../../sim/rng';
import { MAP_W } from '../../sim/world/grid';
import type { World } from '../../sim/world/World';
import { townOf } from '../town';

/**
 * A city's furniture (2.57): the same pieces the prisons have, on the same tiles, drawn as what a home, a
 * shop or a shed would hold: a bed with a quilt and a headboard instead of a cell's cot, a ward's bed on
 * its white frame, a grocer's racks half emptied, a shed's pallet racking, crates nailed shut, a table
 * laid with a cloth, an armchair, a shop's till. Render only: a piece's kind, tile and size are the
 * generator's; a police station keeps its cots. Null: the prisons' own model.
 */
const WOOD = 0x9a7450;
const WOOD_DARK = 0x6e5138;
const STEEL = 0xaab0b8;
const WHITE = 0xf2f0ea;
const QUILTS = [0xa8443c, 0x3f6a8c, 0x5f7f4c, 0xb8943c, 0x7a5c8c, 0x4f8a86];
const TINS = [0xb8463a, 0x3f78a8, 0x5c9a52, 0xd8b23c, 0xd8d2c0, 0x8a5a9a, 0xc9742e];

const legs = (w: number, d: number, h: number, color: number, t = 0.07): Part[] =>
  [-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(t, h, t, color, sx * (w / 2 - t / 2), 0, sz * (d / 2 - t / 2))));

/** A home's bed, its head to the north (−z): a wooden frame and headboard, a white sheet, a quilt, a pillow. */
function homeBed(w: number, d: number, v: number): Part[] {
  const quilt = QUILTS[v % QUILTS.length];
  return [
    box(w - 0.1, 0.24, d - 0.1, WOOD_DARK, 0, 0, 0),
    box(w - 0.06, 0.62, 0.08, WOOD, 0, 0, -d / 2 + 0.08),
    box(w - 0.06, 0.34, 0.06, WOOD, 0, 0, d / 2 - 0.07),
    box(w - 0.16, 0.14, d - 0.2, WHITE, 0, 0.24, 0),
    box(w - 0.12, 0.05, d * 0.6, quilt, 0, 0.38, d * 0.17),
    box(w - 0.12, 0.03, 0.12, WHITE, 0, 0.39, -d * 0.12),
    box(w - 0.34, 0.09, 0.26, 0xe8e2d2, 0, 0.38, -d / 2 + 0.32),
  ];
}
/** A ward's bed: a white tube frame on castors, a rail at the head, a pale green blanket. */
function wardBed(w: number, d: number): Part[] {
  return [
    ...legs(w - 0.16, d - 0.12, 0.3, STEEL, 0.05),
    box(w - 0.14, 0.05, d - 0.1, STEEL, 0, 0.3, 0),
    box(w - 0.18, 0.12, d - 0.16, WHITE, 0, 0.35, 0),
    box(w - 0.18, 0.03, d * 0.55, 0xa8cdbf, 0, 0.47, d * 0.18),
    box(w - 0.36, 0.08, 0.26, WHITE, 0, 0.47, -d / 2 + 0.3),
    box(0.04, 0.4, 0.04, STEEL, -(w - 0.16) / 2, 0.35, -d / 2 + 0.08),
    box(0.04, 0.4, 0.04, STEEL, (w - 0.16) / 2, 0.35, -d / 2 + 0.08),
    box(w - 0.16, 0.04, 0.04, STEEL, 0, 0.72, -d / 2 + 0.08),
  ];
}
/** A grocer's rack against the wall: a pale steel back, three shelves, what the looters left on them. */
function shopShelf(w: number, d: number, v: number): Part[] {
  const out = [box(w - 0.04, 1.25, 0.06, 0xd8dade, 0, 0, -d / 2 + 0.1), box(w - 0.04, 0.1, d - 0.5, 0x8d9299, 0, 0, -0.2)];
  for (let row = 0; row < 3; row++) {
    const y = 0.3 + row * 0.36;
    out.push(box(w - 0.06, 0.03, d - 0.52, 0xc4c8ce, 0, y, -0.2));
    for (let k = 0; k < Math.round(w * 5); k++) {
      const h = mix32(v * 131 + row * 17 + k);
      // (Half the places bare: it has been gone through.)
      if (h & 1) continue;
      const tall = 0.1 + ((h >> 3) & 3) * 0.04;
      const x = -w / 2 + 0.13 + k * 0.19;
      out.push(
        h & 4
          ? cyl(0.06, tall, TINS[(h >> 6) % TINS.length], x, y + 0.03, -0.12, 7)
          : box(0.13, tall + 0.04, 0.1, TINS[(h >> 6) % TINS.length], x, y + 0.03, -0.12),
      );
    }
  }
  return out;
}
/** A shed's racking: blue uprights, orange beams, boxes and a gap. */
function rack(w: number, v: number): Part[] {
  const out: Part[] = [];
  for (const sx of [-1, 1]) for (const sz of [-0.36, -0.06]) out.push(box(0.06, 1.3, 0.06, 0x3f5f8f, sx * (w / 2 - 0.06), 0, sz));
  for (let row = 0; row < 3; row++) {
    const y = 0.08 + row * 0.42;
    out.push(
      box(w - 0.08, 0.05, 0.05, 0xd0762e, 0, y, -0.06),
      box(w - 0.08, 0.05, 0.05, 0xd0762e, 0, y, -0.36),
      box(w - 0.14, 0.02, 0.32, 0x9a8a6a, 0, y + 0.05, -0.21),
    );
    for (let k = 0; k < 2; k++) {
      const h = mix32(v * 97 + row * 13 + k);
      if (h % 3 === 0) continue;
      out.push(
        box(
          0.3 + ((h >> 4) & 3) * 0.03,
          0.2 + ((h >> 7) & 3) * 0.04,
          0.26,
          h & 8 ? 0xb8905c : 0xa67f4e,
          (k ? 0.2 : -0.2) * w,
          y + 0.07,
          -0.21,
        ),
      );
    }
  }
  return out;
}
/** Shipping crates nailed shut, or cartons stacked. */
function cityCrate(v: number): Part[] {
  if (v & 1)
    return [
      box(0.5, 0.34, 0.42, 0xb8905c, -0.1, 0, 0.04),
      box(0.36, 0.28, 0.34, 0xa67f4e, 0.2, 0, -0.14),
      box(0.4, 0.26, 0.36, 0xc09a66, -0.08, 0.34, 0.02),
      box(0.5, 0.012, 0.08, 0xd8c8a0, -0.1, 0.34, 0.04),
    ];
  return [
    box(0.72, 0.56, 0.6, 0x94714a, 0, 0, 0),
    box(0.76, 0.06, 0.64, 0x6e5236, 0, 0, 0),
    box(0.76, 0.06, 0.64, 0x6e5236, 0, 0.5, 0),
    box(0.06, 0.56, 0.64, 0x6e5236, -0.35, 0, 0),
    box(0.06, 0.56, 0.64, 0x6e5236, 0.35, 0, 0),
    box(0.3, 0.14, 0.02, 0x3a3028, 0, 0.22, 0.31),
  ];
}
/** A home's table: a cloth over it, a plate and a cup left where they were. */
function homeTable(w: number, d: number, v: number): Part[] {
  const cloth = [0xd8d2c0, 0xb8463a, 0x5f8f9a, 0xc9b25c][v % 4];
  return [
    ...legs(w - 0.14, d - 0.24, 0.46, WOOD_DARK),
    box(w - 0.06, 0.05, d - 0.16, WOOD, 0, 0.46, 0),
    box(w - 0.3, 0.012, d - 0.1, cloth, 0, 0.51, 0),
    cyl(0.1, 0.015, WHITE, -w * 0.18, 0.522, 0.04, 10),
    cyl(0.04, 0.07, 0xc9d2d8, w * 0.2, 0.522, -0.08, 8),
  ];
}
/** An armchair: a low seat, a back and two arms in worn cloth. */
function armchair(v: number): Part[] {
  const cloth = [0x7a5a4a, 0x4f6a5a, 0x6a5a7a, 0x8a7a5a][v % 4];
  return [
    box(0.56, 0.26, 0.5, cloth, 0, 0.04, 0.02),
    box(0.56, 0.5, 0.12, cloth, 0, 0.04, -0.22),
    box(0.1, 0.36, 0.46, cloth, -0.26, 0.04, 0.02),
    box(0.1, 0.36, 0.46, cloth, 0.26, 0.04, 0.02),
    box(0.36, 0.05, 0.34, 0xd8d2c0, 0, 0.3, 0.06),
  ];
}
/** A shop's counter: a wooden front, a pale top, the till with its drawer out. */
function shopCounter(w: number, d: number): Part[] {
  return [
    box(w - 0.04, 0.52, d - 0.3, 0x7a6248, 0, 0, -0.1),
    box(w, 0.05, d - 0.2, 0xd8d2c4, 0, 0.52, -0.06),
    box(0.3, 0.16, 0.26, 0x3a4048, w * 0.2, 0.57, -0.1),
    box(0.22, 0.1, 0.03, 0x9ad0b8, w * 0.2, 0.7, -0.2),
    box(0.26, 0.04, 0.16, 0x5d6269, w * 0.2, 0.57, 0.1),
  ];
}

const HOMES = ['house', 'boathouse', 'rangers'];
const SHOPS = ['shop', 'mall', 'station'];
const SHEDS = ['warehouse', 'garage', 'factory', 'boathouse'];
const WARDS = ['clinic', 'hospital'];

/** A piece's city model, and the name it is batched under (the same model drawn once, placed many times). */
export function cityProp(
  world: World,
  p: { kind: string; x: number; z: number },
  w: number,
  d: number,
): { key: string; make: () => THREE.BufferGeometry } | null {
  const district = townOf(world);
  if (!district?.lots.length) return null;
  const use = district.lots[district.lotAt[p.z * MAP_W + p.x] - 1]?.use ?? 'none';
  const v = mix32(Math.imul(p.z * MAP_W + p.x + 1, 0x9e3779b1) ^ district.index) % 6;
  const as = (name: string, variants: number, parts: (v: number) => Part[]) => {
    const n = v % variants;
    return { key: `city:${name}:${n}:${w}x${d}`, make: () => merge(parts(n)) };
  };
  switch (p.kind) {
    case 'bed':
      if (HOMES.includes(use)) return as('bed', 6, (n) => homeBed(w, d, n));
      if (WARDS.includes(use)) return as('ward', 1, () => wardBed(w, d));
      return null;
    case 'shelf':
      if (SHOPS.includes(use)) return as('rackShop', 4, (n) => shopShelf(w, d, n));
      if (SHEDS.includes(use)) return as('rackShed', 3, (n) => rack(w, n));
      return null;
    case 'crate':
      return as('crate', 2, cityCrate);
    case 'table':
      return HOMES.includes(use) ? as('table', 4, (n) => homeTable(w, d, n)) : null;
    case 'chair':
      return HOMES.includes(use) ? as('armchair', 4, armchair) : null;
    case 'counter':
      return SHOPS.includes(use) ? as('till', 1, () => shopCounter(w, d)) : null;
    default:
      return null;
  }
}
