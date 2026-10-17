import * as THREE from 'three';
import type { DeliveryDef } from '../content/prisons/types';
import { DIR_X, DIR_Z } from '../sim/command';
import { MAP_W, type World } from '../sim/world/World';
import { TILE } from '../sim/world/tiles';
import { box, kitMaterial, merge, paint, rod, type Part } from './kit';

/** What the delivery looks like this frame (P18), from the day's plan. */
export interface DeliveryFrame {
  /** Minutes into the prison day, fractional (-1: not a delivery day). */
  t: number;
  /** When it's in (minutes into the prison day): its arrival, the search, its leaving. */
  at: number;
  search: number;
  until: number;
  /** The player hidden in it. */
  stowed: boolean;
}

/** Minutes it takes to drive in (ending at `at`) and out (from `until`). */
const DRIVE = 5;
/** How far a tile's door is opened ahead of the vehicle passing through it (tiles). */
const GATE_REACH = 3.2;

/**
 * Delivery day in the picture (P18): the vehicle that comes once a week (Center Perks' supply
 * truck, Stalag Flucht's Red Cross truck, San Pancho's produce truck; Irongate's helicopter
 * is the island's): it backs in along its road over the five minutes before 12:30 (reversing
 * lights, the gates on its way opening for it), stands at its bay with its tailgate open
 * (crates inside), shuts it for the search at 14:30, and drives out at 14:31. A ring at its
 * tail shows where to climb in. Leaving with the player aboard (the escape), it drives off
 * in real time and the camera goes with it. Two meshes for the body (one with the wheels,
 * instanced), one for the tailgate, one for its lamps, one for the ring.
 */
export class Delivery {
  readonly group = new THREE.Group();
  private def: DeliveryDef | null = null;
  private body: THREE.Mesh | null = null;
  private wheels: THREE.InstancedMesh | null = null;
  private wheelAt: Array<[number, number, number]> = [];
  private gate: THREE.Mesh | null = null;
  private lamps: THREE.Mesh | null = null;
  private mat: THREE.MeshStandardMaterial | null = null;
  private tailFar = false;
  private wheelR = 0.34;
  private fade = 1;
  private lampMat: THREE.MeshBasicMaterial | null = null;
  private ring: THREE.Mesh | null = null;
  private ringMat: THREE.MeshBasicMaterial | null = null;
  /** The road as points (tiles), from off the map to the bay's middle, and its length. */
  private road: THREE.Vector2[] = [];
  private roadLen = 0;
  /** Doors on its road (tile indexes and where they are). */
  private gates: Array<{ tile: number; x: number; z: number }> = [];
  /** Where the tailgate hinges (local), and its kind of movement. */
  private gateKind: 'roller' | 'flaps' | 'drop' = 'roller';
  private gateOpen = 0;
  private spin = 0;
  private lastS = -1;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  /** Leaving with the player aboard (seconds since). */
  private leaving = -1;
  /** On screen this frame, and the way it's moving (1 forward, -1 reversing, 0 standing). */
  shown = false;
  moving = 0;
  /** The doors it's passing through this frame (the view opens them). */
  readonly opening = new Set<number>();
  /** Sounds as it goes (the play layer plays them): reversing beeps, the tailgate, the engine pulling away. */
  onSound: (kind: 'beep' | 'gate' | 'engine', x: number, z: number) => void = () => {};
  private beepClock = 0;
  private wasOpen = false;
  private wasMoving = 0;

