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
import { LandmarkLive, landmarkParts, type LandmarkFrame } from './landmarks';
import type { LandmarkPlan } from './landmarkPlan';

/**
 * A district's own pieces in the picture (C1, render only): what the World's floors, walls and
 * furniture don't draw. The cars left on the streets and the burnt ones, rubble, sandbags, trees
 * alive and dead, bushes, crates, dumpsters, barrels, tyres, cones, the prison bus on its side; and
 * past a sector's fence, the next district's rooftops, so the city goes on. One merged model a
 * district: a single draw. Built when a district is entered; reads its plan, never the simulation.
 */

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

/** A car two tiles long, nose along +z from the middle of its first tile; `burnt`: a shell, its roof down. */
function car(paint: number, burnt: boolean, flat: number): Part[] {
  const body = burnt ? BURNT : paint;
  const w = 0.86;
  const wheels = [0.05, 0.95].flatMap((z, k) =>
    [-1, 1].map((s, j) => rod(k * 2 + j === flat ? 0.1 : 0.15, 0.14, TYRE, s * (w / 2 - 0.04), k * 2 + j === flat ? 0.1 : 0.15, z, 8)),
  );
  return [
    box(w, 0.26, 1.8, body, 0, 0.14, 0.5),
    box(w - 0.1, burnt ? 0.16 : 0.26, 0.9, burnt ? 0x1c1a19 : paint, 0, 0.4, 0.4),
    ...(burnt
      ? [box(w - 0.3, 0.05, 0.5, 0x3a322c, 0.05, 0.4, 1.1)]
      : [
          box(w - 0.14, 0.18, 0.04, GLASS, 0, 0.43, 0.86),
          box(w - 0.14, 0.18, 0.04, GLASS, 0, 0.43, -0.06),
          box(w - 0.08, 0.16, 0.7, GLASS, 0, 0.44, 0.4),
          box(w - 0.12, 0.03, 0.86, paint, 0, 0.64, 0.4),
        ]),
    box(w + 0.02, 0.06, 0.06, burnt ? 0x151413 : 0x8b9098, 0, 0.16, 1.41),
    box(w + 0.02, 0.06, 0.06, burnt ? 0x151413 : 0x8b9098, 0, 0.16, -0.41),
    ...wheels,
  ];
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
  const TONES = [0x55585e, 0x64605a, 0x4a4e55, 0x6e665e, 0x5a5348];
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
      if ((r >> 13) & 3 && !onStreet) out.push(box(bw - 0.4, tall, bd - 0.4, TONES[(r >> 16) % TONES.length], x, 0, z));
      k += w + ((r >> 20) & 1);
    }
  }
}

/** One of the dead as the view is handed it (tiles, radians; eased by the play layer). */
export interface DeadFrame {
  x: number;
  z: number;
  facing: number;
  moving: boolean;
  /** After the player; reeling from a blow. */
  chasing: boolean;
  reeling: boolean;
  /** Its own number (its clothes and its gait). */
  seed: number;
  /** What it is (ZKIND: 0 a shambler, 1 a runner, 2 a brute). */
  kind: number;
}

