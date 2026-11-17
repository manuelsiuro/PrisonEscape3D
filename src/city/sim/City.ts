import type { PropKind } from '../../content/props';
import { atFire, dayDark, freshLight, lightMinute, relight, soundLight, useLight, type Light } from './light';
import { argA, DIR_X, DIR_Z, dirOf, opOf } from '../../sim/command';
import { mix32 } from '../../sim/rng';
import { bodyAt, walk, type Body } from '../../sim/systems/movement';
import { STEPS_PER_MINUTE, UNIT, WALK_SPEED } from '../../sim/tuning';
import { tileAt } from '../../sim/world/grid';
import { MAP_H, MAP_W, type World } from '../../sim/world/World';
import { decoVeils, generateDistrict, type District, type Gate } from '../gen/district';
import { CITY_N, cityPlan, OPPOSITE, SIDE, type CityPlan } from '../gen/plan';
import { generateTunnel, PLACES, TUNNEL, type Tunnel } from '../gen/tunnel';
import { cityItem, cityItemNumber } from '../content/items';
import { BOX_SLOTS, carLoot, CARS, EMPTY_DRAWS, lootList, SEARCH_STEPS, SEARCHED } from '../content/loot';
import { freshRanged, soundRanged, stepFires, useThrown } from './ranged';
import { carMinute, carOpened, carsHere, carTiles, freshCars, isWreck, soundCars } from './cars';
import { streamOf } from '../gen/plan';
import { BLEED, BLOW, DOWN } from '../content/dead';
import { CITY_RECIPES, recipeParts } from '../content/recipes';
import { noise, places, populate, stepDead, strike, type Zed } from './dead';
import { districtWorld } from './world';
import {
  clothesSpot,
  cutCode,
  cutSpots,
  foundClothes,
  freshTools,
  lockedDoors,
  lockedPanes,
  soundCuts,
  soundTools,
  TOOLS,
  withCuts,
  type CutSpot,
} from './tools';
import type { Beat } from '../content/story';
import {
  castOff,
  choose,
  freshStory,
  giveErrand,
  holds,
  meet,
  trade,
  soundStory,
  busNotes,
  storyAct,
  storyDid,
  storyFell,
  storyFound,
  storyMinute,
  storyMoved,
  storyPlaces,
  storyTarget,
  type Spot,
  type StoryPlaces,
} from './story';

/**
 * City Escape's simulation (C1: the foundations): a city of nine districts from a seed, the player
 * walking one of them at a time (its own World), crossing to the next where a street meets the
 * border, the clock, and what of each district has been seen (the map's fog). Deterministic, as the
 * prisons' is: fixed 20 Hz steps, whole-number positions, no clock or DOM; every input is a packed
 * command (sim/command.ts). The prisons' Sim is not used: nothing of a prison's day happens here.
 */

/** How death is taken, chosen when the city is made. Never renumber: saves store it. */
export const MODE = { SURVIVOR: 0, HARDCORE: 1 } as const;
/** The time a city starts at: dawn, the bus on its side. */
export const START_MINUTE = 6 * 60 + 30;
/** How far round the player the map fills in (tiles). */
export const SEE_TILES = 7;

const N = MAP_W * MAP_H;
const DAY_MINUTES = 1440;

/** What a command asks beside a direction (its op; `a` the pocket or the slot). Never renumber. */
export const COP = {
  NONE: 0,
  ACT: 1,
  TAKE: 2,
  STORE: 3,
  USE: 4,
  DROP: 5,
  CLOSE: 6,
  TAKE_ALL: 7,
  HIT: 8,
  MAKE: 9,
  CHOOSE: 10,
  TRADE: 11,
  GIVE: 12,
} as const;

/** The pockets. */
export const POCKETS = 8;
/** Hunger and energy are kept in thousandths of a point (whole numbers): a full bar. */
export const FULL = 100_000;
/** A game minute awake: hunger gone (a full bar lasts about 30 hours), energy gone (about 18). Asleep: hunger, and energy back. */
const HUNGER_AWAKE = 55;
const HUNGER_ASLEEP = 25;
const ENERGY_AWAKE = 92;
const ENERGY_ASLEEP = 250;
/** Starving: a point of health every so many minutes; fed (over half), one back every so many, awake and asleep. */
const STARVE_EVERY = 3;
const MEND_AWAKE = 10;
const MEND_ASLEEP = 4;
/** Under a quarter fed, or worn out: a slower walk (thousandths). */
const WEAK_SPEED = 820;
/** Sleep is for the night (from 20:00) or the tired (energy under this); it ends at 06:00, or rested by day. */
export const SLEEP_FROM = 20 * 60;
export const SLEEP_TO = 6 * 60;
const TIRED = 60_000;
/** A Survivor who fell wakes at home the next morning with this much health, hunger and energy. */
const WAKE = { health: 40, hunger: 15_000, energy: 60_000 };
/** A pile's most slots (what a save takes). */
const PILE_SLOTS = 64;
/** Steps to bar a door or take its boards down. */
export const BAR_STEPS = 40;
const BOARDS = cityItemNumber('boards');
const STOVE = cityItemNumber('stove');
const CROWBAR = cityItemNumber('crowbar');
const CUTTERS = cityItemNumber('cutters');

/** A pocket or a slot: [item number, how many] ([0, 0]: empty). */
export type Stack = [number, number];
const empty = (): Stack => [0, 0];

/** What the action button would do now: search a piece of furniture, look at what lies on the ground, sleep in a bed. */
export interface Target {
  kind: 'box' | 'pile' | 'bed' | 'door' | 'way' | 'npc' | 'lock' | 'fence' | 'pane';
  /** The box's key in the state (a piece of furniture: its number; a pile: 'g' + its tile; 2.58: a locked door: 'k' + its tile, a fence: 'f' + its first tile). */
  key: string;
  tile: number;
  /** The furniture it is (2.54: or a car, or a wreck). */
  prop: PropKind | 'car' | 'wreck' | null;
}

export interface CityState {
  /** The save's layout (new fields go at the end and load as optional). */
  v: 1;
  seed: number;
  mode: number;
  step: number;
  /** The district the player is in, and where (units). */
  district: number;
  player: Body;
  /** The districts walked into so far (bit d). */
  visited: number;
  // C2 (2.47), optional on load.
  /** Health (0–100), hunger and energy (0–FULL). */
  health: number;
  hunger: number;
  energy: number;
  /** The pockets. */
  inv: Stack[];
  /** What's in each box looked into or filled so far, by district then key (furniture searched, piles on the ground). */
  boxes: Record<string, Stack[]>;
  /** The box open now ('' none), and a first search under way: its key and the steps left. */
  open: string;
  search: string;
  searchLeft: number;
  sleeping: boolean;
  /** Where a Survivor wakes after a fall: [district, tile] (the last bed slept in; at first, beside the bus). */
  home: [number, number];
  /** Times fallen; `over` 1 once the city is lost (Hardcore). */
  deaths: number;
  over: number;
  // C2b (2.47), optional on load.
  /** The dead in the district the player is in; the draws their rules make; how many were put down for good; the step of the player's last blow. */
  zeds: Zed[];
  rng: number;
  kills: number;
  swung: number;
  /** 1 from entering a district until its dead are put down (the next step). */
  arrive: number;
  // C2c (2.47), optional on load.
  /** The street doors barred, by district: their tiles. */
  bars: Record<string, number[]>;
  // C3 (2.48), optional on load: the story.
  /** The act (1–5); what's been done (FLAG); the things found (a bit each of THINGS); the ways out scouted (bit way − 1) and the one chosen (0 none). */
  act: number;
  flags: number;
  kit: number;
  scouted: number;
  way: number;
  /** The notes found (a bit each); the way out set going (1) and the step it was; the way out taken (0: none yet); Dispatch's lines heard, in order. */
  notes: number;
  ready: number;
  readyAt: number;
  won: number;
  heard: Beat[];
  // C3b (2.48), optional on load: the survivors met (a bit each of PEOPLE), the errands each has had done (0–2), the count of the dead put down when each one's open errand was asked.
  met: number;
  errand: number[];
  mark: number[];
  /** The last brute put down in the streets: its district × 1000 + its night (-1: none yet). One a district a night. */
  brute: number;
  // 2.52, optional on load: light and fire. The torch's charge (game minutes) and whether it's on; what burns, by district (sim/light.ts).
  torch: number;
  torchOn: number;
  lights: Record<string, Light[]>;
  // 2.54, optional on load: a car's alarm sounding in the district the player is in (sim/cars.ts): none, or [where it's heard from, the step it stops].
  alarm: number[];
  // 2.55, optional on load: what burns in the district the player is in (sim/ranged.ts): [tile, the step it goes out].
  fires: number[][];
  // 2.58, optional on load: the crowbar and the bolt cutters (sim/tools.ts). Whether this city has locked buildings (one begun before them: 0);
  // the buildings forced open, by district (their lots); the fences cut (cutCode).
  locks: number;
  forced: Record<string, number[]>;
  cuts: number[];
  // 2.59, optional on load: what the player wears (0: the prison's orange; 1: clothes found).
  outfit: number;
  // 2.60, optional on load: the step until which a crawler's bite holds the player's leg (a slower walk).
  snare: number;
  // 2.61, optional on load: the health still to bleed from bites (BLEED); the windows broken, by district (their tiles).
  bleed: number;
  panes: Record<string, number[]>;
}

