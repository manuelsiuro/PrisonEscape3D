import { HUNT } from '../../content/manhunt';
import { itemDef, itemNumber } from '../../content/items';
import type { OutsideDef, Spot } from '../../content/outside/types';
import type { PrisonDef } from '../../content/prisons/types';
import { centerX, centerZ, findPath, nearestDir, tileAt } from '../ai/path';
import { canSee, lineOfSight } from '../ai/sight';
import { argA, argB, argC, DIR_X, DIR_Z, dirOf, EXT, OP, opOf, tossTile } from '../command';
import { fnv1a, rollInt, SALT } from '../rng';
import { bodyAt, walk, type Body } from '../systems/movement';
import { UNIT, walkSpeed } from '../tuning';
import { TILE } from '../world/tiles';
import { LAYER, MAP_H, MAP_W, type World } from '../world/World';
import { HFEAT, HOUND, HUNT_FEATS, OVER, SEEK, type Carry, type HuntDog, type HuntState, type Searcher } from './state';
import { DECO, fillArea, outsideWorld, spotTile, type OutsideWorld } from './world';

export * from './state';

/** Why an action did nothing (a toast says it). */
export type HuntRefusal = 'nothing' | 'noCutters' | 'stoneSoon' | 'stoneFar' | 'noTreat' | 'dogFar';

/** What happened during a hunt's step (the play layer's sounds, toasts and bubbles read them; the hunt never calls them). */
export type HuntEvent =
  | { type: 'alarm' }
  | { type: 'out'; who: number }
  | { type: 'roadblock'; k: number }
  | { type: 'heli' }
  | { type: 'spotted'; who: number }
  | { type: 'lost'; who: number }
  | { type: 'heard'; who: number; tile: number }
  | { type: 'noise'; tile: number; reach: number; kind: 'crunch' | 'stone' | 'cut' | 'bark' }
  | { type: 'track'; dog: number }
  | { type: 'point'; dog: number }
  | { type: 'lit'; on: boolean }
  | { type: 'hidden'; on: boolean }
  | { type: 'swap' }
  | { type: 'cut'; tile: number; done: boolean }
  | { type: 'treat'; dog: number; what: number }
  | { type: 'stone'; tile: number }
  | { type: 'whistle'; who: number }
  | { type: 'refused'; why: HuntRefusal }
  | { type: 'safe'; lou: boolean }
  | { type: 'caught'; by: number }
  | { type: 'widen'; heat: number };

/** Options for a lesson's hunt (P41's lesson): only some searchers, no helicopter, no roadblocks, the search never widening. A lesson's hunt keeps the map's own times and beats (no shuffle by the salt). */
export interface HuntOptions {
  searchers?: readonly number[];
  heli?: boolean;
  roadblocks?: boolean;
  ramp?: boolean;
}

const S = 20;
const N = MAP_W * MAP_H;
const GUARD_OUTFIT = itemNumber('guard_outfit');
const OWN_CLOTHES = itemNumber('own_clothes');
const TREATS = [itemNumber('jerky'), itemNumber('pepper'), itemNumber('sleepy_jerky')];
/** Standing still at a beat's stop (steps); turning to look round while looking (every this many steps). */
const STOP_STEPS = 2 * S;
/** Longer than any hunt (steps): an officer at his post stays there. */
const FOREVER = 1e9;
const TURN_STEPS = 20;
/** Close enough to a waypoint to aim at the next one (units), and steps without getting closer before the way is looked for again. */
const REACHED = 200;
const STUCK_STEPS = 24;
/** A dog this far from its handler (tiles) runs to catch up; its pace then. */
const DOG_CATCH_UP = 3;
const DOG_RUN = 200;
/** A dog that lost a trail picks one up again only after this long (steps); a pointing dog holds this long, barking every BARK_EVERY. */
const TRAIL_REST = 10 * S;
const POINT_HOLD = 3 * S;
const BARK_EVERY = 30;
/** Crunching gravel is heard at most this often (steps). */
const CRUNCH_EVERY = 10;
/** A washing line: this close (tiles) to take clothes off it. */
const LINE_REACH = 1.5;
/** The helicopter calls the player in every this many steps while it holds them lit. */
const HELI_CALL = S;
/** The search widened: the helicopter picks its next place among this many of the nearest not yet swept. */
const HELI_PICK = 6;
/** What the salt's draws are for (roll()'s first argument, negative: never a step). */
const DRAW = { ORDER: -1, TIME: -2, STOP: -3, BLOCK: -4, HELI: -5, AIM: -6 } as const;

