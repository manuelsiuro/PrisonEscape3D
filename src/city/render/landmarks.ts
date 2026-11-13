import * as THREE from 'three';
import { disposeTree } from '../../render/batch';
import { heliModel } from '../../render/huntModels';
import { box, cyl, kitMaterial, merge, type Part } from '../../render/kit';
import { WALL_H } from '../../render/WorldView';
import { MAP_W as W } from '../../sim/world/grid';
import type { LotUse } from '../content/districts';
import type { LandmarkPlan } from './landmarkPlan';

/**
 * The landmarks' own models (2.50, render only): each district's landmark told from its neighbours at
 * a glance. A coping in its colour along the tops of its walls, a sign with its pictogram tipped up to
 * the camera on the north wall, and what it is on its corners (a radio mast, chimneys, a lookout…);
 * and the three ways out as things to look at: the hospital's pad and its beacon, the boat moored at
 * the pier's end, the grille over the metro's stairs. The still pieces are one merged model
 * (`landmarkParts`), cut away round the player as the walls under them are; what moves with the story is `LandmarkLive` (a few small meshes,
 * only in the district they belong to). Where each stands: landmarkPlan.ts.
 */

const WHITE = 0xf4f1ea;
const STEEL = 0x8b9098;
const DARK = 0x2a2f36;
const WOOD = 0x8d6b42;
const RED = 0xc24a3a;

/** A landmark's colour (its awnings', a shade deeper so the white pictogram reads on it). */
export const LANDMARK_PAINT: Partial<Record<LotUse, number>> = {
  station: 0xd9812c,
  tower: 0x6f86c8,
  factory: 0x9a5f34,
  hospital: 0xd94a3c,
  boathouse: 0x3f8fb8,
  rangers: 0x4f9440,
  mall: 0x2fa89c,
  police: 0x3a5ec0,
  metro: 0xd6b02a,
};

/** Each landmark's pictogram, seven by seven. */
const PICTO: Partial<Record<LotUse, readonly string[]>> = {
  // A fuel pump.
  station: ['XXXX...', 'X..X.X.', 'X..X..X', 'XXXX..X', 'XXXX..X', 'XXXX.X.', 'XXXXX..'],
  // An aerial and its waves.
  tower: ['X..X..X', '.X.X.X.', '..XXX..', '...X...', '...X...', '..XXX..', '.XXXXX.'],
  // A cog.
  factory: ['.X.X.X.', 'XXXXXXX', '.XX.XX.', 'XX...XX', '.XX.XX.', 'XXXXXXX', '.X.X.X.'],
  // A cross.
  hospital: ['..XXX..', '..XXX..', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '..XXX..', '..XXX..'],
  // An anchor.
  boathouse: ['..XXX..', '..X.X..', '..XXX..', '...X...', 'X..X..X', 'X..X..X', '.XXXXX.'],
  // A fir.
  rangers: ['...X...', '..XXX..', '.XXXXX.', '..XXX..', '.XXXXX.', 'XXXXXXX', '...X...'],
  // A shopping bag.
  mall: ['..XXX..', '.X...X.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX'],
  // A badge.
  police: ['XXXXXXX', 'XXXXXXX', 'XX.X.XX', 'XXX.XXX', '.XXXXX.', '..XXX..', '...X...'],
  // The metro's M (the same in every language).
  metro: ['X.....X', 'XX...XX', 'X.X.X.X', 'X..X..X', 'X.....X', 'X.....X', 'X.....X'],
};

const xz = (tile: number): [number, number] => [(tile % W) + 0.5, Math.floor(tile / W) + 0.5];
function place(out: Part[], parts: Part[], x: number, y: number, z: number, angle = 0) {
  for (const p of parts) {
    if (angle) p.rotateY(angle);
    p.translate(x, y, z);
    out.push(p);
  }
}

