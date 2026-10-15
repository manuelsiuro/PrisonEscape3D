import * as THREE from 'three';
import type { DecorKind, DecorPlacement } from '../content/decor';
import { box, cyl, disc, kitMaterial, merge, rod, type Part } from './kit';
import { seeThrough } from './occlusion';

/**
 * Decor models (P8+), in the props' style: a few boxes and cylinders colored by the vertices,
 * built facing +z (south) on a tile centered on the origin. A wall piece stands against the
 * tile's north edge (z = -d/2), the wall behind it. Screens and signs that light up are `glow`
 * parts (an unlit material, dimmed when the power is out).
 */
interface Model {
  parts: Part[];
  glow?: Part[];
}
type Builder = (w: number, d: number) => Model;

const DARK = 0x3b4048;
const METAL = 0x8d949e;
const STEEL = 0xb8bec6;
const WOOD = 0x9b6a3f;
const WOOD_DARK = 0x6e4a2b;
const WHITE = 0xeef1f4;
const CORK = 0xb98a55;
const GREEN = 0x4f8a3c;
const LEAF = 0x3f7d33;
const RED = 0xd23b2e;
/** How far off the wall a wall piece's front is (its back is at the wall). */
const ON_WALL = (d: number) => -d / 2;

const poster = (bg: number, ink: number, mark: number): Builder => (_w, d) => {
  const z = ON_WALL(d) + 0.015;
  return {
    parts: [
      box(0.5, 0.66, 0.02, bg, 0, 0.5, z),
      box(0.38, 0.06, 0.01, ink, 0, 1.02, z + 0.012),
      box(0.3, 0.26, 0.01, mark, 0, 0.66, z + 0.012),
      box(0.36, 0.03, 0.01, ink, 0, 0.58, z + 0.012),
    ],
  };
};

