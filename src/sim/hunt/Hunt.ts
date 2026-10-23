import { HUNT } from '../../content/manhunt';
import { itemDef, itemNumber } from '../../content/items';
import type { OutsideDef } from '../../content/outside/types';
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
  | { type: 'caught'; by: number };

/** Options for a lesson's hunt (P41's lesson): only some searchers, no helicopter, no roadblocks. */
export interface HuntOptions {
  searchers?: readonly number[];
  heli?: boolean;
  roadblocks?: boolean;
}

const S = 20;
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

const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const within = (a: { x: number; z: number }, b: { x: number; z: number }, tiles: number) => dist2(a, b) <= (tiles * UNIT) ** 2;
/** Chebyshev distance between two tiles. */
const cheb = (a: number, b: number) => Math.max(Math.abs((a % MAP_W) - (b % MAP_W)), Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W)));

/**
 * The manhunt (P41): a deterministic simulation of its own, outside the wall, at the inside's
 * fixed 20 steps a second with packed commands (command.ts). Built from the outside's map and
 * what carried over (`Carry`), so the inside run, its records, its replay and the escape bots
 * stay as they were. Each step, in this order: the alarm's age (searchers out, roadblocks, the
 * helicopter) → the player (a cut, the walk, the trail, gravel underfoot, cover, an action) →
 * the searchers (eyes, the notice meter, chases, looks, beats) → the dogs (the trail, pointing)
 * → the helicopter's light → the lookout's whistle → safe or caught.
 */
export class Hunt {
  readonly out: OutsideWorld;
  readonly world: World;
  state: HuntState;
  events: HuntEvent[] = [];
  /** What stops the player's feet now (the base, roadblocks up, wire cut), and the searchers' (cover and cut wire too). Not state: derived. */
  readonly grid = new Uint8Array(MAP_W * MAP_H);
  readonly npcGrid = new Uint8Array(MAP_W * MAP_H);
  /** Walking tiles from every tile to the nearest way out (the safe point, Lou's car when he's there); -1 none. Not state. */
  readonly toGoal: Int32Array;
  /** Where the player came out (a tile). */
  readonly start: number;
  /** Bumps when a tile changes (wire cut): the view redraws the fences. Not state. */
  tilesRev = 0;
  private readonly feet = { blocked: (x: number, z: number) => x < 0 || z < 0 || x >= MAP_W || z >= MAP_H || this.grid[z * MAP_W + x] === 1 };
  private readonly npcFeet = { blocked: (x: number, z: number) => x < 0 || z < 0 || x >= MAP_W || z >= MAP_H || this.npcGrid[z * MAP_W + x] === 1 };
  private readonly heard = new Int32Array(MAP_W * MAP_H);
  /** The searchers' and roadblocks' timings in steps after the alarm (-1: never, a lesson's). */
  private readonly outAt: number[];
  private readonly blockAt: number[];
  private readonly heliAt: number;

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
    const searchers: Searcher[] = [];
    const dogs: HuntDog[] = [];
    this.outAt = [];
    def.searchers.forEach((d, k) => {
      const b0 = d.beat[0];
      const body = bodyAt(b0.x + ox, b0.z + oz, b0.face ?? 5);
      const dog = d.dog ? dogs.length : -1;
      searchers.push(fresh(body, dog));
      if (d.dog) dogs.push({ body: bodyAt(b0.x + ox, b0.z + oz, b0.face ?? 5), mode: HOUND.HEEL, handler: k, until: 0, trail: 0, rest: 0, path: [], goal: -1, best: FOREVER, stuck: 0 });
      // (Never: a lesson leaves it out; at once: a patrol out before any alarm.)
      this.outAt.push(opts.searchers && !opts.searchers.includes(k) ? Infinity : d.at < 0 ? -Infinity : d.at * S);
    });
    this.blockAt = def.roadblocks.map((r) => (opts.roadblocks === false ? Infinity : r.at * S));
    def.roadblocks.forEach((r, k) => {
      searchers.push(fresh(bodyAt(r.post.x + ox, r.post.z + oz, r.post.face ?? 5), -1));
      this.outAt.push(this.blockAt[k]);
    });
    this.heliAt = opts.heli === false ? Infinity : def.heli.at * S;
    const h0 = def.heli.route[0];
    const clothes = carry.outfit === GUARD_OUTFIT ? 1 : carry.outfit === OWN_CLOTHES ? 2 : 0;
    this.state = {
      step: 0,
      salt: carry.salt | 0,
      player: bodyAt(at.x + ox, at.z + oz, at.face ?? 13),
      still: 0,
      hidden: false,
      clothes,
      trail: [],
      searchers,
      dogs,
      heli: { on: false, x: (h0.x + ox) * UNIT + UNIT / 2, z: (h0.z + oz) * UNIT + UNIT / 2, k: 1 % def.heli.route.length, hold: 0, lit: false },
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
    };
    this.refreshGrid();
    this.toGoal = this.distances();
    this.state.best = this.toGoal[this.start];
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