/** A city saved: its state, and each district's seen tiles (a bit a tile, base64). */
export interface CitySnapshot {
  state: CityState;
  seen: string[];
}

export type CityEvent =
  /** Through a gate: the district changed (the view takes the new world). */
  | { type: 'travel'; from: number; to: number; side: number; first: boolean }
  /** A first search begun, and a box opened (`found`: how many things it holds) or shut. */
  | { type: 'search'; key: string }
  | { type: 'open'; key: string; found: number; first: boolean }
  | { type: 'close' }
  | { type: 'took'; item: number; n: number }
  | { type: 'stored'; item: number }
  | { type: 'used'; item: number }
  | { type: 'dropped'; item: number }
  | { type: 'full' }
  | { type: 'sleep'; on: boolean; why?: 'morning' | 'rested' | 'hungry' | 'stirred' | 'attacked' | 'pounding' }
  /** The dead: one has seen the player; a bite; the player's blow (landed, and whether it put one down, where); dusk coming (minutes), night fallen or over. */
  | { type: 'spotted'; zed: number }
  | { type: 'bite'; harm: number }
  | { type: 'swing'; hit: boolean; dead: boolean; x?: number; z?: number; unseen?: boolean; left?: number; down?: boolean }
  /** 2.60: one of the dead put down for good (where, which way it faced, what it was, its own number); a screamer's scream; a bloater burst (`harm`: what it cost the player, 0 out of its reach); a crawler's bite holding a leg. */
  | { type: 'fell'; x: number; z: number; facing: number; kind: number; seed: number; lying?: boolean }
  | { type: 'scream'; x: number; z: number }
  | { type: 'burst'; x: number; z: number; harm: number }
  | { type: 'snared' }
  /** C2c: a thing made (or why not); a weapon worn out; a door barred or its boards taken down (the work begun, then done). */
  | { type: 'made'; item: number }
  | { type: 'cantMake'; why: 'parts' | 'bench' | 'stove' | 'unknown' }
  | { type: 'broke'; item: number }
  | { type: 'barring'; on: boolean }
  | { type: 'barred'; on: boolean; tile: number; shelter: boolean }
  | { type: 'dusk'; soon: number }
  | { type: 'night'; on: boolean }
  | {
      type: 'refused';
      why:
        | 'notTired'
        | 'tooHungry'
        | 'notHungry'
        | 'noNeed'
        | 'noUse'
        | 'doorway'
        | 'parts'
        | 'notNight'
        | 'tide'
        | 'locked'
        | 'noTrade'
        | 'noBattery'
        | 'noFire'
        | 'alreadyLit'
        | 'noRoom'
        | 'crowbar'
        | 'cutters';
    }
  /** 2.52: a fire, a lantern or a generator lit (LIGHT_KIND) or burnt out; the torch on or off (`spent`: its battery ran down). */
  | { type: 'lit'; kind: number; tile: number }
  | { type: 'burnt'; kind: number; tile: number }
  | { type: 'torch'; on: boolean; spent: boolean }
  /** 2.54: a car's alarm set off by a search (`tile`: the car's), or stopped. */
  | { type: 'alarm'; on: boolean; tile: number }
  /** 2.55: a thing thrown (a bottle, a molotov) from a tile to another; a bolt shot at one of the dead; the dead a fire put down; the player burnt; the last fire out. */
  | { type: 'thrown'; item: number; from: number; to: number }
  | { type: 'shot'; from: number; x: number; z: number; dead: boolean }
  | { type: 'scorched'; dead: number }
  | { type: 'burn'; harm: number }
  | { type: 'fireOut' }
  /** 2.58: a locked door being forced or a fence being cut (the work begun); a building forced open; a fence cut through (the district is put up again). */
  | { type: 'forcing'; what: 'lock' | 'fence' | 'pane' }
  | { type: 'casting' }
  /** 2.59: somebody's clothes found and put on. */
  | { type: 'clothes' }
  | { type: 'forced'; tile: number }
  /** 2.61: a chained building's window broken and climbed through (`cut`: by bare hands, on the glass); bleeding begun or stopped (`why`: a bandage, or it stopped of itself). */
  | { type: 'smashed'; tile: number; cut: boolean }
  | { type: 'bleeding'; on: boolean; why?: 'bandaged' | 'clotted' }
  /** 2.61: one of the dead knocked down got up again (where). */
  | { type: 'rose'; x: number; z: number }
  | { type: 'cut'; tile: number }
  /** C3b: a survivor spoken to (first met, an errand handed in, or a word), a swap made. */
  | { type: 'talk'; who: number; what: 'met' | 'done' | 'chat' }
  | { type: 'traded'; who: number; item: number }
  /** C4: a brute's blow on a barred door (said every so many of its steps there). */
  | { type: 'pound'; tile: number }
  /** C3, the story: a thing or a note found; the radio mended; Dispatch speaks; the act moves on; a way out scouted, chosen, set going (or gone out), the metro's gates open, a barred door torn open; away. */
  | { type: 'found'; thing: number }
  | { type: 'note'; n: number }
  | { type: 'fixed' }
  | { type: 'say'; beat: Beat }
  | { type: 'act'; act: number }
  | { type: 'scouted'; way: number }
  | { type: 'chose'; way: number }
  | { type: 'ready'; way: number; on: boolean }
  | { type: 'gates' }
  | { type: 'breach'; tile: number }
  | { type: 'escaped'; way: number }
  /** Hunger bites (once each time it reaches nothing). */
  | { type: 'starving' }
  /** Fallen: `final` in Hardcore (the city is lost); a Survivor wakes at home (`moved`: in another district). */
  | { type: 'dead'; final: boolean; moved: boolean };

export class City {
  readonly plan: CityPlan;
  readonly state: CityState;
  /** What a step reported, for sound and the screen; emptied at each step. */
  events: CityEvent[] = [];
  /** The district the player is in: its plan, and its world. */
  district!: District;
  world!: World;
  /** Per district: 1 on each tile seen so far. */
  readonly seen: Uint8Array[] = Array.from({ length: PLACES }, () => new Uint8Array(N));
  /** Bumps when `seen` changes (the map redraws). */
  seenRev = 0;
  private readonly districts = new Map<number, District>();
  private lastTile = -1;

  constructor(seed: number, mode: number = MODE.SURVIVOR, from?: CitySnapshot) {
    this.plan = cityPlan(from?.state.seed ?? seed);
    if (from) {
      // (A save from before a field has it fresh, after the ones it has: a save's own order is kept.)
      this.state = { ...from.state, player: { ...from.state.player } };
      // (2.58: a city begun before the chains has none, whoever builds it from its save.)
      if ((this.state as { locks?: number }).locks === undefined) this.state.locks = 0;
      for (const [k, v] of Object.entries({
        ...freshSurvival(),
        ...freshStory(),
        ...freshLight(),
        ...freshCars(),
        ...freshRanged(),
        ...freshTools(),
      }))
        if ((this.state as unknown as Record<string, unknown>)[k] === undefined) Object.assign(this.state, { [k]: v });
      from.seen.forEach((text, d) => d < PLACES && unpackBits(text, this.seen[d]));
      this.enter(this.state.district, true);
    } else {
      const d = this.plan.start;
      this.state = {
        v: 1,
        seed: this.plan.seed,
        mode,
        step: 0,
        district: d,
        player: bodyAt(0, 0),
        visited: 0,
        ...freshSurvival(),
        ...freshStory(),
        ...freshLight(),
        ...freshCars(),
        ...freshRanged(),
        ...freshTools(),
      };
      this.state.rng = this.salt(77) | 0;
      this.enter(d);
      const s = this.district.spawn;
      this.state.player = bodyAt(s.x, s.z);
      this.state.home = [d, s.z * MAP_W + s.x];
    }
    this.look();
  }

  /** 2.59: the furniture of the start's district the clothes lie in (-1: none). */
  private wardrobe: number | null = null;
  get clothes(): number {
    return (this.wardrobe ??= clothesSpot(this));
  }
  /** 2.61: where the notes about the others off the bus lie (worked out when first asked, after everything else). */
  private bus: Spot[] | null = null;
  get busNotes(): Spot[] {
    return (this.bus ??= busNotes(this));
  }
  /** Where the story's things lie (worked out when first asked). */
  private places: StoryPlaces | null = null;
  get story(): StoryPlaces {
    return (this.places ??= storyPlaces(this));
  }

