import * as THREE from 'three';
import { MAP_W } from '../sim/world/World';
import { box, kitMaterial, merge, paint, type Part } from './kit';
import { seeThrough } from './occlusion';

/** What smuggling shows this frame (P21), from the sim's own schedule. */
export interface SmuggleFrame {
  /**
   * The drone: seconds from its drop (negative before it), the tile middle it drops on, the
   * edge of the map it comes from (upwind) and goes back to, what it carries, and whether it
   * lets go (not with the sirens on: it turns back); null while it isn't about.
   */
  drone: { t: number; x: number; z: number; fromX: number; fromZ: number; item: number; lets: boolean; dropped: boolean } | null;
  /** What it dropped that still lies there (tile middles): a beacon blinks over each. */
  drops: Array<{ x: number; z: number }>;
  /** Visiting hours (P21): the arches at the visiting room's ways out (tiles, and whether each faces along x). */
  arches: Array<{ tile: number; alongX: boolean }>;
  /** The visitors, sat at the tables: where, the way they face (radians, 0 = +z), a look number, on a chair (a little higher), how far they've come in (0–1); (P39: the parole board's members among them, in their `suit`s.) */
  visitors: Array<{ x: number; z: number; facing: number; look: number; chair: boolean; arrive: number; suit?: number }>;
}

/** Seconds the drone takes to fly in to its drop, and out again. */
export const DRONE_IN = 9;
export const DRONE_OUT = 8;
/** How long the parcel takes to fall (it lands as the sim drops it). */
const FALL = 0.6;
/** How high the drone cruises, and hovers to drop. */
const CRUISE = 7;
const HOVER = 3.4;
const MAX_DROPS = 4;
// (P39: the parole board's three besides.)
const MAX_VISITORS = 9;
const MAX_ARCHES = 12;

const NO_DROPS: SmuggleFrame['drops'] = [];
const NO_ARCHES: SmuggleFrame['arches'] = [];
const NO_VISITORS: SmuggleFrame['visitors'] = [];
/** A visitor on a chair sits this much higher than on a bench (the forearms land on Center Perks' counter top). */
const CHAIR_LIFT = 0.04;
/** One of n, by a look number and what's picked (the same visitor looks the same all morning). */
const pick = (look: number, j: number, n: number) => Math.floor((Math.abs(Math.sin(look * 12.9898 + j * 78.233) * 43758.5453) % 1) * n);

/** Visitors' clothes: everyday colours, nothing orange (inmates) or navy (guards). */
const CLOTHES = [0x3f6fb5, 0x8e3b5c, 0x4f8a5b, 0xc9a227, 0x6b4c9a, 0xd9653b, 0x2f8f8a, 0xb84a62];
const SKINS = [0xf1c6a0, 0xe2ad84, 0xc98d62, 0xa86e48, 0x7d4f33, 0x5b3a26];
const HAIRS = [0x1d1612, 0x3a2a1e, 0x6b4a2b, 0xb08850, 0x8a8a8a, 0xd9d4cc];

/** Its navigation lights, apart from the body (they alone glow and blink): red to port (+x, the nose along +z), green to starboard. */
function lightsGeometry(): THREE.BufferGeometry {
  return merge([box(0.06, 0.05, 0.06, 0xff3b30, 0.34, 0.12, 0.34), box(0.06, 0.05, 0.06, 0x34c759, -0.34, 0.12, 0.34), box(0.05, 0.04, 0.05, 0xffffff, 0, 0.07, -0.2)], false);
}

