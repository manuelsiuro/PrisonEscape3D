import * as THREE from 'three';
import { TILE, TILE_INFO } from '../sim/world/tiles';
import type { World } from '../sim/world/World';
import { MAP_H, MAP_W } from '../sim/world/World';
import { Character, guardLook, INMATE_LOOK, inmateLook, type BadgeKind, type BedPose } from './Character';
import { Cones } from './Cones';
import { Security, type SecurityFrame } from './Security';
import { ALERT } from '../sim/systems/guards';
import { DOING } from '../sim/systems/inmates';
import { Dust } from './Dust';
import { Island } from './Island';
import { Snores, Sparks } from './Particles';
import { DecorView } from './decor';
import { Minefield } from './Minefield';
import { Guide } from './Guide';
import { itemDef, itemNumber } from '../content/items';
import type { Prisoner } from '../content/prisoner';
import { lookFor } from './prisonerLook';
import { itemGeometry } from './itemModels';
import { Pickups, type Focus, type GroundItem } from './Pickups';
import { updateOcclusion } from './occlusion';
import { WorldView } from './WorldView';
import { LAYER_Y, Structure } from './Structure';
import { NoiseFx, type AimView } from './Noise';
import { FIRECRACKER } from '../sim/systems/structure';
import { Underground } from './Underground';
import { setTheme } from './textures';
import { Blobs } from './Blobs';
import { Snowfall } from './Snow';
import { Weather, type WeatherFrame, type WeatherView } from './Weather';
import { Delivery, type DeliveryFrame } from './Delivery';
import { DayEvents, type EventsFrame } from './DayEvents';
import { ROOF_Y as ROOF_HEIGHT } from './Structure';
import { WALL_H } from './WorldView';
import { LAYER } from '../sim/world/World';
import type { NoiseKind } from '../sim/state';
import { Dogs, type DogFrame } from './Dog';
import { Rats, type RatFrame } from './Rat';
import { SmuggleView, type SmuggleFrame } from './Smuggling';
import { GamesView, type GamesFrame } from './Games';
import { handlersOf } from '../sim/systems/k9';

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
  /** Training (GDD §3.2): the player's pose (DOING.LIFT, RUN, READ; NOTHING otherwise), where they stand for it (on the treadmill's belt), and a count of reps so far (each one pumps the arms). */
  doing: number;
  trainAt: { x: number; z: number; facing: number; y: number } | null;
  /** Resting on an infirmary bed: where it lies (the player lies on it as in their own bed). */
  restBed: BedPose | null;
  reps: number;
  /** Puddles to mop (tiles), and a number that changes whenever they do. */
  puddles: readonly number[];
  puddlesRev: number;
  /** Mines set off today (P11): their ground tiles. */
  craters: readonly number[];
  /** Security (GDD §5.4–5.6): the power, cameras, searchlights, a sniper's aim. */
  security: SecurityFrame;
  /** A takeover (GDD §12): every door stands open. */
  takeover: boolean;
  /** Firecrackers burning on the floor (P14): their ground tiles. */
  fuses: readonly number[];
  /** The day (P17): the weather over the prison, and the event on (the movie, the food fight, the inspectors). */
  weather: WeatherFrame;
  events: EventsFrame;
  /** Delivery day (P18): where its vehicle is in its day, and the player hidden in it. */
  delivery: DeliveryFrame;
  /** Guard dogs (P19), interpolated; the player's trail ([ground tile, freshness 1 → 0], oldest first). */
  dogs: DogFrame[];
  scent: ReadonlyArray<readonly [number, number]>;
  /** The rats (P20): the pet and any thrown loose, interpolated. */
  rats: RatFrame[];
  /** Smuggling (P21): the drone, what it dropped, visiting day's arches and visitors (null where there's none). */
  smuggle: SmuggleFrame | null;
  /** Side games (P22): an arm-wrestle, dice on the ground, the lockpick's taps, sports day's bunting. */
  games: GamesFrame;
}

const NO_FUSES: readonly number[] = [];
/** How far apart two arm-wrestlers stand, centre to centre (tiles): their right hands, each reaching about half of it, meet between them. */
const BOUT_GAP = 1.0;
/** How far each steps to its own left (tiles), so the right hands (a shoulder's width off the middle) meet on the line between them. */
const BOUT_SIDE = 0.21;
/** How far the one winning leans in, and the other gives way, at the most (tiles). */
const BOUT_LEAN = 0.06;
/** How far in to a lock the player leans (tiles from the tile's middle: the hands at the door's face). */
const PICK_LEAN = 0.38;
const NO_WEATHER: WeatherFrame = { rain: 0, fog: 0, heat: false, windAngle: 0, windForce: 0 };
const NO_EVENTS: EventsFrame = { movie: false, foodFight: false, inspection: false };

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
  /** Bribed to look the other way (P15): its cone in the looking-away tint, and steps left. */
  away: boolean;
  awayLeft: number;
  /** Dozing and stirring (0–1): the player at its elbow is about to wake it. */
  stir: number;
  /** How far it sees now (tiles; P17: the weather, the inspectors): its cone is drawn that long. */
  range: number;
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
  /** The badge over their head: a favor, a shop, the player's letter for them, a follower. */
  badge: BadgeKind;
}

export interface Quality {
  /** Shadow map size; 0 = no shadows. */
  shadows: number;
  /** Shadow edge softness in shadow-map texels (PCF filter radius). */
  softness: number;
  pixelRatio: number;
}

/** From the target, up and to the south: the classic angled top-down view (tech plan §6.1). */
const CAMERA_OFFSET = new THREE.Vector3(0, 38, 24).normalize().multiplyScalar(60);
const GUARD_OUTFIT = itemNumber('guard_outfit');
const INMATE_OUTFIT = itemNumber('inmate_outfit');
/** The escape camera (P16): how far it turns round the player (radians) and pulls back (a share of the zoom). */
const CINEMA_TURN = (25 * Math.PI) / 180;
const CINEMA_PULL = 0.3;
/** The Intake preview's zoom (P16): close on your prisoner in their cell. */
const PREVIEW_ZOOM = 4.2;
/** The Intake's camera: lower than play's, nearly face on (a mugshot, not a map). */
const PREVIEW_OFFSET = new THREE.Vector3(0, 16, 24).normalize().multiplyScalar(60);
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

