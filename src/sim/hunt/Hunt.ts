import { HUNT } from '../../content/manhunt';
import { itemDef, itemNumber } from '../../content/items';
import type { OutsideDef, Spot } from '../../content/outside/types';
import type { PrisonDef } from '../../content/prisons/types';
import { blockedIn, centerX, centerZ, chebTiles, neighbours4, tileAt } from '../world/grid';
import { lineOfSight } from '../ai/sight';
import { argA, argB, argC, DIR_X, DIR_Z, dirOf, EXT, OP, opOf, sideX, sideZ, tossTile } from '../command';
import { fnv1a, rollInt, SALT } from '../rng';
import { bodyAt, walk, type Body } from '../systems/movement';
import { UNIT, walkSpeed } from '../tuning';
import { TILE } from '../world/tiles';
import { LAYER, MAP_H, MAP_W, type World } from '../world/World';
import {
  HFEAT,
  HOUND,
  HUNT_FEATS,
  OVER,
  SEEK,
  type Carry,
  type HuntDog,
  type HuntEvent,
  type HuntOptions,
  type HuntState,
  type Searcher,
} from './state';
import { dist2, DRAW, FOREVER, N, S, within } from './common';
import { dogLost, dogsSniff } from './dogs';
import { heliSweeps } from './heli';
import { backToBeat, lookAt, searchersLook } from './searchers';
import { fillArea, goalDistances, outsideWorld, spotTile, sweepPoints, type OutsideWorld } from './world';

export * from './state';
export type { Walker } from './common';

