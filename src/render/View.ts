import * as THREE from 'three';
import type { Pitch } from '../content/prisons/types';
import { TILE, TILE_INFO } from '../sim/world/tiles';
import { LAYER, MAP_H, MAP_W, type World } from '../sim/world/World';
import { Character, guardLook, INMATE_LOOK, inmateLook, type BadgeKind, type BedPose, type Look } from './Character';
import { Cones } from './Cones';
import { Security, type SecurityFrame } from './Security';
import { ALERT } from '../sim/systems/guards';
import { DOING } from '../sim/systems/inmates';
import { Dust } from './Dust';
import { Island } from './Island';
import { Snores, Sparks } from './Particles';
import { DecorView } from './decor';
import { rollCallLayer } from './ground';
import { Minefield } from './Minefield';
import { Guide } from './Guide';
import { itemDef, itemNumber } from '../content/items';
import type { Prisoner } from '../content/prisoner';
import { lookFor } from './prisonerLook';
import { itemGeometry } from './itemModels';
import { Pickups, type Focus, type GroundItem } from './Pickups';
import { updateOcclusion } from './occlusion';
import { WorldView } from './WorldView';
import { LAYER_Y, ROOF_Y as ROOF_HEIGHT, Structure } from './Structure';
import { NoiseFx, type AimView } from './Noise';
import { FIRECRACKER } from '../sim/systems/structure';
import { Underground } from './Underground';
import { setTheme } from './textures';
import { skipEmpty } from './batch';
import { Blobs } from './Blobs';
import { Snowfall } from './Snow';
import { Weather, type WeatherFrame, type WeatherView } from './Weather';
import { Delivery, type DeliveryFrame } from './Delivery';
import { DayEvents, type EventsFrame } from './DayEvents';
import { HolidaysView, NO_HOLIDAY, type HolidayFrame } from './Holidays';
import { WALL_H } from './WorldView';
import { pitchFraming, SCREEN_COLS, SCREEN_ROWS, ZOOM_MAX, ZOOM_MIN } from './pitchFrame';
import type { NoiseKind } from '../sim/state';
import { Dogs, type DogFrame } from './Dog';
import { Rats, type RatFrame } from './Rat';
import { GetawayView, type GetawayFrame } from './Getaway';
import { SmuggleView, type SmuggleFrame } from './Smuggling';
import { GamesView, type GamesFrame } from './Games';
import { PastimesView, type PastimesFrame } from './Pastimes';
import { LongView, type LongFrame } from './Long';
import { TeamView, type TeamFrame } from './Team';
import { GroundsView } from './Grounds';
import { NightsView, type NightsFrame } from './Nights';
import { PhoneView, type PhoneFrame } from './Phone';
import { KioskView, type KioskFrame } from './Kiosk';
import { OddJobsView, type OddJobsFrame } from './OddJobs';
import { ReleaseView, type ReleaseFrame } from './Release';
import { handlersOf } from '../sim/systems/k9';

/** The old-timer's hair (P27): white with age. */
const ELDER_HAIR = 0xd8d3c8;

/** What the view needs from the simulation each frame (positions in tiles, already interpolated). */
export interface Frame {
  x: number;
  z: number;
  /** Radians, 0 = facing +z (south). */
  facing: number;
  moving: boolean;
  /** Game time of day in minutes, fractional (lighting). */
  minuteOfDay: number;
  /** Roll call is on or minutes off, or a fire drill musters there (P29: its paint over a football pitch shows only then). */
  rollCall: boolean;
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
  /** P31: the gardener's planters at work (prop index → how far the seedlings have grown, 0–1); the rest grown. */
  planters: ReadonlyMap<number, number>;
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
  /** Card sharks (P27): the court's lit spot, the ball, cards on the ground, the old-timer's board. */
  pastimes: PastimesFrame;
  /** Long games (P28): the garden, the rat track and its racers, the pet's laps, tipsy (null: none yet). */
  long: LongFrame | null;
  /** Team & ink (P29): the pitch and the ball. */
  team: TeamFrame;
  /** Stage nights (P30): the stage set up, the quiz's buzzers. */
  nights: NightsFrame;
  /** The pay phone (P34): its handset off the hook, Lou's car waiting on the road. */
  phone: PhoneFrame;
  /** The internet kiosk (P35): logged in or not, the family's drawings over the player's bed. */
  kiosk: KioskFrame;
  /** The odd jobs board (P40): the cards still pinned up today, the player's job tag. */
  oddjobs: OddJobsFrame;
  /** The release desk (P36): the name called, the way out open. */
  release: ReleaseFrame;
  /** P29: the designs inked on the player's arms. */
  inked: readonly number[];
  /** Bluff & glider (P24): the checkpoint's shift change and the player waved through, a glide's preview. */
  getaway: GetawayFrame;
  /** v2.21 (P42): the holiday dressed for, the water fight, New Year's fireworks. */
  holiday: HolidayFrame;
}

