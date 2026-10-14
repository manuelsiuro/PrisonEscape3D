import * as THREE from 'three';
import { TILE } from '../sim/world/tiles';
import type { World } from '../sim/world/World';
import { MAP_H, MAP_W } from '../sim/world/World';
import { Character, INMATE_LOOK, inmateLook, type BedPose } from './Character';
import { Dust } from './Dust';
import { Guide } from './Guide';
import { updateOcclusion } from './occlusion';
import { WorldView } from './WorldView';

/** What the view needs from the simulation each frame (positions in tiles, already interpolated). */
export interface Frame {
  x: number;
  z: number;
  /** Radians, 0 = facing +z (south). */
  facing: number;
  moving: boolean;
  /** Game time of day in minutes, fractional (lighting). */
  minuteOfDay: number;
  /** The tile kind under the player (footstep dust and sound). */
  surface: number;
  /** The other inmates, interpolated like the player. */
  inmates: InmateFrame[];
  /** Where the floor arrows lead (tile centers), or null for none. */
  guide: Array<{ x: number; z: number }> | null;
  /** The tap-to-walk target, or null. */
  tap: { x: number; z: number } | null;
  /** A lockdown: red lights pulse. */
  alarm: boolean;
}

export interface InmateFrame {
  x: number;
  z: number;
  facing: number;
  moving: boolean;
  /** DOING (sim/systems/inmates.ts). */
  doing: number;
  /** Their cell number (their bed is in it). */
  cell: number;
}

export interface Quality {
  /** Shadow map size; 0 = no shadows. */
  shadows: number;
  pixelRatio: number;
}

/** From the target, up and to the south: the classic angled top-down view (tech plan §6.1). */
const CAMERA_OFFSET = new THREE.Vector3(0, 38, 24).normalize().multiplyScalar(60);
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 1.9;

/** Light by time of day: [minute, sun intensity, sun color, ambient intensity, sky color]. */
const DAYLIGHT: Array<[number, number, number, number, number]> = [
  [0, 0.3, 0x8aa2ff, 0.5, 0x0b1322],
  [300, 0.3, 0x8aa2ff, 0.5, 0x0b1322],
  [390, 1.4, 0xffc58a, 0.85, 0x6b8fb8],
  [480, 2.3, 0xfff1dc, 1.05, 0x9cc3e6],
  [1080, 2.3, 0xfff1dc, 1.05, 0x9cc3e6],
  [1170, 1.3, 0xff9a5c, 0.8, 0x5f6f9a],
  [1260, 0.3, 0x8aa2ff, 0.5, 0x0b1322],
  [1440, 0.3, 0x8aa2ff, 0.5, 0x0b1322],
];

/** Dust colors by ground (only soft ground and dirt puffs). */
const DUST: Record<number, number> = {
  [TILE.GRASS]: 0x7fa65a,
  [TILE.DIRT]: 0xa88660,
  [TILE.ROAD]: 0x8a8d92,
  [TILE.ASPHALT]: 0x9a9da3,
};

