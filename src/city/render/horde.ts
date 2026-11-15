import * as THREE from 'three';
import { box, kitMaterial, merge, type Part } from '../../render/kit';
import type { DistrictKind } from '../content/districts';

/**
 * The dead in the picture (2.60, render only): each one a body of its own look with arms and legs that
 * move (a shamble, a lean into the chase, a lunge, thrown back by a blow, a crawl), its health over its
 * head once it has been struck, and a body that topples and sinks where it is put down. One instanced
 * mesh a look for the bodies, one each for every leg, arm and hand: a dozen draws whatever their number.
 * Reads what the play layer hands it (`DeadFrame`), never the simulation.
 */

/** One of the dead as the view is handed it (tiles, radians; eased by the play layer). */
export interface DeadFrame {
  x: number;
  z: number;
  facing: number;
  moving: boolean;
  /** After the player; reeling from a blow; in reach, about to bite. */
  chasing: boolean;
  reeling: boolean;
  lunging: boolean;
  /** Its own number (its clothes and its gait). */
  seed: number;
  /** What it is (ZKIND: 0 a shambler, 1 a runner, 2 a brute, 3 a crawler, 4 a screamer, 5 a bloater). */
  kind: number;
  /** Its health left (0–1). */
  hp: number;
}

/** The most of the dead drawn at once. */
export const MOST = 80;

const SKIN = 0x9aad94;
const PALE = 0xc9d2c2;
const DARK = 0x1a1414;
const BLOOD = 0x7a2a26;
const WHITE = 0xf2f2f2;

/** The looks. The first eight are worn by shamblers, runners and crawlers; the last three are a kind's own. */
const LOOK = {
  CIVIL: 0,
  OFFICE: 1,
  SCRUBS: 2,
  WORKER: 3,
  POLICE: 4,
  SOLDIER: 5,
  PRISONER: 6,
  HOODIE: 7,
  BRUTE: 8,
  SCREAMER: 9,
  BLOATER: 10,
} as const;
const LOOKS = 11;

/** Per look: its sleeves and its trousers (the limbs are white, tinted). */
const SLEEVE = [WHITE, 0xe8e6de, 0x4fb8ae, 0x8a8f96, 0x2b3a5c, 0x66734f, 0xf2701c, 0x6e2f33, 0x8a9a86, 0xcfc6d6, 0x9aa66a];
const LEGS = [0x4a4f58, 0x2e3440, 0x3f948c, 0x3d4a5c, 0x1f2a44, 0x4d5a3e, 0xd9601a, 0x3a3f4a, 0x3a3630, 0x5a5262, 0x5a5a3a];
/** Civilian clothes, each its own. */
const TINTS = [0xb9c2c9, 0xa9b89a, 0xc9b79a, 0x9aa9c2, 0xc29a9a, 0xb0a6c4, 0x8f9a8a];

/** A head: its skin, its eyes and mouth (a jaw dropped: `open`). */
function head(skin: number, open = false, y = 0.98): Part[] {
  return [
    box(0.36, 0.34, 0.34, skin, 0, y, 0.02),
    box(0.07, 0.06, 0.02, DARK, -0.09, y + 0.16, 0.2),
    box(0.07, 0.06, 0.02, DARK, 0.09, y + 0.16, 0.2),
    open ? box(0.18, 0.16, 0.03, 0x3a0f0e, 0, y + 0.0, 0.2) : box(0.16, 0.05, 0.02, 0x5a1c1a, 0, y + 0.05, 0.2),
  ];
}
const torso = (colour: number, w = 0.46, h = 0.5, d = 0.26) => box(w, h, d, colour, 0, 0.46, 0);