/** A board with a pictogram, standing on its foot at the origin, facing +z, tipped back so it faces up to the camera. */
function sign(use: LotUse, size: number): Part[] {
  const rows = PICTO[use];
  if (!rows) return [];
  const paint = LANDMARK_PAINT[use] ?? STEEL;
  const px = (size * 0.74) / 7;
  const parts = [box(size, size, 0.08, paint, 0, 0.12, 0), box(size + 0.1, size + 0.1, 0.05, DARK, 0, 0.07, -0.05)];
  rows.forEach((row, r) => {
    // (A row's lit squares joined into runs: fewer boxes.)
    for (let c = 0; c < 7; c++) {
      if (row[c] !== 'X') continue;
      let e = c;
      while (e + 1 < 7 && row[e + 1] === 'X') e++;
      parts.push(box(px * (e - c + 1), px, 0.04, WHITE, ((c + e) / 2 - 3) * px, 0.12 + size / 2 + (3 - r) * px - px / 2, 0.05));
      c = e;
    }
  });
  // Its two legs, then the lot tipped back about its foot.
  parts.push(box(0.08, 0.14, 0.08, DARK, -size * 0.3, 0, 0), box(0.08, 0.14, 0.08, DARK, size * 0.3, 0, 0));
  for (const p of parts) p.rotateX(-0.55);
  return parts;
}

/** A pole with a pennant in a colour. */
const flag = (color: number, tall = 2.2): Part[] => [
  cyl(0.035, tall, STEEL, 0, 0, 0, 6),
  box(0.56, 0.32, 0.03, color, 0.3, tall - 0.36, 0),
  box(0.08, 0.08, 0.08, WHITE, 0, tall, 0),
];

/** A lattice mast: four legs drawing in, cross-pieces, a lamp at its head. */
function mast(tall: number, lamp: number, dishes: boolean): Part[] {
  const parts: Part[] = [];
  const steps = Math.round(tall / 0.7);
  for (let k = 0; k < steps; k++) {
    const y = (k * tall) / steps;
    const w = 0.82 - (0.62 * k) / steps;
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      parts.push(box(0.08, tall / steps + 0.02, 0.08, k % 2 ? WHITE : RED, (sx * w) / 2, y, (sz * w) / 2));
    parts.push(box(w + 0.05, 0.04, 0.04, STEEL, 0, y, w / 2), box(w + 0.05, 0.04, 0.04, STEEL, 0, y, -w / 2));
    parts.push(box(0.04, 0.04, w + 0.05, STEEL, w / 2, y, 0), box(0.04, 0.04, w + 0.05, STEEL, -w / 2, y, 0));
  }
  parts.push(cyl(0.03, 0.5, STEEL, 0, tall, 0, 6), box(0.18, 0.18, 0.18, lamp, 0, tall + 0.5, 0));
  if (dishes) parts.push(cyl(0.3, 0.08, WHITE, 0.3, tall * 0.62, 0.2, 10), cyl(0.22, 0.08, WHITE, -0.26, tall * 0.78, 0.14, 10));
  return parts;
}

const chimney = (tall: number): Part[] => [
  cyl(0.3, tall, 0x8a4a3a, 0, 0, 0, 10),
  cyl(0.33, 0.14, DARK, 0, tall - 0.5, 0, 10),
  cyl(0.33, 0.16, WHITE, 0, tall - 0.9, 0, 10),
  cyl(0.24, 0.05, 0x151413, 0, tall, 0, 10),
];

/** The rangers' lookout: a cabin on four legs, a roof over it. */
const lookout = (): Part[] => [
  ...[-0.34, 0.34].flatMap((x) => [-0.34, 0.34].map((z) => box(0.07, 1.3, 0.07, 0x6a5236, x, 0, z))),
  box(0.9, 0.06, 0.9, WOOD, 0, 1.3, 0),
  box(0.9, 0.3, 0.05, 0x7a5c38, 0, 1.36, 0.43),
  box(0.9, 0.3, 0.05, 0x7a5c38, 0, 1.36, -0.43),
  box(0.05, 0.3, 0.9, 0x7a5c38, 0.43, 1.36, 0),
  box(0.05, 0.3, 0.9, 0x7a5c38, -0.43, 1.36, 0),
  ...[-0.4, 0.4].flatMap((x) => [-0.4, 0.4].map((z) => box(0.05, 0.6, 0.05, 0x6a5236, x, 1.66, z))),
  box(1.1, 0.07, 1.1, 0x3f6b34, 0, 2.26, 0),
  box(0.7, 0.07, 0.7, 0x4a7a3a, 0, 2.33, 0),
];

