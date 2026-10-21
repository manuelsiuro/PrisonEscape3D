import * as THREE from 'three';
import type { CommsDef } from '../content/prisons/types';
import { DIR_X, DIR_Z } from '../sim/command';
import { commsOf } from '../sim/systems/phone';
import { MAP_H, MAP_W, type World } from '../sim/world/World';
import { TILE } from '../sim/world/tiles';
import { now, type Later } from './batch';
import { box, cyl, kitMaterial, merge, paint, rod, type Part } from './kit';
import { glowTexture } from './lights';
import { seeThrough } from './occlusion';

/** What the pay phone (P34) shows this frame. */
export interface PhoneFrame {
  /** Someone on the phone (an inmate's call begun, or the player's): the handset is off its hook. */
  offHook: boolean;
  /** Lou's getaway car waits on the road tonight. */
  car: boolean;
}

/** A face (1 east, 5 south, 9 west, 13 north) as the turn that points +z that way. */
const faceAngle = (face: number) => Math.atan2(DIR_X[face] ?? 0, DIR_Z[face] ?? 1);

/** The diversion's beacon flashes this many game minutes (200 steps), held through a pause (it counts the clock, not the screen's seconds). */
const ALARM_MINUTES = 10;
/** Lou's car pulling away (the 'wheels' event): seconds on screen, the last of them fading; how hard it pulls away (tiles/s²). */
const AWAY_SECS = 2.6;
const AWAY_FADE = 1.1;
const AWAY_PULL = 3.6;
/** The car's nose ahead of its middle (tiles). */
const CAR_NOSE = 1.4;
/** The beacon stands this far off its tile's middle, toward the gate and its post. */
const BEACON_OFF = 0.36;

const STEEL = 0xa9b2bc;
const STEEL_DARK = 0x6b737c;
const BLACK = 0x1a1c20;
const CHROME = 0xc9d0d8;

/**
 * The pay phone on its wall, in its own terms: the wall's face at z = 0, the room toward +z,
 * the floor at y = 0. A brushed-steel hood (two sides and a top, the phone company's blue band
 * along its front), a grey coin box with its keypad, coin slot and coin return; the hook on the
 * box's right (+x, the side of the caller's raised hand), a black handset on it, its coiled
 * cord looping down from the box.
 */
function phoneParts(): { body: Part[]; handset: Part[]; out: Part[] } {
  const body: Part[] = [
    // The back plate and the hood.
    box(0.58, 0.66, 0.02, STEEL_DARK, 0, 0.7, 0.01),
    box(0.03, 0.66, 0.26, STEEL, -0.285, 0.7, 0.13),
    box(0.03, 0.66, 0.26, STEEL, 0.285, 0.7, 0.13),
    box(0.6, 0.035, 0.28, STEEL, 0, 1.36, 0.14),
    box(0.6, 0.08, 0.02, 0x2f6fd1, 0, 1.29, 0.275),
    box(0.34, 0.025, 0.022, 0xf4f6ff, 0, 1.317, 0.276),
    // The coin box, its keypad (four rows of three), the slot and the return.
    box(0.25, 0.4, 0.12, 0x7a828c, 0, 0.8, 0.08),
    box(0.14, 0.17, 0.012, 0x40464e, -0.02, 0.88, 0.145),
    ...[0, 1, 2, 3].flatMap((r) => [-1, 0, 1].map((c) => box(0.032, 0.026, 0.014, 0xe4e8ec, -0.02 + c * 0.042, 0.895 + r * 0.038, 0.149))),
    box(0.06, 0.016, 0.012, BLACK, 0.06, 1.1, 0.145),
    box(0.07, 0.05, 0.012, BLACK, -0.02, 0.83, 0.145),
    // The hook: a chrome cradle high on the right of the box (seen over a caller's head).
    box(0.1, 0.05, 0.05, CHROME, 0.175, 1.0, 0.08),
    box(0.04, 0.22, 0.05, CHROME, 0.225, 1.0, 0.1),
    box(0.08, 0.02, 0.08, CHROME, 0.225, 1.2, 0.12),
    box(0.012, 0.035, 0.012, CHROME, 0.225, 1.22, 0.155),
  ];
  // On the hook: the handset upright beside the box, its ear cup up, the coiled cord looping down from the box's foot to the handset's.
  const handset: Part[] = [
    box(0.05, 0.24, 0.05, BLACK, 0.23, 0.96, 0.145),
    box(0.07, 0.06, 0.075, BLACK, 0.23, 1.16, 0.15),
    box(0.07, 0.06, 0.075, BLACK, 0.23, 0.94, 0.15),
  ];
  const coil = new THREE.CatmullRomCurve3([new THREE.Vector3(0.12, 0.84, 0.1), new THREE.Vector3(0.16, 0.72, 0.13), new THREE.Vector3(0.21, 0.72, 0.15), new THREE.Vector3(0.23, 0.94, 0.145)]);
  handset.push(paint(new THREE.TubeGeometry(coil, 14, 0.014, 5, false), BLACK));
  // Off the hook: only the cord, stretched out of the box, sagging, up into the caller's raised fist
  // (Character: drawn PHONE_SHIFT to their right, the fist over the ear at PHONE_ARM).
  const stub = new THREE.CatmullRomCurve3([new THREE.Vector3(0.12, 0.84, 0.1), new THREE.Vector3(0.2, 0.72, 0.17), new THREE.Vector3(0.23, 0.86, 0.27), new THREE.Vector3(0.165, 1.08, 0.33)]);
  return { body, handset, out: [paint(new THREE.TubeGeometry(stub, 14, 0.016, 5, false), BLACK)] };
}