  /** A district's plan as the generator made it (made once, kept). */
  baseOf(d: number): District {
    let made = this.bases.get(d);
    if (!made) this.bases.set(d, (made = d === TUNNEL ? this.tunnel.district : generateDistrict(this.plan, d)));
    return made;
  }
  private readonly bases = new Map<number, District>();
  /** A district's plan as it stands: the generator's, with the fences cut so far (2.58). Kept until another is cut. */
  districtOf(d: number): District {
    let made = this.districts.get(d);
    if (!made) this.districts.set(d, (made = withCuts(this, this.baseOf(d))));
    return made;
  }
  /** 2.56: the metro's tunnel, a tenth map (made once, kept). */
  private under: Tunnel | null = null;
  get tunnel(): Tunnel {
    return (this.under ??= generateTunnel(this.plan));
  }
  /** After a load mended what a district is made of: put up again, everyone where they were. */
  reenter() {
    this.districts.clear();
    this.enter(this.state.district, true);
  }
  /** Up at the metro's stairs again (a save that has no business in the tunnel). */
  surface() {
    const s = this.state;
    this.enter(this.story.wayDistrict[2]);
    const exit = this.story.exits[2];
    s.player = bodyAt(exit % MAP_W, Math.floor(exit / MAP_W), s.player.facing);
    s.zeds = [];
    s.arrive = 1;
  }
  /** Down the metro's stairs, the gates open: to the foot of them, in the tunnel (story.ts asks). */
  descend() {
    const s = this.state;
    s.search = '';
    this.close();
    const from = s.district;
    const first = ((s.visited >> TUNNEL) & 1) === 0;
    this.enter(TUNNEL);
    s.player = bodyAt(this.tunnel.start % MAP_W, Math.floor(this.tunnel.start / MAP_W), s.player.facing);
    this.events.push({ type: 'travel', from, to: TUNNEL, side: SIDE.W, first });
  }

  /** Into a district (`kept`: a save's, its dead as they were). */
  private enter(d: number, kept = false) {
    this.district = this.districtOf(d);
    this.world = districtWorld(this.plan, d, this.district);
    this.state.district = d;
    this.state.visited |= 1 << d;
    this.lastTile = -1;
    // Which furniture can be searched or slept in, by tile (a bed's two).
    this.propAt = new Int16Array(N);
    this.district.props.forEach((p, k) => {
      if (SEARCHED[p.kind] === undefined) return;
      for (let z = p.z; z < p.z + (p.d ?? 1); z++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) this.propAt[z * MAP_W + x] = k + 1;
    });
    // Which tile is a building's street door (its lot's number + 1), and what stops the dead: the world, and the doors barred.
    this.doorLot = new Uint8Array(N);
    this.district.lots.forEach((l, k) => l.doors.forEach((i) => (this.doorLot[i] = k + 1)));
    // (2.58: the locked buildings: their doors shut to everyone, nobody put down inside. The fences that can be cut.)
    this.locked = lockedDoors(this, d);
    this.panes = lockedPanes(this, d, this.locked);
    for (let i = 0; i < N; i++) if (this.locked[i]) this.world.parked[i] = 1;
    this.world.refreshBlock();
    this.fences = cutSpots(this, d);
    this.locksRev++;
    this.setPlaces();
    // The survivors here: nobody walks through them, and nothing is put down in the buildings they hold.
    this.people = [];
    this.safeLots = new Set();
    this.story.people.forEach((p, k) => {
      if (p.district !== d) return;
      this.people.push({ who: k, tile: p.tile });
      this.safeLots.add(p.lot);
      this.world.parked[p.tile] = 1;
    });
    if (this.people.length) this.world.refreshBlock();
    this.refreshBars();
    carsHere(this);
    // (2.54: an alarm isn't heard from the next district.)
    if (!kept) this.state.alarm = [];
    // (2.55: nor does a fire burn on behind them.)
    if (!kept) this.state.fires = [];
    this.firesRev++;
    dayDark(this);
    // (2.53: by day the dead wait where it's dark.)
    this.zedPlaces.deep = this.zedPlaces.indoors.filter((i) => this.dim[i] === 1);
    relight(this);
    if (!kept) this.state.arrive = 1;
  }
  /** Where the dead may be: the open floors indoors (not a locked building's) and the streets. */
  private setPlaces() {
    this.zedPlaces = places(this);
    this.zedIndoor = new Uint8Array(N);
    this.zedStreet = new Uint8Array(N);
    for (const i of this.zedPlaces.indoors) this.zedIndoor[i] = 1;
    for (const i of this.zedPlaces.streets) this.zedStreet[i] = 1;
    this.zedPlaces.deep = this.zedPlaces.indoors.filter((i) => this.dim[i] === 1);
  }
  /** 2.58: per tile, 1 on a locked building's door; the fences that can be cut here; a count the view watches (a door forced, a district entered). */
  locked = new Uint8Array(N);
  /** 2.61: per tile, 1 on a window of a building still locked. */
  panes = new Uint8Array(N);
  fences: CutSpot[] = [];
  locksRev = 0;
  /** Whether a building (its lot's number) is locked still. */
  lockedLot(lot: number): boolean {
    return (this.district.lots[lot]?.doors ?? []).some((i) => this.locked[i] === 1);
  }
  /** Whether a building was locked when the city began (forced since, or not): what's inside was never picked over. */
  private wasLocked(lot: number): boolean {
    return this.lockedLot(lot) || (this.state.forced[this.state.district] ?? []).includes(lot);
  }
  /** 2.54: per tile, the car or wreck standing there (its first tile + 1); a count the view watches (a car searched, a district entered). */
  carAt = new Int16Array(N);
  carsRev = 0;
  /** 2.55: a count the view watches (a fire lit, gone out, a district entered). */
  firesRev = 0;
  /** 2.52: the tiles in strong light in the district the player is in; whether anything burns here; a count the view watches. */
  lit = new Uint8Array(N);
  /** 2.53: the tiles daylight doesn't reach (deep in a building): dark by day as the street is by night. */
  dim = new Uint8Array(N);
  anyLight = false;
  lightsRev = 0;
  /** The survivors in the district the player is in, and the buildings (lots) they hold. */
  people: Array<{ who: number; tile: number }> = [];
  safeLots = new Set<number>();
  /** No dead at all (the tests of everything else; never set in play). */
  peace = false;
  /** Per tile: the searchable piece of furniture standing there, + 1. */
  private propAt = new Int16Array(N);
  /** Where the dead are put down and go to ground: the district's open floors indoors and its streets, and each as a mask (`deep`: the floors indoors daylight doesn't reach). */
  zedPlaces: { indoors: number[]; streets: number[]; deep: number[] } = { indoors: [], streets: [], deep: [] };
  zedIndoor = new Uint8Array(N);
  zedStreet = new Uint8Array(N);
  /** 2.58: the share of the district's floors indoors that isn't behind a chained door (the dead indoors are that many fewer). */
  zedShare = 1;
  /** Per tile: the building (lot + 1) whose street door it is. */
  private doorLot = new Uint8Array(N);
  /** What the dead can't walk: the world's own, and every barred door. */
  zedGrid = new Uint8Array(N);
  /** What stops one that boards don't (a brute, one at a sleeper's door): the world's own, and every locked door. */
  lockGrid = new Uint8Array(N);
  /** The same, as `walk` asks it. */
  readonly zedWorld = {
    blocked: (x: number, z: number) => x < 0 || z < 0 || x >= MAP_W || z >= MAP_H || this.zedGrid[z * MAP_W + x] === 1,
  };
  /** Bumps when a door is barred or opened (the view's boards). */
  barsRev = 0;

  /** The barred doors of the district the player is in. */
  get bars(): readonly number[] {
    return this.state.bars[this.state.district] ?? [];
  }
  private refreshBars() {
    // (2.58: a locked door stops everyone, and sight.)
    this.lockGrid.set(this.world.npcBlock);
    // (Its leaf is drawn shut: the world works out again which doors are, each time it is asked what blocks.)
    for (let i = 0; i < N; i++) if (this.locked[i]) this.lockGrid[i] = this.world.doorShut[i] = 1;
    this.zedGrid.set(this.lockGrid);
    // (Boards stop sight as well as the dead: what stands on the streets veils as it did, and each barred door too.)
    for (let i = 0; i < N; i++) this.world.veil[i] = decoVeils(this.district.deco[i]) || this.locked[i] ? 1 : 0;
    for (const i of this.bars) this.zedGrid[i] = this.world.veil[i] = 1;
    this.barsRev++;
  }
  /** After a load: only street doors stay barred, each once; `old`: a save from before wear, its weapons given their blows. */
  soundBars(old: boolean) {
    const s = this.state;
    const sound: Record<string, number[]> = {};
    for (const [d, list] of Object.entries(s.bars)) {
      if (!/^[0-9]$/.test(d) || !Array.isArray(list)) continue;
      const doors = new Set(this.districtOf(Number(d)).lots.flatMap((l) => l.doors));
      const kept = [...new Set(list)].filter((i) => doors.has(i));
      if (kept.length) sound[d] = kept;
    }
    s.bars = sound;
    if (!old) return;
    for (const st of [...s.inv, ...Object.values(s.boxes).flat()]) {
      const wear = cityItem(st[0])?.wear;
      if (wear !== undefined) st[1] = wear;
    }
  }
  /** After a load: the barred doors as the save has them. */
  rebar() {
    this.refreshBars();
  }
  /** Whether a building is a shelter: it has street doors and every one is barred. */
  shelter(lot: number): boolean {
    const doors = this.district.lots[lot]?.doors ?? [];
    return doors.length > 0 && doors.every((i) => this.bars.includes(i));
  }
  /** The building (its lot's number; -1 the street) the player stands in. */
  get lot(): number {
    return this.district.lotAt[this.tile] - 1;
  }