/** The most of the dead drawn at once. */
const MOST = 80;
/** Grey skin, eyes like coals, arms held out: one body for all of them, their clothes tinted each its own. */
function deadBody(): THREE.BufferGeometry {
  const SKIN = 0x9aad94;
  const CLOTH = 0xf2f2f2;
  const parts = [
    box(0.16, 0.46, 0.18, 0x4a4f58, -0.11, 0, 0),
    box(0.16, 0.46, 0.18, 0x4a4f58, 0.11, 0, 0),
    box(0.46, 0.5, 0.26, CLOTH, 0, 0.46, 0),
    box(0.4, 0.12, 0.24, 0x7a2a26, 0, 0.6, 0.02),
    box(0.36, 0.34, 0.34, SKIN, 0, 0.98, 0.02),
    box(0.38, 0.1, 0.36, 0x3a3630, 0, 1.3, 0),
    box(0.07, 0.06, 0.02, 0x1a1414, -0.09, 1.14, 0.2),
    box(0.07, 0.06, 0.02, 0x1a1414, 0.09, 1.14, 0.2),
    box(0.16, 0.05, 0.02, 0x5a1c1a, 0, 1.03, 0.2),
    // The arms, held out ahead.
    box(0.12, 0.12, 0.5, CLOTH, -0.29, 0.78, 0.2),
    box(0.12, 0.12, 0.5, CLOTH, 0.29, 0.74, 0.2),
    box(0.12, 0.12, 0.12, SKIN, -0.29, 0.78, 0.5),
    box(0.12, 0.12, 0.12, SKIN, 0.29, 0.74, 0.5),
  ];
  return merge(parts);
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

/** An awning over a street door, in the colour of what the building is (C4): the city read from above. A landmark's is wider, with a white band. */
function awning(color: number, big: boolean): Part[] {
  const w = big ? 1.5 : 0.96;
  const out = [box(w, 0.06, 0.62, color, 0, WALL_H - 0.34, 0.2), box(w, 0.2, 0.05, color, 0, WALL_H - 0.5, 0.5)];
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
const SHADE = 0x1c2230;
/** How dark a building's depths are drawn by day (2.53). */
const GLOOM = 0.5;
const NOWHERE = new THREE.Matrix4().makeScale(0, 0, 0);
const DARK_IRON = 0x2a2f36;
/** A flame: a narrow cone on its foot; a work lamp: a small bright box. */
const FLAME_GEO = new THREE.ConeGeometry(0.2, 0.55, 6).translate(0, 0.27, 0);
const HOT_GEO = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
const LAMP_GEO = new THREE.BoxGeometry(0.18, 0.1, 0.18).translate(0, 0.06, 0);
const TINTS = [0xb9c2c9, 0xa9b89a, 0xc9b79a, 0x9aa9c2, 0xc29a9a, 0xb0a6c4, 0x8f9a8a];

export class CityView {
  readonly group = new THREE.Group();
  /** The dead: one instanced body, kept across districts. */
  private readonly dead: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly at = new THREE.Vector3();
  private readonly size = new THREE.Vector3(1.3, 1.3, 1.3);
  private readonly tint = new THREE.Color();
  readonly root = new THREE.Group();
  /** After dark: their eyes, lit (the same places as the bodies), and a faint pool of light round the player. */
  private readonly eyes: THREE.InstancedMesh;
  private readonly glow: THREE.Mesh;

  constructor() {
    this.dead = new THREE.InstancedMesh(deadBody(), kitMaterial, MOST);
    this.dead.castShadow = true;
    this.dead.count = 0;
    this.dead.frustumCulled = false;
    // (Drawn after the gloom of a dark room, 2.53, so they shine out of it.)
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xd8ff6a, toneMapped: false, transparent: true });
    this.eyes = new THREE.InstancedMesh(
      merge([box(0.08, 0.07, 0.03, 0xffffff, -0.09, 1.135, 0.215), box(0.08, 0.07, 0.03, 0xffffff, 0.09, 1.135, 0.215)], false),
      eyeMat,
      MOST,
    );
    this.eyes.count = 0;
    this.eyes.frustumCulled = false;
    this.eyes.renderOrder = 0.5;
    this.glow = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.09, depthWrite: false, toneMapped: false }),
    );
    this.glow.renderOrder = 0.44;
    this.glow.visible = false;
    this.root.add(this.group, this.dead, this.eyes, this.glow, this.bars, this.marks, this.folk, this.live.group, this.lights);
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
    opacity: 0.12,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly hotMat = new THREE.MeshBasicMaterial({
    color: 0xffd890,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly flameMat = new THREE.MeshBasicMaterial({ color: 0xffa23a, toneMapped: false });
  private readonly coreMat = new THREE.MeshBasicMaterial({ color: 0xfff0a8, toneMapped: false });
  /** 2.53: the gloom of a building's depths by day, over everything that stands in it (the tiles daylight and no light reach). */
  private readonly gloomMat = new THREE.MeshBasicMaterial({
    color: 0x05070c,
    transparent: true,
    opacity: GLOOM,
    depthWrite: false,
    depthTest: false,
  });
  private gloom: THREE.Mesh | null = null;
  private lit: Uint8Array | null = null;
  private dim: Uint8Array | null = null;
  private torch = false;
  /** `dim`: the tiles daylight doesn't reach (City.dim). */
  setLights(list: ReadonlyArray<readonly [number, number, number]>, lit: Uint8Array, dim: Uint8Array) {
    const keep = new Set<THREE.Material>([kitMaterial, this.poolMat, this.hotMat, this.flameMat, this.coreMat, this.gloomMat]);
    disposeTree(this.lights, () => false, keep);
    this.lights.clear();
    this.flames.length = 0;
    this.lit = list.length ? lit : null;
    this.dim = dim;
    this.gloom = null;
    const dark: THREE.BufferGeometry[] = [];
    for (let i = 0; i < W * H; i++) {
      if (!dim[i] || (list.length && lit[i])) continue;
      const q = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      q.translate((i % W) + 0.5, 0.032, Math.floor(i / W) + 0.5);
      dark.push(q);
    }
    if (dark.length) {
      this.gloom = new THREE.Mesh(mergeGeometries(dark), this.gloomMat);
      for (const q of dark) q.dispose();
      this.gloom.renderOrder = 0.42;
      this.lights.add(this.gloom);
    }
    if (!list.length) return;
    // The pool: a quad a lit tile, in one piece.
    const quads: THREE.BufferGeometry[] = [];
    for (let i = 0; i < W * H; i++) {
      if (!lit[i]) continue;
      const q = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      q.translate((i % W) + 0.5, 0.034, Math.floor(i / W) + 0.5);
      quads.push(q);
    }
    if (quads.length) {
      const pool = new THREE.Mesh(mergeGeometries(quads), this.poolMat);
      for (const q of quads) q.dispose();
      pool.renderOrder = 0.45;
      this.lights.add(pool);
    }
    const things: Part[] = [];
    for (const [tile, kind] of list) {
      const x = (tile % W) + 0.5;
      const z = Math.floor(tile / W) + 0.5;
      // (A fire: over the barrel's rim; a lantern: on the floor; a generator: a work lamp on a stand beside its top.)
      const y = kind === 0 ? 0.62 : kind === 1 ? 0.2 : 0.95;
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
      // (The hot middle of its light, on the floor round it.)
      if (kind !== 2) {
        const hot = new THREE.Mesh(HOT_GEO, this.hotMat);
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
  /** The fires flicker, the pool is stronger after dark; `torch`: the player's own light is the torch's (wider, warm). */
  drawLights(time: number, still: boolean, night: boolean, torch: boolean) {
    this.torch = torch;
    // (After dark the whole district is as dark: nothing more to lay over its rooms.)
    if (this.gloom) this.gloom.visible = !night;
    this.poolMat.opacity = night ? 0.3 : 0.06;
    this.hotMat.opacity = night ? 0.3 : 0.08;
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
  drawLandmark(f: LandmarkFrame) {
    this.live.draw(f);
  }

  /** The survivors in this district: the dead's own body, standing straight in the colours of the living. */
  private readonly folk = new THREE.Group();
  setPeople(list: ReadonlyArray<{ who: number; tile: number }>, facing: (tile: number) => number) {
    disposeTree(this.folk, () => false, new Set([kitMaterial]));
    this.folk.clear();
    for (const p of list) {
      const mesh = new THREE.Mesh(merge(folk(p.who)), kitMaterial);
      mesh.castShadow = true;
      mesh.scale.setScalar(1.3);
      mesh.position.set((p.tile % W) + 0.5, 0, Math.floor(p.tile / W) + 0.5);
      mesh.rotation.y = facing(p.tile);
      this.folk.add(mesh);
    }
  }

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

  /** The dead where they stand now: a shamble's sway, a lean into the chase, thrown back by a blow. */
  drawDead(list: readonly DeadFrame[], time: number, still: boolean, night: boolean, me: { x: number; z: number }) {
    for (const g of this.marks.children) {
      const gem = g.children[0];
      gem.rotation.y = still ? 0 : time * 1.6;
      gem.position.y = 1.9 + (still ? 0 : Math.sin(time * 2.2 + g.position.x) * 0.08);
    }
    const n = Math.min(MOST, list.length);
    // (By day, eyes only where it's dark: a building's depths.)
    let murky = night;
    const mine = Math.floor(me.z) * W + Math.floor(me.x);
    for (let k = 0; k < n; k++) {
      const d = list[k];
      const beat = still ? 0 : time * (d.chasing ? 7 : 4) + d.seed;
      const sway = d.moving ? Math.sin(beat) * 0.09 : Math.sin(beat * 0.4) * 0.03;
      this.e.set(d.reeling ? -0.45 : d.chasing ? 0.2 : 0.08, d.facing, sway, 'YXZ');
      this.q.setFromEuler(this.e);
      this.at.set(d.x, d.moving ? Math.abs(Math.sin(beat)) * 0.05 : 0, d.z);
      // (A runner is slight and pale, a brute half as big again and dark.)
      this.size.setScalar(d.kind === 2 ? 1.85 : d.kind === 1 ? 1.16 : 1.3);
      this.m.compose(this.at, this.q, this.size);
      this.dead.setMatrixAt(k, this.m);
      // (2.52: at night, beyond the player's light and any other, a shape and its eyes; 2.53: by day too, deep in a building.)
      const tile = Math.floor(d.z) * W + Math.floor(d.x);
      const murk = night || this.dim?.[tile] === 1;
      if (murk) {
        this.eyes.setMatrixAt(k, this.m);
        murky = true;
      } else this.eyes.setMatrixAt(k, NOWHERE);
      const dx = d.x - me.x;
      const dz = d.z - me.z;
      const reach = this.torch ? TORCH_SEES : GLOW_SEES;
      const shown = !murk || dx * dx + dz * dz <= reach * reach || (this.lit?.[tile] ?? 0) === 1;
      this.dead.setColorAt(
        k,
        this.tint.set(!shown ? SHADE : d.kind === 2 ? 0x5a4a52 : d.kind === 1 ? 0xe6d8c8 : TINTS[d.seed % TINTS.length]),
      );
    }
    this.dead.count = n;
    this.eyes.count = murky ? n : 0;
    this.eyes.instanceMatrix.needsUpdate = true;
    // (The player's own light: after dark, and by day in the dark of a building.)
    this.glow.visible = night || (this.dim?.[mine] === 1 && this.lit?.[mine] !== 1);
    this.glow.position.set(me.x, 0.03, me.z);
    // (The torch: a wider, warmer pool round the player.)
    this.glow.scale.setScalar(this.torch ? TORCH_SEES / 2.6 : 1);
    (this.glow.material as THREE.MeshBasicMaterial).color.set(this.torch ? 0xffe2a0 : 0x9fb8ff);
    (this.glow.material as THREE.MeshBasicMaterial).opacity = this.torch ? 0.2 : 0.09;
    this.dead.instanceMatrix.needsUpdate = true;
    if (this.dead.instanceColor) this.dead.instanceColor.needsUpdate = true;
  }

  /** A district's pieces put up (the last one's taken down); `landmark`: its landmark's own (landmarkPlan). */
  set(plan: CityPlan, district: District, own: LandmarkPlan | null = null) {
    this.clear();
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
        case DECO.CAR:
          put(parts, car(PAINTS[h % PAINTS.length], false, (h >> 4) & 7), x, z, along);
          break;
        case DECO.WRECK:
          put(parts, car(0, true, (h >> 4) & 3), x, z, along);
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
    beyond(
      plan,
      district.index,
      parts,
      district.gates.map((g) => ({
        side: g.side,
        at: g.side === SIDE.N || g.side === SIDE.S ? (g.tiles[0] % W) + 1 : Math.floor(g.tiles[0] / W) + 1,
      })),
    );
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
    if (!parts.length) return;
    const mesh = new THREE.Mesh(merge(parts), kitMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  clear() {
    disposeTree(this.group, () => false, new Set([kitMaterial, this.landMat]));
    this.group.clear();
    this.dead.count = 0;
    this.eyes.count = 0;
    this.glow.visible = false;
    disposeTree(this.bars, () => false, new Set([kitMaterial]));
    this.bars.clear();
    this.marks.clear();
    disposeTree(this.folk, () => false, new Set([kitMaterial]));
    this.folk.clear();
    this.live.clear();
    this.setLights([], new Uint8Array(0), new Uint8Array(0));
  }
}