const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const within = (a: { x: number; z: number }, b: { x: number; z: number }, tiles: number) => dist2(a, b) <= (tiles * UNIT) ** 2;
/** Chebyshev distance between two tiles. */
const cheb = (a: number, b: number) => Math.max(Math.abs((a % MAP_W) - (b % MAP_W)), Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W)));
/** The whole square root of a whole number (the same on every device). */
function isqrt(n: number): number {
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** Someone who walks a way (a searcher, a dog). */
type Walker = { body: Body; goal: number; path: number[]; best: number; stuck: number };

/**
 * The manhunt (P41): a deterministic simulation of its own, outside the wall, at the inside's
 * fixed 20 steps a second with packed commands (command.ts). Built from the outside's map and
 * what carried over (`Carry`), so the inside run, its records, its replay and the escape bots
 * stay as they were. Each step, in this order: the player (a cut, the walk, the trail, gravel
 * underfoot, a ford, cover, an action) → the alarm's age (searchers out where the player, as
 * they stand now, won't see it, roadblocks, the helicopter, the search widening) → the searchers
 * (eyes, the notice meter, chases, looks, sweeps, beats) → the dogs (the trail, the nose,
 * pointing) → the helicopter's light → the lookout's whistle → safe or caught.
 */
export class Hunt {
  readonly out: OutsideWorld;
  readonly world: World;
  state: HuntState;
  events: HuntEvent[] = [];
  /**
   * What stops the player's feet now (the base, roadblocks up, wire cut); a chaser's way (cut
   * wire too: searchers keep out of the player's cut); the searchers' way on a beat, a look or a
   * sweep (cover too: they go round it; chasing, or to what their dog points at, they push in).
   * Not state: derived.
   */
  readonly grid = new Uint8Array(N);
  readonly chaseGrid = new Uint8Array(N);
  readonly npcGrid = new Uint8Array(N);
  /** Walking tiles from every tile to the nearest way out (the safe point, Lou's car when he's there); -1 none. Not state. */
  readonly toGoal: Int32Array;
  /** Where the player came out (a tile). */
  readonly start: number;
  /** The places the search sweeps (tiles: open ground beside cover, every cover tile within a dog's nose of one; and a place every few tiles across the open). Not state. */
  readonly sweepPts: number[];
  /** Bumps when a tile changes (wire cut): the view redraws the fences. Not state. */
  tilesRev = 0;
  private readonly feet = { blocked: (x: number, z: number) => x < 0 || z < 0 || x >= MAP_W || z >= MAP_H || this.grid[z * MAP_W + x] === 1 };
  private readonly npcFeet = { blocked: (x: number, z: number) => x < 0 || z < 0 || x >= MAP_W || z >= MAP_H || this.chaseGrid[z * MAP_W + x] === 1 };
  private readonly heard = new Int32Array(N);
  /** The searchers' and roadblocks' timings in steps after the alarm (Infinity: never, a lesson's; -Infinity: a patrol, out at once). */
  private readonly outAt: number[];
  private readonly blockAt: number[];
  private readonly heliAt: number;
  /** Each searcher's first stop: on its beat (a patrol starts there), or the one it heads for once on. */
  private readonly firstStop: number[];
  /** The step after the alarm the search starts widening (Infinity: never). */
  private readonly rampAt: number;

  constructor(
    readonly def: OutsideDef,
    readonly prison: PrisonDef,
    readonly carry: Carry,
    opts: HuntOptions = {},
  ) {
    this.out = outsideWorld(def, prison);
    this.world = this.out.world;
    const { ox, oz } = this.out;
    const at = def.starts[carry.kind] ?? def.starts.wall ?? Object.values(def.starts)[0]!;
    this.start = spotTile(at, ox, oz);
    const kit = carry.kit;
    const salt = carry.salt | 0;
    // The run's salt: a full hunt shuffles the searchers' times, moves them a little, starts each beat somewhere of its own (a lesson's keeps the map's).
    const full = !opts.searchers;
    const draw = (what: number, k: number, n: number) => (full ? rollInt(salt, SALT.HUNT, what, k, n) : 0);
    const shift = (what: number, k: number) => (full ? draw(what, k, 2 * HUNT.jitter + 1) - HUNT.jitter : 0);
    const late = def.searchers.flatMap((d, k) => (d.at >= 0 ? [k] : []));
    const times = late.map((k) => def.searchers[k].at);
    for (let i = times.length - 1; i > 0; i--) {
      const j = draw(DRAW.ORDER, i, i + 1);
      [times[i], times[j]] = [times[j], times[i]];
    }
    const searchers: Searcher[] = [];
    const dogs: HuntDog[] = [];
    this.outAt = [];
    this.firstStop = [];
    def.searchers.forEach((d, k) => {
      const b0 = d.from ?? d.beat[0];
      const body = bodyAt(b0.x + ox, b0.z + oz, b0.face ?? 5);
      const dog = d.dog ? dogs.length : -1;
      searchers.push(fresh(body, dog));
      if (d.dog) dogs.push({ body: bodyAt(b0.x + ox, b0.z + oz, b0.face ?? 5), mode: HOUND.HEEL, handler: k, until: 0, trail: 0, rest: 0, path: [], goal: -1, best: FOREVER, stuck: 0 });
      // (Never: a lesson leaves it out; at once: a patrol out before any alarm.)
      const t = d.at < 0 ? -1 : times[late.indexOf(k)];
      this.outAt.push(opts.searchers && !opts.searchers.includes(k) ? Infinity : t < 0 ? -Infinity : Math.max(0, t + shift(DRAW.TIME, k)) * S);
      const n = d.beat.length;
      this.firstStop.push(d.at < 0 || d.from ? draw(DRAW.STOP, k, n) : n > 1 ? 1 + draw(DRAW.STOP, k, n - 1) : 0);
    });
    this.blockAt = def.roadblocks.map((r, k) => (opts.roadblocks === false ? Infinity : Math.max(0, r.at + shift(DRAW.BLOCK, k)) * S));
    def.roadblocks.forEach((r, k) => {
      searchers.push(fresh(bodyAt(r.post.x + ox, r.post.z + oz, r.post.face ?? 5), -1));
      this.outAt.push(this.blockAt[k]);
      this.firstStop.push(0);
    });
    this.heliAt = opts.heli === false ? Infinity : Math.max(0, def.heli.at + shift(DRAW.HELI, 0)) * S;
    // The search widens once the last of them is due out.
    const due = [...this.outAt, ...this.blockAt, this.heliAt].filter((v) => Number.isFinite(v));
    this.rampAt = opts.ramp === false || !full ? Infinity : Math.max(0, ...due);
    const h0 = def.heli.route[0];
    const clothes = carry.outfit === GUARD_OUTFIT ? 1 : carry.outfit === OWN_CLOTHES ? 2 : 0;
    this.state = {
      step: 0,
      salt,
      player: bodyAt(at.x + ox, at.z + oz, at.face ?? 13),
      still: 0,
      hidden: false,
      clothes,
      trail: [],
      searchers,
      dogs,
      heli: { on: false, x: (h0.x + ox) * UNIT + UNIT / 2, z: (h0.z + oz) * UNIT + UNIT / 2, k: 1 % def.heli.route.length, hold: 0, lit: false, aim: -1 },
      alarmAt: Math.max(0, Math.round(carry.headStart)) * S,
      blocks: 0,
      lines: 0,
      cut: [],
      cutting: [],
      stoneAt: -1e6,
      treats: TREATS.map((t) => kit.filter((i) => i === t).length),
      cutters: kit.some((i) => i > 0 && itemDef(i).tool?.kind === 'cut'),
      noises: [],
      at: this.start,
      warned: 0,
      over: OVER.RUNNING,
      overAt: 0,
      by: -1,
      feats: new Array(HUNT_FEATS.length).fill(0),
      best: 0,
      known: this.start,
      knownAt: 0,
      heat: 0,
      swept: [],
    };
    this.refreshGrid();
    this.toGoal = this.distances();
    this.state.best = this.toGoal[this.start];
    this.sweepPts = this.sweepPoints();
  }

  /** The minute of the day now (the light, how far eyes see). */
  get minute(): number {
    return (this.carry.minute + Math.floor(this.state.step / S)) % 1440;
  }

  /** After dark (21:00–06:00): eyes see less far. */
  get night(): boolean {
    const m = this.minute;
    return m < 360 || m >= 1260;
  }

  /** Seconds since the alarm went up (negative: still to come). */
  get alarmAge(): number {
    return (this.state.step - this.state.alarmAt) / S;
  }

  /** How far a searcher's eyes reach now (tiles): further as the search widens. */
  get sight(): number {
    return (this.night ? HUNT.sightNight : HUNT.sightDay) + this.state.heat * HUNT.rampSight;
  }

  /** How close a searcher must be to know the player in what they wear (tiles). */
  get knownAt(): number {
    const c = this.state.clothes;
    return c === 1 ? HUNT.uniform : c === 2 ? HUNT.disguised : this.sight;
  }

  /** How close they got: the share of the way to safety walked (0–1). */
  get progress(): number {
    const from = this.toGoal[this.start];
    return from > 0 ? Math.max(0, Math.min(1, 1 - this.state.best / from)) : 1;
  }

  /** The player's tile now. */
  get tile(): number {
    return tileAt(this.state.player.x, this.state.player.z);
  }

  /** One step: false once it's over (nothing happens). */
  step(cmd: number): boolean {
    const s = this.state;
    this.events = [];
    if (s.over) return false;
    s.step++;
    this.playerMoves(cmd);
    this.timeline();
    if (!s.over) this.searchersLook();
    if (!s.over) this.dogsSniff();
    if (!s.over) this.heliSweeps();
    if (!s.over) this.lookout();
    if (!s.over) this.outcome();
    // Noises fade from the view after a few seconds.
    while (s.noises.length && s.step - s.noises[0][1] > 3 * S) s.noises.shift();
    return true;
  }

  // ---------------------------------------------------------------- the alarm's age
  private timeline() {
    const s = this.state;
    const age = s.step - s.alarmAt;
    if (age === 0 && s.alarmAt > 0) this.events.push({ type: 'alarm' });
    const n = this.def.searchers.length;
    for (let k = 0; k < n; k++) {
      const m = s.searchers[k];
      if (m.mode !== SEEK.OFF || age < this.outAt[k]) continue;
      // (Those due at the alarm give a player who starts with it up a moment: a takeover, seen going.)
      if (this.def.searchers[k].at >= 0 && s.step < HUNT.grace) continue;
      this.deploy(k);
    }
    this.def.roadblocks.forEach((r, k) => {
      if (s.blocks & (1 << k)) {
        // (Its officer comes once he wouldn't appear on top of the player.)
        if (s.searchers[n + k].mode === SEEK.OFF) this.deploy(n + k);
        return;
      }
      if (age < this.blockAt[k]) return;
      // Never shut on the player; it waits a while for one loitering by it, then goes up as soon as they're off its tiles.
      const t = this.tile;
      const [x0, z0, x1, z1] = r.area;
      const px = (t % MAP_W) - this.out.ox;
      const pz = Math.floor(t / MAP_W) - this.out.oz;
      if (px >= x0 && px <= x1 && pz >= z0 && pz <= z1) return;
      if (px >= x0 - 1 && px <= x1 + 1 && pz >= z0 - 1 && pz <= z1 + 1 && age < this.blockAt[k] + HUNT.blockWait) return;
      s.blocks |= 1 << k;
      this.refreshGrid();
      this.events.push({ type: 'roadblock', k });
      this.deploy(n + k);
    });
    if (!s.heli.on && age >= this.heliAt) {
      s.heli.on = true;
      this.events.push({ type: 'heli' });
    }
    // The search widens: eyes further, the helicopter over the cover where the player is reckoned to be.
    if (age >= this.rampAt) {
      const heat = Math.min(HUNT.rampMax, 1 + Math.floor((age - this.rampAt) / HUNT.rampEvery));
      if (heat !== s.heat) {
        s.heat = heat;
        this.events.push({ type: 'widen', heat });
      }
    }
    // Those out after the alarm search where the player is reckoned to have got to (the patrols keep to their beats till the search has widened twice; the roadblocks' officers keep to their posts).
    if (Number.isFinite(this.rampAt) && age >= 0)
      for (let k = 0; k < n; k++) {
        const m = s.searchers[k];
        if (m.mode !== SEEK.BEAT || (this.def.searchers[k].at < 0 && s.heat < 2)) continue;
        m.mode = SEEK.SWEEP;
        m.goal = -1;
        m.path = [];
      }
  }

  /** Out, where the player won't see it appear (not within HUNT.clear tiles, nor in their sight); false while it must wait. */
  private deploy(k: number): boolean {
    const s = this.state;
    const m = s.searchers[k];
    const n = this.def.searchers.length;
    const d = k < n ? this.def.searchers[k] : null;
    const beat = this.beatOf(k);
    // Where it comes on: its post, its edge or gate; a patrol already out, on its beat from its first stop.
    const spots: Array<[Spot, number]> = !d ? [[beat[0], 0]] : d.at < 0 ? beat.map((_, j) => [beat[(this.firstStop[k] + j) % beat.length], (this.firstStop[k] + j + 1) % beat.length]) : [[d.from ?? beat[0], this.firstStop[k]]];
    const { ox, oz } = this.out;
    for (const [spot, next] of spots) {
      const t = spotTile(spot, ox, oz);
      if (!this.clearOf(t)) continue;
      const put = (b: Body) => {
        b.x = centerX(t);
        b.z = centerZ(t);
        b.facing = spot.face ?? 5;
        b.moving = false;
      };
      put(m.body);
      if (m.dog >= 0) put(s.dogs[m.dog].body);
      m.mode = SEEK.BEAT;
      m.k = next;
      m.goal = -1;
      m.path = [];
      this.events.push({ type: 'out', who: k });
      return true;
    }
    return false;
  }

  /** Nobody would see someone come on at this tile: not within HUNT.clear tiles of the player, nor in their sight. */
  private clearOf(t: number): boolean {
    const p = this.state.player;
    const c = { x: centerX(t), z: centerZ(t) };
    if (within(c, p, HUNT.clear)) return false;
    return !(within(c, p, this.sight + 1) && lineOfSight(this.world, c.x, c.z, p.x, p.z));
  }

  /** A searcher's beat (a roadblock's officer: his post). */
  private beatOf(k: number): readonly Spot[] {
    const n = this.def.searchers.length;
    return k < n ? this.def.searchers[k].beat : [this.def.roadblocks[k - n].post];
  }

  /** Feet stopped by: the map (trees, water but fords, walls, wire not yet cut), roadblocks up; searchers by the player's cut wire too, and their ways go round cover. */
  private refreshGrid() {
    const s = this.state;
    const o = this.out;
    const w = this.world;
    for (let i = 0; i < N; i++) {
      this.grid[i] = w.block[i] && !o.ford[i] ? 1 : 0;
    }
    this.def.roadblocks.forEach((r, k) => {
      if (s.blocks & (1 << k)) fillArea(this.grid, r.area, o.ox, o.oz);
    });
    this.chaseGrid.set(this.grid);
    for (const t of s.cut) this.chaseGrid[t] = 1;
    for (let i = 0; i < N; i++) this.npcGrid[i] = this.chaseGrid[i] || o.cover[i] ? 1 : 0;
  }

  /** Walking tiles to the nearest way to safety from every tile (the map as built). */
  private distances(): Int32Array {
    const d = new Int32Array(N).fill(-1);
    const queue: number[] = [];
    const o = this.out;
    for (let i = 0; i < N; i++) if (o.safe[i]) (d[i] = 0), queue.push(i);
    if (this.carry.lou) {
      const t = spotTile(this.def.lou, o.ox, o.oz);
      if (d[t] !== 0) (d[t] = 0), queue.push(t);
    }
    // (Wire counts as passable: cutters make it so; a way round it is shorter anyway where there is one.)
    const open = (i: number) => !this.grid[i] || o.wire[i] === 1;
    flood(d, queue, open);
    return d;
  }

  /** Open ground beside cover a searcher can walk to, so that every cover tile is within a tile or two of one, and a place every few tiles across the open (in the map's order: the same every run). */
  private sweepPoints(): number[] {
    const o = this.out;
    const reach = new Int32Array(N).fill(-1);
    reach[this.start] = 0;
    flood(reach, [this.start], (i) => !this.npcGrid[i]);
    const stand = (i: number) => reach[i] >= 0 && !this.npcGrid[i];
    const done = new Uint8Array(N);
    const pts: number[] = [];
    for (let c = 0; c < N; c++) {
      if (!o.cover[c] || done[c]) continue;
      const cx = c % MAP_W;
      const cz = Math.floor(c / MAP_W);
      // The open tile beside it that reaches the most cover not yet covered (nearest first).
      let best = -1;
      let bestN = 0;
      for (let r = 1; r <= 2 && best < 0; r++)
        for (let z = cz - r; z <= cz + r; z++)
          for (let x = cx - r; x <= cx + r; x++) {
            if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
            const i = z * MAP_W + x;
            if (!stand(i)) continue;
            let n = 0;
            for (let dz = -2; dz <= 2; dz++)
              for (let dx = -2; dx <= 2; dx++) {
                const j = i + dz * MAP_W + dx;
                if (dx * dx + dz * dz <= 5 && j >= 0 && j < N && o.cover[j] && !done[j]) n++;
              }
            if (n > bestN) (best = i), (bestN = n);
          }
      done[c] = 1;
      if (best < 0) continue;
      pts.push(best);
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const j = best + dz * MAP_W + dx;
          if (dx * dx + dz * dz <= 5 && j >= 0 && j < N && o.cover[j]) done[j] = 1;
        }
    }
    // And the open ground: a place every few tiles across the map (the nearest standing to each).
    const step = 8;
    for (let z = o.oz + step / 2; z < o.oz + o.h; z += step)
      for (let x = o.ox + step / 2; x < o.ox + o.w; x += step) {
        let best = -1;
        for (let r = 0; r <= 3 && best < 0; r++)
          for (let dz = -r; dz <= r && best < 0; dz++)
            for (let dx = -r; dx <= r && best < 0; dx++) {
              const i = (z + dz) * MAP_W + x + dx;
              if (stand(i)) best = i;
            }
        if (best >= 0 && !pts.some((t) => cheb(t, best) <= 3)) pts.push(best);
      }
    return pts;
  }

  // ---------------------------------------------------------------- the player
  private playerMoves(cmd: number) {
    const s = this.state;
    const o = this.out;
    const p = s.player;
    const dir = dirOf(cmd);
    // A cut under way: a step away stops it; standing at it, it goes on.
    if (s.cutting.length) {
      if (dir !== 0) s.cutting = [];
      else if (++s.cutting[1] >= HUNT.cutSteps) this.cutThrough(s.cutting[0]);
    }
    const from = this.tile;
    walk(this.feet, p, dir, this.paceAt(from), LAYER.GROUND);
    const t = this.tile;
    if (t !== s.at) {
      s.at = t;
      if (o.ford[t]) {
        // A ford: the water takes the trail, and a dog on it loses it there (as at a washing line).
        if (s.trail.length) {
          s.trail = [];
          for (const d of s.dogs) if (d.mode === HOUND.TRACK) this.dogLost(d);
        }
      } else {
        s.trail.push([t, s.step]);
        if (s.trail.length > HUNT.trailTiles) s.trail.shift();
      }
      // Gravel and ballast underfoot.
      if (o.noisy[t] && !s.noises.some(([, at, r]) => r === HUNT.crunch && s.step - at < CRUNCH_EVERY)) {
        s.feats[HFEAT.crunches]++;
        this.noise(t, HUNT.crunch, 'crunch');
        this.know(t);
      }
    }
    while (s.trail.length && s.step - s.trail[0][1] > HUNT.trailSteps) s.trail.shift();
    s.still = dir === 0 ? s.still + 1 : 0;
    const hidden = o.cover[t] === 1 && s.still >= HUNT.settle;
    if (hidden !== s.hidden) {
      s.hidden = hidden;
      if (hidden) s.feats[HFEAT.hid]++;
      this.events.push({ type: 'hidden', on: hidden });
    }
    const op = opOf(cmd);
    if (op === OP.INTERACT) this.act();
    else if (op === OP.EXT && argA(cmd) === EXT.HUNT_THROW) this.stone(tossTile(argB(cmd), argC(cmd)));
    else if (op === OP.EXT && argA(cmd) === EXT.HUNT_TREAT) this.treat(argB(cmd), argC(cmd));
  }

  /** The player's pace on a tile (units a step): their Speed's, less off the roads, in cover, in a ford. */
  paceAt(tile: number): number {
    return this.terrain(tile, walkSpeed(this.carry.spd));
  }

  /** A pace on a tile: the outside's share of it (HUNT.pace), less off the roads (grass, snow, sand), in cover, in a ford. */
  terrain(tile: number, pace: number): number {
    const o = this.out;
    const share = o.ford[tile] ? HUNT.fordPace : o.cover[tile] ? HUNT.coverPace : this.world.ground.kind[tile] === TILE.GRASS ? HUNT.roughPace : 100;
    return Math.floor((pace * share * HUNT.pace) / 10000);
  }

  /** The action button: clothes off a washing line close by, else a cut at the wire ahead. */
  private act() {
    const s = this.state;
    const line = this.lineNear();
    if (line >= 0) {
      s.lines |= 1 << line;
      s.clothes = 2;
      s.feats[HFEAT.swaps]++;
      // New clothes, a new scent: the trail so far is no use to a dog.
      s.trail = [];
      for (const d of s.dogs) if (d.mode === HOUND.TRACK || d.mode === HOUND.POINT) this.dogLost(d);
      this.events.push({ type: 'swap' });
      return;
    }
    const wire = this.wireAhead();
    if (wire >= 0) {
      if (!s.cutters) return void this.events.push({ type: 'refused', why: 'noCutters' });
      s.cutting = [wire, 0];
      this.noise(wire, HUNT.cutNoise, 'cut');
      this.know(this.tile);
      this.events.push({ type: 'cut', tile: wire, done: false });
      return;
    }
    this.events.push({ type: 'refused', why: 'nothing' });
  }

  /** A washing line within reach not yet used (its index), -1 none (or none worth it: a guard's uniform is the better disguise). */
  lineNear(): number {
    const s = this.state;
    const o = this.out;
    if (s.clothes === 1) return -1;
    return this.def.lines.findIndex((l, k) => !(s.lines & (1 << k)) && within(s.player, { x: (l.x + o.ox) * UNIT + UNIT / 2, z: (l.z + o.oz) * UNIT + UNIT / 2 }, LINE_REACH));
  }

  /** The wire fence tile the player faces, next to them (-1 none). */
  wireAhead(): number {
    const s = this.state;
    const p = s.player;
    const fx = DIR_X[p.facing] ?? 0;
    const fz = DIR_Z[p.facing] ?? 0;
    // The nearest of the four ways round the way they face.
    const [dx, dz] = Math.abs(fx) >= Math.abs(fz) ? [Math.sign(fx), 0] : [0, Math.sign(fz)];
    const t = this.tile;
    const x = (t % MAP_W) + dx;
    const z = Math.floor(t / MAP_W) + dz;
    if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return -1;
    const j = z * MAP_W + x;
    return this.out.wire[j] && !s.cut.includes(j) ? j : -1;
  }

  private cutThrough(tile: number) {
    const s = this.state;
    s.cutting = [];
    s.cut.push(tile);
    s.feats[HFEAT.cuts]++;
    this.world.setKind(LAYER.GROUND, tile, TILE.FENCE_CUT);
    this.tilesRev++;
    this.refreshGrid();
    this.events.push({ type: 'cut', tile, done: true });
  }

  /** Where a stone thrown now lands: the furthest open tile ahead, in sight, up to its range (-1 nowhere). */
  stoneTarget(): number {
    const p = this.state.player;
    const fx = DIR_X[p.facing] ?? 0;
    const fz = DIR_Z[p.facing] ?? 0;
    for (let d = HUNT.stoneRange; d >= 2; d--) {
      const x = p.x + Math.trunc((fx * d * UNIT) / 1024);
      const z = p.z + Math.trunc((fz * d * UNIT) / 1024);
      if (x < 0 || z < 0 || x >= MAP_W * UNIT || z >= MAP_H * UNIT) continue;
      const t = tileAt(x, z);
      if (this.grid[t] || !this.out.inside[t]) continue;
      if (lineOfSight(this.world, p.x, p.z, centerX(t), centerZ(t))) return t;
    }
    return -1;
  }

  private stone(tile: number) {
    const s = this.state;
    if (s.step - s.stoneAt < HUNT.stoneEvery) return void this.events.push({ type: 'refused', why: 'stoneSoon' });
    if (tile < 0 || tile >= N || this.grid[tile] || cheb(tile, this.tile) > HUNT.stoneRange || !lineOfSight(this.world, s.player.x, s.player.z, centerX(tile), centerZ(tile))) {
      return void this.events.push({ type: 'refused', why: 'stoneFar' });
    }
    s.stoneAt = s.step;
    s.feats[HFEAT.stones]++;
    this.events.push({ type: 'stone', tile });
    this.noise(tile, HUNT.stoneNoise, 'stone');
  }

  /** The dog a treat could be thrown to now (the nearest in reach, in sight, not already asleep), -1 none. */
  dogInReach(): number {
    const s = this.state;
    let best = -1;
    let bestD = Infinity;
    s.dogs.forEach((d, k) => {
      if (d.mode === HOUND.ASLEEP || s.searchers[d.handler].mode === SEEK.OFF) return;
      const d2 = dist2(d.body, s.player);
      if (d2 > (HUNT.treatRange * UNIT) ** 2 || d2 >= bestD || !lineOfSight(this.world, s.player.x, s.player.z, d.body.x, d.body.z)) return;
      best = k;
      bestD = d2;
    });
    return best;
  }

  private treat(k: number, what: number) {
    const s = this.state;
    const d = s.dogs[k];
    if (!d || what < 0 || what > 2 || s.treats[what] <= 0) return void this.events.push({ type: 'refused', why: 'noTreat' });
    if (d.mode === HOUND.ASLEEP || !within(d.body, s.player, HUNT.treatRange) || !lineOfSight(this.world, s.player.x, s.player.z, d.body.x, d.body.z)) return void this.events.push({ type: 'refused', why: 'dogFar' });
    s.treats[what]--;
    s.feats[HFEAT.treats]++;
    d.path = [];
    d.goal = -1;
    if (what === 2) d.mode = HOUND.ASLEEP;
    else {
      d.mode = what === 0 ? HOUND.CALM : HOUND.DAZED;
      d.until = s.step + (what === 0 ? HUNT.calm : HUNT.daze);
    }
    // Pepper up its nose: the trail is gone for it.
    if (what === 1) d.trail = s.step;
    const h = s.searchers[d.handler];
    if (h.mode === SEEK.FOLLOW) this.backToBeat(d.handler);
    this.events.push({ type: 'treat', dog: k, what });
  }

  // ---------------------------------------------------------------- noise
  /** A noise: every searcher out within `reach` walking tiles of it goes to look (not one already after the player, nor an officer at his roadblock). */
  private noise(tile: number, reach: number, kind: 'crunch' | 'stone' | 'cut' | 'bark', by = -1) {
    const s = this.state;
    s.noises.push([tile, s.step, reach]);
    this.events.push({ type: 'noise', tile, reach, kind });
    const d = this.heard;
    d.fill(-1);
    d[tile] = 0;
    const queue = [tile];
    for (let q = 0; q < queue.length; q++) {
      const t = queue[q];
      if (d[t] >= reach) continue;
      const x = t % MAP_W;
      for (const [j, ok] of [
        [t - 1, x > 0],
        [t + 1, x < MAP_W - 1],
        [t - MAP_W, t >= MAP_W],
        [t + MAP_W, t < MAP_W * (MAP_H - 1)],
      ] as const)
        if (ok && d[j] < 0 && (!this.grid[j] || this.out.cover[j])) (d[j] = d[t] + 1), queue.push(j);
    }
    s.searchers.forEach((m, k) => {
      // (A bark: not its own handler, who goes to his dog anyway.)
      if (m.mode === SEEK.OFF || m.mode === SEEK.CHASE || m.mode === SEEK.FOLLOW || this.isPost(k) || k === by) return;
      if (d[tileAt(m.body.x, m.body.z)] < 0) return;
      this.lookAt(k, tile);
      this.events.push({ type: 'heard', who: k, tile });
    });
  }

  private isPost(k: number) {
    return k >= this.def.searchers.length;
  }

  // ---------------------------------------------------------------- the searchers
  /** Off to look at a tile (heard there, said on the radio, last seen there): the way there, then a look round. No way there: a look round where he stands. */
  private lookAt(k: number, tile: number) {
    const m = this.state.searchers[k];
    m.mode = SEEK.LOOK;
    m.wait = HUNT.look;
    this.route(m, tile);
    if (!m.path.length && !this.arrived(m)) m.goal = -1;
  }

  private backToBeat(k: number) {
    const m = this.state.searchers[k];
    m.mode = SEEK.BEAT;
    m.goal = -1;
    m.path = [];
    m.notice = 0;
  }

  /** Spotted: after the player, and on the radio to the others (who come to look). */
  private spot(k: number) {
    const s = this.state;
    const chasing = s.searchers.some((m) => m.mode === SEEK.CHASE);
    const m = s.searchers[k];
    m.mode = SEEK.CHASE;
    m.unseen = 0;
    m.last = this.tile;
    m.path = [];
    m.goal = -1;
    this.know(this.tile);
    if (!chasing) s.feats[HFEAT.spotted]++;
    this.events.push({ type: 'spotted', who: k });
    this.radio(k);
  }

  /** The others within HUNT.radio tiles hear where the player is (none already after them, no officer leaves his roadblock). */
  private radio(from: number) {
    const s = this.state;
    const t = this.tile;
    s.searchers.forEach((o, j) => {
      if (j === from || o.mode === SEEK.OFF || o.mode === SEEK.CHASE || this.isPost(j) || !within(o.body, s.player, HUNT.radio)) return;
      if (o.mode === SEEK.FOLLOW && o.dog >= 0 && s.dogs[o.dog].mode === HOUND.TRACK) return;
      this.lookAt(j, t);
    });
  }

  /** Whether a searcher's eyes find the player: never hidden; moving (or not yet settled) in cover only close by, the cover they stand in no veil. */
  private seesPlayer(m: Searcher, range: number): boolean {
    const s = this.state;
    if (s.hidden) return false;
    const t = this.tile;
    const r = this.out.cover[t] ? Math.min(range, HUNT.coverSeen) : range;
    return canSee(this.world, m.body, s.player, r * UNIT, true, t);
  }

  private searchersLook() {
    const s = this.state;
    const p = s.player;
    const range = this.sight;
    const known = this.knownAt;
    const t = this.tile;
    const moving = s.still === 0;
    const inCover = this.out.cover[t] === 1;
    for (let k = 0; k < s.searchers.length; k++) {
      const m = s.searchers[k];
      m.sees = false;
      if (m.mode === SEEK.OFF) continue;
      // Eyes first.
      const sees = this.seesPlayer(m, range);
      m.sees = sees;
      if (sees) {
        if (m.mode === SEEK.CHASE) {
          m.unseen = 0;
          m.last = t;
          this.know(t);
        } else if (within(m.body, p, known)) {
          // (Moving through cover, a third of the pace.)
          if (!(inCover && moving && s.step % 3 !== 0)) m.notice += within(m.body, p, HUNT.near) ? 3 : 1;
          if (m.notice >= HUNT.spot) this.spot(k);
        }
      } else if (m.notice > 0) m.notice--;
      this.searcherMoves(k);
      if (s.over) return;
      // Caught: a chaser at arm's length in the open; in cover (he saw them go in), within reach of the hedge.
      if (m.mode === SEEK.CHASE && within(m.body, p, inCover ? HUNT.found : HUNT.catch)) return this.caught(k);
      // Found: a handler whose dog points at them in cover, hidden or not (in the open, his dog's find is a chase).
      if (inCover && m.dog >= 0 && s.dogs[m.dog].mode === HOUND.POINT && within(m.body, p, HUNT.found)) return this.caught(k);
    }
  }

  private searcherMoves(k: number) {
    const s = this.state;
    const m = s.searchers[k];
    const beat = this.beatOf(k);
    const { ox, oz } = this.out;
    // (A handler whose dog is on the trail or pointing goes after it, whatever he was doing but a chase.)
    if (m.dog >= 0 && (m.mode === SEEK.LOOK || m.mode === SEEK.BEAT || m.mode === SEEK.SWEEP)) {
      const dm = s.dogs[m.dog].mode;
      if (dm === HOUND.TRACK || dm === HOUND.POINT) {
        m.mode = SEEK.FOLLOW;
        m.path = [];
        m.goal = -1;
        return;
      }
    }
    switch (m.mode) {
      case SEEK.CHASE: {
        m.unseen = m.sees ? 0 : m.unseen + 1;
        if (m.unseen >= HUNT.lose) {
          s.feats[HFEAT.lost]++;
          this.events.push({ type: 'lost', who: k });
          this.lookAt(k, m.last);
          return;
        }
        const target = m.sees ? this.tile : m.last;
        if (m.goal !== target && (s.step % HUNT.replan === 0 || !m.path.length)) this.route(m, target, this.chaseGrid);
        this.follow(m, HUNT.chase, true, this.chaseGrid);
        return;
      }
      case SEEK.LOOK: {
        if (m.goal >= 0 && !this.arrived(m)) {
          if (m.path.length) return void this.follow(m, HUNT.hurry);
          // (The way lost: a look round here.)
          m.goal = -1;
        }
        this.lookRound(m, k);
        if (--m.wait <= 0) this.backToBeat(k);
        return;
      }
      case SEEK.SWEEP: {
        // The cover nearest where the player was last known, one place after another, a look round at each.
        if (m.goal < 0) {
          this.nextSweep(m);
          m.wait = HUNT.sweepLook;
          if (m.goal < 0) return this.backToBeat(k);
        }
        if (!this.arrived(m)) {
          if (m.path.length) return void this.follow(m, HUNT.hurry);
          m.goal = -1;
          return;
        }
        this.lookRound(m, k);
        if (--m.wait <= 0) m.goal = -1;
        return;
      }
      case SEEK.FOLLOW: {
        const d = s.dogs[m.dog];
        if (!d || (d.mode !== HOUND.TRACK && d.mode !== HOUND.POINT)) return this.backToBeat(k);
        // (Its dog pointing: to what it points at, the player, into cover if that's where they are.)
        const pointing = d.mode === HOUND.POINT;
        const target = pointing ? this.tile : tileAt(d.body.x, d.body.z);
        if (cheb(target, tileAt(m.body.x, m.body.z)) <= (pointing ? 0 : 1)) {
          m.body.moving = false;
          m.body.facing = nearestDir(d.body.x - m.body.x, d.body.z - m.body.z) || m.body.facing;
          return;
        }
        const grid = pointing ? this.chaseGrid : this.npcGrid;
        if (m.goal !== target && (s.step % HUNT.replan === 0 || !m.path.length)) this.route(m, target, grid);
        this.follow(m, HUNT.hurry, true, grid);
        return;
      }
      case SEEK.BEAT: {
        const stop = beat[m.k];
        const goal = spotTile(stop, ox, oz);
        if (m.goal !== goal) {
          this.route(m, goal);
          m.wait = beat.length > 1 ? STOP_STEPS : FOREVER;
        }
        if (!this.arrived(m)) {
          if (m.path.length) return void this.follow(m, HUNT.walk);
          // (No way to that stop now: on to the next.)
          if (beat.length > 1) m.k = (m.k + 1) % beat.length;
          return;
        }
        m.body.moving = false;
        if (stop.face) m.body.facing = stop.face;
        if (--m.wait <= 0) m.k = (m.k + 1) % beat.length;
      }
    }
  }

  /** Standing, turning this way and that. */
  private lookRound(m: Searcher, k: number) {
    m.body.moving = false;
    if (m.wait % TURN_STEPS === 0) m.body.facing = 1 + rollInt(this.state.salt, SALT.HUNT, this.state.step, k, 16);
  }

  /** Where the player is known to be now (seen, lit, heard, found). */
  private know(t: number) {
    this.state.known = t;
    this.state.knownAt = this.state.step;
  }

  /**
   * Where the search reckons the player has got to: from where they were last known, along the
   * shortest way to safety, as far as HUNT.guess tiles a second since would take them.
   */
  guess(): number {
    const s = this.state;
    const d = this.toGoal;
    let t = s.known;
    let n = Math.floor(((s.step - s.knownAt) * HUNT.guess) / S);
    while (n-- > 0 && d[t] > 0) {
      const x = t % MAP_W;
      let next = -1;
      for (const [j, ok] of [
        [t - MAP_W, t >= MAP_W],
        [t + 1, x < MAP_W - 1],
        [t + MAP_W, t < N - MAP_W],
        [t - 1, x > 0],
      ] as const)
        if (ok && d[j] >= 0 && d[j] < d[t] && (next < 0 || d[j] < d[next])) next = j;
      if (next < 0) break;
      t = next;
    }
    return t;
  }

  /** The next place to sweep (the nearest not yet swept to where the search reckons the player has got to, or once it has widened, for the dog teams every other time, to where they were last known; then nearest him), marked swept; every one swept, round again. */
  private nextSweep(m: Searcher) {
    const s = this.state;
    const pts = this.sweepPts;
    if (!pts.length) return;
    if (s.swept.length >= pts.length) s.swept = [];
    const here = tileAt(m.body.x, m.body.z);
    // (Once the search widens, the dog teams work back where the player was last known every other time it widens.)
    const turns = s.heat > 0 ? Math.floor((s.step - s.alarmAt - this.rampAt) / HUNT.rampEvery) : 0;
    const back = s.heat > 0 && m.dog >= 0 && turns % 2 === 0;
    const aim = back ? s.known : this.guess();
    let best = -1;
    let bestD = Infinity;
    for (const t of pts) {
      if (s.swept.includes(t)) continue;
      const d = 2 * cheb(t, aim) + cheb(t, here);
      if (d < bestD) (best = t), (bestD = d);
    }
    if (best < 0) return;
    s.swept.push(best);
    this.route(m, best);
    if (!m.path.length && !this.arrived(m)) m.goal = -1;
  }

  /** At its goal (in the tile, or next to it when the goal is somewhere it can't stand: cover, a hedge the player hid in). */
  private arrived(m: { body: Body; goal: number; path: number[] }): boolean {
    if (m.goal < 0) return true;
    const here = tileAt(m.body.x, m.body.z);
    if (here === m.goal) return Math.abs(m.body.x - centerX(m.goal)) + Math.abs(m.body.z - centerZ(m.goal)) < REACHED * 2 || !m.path.length;
    return !m.path.length && cheb(here, m.goal) <= 1;
  }

  /** The way to a tile over a grid (next to it, if it's somewhere that grid won't stand on); from somewhere the grid shuts in (a searcher left in cover), through cover. */
  private route(w: Walker, goal: number, grid = this.npcGrid) {
    w.goal = goal;
    w.best = FOREVER;
    w.stuck = 0;
    const from = tileAt(w.body.x, w.body.z);
    const find = (g: Uint8Array) => findPath(this.world, from, !g[goal] ? (i) => i === goal : (i) => cheb(i, goal) <= 1, goal, N, undefined, g);
    w.path = find(grid) ?? (grid !== this.chaseGrid ? find(this.chaseGrid) : null) ?? [];
  }

  /** A step along the way at a pace (a new way looked for when stuck against something). */
  private follow(w: Walker, speed: number, rough = true, grid = this.npcGrid) {
    const b = w.body;
    while (w.path.length) {
      const next = w.path[0];
      const dx = centerX(next) - b.x;
      const dz = centerZ(next) - b.z;
      const d = Math.abs(dx) + Math.abs(dz);
      if (d < REACHED) {
        w.path.shift();
        w.best = FOREVER;
        continue;
      }
      if (d < w.best) {
        w.best = d;
        w.stuck = 0;
      } else if (++w.stuck > STUCK_STEPS) {
        this.route(w, w.goal, grid);
        return;
      }
      walk(this.npcFeet, b, nearestDir(dx, dz), rough ? this.terrain(tileAt(b.x, b.z), speed) : Math.floor((speed * HUNT.pace) / 100), LAYER.GROUND);
      return;
    }
    b.moving = false;
  }

  private caught(k: number) {
    const s = this.state;
    s.over = OVER.CAUGHT;
    s.overAt = s.step;
    s.by = k;
    s.player.moving = false;
    this.events.push({ type: 'caught', by: k });
  }

  // ---------------------------------------------------------------- the dogs
  private dogsSniff() {
    const s = this.state;
    s.dogs.forEach((d, k) => {
      const h = s.searchers[d.handler];
      if (h.mode === SEEK.OFF) return;
      switch (d.mode) {
        case HOUND.ASLEEP:
          d.body.moving = false;
          return;
        case HOUND.CALM:
        case HOUND.DAZED:
          d.body.moving = false;
          if (s.step >= d.until) d.mode = HOUND.HEEL;
          return;
        case HOUND.POINT: {
          d.body.moving = false;
          d.body.facing = nearestDir(s.player.x - d.body.x, s.player.z - d.body.z) || d.body.facing;
          if ((s.step - d.until + POINT_HOLD) % BARK_EVERY === 0) this.noise(tileAt(d.body.x, d.body.z), HUNT.bark, 'bark', d.handler);
          // (Out in the open, its handler is after them.)
          if (!this.out.cover[this.tile] && h.mode !== SEEK.CHASE && within(d.body, s.player, HUNT.nose)) this.spot(d.handler);
          if (s.step < d.until) return;
          if (within(d.body, s.player, HUNT.nose)) d.until = s.step + POINT_HOLD;
          else this.nextScent(d, k);
          return;
        }
        case HOUND.TRACK: {
          if (within(d.body, s.player, HUNT.nose)) return this.point(d, k);
          if (this.arrived(d)) this.nextScent(d, k);
          else this.follow(d, HUNT.dogTrack, false);
          return;
        }
        default: {
          // At the heel: the player under its nose, it points; a fresh trail close by puts it on it.
          if (within(d.body, s.player, HUNT.nose)) return this.point(d, k);
          if (s.step >= d.rest) {
            for (let j = s.trail.length - 1; j >= 0; j--) {
              const [t, at] = s.trail[j];
              if (at <= d.trail) break;
              if (within(d.body, { x: centerX(t), z: centerZ(t) }, HUNT.sniff)) {
                d.mode = HOUND.TRACK;
                d.trail = at;
                this.route(d, t);
                this.events.push({ type: 'track', dog: k });
                return;
              }
            }
          }
          const far = !within(d.body, h.body, DOG_CATCH_UP);
          if (within(d.body, h.body, 1)) {
            d.body.moving = false;
            return;
          }
          const target = tileAt(h.body.x, h.body.z);
          if (d.goal !== target && (s.step % HUNT.replan === 0 || !d.path.length)) this.route(d, target);
          this.follow(d, far ? DOG_RUN : HUNT.dogHeel, false);
        }
      }
    });
  }

  /** On along the trail: the next fresher scent tile, or the end of it (the player there: it points; else the trail's lost). */
  private nextScent(d: HuntDog, k: number) {
    const s = this.state;
    const next = s.trail.find(([, at]) => at > d.trail);
    if (next) {
      d.mode = HOUND.TRACK;
      d.trail = next[1];
      this.route(d, next[0]);
      return;
    }
    if (within(d.body, s.player, HUNT.nose)) return this.point(d, k);
    this.dogLost(d);
  }

  /** It has them: it points and barks; in the open its handler is after them (a chase), in cover he comes to where it points. */
  private point(d: HuntDog, k: number) {
    const s = this.state;
    d.mode = HOUND.POINT;
    d.until = s.step + POINT_HOLD;
    d.path = [];
    d.goal = -1;
    this.know(this.tile);
    this.events.push({ type: 'point', dog: k });
    this.noise(tileAt(d.body.x, d.body.z), HUNT.bark, 'bark', d.handler);
    const h = s.searchers[d.handler];
    if (h.mode === SEEK.CHASE) return;
    if (!this.out.cover[this.tile]) return this.spot(d.handler);
    h.mode = SEEK.FOLLOW;
    h.path = [];
    h.goal = -1;
  }

  private dogLost(d: HuntDog) {
    d.mode = HOUND.HEEL;
    d.rest = this.state.step + TRAIL_REST;
    d.trail = this.state.step;
    d.path = [];
    d.goal = -1;
  }

  // ---------------------------------------------------------------- the helicopter
  private heliSweeps() {
    const s = this.state;
    const h = s.heli;
    if (!h.on) return;
    const { ox, oz } = this.out;
    const route = this.def.heli.route;
    let tx: number;
    let tz: number;
    let pace: number;
    const searching = s.heat > 0 && this.sweepPts.length > 0;
    if (h.hold > 0) {
      tx = s.player.x;
      tz = s.player.z;
      pace = Math.floor((HUNT.heliChase * HUNT.pace) / 100);
      h.hold--;
    } else if (searching) {
      // The search widened: over the cover nearest where the player was last known.
      if ((h.aim ?? -1) < 0) h.aim = this.heliAim();
      tx = centerX(h.aim!);
      tz = centerZ(h.aim!);
      pace = Math.floor((HUNT.heliSpeed * HUNT.pace) / 100);
    } else {
      const stop = route[h.k];
      tx = (stop.x + ox) * UNIT + UNIT / 2;
      tz = (stop.z + oz) * UNIT + UNIT / 2;
      pace = Math.floor((HUNT.heliSpeed * HUNT.pace) / 100);
    }
    const dx = tx - h.x;
    const dz = tz - h.z;
    const d = isqrt(dx * dx + dz * dz);
    if (d <= pace) {
      h.x = tx;
      h.z = tz;
      if (h.hold <= 0) {
        if (searching) h.aim = -1;
        else h.k = (h.k + 1) % route.length;
      }
    } else {
      h.x += Math.trunc((dx * pace) / d);
      h.z += Math.trunc((dz * pace) / d);
    }
    // Its light: someone in the open under it; someone moving in cover only under its middle; someone hidden never.
    const reach = this.out.cover[this.tile] ? HUNT.heliCover : HUNT.heliLight;
    const lit = !s.hidden && within(h, s.player, reach);
    if (lit) {
      h.hold = HUNT.heliHold;
      this.know(this.tile);
      if (!h.lit || s.step % HELI_CALL === 0) {
        // The light on them: every searcher out within the radio's reach comes running (a chaser keeps on).
        const t = this.tile;
        s.searchers.forEach((m, j) => {
          if (m.mode === SEEK.OFF || m.mode === SEEK.CHASE || this.isPost(j) || !within(m.body, s.player, HUNT.radio)) return;
          this.lookAt(j, t);
        });
      }
    }
    if (lit !== h.lit) {
      h.lit = lit;
      if (lit) s.feats[HFEAT.lit]++;
      this.events.push({ type: 'lit', on: lit });
    }
  }

  /** The helicopter's next place to search: one of the few nearest where the search reckons the player has got to, not yet swept on foot. */
  private heliAim(): number {
    const s = this.state;
    const aim = this.guess();
    const near = this.sweepPts
      .filter((t) => !s.swept.includes(t))
      .map((t) => [cheb(t, aim), t] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, HELI_PICK);
    if (!near.length) return this.sweepPts[rollInt(s.salt, SALT.HUNT, DRAW.AIM, s.step, this.sweepPts.length)];
    return near[rollInt(s.salt, SALT.HUNT, DRAW.AIM, s.step, near.length)][1];
  }

  // ---------------------------------------------------------------- the lookout, the end
  private lookout() {
    const s = this.state;
    if (this.carry.crew <= 0) return;
    s.searchers.forEach((m, k) => {
      if (m.mode === SEEK.OFF || k > 30) return;
      const bit = 1 << k;
      if (s.warned & bit) {
        if (!within(m.body, s.player, HUNT.lookoutClear)) s.warned &= ~bit;
        return;
      }
      if (s.hidden || m.mode === SEEK.CHASE || !within(m.body, s.player, HUNT.lookoutWarn)) return;
      s.warned |= bit;
      s.feats[HFEAT.whistles]++;
      this.events.push({ type: 'whistle', who: k });
    });
  }

  private outcome() {
    const s = this.state;
    const t = this.tile;
    const d = this.toGoal[t];
    if (d >= 0 && d < s.best) s.best = d;
    const o = this.out;
    const lou = this.carry.lou && within(s.player, { x: (this.def.lou.x + o.ox) * UNIT + UNIT / 2, z: (this.def.lou.z + o.oz) * UNIT + UNIT / 2 }, HUNT.car);
    if (!o.safe[t] && !lou) return;
    s.over = lou && !o.safe[t] ? OVER.LOU : OVER.SAFE;
    s.overAt = s.step;
    s.best = 0;
    s.player.moving = false;
    this.events.push({ type: 'safe', lou: s.over === OVER.LOU });
  }

  /** A fingerprint of the whole state (tests compare these). */
  hash(): string {
    return fnv1a(JSON.stringify(this.state));
  }
}

function fresh(body: Body, dog: number): Searcher {
  return { body, mode: SEEK.OFF, k: 0, wait: 0, goal: -1, path: [], best: FOREVER, stuck: 0, notice: 0, unseen: 0, last: -1, sees: false, dog };
}

/** Walking tiles outward from the tiles already queued (their distances set), over open ground. */
function flood(d: Int32Array, queue: number[], open: (i: number) => boolean) {
  for (let q = 0; q < queue.length; q++) {
    const t = queue[q];
    const x = t % MAP_W;
    for (const [j, ok] of [
      [t - 1, x > 0],
      [t + 1, x < MAP_W - 1],
      [t - MAP_W, t >= MAP_W],
      [t + MAP_W, t < MAP_W * (MAP_H - 1)],
    ] as const)
      if (ok && d[j] < 0 && open(j)) (d[j] = d[t] + 1), queue.push(j);
  }
}

/** What a tile is, for the frame's footsteps and the view (re-exported for the play layer). */
export { DECO };
