import type { PropKind } from '../../content/props';
import { argA, DIR_X, DIR_Z, dirOf, opOf } from '../../sim/command';
import { mix32 } from '../../sim/rng';
import { bodyAt, walk, type Body } from '../../sim/systems/movement';
import { STEPS_PER_MINUTE, UNIT, WALK_SPEED } from '../../sim/tuning';
import { tileAt } from '../../sim/world/grid';
import { MAP_H, MAP_W, type World } from '../../sim/world/World';
import { generateDistrict, type District, type Gate } from '../gen/district';
import { CITY_N, cityPlan, OPPOSITE, SIDE, type CityPlan } from '../gen/plan';
import { cityItem } from '../content/items';
import { BOX_SLOTS, EMPTY_DRAWS, lootList, SEARCH_STEPS, SEARCHED } from '../content/loot';
import { streamOf } from '../gen/plan';
import { districtWorld } from './world';

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
export const COP = { NONE: 0, ACT: 1, TAKE: 2, STORE: 3, USE: 4, DROP: 5, CLOSE: 6, TAKE_ALL: 7 } as const;

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
const WAKE = { health: 40, hunger: 35_000, energy: 60_000 };

/** A pocket or a slot: [item number, how many] ([0, 0]: empty). */
export type Stack = [number, number];
const empty = (): Stack => [0, 0];

/** What the action button would do now: search a piece of furniture, look at what lies on the ground, sleep in a bed. */
export interface Target {
  kind: 'box' | 'pile' | 'bed';
  /** The box's key in the state (a piece of furniture: its number; a pile: 'g' + its tile). */
  key: string;
  tile: number;
  prop: PropKind | null;
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
  | { type: 'sleep'; on: boolean; why?: 'morning' | 'rested' | 'hungry' | 'stirred' }
  | { type: 'refused'; why: 'notTired' | 'tooHungry' | 'notHungry' | 'noUse' }
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
  readonly seen: Uint8Array[] = Array.from({ length: CITY_N }, () => new Uint8Array(N));
  /** Bumps when `seen` changes (the map redraws). */
  seenRev = 0;
  private readonly districts = new Map<number, District>();
  private lastTile = -1;

  constructor(seed: number, mode: number = MODE.SURVIVOR, from?: CitySnapshot) {
    this.plan = cityPlan(from?.state.seed ?? seed);
    if (from) {
      // (A save from before a field has it fresh, after the ones it has: a save's own order is kept.)
      this.state = { ...from.state, player: { ...from.state.player } };
      for (const [k, v] of Object.entries(freshSurvival()))
        if ((this.state as unknown as Record<string, unknown>)[k] === undefined) Object.assign(this.state, { [k]: v });
      from.seen.forEach((text, d) => d < CITY_N && unpackBits(text, this.seen[d]));
      this.enter(this.state.district);
    } else {
      const d = this.plan.start;
      this.state = { v: 1, seed: this.plan.seed, mode, step: 0, district: d, player: bodyAt(0, 0), visited: 0, ...freshSurvival() };
      this.enter(d);
      const s = this.district.spawn;
      this.state.player = bodyAt(s.x, s.z);
      this.state.home = [d, s.z * MAP_W + s.x];
    }
    this.look();
  }

  /** A district's plan (made once, kept). */
  districtOf(d: number): District {
    let made = this.districts.get(d);
    if (!made) this.districts.set(d, (made = generateDistrict(this.plan, d)));
    return made;
  }

