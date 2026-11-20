import * as THREE from 'three';
import { disposeTree } from '../../render/batch';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { box, cyl, kitMaterial, merge, rod, type Part } from '../../render/kit';
import { seeThrough } from '../../render/occlusion';
import { WALL_H } from '../../render/WorldView';
import { mix32 } from '../../sim/rng';
import { DISTRICTS } from '../content/districts';
import { MAP_H, MAP_W } from '../../sim/world/grid';
import { DECO, type District } from '../gen/district';
import { MAP_H as H, MAP_W as W } from '../../sim/world/grid';
import { neighbour, ROAD_W, SIDE, type CityPlan } from '../gen/plan';
import { facadeParts } from './facades';
import { streetParts } from './streetThings';
import { LandmarkLive, landmarkParts, type LandmarkFrame } from './landmarks';
import type { LandmarkPlan } from './landmarkPlan';
import { lotPanes } from '../content/windows';
import { Horde, type DeadFrame } from './horde';
import { pieceParts } from './pieces';

export type { DeadFrame } from './horde';

/**
 * A district's own pieces in the picture (C1, render only): what the World's floors, walls and
 * furniture don't draw. The cars left on the streets and the burnt ones, rubble, sandbags, trees
 * alive and dead, bushes, crates, dumpsters, barrels, tyres, cones, the prison bus on its side; and
 * past a sector's fence, the next district's rooftops, so the city goes on. One merged model a
 * district: a single draw. Built when a district is entered; reads its plan, never the simulation.
 */

/** 2.64: a fallen one's stain lasts this many seconds; this many at most in a district. */
const STAIN_SECONDS = 90;
const STAINS = 40;
/** Dusty paint for the cars left behind. */
const PAINTS = [0x7c8794, 0x8f4a42, 0x4d6a82, 0xa39a84, 0x5c6b58, 0x9a8a4a, 0x6b5a72, 0xb9b4a8];
const RUST = 0x6b4630;
const TYRE = 0x16181b;
const GLASS = 0x1e2a36;
const BURNT = 0x2a2624;
/** A street past the border, as the map's own streets read from above. */
const ROAD = 0x4a4b4f;

/** A model's parts turned about the upright and set down on a tile's middle. */
function put(out: Part[], parts: Part[], x: number, z: number, angle = 0) {
  for (const p of parts) {
    if (angle) p.rotateY(angle);
    p.translate(x, 0, z);
    out.push(p);
  }
}

/** A checkpoint (2.59), about the middle of its street on the border's line (x along the border): the street's two tiles left clear. */
function checkpoint(blocks: readonly number[]): Part[] {
  const OLIVE = 0x74856a;
  const DARK = 0x39443a;
  const CONCRETE = 0xb9b4a8;
  const WHITE = 0xe6e3da;
  const RED = 0xc23a30;
  // The boom, raised: red and white lengths leaning up over the street from its post.
  const boom = Array.from({ length: 7 }, (_, k) => box(0.1, 0.36, 0.1, k % 2 ? WHITE : RED, 1.42 - 0.13 * k, 0.95 + 0.33 * k, 0));
  return [
    // The sentry box: a window band, a roof with an overhang.
    box(0.92, 0.8, 0.92, OLIVE, -1.5, 0, 0),
    box(0.94, 0.4, 0.94, 0x9fc3cf, -1.5, 0.8, 0),
    box(0.92, 0.5, 0.92, OLIVE, -1.5, 1.2, 0),
    box(1.14, 0.1, 1.14, DARK, -1.5, 1.7, 0),
    // The boom's post and its weight.
    box(0.2, 1.05, 0.2, DARK, 1.5, 0, 0),
    box(0.34, 0.3, 0.24, DARK, 1.72, 0.8, 0),
    ...boom,
    // Concrete blocks beyond, a yellow band along their tops.
    ...blocks.flatMap((x) => [box(0.94, 0.55, 0.6, CONCRETE, x, 0, 0), box(0.94, 0.06, 0.6, 0xe0b23a, x, 0.55, 0)]),
  ];
}

/**
 * A car two tiles long, nose along +z from the middle of its first tile; `burnt`: a shell, its roof down. 2.66: `stripped`, broken
 * up for its metal: on the ground with its wheels gone, its glass out, its bonnet off over a dark engine bay, its bumpers gone.
 */
function car(paint: number, burnt: boolean, flat: number, stripped = false): Part[] {
  const body = burnt ? BURNT : paint;
  const w = 0.86;
  const wheels = stripped
    ? []
    : [0.05, 0.95].flatMap((z, k) =>
        [-1, 1].map((s, j) => rod(k * 2 + j === flat ? 0.1 : 0.15, 0.14, TYRE, s * (w / 2 - 0.04), k * 2 + j === flat ? 0.1 : 0.15, z, 8)),
      );
  const HOLE = 0x16181b;
  const parts = [
    box(w, 0.26, 1.8, body, 0, 0.14, 0.5),
    box(w - 0.1, burnt ? 0.16 : 0.26, 0.9, burnt ? 0x1c1a19 : paint, 0, 0.4, 0.4),
    ...(burnt
      ? [box(w - 0.3, 0.05, 0.5, 0x3a322c, 0.05, 0.4, 1.1)]
      : stripped
        ? [
            box(w - 0.14, 0.18, 0.04, HOLE, 0, 0.43, 0.86),
            box(w - 0.14, 0.18, 0.04, HOLE, 0, 0.43, -0.06),
            box(w - 0.08, 0.16, 0.7, HOLE, 0, 0.44, 0.4),
            box(w - 0.12, 0.03, 0.86, paint, 0, 0.64, 0.4),
            box(w - 0.16, 0.03, 0.46, HOLE, 0, 0.4, 1.12),
          ]
        : [
            box(w - 0.14, 0.18, 0.04, GLASS, 0, 0.43, 0.86),
            box(w - 0.14, 0.18, 0.04, GLASS, 0, 0.43, -0.06),
            box(w - 0.08, 0.16, 0.7, GLASS, 0, 0.44, 0.4),
            box(w - 0.12, 0.03, 0.86, paint, 0, 0.64, 0.4),
          ]),
    ...(stripped
      ? []
      : [
          box(w + 0.02, 0.06, 0.06, burnt ? 0x151413 : 0x8b9098, 0, 0.16, 1.41),
          box(w + 0.02, 0.06, 0.06, burnt ? 0x151413 : 0x8b9098, 0, 0.16, -0.41),
        ]),
    ...wheels,
  ];
  // (No wheels: it sits on the ground.)
  if (stripped) for (const p of parts) p.translate(0, -0.12, 0);
  return parts;
}

/** The prison bus on its side, three tiles long from the middle of its first tile, along +z: the grey of the service, its barred windows up at the sky. */
function bus(): Part[] {
  const len = 2.8;
  const parts = [
    box(0.95, 1.0, len, 0xc9cdd0, 0, 0.3, 0),
    box(0.97, 0.16, len, 0x2f5f8f, 0, 0.5, 0),
    box(0.97, 0.3, len - 0.5, GLASS, 0, 0.85, -0.1),
    ...Array.from({ length: 9 }, (_, k) => box(0.99, 0.32, 0.03, 0x3b4046, 0, 0.84, -1.2 + k * 0.27)),
    box(0.8, 0.4, 0.04, GLASS, 0, 0.8, len / 2 + 0.01),
    box(0.9, 0.05, len, 0xe9ebec, 0, 1.3, 0),
    ...[-0.9, 0.9].flatMap((z) => [-1, 1].map((s) => rod(0.22, 0.16, TYRE, s * 0.44, 0.22, z, 10))),
  ];
  // Onto its side, lying on the street, its middle a tile along from where it starts.
  for (const p of parts) {
    p.translate(0, -0.8, 0);
    p.rotateZ(Math.PI / 2 - 0.06);
    p.translate(-0.25, 0.5, 1);
  }
  return parts;
}

/** Broken masonry: a few blocks thrown down, seeded by the tile. */
function rubble(h: number): Part[] {
  const out: Part[] = [];
  for (let k = 0; k < 6; k++) {
    const r = mix32(h + k * 977);
    const s = 0.14 + ((r >> 4) & 7) / 28;
    const p = box(s * 1.3, s * 0.8, s, [0x77706a, 0x8a7a70, 0x5f5a56, 0x94493d][(r >> 9) & 3], 0, 0, 0);
    p.rotateY(((r >> 12) & 31) / 5);
    p.translate((((r >> 17) & 15) - 7.5) / 24, 0, (((r >> 21) & 15) - 7.5) / 24);
    out.push(p);
  }
  return out;
}

function sandbags(): Part[] {
  const SACK = 0xb6a47c;
  const row = (y: number, n: number, off: number) =>
    Array.from({ length: n }, (_, k) => box(0.3, 0.16, 0.42, k % 2 ? 0xa9976f : SACK, -0.33 * ((n - 1) / 2) + k * 0.33 + off, y, 0));
  return [...row(0, 3, 0), ...row(0.16, 2, 0.02), ...row(0.32, 1, 0)];
}