/** A look's body: the trunk and the head, what it wears on them. Its feet at the ground, facing +z. */
function body(look: number): Part[] {
  switch (look) {
    case LOOK.OFFICE:
      return [
        torso(0xe8e6de),
        box(0.08, 0.34, 0.02, 0x8f2f2a, 0, 0.58, 0.14),
        box(0.4, 0.1, 0.24, BLOOD, 0, 0.5, 0.02),
        ...head(SKIN),
        box(0.38, 0.08, 0.36, 0x4a3a2c, 0, 1.3, 0),
      ];
    case LOOK.SCRUBS:
      return [torso(0x4fb8ae), box(0.3, 0.16, 0.02, BLOOD, 0.04, 0.62, 0.14), ...head(SKIN), box(0.38, 0.12, 0.36, 0x4fb8ae, 0, 1.28, 0)];
    case LOOK.WORKER:
      return [
        torso(0x8a8f96),
        box(0.48, 0.34, 0.28, 0xe8862a, 0, 0.6, 0),
        box(0.49, 0.06, 0.29, 0xe6d24a, 0, 0.7, 0),
        ...head(SKIN),
        box(0.42, 0.12, 0.42, 0xe6c22a, 0, 1.28, 0.01),
        box(0.3, 0.05, 0.16, 0xe6c22a, 0, 1.28, 0.24),
      ];
    case LOOK.POLICE:
      return [
        torso(0x2b3a5c),
        box(0.07, 0.07, 0.02, 0xe0b23a, -0.12, 0.82, 0.14),
        box(0.46, 0.06, 0.27, 0x14181f, 0, 0.5, 0),
        ...head(SKIN),
        box(0.4, 0.1, 0.38, 0x1f2a44, 0, 1.3, 0),
        box(0.34, 0.04, 0.14, 0x14181f, 0, 1.3, 0.24),
      ];
    case LOOK.SOLDIER:
      return [
        torso(0x66734f),
        box(0.48, 0.08, 0.28, 0x3d4632, 0, 0.56, 0),
        box(0.1, 0.3, 0.28, 0x3d4632, -0.14, 0.64, 0),
        ...head(SKIN),
        box(0.42, 0.18, 0.42, 0x4d5a3e, 0, 1.24, 0.01),
      ];
    case LOOK.PRISONER:
      return [torso(0xf2701c), box(0.3, 0.06, 0.28, WHITE, 0, 0.9, 0), box(0.4, 0.12, 0.24, BLOOD, 0, 0.56, 0.02), ...head(SKIN)];
    case LOOK.HOODIE:
      return [
        torso(0x6e2f33),
        ...head(SKIN),
        box(0.44, 0.4, 0.3, 0x6e2f33, 0, 0.98, -0.06),
        box(0.44, 0.1, 0.4, 0x6e2f33, 0, 1.3, 0),
        box(0.26, 0.1, 0.12, 0x562428, 0, 0.5, 0.16),
      ];
    case LOOK.BRUTE:
      // (Broad, bare to the waist, a small head sunk between the shoulders.)
      return [
        box(0.66, 0.52, 0.34, 0x8a9a86, 0, 0.46, 0),
        box(0.74, 0.16, 0.36, 0x7f8f7c, 0, 0.84, 0),
        box(0.5, 0.1, 0.02, BLOOD, 0, 0.7, 0.18),
        box(0.6, 0.12, 0.34, 0x3a3630, 0, 0.44, 0),
        ...head(0x8a9a86, false, 0.94).map((p) => p.scale(0.86, 0.86, 0.86)),
      ];
    case LOOK.SCREAMER:
      // (Thin, pale, long hair down its back, its jaw dropped.)
      return [
        torso(0xcfc6d6, 0.38, 0.5, 0.22),
        box(0.34, 0.2, 0.2, 0xb9aec4, 0, 0.36, 0),
        ...head(PALE, true),
        box(0.4, 0.1, 0.38, 0x2a2228, 0, 1.3, 0),
        box(0.4, 0.62, 0.1, 0x2a2228, 0, 0.72, -0.2),
      ];
    case LOOK.BLOATER:
      // (Swollen: a belly out ahead of it, boils, its head sunk in.)
      return [
        box(0.64, 0.58, 0.52, 0x9aa66a, 0, 0.4, 0.04),
        box(0.5, 0.2, 0.4, 0x8f9a5e, 0, 0.94, 0.02),
        box(0.14, 0.12, 0.06, 0xc9c27a, -0.16, 0.6, 0.3),
        box(0.12, 0.1, 0.06, 0xc9c27a, 0.14, 0.76, 0.3),
        box(0.1, 0.1, 0.06, 0xb6a85a, 0.02, 0.5, 0.31),
        ...head(0xa8b07a, false, 1.02).map((p) => p.scale(0.8, 0.8, 0.8)),
      ];
    default:
      return [torso(WHITE), box(0.4, 0.12, 0.24, BLOOD, 0, 0.6, 0.02), ...head(SKIN), box(0.38, 0.1, 0.36, 0x3a3630, 0, 1.3, 0)];
  }
}

