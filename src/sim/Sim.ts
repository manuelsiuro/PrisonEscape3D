import { itemDef, itemNumber } from '../content/items';
import type { PrisonDef } from '../content/prisons/types';
import { ROUTINE, routineAt } from '../content/routine';
import { RESTRICTED, zoneIndex } from '../content/zones';
import { argA, argB, dirOf, OP, opOf, SLOT } from './command';
import { findPath, nearestDir } from './ai/path';
import { placesOf } from './ai/places';
import { canSee } from './ai/sight';
import { craft, dropItem, equip, give, HOTBAR, interactTarget, itemOf, moveItem, pickUp, restock, slot, startItems, stillInReach, usesOf, type ItemEvent, type ItemState } from './systems/items';
import { besideOnGround, cavesIn, climbTarget, DIRT, ladderFootOf, STRIKES, toolTarget, underMyDesk, WALL_CHUNK, type ClimbAction, type ClimbTarget, type ToolAction, type ToolTarget } from './systems/structure';
import { fnv1a, randomInt } from './rng';
import { clockAt, hourStarts, type Clock } from './systems/clock';
import { assign, awake, backToDuty, cancelTasks, CATCH_RANGE, GUARD, spawnGuards, startChase, stepGuards, type Guard, type GuardReport } from './systems/guards';
import { LOCKDOWN_PLAN, spawnInmates, stepInmates, type Inmate } from './systems/inmates';
import { bodyAt, tileOfBody, walk, type Body } from './systems/movement';
import {
  BODY_HALF,
  CAVE_IN_ENERGY,
  CHASE_HEAT,
  CHOCOLATE_ENERGY,
  CRAWL_SPEED,
  ENERGY_REGEN_STEPS,
  MEAL_ENERGY,
  SHOWER_ENERGY,
  STRIKE_SEEN_STEPS,
  STRIKE_STEPS,
  TOILET_CLOG_STEPS,
  TOILET_LOADS,
  TUNNEL_SPEED,
  WALK_SPEED,
  CONTRABAND_HEAT,
  HEAT_DECAY_STEPS,
  KO_STEPS,
  LIGHTS_OUT_GRACE,
  MISSED_ROUTINE_HEAT,
  PEEL_STEPS,
  POTATO_PRESSES,
  POTATO_STEPS,
  RECOGNIZE_RANGE,
  RECOGNIZE_STEPS,
  SOLITARY_HEAT,
  SOLITARY_STEPS,
  STEPS_PER_MINUTE,
  UNIT,
} from './tuning';
import { LAYER, layerOfKey, MAP_H, MAP_W, placeKey, tileOfKey, World } from './world/World';
import { DAMAGE_SHOWS, TILE, TILE_INFO } from './world/tiles';
import { containersOf } from './world/containers';

/** Why guards took notice of the player (GDD §5.2). Stored as numbers: never renumber. */
export const SPOT = ['none', 'night', 'restricted', 'contraband', 'recognized', 'wanted', 'bedCheck', 'damage', 'tampering'] as const;
export type SpotReason = (typeof SPOT)[number];
/** Where a knocked-out player wakes up. */
export const WAKE = { NONE: 0, SOLITARY: 1, INFIRMARY: 2 } as const;

/** Something that happened during a step; sound, effects and the HUD read these. */
export type SimEvent =
  | { type: 'hour'; hour: number }
  /** A new routine block began (index into ROUTINE). */
  | { type: 'routine'; routine: number }
  /** The player checked in to the block. */
  | { type: 'attended'; routine: number }
  /** The block ended without the player: what it cost. */
  | { type: 'missed'; routine: number; heat: number }
  | { type: 'lockdown'; on: boolean }
  /** The player's cell door locked or unlocked (Lights Out, a lockdown, 08:00). */
  | { type: 'cells'; locked: boolean }
  | { type: 'sleep'; on: boolean }
  /** A guard noticed something (the first step of it): a heat jump or a chase. */
  | { type: 'spotted'; reason: SpotReason }
  /** A chasing guard caught the player: knocked out, then solitary or the infirmary. */
  | { type: 'caught'; solitary: boolean }
  /** Into solitary (with how many contraband items were taken) and out again. */
  | { type: 'solitary'; on: boolean; taken: number }
  | { type: 'infirmary'; taken: number }
  /** A press on the potato; `done` when a whole potato is peeled (10 minutes off). */
  | { type: 'peel'; done: boolean }
  /** 08:00: the cells to be searched this morning; a guard has searched one. */
  | { type: 'shakedown'; cells: number[] }
  | { type: 'searched'; cell: number; taken: number }
  /** The night bed check begins, and how it went at the player's cell. */
  | { type: 'bedCheck'; result: 'start' | 'pass' | 'fail' }
  /** A tool strike landed (`broke`: the tile gave way), or why it couldn't. */
  | { type: 'strike'; action: ToolAction; layer: number; tile: number; broke: boolean }
  | { type: 'cantStrike'; why: 'tool' | 'reinforced' | 'tired' | 'poster'; action: ToolAction }
  /** A tool wore out. */
  | { type: 'broke'; item: number }
  /** A live electric fence: knocked out (GDD §9.1). */
  | { type: 'shocked' }
  /** A tunnel roof came down on the player (GDD §9.2). */
  | { type: 'caveIn'; tile: number }
  /** Onto another layer (through a grate, up the ladder, into a tunnel…). */
  | { type: 'layer'; layer: number; from: number; how: ClimbAction | 'digUp' | 'rope' }
  /** A cover put over damage or taken off it; a brace set up; chocolate eaten. */
  | { type: 'covered'; item: number; on: boolean }
  | { type: 'braced' }
  | { type: 'ate'; item: number }
  /** Dirt down a toilet; a toilet that takes no more for now. */
  | { type: 'flushed'; item: number }
  | { type: 'clogged' }
  /** Guards found damage or evidence (and repaired what they found, after a capture). */
  | { type: 'found'; kind: number }
  | { type: 'repaired'; n: number }
  /** Out on the road: free (GDD §4.0). */
  | { type: 'escaped' }
  | ItemEvent;

/**
 * Everything that changes, as plain data (the world's tiles are kept in World and saved
 * with it). New fields go at the end and must be optional when loading old snapshots.
 */