  /** How far a searcher's eyes reach now (tiles). */
  get sight(): number {
    return this.night ? HUNT.sightNight : HUNT.sightDay;
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
    this.timeline();
    this.playerMoves(cmd);
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
    s.searchers.forEach((m, k) => {
      if (m.mode !== SEEK.OFF || age < this.outAt[k]) return;
      // (A roadblock's officer comes with his barrier: below.)
      if (k >= this.def.searchers.length) return;
      this.deploy(k);
    });
    this.def.roadblocks.forEach((r, k) => {
      if (s.blocks & (1 << k) || age < this.blockAt[k]) return;
      // (Never shut on the player: it waits for them to be clear of it.)
      const t = this.tile;
      const [x0, z0, x1, z1] = r.area;
      const px = (t % MAP_W) - this.out.ox;
      const pz = Math.floor(t / MAP_W) - this.out.oz;
      if (px >= x0 - 1 && px <= x1 + 1 && pz >= z0 - 1 && pz <= z1 + 1) return;
      s.blocks |= 1 << k;
      this.refreshGrid();
      this.deploy(this.def.searchers.length + k);
      this.events.push({ type: 'roadblock', k });
    });
    if (!s.heli.on && age >= this.heliAt) {
      s.heli.on = true;
      this.events.push({ type: 'heli' });
    }
  }

  private deploy(k: number) {
    const m = this.state.searchers[k];
    m.mode = SEEK.BEAT;
    m.k = this.beatOf(k).length > 1 ? 1 : 0;
    m.goal = -1;
    this.events.push({ type: 'out', who: k });
  }

  /** A searcher's beat (a roadblock's officer: his post). */
  private beatOf(k: number) {
    const n = this.def.searchers.length;
    return k < n ? this.def.searchers[k].beat : [this.def.roadblocks[k - n].post];
  }