/**
 * Lou's car (nose toward +z, centered, wheels on y = 0): a two-tone sedan, cherry red with a cream
 * roof (it reads at night too), a chrome bumper at each end, glass all round the cabin (seen from
 * above: the roof between the windscreen sloping up from the hood and the rear window sloping
 * down to the trunk), and its glass and lamps as their own parts (the cabin glows faintly after
 * dark; the lamps glow).
 */
function carParts(): { body: Part[]; glass: Part[]; lamps: Part[] } {
  const PAINT = 0xa63746;
  const HOOD = 0xb03e4d;
  const ROOF = 0xe6dcc6;
  const GLASS = 0x1c2a38;
  // A slab tilted about x (a windscreen), its middle at (y, z): a positive tilt drops its +z end.
  const slab = (w: number, h: number, d: number, color: number, y: number, z: number, tilt: number) => paint(new THREE.BoxGeometry(w, h, d).rotateX(tilt).translate(0, y, z), color);
  const W = 1.24;
  const body: Part[] = [
    box(W, 0.34, 2.8, PAINT, 0, 0.16, 0),
    box(W - 0.04, 0.05, 0.86, HOOD, 0, 0.5, 0.94),
    box(W - 0.04, 0.05, 0.5, HOOD, 0, 0.5, -1.13),
    // The cabin: pillars between the glass, the roof over it.
    box(W - 0.12, 0.3, 0.07, PAINT, 0, 0.5, -0.2),
    box(W - 0.14, 0.06, 0.96, ROOF, 0, 0.8, -0.22),
    // A pinstripe down each side, the grille, the bumpers, the door handles.
    box(0.01, 0.03, 2.6, CHROME, W / 2 + 0.002, 0.42, 0),
    box(0.01, 0.03, 2.6, CHROME, -W / 2 - 0.002, 0.42, 0),
    box(0.62, 0.13, 0.02, 0x0d1015, 0, 0.27, 1.405),
    box(W + 0.04, 0.1, 0.08, CHROME, 0, 0.13, 1.42),
    box(W + 0.04, 0.1, 0.08, CHROME, 0, 0.13, -1.42),
    ...[-1, 1].flatMap((s) => [box(0.012, 0.025, 0.1, CHROME, s * (W / 2 + 0.004), 0.38, 0.1), box(0.012, 0.025, 0.1, CHROME, s * (W / 2 + 0.004), 0.38, -0.5)]),
    // The wheels, half under the body.
    ...[0.92, -0.92].flatMap((z) => [-1, 1].flatMap((s) => [rod(0.22, 0.18, 0x15171b, s * (W / 2 - 0.08), 0.22, z, 12), rod(0.12, 0.19, 0x9aa1ab, s * (W / 2 - 0.08), 0.22, z, 10)])),
  ];
  // The glass: the side windows under the roof, the windscreen from the hood (z 0.6) up to the roof's
  // front (z 0.26), the rear window from the roof's back (z -0.7) down to the trunk.
  const glass: Part[] = [
    box(W - 0.16, 0.3, 0.96, GLASS, 0, 0.5, -0.22),
    slab(W - 0.18, 0.04, 0.46, GLASS, 0.69, 0.43, 0.72),
    slab(W - 0.18, 0.04, 0.44, GLASS, 0.695, -0.86, -0.74),
  ];
  const lamps: Part[] = [
    ...[-1, 1].map((s) => box(0.22, 0.09, 0.03, 0xfff2c4, s * (W / 2 - 0.17), 0.33, 1.41)),
    ...[-1, 1].map((s) => box(0.24, 0.08, 0.03, 0xff3a2a, s * (W / 2 - 0.17), 0.36, -1.41)),
  ];
  return { body, glass, lamps };
}

