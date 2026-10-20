import * as THREE from 'three';
import { box, cyl, merge, paint } from './kit';
import { bodyGeometry, tailGeometry } from './Rat';
import { MAP_W } from '../sim/world/World';

/**
 * What long games (P28) show this frame: the garden's beds (tilled soil, darker watered today, a
 * plant by its stage, drooping and brown when wilted, its crop showing when ripe), the rat track in
 * the cell block (chalk lanes and a finish line), the rats down it while a race is run, and the
 * pet's laps on its home track at the player's feet.
 */
export interface LongFrame {
  /** Each bed: its tile, crop (0 none), stages grown, wilted, watered today, ripe, a hole dug through it (the soil gone: the plant grows out of the shaft's mouth). */
  beds: Array<{ tile: number; crop: number; grown: number; wilted: boolean; watered: boolean; ripe: boolean; hole: boolean }>;
  /** The track's tiles from the start (null: none). */
  track: number[] | null;
  /** Rats racing: the lane, how many lanes, how far along (0–1), the player's pet. */
  rats: Array<{ lane: number; of: number; pos: number; pet: boolean }>;
  /** The pet's laps on its track at home: the middle of the floor tile it's set down on (tiles). */
  laps: { x: number; z: number } | null;
  /** The player tipsy (the walk sways). */
  tipsy: boolean;
}

const SOIL = 0x7a5536;
const SOIL_WET = 0x4f3320;
const FURROW = 0x4a3220;
const LEAF = 0x4f9a3a;
const LEAF_DRY = 0xd8c060;
const VEG = 0xe8862e;
const BERRY = 0xd8344a;
const CHALK = 0xece6d6;
/** The lane colours (the race card's: ui/long.ts LANE_COLORS), and the player's pet's (gold). */
const LANES = [0xe0574a, 0x3a8ed8, 0x9a5ad8, 0x5aa846];
const PET = 0xffd34a;
const MAX_BEDS = 12;
const MAX_RACERS = 4;
const UP = new THREE.Vector3(0, 1, 0);

/** A plant: a few leaves round a stem, unit size (scaled by its stage). */
function plantGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [cyl(0.018, 0.22, 0x3f7a2c, 0, 0, 0, 6)];
  for (let k = 0; k < 5; k++) {
    const leaf = new THREE.SphereGeometry(1, 7, 5);
    leaf.scale(0.09, 0.025, 0.045);
    leaf.translate(0.09, 0, 0);
    leaf.rotateZ(0.5);
    leaf.rotateY((k / 5) * Math.PI * 2);
    leaf.translate(0, 0.08 + k * 0.03, 0);
    parts.push(paint(leaf, 0xffffff));
  }
  return merge(parts, false);
}

/** A crop showing on a ripe plant: three round fruit (or a vegetable's tops), unit size. */
function cropGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.SphereGeometry(0.045, 8, 6);
    const a = (k / 3) * Math.PI * 2 + 0.4;
    g.translate(Math.cos(a) * 0.08, 0.1 + (k % 2) * 0.05, Math.sin(a) * 0.08);
    parts.push(paint(g, 0xffffff));
  }
  return merge(parts, false);
}

/** The pet's home track: a little oval run of magazine pages (unit: a tile across). */
function lapTrackGeometry(): THREE.BufferGeometry {
  const ring = new THREE.RingGeometry(0.22, 0.34, 28);
  ring.rotateX(-Math.PI / 2);
  ring.scale(1.4, 1, 1);
  ring.translate(0, 0.012, 0);
  return merge([paint(ring, 0xe0574a), box(0.08, 0.03, 0.02, 0xf2d23c, 0.42, 0, 0)], false);
}

interface Racer {
  root: THREE.Group;
  tail: THREE.Mesh;
  stripe: THREE.Mesh;
}

/** One rat of the race, as instances: its body (and rim), its tail, its lane's stripe. */
const TAIL_AT = new THREE.Vector3(0, 0.05, -0.11);
const STRIPE_AT = new THREE.Vector3(0, 0.135, 0);
const RACER_SCALE = 1.5;

/** A plant's breeze and tilt, for its instance. */
interface Bed {
  x: number;
  z: number;
  scale: number;
  wilted: boolean;
  turn: number;
}

