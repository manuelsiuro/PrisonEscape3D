/**
 * A bot that plays through the real simulation with ordinary commands (the sim playbook's
 * escape bots): walks with the autopilot on whatever layer it is on, keeps the routine like a
 * model prisoner, opens furniture, moves items, strikes with tools, fights. Every action is a
 * command, so a run is recorded, replayed and deterministic.
 */
import { itemNumber } from '../src/content/items';
import type { PrisonDef } from '../src/content/prisons/types';
import { ROUTINE } from '../src/content/routine';
import { ZONES } from '../src/content/zones';
import { Autopilot } from '../src/sim/ai/autopilot';
import { placesOf } from '../src/sim/ai/places';
import { command, OP, SLOT } from '../src/sim/command';
import { Sim, type SimEvent, type Snapshot } from '../src/sim/Sim';
import { formatTime } from '../src/sim/systems/clock';
import { itemOf, slot } from '../src/sim/systems/items';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { MAP_W } from '../src/sim/world/World';

export const n = (id: string) => itemNumber(id);
export const DIR = { EAST: 1, SOUTH: 5, WEST: 9, NORTH: 13 } as const;
export const tileOf = (x: number, z: number) => z * MAP_W + x;

export class Bot {
  readonly sim: Sim;
  readonly pilot: Autopilot;
  /** Highest heat seen, and the notable events with their times. */
  heatPeak = 0;
  readonly log: string[] = [];
  private readonly events: SimEvent[] = [];
  /** The state before the first step (after any setup) and every command since: the run, replayable. */
  start: Snapshot | null = null;
  readonly cmds: number[] = [];

  constructor(prison: PrisonDef, seed: number) {
    this.sim = new Sim(prison, seed);
    this.pilot = new Autopilot(this.sim.world, () => this.sim.world.routeGrid(this.sim.state.layer));
  }

  get st() {
    return this.sim.state;
  }
  get time() {
    return `day ${this.sim.clock.day} ${formatTime(this.sim.clock)}`;
  }
  get tile() {
    return Math.floor(this.st.player.z / UNIT) * MAP_W + Math.floor(this.st.player.x / UNIT);
  }
  get done() {
    return this.st.escaped > 0;
  }

  /** One step; notable events go in the log. */
  step(cmd = 0) {
    this.start ??= this.sim.snapshot();
    this.cmds.push(cmd);
    this.sim.step(cmd);
    this.heatPeak = Math.max(this.heatPeak, this.st.heat);
    for (const e of this.sim.events) {
      this.events.push(e);
      const line = describe(e);
      if (line) this.log.push(`${this.time} ${line}`);
    }
  }
  op(op: number, a = 0, b = 0, c = 0) {
    this.step(command(0, op, a, b, c));
  }
  /** Steps until a test passes (or a limit); whether it did. */
  until(test: () => boolean, limit: number, cmd: () => number = () => 0): boolean {
    for (let k = 0; k < limit && !test() && !this.done; k++) this.step(cmd());
    return test();
  }
  /** Walks to a tile on the current layer; whether it got there. */
  walkTo(tile: number, limit = 4000): boolean {
    this.pilot.goTo(tile);
    for (let k = 0; k < limit && this.pilot.active && !this.done; k++) this.step(command(this.pilot.dir(this.st.player)));
    this.pilot.stop();
    return this.tile === tile;
  }
  /** Turns to face a way (a step's walk that way: against a wall or a fence it goes nowhere). */
  face(dir: number) {
    this.step(command(dir));
    this.step(command(0));
  }
  /** Interact (the action button). */
  act(a = 0) {
    this.op(OP.INTERACT, a);
  }
  /** Holds hotbar slot k. */
  hold(item: string) {
    const k = this.slotOf(item);
    if (k >= 0) this.op(OP.SELECT, k);
    return k >= 0;
  }
  slotOf(item: string) {
    return this.st.items.inv.slice(0, 6).findIndex((v) => itemOf(v) === n(item));
  }
  /** One press of the use button. */
  use() {
    this.op(OP.USE, 1);
  }
  /** Strikes with a tool (a fresh press each time) until `done`, resting when too tired; whether it got there. */
  strikeUntil(tool: string, done: () => boolean, limit = 2000): boolean {
    for (let k = 0; k < limit && !done() && !this.done; k++) {
      if (itemOf(this.st.items.inv[this.st.items.hand]) !== n(tool) && !this.hold(tool)) return false;
      this.op(OP.USE, 1);
      // Out of breath: a breather (a minute or two standing still).
      if (this.sim.events.some((e) => e.type === 'cantStrike' && e.why === 'tired')) this.until(() => this.st.energy >= 40, 40 * STEPS_PER_MINUTE);
    }
    return done();
  }

  /** The player's own desk and bed (container indexes). */
  get desk() {
    return containersOf(this.sim.world).findIndex((c) => c.mine && c.prop.kind === 'desk');
  }
  get bed() {
    return containersOf(this.sim.world).findIndex((c) => c.mine && c.prop.kind === 'bed');
  }
  /** Day 1, before anything: the escape kit hidden in the desk's compartment (where the player would have stashed it). */
  stash(...ids: string[]) {
    const box = this.st.items.containers[this.desk];
    ids.forEach((id, k) => (box[k] = slot(n(id))));
  }
  /** Opens a container from where the player stands (interact until it is the open one). */
  open(index: number): boolean {
    if (this.st.items.open !== index) this.act();
    return this.st.items.open === index;
  }
  /** Everything in the open container's first slots into the pockets. */
  takeAll(slots: number) {
    for (let k = 0; k < slots; k++) {
      const box = this.st.items.containers[this.st.items.open];
      if (!box?.[k]) continue;
      const free = this.st.items.inv.slice(0, 6).indexOf(0);
      if (free < 0) return;
      this.op(OP.MOVE, SLOT.CONTAINER + k, free);
    }
  }
  /** An item from the pockets into the open container's slot k. */
  putIn(item: string, k: number) {
    const from = this.slotOf(item);
    if (from >= 0) this.op(OP.MOVE, from, SLOT.CONTAINER + k);
  }
  close() {
    this.op(OP.CLOSE);
  }