/** A leg from its hip down; an arm from its shoulder out ahead, and the hand at its end (each about its joint). */
const legGeo = () => merge([box(0.16, 0.46, 0.18, WHITE, 0, -0.46, 0)]);
const armGeo = () => merge([box(0.12, 0.12, 0.42, WHITE, 0, -0.06, 0.21)]);
const handGeo = () => merge([box(0.12, 0.12, 0.12, SKIN, 0, -0.06, 0.48)]);

/** What a district's dead wear, by what it is (one drawn by the dead's own number). */
const WEAR: Record<DistrictKind, readonly number[]> = {
  suburbs: [LOOK.CIVIL, LOOK.CIVIL, LOOK.HOODIE, LOOK.OFFICE, LOOK.CIVIL],
  downtown: [LOOK.OFFICE, LOOK.OFFICE, LOOK.CIVIL, LOOK.HOODIE, LOOK.POLICE],
  industrial: [LOOK.WORKER, LOOK.WORKER, LOOK.CIVIL, LOOK.HOODIE],
  hospital: [LOOK.SCRUBS, LOOK.SCRUBS, LOOK.CIVIL, LOOK.OFFICE, LOOK.SOLDIER],
  docks: [LOOK.WORKER, LOOK.CIVIL, LOOK.HOODIE, LOOK.WORKER],
  park: [LOOK.CIVIL, LOOK.HOODIE, LOOK.SOLDIER, LOOK.CIVIL],
  market: [LOOK.CIVIL, LOOK.CIVIL, LOOK.OFFICE, LOOK.HOODIE, LOOK.WORKER],
  precinct: [LOOK.POLICE, LOOK.POLICE, LOOK.CIVIL, LOOK.SOLDIER, LOOK.PRISONER],
  metro: [LOOK.CIVIL, LOOK.OFFICE, LOOK.HOODIE, LOOK.WORKER, LOOK.SOLDIER],
};
/** Under the city: the metro's own, the army's. */
const WEAR_TUNNEL = [LOOK.WORKER, LOOK.SOLDIER, LOOK.CIVIL, LOOK.WORKER];

/** The look one of the dead wears: its kind's own, or one of its district's (the bus's own orange now and then where the city starts). */
export function lookOf(kind: number, seed: number, place: DistrictKind | null, start: boolean): number {
  if (kind === 2) return LOOK.BRUTE;
  if (kind === 4) return LOOK.SCREAMER;
  if (kind === 5) return LOOK.BLOATER;
  if (start && seed % 9 === 0) return LOOK.PRISONER;
  const from = place ? WEAR[place] : WEAR_TUNNEL;
  return from[seed % from.length];
}

/** How big each kind stands (a runner slight, a brute half as big again, a bloater broad). */
const SIZE = [1.3, 1.16, 1.85, 1.24, 1.22, 1.46];
const NOWHERE = new THREE.Matrix4().makeScale(0, 0, 0);
const SHADE = 0x1c2230;
const HURT = 0xff9a8a;

interface Fallen {
  mesh: THREE.Mesh;
  born: number;
  crawler: boolean;
}

export class Horde {
  readonly group = new THREE.Group();
  /** After dark: their eyes, lit (the same places as the heads). */
  readonly eyes: THREE.InstancedMesh;
  private readonly bodies: THREE.InstancedMesh[] = [];
  private readonly legs: THREE.InstancedMesh;
  private readonly arms: THREE.InstancedMesh;
  private readonly hands: THREE.InstancedMesh;
  /** Its health over the head of one that has been struck: a dark strip, the red of what is left on it. */
  private readonly barBack: THREE.InstancedMesh;
  private readonly barFill: THREE.InstancedMesh;
  private readonly fallen: Fallen[] = [];
  private readonly figures = new Map<number, THREE.BufferGeometry>();
  private readonly base = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();
  private readonly j = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly at = new THREE.Vector3();
  private readonly size = new THREE.Vector3();
  private readonly tint = new THREE.Color();
  private readonly paint = new THREE.Color();
  private readonly counts = new Array<number>(LOOKS).fill(0);
  /** Where they are: what its dead wear. */
  private place: DistrictKind | null = null;
  private start = false;

