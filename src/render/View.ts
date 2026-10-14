import * as THREE from 'three';
import type { World } from '../sim/world/World';
import { MAP_H, MAP_W } from '../sim/world/World';
import { Character, INMATE_LOOK } from './Character';
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
}

/** From the target, up and to the south: the classic angled top-down view (tech plan §6.1). */
const CAMERA_OFFSET = new THREE.Vector3(0, 38, 24).normalize().multiplyScalar(60);
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 1.9;

/** Light by time of day: [minute, sun intensity, sun color, ambient intensity, sky color]. */
const DAYLIGHT: Array<[number, number, number, number, number]> = [
  [0, 0.25, 0x8aa2ff, 0.55, 0x0e1626],
  [300, 0.25, 0x8aa2ff, 0.55, 0x0e1626],
  [390, 1.4, 0xffc58a, 0.9, 0x6b8fb8],
  [480, 2.2, 0xfff3e0, 1.1, 0x9cc3e6],
  [1080, 2.2, 0xfff3e0, 1.1, 0x9cc3e6],
  [1170, 1.3, 0xff9a5c, 0.85, 0x5f6f9a],
  [1260, 0.25, 0x8aa2ff, 0.55, 0x0e1626],
  [1440, 0.25, 0x8aa2ff, 0.55, 0x0e1626],
];

/**
 * The 3D scene: the prison, the player, an orthographic camera at the classic angle that
 * follows the player, and a sun that moves with the prison clock. Reads state, never
 * changes it.
 */
export class View {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 200);
  private readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  private readonly ambient = new THREE.HemisphereLight(0xdfe8ff, 0x4a5a3a, 1);
  private worldView: WorldView | null = null;
  readonly player = new Character(INMATE_LOOK);
  private readonly target = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);
  private readonly c1 = new THREE.Color();
  private readonly c2 = new THREE.Color();
  private readonly sky = new THREE.Color();
  private readonly follow = new THREE.Vector3();
  zoom = 1;

  constructor(
    readonly renderer: THREE.WebGLRenderer,
    shadowSize: number,
  ) {
    renderer.shadowMap.enabled = shadowSize > 0;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.sun.castShadow = shadowSize > 0;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -22;
    s.right = s.top = 22;
    s.near = 1;
    s.far = 120;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.02;
    this.scene.background = this.sky;
    this.scene.add(this.sun, this.sun.target, this.ambient, this.player.root);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setWorld(world: World) {
    if (this.worldView) {
      this.scene.remove(this.worldView.group);
      this.worldView.dispose();
    }
    this.worldView = new WorldView(world);
    this.scene.add(this.worldView.group);
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.applyZoom();
  }

  /** Multiplies the zoom (wheel, pinch), within limits. */
  zoomBy(f: number) {
    this.zoom = THREE.MathUtils.clamp(this.zoom * f, ZOOM_MIN, ZOOM_MAX);
    this.applyZoom();
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
  }

  private light(minute: number) {
    let k = 1;
    while (k < DAYLIGHT.length - 1 && DAYLIGHT[k][0] < minute) k++;
    const a = DAYLIGHT[k - 1];
    const b = DAYLIGHT[k];
    const f = THREE.MathUtils.clamp((minute - a[0]) / Math.max(1, b[0] - a[0]), 0, 1);
    this.sun.intensity = THREE.MathUtils.lerp(a[1], b[1], f);
    this.sun.color.copy(this.c1.set(a[2]).lerp(this.c2.set(b[2]), f));
    this.ambient.intensity = THREE.MathUtils.lerp(a[3], b[3], f);
    this.sky.copy(this.c1.set(a[4]).lerp(this.c2.set(b[4]), f));
  }

  /** Draws a frame of play: the camera follows the player. */
  draw(f: Frame, dt: number, time: number) {
    this.player.root.visible = true;
    this.player.pose(f.x, f.z, f.facing, f.moving, dt, time);
    this.target.lerp(this.follow.set(f.x, 0, f.z), Math.min(1, dt * 8));
    this.render(f.minuteOfDay, dt, f);
  }

  /** Puts the camera on a point at once (a new game starts on the player, not mid-pan). */
  snapTo(x: number, z: number) {
    this.target.set(x, 0, z);
  }

  /** Draws the title backdrop: the camera drifts slowly over the prison, nobody in it. */
  drawTitle(dt: number, time: number) {
    this.player.root.visible = false;
    const a = time * 0.05;
    this.target.set(MAP_W / 2 + Math.cos(a) * 14, 0, MAP_H / 2 - 4 + Math.sin(a * 1.3) * 10);
    this.render(600, dt, null);
  }

  private render(minute: number, dt: number, focus: { x: number; z: number } | null) {
    this.light(minute);
    this.worldView?.update(dt, focus);
    this.camera.position.copy(this.target).add(CAMERA_OFFSET);
    this.camera.lookAt(this.target);
    // The sun's shadow box follows the camera's target; it swings east to west over the day.
    const sunAngle = ((minute - 720) / 720) * Math.PI * 0.6;
    this.sun.position.set(this.target.x - Math.sin(sunAngle) * 30, 40, this.target.z + 18);
    this.sun.target.position.copy(this.target);
    this.renderer.render(this.scene, this.camera);
  }
}