const NO_FUSES: readonly number[] = [];
/** How far apart two arm-wrestlers stand, centre to centre (tiles): their right hands, each reaching about half of it, meet between them. */
const BOUT_GAP = 1.0;
/** How far each steps to its own left (tiles), so the right hands (a shoulder's width off the middle) meet on the line between them. */
const BOUT_SIDE = 0.21;
/** How far the one winning leans in, and the other gives way, at the most (tiles). */
const BOUT_LEAN = 0.09;
/** Where the player stands to pick a lock: this far from the door tile's middle (the hands at its face, the pick in the keyhole). */
const PICK_STAND = 0.7;
const NO_WEATHER: WeatherFrame = { rain: 0, fog: 0, heat: false, windAngle: 0, windForce: 0, snow: false };
const NO_EVENTS: EventsFrame = { movie: false, foodFight: false, inspection: false };

interface GuardFrame {
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

interface InmateFrame {
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
const COSTUME = itemNumber('costume');
const OWN_CLOTHES = itemNumber('own_clothes');
const OWN_JEANS = 0x4a6a96;
/** The escape camera (P16): how far it turns round the player (radians) and pulls back (a share of the zoom). */
const CINEMA_TURN = (25 * Math.PI) / 180;
const CINEMA_PULL = 0.3;
/** The Intake preview's zoom (P16): close on your prisoner in their cell. */
const PREVIEW_ZOOM = 4.2;
/** The Intake's camera: lower than play's, nearly face on (a mugshot, not a map). */
const PREVIEW_OFFSET = new THREE.Vector3(0, 16, 24).normalize().multiplyScalar(60);

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
  /** The football pitch in use with it (setWorld). */
  private pitch: Pitch | null = null;
  player = new Character(INMATE_LOOK);
  /** How the player is drawn now (the HUD's portrait follows it: portrait.ts). */
  playerLook: Look = INMATE_LOOK;
  private outfit = -1;
  /** The tattoos inked in the prison the player is drawn with (P29). */
  private inkedShown: number[] = [];
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
  /** Where everyone stands this frame (x, z pairs, tiles): the trees' leaves fade over them. */
  private readonly people: number[] = [];
  private readonly snow = new Snowfall();
  /** The day (P17): rain, ripples and fog; the movie screen, the food fight, the inspectors. */
  private readonly weather = new Weather();
  private readonly events = new DayEvents();
  /** P42: the holidays' decor, sprays and fireworks; the holiday behind the title (the date's, as Settings have it). */
  private readonly holidaysView = new HolidaysView();
  private titleHoliday = 0;
  /** Delivery day's vehicle (P18; Irongate's helicopter is the island's). */
  private readonly delivery = new Delivery();
  /** The guard dogs, their kennels, the trail (P19). */
  private readonly dogs = new Dogs();
  /** The rats (P20), and where the player's shoulder is this frame. */
  private readonly rats = new Rats();
  /** Smuggling (P21): the drone, the drops' beacons, visiting day. */
  private readonly smuggling = new SmuggleView();
  /** Bluff & glider (P24): the checkpoint's booth, the glide's preview and flight. */
  private readonly getaway = new GetawayView();
  private readonly flyAt = new THREE.Vector3();
  private readonly gamesView = new GamesView();
  private readonly pastimesView = new PastimesView();
  private readonly longView = new LongView();
  private readonly teamView = new TeamView();
  /** The player where they're drawn this frame (the match's ring under them). */
  private readonly meAt = { x: 0, z: 0 };
  /** P31: the sports ground's track and court paint, the garden's crops. */
  private readonly groundsView = new GroundsView();
  private readonly nightsView = new NightsView();
  /** P34: the pay phone, Lou's car, the diversion's beacon. */
  private readonly phoneView = new PhoneView();
  /** P35: the internet kiosk on the library wall, the family's drawings over the player's bed. */
  private readonly kioskView = new KioskView();
  /** P40: the odd jobs board on the canteen wall. */
  private readonly oddJobsView = new OddJobsView();
  /** P36: the release desk's sign, tray and lamp. */
  private readonly releaseView = new ReleaseView();
  /** How far the tipsy sway is in (0–1, eased). */
  private tipsySway = 0;
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
  private readonly wxSnow: WeatherFrame = { rain: 0, fog: 0, heat: false, windAngle: 0, windForce: 0, snow: false };
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
  /** The roll call's paint over a football pitch (P29), and how far it's faded in (0 … 1). */
  private rollCallPaint: THREE.Mesh | null = null;
  private rollCallShown = 0;
  private structure: Structure | null = null;
  private security: Security | null = null;
  private minefield: Minefield | null = null;
  private island: Island | null = null;
  private riot = false;
  private underground: Underground | null = null;
  /** The last prison's parts, taken off screen and freed after the next frame (setWorld). */
  private readonly retired: Array<() => void> = [];
  /** Frees something after the next frame (as a world change does). */
  private readonly later = (dispose: () => void) => void this.retired.push(dispose);
  /** The holiday behind the title (P42: the date's, as Settings have it; 0 none). */
  setHoliday(kind: number) {
    this.titleHoliday = kind;
  }
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
  /** P29, a match: the zoom that fits the whole pitch on screen (0: none), never closer than the player's own zoom. */
  private fitZoom = 0;
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
  /** The dice partner's throw seen (its fling plays once). */
  private rivalThrew = false;
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
    this.scene.add(this.sun, this.sun.target, this.ambient, this.player.root, this.blobs.mesh, this.dust.mesh, this.snow.points, this.sparks.mesh, this.snores.group, this.guide.group, this.pickups.group, this.noiseFx.group, this.cones.group, this.ring, this.cup, this.puddles, this.weather.group, this.events.group, this.delivery.group, this.dogs.group, this.rats.group, this.smuggling.group, this.gamesView.group, this.pastimesView.group, this.longView.group, this.teamView.group, this.groundsView.group, this.nightsView.group, this.phoneView.group, this.kioskView.group, this.oddJobsView.group, this.holidaysView.group, this.releaseView.group, this.getaway.group);
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