  /** A prison: its vehicle (none without a delivery, or with the helicopter: the island draws that). */
  setWorld(world: World) {
    this.clear();
    const d = world.def.delivery;
    if (!d) return;
    this.def = d;
    this.addRing(d);
    // (The helicopter is the island's to draw: only its ring here.)
    if (d.vehicle === 'helicopter') return;
    this.road = d.road.map((p) => new THREE.Vector2(p.x, p.z));
    this.roadLen = 0;
    for (let k = 1; k < this.road.length; k++) this.roadLen += this.road[k].distanceTo(this.road[k - 1]);
    // The doors along its road (within a tile of it).
    for (let i = 0; i < world.ground.kind.length; i++) {
      if (world.ground.kind[i] !== TILE.DOOR) continue;
      const x = (i % MAP_W) + 0.5;
      const z = Math.floor(i / MAP_W) + 0.5;
      if (this.distToRoad(x, z) <= 1.1) this.gates.push({ tile: i, x, z });
    }
    const built = MODELS[d.vehicle]();
    this.gateKind = built.gate;
    // Its own material: it fades to see the player and the guards behind it (the camera looks north, over its far side).
    this.mat = kitMaterial.clone();
    this.mat.transparent = true;
    this.body = new THREE.Mesh(merge(built.body), this.mat);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    const gate = merge(built.tailgate, false);
    // (A drop tailgate turns on its bottom edge: built about it.)
    if (built.gate === 'drop') gate.translate(0, -DROP_HINGE.y, -DROP_HINGE.z);
    this.gate = new THREE.Mesh(gate, this.mat);
    this.gate.castShadow = true;
    this.lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.lamps = new THREE.Mesh(merge(built.lamps, false), this.lampMat);
    this.wheelAt = built.wheels;
    this.wheelR = built.wheelR;
    const wheel = merge([rod(built.wheelR, 0.24, 0x1d1f23, 0, 0, 0, 12), rod(built.wheelR * 0.55, 0.26, 0x9aa1ab, 0, 0, 0, 10)], false);
    this.wheels = new THREE.InstancedMesh(wheel, this.mat, built.wheels.length);
    this.wheels.castShadow = true;
    this.wheels.frustumCulled = false;
    const holder = new THREE.Group();
    holder.add(this.body, this.gate, this.lamps, this.wheels);
    holder.visible = false;
    this.group.add(holder);
  }