export interface SimState {
  step: number;
  /** mulberry32 state (rng.ts). */
  rng: number;
  player: Body;
  /** Guard heat, 0–100 (GDD §3.1). */
  heat: number;
  /** The routine block running (index into ROUTINE). */
  routine: number;
  /** The player has checked in to the block. */
  attended: boolean;
  lockdown: boolean;
  inmates: Inmate[];
  /** A lockdown ran during this block: missing it costs nothing. */
  excused: boolean;
  /** What the player carries, every container's contents, the floor, the handbook. */
  items: ItemState;
  /** Asleep in bed (Lights Out): time can run fast, any move wakes the player. */
  sleeping: boolean;
  guards: Guard[];
  /** A guard saw the player at the end of this step. */
  seen: boolean;
  /** Steps left knocked out, and where the player wakes (WAKE). */
  ko: number;
  wake: number;
  /** Steps left in solitary (0: not there), and presses on the potato being peeled. */
  solitary: number;
  peeled: number;
  /** What guards are noticing right now (SPOT index): an event fires when it changes. */
  spotted: number;
  /** Steps a disguised player has spent close to a guard. */
  near: number;
  /** The step of the last stroke of the peeler (presses come at most every PEEL_STEPS). */
  peelAt: number;
  /** The layer the player is on (World LAYER): tunnels, ground, vents, roof. */
  layer: number;
  /** 0–100: tools spend it, sleep, meals, showers and chocolate give it back (GDD §3.1). */
  energy: number;
  /** Tiles changed from the map (World placeKey → tile kind): dug, chipped, cut, covered, braced. */
  tiles: Record<number, number>;
  /** Hit points struck off tiles that haven't given way yet (placeKey → damage). */
  wear: Record<number, number>;
  /** Toilets that took dirt (container index → [loads, the step the count began]). */
  toilets: Record<number, [number, number]>;
  /** Damage guards have found (placeKeys): put right when they catch the player. */
  found: number[];
  /** The step of the last strike that landed (a guard who sees it sees tampering). */
  struckAt: number;
  /** The step the player reached the road (0 while still inside). */
  escaped: number;
}

export interface Snapshot {
  v: 1;
  prison: string;
  state: SimState;
}

/**
 * The game's rules: `step(cmd)` advances one fixed step (1/20 s). The state depends only
 * on the prison, the seed and the commands, never on frame time, the DOM or Three.js, so
 * the tests replay it headless. Systems run in a fixed order (docs/PLAN.md §3):
 * clock → routine (restock, shakedown, bed checks) → inmates → guards → player →
 * solitary → what guards see (heat, chases, capture) → attendance → heat decay → doors.
 */
export class Sim {
  readonly world: World;
  state: SimState;
  /** What happened during the last step. */
  events: SimEvent[] = [];
  private readonly forInmates: Body[] = [];
  private readonly inmateBodies: Body[] = [];
  private readonly onReport = (r: GuardReport) => this.report(r);

  constructor(
    readonly prison: PrisonDef,
    seed = 1,
  ) {
    this.world = new World(prison);
    const s = { rng: seed | 0 };
    const inmates = spawnInmates(this.world, s);
    const items = startItems(this.world, s);
    this.state = {
      step: 0,
      rng: s.rng,
      player: bodyAt(prison.spawn.x, prison.spawn.z),
      heat: 0,
      routine: routineAt(clockAt(0).minuteOfDay),
      attended: false,
      lockdown: false,
      inmates,
      excused: false,
      items,
      sleeping: false,
      guards: spawnGuards(this.world),
      seen: false,
      ko: 0,
      wake: WAKE.NONE,
      solitary: 0,
      peeled: 0,
      spotted: 0,
      near: 0,
      peelAt: 0,
      layer: LAYER.GROUND,
      energy: 100,
      tiles: {},
      wear: {},
      toilets: {},
      found: [],
      struckAt: -STRIKE_STEPS,
      escaped: 0,
    };
    this.ladderFoot = ladderFootOf(this.world);
    this.updateDoors(false);
  }

  /** Where the ladder's floor end is (-1 without one). */
  private ladderFoot = -1;
  /** Bumps whenever a tile or its wear changes (the view redraws damage then). Not state. */
  tilesRev = 0;

  get clock(): Clock {
    return clockAt(this.state.step);
  }

