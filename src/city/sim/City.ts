import { dirOf } from '../../sim/command';
import { mix32 } from '../../sim/rng';
import { bodyAt, walk, type Body } from '../../sim/systems/movement';
import { STEPS_PER_MINUTE, UNIT, WALK_SPEED } from '../../sim/tuning';
import { tileAt } from '../../sim/world/grid';
import { MAP_H, MAP_W, type World } from '../../sim/world/World';
import { generateDistrict, type District, type Gate } from '../gen/district';
import { CITY_N, cityPlan, OPPOSITE, SIDE, type CityPlan } from '../gen/plan';
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
}

/** A city saved: its state, and each district's seen tiles (a bit a tile, base64). */
export interface CitySnapshot {
  state: CityState;
  seen: string[];
}

export type CityEvent =
  /** Through a gate: the district changed (the view takes the new world). */
  { type: 'travel'; from: number; to: number; side: number; first: boolean };

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
      this.state = { ...from.state, player: { ...from.state.player } };
      from.seen.forEach((text, d) => d < CITY_N && unpackBits(text, this.seen[d]));
      this.enter(this.state.district);
    } else {
      const d = this.plan.start;
      this.state = { v: 1, seed: this.plan.seed, mode, step: 0, district: d, player: bodyAt(0, 0), visited: 0 };
      this.enter(d);
      const s = this.district.spawn;
      this.state.player = bodyAt(s.x, s.z);
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
    s.step++;
    walk(this.world, s.player, dirOf(cmd), WALK_SPEED);
    const here = this.tile;
    if (here === this.lastTile) return;
    const gate = this.district.gates.find((g) => g.tiles.includes(here));
    if (gate) this.cross(gate);
    this.look();
  }

  /** Through a gate: the same street on the neighbour's side, a tile in from its border. */
  private cross(gate: Gate) {
    const s = this.state;
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
    return { state: { ...this.state, player: { ...this.state.player, moving: false } }, seen: this.seen.map(packBits) };
  }
}

/** A city from a snapshot, or null if it isn't one (a damaged save). */
export function loadCity(snap: unknown): City | null {
  const s = snap as CitySnapshot | null;
  const st = s?.state;
  if (!st || st.v !== 1 || !Array.isArray(s.seen)) return null;
  const whole = [st.seed, st.mode, st.step, st.district, st.visited, st.player?.x, st.player?.z, st.player?.facing].every(Number.isInteger);
  if (!whole || st.district < 0 || st.district >= CITY_N || st.step < 0) return null;
  if (st.player.x < 0 || st.player.z < 0 || st.player.x >= MAP_W * UNIT || st.player.z >= MAP_H * UNIT) return null;
  if (!s.seen.every((t) => typeof t === 'string')) return null;
  try {
    const city = new City(st.seed, st.mode, { state: { ...st, player: { ...st.player, moving: false } }, seen: s.seen });
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