/** Dust colors by ground (only soft ground and dirt puffs); in the snow, powder. */
const DUST: Record<number, number> = {
  [TILE.GRASS]: 0x7fa65a,
  [TILE.DIRT]: 0xa88660,
  [TILE.ROAD]: 0x8a8d92,
  [TILE.ASPHALT]: 0x9a9da3,
};
/** In the desert: pale sand everywhere, red earth in the plaza. */
const SAND_DUST: Record<number, number> = {
  [TILE.GRASS]: 0xdcbb84,
  [TILE.MINE]: 0xcba86f,
  [TILE.DIRT]: 0xb98257,
  [TILE.ROAD]: 0xb7a07a,
  [TILE.ASPHALT]: 0xb7a07a,
};
const SNOW_DUST: Record<number, number> = {
  [TILE.GRASS]: 0xf4f8fc,
  [TILE.DIRT]: 0xd6dbe1,
  [TILE.ROAD]: 0xe6ebf1,
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
  /** Your prisoner (P16): how the player looks (null: the plain jumpsuit). */
  private prisoner: Prisoner | null = null;
  /** The Intake's preview (P16): your prisoner standing in their cell behind the title, turned by `previewTurn`. */
  private model: Character | null = null;
  previewTurn = 0;
  private titleZoom = 1;
  /** 0 the title's angle … 1 the Intake's (eased between them). */
  private previewBlend = 0;
  /** The raft or the helicopter carries the player off (the camera follows it). */
  private carrying = false;
  /** The escape camera (P16): time in, length, turn (signed), the zoom it starts from; resolved once played (or skipped). */
  private cine: { t: number; dur: number; turn: number; zoom0: number; still: boolean; done: (() => void) | null; held: boolean } | null = null;
  private readonly cineOffset = new THREE.Vector3();
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
  /** The infirmary bed the player rested on, while they get up from it. */
  private lastRest: BedPose | null = null;
  /** 1 on tiles under a shower head. */
  private readonly showers = new Uint8Array(MAP_W * MAP_H);
  private readonly guide = new Guide();
  private readonly dust = new Dust();
  private readonly blobs = new Blobs();
  /** Everyone on stage, for the contact shadows (refilled per frame). */
  private readonly onStage: Character[] = [];
  private readonly snow = new Snowfall();
  /** The day (P17): rain, ripples and fog; the movie screen, the food fight, the inspectors. */
  private readonly weather = new Weather();
  private readonly events = new DayEvents();
  /** Delivery day's vehicle (P18; Irongate's helicopter is the island's). */
  private readonly delivery = new Delivery();
  /** The guard dogs, their kennels, the trail (P19). */
  private readonly dogs = new Dogs();
  /** The rats (P20), and where the player's shoulder is this frame. */
  private readonly rats = new Rats();
  /** Smuggling (P21): the drone, the drops' beacons, visiting day. */
  private readonly smuggling = new SmuggleView();
  private readonly gamesView = new GamesView();
  /** The side games' taps so far (P22: a pin tried, dice thrown), and the inmate in an arm-wrestle (eased apart again after). */
  private taps = 0;
  private buzzClock = 0;
  /** The drone overhead (P21): its buzz, every so often while it's about (the play layer plays it, louder the nearer). */
  onDrone: (x: number, z: number) => void = () => {};
  private readonly shoulderAt = new THREE.Vector3();
  private readonly noSleepers: number[] = [];
  /** The weather's light this frame (the title has none), and a lightning flash easing away. */
  private wxLight: WeatherFrame | null = null;
  /** The weather's light as drawn: eased toward the frame's (P17). */
  private readonly wxEased = { grey: 0, storm: 0, fog: 0, heat: 0 };
  private wxFresh = true;
  private flash = 0;
  private readonly guardSpots: Array<{ x: number; z: number; awake: boolean }> = [];
  /** Whether a tile has open sky over it (no roof): where snow falls. */
  private readonly openSky = (x: number, z: number) => !this.world || !this.world.inside(x, z) || this.world.layers[LAYER.ROOF].kind[z * MAP_W + x] === TILE.EMPTY;
  /** Where rain lands on a tile (P17): seen from the ground floor or below a roof, the open ground; from the roofs, the roof or the ground. -1: none. */
  private readonly rainBelow = (x: number, z: number) => (this.openSky(x, z) ? 0 : -1);
  private readonly rainOnRoofs = (x: number, z: number) => (this.openSky(x, z) ? 0 : ROOF_HEIGHT);
  /** On the roofs: puddles on the roofs and on hard open ground. */
  private readonly wetRoofs = (x: number, z: number) => !this.openSky(x, z) || this.puddly(x, z);
  private readonly wxSnow: WeatherFrame = { rain: 0, fog: 0, heat: false, windAngle: 0, windForce: 0 };
  /** Open sky over hard ground (paths, roads, concrete): where rain ripples (P17). */
  private readonly puddly = (x: number, z: number) => {
    if (!this.openSky(x, z) || !this.world?.inside(x, z)) return false;
    const k = this.world.ground.kind[z * MAP_W + x];
    return k !== TILE.GRASS && k !== TILE.DIRT && k !== TILE.MINE && !TILE_INFO[k].solid;
  };
  private readonly sparks = new Sparks();
  /** Noise and throwing (P14): the aim, waves, things in flight, lit fuses. */
  private readonly noiseFx = new NoiseFx();
  private readonly fuseSpark = (x: number, y: number, z: number) => this.sparks.burst(x, y, z, 1, 0xffd27a, 1.1);
  private readonly snores = new Snores();
  /** Sleepers' heads this frame ([x, y, z] each), for the snores. */
  private readonly sleepers: number[] = [];
  /** Chair tiles (someone sitting there sits a little higher). */
  private readonly chairs = new Set<number>();
  private decor: DecorView | null = null;
  private structure: Structure | null = null;
  private security: Security | null = null;
  private minefield: Minefield | null = null;
  private island: Island | null = null;
  private riot = false;
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
  private readonly carried = new THREE.Vector3();
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
  /** Puddles for the janitor to mop (GDD §11): flat glossy pools, one instance each. */
  private readonly puddles = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.46, 20).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x7cc4f5, emissive: 0x2a6a96, roughness: 0.2, metalness: 0, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    16,
  );
  private puddlesRev = -1;
  private readonly m4 = new THREE.Matrix4();
  /** Easing onto the training equipment (0 standing where the sim has them, 1 on it). */
  private trainBlend = 0;
  /** Where the side games (P22) draw the player off their spot (an arm-wrestle's stance, leaning in to a lock), and the one wrestling them (and who), eased in and out. */
  private readonly gameOff = { x: 0, z: 0 };
  private readonly rivalOff = { x: 0, z: 0 };
  private rivalWho = -1;
  private readonly trainPos = new THREE.Vector3();
  private reps = 0;
  /** No camera drift, idle glances or dust. */
  reducedMotion = false;
  /** The camera jolts on blows, breaks and shots (a setting; never with reduced motion). */
  shakeOn = true;
  /** Called when a foot lands, with the ground kind. */
  onStep: (surface: number) => void = () => {};
  /** Called when food lands in a food fight (P17). */
  onSplat: (x: number, z: number) => void = () => {};

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
    this.scene.add(this.sun, this.sun.target, this.ambient, this.player.root, this.blobs.mesh, this.dust.mesh, this.snow.points, this.sparks.mesh, this.snores.group, this.guide.group, this.pickups.group, this.noiseFx.group, this.cones.group, this.ring, this.cup, this.puddles, this.weather.group, this.events.group, this.delivery.group, this.dogs.group, this.rats.group, this.smuggling.group, this.gamesView.group);
    this.delivery.onSound = (kind, x, z) => this.onDelivery(kind, x, z);
    // Food landing in a food fight: a splat of it.
    this.events.onSplat = (x, z, color) => {
      this.dust.puff(x, z, color, 5, 0.1);
      this.onSplat(x, z);
    };
    this.cup.visible = false;
    this.puddles.count = 0;
    this.puddles.renderOrder = 0.15;
    // Instances spread over the whole map: the mesh's own bounds (at the origin) would cull them.
    this.puddles.frustumCulled = false;
    this.setQuality(quality);
    addEventListener('resize', () => this.resize());
  }

  setQuality(q: Quality) {
    this.renderer.setPixelRatio(q.pixelRatio);
    const on = q.shadows > 0;
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.sun.shadow.radius = q.softness;
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
    // (Recompiled for the new settings now, the day's effects with them: auto quality steps down on phones mid-game.)
    if (this.world) this.warmDay();
  }

  setWorld(world: World) {
    this.snores.clear();
    // The escape camera ends with the game (the title's picture is the classic angle again).
    this.endCinema();
    this.carrying = false;
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
    if (this.security) {
      this.scene.remove(this.security.group);
      this.security.dispose();
    }
    if (this.decor) {
      this.scene.remove(this.decor.group);
      this.decor.dispose();
    }
    if (this.minefield) {
      this.scene.remove(this.minefield.group);
      this.minefield.dispose();
    }
    if (this.island) {
      this.scene.remove(this.island.group);
      this.island.dispose();
      this.island = null;
    }
    // The prison's look (snow at Stalag Flucht): the textures drawn from here on follow it.
    setTheme(world.def.theme ?? 'suburban');
    this.world = world;
    this.chairs.clear();
    for (const p of world.props) if (p.kind === 'chair') this.chairs.add(p.z * MAP_W + p.x);
    this.security = new Security(world);
    this.decor = new DecorView(world.def.decor ?? []);
    this.scene.add(this.decor.group);
    this.minefield = new Minefield(world);
    this.scene.add(this.minefield.group);
    // An island's sea and shore, the drawbridge, the helicopter (P12).
    if (world.def.theme === 'island') {
      this.island = new Island(world);
      this.scene.add(this.island.group);
    }
    this.scene.add(this.security.group);
    this.worldView = new WorldView(world);
    this.smuggling.setLampMaterial(this.worldView.archLight);
    this.structure = new Structure(world, this.worldView);
    this.underground = new Underground(world);
    this.scene.add(this.worldView.group, this.structure.group, this.structure.roofs, this.underground.group, this.underground.lantern);
    this.layer = -1;
    this.tilesRev = -1;
    this.wearRev = -1;
    this.showLayer(LAYER.GROUND);
    this.guide.world = world;
    this.cones.world = world;
    this.events.setWorld(world);
    this.delivery.setWorld(world);
    this.gamesView.setWorld(world);
    this.dogs.setDogs(
      handlersOf(world).map((h) => {
        const d = world.def.guards[h].dog!;
        return { x: d.kennel.x, z: d.kennel.z, face: d.kennel.face ?? 5, coat: d.coat };
      }),
    );
    this.weather.setWorld(world);
    this.warmDay();
    this.flash = 0;
    // (The first frame takes the weather as it is: a save loaded in fog isn't clear for its first seconds.)
    this.wxFresh = true;
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
    this.guardCast = beds.map((_, k) => new Character(guardLook(k, keys[k], !!this.world?.def.guards[k]?.riot)));
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
    this.noiseFx.group.position.y = LAYER_Y[layer];
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
      // Steel on steel: sparks off the fence or the grate.
      if (action === 'cut' || action === 'unscrew') this.sparks.burst(fx, y, fz, broke ? 16 : 6, 0xffc45a, broke ? 3.4 : 2.4);
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

  /** The throw being aimed (P14), or null: the reach, the arc, the landing ring, where its thud would carry. */
  setAim(a: AimView | null) {
    this.noiseFx.setAim(a);
  }

  /** A noise made (P14): a wave out from its tile as far as it carries, the tiles it reached lit (after `delay` s: a thrown thing lands first). */
  noise(kind: NoiseKind, tile: number, reach: number, tiles: readonly number[], heard: boolean, delay = 0) {
    this.noiseFx.noise(kind, tile, reach, tiles, heard, delay, !this.reducedMotion);
  }

  /** Something thrown by the player (P14): out of the hand, over to its tile (without motion it's simply there). */
  toss(item: number, to: number) {
    this.player.punch();
    if (this.reducedMotion) return;
    const p = this.player.root.position;
    this.noiseFx.toss(item, p.x, p.y + 1.1, p.z, to);
  }

  /** A firecracker going off (P14): a flash of sparks and smoke, the camera jolted. */
  bang(tile: number) {
    if (this.reducedMotion) return;
    const x = (tile % MAP_W) + 0.5;
    const z = Math.floor(tile / MAP_W) + 0.5;
    this.sparks.burst(x, 0.3, z, 22, 0xffd27a, 4);
    this.sparks.burst(x, 0.4, z, 10, 0xff5a3a, 3);
    this.dust.puff(x, z, 0xd8d2c8, 14, 0.5);
    this.shake = Math.max(this.shake, 0.9);
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

  /** The janitor's puddles, placed when they change; a slow shimmer. */
  private drawPuddles(f: Frame, time: number) {
    const mesh = this.puddles;
    mesh.visible = f.layer === LAYER.GROUND && f.puddles.length > 0;
    if (f.puddlesRev !== this.puddlesRev) {
      this.puddlesRev = f.puddlesRev;
      mesh.count = Math.min(f.puddles.length, 16);
      for (let k = 0; k < mesh.count; k++) {
        const t = f.puddles[k];
        // Each its own shape: stretched and turned by where it lies.
        const sx = 0.85 + ((t * 7) % 5) * 0.08;
        const sz = 0.7 + ((t * 3) % 4) * 0.08;
        this.m4.makeRotationY((t % 7) * 0.45).scale(this.v.set(sx, 1, sz)).setPosition((t % MAP_W) + 0.5, 0.02, Math.floor(t / MAP_W) + 0.5);
        mesh.setMatrixAt(k, this.m4);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (mesh.visible) (mesh.material as THREE.MeshStandardMaterial).opacity = 0.74 + (this.reducedMotion ? 0 : Math.sin(time * 2.2) * 0.06);
  }

  /** A point of the world (tiles) on screen (CSS pixels); null off screen. */
  screenAt(x: number, y: number, z: number, out: { x: number; y: number }): { x: number; y: number } | null {
    this.v.set(x, y, z).project(this.camera);
    if (this.v.z > 1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) return null;
    out.x = ((this.v.x + 1) / 2) * innerWidth;
    out.y = ((1 - this.v.y) / 2) * innerHeight;
    return out;
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

  /** Where the picture is slid to (CSS px), and where it's going: the player kept clear of an open panel. */
  private readonly shift = { x: 0, y: 0 };
  private readonly shiftGoal = { x: 0, y: 0 };

  /**
   * Slides the picture so the player shows in the part of the screen a panel leaves free (a
   * side panel in landscape, a bottom sheet in portrait); 0, 0 puts it back. Eased.
   */
  setShift(x: number, y: number) {
    this.shiftGoal.x = x;
    this.shiftGoal.y = y;
  }

  private easeShift(dt: number) {
    const k = this.reducedMotion ? 1 : Math.min(1, dt * 7);
    const dx = this.shiftGoal.x - this.shift.x;
    const dy = this.shiftGoal.y - this.shift.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      if (dx || dy) {
        this.shift.x = this.shiftGoal.x;
        this.shift.y = this.shiftGoal.y;
        this.applyZoom();
      }
      return;
    }
    this.shift.x += dx * k;
    this.shift.y += dy * k;
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
    // The picture slides by the shift (CSS px): the frustum moves the other way.
    const sx = (-this.shift.x / Math.max(1, innerWidth)) * 2 * half * aspect;
    const sy = (this.shift.y / Math.max(1, innerHeight)) * 2 * half;
    this.camera.left = -half * aspect + sx;
    this.camera.right = half * aspect + sx;
    this.camera.top = half + sy;
    this.camera.bottom = -half + sy;
    this.camera.updateProjectionMatrix();
    // The shadow box covers what the camera sees (the view is stretched along the ground by the tilt).
    // (Turned by the escape camera, the view's corners swing out: the box covers its diagonal.)
    const reach = this.cine ? Math.hypot(half * aspect, half * 1.25) : Math.max(half * aspect, half * 1.25);
    this.shadowHalf = Math.min(34, reach + 3 + Math.max(Math.abs(sx), Math.abs(sy) * 1.25));
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
    this.endCinema();
    this.target.set(x, 0, z);
    this.ahead.set(0, 0, 0);
    this.zoom = zoom;
    this.applyZoom();
  }

  /** Your prisoner (P16): the player is dressed again as them at the next frame. */
  setPrisoner(p: Prisoner | null) {
    this.prisoner = p;
    this.outfit = -1;
  }

  /**
   * The Intake's preview (P16): your prisoner (null: none) standing in the cell behind the
   * title, the camera close on them; the zoom the title had comes back after.
   */
  setPreview(p: Prisoner | null) {
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.dispose();
      this.model = null;
    } else if (p) this.titleZoom = this.zoomGoal;
    if (!p) {
      this.zoomGoal = this.titleZoom;
      return;
    }
    this.model = new Character(lookFor(p, INMATE_LOOK.outfit, false));
    this.scene.add(this.model.root);
    this.zoomGoal = PREVIEW_ZOOM;
  }

  /**
   * The escape camera (P16): a slow turn of up to 25° round the player and a pull-back, then
   * a hold; resolves when it's played (or skipped). With reduced motion: a still hold, 0.9 s.
   */
  cinema(long: boolean, still = this.reducedMotion): Promise<void> {
    this.cine?.done?.();
    return new Promise((resolve) => {
      this.cine = { t: 0, dur: still ? 0.9 : long ? 3.4 : 2.6, turn: (Math.random() < 0.5 ? -1 : 1) * CINEMA_TURN, zoom0: this.zoom, still, done: resolve, held: false };
    });
  }

  /** Cuts the escape camera short (a tap): it resolves now and holds where it got to. */
  skipCinema() {
    const c = this.cine;
    if (!c?.done) return;
    c.held = true;
    c.done();
    c.done = null;
  }

  /** The escape camera over (a new game, the title): the classic angle, and the zoom it started from. */
  private endCinema() {
    const c = this.cine;
    if (!c) return;
    c.done?.();
    this.cine = null;
    this.zoomGoal = c.zoom0;
  }

  /** Sets the zoom to ease to (a new game's), within limits. */
  zoomTo(z: number) {
    this.zoomGoal = THREE.MathUtils.clamp(z, ZOOM_MIN, ZOOM_MAX);
  }

  /** Dresses the player: your prisoner in the outfit (a white vest with none on; the guard cap with the guard's uniform). */
  private dress(outfit: number) {
    if (outfit === this.outfit) return;
    this.outfit = outfit;
    const old = this.player;
    this.player = new Character(lookFor(this.prisoner, outfit ? itemDef(outfit).color : null, outfit === GUARD_OUTFIT, outfit === INMATE_OUTFIT));
    this.player.root.position.copy(old.root.position);
    this.player.root.rotation.copy(old.root.rotation);
    this.scene.remove(old.root);
    old.dispose();
    this.scene.add(this.player.root);
  }

  /** Draws a frame of play: the camera follows the player, looking a little ahead. */
  draw(f: Frame, dt: number, time: number) {
    this.noiseFx.group.visible = true;
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
    this.player.hold(f.sleeping || f.knockedOut ? 0 : f.held, f.held ? itemGeometry(itemDef(f.held)) : null);
    const doing = f.knockedOut ? DOING.KNOCKED_OUT : f.sleeping ? DOING.SLEEP : f.layer === LAYER.VENTS ? DOING.CRAWL : f.doing;
    // Onto the treadmill's belt and off it again, eased; a rep pumps the arms.
    this.trainBlend += ((f.trainAt ? 1 : 0) - this.trainBlend) * Math.min(1, dt * 8);
    if (f.trainAt) this.trainPos.set(f.trainAt.x, f.trainAt.y, f.trainAt.z);
    const tb = this.trainBlend > 0.001 ? this.trainBlend : 0;
    if (f.reps !== this.reps) {
      if (f.reps > this.reps) this.player.pump();
      this.reps = f.reps;
    }
    let px = f.x + (this.trainPos.x - f.x) * tb;
    let pz = f.z + (this.trainPos.z - f.z) * tb;
    let facing = f.trainAt ? f.trainAt.facing : f.facing;
    // An arm-wrestle (P22): the two square on at arm's length, each a step to its own left so the
    // right hands meet on the line between them; the one winning leans in, the other gives way.
    // At a lock: leaning in to the door. Eased in and out (never a jump).
    const bout = f.games.bout;
    const rival = bout ? f.inmates[bout.who] : null;
    let gx = 0;
    let gz = 0;
    let rx = 0;
    let rz = 0;
    if (bout && rival) {
      const dx = rival.x - f.x;
      const dz = rival.z - f.z;
      const d = Math.hypot(dx, dz) || 1;
      const fx = dx / d;
      const fz = dz / d;
      const along = Math.max(-0.25, Math.min(0.35, (d - BOUT_GAP) / 2));
      const lean = BOUT_LEAN * bout.strain;
      // (A body's own left, the side away from the arm that grips: the player's (−fz, fx), the rival's the opposite.)
      gx = fx * (along + lean) - fz * BOUT_SIDE;
      gz = fz * (along + lean) + fx * BOUT_SIDE;
      rx = -fx * (along - lean) + fz * BOUT_SIDE;
      rz = -fz * (along - lean) - fx * BOUT_SIDE;
      facing = Math.atan2(dx, dz);
      this.rivalWho = bout.who;
      this.player.strain = bout.strain;
      this.player.shudder = bout.surge;
    } else if (f.doing === DOING.PICK) {
      gx = Math.sin(f.facing) * PICK_LEAN;
      gz = Math.cos(f.facing) * PICK_LEAN;
    }
    const ge = Math.min(1, dt * 8);
    this.gameOff.x += (gx - this.gameOff.x) * ge;
    this.gameOff.z += (gz - this.gameOff.z) * ge;
    this.rivalOff.x += (rx - this.rivalOff.x) * ge;
    this.rivalOff.z += (rz - this.rivalOff.z) * ge;
    if (!bout && Math.abs(this.rivalOff.x) + Math.abs(this.rivalOff.z) < 0.002) this.rivalWho = -1;
    px += this.gameOff.x;
    pz += this.gameOff.z;
    if (f.games.taps !== this.taps) {
      if (f.games.taps > this.taps) this.player.pump();
      this.taps = f.games.taps;
    }
    this.player.baseY = LAYER_Y[f.layer] + this.trainPos.y * tb;
    // Under a shower in the showers block: wet like the inmates.
    this.player.wet = f.doing === DOING.SHOWER;
    // Off an infirmary bed: the body eases up from that bed (not the cell's) until it stands.
    if (f.restBed) this.lastRest = f.restBed;
    else if (this.player.lying === 0) this.lastRest = null;
    // (A pet rat on the shoulder, P20: the arm under it holds still, glances stay small.)
    let perchedRat = false;
    for (const r of f.rats) if (r.mode === 'shoulder') perchedRat = true;
    this.player.perched = perchedRat;
    if (this.player.pose(px, pz, facing, f.moving, dt, time, !this.reducedMotion, doing, f.restBed ?? this.lastRest ?? this.beds[1])) {
      const theme = f.layer === LAYER.GROUND ? this.world?.def.theme : undefined;
      const dust = theme === 'alpine' ? SNOW_DUST : theme === 'desert' ? SAND_DUST : DUST;
      if (dust[f.surface] !== undefined && !this.reducedMotion && (f.layer === LAYER.GROUND || f.layer === LAYER.UNDER)) this.dust.puff(f.x, f.z, dust[f.surface], 2);
      this.onStep(f.surface);
    }
    // Look-ahead: up to a tile and a half in the walking direction, eased.
    const lead = f.moving && !this.reducedMotion ? 1.4 : 0;
    this.ahead.lerp(this.v.set(Math.sin(f.facing) * lead, 0, Math.cos(f.facing) * lead * 0.8), Math.min(1, dt * 2.2));
    // Carried somewhere far (solitary, the infirmary): cut there instead of panning across the map.
    // The camera rises and sinks with the layer (into the tunnels at once: it's another view).
    const y = LAYER_Y[f.layer];
    // (Aboard the raft or the helicopter, the camera follows them instead: below.)
    if (this.carrying) {
      /* followed below */
    } else if (Math.abs(this.target.x - f.x) + Math.abs(this.target.z - f.z) > 10 || f.layer === LAYER.UNDER) this.target.set(f.x, y, f.z);
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
      // On a chair, a little higher than on a canteen bench.
      const lift = (m.doing === DOING.SIT || m.doing === DOING.SIT_READ) && this.chairs.has(Math.floor(m.z) * MAP_W + Math.floor(m.x)) ? 0.1 : 0;
      c.baseY += (lift - c.baseY) * Math.min(1, dt * 8);
      // The one arm-wrestling the player (P22): square on to them in its stance, straining the other way (eased back to its spot after).
      if (bout && bout.who === k) {
        c.strain = -bout.strain;
        c.shudder = bout.surge;
        c.pose(m.x + this.rivalOff.x, m.z + this.rivalOff.z, Math.atan2(f.x - m.x, f.z - m.z), false, dt, time, !this.reducedMotion, DOING.WRESTLE, this.beds[m.cell]);
      } else if (this.rivalWho === k) c.pose(m.x + this.rivalOff.x, m.z + this.rivalOff.z, m.facing, m.moving, dt, time, !this.reducedMotion, m.doing, this.beds[m.cell]);
      else c.pose(m.x, m.z, m.facing, m.moving, dt, time, !this.reducedMotion, m.doing, this.beds[m.cell]);
      c.mark(m.angry ? '!' : '', dt, !this.reducedMotion);
      c.badge(f.layer === LAYER.GROUND ? m.badge : '', dt, !this.reducedMotion);
    });
    this.drawPuddles(f, time);
    if (this.minefield) {
      this.minefield.group.visible = f.layer === LAYER.GROUND || f.layer === LAYER.ROOF;
      this.minefield.update(f.craters);
    }
    this.doorsOpen.clear();
    f.guards.forEach((g, k) => {
      const c = this.guardCast[k];
      if (!c) return;
      c.root.visible = f.layer !== LAYER.UNDER;
      c.gait = g.pace;
      c.hold(g.held, g.held ? itemGeometry(itemDef(g.held)) : null);
      c.pose(g.x, g.z, g.facing, g.moving, dt, time, !this.reducedMotion, g.doing, this.guardBeds[k]);
      // "$" pops over a guard as it takes the money (and again once it's calm, still paid).
      // (Not over one floored while looking into something: a "$" already up stays, small.)
      c.mark(g.alert === ALERT.HOSTILE ? '!' : g.alert === ALERT.SUSPICIOUS ? '?' : g.away && (g.alert === ALERT.CALM || c.markChar === '$') ? '$' : '', dt, !this.reducedMotion);
      c.stir = g.stir;
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
    // Delivery day (P18): the vehicle in or on its road (the gates it passes open for it); the player hidden in it out of sight.
    const dv = f.delivery;
    this.delivery.group.visible = f.layer !== LAYER.UNDER;
    const near = !!this.world?.def.delivery && Math.hypot(f.x - this.world.def.delivery.tail.x - 0.5, f.z - this.world.def.delivery.tail.z - 0.5) < 4;
    this.delivery.update(dv, dt, time, !this.reducedMotion, near, f.layer === LAYER.GROUND);
    for (const t of this.delivery.opening) this.doorsOpen.add(t);
    if (dv.stowed) this.player.root.visible = false;
    // Z's over everyone asleep on the ground floor (the player too).
    this.sleepers.length = 0;
    if (f.layer === LAYER.GROUND) {
      if (f.sleeping) this.head(this.player);
      for (let k = 0; k < f.inmates.length; k++) if (f.inmates[k].doing === DOING.SLEEP && this.cast[k]) this.head(this.cast[k]);
      // (A guard dozing on its feet has its own Z's, over its cap: Character.)
      for (let k = 0; k < f.guards.length; k++) if (f.guards[k].doing === DOING.SLEEP && this.guardCast[k]) this.head(this.guardCast[k]);
    }
    // The dogs (P19): out of the picture below ground; asleep, Z's over them too.
    this.dogs.group.visible = f.layer !== LAYER.UNDER;
    this.dogs.update(f.dogs, f.scent, f.x, f.z, dt, time, !this.reducedMotion, f.layer === LAYER.GROUND ? this.sleepers : this.noSleepers, f.layer === LAYER.GROUND);
    this.noSleepers.length = 0;
    this.snores.update(dt, this.sleepers, this.sleepers.length / 3, !this.reducedMotion);
    // Snow over an alpine prison, out in the open (ground floor and roofs).
    const wx = f.weather;
    this.snow.update(dt, time, f.x, f.z, !this.reducedMotion && this.world?.def.theme === 'alpine' && (f.layer === LAYER.GROUND || f.layer === LAYER.ROOF), f.layer === LAYER.ROOF ? undefined : this.openSky, wx.rain >= 2 ? 3 : wx.windForce, wx.windAngle);
    // The weather (P17): no rain in the snow (a storm there is a blizzard of it, above).
    const alpine = this.world?.def.theme === 'alpine';
    this.wxLight = wx;
    let wxNow = wx;
    if (alpine && wx.rain) {
      Object.assign(this.wxSnow, wx);
      this.wxSnow.rain = 0;
      wxNow = this.wxSnow;
    }
    this.weather.update(wxNow, dt, time, f.x, f.z, LAYER_Y[f.layer], f.layer === LAYER.ROOF ? ROOF_HEIGHT + 0.7 : WALL_H + 0.45, this.night, !this.reducedMotion, f.layer === LAYER.UNDER, f.layer === LAYER.ROOF ? this.rainOnRoofs : this.rainBelow, f.layer === LAYER.ROOF ? this.wetRoofs : this.puddly, this.weatherView(f.layer, time));
    // The day's events: the film, the food, the inspectors trailing a guard.
    const spots = this.guardSpots;
    spots.length = f.guards.length;
    for (let k = 0; k < f.guards.length; k++) {
      const g = f.guards[k];
      const o = (spots[k] ??= { x: 0, z: 0, awake: false });
      o.x = g.x;
      o.z = g.z;
      o.awake = g.alert !== ALERT.NONE && g.doing !== DOING.KNOCKED_OUT;
    }
    this.inspecting = this.events.update(f.events, dt, time, spots, f.inmates, f.layer === LAYER.GROUND, !this.reducedMotion, !this.reducedMotion, f.x, f.z, f.layer !== LAYER.UNDER, this.security?.powerLevel ?? 1);
    this.sparks.update(dt);
    this.drawLock(f, dt, time);
    this.cones.update(f.guards, dt, this.night, !this.reducedMotion);
    // Cameras, searchlights and snipers belong to the ground floor (from below or in the ducts, out of the picture).
    if (this.security) {
      this.security.group.visible = f.layer !== LAYER.UNDER;
      this.security.update(f.security, dt, time, this.night, !this.reducedMotion);
    }
    this.riot = f.takeover;
    this.carrying = false;
    if (this.island) {
      this.island.group.visible = f.layer !== LAYER.UNDER;
      this.island.update(dt, time, f.minuteOfDay, f.takeover, !this.reducedMotion, f.delivery);
      // Leaving: on the raft as it drifts out, or aboard the helicopter (out of sight).
      const on = this.island.carry(this.carried);
      this.carrying = !!on;
      if (on) {
        this.player.root.position.copy(on);
        // The camera goes with them (the helicopter climbs out of a fixed shot).
        this.target.lerp(this.v.set(on.x, on.y * 0.6, on.z), Math.min(1, dt * 3));
      }
      this.player.root.visible = !this.island.aboard && this.player.root.visible;
    }
    // Away in the delivery's truck (P18): the camera follows it out.
    const ride = this.delivery.carry(this.carried);
    if (ride) {
      this.carrying = true;
      this.player.root.visible = false;
      this.target.lerp(this.v.set(ride.x, 0, ride.z), Math.min(1, dt * 3));
    }
    // The rats (P20), after the player has gone wherever they go (a raft, the helicopter, a truck): on the floor seen from anywhere but a tunnel;
    // on the shoulder of a player up and about (not lying, not crawling, not in a tunnel), turning with them.
    this.rats.group.visible = true;
    // (Hands busy, it ducks into a pocket a moment: never an arm through it.)
    const perch = this.player.perched && this.player.root.visible && !f.sleeping && !f.knockedOut && (f.layer === LAYER.GROUND || f.layer === LAYER.ROOF) && this.player.lying < 0.2 && this.player.crawling < 0.1 && !this.player.armsBusy ? this.player.shoulder(this.shoulderAt) : null;
    this.rats.update(f.rats, perch, this.player.root.rotation.y, dt, time, !this.reducedMotion, f.layer !== LAYER.UNDER);
    // Smuggling (P21): the drone, the drops, visiting day's arches and visitors.
    // (From the vents and the roof the ground floor shows too, its visitors and arches with it.)
    this.smuggling.group.visible = f.layer !== LAYER.UNDER;
    this.smuggling.update(f.smuggle, dt, time, !this.reducedMotion, f.layer !== LAYER.UNDER);
    // The side games (P22): dice on the ground floor, sports day's bunting (seen from the roofs too).
    this.gamesView.group.visible = f.layer !== LAYER.UNDER;
    this.gamesView.update(f.games, time, !this.reducedMotion, f.layer !== LAYER.UNDER);
    // (Its buzz unheard below ground and in the vents, where it isn't drawn either.)
    const drone = f.layer === LAYER.GROUND || f.layer === LAYER.ROOF ? this.smuggling.droneAt : null;
    if (drone && (this.buzzClock -= dt) <= 0) {
      this.buzzClock = 1.3;
      this.onDrone(drone.x, drone.z);
    } else if (!drone) this.buzzClock = 0;
    this.noiseFx.update(dt, time, f.layer === LAYER.GROUND ? f.fuses : NO_FUSES, FIRECRACKER, !this.reducedMotion, this.fuseSpark);
    this.pickups.update(f.ground, f.groundRev, f.focus, dt, time, !this.reducedMotion, this.noiseFx.landing);
    this.guide.setPath(f.guide);
    this.guide.setTap(f.tap);
    this.guide.update(dt, time, f, !this.reducedMotion);
    this.alarm += ((f.alarm ? 1 : 0) - this.alarm) * Math.min(1, dt * 3);
    this.render(f.minuteOfDay, dt, cut ? this.feet : null, time);
  }

  /** A sleeper's head, for the snores. */
  private head(c: Character) {
    this.sleepers.push(c.root.position.x, c.root.position.y + 0.85, c.root.position.z);
  }

  /** A sniper's shot (GDD §5.6): the tracer and flash, dust where a warning shot lands, a jolt when it hits. */
  shot(tower: number, x: number, z: number, hit: boolean) {
    this.security?.shot(tower, x, z, hit);
    if (this.reducedMotion) return;
    if (hit) this.shake = Math.max(this.shake, 0.8);
    else {
      this.dust.puff(x + 0.9, z + 0.6, 0x9a8a6a, 10, 0.8);
      this.sparks.burst(x + 0.9, 0.05, z + 0.6, 7, 0xffe2a0, 2.6);
    }
  }

  /** Away over the sea (P12): the raft pushes off the pier, or the helicopter lifts off with the player aboard; or (P18) the delivery's vehicle leaves with them hidden in it. */
  depart(kind: 'raft' | 'helicopter' | 'stowaway') {
    const p = this.player.root.position;
    if (kind === 'stowaway') {
      if (this.world?.def.delivery?.vehicle === 'helicopter') this.island?.depart('helicopter', p.x, p.z);
      else this.delivery.depart();
      return;
    }
    this.island?.depart(kind, p.x, p.z);
  }

  /** Delivery day's sounds (the play layer plays them): reversing beeps, the tailgate, the engine. */
  onDelivery: (kind: 'beep' | 'gate' | 'engine', x: number, z: number) => void = () => {};

  /** A landmine goes off (P11): a fireball of sparks, a column of sand and smoke, the hardest jolt. */
  blast(tile: number) {
    const x = (tile % MAP_W) + 0.5;
    const z = Math.floor(tile / MAP_W) + 0.5;
    this.shake = Math.max(this.shake, 1.8);
    if (this.reducedMotion) return;
    this.sparks.burst(x, 0.3, z, 40, 0xffa53a, 6.5);
    this.sparks.burst(x, 0.5, z, 18, 0xfff0c0, 4.5);
    this.dust.puff(x, z, 0xc8a36a, 34, 0.3);
    this.dust.puff(x, z, 0x5b4a3a, 18, 1.1);
  }

  /** The electric fence bites (GDD §5.5): a shower of blue-white sparks off the player and a hard jolt. */
  shock() {
    const p = this.player.root.position;
    this.shake = Math.max(this.shake, 1);
    if (this.reducedMotion) return;
    this.sparks.burst(p.x, 0.9, p.z, 22, 0x9fd8ff, 4);
    this.sparks.burst(p.x, 1.2, p.z, 10, 0xffffff, 3);
  }

  /** A detector arch tripped: its lamps flash. */
  tripArch() {
    this.worldView?.tripArch();
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
    // Nothing of a game's noise behind the title (a lit firecracker, an aim, a wave).
    this.noiseFx.group.visible = false;
    this.rats.group.visible = false;
    this.smuggling.clear();
    this.gamesView.update(null, 0, false, false);
    this.player.root.visible = false;
    this.ring.visible = false;
    this.cup.visible = false;
    this.cupT = 1;
    this.doorsOpen.clear();
    this.cones.update([], dt, 0, false);
    this.alarm = 0;
    this.riot = false;
    if (this.security) this.security.group.visible = false;
    this.pickups.update([], -1, null, dt, time, false);
    this.guide.setPath(null);
    this.guide.setTap(null);
    this.guide.update(dt, time, this.target, false);
    // The Intake (P16): your prisoner in their cell, the camera close (the walls in front cut away).
    // In and out of it eased (the angle, the target), at once with reduced motion.
    const model = this.model;
    const k = this.reducedMotion ? 1 : Math.min(1, dt * 4);
    this.previewBlend += ((model ? 1 : 0) - this.previewBlend) * k;
    if (model && this.world) {
      const sp = this.world.def.spawn;
      const sway = this.reducedMotion ? 0 : Math.sin(time * 0.6) * 0.35;
      model.pose(sp.x + 0.5, sp.z + 0.5, this.previewTurn + sway, false, dt, time, !this.reducedMotion, DOING.NOTHING);
      this.target.lerp(this.v.set(sp.x + 0.5, 0.75, sp.z + 0.5), this.reducedMotion ? 1 : Math.min(1, dt * 6));
      this.feet.set(sp.x + 0.5, 0, sp.z + 0.5);
    } else {
      const a = this.reducedMotion ? 1.2 : time * 0.05;
      this.v.set(MAP_W / 2 + Math.cos(a) * 14, 0, MAP_H / 2 - 4 + Math.sin(a * 1.3) * 10);
      if (this.previewBlend > 0.002) this.target.lerp(this.v, k);
      else this.target.copy(this.v);
    }
    // Snow falling over an alpine prison behind the title too (no day's weather there).
    this.snow.update(dt, time, this.target.x, this.target.z, !this.reducedMotion && this.world?.def.theme === 'alpine', this.openSky);
    this.wxLight = null;
    this.weather.update(NO_WEATHER, dt, time, this.target.x, this.target.z, 0, WALL_H + 0.45, 0, !this.reducedMotion, false, this.rainBelow, this.puddly);
    this.inspecting = this.events.update(NO_EVENTS, dt, time, [], [], false, false, false);
    this.delivery.update(null, dt, time, false, false);
    this.render(600, dt, model ? this.feet : null, time);
  }

  private render(minute: number, dt: number, focus: THREE.Vector3 | null, time: number) {
    this.easeShift(dt);
    if (Math.abs(this.zoom - this.zoomGoal) > 1e-4) {
      this.zoom += (this.zoomGoal - this.zoom) * Math.min(1, dt * 10);
      this.applyZoom();
    }
    const night = (this.night = this.light(minute));
    // The weather first: a lockdown's red pulses through a storm's grey (not washed out by it).
    this.weatherLight(dt);
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
    this.decor?.update(this.security?.group.visible ? this.security.powerLevel : 1, time, this.layer === LAYER.VENTS ? 0.3 : 1, this.reducedMotion);
    // Decor belongs to the ground floor (out of the picture from the tunnels).
    if (this.decor) this.decor.group.visible = this.layer !== LAYER.UNDER;
    this.worldView?.update(dt, night, this.doorsOpen, this.security?.group.visible ? this.security.powerLevel : 1, this.riot, this.security?.group.visible ? this.security.arches : 1);
    this.dust.update(dt);
    const c = this.cine;
    this.cineOffset.copy(CAMERA_OFFSET);
    if (this.previewBlend > 0.002) this.cineOffset.lerp(PREVIEW_OFFSET, this.previewBlend).setLength(60);
    if (c) {
      // Skipped: it holds where it got to.
      if (!c.held) c.t = Math.min(c.dur, c.t + dt);
      const e = c.still ? 0 : THREE.MathUtils.smootherstep(c.t / c.dur, 0, 1);
      this.cineOffset.applyAxisAngle(UP, c.turn * e);
      if (!c.still) {
        this.zoom = this.zoomGoal = Math.max(ZOOM_MIN, c.zoom0 * (1 - CINEMA_PULL * e));
        this.applyZoom();
      }
      if (c.t >= c.dur && c.done) {
        c.done();
        c.done = null;
      }
    }
    this.camera.position.copy(this.target).add(this.cineOffset);
    this.camera.lookAt(this.target);
    if (this.shake > 0.001) {
      // A short jolt on a strike, eased away (none with the setting off or reduced motion).
      const a = this.shakeOn && !this.reducedMotion ? this.shake * 0.06 : 0;
      this.camera.position.x += Math.sin(time * 91) * a;
      this.camera.position.y += Math.cos(time * 77) * a;
      this.shake = Math.max(0, this.shake - dt * 5);
    }
    this.placeSun(minute);
    const stage = this.onStage;
    stage.length = 0;
    stage.push(this.player, ...this.cast, ...this.guardCast, ...this.inspecting);
    if (this.model) stage.push(this.model);
    this.blobs.update(stage);
    updateOcclusion(this.renderer, this.camera, focus, dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** How the view sees the weather (P17): the rain's box as wide as the view, the lockdown's red as it pulses, the layer, where a point higher up lands on the ground (the camera's angle, turned by the escape camera). */
  private readonly wxView: WeatherView = { span: 40, alarm: 0, vents: false, roof: false, lx: 0, lz: 24 / 38 };
  private weatherView(layer: number, time: number): WeatherView {
    const v = this.wxView;
    v.span = Math.max(this.camera.right - this.camera.left, (this.camera.top - this.camera.bottom) * 1.6) + 6;
    const pulse = this.reducedMotion ? 0.5 : (Math.sin(time * 5) + 1) / 2;
    v.alarm = this.alarm * (0.25 + pulse * 0.45);
    v.vents = layer === LAYER.VENTS;
    v.roof = layer === LAYER.ROOF;
    const o = this.cineOffset;
    if (o.y > 1) {
      v.lx = o.x / o.y;
      v.lz = o.z / o.y;
    }
    return v;
  }

  /** The day's effects compiled while nothing is on screen (a new game; new graphics settings), not on a phone in the middle of a food fight. */
  private warmDay() {
    this.weather.warm(true);
    this.events.warm(true);
    this.delivery.warm(true);
    this.gamesView.warm(true);
    this.renderer.compile(this.scene, this.camera);
    this.weather.warm(false);
    this.events.warm(false);
    this.delivery.warm(false);
    this.gamesView.warm(false);
  }

  /** Who the day's events put on stage this frame (the inspectors), for the contact shadows. */
  private inspecting: Character[] = [];

  /**
   * The weather's light (P17): rain and storms dim and grey the day, fog softens it, a
   * heatwave warms it to a haze; lightning flashes it white for an instant.
   */
  private weatherLight(dt: number) {
    const w = this.wxLight;
    // Each part eases in and out (the fog lifting, a storm rolling in at 08:00), at once with reduced motion.
    const k = this.reducedMotion || (this.wxFresh && w) ? 1 : Math.min(1, dt * 0.8);
    if (w) this.wxFresh = false;
    const g = this.wxEased;
    g.grey += ((w ? (w.rain >= 2 ? 0.65 : w.rain ? 0.45 : 0) : 0) - g.grey) * k;
    g.storm += ((w && w.rain >= 2 ? 1 : 0) - g.storm) * k;
    g.fog += ((w ? w.fog : 0) - g.fog) * k;
    // (The heat's haze goes with the daylight.)
    g.heat += ((w?.heat ? 1 - this.night : 0) - g.heat) * k;
    if (g.grey > 0.002) {
      const rain = g.grey / 0.45;
      const sun = 1 - Math.min(1, rain) * 0.4 - g.storm * 0.22;
      this.sun.intensity *= sun;
      this.ambient.intensity *= 1 - Math.min(1, rain) * 0.14 - g.storm * 0.14;
      this.sky.lerp(this.c1.set(0x4a5462), g.grey);
      this.sun.color.lerp(this.c1.set(0xc6d2e2), g.grey * 0.6);
    }
    if (g.fog > 0.002) {
      this.sun.intensity *= 1 - 0.25 * g.fog;
      this.sky.lerp(this.c1.set(0x9aa6b2), 0.6 * g.fog * (1 - this.night));
    }
    if (g.heat > 0.002) {
      this.sun.intensity *= 1 + 0.08 * g.heat;
      this.sun.color.lerp(this.c1.set(0xffc27a), 0.4 * g.heat);
      this.sky.lerp(this.c1.set(0xe8c79a), 0.35 * g.heat);
    }
    if (this.flash > 0.001) {
      this.ambient.intensity += this.flash * 2.6;
      this.sky.lerp(this.c1.set(0xe8f0ff), this.flash * 0.7);
      this.flash = Math.max(0, this.flash - dt * 5);
    }
  }

  /** A bolt of lightning (P17): the scene flashes white (not with reduced motion). */
  lightning() {
    if (!this.reducedMotion) this.flash = 1;
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