  step(cmd: number) {
    const s = this.state;
    const w = this.world;
    this.events = [];
    // Out: the game is won, nothing more happens.
    if (s.escaped) return;
    s.step++;
    // Clock.
    const clock = this.clock;
    if (hourStarts(s.step)) this.events.push({ type: 'hour', hour: clock.hour });
    // Routine: a new block settles the last one.
    const now = routineAt(clock.minuteOfDay);
    if (now !== s.routine) {
      const past = ROUTINE[s.routine];
      if (past.miss && !s.attended && !s.excused) {
        const heat = past.miss === 'lockdown' ? 100 : MISSED_ROUTINE_HEAT;
        this.events.push({ type: 'missed', routine: s.routine, heat });
        this.addHeat(heat);
      }
      s.routine = now;
      s.attended = false;
      // Night jobs end with the night, the morning's with Lights Out (a long chase may have held them up).
      const night = ROUTINE[now].id === 'lightsOut';
      s.guards.forEach((g, i) => {
        const duties = w.def.guards[i].duties ?? [];
        if (!night && duties.includes('bedCheck')) cancelTasks(g, GUARD.BED_CHECK);
        if (night && duties.includes('shakedown')) cancelTasks(g, GUARD.SHAKEDOWN);
      });
      s.excused = s.lockdown || this.away;
      this.events.push({ type: 'routine', routine: now });
      // A new day: desks, shelves and counters are stocked again (GDD §6.2), and two cells
      // are named for the shakedown during roll call.
      if (now === 0) {
        restock(w, s.items, s);
        this.events.push({ type: 'restock' });
        this.shakedown();
      }
    }
    // 00:30 and 04:00: the night bed check (GDD §5.3).
    if (s.step % STEPS_PER_MINUTE === 0 && (clock.minuteOfDay === 30 || clock.minuteOfDay === 240)) this.bedCheck();
    // Everyone moves.
    // In a lockdown inmates head for their cells (at night they are going there anyway, to sleep).
    // Who each group shares the floor with (arrays reused: asleep, hundreds of steps run a second).
    const forInmates = this.forInmates;
    const inmateBodies = this.inmateBodies;
    const about = s.layer === LAYER.GROUND;
    forInmates.length = 0;
    if (about) forInmates.push(s.player);
    for (const g of s.guards) forInmates.push(g.body);
    inmateBodies.length = 0;
    for (const m of s.inmates) inmateBodies.push(m.body);
    stepInmates(w, s.inmates, s.lockdown && ROUTINE[s.routine].id !== 'lightsOut' ? LOCKDOWN_PLAN : s.routine, s, forInmates, s.step);
    stepGuards(w, s.guards, s.routine, s.lockdown, s.player, inmateBodies, s.step, this.onReport, about);
    // Knocked out: nothing to do but lie there, then wake up somewhere else.
    if (s.ko > 0) {
      s.player.moving = false;
      if (--s.ko === 0) this.wakeUp();
    } else {
      // Asleep: a move (or the action button) wakes the player, and so does 07:55 (in time for roll call).
      const wokenByPlayer = s.sleeping && (dirOf(cmd) !== 0 || opOf(cmd) === OP.INTERACT);
      if (s.sleeping && (wokenByPlayer || clock.minuteOfDay === 7 * 60 + 55 || ROUTINE[s.routine].id !== 'lightsOut' || s.lockdown)) {
        s.sleeping = false;
        this.events.push({ type: 'sleep', on: false });
      }
      walk(w, s.player, s.sleeping ? 0 : dirOf(cmd), s.layer === LAYER.VENTS ? CRAWL_SPEED : s.layer === LAYER.UNDER ? TUNNEL_SPEED : WALK_SPEED, s.layer);
      // Nothing gets done in your sleep, and the press that woke you doesn't put you back to bed.
      this.useItems(s.sleeping || wokenByPlayer ? dirOf(cmd) : cmd);
      // On the road outside: free.
      if (s.layer === LAYER.GROUND && this.playerZone === 'outside') {
        s.escaped = s.step;
        this.closeBox();
        this.events.push({ type: 'escaped' });
        return;
      }
    }
    // Energy: a point back every couple of minutes, one a minute asleep.
    if (s.energy < 100 && (s.step % ENERGY_REGEN_STEPS === 0 || (s.sleeping && s.step % STEPS_PER_MINUTE === 0))) s.energy++;
    // Solitary: time served (and potatoes peeled) sets the player free.
    if (s.solitary > 0 && --s.solitary === 0) this.release();
    // Who sees the player now, and what they make of it.
    this.watch();
    // Attendance.
    const zone = this.playerZone;
    if (!s.attended && ROUTINE[s.routine].zones.includes(zone)) {
      s.attended = true;
      this.events.push({ type: 'attended', routine: s.routine });
      // A meal or a shower picks the player up.
      const id = ROUTINE[s.routine].id;
      const gain = id === 'breakfast' || id === 'dinner' ? MEAL_ENERGY : id === 'showers' ? SHOWER_ENERGY : 0;
      s.energy = Math.min(100, s.energy + gain);
    }
    // Heat cools while no guard is looking.
    if (!s.seen && !s.lockdown && s.heat > 0 && s.step % HEAT_DECAY_STEPS === 0) s.heat--;
    // Doors last: they follow where everyone ended up, so the state at the end of a step
    // (a save, a keyframe) says everything about them.
    this.updateDoors(true);
  }

  /** Bed means sleep: Lights Out, and no lockdown (the sirens would wake you at once). */
  get bedtime(): boolean {
    return ROUTINE[this.state.routine].id === 'lightsOut' && !this.state.lockdown;
  }

  /** Knocked out or in solitary: not about, so the routine excuses the player. */
  get away(): boolean {
    return this.state.ko > 0 || this.state.solitary > 0;
  }

  /**
   * Guards look (GDD §5.1–5.3): who sees the player, what that costs in heat, who gives
   * chase, and whether a chaser has caught them.
   */
  private watch() {
    const s = this.state;
    const p = s.player;
    const t = tileOfBody(p);
    const here = t.z * MAP_W + t.x;
    s.seen = false;
    for (const g of s.guards) {
      g.sees = !this.away && awake(g) && this.inView(g.body);
      if (g.sees) {
        g.lastSeen = here;
        s.seen = true;
      }
    }
    // Damage and evidence in a guard's cone (GDD §9.3).
    const found = this.noticeDamage();
    if (this.away) {
      s.spotted = 0;
      s.near = 0;
      if (found) this.repair();
      return;
    }
    const zone = this.playerZone;
    const it = s.items;
    const disguised = itemOf(it.inv[SLOT.OUTFIT]) === GUARD_OUTFIT;
    let reason = 0;
    let heat = 0;
    // Out of the cell after Lights Out (past the walk home), or somewhere staff only: 100%.
    const sinceLightsOut = (clockAt(s.step).minuteOfDay - ROUTINE[ROUTINE.length - 1].start + 1440) % 1440;
    const late = ROUTINE[s.routine].id === 'lightsOut' && sinceLightsOut * STEPS_PER_MINUTE >= LIGHTS_OUT_GRACE;
    // Seen at work on a wall, a fence, a grate or the floor; damage found: 100% (GDD §5.2, §9.3).
    if (s.seen && s.step - s.struckAt <= STRIKE_SEEN_STEPS) [reason, heat] = [SPOT.indexOf('tampering'), 100];
    else if (found) [reason, heat] = [SPOT.indexOf('damage'), 100];
    else if (s.seen && !disguised && late && zone !== 'playerCell') [reason, heat] = [SPOT.indexOf('night'), 100];
    else if (s.seen && !disguised && RESTRICTED.includes(zone)) [reason, heat] = [SPOT.indexOf('restricted'), 100];
    // A contraband tool or weapon in hand, in plain sight: +40% a second.
    const held = itemOf(it.inv[it.hand]);
    const def = held ? itemDef(held) : null;
    if (!reason && s.seen && def?.contraband && (def.cat === 'tool' || def.cat === 'weapon')) [reason, heat] = [SPOT.indexOf('contraband'), CONTRABAND_HEAT];
    // In a guard's uniform, but too close to a real one (who sees the player) for too long: +50% a second.
    const close = disguised && s.guards.some((g) => g.sees && (g.body.x - p.x) ** 2 + (g.body.z - p.z) ** 2 <= RECOGNIZE_RANGE ** 2);
    s.near = close ? s.near + 1 : 0;
    if (!reason && s.near > RECOGNIZE_STEPS) [reason, heat] = [SPOT.indexOf('recognized'), s.step % 2 === 0 ? 5 : 0];
    // Wanted (80%+): any guard who sees the player gives chase.
    if (!s.lockdown && s.heat >= CHASE_HEAT) {
      for (const g of s.guards) {
        if (!g.sees || g.mode === GUARD.CHASE) continue;
        if (!reason) reason = SPOT.indexOf('wanted');
        startChase(g);
      }
    }
    // Something new noticed (in a lockdown there is nothing more to notice).
    if (reason && reason !== s.spotted && !s.lockdown) this.events.push({ type: 'spotted', reason: SPOT[reason] });
    s.spotted = reason;
    if (heat) this.addHeat(heat);
    // Caught: a chaser close enough (on the same floor).
    if (s.layer === LAYER.GROUND && s.guards.some((g) => g.mode === GUARD.CHASE && (g.body.x - p.x) ** 2 + (g.body.z - p.z) ** 2 <= CATCH_RANGE * CATCH_RANGE)) this.caught();
  }

