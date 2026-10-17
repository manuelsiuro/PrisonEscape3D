import * as THREE from 'three';
import type { DogCoat } from '../content/prisons/types';
import { DIR_X, DIR_Z } from '../sim/command';
import { MAP_W } from '../sim/world/World';
import { box, cyl, kitMaterial, merge, paint } from './kit';

/** What the view needs of a dog (P19), interpolated like everyone else. */
export interface DogFrame {
  x: number;
  z: number;
  /** Radians, 0 = facing +z. */
  facing: number;
  moving: boolean;
  /** How fast it goes (1: at its handler's walking pace). */
  pace: number;
  /** Lying by its kennel, at the heel, pointing and barking, nose down on the trail, sneezing (pepper), asleep (sleepy jerky). */
  pose: 'kennel' | 'heel' | 'point' | 'track' | 'dazed' | 'asleep';
  /** It likes the player (trust TRUST_IGNORE and up): its tail wags when they're close. */
  friend: boolean;
}

/** The kennels: where each stands (tile) and which way its door faces (1–16). */
export interface KennelSpot {
  x: number;
  z: number;
  face: number;
  coat: DogCoat;
}

/** A coat: its main colour, the saddle's (null: none), the head's, its build (x, y, z). */
const COATS: Record<DogCoat, { main: number; saddle: number | null; head: number; build: [number, number, number] }> = {
  shepherd: { main: 0xc8894a, saddle: 0x231d19, head: 0xc28447, build: [1.3, 1.32, 1.32] },
  mastiff: { main: 0x8c6239, saddle: 0x5e3d24, head: 0x7a5432, build: [1.6, 1.35, 1.35] },
  retriever: { main: 0xc9743b, saddle: null, head: 0xc9743b, build: [1.35, 1.25, 1.25] },
  collie: { main: 0xefebe3, saddle: 0x1f1c20, head: 0x24212a, build: [1.2, 1.2, 1.2] },
};

/** Paint values: the coat's own (1), a little darker underneath, the muzzle, the ears, the nose and eyes, the paws. */
const COAT = 0xffffff;
const UNDER = 0xd9d9d9;
const MUZZLE = 0xa8a8a8;
const EARS = 0x707070;
const NOSE = 0x141414;
const PAW = 0x8a8a8a;

const LEG_H = 0.24;
const HIP_Y = 0.25;
/** Shoe prints on the trail, paw prints behind a dog on it. */
const PRINTS = 32;
const PAWS = 48;
const PAW_EVERY = 0.42;
const PAW_LIFE = 6;
/** Prints lie just over the floor's decals (rugs reach 0.016). */
const PRINT_Y = 0.021;
/** How far in front of its kennel's door a dog lies, and the most dogs a prison has pieces for. */
const LIE_OUT = 0.42;
const MAX_DOGS = 4;
const SCENT_AMBER = new THREE.Color(0xf0a030);
const PAW_ORANGE = new THREE.Color(0xff7a3a);

/** A dog's pieces, posed each frame (never in the scene: their matrices go to the instanced meshes). */
interface Rig {
  root: THREE.Object3D;
  body: THREE.Object3D;
  head: THREE.Object3D;
  tail: THREE.Object3D;
  legs: THREE.Object3D[];
  /** The body, head and tail as drawn: their breed's width on their own x (a uniform scale on the root, so nothing shears as a head turns). */
  bodyShape: THREE.Object3D;
  headShape: THREE.Object3D;
  tailShape: THREE.Object3D;
  yaw: number;
  gait: number;
  sit: number;
  lie: number;
  still: number;
  bark: number;
  wag: number;
  sneeze: number;
  /** Where its last paw print went down. */
  px: number;
  pz: number;
}

/**
 * The guard dogs (P19): a low-poly dog for each, built from five instanced pieces (body, saddle,
 * head, legs, tail) in its coat's colours; trotting at the heel, sitting while its handler stands,
 * nose down on the trail, pointing and barking (sound rings over it), sneezing at pepper, lying by
 * its kennel or asleep. The kennels themselves, and the player's trail as faint amber shoe prints
 * (fresher, brighter) with a tracking dog's paw prints behind it. About eight draw calls in all.
 */