  /** The ring at the tail (every vehicle, the helicopter's too). */
  private addRing(d: DeliveryDef) {
    // The ring at the tail: where to climb in.
    // (Drawn over everything, like the floor's arrows: the vehicle's body would hide it.)
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0x4fe0a6, transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false });
    const ring = new THREE.RingGeometry(0.34, 0.44, 32);
    ring.rotateX(-Math.PI / 2);
    const arrow = new THREE.ShapeGeometry(arrowShape());
    arrow.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(mergeFlat([ring, arrow]), this.ringMat);
    this.ring.position.set(d.tail.x + 0.5, 0.03, d.tail.z + 0.5);
    // The arrow points into the vehicle (from the tail toward the bay's middle).
    const [bx0, bz0, bx1, bz1] = d.bay;
    this.ring.rotation.y = Math.atan2((bx0 + bx1 + 1) / 2 - (d.tail.x + 0.5), (bz0 + bz1 + 1) / 2 - (d.tail.z + 0.5));
    this.ring.renderOrder = 5;
    // Its tail away from the camera (north of it): the player there is behind it.
    this.tailFar = d.tail.z < (bz0 + bz1 + 1) / 2;
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  private get holder(): THREE.Group | null {
    return (this.body?.parent as THREE.Group) ?? null;
  }

  /** How far a point is from the road (tiles). */
  private distToRoad(x: number, z: number): number {
    let best = Infinity;
    const p = new THREE.Vector2(x, z);
    for (let k = 1; k < this.road.length; k++) {
      const a = this.road[k - 1];
      const b = this.road[k];
      const ab = b.clone().sub(a);
      const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
      best = Math.min(best, a.clone().addScaledVector(ab, t).distanceTo(p));
    }
    return best;
  }

  /** A point `s` along the road from its start (tiles), into `out`. */
  private along(s: number, out: THREE.Vector2): THREE.Vector2 {
    let left = Math.max(0, Math.min(this.roadLen, s));
    for (let k = 1; k < this.road.length; k++) {
      const a = this.road[k - 1];
      const b = this.road[k];
      const len = a.distanceTo(b);
      if (left <= len || k === this.road.length - 1) return out.copy(a).lerp(b, len > 0 ? Math.min(1, left / len) : 1);
      left -= len;
    }
    return out.copy(this.road[this.road.length - 1]);
  }

  private readonly at2 = new THREE.Vector2();

  /**
   * Per frame. `near`: the player within a few tiles (the ring brightens). Returns whether it's
   * in the picture.
   */
  update(f: DeliveryFrame | null, dt: number, time: number, motion: boolean, near: boolean, ground = true): boolean {
    // Faded while the player is round its far side (not while they're hidden in it).
    const see = near && this.tailFar && !f?.stowed ? 0.4 : 1;
    this.fade += (see - this.fade) * Math.min(1, dt * 6);
    if (this.mat) {
      this.mat.opacity = this.fade;
      // (Opaque unless faded: drawn with the rest, cones and veils over it as over everything.)
      this.mat.transparent = this.fade < 0.98;
      this.mat.depthWrite = this.fade > 0.98;
    }
    const d = this.def;
    const holder = this.holder;
    this.opening.clear();
    this.moving = 0;
    // The ring: while it's in and its tailgate is open, nobody aboard.
    // (On the ground floor only: from the roofs and the vents there's no climbing in.)
    const ringOn = ground && !!f && f.t >= 0 && this.leaving < 0 && f.t >= f.at && f.t < f.search && !f.stowed;
    if (this.ring && this.ringMat) {
      this.ring.visible = ringOn;
      if (ringOn) this.ringMat.opacity = (near ? 0.75 : 0.42) + (motion ? Math.sin(time * 3.2) * 0.15 : 0);
    }
    if (!d || !holder || !this.body) {
      this.shown = false;
      return false;
    }
    // Where along its road (0 off the map, roadLen at the bay), and which way it's going.
    let s = -1;
    let dir = 0;
    if (this.leaving >= 0) {
      this.leaving += dt;
      const k = Math.min(1, this.leaving / (DRIVE * 0.9));
      s = this.roadLen * (1 - ease(k));
      dir = 1;
    } else if (f && f.t >= 0) {
      if (f.t >= f.at - DRIVE && f.t < f.at) {
        s = this.roadLen * ease((f.t - (f.at - DRIVE)) / DRIVE);
        dir = -1;
      } else if (f.t >= f.at && f.t < f.until) s = this.roadLen;
      else if (f.t >= f.until && f.t < f.until + DRIVE) {
        s = this.roadLen * (1 - ease((f.t - f.until) / DRIVE));
        dir = 1;
      }
    }
    const shown = s >= 0;
    holder.visible = shown;
    this.shown = shown;
    if (!shown) {
      this.lastS = -1;
      return false;
    }
    const pos = this.along(s, this.at2);
    holder.position.set(pos.x, 0, pos.y);
    // The nose points where it faces at the bay (it backs in along its road, and drives out nose first).
    holder.rotation.y = Math.atan2(DIR_X[d.face], DIR_Z[d.face]);
    // Moving: the wheels turn, the lamps say which way.
    const ds = this.lastS >= 0 ? s - this.lastS : 0;
    this.lastS = s;
    this.moving = Math.abs(ds) > 1e-4 ? dir : 0;
    // (Rolling back as it reverses in: a turn of the wheel per its circumference.)
    if (motion) this.spin += (Math.abs(ds) / this.wheelR) * (dir < 0 ? -1 : 1);
    this.placeWheels();
    // The tailgate: open while it's in (until the search), shut on the road.
    const want = f && this.leaving < 0 && f.t >= f.at + 0.5 && f.t < f.search ? 1 : 0;
    this.gateOpen += Math.sign(want - this.gateOpen) * Math.min(Math.abs(want - this.gateOpen), dt * (motion ? 1.6 : 99));
    this.poseGate();
    const open = this.gateOpen > 0.5;
    if (open !== this.wasOpen) {
      this.wasOpen = open;
      this.onSound('gate', pos.x, pos.y);
    }
    // Lamps: the tail lights glow, white reversing lights (and beeps) backing in, brighter braking at the end.
    if (this.lampMat) {
      const reversing = this.moving < 0;
      // (Steady with reduced motion.)
      const blink = motion && Math.sin(time * 9) > 0;
      this.lampMat.color.setScalar(reversing ? (blink ? 1.25 : 0.9) : this.moving ? 1 : 0.55);
    }
    if (this.moving < 0) {
      this.beepClock -= dt;
      if (this.beepClock <= 0) {
        this.beepClock = 0.55;
        this.onSound('beep', pos.x, pos.y);
      }
    } else this.beepClock = 0;
    if (this.moving > 0 && this.wasMoving <= 0) this.onSound('engine', pos.x, pos.y);
    this.wasMoving = this.moving;
    // The doors on its way stand open while it's on the road near them (paused too: never shut through it).
    if (s < this.roadLen - 1e-3) for (const g of this.gates) if (Math.hypot(g.x - pos.x, g.z - pos.y) <= GATE_REACH + 2.5) this.opening.add(g.tile);
    return true;
  }

  private placeWheels() {
    const w = this.wheels;
    if (!w) return;
    this.wheelAt.forEach(([x, y, z], k) => {
      this.e.set(this.spin, 0, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(x, y, z), this.q, this.one);
      w.setMatrixAt(k, this.m);
    });
    w.instanceMatrix.needsUpdate = true;
  }

  private poseGate() {
    const g = this.gate;
    if (!g) return;
    const k = ease(this.gateOpen);
    // A roller door rolls up into the top of the box; canvas flaps roll up to the hoops (their top edge stays put); a tailgate drops down on its hinge.
    if (this.gateKind === 'roller' || this.gateKind === 'flaps') {
      const top = this.gateKind === 'roller' ? 2.2 : 1.88;
      const sy = 1 - k * (this.gateKind === 'roller' ? 0.92 : 0.85);
      g.scale.set(1, sy, 1);
      g.position.set(0, top * (1 - sy), 0);
    } else {
      g.position.set(0, DROP_HINGE.y, DROP_HINGE.z);
      g.rotation.x = -k * 1.5;
    }
  }

  /** The escape (P18): the vehicle drives off with the player aboard, in real time. */
  depart() {
    this.leaving = 0;
    this.gateOpen = 0;
    // (The escape plays the engine itself.)
    this.wasMoving = 1;
  }

  /** Shown for a moment (a new game, new graphics settings) so its shaders compile before it's needed. */
  warm(on: boolean) {
    const h = this.holder;
    if (h) h.visible = on;
    if (this.ring) this.ring.visible = on;
  }

  /** Where the player rides now (tiles; y up) while it leaves with them aboard, or null. */
  carry(out: THREE.Vector3): THREE.Vector3 | null {
    const h = this.holder;
    if (this.leaving < 0 || !h) return null;
    return out.set(h.position.x, 1.2, h.position.z);
  }

  get aboard(): boolean {
    return this.leaving >= 0;
  }

  clear() {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) if (mat !== kitMaterial) mat.dispose();
      }
    });
    this.group.clear();
    this.def = null;
    this.body = this.gate = this.lamps = this.ring = null;
    this.mat?.dispose();
    this.mat = null;
    this.fade = 1;
    this.wheels = null;
    this.gates = [];
    this.leaving = -1;
    this.gateOpen = 0;
    this.lastS = -1;
    this.shown = false;
    this.wasOpen = false;
    this.wasMoving = 0;
    this.beepClock = 0;
    this.spin = 0;
  }
}

