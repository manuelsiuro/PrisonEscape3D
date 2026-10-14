import { itemDef, itemNumber } from '../content/items';
import type { PrisonDef } from '../content/prisons/types';
import { ROUTINE, routineAt } from '../content/routine';
import { RESTRICTED, zoneIndex } from '../content/zones';
import { argA, argB, dirOf, OP, opOf, SLOT } from './command';
import { findPath, nearestDir } from './ai/path';
import { placesOf } from './ai/places';
import { canSee } from './ai/sight';
import { craft, dropItem, equip, HOTBAR, interactTarget, itemOf, moveItem, pickUp, restock, slot, startItems, stillInReach, type ItemEvent, type ItemState } from './systems/items';
import { fnv1a, randomInt } from './rng';
import { clockAt, hourStarts, type Clock } from './systems/clock';
import { assign, awake, backToDuty, CATCH_RANGE, GUARD, spawnGuards, startChase, stepGuards, type Guard, type GuardReport } from './systems/guards';
import { LOCKDOWN_PLAN, spawnInmates, stepInmates, type Inmate } from './systems/inmates';
import { bodyAt, tileOfBody, walk, type Body } from './systems/movement';
import {
  BODY_HALF,
  CHASE_HEAT,
  CONTRABAND_HEAT,
  HEAT_DECAY_STEPS,
  KO_STEPS,
  LIGHTS_OUT_GRACE,
  MISSED_ROUTINE_HEAT,
  POTATO_PRESSES,
  POTATO_STEPS,
  RECOGNIZE_RANGE,
  RECOGNIZE_STEPS,
  SOLITARY_HEAT,
  SOLITARY_STEPS,
  STEPS_PER_MINUTE,
  UNIT,
} from './tuning';
import { MAP_H, MAP_W, World } from './world/World';
import { containersOf } from './world/containers';

/** Why guards took notice of the player (GDD §5.2). Stored as numbers: never renumber. */
export const SPOT = ['none', 'night', 'restricted', 'contraband', 'recognized', 'wanted', 'bedCheck'] as const;
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
    };
    this.updateDoors(false);
  }

  get clock(): Clock {
    return clockAt(this.state.step);
  }

  step(cmd: number) {
    const s = this.state;
    const w = this.world;
    this.events = [];
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
    const guardBodies = s.guards.map((g) => g.body);
    stepInmates(w, s.inmates, s.lockdown && ROUTINE[s.routine].id !== 'lightsOut' ? LOCKDOWN_PLAN : s.routine, s, [s.player, ...guardBodies], s.step);
    stepGuards(
      w,
      s.guards,
      s.routine,
      s.lockdown,
      s.player,
      s.inmates.map((m) => m.body),
      s.step,
      (r) => this.report(r),
    );
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
      walk(w, s.player, s.sleeping ? 0 : dirOf(cmd));
      // Nothing gets done in your sleep, and the press that woke you doesn't put you back to bed.
      this.useItems(s.sleeping || wokenByPlayer ? dirOf(cmd) : cmd);
    }
    // Solitary: time served (and potatoes peeled) sets the player free.
    if (s.solitary > 0 && --s.solitary === 0) this.release();
    // Who sees the player now, and what they make of it.
    this.watch();
    // Attendance.
    const zone = this.playerZone;
    if (!s.attended && ROUTINE[s.routine].zones.includes(zone)) {
      s.attended = true;
      this.events.push({ type: 'attended', routine: s.routine });
    }
    // Heat cools while no guard is looking.
    if (!s.seen && !s.lockdown && s.heat > 0 && s.step % HEAT_DECAY_STEPS === 0) s.heat--;
    // Doors last: they follow where everyone ended up, so the state at the end of a step
    // (a save, a keyframe) says everything about them.
    this.updateDoors(true);
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
    const w = this.world;
    const p = s.player;
    const t = tileOfBody(p);
    const here = t.z * MAP_W + t.x;
    s.seen = false;
    for (const g of s.guards) {
      g.sees = !this.away && awake(g) && canSee(w, g.body, p);
      if (g.sees) {
        g.lastSeen = here;
        s.seen = true;
      }
    }
    if (this.away) {
      s.spotted = 0;
      s.near = 0;
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
    if (s.seen && !disguised && late && zone !== 'playerCell') [reason, heat] = [SPOT.indexOf('night'), 100];
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
    // Caught: a chaser close enough.
    if (s.guards.some((g) => g.mode === GUARD.CHASE && (g.body.x - p.x) ** 2 + (g.body.z - p.z) ** 2 <= CATCH_RANGE * CATCH_RANGE)) this.caught();
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
    if (++s.peeled < POTATO_PRESSES) {
      this.events.push({ type: 'peel', done: false });
      return;
    }
    s.peeled = 0;
    s.solitary = Math.max(1, s.solitary - POTATO_STEPS);
    this.events.push({ type: 'peel', done: true });
  }

  /** Puts the player on a tile (carried there, facing south). */
  private place(tile: number) {
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
    if (r.cell !== 1) return;
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
        const target = interactTarget(this.world, it, s.player, ROUTINE[s.routine].id === 'lightsOut');
        if (!target) break;
        if (target.kind === 'ground') pickUp(it, target.index, ev);
        else if (target.kind === 'sleep') this.sleep();
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
        dropItem(it, a, s.player, ev);
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
      const bodies = [s.player, ...s.inmates.map((m) => m.body)];
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

  /** The zone the player stands in. */
  get playerZone() {
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
      guards: st.guards?.length === this.world.def.guards.length ? st.guards : spawnGuards(this.world),
      seen: st.seen ?? false,
      ko: st.ko ?? 0,
      wake: st.wake ?? WAKE.NONE,
      solitary: st.solitary ?? 0,
      peeled: st.peeled ?? 0,
      spotted: st.spotted ?? 0,
      near: st.near ?? 0,
    };
    this.updateDoors(false);
    this.events = [];
  }

  /** A fingerprint of the whole state (tests compare these). */
  hash(): string {
    const g = this.world.ground;
    return fnv1a(JSON.stringify(this.state) + fnv1a(String.fromCharCode(...g.kind)) + fnv1a(String.fromCharCode(...this.world.block)));
  }
}

const GUARD_OUTFIT = itemNumber('guard_outfit');
const INMATE_OUTFIT = itemNumber('inmate_outfit');
const BED_DUMMY = itemNumber('bed_dummy');

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
