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
import { disposeTurf, showTurf, turfLayer } from './Turf';
import { Minefield } from './Minefield';
import { Guide } from './Guide';
import type { Prisoner } from '../content/prisoner';
import { lookFor } from './prisonerLook';
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

import { type WeatherFrame, type WeatherView } from './Weather';

import { type EventsFrame } from './DayEvents';
import { NO_HOLIDAY } from './Holidays';
import type { NoiseKind } from '../sim/events';

import type { Frame, Quality } from './viewFrame';
import { CameraRig } from './viewCamera';
import { Crowd } from './viewCrowd';
import { PlayerView } from './viewPlayer';
import { Effects } from './viewEffects';
import { Lighting } from './viewLight';
import { mapShot } from './viewMapShot';
import { DayPieces } from './viewPieces';
import { INMATE_LOOK, type Look } from './look';

const NO_FUSES: readonly number[] = [];
const NO_WEATHER: WeatherFrame = { rain: 0, fog: 0, heat: false, windAngle: 0, windForce: 0, snow: false };
const NO_EVENTS: EventsFrame = { movie: false, foodFight: false, inspection: false };

/** The Intake preview's zoom (P16): close on your prisoner in their cell. */
const PREVIEW_ZOOM = 4.2;

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
  /** The player's character (viewPlayer.ts). */
  private readonly me = new PlayerView(
    (c) => this.scene.add(c.root),
    (c) => this.retireCharacter(c),
    () => ({ gear: this.gear, running: this.running, crowd: this.crowd }),
  );
  get player(): Character {
    return this.me.c;
  }
  /** How the player is drawn now (the HUD's portrait follows it: portrait.ts). */
  get playerLook(): Look {
    return this.me.look;
  }
  /** The Intake's preview (P16): your prisoner standing in their cell behind the title, turned by `previewTurn`. */
  private model: Character | null = null;
  previewTurn = 0;
  private titleZoom = 1;
  /** 0 the title's angle … 1 the Intake's (eased between them). */
  private previewBlend = 0;
  /** The raft or the helicopter carries the player off (the camera follows it). */
  private carrying = false;
  private readonly pickups = new Pickups();
  private readonly cones = new Cones();
  /** Door tiles a guard is walking through this frame (they open for guards' keys). */
  private readonly doorsOpen = new Set<number>();
  private readonly guide = new Guide();
  private readonly dust = new Dust();
  private readonly showerWater = new ShowerWater();
  /** The tiles of the heads someone's washing under, this frame. */
  private readonly running = new Set<number>();
  private readonly blobs = new Blobs();
  /** Everyone on stage, for the contact shadows (refilled per frame). */
  private readonly onStage: Character[] = [];
  /** Where everyone stands this frame (x, z pairs, tiles): the trees' leaves fade over them. */
  private readonly people: number[] = [];
  /** The day's pieces in the picture: the weather, the day's events, the holidays, the vehicle, dogs, rats, smuggling, the getaways, the games and pastimes, the stage, the phone, the kiosk, the machines and boards, the release desk (viewPieces.ts). */
  private readonly pieces = new DayPieces();
  private titleHoliday = 0;
  private readonly flyAt = new THREE.Vector3();
  /** The player where they're drawn this frame (the match's ring under them). */
  private readonly meAt = { x: 0, z: 0 };
  /** How far the tipsy sway is in (0–1, eased). */
  private tipsySway = 0;
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
  private decor: DecorView | null = null;
  /** The roll call's paint over a football pitch (P29), and how far it's faded in (0 … 1). */
  private rollCallPaint: THREE.Mesh | null = null;
  /** 2.36: the gangs' turf painted on the floor, and how strongly it shows now. */
  private turfPaint: THREE.Group | null = null;
  private readonly turfShown = [0, 0];
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
  /** The lamps' pools stop at walls (2.36); a replay of an older run lights through them, as its rule does (session 14). */
  private lampsWalled = true;
  /** The bed dummy in the player's bed (2.28). */
  private readonly dummy = bedDummyMesh();
  /** 2.29: the bars and the bags (what's pressed on them this frame, gathered). */
  private readonly gear = new GymGear();
  private readonly workGear = new WorkGear();
  private readonly gearUses: GearUse[] = [];
  /** Everyone but the player (viewCrowd.ts). */
  private readonly crowd = new Crowd(
    (c) => this.scene.add(c.root),
    (c) => this.retireCharacter(c),
    this.gear,
    this.gearUses,
    this.running,
    this.doorsOpen,
  );
  private readonly feet = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly carried = new THREE.Vector3();
  /** What lands and flies: chips, bursts, blasts, the thrown cup, the lock-on ring, the puddles (viewEffects.ts). */
  private readonly fx = new Effects(
    this.dust,
    this.sparks,
    this.cam,
    (id) => this.who(id),
    () => this.player,
    () => this.reducedMotion,
    () => this.layer,
  );
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
      this.pieces.vendingView.group,
      this.pieces.menuView.group,
      this.pieces.coolerView.group,
      this.blobs.mesh,
      this.dust.mesh,
      this.showerWater.group,
      this.pieces.snow.points,
      this.sparks.mesh,
      this.snores.group,
      this.guide.group,
      this.pickups.group,
      this.noiseFx.group,
      this.cones.group,
      this.fx.ring,
      this.fx.bar,
      this.fx.cup,
      this.fx.puddles,
      this.pieces.weather.group,
      this.pieces.events.group,
      this.pieces.delivery.group,
      this.pieces.dogs.group,
      this.pieces.rats.group,
      this.pieces.smuggling.group,
      this.pieces.gamesView.group,
      this.pieces.pastimesView.group,
      this.pieces.longView.group,
      this.pieces.teamView.group,
      this.pieces.groundsView.group,
      this.pieces.nightsView.group,
      this.pieces.phoneView.group,
      this.pieces.kioskView.group,
      this.pieces.oddJobsView.group,
      this.pieces.holidaysView.group,
      this.pieces.releaseView.group,
      this.pieces.getaway.group,
    );
    this.cam.shadow = this.lighting.sun.shadow.camera;
    this.pieces.delivery.onSound = (kind, x, z) => this.onDelivery(kind, x, z);
    // Food landing in a food fight: a splat of it.
    this.pieces.events.onSplat = (x, z, color) => {
      this.dust.puff(x, z, color, 5, 0.1);
      this.onSplat(x, z);
    };
    this.setQuality(quality);
    addEventListener('resize', () => this.resize());
  }

  /** Session 9: CSS pixels per screen point, with the interface scaled (app/scale.ts): the 3D keeps its sharpness. */
  pixelScale = 1;
  private quality: Quality | null = null;

  setQuality(q: Quality) {
    this.quality = q;
    this.renderer.setPixelRatio(q.pixelRatio * this.pixelScale);
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
    if (this.turfPaint) {
      const old = this.turfPaint;
      retire([old], () => disposeTurf(old));
      this.turfPaint = null;
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
    this.crowd.chairs.clear();
    for (const p of world.props)
      if (p.kind === 'chair' || p.kind === 'readChair' || p.kind === 'deskChair') this.crowd.chairs.add(p.z * MAP_W + p.x);
    this.security = new Security(world);
    if (!same) {
      this.decor = new DecorView(world.def.decor ?? []);
      this.scene.add(this.decor.group);
    }
    // (P29: the roll call's paint where it crosses the football pitch, shown for roll call only.)
    this.rollCallPaint = rollCallLayer(world, pitch);
    this.rollCallShown = 0;
    if (this.rollCallPaint) this.scene.add(this.rollCallPaint);
    this.turfPaint = turfLayer(world);
    this.turfShown.fill(0);
    if (this.turfPaint) this.scene.add(this.turfPaint);
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
    this.pieces.smuggling.setLampMaterial(this.worldView!.archLight);
    this.underground = new Underground(world);
    this.scene.add(this.underground.group, this.underground.lantern);
    this.layer = -1;
    this.tilesRev = -1;
    this.wearRev = -1;
    this.showLayer(LAYER.GROUND);
    this.guide.world = world;
    this.cones.world = world;
    // (Their last prison's parts freed after the next frame, as the rest.)
    this.pieces.setWorld(world, pitch, this.later);
    this.warmDay();
    this.lighting.newWorld();
    // A new game dresses (rebuilds) the player afresh: nothing carries over, not even a pose.
    this.me.newWorld();
    this.crowd.showers.fill(0);
    for (const p of world.props) if (p.kind === 'shower') this.crowd.showers[p.z * MAP_W + p.x] = 1;
    this.showerWater.setWorld(world.props, MAP_W);
    this.running.clear();
    this.crowd.beds = world.cellBed.map((b) => b && { x: b.x + b.w / 2, z: b.z + b.d / 2, angle: (b.rot * Math.PI) / 2 });
    if (this.crowd.beds[1]) placeInBed(this.dummy, this.crowd.beds[1]);
    this.dummy.visible = false;
    this.gear.build(world);
    this.workGear.build(world);
    this.blockDark = this.blockDarkGoal = 0;
    this.lampsWalled = true;
    this.setCast(0);
    this.setGuards([]);
  }

  /** The guards: one character each (its key's color on the belt), and the bed each sleeps in at night (if any). */
  setGuards(beds: Array<BedPose | undefined>, keys: number[] = []) {
    this.crowd.setGuards(beds, keys, (k) => !!this.world?.def.guards[k]?.riot);
    this.cones.setCount(beds.length);
  }

  /** The other inmates: one character each, looks varied by cell, legs paced by walking speed (P27: the old-timer's hair gone white). */
  setCast(cast: Array<{ cell: number; gait: number; elder?: boolean }> | 0) {
    this.crowd.setCast(cast);
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
    this.fx.impact(action, tile, layer, broke);
  }

  /** Someone by Cast id (inmates, then guards; -1 the player). */
  private who(id: number): Character | undefined {
    return id < 0 ? this.player : this.crowd.who(id);
  }

  /** A blow lands (`by` hits `on`, Cast ids, -1 the player): viewEffects.ts. */
  blow(by: number, on: number, ko: boolean) {
    this.fx.blow(by, on, ko);
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
    return new Promise((done) => this.pieces.getaway.glide(from, to, dist, out, !this.reducedMotion, done));
  }

  /** A glide still in the air on screen (P24: the player's input waits for it to land). */
  get gliding(): boolean {
    return this.pieces.getaway.flying;
  }

  /** A replay's jump in time (P25): the weather shown as it is at once, not eased in from the moment before. */
  jumped() {
    this.lighting.jumped();
  }

  /** Resolves once a glide in the air is down (P24: the escape camera waits for it). */
  glideDown(): Promise<void> {
    return new Promise((done) => this.pieces.getaway.whenDown(done));
  }

  /** A firecracker going off (P14): a flash of sparks and smoke, the camera jolted. */
  bang(tile: number) {
    this.fx.bang(tile);
  }

  /** A cup of molten chocolate thrown at someone (Cast id): it arcs over, then splashes. */
  throwAt(on: number) {
    this.fx.throwAt(on);
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

  /** The interface's scale changed (session 9): the same pixels drawn as before, on fewer CSS pixels. */
  setPixelScale(s: number) {
    this.pixelScale = s;
    if (this.quality) this.setQuality(this.quality);
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
    this.me.setPrisoner(p);
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

  /** A character off screen, freed after the next frame (its materials' shaders kept for the next one's: setWorld). */
  private retireCharacter(c: Character) {
    this.scene.remove(c.root);
    this.retired.push(() => c.dispose());
  }

  /** Draws a frame of play: the camera follows the player, looking a little ahead. */
  draw(f: Frame, dt: number, time: number) {
    this.noiseFx.group.visible = true;
    this.me.dress(f.outfit, f.inked);
    // (2.36: the player's gang's colours.)
    this.player.colours(f.colours);
    // (P24: a glide still higher than the walls keeps the roofs drawn.)
    this.showLayer(this.pieces.getaway.aloft ? LAYER.ROOF : f.layer);
    this.redrawTiles(f);
    // (P24: hanging from a glider's bar in flight, both hands up.)
    const doing = this.pieces.getaway.flying
      ? DOING.LIFT
      : f.knockedOut
        ? DOING.KNOCKED_OUT
        : f.sleeping
          ? DOING.SLEEP
          : f.layer === LAYER.VENTS
            ? DOING.CRAWL
            : f.doing;
    if (this.me.draw(f, dt, time, doing, this.reducedMotion)) {
      const theme = f.layer === LAYER.GROUND ? this.world?.def.theme : undefined;
      const dust = theme === 'alpine' ? SNOW_DUST : theme === 'desert' ? SAND_DUST : DUST;
      if (dust[f.surface] !== undefined && !this.reducedMotion && (f.layer === LAYER.GROUND || f.layer === LAYER.UNDER))
        this.dust.puff(f.x, f.z, dust[f.surface], 2);
      this.onStep(f.surface);
    }
    this.followPlayer(f, dt);
    // The see-through cut: on the ground floor and in the tunnels (nothing stands over the vents or the roof).
    const cut = f.layer === LAYER.GROUND || f.layer === LAYER.UNDER;
    this.crowd.drawInmates(f, dt, time, this.reducedMotion);
    this.fx.drawPuddles(f, time);
    if (this.minefield) {
      this.minefield.group.visible = f.layer === LAYER.GROUND || f.layer === LAYER.ROOF;
      this.minefield.update(f.craters);
    }
    this.doorsOpen.clear();
    this.crowd.drawGuards(f, dt, time, this.reducedMotion);
    this.openAround(f, dt, time);
    this.drawSleepers(f, dt, time);
    this.drawSky(f, dt, time);
    this.drawWatch(f, dt, time);
    this.drawCarried(f, dt, time);
    this.drawPastimes(f, dt, time);
    // Tipsy (P28): the walk sways, on their feet only, easing in and out (none with reduced motion).
    const upright =
      !f.sleeping &&
      !f.knockedOut &&
      this.player.lying < 0.2 &&
      this.player.crawling < 0.1 &&
      !this.carrying &&
      !this.pieces.getaway.flying;
    this.tipsySway += ((f.long?.tipsy && upright && !this.reducedMotion ? 1 : 0) - this.tipsySway) * Math.min(1, dt * 2);
    this.player.root.rotation.z = this.tipsySway > 0.001 ? Math.sin(time * 2.3) * 0.07 * this.tipsySway : 0;
    // (Its buzz unheard below ground and in the vents, where it isn't drawn either.)
    const drone = f.layer === LAYER.GROUND || f.layer === LAYER.ROOF ? this.pieces.smuggling.droneAt : null;
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

  /** Damage, grates and tunnels redrawn when the tiles change (the desk over a tunnel pushed aside while the player is below). */
  private redrawTiles(f: Frame) {
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
  }

  /** The camera after the player: a look-ahead where they walk, a glide's ring, a match's goals; cut, not panned, when they're carried far. */
  private followPlayer(f: Frame, dt: number) {
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
    if (this.carrying || this.pieces.getaway.flying) {
      /* followed below */
    } else if (Math.abs(this.cam.target.x - f.x) + Math.abs(this.cam.target.z - f.z) > 10 || f.layer === LAYER.UNDER)
      this.cam.target.set(f.x, y, f.z);
    else this.cam.target.lerp(this.v.set(f.x, y, f.z).add(this.cam.ahead), Math.min(1, dt * 7));
    this.underground?.follow(f.x, f.z);
    this.feet.set(f.x, 0, f.z);
  }

  /** The trees' leaves over people, the doors the player and the delivery's vehicle open, the gates waved through. */
  private openAround(f: Frame, dt: number, time: number) {
    // A tree's leaves fade over anyone standing under or behind them (P23: a lookout posted there stays in view).
    if (this.decor) {
      const at = this.people;
      let n = 0;
      if (f.layer === LAYER.GROUND && this.player.root.visible) {
        at[0] = this.me.x;
        at[1] = this.me.z;
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
    this.pieces.delivery.group.visible = f.layer !== LAYER.UNDER;
    const near =
      !!this.world?.def.delivery && Math.hypot(f.x - this.world.def.delivery.tail.x - 0.5, f.z - this.world.def.delivery.tail.z - 0.5) < 4;
    this.pieces.delivery.update(dv, dt, time, !this.reducedMotion, near, f.layer === LAYER.GROUND);
    for (const t of this.pieces.delivery.opening) this.doorsOpen.add(t);
    // Waved through the checkpoint (P24): its gates stand open all the way out.
    const cp = this.world?.def.checkpoint;
    if (f.getaway.waved && cp) for (const q of cp.gates) this.doorsOpen.add(q.z * MAP_W + q.x);
    if (dv.stowed) this.player.root.visible = false;
  }

  /** Z's over everyone asleep, the dogs (asleep too, some of them), the snores. */
  private drawSleepers(f: Frame, dt: number, time: number) {
    // Z's over everyone asleep on the ground floor (the player too).
    this.sleepers.length = 0;
    if (f.layer === LAYER.GROUND) {
      if (f.sleeping) this.head(this.player);
      for (let k = 0; k < f.inmates.length; k++)
        if (f.inmates[k].doing === DOING.SLEEP && this.crowd.cast[k]) this.head(this.crowd.cast[k]);
      // (A guard dozing on its feet has its own Z's, over its cap: Character.)
      for (let k = 0; k < f.guards.length; k++)
        if (f.guards[k].doing === DOING.SLEEP && this.crowd.guardCast[k]) this.head(this.crowd.guardCast[k]);
    }
    // The dogs (P19): out of the picture below ground; asleep, Z's over them too.
    this.pieces.dogs.group.visible = f.layer !== LAYER.UNDER;
    this.pieces.dogs.update(
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
  }

  /** The snow and the weather (P17), and the day's events: the film, the food fight, the inspectors. */
  private drawSky(f: Frame, dt: number, time: number) {
    // Snow over an alpine prison, or on a Big Freeze Daily anywhere (P26), out in the open (ground floor and roofs).
    const wx = f.weather;
    const snowing = this.world?.def.theme === 'alpine' || wx.snow;
    this.pieces.snow.update(
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
    this.pieces.weather.update(
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
    this.pieces.events.timeScale = f.speed;
    this.inspecting = this.pieces.events.update(
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
  }

  /** The holiday (P42), the lock-on ring, the guards' cones, the cameras and searchlights, a takeover's riot. */
  private drawWatch(f: Frame, dt: number, time: number) {
    // The holiday (P42): its decor, the water fight's sprays, New Year's fireworks (from anywhere but a tunnel).
    this.pieces.holidaysView.dress(f.holiday.kind, this.later);
    this.pieces.holidaysView.group.visible = f.layer !== LAYER.UNDER;
    this.pieces.holidaysView.update(
      f.holiday,
      dt,
      time,
      f.x,
      f.z,
      !this.reducedMotion,
      this.security?.powerLevel ?? 1,
      f.guards,
      f.inmates,
    );
    this.sparks.update(dt);
    this.fx.drawLock(f, dt, time);
    this.cones.update(f.guards, dt, this.lighting.night, !this.reducedMotion, f.dark);
    // Cameras, searchlights and snipers belong to the ground floor (from below or in the ducts, out of the picture).
    if (this.security) {
      this.security.group.visible = f.layer !== LAYER.UNDER;
      this.security.update(f.security, dt, time, this.lighting.night, !this.reducedMotion);
    }
    this.riot = f.takeover;
  }

  /** Carried off (the raft, the helicopter, the delivery's truck, a glider: the camera goes with them), then the rats, on the floor or the shoulder. */
  private drawCarried(f: Frame, dt: number, time: number) {
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
    const ride = this.pieces.delivery.carry(this.carried);
    if (ride) {
      this.carrying = true;
      this.player.root.visible = false;
      this.cam.target.lerp(this.v.set(ride.x, 0, ride.z), Math.min(1, dt * 3));
    }
    // Off a roof on a glider (P24): carried along its fall, the camera going with them.
    this.pieces.getaway.group.visible = f.layer !== LAYER.UNDER;
    if (this.pieces.getaway.update(f.getaway, dt, time, !this.reducedMotion, this.lighting.night, this.flyAt)) {
      this.player.root.position.copy(this.flyAt);
      this.cam.target.lerp(this.v.set(this.flyAt.x, 0, this.flyAt.z), Math.min(1, dt * 5));
    }
    // The rats (P20), after the player has gone wherever they go (a raft, the helicopter, a truck): on the floor seen from anywhere but a tunnel;
    // on the shoulder of a player up and about (not lying, not crawling, not in a tunnel), turning with them.
    this.pieces.rats.group.visible = true;
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
    this.pieces.rats.update(f.rats, perch, this.player.root.rotation.y, dt, time, !this.reducedMotion, f.layer !== LAYER.UNDER);
  }

  /** The rest of the day's pieces: smuggling, the side games and pastimes, the long games, the pitch, the stage, the phone, the kiosk, the machines, the boards, the gym, the bed dummy, the release desk. */
  private drawPastimes(f: Frame, dt: number, time: number) {
    // Smuggling (P21): the drone, the drops, visiting day's arches and visitors.
    // (From the vents and the roof the ground floor shows too, its visitors and arches with it.)
    this.pieces.smuggling.group.visible = f.layer !== LAYER.UNDER;
    this.pieces.smuggling.update(f.smuggle, dt, time, !this.reducedMotion, f.layer !== LAYER.UNDER);
    // The side games (P22): dice on the ground floor, sports day's bunting (seen from the roofs too).
    this.pieces.gamesView.group.visible = f.layer !== LAYER.UNDER;
    this.pieces.gamesView.update(f.games, time, !this.reducedMotion, f.layer !== LAYER.UNDER);
    // Card sharks (P27): the court's spots, the ball, the cards, the board (the ground floor only).
    this.pieces.pastimesView.group.visible = f.layer === LAYER.GROUND;
    this.pieces.groundsView.group.visible = f.layer === LAYER.GROUND || f.layer === LAYER.ROOF;
    this.pieces.groundsView.update(f.planters);
    this.pieces.pastimesView.update(f.pastimes, f.x, f.z, time, !this.reducedMotion, f.layer === LAYER.GROUND, !!f.team.ball, dt);
    // Long games (P28): the garden, the track, the racers, the pet's laps (the ground floor, and from the roofs).
    this.pieces.longView.update(f.long, time, !this.reducedMotion, f.layer === LAYER.GROUND || f.layer === LAYER.ROOF);
    // The roll call's boxes over the pitch: chalked in for roll call, gone for the rest of the day (and any match).
    if (this.rollCallPaint) {
      const goal = f.rollCall && !f.team.ball ? 1 : 0;
      this.rollCallShown += (goal - this.rollCallShown) * (this.reducedMotion ? 1 : Math.min(1, dt * 2));
      if (Math.abs(goal - this.rollCallShown) < 0.01) this.rollCallShown = goal;
      (this.rollCallPaint.material as THREE.MeshBasicMaterial).opacity = this.rollCallShown;
      this.rollCallPaint.visible = this.rollCallShown > 0 && f.layer !== LAYER.UNDER;
    }
    // 2.36: the gangs' turf, faint all day, the tables bright at dinner, the corners in the evening.
    if (this.turfPaint)
      showTurf(this.turfPaint, f.turf, this.turfShown, dt, this.reducedMotion, f.layer === LAYER.GROUND || f.layer === LAYER.ROOF);
    // Team & ink (P29): the pitch and the ball (seen from the roofs and the vents too; not from the tunnels).
    this.meAt.x = f.x;
    this.meAt.z = f.z;
    this.pieces.teamView.update(f.team, f.inmates, dt, f.layer !== LAYER.UNDER, this.meAt);
    // Stage nights (P30): the stage, the buzzers (the ground floor, and from the vents and roofs over it).
    this.pieces.nightsView.update(f.nights, time, !this.reducedMotion, f.layer !== LAYER.UNDER);
    // The pay phone (P34): the handset, Lou's car, the diversion's beacon (not from the tunnels).
    this.pieces.phoneView.update(f.phone, dt, f.minuteOfDay, time, !this.reducedMotion, this.lighting.night, f.layer !== LAYER.UNDER);
    // The internet kiosk (P35): its screen, its glow after dark; the drawings over the bed (not from the tunnels).
    this.pieces.kioskView.update(f.kiosk, time, !this.reducedMotion, this.lighting.night, this.powerLevel, f.layer !== LAYER.UNDER);
    // The vending machine (2.32): its front, what's left in it, what's dropping (not from the tunnels).
    this.pieces.vendingView.update(f.vending, dt, time, !this.reducedMotion, this.lighting.night, f.layer !== LAYER.UNDER);
    // The menu board's dishes and the water cooler's bubbles (2.33).
    this.pieces.menuView.update(f.menu);
    this.pieces.coolerView.update(f.cooler, dt, !this.reducedMotion);
    // The odd jobs board (P40): the cards still up today, the job tag (not from the tunnels).
    this.pieces.oddJobsView.update(f.oddjobs, f.layer !== LAYER.UNDER);
    // (2.28: a dummy in the player's bed shows, but not under them, nor from the tunnels.)
    // (2.29: the bars: the player's, and those the inmates have up, gathered by Crowd.drawInmates.)
    if (f.doing === DOING.BENCH) this.gearUses.push({ prop: f.trainProp, up: this.player.pressed });
    this.gear.update(dt, this.gearUses, !this.reducedMotion);
    this.workGear.update(time, f.running, !this.reducedMotion);
    this.gearUses.length = 0;
    this.dummy.visible = f.bedDummy && !f.sleeping && f.layer !== LAYER.UNDER && !!this.crowd.beds[1];
    this.blockDarkGoal = f.blockDark ? 1 : 0;
    this.lampsWalled = f.dark?.walls !== false;
    this.pieces.releaseView.update(f.release, time, !this.reducedMotion, f.layer !== LAYER.UNDER);
  }

  /** A sleeper's head, for the snores. */
  private head(c: Character) {
    this.sleepers.push(c.root.position.x, c.root.position.y + 0.85, c.root.position.z);
  }

  /** A sniper's shot (GDD §5.6): the tracer and flash, dust where a warning shot lands, a jolt when it hits. */
  shot(tower: number, x: number, z: number, hit: boolean) {
    this.security?.shot(tower, x, z, hit);
    this.fx.shot(x, z, hit);
  }

  /** Away over the sea (P12): the raft pushes off the pier, or the helicopter lifts off with the player aboard; or (P18) the delivery's vehicle leaves with them hidden in it. */
  depart(kind: 'raft' | 'helicopter' | 'stowaway') {
    const p = this.player.root.position;
    if (kind === 'stowaway') {
      if (this.world?.def.delivery?.vehicle === 'helicopter') this.island?.depart('helicopter', p.x, p.z);
      else this.pieces.delivery.depart();
      return;
    }
    this.island?.depart(kind, p.x, p.z);
  }

  /** Lou's car pulls away with the player in it (P34, the phone's 'wheels' event): along its facing, fading out. */
  carAway() {
    this.pieces.phoneView.carAway();
  }

  /** The diversion at the gate (P34, the phone's 'diversion' and 'ignored' events): an amber beacon flashes at the ground tile for ten game minutes (steady with reduced motion). */
  phoneAlarm(tile: number) {
    this.pieces.phoneView.alarm(tile);
  }

  /** Delivery day's sounds (the play layer plays them): reversing beeps, the tailgate, the engine. */
  onDelivery: (kind: 'beep' | 'gate' | 'engine', x: number, z: number) => void = () => {};

  /** A landmine goes off (P11): a fireball of sparks, a column of sand and smoke, the hardest jolt. */
  blast(tile: number) {
    this.fx.blast(tile);
  }

  /** The electric fence bites (GDD §5.5): a shower of blue-white sparks off the player and a hard jolt. */
  shock() {
    this.fx.shock();
  }

  /** A detector arch tripped: its lamps flash. */
  tripArch() {
    this.worldView?.tripArch();
  }

  /** Draws the title backdrop: the camera drifts slowly over the prison, nobody in it. */
  drawTitle(dt: number, time: number) {
    this.showLayer(LAYER.GROUND);
    // Nothing of a game's noise behind the title (a lit firecracker, an aim, a wave).
    this.noiseFx.group.visible = false;
    this.pieces.blank(dt);
    // (The trees whole again; no match's framing.)
    this.decor?.shelter(this.people, 0, dt, false);
    this.cam.fitZoom = 0;
    if (this.rollCallPaint) this.rollCallPaint.visible = false;
    this.rollCallShown = 0;
    this.player.root.visible = false;
    this.fx.clear();
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
    this.pieces.snow.update(
      dt,
      time,
      this.cam.target.x,
      this.cam.target.z,
      !this.reducedMotion && this.world?.def.theme === 'alpine',
      this.openSky,
    );
    this.lighting.weather = null;
    this.pieces.weather.update(
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
    this.inspecting = this.pieces.events.update(NO_EVENTS, dt, time, [], [], false, false);
    this.pieces.holidaysView.dress(this.titleHoliday, this.later);
    this.pieces.holidaysView.group.visible = true;
    this.pieces.holidaysView.update(NO_HOLIDAY, dt, time, this.cam.target.x, this.cam.target.z, !this.reducedMotion);
    this.pieces.delivery.update(null, dt, time, false, false);
    this.render(600, dt, model ? this.feet : null, time);
  }

  /** Dev tool (the map viewer's "In game" picture): viewMapShot.ts. */
  mapShot(px = 40, ss = 2, dress = false): { canvas: HTMLCanvasElement; top: number; rows: number } {
    return mapShot(
      {
        renderer: this.renderer,
        scene: this.scene,
        cam: this.cam,
        lighting: this.lighting,
        pieces: this.pieces,
        dust: this.dust,
        guide: this.guide,
        showerWater: this.showerWater,
        island: this.island,
        security: this.security,
        pitch: this.pitch,
        world: this.world,
        turf: this.turfPaint,
        resize: () => this.resize(),
      },
      px,
      ss,
      dress,
    );
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
      this.lampsWalled,
    );
    this.dust.update(dt);
    // (The running heads as the last frame found them; off the ground floor's picture from the tunnels.)
    this.showerWater.update(dt, time, !this.reducedMotion, this.running, this.cam.camera);
    if (this.layer === LAYER.UNDER) this.showerWater.group.visible = false;
    this.cam.place(dt, time, this.previewBlend, this.shakeOn && !this.reducedMotion);
    this.lighting.placeSun(minute, this.cam.target, this.cam.shadowHalf);
    const stage = this.onStage;
    stage.length = 0;
    stage.push(this.player, ...this.crowd.cast, ...this.crowd.guardCast, ...this.inspecting);
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
    const views = this.pieces.warming;
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