/** A price totem: stacked panels on a post. */
const totem = (paint: number): Part[] => [
  cyl(0.06, 1.5, STEEL, 0, 0, 0, 6),
  box(0.7, 0.34, 0.12, paint, 0, 1.5, 0),
  box(0.7, 0.26, 0.12, WHITE, 0, 1.86, 0),
  box(0.7, 0.26, 0.12, DARK, 0, 2.14, 0),
  box(0.76, 0.05, 0.16, paint, 0, 2.4, 0),
];

/** A rooftop unit (the mall's, the police's): a grey box with its fan. */
const unit = (): Part[] => [box(0.6, 0.3, 0.5, 0xa9adb2, 0, 0, 0), cyl(0.18, 0.04, DARK, 0, 0.3, 0, 10)];

/** A metro roundel on a post: the M's yellow disc, a dark bar across it. */
const roundel = (): Part[] => {
  const disc = cyl(0.34, 0.08, 0xd6b02a, 0, 0, 0, 14);
  disc.rotateX(Math.PI / 2);
  disc.translate(0, 1.9, 0);
  return [cyl(0.05, 1.6, DARK, 0, 0, 0, 6), disc, box(0.86, 0.16, 0.1, DARK, 0, 1.82, 0)];
};

/** A windsock on its pole, blown along +x. */
const windsock = (): Part[] => [
  cyl(0.035, 1.7, STEEL, 0, 0, 0, 6),
  box(0.22, 0.2, 0.2, 0xe0762a, 0.14, 1.5, 0),
  box(0.2, 0.17, 0.17, WHITE, 0.35, 1.5, 0),
  box(0.18, 0.14, 0.14, 0xe0762a, 0.54, 1.5, 0),
];

/** The helipad's paint, flat on the floor: a yellow ring, a white H. */
function pad(wide: boolean): Part[] {
  const r = wide ? 1.42 : 0.47;
  const h = r * 0.42;
  return [
    ringOfBoxes(r, 0xe8c230),
    box(r * 0.16, 0.012, h * 2, WHITE, -h * 0.62, 0.006, 0),
    box(r * 0.16, 0.012, h * 2, WHITE, h * 0.62, 0.006, 0),
    box(h * 1.24, 0.012, r * 0.16, WHITE, 0, 0.006, 0),
  ].flat();
}
/** A flat ring from short boxes (the kit's parts merge only with their like). */
function ringOfBoxes(r: number, color: number): Part[] {
  const n = 28;
  const len = ((2 * Math.PI * r) / n) * 1.08;
  return Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2;
    const p = box(len, 0.012, r * 0.13, color, 0, 0.006, 0);
    p.rotateY(-a + Math.PI / 2);
    p.translate(Math.cos(a) * r * 0.93, 0, Math.sin(a) * r * 0.93);
    return p;
  });
}

/** The stairs down under the metro's grille: a dark well, its steps going down to the north, a yellow edge. */
const stairs = (): Part[] => [
  box(0.9, 0.008, 0.9, 0x101216, 0, 0.004, 0),
  ...[0, 1, 2, 3].map((k) => box(0.8, 0.008, 0.14, [0x4a4e55, 0x3c4046, 0x2e3237, 0x22252a][k], 0, 0.01, 0.32 - k * 0.2)),
  box(0.96, 0.014, 0.05, 0xd6b02a, 0, 0.004, 0.47),
  ...[-0.46, 0.46].flatMap((x) => [-0.46, 0.46].map((z) => cyl(0.035, 0.7, 0xd6b02a, x, 0, z, 6))),
];