function tree(h: number, dead: boolean): Part[] {
  const tall = 1.5 + ((h >> 3) & 7) / 8;
  const trunk = cyl(0.11, tall * (dead ? 1 : 0.55), dead ? 0x4b4138 : 0x5a4530, 0, 0, 0, 7);
  if (dead) {
    const limbs = [0, 1, 2, 3].map((k) => {
      const p = box(0.05, 0.6, 0.05, 0x4b4138, 0, 0, 0);
      p.rotateZ(0.7 + k * 0.2);
      p.rotateY(k * 1.7 + ((h >> 6) & 7));
      p.translate(0, tall * (0.55 + k * 0.1), 0);
      return p;
    });
    return [trunk, ...limbs];
  }
  const leaf = [0x3f6b34, 0x4a7a3a, 0x6f7a34, 0x8a6a2c][(h >> 9) & 3];
  return [
    trunk,
    cyl(0.62, tall * 0.42, leaf, 0, tall * 0.42, 0, 7),
    cyl(0.44, tall * 0.34, leaf, 0.06, tall * 0.74, -0.04, 7),
    cyl(0.24, tall * 0.2, leaf, 0, tall * 1.0, 0, 6),
  ];
}

function bush(h: number): Part[] {
  const c = [0x3f6b34, 0x55703a, 0x4a6030][((h >> 5) & 3) % 3];
  return [box(0.7, 0.34, 0.6, c, 0, 0, 0), box(0.44, 0.24, 0.42, c, 0.08, 0.3, -0.05)];
}

function crates(h: number): Part[] {
  const WOOD = 0x8d6b42;
  const out = [box(0.58, 0.52, 0.58, WOOD, -0.12, 0, 0.1), box(0.42, 0.4, 0.42, 0x7a5c38, 0.22, 0, -0.2)];
  if (h & 16) out.push(box(0.44, 0.4, 0.44, 0x9a7748, -0.1, 0.52, 0.08));
  // (Their slats.)
  out.push(box(0.6, 0.05, 0.6, 0x5f4729, -0.12, 0.24, 0.1));
  return out;
}

const dumpster = (): Part[] => [
  box(0.92, 0.6, 0.66, 0x3c6b52, 0, 0.06, 0),
  box(0.96, 0.07, 0.7, 0x2c4f3c, 0, 0.66, 0),
  box(0.06, 0.12, 0.06, TYRE, -0.36, 0, 0.24),
  box(0.06, 0.12, 0.06, TYRE, 0.36, 0, 0.24),
];
const barrel = (): Part[] => [
  cyl(0.24, 0.62, RUST, 0, 0, 0, 10),
  cyl(0.25, 0.05, 0x40403c, 0, 0.2, 0, 10),
  cyl(0.25, 0.05, 0x40403c, 0, 0.44, 0, 10),
];
const tyres = (): Part[] => [0, 1, 2].map((k) => cyl(0.26, 0.13, k === 1 ? 0x1f2226 : TYRE, k === 2 ? 0.04 : 0, k * 0.13, 0, 12));
const cone = (): Part[] => [
  box(0.3, 0.03, 0.3, 0x2a2a2a, 0, 0, 0),
  cyl(0.1, 0.18, 0xe0762a, 0, 0.03, 0, 8),
  cyl(0.06, 0.16, 0xf2f2ee, 0, 0.21, 0, 8),
  cyl(0.03, 0.1, 0xe0762a, 0, 0.37, 0, 8),
];

/** The next district's rooftops past a sector's fence: blocks of grey at a distance, seeded by the place. */
function beyond(plan: CityPlan, d: number, out: Part[], streets: ReadonlyArray<{ side: number; at: number }>) {
  const TONES = [0x8a8478, 0x7d8690, 0x94806c, 0x7c8a7c, 0x8c7a74, 0x9a9488];
  const ROOFS = [0x6a4a40, 0x4f5862, 0x5c5248, 0x586456, 0x55585e];
  for (let side = 0; side < 4; side++) {
    if (neighbour(d, side) < 0) continue;
    for (let k = 1; k < MAP_W - 1;) {
      const r = mix32(plan.seed ^ (d * 7919 + side * 104729 + k * 31));
      const w = 3 + (r & 3);
      const deep = 3 + ((r >> 3) & 3);
      const tall = 1.6 + ((r >> 6) & 7) * 0.45;
      const far = 2.5 + ((r >> 10) & 3);
      const mid = k + w / 2;
      const off = far + deep / 2;
      const [x, z, bw, bd] =
        side === SIDE.N
          ? [mid, -off, w, deep]
          : side === SIDE.S
            ? [mid, MAP_H + off, w, deep]
            : side === SIDE.W
              ? [-off, mid, deep, w]
              : [MAP_W + off, mid, deep, w];
      // (A gap left now and then; never over a street that runs on past the border.)
      const onStreet = streets.some((s) => s.side === side && Math.abs(s.at - mid) < w / 2 + 1.5);
      if ((r >> 13) & 3 && !onStreet) {
        // (2.57: a building, not a block: its walls a faded paint, a roof slab in its own colour, rows of dark windows in the face the camera sees.)
        out.push(box(bw - 0.4, tall, bd - 0.4, TONES[(r >> 16) % TONES.length], x, 0, z));
        out.push(box(bw - 0.2, 0.14, bd - 0.2, ROOFS[(r >> 19) % ROOFS.length], x, tall, z));
        for (let y = 0.7; y + 0.5 < tall; y += 0.85) out.push(box(bw - 1.1, 0.34, 0.03, GLASS, x, y, z + (bd - 0.4) / 2 + 0.01));
      }
      k += w + ((r >> 20) & 1);
    }
  }
}

/**
 * A survivor (C4): one of the living, standing straight, arms at their sides, dressed for what they are:
 * the fence in the bus's orange with a wool cap, the nurse in teal scrubs and a white cap with its cross,
 * the mechanic in blue overalls and a peaked cap, the ranger in a green jacket and a brimmed hat.
 */
function folk(who: number): Part[] {
  const SKINS = [0xc98f6a, 0x8a5a3c, 0xe2b48c, 0xd6a878];
  const skin = SKINS[who % SKINS.length];
  const cloth = [0xe8762a, 0x4fb8ae, 0x3f6fc0, 0x5f8f4a][who % 4];
  const legs = [0xc9601e, 0x3f948c, 0x2f528e, 0x5a4a36][who % 4];
  const parts = [
    box(0.16, 0.46, 0.18, legs, -0.11, 0, 0),
    box(0.16, 0.46, 0.18, legs, 0.11, 0, 0),
    box(0.46, 0.5, 0.26, cloth, 0, 0.46, 0),
    box(0.12, 0.44, 0.14, cloth, -0.29, 0.5, 0),
    box(0.12, 0.44, 0.14, cloth, 0.29, 0.5, 0),
    box(0.12, 0.1, 0.14, skin, -0.29, 0.4, 0),
    box(0.12, 0.1, 0.14, skin, 0.29, 0.4, 0),
    box(0.36, 0.34, 0.34, skin, 0, 0.98, 0.02),
    box(0.07, 0.06, 0.02, 0x241a14, -0.09, 1.14, 0.2),
    box(0.07, 0.06, 0.02, 0x241a14, 0.09, 1.14, 0.2),
    box(0.12, 0.03, 0.02, 0x6a3a2a, 0, 1.05, 0.2),
  ];
  if (who % 4 === 0) parts.push(box(0.4, 0.14, 0.38, 0x2c3440, 0, 1.3, 0.01), box(0.2, 0.05, 0.02, 0xf4f1ea, 0, 0.78, 0.14));
  else if (who % 4 === 1)
    parts.push(
      box(0.38, 0.1, 0.36, 0xf4f1ea, 0, 1.3, 0.01),
      box(0.12, 0.04, 0.02, 0xc24a3a, 0, 1.33, 0.2),
      box(0.04, 0.09, 0.02, 0xc24a3a, 0, 1.305, 0.2),
      box(0.3, 0.3, 0.02, 0xf4f1ea, 0, 0.5, 0.14),
    );
  else if (who % 4 === 2)
    parts.push(
      box(0.38, 0.09, 0.36, 0x2f528e, 0, 1.3, 0.01),
      box(0.3, 0.03, 0.16, 0x24406e, 0, 1.3, 0.24),
      box(0.1, 0.5, 0.02, 0x24406e, -0.12, 0.46, 0.14),
      box(0.1, 0.5, 0.02, 0x24406e, 0.12, 0.46, 0.14),
    );
  else
    parts.push(
      box(0.56, 0.03, 0.54, 0x6a5236, 0, 1.3, 0.01),
      box(0.34, 0.12, 0.32, 0x6a5236, 0, 1.32, 0.01),
      box(0.1, 0.1, 0.02, 0xd8b04a, -0.12, 0.8, 0.14),
    );
  return parts;
}

/**
 * An awning over a street door, in the colour of what the building is (C4): the city read from above. A landmark's is wider, with a
 * white band. 2.64: every one has a pale edge along its front, so a door reads as one against walls of the same colour (a house's
 * brown on brick was missed, and players walked round looking for the way in).
 */