/**
 * The garden's beds and the race's rats as instanced meshes, tinted per instance (a handful of
 * draw calls for twelve beds and four racers, not one per piece); the pet's laps at home are
 * one rat on its own.
 */
export class LongView {
  readonly group = new THREE.Group();
  /** Soil dry and soil watered (glistening: its own roughness), the plants, the crops. */
  private readonly soilDry: THREE.InstancedMesh;
  private readonly soilWet: THREE.InstancedMesh;
  private readonly plants: THREE.InstancedMesh;
  private readonly crops: THREE.InstancedMesh;
  private readonly growing: Bed[] = [];
  private readonly racerBody: THREE.InstancedMesh;
  private readonly racerRim: THREE.InstancedMesh;
  private readonly racerTail: THREE.InstancedMesh;
  private readonly racerStripe: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly part = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();
  private readonly tint = new THREE.Color();
  private readonly track = new THREE.Group();
  private trackTiles: number[] | null = null;
  private readonly lap: THREE.Group;
  private readonly lapRat: Racer;
  private shown = '';

  constructor() {
    const soil = merge([box(0.86, 0.04, 0.86, 0xffffff), ...[-0.25, 0, 0.25].map((x) => box(0.08, 0.05, 0.8, FURROW, x, 0.005, 0))], false);
    const plant = plantGeometry();
    const crop = cropGeometry();
    // (White materials, each instance tinted: the soil's wetness, the leaves' dryness, the crop's kind.)
    // (The tinted ones get their colors from the start: their shader is the same before and after the first tint, compiled once.)
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, tinted = false) => {
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      if (tinted) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3);
      mesh.count = 0;
      // (Placed anew whenever they change, anywhere on the map.)
      mesh.frustumCulled = false;
      this.group.add(mesh);
      return mesh;
    };
    this.soilDry = instanced(soil, new THREE.MeshStandardMaterial({ roughness: 1, vertexColors: true }), MAX_BEDS, true);
    this.soilWet = instanced(soil, new THREE.MeshStandardMaterial({ roughness: 0.35, vertexColors: true }), MAX_BEDS, true);
    this.plants = instanced(plant, new THREE.MeshStandardMaterial({ roughness: 0.8, vertexColors: true }), MAX_BEDS, true);
    this.crops = instanced(crop, new THREE.MeshStandardMaterial({ roughness: 0.5, vertexColors: true }), MAX_BEDS, true);
    this.soilDry.receiveShadow = this.soilWet.receiveShadow = true;
    this.plants.castShadow = this.crops.castShadow = true;
    this.group.add(this.track);
    const body = bodyGeometry();
    const tail = tailGeometry();
    const fur = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const stripe = new THREE.BoxGeometry(0.06, 0.012, 0.16);
    const rim = new THREE.SphereGeometry(1, 10, 8);
    rim.scale(0.082, 0.07, 0.142);
    rim.translate(0, 0.068, -0.005);
    const rimMat = new THREE.MeshBasicMaterial({ color: 0xd9cabd, side: THREE.BackSide });
    const rig = (color: number): Racer => {
      const root = new THREE.Group();
      const b = new THREE.Mesh(body, fur);
      b.castShadow = true;
      const t = new THREE.Mesh(tail, fur);
      t.position.set(0, 0.05, -0.11);
      const s = new THREE.Mesh(stripe, new THREE.MeshBasicMaterial({ color }));
      s.position.set(0, 0.135, 0);
      // (A pale rim round the body, as the floor rats have: a dark rat on a dark floor still reads.)
      root.add(b, t, s, new THREE.Mesh(rim, rimMat));
      root.scale.setScalar(1.5);
      root.visible = false;
      return { root, tail: t, stripe: s };
    };
    this.racerBody = instanced(body, fur, MAX_RACERS);
    this.racerBody.castShadow = true;
    this.racerRim = instanced(rim, rimMat, MAX_RACERS);
    this.racerTail = instanced(tail, fur, MAX_RACERS);
    this.racerStripe = instanced(stripe, new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX_RACERS, true);
    this.lap = new THREE.Group();
    this.lap.add(new THREE.Mesh(lapTrackGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })));
    this.lapRat = rig(LANES[0]);
    this.lapRat.stripe.visible = false;
    this.lap.add(this.lapRat.root);
    this.lap.visible = false;
    this.group.add(this.lap);
  }

  /** The track's chalk lanes and finish line, drawn once per map. */
  private drawTrack(tiles: number[] | null) {
    if (tiles === this.trackTiles) return;
    this.trackTiles = tiles;
    for (const c of [...this.track.children]) {
      this.track.remove(c);
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose();
    }
    if (!tiles || tiles.length < 2) return;
    const [x0, z0] = [tiles[0] % MAP_W, Math.floor(tiles[0] / MAP_W)];
    const [x1, z1] = [tiles[tiles.length - 1] % MAP_W, Math.floor(tiles[tiles.length - 1] / MAP_W)];
    const alongX = z0 === z1;
    const len = tiles.length;
    const parts: THREE.BufferGeometry[] = [];
    // Lane lines (5 across a tile's width), the start and a chequered finish.
    for (let k = 0; k <= 4; k++) {
      const off = -0.4 + k * 0.2;
      parts.push(alongX ? box(len, 0.004, 0.02, CHALK, 0, 0, off) : box(0.02, 0.004, len, CHALK, off, 0, 0));
    }
    parts.push(alongX ? box(0.04, 0.005, 0.82, CHALK, -len / 2 + 0.1, 0, 0) : box(0.82, 0.005, 0.04, CHALK, 0, 0, -len / 2 + 0.1));
    for (let k = 0; k < 8; k++)
      for (let j = 0; j < 2; j++)
        if ((k + j) % 2 === 0) {
          const a = -0.4 + k * 0.1 + 0.05;
          const b = len / 2 - 0.15 + j * 0.1;
          parts.push(alongX ? box(0.1, 0.005, 0.1, 0x222222, b, 0.001, a) : box(0.1, 0.005, 0.1, 0x222222, a, 0.001, b));
        }
    const g = merge(parts, false);
    // (Lit like the floor it's chalked on: dim at night; under the fog's veil and the blob shadows.)
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }));
    m.position.set((x0 + x1) / 2 + 0.5, 0.006, (z0 + z1) / 2 + 0.5);
    // (Running the other way: turned round, the finish at its far end.)
    if (alongX && x1 < x0) m.rotation.y = Math.PI;
    if (!alongX && z1 < z0) m.rotation.y = Math.PI;
    m.renderOrder = 0.2;
    this.track.add(m);
  }

  update(f: LongFrame | null, time: number, motion: boolean, ground: boolean) {
    this.group.visible = !!f && ground;
    if (!f || !ground) return;
    // The beds: redrawn when one changes (never every frame).
    const key = f.beds.map((b) => `${b.tile}:${b.crop}:${b.grown}:${b.wilted}:${b.watered}:${b.ripe}:${b.hole}`).join('|');
    if (key !== this.shown) {
      this.shown = key;
      let dry = 0;
      let wet = 0;
      let crops = 0;
      this.growing.length = 0;
      for (const b of f.beds.slice(0, MAX_BEDS)) {
        const x = (b.tile % MAP_W) + 0.5;
        const z = Math.floor(b.tile / MAP_W) + 0.5;
        // (Watered today: dark and glistening. A hole dug through it: no soil.)
        if (!b.hole) {
          const soil = b.watered ? this.soilWet : this.soilDry;
          const n = b.watered ? wet++ : dry++;
          soil.setMatrixAt(n, this.m.makeTranslation(x, 0, z));
          soil.setColorAt(n, this.tint.setHex(b.watered ? SOIL_WET : SOIL));
        }
        const scale = b.crop ? 0.65 + Math.min(3, b.grown) * 0.3 : 0;
        if (b.crop > 0) {
          this.plants.setColorAt(this.growing.length, this.tint.setHex(b.wilted ? LEAF_DRY : LEAF));
          this.growing.push({ x, z, scale, wilted: b.wilted, turn: (b.tile % 7) * 0.9 });
        }
        if (b.ripe) {
          // (Fruit hangs among the leaves; a vegetable's crop shows as its top at the soil.)
          if (b.crop === 2) this.m.compose(this.v.set(x, 0.04 + scale * 0.12, z), this.q.identity(), this.sc.setScalar(scale));
          else this.m.compose(this.v.set(x, 0.01, z), this.q.identity(), this.sc.set(scale, scale * 0.35, scale));
          this.crops.setMatrixAt(crops, this.m);
          this.crops.setColorAt(crops++, this.tint.setHex(b.crop === 2 ? BERRY : VEG));
        }
      }
      for (const [mesh, n] of [[this.soilDry, dry], [this.soilWet, wet], [this.crops, crops], [this.plants, this.growing.length]] as const) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      this.placePlants(0, false);
    }
    // A breeze through the leaves.
    if (motion && this.growing.length) this.placePlants(time, true);
    this.drawTrack(f.track);
    // The racers down the track, side by side across it.
    const tiles = f.track;
    let n = 0;
    for (let k = 0; k < MAX_RACERS && tiles; k++) {
      const r = f.rats[k];
      if (!r) continue;
      const a = tiles[0];
      const b = tiles[tiles.length - 1];
      const ax = (a % MAP_W) + 0.5;
      const az = Math.floor(a / MAP_W) + 0.5;
      const bx = (b % MAP_W) + 0.5;
      const bz = Math.floor(b / MAP_W) + 0.5;
      const dx = bx - ax;
      const dz = bz - az;
      // (Between the chalk lines, lane 0 first: west to east across a track running north or south, north to south across one running east or west.)
      const across = -0.3 + Math.min(3, r.lane) * 0.2;
      const alongX = Math.abs(dx) > Math.abs(dz);
      const x = ax + dx * r.pos + (alongX ? 0 : across);
      const z = az + dz * r.pos + (alongX ? across : 0);
      const running = r.pos > 0 && r.pos < 1;
      const hop = motion && running ? Math.abs(Math.sin(time * 22 + k)) * 0.02 : 0;
      const wag = motion && running ? Math.sin(time * 18 + k) * 0.5 : 0;
      this.q.setFromAxisAngle(UP, Math.atan2(dx, dz));
      this.m.compose(this.v.set(x, hop, z), this.q, this.sc.setScalar(RACER_SCALE));
      this.racerBody.setMatrixAt(n, this.m);
      this.racerRim.setMatrixAt(n, this.m);
      this.racerStripe.setMatrixAt(n, this.part.makeTranslation(STRIPE_AT).premultiply(this.m));
      this.racerTail.setMatrixAt(n, this.part.makeRotationY(wag).setPosition(TAIL_AT).premultiply(this.m));
      // The pet wears a gold stripe (its lane's colour otherwise).
      this.racerStripe.setColorAt(n, this.tint.setHex(r.pet ? PET : LANES[r.lane % LANES.length]));
      n++;
    }
    for (const mesh of [this.racerBody, this.racerRim, this.racerTail, this.racerStripe]) {
      mesh.count = n;
      if (!n) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    // The pet's laps at home: round the oval, a lap every second and a half.
    const l = f.laps;
    this.lap.visible = !!l;
    if (l) {
      this.lap.position.set(l.x, 0, l.z);
      const a = motion ? time * 4.2 : 0;
      const rx = 0.28 * 1.4;
      const rz = 0.28;
      this.lapRat.root.position.set(Math.cos(a) * rx, 0.012, Math.sin(a) * rz);
      this.lapRat.root.rotation.y = Math.atan2(-Math.sin(a) * rx, Math.cos(a) * rz);
      this.lapRat.root.visible = true;
      this.lapRat.root.scale.setScalar(1.2);
      if (motion) this.lapRat.tail.rotation.y = Math.sin(time * 18) * 0.5;
    }
  }

  /** The plants' instances: grown to their stage, drooping when wilted, swaying in a breeze (`sway`). */
  private placePlants(time: number, sway: boolean) {
    this.growing.forEach((b, k) => {
      this.e.set(b.wilted ? 0.35 : 0, b.turn, sway ? Math.sin(time * 1.3 + k) * 0.05 : 0);
      this.m.compose(this.v.set(b.x, 0.04, b.z), this.q.setFromEuler(this.e), this.sc.set(b.scale, b.wilted ? b.scale * 0.7 : b.scale, b.scale));
      this.plants.setMatrixAt(k, this.m);
    });
    this.plants.instanceMatrix.needsUpdate = true;
  }
}