  /**
   * Puts a prison on screen. The old prison's meshes are let go only after the new one's first
   * frame (`retired`): its materials' shaders are still in use when the new ones ask for the
   * same, so none is compiled again (a world change used to recompile about twenty). The same
   * World staged again (P25: a replay's Watch again, its state restored in place) keeps the
   * floors, walls, doors, furniture and decor built for it, redrawn from the state; the rest is
   * made afresh.
   */
  setWorld(world: World, pitch: Pitch | null = world.def.leisure?.pitch ?? null) {
    this.snores.clear();
    // The escape camera ends with the game (the title's picture is the classic angle again).
    this.endCinema();
    this.carrying = false;
    const same = world === this.world && pitch === this.pitch && !!this.worldView && !!this.structure && !!this.decor;
    const retire = (objects: THREE.Object3D[], dispose: () => void) => {
      this.scene.remove(...objects);
      this.retired.push(dispose);
    };
    if (this.worldView && !same) {
      const old = this.worldView;
      retire([old.group], () => old.dispose());
    }
    if (this.structure && !same) {
      const old = this.structure;
      retire([old.group, old.roofs], () => old.dispose());
    }
    if (this.decor && !same) {
      const old = this.decor;
      retire([old.group], () => old.dispose());
    }
    if (this.underground) {
      const old = this.underground;
      retire([old.group, old.lantern], () => old.dispose());
    }
    if (this.security) {
      const old = this.security;
      retire([old.group], () => old.dispose());
    }
    if (this.rollCallPaint) {
      const old = this.rollCallPaint;
      retire([old], () => {
        old.geometry.dispose();
        const m = old.material as THREE.MeshBasicMaterial;
        m.map?.dispose();
        m.dispose();
      });
      this.rollCallPaint = null;
    }
    if (this.minefield) {
      const old = this.minefield;
      retire([old.group], () => old.dispose());
    }
    if (this.island) {
      const old = this.island;
      retire([old.group], () => old.dispose());
      this.island = null;
    }
    // The prison's look (snow at Stalag Flucht): the textures drawn from here on follow it.
    setTheme(world.def.theme ?? 'suburban');
    this.world = world;
    this.pitch = pitch;
    this.chairs.clear();
    for (const p of world.props) if (p.kind === 'chair') this.chairs.add(p.z * MAP_W + p.x);
    this.security = new Security(world);
    if (!same) {
      this.decor = new DecorView(world.def.decor ?? []);
      this.scene.add(this.decor.group);
    }
    // (P29: the roll call's paint where it crosses the football pitch, shown for roll call only.)
    this.rollCallPaint = rollCallLayer(world, pitch);
    this.rollCallShown = 0;
    if (this.rollCallPaint) this.scene.add(this.rollCallPaint);
    this.minefield = new Minefield(world);
    this.scene.add(this.minefield.group);
    // An island's sea and shore, the drawbridge, the helicopter (P12).
    if (world.def.theme === 'island') {
      this.island = new Island(world);
      this.scene.add(this.island.group);
    }
    this.scene.add(this.security.group);
    if (same) {
      // (Walls, fences and the damage follow the tiles at the next frame: tilesRev below.)
      this.worldView!.reset();
    } else {
      this.worldView = new WorldView(world, pitch);
      this.structure = new Structure(world, this.worldView);
      this.scene.add(this.worldView.group, this.structure.group, this.structure.roofs);
    }
    this.smuggling.setLampMaterial(this.worldView!.archLight);
    this.underground = new Underground(world);
    this.scene.add(this.underground.group, this.underground.lantern);
    this.layer = -1;
    this.tilesRev = -1;
    this.wearRev = -1;
    this.showLayer(LAYER.GROUND);
    this.guide.world = world;
    this.cones.world = world;
    // (Their last prison's parts freed after the next frame, as the rest.)
    const later = this.later;
    this.events.setWorld(world, later);
    this.delivery.setWorld(world, later);
    this.gamesView.setWorld(world, later);
    this.teamView.setWorld(pitch, world.def.theme ?? 'suburban', later);
    this.longView.setWorld(later);
    this.groundsView.setWorld(world, later);
    this.pastimesView.setWorld(world, pitch);
    this.getaway.setWorld(world);
    this.phoneView.setWorld(world, later);
    this.kioskView.setWorld(world, later);
    this.oddJobsView.setWorld(world, later);
    this.releaseView.setWorld(world, later);
    this.holidaysView.setWorld(world, later);
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
    for (const c of this.guardCast) this.retireCharacter(c);
    this.guardCast = beds.map((_, k) => new Character(guardLook(k, keys[k], !!this.world?.def.guards[k]?.riot)));
    this.guardBeds = beds;
    for (const c of this.guardCast) this.scene.add(c.root);
    this.cones.setCount(beds.length);
  }

