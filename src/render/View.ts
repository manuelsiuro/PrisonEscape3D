import * as THREE from 'three';
import type { Pitch } from '../content/prisons/types';
import { TILE, TILE_INFO } from '../sim/world/tiles';
import { LAYER, MAP_H, MAP_W, type World } from '../sim/world/World';
import { bedDummyMesh, placeInBed } from './BedDummy';
import { GymGear, type GearUse } from './GymGear';
import { WorkGear } from './WorkGear';
import { Character, type BedPose } from './Character';
import { Cones } from './Cones';
import { Security } from './Security';
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
import { Pickups } from './Pickups';
import { updateOcclusion } from './occlusion';
import { ShowerWater } from './ShowerWater';
import { WALL_H, WorldView } from './WorldView';
import { LAYER_Y, ROOF_Y as ROOF_HEIGHT, Structure } from './Structure';
import { NoiseFx, type AimView } from './Noise';
import { FIRECRACKER } from '../sim/systems/structure';
import { Underground } from './Underground';
import { setTheme } from './textures';
import { skipEmpty } from './batch';
import { Blobs } from './Blobs';
import { Snowfall } from './Snow';
import { Weather, type WeatherFrame, type WeatherView } from './Weather';
import { Delivery } from './Delivery';
import { DayEvents, type EventsFrame } from './DayEvents';
import { HolidaysView, NO_HOLIDAY } from './Holidays';
import type { NoiseKind } from '../sim/events';
import { Dogs } from './Dog';
import { Rats } from './Rat';
import { GetawayView } from './Getaway';
import { SmuggleView } from './Smuggling';
import { GamesView } from './Games';
import { PastimesView } from './Pastimes';
import { LongView, type LongFrame } from './Long';
import { TeamView } from './Team';
import { GroundsView } from './Grounds';
import { NightsView } from './Nights';
import { PhoneView } from './Phone';
import { KioskView } from './Kiosk';
import { VendingView } from './Vending';
import { CoolerView, MenuBoardView } from './MenuBoard';
import { OddJobsView } from './OddJobs';
import { ReleaseView } from './Release';
import { handlersOf } from '../sim/systems/k9';
import type { Frame, Quality } from './viewFrame';
import { CameraRig, CAMERA_OFFSET } from './viewCamera';
import { Lighting } from './viewLight';
import { guardLook, INMATE_LOOK, inmateLook, type Look } from './look';

/** The old-timer's hair (P27): white with age. */
const ELDER_HAIR = 0xd8d3c8;

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

const GUARD_OUTFIT = itemNumber('guard_outfit');
const INMATE_OUTFIT = itemNumber('inmate_outfit');
const COSTUME = itemNumber('costume');
const OWN_CLOTHES = itemNumber('own_clothes');
const OWN_JEANS = 0x4a6a96;
/** The Intake preview's zoom (P16): close on your prisoner in their cell. */
const PREVIEW_ZOOM = 4.2;

/** How long the player keeps the towel round their neck after washing (s). */
const PLAYER_DRY = 2.5;

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

/** The tunnel lantern's strength while the player is below. */
const LANTERN = 2.6;