/** The drone: a dark body, four arms, landing legs; rotors and lights are drawn apart. */
function droneGeometry(): THREE.BufferGeometry {
  const parts: Part[] = [box(0.34, 0.12, 0.34, 0x2b3038, 0, 0, 0), box(0.2, 0.05, 0.2, 0x3d434d, 0, 0.12, 0), box(0.1, 0.05, 0.06, 0x111418, 0, 0.02, 0.19)];
  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    const arm = new THREE.BoxGeometry(0.42, 0.04, 0.05);
    arm.rotateY(sx * sz > 0 ? -Math.PI / 4 : Math.PI / 4);
    arm.translate(sx * 0.2, 0.07, sz * 0.2);
    parts.push(paint(arm, 0x3d434d), box(0.07, 0.07, 0.07, 0x1b1e24, sx * 0.34, 0.05, sz * 0.34), box(0.025, 0.12, 0.025, 0x1b1e24, sx * 0.12, -0.12, sz * 0.12));
  }
  return merge(parts, false);
}

/** A rotor: a pale blurred disc and its hub. */
function rotorGeometry(): THREE.BufferGeometry {
  const disc = new THREE.CylinderGeometry(0.17, 0.17, 0.008, 16);
  return merge([paint(disc, 0xcfd6de), box(0.03, 0.03, 0.03, 0x1b1e24, 0, -0.015, 0)], false);
}

/** The parcel it carries: a small taped box, and its sling. */
function parcelGeometry(): THREE.BufferGeometry {
  return merge([box(0.24, 0.18, 0.24, 0xb88a52, 0, -0.18, 0), box(0.25, 0.03, 0.06, 0xd9c79a, 0, -0.06, 0), box(0.02, 0.24, 0.02, 0x2b3038, 0, -0.02, 0)], false);
}

/** A visitor sat at a table, facing +z, feet on y = 0, in three parts tinted per visitor: clothes, skin, hair. */
function visitorParts(): { clothes: THREE.BufferGeometry; skin: THREE.BufferGeometry; hair: THREE.BufferGeometry } {
  const W = 0xffffff;
  const clothes = merge(
    [
      // Torso and the thighs on the seat, the shins down to the floor (trousers are tinted with it: a tone darker by the vertex colour).
      box(0.52, 0.42, 0.3, W, 0, 0.34, -0.02),
      box(0.53, 0.05, 0.31, 0xd8d8d8, 0, 0.34, -0.02),
      box(0.19, 0.17, 0.36, 0x8a8a8a, -0.11, 0.26, 0.18),
      box(0.19, 0.17, 0.36, 0x8a8a8a, 0.11, 0.26, 0.18),
      box(0.18, 0.28, 0.18, 0x8a8a8a, -0.11, 0.0, 0.32),
      box(0.18, 0.28, 0.18, 0x8a8a8a, 0.11, 0.0, 0.32),
      // Shoes, dark whatever the clothes.
      box(0.2, 0.07, 0.26, 0x2a2a2a, -0.11, 0, 0.36),
      box(0.2, 0.07, 0.26, 0x2a2a2a, 0.11, 0, 0.36),
      // Arms: down from the shoulders, the forearms forward onto the table.
      box(0.15, 0.24, 0.16, W, -0.33, 0.52, 0.02),
      box(0.15, 0.24, 0.16, W, 0.33, 0.52, 0.02),
      box(0.14, 0.13, 0.5, W, -0.31, 0.52, 0.31),
      box(0.14, 0.13, 0.5, W, 0.31, 0.52, 0.31),
    ],
    false,
  );
  const skin = merge(
    [
      box(0.46, 0.44, 0.44, W, 0, 0.76, -0.02),
      box(0.06, 0.07, 0.04, W, 0, 0.94, 0.215),
      box(0.13, 0.08, 0.13, W, -0.29, 0.52, 0.62),
      box(0.13, 0.08, 0.13, W, 0.29, 0.52, 0.62),
      // Eyes and a smile (dark: the tint barely shows).
      box(0.07, 0.07, 0.02, 0x161616, -0.1, 1.0, 0.2),
      box(0.07, 0.07, 0.02, 0x161616, 0.1, 1.0, 0.2),
      box(0.12, 0.025, 0.02, 0x5a2a20, 0, 0.86, 0.2),
    ],
    false,
  );
  const hair = merge([box(0.48, 0.1, 0.47, W, 0, 1.2, -0.025), box(0.48, 0.28, 0.08, W, 0, 0.94, -0.23), box(0.05, 0.16, 0.4, W, -0.235, 1.04, -0.04), box(0.05, 0.16, 0.4, W, 0.235, 1.04, -0.04)], false);
  return { clothes, skin, hair };
}