const BUILDERS: Record<DecorKind, Builder> = {
  poster: poster(0xf2e6c9, 0x2b3a55, 0xd2502e),
  posterB: poster(0x2b3a55, 0xf2c94c, 0x5fa8d3),
  posterC: poster(0xe9eef3, 0xc0392b, 0x3f7d33),
  clock: (_w, d) => {
    const z = ON_WALL(d) + 0.03;
    return {
      parts: [disc(0.17, 0.05, DARK, 0, 1.1, z), disc(0.145, 0.02, WHITE, 0, 1.1, z + 0.03), box(0.02, 0.11, 0.01, DARK, 0, 1.1, z + 0.045), box(0.08, 0.02, 0.01, DARK, 0.03, 1.1, z + 0.045)],
    };
  },
  noticeBoard: (w, d) => {
    const z = ON_WALL(d) + 0.025;
    const parts = [box(w - 0.3, 0.6, 0.04, WOOD_DARK, 0, 0.55, z), box(w - 0.4, 0.5, 0.02, CORK, 0, 0.6, z + 0.02)];
    const notes = [WHITE, 0xf6e27a, 0xbfe3f2, 0xf3c1c1, WHITE];
    for (let k = 0; k < Math.round(w * 2.5); k++) parts.push(box(0.16, 0.2, 0.01, notes[k % notes.length], -w / 2 + 0.35 + k * 0.32, 0.66 + (k % 2) * 0.16, z + 0.035));
    return { parts };
  },
  menuBoard: (w, d) => {
    const z = ON_WALL(d) + 0.025;
    const parts = [box(w - 0.4, 0.5, 0.04, DARK, 0, 0.75, z)];
    const glow = [];
    for (let k = 0; k < 4; k++) glow.push(box(w * 0.32, 0.04, 0.01, 0xf8f3e3, -w * 0.18, 1.12 - k * 0.1, z + 0.025), box(0.14, 0.04, 0.01, 0xf2c94c, w / 2 - 0.4, 1.12 - k * 0.1, z + 0.025));
    return { parts, glow };
  },
  monitors: (w, d) => {
    const z = ON_WALL(d) + 0.06;
    const parts: Part[] = [box(w - 0.1, 0.06, 0.12, DARK, 0, 0.5, z)];
    const glow: Part[] = [];
    const cols = Math.round(w * 1.5);
    const colors = [0x5fd4ff, 0x8ef0c2, 0x5fd4ff, 0xb9e6ff];
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < 2; r++) {
        const x = -w / 2 + 0.3 + c * ((w - 0.6) / Math.max(1, cols - 1));
        parts.push(box(0.5, 0.34, 0.08, 0x1d2026, x, 0.58 + r * 0.38, z));
        glow.push(box(0.42, 0.27, 0.01, colors[(c + r) % colors.length], x, 0.615 + r * 0.38, z + 0.045));
      }
    return { parts, glow };
  },
  pigeonholes: (w, d) => {
    const z = ON_WALL(d) + 0.1;
    const parts: Part[] = [box(w - 0.2, 0.9, 0.2, WOOD, 0, 0.3, z)];
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < Math.round(w * 3); c++) {
        parts.push(box(0.22, 0.16, 0.01, WOOD_DARK, -w / 2 + 0.25 + c * 0.3, 0.38 + r * 0.21, z + 0.1));
        if ((r * 7 + c * 3) % 4 !== 0) parts.push(box(0.16, 0.1, 0.01, (r + c) % 3 ? WHITE : 0xe8d9b0, -w / 2 + 0.25 + c * 0.3, 0.4 + r * 0.21, z + 0.105));
      }
    return { parts };
  },
  toolRack: (w, d) => {
    const z = ON_WALL(d) + 0.03;
    const parts: Part[] = [box(w - 0.3, 0.5, 0.03, 0x7c8a6a, 0, 0.6, z)];
    for (let k = 0; k < Math.round(w * 3); k++) {
      const x = -w / 2 + 0.35 + k * 0.28;
      parts.push(box(0.03, 0.3, 0.03, k % 2 ? WOOD : METAL, x, 0.68, z + 0.04), box(0.12, 0.06, 0.03, k % 3 ? DARK : RED, x, 0.92, z + 0.04));
    }
    return { parts };
  },
  panRack: (_w, d) => {
    const z = ON_WALL(d) + 0.05;
    return {
      parts: [rod(0.015, 0.8, METAL, 0, 1.2, z), cyl(0.11, 0.04, STEEL, -0.25, 0.88, z + 0.06), cyl(0.09, 0.04, DARK, 0.02, 0.95, z + 0.06), cyl(0.12, 0.04, STEEL, 0.28, 0.85, z + 0.06), box(0.02, 0.25, 0.02, METAL, -0.25, 0.92, z), box(0.02, 0.2, 0.02, METAL, 0.28, 0.92, z)],
    };
  },
  fuseBox: (_w, d) => {
    const z = ON_WALL(d) + 0.07;
    return { parts: [box(0.42, 0.55, 0.14, 0x8f9aa6, 0, 0.55, z), box(0.36, 0.48, 0.01, 0xa9b3bd, 0, 0.58, z + 0.075), box(0.1, 0.1, 0.01, 0xf2c94c, 0, 0.92, z + 0.08)], glow: [box(0.04, 0.04, 0.01, 0x7dff8a, 0.13, 1.0, z + 0.08)] };
  },
  pipes: (w, d) => {
    const z = ON_WALL(d) + 0.08;
    return { parts: [rod(0.05, w, 0x9a6d4a, 0, 1.15, z), rod(0.035, w, METAL, 0, 0.95, z - 0.02), box(0.06, 0.4, 0.06, 0x9a6d4a, -w / 2 + 0.3, 0.75, z), cyl(0.07, 0.04, RED, w / 2 - 0.35, 1.1, z + 0.05)] };
  },
  warningSign: (_w, d) => {
    const z = ON_WALL(d) + 0.015;
    return { parts: [box(0.42, 0.42, 0.02, 0xf2c94c, 0, 0.75, z), box(0.04, 0.2, 0.01, DARK, 0, 0.87, z + 0.012), box(0.05, 0.05, 0.01, DARK, 0, 0.8, z + 0.012)] };
  },
  mirror: (w, d) => {
    const z = ON_WALL(d) + 0.02;
    return { parts: [box(w - 0.3, 0.8, 0.03, METAL, 0, 0.45, z)], glow: [box(w - 0.4, 0.7, 0.01, 0xc9dbe8, 0, 0.5, z + 0.02)] };
  },
  towelHooks: (w, d) => {
    const z = ON_WALL(d) + 0.02;
    const parts: Part[] = [box(w - 0.3, 0.05, 0.03, WOOD_DARK, 0, 1.15, z)];
    const towels = [0xe9eef3, 0x9fc6e0, 0xf3d9a4, 0xe9eef3];
    for (let k = 0; k < Math.round(w * 2); k++) parts.push(box(0.26, 0.42, 0.04, towels[k % towels.length], -w / 2 + 0.35 + k * 0.45, 0.72, z + 0.04));
    return { parts };
  },
  speaker: (_w, d) => {
    const z = ON_WALL(d) + 0.1;
    return { parts: [box(0.06, 0.06, 0.16, DARK, 0, 1.25, z - 0.05), box(0.26, 0.2, 0.16, 0x50565f, 0, 1.12, z + 0.04), disc(0.08, 0.01, 0x2b3038, 0, 1.22, z + 0.125)] };
  },
  extinguisher: (_w, d) => {
    const z = ON_WALL(d) + 0.12;
    return { parts: [cyl(0.09, 0.42, RED, 0, 0.35, z), cyl(0.05, 0.06, DARK, 0, 0.77, z), box(0.14, 0.03, 0.04, DARK, 0.05, 0.82, z), box(0.24, 0.3, 0.02, WHITE, 0, 0.85, ON_WALL(d) + 0.01)] };
  },
  wallShelf: (w, d) => {
    const z = ON_WALL(d) + 0.12;
    const parts: Part[] = [box(w - 0.2, 0.04, 0.24, WOOD, 0, 0.95, z), box(0.04, 0.12, 0.2, DARK, -w / 2 + 0.25, 0.83, z), box(0.04, 0.12, 0.2, DARK, w / 2 - 0.25, 0.83, z)];
    const things = [0xd9d2c0, 0x5fa8d3, 0xc0392b, 0xf2c94c, 0x8e5a2b];
    for (let k = 0; k < Math.round(w * 3); k++) parts.push(box(0.14, 0.16 + (k % 3) * 0.04, 0.14, things[k % things.length], -w / 2 + 0.3 + k * 0.3, 0.99, z));
    return { parts };
  },
  medCabinet: (_w, d) => {
    const z = ON_WALL(d) + 0.08;
    return { parts: [box(0.6, 0.6, 0.16, WHITE, 0, 0.55, z), box(0.5, 0.5, 0.01, 0xd6e6ee, 0, 0.6, z + 0.085), box(0.06, 0.18, 0.01, RED, 0, 0.92, z + 0.09), box(0.18, 0.06, 0.01, RED, 0, 0.98, z + 0.09)] };
  },
  sink: (_w, d) => {
    const z = ON_WALL(d) + 0.2;
    return { parts: [box(0.5, 0.14, 0.36, WHITE, 0, 0.62, z), box(0.4, 0.04, 0.28, 0xc8d3dc, 0, 0.73, z), box(0.04, 0.5, 0.04, METAL, 0, 0.12, z - 0.12), rod(0.015, 0.12, METAL, 0, 0.86, z - 0.12)] };
  },
  keyCabinet: (_w, d) => {
    const z = ON_WALL(d) + 0.05;
    const parts: Part[] = [box(0.5, 0.5, 0.1, 0x6b4a2b, 0, 0.6, z)];
    const keys = [0xff5f6d, 0x2fb6c8, 0xffc23d, 0x3fb950, 0x8e4fc4];
    keys.forEach((c, k) => parts.push(box(0.05, 0.12, 0.01, c, -0.18 + k * 0.09, 0.82, z + 0.055)));
    return { parts };
  },
  plant: () => ({ parts: [cyl(0.17, 0.3, 0xa0522d, 0, 0, 0, 10), cyl(0.18, 0.04, 0x8a4524, 0, 0.3, 0, 10), cyl(0.27, 0.3, LEAF, 0, 0.38, 0, 8), cyl(0.2, 0.28, GREEN, 0.06, 0.62, -0.04, 8), cyl(0.12, 0.2, 0x5d9e46, -0.05, 0.86, 0.04, 6)] }),
  smallBin: () => ({ parts: [cyl(0.16, 0.42, 0x5b6470, 0, 0, 0, 10), cyl(0.17, 0.03, DARK, 0, 0.42, 0, 10)] }),
  waterCooler: () => ({
    parts: [box(0.36, 0.85, 0.36, WHITE, 0, 0, 0), box(0.06, 0.06, 0.04, 0x2f6fd0, -0.08, 0.6, 0.19), box(0.06, 0.06, 0.04, RED, 0.08, 0.6, 0.19)],
    glow: [cyl(0.15, 0.4, 0x9fd8ff, 0, 0.85, 0, 10)],
  }),
  vending: (_w, d) => ({
    parts: [box(0.8, 1.4, d - 0.25, 0xc0392b, 0, 0, -0.05), box(0.2, 0.5, 0.02, DARK, 0.25, 0.5, d / 2 - 0.17)],
    glow: [box(0.42, 0.9, 0.02, 0xfff3c4, -0.12, 0.35, d / 2 - 0.17), box(0.6, 0.12, 0.02, 0xffffff, 0, 1.18, d / 2 - 0.17)],
  }),
  lockers: (w, d) => {
    const parts: Part[] = [];
    const n = Math.round(w * 2);
    for (let k = 0; k < n; k++) {
      const x = -w / 2 + 0.25 + k * ((w - 0.5) / Math.max(1, n - 1));
      parts.push(box(0.44, 1.3, d - 0.5, 0x5d7e9e, x, 0, -d / 2 + 0.3), box(0.36, 0.05, 0.01, 0x2b3a55, x, 1.05, -d / 2 + 0.3 + (d - 0.5) / 2 + 0.005), box(0.36, 0.05, 0.01, 0x2b3a55, x, 0.95, -d / 2 + 0.3 + (d - 0.5) / 2 + 0.005), box(0.04, 0.1, 0.02, METAL, x + 0.14, 0.62, -d / 2 + 0.3 + (d - 0.5) / 2 + 0.01));
    }
    return { parts };
  },
  tv: () => ({
    parts: [box(0.7, 0.45, 0.4, WOOD_DARK, 0, 0, 0), box(0.8, 0.5, 0.08, DARK, 0, 0.5, 0), box(0.08, 0.06, 0.08, DARK, 0, 0.45, 0)],
    glow: [box(0.72, 0.42, 0.01, 0x8fd3ff, 0, 0.54, 0.045)],
  }),
  drum: () => ({ parts: [cyl(0.28, 0.85, 0x3d6b8f, 0, 0, 0, 12), cyl(0.29, 0.04, 0x2b4d68, 0, 0.25, 0, 12), cyl(0.29, 0.04, 0x2b4d68, 0, 0.6, 0, 12), box(0.3, 0.2, 0.01, 0xf2c94c, 0, 0.35, 0.285)] }),
  sacks: () => ({ parts: [box(0.5, 0.32, 0.36, 0xd8c79d, -0.12, 0, 0.05), box(0.46, 0.3, 0.34, 0xc9b88b, 0.16, 0, -0.1), box(0.44, 0.28, 0.34, 0xe0d2ad, 0.02, 0.3, -0.02)] }),
  parcels: () => ({ parts: [box(0.46, 0.34, 0.4, 0xc49a6c, -0.1, 0, 0), box(0.36, 0.28, 0.3, 0xb3895b, 0.18, 0, 0.1), box(0.34, 0.24, 0.3, 0xd1a978, 0, 0.34, -0.02), box(0.36, 0.02, 0.06, 0xe9e2cf, -0.1, 0.34, 0)] }),
  mopBucket: () => ({ parts: [cyl(0.2, 0.3, 0xf2c94c, 0, 0, 0, 10), cyl(0.17, 0.02, 0x7a9fb5, 0, 0.28, 0, 10), box(0.03, 1.1, 0.03, WOOD, 0.08, 0.1, 0.02), cyl(0.12, 0.08, 0xd9d2c0, 0.08, 0.1, 0.02, 8)] }),
  wetSign: () => ({ parts: [box(0.36, 0.55, 0.03, 0xf2c94c, 0, 0, 0.1), box(0.36, 0.55, 0.03, 0xf2c94c, 0, 0, -0.1), box(0.26, 0.06, 0.01, DARK, 0, 0.36, 0.12)] }),
  basket: () => ({ parts: [box(0.56, 0.36, 0.4, 0xd9c08e, 0, 0, 0), box(0.5, 0.08, 0.34, 0xeef1f4, 0, 0.36, 0), box(0.2, 0.06, 0.2, 0x9fc6e0, 0.1, 0.42, 0.04)] }),
  ironingBoard: () => ({ parts: [box(1.0, 0.04, 0.34, 0xbfd3e3, 0, 0.78, 0), rod(0.015, 0.95, METAL, 0, 0.4, 0), box(0.03, 0.78, 0.03, METAL, -0.3, 0, 0), box(0.03, 0.78, 0.03, METAL, 0.3, 0, 0), box(0.22, 0.1, 0.14, 0xd8dde3, -0.25, 0.82, 0)] }),
  sawhorse: () => ({ parts: [box(0.9, 0.08, 0.1, WOOD, 0, 0.55, 0), box(0.06, 0.6, 0.06, WOOD_DARK, -0.35, 0, -0.12), box(0.06, 0.6, 0.06, WOOD_DARK, -0.35, 0, 0.12), box(0.06, 0.6, 0.06, WOOD_DARK, 0.35, 0, -0.12), box(0.06, 0.6, 0.06, WOOD_DARK, 0.35, 0, 0.12), box(0.5, 0.06, 0.18, 0xc58f5a, 0.1, 0.63, 0)] }),
  timber: (w) => {
    const parts: Part[] = [];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 4 - r; k++) parts.push(box(w - 0.15, 0.12, 0.14, (r + k) % 2 ? WOOD : 0xb27b47, 0, r * 0.12, -0.24 + k * 0.16 + r * 0.08));
    return { parts };
  },
  punchingBag: () => ({ parts: [box(0.06, 0.06, 0.6, DARK, 0, 1.5, -0.25), box(0.02, 0.35, 0.02, METAL, 0, 1.15, 0), cyl(0.2, 0.75, RED, 0, 0.4, 0, 12), cyl(0.21, 0.04, DARK, 0, 0.62, 0, 12)] }),
  dumbbells: (w) => {
    const parts: Part[] = [box(w - 0.2, 0.06, 0.4, DARK, 0, 0.35, 0), box(0.06, 0.35, 0.36, DARK, -w / 2 + 0.15, 0, 0), box(0.06, 0.35, 0.36, DARK, w / 2 - 0.15, 0, 0)];
    for (let k = 0; k < Math.round(w * 3); k++) {
      const x = -w / 2 + 0.3 + k * 0.3;
      parts.push(rod(0.02, 0.22, METAL, x, 0.47, 0), disc(0.06, 0.05, 0x23262b, x - 0.1, 0.47, 0), disc(0.06, 0.05, 0x23262b, x + 0.1, 0.47, 0));
    }
    return { parts };
  },
  mat: (w, d) => ({ parts: [box(w - 0.15, 0.03, d - 0.25, 0x2f6fd0, 0, 0, 0), box(w - 0.3, 0.005, 0.04, 0x5f95e8, 0, 0.03, 0)] }),
  flagpole: () => ({ parts: [cyl(0.2, 0.15, 0x9aa1a9, 0, 0, 0, 10), cyl(0.04, 3.4, STEEL, 0, 0.15, 0, 8), box(0.02, 0.48, 0.8, 0x2b5fb8, 0, 2.95, 0.42), box(0.025, 0.12, 0.8, WHITE, 0, 3.1, 0.42)] }),
  tree: () => ({ parts: [cyl(0.14, 1.2, 0x6e4a2b, 0, 0, 0, 8), cyl(0.75, 0.9, LEAF, 0, 1.1, 0, 9), cyl(0.58, 0.7, GREEN, 0.1, 1.85, -0.05, 9), cyl(0.34, 0.5, 0x5d9e46, -0.05, 2.45, 0.05, 8)] }),
  bush: () => ({ parts: [cyl(0.42, 0.42, LEAF, 0, 0, 0, 8), cyl(0.3, 0.3, GREEN, 0.12, 0.32, 0.06, 7)] }),
  hoop: () => ({ parts: [cyl(0.05, 2.4, DARK, 0, 0, -0.3, 8), box(0.9, 0.6, 0.04, WHITE, 0, 2.2, -0.24), box(0.3, 0.22, 0.01, RED, 0, 2.25, -0.215), cyl(0.2, 0.03, 0xe8642c, 0, 2.15, -0.02, 14)] }),
  filing: () => ({ parts: [box(0.5, 1.1, 0.5, 0x8a96a3, 0, 0, 0), ...[0.22, 0.48, 0.74].map((y) => box(0.42, 0.2, 0.01, 0x9fabb7, 0, y, 0.255)), ...[0.3, 0.56, 0.82].map((y) => box(0.12, 0.03, 0.02, DARK, 0, y, 0.265))] }),
  ivStand: () => ({ parts: [cyl(0.2, 0.04, DARK, 0, 0, 0, 8), cyl(0.02, 1.5, STEEL, 0, 0.04, 0, 6), box(0.3, 0.02, 0.02, STEEL, 0, 1.52, 0), box(0.12, 0.2, 0.06, 0xd9eef7, 0.1, 1.3, 0)] }),
  rug: (w, d) => ({ parts: [box(w - 0.3, 0.012, d - 0.3, 0x8e3b2e, 0, 0, 0), box(w - 0.6, 0.014, d - 0.6, 0xc58f5a, 0, 0, 0), box(w - 0.9, 0.016, d - 0.9, 0x8e3b2e, 0, 0, 0)] }),
  drain: () => ({ parts: [cyl(0.14, 0.008, 0x6b737c, 0, 0, 0, 12), box(0.18, 0.01, 0.02, 0x3b4048, 0, 0, -0.04), box(0.18, 0.01, 0.02, 0x3b4048, 0, 0, 0.04)] }),
  potatoes: () => ({ parts: [box(0.42, 0.42, 0.36, 0xc9b88b, -0.2, 0, 0), cyl(0.18, 0.24, METAL, 0.25, 0, 0.05, 10), ...[[0.22, 0.03], [0.3, 0.1], [0.18, 0.12]].map(([x, z]) => box(0.08, 0.06, 0.07, 0xc9a05a, x, 0.24, z)), ...[[-0.25, 0], [-0.12, 0.05], [-0.2, -0.08]].map(([x, z]) => box(0.09, 0.07, 0.08, 0xb98a46, x, 0.42, z))] }),
  globe: () => ({ parts: [cyl(0.12, 0.05, WOOD_DARK, 0, 0, 0, 10), cyl(0.02, 0.18, WOOD_DARK, 0, 0.05, 0, 6), cyl(0.15, 0.3, 0x3f86c9, 0, 0.22, 0, 12), box(0.1, 0.12, 0.31, 0x5fa04a, 0.03, 0.3, 0)] }),
  trays: (w) => {
    const parts: Part[] = [];
    for (let k = 0; k < Math.round(w * 2); k++) {
      const x = -w / 2 + 0.3 + k * 0.48;
      parts.push(box(0.36, 0.03, 0.28, 0xb8c2cc, x, 0, 0), box(0.12, 0.04, 0.1, 0xe8d9a8, x - 0.07, 0.03, 0.03), box(0.1, 0.04, 0.1, 0x8fb35a, x + 0.09, 0.03, -0.04), box(0.08, 0.05, 0.08, 0xb9542f, x + 0.09, 0.03, 0.07));
    }
    return { parts };
  },
  pans: (w) => {
    const parts: Part[] = [];
    for (let k = 0; k < Math.round(w * 1.6); k++) parts.push(box(0.42, 0.08, 0.32, STEEL, -w / 2 + 0.35 + k * 0.55, 0, 0), box(0.36, 0.03, 0.26, [0xe8c860, 0x9a5b33, 0x8fb35a, 0xe8d9a8][k % 4], -w / 2 + 0.35 + k * 0.55, 0.06, 0));
    return { parts };
  },
  deskLamp: () => ({ parts: [cyl(0.08, 0.03, DARK, 0, 0, 0, 8), box(0.025, 0.3, 0.025, DARK, 0, 0.03, 0), box(0.025, 0.025, 0.18, DARK, 0, 0.32, 0.07)], glow: [cyl(0.07, 0.07, 0xffe6a0, 0, 0.25, 0.16, 8)] }),
  coffee: () => ({ parts: [box(0.3, 0.38, 0.26, DARK, 0, 0, 0), box(0.18, 0.04, 0.12, METAL, 0, 0.06, 0.12), cyl(0.05, 0.08, WHITE, 0, 0.1, 0.12, 8), cyl(0.07, 0.12, 0x2b3038, -0.08, 0.38, 0, 8)], glow: [box(0.05, 0.03, 0.01, 0xff5050, 0.1, 0.3, 0.135)] }),
  books: (w) => {
    const parts: Part[] = [];
    const c = [0xc0392b, 0x2f6fd0, 0x3f7d33, 0xf2c94c, 0x8e4fc4];
    for (let k = 0; k < Math.round(w * 2); k++) parts.push(box(0.22, 0.04 + (k % 3) * 0.02, 0.3, c[k % c.length], -w / 2 + 0.3 + k * 0.4, 0, (k % 2) * 0.06 - 0.03));
    return { parts };
  },
  phone: () => ({ parts: [box(0.18, 0.32, 0.08, DARK, 0, 0, -0.05), box(0.05, 0.2, 0.05, 0x23262b, 0.1, 0.06, 0.02), box(0.12, 0.08, 0.02, 0x6b737c, 0, 0.2, -0.005)] }),
};