  /**
   * Whether a guard sees the player: on the ground floor, its cone and a clear line; up on a
   * roof, from the open yard (nothing on the ground is in the way); in the vents and the
   * tunnels, never.
   */
  private inView(eye: Body): boolean {
    const s = this.state;
    if (s.layer === LAYER.GROUND) return canSee(this.world, eye, s.player);
    if (s.layer !== LAYER.ROOF) return false;
    const t = tileOfBody(eye);
    return TILE_INFO[this.world.ground.kind[t.z * MAP_W + t.x]].outdoor && canSee(this.world, eye, s.player, undefined, false);
  }

  /**
   * Guards notice damage in their cones (GDD §9.3): an open hole, a cut fence, a missing
   * grate overhead, a tunnel entrance (one under the player's desk only while the desk is
   * pushed aside, with the player below), and dirt or chunks of wall left on the floor
   * (taken away there and then). Returns whether anything new was found.
   */
  private noticeDamage(): boolean {
    const s = this.state;
    const w = this.world;
    const watchers = s.guards.filter(awake);
    if (!watchers.length) return false;
    const point = { x: 0, z: 0 };
    // The middle of the tile, or any of its four faces (a hole in a wall is seen from an angle by its face).
    const seenAt = (tile: number) => {
      const cx = (tile % MAP_W) * UNIT + UNIT / 2;
      const cz = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
      for (const [fx, fz] of FACES) {
        point.x = cx + fx;
        point.z = cz + fz;
        if (watchers.some((g) => canSee(w, g.body, point))) return true;
      }
      return false;
    };
    let any = false;
    for (const k in s.tiles) {
      const key = Number(k);
      const kind = s.tiles[key];
      const layer = layerOfKey(key);
      const tile = tileOfKey(key);
      const shows = layer === LAYER.GROUND ? DAMAGE_SHOWS.has(kind) && !(kind === TILE.SHAFT && underMyDesk(w, tile) && s.layer !== LAYER.UNDER) : layer === LAYER.VENTS && kind === TILE.GRATE_OPEN;
      if (!shows || s.found.includes(key) || !seenAt(tile)) continue;
      s.found.push(key);
      this.events.push({ type: 'found', kind });
      any = true;
    }
    const it = s.items;
    for (let k = it.ground.length - 1; k >= 0; k--) {
      const [key, v] = it.ground[k];
      const item = itemOf(v);
      if ((item !== DIRT && item !== WALL_CHUNK) || layerOfKey(key) !== LAYER.GROUND || !seenAt(key)) continue;
      it.ground.splice(k, 1);
      it.rev++;
      this.events.push({ type: 'found', kind: TILE.DIRT });
      any = true;
    }
    return any;
  }

  /** Damage the guards found is put right (concreted over, the grate screwed back): after a capture. */
  private repair() {
    const s = this.state;
    if (!s.found.length) return;
    const n = s.found.length;
    for (const key of s.found) this.setTile(layerOfKey(key), tileOfKey(key), -1);
    s.found = [];
    this.events.push({ type: 'repaired', n });
  }

  /** Changes a tile and records it in the state (-1 puts the map's own tile back). */
  private setTile(layer: number, tile: number, kind: number) {
    const s = this.state;
    const l = this.world.layers[layer];
    const key = placeKey(layer, tile);
    const k = kind < 0 ? l.base[tile] : kind;
    delete s.wear[key];
    if (k === l.base[tile]) delete s.tiles[key];
    else s.tiles[key] = k;
    this.world.setKind(layer, tile, k);
    this.tilesRev++;
  }

  /** The prison's power (the generator arrives in P7: until then it is always on). */
  get power(): boolean {
    return true;
  }

  /** Knocked down by a guard: the lockdown is over, everyone back to work, the player out cold. */
  private caught() {
    const s = this.state;
    const solitary = s.heat >= SOLITARY_HEAT;
    s.ko = KO_STEPS;
    s.wake = solitary ? WAKE.SOLITARY : WAKE.INFIRMARY;
    s.excused = true;
    s.player.moving = false;
    s.sleeping = false;
    s.spotted = 0;
    s.near = 0;
    this.closeBox();
    // The guard who made the catch stands over the player until they're carried off.
    const p = s.player;
    const d2 = (g: Guard) => (g.body.x - p.x) ** 2 + (g.body.z - p.z) ** 2;
    const catcher = s.guards.filter((g) => g.mode === GUARD.CHASE).sort((a, b) => d2(a) - d2(b))[0];
    for (const g of s.guards) if (g.mode === GUARD.CHASE || g.mode === GUARD.INVESTIGATE) backToDuty(g);
    if (catcher) {
      catcher.wait = KO_STEPS;
      catcher.body.moving = false;
      if (catcher.body.x !== p.x || catcher.body.z !== p.z) catcher.body.facing = nearestDir(p.x - catcher.body.x, p.z - catcher.body.z);
    }
    this.events.push({ type: 'caught', solitary });
    if (s.lockdown) {
      s.lockdown = false;
      this.events.push({ type: 'lockdown', on: false });
    }
  }

