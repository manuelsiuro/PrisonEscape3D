import * as THREE from 'three';
import { MAP_W, type World } from '../sim/world/World';
import { box, kitMaterial, merge, paint, type Part } from './kit';
import { ROOF_Y } from './Structure';

/** What the bluff and the glider show this frame (P24). */
export interface GetawayFrame {
  /** The checkpoint: its gate changing shifts (19:50–20:10), the player waved through. */
  shift: boolean;
  waved: boolean;
  /** A glider at a roof's edge in hand: from (tile middle, on the roof), where it comes down (tile middle), whether it goes and lands out; null otherwise. */
  glide: { fromX: number; fromZ: number; toX: number; toZ: number; go: boolean; out: boolean } | null;
}

/** The pilot's hands on the bar, above their feet (the LIFT pose: arms raised forward), and how high counts as over the walls (the roofs stay drawn). */
const HANDS = 1.03;
const WALL_ABOVE = 1.45;
/** How long a glide takes on screen (seconds): a run-up, then a beat a tile. */
export const glideSecs = (dist: number) => 0.35 + 0.24 * dist;
/** The landing ring's colours: out to the road, down inside, can't go. */
const OUT = 0x5fe08a;
const IN = 0xffb347;
const NO = 0x9aa2ad;
/** Dots along the preview's path. */
const DOTS = 9;
/** A wreck left where a glide came down inside fades after this long (seconds). */
const WRECK_SECS = 9;

/** A balsa rod from one point to another (glider frame), as a kit part. */
function spar(from: THREE.Vector3, to: THREE.Vector3, r: number, color: number): Part {
  const d = new THREE.Vector3().subVectors(to, from);
  const g = new THREE.CylinderGeometry(r, r, d.length(), 6);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
  g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  return paint(g, color);
}

/** The glider: a pale sheet on a balsa frame (the keel, the leading edges from the nose to each tip), the control bar ahead of the pilot's face; the nose along +z. */
const NOSE = new THREE.Vector3(0, 0.05, 0.75);
const TAIL = new THREE.Vector3(0, 0, -0.25);
/** Where the pilot's hands hold the bar, from the wing's origin (the arms up and forward, the sail over the cap). */
const BAR = new THREE.Vector3(0, -0.52, 0.34);
export function wingGeometry(): THREE.BufferGeometry {
  const sheet = new THREE.BufferGeometry();
  // A delta wing: nose forward, the trailing edge behind, a little dihedral.
  // (Each half twice, wound both ways: seen from above and below.)
  const up = [0, 0.05, 0.75, -1.15, 0.22, -0.45, 0, 0, -0.25, 0, 0.05, 0.75, 0, 0, -0.25, 1.15, 0.22, -0.45];
  const down: number[] = [];
  for (let k = up.length - 3; k >= 0; k -= 3) down.push(up[k], up[k + 1], up[k + 2]);
  const v = new Float32Array([...up, ...down]);
  sheet.setAttribute('position', new THREE.BufferAttribute(v, 3));
  // (Merged with the kit's boxes: the same attributes, uv included.)
  sheet.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(24), 2));
  sheet.computeVertexNormals();
  const parts: Part[] = [paint(sheet, 0x9fc0dc)];
  const BALSA = 0xd9bf8a;
  parts.push(spar(NOSE, TAIL, 0.022, BALSA));
  for (const s of [-1, 1]) {
    const tip = new THREE.Vector3(s * 1.15, 0.22, -0.45);
    parts.push(spar(NOSE, tip, 0.02, BALSA));
    // The A-frame down to the bar.
    parts.push(spar(new THREE.Vector3(0, 0.02, 0.1), new THREE.Vector3(s * 0.26, BAR.y, BAR.z), 0.014, 0x8a6a40));
  }
  parts.push(spar(new THREE.Vector3(-0.28, BAR.y, BAR.z), new THREE.Vector3(0.28, BAR.y, BAR.z), 0.018, 0x5a4a35));
  return merge(parts, false);
}