  /** What blocks walking in any district (the one the player is in: its world's own; another: built to ask). */
  districtGrid(d: number): Uint8Array {
    return d === this.state.district ? this.world.block : districtWorld(this.plan, d, this.districtOf(d)).block;
  }
  /** What blocks walking in the district (the world's own grid: walls, water, furniture, what stands on the streets). */
  get grid(): Uint8Array {
    return this.world.block;
  }
  /** The tile the player stands on. */
  get tile(): number {
    return tileAt(this.state.player.x, this.state.player.z);
  }
  /** The time of day in minutes, and the day (1 on the first). */
  get minute(): number {
    return (START_MINUTE + Math.floor(this.state.step / STEPS_PER_MINUTE)) % DAY_MINUTES;
  }
  get day(): number {
    return Math.floor((START_MINUTE + Math.floor(this.state.step / STEPS_PER_MINUTE)) / DAY_MINUTES) + 1;
  }
  /** A stable number for this city and a purpose (draws that never shift another's). */
  salt(what: number): number {
    return mix32((this.state.seed ^ Math.imul(what + 1, 0x85ebca6b)) | 0);
  }

  /** One step: the player walks; on a gate's tiles, across to the next district. */
  step(cmd: number) {
    this.events = [];
    const s = this.state;
    if (s.over) return;
    s.step++;
    const dir = dirOf(cmd);
    if (s.step % STEPS_PER_MINUTE === 0) this.minutePassed();
    if (s.over || this.events.some((e) => e.type === 'dead')) return;
    // (2.61: a wound bleeds, awake or asleep, never the last point.)
    if (s.bleed && s.step % BLEED.every === 0) {
      if (s.health > 1) s.health--;
      if (--s.bleed <= 0 || s.health <= 1) {
        s.bleed = 0;
        this.events.push({ type: 'bleeding', on: false, why: 'clotted' });
      }
    }
    if (s.sleeping) {
      // (A push on the stick wakes them; the dead go on about the streets meanwhile.)
      if (dir) this.wake('stirred');
      // (The journal is read in bed: a way out chosen there is chosen.)
      if (opOf(cmd) === COP.CHOOSE) choose(this, argA(cmd));
      if (!this.peace) stepDead(this);
      // (2.55: what burns goes on burning, and wakes whoever lies in it.)
      if (!s.over && !this.events.some((e) => e.type === 'dead')) stepFires(this);
      return;
    }
    const weak = s.hunger < FULL / 4 || s.energy <= 0 || s.step < s.snare;
    const px = s.player.x;
    const pz = s.player.z;
    walk(this.world, s.player, dir, weak ? Math.trunc((WALK_SPEED * WEAK_SPEED) / 1000) : WALK_SPEED);
    // (Nobody walks through the dead: a step that would bring them closer to one already against them isn't taken.)
    if (dir && crowded(s.zeds, px, pz, s.player.x, s.player.z)) {
      s.player.x = px;
      s.player.z = pz;
    }
    // A first search takes a moment, standing still; walking off leaves it.
    let ended = false;
    if (s.search) {
      if (dir || this.target()?.key !== s.search) s.search = '';
      else if (--s.searchLeft <= 0) {
        const key = s.search;
        s.search = '';
        ended = true;
        if (key.startsWith('d')) this.bar(Number(key.slice(1)));
        else if (key === 'w') castOff(this);
        else if (key.startsWith('k')) this.force(Number(key.slice(1)));
        else if (key.startsWith('x')) this.smash(Number(key.slice(1)));
        else if (key.startsWith('f')) this.cut(Number(key.slice(1)));
        else this.openBox(key, true);
      }
    }
    // (A press on the very step the work ends was a press at the work: it doesn't begin the opposite, or shut the box just opened.)
    if (!(ended && opOf(cmd) === COP.ACT)) this.act(opOf(cmd), argA(cmd));
    // (2.60: fallen to their own blow, a bloater's burst: nothing more this step, as after the dead's.)
    if (s.over || this.events.some((e) => e.type === 'dead')) return;
    // (A district just entered: its dead are put down once the player stands in it. In the state: a save made at a crossing loads to the same.)
    if (s.arrive) {
      s.arrive = 0;
      if (!this.peace) populate(this);
    }
    if (!this.peace) stepDead(this);
    if (s.over || this.events.some((e) => e.type === 'dead')) return;
    // (2.55: what burns, burns whoever stands in it.)
    stepFires(this);
    if (s.over || this.events.some((e) => e.type === 'dead')) return;
    const here = this.tile;
    if (here === this.lastTile) return;
    // (Walked away from the open box: shut.)
    if (s.open && !this.inReach(s.open)) this.close();
    const gate = this.district.gates.find((g) => g.tiles.includes(here));
    if (gate) this.cross(gate);
    storyMoved(this);
    this.look();
  }

  // ------------------------------------------------------------------ the body's needs
  private minutePassed() {
    const s = this.state;
    const minute = Math.floor(s.step / STEPS_PER_MINUTE);
    s.hunger = Math.max(0, s.hunger - (s.sleeping ? HUNGER_ASLEEP : HUNGER_AWAKE));
    s.energy = s.sleeping ? Math.min(FULL, s.energy + ENERGY_ASLEEP) : Math.max(0, s.energy - ENERGY_AWAKE);
    if (s.hunger === 0) {
      if (minute % STARVE_EVERY === 0) this.hurt(1);
      if (!this.starved) this.events.push({ type: 'starving' });
      this.starved = true;
    } else {
      this.starved = false;
      if (s.hunger > FULL / 2 && minute % (s.sleeping ? MEND_ASLEEP : MEND_AWAKE) === 0) s.health = Math.min(100, s.health + 1);
    }
    if (!s.over) storyMinute(this);
    if (!s.over) lightMinute(this);
    if (!s.over) carMinute(this);
    if (s.over || !s.sleeping) return;
    if (s.hunger === 0) this.wake('hungry');
    else if (this.minute === SLEEP_TO) this.wake('morning');
    else if (s.energy >= FULL && this.minute > SLEEP_TO && this.minute < SLEEP_FROM) this.wake('rested');
  }
  private starved = false;

  /** Woken (the dead's bite). */
  wakeNow(why: 'attacked' | 'pounding') {
    if (this.state.sleeping) this.wake(why);
  }
  private wake(why: 'morning' | 'rested' | 'hungry' | 'stirred' | 'attacked' | 'pounding') {
    this.state.sleeping = false;
    this.events.push({ type: 'sleep', on: false, why });
  }

  /** Health lost; at nothing, fallen. */
  hurt(n: number) {
    const s = this.state;
    s.health = Math.max(0, s.health - n);
    if (s.health > 0) return;
    s.sleeping = false;
    s.search = '';
    s.bleed = 0;
    this.close();
    s.deaths++;
    if (s.mode === MODE.HARDCORE) {
      s.over = 1;
      this.events.push({ type: 'dead', final: true, moved: false });
      return;
    }
    // A Survivor: what they carried lies where they fell; they wake at home the next morning.
    // (2.56: fallen in the tunnel, it lies at the top of the metro's stairs: not behind another night of the generator.)
    const under = s.district === TUNNEL;
    // (Made only if something is carried: empty pockets leave no pile.)
    // (2.57: beside the stairs, not on them: on their tile the button was the generator's, and the pile came second.)
    const stairs = this.story.exits[2];
    const top = under ? this.districtGrid(this.story.wayDistrict[2]) : null;
    const beside = (top && [stairs + MAP_W, stairs - MAP_W, stairs + 1, stairs - 1].find((i) => !top[i])) ?? stairs;
    const pile = () => (under ? (s.boxes[`${this.story.wayDistrict[2]}:g${beside}`] ??= []) : this.boxOf(`g${this.tile}`, true));
    for (const st of s.inv) {
      if (!st[0]) continue;
      // (Onto the pile already there, if they fell here before: never more slots than a save takes.)
      this.put(pile(), PILE_SLOTS, st[0], st[1]);
      st[0] = st[1] = 0;
    }
    storyFell(this);
    // (2.54: nobody is left to hear the alarm.)
    s.alarm = [];
    s.fires = [];
    this.firesRev++;
    const [d, tile] = s.home;
    const moved = d !== s.district;
    if (moved) this.enter(d);
    s.arrive = 1;
    s.zeds = [];
    s.player = bodyAt(tile % MAP_W, Math.floor(tile / MAP_W));
    // (To the next 06:30.)
    const now = (START_MINUTE + Math.floor(s.step / STEPS_PER_MINUTE)) % DAY_MINUTES;
    s.step += ((START_MINUTE - now + DAY_MINUTES) % DAY_MINUTES || DAY_MINUTES) * STEPS_PER_MINUTE;
    // (2.52: what burnt out in the hours passed over is out before the morning's dead are put down.)
    relight(this);
    s.health = WAKE.health;
    // (Hunger is not mended by a fall: a little, so the morning isn't spent starving again at once.)
    s.hunger = Math.max(s.hunger, WAKE.hunger);
    s.energy = Math.max(s.energy, WAKE.energy);
    this.look();
    this.events.push({ type: 'dead', final: false, moved });
  }