/** A landmark's still pieces, for the district's merged model. */
export function landmarkParts(lm: LandmarkPlan, out: Part[]) {
  const paint = LANDMARK_PAINT[lm.use] ?? STEEL;
  const { lot } = lm;
  for (const i of lm.coping) {
    const [x, z] = xz(i);
    out.push(box(1.02, 0.07, 1.02, paint, x, WALL_H, z));
  }
  const [nw, ne, sw] = lm.corners.map(xz);
  const top = WALL_H + 0.07;
  place(out, sign(lm.use, lm.use === 'mall' ? 2.3 : 1.7), lm.signX, top, lot.z0 + 0.5);
  switch (lm.use) {
    case 'station':
      place(out, totem(paint), ne[0], top, ne[1]);
      place(out, flag(paint), nw[0], top, nw[1]);
      break;
    case 'tower':
      place(out, mast(6.4, 0xe03a2a, true), nw[0], top, nw[1]);
      place(out, mast(3.2, 0xe03a2a, false), ne[0], top, ne[1]);
      break;
    case 'factory':
      place(out, chimney(3.3), nw[0], top, nw[1]);
      place(out, chimney(2.6), ne[0], top, ne[1]);
      place(out, [cyl(0.42, 0.7, 0x7c8794, 0, 0, 0, 12), cyl(0.44, 0.05, DARK, 0, 0.7, 0, 12)], sw[0], top, sw[1]);
      break;
    case 'hospital':
      place(out, windsock(), nw[0], top, nw[1]);
      // (The beacon's mast: its lamp is LandmarkLive's, lit when the beacon is.)
      place(out, [cyl(0.05, 1.5, STEEL, 0, 0, 0, 6), box(0.3, 0.05, 0.3, DARK, 0, 1.5, 0)], ne[0], top, ne[1]);
      break;
    case 'boathouse':
      place(out, flag(WHITE), nw[0], top, nw[1]);
      place(out, flag(paint, 1.8), ne[0], top, ne[1]);
      break;
    case 'rangers':
      place(out, lookout(), nw[0], top, nw[1]);
      place(out, flag(paint), ne[0], top, ne[1]);
      break;
    case 'mall':
      place(out, flag(0xe8c230), nw[0], top, nw[1]);
      place(out, flag(RED), ne[0], top, ne[1]);
      // (Rooftop units on the north wall, two a side, a tile apart, clear of the sign and of every door.)
      for (const side of lm.roof)
        for (const x of side.filter((_, k) => k % 2 === 0).slice(0, 2)) place(out, unit(), x + 0.5, top, lot.z0 + 0.5);
      break;
    case 'police':
      place(out, flag(paint), nw[0], top, nw[1]);
      place(out, mast(3.4, 0x4a8cff, false), ne[0], top, ne[1]);
      // (A light bar on the wall to either side of the sign.)
      lm.roof.forEach((side, k) => {
        if (!side.length) return;
        const [l, r] = k ? [RED, 0x4a8cff] : [0x4a8cff, RED];
        place(
          out,
          [box(0.5, 0.12, 0.2, DARK, 0, 0, 0), box(0.2, 0.1, 0.16, l, -0.13, 0.12, 0), box(0.2, 0.1, 0.16, r, 0.13, 0.12, 0)],
          side[0] + 0.5,
          top,
          lot.z0 + 0.5,
        );
      });
      break;
    case 'metro':
      place(out, roundel(), nw[0], top, nw[1]);
      place(out, roundel(), ne[0], top, ne[1]);
      break;
  }
  if (lm.pad) place(out, pad(lm.pad.wide), xz(lm.pad.tile)[0], 0.012, xz(lm.pad.tile)[1]);
  if (lm.grille) place(out, stairs(), xz(lm.grille.tile)[0], 0.012, xz(lm.grille.tile)[1]);
}

