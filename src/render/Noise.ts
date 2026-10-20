import * as THREE from 'three';
import type { NoiseKind } from '../sim/state';
import { itemDef } from '../content/items';
import { MAP_W } from '../sim/world/World';
import { itemGeometry } from './itemModels';
import { kitMaterial } from './kit';

/** Tiles the earshot preview and a noise's flash can light at most. */
const TILES = 400;
/** Waves (expanding rings) and items in flight at once. */
const WAVES = 4;
const FLIGHTS = 3;
/** Dots along the arc. */
const DOTS = 18;

/** How long something thrown is in the air (seconds), by how far it goes (tiles). */
export const tossFlight = (tiles: number) => 0.24 + tiles * 0.045;

/** What the aim shows (tiles): from the hand to the landing tile's middle, whether it can go, how far it can, where its thud would carry. */
export interface AimView {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  valid: boolean;
  range: number;
  tiles: readonly number[];
}

type Kind = NoiseKind;
const WAVE_COLOR: Record<Kind, number> = { strike: 0xffd27a, thud: 0xffb347, bang: 0xff7a2e, ring: 0xffe08a, bark: 0xffc04a, squeak: 0xf2c2d8, buzz: 0xa8e6ff, stumble: 0xd9c27a, cheer: 0xffe08a };
const AMBER = 0xffb347;
const RED = 0xff4a3a;

const flat = (g: THREE.BufferGeometry) => g.rotateX(-Math.PI / 2);

/**
 * Noise and throwing on screen (P14): the aim (the reach around the player, the arc, the
 * landing ring, the tiles its thud would reach), the waves a noise sends out (the tiles it
 * reached lit for a moment), things in flight, and lit firecrackers fizzing on the floor.
 * A handful of pooled meshes and three instanced ones (the arc's dots, the preview, the flash);
 * nothing allocated per frame.
 */
export class NoiseFx {
  readonly group = new THREE.Group();
  private readonly reach: THREE.Mesh;
  private readonly arc: THREE.InstancedMesh;
  private readonly land: THREE.Mesh;
  private readonly preview: THREE.InstancedMesh;
  private readonly flash: THREE.InstancedMesh;
  private flashT = 1;
  private readonly waves: Array<{ mesh: THREE.Mesh; t: number; delay: number; dur: number; size: number }> = [];
  private nextWave = 0;
  private readonly flights: Array<{ mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; height: number; spin: number }> = [];
  private nextFlight = 0;
  private readonly fuses: THREE.Mesh[] = [];
  private readonly m4 = new THREE.Matrix4();
  private aimOn = 0;
  private aimView: AimView | null = null;
  private previewKey = '';
  /** The tile a flight lands on while it's in the air (the item lying there waits for it), -1 none. */
  landing = -1;