  // ------------------------------------------------------------------ boxes and pockets
  private boxKey(key: string) {
    return `${this.state.district}:${key}`;
  }
  /** A box's slots (`make`: an empty one made where there's none), or what's in it so far. */
  private boxOf(key: string, make: true): Stack[];
  private boxOf(key: string, make?: false): Stack[] | undefined;
  private boxOf(key: string, make = false): Stack[] | undefined {
    const k = this.boxKey(key);
    if (make) return (this.state.boxes[k] ??= []);
    return this.state.boxes[k];
  }

  /** What the action button would do now: what lies underfoot, else the furniture faced, else any beside. */
  target(): Target | null {
    const here = this.tile;
    // (Standing on the way out's own tile: it is what's meant, whatever lies there.)
    const way = storyTarget(this);
    if (way && way.tile === here) return way;
    // (Beside a survivor: them, before what lies underfoot, or a reward dropped there would take them away.)
    for (const p of this.people)
      if (Math.abs((p.tile % MAP_W) - (here % MAP_W)) + Math.abs(Math.floor(p.tile / MAP_W) - Math.floor(here / MAP_W)) === 1)
        return { kind: 'npc', key: `n${p.who}`, tile: p.tile, prop: null };
    if (this.boxOf(`g${here}`)?.some((st) => st[0])) return { kind: 'pile', key: `g${here}`, tile: here, prop: null };
    const p = this.state.player;
    const x = here % MAP_W;
    const z = Math.floor(here / MAP_W);
    const fx = Math.sign(Math.round(Math.sin(headingOf(p.facing)) * 2));
    const fz = Math.sign(Math.round(Math.cos(headingOf(p.facing)) * 2));
    const around: Array<[number, number]> = [
      [fx, 0],
      [0, fz],
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ];
    // (A street door faced comes before the furniture beside: what's faced is what's meant.)
    // (2.58: a locked one is forced, whatever is in the pockets: the button says what it wants.)
    const doorAt = (t: number): Target | null =>
      t >= 0 && t < N && this.locked[t]
        ? { kind: 'lock', key: `k${t}`, tile: t, prop: null }
        : t >= 0 && t < N && this.doorLot[t] && (this.bars.includes(t) || this.count(BOARDS) > 0)
          ? { kind: 'door', key: `d${t}`, tile: t, prop: null }
          : null;
    const faced = (fx ? doorAt(here + fx) : null) ?? (fz ? doorAt(here + fz * MAP_W) : null);
    if (faced) return faced;
    // (2.61: a chained building's window faced from outside: broken, and climbed through.)
    const pane = fx && this.panes[here + fx] ? here + fx : fz && this.panes[here + fz * MAP_W] ? here + fz * MAP_W : -1;
    if (pane >= 0 && this.district.lotAt[here] !== this.district.lotAt[pane])
      return { kind: 'pane', key: `x${pane}`, tile: pane, prop: null };
    // (Beside the way out's tile: it comes after the furniture faced, before the furniture merely beside.)
    for (let a = 0; a < around.length; a++) {
      const [dx, dz] = around[a];
      if (a === 2 && way) return way;
      if (!dx && !dz) continue;
      const tx = x + dx;
      const tz = z + dz;
      if (tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) continue;
      const t = tz * MAP_W + tx;
      const k = this.propAt[t];
      if (k) {
        const kind = this.district.props[k - 1].kind;
        // (A bed looked into and empty is slept in; with something in it, looked into again first.)
        const empty = this.boxOf(`${k - 1}`)?.every((st) => !st[0]) ?? false;
        // (One the story still has something in, the armoury's: looked into, never slept in.)
        return { kind: kind === 'bed' && empty && !holds(this, k - 1) ? 'bed' : 'box', key: `${k - 1}`, tile: t, prop: kind };
      }
      if (this.boxOf(`g${t}`)?.some((st) => st[0]) && !this.grid[t]) return { kind: 'pile', key: `g${t}`, tile: t, prop: null };
    }
    // A street door underfoot or beside: barred with boards from the pockets, or its boards taken down.
    for (const t of [here, here - MAP_W, here + 1, here + MAP_W, here - 1]) {
      const door = doorAt(t);
      if (door) return door;
    }
    // (2.54) A car or a wreck beside, the one faced first: after everything else, so nothing that was done before is done otherwise.
    for (const [dx, dz] of around) {
      const tx = x + dx;
      const tz = z + dz;
      if ((!dx && !dz) || tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) continue;
      const car = this.carAt[tz * MAP_W + tx];
      if (car) return { kind: 'box', key: `c${car - 1}`, tile: tz * MAP_W + tx, prop: isWreck(this, car - 1) ? 'wreck' : 'car' };
    }
    // (2.58) The army's fence where a street runs up to it on both sides: cut through. Last of all.
    for (const f of this.fences)
      if (f.tiles.some((t) => Math.abs((t % MAP_W) - x) + Math.abs(Math.floor(t / MAP_W) - z) === 1))
        return { kind: 'fence', key: `f${f.tiles[0]}`, tile: f.tiles[0], prop: null };
    return null;
  }

  /** Whether a box has been looked into. */
  searched(key: string): boolean {
    return this.boxOf(key) !== undefined;
  }
  private inReach(key: string): boolean {
    const here = this.tile;
    if (key === 'w') return true;
    if (key.startsWith('n')) return this.target()?.key === key;
    const at = key.startsWith('c')
      ? carTiles(this, Number(key.slice(1)))
      : key.startsWith('g') || key.startsWith('d') || key.startsWith('k')
        ? [Number(key.slice(1))]
        : key.startsWith('f')
          ? (this.fences.find((f) => f.tiles[0] === Number(key.slice(1)))?.tiles ?? [])
          : this.tilesOf(Number(key));
    return at.some((t) => Math.abs((t % MAP_W) - (here % MAP_W)) + Math.abs(Math.floor(t / MAP_W) - Math.floor(here / MAP_W)) <= 1);
  }
  /** The tiles a piece of furniture stands on. */
  tilesOf(prop: number): number[] {
    const p = this.district.props[prop];
    const out: number[] = [];
    if (p) for (let z = p.z; z < p.z + (p.d ?? 1); z++) for (let x = p.x; x < p.x + (p.w ?? 1); x++) out.push(z * MAP_W + x);
    return out;
  }

  /** What a piece of furniture holds, drawn once from the city's seed, its district and its number. */
  private stock(prop: number): Stack[] {
    const p = this.district.props[prop];
    const lot = this.district.lotAt[p.z * MAP_W + p.x];
    const { list, total } = lootList(lot ? this.district.lots[lot - 1].use : 'house', p.kind);
    const rnd = streamOf(this.state.seed, 5000 + this.state.district * 1000 + prop);
    // (2.58: a building that was locked was never picked over: a draw more, and fewer of them empty.)
    const kept = lot > 0 && this.wasLocked(lot - 1);
    return this.draws(list, total, (SEARCHED[p.kind] ?? 0) + (kept ? TOOLS.moreDraws : 0), rnd, kept ? TOOLS.emptyDraws : EMPTY_DRAWS);
  }
  /** What a car or a wreck holds (2.54), drawn once from the seed, its district and its first tile. */
  private stockCar(first: number): Stack[] {
    const wreck = isWreck(this, first);
    const { list, total } = carLoot(wreck);
    return this.draws(
      list,
      total,
      wreck ? CARS.wreckDraws : CARS.draws,
      streamOf(this.state.seed, 200_000 + this.state.district * N + first),
    );
  }
  private draws(list: Array<[number, number]>, total: number, n: number, rnd: () => number, none: number = EMPTY_DRAWS): Stack[] {
    const out: Stack[] = [];
    for (let draw = 0; draw < n; draw++) {
      if (rnd() * 1000 < none) continue;
      let roll = rnd() * total;
      const item = list.find(([, w]) => (roll -= w) < 0)?.[0] ?? list[0][0];
      const wear = cityItem(item)?.wear;
      const same = wear === undefined ? out.find((st) => st[0] === item && st[1] < (cityItem(item)?.stack ?? 1)) : undefined;
      if (same) same[1]++;
      // (A weapon found has been used: between half and all of its blows left.)
      else out.push([item, wear === undefined ? 1 : Math.ceil(wear / 2) + Math.floor(rnd() * (Math.floor(wear / 2) + 1))]);
    }
    return out;
  }