  /**
   * The model prisoner (as in routinetest) until a test passes: wherever the block wants the
   * player (roll call spot, the block's zone, the job's room), the cell at night.
   */
  keepRoutine(until: () => boolean, limit: number) {
    const places = placesOf(this.sim.world);
    let want = '';
    for (let k = 0; k < limit && !until() && !this.done; k++) {
      const st = this.st;
      const r = ROUTINE[st.routine];
      const zones = this.sim.dutyZones;
      const key = st.lockdown ? 'lockdown' : `${r.id}:${zones.join()}`;
      if (key !== want) {
        want = key;
        if (st.lockdown || r.id === 'lightsOut') this.pilot.goTo(places.bedside[1]);
        else if (r.id === 'rollCall' || r.id === 'eveningRollCall') this.pilot.goTo(places.rollCall[0].tile);
        else if (zones.length) this.pilot.goToAny((i) => zones.includes(ZONES[this.sim.world.ground.zone[i]]));
        else this.pilot.goTo(places.bedside[1]);
      }
      this.step(command(this.pilot.dir(st.player)));
    }
    this.pilot.stop();
    return until();
  }
  /** Until a minute of a day (keeping the routine meanwhile). */
  routineUntil(day: number, minute: number) {
    const target = ((day - 1) * 1440 + minute - 8 * 60) * STEPS_PER_MINUTE;
    return this.keepRoutine(() => this.st.step >= target, Math.max(0, target - this.st.step) + 1);
  }
}

/**
 * Saved and loaded mid-run (GDD §2): the run replayed from its start, saved at each cut (a
 * fraction of the way), the save written out as JSON and loaded into a fresh game, which plays
 * the rest of the commands and must end exactly as the run did. Returns where each cut fell.
 */
export function resumes(bot: Bot, cuts: readonly number[]): string[] {
  const end = bot.sim.hash();
  const replay = new Sim(bot.sim.prison, 1);
  replay.restore(bot.start!);
  const at: string[] = [];
  let k = 0;
  for (const cut of cuts) {
    const stop = Math.floor(bot.cmds.length * cut);
    for (; k < stop; k++) replay.step(bot.cmds[k]);
    const saved = JSON.parse(JSON.stringify(replay.snapshot())) as Snapshot;
    const loaded = new Sim(bot.sim.prison, 99);
    loaded.restore(saved);
    for (let j = stop; j < bot.cmds.length; j++) loaded.step(bot.cmds[j]);
    at.push(`day ${replay.clock.day} ${formatTime(replay.clock)} (${replay.playerZone}) ${loaded.hash() === end ? 'resumes' : 'DIVERGES'}`);
  }
  return at;
}

export function describe(e: SimEvent): string {
  switch (e.type) {
    case 'lockdown':
      return e.on ? 'LOCKDOWN' : 'lockdown lifted';
    case 'spotted':
      return `spotted: ${e.reason}`;
    case 'caught':
      return `caught (${e.solitary ? 'solitary' : 'infirmary'})`;
    case 'missed':
      return `missed ${ROUTINE[e.routine].id} +${e.heat}%`;
    case 'bedCheck':
      return e.result === 'start' ? '' : `bed check: ${e.result}`;
    case 'power':
      return `power ${e.on ? 'on' : 'OFF'} (${e.by})`;
    case 'scanned':
      return e.tripped ? 'detector TRIPPED' : `detector: shielded (${e.pouch} passes left)`;
    case 'camera':
      return `camera ${e.index} ${e.blind ? 'taped' : 'watching again'}`;
    case 'shot':
      return e.hit ? `sniper hit (${e.dmg})` : 'sniper warning shot';
    case 'takeover':
      return e.on ? 'TAKEOVER: the gates are open' : 'takeover over';
    case 'shocked':
      return 'shocked by the fence';
    case 'caveIn':
      return 'cave-in';
    case 'koed':
      return `knocked out #${e.who}`;
    case 'layer':
      return `${e.how} → layer ${e.layer}`;
    case 'escaped':
      return `ESCAPED (${e.via})`;
    case 'stow':
      return e.on ? 'into the vehicle' : e.found ? 'FOUND in the vehicle' : 'out of the vehicle';
    case 'dog':
      return e.what === 'sniff' || e.what === 'dug' || e.what === 'track' || e.what === 'point' ? `dog #${e.dog} ${e.what}` : '';
    case 'today':
      if (e.event !== 'delivery') return '';
      return e.phase === 'start' ? 'the delivery is in' : e.phase === 'search' ? `the vehicle searched (${e.thorough ? 'thoroughly' : 'a quick look'})` : e.phase === 'waved' ? 'the vehicle waved through' : e.phase === 'end' ? 'the delivery leaves' : '';
    case 'refused':
      return e.why === 'watched' || e.why === 'tailgate' ? `refused: ${e.why}` : '';
    default:
      return '';
  }
}