/** A decor model's geometries (the glow part may be empty). */
function geometryOf(kind: DecorKind, w: number, d: number): { base: THREE.BufferGeometry; glow: THREE.BufferGeometry | null } {
  const m = BUILDERS[kind](w, d);
  return { base: merge(m.parts), glow: m.glow?.length ? merge(m.glow) : null };
}

/**
 * Every decor piece of a prison, instanced by kind and size; furniture's see-through cut
 * near the player (above waist height) applies to them as to props. `update` dims what glows
 * when the power is out and lets the monitors flicker now and then.
 */
export class DecorView {
  readonly group = new THREE.Group();
  private readonly glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  private readonly base = seeThrough(kitMaterial.clone(), 0.6);
  private lit = 1;

  constructor(list: readonly DecorPlacement[]) {
    seeThrough(this.glowMat, 0.6);
    const groups = new Map<string, DecorPlacement[]>();
    for (const p of list) {
      const w = p.w ?? 1;
      const d = p.d ?? 1;
      const turned = (p.rot ?? 0) % 2 === 1;
      const key = `${p.kind}:${turned ? d : w}x${turned ? w : d}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const at = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [key, ps] of groups) {
      const [kind, size] = key.split(':');
      const [w, d] = size.split('x').map(Number);
      const { base, glow } = geometryOf(kind as DecorKind, w, d);
      const meshes: THREE.InstancedMesh[] = [new THREE.InstancedMesh(base, this.base, ps.length)];
      if (glow) meshes.push(new THREE.InstancedMesh(glow, this.glowMat, ps.length));
      ps.forEach((p, i) => {
        const rot = p.rot ?? 0;
        q.setFromAxisAngle(up, [0, Math.PI / 2, Math.PI, -Math.PI / 2][rot]);
        at.set(p.x + (p.w ?? 1) / 2, p.y ?? 0, p.z + (p.d ?? 1) / 2);
        m.compose(at, q, s);
        for (const mesh of meshes) mesh.setMatrixAt(i, m);
      });
      meshes[0].castShadow = meshes[0].receiveShadow = true;
      for (const mesh of meshes) this.group.add(mesh);
    }
  }

  /** Glow follows the power (0 out … 1 on); screens flicker a touch. */
  update(power: number, time: number) {
    const flicker = 0.94 + Math.sin(time * 23) * 0.03 + (Math.sin(time * 3.1) > 0.995 ? -0.25 : 0);
    const lit = 0.12 + 0.88 * power * flicker;
    if (Math.abs(lit - this.lit) < 0.005) return;
    this.lit = lit;
    this.glowMat.color.setScalar(lit);
  }

  dispose() {
    for (const c of this.group.children) (c as THREE.InstancedMesh).geometry.dispose();
    this.base.dispose();
    this.glowMat.dispose();
  }
}