  private openBox(key: string, first: boolean) {
    const s = this.state;
    const fresh = !key.startsWith('g') && !this.searched(key);
    const car = key.startsWith('c');
    if (fresh) this.boxOf(key, true).push(...(car ? this.stockCar(Number(key.slice(1))) : this.stock(Number(key))));
    s.open = key;
    this.events.push({ type: 'open', key, found: this.box().filter((st) => st[0]).length, first });
    if (car) {
      if (fresh) carOpened(this, Number(key.slice(1)));
    } else if (!key.startsWith('g')) {
      storyFound(this, Number(key));
      foundClothes(this, Number(key));
    }
  }
  private close() {
    if (!this.state.open) return;
    // (A pile picked clean is gone.)
    const k = this.boxKey(this.state.open);
    if (this.state.open.startsWith('g') && !this.state.boxes[k]?.some((st) => st[0])) delete this.state.boxes[k];
    this.state.open = '';
    this.events.push({ type: 'close' });
  }
  /** The open box's slots (empty: none open). */
  box(): Stack[] {
    return this.state.open ? (this.boxOf(this.state.open) ?? []) : [];
  }

  /** Into the pockets (or a box's slots): onto a stack of the same with room, else an empty one. How many didn't fit. */
  private put(into: Stack[], slots: number, item: number, n: number): number {
    // (A weapon: one to a slot, `n` the blows left in it.)
    if (cityItem(item)?.wear !== undefined) {
      let free = into.find((st) => !st[0]);
      if (!free && into.length < slots) into.push((free = empty()));
      if (!free) return n;
      free[0] = item;
      free[1] = n;
      return 0;
    }
    const max = cityItem(item)?.stack ?? 1;
    for (const st of into) {
      if (!n) break;
      if (st[0] !== item || st[1] >= max) continue;
      const add = Math.min(n, max - st[1]);
      st[1] += add;
      n -= add;
    }
    while (n > 0) {
      let free = into.find((st) => !st[0]);
      if (!free && into.length < slots) into.push((free = empty()));
      if (!free) break;
      const add = Math.min(n, max);
      free[0] = item;
      free[1] = add;
      n -= add;
    }
    return n;
  }

  private act(op: number, a: number) {
    const s = this.state;
    if (op === COP.NONE) return;
    if (op === COP.ACT) {
      const t = this.target();
      if (!t) return;
      if (t.kind === 'way') return storyAct(this);
      if (t.kind === 'npc') return meet(this, Number(t.key.slice(1)));
      if (s.open === t.key) return this.close();
      // (2.54: a press that shuts something else, a pile picked clean beside a car, doesn't start on the car as well.)
      if (s.open && t.key.startsWith('c')) return this.close();
      // (Pressed again while searching: the search goes on.)
      if (s.search === t.key) return;
      if (t.kind === 'bed') {
        if (s.hunger === 0) return void this.events.push({ type: 'refused', why: 'tooHungry' });
        if (s.energy >= TIRED && this.minute < SLEEP_FROM && this.minute >= SLEEP_TO)
          return void this.events.push({ type: 'refused', why: 'notTired' });
        s.sleeping = true;
        // (2.52: the torch isn't left burning through the night.)
        s.torchOn = 0;
        s.home = [s.district, this.tile];
        storyDid(this, 'slept');
        this.close();
        return void this.events.push({ type: 'sleep', on: true });
      }
      if (t.kind === 'door') {
        // (Hammering, or prising the boards off: a moment's work, heard as a blow is.)
        s.search = t.key;
        s.searchLeft = BAR_STEPS;
        this.close();
        noise(this, this.tile, BLOW.noise);
        return void this.events.push({ type: 'barring', on: !this.bars.includes(t.tile) });
      }
      if (t.kind === 'pane') {
        // (2.61: no tool: quick, and heard twice as far as a crowbar's work.)
        s.search = t.key;
        s.searchLeft = TOOLS.paneSteps;
        this.close();
        noise(this, this.tile, TOOLS.paneNoise);
        return void this.events.push({ type: 'forcing', what: 'pane' });
      }
      if (t.kind === 'lock' || t.kind === 'fence') {
        // (Prised open, cut through: a longer moment's work, heard as a blow is. Without the tool: said.)
        const lock = t.kind === 'lock';
        if (!this.count(lock ? CROWBAR : CUTTERS)) return void this.events.push({ type: 'refused', why: lock ? 'crowbar' : 'cutters' });
        s.search = t.key;
        s.searchLeft = lock ? TOOLS.forceSteps : TOOLS.cutSteps;
        this.close();
        noise(this, this.tile, BLOW.noise);
        return void this.events.push({ type: 'forcing', what: t.kind });
      }
      if (t.kind === 'pile' || this.searched(t.key)) return this.openBox(t.key, false);
      s.search = t.key;
      s.searchLeft = SEARCH_STEPS;
      // (Drawers pulled out: heard nearby.)
      noise(this, this.tile, BLOW.rustle);
      this.close();
      return void this.events.push({ type: 'search', key: t.key });
    }
    if (op === COP.CLOSE) return this.close();
    if (op === COP.HIT) return strike(this);
    if (op === COP.MAKE) return this.make(a);
    if (op === COP.CHOOSE) return choose(this, a);
    if (op === COP.TRADE) return trade(this, a >> 2, a & 3);
    if (op === COP.GIVE) return giveErrand(this, a);
    if (op === COP.TAKE || op === COP.TAKE_ALL) {
      const box = this.box();
      let full = false;
      for (const st of op === COP.TAKE ? [box[a]] : box) {
        if (!st?.[0]) continue;
        const left = this.put(s.inv, POCKETS, st[0], st[1]);
        if (left < st[1]) this.events.push({ type: 'took', item: st[0], n: st[1] - left });
        if (left) full = true;
        st[1] = left;
        if (!left) st[0] = 0;
      }
      if (full) this.events.push({ type: 'full' });
      return;
    }
    const st = s.inv[a];
    if (!st?.[0]) return;
    const item = st[0];
    if (op === COP.USE) {
      // (2.52: a light is lit, not eaten.)
      if (useLight(this, item)) return;
      // (2.55: a bottle or a molotov is thrown.)
      if (useThrown(this, item, a)) return;
      const use = cityItem(item)?.use;
      if (!use) return void this.events.push({ type: 'refused', why: 'noUse' });
      // (Nothing wasted: a full stomach isn't fed, unless the thing mends or wakes too.)
      // (2.61: a bandage or a medkit stops a wound bleeding, whatever the health.)
      const stanch = s.bleed > 0 && cityItem(item)?.kind === 'med' && (use.health ?? 0) >= 20;
      const needed =
        stanch ||
        ((use.hunger ?? 0) > 0 && s.hunger < FULL - 2000) ||
        ((use.energy ?? 0) > 0 && s.energy < FULL - 5000) ||
        ((use.health ?? 0) > 0 && s.health < 100);
      if (!needed) return void this.events.push({ type: 'refused', why: cityItem(item)?.kind === 'med' ? 'noNeed' : 'notHungry' });
      s.hunger = Math.min(FULL, s.hunger + (use.hunger ?? 0) * 1000);
      s.energy = Math.min(FULL, s.energy + (use.energy ?? 0) * 1000);
      if (--st[1] <= 0) st[0] = st[1] = 0;
      this.events.push({ type: 'used', item });
      if ((use.hunger ?? 0) > 0) storyDid(this, 'ate');
      // (2.58: what's eaten never kills: raw fish takes health down to one point at the worst.)
      s.health = Math.max(1, Math.min(100, s.health + (use.health ?? 0)));
      if (stanch) {
        s.bleed = 0;
        this.events.push({ type: 'bleeding', on: false, why: 'bandaged' });
      }
      return;
    }
    if (op === COP.STORE && s.open) {
      const left = this.put(this.boxOf(s.open, true), BOX_SLOTS, item, st[1]);
      if (left === st[1]) return void this.events.push({ type: 'full' });
      st[1] = left;
      if (!left) st[0] = 0;
      return void this.events.push({ type: 'stored', item });
    }
    if (op === COP.DROP) {
      const left = this.put(this.boxOf(`g${this.tile}`, true), BOX_SLOTS, item, st[1]);
      if (left === st[1]) return void this.events.push({ type: 'full' });
      st[1] = left;
      if (!left) st[0] = 0;
      this.events.push({ type: 'dropped', item });
    }
  }

  /** How many of an item the pockets hold (a weapon: how many of them, whatever blows each has left). */
  count(item: number): number {
    const each = cityItem(item)?.wear !== undefined;
    return this.state.inv.reduce((n, st) => n + (st[0] === item ? (each ? 1 : st[1]) : 0), 0);
  }
  /** That many of an item out of the pockets. */
  spend(item: number, n: number) {
    const each = cityItem(item)?.wear !== undefined;
    // (Of several weapons alike, the most worn goes first.)
    const stacks = each ? [...this.state.inv].sort((a, b) => a[1] - b[1]) : this.state.inv;
    for (const st of stacks) {
      if (!n) break;
      if (st[0] !== item) continue;
      const take = each ? 1 : Math.min(n, st[1]);
      n -= take;
      st[1] = each ? 0 : st[1] - take;
      if (st[1] <= 0) st[0] = st[1] = 0;
    }
  }