/** How high the Red Cross truck's canvas bows over its hoops (of a half circle). */
const BOW = 0.45;
/** Where the produce truck's tailgate hinges (local: its bottom edge, at the tail). */
const DROP_HINGE = { y: 0.62, z: -1.42 };

const ease = (k: number) => {
  const t = Math.max(0, Math.min(1, k));
  return t * t * (3 - 2 * t);
};

/** An arrow, its tip at -y in the shape's plane: laid flat (-y becomes +z) and turned, it points into the vehicle. */
function arrowShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, -0.2);
  s.lineTo(0.14, -0.02);
  s.lineTo(0.05, -0.02);
  s.lineTo(0.05, 0.18);
  s.lineTo(-0.05, 0.18);
  s.lineTo(-0.05, -0.02);
  s.lineTo(-0.14, -0.02);
  s.closePath();
  return s;
}

/** Flat geometries joined (no vertex colours: the ring's own material colours them). */
function mergeFlat(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const n = g.reduce((a, p) => a + p.attributes.position.count, 0);
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const p of g) {
    pos.set(p.attributes.position.array as Float32Array, o);
    o += p.attributes.position.count * 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  for (const p of parts) p.dispose();
  return out;
}

interface Model {
  body: Part[];
  tailgate: Part[];
  lamps: Part[];
  wheels: Array<[number, number, number]>;
  wheelR: number;
  gate: 'roller' | 'flaps' | 'drop';
}