/**
 * The pay phone (P34) in the picture: the phone on its corridor wall (its handset off the hook
 * while someone's on it: the caller holds it, Character), Lou's getaway car on the road on its
 * night (headlights on after dark; pulling away along its facing when the player gets in), and
 * the diversion's amber beacon flashing at the front gate for ten game minutes. Built once per
 * map from `def.comms` (none at the Training Block: nothing).
 */
export class PhoneView {
  readonly group = new THREE.Group();
  private comms: CommsDef | null = null;
  private world: World | null = null;
  private phone: THREE.Group | null = null;
  /**
   * The phone: its own see-through kit material, cut only by a player north of the wall it hangs
   * on (no z margin): one standing at it, just south of it, never dithers it away.
   */
  private readonly phoneMat = seeThrough(kitMaterial.clone(), 0.6, -0.05);
  private handset: THREE.Mesh | null = null;
  private cord: THREE.Mesh | null = null;
  /** The car: the body (fades as it goes), its lamps, a pool of light ahead of it after dark. */
  private readonly car = new THREE.Group();
  /** (Transparent, and casting no shadow, only while it fades.) */
  private readonly carMat = kitMaterial.clone();
  private readonly glassMat = Object.assign(kitMaterial.clone(), { emissive: new THREE.Color(0x000000) });
  private readonly carBody: THREE.Mesh;
  private readonly carGlass: THREE.Mesh;
  /** How far the car may pull away before its nose leaves the road (tiles), and so how hard it pulls. */
  private carPull = AWAY_PULL;
  private readonly lampMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true });
  private readonly beamMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xfff0c8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  private carAt = { x: 0, z: 0, angle: 0 };
  /** Pulling away (seconds since; -1 not), and gone until the night's car is over. */
  private leaving = -1;
  private gone = false;
  /** The beacon: a post, its amber dome, a flashing pool around it. */
  private readonly beacon = new THREE.Group();
  private readonly domeMat = new THREE.MeshBasicMaterial({ color: 0xffa524, toneMapped: false });
  private readonly glareMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffa524, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
  private readonly poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff9a1f, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  private readonly sweep: THREE.Mesh;
  /** Game minutes the beacon still flashes (0: dark), and the clock at the last frame. */
  private alarmLeft = 0;
  private lastMinute = -1;

  constructor() {
    // The car: built once (every prison's is the same), placed per map.
    const cp = carParts();
    const body = (this.carBody = new THREE.Mesh(merge(cp.body), this.carMat));
    body.castShadow = true;
    body.receiveShadow = true;
    const glass = (this.carGlass = new THREE.Mesh(merge(cp.glass), this.glassMat));
    glass.castShadow = true;
    const lamps = new THREE.Mesh(merge(cp.lamps, false), this.lampMat);
    // (A long pool ahead of the nose, on the road.)
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 3.2).rotateX(-Math.PI / 2).translate(0, 0.012, 2.9), this.beamMat);
    beam.renderOrder = 0.33;
    this.car.add(body, glass, lamps, beam);
    this.car.visible = false;
    // The beacon: a grey post on a foot, the amber dome on top, a glare round the dome (seen over the walls), the light washing the ground.
    const post = new THREE.Mesh(merge([cyl(0.16, 0.05, 0x3b3f46, 0, 0, 0, 10), cyl(0.035, 1.5, 0x8a929c, 0, 0.05, 0, 8), cyl(0.13, 0.06, 0x2b2e34, 0, 1.55, 0, 12)]), kitMaterial);
    post.castShadow = true;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.61, 0), this.domeMat);
    const glare = new THREE.Sprite(this.glareMat);
    glare.scale.setScalar(2.4);
    glare.position.y = 1.66;
    glare.renderOrder = 6;
    // (The pool, and a beam that sweeps round with the lamp's mirror.)
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2).translate(0, 0.014, 0), this.poolMat);
    pool.renderOrder = 0.34;
    this.sweep = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 3.4).rotateX(-Math.PI / 2).translate(0, 0.016, 1.8), this.poolMat);
    this.sweep.renderOrder = 0.34;
    this.beacon.add(post, dome, glare, pool, this.sweep);
    this.beacon.visible = false;
    this.group.add(this.car, this.beacon);
  }

  /** A prison: its phone, where Lou's car waits (none without comms). */
  setWorld(world: World, later: Later = now) {
    this.world = world;
    const old = this.phone;
    if (old) {
      this.group.remove(old);
      later(() => old.traverse((m) => (m as THREE.Mesh).geometry?.dispose()));
    }
    this.phone = null;
    this.handset = null;
    this.cord = null;
    this.leaving = -1;
    this.gone = false;
    this.alarmLeft = 0;
    this.beacon.visible = false;
    this.car.visible = false;
    const c = (this.comms = commsOf({ world }));
    if (!c) return;
    const parts = phoneParts();
    const g = new THREE.Group();
    const body = new THREE.Mesh(merge(parts.body), this.phoneMat);
    body.castShadow = true;
    this.handset = new THREE.Mesh(merge(parts.handset, false), this.phoneMat);
    this.handset.castShadow = true;
    this.cord = new THREE.Mesh(merge(parts.out, false), this.phoneMat);
    this.cord.visible = false;
    g.add(body, this.handset, this.cord);
    // On the wall the caller faces: half a tile from their tile's middle that way, its front turned back to them.
    const a = faceAngle(c.phone.face);
    g.position.set(c.phone.x + 0.5 + Math.sin(a) * 0.5, 0, c.phone.z + 0.5 + Math.cos(a) * 0.5);
    g.rotation.y = a + Math.PI;
    this.phone = g;
    this.group.add(g);
    this.carAt = { x: c.car.x + 0.5, z: c.car.z + 0.5, angle: faceAngle(c.car.face) };
    // Pulling away: never off the road's end (Irongate's ferry landing is only a few tiles of it): no
    // harder than brings the nose (CAR_NOSE ahead of the middle) to the last road tile's edge as it fades out.
    const dx = Math.sign(DIR_X[c.car.face] ?? 0);
    const dz = Math.sign(DIR_Z[c.car.face] ?? 0);
    const base = world.ground.base;
    let road = 0;
    for (let x = c.car.x + dx, z = c.car.z + dz; road < 16 && x >= 0 && x < MAP_W && z >= 0 && z < MAP_H && base[z * MAP_W + x] === TILE.ROAD; x += dx, z += dz) road++;
    const room = Math.max(0.3, road + 0.5 - CAR_NOSE);
    this.carPull = Math.min(AWAY_PULL, (2 * room) / (AWAY_SECS * AWAY_SECS));
  }

  /** Lou's car pulls away with the player in it (the 'wheels' event): along its facing, fading out (just fades without motion). */
  carAway() {
    if (!this.comms || this.leaving >= 0) return;
    this.leaving = 0;
  }

  /** The diversion goes off (or is ignored) at a tile: the amber beacon flashes there for ten game minutes. */
  alarm(tile: number) {
    // Not in the gateway: against its post, in the tile's corner by the gate (the gate the next tile
    // over; its post the side where the gate doesn't go on).
    const tx = tile % MAP_W;
    const tz = Math.floor(tile / MAP_W);
    let ox = 0;
    let oz = 0;
    const door = (x: number, z: number) => !!this.world && x >= 0 && x < MAP_W && z >= 0 && z < MAP_H && this.world.ground.base[z * MAP_W + x] === TILE.DOOR;
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      if (!door(tx + dx, tz + dz)) continue;
      // (The two ways along the gate: toward the one where it stops, west or north first.)
      const side = [-1, 1].find((k) => !door(tx + dx + k * dz, tz + dz + k * dx)) ?? 0;
      ox = (dx + side * dz) * BEACON_OFF;
      oz = (dz + side * dx) * BEACON_OFF;
      break;
    }
    this.beacon.position.set(tx + 0.5 + ox, 0, tz + 0.5 + oz);
    this.alarmLeft = ALARM_MINUTES;
    this.lastMinute = -1;
  }

  /**
   * Per frame: the handset on its hook or off it, the car (waiting, pulling away), the beacon.
   * `minute` is the game clock (minutes of the day, fractional): the beacon's ten minutes run on
   * it, so a pause holds them. `shown`: on a floor that sees them (not the tunnels).
   */
  update(f: PhoneFrame | null, dt: number, minute: number, time: number, motion: boolean, night: number, shown: boolean) {
    this.group.visible = shown;
    if (this.handset && this.cord) {
      const off = !!f?.offHook;
      this.handset.visible = !off;
      this.cord.visible = off;
    }
    // The car: there while it waits; once it has pulled away, gone until the night's wait is over.
    if (!f?.car && this.leaving < 0) this.gone = false;
    const away = this.leaving >= 0;
    if (away) this.leaving += dt;
    if (away && this.leaving >= (motion ? AWAY_SECS : AWAY_FADE)) {
      this.leaving = -1;
      this.gone = true;
    }
    const car = !!this.comms && ((!!f?.car && !this.gone) || this.leaving >= 0);
    this.car.visible = car;
    if (car) {
      const t = Math.max(0, this.leaving);
      const s = motion ? 0.5 * this.carPull * t * t : 0;
      const { x, z, angle } = this.carAt;
      this.car.position.set(x + Math.sin(angle) * s, 0, z + Math.cos(angle) * s);
      this.car.rotation.y = angle;
      const fade = this.leaving < 0 ? 1 : Math.max(0, Math.min(1, ((motion ? AWAY_SECS : AWAY_FADE) - t) / AWAY_FADE));
      // (Solid and shadowed while it waits; see-through, its shadow gone, only as it fades.)
      const fading = fade < 0.999;
      for (const m of [this.carMat, this.glassMat]) {
        if (m.transparent !== fading) {
          m.transparent = fading;
          m.needsUpdate = true;
        }
        m.opacity = fade;
        m.depthWrite = !fading;
      }
      this.carBody.castShadow = this.carGlass.castShadow = !fading;
      this.lampMat.opacity = fade;
      // The lamps: dim by day, glowing after dark (and its lights on as it goes); the pool ahead on the road.
      const lit = Math.max(night, this.leaving >= 0 ? 0.6 : 0);
      this.lampMat.color.setScalar(0.45 + lit * 0.9);
      this.beamMat.opacity = lit * 0.55 * fade;
      // (A faint glow in the cabin after dark: the dash, Lou's cigarette.)
      this.glassMat.emissive.setRGB(0.045, 0.04, 0.03).multiplyScalar(night);
    }
    // The beacon: ten game minutes on the clock (a big jump, a night slept through, ends it).
    if (this.alarmLeft > 0) {
      if (this.lastMinute >= 0) {
        const d = (((minute - this.lastMinute) % 1440) + 1440) % 1440;
        this.alarmLeft = d > 30 ? 0 : this.alarmLeft - d;
      }
      this.lastMinute = minute;
    }
    const on = this.alarmLeft > 0;
    this.beacon.visible = on;
    if (on) {
      // Flashing twice a second, its beam sweeping round; steady and still with reduced motion.
      const flash = motion ? Math.max(0, Math.sin(time * 12.5)) ** 0.6 : 0.8;
      // (Capped short of white-hot: it stays amber at its peak.)
      this.domeMat.color.setHex(0xffa524).multiplyScalar(0.45 + flash * 0.6);
      this.glareMat.opacity = 0.35 + flash * 0.65;
      this.poolMat.opacity = (0.2 + flash * 0.5) * (0.7 + 0.3 * night);
      this.sweep.visible = motion;
      this.sweep.rotation.y = time * 5;
    }
  }
}