  /** Whether a recipe can be made now, or what's missing. */
  canMake(k: number): 'ok' | 'parts' | 'bench' | 'stove' | 'unknown' {
    const r = CITY_RECIPES[k];
    if (!r) return 'parts';
    if (r.taught !== undefined && this.state.errand[r.taught] < 1) return 'unknown';
    if (recipeParts(r).from.some(([item, n]) => this.count(item) < n)) return 'parts';
    // (2.52: a fire barrel burning beside them cooks as the stove does.)
    if (r.stove && !this.count(STOVE) && !atFire(this)) return 'stove';
    if (r.bench && !this.atBench()) return 'bench';
    return 'ok';
  }
  /** A workbench on a tile beside the player. */
  atBench(): boolean {
    const here = this.tile;
    return [here - MAP_W, here + 1, here + MAP_W, here - 1].some((t) => {
      const k = t >= 0 && t < N ? this.propAt[t] : 0;
      return k > 0 && this.district.props[k - 1].kind === 'workbench';
    });
  }
  private make(k: number) {
    const why = this.canMake(k);
    if (why !== 'ok') return void this.events.push({ type: 'cantMake', why });
    const r = CITY_RECIPES[k];
    const { makes, from } = recipeParts(r);
    for (const [item, n] of from) this.spend(item, n);
    // (What doesn't fit the pockets goes on the ground underfoot.)
    const left = this.give(this.state.inv, POCKETS, makes, r.n);
    if (left) this.give(this.boxOf(`g${this.tile}`, true), PILE_SLOTS, makes, left);
    this.events.push({ type: 'made', item: makes });
  }

  /** A door barred (a set of boards from the pockets) or its boards taken down (back into the pockets, or onto the ground). */
  private bar(tile: number) {
    const s = this.state;
    const list = (s.bars[s.district] ??= []);
    const at = list.indexOf(tile);
    if (at >= 0) {
      list.splice(at, 1);
      if (this.put(s.inv, POCKETS, BOARDS, 1)) this.put(this.boxOf(`g${this.tile}`, true), PILE_SLOTS, BOARDS, 1);
    } else {
      if (!this.count(BOARDS)) return;
      // (One of the dead in the doorway: nothing to nail across.)
      if (s.zeds.some((z) => tileAt(z.body.x, z.body.z) === tile)) return void this.events.push({ type: 'refused', why: 'doorway' });
      this.spend(BOARDS, 1);
      list.push(tile);
    }
    this.refreshBars();
    const shelter = this.shelter(this.doorLot[tile] - 1);
    this.events.push({ type: 'barred', on: at < 0, tile, shelter });
    if (at < 0 && shelter) storyDid(this, 'shelter');
  }
  /** A barred door torn open (the beacon lit): its boards are gone. */
  breach(tile: number) {
    const list = this.state.bars[this.state.district] ?? [];
    const at = list.indexOf(tile);
    if (at < 0) return;
    list.splice(at, 1);
    this.refreshBars();
    this.events.push({ type: 'breach', tile });
  }

  /**
   * 2.61: a chained building's window broken: climbed through, the chain lifted off from inside (the building forced, as by the
   * crowbar); bare hands are cut on the glass. Kept, for the picture.
   */
  private smash(tile: number) {
    const s = this.state;
    const lot = this.district.lotAt[tile] - 1;
    const door = lot >= 0 ? this.district.lots[lot].doors.find((i) => this.locked[i]) : undefined;
    if (door === undefined || !this.panes[tile]) return;
    (s.panes[s.district] ??= []).push(tile);
    const cut = !this.weapon();
    this.events.push({ type: 'smashed', tile, cut });
    this.force(door);
    if (cut) this.bleedFor(TOOLS.paneCut * BLEED.per);
  }

  /** 2.61: what a wound will bleed (BLEED): added to what's still to bleed. */
  bleedFor(harm: number) {
    const s = this.state;
    const was = s.bleed;
    s.bleed = Math.min(BLEED.most, s.bleed + Math.ceil(harm / BLEED.per));
    if (!was && s.bleed) this.events.push({ type: 'bleeding', on: true });
  }

  /** 2.58: a locked building forced open (the crowbar): every door of it, for good; the dead can go in as anywhere. */
  private force(tile: number) {
    const s = this.state;
    const lot = this.doorLot[tile] - 1;
    if (lot < 0 || !this.locked[tile]) return;
    (s.forced[s.district] ??= []).push(lot);
    for (const i of this.district.lots[lot].doors) this.locked[i] = this.world.parked[i] = 0;
    // (The dead's places as a district entered works them out: before the survivors stand in the way. A save loads to the same.)
    for (const p of this.people) this.world.parked[p.tile] = 0;
    this.world.refreshBlock();
    this.setPlaces();
    for (const p of this.people) this.world.parked[p.tile] = 1;
    if (this.people.length) this.world.refreshBlock();
    this.refreshBars();
    this.panes = lockedPanes(this, s.district, this.locked);
    this.locksRev++;
    this.events.push({ type: 'forced', tile });
  }
  /** 2.58: the fence cut through (the bolt cutters): the street runs on into the next district, from both sides, for good. */
  private cut(tile: number) {
    const s = this.state;
    const spot = this.fences.find((f) => f.tiles[0] === tile);
    if (!spot) return;
    s.cuts.push(cutCode(s.district, spot.side, spot.lane));
    this.districts.delete(s.district);
    this.districts.delete(spot.to);
    // (The district put up again as it now stands, everyone where they were.)
    this.enter(s.district, true);
    this.events.push({ type: 'cut', tile });
  }

  /** Things handed to the player: into the pockets, what doesn't fit on the ground underfoot. */
  hand(item: number, n: number) {
    const each = cityItem(item)?.wear !== undefined;
    let dropped = false;
    for (let k = 0; k < (each ? n : 1); k++) {
      const left = this.give(this.state.inv, POCKETS, item, each ? 1 : n);
      if (left) {
        this.give(this.boxOf(`g${this.tile}`, true), PILE_SLOTS, item, left);
        dropped = true;
      }
    }
    this.events.push({ type: 'took', item, n });
    if (dropped) this.events.push({ type: 'full' });
  }

  /** New things into slots: a weapon each in a slot of its own with all its blows, the rest as `put`. */
  private give(into: Stack[], slots: number, item: number, n: number): number {
    const wear = cityItem(item)?.wear;
    return wear === undefined ? this.put(into, slots, item, n) : this.put(into, slots, item, wear);
  }

  /** The player's weapon took a blow: the best in the pockets (the one that strikes) loses one, and breaks at none. */
  /** The weapon that strikes: the strongest in the pockets (of two as strong, the one with the longer reach, then the first); null: fists. */
  weapon(): Stack | null {
    let best: Stack | null = null;
    for (const st of this.state.inv) {
      const d = cityItem(st[0]);
      if (!d?.attack) continue;
      const b = best ? cityItem(best[0])! : null;
      if (!b || d.attack > b.attack! || (d.attack === b.attack && (d.reach ?? 0) > (b.reach ?? 0))) best = st;
    }
    return best;
  }
  /** 2.55: something left on a tile's pile; a thing that wears (the crossbow) used once. */
  leave(tile: number, item: number, n: number) {
    this.put(this.boxOf(`g${tile}`, true), PILE_SLOTS, item, n);
  }
  wearItem(item: number) {
    const st = this.state.inv.find((x) => x[0] === item);
    if (!st || cityItem(item)?.wear === undefined) return;
    if (--st[1] > 0) return;
    this.events.push({ type: 'broke', item });
    st[0] = st[1] = 0;
  }
  wearWeapon() {
    const best = this.weapon();
    if (!best || cityItem(best[0])?.wear === undefined) return;
    if (--best[1] > 0) return;
    this.events.push({ type: 'broke', item: best[0] });
    best[0] = best[1] = 0;
  }

  /** Through a gate: the same street on the neighbour's side, a tile in from its border. */
  private cross(gate: Gate) {
    const s = this.state;
    s.search = '';
    this.close();
    const from = s.district;
    const first = ((s.visited >> gate.to) & 1) === 0;
    this.enter(gate.to);
    const p = s.player;
    if (gate.side === SIDE.N) p.z = (MAP_H - 2) * UNIT + UNIT / 2;
    else if (gate.side === SIDE.S) p.z = UNIT + UNIT / 2;
    else if (gate.side === SIDE.W) p.x = (MAP_W - 2) * UNIT + UNIT / 2;
    else p.x = UNIT + UNIT / 2;
    this.events.push({ type: 'travel', from, to: gate.to, side: OPPOSITE[gate.side], first });
  }

  /** The tiles round the player seen (a disc: the map fills in as they walk). */
  private look() {
    const here = this.tile;
    this.lastTile = here;
    const seen = this.seen[this.state.district];
    const cx = here % MAP_W;
    const cz = Math.floor(here / MAP_W);
    let changed = false;
    for (let z = Math.max(0, cz - SEE_TILES); z <= Math.min(MAP_H - 1, cz + SEE_TILES); z++)
      for (let x = Math.max(0, cx - SEE_TILES); x <= Math.min(MAP_W - 1, cx + SEE_TILES); x++) {
        if ((x - cx) ** 2 + (z - cz) ** 2 > SEE_TILES * SEE_TILES + 1) continue;
        const i = z * MAP_W + x;
        if (!seen[i]) {
          seen[i] = 1;
          changed = true;
        }
      }
    if (changed) this.seenRev++;
  }