function awning(color: number, big: boolean): Part[] {
  const w = big ? 1.5 : 0.96;
  const out = [
    box(w, 0.06, 0.62, color, 0, WALL_H - 0.34, 0.2),
    box(w, 0.2, 0.05, color, 0, WALL_H - 0.5, 0.5),
    box(w, 0.07, 0.1, 0xf4f1ea, 0, WALL_H - 0.335, 0.46),
  ];
  if (big) out.push(box(w, 0.07, 0.16, 0xf4f1ea, 0, WALL_H - 0.335, 0.28));
  return out;
}
const AWNINGS: Partial<Record<string, number>> = {
  house: 0x9a7a58,
  shop: 0x3f8f88,
  office: 0x5f7298,
  warehouse: 0x6d655a,
  clinic: 0xd9e2e6,
  garage: 0x7a7264,
  station: 0xe0913a,
  tower: 0x8fa4d8,
  factory: 0xa06a3c,
  hospital: 0xf0f2f2,
  boathouse: 0x4fa0c8,
  rangers: 0x6fb45a,
  mall: 0x48c0b4,
  police: 0x4a6ed0,
  metro: 0xd6b83a,
};

/** Weeds through the paving, litter on the road (C4): never in the way. */
function weeds(h: number): Part[] {
  const g = [0x4f7a3a, 0x5f8a44, 0x6a7a3a][(h >> 3) % 3];
  const out = [
    box(0.06, 0.2 + ((h >> 5) & 3) * 0.05, 0.06, g, -0.2, 0, 0.12),
    box(0.05, 0.16, 0.05, g, 0.1, 0, -0.18),
    box(0.07, 0.26, 0.05, g, 0.24, 0, 0.2),
  ];
  if (h & 64) out.push(box(0.05, 0.3, 0.05, 0x7a8a3a, -0.05, 0, -0.02));
  return out;
}
function litter(h: number): Part[] {
  const c = [0xd8d2c0, 0xb8b0a0, 0xc9b79a][(h >> 3) % 3];
  return [box(0.26, 0.012, 0.18, c, -0.14, 0.004, 0.1), box(0.16, 0.012, 0.22, 0xa8a090, 0.2, 0.004, -0.16)];
}
/** 2.52: how far the player makes out the dead at night (tiles): by the faint light round them, by their torch; and what one out of the light looks like. */
const GLOW_SEES = 3;
const TORCH_SEES = 6.5;
/** 2.61: the docks' fog: clear within so many tiles of the player, thick from so many; its colour. */
const FOG_CLEAR = 2.2;
const FOG_THICK = 5.5;
// (2.65: a night's fog, blue-grey: the pale one glowed like day over a dark city.)
const FOG_TINT = 0x37424e;
/** How dark a building's depths are drawn by day (2.53). */
const GLOOM = 0.5;
const GLOOM_NIGHT = 0.5;
const DARK_IRON = 0x2a2f36;
/** A flame: a narrow cone on its foot; a work lamp: a small bright box. */
const FLAME_GEO = new THREE.ConeGeometry(0.2, 0.55, 6).translate(0, 0.27, 0);
const HOT_GEO = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
/** 2.65: the least of a light's pool on a tile it lights (the edge of what the dead keep out of). */
const LIT_FLOOR = 0.18;
/** 2.65: a light's glow on the floor, its edge faded out (a square drawn with a round soft spot). */
const SOFT_GEO = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
let softSpot: THREE.Texture | null = null;
/** A white spot fading to nothing at its rim, smoothly (made once, in the browser). */
function soft(): THREE.Texture | null {
  if (softSpot || typeof document === 'undefined') return softSpot;
  const n = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d');
  if (!g) return null;
  const r = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  for (let k = 0; k <= 8; k++) {
    const f = k / 8;
    // (Falling off as light does, then gone well before the square's edge.)
    r.addColorStop(f, `rgba(255,255,255,${(1 - f * f) ** 1.6})`);
  }
  g.fillStyle = r;
  g.fillRect(0, 0, n, n);
  softSpot = new THREE.CanvasTexture(cv);
  softSpot.colorSpace = THREE.SRGBColorSpace;
  return softSpot;
}
const LAMP_GEO = new THREE.BoxGeometry(0.18, 0.1, 0.18).translate(0, 0.06, 0);

