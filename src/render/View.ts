import * as THREE from 'three';
import { TILE } from '../sim/world/tiles';
import type { World } from '../sim/world/World';
import { MAP_H, MAP_W } from '../sim/world/World';
import { Character, guardLook, INMATE_LOOK, inmateLook, type BedPose } from './Character';
import { Cones } from './Cones';
import { ALERT } from '../sim/systems/guards';
import { DOING } from '../sim/systems/inmates';
import { Dust } from './Dust';
import { Guide } from './Guide';
import { itemDef } from '../content/items';
import { itemGeometry } from './itemModels';
import { Pickups, type Focus, type GroundItem } from './Pickups';
import { updateOcclusion } from './occlusion';
import { WorldView } from './WorldView';
import { LAYER_Y, Structure } from './Structure';
import { Underground } from './Underground';
import { LAYER } from '../sim/world/World';

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
  /** Items on the floor, and a number that changes whenever they do. */
  ground: readonly GroundItem[];
  groundRev: number;
  /** What the action button would use, framed on the floor. */
  focus: Focus | null;
  /** The item in the player's hand and the outfit they wear (item numbers, 0 for none). */
  held: number;
  outfit: number;
  /** Asleep in bed. */
  sleeping: boolean;
  /** Knocked out on the floor. */
  knockedOut: boolean;
  /** The guards, interpolated like everyone else. */
  guards: GuardFrame[];
  /** The layer the player is on (World LAYER). */
  layer: number;
  /** Changes whenever tiles or their wear do (damage is redrawn then), and the wear itself. */
  tilesRev: number;
  wearRev: number;
  /** The desk over the player's tunnel is pushed aside (they went down through it). */
  deskAside: boolean;
  wear: Readonly<Record<number, number>>;
  /** Who the player is locked on to (Cast id: inmates, then guards; -1 none), and whether that's a guard after them. */
  lock: number;
  /** The target is after the player (the ring turns red), or out of reach (it dims). */
  lockHostile: boolean;
  lockFar: boolean;
}