/** The lock-on ring under the target: a bright band with four ticks, drawn over the floor. */
function lockRing(): THREE.Mesh {
  const g = new THREE.RingGeometry(0.46, 0.56, 40).rotateX(-Math.PI / 2);
  const ticks: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const t = new THREE.PlaneGeometry(0.08, 0.2)
      .rotateX(-Math.PI / 2)
      .translate(0, 0, -0.68)
      .rotateY((k * Math.PI) / 2);
    ticks.push(t);
  }
  const all = [g, ...ticks].map((x) => x.toNonIndexed());
  const pos: number[] = [];
  for (const x of all) pos.push(...(x.getAttribute('position').array as Float32Array));
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  for (const x of [g, ...ticks, ...all]) x.dispose();
  // Depth-tested (walls and the target's own legs stand in front of it), nudged toward the camera over the floor.
  const m = new THREE.Mesh(
    merged,
    new THREE.MeshBasicMaterial({
      color: 0xffb02e,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
  );
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
  /** The camera, its zoom, its jolts, the escape camera (viewCamera.ts). */
  private readonly cam = new CameraRig();
  get camera(): THREE.OrthographicCamera {
    return this.cam.camera;
  }
  /** The sun, the sky, the weather's light (viewLight.ts). */
  private readonly lighting = new Lighting();
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
  private readonly showerWater = new ShowerWater();
  /** The tiles of the heads someone's washing under, this frame. */
  private readonly running = new Set<number>();
  private wasWashing = false;
  /** Seconds left with the towel, after stepping out from under the water. */
  private dryingFor = 0;
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
  /** 2.32: the vending machine's front. */
  private readonly vendingView = new VendingView();
  /** 2.33: the menu board's face, the water cooler's bubbles. */
  private readonly menuView = new MenuBoardView();
  private readonly coolerView = new CoolerView();
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
  private readonly guardSpots: Array<{ x: number; z: number; awake: boolean }> = [];
  /** Whether a tile has open sky over it (no roof): where snow falls. */
  private readonly openSky = (x: number, z: number) =>
    !this.world || !this.world.inside(x, z) || this.world.layers[LAYER.ROOF].kind[z * MAP_W + x] === TILE.EMPTY;
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
  /** The cell block's lights out (2.28): 0 on … 1 out, and where it's heading. */
  private blockDark = 0;
  private blockDarkGoal = 0;
  /** The bed dummy in the player's bed (2.28). */
  private readonly dummy = bedDummyMesh();
  /** 2.29: the bars and the bags; for each inmate, how far onto its machine it's drawn, where that was, the bench it's getting up from, the rep it's at. */
  private readonly gear = new GymGear();
  private readonly workGear = new WorkGear();
  private readonly gearUses: GearUse[] = [];
  private readonly machineBlend: number[] = [];
  private readonly machineAt: Array<{ x: number; z: number; y: number }> = [];
  private readonly machineRest: Array<BedPose | null> = [];
  private readonly machineRep: number[] = [];
  private readonly feet = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly carried = new THREE.Vector3();
  /** The lock-on ring, and the cup of molten chocolate in flight (from, to, 0–1 along the way). */
  private readonly ring = lockRing();
  private readonly cup = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a3018, roughness: 0.35, emissive: 0x2a1006 }),
  );
  private readonly cupFrom = new THREE.Vector3();
  private readonly cupTo = new THREE.Vector3();
  private cupT = 1;
  private cupWho = -1;
  /** Puddles for the janitor to mop (GDD §11): flat glossy pools, one instance each. */
  private readonly puddles = new THREE.InstancedMesh(
    new THREE.CircleGeometry(0.46, 20).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: 0x7cc4f5,
      emissive: 0x2a6a96,
      roughness: 0.2,
      metalness: 0,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
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
    this.scene.background = this.lighting.sky;
    this.scene.add(
      this.lighting.sun,
      this.lighting.sun.target,
      this.lighting.ambient,
      this.player.root,
      this.dummy,
      this.gear.group,
      this.workGear.group,
      this.vendingView.group,
      this.menuView.group,
      this.coolerView.group,
      this.blobs.mesh,
      this.dust.mesh,
      this.showerWater.group,
      this.snow.points,
      this.sparks.mesh,
      this.snores.group,
      this.guide.group,
      this.pickups.group,
      this.noiseFx.group,
      this.cones.group,
      this.ring,
      this.cup,
      this.puddles,
      this.weather.group,
      this.events.group,
      this.delivery.group,
      this.dogs.group,
      this.rats.group,
      this.smuggling.group,
      this.gamesView.group,
      this.pastimesView.group,
      this.longView.group,
      this.teamView.group,
      this.groundsView.group,
      this.nightsView.group,
      this.phoneView.group,
      this.kioskView.group,
      this.oddJobsView.group,
      this.holidaysView.group,
      this.releaseView.group,
      this.getaway.group,
    );
    this.cam.shadow = this.lighting.sun.shadow.camera;
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
    this.lighting.sun.castShadow = on;
    this.lighting.sun.shadow.radius = q.softness;
    if (on && this.lighting.sun.shadow.mapSize.x !== q.shadows) {
      this.lighting.sun.shadow.mapSize.set(q.shadows, q.shadows);
      this.lighting.sun.shadow.map?.dispose();
      this.lighting.sun.shadow.map = null;
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
    this.cam.endCinema();
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
    for (const p of world.props)
      if (p.kind === 'chair' || p.kind === 'readChair' || p.kind === 'deskChair') this.chairs.add(p.z * MAP_W + p.x);
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
    this.vendingView.setWorld(world, later);
    this.menuView.setWorld(world);
    this.coolerView.setWorld(world);
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
    this.lighting.newWorld();
    // A new game dresses (rebuilds) the player afresh: nothing carries over, not even a pose.
    this.outfit = -1;
    this.showers.fill(0);
    for (const p of world.props) if (p.kind === 'shower') this.showers[p.z * MAP_W + p.x] = 1;
    this.showerWater.setWorld(world.props, MAP_W);
    this.running.clear();
    this.wasWashing = false;
    this.dryingFor = 0;
    this.beds = world.cellBed.map((b) => b && { x: b.x + b.w / 2, z: b.z + b.d / 2, angle: (b.rot * Math.PI) / 2 });
    if (this.beds[1]) placeInBed(this.dummy, this.beds[1]);
    this.dummy.visible = false;
    this.gear.build(world);
    this.workGear.build(world);
    this.blockDark = this.blockDarkGoal = 0;
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
    this.cast = cast
      ? cast.map(
          (c) => new Character({ ...inmateLook(c.cell), ...(c.elder ? { hair: ELDER_HAIR, hairStyle: 1, beard: 3 } : {}), gait: c.gait }),
        )
      : [];
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
    this.gear.group.visible = !under;
    this.workGear.group.visible = !under;
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
    this.cam.setFloor(LAYER_Y[layer]);
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
    const y =
      action === 'unscrew'
        ? layer === LAYER.VENTS
          ? LAYER_Y[LAYER.VENTS]
          : 1.3
        : action === 'chip'
          ? 0.6
          : action === 'cut' || action === 'sharpen'
            ? 0.8
            : LAYER_Y[this.layer];
    const color =
      action === 'chip' ? 0xa0533e : action === 'cut' || action === 'unscrew' ? 0xffd27a : action === 'sharpen' ? 0xd8cfc0 : 0x8a6644;
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
      this.cam.jolt(broke ? 1 : 0.35);
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
    if (by < 0) this.cam.jolt(ko ? 0.8 : 0.3);
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
    this.lighting.jumped();
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
    this.cam.jolt(0.9);
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
        this.m4
          .makeRotationY((t % 7) * 0.45)
          .scale(this.v.set(sx, 1, sz))
          .setPosition((t % MAP_W) + 0.5, 0.02, Math.floor(t / MAP_W) + 0.5);
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
    return this.cam.screenAt(x, y, z, out);
  }

  /** Where someone's head is on screen (CSS pixels), for floating numbers; null off screen. */
  screenOf(id: number, out: { x: number; y: number }, height = 1.7): { x: number; y: number } | null {
    const c = this.who(id);
    return c ? this.screenAt(c.root.position.x, c.root.position.y + height, c.root.position.z, out) : null;
  }

  /** The floor point under a screen point (tiles), for tap-to-walk. */
  groundAt(clientX: number, clientY: number): { x: number; z: number } | null {
    return this.cam.groundAt(clientX, clientY);
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.cam.applyZoom();
  }

  /**
   * Slides the picture so the player shows in the part of the screen a panel leaves free (a
   * side panel in landscape, a bottom sheet in portrait); 0, 0 puts it back. Eased.
   */
  setShift(x: number, y: number) {
    this.cam.setShift(x, y);
  }

  /** Multiplies the zoom (wheel, pinch), within limits; the camera eases to it. */
  zoomBy(f: number) {
    this.cam.zoomBy(f);
  }

  /** Puts the camera on a point at once (a new game starts on the player, not mid-pan). */
  snapTo(x: number, z: number, zoom?: number) {
    this.cam.snapTo(x, z, zoom);
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
    } else if (p) this.titleZoom = this.cam.zoomGoal;
    if (!p) {
      this.cam.zoomGoal = this.titleZoom;
      return;
    }
    this.model = new Character(lookFor(p, INMATE_LOOK.outfit, false));
    this.scene.add(this.model.root);
    this.cam.zoomGoal = PREVIEW_ZOOM;
  }

  /**
   * The escape camera (P16): a slow turn of up to 25° round the player and a pull-back, then
   * a hold; resolves when it's played (or skipped). With reduced motion: a still hold, 0.9 s.
   */
  cinema(long: boolean, still = this.reducedMotion): Promise<void> {
    return this.cam.cinema(long, still);
  }

  /** Cuts the escape camera short (a tap): it resolves now and holds where it got to. */
  skipCinema() {
    this.cam.skipCinema();
  }

  /** Sets the zoom to ease to (a new game's), within limits. */
  zoomTo(z: number) {
    this.cam.zoomTo(z);
  }

  /** Dresses the player: your prisoner in the outfit (a white vest with none on; the guard cap with the guard's uniform). */
  private dress(outfit: number, inked: readonly number[] = []) {
    // (The designs compared one by one: no string a frame.)
    const same = inked.length === this.inkedShown.length && inked.every((d, k) => d === this.inkedShown[k]);
    if (outfit === this.outfit && same) return;
    this.outfit = outfit;
    this.inkedShown = inked.slice();
    const old = this.player;
    this.playerLook = lookFor(
      this.prisoner,
      outfit ? itemDef(outfit).color : null,
      outfit === GUARD_OUTFIT,
      outfit === INMATE_OUTFIT,
      inked,
    );
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
    // (A tray takes both hands: what's in hand is out of sight while it does.)
    this.player.hold(
      f.sleeping ||
        f.knockedOut ||
        f.trayAt ||
        f.doing === DOING.SHOWER ||
        f.doing === DOING.BENCH ||
        f.doing === DOING.PULLUP ||
        f.doing === DOING.PUSHUP ||
        f.doing === DOING.BAG
        ? 0
        : f.held,
      f.held ? itemGeometry(itemDef(f.held)) : null,
    );
    this.player.trayPose(f.trayAt, f.trayLeft);
    // (P24: hanging from a glider's bar in flight, both hands up.)
    const doing = this.getaway.flying
      ? DOING.LIFT
      : f.knockedOut
        ? DOING.KNOCKED_OUT
        : f.sleeping
          ? DOING.SLEEP
          : f.layer === LAYER.VENTS
            ? DOING.CRAWL
            : f.doing;
    // Onto the treadmill's belt and off it again, eased; a rep pumps the arms.
    this.trainBlend += ((f.trainAt ? 1 : 0) - this.trainBlend) * Math.min(1, dt * 8);
    if (f.trainAt) this.trainPos.set(f.trainAt.x, f.trainAt.y, f.trainAt.z);
    const tb = this.trainBlend > 0.001 ? this.trainBlend : 0;
    if (f.reps !== this.reps) {
      if (f.reps > this.reps) {
        this.player.pump();
        if (f.doing === DOING.BAG) this.gear.hit(f.trainProp, !this.reducedMotion);
      }
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
    // (2.26: in shorts, and a moment after with a towel round the neck on the way off.)
    const washing = f.doing === DOING.SHOWER;
    if (this.wasWashing && !washing && !f.knockedOut && !f.sleeping) this.dryingFor = PLAYER_DRY;
    this.wasWashing = washing;
    this.dryingFor = washing || f.knockedOut || f.sleeping ? 0 : Math.max(0, this.dryingFor - dt);
    this.player.undressed = washing || this.dryingFor > 0;
    this.player.towel = this.dryingFor > 0 ? 1 : 0;
    this.running.clear();
    if (washing) this.running.add(Math.floor(f.z) * MAP_W + Math.floor(f.x));
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
      if (dust[f.surface] !== undefined && !this.reducedMotion && (f.layer === LAYER.GROUND || f.layer === LAYER.UNDER))
        this.dust.puff(f.x, f.z, dust[f.surface], 2);
      this.onStep(f.surface);
    }
    // Look-ahead: up to a tile and a half in the walking direction, eased.
    const lead = f.moving && !this.reducedMotion ? 1.4 : 0;
    this.cam.ahead.lerp(this.v.set(Math.sin(f.facing) * lead, 0, Math.cos(f.facing) * lead * 0.8), Math.min(1, dt * 2.2));
    // (P24: a glide's ring in view, the camera halfway out to it.)
    const gp = f.getaway.glide;
    if (gp) this.cam.ahead.lerp(this.v.set((gp.toX - f.x) / 2, 0, (gp.toZ - f.z) / 2), Math.min(1, dt * 3));
    // (P29: in a match, both goals kept in the picture: see framePitch.)
    this.cam.framePitch(f, dt, this.reducedMotion);
    // Carried somewhere far (solitary, the infirmary): cut there instead of panning across the map.
    // The camera rises and sinks with the layer (into the tunnels at once: it's another view).
    const y = LAYER_Y[f.layer];
    // (Aboard the raft or the helicopter, the camera follows them instead: below.)
    if (this.carrying || this.getaway.flying) {
      /* followed below */
    } else if (Math.abs(this.cam.target.x - f.x) + Math.abs(this.cam.target.z - f.z) > 10 || f.layer === LAYER.UNDER)
      this.cam.target.set(f.x, y, f.z);
    else this.cam.target.lerp(this.v.set(f.x, y, f.z).add(this.cam.ahead), Math.min(1, dt * 7));
    this.underground?.follow(f.x, f.z);
    this.feet.set(f.x, 0, f.z);
    // The see-through cut: on the ground floor and in the tunnels (nothing stands over the vents or the roof).
    const cut = f.layer === LAYER.GROUND || f.layer === LAYER.UNDER;
    f.inmates.forEach((m, k) => {
      const c = this.cast[k];
      if (!c) return;
      // In the tunnels the ground floor and everyone on it are out of the picture.
      c.root.visible = f.layer !== LAYER.UNDER;
      // (2.26: the water's the head's own; a turn at the showers in shorts, a towel while waiting and after.)
      const tile = Math.floor(m.z) * MAP_W + Math.floor(m.x);
      if (m.doing === DOING.SHOWER && this.showers[tile] === 1) this.running.add(tile);
      c.undressed = m.bare;
      c.towel = m.towel;
      c.attention = m.attention;
      c.trayPose(m.trayAt, m.trayLeft);
      // (2.30: what it's carrying at work.)
      c.hold(m.held, m.held ? itemGeometry(itemDef(m.held)) : null);
      // On a chair, a little higher than on a canteen bench.
      // (2.29: on a machine, drawn on it, and at it: an arm or a body going of its own accord, slower than anyone is asked to keep time.)
      const onGear = m.prop >= 0 && m.doing !== DOING.BENCH;
      const blend = (this.machineBlend[k] =
        (this.machineBlend[k] ?? 0) + ((onGear ? 1 : 0) - (this.machineBlend[k] ?? 0)) * Math.min(1, dt * 8));
      const gearAt = (this.machineAt[k] ??= { x: m.x, z: m.z, y: 0 });
      if (onGear) Object.assign(gearAt, { x: m.at.x, z: m.at.z, y: m.at.y });
      if (m.doing === DOING.BENCH) this.machineRest[k] = m.bench;
      else if (c.lying === 0) this.machineRest[k] = null;
      if (m.prop >= 0 && !this.reducedMotion) {
        const rep = Math.floor((time + k * 0.37) / (m.doing === DOING.BAG ? 0.6 : 1.2));
        if (rep !== this.machineRep[k]) {
          this.machineRep[k] = rep;
          c.pump();
          if (m.doing === DOING.BAG) this.gear.hit(m.prop, true);
        }
      }
      if (m.doing === DOING.BENCH && m.prop >= 0) this.gearUses.push({ prop: m.prop, up: c.pressed });
      const lift =
        (m.doing === DOING.SIT || m.doing === DOING.SIT_READ) && this.chairs.has(Math.floor(m.z) * MAP_W + Math.floor(m.x))
          ? 0.1
          : blend > 0.001
            ? gearAt.y * blend
            : 0;
      c.baseY += (lift - c.baseY) * Math.min(1, dt * 8);
      // The one arm-wrestling the player (P22): square on to them in its stance, straining the other way (eased back to its spot after).
      if (bout && bout.who === k) {
        c.strain = -bout.strain;
        c.shudder = bout.surge;
        c.pose(
          m.x + this.rivalOff.x,
          m.z + this.rivalOff.z,
          Math.atan2(f.x - m.x, f.z - m.z),
          false,
          dt,
          time,
          !this.reducedMotion,
          DOING.WRESTLE,
          this.beds[m.cell],
        );
      } else if (f.games.dice && f.games.dice.who === k) {
        // The dice partner (P22): shaking its dice until it throws, a fling as it does.
        const threw = f.games.dice.t[2] >= 0;
        if (threw && !this.rivalThrew) c.pump();
        this.rivalThrew = threw;
        c.diceShake = !threw;
        c.pose(m.x, m.z, m.facing, m.moving, dt, time, !this.reducedMotion, m.doing, this.beds[m.cell]);
      } else if (this.rivalWho === k)
        c.pose(m.x + this.rivalOff.x, m.z + this.rivalOff.z, m.facing, m.moving, dt, time, !this.reducedMotion, m.doing, this.beds[m.cell]);
      else if (blend > 0.001)
        c.pose(
          m.x + (gearAt.x - m.x) * blend,
          m.z + (gearAt.z - m.z) * blend,
          onGear ? m.at.facing : m.facing,
          m.moving,
          dt,
          time,
          !this.reducedMotion,
          m.doing,
          this.beds[m.cell],
        );
      else c.pose(m.x, m.z, m.facing, m.moving, dt, time, !this.reducedMotion, m.doing, this.machineRest[k] ?? this.beds[m.cell]);
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
      c.mark(
        g.alert === ALERT.HOSTILE
          ? '!'
          : g.alert === ALERT.SUSPICIOUS
            ? '?'
            : g.away && (g.alert === ALERT.CALM || c.markChar === '$')
              ? '$'
              : '',
        dt,
        !this.reducedMotion,
      );
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
    const near =
      !!this.world?.def.delivery && Math.hypot(f.x - this.world.def.delivery.tail.x - 0.5, f.z - this.world.def.delivery.tail.z - 0.5) < 4;
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
    this.dogs.update(
      f.dogs,
      f.scent,
      f.x,
      f.z,
      dt,
      time,
      !this.reducedMotion,
      f.layer === LAYER.GROUND ? this.sleepers : this.noSleepers,
      f.layer === LAYER.GROUND,
    );
    this.noSleepers.length = 0;
    this.snores.update(dt, this.sleepers, this.sleepers.length / 3, !this.reducedMotion);
    // Snow over an alpine prison, or on a Big Freeze Daily anywhere (P26), out in the open (ground floor and roofs).
    const wx = f.weather;
    const snowing = this.world?.def.theme === 'alpine' || wx.snow;
    this.snow.update(
      dt,
      time,
      f.x,
      f.z,
      !this.reducedMotion && snowing && (f.layer === LAYER.GROUND || f.layer === LAYER.ROOF),
      f.layer === LAYER.ROOF ? undefined : this.openSky,
      wx.rain >= 2 ? 3 : wx.windForce,
      wx.windAngle,
    );
    // The weather (P17): no rain in the snow (a storm there is a blizzard of it, above).
    this.lighting.weather = wx;
    let wxNow = wx;
    if (snowing && wx.rain) {
      Object.assign(this.wxSnow, wx);
      this.wxSnow.rain = 0;
      wxNow = this.wxSnow;
    }
    this.weather.update(
      wxNow,
      dt,
      time,
      f.x,
      f.z,
      LAYER_Y[f.layer],
      f.layer === LAYER.ROOF ? ROOF_HEIGHT + 0.7 : WALL_H + 0.45,
      this.lighting.night,
      !this.reducedMotion,
      f.layer === LAYER.UNDER,
      f.layer === LAYER.ROOF ? this.rainOnRoofs : this.rainBelow,
      f.layer === LAYER.ROOF ? this.wetRoofs : this.puddly,
      this.weatherView(f.layer, time),
    );
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
    this.inspecting = this.events.update(
      f.events,
      dt,
      time,
      spots,
      f.inmates,
      f.layer === LAYER.GROUND,
      !this.reducedMotion,
      f.x,
      f.z,
      f.layer !== LAYER.UNDER,
      this.security?.powerLevel ?? 1,
    );
    // The holiday (P42): its decor, the water fight's sprays, New Year's fireworks (from anywhere but a tunnel).
    this.holidaysView.dress(f.holiday.kind, this.later);
    this.holidaysView.group.visible = f.layer !== LAYER.UNDER;
    this.holidaysView.update(f.holiday, dt, time, f.x, f.z, !this.reducedMotion, this.security?.powerLevel ?? 1, f.guards, f.inmates);
    this.sparks.update(dt);
    this.drawLock(f, dt, time);
    this.cones.update(f.guards, dt, this.lighting.night, !this.reducedMotion);
    // Cameras, searchlights and snipers belong to the ground floor (from below or in the ducts, out of the picture).
    if (this.security) {
      this.security.group.visible = f.layer !== LAYER.UNDER;
      this.security.update(f.security, dt, time, this.lighting.night, !this.reducedMotion);
    }
    this.riot = f.takeover;
    this.carrying = false;
    if (this.island) {
      this.island.group.visible = f.layer !== LAYER.UNDER;
      this.island.update(
        dt,
        time,
        f.minuteOfDay,
        f.takeover || (f.getaway.waved && !!this.world?.def.checkpoint?.bridge),
        !this.reducedMotion,
        f.delivery,
      );
      // Leaving: on the raft as it drifts out, or aboard the helicopter (out of sight).
      const on = this.island.carry(this.carried);
      this.carrying = !!on;
      if (on) {
        this.player.root.position.copy(on);
        // The camera goes with them (the helicopter climbs out of a fixed shot).
        this.cam.target.lerp(this.v.set(on.x, on.y * 0.6, on.z), Math.min(1, dt * 3));
      }
      this.player.root.visible = !this.island.aboard && this.player.root.visible;
    }
    // Away in the delivery's truck (P18): the camera follows it out.
    const ride = this.delivery.carry(this.carried);
    if (ride) {
      this.carrying = true;
      this.player.root.visible = false;
      this.cam.target.lerp(this.v.set(ride.x, 0, ride.z), Math.min(1, dt * 3));
    }
    // Off a roof on a glider (P24): carried along its fall, the camera going with them.
    this.getaway.group.visible = f.layer !== LAYER.UNDER;
    if (this.getaway.update(f.getaway, dt, time, !this.reducedMotion, this.lighting.night, this.flyAt)) {
      this.player.root.position.copy(this.flyAt);
      this.cam.target.lerp(this.v.set(this.flyAt.x, 0, this.flyAt.z), Math.min(1, dt * 5));
    }
    // The rats (P20), after the player has gone wherever they go (a raft, the helicopter, a truck): on the floor seen from anywhere but a tunnel;
    // on the shoulder of a player up and about (not lying, not crawling, not in a tunnel), turning with them.
    this.rats.group.visible = true;
    // (Hands busy, it ducks into a pocket a moment: never an arm through it.)
    const perch =
      this.player.perched &&
      this.player.root.visible &&
      !f.sleeping &&
      !f.knockedOut &&
      (f.layer === LAYER.GROUND || f.layer === LAYER.ROOF) &&
      this.player.lying < 0.2 &&
      this.player.crawling < 0.1 &&
      !this.player.armsBusy
        ? this.player.shoulder(this.shoulderAt)
        : null;
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
    this.phoneView.update(f.phone, dt, f.minuteOfDay, time, !this.reducedMotion, this.lighting.night, f.layer !== LAYER.UNDER);
    // The internet kiosk (P35): its screen, its glow after dark; the drawings over the bed (not from the tunnels).
    this.kioskView.update(f.kiosk, time, !this.reducedMotion, this.lighting.night, this.powerLevel, f.layer !== LAYER.UNDER);
    // The vending machine (2.32): its front, what's left in it, what's dropping (not from the tunnels).
    this.vendingView.update(f.vending, dt, time, !this.reducedMotion, this.lighting.night, f.layer !== LAYER.UNDER);
    // The menu board's dishes and the water cooler's bubbles (2.33).
    this.menuView.update(f.menu);
    this.coolerView.update(f.cooler, dt, !this.reducedMotion);
    // The odd jobs board (P40): the cards still up today, the job tag (not from the tunnels).
    this.oddJobsView.update(f.oddjobs, f.layer !== LAYER.UNDER);
    // (2.28: a dummy in the player's bed shows, but not under them, nor from the tunnels.)
    // (2.29: the bars: the player's, and those the inmates have up, gathered above.)
    if (f.doing === DOING.BENCH) this.gearUses.push({ prop: f.trainProp, up: this.player.pressed });
    this.gear.update(dt, this.gearUses, !this.reducedMotion);
    this.workGear.update(time, f.running, !this.reducedMotion);
    this.gearUses.length = 0;
    this.dummy.visible = f.bedDummy && !f.sleeping && f.layer !== LAYER.UNDER && !!this.beds[1];
    this.blockDarkGoal = f.blockDark ? 1 : 0;
    this.releaseView.update(f.release, time, !this.reducedMotion, f.layer !== LAYER.UNDER);
    // Tipsy (P28): the walk sways, on their feet only, easing in and out (none with reduced motion).
    const upright =
      !f.sleeping && !f.knockedOut && this.player.lying < 0.2 && this.player.crawling < 0.1 && !this.carrying && !this.getaway.flying;
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
    this.lighting.alarm += ((f.alarm ? 1 : 0) - this.lighting.alarm) * Math.min(1, dt * 3);
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
    if (hit) this.cam.jolt(0.8);
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
    this.cam.jolt(1.8);
    if (this.reducedMotion) return;
    this.sparks.burst(x, 0.3, z, 40, 0xffa53a, 6.5);
    this.sparks.burst(x, 0.5, z, 18, 0xfff0c0, 4.5);
    this.dust.puff(x, z, 0xc8a36a, 34, 0.3);
    this.dust.puff(x, z, 0x5b4a3a, 18, 1.1);
  }

  /** The electric fence bites (GDD §5.5): a shower of blue-white sparks off the player and a hard jolt. */
  shock() {
    const p = this.player.root.position;
    this.cam.jolt(1);
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
          this.cam.jolt(0.6);
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
    this.cam.fitZoom = 0;
    if (this.rollCallPaint) this.rollCallPaint.visible = false;
    this.rollCallShown = 0;
    this.player.root.visible = false;
    this.ring.visible = false;
    this.cup.visible = false;
    this.cupT = 1;
    this.doorsOpen.clear();
    this.cones.update([], dt, 0, false);
    this.lighting.alarm = 0;
    this.riot = false;
    if (this.security) this.security.group.visible = false;
    this.pickups.update([], -1, null, dt, time, false);
    this.guide.setPath(null);
    this.guide.setTap(null);
    this.guide.update(dt, time, this.cam.target, false);
    // The Intake (P16): your prisoner in their cell, the camera close (the walls in front cut away).
    // In and out of it eased (the angle, the target), at once with reduced motion.
    const model = this.model;
    const k = this.reducedMotion ? 1 : Math.min(1, dt * 4);
    this.previewBlend += ((model ? 1 : 0) - this.previewBlend) * k;
    if (model && this.world) {
      const sp = this.world.def.spawn;
      const sway = this.reducedMotion ? 0 : Math.sin(time * 0.6) * 0.35;
      model.pose(sp.x + 0.5, sp.z + 0.5, this.previewTurn + sway, false, dt, time, !this.reducedMotion, DOING.NOTHING);
      this.cam.target.lerp(this.v.set(sp.x + 0.5, 0.75, sp.z + 0.5), this.reducedMotion ? 1 : Math.min(1, dt * 6));
      this.feet.set(sp.x + 0.5, 0, sp.z + 0.5);
    } else {
      const a = this.reducedMotion ? 1.2 : time * 0.05;
      this.v.set(MAP_W / 2 + Math.cos(a) * 14, 0, MAP_H / 2 - 4 + Math.sin(a * 1.3) * 10);
      if (this.previewBlend > 0.002) this.cam.target.lerp(this.v, k);
      else this.cam.target.copy(this.v);
    }
    // Snow falling over an alpine prison behind the title too (no day's weather there).
    this.snow.update(
      dt,
      time,
      this.cam.target.x,
      this.cam.target.z,
      !this.reducedMotion && this.world?.def.theme === 'alpine',
      this.openSky,
    );
    this.lighting.weather = null;
    this.weather.update(
      NO_WEATHER,
      dt,
      time,
      this.cam.target.x,
      this.cam.target.z,
      0,
      WALL_H + 0.45,
      0,
      !this.reducedMotion,
      false,
      this.rainBelow,
      this.puddly,
    );
    this.inspecting = this.events.update(NO_EVENTS, dt, time, [], [], false, false);
    this.holidaysView.dress(this.titleHoliday, this.later);
    this.holidaysView.group.visible = true;
    this.holidaysView.update(NO_HOLIDAY, dt, time, this.cam.target.x, this.cam.target.z, !this.reducedMotion);
    this.delivery.update(null, dt, time, false, false);
    this.render(600, dt, model ? this.feet : null, time);
  }

  /**
   * Dev tool (scripts/dev/mapimage.ts, the map viewer's "In game" picture): the whole prison at
   * the classic angle in one frame, as drawn behind the title (nobody in it, at 10:00). The
   * camera is orthographic, so the floor stays a regular grid: a tile `px` wide and `px * rows`
   * deep, the floor's north edge `top` pixels down. Drawn `ss` times over and scaled down; the
   * camera, the shadow box and the drawing size are put back after. `dress`: a prison's photo for
   * the map viewer, with what stands there every day though the title screen hides it.
   */
  mapShot(px = 40, ss = 2, dress = false): { canvas: HTMLCanvasElement; top: number; rows: number } {
    const off = CAMERA_OFFSET.clone().normalize();
    const rows = off.y; // a floor tile's depth on screen, in tiles (the view's tilt)
    const lift = Math.hypot(off.x, off.z); // a unit of height on screen, in tiles
    const pad = WALL_H * 2 * lift + 0.5;
    const half = (MAP_H / 2) * rows;
    const w = MAP_W * px;
    const h = Math.ceil((half * 2 + pad + 0.5) * px);
    const target = new THREE.Vector3(MAP_W / 2, 0, MAP_H / 2);
    const kept = { target: this.cam.target.clone(), shadow: this.lighting.sun.shadow.mapSize.x, ratio: this.renderer.getPixelRatio() };
    const cam = this.cam.camera;
    cam.left = -MAP_W / 2;
    cam.right = MAP_W / 2;
    cam.top = half + pad;
    cam.bottom = cam.top - h / px;
    cam.updateProjectionMatrix();
    cam.position.copy(target).add(CAMERA_OFFSET);
    cam.lookAt(target);
    // The shadows over the whole map, finer.
    this.cam.target.copy(target);
    this.cam.shadowHalf = 50;
    const s = this.lighting.sun.shadow.camera;
    s.left = s.bottom = -this.cam.shadowHalf;
    s.right = s.top = this.cam.shadowHalf;
    s.updateProjectionMatrix();
    const resize = (n: number) => {
      this.lighting.sun.shadow.mapSize.set(n, n);
      this.lighting.sun.shadow.map?.dispose();
      this.lighting.sun.shadow.map = null;
    };
    if (this.lighting.sun.castShadow) resize(4096);
    this.lighting.placeSun(600, this.cam.target, this.cam.shadowHalf);
    // (P42: nor a holiday's decor: the map viewer's pictures never depend on the date.)
    const hidden = [
      this.snow.points,
      this.weather.group,
      this.dust.mesh,
      this.showerWater.group,
      this.guide.group,
      this.holidaysView.group,
    ].filter((o) => o.visible);
    for (const o of hidden) o.visible = false;
    // The pay phone, the kiosk and the odd jobs board hang on their walls in game, but the title screen behind the shot hides their groups.
    const shown = [this.phoneView.group, this.kioskView.group, this.oddJobsView.group, this.releaseView.group].filter((o) => !o.visible);
    for (const o of shown) o.visible = true;
    const undress = dress ? this.dressForMap() : null;
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
    undress?.();
    if (this.lighting.sun.castShadow) resize(kept.shadow);
    this.renderer.setPixelRatio(kept.ratio);
    this.cam.target.copy(kept.target);
    this.resize();
    return { canvas, top: Math.round(pad * px), rows };
  }

  /**
   * What the title screen takes away and a prison has every day: the cameras and searchlights, the
   * pitch's lines and goals, the garden's beds, the rat track; Irongate's drawbridge up. Nothing
   * that comes only with an event. Returns how to take them away again (the drawbridge stays up: it
   * is, in play).
   */
  private dressForMap(): () => void {
    const w = this.world;
    const def = w?.def;
    if (!w || !def) return () => {};
    const tile = (x: number, z: number) => z * MAP_W + x;
    const sec = this.security;
    if (sec) {
      sec.group.visible = true;
      sec.update(
        {
          power: true,
          fence: true,
          arches: true,
          gens: [true, true],
          // (As the frame turns them, at the middle of their sweep; off, so that no cone hides the floor.)
          cams: (def.cameras ?? []).map((c) => ({
            facing: Math.PI / 2 - ((c.face - 1) * Math.PI * 2) / 16,
            on: false,
            sees: false,
            taped: false,
          })),
          // (Each lamp's pool halfway along its sweep.)
          beams: (def.searchlights ?? []).map((line) => {
            const q = line[Math.floor(line.length / 2)];
            return { x: q.x + 0.5, z: q.z + 0.5 };
          }),
          aim: -1,
          px: 0,
          pz: 0,
          hook: null,
        },
        // (A short step eases the searchlights only part of the way on: a faint pool by day, not a glare over the floor.)
        0.12,
        0,
        0,
        false,
      );
    }
    const ls = def.leisure;
    if (this.pitch)
      this.teamView.update({ pitch: this.pitch, theme: def.theme ?? 'suburban', ball: null, mates: [], rivals: [] }, [], 0, true);
    if (ls) {
      const beds: LongFrame['beds'] = [];
      for (let z = ls.garden.z; z < ls.garden.z + ls.garden.d; z++)
        for (let x = ls.garden.x; x < ls.garden.x + ls.garden.w; x++)
          beds.push({ tile: tile(x, z), crop: 0, grown: 0, wilted: false, watered: false, ripe: false, hole: false });
      const a = ((ls.race.dir - 1) * Math.PI) / 8;
      const track = Array.from({ length: ls.race.len }, (_, k) =>
        tile(ls.race.x + Math.round(Math.cos(a)) * k, ls.race.z + Math.round(Math.sin(a)) * k),
      );
      this.longView.update({ beds, track, rats: [], laps: null, tipsy: false }, 0, false, true);
    }
    // (Its one piece never otherwise moved behind the title: up, as in a day's play; the helicopter away at 10:00.)
    this.island?.update(100, 0, 600, false, false);
    return () => {
      if (sec) sec.group.visible = false;
      this.teamView.update(null, [], 0, false);
      this.longView.update(null, 0, false, false);
    };
  }

  private render(minute: number, dt: number, focus: THREE.Vector3 | null, time: number) {
    this.cam.ease(dt, this.reducedMotion);
    const night = this.lighting.update(minute, dt, time, this.layer, this.reducedMotion);
    this.decor?.update(this.powerLevel, time, this.layer === LAYER.VENTS ? 0.3 : 1, this.reducedMotion);
    // Decor belongs to the ground floor (out of the picture from the tunnels).
    if (this.decor) this.decor.group.visible = this.layer !== LAYER.UNDER;
    // (2.28: the cell block's lights go out, past the walk home; a lockdown has them back on.)
    this.blockDark = this.reducedMotion ? this.blockDarkGoal : this.blockDark + (this.blockDarkGoal - this.blockDark) * Math.min(1, dt * 3);
    this.worldView?.update(
      dt,
      night,
      this.doorsOpen,
      this.powerLevel,
      this.riot,
      this.security?.group.visible ? this.security.arches : 1,
      this.blockDark,
    );
    this.dust.update(dt);
    // (The running heads as the last frame found them; off the ground floor's picture from the tunnels.)
    this.showerWater.update(dt, time, !this.reducedMotion, this.running, this.cam.camera);
    if (this.layer === LAYER.UNDER) this.showerWater.group.visible = false;
    this.cam.place(dt, time, this.previewBlend, this.shakeOn && !this.reducedMotion);
    this.lighting.placeSun(minute, this.cam.target, this.cam.shadowHalf);
    const stage = this.onStage;
    stage.length = 0;
    stage.push(this.player, ...this.cast, ...this.guardCast, ...this.inspecting);
    if (this.model) stage.push(this.model);
    this.blobs.update(stage);
    updateOcclusion(this.renderer, this.cam.camera, focus, dt);
    skipEmpty(this.scene);
    this.renderer.render(this.scene, this.cam.camera);
    // The last prison's meshes, now that the new one's shaders are in use (setWorld).
    if (this.retired.length) for (const dispose of this.retired.splice(0)) dispose();
  }

  /** How the view sees the weather (P17): the rain's box as wide as the view, the lockdown's red as it pulses, the layer, where a point higher up lands on the ground (the camera's angle, turned by the escape camera). */
  private readonly wxView: WeatherView = { span: 40, alarm: 0, vents: false, roof: false, lx: 0, lz: 24 / 38 };
  private weatherView(layer: number, time: number): WeatherView {
    const v = this.wxView;
    v.span = Math.max(this.cam.camera.right - this.cam.camera.left, (this.cam.camera.top - this.cam.camera.bottom) * 1.6) + 6;
    v.alarm = this.lighting.alarmPulse(time, this.reducedMotion);
    v.vents = layer === LAYER.VENTS;
    v.roof = layer === LAYER.ROOF;
    const o = this.cam.offset;
    if (o.y > 1) {
      v.lx = o.x / o.y;
      v.lz = o.z / o.y;
    }
    return v;
  }

  /** The day's effects compiled while nothing is on screen (a new game; new graphics settings), not on a phone in the middle of a food fight. */
  private warmDay() {
    const views = [this.weather, this.events, this.delivery, this.gamesView, this.pastimesView];
    for (const v of views) v.warm(true);
    this.renderer.compile(this.scene, this.cam.camera);
    for (const v of views) v.warm(false);
  }

  /** Who the day's events put on stage this frame (the inspectors), for the contact shadows. */
  private inspecting: Character[] = [];

  /** A bolt of lightning (P17): the scene flashes white (not with reduced motion). */
  lightning() {
    if (!this.reducedMotion) this.lighting.lightning();
  }
}