/** What the story has done to the landmark, as the play layer hands it over each frame. */
export interface LandmarkFrame {
  /** Seconds, and nothing moving (paused, or reduced motion). */
  time: number;
  still: boolean;
  /** The beacon is lit. */
  beacon: boolean;
  /** The helicopter coming in over the pad: 0 not yet, up to 1 over it. */
  heli: number;
  /** The boat has its engine and its fuel. */
  boat: boolean;
  /** The metro's grille is wound open. */
  open: boolean;
}

/** The landmark's pieces that change with the story: the beacon's lamp, the helicopter, the boat, the grille. */
export class LandmarkLive {
  readonly group = new THREE.Group();
  private lamp: THREE.Mesh | null = null;
  private heli: { all: THREE.Group; rotor: THREE.Group; tail: THREE.Group } | null = null;
  private boat: { all: THREE.Group; kit: THREE.Mesh } | null = null;
  private grille: { mesh: THREE.Mesh; x: number; z: number; dx: number; dz: number; at: number } | null = null;
  private readonly lampMat = new THREE.MeshBasicMaterial({ color: 0x4a2a22, toneMapped: false });
  private padAt: [number, number] | null = null;

  set(lm: LandmarkPlan | null) {
    this.clear();
    if (!lm) return;
    if (lm.use === 'hospital') {
      const [x, z] = xz(lm.corners[1]);
      this.lamp = new THREE.Mesh(merge([cyl(0.13, 0.2, 0xffffff, 0, 0, 0, 10)], false), this.lampMat);
      this.lamp.position.set(x, WALL_H + 0.07 + 1.55, z);
      this.group.add(this.lamp);
    }
    if (lm.pad) this.padAt = xz(lm.pad.tile);
    if (lm.boat) {
      const [x, z] = xz(lm.boat.tile);
      const all = new THREE.Group();
      const hull = new THREE.Mesh(merge(boatHull()), kitMaterial);
      hull.castShadow = true;
      const kit = new THREE.Mesh(merge(boatKit()), kitMaterial);
      kit.visible = false;
      all.add(hull, kit);
      all.position.set(x, -0.02, z);
      all.rotation.y = Math.atan2(lm.boat.dx, lm.boat.dz);
      all.scale.setScalar(1.2);
      this.boat = { all, kit };
      this.group.add(all);
    }
    if (lm.grille) {
      const [x, z] = xz(lm.grille.tile);
      const mesh = new THREE.Mesh(merge(grilleBars()), kitMaterial);
      mesh.position.set(x, 0.03, z);
      this.grille = { mesh, x, z, dx: lm.grille.dx, dz: lm.grille.dz, at: -1 };
      this.group.add(mesh);
    }
  }

  /** When it was last drawn (seconds): what moves by time moves the same at any frame rate. */
  private last = 0;