  constructor() {
    const mesh = (g: THREE.BufferGeometry, n: number, mat: THREE.Material = kitMaterial) => {
      const im = new THREE.InstancedMesh(g, mat, n);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = mat === kitMaterial;
      // (A colour each from the first frame on.)
      im.setColorAt(0, this.tint.set(0xffffff));
      this.group.add(im);
      return im;
    };
    for (let k = 0; k < LOOKS; k++) this.bodies.push(mesh(merge(body(k)), MOST));
    this.legs = mesh(legGeo(), MOST * 2);
    this.arms = mesh(armGeo(), MOST * 2);
    this.hands = mesh(handGeo(), MOST * 2);
    // (Drawn after the gloom of a dark room, 2.53, so they shine out of it.)
    this.eyes = mesh(
      merge([box(0.08, 0.07, 0.03, 0xffffff, -0.09, 1.135, 0.215), box(0.08, 0.07, 0.03, 0xffffff, 0.09, 1.135, 0.215)], false),
      MOST,
      new THREE.MeshBasicMaterial({ color: 0xd8ff6a, toneMapped: false, transparent: true }),
    );
    this.eyes.renderOrder = 0.5;
    const strip = () => new THREE.PlaneGeometry(1, 0.09).rotateX(-Math.PI / 2);
    const flat = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false });
    this.barBack = mesh(strip(), MOST, flat(0x10131a, 0.7));
    this.barFill = mesh(strip(), MOST, flat(0xe5484d, 0.95));
    this.barBack.renderOrder = 0.6;
    this.barFill.renderOrder = 0.61;
  }

  /** The district they are in: what they wear there (`start`: where the bus lies). */
  setPlace(place: DistrictKind | null, start: boolean) {
    this.place = place;
    this.start = start;
  }

  /** A whole figure of a look, standing, its arms hanging: what topples when one is put down. */
  private figure(look: number, seed: number): THREE.BufferGeometry {
    // (A civilian's clothes are its own: one figure for each of their colours.)
    const own = look === LOOK.CIVIL ? TINTS[seed % TINTS.length] : 0xffffff;
    const key = look * 16 + (look === LOOK.CIVIL ? seed % TINTS.length : 0);
    let g = this.figures.get(key);
    if (g) return g;
    const tintOf = (p: Part, colour: number) => {
      const c = p.getAttribute('color');
      const t = new THREE.Color(colour);
      for (let k = 0; k < c.count; k++) c.setXYZ(k, c.getX(k) * t.r, c.getY(k) * t.g, c.getZ(k) * t.b);
      return p;
    };
    const limb = (x: number, y: number, hang: number, geo: THREE.BufferGeometry, colour: number) =>
      tintOf(geo.rotateX(hang).translate(x, y, 0) as Part, colour);
    const wide = look === LOOK.BRUTE ? 0.4 : look === LOOK.BLOATER ? 0.38 : 0.29;
    const sleeve = look === LOOK.CIVIL ? own : SLEEVE[look];
    g = merge(
      [
        ...body(look).map((p) => tintOf(p, own)),
        limb(-0.11, 0.46, 0, legGeo(), LEGS[look]),
        limb(0.11, 0.46, 0, legGeo(), LEGS[look]),
        limb(-wide, 0.86, 1.1, armGeo(), sleeve),
        limb(wide, 0.86, 1.1, armGeo(), sleeve),
        limb(-wide, 0.86, 1.1, handGeo(), 0xffffff),
        limb(wide, 0.86, 1.1, handGeo(), 0xffffff),
      ],
      false,
    );
    this.figures.set(key, g);
    return g;
  }

  /** One of them put down (tiles): its body topples back and sinks away. A bloater leaves nothing: it burst. */
  fell(x: number, z: number, facing: number, kind: number, seed: number, time: number) {
    if (kind === 5) return;
    const mesh = new THREE.Mesh(this.figure(lookOf(kind, seed, this.place, this.start), seed), kitMaterial);
    mesh.castShadow = true;
    mesh.position.set(x, 0, z);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = facing;
    mesh.scale.setScalar(SIZE[kind] ?? 1.3);
    this.group.add(mesh);
    this.fallen.push({ mesh, born: time, crawler: kind === 3 });
    // (Never a heap of them: the oldest goes.)
    if (this.fallen.length > 24) this.group.remove(this.fallen.shift()!.mesh);
  }

  /** The dead where they stand now, and those just put down. `shown`: whether the player makes one out (else a shape and its eyes); `murk`: in the dark. */
  draw(list: readonly DeadFrame[], time: number, still: boolean, seen: (d: DeadFrame) => { murk: boolean; shown: boolean }) {
    const n = Math.min(MOST, list.length);
    this.counts.fill(0);
    let murky = false;
    let bars = 0;
    for (let k = 0; k < n; k++) {
      const d = list[k];
      const kind = d.kind;
      const look = lookOf(kind, d.seed, this.place, this.start);
      const crawl = kind === 3;
      const beat = still ? 0 : time * (d.chasing ? (kind === 1 ? 10 : 7) : 4) + d.seed;
      const step = d.moving ? Math.sin(beat) : 0;
      // (Its lean: thrown back by a blow, into the chase, a runner low, a crawler flat on its front.)
      const lean = crawl ? 1.32 : d.reeling ? -0.5 : d.chasing ? (kind === 1 ? 0.42 : 0.2) : 0.08;
      const sway =
        (d.moving ? Math.sin(beat) * (kind === 5 ? 0.16 : kind === 2 ? 0.12 : 0.09) : Math.sin(beat * 0.4) * 0.03) * (crawl ? 0.4 : 1);
      this.e.set(lean, d.facing, sway, 'YXZ');
      this.q.setFromEuler(this.e);
      const s = SIZE[kind] ?? 1.3;
      this.at.set(d.x, crawl ? 0.2 : d.moving ? Math.abs(Math.sin(beat)) * 0.05 : 0, d.z);
      // (A runner is slight.)
      this.size.set(kind === 1 ? s * 0.88 : s, s, s);
      this.base.compose(this.at, this.q, this.size);
      this.bodies[look].setMatrixAt(this.counts[look], this.base);
      const { murk, shown } = seen(d);
      if (murk) {
        // (A brute's head and a bloater's are smaller and sit lower: their eyes with them.)
        if (kind === 2 || kind === 5) this.eyes.setMatrixAt(k, this.m.multiplyMatrices(this.base, this.j.makeScale(0.86, 0.833, 0.86)));
        else this.eyes.setMatrixAt(k, this.base);
        murky = true;
      } else this.eyes.setMatrixAt(k, NOWHERE);
      // (Its colours: a shape out of the light; its own clothes; a flush where a blow has just landed.)
      this.tint.set(!shown ? SHADE : look === LOOK.CIVIL ? TINTS[d.seed % TINTS.length] : kind === 1 ? 0xf0ece4 : 0xffffff);
      if (shown && d.reeling) this.tint.lerp(this.paint.set(HURT), 0.55);
      this.bodies[look].setColorAt(this.counts[look]++, this.tint);
      // The legs: a stride as it walks; trailing behind a crawler.
      const stride = crawl ? 0.12 : kind === 1 ? 0.9 : kind === 5 ? 0.35 : 0.55;
      for (let side = 0; side < 2; side++) {
        const sign = side ? 1 : -1;
        this.j.makeRotationX(crawl ? Math.sin(beat + side * 2) * stride : step * stride * sign);
        this.j.setPosition(0.11 * sign, 0.46, 0);
        this.m.multiplyMatrices(this.base, this.j);
        this.legs.setMatrixAt(k * 2 + side, this.m);
        this.paint.set(shown ? LEGS[look] : SHADE);
        this.legs.setColorAt(k * 2 + side, this.paint);
        // The arms (0: held out ahead; more: hanging; less: raised).
        const claw = still ? 0 : Math.sin(beat * 1.3 + side * 2.1);
        const arm = crawl
          ? -1.25 + Math.sin(beat + side * Math.PI) * (d.moving ? 0.5 : 0.1)
          : d.reeling
            ? -1.15
            : d.lunging
              ? -0.35 + claw * 0.25
              : kind === 1 && d.chasing
                ? 2.1 + claw * 0.2
                : kind === 4 && d.chasing
                  ? -0.9 + claw * 0.5
                  : kind === 5
                    ? 1.05 + claw * 0.06
                    : kind === 2
                      ? (d.chasing ? 0.35 : 0.95) + claw * 0.12
                      : d.chasing
                        ? claw * 0.18
                        : d.moving
                          ? 0.55 + claw * 0.1
                          : 1.2 + claw * 0.04;
        const wide = kind === 2 ? 0.4 : kind === 5 ? 0.38 : 0.29;
        this.j.makeRotationX(arm);
        this.j.setPosition(wide * sign, kind === 5 ? 0.9 : 0.86, 0);
        this.m.multiplyMatrices(this.base, this.j);
        this.arms.setMatrixAt(k * 2 + side, this.m);
        this.hands.setMatrixAt(k * 2 + side, this.m);
        this.paint.set(shown ? (look === LOOK.CIVIL ? TINTS[d.seed % TINTS.length] : SLEEVE[look]) : SHADE);
        if (shown && d.reeling) this.paint.lerp(this.tint.set(HURT), 0.4);
        this.arms.setColorAt(k * 2 + side, this.paint);
        this.hands.setColorAt(k * 2 + side, this.paint.set(shown ? 0xffffff : SHADE));
      }
      // Its health, once struck: over its head, the width of its shoulders.
      if (shown && d.hp < 1 && d.hp > 0) {
        const y = (crawl ? 0.75 : 1.62) * s;
        this.at.set(d.x, y, d.z);
        this.size.set(0.72, 1, 1);
        this.m.compose(this.at, this.q.identity(), this.size);
        this.barBack.setMatrixAt(bars, this.m);
        this.at.set(d.x - 0.36 * (1 - d.hp), y + 0.004, d.z);
        this.size.set(0.72 * d.hp, 1, 0.7);
        this.m.compose(this.at, this.q, this.size);
        this.barFill.setMatrixAt(bars++, this.m);
      }
    }
    this.bodies.forEach((b, look) => {
      b.count = this.counts[look];
      b.visible = b.count > 0;
      b.instanceMatrix.needsUpdate = true;
      if (b.instanceColor) b.instanceColor.needsUpdate = true;
    });
    for (const limb of [this.legs, this.arms, this.hands]) {
      limb.count = n * 2;
      limb.visible = n > 0;
      limb.instanceMatrix.needsUpdate = true;
      if (limb.instanceColor) limb.instanceColor.needsUpdate = true;
    }
    this.eyes.count = murky ? n : 0;
    this.eyes.visible = murky;
    this.eyes.instanceMatrix.needsUpdate = true;
    for (const bar of [this.barBack, this.barFill]) {
      bar.count = bars;
      bar.visible = bars > 0;
      bar.instanceMatrix.needsUpdate = true;
    }
    // Those put down: back and over in a third of a second, lying a moment, then down through the floor.
    for (let k = this.fallen.length - 1; k >= 0; k--) {
      const f = this.fallen[k];
      // (Put down in a step of this very frame: its clock may read a moment ahead of the frame's.)
      const t = Math.max(0, time - f.born);
      if (t > 2.3) {
        this.group.remove(f.mesh);
        this.fallen.splice(k, 1);
        continue;
      }
      const over = still ? 1 : Math.min(1, t / 0.34);
      f.mesh.rotation.x = f.crawler ? 1.32 + over * 0.25 : -over * over * (Math.PI / 2 - 0.06);
      f.mesh.position.y = (f.crawler ? 0.2 * (1 - over) : 0.14 * over) - Math.max(0, t - 1.6) * 1.1;
    }
  }

  /** Nobody about (a district left, the city left). */
  clear() {
    for (const b of this.bodies) b.count = 0;
    for (const m of [this.legs, this.arms, this.hands, this.eyes, this.barBack, this.barFill]) m.count = 0;
    for (const f of this.fallen) this.group.remove(f.mesh);
    this.fallen.length = 0;
  }
}
