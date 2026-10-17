import * as THREE from 'three';
import type { ItemDef } from '../content/items';
import { box, cyl, disc, merge, paint, rod, type Part } from './kit';

/**
 * Little models for items, built from kit parts by shape (content/items.ts `shape`), in
 * the item's colors. About 0.5 tiles long, lying flat on y = 0, centered. The same model
 * lies on the floor, sits in the hand and is photographed for the inventory icons.
 */
type Shape = (c: number, a: number) => Part[];

const METAL = 0x9aa2ad;
const DARK = 0x2b3038;

/** A ring lying flat (rope and wire coils). */
const ring = (r: number, tube: number, color: number, y: number) => paint(new THREE.TorusGeometry(r, tube, 6, 18).rotateX(Math.PI / 2).translate(0, y, 0), color);

/** A part rotated about y (radians), then moved. */
const turn = (p: Part, angle: number, x = 0, z = 0) => p.rotateY(angle).translate(x, 0, z);
/** A long stick along x: length, thickness, height of its middle. */
const stick = (len: number, r: number, color: number | string, x = 0, y = r, z = 0) => rod(r, len, color, x, y, z, 8);

const SHAPES: Record<string, Shape> = {
  comb: (c) => [box(0.42, 0.03, 0.08, c, 0, 0, -0.04), ...Array.from({ length: 9 }, (_, k) => box(0.025, 0.025, 0.1, c, -0.18 + k * 0.045, 0, 0.05))],
  brush: (c, a) => [box(0.42, 0.04, 0.05, c), box(0.09, 0.08, 0.06, a, 0.17, 0.03)],
  lighter: (c, a) => [box(0.12, 0.2, 0.06, c).rotateZ(Math.PI / 2).translate(0, 0.06, 0), box(0.06, 0.06, 0.065, a, 0.12, 0.0)],
  roll: (c) => [cyl(0.11, 0.16, c, 0, 0, 0, 14), cyl(0.04, 0.165, 0x8a6a4a, 0, 0, 0, 10)],
  tape: (c) => [cyl(0.13, 0.08, c, 0, 0, 0, 16), cyl(0.07, 0.085, 0xc8b89a, 0, 0, 0, 12)],
  tube: (c, a) => [box(0.32, 0.06, 0.1, c), box(0.06, 0.07, 0.07, a, 0.19, 0.0)],
  file: (c, a) => [box(0.3, 0.025, 0.06, c, 0.05), box(0.14, 0.05, 0.06, a, -0.17)],
  plank: (c) => [box(0.5, 0.06, 0.16, c), box(0.5, 0.005, 0.01, 0x8a5a2e, 0, 0.06, 0.03)],
  sheet: (c) => [box(0.42, 0.025, 0.32, c), box(0.4, 0.005, 0.3, 0xd8dde3, 0, 0.025)],
  /** A license plate: a rimmed rectangle, a row of stamped characters. */
  plate: (c, a) => [
    box(0.44, 0.02, 0.22, a),
    box(0.4, 0.024, 0.18, c),
    ...Array.from({ length: 6 }, (_, k) => box(0.035, 0.03, 0.09, a, -0.14 + k * 0.056, 0, 0)),
  ],
  crowbar: (c) => [stick(0.46, 0.025, c, 0.02), box(0.06, 0.05, 0.1, c, -0.22, 0, 0.04)],
  pillow: (c) => [box(0.4, 0.1, 0.26, c), box(0.36, 0.04, 0.22, 0xffffff, 0, 0.08)],
  cloth: (c) => [box(0.38, 0.06, 0.3, c), box(0.38, 0.03, 0.08, 0xe6ebf2, 0, 0.06, -0.11)],
  sock: (c) => [box(0.1, 0.06, 0.28, c, 0, 0, -0.04), box(0.18, 0.06, 0.1, c, 0.04, 0, 0.12), box(0.105, 0.065, 0.05, 0xd23f36, 0, 0, -0.16)],
  bar: (c, a) => [box(0.24, 0.07, 0.13, c), box(0.12, 0.072, 0.135, a ?? c, -0.05)],
  battery: (c, a) => [cyl(0.05, 0.22, c, 0, 0, 0, 12).rotateZ(Math.PI / 2).translate(0, 0.05, 0), box(0.06, 0.1, 0.1, a, 0.06, 0.0)],
  coil: (c) => [ring(0.13, 0.025, c, 0.025), ring(0.115, 0.025, c, 0.07), ring(0.13, 0.025, c, 0.115)],
  blade: (c) => [box(0.2, 0.01, 0.1, c), box(0.08, 0.012, 0.02, DARK)],
  jar: (c, a) => [cyl(0.08, 0.14, c, 0, 0, 0, 12), cyl(0.085, 0.04, a, 0, 0.14, 0, 12)],
  book: (c, a) => [box(0.3, 0.03, 0.22, c), box(0.18, 0.031, 0.06, a, 0, 0, -0.04)],
  bottle: (c, a) => [cyl(0.07, 0.24, c, 0, 0, 0, 12), cyl(0.04, 0.06, a, 0, 0.24, 0, 10)],
  blob: (c) => [box(0.2, 0.08, 0.16, c), box(0.12, 0.05, 0.12, c, 0.04, 0.06, -0.02)],
  handle: (c) => [stick(0.44, 0.035, c), box(0.08, 0.08, 0.08, 0x8a5a2e, 0.2, 0, 0)],
  cup: (c, a) => [cyl(0.08, 0.16, c, 0, 0, 0, 14), cyl(0.07, 0.01, a ?? c, 0, 0.155, 0, 14)],
  broom: (c, a) => [stick(0.5, 0.02, c, -0.05), box(0.1, 0.05, 0.22, a, 0.24, 0)],
  mop: (c, a) => [stick(0.5, 0.02, c, -0.05), box(0.1, 0.07, 0.2, a, 0.24, 0)],
  chunk: (c) => [box(0.2, 0.12, 0.16, c), box(0.12, 0.09, 0.1, 0x8a8f96, -0.08, 0.04, 0.06)],
  potato: (c) => [box(0.18, 0.1, 0.13, c), box(0.12, 0.08, 0.1, c, 0.06, 0.02, 0.02)],
  spoon: (c) => [stick(0.3, 0.015, c, -0.06), disc(0.05, 0.02, c, 0.13, 0.02, 0).rotateX(Math.PI / 2)],
  fork: (c) => [stick(0.28, 0.015, c, -0.07), box(0.08, 0.02, 0.07, c, 0.1), ...[-0.025, 0, 0.025].map((z) => box(0.08, 0.015, 0.012, c, 0.17, 0, z))],
  knife: (c) => [stick(0.18, 0.018, c, -0.1), box(0.2, 0.012, 0.045, c, 0.08)],
  trowel: (c, a) => [stick(0.16, 0.03, a, -0.14), box(0.24, 0.02, 0.12, c, 0.08)],
  shovel: (c, a) => [stick(0.4, 0.025, a, -0.08), box(0.16, 0.025, 0.18, c, 0.2), box(0.03, 0.04, 0.12, a, -0.28)],
  pickaxe: (c, a) => [stick(0.42, 0.025, a), box(0.06, 0.04, 0.36, c, 0.2)],
  cutters: (c, a) => [turn(box(0.36, 0.03, 0.04, a), 0.25, -0.02, 0.04), turn(box(0.36, 0.03, 0.04, a), -0.25, -0.02, -0.04), box(0.12, 0.04, 0.06, c, 0.19)],
  screwdriver: (c, a) => [box(0.14, 0.06, 0.06, a, -0.12), stick(0.24, 0.012, c, 0.07)],
  drill: (c, a) => [box(0.22, 0.12, 0.08, c, 0, 0.0), box(0.08, 0.16, 0.07, a, -0.06, 0.0).rotateZ(-0.2), stick(0.12, 0.012, METAL, 0.16, 0.08)],
  multitool: (c, a) => [box(0.24, 0.05, 0.08, c), box(0.18, 0.02, 0.03, a, 0.14, 0.03), box(0.12, 0.02, 0.03, a, -0.14, 0.03)],
  shiv: (c, a) => [box(0.18, 0.04, 0.06, c, -0.1), box(0.2, 0.015, 0.05, a, 0.09)],
  mace: (c, a) => [box(0.08, 0.06, 0.28, c, 0, 0, -0.06), box(0.16, 0.12, 0.14, a, 0, 0, 0.12)],
  bat: (c, a) => [rod(0.04, 0.24, c, -0.14, 0.05, 0, 8), rod(0.06, 0.28, c, 0.12, 0.06, 0, 10), box(0.04, 0.12, 0.12, a, 0.16, 0.0)],
  baton: (c, a) => [stick(0.46, 0.03, c), box(0.04, 0.08, 0.12, a, -0.12)],
  nunchucks: (c, a) => [stick(0.22, 0.03, c, -0.06, 0.03, -0.08), stick(0.22, 0.03, c, 0.06, 0.03, 0.08), box(0.04, 0.02, 0.16, a, 0.0)],
  whip: (c, a) => [stick(0.16, 0.03, c, -0.18), box(0.34, 0.02, 0.02, 0x5a3a20, 0.08), ...[0, 0.08, 0.16].map((x) => box(0.03, 0.01, 0.04, a, x))],
  outfit: (c, a) => [box(0.34, 0.06, 0.3, c), box(0.12, 0.062, 0.05, a, 0, 0, -0.13), box(0.08, 0.063, 0.05, a, 0.09, 0, 0.02)],
  key: (c, a) => [disc(0.07, 0.03, c, -0.12, 0.07, 0).rotateX(Math.PI / 2).translate(0, -0.05, 0), box(0.24, 0.025, 0.04, a ?? METAL, 0.06), box(0.03, 0.025, 0.06, a ?? METAL, 0.16, 0, 0.03)],
  mold: (c, a) => [box(0.26, 0.06, 0.16, c), box(0.18, 0.062, 0.04, a, 0.02)],
  pouch: (c, a) => [box(0.24, 0.06, 0.18, c), box(0.24, 0.02, 0.06, a, 0, 0.06, -0.06)],
  dummy: (c, a) => [box(0.42, 0.1, 0.2, a), box(0.14, 0.12, 0.18, c, -0.17)],
  poster: (c, a) => [box(0.34, 0.015, 0.26, c), box(0.2, 0.017, 0.08, a, 0, 0, 0.04)],
  block: (c, a) => [box(0.28, 0.16, 0.2, c), box(0.29, 0.02, 0.21, a, 0, 0.07)],
  vent: (c, a) => [box(0.3, 0.03, 0.3, a), ...[-0.1, -0.03, 0.04, 0.11].map((z) => box(0.26, 0.035, 0.03, c, 0, 0, z))],
  fence: (c, a) => [box(0.32, 0.02, 0.28, a), ...[-0.1, 0, 0.1].map((x) => box(0.012, 0.025, 0.28, c, x)), ...[-0.08, 0.02, 0.12].map((z) => box(0.32, 0.025, 0.012, c, 0, 0, z))],
  brace: (c, a) => [box(0.46, 0.06, 0.08, c, 0, 0, -0.08), box(0.46, 0.06, 0.08, c, 0, 0, 0.08), box(0.08, 0.08, 0.26, a)],
  hook: (c, a) => [stick(0.26, 0.03, c, -0.08), ...[-1, 0, 1].map((s) => turn(box(0.14, 0.03, 0.03, c), s * 0.7, 0.1 + 0.04, s * 0.04)), box(0.06, 0.04, 0.06, a, -0.2)],
  grapnel: (c, a) => [...SHAPES.hook(c, a), cyl(0.12, 0.04, a, -0.05, 0, 0.12, 14)],
  pack: (c, a) => [box(0.3, 0.06, 0.22, a), box(0.24, 0.07, 0.16, c, 0, 0.02), box(0.08, 0.072, 0.06, 0xf6c6c6, 0.05, 0.02, -0.02)],
  tray: (c, a) => [box(0.4, 0.03, 0.28, c), box(0.12, 0.06, 0.1, 0xe8d9a8, -0.1, 0.03, -0.04), box(0.1, 0.05, 0.1, 0x8a5a3a, 0.1, 0.03, 0.04), box(0.08, 0.05, 0.08, a, 0.02, 0.03, -0.07)],
  stool: (c, a) => [box(0.3, 0.05, 0.3, c, 0, 0.22), ...[-1, 1].flatMap((x) => [-1, 1].map((z) => box(0.04, 0.22, 0.04, a, x * 0.11, 0, z * 0.11)))],
  letter: (c, a) => [box(0.3, 0.02, 0.2, c), turn(box(0.19, 0.022, 0.012, 0xc8bfa8), 0.6, -0.05, 0.02), turn(box(0.19, 0.022, 0.012, 0xc8bfa8), -0.6, 0.05, 0.02), box(0.05, 0.024, 0.05, a, 0, 0, 0.04)],
  raft: (c, a) => [...[-0.12, 0, 0.12].map((z) => box(0.46, 0.05, 0.1, c, 0, 0, z)), box(0.06, 0.06, 0.36, a, -0.15, 0.05), box(0.06, 0.06, 0.36, a, 0.15, 0.05)],
  /** A firecracker (P14): a red tube with gold bands and its fuse. */
  firecracker: (c, a) => [rod(0.05, 0.26, c, 0, 0.05, 0, 12), box(0.03, 0.105, 0.105, a, -0.07, -0.002), box(0.03, 0.105, 0.105, a, 0.07, -0.002), stick(0.09, 0.009, DARK, 0.17, 0.05)],
  /** An alarm clock (P14) on its back: the case, the white face with its hands, two bells on top. */
  clock: (c, a) => [
    cyl(0.12, 0.08, c, 0, 0, 0, 18),
    cyl(0.1, 0.085, a, 0, 0, 0, 18),
    box(0.075, 0.006, 0.014, DARK, 0.035, 0.085, 0),
    box(0.014, 0.006, 0.055, DARK, 0, 0.085, -0.025),
    cyl(0.045, 0.05, c, -0.08, 0.02, -0.1, 10),
    cyl(0.045, 0.05, c, 0.08, 0.02, -0.1, 10),
    box(0.04, 0.03, 0.03, METAL, 0, 0.03, -0.13),
  ],
  /** Jerky (P19): two twisted strips of dried meat. */
  jerky: (c, a) => [turn(box(0.36, 0.035, 0.07, c, 0, 0, 0), 0.18, 0, -0.035), turn(box(0.3, 0.035, 0.065, a, 0, 0.02, 0), -0.22, 0.02, 0.04)],
  /** A pepper pot (P19): a white body, a dark cap with holes. */
  shaker: (c, a) => [cyl(0.06, 0.16, c, 0, 0, 0, 14), cyl(0.065, 0.05, a, 0, 0.16, 0, 14), cyl(0.04, 0.02, a, 0, 0.21, 0, 10)],
  /** A pill bottle (P19) on its side, with its cap and label. */
  pills: (c, a) => [rod(0.07, 0.2, c, 0, 0.07, 0, 14), rod(0.075, 0.06, a, 0.12, 0.07, 0, 14), rod(0.072, 0.09, 0xf4f4ef, -0.02, 0.07, 0, 14)],
  /** A burner phone (P21): a chunky handset lying face up, its screen lit (the accent), a keypad below, a stub of aerial. */
  phone: (c, a) => [
    box(0.13, 0.04, 0.26, c, 0, 0, 0),
    box(0.1, 0.006, 0.09, a, 0, 0.04, -0.055),
    ...[-1, 0, 1].flatMap((x) => [0.04, 0.075].map((z) => box(0.025, 0.006, 0.02, 0x8a929e, x * 0.035, 0.04, z))),
    box(0.03, 0.03, 0.05, 0x1b1e24, 0.045, 0.01, -0.15),
  ],
  /** A rat trap (P20): a cup tipped mouth down over the bait, its raised rim propped on a matchstick, on a scrap of board. */
  trap: (c, a) => {
    const r = 0.085;
    const h = 0.17;
    const tilt = 0.42;
    const sin = Math.sin(tilt);
    const cos = Math.cos(tilt);
    // The low rim on the board at x −0.13 (y 0.02); the raised rim 2r·sin(tilt) up at the far side.
    const dx = -0.13 - (-r * cos + (h / 2) * sin);
    const dy = 0.02 - (-r * sin - (h / 2) * cos);
    const cup = cyl(r, h, c, 0, -h / 2, 0, 14).rotateZ(tilt).translate(dx, dy, 0);
    const rimX = r * cos + (h / 2) * sin + dx;
    const rimY = r * sin - (h / 2) * cos + dy;
    const mouthX = (h / 2) * sin + dx;
    return [box(0.4, 0.02, 0.28, 0xb07a45), cup, box(0.07, 0.025, 0.06, a, mouthX, 0.02, 0), box(0.022, rimY - 0.02, 0.022, 0xe8c45a, rimX - 0.014, 0.02, 0)];
  },
  /** A rat caught (P20): the cup down over it, its tail out on the board, its nose at the rim. */
  caughtRat: (c, a) => [
    box(0.4, 0.02, 0.28, 0xb07a45),
    cyl(0.1, 0.16, c, 0, 0.02, 0, 16),
    cyl(0.104, 0.012, 0xd8dde3, 0, 0.02, 0, 16),
    box(0.09, 0.012, 0.016, 0xd89aa0, 0.14, 0.02, 0.03),
    box(0.016, 0.012, 0.045, 0xd89aa0, 0.18, 0.02, 0.05),
    box(0.04, 0.035, 0.05, a, -0.11, 0.02, -0.02),
    box(0.012, 0.012, 0.012, 0xd89aa0, -0.135, 0.04, -0.02),
  ],
};

const cache = new Map<string, THREE.BufferGeometry>();

/** The model of an item (shared and cached: don't dispose). */
export function itemGeometry(d: ItemDef): THREE.BufferGeometry {
  let g = cache.get(d.id);
  if (!g) {
    const shape = SHAPES[d.shape] ?? SHAPES.blob;
    g = merge(shape(d.color, d.accent ?? d.color), false);
    g.computeBoundingBox();
    cache.set(d.id, g);
  }
  return g;
}