/** The gatekeeper (seated behind his hatch, facing +z): shoulders, a head, a guard's cap. */
function keeperGeometry(): THREE.BufferGeometry {
  return merge([box(0.42, 0.34, 0.24, 0x3a5a8c, 0, 0, 0), box(0.26, 0.26, 0.24, 0xe2ad84, 0, 0.34, 0.01), box(0.3, 0.07, 0.3, 0x1f2c44, 0, 0.58, 0.02), box(0.3, 0.02, 0.12, 0x1f2c44, 0, 0.58, 0.17), box(0.05, 0.05, 0.02, 0x161616, -0.06, 0.45, 0.13), box(0.05, 0.05, 0.02, 0x161616, 0.06, 0.45, 0.13)], false);
}

/**
 * Bluff & glider on screen (P24): the checkpoint's booth just outside the gate with its
 * gatekeeper, his relief behind the glass at the shift change, the hatch's lamp (amber at the change, green waved through); the glide's preview
 * (a dotted path off the edge and the ring where it comes down); the flight itself, and the
 * wreck where one came down inside. A handful of meshes, nothing allocated per frame.
 */
export class GetawayView {
  readonly group = new THREE.Group();
  private booth: THREE.Group | null = null;
  private readonly lampMat = new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffe0a0, emissiveIntensity: 0.6 });
  private readonly glassMat = new THREE.MeshStandardMaterial({ color: 0x2a3a4a, roughness: 0.15, metalness: 0.5, emissive: 0xffd9a0, emissiveIntensity: 0.25, transparent: true, opacity: 0.3 });
  private relief: THREE.Mesh | null = null;
  /** The preview: its ring, the dots along the way. */
  private readonly ringMat = new THREE.MeshBasicMaterial({ color: OUT, transparent: true, opacity: 0.85, depthTest: false });
  private readonly ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 32).rotateX(-Math.PI / 2), this.ringMat);
  private readonly dotMat = new THREE.MeshBasicMaterial({ color: OUT, transparent: true, opacity: 0.75, depthTest: false });
  private readonly dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.085, 8, 6), this.dotMat, DOTS);
  /** The glider in flight (and left where it came down inside). */
  private readonly wing = new THREE.Mesh(wingGeometry(), kitMaterial);
  private flight: { fromX: number; fromY: number; fromZ: number; toX: number; toZ: number; t: number; secs: number; angle: number; out: boolean } | null = null;
  private wreck = 0;
  /** The glide is still higher than the walls (the roofs stay drawn till it drops below them). */
  aloft = false;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly onDone: Array<() => void> = [];

  constructor() {
    this.ring.renderOrder = 4;
    this.dots.renderOrder = 4;
    this.ring.visible = false;
    this.dots.visible = false;
    this.wing.visible = false;
    // (Its pitch about its own heading, never a roll: yaw first.)
    this.wing.rotation.order = 'YXZ';
    this.dots.frustumCulled = false;
    this.group.add(this.ring, this.dots, this.wing);
  }

  setWorld(world: World) {
    this.clear();
    if (this.booth) {
      this.group.remove(this.booth);
      this.booth.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      this.booth = null;
      this.relief = null;
    }
    const c = world.def.checkpoint;
    if (!c) return;
    const g = new THREE.Group();
    const keeper = keeperGeometry();
    // A booth: a concrete plinth, white walls to the sill, glass all round, a flat roof overhanging (the guards' navy, a yellow band), the lamp on top, a ledge for papers under the hatch.
    const H = 1.65;
    g.add(
      new THREE.Mesh(
        merge([
          box(0.92, 0.12, 0.92, 0x8a8f96, 0, 0, 0),
          box(0.86, 0.62, 0.86, 0xe9ebee, 0, 0.12, 0),
          box(0.86, 0.12, 0.86, 0xe9ebee, 0, H - 0.12, 0),
          ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.08, H - 0.86, 0.08, 0xd2d6db, sx * 0.39, 0.74, sz * 0.39))),
          // The roof: pale on top (seen from above), a navy fascia, hazard stripes along its edge.
          box(1.06, 0.12, 1.06, 0x2a4a7c, 0, H - 0.04, 0),
          box(1.0, 0.04, 1.0, 0xe4e8ec, 0, H + 0.08, 0),
          ...[-0.42, -0.21, 0, 0.21, 0.42].flatMap((x) => [box(0.1, 0.05, 0.02, 0xffd23f, x, H, 0.535), box(0.1, 0.05, 0.02, 0xffd23f, x, H, -0.535), box(0.02, 0.05, 0.1, 0xffd23f, 0.535, H, x), box(0.02, 0.05, 0.1, 0xffd23f, -0.535, H, x)]),
          box(0.5, 0.04, 0.16, 0x8a939e, 0, 0.74, 0.47),
        ]),
        kitMaterial,
      ),
    );
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.8, H - 0.98, 0.8), this.glassMat);
    glass.position.y = 0.74 + (H - 0.98) / 2;
    g.add(glass);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.18), this.lampMat);
    lamp.position.set(0, H + 0.18, 0);
    g.add(lamp);
    // On duty facing the hatch (part of the booth: never moves); at the shift change his relief stands behind him.
    g.add(new THREE.Mesh(keeper.clone().translate(-0.08, 0.62, 0.08), kitMaterial));
    this.relief = new THREE.Mesh(keeper, kitMaterial);
    this.relief.position.set(0.18, 0.7, -0.22);
    this.relief.visible = false;
    g.add(this.relief);
    // Its hatch faces `face` (1 east, 5 south, 9 west, 13 north): the model's +z turned to it.
    g.rotation.y = faceAngle(c.booth.face);
    g.position.set(c.booth.x + 0.5, 0, c.booth.z + 0.5);
    this.booth = g;
    this.group.add(g);
  }

  /** Off the edge (the 'glide' event): from the roof tile to the ground tile, over `dist` tiles; done() once it's down (at once without motion). */
  glide(from: number, to: number, dist: number, out: boolean, motion: boolean, done?: () => void) {
    const fx = (from % MAP_W) + 0.5;
    const fz = Math.floor(from / MAP_W) + 0.5;
    const tx = (to % MAP_W) + 0.5;
    const tz = Math.floor(to / MAP_W) + 0.5;
    if (done) this.onDone.push(done);
    if (!motion) {
      this.flight = null;
      this.land(tx, tz, Math.atan2(tx - fx, tz - fz), out);
      return;
    }
    this.flight = { fromX: fx, fromY: ROOF_Y, fromZ: fz, toX: tx, toZ: tz, t: 0, secs: glideSecs(dist), angle: Math.atan2(tx - fx, tz - fz), out };
  }

  /** Calls back once the glide in the air is down (at once if none is). */
  whenDown(done: () => void) {
    if (this.flight) this.onDone.push(done);
    else done();
  }

  /** Whether a glide is in the air now. */
  get flying(): boolean {
    return !!this.flight;
  }

  /**
   * Per frame: the booth's lamp and faces, the preview, the flight (the player carried along:
   * `out` gets where to draw them, true while it's in the air), the wreck fading.
   */
  update(f: GetawayFrame, dt: number, time: number, motion: boolean, night: number, out: THREE.Vector3): boolean {
    // The lamp: amber, blinking, while the gate changes shifts; green waved through; a plain light after dark otherwise.
    const blink = motion ? 0.55 + 0.45 * Math.sin(time * 7) : 1;
    this.lampMat.emissive.setHex(f.waved ? 0x3fdc6a : f.shift ? 0xffa524 : 0xffe0a0);
    this.lampMat.color.setHex(f.waved ? 0x7cf0a0 : f.shift ? 0xffc46a : 0xfff2c8);
    this.lampMat.emissiveIntensity = f.waved ? 1.6 : f.shift ? 1.6 * blink : 0.25 + night * 0.9;
    this.glassMat.emissiveIntensity = 0.12 + night * 0.7;
    if (this.relief) this.relief.visible = f.shift && !f.waved;
    // The preview: the ring where it comes down, dots along a gentle fall from the edge.
    const gp = f.glide;
    const show = !!gp && !this.flight;
    this.ring.visible = show;
    this.dots.visible = show;
    if (gp && show) {
      const col = !gp.go ? NO : gp.out ? OUT : IN;
      this.ringMat.color.setHex(col);
      this.dotMat.color.setHex(col);
      const pulse = motion ? 1 + 0.08 * Math.sin(time * 5) : 1;
      this.ring.position.set(gp.toX, 0.05, gp.toZ);
      this.ring.scale.setScalar(pulse);
      for (let k = 0; k < DOTS; k++) {
        const s = (k + 1) / (DOTS + 1);
        this.at(gp.fromX, gp.fromZ, gp.toX, gp.toZ, ROOF_Y, s, this.p);
        this.m.makeTranslation(this.p.x, this.p.y, this.p.z);
        this.dots.setMatrixAt(k, this.m);
      }
      this.dots.instanceMatrix.needsUpdate = true;
    }
    // The flight: along the same fall, the glider over the player's head.
    const fl = this.flight;
    if (fl) {
      fl.t += dt / fl.secs;
      const s = Math.min(1, fl.t);
      this.at(fl.fromX, fl.fromZ, fl.toX, fl.toZ, fl.fromY, s, out);
      this.wing.visible = true;
      // The bar at the pilot's hands (raised forward over the face), the sail over the cap.
      this.wing.position.set(out.x, out.y + HANDS - BAR.y, out.z);
      this.wing.rotation.set(-0.12 + s * 0.2, fl.angle, motion ? Math.sin(time * 3.1) * 0.06 : 0);
      this.aloft = out.y > WALL_ABOVE;
      if (fl.t >= 1) {
        this.flight = null;
        this.aloft = false;
        this.land(fl.toX, fl.toZ, fl.angle, fl.out);
        return false;
      }
      return true;
    }
    if (this.wreck > 0) {
      this.wreck = Math.max(0, this.wreck - dt);
      if (this.wreck === 0) this.wing.visible = false;
    }
    return false;
  }

  /** Down: the glider left lying where it came down inside (out on the road, it goes with the player). */
  private land(x: number, z: number, angle: number, out: boolean) {
    for (const d of this.onDone.splice(0)) d();
    if (out) {
      this.wing.visible = false;
      return;
    }
    // Crumpled where the pilot came down, a little back toward the roof (never out in a fence), flat on the ground.
    this.wing.visible = true;
    this.wing.position.set(x - Math.sin(angle) * 0.25, 0.3, z - Math.cos(angle) * 0.25);
    this.wing.rotation.set(0.35, angle + 0.5, 0.12);
    this.wreck = WRECK_SECS;
  }

  /** A point along a glide's fall at `s` (0–1): out from the edge and down to the ground, easing in. */
  private at(fx: number, fz: number, tx: number, tz: number, y0: number, s: number, out: THREE.Vector3) {
    out.x = fx + (tx - fx) * s;
    out.z = fz + (tz - fz) * s;
    // A short lift off the edge, then a long glide down.
    out.y = Math.max(0, y0 * (1 - s * s) + 0.35 * Math.sin(Math.PI * Math.min(1, s * 1.6)) * (1 - s));
    return out;
  }

  /** A new game or a load: nothing in flight, no wreck, no preview. */
  clear() {
    this.flight = null;
    this.aloft = false;
    this.wreck = 0;
    this.wing.visible = false;
    this.ring.visible = false;
    this.dots.visible = false;
    for (const d of this.onDone.splice(0)) d();
  }
}

/** The model's +z turned to a heading (1–16: 1 east, 5 south, 9 west, 13 north). */
function faceAngle(face: number): number {
  const a = ((face - 1) * Math.PI) / 8;
  // Heading east (+x) at 1, south (+z) at 5.
  return Math.atan2(Math.cos(a), Math.sin(a));
}