  /** Feet stopped by: the map (trees, water but fords, walls, wire not yet cut), roadblocks up; searchers keep out of cover and the player's cut wire too. */
  private refreshGrid() {
    const s = this.state;
    const o = this.out;
    const w = this.world;
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      this.grid[i] = w.block[i] && !o.ford[i] ? 1 : 0;
    }
    this.def.roadblocks.forEach((r, k) => {
      if (s.blocks & (1 << k)) fillArea(this.grid, r.area, o.ox, o.oz);
    });
    for (let i = 0; i < MAP_W * MAP_H; i++) this.npcGrid[i] = this.grid[i] || o.cover[i] ? 1 : 0;
    for (const t of s.cut) this.npcGrid[t] = 1;
  }

  /** Walking tiles to the nearest way to safety from every tile (the map as built). */
  private distances(): Int32Array {
    const d = new Int32Array(MAP_W * MAP_H).fill(-1);
    const queue: number[] = [];
    const o = this.out;
    for (let i = 0; i < MAP_W * MAP_H; i++) if (o.safe[i]) (d[i] = 0), queue.push(i);
    if (this.carry.lou) {
      const t = spotTile(this.def.lou, o.ox, o.oz);
      if (d[t] !== 0) (d[t] = 0), queue.push(t);
    }
    // (Wire counts as passable: cutters make it so; a way round it is shorter anyway where there is one.)
    const open = (i: number) => !this.grid[i] || o.wire[i];
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
    return d;
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
      // The trail (none in a ford: the water takes it).
      if (!o.ford[t]) {
        s.trail.push([t, s.step]);
        if (s.trail.length > HUNT.trailTiles) s.trail.shift();
      }
      // Gravel and ballast underfoot.
      if (o.noisy[t] && !s.noises.some(([, at, r]) => r === HUNT.crunch && s.step - at < CRUNCH_EVERY)) {
        s.feats[HFEAT.crunches]++;
        this.noise(t, HUNT.crunch, 'crunch');
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

  /** A pace on a tile: less off the roads (grass, snow, sand), in cover, in a ford. */
  terrain(tile: number, pace: number): number {
    const o = this.out;
    const share = o.ford[tile] ? HUNT.fordPace : o.cover[tile] ? HUNT.coverPace : this.world.ground.kind[tile] === TILE.GRASS ? HUNT.roughPace : 100;
    return Math.floor((pace * share) / 100);
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
      this.events.push({ type: 'cut', tile: wire, done: false });
      return;
    }
    this.events.push({ type: 'refused', why: 'nothing' });
  }

  /** A washing line within reach not yet used (its index), -1 none. */
  lineNear(): number {
    const s = this.state;
    const o = this.out;
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
    if (tile < 0 || tile >= MAP_W * MAP_H || this.grid[tile] || cheb(tile, this.tile) > HUNT.stoneRange || !lineOfSight(this.world, s.player.x, s.player.z, centerX(tile), centerZ(tile))) {
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
  private noise(tile: number, reach: number, kind: 'crunch' | 'stone' | 'cut' | 'bark') {
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
      if (m.mode === SEEK.OFF || m.mode === SEEK.CHASE || this.isPost(k)) return;
      if (d[tileAt(m.body.x, m.body.z)] < 0) return;
      this.lookAt(k, tile);
      this.events.push({ type: 'heard', who: k, tile });
    });
  }

  private isPost(k: number) {
    return k >= this.def.searchers.length;
  }

  // ---------------------------------------------------------------- the searchers
  private lookAt(k: number, tile: number) {
    const m = this.state.searchers[k];
    m.mode = SEEK.LOOK;
    m.goal = tile;
    m.path = [];
    m.wait = HUNT.look;
    m.best = FOREVER;
    m.stuck = 0;
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
    if (!chasing) s.feats[HFEAT.spotted]++;
    this.events.push({ type: 'spotted', who: k });
    this.radio(k);
  }

  /** The others hear where the player is (none already after them, no officer leaves his roadblock). */
  private radio(from: number) {
    const s = this.state;
    const t = this.tile;
    s.searchers.forEach((o, j) => {
      if (j === from || o.mode === SEEK.OFF || o.mode === SEEK.CHASE || this.isPost(j)) return;
      if (o.mode === SEEK.FOLLOW && o.dog >= 0 && s.dogs[o.dog].mode === HOUND.TRACK) return;
      this.lookAt(j, t);
    });
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
      const sees = !s.hidden && canSee(this.world, m.body, p, range * UNIT);
      m.sees = sees;
      if (sees) {
        if (m.mode === SEEK.CHASE) {
          m.unseen = 0;
          m.last = t;
        } else if (within(m.body, p, known)) {
          // (Moving through cover, a third of the pace.)
          if (!(inCover && moving && s.step % 3 !== 0)) m.notice += within(m.body, p, HUNT.near) ? 3 : 1;
          if (m.notice >= HUNT.spot) this.spot(k);
        }
      } else if (m.notice > 0) m.notice--;
      this.searcherMoves(k);
      if (s.over) return;
      // Caught: a chaser at arm's length of a player in the open.
      if (m.mode === SEEK.CHASE && !s.hidden && within(m.body, p, HUNT.catch)) return this.caught(k);
      // Found: a handler whose dog has them, hidden or not.
      if (m.dog >= 0 && s.dogs[m.dog].mode === HOUND.POINT && within(m.body, p, HUNT.found)) return this.caught(k);
    }
  }

  private searcherMoves(k: number) {
    const s = this.state;
    const m = s.searchers[k];
    const beat = this.beatOf(k);
    const { ox, oz } = this.out;
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
        if (m.goal !== target && (s.step % HUNT.replan === 0 || !m.path.length)) this.route(m, target);
        this.follow(m, HUNT.chase);
        return;
      }
      case SEEK.LOOK: {
        if (m.goal >= 0 && !this.arrived(m)) {
          this.follow(m, HUNT.hurry);
          return;
        }
        m.body.moving = false;
        // A look round: turning this way and that.
        if (m.wait % TURN_STEPS === 0) m.body.facing = 1 + rollInt(s.salt, SALT.HUNT, s.step, k, 16);
        if (--m.wait <= 0) this.backToBeat(k);
        return;
      }
      case SEEK.FOLLOW: {
        const d = s.dogs[m.dog];
        if (!d || (d.mode !== HOUND.TRACK && d.mode !== HOUND.POINT)) return this.backToBeat(k);
        const target = tileAt(d.body.x, d.body.z);
        if (cheb(target, tileAt(m.body.x, m.body.z)) <= 1) {
          m.body.moving = false;
          m.body.facing = nearestDir(d.body.x - m.body.x, d.body.z - m.body.z) || m.body.facing;
          return;
        }
        if (m.goal !== target && (s.step % HUNT.replan === 0 || !m.path.length)) this.route(m, target);
        this.follow(m, HUNT.hurry);
        return;
      }
      case SEEK.BEAT: {
        // A handler whose dog has a trail follows it.
        if (m.dog >= 0 && s.dogs[m.dog].mode === HOUND.TRACK) {
          m.mode = SEEK.FOLLOW;
          m.path = [];
          m.goal = -1;
          return;
        }
        const stop = beat[m.k];
        const goal = spotTile(stop, ox, oz);
        if (m.goal !== goal) {
          this.route(m, goal);
          m.wait = beat.length > 1 ? STOP_STEPS : FOREVER;
        }
        if (!this.arrived(m)) {
          this.follow(m, HUNT.walk);
          return;
        }
        m.body.moving = false;
        if (stop.face) m.body.facing = stop.face;
        if (--m.wait <= 0) m.k = (m.k + 1) % beat.length;
      }
    }
  }

  /** At its goal (in the tile, or next to it when the goal is somewhere it can't stand: cover, a hedge the player hid in). */
  private arrived(m: { body: Body; goal: number; path: number[] }): boolean {
    if (m.goal < 0) return true;
    const here = tileAt(m.body.x, m.body.z);
    if (here === m.goal) return Math.abs(m.body.x - centerX(m.goal)) + Math.abs(m.body.z - centerZ(m.goal)) < REACHED * 2 || !m.path.length;
    return !m.path.length && cheb(here, m.goal) <= 1;
  }

  /** The way to a tile (next to it, if it's somewhere a searcher can't stand). */
  private route(w: { body: Body; goal: number; path: number[]; best: number; stuck: number }, goal: number) {
    w.goal = goal;
    w.best = FOREVER;
    w.stuck = 0;
    const from = tileAt(w.body.x, w.body.z);
    const open = !this.npcGrid[goal];
    const p = findPath(this.world, from, open ? (i) => i === goal : (i) => cheb(i, goal) <= 1, goal, MAP_W * MAP_H, undefined, this.npcGrid);
    w.path = p ?? [];
  }

  /** A step along the way at a pace (a new way looked for when stuck against something). */
  private follow(w: { body: Body; goal: number; path: number[]; best: number; stuck: number }, speed: number, rough = true) {
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
        this.route(w, w.goal);
        return;
      }
      walk(this.npcFeet, b, nearestDir(dx, dz), rough ? this.terrain(tileAt(b.x, b.z), speed) : speed, LAYER.GROUND);
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
          if ((s.step - d.until + POINT_HOLD) % BARK_EVERY === 0) this.noise(tileAt(d.body.x, d.body.z), HUNT.bark, 'bark');
          if (s.step < d.until) return;
          if (within(d.body, s.player, HUNT.point)) d.until = s.step + POINT_HOLD;
          else this.nextScent(d, k);
          return;
        }
        case HOUND.TRACK: {
          if (within(d.body, s.player, HUNT.point) && lineOfSight(this.world, d.body.x, d.body.z, s.player.x, s.player.z)) return this.point(d, k);
          if (this.arrived(d)) this.nextScent(d, k);
          else this.follow(d, HUNT.dogTrack, false);
          return;
        }
        default: {
          // At the heel; a fresh trail close by puts it on it.
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
    if (within(d.body, s.player, HUNT.point)) return this.point(d, k);
    this.dogLost(d);
  }

  private point(d: HuntDog, k: number) {
    const s = this.state;
    d.mode = HOUND.POINT;
    d.until = s.step + POINT_HOLD;
    d.path = [];
    this.events.push({ type: 'point', dog: k });
    this.noise(tileAt(d.body.x, d.body.z), HUNT.bark, 'bark');
    const h = s.searchers[d.handler];
    if (h.mode !== SEEK.CHASE) {
      h.mode = SEEK.FOLLOW;
      h.path = [];
      h.goal = -1;
    }
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
    if (h.hold > 0) {
      tx = s.player.x;
      tz = s.player.z;
      pace = HUNT.heliChase;
      h.hold--;
    } else {
      const stop = route[h.k];
      tx = (stop.x + ox) * UNIT + UNIT / 2;
      tz = (stop.z + oz) * UNIT + UNIT / 2;
      pace = HUNT.heliSpeed;
    }
    const dx = tx - h.x;
    const dz = tz - h.z;
    const d = Math.hypot(dx, dz);
    if (d <= pace) {
      h.x = tx;
      h.z = tz;
      if (h.hold <= 0) h.k = (h.k + 1) % route.length;
    } else {
      h.x += Math.trunc((dx * pace) / d);
      h.z += Math.trunc((dz * pace) / d);
    }
    const lit = !s.hidden && within(h, s.player, HUNT.heliLight);
    if (lit) {
      h.hold = HUNT.heliHold;
      if (!h.lit || s.step % HELI_CALL === 0) {
        // The light on them: every searcher out comes running (a chaser keeps on).
        const t = this.tile;
        s.searchers.forEach((m, j) => {
          if (m.mode === SEEK.OFF || m.mode === SEEK.CHASE || this.isPost(j)) return;
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

/** What a tile is, for the frame's footsteps and the view (re-exported for the play layer). */
export { DECO };