/** Crates at the back of a load (local z from the tail), to be seen through an open tailgate. */
function crates(z0: number, w: number, y: number, colors: readonly number[]): Part[] {
  const out: Part[] = [];
  const n = 3;
  for (let k = 0; k < n; k++) {
    const x = -w / 2 + (k + 0.5) * (w / n);
    const c = colors[k % colors.length];
    out.push(box(w / n - 0.08, 0.42, 0.5, c, x, y, z0 + 0.32), box(w / n - 0.2, 0.36, 0.44, colors[(k + 1) % colors.length], x + 0.03, y + 0.42, z0 + 0.36));
  }
  return out;
}

/**
 * The vehicles, nose toward +z, tail at -z, built from kit parts (units: tiles; a bay two
 * tiles wide and five long for the trucks, two by three for the produce truck).
 */
const MODELS: Record<Exclude<DeliveryDef['vehicle'], 'helicopter'>, () => Model> = {
  // Center Perks: a white box truck in the suppliers' blue, an orange stripe, a roller door.
  truck: () => {
    const W = 1.76;
    const body: Part[] = [
      box(1.5, 0.26, 4.5, 0x2a2d33, 0, 0.3, 0),
      // The cab.
      box(W, 1.12, 1.25, 0x2f6fd1, 0, 0.52, 1.55),
      box(W - 0.06, 0.42, 0.06, 0x1b2836, 0, 1.08, 2.18),
      box(0.06, 0.34, 0.7, 0x1b2836, W / 2, 1.12, 1.6),
      box(0.06, 0.34, 0.7, 0x1b2836, -W / 2, 1.12, 1.6),
      box(W + 0.04, 0.12, 0.14, 0xb9c0c8, 0, 0.45, 2.2),
      box(W - 0.2, 0.06, 1.1, 0x2a5cb0, 0, 1.64, 1.5),
      // The box, open at the back (crates inside).
      box(0.07, 1.78, 3.1, 0xf2f3f0, W / 2 - 0.035, 0.52, -0.8),
      box(0.07, 1.78, 3.1, 0xf2f3f0, -W / 2 + 0.035, 0.52, -0.8),
      box(W, 0.08, 3.1, 0xe9ebe7, 0, 2.22, -0.8),
      box(W, 1.78, 0.07, 0xe9ebe7, 0, 0.52, 0.72),
      box(W, 0.08, 3.1, 0x5b5f66, 0, 0.52, -0.8),
      box(W - 0.14, 1.66, 0.04, 0x26282c, 0, 0.58, 0.66),
      // The stripe and the doorframe.
      box(0.02, 0.22, 3.0, 0xf08a24, W / 2 + 0.005, 1.25, -0.8),
      box(0.02, 0.22, 3.0, 0xf08a24, -W / 2 - 0.005, 1.25, -0.8),
      box(0.1, 1.78, 0.1, 0xc8ccd0, W / 2 - 0.05, 0.52, -2.33),
      box(0.1, 1.78, 0.1, 0xc8ccd0, -W / 2 + 0.05, 0.52, -2.33),
      box(W, 0.12, 0.1, 0xc8ccd0, 0, 2.18, -2.33),
      box(W, 0.14, 0.2, 0x3a3d43, 0, 0.36, -2.3),
      ...crates(-2.2, W - 0.24, 0.56, [0xb8874e, 0xa06f3c, 0xc79a5f]),
      // Seen from above: the roof's ribs, its orange edges and the suppliers' sun.
      ...[-1.95, -1.3, -0.65, 0].map((z) => box(W - 0.14, 0.03, 0.06, 0xcfd2ce, 0, 2.3, z)),
      box(0.12, 0.025, 3.0, 0xf08a24, W / 2 - 0.12, 2.3, -0.8),
      box(0.12, 0.025, 3.0, 0xf08a24, -W / 2 + 0.12, 2.3, -0.8),
      paint(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 18).translate(0, 2.33, -0.8), 0xf08a24),
      paint(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 18).translate(0, 2.345, -0.8), 0xffd36b),
    ];
    const tailgate = [box(W - 0.16, 1.62, 0.05, 0xd9dcd8, 0, 0.58, -2.33), ...[0.85, 1.25, 1.65].map((y) => box(W - 0.18, 0.025, 0.06, 0xb7bab6, 0, y, -2.34))];
    const lamps = [box(0.16, 0.12, 0.04, 0xff3a2a, W / 2 - 0.14, 0.44, -2.42), box(0.16, 0.12, 0.04, 0xff3a2a, -W / 2 + 0.14, 0.44, -2.42), box(0.07, 0.07, 0.04, 0xf4f6ff, W / 2 - 0.3, 0.44, -2.42), box(0.07, 0.07, 0.04, 0xf4f6ff, -W / 2 + 0.3, 0.44, -2.42), box(0.2, 0.12, 0.04, 0xfff2c4, W / 2 - 0.2, 0.68, 2.2), box(0.2, 0.12, 0.04, 0xfff2c4, -W / 2 + 0.2, 0.68, 2.2)];
    return { body, tailgate, lamps, wheels: wheels(W, [1.55, -1.0, -1.62], 0.34), wheelR: 0.34, gate: 'roller' };
  },
  // Stalag Flucht: the Red Cross's truck, canvas over hoops, the cross on its sides and its roof.
  redCross: () => {
    const W = 1.72;
    const canvas = 0xe7e1cf;
    const red = 0xd42a2a;
    const cross = (x: number, y: number, z: number, along: 'x' | 'y', s: number): Part[] =>
      along === 'x'
        ? [box(0.02, s, s * 0.32, red, x, y - s / 2, z), box(0.02, s * 0.32, s, red, x, y - (s * 0.32) / 2, z)]
        : [box(s, 0.02, s * 0.32, red, 0, y, z), box(s * 0.32, 0.02, s, red, 0, y, z)];
    const body: Part[] = [
      box(1.46, 0.26, 4.5, 0x2a2d33, 0, 0.3, 0),
      // The cab: grey-white, a rounded bonnet in front.
      box(W, 1.0, 1.0, 0xd9d6cc, 0, 0.52, 1.45),
      box(W * 0.8, 0.62, 0.62, 0xcfccc1, 0, 0.5, 2.1),
      box(W - 0.08, 0.36, 0.06, 0x23303a, 0, 1.08, 1.96),
      box(W * 0.78, 0.1, 0.12, 0x9a9a92, 0, 0.42, 2.42),
      // The canvas: sides, the roof bowed over its hoops, the front.
      box(0.06, 1.3, 3.2, canvas, W / 2 - 0.03, 0.58, -0.75),
      box(0.06, 1.3, 3.2, canvas, -W / 2 + 0.03, 0.58, -0.75),
      paint(new THREE.CylinderGeometry(W / 2, W / 2, 3.2, 14, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).scale(1, BOW, 1).translate(0, 1.88, -0.75), canvas),
      box(W, 1.3, 0.06, canvas, 0, 0.58, 0.83),
      box(W, 0.08, 3.2, 0x6b5a44, 0, 0.52, -0.75),
      box(W - 0.12, 1.2, 0.04, 0x2a2620, 0, 0.62, 0.78),
      // Its hoops, and the crosses.
      ...[-2.2, -0.75, 0.7].map((z) => box(W + 0.02, 0.05, 0.06, 0x8e8a7c, 0, 1.86, z)),
      ...cross(W / 2 + 0.01, 1.52, -0.75, 'x', 0.8),
      ...cross(-W / 2 - 0.01, 1.52, -0.75, 'x', 0.8),
      ...cross(0, 1.89 + (W / 2) * BOW, -0.75, 'y', 0.95),
      box(W, 0.14, 0.2, 0x3a3d43, 0, 0.36, -2.3),
      ...crates(-2.2, W - 0.24, 0.56, [0xe8e2d0, 0xb8874e, 0xd9d0b8]),
    ];
    const tailgate = [box(W - 0.06, 1.3, 0.05, 0xdcd5c0, 0, 0.58, -2.36), box(0.04, 1.3, 0.06, 0xb9b19a, 0, 0.58, -2.37)];
    const lamps = [box(0.15, 0.12, 0.04, 0xff3a2a, W / 2 - 0.14, 0.42, -2.42), box(0.15, 0.12, 0.04, 0xff3a2a, -W / 2 + 0.14, 0.42, -2.42), box(0.07, 0.07, 0.04, 0xf4f6ff, W / 2 - 0.3, 0.42, -2.42), box(0.07, 0.07, 0.04, 0xf4f6ff, -W / 2 + 0.3, 0.42, -2.42), cylLamp(W / 2 - 0.22, 0.72, 2.42), cylLamp(-W / 2 + 0.22, 0.72, 2.42)];
    return { body, tailgate, lamps, wheels: wheels(W, [1.6, -1.05, -1.65], 0.36), wheelR: 0.36, gate: 'flaps' };
  },
  // San Pancho: a sun-faded pickup, its bed piled with crates of fruit and veg, a tailgate that drops.
  produce: () => {
    const W = 1.62;
    const fruit = [0xf28a1e, 0x5fae3a, 0xd93a2a, 0xf2cf3a, 0x8a4fc0];
    const body: Part[] = [
      box(1.38, 0.24, 2.9, 0x2a2d33, 0, 0.3, 0),
      // The cab.
      box(W, 0.92, 1.05, 0x2aa59a, 0, 0.5, 0.9),
      box(W - 0.06, 0.34, 0.06, 0x1d2a30, 0, 1.0, 1.42),
      box(W - 0.1, 0.06, 0.9, 0xf2efe6, 0, 1.42, 0.9),
      box(W * 0.9, 0.4, 0.3, 0x239086, 0, 0.5, 1.5),
      box(W + 0.04, 0.1, 0.12, 0xb9c0c8, 0, 0.44, 1.66),
      // The bed and its wooden rails.
      box(W, 0.1, 1.8, 0x7a5a3a, 0, 0.56, -0.5),
      box(0.08, 0.42, 1.8, 0x9a7448, W / 2 - 0.04, 0.62, -0.5),
      box(0.08, 0.42, 1.8, 0x9a7448, -W / 2 + 0.04, 0.62, -0.5),
      box(W, 0.42, 0.08, 0x9a7448, 0, 0.62, 0.38),
    ];
    // Crates, two rows of three, each topped with its produce.
    for (let r = 0; r < 2; r++)
      for (let k = 0; k < 3; k++) {
        const x = -W / 2 + 0.3 + k * 0.5;
        const z = 0.05 - r * 0.62;
        body.push(box(0.44, 0.34, 0.5, 0xb8874e, x, 0.66, z));
        const c = fruit[(r * 3 + k) % fruit.length];
        for (let j = 0; j < 4; j++) body.push(paint(new THREE.IcosahedronGeometry(0.1, 0).translate(x - 0.1 + (j % 2) * 0.2, 1.06, z - 0.1 + Math.floor(j / 2) * 0.2), c));
      }
    // A green tarp over the back row: where a stowaway hides.
    body.push(box(W - 0.2, 0.08, 0.66, 0x3f6b3a, 0, 1.12, -0.95), box(W - 0.26, 0.5, 0.06, 0x3f6b3a, 0, 0.66, -1.26));
    const tailgate = [box(W - 0.06, 0.4, 0.06, 0x9a7448, 0, 0.62, -1.42), box(W - 0.3, 0.06, 0.07, 0x7a5a3a, 0, 0.82, -1.43)];
    const lamps = [box(0.14, 0.1, 0.04, 0xff3a2a, W / 2 - 0.12, 0.5, -1.48), box(0.14, 0.1, 0.04, 0xff3a2a, -W / 2 + 0.12, 0.5, -1.48), box(0.18, 0.1, 0.04, 0xfff2c4, W / 2 - 0.18, 0.66, 1.66), box(0.18, 0.1, 0.04, 0xfff2c4, -W / 2 + 0.18, 0.66, 1.66)];
    return { body, tailgate, lamps, wheels: wheels(W, [0.9, -0.85], 0.3), wheelR: 0.3, gate: 'drop' };
  },
};

/** A round headlamp facing forward. */
function cylLamp(x: number, y: number, z: number): Part {
  return paint(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10).rotateX(Math.PI / 2).translate(x, y, z), 0xfff2c4);
}

/** Wheels either side at each axle (local positions of their centres). */
function wheels(w: number, axles: readonly number[], r: number): Array<[number, number, number]> {
  return axles.flatMap((z) => [
    [w / 2 - 0.1, r, z],
    [-w / 2 + 0.1, r, z],
  ]) as Array<[number, number, number]>;
}