export class CityView {
  readonly group = new THREE.Group();
  /** The dead (2.60: render/horde.ts), kept across districts. */
  private readonly horde = new Horde();
  readonly root = new THREE.Group();
  /** After dark: a faint pool of light round the player. */
  private readonly glow: THREE.Mesh;
  /**
   * 2.64: a pale ring under the player's feet, always: from this camera their top is dark hair, and at night they were one dark
   * shape among the dead. Brighter after dark.
   */
  private readonly you = new THREE.Mesh(
    new THREE.RingGeometry(0.32, 0.44, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xf4f1ea, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }),
  );
  /** 2.64: where one of the dead fell, a stain that fades over a minute and a half (render only, the district's alone). */
  private readonly stains = new THREE.Group();
  private readonly stainGeo = mergeGeometries([
    new THREE.CircleGeometry(0.3, 12).rotateX(-Math.PI / 2),
    new THREE.CircleGeometry(0.2, 10).rotateX(-Math.PI / 2).translate(0.24, 0, 0.1),
    new THREE.CircleGeometry(0.13, 8).rotateX(-Math.PI / 2).translate(-0.2, 0, -0.22),
  ]);

  constructor() {
    // (2.65: soft at its rim, as light is: a flat disc had an edge.)
    this.glow = new THREE.Mesh(
      new THREE.PlaneGeometry(5.2, 5.2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false, map: soft() }),
    );
    this.glow.renderOrder = 0.44;
    this.glow.visible = false;
    this.you.renderOrder = 0.46;
    this.you.visible = false;
    this.root.add(
      this.group,
      this.horde.group,
      this.glow,
      this.you,
      this.stains,
      this.bars,
      this.cars,
      this.pieces,
      this.ghost,
      this.locks,
      this.marks,
      this.folk,
      this.hearths,
      this.live.group,
      this.lights,
      this.alarms,
      this.fires,
      this.fx,
      this.track,
    );
  }

  /**
   * Light and fire (2.52): the tiles in strong light, washed warm (exactly the tiles the dead keep out of),
   * and what burns: flames over a barrel, a lantern on the floor, a lamp over a running generator.
   */
  private readonly lights = new THREE.Group();
  private readonly flames: THREE.Mesh[] = [];
  private readonly poolMat = new THREE.MeshBasicMaterial({
    color: 0xffc46a,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    toneMapped: false,
    vertexColors: true,
    // (2.65: light added to what it falls on, as light is: a wash over the dark tarmac was all but lost.)
    blending: THREE.AdditiveBlending,
  });
  private readonly hotMat = new THREE.MeshBasicMaterial({
    color: 0xffd890,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    toneMapped: false,
    map: soft(),
    blending: THREE.AdditiveBlending,
  });
  private readonly flameMat = new THREE.MeshBasicMaterial({ color: 0xffa23a, toneMapped: false });
  private readonly coreMat = new THREE.MeshBasicMaterial({ color: 0xfff0a8, toneMapped: false });
  /** 2.53: the gloom of a building's depths by day, over everything that stands in it (the tiles daylight and no light reach). */
  private readonly gloomMat = new THREE.MeshBasicMaterial({
    color: 0x05070c,
    transparent: true,
    opacity: GLOOM,
    depthWrite: false,
    vertexColors: true,
  });
  private gloom: THREE.Mesh | null = null;
  private lit: Uint8Array | null = null;
  private dim: Uint8Array | null = null;
  private torch = false;
  /** `dim`: the tiles daylight doesn't reach (City.dim); `solid` (2.65): what stands in the way (walls, furniture), for the shade's edges. */
  setLights(
    list: ReadonlyArray<readonly [number, number, number]>,
    lit: Uint8Array,
    dim: Uint8Array,
    solid?: Uint8Array,
    lotAt?: Uint8Array,
  ) {
    const keep = new Set<THREE.Material>([kitMaterial, this.poolMat, this.hotMat, this.flameMat, this.coreMat, this.gloomMat]);
    disposeTree(this.lights, () => false, keep);
    this.lights.clear();
    this.flames.length = 0;
    this.lit = list.length ? lit : null;
    this.dim = dim;
    this.gloom = null;
    // (2.57: a body of shade standing in each dark room, waist high: what stands in it is in the dark, the roof's edge over it is not.
    // 2.65: one sheet, its edges soft: each corner as dark as the share of the open tiles round it that are dark (walls and furniture
    // not counted, so a room is as dark against its walls as in its middle). Before, it stepped tile by tile where daylight came in
    // and its walls of shade stood like blocks.)
    const inside = (x: number, z: number) => x >= 0 && z >= 0 && x < W && z < H;
    const isDark = (x: number, z: number) => inside(x, z) && !!dim[z * W + x] && !(list.length && lit[z * W + x]);
    const counts = (x: number, z: number) => inside(x, z) && !solid?.[z * W + x];
    const corner = (cx: number, cz: number) => {
      let dark = 0;
      let open = 0;
      for (const [x, z] of [
        [cx - 1, cz - 1],
        [cx, cz - 1],
        [cx - 1, cz],
        [cx, cz],
      ]) {
        if (isDark(x, z)) dark++;
        else if (counts(x, z)) open++;
      }
      const a = dark + open ? dark / (dark + open) : 0;
      return a * a * (3 - 2 * a);
    };
    const pos: number[] = [];
    const rgba: number[] = [];
    const quad = (p: number[], a: number[]) => {
      for (const k of [0, 1, 2, 0, 2, 3]) {
        pos.push(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
        rgba.push(1, 1, 1, a[k]);
      }
    };
    const TOP = 0.8;
    const near = new Uint8Array(W * H);
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++)
        if (isDark(x, z))
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (inside(x + dx, z + dz)) near[(z + dz) * W + x + dx] = 1;
    for (let z = 0; z < H; z++)
      for (let x = 0; x < W; x++) {
        if (!near[z * W + x]) continue;
        const a = [corner(x, z), corner(x, z + 1), corner(x + 1, z + 1), corner(x + 1, z)];
        if (a.every((v) => v === 0)) continue;
        quad([x, TOP, z, x, TOP, z + 1, x + 1, TOP, z + 1, x + 1, TOP, z], a);
      }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(rgba, 4));
      this.gloom = new THREE.Mesh(g, this.gloomMat);
      this.gloom.renderOrder = 0.42;
      this.lights.add(this.gloom);
    }
    if (!list.length) return;
    // The pool: a quad a lit tile, in one piece. 2.65: bright by a fire or a lantern and fading out to its reach (each corner by its
    // distance from the nearest), even over a generator's building: before, a flat wash of tiles in a stepped cross.
    const spots = list
      .filter(([, kind]) => kind !== 2)
      .map(([tile, kind]) => ({ x: (tile % W) + 0.5, z: Math.floor(tile / W) + 0.5, r: (kind === 0 ? 4 : 3) + 0.5 }));
    // (A generator's building: its own wash all through, whatever else burns near; by its lot, or failing that, out of every flame's reach.)
    const powered = new Set(list.filter(([, kind]) => kind === 2).map(([tile]) => lotAt?.[tile] ?? 0));
    const byPower = (i: number) =>
      lotAt
        ? lotAt[i] > 0 && powered.has(lotAt[i])
        : !spots.some((s) => Math.max(Math.abs((i % W) + 0.5 - s.x), Math.abs(Math.floor(i / W) + 0.5 - s.z)) < s.r);
    const glow = (x: number, z: number) => {
      let a = 0;
      for (const s of spots) {
        const f = Math.max(0, 1 - Math.hypot(x - s.x, z - s.z) / s.r);
        a = Math.max(a, Math.sqrt(f) * (0.4 + 0.6 * f));
      }
      return a;
    };
    const pPos: number[] = [];
    const pRgba: number[] = [];
    for (let i = 0; i < W * H; i++) {
      if (!lit[i]) continue;
      const x = i % W;
      const z = Math.floor(i / W);
      const power = byPower(i);
      // (A floor under every lit tile: where the light ends is where the dead stop, and it shows, faintly.)
      const at = (cx: number, cz: number) => Math.max(power ? 0.75 : 0, LIT_FLOOR, glow(cx, cz));
      const c = [at(x, z), at(x, z + 1), at(x + 1, z + 1), at(x + 1, z)];
      const p = [x, 0.034, z, x, 0.034, z + 1, x + 1, 0.034, z + 1, x + 1, 0.034, z];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        pPos.push(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
        pRgba.push(1, 1, 1, c[k]);
      }
    }
    if (pPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(pRgba, 4));
      const pool = new THREE.Mesh(g, this.poolMat);
      pool.renderOrder = 0.45;
      this.lights.add(pool);
    }
    const things: Part[] = [];
    for (const [tile, kind] of list) {
      const x = (tile % W) + 0.5;
      const z = Math.floor(tile / W) + 0.5;
      // (A fire: over the barrel's rim; a lantern: on the floor; a generator: a work lamp on a stand beside its top.)
      // (2.67: a campfire's low among its logs.)
      const y = kind === 0 ? 0.62 : kind === 1 ? 0.2 : kind === 3 ? 0.16 : 0.95;
      if (kind === 1)
        put(
          things,
          [cyl(0.11, 0.2, 0x6a8a5a, 0, 0, 0, 8), cyl(0.13, 0.03, DARK_IRON, 0, 0, 0, 8), cyl(0.05, 0.05, DARK_IRON, 0, 0.2, 0, 6)],
          x,
          z,
        );
      if (kind === 2) put(things, [cyl(0.03, 0.95, DARK_IRON, 0.3, 0, 0.3, 6), box(0.22, 0.06, 0.22, DARK_IRON, 0.3, 0.95, 0.3)], x, z);
      const flame = new THREE.Mesh(kind === 2 ? LAMP_GEO : FLAME_GEO, kind === 2 ? this.coreMat : this.flameMat);
      flame.position.set(kind === 2 ? x + 0.3 : x, y, kind === 2 ? z + 0.3 : z);
      flame.userData.kind = kind;
      flame.userData.seed = tile * 0.37;
      if (kind !== 2) {
        const core = new THREE.Mesh(FLAME_GEO, this.coreMat);
        core.scale.setScalar(0.5);
        flame.add(core);
      }
      if (kind === 1) flame.scale.setScalar(0.55);
      if (kind === 3) flame.scale.setScalar(0.85);
      // (The hot middle of its light, on the floor round it.)
      if (kind !== 2) {
        const hot = new THREE.Mesh(SOFT_GEO, this.hotMat);
        hot.position.set(x, 0.038, z);
        hot.scale.setScalar(kind === 0 ? 1.9 : 1.4);
        hot.renderOrder = 0.46;
        this.lights.add(hot);
      }
      this.flames.push(flame);
      this.lights.add(flame);
    }
    if (things.length) {
      const m = new THREE.Mesh(merge(things), kitMaterial);
      m.castShadow = true;
      this.lights.add(m);
    }
  }
  /** Cars searched (2.54): a small red light on the roof of each car whose alarm would still go off (`at`: the car's middle, in tiles). */
  private readonly alarms = new THREE.Group();
  private readonly alarmMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, toneMapped: false });
  /** 2.65: the tunnel's rock and its ballast (`setTunnel`). */
  // (Cut away round the player as the walls under it are: a cap over the south wall stood over their legs.)
  private readonly rockMat = seeThrough(new THREE.MeshBasicMaterial({ vertexColors: true }));
  private readonly ballastMat = new THREE.MeshBasicMaterial({ color: 0x24211d, transparent: true, opacity: 0.55, depthWrite: false });
  setAlarms(at: ReadonlyArray<{ x: number; z: number }>) {
    for (const m of this.alarms.children) (m as THREE.Mesh).geometry.dispose();
    this.alarms.clear();
    for (const p of at) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14), this.alarmMat);
      lamp.position.set(p.x, 0.7, p.z);
      this.alarms.add(lamp);
    }
  }

  /** The metro's tunnel (2.56): sleepers and rails along its way, a ladder under a shaft of light at its end (`way`: the track's middle, tile by tile; null: not the tunnel). */
  private readonly track = new THREE.Group();
  private readonly shaftMat = new THREE.MeshBasicMaterial({
    color: 0xcfe2ff,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    toneMapped: false,
  });
  setTunnel(way: readonly number[] | null, rows?: readonly string[]) {
    disposeTree(this.track, () => false, new Set<THREE.Material>([kitMaterial, this.shaftMat, this.rockMat, this.ballastMat]));
    this.track.clear();
    if (!way?.length) return;
    // (2.65: under the ground: the rock over the walls rough and dark, not a building's tiled roof; the floor ballast, not a pale
    // concrete. Render only; drawn over the world's own tops and floor.)
    if (rows) {
      const rock: number[] = [];
      const rockRgb: number[] = [];
      const floor: THREE.BufferGeometry[] = [];
      const top = WALL_H + 0.015;
      for (let i = 0; i < W * H; i++) {
        const x = i % W;
        const z = Math.floor(i / W);
        const ch = rows[z]?.[x];
        if (ch === '_') {
          floor.push(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(x + 0.5, 0.012, z + 0.5));
          continue;
        }
        const h = mix32(Math.imul(i + 1, 0x9e3779b1));
        // (Linear colour: a dark stone, each tile a little different.)
        const v = 0.017 + ((h & 255) / 255) * 0.007;
        const tint = [v * 1.12, v, v * 0.85];
        // (Each corner a little higher than the wall's top, shared by the tiles round it: rock, not a cap laid flat, and no cracks.)
        const y = (cx: number, cz: number) => top + 0.006 + ((mix32(Math.imul(cz * 65 + cx + 1, 0x85ebca6b)) >>> 0) % 8) * 0.009;
        const c = [
          [x, y(x, z), z],
          [x, y(x, z + 1), z + 1],
          [x + 1, y(x + 1, z + 1), z + 1],
          [x + 1, y(x + 1, z), z],
        ];
        for (const k of [0, 1, 2, 0, 2, 3]) {
          rock.push(...c[k]);
          rockRgb.push(...tint);
        }
      }
      if (rock.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(rock, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(rockRgb, 3));
        this.track.add(new THREE.Mesh(g, this.rockMat));
      }
      if (floor.length) {
        const m = new THREE.Mesh(mergeGeometries(floor), this.ballastMat);
        for (const g of floor) g.dispose();
        m.renderOrder = 0.2;
        this.track.add(m);
      }
    }
    const parts: Part[] = [];
    const SLEEPER = 0x4a3a2c;
    const RAIL = 0x7c8794;
    way.forEach((tile, k) => {
      const x = (tile % W) + 0.5;
      const z = Math.floor(tile / W) + 0.5;
      const next = way[k + 1] ?? tile + (tile - (way[k - 1] ?? tile));
      const prev = way[k - 1] ?? tile - (next - tile);
      // (A straight tile: sleepers across it, a rail either side; a corner's is left bare.)
      if (next - tile !== tile - prev) return;
      const east = Math.abs(next - tile) === 1;
      for (const o of [-0.25, 0.25])
        put(parts, [box(east ? 0.16 : 0.9, 0.03, east ? 0.9 : 0.16, SLEEPER, 0, 0.005, 0)], x + (east ? o : 0), z + (east ? 0 : o));
      for (const o of [-0.3, 0.3])
        put(parts, [box(east ? 1 : 0.07, 0.07, east ? 0.07 : 1, RAIL, 0, 0.03, 0)], x + (east ? 0 : o), z + (east ? o : 0));
    });
    const end = way[way.length - 1];
    const ex = (end % W) + 0.5;
    const ez = Math.floor(end / W) + 0.5;
    const ladder: Part[] = [box(0.06, 2.4, 0.06, DARK_IRON, -0.22, 0, 0), box(0.06, 2.4, 0.06, DARK_IRON, 0.22, 0, 0)];
    for (let r = 0; r < 7; r++) ladder.push(box(0.44, 0.04, 0.04, DARK_IRON, 0, 0.25 + r * 0.32, 0));
    put(parts, ladder, ex + 0.35, ez);
    const mesh = new THREE.Mesh(merge(parts), kitMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.track.add(mesh);
    const shaft = new THREE.Mesh(HOT_GEO, this.shaftMat);
    shaft.position.set(ex, 0.04, ez);
    shaft.scale.setScalar(1.3);
    shaft.renderOrder = 0.48;
    this.track.add(shaft);
  }

  /** Thrown and shot (2.55): the flames on what burns, each on a scorched tile; a bottle's arc; a bolt's streak. */
  private readonly fires = new THREE.Group();
  private readonly fx = new THREE.Group();
  private readonly scorchMat = new THREE.MeshBasicMaterial({
    color: 0xff7a1a,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly thrownMat = new THREE.MeshBasicMaterial({ color: 0x9fc08a, toneMapped: false });
  private readonly boltMat = new THREE.MeshBasicMaterial({ color: 0xf2efe6, toneMapped: false });
  private firesAt = '';
  setFires(tiles: readonly number[]) {
    const key = tiles.join();
    if (key === this.firesAt) return;
    // (Those already burning keep their flames as they are: only the new ones grow in.)
    const had = new Set(this.firesAt ? this.firesAt.split(',').map(Number) : []);
    this.firesAt = key;
    for (const m of [...this.fires.children]) {
      if (tiles.includes(m.userData.tile as number)) continue;
      this.fires.remove(m);
      if (m.userData.own) (m as THREE.Mesh).geometry.dispose();
    }
    for (const tile of tiles) {
      if (had.has(tile)) continue;
      const x = (tile % W) + 0.5;
      const z = Math.floor(tile / W) + 0.5;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.scorchMat);
      floor.position.set(x, 0.036, z);
      floor.renderOrder = 0.47;
      floor.userData = { tile, own: true };
      this.fires.add(floor);
      for (const [dx, dz, size] of [
        [-0.2, -0.15, 1],
        [0.22, 0.05, 0.8],
        [-0.05, 0.25, 0.65],
      ]) {
        const flame = new THREE.Mesh(FLAME_GEO, this.flameMat);
        flame.position.set(x + dx, 0.02, z + dz);
        flame.userData = { tile, size, seed: tile * 0.61 + dx * 7, born: -1 };
        const core = new THREE.Mesh(FLAME_GEO, this.coreMat);
        core.scale.setScalar(0.5);
        flame.add(core);
        this.fires.add(flame);
      }
    }
  }
  /** Something thrown from a place to another (in tiles; `fire`: a molotov), or a bolt shot. */
  throwFx(from: { x: number; z: number }, to: { x: number; z: number }, kind: 'bottle' | 'molotov' | 'bolt') {
    const bolt = kind === 'bolt';
    const m = new THREE.Mesh(
      bolt ? new THREE.BoxGeometry(0.04, 0.04, 0.5) : new THREE.BoxGeometry(0.12, 0.2, 0.12),
      bolt ? this.boltMat : kind === 'molotov' ? this.flameMat : this.thrownMat,
    );
    m.userData = { from, to, born: -1, dur: bolt ? 0.12 : 0.28, bolt };
    if (bolt) m.rotation.y = Math.atan2(to.x - from.x, to.z - from.z);
    m.visible = false;
    this.fx.add(m);
  }
  private drawFx(time: number, still: boolean) {
    for (const f of this.fires.children) {
      const u = f.userData as { size?: number; seed: number; born: number };
      if (u.size === undefined) continue;
      if (u.born < 0) u.born = time;
      const grow = Math.min(1, (time - u.born) / 0.3);
      const k = still ? 1 : 1 + Math.sin(time * 12 + u.seed) * 0.14 + Math.sin(time * 27 + u.seed * 2) * 0.07;
      f.scale.set(u.size * grow * (2 - k), u.size * grow * k * 1.25, u.size * grow * (2 - k));
      if (!still) f.rotation.y = time * 2.4 + u.seed;
    }
    for (const m of [...this.fx.children]) {
      const u = m.userData as { from: { x: number; z: number }; to: { x: number; z: number }; born: number; dur: number; bolt: boolean };
      if (u.born < 0) u.born = time;
      const t = (time - u.born) / u.dur;
      if (t >= 1) {
        this.fx.remove(m);
        (m as THREE.Mesh).geometry.dispose();
        continue;
      }
      m.visible = true;
      m.position.set(
        u.from.x + (u.to.x - u.from.x) * t,
        u.bolt ? 0.95 : 0.9 + Math.sin(t * Math.PI) * 1.1,
        u.from.z + (u.to.z - u.from.z) * t,
      );
      if (!u.bolt && !still) m.rotation.x = time * 14;
    }
  }

  /** The fires flicker, the pool is stronger after dark; `torch`: the player's own light is the torch's (wider, warm). */
  drawLights(time: number, still: boolean, night: boolean, torch: boolean) {
    this.torch = torch;
    this.drawFx(time, still);
    // (A car's alarm light: two blinks every second and a half; held lit when nothing should move.)
    this.alarms.visible = still || time % 1.5 < 0.2 || (time % 1.5 > 0.4 && time % 1.5 < 0.6);
    // (After dark the rooms keep a thinner shade: no moon gets in, and a pale floor doesn't outshine the street. 2.57.)
    this.gloomMat.opacity = night ? GLOOM_NIGHT : GLOOM;
    // (2.65: added light, fading to its reach: stronger at its heart than the flat wash it was.)
    this.poolMat.opacity = night ? 0.5 : 0.08;
    this.sheenMat.opacity = night ? 0.16 : 0;
    this.sheenMat.visible = night;
    // (2.61: a warm wash that fades at its rim, a flicker in it; by day hardly there.)
    this.hearthMat.opacity = night ? (still ? 0.62 : 0.62 + Math.sin(time * 7) * 0.05) : 0.08;
    this.hearthFlame.color.set(night ? 0xffc46a : 0xc9b894);
    this.hotMat.opacity = night ? 0.45 : 0.1;
    for (const f of this.flames) {
      if (f.userData.kind === 2) continue;
      const base = f.userData.kind === 1 ? 0.55 : 1;
      const s = f.userData.seed as number;
      const k = still ? 1 : 1 + Math.sin(time * 11 + s) * 0.12 + Math.sin(time * 23 + s * 2) * 0.06;
      f.scale.set(base * (2 - k), base * k, base * (2 - k));
      if (!still) f.rotation.y = time * 2 + s;
    }
  }

  /** The landmark's pieces that change with the story (2.50). */
  private readonly live = new LandmarkLive();
  private readonly landMat = seeThrough(kitMaterial.clone(), 0.6);
  /** 2.57: the windows and what stands on the roofs' edges, cut through with the walls they are on. */
  private readonly facadeMat = seeThrough(kitMaterial.clone());
  drawLandmark(f: LandmarkFrame) {
    this.live.draw(f);
  }

  /** The survivors in this district: the dead's own body, standing straight in the colours of the living. */
  private readonly folk = new THREE.Group();
  setPeople(list: ReadonlyArray<{ who: number; tile: number }>, facing: (tile: number) => number) {
    disposeTree(this.folk, () => false, new Set([kitMaterial]));
    this.folk.clear();
    disposeTree(this.hearths, () => false, new Set([kitMaterial, this.hearthMat, this.hearthFlame]));
    this.hearths.clear();
    for (const p of list) {
      const mesh = new THREE.Mesh(merge(folk(p.who)), kitMaterial);
      mesh.castShadow = true;
      mesh.scale.setScalar(1.3);
      mesh.position.set((p.tile % W) + 0.5, 0, Math.floor(p.tile / W) + 0.5);
      mesh.rotation.y = facing(p.tile);
      this.folk.add(mesh);
      // (2.59: the living keep a light: a storm lantern at their feet, its flame and a warm pool on the floor after dark.
      // To look at only: the rules' light is what the player lights.)
      const x = (p.tile % W) + 0.84;
      const z = Math.floor(p.tile / W) + 0.84;
      const lamp = new THREE.Mesh(
        merge([
          box(0.2, 0.05, 0.2, 0x3a3f46, 0, 0, 0),
          box(0.2, 0.04, 0.2, 0x3a3f46, 0, 0.25, 0),
          box(0.04, 0.1, 0.04, 0x3a3f46, 0, 0.29, 0),
        ]),
        kitMaterial,
      );
      lamp.position.set(x, 0, z);
      // (Warm at the lantern, nothing at its rim: the pool fades out, no edge to it. 2.61: laid over the floor, not added to
      // it: added, a pale floor washed out to white.)
      const g = new THREE.CircleGeometry(3.2, 32).rotateX(-Math.PI / 2);
      const n = g.getAttribute('position').count;
      const rgba = new Float32Array(n * 4);
      for (let k = 0; k < n; k++) rgba.set([1, 0.58, 0.2, k === 0 ? 1 : 0], k * 4);
      g.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
      // (Its glass: the light itself, lit after dark.)
      const flame = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.14), this.hearthFlame);
      flame.position.set(x, 0.15, z);
      const pool = new THREE.Mesh(g, this.hearthMat);
      pool.position.set(x, 0.03, z);
      this.hearths.add(lamp, flame, pool);
    }
  }
  private readonly hearths = new THREE.Group();
  private readonly hearthMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly hearthFlame = new THREE.MeshBasicMaterial({ color: 0xffc46a, toneMapped: false });

  /** A survivor turns to the player when they come near (within four tiles). */
  facePeople(x: number, z: number) {
    for (const m of this.folk.children) {
      const dx = x - m.position.x;
      const dz = z - m.position.z;
      if (dx * dx + dz * dz < 16 && dx * dx + dz * dz > 0.04) m.rotation.y = Math.atan2(dx, dz);
    }
  }

  /** Where the story points in this district: a lit diamond turning over each tile, a ring on the floor under it. */
  private readonly marks = new THREE.Group();
  private readonly markGem = new THREE.OctahedronGeometry(0.2);
  private readonly markRing = new THREE.RingGeometry(0.34, 0.44, 24).rotateX(-Math.PI / 2);
  private readonly markMat = new THREE.MeshBasicMaterial({
    color: 0xf2c230,
    toneMapped: false,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  setMarks(tiles: readonly number[]) {
    this.marks.clear();
    for (const i of tiles) {
      const g = new THREE.Group();
      g.position.set((i % W) + 0.5, 0, Math.floor(i / W) + 0.5);
      const gem = new THREE.Mesh(this.markGem, this.markMat);
      gem.scale.set(1, 1.5, 1);
      gem.position.y = 1.9;
      const ring = new THREE.Mesh(this.markRing, this.markMat);
      ring.position.y = 0.04;
      ring.renderOrder = 0.5;
      g.add(gem, ring);
      this.marks.add(g);
    }
  }

  /**
   * 2.67: what's built in the district (tile, kind, how worn 0–1, its angle: a wall across the way it was built from), cut away
   * round the player above the waist as the furniture is; and the piece being placed, see-through, green where it can go.
   */
  private readonly pieces = new THREE.Group();
  private readonly pieceMat = seeThrough(kitMaterial.clone(), 0.6);
  setPieces(list: ReadonlyArray<{ tile: number; kind: number; worn: number; angle: number }>) {
    disposeTree(this.pieces, () => false, new Set([kitMaterial, this.pieceMat]));
    this.pieces.clear();
    if (!list.length) return;
    const parts: Part[] = [];
    for (const p of list) put(parts, pieceParts(p.kind, p.worn, p.tile), (p.tile % W) + 0.5, Math.floor(p.tile / W) + 0.5, p.angle);
    const mesh = new THREE.Mesh(merge(parts), this.pieceMat);
    mesh.castShadow = mesh.receiveShadow = true;
    this.pieces.add(mesh);
  }
  private readonly ghost = new THREE.Group();
  private readonly ghostOk = new THREE.MeshBasicMaterial({ color: 0x6fd08a, transparent: true, opacity: 0.45, depthWrite: false });
  private readonly ghostNo = new THREE.MeshBasicMaterial({ color: 0xe0564a, transparent: true, opacity: 0.4, depthWrite: false });
  private ghostKey = '';
  setGhost(g: { tile: number; kind: number; angle: number; ok: boolean } | null) {
    const key = g ? `${g.tile}|${g.kind}|${g.angle}|${g.ok}` : '';
    if (key === this.ghostKey) return;
    this.ghostKey = key;
    disposeTree(this.ghost, () => false, new Set([this.ghostOk, this.ghostNo]));
    this.ghost.clear();
    if (!g || g.tile < 0) return;
    const parts: Part[] = [];
    put(parts, pieceParts(g.kind, 0, g.tile), (g.tile % W) + 0.5, Math.floor(g.tile / W) + 0.5, g.angle);
    const mesh = new THREE.Mesh(merge(parts), g.ok ? this.ghostOk : this.ghostNo);
    mesh.renderOrder = 0.5;
    this.ghost.add(mesh);
    // (Its tile marked on the floor too: where it will stand.)
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2), g.ok ? this.ghostOk : this.ghostNo);
    floor.position.set((g.tile % W) + 0.5, 0.04, Math.floor(g.tile / W) + 0.5);
    this.ghost.add(floor);
  }

  /** 2.66: the cars and wrecks of the district (where, which way, their look's seed), and the mesh they are drawn in. */
  private carSpots: Array<{ i: number; x: number; z: number; along: number; h: number; wreck: boolean }> = [];
  private readonly cars = new THREE.Group();
  /** The cars and wrecks, those stripped (their first tiles) drawn so. */
  setCars(stripped: readonly number[]) {
    disposeTree(this.cars, () => false, new Set([kitMaterial]));
    this.cars.clear();
    if (!this.carSpots.length) return;
    const gone = new Set(stripped);
    const parts: Part[] = [];
    for (const c of this.carSpots)
      put(
        parts,
        c.wreck ? car(0, true, (c.h >> 4) & 3, gone.has(c.i)) : car(PAINTS[c.h % PAINTS.length], false, (c.h >> 4) & 7, gone.has(c.i)),
        c.x,
        c.z,
        c.along,
      );
    const mesh = new THREE.Mesh(merge(parts), kitMaterial);
    mesh.castShadow = mesh.receiveShadow = true;
    this.cars.add(mesh);
  }

  /** Boards nailed across the barred doors (put up again whenever one is barred or opened). */
  private readonly bars = new THREE.Group();
  setBars(tiles: readonly number[], district: District) {
    disposeTree(this.bars, () => false, new Set([kitMaterial]));
    this.bars.clear();
    if (!tiles.length) return;
    const parts: Part[] = [];
    for (const i of tiles) {
      const x = (i % W) + 0.5;
      const z = Math.floor(i / W) + 0.5;
      // (Across the opening: along x where the walls are to the west and east of the door.)
      const row = district.rows[Math.floor(i / W)];
      const across = row[(i % W) - 1] === '#' || row[(i % W) + 1] === '#' ? 0 : Math.PI / 2;
      const boards = [
        box(1.04, 0.14, 0.08, 0x8a6a40, 0, 0.32, 0),
        box(1.04, 0.14, 0.08, 0x7a5c38, 0, 0.72, 0),
        box(1.04, 0.14, 0.08, 0x94713f, 0, 1.12, 0),
        box(0.12, 1.2, 0.09, 0x6f5330, -0.3, 0.1, 0.02),
        box(0.12, 1.2, 0.09, 0x6f5330, 0.3, 0.1, 0.02),
      ];
      put(parts, boards, x, z, across);
    }
    const mesh = new THREE.Mesh(merge(parts), kitMaterial);
    mesh.castShadow = true;
    this.bars.add(mesh);
  }

  /** 2.58: a chain and a padlock across each locked door. */
  private readonly locks = new THREE.Group();
  setLocks(locked: Uint8Array, district: District, broken: readonly number[] = []) {
    disposeTree(this.locks, () => false, new Set([kitMaterial]));
    this.locks.clear();
    const parts: Part[] = [];
    locked.forEach((on, i) => {
      if (!on) return;
      const row = district.rows[Math.floor(i / W)];
      const across = row[(i % W) - 1] === '#' || row[(i % W) + 1] === '#' ? 0 : Math.PI / 2;
      const STEEL = 0x8b929b;
      const BRASS = 0xe0b23a;
      // (Seen from above: two runs of chain over the shut leaf's top and down both its faces, a brass padlock where they cross.)
      const chain = [
        box(1.08, 0.06, 0.5, STEEL, 0, 1.41, 0),
        box(0.1, 0.07, 0.5, 0x6d747d, -0.3, 1.42, 0),
        box(0.1, 0.07, 0.5, 0x6d747d, 0.3, 1.42, 0),
        box(1.08, 0.07, 0.06, STEEL, 0, 0.74, 0.25),
        box(1.08, 0.07, 0.06, STEEL, 0, 0.74, -0.25),
        box(0.34, 0.12, 0.34, BRASS, 0, 1.47, 0),
        box(0.16, 0.06, 0.16, 0x6d747d, 0, 1.59, 0),
        box(0.22, 0.26, 0.08, BRASS, 0, 0.66, 0.29),
        box(0.22, 0.26, 0.08, BRASS, 0, 0.66, -0.29),
      ];
      put(parts, chain, (i % W) + 0.5, Math.floor(i / W) + 0.5, across);
    });
    // (2.61: a window broken to climb in by: the hole, a tooth of glass left in its frame, the rest on the ground outside.)
    for (const tile of broken) {
      const x = tile % W;
      const z = Math.floor(tile / W);
      const pane = lotPanes(district, district.lotAt[tile] - 1).find((p) => p.x === x && p.z === z);
      if (!pane) continue;
      const band = pane.look === 'band';
      const w = band ? 0.96 : 0.52;
      const y = band ? 0.62 : 0.55;
      const shards: Part[] = [
        box(w, band ? 0.32 : 0.38, 0.03, 0x07090c, 0, y, 0.535),
        box(w * 0.22, 0.12, 0.035, 0x6e8aa0, -w * 0.36, y + 0.1, 0.54),
      ];
      for (let k = 0; k < 7; k++) {
        const h = Math.imul(tile + 1, 2654435761 + k * 40503) >>> 0;
        const s = box(0.05 + (h % 7) / 70, 0.012, 0.04 + ((h >>> 4) % 5) / 60, k & 1 ? 0x9fc2d8 : 0x6e8aa0, 0, 0.006, 0);
        s.rotateY(((h >>> 8) % 628) / 100);
        s.translate((((h >>> 12) % 100) / 100 - 0.5) * 0.9, 0, 0.62 + ((h >>> 20) % 100) / 220);
        shards.push(s);
      }
      put(parts, shards, x + 0.5, z + 0.5, pane.angle);
    }
    if (!parts.length) return;
    const mesh = new THREE.Mesh(merge(parts), kitMaterial);
    mesh.castShadow = true;
    this.locks.add(mesh);
  }

  /** The dead where they stand now: a shamble's sway, a lean into the chase, thrown back by a blow. */
  drawDead(list: readonly DeadFrame[], time: number, still: boolean, night: boolean, me: { x: number; z: number }) {
    for (const g of this.marks.children) {
      const gem = g.children[0];
      gem.rotation.y = still ? 0 : time * 1.6;
      gem.position.y = 1.9 + (still ? 0 : Math.sin(time * 2.2 + g.position.x) * 0.08);
    }
    const mine = Math.floor(me.z) * W + Math.floor(me.x);
    const reach = this.torch ? TORCH_SEES : GLOW_SEES;
    // (2.52: at night, beyond the player's light and any other, a shape and its eyes; 2.53: by day too, deep in a building.)
    this.horde.draw(list, time, still, (d) => {
      const tile = Math.floor(d.z) * W + Math.floor(d.x);
      const murk = night || this.dim?.[tile] === 1;
      const dx = d.x - me.x;
      const dz = d.z - me.z;
      return { murk, shown: !murk || dx * dx + dz * dz <= reach * reach || (this.lit?.[tile] ?? 0) === 1 };
    });
    // (The player's own light: after dark, and by day in the dark of a building.)
    this.glow.visible = night || (this.dim?.[mine] === 1 && this.lit?.[mine] !== 1);
    this.glow.position.set(me.x, 0.03, me.z);
    // (The torch: a wider, warmer pool round the player.)
    this.glow.scale.setScalar(this.torch ? TORCH_SEES / 2.6 : 1);
    (this.glow.material as THREE.MeshBasicMaterial).color.set(this.torch ? 0xffe2a0 : 0x9fb8ff);
    (this.glow.material as THREE.MeshBasicMaterial).opacity = this.torch ? 0.34 : 0.16;
    this.you.visible = true;
    this.you.position.set(me.x, 0.035, me.z);
    (this.you.material as THREE.MeshBasicMaterial).opacity = night || this.dim?.[mine] === 1 ? 0.8 : 0.45;
    // (The stains: each fades out over its time, and goes.)
    for (const s of [...this.stains.children] as THREE.Mesh[]) {
      const left = 1 - (time - (s.userData.at as number)) / STAIN_SECONDS;
      if (left <= 0) {
        (s.material as THREE.Material).dispose();
        this.stains.remove(s);
      } else (s.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.min(1, left * 4);
    }
  }

  /**
   * 2.64: furniture searched and emptied: a small pale tick on its top, so nothing is looked into twice for nothing (only the
   * button said so, standing beside it). `list`: where each one's top is.
   */
  private emptied: THREE.InstancedMesh | null = null;
  setEmptied(list: ReadonlyArray<{ x: number; z: number; y: number }>) {
    if (!this.emptied) {
      const short = new THREE.BoxGeometry(0.07, 0.02, 0.16).translate(-0.05, 0, 0.04).rotateY(Math.PI / 4);
      const long = new THREE.BoxGeometry(0.07, 0.02, 0.3).translate(0.07, 0, -0.02).rotateY(-Math.PI / 5);
      this.emptied = new THREE.InstancedMesh(
        mergeGeometries([short, long]),
        new THREE.MeshBasicMaterial({ color: 0xdfe6ea, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false }),
        256,
      );
      this.emptied.renderOrder = 2;
      this.emptied.frustumCulled = false;
      this.root.add(this.emptied);
    }
    const m = new THREE.Matrix4();
    const n = Math.min(list.length, 256);
    for (let k = 0; k < n; k++) this.emptied.setMatrixAt(k, m.makeTranslation(list[k].x, list[k].y + 0.02, list[k].z));
    this.emptied.count = n;
    this.emptied.instanceMatrix.needsUpdate = true;
  }

  /** 2.64: one of the dead fell here: a dark stain on the ground (the oldest goes past the most kept). */
  stain(x: number, z: number, time: number, seed: number) {
    if (this.stains.children.length >= STAINS) {
      const old = this.stains.children[0] as THREE.Mesh;
      (old.material as THREE.Material).dispose();
      this.stains.remove(old);
    }
    const m = new THREE.Mesh(
      this.stainGeo,
      new THREE.MeshBasicMaterial({ color: 0x3a0d0b, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    m.position.set(x, 0.025, z);
    m.scale.set(1 + (seed % 5) * 0.08, 1, 0.8 + (seed % 3) * 0.1);
    m.rotation.y = (seed % 16) * 0.39;
    m.renderOrder = 0.43;
    m.userData.at = time;
    this.stains.add(m);
  }
  /**
   * 2.61: the docks' fog on the boat's night (the rules: the dead see two tiles): a low bank of it over everything, thinning to
   * nothing round the player, drifting. Render only.
   */
  private fog: THREE.Mesh | null = null;
  drawFog(on: boolean, me: { x: number; z: number }, time: number, still: boolean) {
    if (!on) {
      if (this.fog) this.fog.visible = false;
      return;
    }
    if (!this.fog) {
      this.fog = new THREE.Mesh(
        new THREE.PlaneGeometry(48, 48).rotateX(-Math.PI / 2),
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          uniforms: { me: { value: new THREE.Vector2() }, time: { value: 0 }, tint: { value: new THREE.Color(FOG_TINT) } },
          vertexShader: `varying vec2 vAt;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vAt = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
          fragmentShader: `uniform vec2 me;
uniform float time;
uniform vec3 tint;
varying vec2 vAt;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float d = distance(vAt, me);
  float drift = noise(vAt * 0.22 + vec2(time * 0.05, time * 0.02)) * 0.6 + noise(vAt * 0.6 - vec2(time * 0.08, 0.0)) * 0.4;
  float a = smoothstep(${FOG_CLEAR.toFixed(1)}, ${FOG_THICK.toFixed(1)}, d) * (0.62 + drift * 0.3);
  gl_FragColor = vec4(tint, a);
}`,
        }),
      );
      // (Over the ground and the dead; drawn before the story's marks, the bars over the struck and the eyes in the dark, so they
      // show through it: it writes no depth.)
      this.fog.renderOrder = 0.4;
      this.root.add(this.fog);
    }
    this.fog.visible = true;
    // (Over the heads of the dead, a brute's too: only the street lamps' tops stand out of it.)
    this.fog.position.set(me.x, 2.5, me.z);
    const u = (this.fog.material as THREE.ShaderMaterial).uniforms;
    (u.me.value as THREE.Vector2).set(me.x, me.z);
    if (!still) u.time.value = time;
  }

  /** 2.60: one of the dead put down (tiles): its body topples where it stood. */
  fellFx(x: number, z: number, facing: number, kind: number, seed: number, time: number, lying = false) {
    this.horde.fell(x, z, facing, kind, seed, time, lying);
  }

  /** A district's pieces put up (the last one's taken down); `landmark`: its landmark's own (landmarkPlan). */
  set(
    plan: CityPlan,
    district: District,
    own: LandmarkPlan | null = null,
    sea: ReadonlyArray<readonly [number, number, number, number]> = [],
  ) {
    this.clear();
    // (What its dead wear: the tunnel has no gate, and its own.)
    this.horde.setPlace(district.gates.length ? district.kind : null, district.index === plan.start);
    this.live.set(own);
    if (own) {
      // (A model of its own: cut away round the player like the walls it stands on, so nobody is lost behind a sign.)
      const lp: Part[] = [];
      landmarkParts(own, lp);
      const lm = new THREE.Mesh(merge(lp), this.landMat);
      lm.castShadow = true;
      lm.receiveShadow = true;
      this.group.add(lm);
    }
    const parts: Part[] = [];
    this.carSpots = [];
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      const kind = district.deco[i];
      if (!kind || kind === DECO.PART) continue;
      const x = (i % MAP_W) + 0.5;
      const z = Math.floor(i / MAP_W) + 0.5;
      const h = mix32(plan.seed ^ Math.imul(i + 1 + district.index * 4096, 0x9e3779b1));
      // (Long things lie along z as built: turned a quarter for a street running along x.)
      const along = district.turn[i] ? 0 : Math.PI / 2;
      const any = ((h >> 8) & 255) / 40;
      switch (kind) {
        // (2.66: the cars and wrecks a mesh of their own, put up again when one is stripped.)
        case DECO.CAR:
        case DECO.WRECK:
          this.carSpots.push({ i, x, z, along, h, wreck: kind === DECO.WRECK });
          break;
        case DECO.BUS:
          put(parts, bus(), x, z, along);
          break;
        case DECO.RUBBLE:
          put(parts, rubble(h), x, z);
          break;
        case DECO.SANDBAGS:
          put(parts, sandbags(), x, z, along + Math.PI / 2);
          break;
        case DECO.TREE:
          put(parts, tree(h, false), x, z, any);
          break;
        case DECO.DEAD_TREE:
          put(parts, tree(h, true), x, z, any);
          break;
        case DECO.BUSH:
          put(parts, bush(h), x, z, any);
          break;
        case DECO.CRATES:
          put(parts, crates(h), x, z, (h & 3) * (Math.PI / 2));
          break;
        case DECO.DUMPSTER:
          put(parts, dumpster(), x, z, along);
          break;
        case DECO.BARREL:
          put(parts, barrel(), x, z);
          break;
        case DECO.TYRES:
          put(parts, tyres(), x, z);
          break;
        case DECO.CONE:
          put(parts, cone(), x, z);
          break;
      }
    }
    // (C4) What time did to it: weeds through the paving and litter on the roads, one tile in nine or so; an awning over every street door.
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      if (district.deco[i]) continue;
      const ch = district.rows[Math.floor(i / MAP_W)][i % MAP_W];
      if (ch !== 'a' && ch !== ',') continue;
      const h = mix32(plan.seed ^ Math.imul(i + 77 + district.index * 8192, 0x85ebca6b));
      if ((h & 255) > (ch === 'a' ? 34 : 16)) continue;
      put(parts, ch === 'a' ? weeds(h) : litter(h), (i % MAP_W) + 0.5, Math.floor(i / MAP_W) + 0.5, ((h >> 9) & 7) * (Math.PI / 4));
    }
    const landmark = DISTRICTS[district.kind].landmark;
    district.lots.forEach((l, k) => {
      const color = AWNINGS[l.use];
      if (color === undefined) return;
      for (const door of l.doors) {
        // (Out over the street: the side of the door that isn't the building's.)
        const out = [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ].find(([dx, dz]) => {
          const t = door + dz * MAP_W + dx;
          const c = district.rows[Math.floor(t / MAP_W)]?.[t % MAP_W];
          return district.lotAt[t] !== k + 1 || c === 'a' || c === ',';
        });
        if (!out) continue;
        put(parts, awning(color, l.use === landmark), (door % MAP_W) + 0.5, Math.floor(door / MAP_W) + 0.5, Math.atan2(out[0], out[1]));
      }
    });
    // (2.56: nothing stands beyond the tunnel's rock.)
    if (district.gates.length)
      beyond(
        plan,
        district.index,
        parts,
        district.gates.map((g) => ({
          side: g.side,
          at: g.side === SIDE.N || g.side === SIDE.S ? (g.tiles[0] % W) + 1 : Math.floor(g.tiles[0] / W) + 1,
        })),
      );
    // (2.59) A checkpoint's own things at each crossing the army left (not where the player cut the fence): a sentry box and
    // a raised boom on the fence's line either side of the street, concrete blocks beyond them. All on the border's own tiles.
    for (const g of district.gates) {
      if (g.cut) continue;
      const mx = ((g.tiles[0] % W) + (g.tiles[1] % W)) / 2 + 0.5;
      const mz = (Math.floor(g.tiles[0] / W) + Math.floor(g.tiles[1] / W)) / 2 + 0.5;
      // (A block only where the fence runs on: not out on the docks' sea, not on the city's wall.)
      const along = g.side === SIDE.N || g.side === SIDE.S;
      const blocks = [-2.5, 2.5].filter((o) => {
        const x = Math.floor(along ? mx + o : mx);
        const z = Math.floor(along ? mz : mz + o);
        return district.rows[z]?.[x] === '=';
      });
      // (Turned a quarter, the model's x runs down the map: its far block is the one up it.)
      put(parts, checkpoint(along ? blocks : blocks.map((o) => -o)), mx, mz, along ? 0 : Math.PI / 2);
    }
    // Each street that crosses a border runs on past it, between the roofs.
    for (const g of district.gates) {
      const along = ((g.tiles[0] % W) + (g.tiles[1] % W)) / 2 + 0.5;
      const down = (Math.floor(g.tiles[0] / W) + Math.floor(g.tiles[1] / W)) / 2 + 0.5;
      const far = 14;
      if (g.side === SIDE.N) parts.push(box(ROAD_W, 0.012, far, ROAD, along, 0, -far / 2));
      else if (g.side === SIDE.S) parts.push(box(ROAD_W, 0.012, far, ROAD, along, 0, H + far / 2));
      else if (g.side === SIDE.W) parts.push(box(far, 0.012, ROAD_W, ROAD, -far / 2, 0, down));
      else parts.push(box(far, 0.012, ROAD_W, ROAD, W + far / 2, 0, down));
    }
    // (2.65: water under the night sky: a faint sheen, not a hole in the ground. Render only, the city's own; by day not drawn.)
    const wet: THREE.BufferGeometry[] = [];
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      if (district.rows[Math.floor(i / MAP_W)][i % MAP_W] !== '~') continue;
      wet.push(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate((i % MAP_W) + 0.5, 0.02, Math.floor(i / MAP_W) + 0.5));
    }
    // (And the docks' sea on past the map's edge, as the water is drawn: no seam where the sheen stopped.)
    for (const [x0, z0, x1, z1] of sea)
      wet.push(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, 0.02, (z0 + z1) / 2));
    if (wet.length) {
      const sheen = new THREE.Mesh(mergeGeometries(wet), this.sheenMat);
      for (const g of wet) g.dispose();
      sheen.renderOrder = 0.3;
      this.group.add(sheen);
    }
    if (!parts.length) return;
    const mesh = new THREE.Mesh(merge(parts), kitMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    const front = [...facadeParts(district), ...streetParts(district)];
    if (front.length) {
      const m = new THREE.Mesh(merge(front), this.facadeMat);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
  }

  /** 2.65: the night sky on water (`drawLights` sets how much). */
  private readonly sheenMat = new THREE.MeshBasicMaterial({
    color: 0x5f7fa6,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  clear() {
    disposeTree(this.group, () => false, new Set([kitMaterial, this.landMat, this.facadeMat, this.sheenMat]));
    this.group.clear();
    this.horde.clear();
    this.glow.visible = false;
    this.you.visible = false;
    if (this.emptied) this.emptied.count = 0;
    for (const s of this.stains.children) ((s as THREE.Mesh).material as THREE.Material).dispose();
    this.stains.clear();
    // (2.61: the docks' fog goes with the city: a boat's escape, a quit mid-fog.)
    if (this.fog) this.fog.visible = false;
    disposeTree(this.bars, () => false, new Set([kitMaterial]));
    this.bars.clear();
    disposeTree(this.cars, () => false, new Set([kitMaterial]));
    this.cars.clear();
    disposeTree(this.pieces, () => false, new Set([kitMaterial, this.pieceMat]));
    this.pieces.clear();
    this.setGhost(null);
    disposeTree(this.locks, () => false, new Set([kitMaterial]));
    this.locks.clear();
    this.marks.clear();
    disposeTree(this.folk, () => false, new Set([kitMaterial]));
    this.folk.clear();
    disposeTree(this.hearths, () => false, new Set([kitMaterial, this.hearthMat, this.hearthFlame]));
    this.hearths.clear();
    this.live.clear();
    this.setLights([], new Uint8Array(0), new Uint8Array(0));
    this.setAlarms([]);
    this.setTunnel(null);
    this.setFires([]);
    for (const m of [...this.fx.children]) {
      this.fx.remove(m);
      (m as THREE.Mesh).geometry.dispose();
    }
  }
}
