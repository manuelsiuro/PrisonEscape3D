import type { PrisonDef } from '../content/prisons/types';
import { ROUTINE, routineAt } from '../content/routine';
import { dirOf } from './command';
import { fnv1a } from './rng';
import { clockAt, hourStarts, type Clock } from './systems/clock';
import { LOCKDOWN_PLAN, spawnInmates, stepInmates, type Inmate } from './systems/inmates';
import { bodyAt, tileOfBody, walk, type Body } from './systems/movement';
import { BODY_HALF, HEAT_DECAY_STEPS, LOCKDOWN_END_HEAT, LOCKDOWN_STEPS, MISSED_ROUTINE_HEAT, UNIT } from './tuning';
import { MAP_W, World } from './world/World';

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
  /** Cell doors locked or unlocked for the night or a lockdown. */
  | { type: 'cells'; locked: boolean };

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
  /** Steps the player still has to spend in their cell before a lockdown lifts. */
  lockdownLeft: number;
  inmates: Inmate[];
  /** A lockdown ran during this block: missing it costs nothing. */
  excused: boolean;
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
 * clock → routine → doors → inmates → player → attendance and lockdown → heat.
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
    this.state = {
      step: 0,
      rng: s.rng,
      player: bodyAt(prison.spawn.x, prison.spawn.z),
      heat: 0,
      routine: routineAt(clockAt(0).minuteOfDay),
      attended: false,
      lockdown: false,
      lockdownLeft: 0,
      inmates,
      excused: false,
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
      s.excused = s.lockdown;
      this.events.push({ type: 'routine', routine: now });
    }
    // Doors, then everyone moves.
    this.updateDoors(true);
    // In a lockdown inmates head for their cells (at night they are going there anyway, to sleep).
    stepInmates(w, s.inmates, s.lockdown && ROUTINE[s.routine].id !== 'lightsOut' ? LOCKDOWN_PLAN : s.routine, s, s.player, s.step);
    walk(w, s.player, dirOf(cmd));
    // Attendance, and the lockdown: it lifts once the player has sat out its time in the cell.
    const zone = this.playerZone;
    if (!s.attended && ROUTINE[s.routine].zones.includes(zone)) {
      s.attended = true;
      this.events.push({ type: 'attended', routine: s.routine });
    }
    if (s.lockdown && zone === 'playerCell' && --s.lockdownLeft <= 0) {
      s.lockdown = false;
      s.heat = Math.min(s.heat, LOCKDOWN_END_HEAT);
      this.events.push({ type: 'lockdown', on: false });
    }
    // Heat cools while nobody is looking (no guards yet: always).
    if (!s.lockdown && s.heat > 0 && s.step % HEAT_DECAY_STEPS === 0) s.heat--;
  }

  private addHeat(n: number) {
    const s = this.state;
    s.heat = Math.min(100, s.heat + n);
    if (s.heat >= 100 && !s.lockdown) {
      s.lockdown = true;
      s.lockdownLeft = LOCKDOWN_STEPS;
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
    if (announce && (was === 0) !== (mask === 0)) this.events.push({ type: 'cells', locked: mask !== 0 });
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
      lockdownLeft: st.lockdownLeft ?? 0,
      inmates: st.inmates ?? spawnInmates(this.world, { rng: st.rng }),
      excused: st.excused ?? false,
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

/** Whether a body's footprint touches a tile. */
function overlaps(b: Body, tile: number): boolean {
  const tx = (tile % MAP_W) * UNIT;
  const tz = Math.floor(tile / MAP_W) * UNIT;
  return b.x + BODY_HALF > tx && b.x - BODY_HALF < tx + UNIT && b.z + BODY_HALF > tz && b.z - BODY_HALF < tz + UNIT;
}