  constructor() {
    const ui = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
    this.reach = new THREE.Mesh(flat(new THREE.RingGeometry(0.965, 1, 72)), ui(0xffffff, 0.3));
    this.reach.renderOrder = 4;
    // The arc: a string of dots from the hand to the landing ring, drifting towards it.
    this.arc = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 8, 6), ui(AMBER, 0.95), DOTS);
    this.arc.frustumCulled = false;
    this.arc.renderOrder = 6;
    this.arc.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The landing ring: a band and a dot in one.
    const band = flat(new THREE.RingGeometry(0.3, 0.42, 32));
    const dot = flat(new THREE.CircleGeometry(0.09, 16));
    const ring = new THREE.BufferGeometry();
    const pos = [...band.getAttribute('position').array, ...dot.getAttribute('position').array];
    const index = [...band.getIndex()!.array, ...Array.from(dot.getIndex()!.array, (i) => i + band.getAttribute('position').count)];
    ring.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    ring.setIndex(index);
    this.land = new THREE.Mesh(ring, ui(AMBER, 0.95));
    this.land.renderOrder = 6;
    const quad = flat(new THREE.PlaneGeometry(0.9, 0.9));
    this.preview = new THREE.InstancedMesh(quad, ui(AMBER, 0.2), TILES);
    this.flash = new THREE.InstancedMesh(quad, ui(AMBER, 0), TILES);
    for (const m of [this.preview, this.flash]) {
      m.count = 0;
      m.frustumCulled = false;
      m.renderOrder = 3;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    for (let k = 0; k < WAVES; k++) {
      const mesh = new THREE.Mesh(flat(new THREE.RingGeometry(0.9, 1, 48)), ui(AMBER, 0));
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.waves.push({ mesh, t: 1, delay: 0, dur: 0.6, size: 1 });
      this.group.add(mesh);
    }
    for (let k = 0; k < FLIGHTS; k++) {
      const mesh = new THREE.Mesh(undefined, kitMaterial);
      mesh.visible = false;
      mesh.castShadow = true;
      mesh.scale.setScalar(1.35);
      this.flights.push({ mesh, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 0.4, height: 1, spin: 0 });
      this.group.add(mesh);
    }
    this.reach.visible = this.arc.visible = this.land.visible = false;
    this.group.add(this.reach, this.arc, this.land, this.preview, this.flash);
  }

  /** The aim to show (null: none). Called each frame while aiming; it eases in and out. */
  setAim(a: AimView | null) {
    this.aimView = a;
  }

  /**
   * A noise made at a tile (tiles reached, for the flash): a wave out from it, as far as it
   * carries; amber, or the guards' orange when someone heard it. Starting after `delay`
   * seconds (a thrown thing lands first).
   */
  noise(kind: Kind, tile: number, reach: number, tiles: readonly number[], heard: boolean, delay = 0, motion = true) {
    const w = this.waves[this.nextWave];
    this.nextWave = (this.nextWave + 1) % WAVES;
    w.mesh.position.set((tile % MAP_W) + 0.5, 0.04, Math.floor(tile / MAP_W) + 0.5);
    w.t = 0;
    w.delay = delay;
    w.dur = kind === 'bang' ? 0.9 : kind === 'strike' ? 0.45 : 0.65;
    w.size = Math.max(1, reach);
    (w.mesh.material as THREE.MeshBasicMaterial).color.setHex(heard ? 0xff7a2e : WAVE_COLOR[kind]);
    if (!motion) w.mesh.scale.setScalar(w.size);
    // A strike's flash would flicker at every blow: the wave says enough. The rest light what they reached.
    if (kind === 'strike') return;
    this.fill(this.flash, tiles);
    this.flashT = -delay / 0.7;
  }

  /** Something thrown: from the hand (tiles, height) over to a tile, spinning; the tile's item waits until it lands. */
  toss(item: number, fromX: number, fromY: number, fromZ: number, to: number) {
    const f = this.flights[this.nextFlight];
    this.nextFlight = (this.nextFlight + 1) % FLIGHTS;
    f.mesh.geometry = itemGeometry(itemDef(item));
    f.from.set(fromX, fromY, fromZ);
    f.to.set((to % MAP_W) + 0.5, 0.02, Math.floor(to / MAP_W) + 0.5);
    const d = Math.hypot(f.to.x - fromX, f.to.z - fromZ);
    f.dur = tossFlight(d);
    f.height = 0.5 + d * 0.22;
    f.spin = 7 + d;
    f.t = 0;
    f.mesh.visible = true;
    f.mesh.position.copy(f.from);
    this.landing = to;
  }

  private fill(mesh: THREE.InstancedMesh, tiles: readonly number[]) {
    const n = Math.min(tiles.length, TILES);
    for (let k = 0; k < n; k++) {
      const t = tiles[k];
      this.m4.makeTranslation((t % MAP_W) + 0.5, 0.025, Math.floor(t / MAP_W) + 0.5);
      mesh.setMatrixAt(k, this.m4);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Each frame: the aim eased in or out, waves spreading and fading, things in flight, lit
   * fuses (their tiles) lying fizzing. `sparks(x, y, z)` throws a spark off a fuse.
   */
  update(dt: number, time: number, fuses: readonly number[], fuseItem: number, motion: boolean, sparks: (x: number, y: number, z: number) => void) {
    const a = this.aimView;
    this.aimOn += ((a ? 1 : 0) - this.aimOn) * Math.min(1, dt * (a ? 14 : 10));
    const on = this.aimOn > 0.02;
    this.reach.visible = this.arc.visible = this.land.visible = on && !!a;
    this.preview.visible = on && !!a && a.valid;
    if (a && on) {
      const color = a.valid ? AMBER : RED;
      this.reach.position.set(a.fromX, 0.03, a.fromZ);
      this.reach.scale.setScalar(a.range + 0.5);
      (this.reach.material as THREE.MeshBasicMaterial).opacity = 0.28 * this.aimOn;
      const lm = this.land.material as THREE.MeshBasicMaterial;
      lm.color.setHex(color);
      lm.opacity = 0.95 * this.aimOn;
      this.land.position.set(a.toX, 0.045, a.toZ);
      this.land.scale.setScalar(motion && a.valid ? 1 + Math.sin(time * 7) * 0.07 : 1);
      // The arc: up from the hand and down onto the ring, its dots drifting towards it.
      const d = Math.hypot(a.toX - a.fromX, a.toZ - a.fromZ);
      const h = 0.5 + d * 0.22;
      const drift = motion ? (time * 1.2) % 1 : 0.5;
      for (let k = 0; k < DOTS; k++) {
        const t = (k + drift) / DOTS;
        const s = 1 - t * 0.35;
        this.m4.makeScale(s, s, s).setPosition(a.fromX + (a.toX - a.fromX) * t, 1.1 * (1 - t) + 0.05 * t + Math.sin(t * Math.PI) * h, a.fromZ + (a.toZ - a.fromZ) * t);
        this.arc.setMatrixAt(k, this.m4);
      }
      this.arc.instanceMatrix.needsUpdate = true;
      const am = this.arc.material as THREE.MeshBasicMaterial;
      am.color.setHex(color);
      am.opacity = (a.valid ? 0.95 : 0.6) * this.aimOn;
      const key = a.tiles.length ? `${a.tiles[0]}|${a.tiles.length}|${a.tiles[a.tiles.length - 1]}` : '';
      if (key !== this.previewKey) {
        this.previewKey = key;
        this.fill(this.preview, a.tiles);
      }
    }
    // Waves: out to the noise's reach, fading as they go.
    for (const w of this.waves) {
      if (w.t >= 1) continue;
      if (w.delay > 0) {
        w.delay -= dt;
        w.mesh.visible = false;
        continue;
      }
      w.t = Math.min(1, w.t + dt / w.dur);
      w.mesh.visible = w.t < 1;
      const e = 1 - (1 - w.t) * (1 - w.t);
      if (motion) w.mesh.scale.setScalar(0.4 + e * w.size);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - w.t);
    }
    // The tiles a noise reached: lit, then fading.
    if (this.flashT < 1) {
      this.flashT = Math.min(1, this.flashT + dt / 0.7);
      const t = Math.max(0, this.flashT);
      this.flash.visible = this.flashT > 0 && this.flashT < 1;
      (this.flash.material as THREE.MeshBasicMaterial).opacity = 0.22 * (1 - t) * (1 - t);
    } else this.flash.visible = false;
    // In flight: a hop and a spin, then it lies where it landed.
    for (const f of this.flights) {
      if (f.t >= 1) continue;
      f.t = Math.min(1, f.t + dt / f.dur);
      f.mesh.position.lerpVectors(f.from, f.to, f.t);
      f.mesh.position.y = f.from.y * (1 - f.t) + f.to.y * f.t + Math.sin(f.t * Math.PI) * f.height;
      f.mesh.rotation.set(f.t * f.spin * 0.6, f.t * f.spin, 0);
      if (f.t >= 1) {
        f.mesh.visible = false;
        if (!this.flights.some((o) => o.t < 1)) this.landing = -1;
      }
    }
    // Lit firecrackers on the floor: fizzing at the fuse's end.
    while (this.fuses.length < fuses.length) {
      const m = new THREE.Mesh(itemGeometry(itemDef(fuseItem)), kitMaterial);
      m.scale.setScalar(1.35);
      m.castShadow = true;
      this.fuses.push(m);
      this.group.add(m);
    }
    this.fuses.forEach((m, k) => {
      const t = fuses[k];
      m.visible = t !== undefined && t !== this.landing;
      if (!m.visible) return;
      const x = (t % MAP_W) + 0.5;
      const z = Math.floor(t / MAP_W) + 0.5;
      m.position.set(x, 0.01, z);
      m.rotation.y = (t * 0.61) % (Math.PI * 2);
      if (motion && Math.random() < dt * 30) sparks(x + Math.cos(m.rotation.y) * 0.3, 0.12, z - Math.sin(m.rotation.y) * 0.3);
    });
  }
}