/** A portable detector arch (for a tile, along x): two posts, the beam, its lamp. */
function archGeometry(): THREE.BufferGeometry {
  return merge([box(0.12, 1.25, 0.24, 0xb4bcc6, -0.44, 0, 0), box(0.12, 1.25, 0.24, 0xb4bcc6, 0.44, 0, 0), box(1, 0.16, 0.26, 0xb4bcc6, 0, 1.22, 0), box(0.34, 0.04, 0.4, 0x6a737e, -0.44, 0, 0), box(0.34, 0.04, 0.4, 0x6a737e, 0.44, 0, 0)], false);
}

/**
 * Smuggling in the picture (P21): the fixer's drone flying in over the yard with a parcel
 * slung under it, letting it fall where the sim drops it and buzzing off again (its lights
 * blink, its rotors spin); a beacon blinking over what it dropped until it's picked up or
 * seized; on visiting day, portable arches at the visiting room's ways out and visitors sat
 * at its tables. A handful of draw calls: the drone (body, four rotors as one instanced
 * mesh, the parcel), the beacons, the arches and their lamps, the visitors (three instanced
 * meshes, tinted per visitor).
 */
export class SmuggleView {
  readonly group = new THREE.Group();
  private readonly drone: THREE.Group;
  private readonly rotors: THREE.InstancedMesh;
  private readonly parcel: THREE.Mesh;
  private readonly beacons: THREE.InstancedMesh;
  private readonly beaconMat: THREE.MeshBasicMaterial;
  private readonly arches: THREE.InstancedMesh;
  private readonly lamps: THREE.InstancedMesh;
  private readonly clothes: THREE.InstancedMesh;
  private readonly skin: THREE.InstancedMesh;
  private readonly hair: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private spin = 0;
  /** The visitors' three meshes. */
  private readonly people: THREE.InstancedMesh[] = [];
  private readonly lightsMat: THREE.MeshBasicMaterial;
  /** The drone's position this frame (null: not about), for its buzz. */
  droneAt: THREE.Vector3 | null = null;
  private readonly at = new THREE.Vector3();