export class Dogs {
  readonly group = new THREE.Group();
  private readonly body: THREE.InstancedMesh;
  private readonly saddle: THREE.InstancedMesh;
  private readonly head: THREE.InstancedMesh;
  private readonly legs: THREE.InstancedMesh;
  private readonly tail: THREE.InstancedMesh;
  private readonly kennels: THREE.InstancedMesh;
  private readonly prints: THREE.InstancedMesh;
  private readonly paws: THREE.InstancedMesh;
  private readonly rings: THREE.Sprite[] = [];
  private readonly rigs: Rig[] = [];
  private coats: DogCoat[] = [];
  private spots: KennelSpot[] = [];
  private readonly pawAt = new Float32Array(PAWS * 4);
  private nextPaw = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  private readonly pieces: THREE.InstancedMesh[];
  private readonly lying = { x: 0, z: 0 };
  private dt = 0;

  constructor() {
    const inst = (g: THREE.BufferGeometry, n: number, mat: THREE.Material = kitMaterial) => {
      const m = new THREE.InstancedMesh(g, mat, n);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      this.group.add(m);
      return m;
    };
    // Built facing +z, feet at y 0. The body's origin is between the hips; the head's at the neck; the tail's at its root.
    this.body = inst(
      merge(
        [
          box(0.21, 0.19, 0.46, COAT, 0, HIP_Y - 0.06, 0),
          box(0.2, 0.05, 0.3, UNDER, 0, HIP_Y - 0.09, 0.02),
          box(0.19, 0.12, 0.08, UNDER, 0, HIP_Y - 0.04, 0.23),
          box(0.12, 0.13, 0.12, COAT, 0, HIP_Y + 0.07, 0.22),
        ],
        false,
      ),
      4,
    );
    this.saddle = inst(merge([box(0.225, 0.07, 0.3, COAT, 0, HIP_Y + 0.09, -0.04), box(0.13, 0.05, 0.1, COAT, 0, HIP_Y + 0.14, 0.17)], false), 4);
    this.head = inst(
      merge(
        [
          box(0.16, 0.15, 0.16, COAT, 0, -0.04, 0.04),
          box(0.1, 0.08, 0.13, MUZZLE, 0, -0.04, 0.17),
          box(0.05, 0.04, 0.03, NOSE, 0, 0.0, 0.24),
          box(0.025, 0.025, 0.01, NOSE, -0.045, 0.05, 0.12),
          box(0.025, 0.025, 0.01, NOSE, 0.045, 0.05, 0.12),
          box(0.04, 0.09, 0.03, EARS, -0.055, 0.1, 0.0),
          box(0.04, 0.09, 0.03, EARS, 0.055, 0.1, 0.0),
        ],
        false,
      ),
      4,
    );
    this.legs = inst(merge([box(0.06, LEG_H - 0.035, 0.06, COAT, 0, -LEG_H + 0.035, 0), box(0.07, 0.035, 0.08, PAW, 0, -LEG_H, 0.01)], false), 16);
    this.tail = inst(merge([box(0.045, 0.045, 0.22, COAT, 0, -0.02, -0.11)], false), 4);
    // A kennel: plank walls, a pitched roof, the dark doorway (facing +z), a nameplate, a water bowl beside it.
    const wood = 0x9a6a3c;
    const roof = 0x8f3b2c;
    // The gable: a triangle as wide as the walls under roof slabs at its own slope (nothing pokes through them).
    const pitch = 0.62;
    const rise = 0.25 * Math.tan(pitch);
    const gable = paint(new THREE.CylinderGeometry(0.25 / Math.sin((2 * Math.PI) / 3), 0.25 / Math.sin((2 * Math.PI) / 3), 0.54, 3).rotateX(-Math.PI / 2), wood);
    gable.scale(1, rise / (0.25 / Math.sin((2 * Math.PI) / 3) * 1.5), 1);
    gable.computeBoundingBox();
    gable.translate(0, 0.4 - gable.boundingBox!.min.y, 0);
    const slab = (side: number) => box(0.34, 0.035, 0.62, roof, 0, 0, 0).rotateZ(-side * pitch).translate(side * 0.125, 0.4 + rise / 2, 0);
    this.kennels = inst(
      merge([box(0.5, 0.4, 0.56, wood, 0, 0, 0), gable, slab(-1), slab(1), box(0.05, 0.035, 0.63, 0x6e2a1f, 0, 0.4 + rise - 0.005, 0), box(0.22, 0.28, 0.02, 0x1a1410, 0, 0.02, 0.281), box(0.14, 0.05, 0.015, 0xe8b828, 0, 0.34, 0.285), cyl(0.07, 0.04, 0x9aa2ad, 0.33, 0, 0.18, 12), cyl(0.055, 0.042, 0x5aa8d8, 0.33, 0.002, 0.18, 12)]),
      4,
    );
    this.kennels.castShadow = true;
    this.kennels.receiveShadow = true;
    // The trail: flat prints, glowing faintly (added on: black is nothing), fading as they go stale.
    const flat = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2);
    const shoe = merge([flat(new THREE.CircleGeometry(0.055, 10).scale(1, 1.6, 1)).translate(0, 0, 0.03), flat(new THREE.CircleGeometry(0.045, 10)).translate(0, 0, -0.085)], false);
    const pad = merge([flat(new THREE.CircleGeometry(0.04, 9)), ...[-0.045, -0.015, 0.015, 0.045].map((x, k) => flat(new THREE.CircleGeometry(0.017, 7)).translate(x, 0, 0.05 + (k === 0 || k === 3 ? -0.012 : 0)))], false);
    // (Plain blending, readable on sand and concrete in daylight as well as at night; stale ones shrink away.)
    const glow = () => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.prints = inst(shoe, PRINTS, glow());
    this.paws = inst(pad, PAWS, glow());
    for (const m of [this.prints, this.paws]) {
      m.castShadow = false;
      m.renderOrder = 0.4;
    }
    for (let k = 0; k < PAWS; k++) this.pawAt[k * 4 + 3] = -1;
    this.pieces = [this.body, this.saddle, this.head, this.legs, this.tail];
    // Barking: sound rings over its head.
    const ringTex = barkTexture();
    for (let k = 0; k < 4; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
      s.scale.setScalar(0.42);
      s.renderOrder = 5;
      s.visible = false;
      this.rings.push(s);
      this.group.add(s);
    }
  }

  /** A prison's dogs (their coats) and kennels. */
  setDogs(all: KennelSpot[]) {
    // (Pieces for MAX_DOGS dogs at most.)
    const spots = all.slice(0, MAX_DOGS);
    this.spots = spots;
    this.coats = spots.map((s) => s.coat);
    this.rigs.length = 0;
    for (const s of spots) {
      const [bx, by] = COATS[s.coat].build;
      const wide = bx / by;
      const root = new THREE.Object3D();
      root.scale.setScalar(by);
      const body = new THREE.Object3D();
      const head = new THREE.Object3D();
      const tail = new THREE.Object3D();
      const shape = () => {
        const o = new THREE.Object3D();
        o.scale.set(wide, 1, 1);
        return o;
      };
      const bodyShape = shape();
      const headShape = shape();
      const tailShape = shape();
      root.add(body);
      body.add(head, tail, bodyShape);
      head.add(headShape);
      tail.add(tailShape);
      head.position.set(0, HIP_Y + 0.17, 0.27);
      tail.position.set(0, HIP_Y + 0.08, -0.22);
      const legs = [
        [-0.07, 0.17],
        [0.07, 0.17],
        [-0.07, -0.17],
        [0.07, -0.17],
      ].map(([x, z]) => {
        const l = new THREE.Object3D();
        l.position.set(x * wide, HIP_Y, z);
        l.scale.set(wide, 1, 1);
        body.add(l);
        return l;
      });
      const at = kennelSpot(s, LIE_OUT);
      root.position.set(at.x, 0, at.z);
      this.rigs.push({ root, body, head, tail, legs, bodyShape, headShape, tailShape, yaw: faceAngle(s.face), gait: 0, sit: 0, lie: 1, still: 0, bark: 0, wag: this.rigs.length * 2.3, sneeze: 0, px: at.x, pz: at.z });
    }
    // A ring left up by the last prison's dogs goes.
    for (const ring of this.rings) ring.visible = false;
    const n = spots.length;
    this.body.count = this.saddle.count = this.head.count = this.tail.count = n;
    this.legs.count = n * 4;
    spots.forEach((s, k) => {
      const coat = COATS[s.coat];
      this.body.setColorAt(k, this.c.set(coat.main));
      this.saddle.setColorAt(k, this.c.set(coat.saddle ?? coat.main));
      this.head.setColorAt(k, this.c.set(coat.head));
      this.tail.setColorAt(k, this.c.set(coat.saddle ?? coat.main));
      for (let j = 0; j < 4; j++) this.legs.setColorAt(k * 4 + j, this.c.set(coat.main));
    });
    for (const m of [this.body, this.saddle, this.head, this.tail, this.legs]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    // The kennels: a little back from the tile's middle, the door the way it faces.
    this.kennels.count = n;
    spots.forEach((s, k) => {
      const at = kennelSpot(s, -0.16);
      this.q.setFromAxisAngle(UP, faceAngle(s.face));
      this.kennels.setMatrixAt(k, this.m.compose(this.v.set(at.x, 0, at.z), this.q, this.s.set(1, 1, 1)));
    });
    this.kennels.instanceMatrix.needsUpdate = true;
    this.prints.count = 0;
    this.paws.count = 0;
    for (let k = 0; k < PAWS; k++) this.pawAt[k * 4 + 3] = -1;
    // Lying by their kennels until the first frame says otherwise (the title's backdrop shows them so).
    const none: number[] = [];
    this.dt = 1;
    spots.forEach((s, k) => this.pose(k, { x: s.x + 0.5, z: s.z + 0.5, facing: faceAngle(s.face), moving: false, pace: 1, pose: 'kennel', friend: false }, -99, -99, 1, 0, false, none));
    for (const m of this.pieces) m.instanceMatrix.needsUpdate = true;
    this.group.visible = n > 0;
  }

  /**
   * Each frame: every dog posed where it is (`near`: the player close by, a friend wags), the
   * trail's prints (scent tiles with their freshness 0–1, oldest first), the paw prints fading.
   * Asleep dogs' heads go into `sleepers` (the view's Z's).
   */
  update(dogs: readonly DogFrame[], scent: ReadonlyArray<readonly [number, number]>, px: number, pz: number, dt: number, time: number, motion: boolean, sleepers: number[]) {
    const n = Math.min(dogs.length, this.rigs.length);
    this.dt = dt;
    for (let k = 0; k < n; k++) this.pose(k, dogs[k], px, pz, dt, time, motion, sleepers);
    for (let k = n; k < this.rings.length; k++) this.rings[k].visible = false;
    this.drawPrints(scent);
    this.fadePaws(dt);
    for (const m of this.pieces) m.instanceMatrix.needsUpdate = true;
  }

  /** Eases a value towards another at a rate (per second) over this frame. */
  private ease(from: number, to: number, rate: number) {
    return from + (to - from) * Math.min(1, this.dt * rate);
  }

  private pose(k: number, d: DogFrame, px: number, pz: number, dt: number, time: number, motion: boolean, sleepers: number[]) {
    const r = this.rigs[k];
    const coat = COATS[this.coats[k]];
    // Lying by the kennel: on the floor in front of its door (clear of the kennel), not on the tile's middle.
    const atKennel = d.pose === 'kennel' && !d.moving;
    const spot = atKennel ? kennelSpot(this.spots[k], LIE_OUT, this.lying) : null;
    const tx = spot ? spot.x : d.x;
    const tz = spot ? spot.z : d.z;
    const far = Math.hypot(r.root.position.x - tx, r.root.position.z - tz);
    if (far > 1.5 || !motion) r.root.position.set(tx, 0, tz);
    else r.root.position.set(this.ease(r.root.position.x, tx, 10), 0, this.ease(r.root.position.z, tz, 10));
    // Turning: the short way round, smoothly.
    const want = atKennel ? faceAngle(this.spots[k].face) : d.facing;
    let turn = want - r.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    r.yaw += motion ? turn * Math.min(1, dt * 9) : turn;
    r.root.rotation.set(0, r.yaw, 0);
    // How it holds itself.
    r.still = d.moving ? 0 : r.still + dt;
    const lie = d.pose === 'asleep' || atKennel;
    const sit = !lie && d.pose === 'heel' && r.still > 1.2;
    r.lie = motion ? this.ease(r.lie, lie ? 1 : 0, 5) : lie ? 1 : 0;
    r.sit = motion ? this.ease(r.sit, sit ? 1 : 0, 5) : sit ? 1 : 0;
    const run = d.pose === 'track' || d.pace > 1.3;
    if (d.moving && motion) r.gait += dt * (run ? 15 : 10) * Math.max(0.8, d.pace);
    const swing = d.moving && motion ? Math.sin(r.gait) * (run ? 0.75 : 0.5) : 0;
    // (A swung leg reaches less far down: the body dips with it, paws on the floor.)
    const bob = -LEG_H * (1 - Math.cos(swing));
    // The body: down on the floor lying, sat back on its haunches, level otherwise.
    r.body.position.set(0, bob - r.lie * (HIP_Y - 0.09) - r.sit * 0.058, -r.sit * 0.05);
    r.body.rotation.set(-r.sit * 0.5, 0, 0);
    // Legs: a trot (diagonal pairs together), folded under lying, the back ones tucked sitting.
    for (let j = 0; j < 4; j++) {
      const l = r.legs[j];
      const front = j < 2;
      const pair = j === 0 || j === 3 ? 1 : -1;
      let rx = swing * pair;
      rx += r.lie * (front ? -1.35 : -1.45);
      rx += r.sit * (front ? 0.5 : -1.1);
      l.rotation.set(rx, 0, 0);
    }
    // The head: up and alert; nose to the ground on the trail; pointing forward low and barking;
    // shaking off pepper with a sneeze now and then; down on its paws asleep.
    let hx = 0;
    let hy = 0;
    const barking = d.pose === 'point';
    if (barking && motion) {
      r.bark += dt;
      // A bark every half second: the head jerks up.
      const b = (r.bark % 0.5) / 0.5;
      hx = -0.35 * Math.max(0, 1 - b * 4);
    } else r.bark = 0;
    if (d.pose === 'track') hx = 0.55;
    else if (barking) hx += 0.12;
    if (d.pose === 'dazed' && motion) {
      r.sneeze += dt;
      hy = Math.sin(time * 22) * 0.35;
      const s = (r.sneeze % 1.3) / 1.3;
      hx = s > 0.8 ? 0.9 * Math.sin(((s - 0.8) / 0.2) * Math.PI) : -0.15;
    }
    if (lie) hx = r.lie * 0.35;
    if (sit) hx -= 0.15 * r.sit;
    // Idle: a look about now and then.
    if (!d.moving && !lie && !barking && d.pose !== 'dazed' && motion) hy += Math.sin(time * 0.7 + k * 2) * 0.35 * Math.max(0, Math.sin(time * 0.31 + k));
    r.head.rotation.set(hx + r.sit * 0.5, hy, 0);
    r.head.position.y = HIP_Y + 0.17 - r.lie * 0.04;
    // The tail: level on the trail, straight up pointing, a wag for a friend close by, a slow sway otherwise, still asleep.
    const close = Math.hypot(px - d.x, pz - d.z) < 3;
    const wagRate = d.friend && close && !lie ? 18 : barking ? 0 : 4;
    if (motion) r.wag += dt * wagRate;
    const wag = d.pose === 'asleep' ? 0 : Math.sin(r.wag) * (d.friend && close ? 0.7 : 0.22);
    const lift = barking ? 1.1 : d.pose === 'track' ? 0.15 : d.pose === 'dazed' ? -0.3 : 0.55;
    // (Lying, curled round to one side, clear of the kennel.)
    r.tail.rotation.set(lift - r.lie * 0.5 + r.sit * 0.4, wag + r.lie * 1.2, 0);
    // Matrices to the pieces.
    r.root.updateMatrixWorld(true);
    this.body.setMatrixAt(k, r.bodyShape.matrixWorld);
    this.saddle.setMatrixAt(k, coat.saddle === null ? this.zero : r.bodyShape.matrixWorld);
    this.head.setMatrixAt(k, r.headShape.matrixWorld);
    this.tail.setMatrixAt(k, r.tailShape.matrixWorld);
    for (let j = 0; j < 4; j++) this.legs.setMatrixAt(k * 4 + j, r.legs[j].matrixWorld);
    // Sound rings over a barking dog (two, rising and fading).
    const ring = this.rings[k];
    if (ring) {
      // (Reduced motion: one still ring, the bark said all the same.)
      ring.visible = barking;
      if (ring.visible) {
        const b = motion ? (r.bark % 0.5) / 0.5 : 0.3;
        r.head.getWorldPosition(this.v);
        ring.position.set(this.v.x, this.v.y + 0.25 + b * 0.25, this.v.z);
        ring.scale.setScalar(0.3 + b * 0.25);
        (ring.material as THREE.SpriteMaterial).opacity = motion ? 1 - b : 0.8;
      }
    }
    if (d.pose === 'asleep') {
      r.head.getWorldPosition(this.v);
      sleepers.push(this.v.x, this.v.y + 0.2, this.v.z);
    }
    // On the trail: paw prints behind it.
    if (d.pose === 'track' && d.moving) {
      const moved = Math.hypot(r.root.position.x - r.px, r.root.position.z - r.pz);
      if (moved >= PAW_EVERY) {
        r.px = r.root.position.x;
        r.pz = r.root.position.z;
        const side = (this.nextPaw & 1 ? 1 : -1) * 0.07;
        const p = this.nextPaw;
        this.nextPaw = (this.nextPaw + 1) % PAWS;
        this.pawAt[p * 4] = r.px + Math.cos(r.yaw) * side;
        this.pawAt[p * 4 + 1] = r.pz - Math.sin(r.yaw) * side;
        this.pawAt[p * 4 + 2] = r.yaw;
        this.pawAt[p * 4 + 3] = PAW_LIFE;
      }
    } else {
      r.px = r.root.position.x;
      r.pz = r.root.position.z;
    }
  }

  /** The player's trail: a shoe print a tile, turned along the way they went, left and right by turns, brighter the fresher. */
  private drawPrints(scent: ReadonlyArray<readonly [number, number]>) {
    const n = Math.min(scent.length, PRINTS);
    const from = scent.length - n;
    for (let k = 0; k < n; k++) {
      const [t, fresh] = scent[from + k];
      const x = (t % MAP_W) + 0.5;
      const z = Math.floor(t / MAP_W) + 0.5;
      const prev = scent[from + k - 1]?.[0] ?? -1;
      const next = scent[from + k + 1]?.[0] ?? -1;
      const a = next >= 0 ? next : t;
      const b = next >= 0 ? t : prev >= 0 ? prev : t;
      const dx = (a % MAP_W) - (b % MAP_W);
      const dz = Math.floor(a / MAP_W) - Math.floor(b / MAP_W);
      const yaw = dx || dz ? Math.atan2(dx, dz) : 0;
      // (Left or right by the tile, so a print keeps its side as the trail moves on.)
      const side = (((t % MAP_W) + Math.floor(t / MAP_W)) & 1 ? 1 : -1) * 0.11;
      this.q.setFromAxisAngle(UP, yaw);
      this.m.compose(this.v.set(x + Math.cos(yaw) * side, PRINT_Y, z - Math.sin(yaw) * side), this.q, this.s.setScalar(0.45 + 0.55 * fresh));
      this.prints.setMatrixAt(k, this.m);
      this.prints.setColorAt(k, this.c.copy(SCENT_AMBER).multiplyScalar(0.75 + 0.25 * fresh));
    }
    this.prints.count = n;
    this.prints.instanceMatrix.needsUpdate = true;
    if (this.prints.instanceColor) this.prints.instanceColor.needsUpdate = true;
  }

  private fadePaws(dt: number) {
    let n = 0;
    for (let k = 0; k < PAWS; k++) {
      const life = this.pawAt[k * 4 + 3];
      if (life < 0) continue;
      this.pawAt[k * 4 + 3] = life - dt;
      this.q.setFromAxisAngle(UP, this.pawAt[k * 4 + 2]);
      this.m.compose(this.v.set(this.pawAt[k * 4], PRINT_Y, this.pawAt[k * 4 + 1]), this.q, this.s.setScalar(0.4 + 0.6 * Math.max(0, life / PAW_LIFE)));
      this.paws.setMatrixAt(n, this.m);
      this.paws.setColorAt(n, PAW_ORANGE);
      n++;
    }
    this.paws.count = n;
    this.paws.instanceMatrix.needsUpdate = true;
    if (this.paws.instanceColor) this.paws.instanceColor.needsUpdate = true;
  }

}

const UP = new THREE.Vector3(0, 1, 0);

/** A kennel door's facing as an angle (0 = +z). */
const faceAngle = (face: number) => Math.atan2(DIR_X[face] ?? 0, DIR_Z[face] ?? 1);

/** A point on a kennel's tile, `off` tiles out from its middle the way its door faces. */
function kennelSpot(s: KennelSpot, off: number, out = { x: 0, z: 0 }): { x: number; z: number } {
  const a = faceAngle(s.face);
  out.x = s.x + 0.5 + Math.sin(a) * off;
  out.z = s.z + 0.5 + Math.cos(a) * off;
  return out;
}

/** Two arcs of sound, drawn once. */
function barkTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.lineCap = 'round';
  for (const [r, w] of [
    [14, 10],
    [24, 10],
  ]) {
    g.strokeStyle = '#1b2230';
    g.lineWidth = w;
    g.beginPath();
    g.arc(32, 40, r, -Math.PI * 0.8, -Math.PI * 0.2);
    g.stroke();
    g.strokeStyle = '#ffc04a';
    g.lineWidth = w - 5;
    g.beginPath();
    g.arc(32, 40, r, -Math.PI * 0.8, -Math.PI * 0.2);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