  /** How much of a district has been seen (0–1). */
  seenShare(d: number): number {
    let n = 0;
    for (const v of this.seen[d]) n += v;
    return n / N;
  }

  snapshot(): CitySnapshot {
    return {
      state: JSON.parse(JSON.stringify({ ...this.state, player: { ...this.state.player, moving: false } })) as CityState,
      seen: this.seen.map(packBits),
    };
  }
}

/** Whether a step from (ax, az) to (bx, bz) walks into one of the dead: within a body's width of one, and nearer it than before. */
const BODY = 620;
export function crowded(zeds: readonly Zed[], ax: number, az: number, bx: number, bz: number, but = -1, mode = -1): boolean {
  for (let k = 0; k < zeds.length; k++) {
    // (`mode`: only those doing that count: the dead wandering pass each other, or two would stand face to face in an alley for good.)
    if (k === but || (mode >= 0 && zeds[k].mode !== mode)) continue;
    const z = zeds[k].body;
    const after = (z.x - bx) ** 2 + (z.z - bz) ** 2;
    if (after < BODY * BODY && after < (z.x - ax) ** 2 + (z.z - az) ** 2) return true;
  }
  return false;
}

/** The survival fields of a new city (and of a save from before them). */
function freshSurvival() {
  return {
    health: 100,
    hunger: 80_000,
    energy: 90_000,
    inv: Array.from({ length: POCKETS }, empty),
    boxes: {} as Record<string, Stack[]>,
    open: '',
    search: '',
    searchLeft: 0,
    sleeping: false,
    home: [0, 0] as [number, number],
    deaths: 0,
    over: 0,
    zeds: [] as Zed[],
    rng: 1,
    kills: 0,
    swung: -9999,
    arrive: 0,
    bars: {} as Record<string, number[]>,
  };
}

/** A facing (1–16) as radians (0: +z). */
const headingOf = (facing: number) => Math.atan2(DIR_X[facing] ?? 0, DIR_Z[facing] ?? 1);

/** Whether a list of stacks is one: pairs of whole numbers, items the city has. */
const stacksOk = (list: unknown, most: number): list is Stack[] =>
  Array.isArray(list) &&
  list.length <= most &&
  list.every(
    (st) =>
      Array.isArray(st) &&
      st.length === 2 &&
      Number.isInteger(st[0]) &&
      Number.isInteger(st[1]) &&
      st[0] >= 0 &&
      st[1] >= 0 &&
      st[1] <= 99 &&
      (st[0] === 0 || !!cityItem(st[0] as number)),
  );

/** Whether a save's dead are sound: bodies on the map, whole numbers, ways of tiles. */
const zedsOk = (list: unknown): list is Zed[] =>
  Array.isArray(list) &&
  list.length <= 200 &&
  list.every(
    (z: Zed) =>
      !!z &&
      !!z.body &&
      [z.body.x, z.body.z, z.body.facing, z.hp, z.mode, z.goal, z.seen, z.last, z.bit, z.reel, z.near, z.pace].every(Number.isInteger) &&
      z.body.x >= 0 &&
      z.body.z >= 0 &&
      z.body.x < MAP_W * UNIT &&
      z.body.z < MAP_H * UNIT &&
      z.mode >= 0 &&
      z.mode <= 3 &&
      (z.kind === undefined || (Number.isInteger(z.kind) && z.kind >= 1 && z.kind <= 5)) &&
      (z.pound === undefined || (Number.isInteger(z.pound) && z.pound >= 0)) &&
      (z.down === undefined || (Number.isInteger(z.down) && z.down > 0 && z.down <= DOWN.steps)) &&
      Array.isArray(z.path) &&
      z.path.every((i) => Number.isInteger(i) && i >= 0 && i < N),
  );

/** A city from a snapshot, or null if it isn't one (a damaged save). */
export function loadCity(snap: unknown): City | null {
  const s = snap as CitySnapshot | null;
  const st = s?.state;
  if (!st || st.v !== 1 || !Array.isArray(s.seen)) return null;
  const whole = [st.seed, st.mode, st.step, st.district, st.visited, st.player?.x, st.player?.z, st.player?.facing].every(Number.isInteger);
  if (!whole || st.district < 0 || st.district >= PLACES || st.step < 0) return null;
  if (st.player.x < 0 || st.player.z < 0 || st.player.x >= MAP_W * UNIT || st.player.z >= MAP_H * UNIT) return null;
  if (!s.seen.every((t) => typeof t === 'string')) return null;
  // (C2's fields: there or not, a save from before them; there, they must be sound.)
  const old = st.health === undefined;
  if (!old) {
    if (![st.health, st.hunger, st.energy, st.deaths, st.over, st.searchLeft].every(Number.isInteger)) return null;
    // (A city that's over is never saved: lost or left, there's nothing to carry on.)
    if (st.over !== 0) return null;
    if (st.mode !== MODE.SURVIVOR && st.mode !== MODE.HARDCORE) return null;
    if (st.health < 0 || st.health > 100 || st.hunger < 0 || st.hunger > FULL || st.energy < 0 || st.energy > FULL) return null;
    if (!stacksOk(st.inv, POCKETS) || st.inv.length !== POCKETS) return null;
    if (typeof st.boxes !== 'object' || !st.boxes || !Object.values(st.boxes).every((b) => stacksOk(b, 64))) return null;
    if (typeof st.open !== 'string' || typeof st.search !== 'string' || typeof st.sleeping !== 'boolean') return null;
    if (
      !Array.isArray(st.home) ||
      !st.home.every(Number.isInteger) ||
      st.home[0] < 0 ||
      st.home[0] >= CITY_N ||
      st.home[1] < 0 ||
      st.home[1] >= N
    )
      return null;
  }
  // (C2c's barred doors: a record of lists by district, or none; a save from before them: its weapons counted one each, given their blows.)
  const before = st.bars === undefined;
  if (typeof st.bars !== 'object' || !st.bars || Array.isArray(st.bars)) st.bars = {};
  soundLight(st);
  soundCars(st);
  soundRanged(st);
  soundTools(st);
  try {
    const city = new City(st.seed, st.mode, { state: { ...st, player: { ...st.player, moving: false } }, seen: s.seen });
    // (A save from before homes: beside where the city starts.)
    if (old) {
      const sp = city.districtOf(city.plan.start).spawn;
      city.state.home = [city.plan.start, sp.z * MAP_W + sp.x];
    }
    // (2.58: only fences that can be cut stay cut; the district put up again if any went.)
    const cuts = city.state.cuts.length;
    soundCuts(city);
    if (city.state.cuts.length !== cuts) city.reenter();
    // (2.59: the clothes' furniture searched before they lay there, an older save: found.)
    if (city.clothes >= 0 && city.state.boxes[`${city.plan.start}:${city.clothes}`] !== undefined) city.state.outfit = 1;
    // (The dead as the save had them, if it's sound; else the district's put down afresh.)
    city.soundBars(before);
    city.rebar();
    soundStory(city);
    // (2.56: in the tunnel without the metro's way going: a damaged save. Back up at the stairs, the district's dead put down afresh.)
    if (city.state.district === TUNNEL && !(city.state.ready === 1 && city.state.way === 3)) city.surface();
    if (!zedsOk(st.zeds) || ![st.rng, st.kills, st.swung, st.arrive].every(Number.isInteger) || st.kills < 0) {
      city.state.zeds = [];
      city.state.rng = city.salt(77) | 0;
      city.state.kills = 0;
      city.state.swung = -9999;
      city.state.arrive = 0;
      populate(city);
    }
    // (An errand counted from more of the dead than were ever put down: from now.)
    city.state.mark = city.state.mark.map((m) => Math.min(m, city.state.kills));
    // (A home nobody can stand on, the map changed under an old save: beside where the city starts.)
    if (city.districtGrid(city.state.home[0])[city.state.home[1]]) {
      const sp = city.districtOf(city.plan.start).spawn;
      city.state.home = [city.plan.start, sp.z * MAP_W + sp.x];
    }
    // (A box open or a search under way isn't carried over a load.)
    city.state.open = city.state.search = '';
    // (Somewhere nobody can stand, the map changed under an old save: back to the district's own place.)
    if (city.grid[city.tile]) {
      const at = city.district.spawn;
      city.state.player = bodyAt(at.x, at.z);
    }
    return city;
  } catch {
    return null;
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** A tile-per-byte mask as text: six tiles a character. */
export function packBits(mask: Uint8Array): string {
  let out = '';
  for (let i = 0; i < mask.length; i += 6) {
    let v = 0;
    for (let k = 0; k < 6; k++) if (mask[i + k]) v |= 1 << k;
    out += B64[v];
  }
  return out;
}

export function unpackBits(text: string, into: Uint8Array) {
  for (let c = 0; c < text.length; c++) {
    const v = B64.indexOf(text[c]);
    if (v < 0) continue;
    for (let k = 0; k < 6; k++) if (c * 6 + k < into.length) into[c * 6 + k] = (v >> k) & 1;
  }
}