/** The ambient light's sky color. */
const SKY_LIGHT = 0xdfe8ff;
const ORIGIN = new THREE.Vector3(0, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

/**
 * The 3D scene: the prison, the player, an orthographic camera at the classic angle that
 * follows the player with a little look-ahead, and a sun that crosses the sky with the
 * prison clock. Reads state, never changes it.
 */
export class View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  private readonly ambient = new THREE.HemisphereLight(SKY_LIGHT, 0x4a5a3a, 1);
  private worldView: WorldView | null = null;
  readonly player = new Character(INMATE_LOOK);
  private cast: Character[] = [];
  /** Each cell's bed, for sleepers (by cell number). */
  private beds: Array<BedPose | undefined> = [];
  /** 1 on tiles under a shower head. */
  private readonly showers = new Uint8Array(MAP_W * MAP_H);
  private readonly guide = new Guide();
  private readonly dust = new Dust();
  private readonly raycaster = new THREE.Raycaster();
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndc = new THREE.Vector2();
  private readonly red = new THREE.Color(0xff2a1a);
  private alarm = 0;
  private readonly target = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);
  private readonly ahead = new THREE.Vector3();
  private readonly feet = new THREE.Vector3();
  private readonly c1 = new THREE.Color();
  private readonly c2 = new THREE.Color();
  private readonly sky = new THREE.Color();
  private readonly v = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly lightBasis = new THREE.Matrix4();
  private readonly lightInverse = new THREE.Matrix4();
  private zoom = 1;
  private zoomGoal = 1;
  private shadowHalf = 20;
  /** No camera drift, idle glances or dust. */
  reducedMotion = false;
  /** Called when a foot lands, with the ground kind. */
  onStep: (surface: number) => void = () => {};

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    quality: Quality,
  ) {
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.background = this.sky;
    this.scene.add(this.sun, this.sun.target, this.ambient, this.player.root, this.dust.mesh, this.guide.group);
    this.setQuality(quality);
    addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality) {
    this.renderer.setPixelRatio(q.pixelRatio);
    const on = q.shadows > 0;
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    if (on && this.sun.shadow.mapSize.x !== q.shadows) {
      this.sun.shadow.mapSize.set(q.shadows, q.shadows);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // Materials compiled with or without shadows must recompile.
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) mat.needsUpdate = true;
    });
    this.resize();
  }

  setWorld(world: World) {
    if (this.worldView) {
      this.scene.remove(this.worldView.group);
      this.worldView.dispose();
    }
    this.worldView = new WorldView(world);
    this.scene.add(this.worldView.group);
    this.guide.world = world;
    this.showers.fill(0);
    for (const p of world.props) if (p.kind === 'shower') this.showers[p.z * MAP_W + p.x] = 1;
    this.beds = world.cellBed.map((b) => b && { x: b.x + b.w / 2, z: b.z + b.d / 2, angle: (b.rot * Math.PI) / 2 });
    this.setCast(0);
  }

  /** The other inmates: one character each, looks varied by cell, legs paced by walking speed. */
  setCast(cast: Array<{ cell: number; gait: number }> | 0) {
    for (const c of this.cast) {
      this.scene.remove(c.root);
      c.dispose();
    }
    this.cast = cast ? cast.map((c) => new Character({ ...inmateLook(c.cell), gait: c.gait })) : [];
    for (const c of this.cast) this.scene.add(c.root);
  }

  /** The floor point under a screen point (tiles), for tap-to-walk. */
  groundAt(clientX: number, clientY: number): { x: number; z: number } | null {
    this.ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.floor, this.v);
    return hit ? { x: hit.x, z: hit.z } : null;
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.applyZoom();
  }

  /** Multiplies the zoom (wheel, pinch), within limits; the camera eases to it. */
  zoomBy(f: number) {
    this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal * f, ZOOM_MIN, ZOOM_MAX);
  }

  /** About 15 tiles tall, never under 11 wide (phones in portrait see more rows instead). */
  private applyZoom() {
    const aspect = innerWidth / Math.max(1, innerHeight);
    const half = Math.max(15, 11 / aspect) / 2 / this.zoom;
    this.camera.left = -half * aspect;
    this.camera.right = half * aspect;
    this.camera.top = half;
    this.camera.bottom = -half;
    this.camera.updateProjectionMatrix();
    // The shadow box covers what the camera sees (the view is stretched along the ground by the tilt).
    this.shadowHalf = Math.min(34, Math.max(half * aspect, half * 1.25) + 3);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -this.shadowHalf;
    s.right = s.top = this.shadowHalf;
    s.near = 1;
    s.far = 140;
    s.updateProjectionMatrix();
  }

  /** Sets the lights for a time of day; returns 0 in full daylight, 1 at night. */
  private light(minute: number): number {
    let k = 1;
    while (k < DAYLIGHT.length - 1 && DAYLIGHT[k][0] < minute) k++;
    const a = DAYLIGHT[k - 1];
    const b = DAYLIGHT[k];
    const f = THREE.MathUtils.clamp((minute - a[0]) / Math.max(1, b[0] - a[0]), 0, 1);
    this.sun.intensity = THREE.MathUtils.lerp(a[1], b[1], f);
    this.sun.color.copy(this.c1.set(a[2]).lerp(this.c2.set(b[2]), f));
    this.ambient.intensity = THREE.MathUtils.lerp(a[3], b[3], f);
    this.sky.copy(this.c1.set(a[4]).lerp(this.c2.set(b[4]), f));
    return THREE.MathUtils.clamp(1 - (this.sun.intensity - 0.3) / (2.3 - 0.3), 0, 1);
  }

  /** Puts the camera on a point at once (a new game starts on the player, not mid-pan). */
  snapTo(x: number, z: number, zoom = this.zoomGoal) {
    this.target.set(x, 0, z);
    this.ahead.set(0, 0, 0);
    this.zoom = zoom;
    this.applyZoom();
  }

  /** Draws a frame of play: the camera follows the player, looking a little ahead. */
  draw(f: Frame, dt: number, time: number) {
    this.player.root.visible = true;
    if (this.player.pose(f.x, f.z, f.facing, f.moving, dt, time, !this.reducedMotion)) {
      if (DUST[f.surface] !== undefined && !this.reducedMotion) this.dust.puff(f.x, f.z, DUST[f.surface], 2);
      this.onStep(f.surface);
    }
    // Look-ahead: up to a tile and a half in the walking direction, eased.
    const lead = f.moving && !this.reducedMotion ? 1.4 : 0;
    this.ahead.lerp(this.v.set(Math.sin(f.facing) * lead, 0, Math.cos(f.facing) * lead * 0.8), Math.min(1, dt * 2.2));
    this.target.lerp(this.v.set(f.x, 0, f.z).add(this.ahead), Math.min(1, dt * 7));
    this.feet.set(f.x, 0, f.z);
    f.inmates.forEach((m, k) => {
      const c = this.cast[k];
      if (!c) return;
      c.wet = this.showers[Math.floor(m.z) * MAP_W + Math.floor(m.x)] === 1;
      c.pose(m.x, m.z, m.facing, m.moving, dt, time, !this.reducedMotion, m.doing, this.beds[m.cell]);
    });
    this.guide.setPath(f.guide);
    this.guide.setTap(f.tap);
    this.guide.update(dt, time, f, !this.reducedMotion);
    this.alarm += ((f.alarm ? 1 : 0) - this.alarm) * Math.min(1, dt * 3);
    this.render(f.minuteOfDay, dt, this.feet, time);
  }

  /** Draws the title backdrop: the camera drifts slowly over the prison, nobody in it. */
  drawTitle(dt: number, time: number) {
    this.player.root.visible = false;
    this.alarm = 0;
    this.guide.setPath(null);
    this.guide.setTap(null);
    this.guide.update(dt, time, this.target, false);
    const a = this.reducedMotion ? 1.2 : time * 0.05;
    this.target.set(MAP_W / 2 + Math.cos(a) * 14, 0, MAP_H / 2 - 4 + Math.sin(a * 1.3) * 10);
    this.render(600, dt, null, time);
  }

  private render(minute: number, dt: number, focus: THREE.Vector3 | null, time: number) {
    if (Math.abs(this.zoom - this.zoomGoal) > 1e-4) {
      this.zoom += (this.zoomGoal - this.zoom) * Math.min(1, dt * 10);
      this.applyZoom();
    }
    const night = this.light(minute);
    if (this.alarm > 0.001) {
      // Lockdown: the light swings red in slow pulses, like a rotating beacon.
      const pulse = this.reducedMotion ? 0.5 : (Math.sin(time * 5) + 1) / 2;
      const a = this.alarm * (0.25 + pulse * 0.45);
      this.ambient.color.set(SKY_LIGHT).lerp(this.red, a);
      this.sky.lerp(this.red, a * 0.35);
      this.sun.intensity *= 1 - 0.35 * this.alarm;
    } else this.ambient.color.set(SKY_LIGHT);
    this.worldView?.update(dt, night);
    this.dust.update(dt);
    this.camera.position.copy(this.target).add(CAMERA_OFFSET);
    this.camera.lookAt(this.target);
    this.placeSun(minute);
    updateOcclusion(this.renderer, this.camera, focus, dt);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * The sun swings east to west over the day; its shadow box follows the camera, snapped to
   * whole shadow-map texels so shadow edges don't shimmer as the camera glides.
   */
  private placeSun(minute: number) {
    const angle = ((minute - 720) / 720) * Math.PI * 0.6;
    // Never straight overhead: a western bias keeps shadows on the floor the camera sees.
    const offset = this.v.set(-Math.sin(angle) * 26 - 9, 40, 9);
    this.lightBasis.lookAt(offset, ORIGIN, UP);
    this.lightInverse.copy(this.lightBasis).invert();
    const texel = (this.shadowHalf * 2) / Math.max(1, this.sun.shadow.mapSize.x);
    const p = this.p.copy(this.target).applyMatrix4(this.lightInverse);
    p.x = Math.round(p.x / texel) * texel;
    p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(this.lightBasis);
    this.sun.target.position.copy(p);
    this.sun.position.copy(p).add(offset);
  }
}