  /**
   * Waking up after being caught (GDD §5.6): carried contraband is taken and the outfit is
   * swapped for an inmate's; in solitary the desk's standard drawers are searched too. The
   * score is settled: heat back to 0.
   */
  private wakeUp() {
    const s = this.state;
    const places = placesOf(this.world);
    const it = s.items;
    let taken = 0;
    for (let k = 0; k <= SLOT.WEAPON; k++) {
      if (it.inv[k] && itemDef(itemOf(it.inv[k])).contraband) {
        it.inv[k] = 0;
        taken++;
      }
    }
    if (itemOf(it.inv[SLOT.OUTFIT]) !== INMATE_OUTFIT) {
      if (it.inv[SLOT.OUTFIT] && itemDef(itemOf(it.inv[SLOT.OUTFIT])).contraband) taken++;
      it.inv[SLOT.OUTFIT] = slot(INMATE_OUTFIT);
    }
    it.rev++;
    s.heat = 0;
    // What the guards found is put right while the player is out cold (GDD §5.6).
    this.repair();
    const lightsOut = ROUTINE[s.routine].id === 'lightsOut';
    if (s.wake === WAKE.SOLITARY && places.solitary >= 0) {
      taken += this.search(1);
      s.solitary = SOLITARY_STEPS;
      s.peeled = 0;
      this.place(places.solitary);
      this.events.push({ type: 'solitary', on: true, taken });
    } else {
      // The infirmary (at night, straight back to the cell).
      this.place(lightsOut || places.infirmary < 0 ? places.bedside[1] : places.infirmary);
      this.events.push({ type: 'infirmary', taken });
    }
    s.wake = WAKE.NONE;
  }

  /** Out of solitary: into the corridor outside it (at night, back to the cell). */
  private release() {
    const s = this.state;
    const w = this.world;
    const places = placesOf(w);
    let to = places.bedside[1];
    if (ROUTINE[s.routine].id !== 'lightsOut') {
      const corridor = zoneIndex('corridor');
      const path = findPath(w, places.solitary, (i) => w.ground.zone[i] === corridor, -1, MAP_W * MAP_H, undefined, w.guardBlock);
      if (path?.length) to = path[path.length - 1];
    }
    s.peeled = 0;
    this.place(to);
    this.events.push({ type: 'solitary', on: false, taken: 0 });
  }

  /** A press on the potato in solitary: every few presses, 10 minutes off. */
  private peel() {
    const s = this.state;
    // A stroke takes a moment: presses faster than that don't count.
    if (s.step - s.peelAt < PEEL_STEPS) return;
    s.peelAt = s.step;
    if (++s.peeled < POTATO_PRESSES) {
      this.events.push({ type: 'peel', done: false });
      return;
    }
    s.peeled = 0;
    s.solitary = Math.max(1, s.solitary - POTATO_STEPS);
    this.events.push({ type: 'peel', done: true });
  }

  /** Puts the player on a ground floor tile (carried there, facing south). */
  private place(tile: number) {
    this.state.layer = LAYER.GROUND;
    const p = this.state.player;
    p.x = (tile % MAP_W) * UNIT + UNIT / 2;
    p.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
    p.moving = false;
    p.facing = 5;
  }

  private closeBox() {
    const it = this.state.items;
    if (it.open < 0) return;
    it.open = -1;
    it.rev++;
    this.events.push({ type: 'close' });
  }

  /** 08:00: two cells, drawn at random, for the shakedown guard to search (GDD §2.1). */
  private shakedown() {
    const s = this.state;
    const n = this.world.def.cells.length;
    const k = s.guards.findIndex((_, i) => this.world.def.guards[i].duties?.includes('shakedown'));
    if (k < 0 || n < 2) return;
    const a = 1 + randomInt(s, n);
    let b = 1 + randomInt(s, n - 1);
    if (b >= a) b++;
    const cells = [a, b];
    assign(s.guards[k], GUARD.SHAKEDOWN, cells);
    this.events.push({ type: 'shakedown', cells: [...cells] });
  }

  /** The bed check: the night guard looks into every cell, east to west. */
  private bedCheck() {
    const s = this.state;
    const k = s.guards.findIndex((_, i) => this.world.def.guards[i].duties?.includes('bedCheck'));
    if (k < 0) return;
    const steps = placesOf(this.world).doorstep;
    const cells = steps.map((_, c) => c).filter((c) => c > 0 && steps[c] >= 0);
    cells.sort((a, b) => (steps[b] % MAP_W) - (steps[a] % MAP_W) || steps[a] - steps[b]);
    assign(s.guards[k], GUARD.BED_CHECK, cells);
    this.events.push({ type: 'bedCheck', result: 'start' });
  }

  /** A guard looked into a cell or searched one. */
  private report(r: GuardReport) {
    const s = this.state;
    if (r.kind === 'search') {
      const taken = this.search(r.cell);
      this.events.push({ type: 'searched', cell: r.cell, taken });
      return;
    }
    if (r.cell !== 1 || ROUTINE[s.routine].id !== 'lightsOut') return;
    // In the cell, asleep, or a bed dummy under the blanket: all present (GDD §5.3).
    const ok = this.playerZone === 'playerCell' || s.sleeping || s.solitary > 0 || s.ko > 0 || this.dummyInBed();
    this.events.push({ type: 'bedCheck', result: ok ? 'pass' : 'fail' });
    if (!ok && !s.lockdown) {
      this.events.push({ type: 'spotted', reason: 'bedCheck' });
      this.addHeat(100);
    }
  }

  /** Whether the player's bed holds a bed dummy. */
  dummyInBed(): boolean {
    const list = containersOf(this.world);
    const k = list.findIndex((c) => c.mine && c.prop.kind === 'bed');
    return k >= 0 && this.state.items.containers[k].some((v) => itemOf(v) === BED_DUMMY);
  }