export interface GuardFrame {
  x: number;
  z: number;
  facing: number;
  moving: boolean;
  doing: number;
  /** ALERT: the cone's color, none while asleep. */
  alert: number;
  /** Leg pace against the player's walk (they run when chasing). */
  pace: number;
  /** What it holds (a baton while chasing), 0 for nothing. */
  held: number;
  /** Its key still on its belt. */
  hasKey: boolean;
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
  /** Fighting the player back. */
  angry: boolean;
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
/** The tunnel lantern's strength while the player is below. */
const LANTERN = 2.6;
const UP = new THREE.Vector3(0, 1, 0);

/** The lock-on ring under the target: a bright band with four ticks, drawn over the floor. */
function lockRing(): THREE.Mesh {
  const g = new THREE.RingGeometry(0.46, 0.56, 40).rotateX(-Math.PI / 2);
  const ticks: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const t = new THREE.PlaneGeometry(0.08, 0.2).rotateX(-Math.PI / 2).translate(0, 0, -0.68).rotateY((k * Math.PI) / 2);
    ticks.push(t);
  }
  const all = [g, ...ticks].map((x) => x.toNonIndexed());
  const pos: number[] = [];
  for (const x of all) pos.push(...(x.getAttribute('position').array as Float32Array));
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  for (const x of [g, ...ticks, ...all]) x.dispose();
  // Depth-tested (walls and the target's own legs stand in front of it), nudged toward the camera over the floor.
  const m = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  m.renderOrder = 8;
  m.visible = false;
  return m;
}

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
  private world: World | null = null;
  player = new Character(INMATE_LOOK);
  private outfit = -1;
  private readonly pickups = new Pickups();
  private cast: Character[] = [];
  private guardCast: Character[] = [];
  /** Where each guard sleeps (by guard). */
  private guardBeds: Array<BedPose | undefined> = [];
  private readonly cones = new Cones();
  /** Door tiles a guard is walking through this frame (they open for guards' keys). */
  private readonly doorsOpen = new Set<number>();
  /** Each cell's bed, for sleepers (by cell number). */
  private beds: Array<BedPose | undefined> = [];
  /** 1 on tiles under a shower head. */
  private readonly showers = new Uint8Array(MAP_W * MAP_H);
  private readonly guide = new Guide();
  private readonly dust = new Dust();
  private structure: Structure | null = null;
  private underground: Underground | null = null;
  /** The layer drawn (the player's), and the tiles revision the damage was drawn for. */
  private layer = -1;
  private tilesRev = -1;
  private wearRev = -1;
  /** Whether the damage was last drawn with the player below (the desk over a tunnel is pushed aside then). */
  private drawnBelow = false;
  /** A strike's jolt (0–1), easing away. */
  private shake = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ndc = new THREE.Vector2();
  private readonly red = new THREE.Color(0xff2a1a);
  private alarm = 0;
  /** 0 by day … 1 at night (the last frame's light). */
  private night = 0;
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
  /** The lock-on ring, and the cup of molten chocolate in flight (from, to, 0–1 along the way). */
  private readonly ring = lockRing();
  private readonly cup = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color: 0x5a3018, roughness: 0.35, emissive: 0x2a1006 }));
  private readonly cupFrom = new THREE.Vector3();
  private readonly cupTo = new THREE.Vector3();
  private cupT = 1;
  private cupWho = -1;
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
    this.scene.add(this.sun, this.sun.target, this.ambient, this.player.root, this.dust.mesh, this.guide.group, this.pickups.group, this.cones.group, this.ring, this.cup);
    this.cup.visible = false;
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
    if (this.structure) {
      this.scene.remove(this.structure.group, this.structure.roofs);
      this.structure.dispose();
    }
    if (this.underground) {
      this.scene.remove(this.underground.group, this.underground.lantern);
      this.underground.dispose();
    }
    this.world = world;
    this.worldView = new WorldView(world);
    this.structure = new Structure(world, this.worldView);
    this.underground = new Underground(world);
    this.scene.add(this.worldView.group, this.structure.group, this.structure.roofs, this.underground.group, this.underground.lantern);
    this.layer = -1;
    this.tilesRev = -1;
    this.wearRev = -1;
    this.showLayer(LAYER.GROUND);
    this.guide.world = world;
    this.cones.world = world;
    // A new game dresses (rebuilds) the player afresh: nothing carries over, not even a pose.
    this.outfit = -1;
    this.showers.fill(0);
    for (const p of world.props) if (p.kind === 'shower') this.showers[p.z * MAP_W + p.x] = 1;
    this.beds = world.cellBed.map((b) => b && { x: b.x + b.w / 2, z: b.z + b.d / 2, angle: (b.rot * Math.PI) / 2 });
    this.setCast(0);
    this.setGuards([]);
  }

  /** The guards: one character each (its key's color on the belt), and the bed each sleeps in at night (if any). */
  setGuards(beds: Array<BedPose | undefined>, keys: number[] = []) {
    for (const c of this.guardCast) {
      this.scene.remove(c.root);
      c.dispose();
    }
    this.guardCast = beds.map((_, k) => new Character(guardLook(k, keys[k])));
    this.guardBeds = beds;
    for (const c of this.guardCast) this.scene.add(c.root);
    this.cones.setCount(beds.length);
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

  /**
   * Which layer is drawn (GDD §1.2 cutaway): the tunnels replace the ground floor; in the
   * vents the ground floor dims under the open ducts; on the roof the roofs go on.
   */
  private showLayer(layer: number) {
    if (layer === this.layer) return;
    this.layer = layer;
    const under = layer === LAYER.UNDER;
    if (this.worldView) this.worldView.group.visible = !under;
    if (this.structure) {
      this.structure.group.visible = !under;
      this.structure.setMode(layer);
    }
    if (this.underground) {
      this.underground.group.visible = under;
      // The lantern never leaves the scene (a light coming and going recompiles every material): it dims instead.
      this.underground.lantern.intensity = under ? LANTERN : 0;
    }
    this.cones.group.visible = !under;
    // The floor arrows and the tap ring at the player's level (off the ground floor only the ring shows).
    this.guide.group.position.y = LAYER_Y[layer];
    this.floor.constant = -LAYER_Y[layer];
    this.pickups.group.position.y = LAYER_Y[layer];
  }

  /**
   * A tool strike landed at a tile (tiles, the layer struck): the arm swings, the material
   * flies, the camera jolts a little; harder when the tile gives way.
   */
  impact(action: string, tile: number, layer: number, broke: boolean) {
    this.player.strike();
    const x = tile >= 0 ? (tile % MAP_W) + 0.5 : this.player.root.position.x;
    const z = tile >= 0 ? Math.floor(tile / MAP_W) + 0.5 : this.player.root.position.z;
    // Struck from the near side: the chips fly from the face, not the middle of the tile.
    const px = this.player.root.position.x;
    const pz = this.player.root.position.z;
    const fx = action === 'unscrew' || action === 'digUp' ? px : x + (px - x) * 0.45;
    const fz = action === 'unscrew' || action === 'digUp' ? pz : z + (pz - z) * 0.45;
    const y = action === 'unscrew' ? (layer === LAYER.VENTS ? LAYER_Y[LAYER.VENTS] : 1.3) : action === 'chip' ? 0.6 : action === 'cut' || action === 'sharpen' ? 0.8 : LAYER_Y[this.layer];
    const color = action === 'chip' ? 0xa0533e : action === 'cut' || action === 'unscrew' ? 0xffd27a : action === 'sharpen' ? 0xd8cfc0 : 0x8a6644;
    // Sharpening is a scrape, not a blow: a little grit, no jolt.
    if (action === 'sharpen') {
      if (!this.reducedMotion) this.dust.puff(fx, fz, color, broke ? 6 : 2, y);
      return;
    }
    if (!this.reducedMotion) {
      this.dust.puff(fx, fz, color, broke ? 14 : 4, y);
      if (broke && action === 'chip') this.dust.puff(fx, fz, 0x8f8a80, 8, y);
      this.shake = Math.max(this.shake, broke ? 1 : 0.35);
    }
  }

  /** Someone by Cast id (inmates, then guards; -1 the player). */
  private who(id: number): Character | undefined {
    if (id < 0) return this.player;
    return id < this.cast.length ? this.cast[id] : this.guardCast[id - this.cast.length];
  }

  /**
   * A blow lands (`by` hits `on`, Cast ids, -1 the player): the hitter's arm goes, the one hit
   * flinches, a burst at the point of contact; the player's own blows jolt the camera a touch,
   * harder for a knockout.
   */
  blow(by: number, on: number, ko: boolean) {
    const a = this.who(by);
    const b = this.who(on);
    a?.punch();
    b?.flinch();
    if (!a || !b || this.reducedMotion) return;
    const x = (a.root.position.x + b.root.position.x * 2) / 3;
    const z = (a.root.position.z + b.root.position.z * 2) / 3;
    this.dust.puff(x, z, 0xfff2c8, ko ? 12 : 6, 0.9);
    if (by < 0) this.shake = Math.max(this.shake, ko ? 0.8 : 0.3);
  }

  /** A cup of molten chocolate thrown at someone (Cast id): it arcs over, then splashes. */
  throwAt(on: number) {
    const b = this.who(on);
    if (!b) return;
    this.player.punch();
    this.cupFrom.copy(this.player.root.position).setY(this.player.root.position.y + 1.1);
    this.cupTo.copy(b.root.position).setY(b.root.position.y + 0.9);
    this.cupT = 0;
    this.cupWho = on;
  }

  /** Where someone's head is on screen (CSS pixels), for floating numbers; null off screen. */
  screenOf(id: number, out: { x: number; y: number }, height = 1.7): { x: number; y: number } | null {
    const c = this.who(id);
    if (!c) return null;
    this.v.copy(c.root.position).setY(c.root.position.y + height).project(this.camera);
    if (this.v.z > 1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) return null;
    out.x = ((this.v.x + 1) / 2) * innerWidth;
    out.y = ((1 - this.v.y) / 2) * innerHeight;
    return out;
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

  /** Dresses the player: the jumpsuit takes the outfit's color (a white vest with none on). */
  private dress(outfit: number) {
    if (outfit === this.outfit) return;
    this.outfit = outfit;
    const old = this.player;
    const color = outfit ? itemDef(outfit).color : 0xe8e8e2;
    this.player = new Character({ ...INMATE_LOOK, outfit: color });
    this.player.root.position.copy(old.root.position);
    this.player.root.rotation.copy(old.root.rotation);
    this.scene.remove(old.root);
    old.dispose();
    this.scene.add(this.player.root);
  }

  /** Draws a frame of play: the camera follows the player, looking a little ahead. */
  draw(f: Frame, dt: number, time: number) {
    this.dress(f.outfit);
    this.showLayer(f.layer);
    // Damage, grates and tunnels redrawn when the tiles change.
    const below = f.deskAside;
    if (f.tilesRev !== this.tilesRev || below !== this.drawnBelow) {
      if (f.tilesRev !== this.tilesRev) this.underground?.refresh();
      this.tilesRev = f.tilesRev;
      this.drawnBelow = below;
      this.structure?.refresh(below);
      this.wearRev = -1;
    }
    if (f.wearRev !== this.wearRev) {
      this.wearRev = f.wearRev;
      this.structure?.refreshWear(f.wear);
    }
    this.player.root.visible = true;
    this.player.baseY = LAYER_Y[f.layer];
    this.player.hold(f.sleeping || f.knockedOut ? 0 : f.held, f.held ? itemGeometry(itemDef(f.held)) : null);
    const doing = f.knockedOut ? DOING.KNOCKED_OUT : f.sleeping ? DOING.SLEEP : f.layer === LAYER.VENTS ? DOING.CRAWL : DOING.NOTHING;
    if (this.player.pose(f.x, f.z, f.facing, f.moving, dt, time, !this.reducedMotion, doing, this.beds[1])) {
      if (DUST[f.surface] !== undefined && !this.reducedMotion && (f.layer === LAYER.GROUND || f.layer === LAYER.UNDER)) this.dust.puff(f.x, f.z, DUST[f.surface], 2);
      this.onStep(f.surface);
    }
    // Look-ahead: up to a tile and a half in the walking direction, eased.
    const lead = f.moving && !this.reducedMotion ? 1.4 : 0;
    this.ahead.lerp(this.v.set(Math.sin(f.facing) * lead, 0, Math.cos(f.facing) * lead * 0.8), Math.min(1, dt * 2.2));
    // Carried somewhere far (solitary, the infirmary): cut there instead of panning across the map.
    // The camera rises and sinks with the layer (into the tunnels at once: it's another view).
    const y = LAYER_Y[f.layer];
    if (Math.abs(this.target.x - f.x) + Math.abs(this.target.z - f.z) > 10 || f.layer === LAYER.UNDER) this.target.set(f.x, y, f.z);
    else this.target.lerp(this.v.set(f.x, y, f.z).add(this.ahead), Math.min(1, dt * 7));
    this.underground?.follow(f.x, f.z);
    this.feet.set(f.x, 0, f.z);
    // The see-through cut: on the ground floor and in the tunnels (nothing stands over the vents or the roof).
    const cut = f.layer === LAYER.GROUND || f.layer === LAYER.UNDER;
    f.inmates.forEach((m, k) => {
      const c = this.cast[k];
      if (!c) return;
      // In the tunnels the ground floor and everyone on it are out of the picture.
      c.root.visible = f.layer !== LAYER.UNDER;
      c.wet = this.showers[Math.floor(m.z) * MAP_W + Math.floor(m.x)] === 1;
      c.pose(m.x, m.z, m.facing, m.moving, dt, time, !this.reducedMotion, m.doing, this.beds[m.cell]);
      c.mark(m.angry ? '!' : '', dt, !this.reducedMotion);
    });
    this.doorsOpen.clear();
    f.guards.forEach((g, k) => {
      const c = this.guardCast[k];
      if (!c) return;
      c.root.visible = f.layer !== LAYER.UNDER;
      c.gait = g.pace;
      c.hold(g.held, g.held ? itemGeometry(itemDef(g.held)) : null);
      c.pose(g.x, g.z, g.facing, g.moving, dt, time, !this.reducedMotion, g.doing, this.guardBeds[k]);
      c.mark(g.alert === ALERT.HOSTILE ? '!' : g.alert === ALERT.SUSPICIOUS ? '?' : '', dt, !this.reducedMotion);
      c.showKey(g.hasKey);
      // A guard's key opens the door it walks through (and the one just ahead).
      const tx = Math.floor(g.x + Math.sin(g.facing) * 0.6);
      const tz = Math.floor(g.z + Math.cos(g.facing) * 0.6);
      this.doorsOpen.add(Math.floor(g.z) * MAP_W + Math.floor(g.x));
      if (g.moving) this.doorsOpen.add(tz * MAP_W + tx);
    });
    // The player's key opens the door they walk into (on screen as for guards).
    if (f.layer === LAYER.GROUND && this.world) {
      const here = Math.floor(f.z) * MAP_W + Math.floor(f.x);
      const ahead = Math.floor(f.z + Math.cos(f.facing) * 0.7) * MAP_W + Math.floor(f.x + Math.sin(f.facing) * 0.7);
      if (!this.world.block[here]) this.doorsOpen.add(here);
      if (f.moving && !this.world.block[ahead]) this.doorsOpen.add(ahead);
    }
    this.drawLock(f, dt, time);
    this.cones.update(f.guards, dt, this.night, !this.reducedMotion);
    this.pickups.update(f.ground, f.groundRev, f.focus, dt, time, !this.reducedMotion);
    this.guide.setPath(f.guide);
    this.guide.setTap(f.tap);
    this.guide.update(dt, time, f, !this.reducedMotion);
    this.alarm += ((f.alarm ? 1 : 0) - this.alarm) * Math.min(1, dt * 3);
    this.render(f.minuteOfDay, dt, cut ? this.feet : null, time);
  }

  /** The ring under the locked-on target (pulsing), and the thrown cup's flight. */
  private drawLock(f: Frame, dt: number, time: number) {
    const id = f.lock;
    const target = id < 0 ? null : id < f.inmates.length ? f.inmates[id] : f.guards[id - f.inmates.length];
    this.ring.visible = !!target && f.layer === LAYER.GROUND;
    if (target) {
      const pulse = this.reducedMotion ? 1 : 1 + Math.sin(time * 6) * 0.06;
      this.ring.position.set(target.x, 0.03, target.z);
      const mat = this.ring.material as THREE.MeshBasicMaterial;
      mat.color.setHex(f.lockHostile ? 0xff4a3a : 0xffb02e);
      mat.opacity = f.lockFar ? 0.45 : 0.92;
      this.ring.scale.setScalar(pulse);
      this.ring.rotation.y = this.reducedMotion ? 0 : time * 0.8;
    }
    if (this.cupT < 1) {
      this.cupT = Math.min(1, this.cupT + dt / 0.32);
      const t = this.cupT;
      this.cup.visible = true;
      this.cup.position.lerpVectors(this.cupFrom, this.cupTo, t);
      this.cup.position.y += Math.sin(t * Math.PI) * 0.9;
      if (t >= 1) {
        this.cup.visible = false;
        const b = this.who(this.cupWho);
        b?.flinch();
        if (!this.reducedMotion) {
          this.dust.puff(this.cupTo.x, this.cupTo.z, 0x6b3d22, 16, 1);
          this.dust.puff(this.cupTo.x, this.cupTo.z, 0xd9a066, 8, 1.2);
          this.shake = Math.max(this.shake, 0.6);
        }
      }
    }
  }

  /** Draws the title backdrop: the camera drifts slowly over the prison, nobody in it. */
  drawTitle(dt: number, time: number) {
    this.showLayer(LAYER.GROUND);
    this.player.root.visible = false;
    this.ring.visible = false;
    this.cup.visible = false;
    this.cupT = 1;
    this.doorsOpen.clear();
    this.cones.update([], dt, 0, false);
    this.alarm = 0;
    this.pickups.update([], -1, null, dt, time, false);
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
    const night = (this.night = this.light(minute));
    if (this.alarm > 0.001) {
      // Lockdown: the light swings red in slow pulses, like a rotating beacon.
      const pulse = this.reducedMotion ? 0.5 : (Math.sin(time * 5) + 1) / 2;
      const a = this.alarm * (0.25 + pulse * 0.45);
      this.ambient.color.set(SKY_LIGHT).lerp(this.red, a);
      this.sky.lerp(this.red, a * 0.35);
      this.sun.intensity *= 1 - 0.35 * this.alarm;
    } else this.ambient.color.set(SKY_LIGHT);
    // Off the ground floor: the vents dim the rooms below; the tunnels are dark but for the lantern.
    if (this.layer === LAYER.VENTS) {
      this.sun.intensity *= 0.22;
      this.ambient.intensity *= 0.32;
    } else if (this.layer === LAYER.UNDER) {
      // Dim, but the map above (tinted on the earth) still reads; the lantern warms the trench.
      this.sun.intensity = 0.55;
      this.ambient.intensity = 0.85;
      this.sky.set(0x120c08);
    }
    this.worldView?.update(dt, night, this.doorsOpen);
    this.dust.update(dt);
    this.camera.position.copy(this.target).add(CAMERA_OFFSET);
    this.camera.lookAt(this.target);
    if (this.shake > 0.001) {
      // A short jolt on a strike (eased away; reduced motion never sets it).
      const a = this.shake * 0.06;
      this.camera.position.x += Math.sin(time * 91) * a;
      this.camera.position.y += Math.cos(time * 77) * a;
      this.shake = Math.max(0, this.shake - dt * 5);
    }
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