const GUARD_OUTFIT = itemNumber('guard_outfit');
const OWN_CLOTHES = itemNumber('own_clothes');
const TREATS = [itemNumber('jerky'), itemNumber('pepper'), itemNumber('sleepy_jerky')];
/** Crunching gravel is heard at most this often (steps). */
const CRUNCH_EVERY = 10;
/** A washing line: this close (tiles) to take clothes off it. */
const LINE_REACH = 1.5;

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
  /** The same for the player as they are: wire passable only with cutters (the HUD's distance, how close they got). */
  readonly toSafe: Int32Array;
  /** Where the player came out (a tile). */
  readonly start: number;
  /** The places the search sweeps (tiles: open ground beside cover, every cover tile within a dog's nose of one; and a place every few tiles across the open). Not state. */
  readonly sweepPts: number[];
  /** Bumps when a tile changes (wire cut): the view redraws the fences. Not state. */
  tilesRev = 0;
  private readonly feet = { blocked: blockedIn(this.grid) };
  /** The searchers' and dogs' feet (walkers.ts). */
  readonly npcFeet = { blocked: blockedIn(this.chaseGrid) };
  private readonly heard = new Int32Array(N);
  /** The searchers' and roadblocks' timings in steps after the alarm (Infinity: never, a lesson's; -Infinity: a patrol, out at once). */
  private readonly outAt: number[];
  private readonly blockAt: number[];
  private readonly heliAt: number;
  /** Each searcher's first stop: on its beat (a patrol starts there), or the one it heads for once on. */
  private readonly firstStop: number[];
  /** The step after the alarm the search starts widening (Infinity: never). */
  readonly rampAt: number;

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
      if (d.dog)
        dogs.push({
          body: bodyAt(b0.x + ox, b0.z + oz, b0.face ?? 5),
          mode: HOUND.HEEL,
          handler: k,
          until: 0,
          trail: 0,
          rest: 0,
          path: [],
          goal: -1,
          best: FOREVER,
          stuck: 0,
        });
      // (Never: a lesson leaves it out; at once: a patrol out before any alarm.)
      const t = d.at < 0 ? -1 : times[late.indexOf(k)];
      this.outAt.push(
        opts.searchers && !opts.searchers.includes(k) ? Infinity : t < 0 ? -Infinity : Math.max(0, t + shift(DRAW.TIME, k)) * S,
      );
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
      heli: {
        on: false,
        x: (h0.x + ox) * UNIT + UNIT / 2,
        z: (h0.z + oz) * UNIT + UNIT / 2,
        k: 1 % def.heli.route.length,
        hold: 0,
        lit: false,
        aim: -1,
      },
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
      sniffed: [],
    };
    this.refreshGrid();
    const lou = this.carry.lou ? spotTile(this.def.lou, this.out.ox, this.out.oz) : -1;
    this.toGoal = goalDistances(this.out, this.grid, lou, true);
    this.toSafe = this.state.cutters ? this.toGoal : goalDistances(this.out, this.grid, lou, false);
    this.state.best = this.walkTo(this.start);
    this.sweepPts = sweepPoints(this.out, this.npcGrid, this.start);
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
    const s = this.state;
    // (In the helicopter's light nothing fools them; a guard's uniform only till the search has widened HUNT.uniformHeat times: by then the radio says one's gone missing.)
    if (s.heli.lit) return this.sight;
    const c = s.clothes;
    // (Clothes off a line, the same: once the search has widened a time more, they have a description of them too.)
    return c === 1 && s.heat < HUNT.uniformHeat ? HUNT.uniform : c === 2 && s.heat <= HUNT.uniformHeat ? HUNT.disguised : this.sight;
  }

  /** How close they got: the share of the way to safety walked (0–1). */
  get progress(): number {
    const from = this.walkTo(this.start);
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
    if (!s.over) searchersLook(this);
    if (!s.over) dogsSniff(this);
    if (!s.over) heliSweeps(this);
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
      // (Nor on a searcher or a dog on its tiles: it waits for them to be by.)
      const on = (b: { x: number; z: number }) => {
        const bt = tileAt(b.x, b.z);
        const bx = (bt % MAP_W) - this.out.ox;
        const bz = Math.floor(bt / MAP_W) - this.out.oz;
        return bx >= x0 && bx <= x1 && bz >= z0 && bz <= z1;
      };
      if (
        s.searchers.some((m) => m.mode !== SEEK.OFF && on(m.body)) ||
        s.dogs.some((d) => s.searchers[d.handler].mode !== SEEK.OFF && on(d.body))
      )
        return;
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
    const spots: Array<[Spot, number]> = !d
      ? [[beat[0], 0]]
      : d.at < 0
        ? beat.map((_, j) => [beat[(this.firstStop[k] + j) % beat.length], (this.firstStop[k] + j + 1) % beat.length])
        : [[d.from ?? beat[0], this.firstStop[k]]];
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
  beatOf(k: number): readonly Spot[] {
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

  /** Walking tiles to safety from a tile for the player (through wire only with cutters; where that's no way at all, as the search reckons it). */
  walkTo(t: number): number {
    const d = this.toSafe[t];
    return d >= 0 ? d : this.toGoal[t];
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
    const was = { x: p.x, z: p.z };
    walk(this.feet, p, dir, this.paceAt(from), LAYER.GROUND);
    // Head-on into a tree, a rock, a corner: round it, along whichever way is open (an eighth turn either side), rather than stuck.
    if (dir !== 0 && p.x === was.x && p.z === was.z) {
      for (const turn of [2, -2]) {
        const d = ((dir - 1 + turn + 16) % 16) + 1;
        walk(this.feet, p, d, this.paceAt(from), LAYER.GROUND);
        if (p.x !== was.x || p.z !== was.z) break;
      }
      p.facing = dir;
    }
    const t = this.tile;
    if (t !== s.at) {
      s.at = t;
      if (o.ford[t]) {
        // A ford: the water takes the trail, and a dog on it loses it there (as at a washing line).
        if (s.trail.length) {
          s.trail = [];
          for (const d of s.dogs) if (d.mode === HOUND.TRACK) dogLost(this, d);
        }
      } else {
        s.trail.push([t, s.step]);
        if (s.trail.length > HUNT.trailTiles) s.trail.shift();
      }
      // Gravel and ballast underfoot.
      if (o.noisy[t] && !s.noises.some(([, at, r]) => r === HUNT.crunch && s.step - at < CRUNCH_EVERY)) {
        s.feats[HFEAT.crunches]++;
        // (Only a crunch someone heard tells the search where they are.)
        if (this.noise(t, HUNT.crunch, 'crunch')) this.know(t);
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
    const share = o.ford[tile]
      ? HUNT.fordPace
      : o.cover[tile]
        ? HUNT.coverPace
        : this.world.ground.kind[tile] === TILE.GRASS
          ? HUNT.roughPace
          : 100;
    return Math.floor((pace * share * HUNT.pace) / 10000);
  }

  /** The action button: clothes off a washing line close by, else a cut at the wire ahead. */
  private act() {
    const s = this.state;
    const line = this.lineNear();
    if (line >= 0) {
      // (Out of a guard's uniform: the eyes know them a little further off, but the dogs lose the trail all the same.)
      const uniform = s.clothes === 1;
      s.lines |= 1 << line;
      s.clothes = 2;
      s.feats[HFEAT.swaps]++;
      // New clothes, a new scent: the trail so far is no use to a dog.
      s.trail = [];
      for (const d of s.dogs) if (d.mode === HOUND.TRACK || d.mode === HOUND.POINT) dogLost(this, d);
      this.events.push({ type: 'swap', uniform });
      return;
    }
    const wire = this.wireAhead();
    if (wire >= 0) {
      if (!s.cutters) return void this.events.push({ type: 'refused', why: 'noCutters' });
      s.cutting = [wire, 0];
      if (this.noise(wire, HUNT.cutNoise, 'cut')) this.know(this.tile);
      this.events.push({ type: 'cut', tile: wire, done: false });
      return;
    }
    this.events.push({ type: 'refused', why: 'nothing' });
  }

  /** A washing line within reach not yet used (its index), -1 none. */
  lineNear(): number {
    const s = this.state;
    const o = this.out;
    return this.def.lines.findIndex(
      (l, k) =>
        !(s.lines & (1 << k)) && within(s.player, { x: (l.x + o.ox) * UNIT + UNIT / 2, z: (l.z + o.oz) * UNIT + UNIT / 2 }, LINE_REACH),
    );
  }

  /** The wire fence tile the player faces, next to them (-1 none). */
  wireAhead(): number {
    const s = this.state;
    const p = s.player;
    // The nearest of the four ways round the way they face.
    const dx = sideX(p.facing);
    const dz = sideZ(p.facing);
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
    if (
      tile < 0 ||
      tile >= N ||
      !this.out.inside[tile] ||
      this.grid[tile] ||
      chebTiles(tile, this.tile) > HUNT.stoneRange ||
      !lineOfSight(this.world, s.player.x, s.player.z, centerX(tile), centerZ(tile))
    ) {
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
    // (Not a dog whose handler isn't out yet: it's nowhere to be seen.)
    if (
      d.mode === HOUND.ASLEEP ||
      s.searchers[d.handler].mode === SEEK.OFF ||
      !within(d.body, s.player, HUNT.treatRange) ||
      !lineOfSight(this.world, s.player.x, s.player.z, d.body.x, d.body.z)
    )
      return void this.events.push({ type: 'refused', why: 'dogFar' });
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
    if (h.mode === SEEK.FOLLOW) backToBeat(this, d.handler);
    this.events.push({ type: 'treat', dog: k, what });
  }

  // ---------------------------------------------------------------- noise
  /** A noise: every searcher out within `reach` walking tiles of it goes to look (not one already after the player, nor an officer at his roadblock). Whether anyone heard it. */
  noise(tile: number, reach: number, kind: 'crunch' | 'stone' | 'cut' | 'bark', by = -1): boolean {
    let heard = false;
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
      for (const [j, ok] of neighbours4(t))
        if (ok && d[j] < 0 && (!this.grid[j] || this.out.cover[j])) {
          d[j] = d[t] + 1;
          queue.push(j);
        }
    }
    s.searchers.forEach((m, k) => {
      // (A bark: not its own handler, who goes to his dog anyway.)
      if (m.mode === SEEK.OFF || m.mode === SEEK.CHASE || m.mode === SEEK.FOLLOW || this.isPost(k) || k === by) return;
      if (d[tileAt(m.body.x, m.body.z)] < 0) return;
      lookAt(this, k, tile);
      this.events.push({ type: 'heard', who: k, tile });
      heard = true;
    });
    return heard;
  }

  isPost(k: number) {
    return k >= this.def.searchers.length;
  }

  // ---------------------------------------------------------------- the searchers

  /** Where the player is known to be now (seen, lit, heard, found). */
  know(t: number) {
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

  // ---------------------------------------------------------------- the dogs

  // ---------------------------------------------------------------- the helicopter

  // ---------------------------------------------------------------- the lookout, the end
  /** Where a crew member out too keeps watch (units). */
  private watch: { x: number; z: number } | null = null;
  private get lookoutAt(): { x: number; z: number } {
    if (!this.watch) {
      const t = spotTile(this.def.lookout, this.out.ox, this.out.oz);
      this.watch = { x: centerX(t), z: centerZ(t) };
    }
    return this.watch;
  }

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
      // (Only one the lookout sees from their rise: within sight of it, nothing in the way.)
      if (
        !within(m.body, this.lookoutAt, HUNT.lookoutSight) ||
        !lineOfSight(this.world, this.lookoutAt.x, this.lookoutAt.z, m.body.x, m.body.z)
      )
        return;
      s.warned |= bit;
      s.feats[HFEAT.whistles]++;
      this.events.push({ type: 'whistle', who: k });
    });
  }

  private outcome() {
    const s = this.state;
    const t = this.tile;
    const d = this.walkTo(t);
    if (d >= 0 && d < s.best) s.best = d;
    const o = this.out;
    const lou =
      this.carry.lou &&
      within(s.player, { x: (this.def.lou.x + o.ox) * UNIT + UNIT / 2, z: (this.def.lou.z + o.oz) * UNIT + UNIT / 2 }, HUNT.car);
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
  return {
    body,
    mode: SEEK.OFF,
    k: 0,
    wait: 0,
    goal: -1,
    path: [],
    best: FOREVER,
    stuck: 0,
    notice: 0,
    unseen: 0,
    last: -1,
    sees: false,
    dog,
  };
}