  /**
   * Searches a cell: contraband in the desk's standard drawers and in the bed goes (the
   * hidden compartment is never found, GDD §6.2). Returns how many items were taken.
   */
  private search(cell: number): number {
    const it = this.state.items;
    let taken = 0;
    containersOf(this.world).forEach((c, i) => {
      if (this.world.cellOf[c.prop.z * MAP_W + c.prop.x] !== cell || (c.prop.kind !== 'desk' && c.prop.kind !== 'bed')) return;
      const box = it.containers[i];
      for (let k = c.hidden; k < box.length; k++) {
        if (box[k] && itemDef(itemOf(box[k])).contraband) {
          box[k] = 0;
          taken++;
        }
      }
    });
    if (taken) it.rev++;
    return taken;
  }

  /** The player's one-step operation (OP), and the open container closing out of reach. */
  private useItems(cmd: number) {
    const s = this.state;
    const it = s.items;
    const ev = this.events as ItemEvent[];
    const a = argA(cmd);
    if (opOf(cmd) !== OP.NONE) it.rev++;
    switch (opOf(cmd)) {
      case OP.INTERACT: {
        if (s.solitary > 0) {
          this.peel();
          break;
        }
        // From the open desk panel: down the tunnel under the player's desk.
        if (a === 1) {
          this.underDesk();
          break;
        }
        const held = itemOf(it.inv[it.hand]);
        const climb = climbTarget(this.world, s.layer, s.player, this.ladderFoot, this.bodiesAbout());
        if (climb) {
          this.climb(climb);
          break;
        }
        const target = interactTarget(this.world, it, s.player, this.bedtime, s.layer);
        if (!target) break;
        if (target.kind === 'ground') pickUp(it, target.index, ev);
        else if (target.kind === 'sleep') this.sleep();
        else if ((held === DIRT || held === WALL_CHUNK) && containersOf(this.world)[target.index].prop.kind === 'toilet') this.flush(target.index);
        else if (it.open !== target.index) {
          it.open = target.index;
          ev.push({ type: 'open', container: target.index });
        }
        break;
      }
      case OP.CLOSE:
        if (it.open >= 0) {
          it.open = -1;
          ev.push({ type: 'close' });
        }
        break;
      case OP.MOVE:
        moveItem(it, a, argB(cmd));
        break;
      case OP.DROP:
        dropItem(it, a, s.player, ev, s.layer);
        break;
      case OP.USE:
        if (s.solitary === 0) this.strike();
        break;
      case OP.CRAFT:
        craft(it, a, ev, argB(cmd) - 1);
        break;
      case OP.EQUIP:
        equip(it, a);
        break;
      case OP.SELECT:
        if (a < HOTBAR) it.hand = a;
        break;
    }
    if (it.open >= 0 && !stillInReach(this.world, it, s.player)) {
      it.open = -1;
      it.rev++;
      ev.push({ type: 'close' });
    }
  }

  /** Everyone about on the ground floor (nobody digs under people). */
  private bodiesAbout(): Body[] {
    const s = this.state;
    const list = this.inmateBodies.slice();
    for (const g of s.guards) list.push(g.body);
    return list;
  }

  /**
   * A strike with the tool in hand (GDD §9, §7.2): at most every STRIKE_STEPS, it costs the
   * tool's energy and a use; the tile's hit points go down by the tool's damage, and when
   * they run out it gives way. Chocolate in hand is eaten instead.
   */
  private strike() {
    const s = this.state;
    const w = this.world;
    const it = s.items;
    const p = s.player;
    const held = itemOf(it.inv[it.hand]);
    const target = toolTarget(w, s.layer, p, held, this.bodiesAbout());
    if (!target) return;
    // Strikes come at their own pace (holding the button asks every step); the rest at a press.
    if (STRIKES.has(target.action) && s.step - s.struckAt < STRIKE_STEPS) return;
    if (target.action === 'eat') {
      it.inv[it.hand] = 0;
      s.energy = Math.min(100, s.energy + CHOCOLATE_ENERGY);
      this.events.push({ type: 'ate', item: held });
      return;
    }
    if (!STRIKES.has(target.action)) {
      this.putInPlace(target, held);
      return;
    }
    const why = target.hp === 0 ? 'reinforced' : !target.fits ? 'tool' : s.energy < itemDef(held).tool!.energy ? 'tired' : null;
    if (why) {
      this.events.push({ type: 'cantStrike', why, action: target.action });
      return;
    }
    const tool = itemDef(held).tool!;
    s.struckAt = s.step;
    s.energy -= tool.energy;
    // Face what is struck (the grate overhead keeps the heading).
    if (target.tile >= 0 && target.action !== 'digUp' && target.action !== 'unscrew') {
      const dx = (target.tile % MAP_W) * UNIT + UNIT / 2 - p.x;
      const dz = Math.floor(target.tile / MAP_W) * UNIT + UNIT / 2 - p.z;
      if (dx || dz) p.facing = nearestDir(dx, dz);
    }
    p.moving = false;
    // The tool wears.
    const left = usesOf(it.inv[it.hand]) - 1;
    if (left <= 0) {
      it.inv[it.hand] = 0;
      this.events.push({ type: 'broke', item: held });
    } else it.inv[it.hand] = slot(held, left);
    // A live fence: knocked flat (GDD §9.1).
    if (target.action === 'cut' && w.ground.kind[target.tile] === TILE.ELECTRIC && this.power) {
      s.ko = KO_STEPS;
      s.wake = WAKE.INFIRMARY;
      s.sleeping = false;
      this.closeBox();
      this.events.push({ type: 'shocked' });
      return;
    }
    const key = placeKey(target.layer, target.tile);
    const taken = (s.wear[key] ?? 0) + tool.damage;
    if (taken < target.hp) {
      s.wear[key] = taken;
      this.tilesRev++;
      this.events.push({ type: 'strike', action: target.action, layer: target.layer, tile: target.tile, broke: false });
      return;
    }
    const t = target.tile;
    switch (target.action) {
      case 'chip':
        this.setTile(LAYER.GROUND, t, TILE.HOLE);
        give(it, WALL_CHUNK, p, s.layer);
        break;
      case 'cut':
        this.setTile(LAYER.GROUND, t, TILE.FENCE_CUT);
        break;
      case 'unscrew':
        this.setTile(LAYER.VENTS, t, TILE.GRATE_OPEN);
        break;
      case 'dig':
        if (target.layer === LAYER.GROUND) {
          this.setTile(LAYER.GROUND, t, TILE.SHAFT);
          if (w.layers[LAYER.UNDER].kind[t] === TILE.SOIL) this.setTile(LAYER.UNDER, t, TILE.TUNNEL);
        } else {
          this.setTile(LAYER.UNDER, t, TILE.TUNNEL);
          // Too long a stretch without a brace: the roof comes down (GDD §9.2).
          if (cavesIn(w, t)) {
            this.setTile(LAYER.UNDER, t, TILE.SOIL);
            s.energy = Math.max(0, s.energy - CAVE_IN_ENERGY);
            this.events.push({ type: 'caveIn', tile: t });
            return;
          }
        }
        give(it, DIRT, p, s.layer);
        break;
      case 'digUp': {
        this.setTile(LAYER.GROUND, t, TILE.SHAFT);
        give(it, DIRT, p, s.layer);
        this.events.push({ type: 'strike', action: target.action, layer: target.layer, tile: t, broke: true });
        // Out through the new hole.
        const out = besideOnGround(w, t, this.bodiesAbout());
        if (out >= 0) this.moveTo(LAYER.GROUND, out, 'digUp');
        return;
      }
    }
    this.events.push({ type: 'strike', action: target.action, layer: target.layer, tile: t, broke: true });
  }