  private enter(d: number) {
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
  }
  /** Per tile: the searchable piece of furniture standing there, + 1. */
  private propAt = new Int16Array(N);

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
    if (s.sleeping) {
      // (A push on the stick wakes them.)
      if (dir) this.wake('stirred');
      return;
    }
    const weak = s.hunger < FULL / 4 || s.energy <= 0;
    walk(this.world, s.player, dir, weak ? Math.trunc((WALK_SPEED * WEAK_SPEED) / 1000) : WALK_SPEED);
    // A first search takes a moment, standing still; walking off leaves it.
    if (s.search) {
      if (dir || this.target()?.key !== s.search) s.search = '';
      else if (--s.searchLeft <= 0) {
        const key = s.search;
        s.search = '';
        this.openBox(key, true);
      }
    }
    this.act(opOf(cmd), argA(cmd));
    const here = this.tile;
    if (here === this.lastTile) return;
    // (Walked away from the open box: shut.)
    if (s.open && !this.inReach(s.open)) this.close();
    const gate = this.district.gates.find((g) => g.tiles.includes(here));
    if (gate) this.cross(gate);
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
    if (s.over || !s.sleeping) return;
    if (s.hunger === 0) this.wake('hungry');
    else if (this.minute === SLEEP_TO) this.wake('morning');
    else if (s.energy >= FULL && this.minute > SLEEP_TO && this.minute < SLEEP_FROM) this.wake('rested');
  }
  private starved = false;

  private wake(why: 'morning' | 'rested' | 'hungry' | 'stirred') {
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
    this.close();
    s.deaths++;
    if (s.mode === MODE.HARDCORE) {
      s.over = 1;
      this.events.push({ type: 'dead', final: true, moved: false });
      return;
    }
    // A Survivor: what they carried lies where they fell; they wake at home the next morning.
    const pile = this.boxOf(`g${this.tile}`, true);
    for (const st of s.inv) {
      if (!st[0]) continue;
      pile.push([st[0], st[1]]);
      st[0] = st[1] = 0;
    }
    const [d, tile] = s.home;
    const moved = d !== s.district;
    if (moved) this.enter(d);
    s.player = bodyAt(tile % MAP_W, Math.floor(tile / MAP_W));
    // (To the next 06:30.)
    const now = (START_MINUTE + Math.floor(s.step / STEPS_PER_MINUTE)) % DAY_MINUTES;
    s.step += ((START_MINUTE - now + DAY_MINUTES) % DAY_MINUTES || DAY_MINUTES) * STEPS_PER_MINUTE;
    s.health = WAKE.health;
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
    for (const [dx, dz] of around) {
      if (!dx && !dz) continue;
      const tx = x + dx;
      const tz = z + dz;
      if (tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) continue;
      const t = tz * MAP_W + tx;
      const k = this.propAt[t];
      if (k) {
        const kind = this.district.props[k - 1].kind;
        return { kind: kind === 'bed' && this.searched(`${k - 1}`) ? 'bed' : 'box', key: `${k - 1}`, tile: t, prop: kind };
      }
      if (this.boxOf(`g${t}`)?.some((st) => st[0]) && !this.grid[t]) return { kind: 'pile', key: `g${t}`, tile: t, prop: null };
    }
    return null;
  }

  /** Whether a box has been looked into. */
  searched(key: string): boolean {
    return this.boxOf(key) !== undefined;
  }
  private inReach(key: string): boolean {
    const here = this.tile;
    const at = key.startsWith('g') ? [Number(key.slice(1))] : this.tilesOf(Number(key));
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
    const out: Stack[] = [];
    for (let draw = 0; draw < (SEARCHED[p.kind] ?? 0); draw++) {
      if (rnd() * 1000 < EMPTY_DRAWS) continue;
      let roll = rnd() * total;
      const item = list.find(([, w]) => (roll -= w) < 0)?.[0] ?? list[0][0];
      const same = out.find((st) => st[0] === item && st[1] < (cityItem(item)?.stack ?? 1));
      if (same) same[1]++;
      else out.push([item, 1]);
    }
    return out;
  }

  private openBox(key: string, first: boolean) {
    const s = this.state;
    if (!key.startsWith('g') && !this.searched(key)) this.boxOf(key, true).push(...this.stock(Number(key)));
    s.open = key;
    this.events.push({ type: 'open', key, found: this.box().filter((st) => st[0]).length, first });
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
      if (s.open === t.key) return this.close();
      if (t.kind === 'bed') {
        if (s.hunger === 0) return void this.events.push({ type: 'refused', why: 'tooHungry' });
        if (s.energy >= TIRED && this.minute < SLEEP_FROM && this.minute >= SLEEP_TO)
          return void this.events.push({ type: 'refused', why: 'notTired' });
        s.sleeping = true;
        s.home = [s.district, this.tile];
        this.close();
        return void this.events.push({ type: 'sleep', on: true });
      }
      if (t.kind === 'pile' || this.searched(t.key)) return this.openBox(t.key, false);
      s.search = t.key;
      s.searchLeft = SEARCH_STEPS;
      this.close();
      return void this.events.push({ type: 'search', key: t.key });
    }
    if (op === COP.CLOSE) return this.close();
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
      const use = cityItem(item)?.use;
      if (!use) return void this.events.push({ type: 'refused', why: 'noUse' });
      // (Nothing wasted: a full stomach isn't fed, unless the thing mends or wakes too.)
      if (s.hunger >= FULL - 2000 && !(use.health && use.health > 0 && s.health < 100) && !(use.energy && s.energy < FULL - 5000))
        return void this.events.push({ type: 'refused', why: 'notHungry' });
      s.hunger = Math.min(FULL, s.hunger + (use.hunger ?? 0) * 1000);
      s.energy = Math.min(FULL, s.energy + (use.energy ?? 0) * 1000);
      if (--st[1] <= 0) st[0] = st[1] = 0;
      this.events.push({ type: 'used', item });
      if (use.health && use.health < 0) this.hurt(-use.health);
      else s.health = Math.min(100, s.health + (use.health ?? 0));
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

  /** How many of an item the pockets hold. */
  count(item: number): number {
    return this.state.inv.reduce((n, st) => n + (st[0] === item ? st[1] : 0), 0);
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

/** A city from a snapshot, or null if it isn't one (a damaged save). */
export function loadCity(snap: unknown): City | null {
  const s = snap as CitySnapshot | null;
  const st = s?.state;
  if (!st || st.v !== 1 || !Array.isArray(s.seen)) return null;
  const whole = [st.seed, st.mode, st.step, st.district, st.visited, st.player?.x, st.player?.z, st.player?.facing].every(Number.isInteger);
  if (!whole || st.district < 0 || st.district >= CITY_N || st.step < 0) return null;
  if (st.player.x < 0 || st.player.z < 0 || st.player.x >= MAP_W * UNIT || st.player.z >= MAP_H * UNIT) return null;
  if (!s.seen.every((t) => typeof t === 'string')) return null;
  // (C2's fields: there or not, a save from before them; there, they must be sound.)
  const old = st.health === undefined;
  if (!old) {
    if (![st.health, st.hunger, st.energy, st.deaths, st.over, st.searchLeft].every(Number.isInteger)) return null;
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
  try {
    const city = new City(st.seed, st.mode, { state: { ...st, player: { ...st.player, moving: false } }, seen: s.seen });
    // (A save from before homes: beside where the city starts.)
    if (old) {
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