  constructor() {
    this.drone = new THREE.Group();
    const body = new THREE.Mesh(droneGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 }));
    body.castShadow = true;
    this.lightsMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const lights = new THREE.Mesh(lightsGeometry(), this.lightsMat);
    this.rotors = new THREE.InstancedMesh(rotorGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, transparent: true, opacity: 0.55, depthWrite: false }), 4);
    this.parcel = new THREE.Mesh(parcelGeometry(), kitMaterial);
    this.parcel.castShadow = true;
    this.drone.add(body, lights, this.rotors);
    this.drone.visible = false;
    this.parcel.visible = false;
    this.beaconMat = new THREE.MeshBasicMaterial({ color: 0x7dffb0, transparent: true, opacity: 0.9, depthWrite: false });
    const beacon = new THREE.ConeGeometry(0.15, 0.3, 12);
    beacon.rotateX(Math.PI);
    this.beacons = new THREE.InstancedMesh(beacon, this.beaconMat, MAX_DROPS);
    this.beacons.count = 0;
    // (See-through like the fixed arches: never hiding the player behind one.)
    this.arches = new THREE.InstancedMesh(archGeometry(), seeThrough(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6 })), MAX_ARCHES);
    this.arches.castShadow = true;
    this.arches.count = 0;
    // (Their lamps take the prison's arches' material once a world is set: green, dark without power, red on a trip.)
    this.lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.06, 0.1), new THREE.MeshStandardMaterial({ color: 0x3fb950, emissive: 0x2a9a3a, emissiveIntensity: 1.5 }), MAX_ARCHES);
    this.lamps.count = 0;
    const v = visitorParts();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    this.clothes = new THREE.InstancedMesh(v.clothes, mat, MAX_VISITORS);
    this.skin = new THREE.InstancedMesh(v.skin, mat, MAX_VISITORS);
    this.hair = new THREE.InstancedMesh(v.hair, mat, MAX_VISITORS);
    this.people.push(this.clothes, this.skin, this.hair);
    for (const im of [this.clothes, this.skin, this.hair]) {
      im.castShadow = true;
      im.count = 0;
      // (Colours set per instance before the first draw.)
      im.setColorAt(0, this.c.set(0xffffff));
    }
    // (Instances stand anywhere on the map: never culled by the geometry's own bounds at the origin.)
    for (const im of [this.rotors, this.beacons, this.arches, this.lamps, this.clothes, this.skin, this.hair]) im.frustumCulled = false;
    this.group.add(this.drone, this.parcel, this.beacons, this.arches, this.lamps, this.clothes, this.skin, this.hair);
  }

  /**
   * Each frame: the drone on its way (in from the upwind edge, a hover, out again), the parcel
   * falling, the beacons, the arches and the visitors. `floor`: the player is on the ground
   * floor or the roof (beacons and visitors only then; the drone is in the sky either way).
   */
  /** The lamps share the fixed arches' material (WorldView): powered, dark or flashing red as they are. */
  setLampMaterial(m: THREE.Material) {
    this.lamps.material = m;
  }

  update(f: SmuggleFrame | null, dt: number, time: number, motion: boolean, floor: boolean) {
    const d = f?.drone ?? null;
    this.spin += dt * 40;
    this.drone.visible = !!d;
    this.parcel.visible = false;
    this.droneAt = null;
    if (d) this.flyDrone(d, time, motion);
    // Beacons: a soft green blink over each drop (steady with reduced motion).
    const drops = floor && f ? f.drops : NO_DROPS;
    this.beacons.count = Math.min(MAX_DROPS, drops.length);
    for (let k = 0; k < this.beacons.count; k++) {
      const bob = motion ? Math.sin(time * 3 + k) * 0.06 : 0;
      this.m.makeTranslation(drops[k].x, 0.95 + bob, drops[k].z);
      this.beacons.setMatrixAt(k, this.m);
    }
    this.beaconMat.opacity = motion ? 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(time * 5)) : 0.9;
    this.beacons.instanceMatrix.needsUpdate = true;
    // The arches.
    const arches = floor && f ? f.arches : NO_ARCHES;
    this.arches.count = this.lamps.count = Math.min(MAX_ARCHES, arches.length);
    for (let k = 0; k < this.arches.count; k++) {
      const a = arches[k];
      this.e.set(0, a.alongX ? 0 : Math.PI / 2, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v.set((a.tile % MAP_W) + 0.5, 0, Math.floor(a.tile / MAP_W) + 0.5), this.q, this.s.set(1, 1, 1));
      this.arches.setMatrixAt(k, this.m);
      this.m.compose(this.v.set((a.tile % MAP_W) + 0.5, 1.41, Math.floor(a.tile / MAP_W) + 0.5), this.q, this.s.set(1, 1, 1));
      this.lamps.setMatrixAt(k, this.m);
    }
    this.arches.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
    // The visitors, easing in as they arrive.
    const vs = floor && f ? f.visitors : NO_VISITORS;
    const n = Math.min(MAX_VISITORS, vs.length);
    this.clothes.count = this.skin.count = this.hair.count = n;
    for (let k = 0; k < n; k++) {
      const p = vs[k];
      // Arriving: settling down into the seat (at once with reduced motion); a little breath once sat.
      const settle = motion ? (1 - p.arrive) * 0.3 : 0;
      const breathe = motion ? Math.sin(time * 1.6 + k * 1.7) * 0.012 : 0;
      this.e.set(0, p.facing, 0);
      this.q.setFromEuler(this.e);
      // (On a chair a touch higher than on a bench, the forearms then on the counter.)
      this.m.compose(this.v.set(p.x, (p.chair ? CHAIR_LIFT : 0) + breathe + settle, p.z), this.q, this.s.set(1, 1, 1));
      this.clothes.setMatrixAt(k, this.m);
      this.skin.setMatrixAt(k, this.m);
      this.hair.setMatrixAt(k, this.m);
      this.clothes.setColorAt(k, this.c.set(p.suit ?? CLOTHES[pick(p.look, 1, CLOTHES.length)]));
      this.skin.setColorAt(k, this.c.set(SKINS[pick(p.look, 2, SKINS.length)]));
      this.hair.setColorAt(k, this.c.set(HAIRS[pick(p.look, 3, HAIRS.length)]));
    }
    for (const im of this.people) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /** The drone along its flight: in at cruising height, down to hover over the drop, the parcel let go, up and away. */
  private flyDrone(d: NonNullable<SmuggleFrame['drone']>, time: number, motion: boolean) {
    const t = d.t;
    // How far along: 0 at the edge, 1 over the drop (in), then back out.
    const k = t <= 0 ? Math.max(0, 1 + t / DRONE_IN) : Math.max(0, 1 - t / DRONE_OUT);
    const ease = k * k * (3 - 2 * k);
    const x = d.fromX + (d.x - d.fromX) * ease;
    const z = d.fromZ + (d.z - d.fromZ) * ease;
    const y = HOVER + (CRUISE - HOVER) * (1 - ease) + (motion ? Math.sin(time * 2.3) * 0.08 : 0);
    this.drone.position.set(x, y, z);
    // Nose the way it came in, all the way (it backs out again); leaning into its speed, forward coming, back going.
    const yaw = Math.atan2(d.x - d.fromX, d.z - d.fromZ);
    const speed = 6 * k * (1 - k);
    const lean = (t <= 0 ? 1 : -1) * 0.12 * speed;
    this.drone.rotation.set(motion ? lean : 0, yaw, 0, 'YXZ');
    this.drone.scale.setScalar(1.6);
    for (let r = 0; r < 4; r++) {
      const sx = r & 1 ? 1 : -1;
      const sz = r & 2 ? 1 : -1;
      this.e.set(0, motion ? this.spin * (r % 3 === 0 ? 1 : -1) : 0, 0);
      this.q.setFromEuler(this.e);
      this.m.compose(this.v.set(sx * 0.34, 0.11, sz * 0.34), this.q, this.s.set(1, 1, 1));
      this.rotors.setMatrixAt(r, this.m);
    }
    this.rotors.instanceMatrix.needsUpdate = true;
    // Its lights blink (steady with reduced motion).
    this.lightsMat.color.setScalar(motion && Math.sin(time * 6) < -0.3 ? 0.25 : 1);
    // The parcel: slung under it until the drop's last moments, then falling to where it lands.
    // (Turned back, it flies off with the parcel still slung.)
    if (t < 0 || !d.dropped) {
      this.parcel.visible = true;
      const fall = d.lets && t < 0 && t > -FALL ? 1 - -t / FALL : 0;
      const slung = y - 0.15;
      this.parcel.position.set(x, slung - (slung - 0.29) * fall * fall, z);
      this.parcel.rotation.set(0, yaw + fall * 1.5, 0);
      this.parcel.scale.setScalar(1.6);
    }
    this.droneAt = this.at.set(x, y, z);
  }

  /** Off screen (the title): nothing shown. */
  clear() {
    this.drone.visible = false;
    this.parcel.visible = false;
    this.beacons.count = this.arches.count = this.lamps.count = this.clothes.count = this.skin.count = this.hair.count = 0;
    this.droneAt = null;
  }
}