  /**
   * The item in hand put to use on the structure (GDD §9.2–9.3): a cover over damage, a
   * brace in the tunnel, a sheet rope down off a roof. One press each.
   */
  private putInPlace(target: ToolTarget, held: number) {
    const s = this.state;
    const it = s.items;
    const t = target.tile;
    if (!target.fits) {
      this.events.push({ type: 'cantStrike', why: 'poster', action: target.action });
      return;
    }
    it.inv[it.hand] = 0;
    switch (target.action) {
      case 'cover':
        if (target.layer === LAYER.VENTS) this.setTile(LAYER.VENTS, t, TILE.GRATE_FAKE);
        else this.setTile(LAYER.GROUND, t, this.world.ground.kind[t] === TILE.FENCE_CUT ? TILE.FENCE_FAKE : held === POSTER_ITEM ? TILE.HOLE_POSTER : TILE.HOLE_FAKE);
        this.events.push({ type: 'covered', item: held, on: true });
        break;
      case 'brace':
        this.setTile(LAYER.UNDER, t, TILE.BRACED);
        this.events.push({ type: 'braced' });
        break;
      case 'rope':
        this.moveTo(LAYER.GROUND, t, 'rope');
        break;
    }
  }

  /** Climbing, and covers taken off (the action button on the structure). */
  private climb(c: ClimbTarget) {
    const s = this.state;
    const it = s.items;
    const p = s.player;
    switch (c.action) {
      case 'uncover': {
        const grate = this.world.layers[LAYER.VENTS].kind[c.tile] === TILE.GRATE_FAKE;
        if (!give(it, c.item!, p, s.layer)) return;
        if (grate) this.setTile(LAYER.VENTS, c.tile, TILE.GRATE_OPEN);
        else this.setTile(LAYER.GROUND, c.tile, this.world.ground.kind[c.tile] === TILE.FENCE_FAKE ? TILE.FENCE_CUT : TILE.HOLE);
        this.events.push({ type: 'covered', item: c.item!, on: false });
        return;
      }
    }
    // Climbing out of the tunnel under the desk: beside the desk.
    const to = c.toTile === -2 ? placesOf(this.world).deskside[1] : c.toTile;
    if (to < 0) return;
    this.moveTo(c.toLayer, to, c.action);
  }

  /** Down the tunnel under the player's desk (from its open panel). */
  private underDesk() {
    const it = this.state.items;
    const box = containersOf(this.world)[it.open];
    if (!box?.mine || box.prop.kind !== 'desk') return;
    const tile = box.prop.z * MAP_W + box.prop.x;
    if (this.world.ground.kind[tile] !== TILE.SHAFT) return;
    this.moveTo(LAYER.UNDER, tile, 'climbDown');
  }

  /** Onto a layer, in the middle of a tile. */
  private moveTo(layer: number, tile: number, how: ClimbAction | 'digUp' | 'rope') {
    const s = this.state;
    const from = s.layer;
    this.closeBox();
    s.layer = layer;
    s.player.x = (tile % MAP_W) * UNIT + UNIT / 2;
    s.player.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
    s.player.moving = false;
    this.events.push({ type: 'layer', layer, from, how });
  }

  /** Dirt (or a chunk of wall) down a toilet: three loads an hour, then it's clogged for an hour (GDD §9.2). */
  private flush(index: number) {
    const s = this.state;
    const it = s.items;
    const t = (s.toilets[index] ??= [0, s.step]);
    if (s.step - t[1] >= TOILET_CLOG_STEPS) {
      t[0] = 0;
      t[1] = s.step;
    }
    if (t[0] >= TOILET_LOADS) {
      this.events.push({ type: 'clogged' });
      return;
    }
    const item = itemOf(it.inv[it.hand]);
    it.inv[it.hand] = 0;
    if (t[0] === 0) t[1] = s.step;
    // The third load clogs it: an hour from now it takes dirt again.
    if (++t[0] >= TOILET_LOADS) t[1] = s.step;
    this.events.push({ type: 'flushed', item });
  }

  /** Into bed: the player lies down beside it (the view puts them in it). */
  private sleep() {
    const s = this.state;
    const t = placesOf(this.world).bedside[1];
    if (t < 0) return;
    s.player.x = (t % MAP_W) * UNIT + UNIT / 2;
    s.player.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
    s.player.moving = false;
    s.sleeping = true;
    this.closeBox();
    this.events.push({ type: 'sleep', on: true });
  }

  /** Heat; at 100% the sirens go: a lockdown, every guard hunting the player (GDD §3.1). */
  private addHeat(n: number) {
    const s = this.state;
    if (this.away) return;
    s.heat = Math.min(100, s.heat + n);
    if (s.heat >= 100 && !s.lockdown) {
      s.lockdown = true;
      s.excused = true;
      this.events.push({ type: 'lockdown', on: true });
    }
  }