  draw(f: LandmarkFrame) {
    if (this.lamp) {
      const on = f.beacon && (f.still || Math.sin(f.time * 5) > -0.2);
      this.lampMat.color.set(on ? 0xff5a3a : 0x4a2a22);
      this.lamp.scale.setScalar(on ? 1.5 : 1);
    }
    if (this.padAt && f.heli > 0) {
      if (!this.heli) {
        const m = heliModel(0xd9dde0);
        m.body.castShadow = true;
        const all = new THREE.Group();
        all.add(m.body, m.rotor, m.tail);
        this.heli = { all, rotor: m.rotor, tail: m.tail };
        this.group.add(all);
      }
      // In from the north-east, high, down to a hover over the pad (eased).
      const t = 1 - (1 - f.heli) * (1 - f.heli);
      const far = 1 - t;
      this.heli.all.position.set(
        this.padAt[0] + far * 16,
        3.2 + far * 7 + (f.still ? 0 : Math.sin(f.time * 1.7) * 0.08),
        this.padAt[1] - far * 12,
      );
      this.heli.all.rotation.y = -2.2 + t * 1.4;
      if (!f.still) {
        this.heli.rotor.rotation.y = f.time * 22;
        this.heli.tail.rotation.x = f.time * 30;
      }
    } else if (this.heli) {
      disposeTree(this.heli.all, () => false, new Set([kitMaterial]));
      this.group.remove(this.heli.all);
      this.heli = null;
    }
    if (this.boat) {
      this.boat.kit.visible = f.boat;
      this.boat.all.position.y = -0.02 + (f.still ? 0 : Math.sin(f.time * 1.3) * 0.025);
      this.boat.all.rotation.z = f.still ? 0 : Math.sin(f.time * 0.9) * 0.035;
    }
    if (this.grille) {
      // Wound aside over a second and a half (at once when nothing moves, or when come upon already open).
      const g = this.grille;
      const goal = f.open ? 1 : 0;
      const dt = Math.max(0, Math.min(0.1, f.time - this.last));
      if (g.at < 0 || f.still) g.at = goal;
      else g.at += Math.max(-dt / 1.5, Math.min(dt / 1.5, goal - g.at));
      g.mesh.position.set(g.x + g.dx * g.at * 0.96, 0.03, g.z + g.dz * g.at * 0.96);
      g.mesh.visible = !!(g.dx || g.dz) || g.at < 1;
    }
    this.last = f.time;
  }

  clear() {
    disposeTree(this.group, () => false, new Set([kitMaterial, this.lampMat]));
    this.group.clear();
    this.lamp = null;
    this.heli = null;
    this.boat = null;
    this.grille = null;
    this.padAt = null;
  }
}

/** An open boat, its bow along +z: a white hull with a blue line, two thwarts. */
function boatHull(): Part[] {
  const HULL = 0xe9ebec;
  const bow = box(0.5, 0.3, 0.5, HULL, 0, 0, 0);
  bow.rotateY(Math.PI / 4);
  bow.scale(0.9, 1, 1);
  bow.translate(0, 0, 0.84);
  return [
    box(0.74, 0.1, 1.7, 0x6f7a80, 0, 0, 0),
    box(0.06, 0.3, 1.7, HULL, -0.37, 0, 0),
    box(0.06, 0.3, 1.7, HULL, 0.37, 0, 0),
    box(0.8, 0.3, 0.06, HULL, 0, 0, -0.85),
    bow,
    box(0.07, 0.06, 1.72, 0x3f8fb8, -0.375, 0.3, 0),
    box(0.07, 0.06, 1.72, 0x3f8fb8, 0.375, 0.3, 0),
    box(0.82, 0.06, 0.07, 0x3f8fb8, 0, 0.3, -0.855),
    box(0.62, 0.03, 1.6, 0x4a4035, 0, 0.1, 0),
    box(0.68, 0.05, 0.2, WOOD, 0, 0.2, 0.3),
    box(0.68, 0.05, 0.2, WOOD, 0, 0.2, -0.4),
  ];
}
/** What the story puts aboard: the outboard on the stern, the fuel drum amidships. */
const boatKit = (): Part[] => [
  box(0.24, 0.3, 0.2, DARK, 0, 0.3, -0.96),
  box(0.2, 0.06, 0.16, RED, 0, 0.6, -0.96),
  box(0.06, 0.4, 0.06, STEEL, 0, -0.1, -1.02),
  box(0.04, 0.04, 0.4, STEEL, 0, 0.5, -0.74),
  cyl(0.17, 0.34, 0x3f6fc0, 0, 0.1, -0.05, 10),
  cyl(0.175, 0.03, DARK, 0, 0.3, -0.05, 10),
];
/** The grille: bars across a frame, lying over the stairwell. */
const grilleBars = (): Part[] => [
  box(0.96, 0.03, 0.05, STEEL, 0, 0, 0.455),
  box(0.96, 0.03, 0.05, STEEL, 0, 0, -0.455),
  ...Array.from({ length: 7 }, (_, k) => box(0.035, 0.03, 0.9, k % 2 ? 0x6f747b : STEEL, -0.42 + k * 0.14, 0, 0)),
];
