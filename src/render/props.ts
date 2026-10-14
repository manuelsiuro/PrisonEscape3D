import type * as THREE from 'three';
import type { PropKind } from '../content/props';
import { box, cyl, disc, merge, rod, type Part } from './kit';

/**
 * Furniture models, built facing +z (south, toward the camera) and centered on the origin,
 * w tiles wide (x) and d tiles deep (z). The world view turns them by the placement's `rot`.
 */
type Builder = (w: number, d: number) => Part[];

const METAL = 0x8d949e;
const DARK = 0x3b4048;
const WOOD = 0x9b6a3f;
const WOOD_DARK = 0x6e4a2b;
const WHITE = 0xeef1f4;

/** Four legs under a top w×d at height h. */
const legs = (w: number, d: number, h: number, color: number, inset = 0.08): Part[] =>
  [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ].map(([sx, sz]) => box(0.07, h, 0.07, color, sx * (w / 2 - inset), 0, sz * (d / 2 - inset)));

const BUILDERS: Record<PropKind, Builder> = {
  bed: (w, d) => [
    ...legs(w - 0.15, d - 0.1, 0.22, DARK),
    box(w - 0.15, 0.08, d - 0.1, DARK, 0, 0.22),
    box(w - 0.2, 0.14, d - 0.16, 0x9fb7d0, 0, 0.3),
    box(w - 0.24, 0.02, d * 0.62, 0x6f8fb5, 0, 0.44, d * 0.16),
    box(w - 0.3, 0.1, 0.3, WHITE, 0, 0.44, -d / 2 + 0.25),
  ],
  desk: (w, d) => [
    ...legs(w - 0.12, d - 0.2, 0.5, WOOD_DARK),
    box(w - 0.1, 0.06, d - 0.18, WOOD, 0, 0.5),
    box(w * 0.45, 0.2, 0.04, WOOD_DARK, w * 0.18, 0.28, d / 2 - 0.12),
    box(0.06, 0.02, 0.02, 0xd8c08a, w * 0.18, 0.4, d / 2 - 0.09),
  ],
  toilet: (_w, d) => [
    cyl(0.2, 0.32, WHITE, 0, 0, 0.05, 12),
    cyl(0.22, 0.05, 0xd5dde4, 0, 0.32, 0.05, 12),
    box(0.46, 0.4, 0.16, WHITE, 0, 0.1, -d / 2 + 0.14),
  ],
  table: (w, d) => [...legs(w - 0.1, d - 0.2, 0.46, DARK), box(w - 0.06, 0.06, d - 0.16, 0xa58360, 0, 0.46)],
  counter: (w, d) => [box(w - 0.04, 0.5, d - 0.3, METAL, 0, 0, -0.1), box(w, 0.06, d - 0.2, 0xc7ccd3, 0, 0.5, -0.06)],
  jobBoard: () => [
    box(0.08, 1.0, 0.08, WOOD_DARK, -0.35, 0, 0),
    box(0.08, 1.0, 0.08, WOOD_DARK, 0.35, 0, 0),
    box(0.82, 0.55, 0.06, 0xc49a62, 0, 0.5, 0),
    box(0.2, 0.14, 0.02, WHITE, -0.2, 0.75, 0.04),
    box(0.18, 0.2, 0.02, 0xfff1a8, 0.05, 0.6, 0.04),
    box(0.16, 0.12, 0.02, WHITE, 0.25, 0.8, 0.04),
  ],
  weights: (w, d) => [
    box(w * 0.3, 0.32, d * 0.8, 0x2e3440, 0, 0, 0),
    box(0.04, 0.6, 0.04, METAL, -0.3, 0, -0.25),
    box(0.04, 0.6, 0.04, METAL, 0.3, 0, -0.25),
    rod(0.025, 0.9, METAL, 0, 0.62, -0.25),
    cyl(0.12, 0.05, DARK, -0.4, 0.5, -0.25),
    cyl(0.12, 0.05, DARK, 0.4, 0.5, -0.25),
  ],
  treadmill: (w, d) => [
    box(w - 0.3, 0.12, d - 0.2, DARK, 0, 0, 0.05),
    box(w - 0.36, 0.02, d - 0.35, 0x1d2026, 0, 0.12, 0.1),
    box(0.05, 0.75, 0.05, METAL, -(w - 0.35) / 2, 0, -d / 2 + 0.2),
    box(0.05, 0.75, 0.05, METAL, (w - 0.35) / 2, 0, -d / 2 + 0.2),
    box(w - 0.3, 0.14, 0.12, 0x4c6a8a, 0, 0.75, -d / 2 + 0.2),
  ],
  shower: (_w, d) => [
    box(0.05, 1.2, 0.05, METAL, 0, 0, -d / 2 + 0.06),
    box(0.05, 0.05, 0.25, METAL, 0, 1.15, -d / 2 + 0.17),
    cyl(0.08, 0.04, 0xc7ccd3, 0, 1.1, -d / 2 + 0.3, 8),
    cyl(0.12, 0.01, 0x9aa3ad, 0, 0.005, 0.05, 10),
  ],
  shelf: (w, d) => {
    const parts = [box(w - 0.04, 1.3, d - 0.5, WOOD_DARK, 0, 0, -0.22)];
    const colors = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xe67e22];
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < Math.round(w * 5); k++) {
        const x = -w / 2 + 0.12 + k * 0.19;
        parts.push(box(0.14, 0.26 + ((k + row) % 3) * 0.03, 0.06, colors[(k * 7 + row * 3) % colors.length], x, 0.12 + row * 0.4, 0.04));
      }
    }
    return parts;
  },
  washer: () => [
    box(0.8, 0.8, 0.75, WHITE, 0, 0, -0.05),
    disc(0.24, 0.03, 0x3d4a57, 0, 0.42, 0.33),
    box(0.6, 0.06, 0.02, 0x9aa3ad, 0, 0.68, 0.33),
  ],
  bin: () => [box(0.66, 0.5, 0.66, 0x5b6470), box(0.56, 0.02, 0.56, 0x2b3038, 0, 0.5)],
  workbench: (w, d) => [
    ...legs(w - 0.1, d - 0.2, 0.55, WOOD_DARK),
    box(w - 0.06, 0.1, d - 0.16, WOOD, 0, 0.55),
    box(0.16, 0.12, 0.12, METAL, w / 2 - 0.2, 0.65, d / 2 - 0.2),
    box(0.3, 0.04, 0.12, 0xd9b77e, -0.2, 0.65, 0),
  ],
  oven: () => [box(0.86, 0.85, 0.8, 0xb8bec6, 0, 0, -0.05), box(0.6, 0.3, 0.02, 0x25292f, 0, 0.3, 0.36), box(0.6, 0.06, 0.04, METAL, 0, 0.66, 0.36)],
  freezer: (w, d) => [box(w - 0.1, 1.5, d - 0.3, WHITE, 0, 0, -0.1), box(0.04, 0.5, 0.04, METAL, -w / 2 + 0.2, 0.7, d / 2 - 0.22), box(w - 0.12, 0.02, 0.02, 0xc7ccd3, 0, 0.75, d / 2 - 0.24)],
  generator: (w, d) => [
    box(w - 0.2, 0.25, d - 0.2, DARK),
    box(w - 0.5, 0.9, d - 0.6, 0xd6a72c, 0, 0.25),
    cyl(0.18, 0.5, METAL, -w / 4, 1.15, -d / 4),
    rod(0.06, w - 0.6, METAL, 0, 0.9, d / 2 - 0.22),
    box(0.3, 0.2, 0.04, 0x1d2026, 0.3, 0.6, d / 2 - 0.3),
  ],
  sortingDesk: (w, d) => {
    const parts = [...legs(w - 0.1, d - 0.2, 0.5, WOOD_DARK), box(w - 0.06, 0.06, d - 0.16, WOOD, 0, 0.5), box(w - 0.1, 0.5, 0.2, WOOD_DARK, 0, 0.56, -d / 2 + 0.2)];
    for (let k = 0; k < Math.round(w * 3); k++) parts.push(box(0.2, 0.12, 0.02, WHITE, -w / 2 + 0.25 + k * 0.32, 0.72, -d / 2 + 0.31));
    return parts;
  },
  controlDesk: (w, d) => {
    const parts = [box(w - 0.06, 0.55, d - 0.3, 0x4a5260, 0, 0, -0.1), box(w - 0.04, 0.05, d - 0.2, 0x2b3038, 0, 0.55)];
    for (let k = 0; k < Math.round(w); k++) parts.push(box(0.7, 0.42, 0.06, 0x1d2026, -w / 2 + 0.5 + k, 0.6, -d / 2 + 0.25), box(0.62, 0.34, 0.01, 0x5fd4ff, -w / 2 + 0.5 + k, 0.64, -d / 2 + 0.285));
    return parts;
  },
};

/** The merged model of a prop kind at a size (local, before turning). */
export function propGeometry(kind: PropKind, w: number, d: number): THREE.BufferGeometry {
  return merge(BUILDERS[kind](w, d));
}