  /** The other inmates: one character each, looks varied by cell, legs paced by walking speed (P27: the old-timer's hair gone white). */
  setCast(cast: Array<{ cell: number; gait: number; elder?: boolean }> | 0) {
    for (const c of this.cast) this.retireCharacter(c);
    this.cast = cast ? cast.map((c) => new Character({ ...inmateLook(c.cell), ...(c.elder ? { hair: ELDER_HAIR, hairStyle: 1, beard: 3 } : {}), gait: c.gait })) : [];
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

  /** Off a roof on a glider (P24): the flight from the roof tile to the ground tile; resolves once it's down (at once without motion). */
  glide(from: number, to: number, dist: number, out: boolean): Promise<void> {
    return new Promise((done) => this.getaway.glide(from, to, dist, out, !this.reducedMotion, done));
  }

  /** A glide still in the air on screen (P24: the player's input waits for it to land). */
  get gliding(): boolean {
    return this.getaway.flying;
  }

  /** A replay's jump in time (P25): the weather shown as it is at once, not eased in from the moment before. */
  jumped() {
    this.wxFresh = true;
  }

  /** Resolves once a glide in the air is down (P24: the escape camera waits for it). */
  glideDown(): Promise<void> {
    return new Promise((done) => this.getaway.whenDown(done));
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

  /** The lights' level (a power cut dims them); full where there's no security to cut. */
  private get powerLevel(): number {
    return this.security?.group.visible ? this.security.powerLevel : 1;
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
    return c ? this.screenAt(c.root.position.x, c.root.position.y + height, c.root.position.z, out) : null;
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

  /**
   * A match on (P29): both goals stay in the picture. The zoom eases out until the pitch (a tile
   * round it) fits across the screen, as on a phone held upright, and the look-ahead is bent so
   * the camera stays between the goals (following the player as far as the pitch allows). The
   * player is kept in the box too: off the pitch (up to PITCH_LEAVE tiles while the match is on),
   * the picture widens to hold both, and where it can't, the player stays on screen.
   */
  private framePitch(f: Frame, dt: number) {
    const p = f.team.pitch;
    if (!p || !f.team.ball || f.layer !== LAYER.GROUND) {
      this.fitZoom = 0;
      return;
    }
    const aim = pitchFraming(p, f.x, f.z, this.ahead, this.zoom, innerWidth / Math.max(1, innerHeight));
    this.fitZoom = aim.fit;
    this.ahead.lerp(this.v.set(aim.x, 0, aim.z), this.reducedMotion ? 1 : Math.min(1, dt * 4));
  }

  /** Multiplies the zoom (wheel, pinch), within limits; the camera eases to it. */
  zoomBy(f: number) {
    this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal * f, ZOOM_MIN, ZOOM_MAX);
  }

  /** About SCREEN_ROWS tiles tall, never under SCREEN_COLS wide (phones in portrait see more rows instead). */
  private applyZoom() {
    const aspect = innerWidth / Math.max(1, innerHeight);
    const half = Math.max(SCREEN_ROWS, SCREEN_COLS / aspect) / 2 / this.zoom;
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
      this.retireCharacter(this.model);
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
  private dress(outfit: number, inked: readonly number[] = []) {
    // (The designs compared one by one: no string a frame.)
    const same = inked.length === this.inkedShown.length && inked.every((d, k) => d === this.inkedShown[k]);
    if (outfit === this.outfit && same) return;
    this.outfit = outfit;
    this.inkedShown = inked.slice();
    const old = this.player;
    this.playerLook = lookFor(this.prisoner, outfit ? itemDef(outfit).color : null, outfit === GUARD_OUTFIT, outfit === INMATE_OUTFIT, inked);
    // (P36: their own clothes on release: an off-white tee over jeans, nothing like a guard's navy.)
    if (outfit === OWN_CLOTHES) this.playerLook = { ...this.playerLook, trousers: OWN_JEANS };
    // (P42: the costume on costume night: a witch's robe and hat. It fools nobody.)
    if (outfit === COSTUME) this.playerLook = { ...this.playerLook, trousers: 0x2a1f36, hat: 13, hatColor: 0x2a1f36 };
    this.player = new Character(this.playerLook);
    this.player.root.position.copy(old.root.position);
    this.player.root.rotation.copy(old.root.rotation);
    this.retireCharacter(old);
    this.scene.add(this.player.root);
  }

  /** A character off screen, freed after the next frame (its materials' shaders kept for the next one's: setWorld). */
  private retireCharacter(c: Character) {
    this.scene.remove(c.root);
    this.retired.push(() => c.dispose());
  }

  /** Draws a frame of play: the camera follows the player, looking a little ahead. */
  draw(f: Frame, dt: number, time: number) {
    this.noiseFx.group.visible = true;
    this.dress(f.outfit, f.inked);
    // (P24: a glide still higher than the walls keeps the roofs drawn.)
    this.showLayer(this.getaway.aloft ? LAYER.ROOF : f.layer);
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
    // (P24: hanging from a glider's bar in flight, both hands up.)
    const doing = this.getaway.flying ? DOING.LIFT : f.knockedOut ? DOING.KNOCKED_OUT : f.sleeping ? DOING.SLEEP : f.layer === LAYER.VENTS ? DOING.CRAWL : f.doing;
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
    if (!f.games.dice || f.games.dice.t[2] < 0) this.rivalThrew = false;
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
      const along = Math.max(-0.45, Math.min(0.7, (d - BOUT_GAP) / 2));
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
    } else if (f.doing === DOING.PICK && f.games.lock) {
      // (Up to the door, from wherever the player stopped: never through it.)
      const fx = Math.sin(f.facing);
      const fz = Math.cos(f.facing);
      const lean = Math.max(0, (f.games.lock.x - fx * PICK_STAND - f.x) * fx + (f.games.lock.z - fz * PICK_STAND - f.z) * fz);
      gx = fx * lean;
      gz = fz * lean;
    }
    const ge = Math.min(1, dt * 8);
    this.gameOff.x += (gx - this.gameOff.x) * ge;
    this.gameOff.z += (gz - this.gameOff.z) * ge;
    this.rivalOff.x += (rx - this.rivalOff.x) * ge;
    this.rivalOff.z += (rz - this.rivalOff.z) * ge;
    if (Math.abs(this.gameOff.x) + Math.abs(this.gameOff.z) < 1e-4) this.gameOff.x = this.gameOff.z = 0;
    if (!bout && Math.abs(this.rivalOff.x) + Math.abs(this.rivalOff.z) < 0.002) {
      this.rivalWho = -1;
      this.rivalOff.x = this.rivalOff.z = 0;
    }
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
    // (P24: a glide's ring in view, the camera halfway out to it.)
    const gp = f.getaway.glide;
    if (gp) this.ahead.lerp(this.v.set((gp.toX - f.x) / 2, 0, (gp.toZ - f.z) / 2), Math.min(1, dt * 3));
    // (P29: in a match, both goals kept in the picture: see framePitch.)
    this.framePitch(f, dt);
    // Carried somewhere far (solitary, the infirmary): cut there instead of panning across the map.
    // The camera rises and sinks with the layer (into the tunnels at once: it's another view).
    const y = LAYER_Y[f.layer];
    // (Aboard the raft or the helicopter, the camera follows them instead: below.)
    if (this.carrying || this.getaway.flying) {
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
      } else if (f.games.dice && f.games.dice.who === k) {
        // The dice partner (P22): shaking its dice until it throws, a fling as it does.
        const threw = f.games.dice.t[2] >= 0;
        if (threw && !this.rivalThrew) c.pump();
        this.rivalThrew = threw;
        c.diceShake = !threw;
        c.pose(m.x, m.z, m.facing, m.moving, dt, time, !this.reducedMotion, m.doing, this.beds[m.cell]);
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
    // A tree's leaves fade over anyone standing under or behind them (P23: a lookout posted there stays in view).
    if (this.decor) {
      const at = this.people;
      let n = 0;
      if (f.layer === LAYER.GROUND && this.player.root.visible) {
        at[0] = px;
        at[1] = pz;
        n = 1;
      }
      for (const m of f.inmates) {
        at[n * 2] = m.x;
        at[n * 2 + 1] = m.z;
        n++;
      }
      for (const g of f.guards) {
        at[n * 2] = g.x;
        at[n * 2 + 1] = g.z;
        n++;
      }
      this.decor.shelter(at, n, dt, !this.reducedMotion);
    }
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
    // Waved through the checkpoint (P24): its gates stand open all the way out.
    const cp = this.world?.def.checkpoint;
    if (f.getaway.waved && cp) for (const q of cp.gates) this.doorsOpen.add(q.z * MAP_W + q.x);
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
    // Snow over an alpine prison, or on a Big Freeze Daily anywhere (P26), out in the open (ground floor and roofs).
    const wx = f.weather;
    const snowing = this.world?.def.theme === 'alpine' || wx.snow;
    this.snow.update(dt, time, f.x, f.z, !this.reducedMotion && snowing && (f.layer === LAYER.GROUND || f.layer === LAYER.ROOF), f.layer === LAYER.ROOF ? undefined : this.openSky, wx.rain >= 2 ? 3 : wx.windForce, wx.windAngle);
    // The weather (P17): no rain in the snow (a storm there is a blizzard of it, above).
    this.wxLight = wx;
    let wxNow = wx;
    if (snowing && wx.rain) {
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
    this.inspecting = this.events.update(f.events, dt, time, spots, f.inmates, f.layer === LAYER.GROUND, !this.reducedMotion, f.x, f.z, f.layer !== LAYER.UNDER, this.security?.powerLevel ?? 1);
    // The holiday (P42): its decor, the water fight's sprays, New Year's fireworks (from anywhere but a tunnel).
    this.holidaysView.dress(f.holiday.kind, this.later);
    this.holidaysView.group.visible = f.layer !== LAYER.UNDER;
    this.holidaysView.update(f.holiday, dt, time, f.x, f.z, !this.reducedMotion, this.security?.powerLevel ?? 1, f.guards, f.inmates);
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
      this.island.update(dt, time, f.minuteOfDay, f.takeover || (f.getaway.waved && !!this.world?.def.checkpoint?.bridge), !this.reducedMotion, f.delivery);
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
    // Off a roof on a glider (P24): carried along its fall, the camera going with them.
    this.getaway.group.visible = f.layer !== LAYER.UNDER;
    if (this.getaway.update(f.getaway, dt, time, !this.reducedMotion, this.night, this.flyAt)) {
      this.player.root.position.copy(this.flyAt);
      this.target.lerp(this.v.set(this.flyAt.x, 0, this.flyAt.z), Math.min(1, dt * 5));
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
    // Card sharks (P27): the court's spots, the ball, the cards, the board (the ground floor only).
    this.pastimesView.group.visible = f.layer === LAYER.GROUND;
    this.groundsView.group.visible = f.layer === LAYER.GROUND || f.layer === LAYER.ROOF;
    this.groundsView.update(f.planters);
    this.pastimesView.update(f.pastimes, f.x, f.z, time, !this.reducedMotion, f.layer === LAYER.GROUND, !!f.team.ball, dt);
    // Long games (P28): the garden, the track, the racers, the pet's laps (the ground floor, and from the roofs).
    this.longView.update(f.long, time, !this.reducedMotion, f.layer === LAYER.GROUND || f.layer === LAYER.ROOF);
    // The roll call's boxes over the pitch: chalked in for roll call, gone for the rest of the day (and any match).
    if (this.rollCallPaint) {
      const goal = f.rollCall && !f.team.ball ? 1 : 0;
      this.rollCallShown += (goal - this.rollCallShown) * (this.reducedMotion ? 1 : Math.min(1, dt * 2));
      if (Math.abs(goal - this.rollCallShown) < 0.01) this.rollCallShown = goal;
      (this.rollCallPaint.material as THREE.MeshBasicMaterial).opacity = this.rollCallShown;
      this.rollCallPaint.visible = this.rollCallShown > 0 && f.layer !== LAYER.UNDER;
    }
    // Team & ink (P29): the pitch and the ball (seen from the roofs and the vents too; not from the tunnels).
    this.meAt.x = f.x;
    this.meAt.z = f.z;
    this.teamView.update(f.team, f.inmates, dt, f.layer !== LAYER.UNDER, this.meAt);
    // Stage nights (P30): the stage, the buzzers (the ground floor, and from the vents and roofs over it).
    this.nightsView.update(f.nights, time, !this.reducedMotion, f.layer !== LAYER.UNDER);
    // The pay phone (P34): the handset, Lou's car, the diversion's beacon (not from the tunnels).
    this.phoneView.update(f.phone, dt, f.minuteOfDay, time, !this.reducedMotion, this.night, f.layer !== LAYER.UNDER);
    // The internet kiosk (P35): its screen, its glow after dark; the drawings over the bed (not from the tunnels).
    this.kioskView.update(f.kiosk, time, !this.reducedMotion, this.night, this.powerLevel, f.layer !== LAYER.UNDER);
    // The odd jobs board (P40): the cards still up today, the job tag (not from the tunnels).
    this.oddJobsView.update(f.oddjobs, f.layer !== LAYER.UNDER);
    this.releaseView.update(f.release, time, !this.reducedMotion, f.layer !== LAYER.UNDER);
    // Tipsy (P28): the walk sways, on their feet only, easing in and out (none with reduced motion).
    const upright = !f.sleeping && !f.knockedOut && this.player.lying < 0.2 && this.player.crawling < 0.1 && !this.carrying && !this.getaway.flying;
    this.tipsySway += ((f.long?.tipsy && upright && !this.reducedMotion ? 1 : 0) - this.tipsySway) * Math.min(1, dt * 2);
    this.player.root.rotation.z = this.tipsySway > 0.001 ? Math.sin(time * 2.3) * 0.07 * this.tipsySway : 0;
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

  /** Lou's car pulls away with the player in it (P34, the phone's 'wheels' event): along its facing, fading out. */
  carAway() {
    this.phoneView.carAway();
  }

  /** The diversion at the gate (P34, the phone's 'diversion' and 'ignored' events): an amber beacon flashes at the ground tile for ten game minutes (steady with reduced motion). */
  phoneAlarm(tile: number) {
    this.phoneView.alarm(tile);
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
    this.getaway.clear();
    this.gamesView.update(null, 0, false, false);
    this.pastimesView.update(null, 0, 0, 0, false, false);
    this.longView.update(null, 0, false, false);
    this.teamView.update(null, [], 0, false);
    this.nightsView.update(null, 0, false, false);
    this.phoneView.update(null, dt, 0, 0, false, 0, false);
    this.kioskView.update(null, 0, false, 0, 1, false);
    this.oddJobsView.update(null, false);
    this.releaseView.update(null, 0, false);
    // (The trees whole again; no match's framing.)
    this.decor?.shelter(this.people, 0, dt, false);
    this.fitZoom = 0;
    if (this.rollCallPaint) this.rollCallPaint.visible = false;
    this.rollCallShown = 0;
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
    this.inspecting = this.events.update(NO_EVENTS, dt, time, [], [], false, false);
    this.holidaysView.dress(this.titleHoliday, this.later);
    this.holidaysView.group.visible = true;
    this.holidaysView.update(NO_HOLIDAY, dt, time, this.target.x, this.target.z, !this.reducedMotion);
    this.delivery.update(null, dt, time, false, false);
    this.render(600, dt, model ? this.feet : null, time);
  }

  /**
   * Dev tool (scripts/dev/mapimage.ts, the map viewer's "In game" picture): the whole prison at
   * the classic angle in one frame, as drawn behind the title (nobody in it, at 10:00). The
   * camera is orthographic, so the floor stays a regular grid: a tile `px` wide and `px * rows`
   * deep, the floor's north edge `top` pixels down. Drawn `ss` times over and scaled down; the
   * camera, the shadow box and the drawing size are put back after.
   */
  mapShot(px = 40, ss = 2): { canvas: HTMLCanvasElement; top: number; rows: number } {
    const off = CAMERA_OFFSET.clone().normalize();
    const rows = off.y; // a floor tile's depth on screen, in tiles (the view's tilt)
    const lift = Math.hypot(off.x, off.z); // a unit of height on screen, in tiles
    const pad = WALL_H * 2 * lift + 0.5;
    const half = (MAP_H / 2) * rows;
    const w = MAP_W * px;
    const h = Math.ceil((half * 2 + pad + 0.5) * px);
    const target = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);
    const kept = { target: this.target.clone(), shadow: this.sun.shadow.mapSize.x, ratio: this.renderer.getPixelRatio() };
    const cam = this.camera;
    cam.left = -MAP_W / 2;
    cam.right = MAP_W / 2;
    cam.top = half + pad;
    cam.bottom = cam.top - h / px;
    cam.updateProjectionMatrix();
    cam.position.copy(target).add(CAMERA_OFFSET);
    cam.lookAt(target);
    // The shadows over the whole map, finer.
    this.target.copy(target);
    this.shadowHalf = 50;
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -this.shadowHalf;
    s.right = s.top = this.shadowHalf;
    s.updateProjectionMatrix();
    const resize = (n: number) => {
      this.sun.shadow.mapSize.set(n, n);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    };
    if (this.sun.castShadow) resize(4096);
    this.placeSun(600);
    // (P42: nor a holiday's decor: the map viewer's pictures never depend on the date.)
    const hidden = [this.snow.points, this.weather.group, this.dust.mesh, this.guide.group, this.holidaysView.group].filter((o) => o.visible);
    for (const o of hidden) o.visible = false;
    // The pay phone, the kiosk and the odd jobs board hang on their walls in game, but the title screen behind the shot hides their groups.
    const shown = [this.phoneView.group, this.kioskView.group, this.oddJobsView.group, this.releaseView.group].filter((o) => !o.visible);
    for (const o of shown) o.visible = true;
    this.renderer.setPixelRatio(ss);
    this.renderer.setSize(w, h, false);
    skipEmpty(this.scene);
    this.renderer.render(this.scene, cam);
    // Read at once, before the browser lets the drawing buffer go.
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    // (The whole drawing buffer: a browser may cap its size below w·ss × h·ss.)
    const el = this.renderer.domElement;
    g.drawImage(el, 0, 0, el.width, el.height, 0, 0, w, h);
    for (const o of hidden) o.visible = true;
    for (const o of shown) o.visible = false;
    if (this.sun.castShadow) resize(kept.shadow);
    this.renderer.setPixelRatio(kept.ratio);
    this.target.copy(kept.target);
    this.resize();
    return { canvas, top: Math.round(pad * px), rows };
  }

  private render(minute: number, dt: number, focus: THREE.Vector3 | null, time: number) {
    this.easeShift(dt);
    // (P29: in a match, out as far as the pitch needs; the player's zoom comes back after.)
    const zoomTo = this.fitZoom ? Math.min(this.zoomGoal, this.fitZoom) : this.zoomGoal;
    if (Math.abs(this.zoom - zoomTo) > 1e-4) {
      this.zoom += (zoomTo - this.zoom) * Math.min(1, dt * (this.fitZoom ? 3 : 10));
      this.applyZoom();
    }
    const night = (this.night = this.light(minute));
    // The weather first: a lockdown's red pulses through a storm's grey (not washed out by it).
    this.weatherLight(dt);
    if (this.alarm > 0.001) {
      // Lockdown: the light swings red in slow pulses, like a rotating beacon.
      const a = this.alarmPulse(time);
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
    this.decor?.update(this.powerLevel, time, this.layer === LAYER.VENTS ? 0.3 : 1, this.reducedMotion);
    // Decor belongs to the ground floor (out of the picture from the tunnels).
    if (this.decor) this.decor.group.visible = this.layer !== LAYER.UNDER;
    this.worldView?.update(dt, night, this.doorsOpen, this.powerLevel, this.riot, this.security?.group.visible ? this.security.arches : 1);
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
    skipEmpty(this.scene);
    this.renderer.render(this.scene, this.camera);
    // The last prison's meshes, now that the new one's shaders are in use (setWorld).
    if (this.retired.length) for (const dispose of this.retired.splice(0)) dispose();
  }

  /** How the view sees the weather (P17): the rain's box as wide as the view, the lockdown's red as it pulses, the layer, where a point higher up lands on the ground (the camera's angle, turned by the escape camera). */
  private readonly wxView: WeatherView = { span: 40, alarm: 0, vents: false, roof: false, lx: 0, lz: 24 / 38 };
  private weatherView(layer: number, time: number): WeatherView {
    const v = this.wxView;
    v.span = Math.max(this.camera.right - this.camera.left, (this.camera.top - this.camera.bottom) * 1.6) + 6;
    v.alarm = this.alarmPulse(time);
    v.vents = layer === LAYER.VENTS;
    v.roof = layer === LAYER.ROOF;
    const o = this.cineOffset;
    if (o.y > 1) {
      v.lx = o.x / o.y;
      v.lz = o.z / o.y;
    }
    return v;
  }

  /** Lockdown: the red light's share now, swinging in slow pulses like a rotating beacon (steady with reduced motion). */
  private alarmPulse(time: number): number {
    const pulse = this.reducedMotion ? 0.5 : (Math.sin(time * 5) + 1) / 2;
    return this.alarm * (0.25 + pulse * 0.45);
  }

  /** The day's effects compiled while nothing is on screen (a new game; new graphics settings), not on a phone in the middle of a food fight. */
  private warmDay() {
    const views = [this.weather, this.events, this.delivery, this.gamesView, this.pastimesView];
    for (const v of views) v.warm(true);
    this.renderer.compile(this.scene, this.camera);
    for (const v of views) v.warm(false);
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