  /** Whether cells lock now: Lights Out or a lockdown. */
  get cellsLocked(): boolean {
    return this.state.lockdown || ROUTINE[this.state.routine].id === 'lightsOut';
  }

  /**
   * Cell doors are locked while cells are, except for a cell whose occupant is still out
   * (the door waits for them), a cell with a visitor in it (nobody is locked in someone
   * else's cell) and a door someone stands in (it never shuts on anyone).
   */
  private updateDoors(announce: boolean) {
    const s = this.state;
    const w = this.world;
    let mask = 0;
    if (this.cellsLocked) {
      const bodies = s.layer === LAYER.GROUND ? [s.player, ...s.inmates.map((m) => m.body)] : s.inmates.map((m) => m.body);
      const occupant = (c: number) => (c === 1 ? s.player : s.inmates.find((m) => m.cell === c)?.body);
      const cellOfBody = (b: Body) => {
        const t = tileOfBody(b);
        return w.cellOf[t.z * MAP_W + t.x];
      };
      for (let c = 1; c < w.cellDoor.length; c++) {
        const b = occupant(c);
        const door = w.cellDoor[c];
        if (!b || cellOfBody(b) !== c || door < 0) continue;
        if (bodies.some((o) => o !== b && cellOfBody(o) === c) || bodies.some((o) => overlaps(o, door))) continue;
        mask |= 1 << c;
      }
    }
    const was = w.lockedCells;
    w.setLockedCells(mask);
    // The player hears their own door lock and unlock.
    if (announce && ((was ^ mask) & 2) !== 0) this.events.push({ type: 'cells', locked: (mask & 2) !== 0 });
  }

  /** The zone the player stands in (off the ground floor: the tunnels, the vents, the roof). */
  get playerZone() {
    const l = this.state.layer;
    if (l === LAYER.UNDER) return 'tunnels';
    if (l === LAYER.VENTS) return 'vents';
    if (l === LAYER.ROOF) return 'roof';
    const t = tileOfBody(this.state.player);
    return this.world.zoneAt(t.x, t.z);
  }

  snapshot(): Snapshot {
    return { v: 1, prison: this.prison.id, state: structuredClone(this.state) };
  }

  restore(snap: Snapshot) {
    if (snap.prison !== this.prison.id) throw new Error(`snapshot of ${snap.prison}, not ${this.prison.id}`);
    const st = structuredClone(snap.state) as Partial<SimState> & Pick<SimState, 'step' | 'rng' | 'player'>;
    // Fields added after a snapshot was taken load with their starting values (in field
    // order, so the state hashes the same however it was made).
    this.state = {
      step: st.step,
      rng: st.rng,
      player: st.player,
      heat: st.heat ?? 0,
      routine: st.routine ?? routineAt(clockAt(st.step).minuteOfDay),
      attended: st.attended ?? false,
      lockdown: st.lockdown ?? false,
      inmates: st.inmates ?? spawnInmates(this.world, { rng: st.rng }),
      excused: st.excused ?? false,
      items: fitItems(this.world, st.items) ?? startItems(this.world, { rng: st.rng }),
      sleeping: st.sleeping ?? false,
      guards: st.guards?.length === this.world.def.guards.length ? st.guards.map((g) => ({ ...g, resume: g.resume ?? 0 })) : spawnGuards(this.world),
      seen: st.seen ?? false,
      ko: st.ko ?? 0,
      wake: st.wake ?? WAKE.NONE,
      solitary: st.solitary ?? 0,
      peeled: st.peeled ?? 0,
      spotted: st.spotted ?? 0,
      near: st.near ?? 0,
      peelAt: st.peelAt ?? 0,
      layer: st.layer ?? LAYER.GROUND,
      energy: st.energy ?? 100,
      tiles: st.tiles ?? {},
      wear: st.wear ?? {},
      toilets: st.toilets ?? {},
      found: st.found ?? [],
      struckAt: st.struckAt ?? -STRIKE_STEPS,
      escaped: st.escaped ?? 0,
    };
    // The world as the state has it: the map, then every tile changed since.
    const w = this.world;
    for (const l of w.layers) l.kind.set(l.base);
    for (const k in this.state.tiles) w.layers[layerOfKey(Number(k))].kind[tileOfKey(Number(k))] = this.state.tiles[k];
    w.refreshBlock();
    this.tilesRev++;
    this.updateDoors(false);
    this.events = [];
  }

  /** A fingerprint of the whole state (tests compare these). */
  hash(): string {
    const w = this.world;
    return fnv1a(JSON.stringify(this.state) + w.layers.map((l) => fnv1a(String.fromCharCode(...l.kind))).join('') + fnv1a(String.fromCharCode(...w.block)));
  }
}

const GUARD_OUTFIT = itemNumber('guard_outfit');
const INMATE_OUTFIT = itemNumber('inmate_outfit');
const BED_DUMMY = itemNumber('bed_dummy');
const POSTER_ITEM = itemNumber('poster');
/** Where a guard looks at a tile from: its middle, then its faces. */
const FACES = [
  [0, 0],
  [0, Math.round(UNIT * 0.45)],
  [0, -Math.round(UNIT * 0.45)],
  [Math.round(UNIT * 0.45), 0],
  [-Math.round(UNIT * 0.45), 0],
];

/**
 * Items from a snapshot, fitted to this prison's containers (a map edit may add or remove
 * some): missing ones come in empty, extra ones are dropped, sizes follow the furniture.
 */
function fitItems(w: World, items: ItemState | undefined): ItemState | undefined {
  if (!items) return undefined;
  const list = containersOf(w);
  items.containers = list.map((c, i) => {
    const old = items.containers[i] ?? [];
    return Array.from({ length: c.slots }, (_, k) => old[k] ?? 0);
  });
  items.rev ??= 0;
  return items;
}

/** Whether a body's footprint touches a tile. */
function overlaps(b: Body, tile: number): boolean {
  const tx = (tile % MAP_W) * UNIT;
  const tz = Math.floor(tile / MAP_W) * UNIT;
  return b.x + BODY_HALF > tx && b.x - BODY_HALF < tx + UNIT && b.z + BODY_HALF > tz && b.z - BODY_HALF < tz + UNIT;
}
