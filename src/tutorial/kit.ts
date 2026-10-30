/** What the lessons are made of (tutorial/lessons.ts): the step and lesson types, the scenes' setup, and the checks a step's goal, arrows and failures are told by. */
import { BLOCK, OPEN_HOURS, ROUTINE, routineAt } from '../content/routine';
import { RECORDS_MINUTE } from '../content/paperwork';
import { freedNow } from '../sim/systems/paperwork';
import { cornersOf } from '../content/grounds';
import { phoneOpen } from '../sim/systems/phone';
import { atKiosk, kioskOpen, loggedIn } from '../sim/systems/kiosk';
import { jobOf } from '../sim/systems/oddjobs';
import { itemNumber } from '../content/items';
import type { PrisonDef } from '../content/prisons/types';
import type { Key } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { clockAt } from '../sim/systems/clock';
import { itemOf, slot } from '../sim/systems/items';
import { STEPS_PER_MINUTE, UNIT } from '../sim/tuning';
import { containersOf, playerDesk } from '../sim/world/containers';
import { LAYER, MAP_W } from '../sim/world/World';
import { CENTER_PERKS } from '../content/prisons/center-perks';
import { SIGN_OFF_MINUTES } from '../content/days';
import { SHIFT_TO } from '../content/getaways';
import { searchMinute, vehicleIn } from '../sim/systems/delivery';
import { jobRooms } from '../sim/systems/economy';
import { isFloor, placesOf } from '../sim/ai/places';
import { lineOfSight } from '../sim/ai/sight';
import { WATCH_RANGE } from '../content/crew';
import { DAY_STEPS, dayMinute, planOf, prisonDay } from '../sim/systems/calendar';
import { FEAT } from '../sim/systems/ledger';
import { HEARINGS } from '../content/parole';
import { touchesMyCell } from '../sim/systems/structure';
import { gameOn, gamesOpen } from '../sim/systems/games';
import { baitSlot, petOf } from '../sim/systems/rats';
import { RACE_MINUTE } from '../content/long';
import { cardUp } from '../sim/systems/races';
import type { StartKind } from '../content/outside/types';
import { OVER, SEEK, type Hunt } from '../sim/hunt/Hunt';
import { spotTile } from '../sim/hunt/world';
import { centerX, centerZ, tileAt } from '../sim/world/grid';
import { inmateInCell } from '../sim/systems/inmates';

/** What a step looks at: the game, and the bits of the screen the sim doesn't know (P41: and the manhunt under way, if any). */
export interface LessonCtx {
  sim: Sim;
  craftOpen: boolean;
  hunt?: Hunt | null;
}

export interface LessonStep {
  /** The prompt (a touch variant where the controls differ). */
  text: Key;
  touch?: Key;
  /** Done when this holds (checked every frame), or (`on`) once an event it waits for has happened while it's the step showing. */
  done?: (c: LessonCtx) => boolean;
  on?: (e: SimEvent, sim: Sim) => boolean;
  /** Where the floor arrows lead meanwhile (a tile), if anywhere, and on which layer (the ground floor unless it says). */
  goal?: (sim: Sim) => number | null;
  layer?: number;
  /** P41: in a lesson's manhunt, where the floor arrows lead (the tiles that will do), if anywhere. */
  huntGoal?: (h: Hunt) => ((i: number) => boolean) | null;
  /** The game runs faster while this step waits (time to pass, nothing to do). */
  speed?: number;
  /** Seconds it shows at least before it can tick (something to read in it; the lesson's card only, not tutorialtest). */
  least?: number;
  /** Why the lesson can't go on now (it ends, to be tried again), if it can't; null while it can. */
  fail?: (c: LessonCtx) => Key | null;
  /** Or an event that ends it (while it's the step showing): why, or null. */
  failOn?: (e: SimEvent, sim: Sim) => Key | null;
}

export interface Lesson {
  id: string;
  icon: string;
  /** Where it's played (the Training Block unless it says; Center Perks, always open, for what the Training Block hasn't got). */
  prison?: PrisonDef;
  /** The game's seed (fixed: trying again plays the same scene); 7 + its place in the list otherwise. */
  seed?: number;
  /** The warden's board and the HUD's day (P17) as in a game (lessons are quiet otherwise). */
  days?: boolean;
  /** false: the routine isn't what the lesson is about (on the roof after Lights Out): the HUD's routine pill shows the block alone, no place, no PENDING. */
  routine?: false;
  /** Guards whose ways the player knows from the start (as if heard in the yard: their talk panel says so). */
  known?: ReadonlyArray<{ guard: number; kind: 'corrupt' | 'strict' | 'lazy' }>;
  /**
   * P41: played outside, in the manhunt (the prison's own scene never shows): where the player
   * starts, the searchers out (their places in the outside's list), the head start (seconds),
   * the minute of the day, cousin Lou's car waiting. No roadblocks, no helicopter.
   */
  hunt?: { kind: StartKind; searchers: readonly number[]; headStart: number; minute: number; lou: boolean };
  /** Sets the scene on a fresh game (before its first step). */
  setup: (sim: Sim) => void;
  steps: LessonStep[];
}

export const tile = (x: number, z: number) => z * MAP_W + x;
/** The pay phone's lessons (P34): off once the phone shuts (free time over, a lockdown). */
export const phoneFail = (c: LessonCtx): Key | null => (phoneOpen(c.sim) ? null : 'lesson.payphone.shut');
/** The kiosk's lesson (P35): off once it shuts; logged out and walked off. */
export const kioskFail = (c: LessonCtx): Key | null => (kioskOpen(c.sim) ? null : 'lesson.kiosk.shut');
export const kioskLeft = (c: LessonCtx): Key | null => kioskFail(c) ?? (!loggedIn(c.sim.state) && !atKiosk(c.sim) ? 'lesson.kiosk.left' : null);
/** The odd jobs board's lesson (P40): on the board's own tile; where the job held's giver or target stands. */
export const onBoard = (sim: Sim) => {
  const b = sim.prison.board!;
  return Math.floor(sim.state.player.x / UNIT) === b.x && Math.floor(sim.state.player.z / UNIT) === b.z;
};
export function jobTile(sim: Sim, field: number): number | null {
  const job = jobOf(sim.state);
  const m = job ? sim.state.inmates[job[field]] : null;
  return m ? tileAt(m.body.x, m.body.z) : null;
}
export const n = (id: string) => itemNumber(id);
/** The minute of day 1 as a step (the game starts at 08:00). */
export const at = (hour: number, minute = 0) => ((hour - 8) * 60 + minute) * STEPS_PER_MINUTE;

/** Sets the clock (a step of day 1) and the block running then, already checked in. */
export function clockTo(sim: Sim, step: number) {
  const s = sim.state;
  s.step = step;
  s.routine = routineAt(clockAt(step).minuteOfDay);
  s.attended = true;
  s.blocks[s.routine] = BLOCK.ATTENDED;
}
/** Puts the player on a tile, facing a way (1 east, 5 south, 9 west, 13 north). */
export function place(sim: Sim, x: number, z: number, facing = 5) {
  const p = sim.state.player;
  p.x = x * UNIT + UNIT / 2;
  p.z = z * UNIT + UNIT / 2;
  p.facing = facing;
}
/** The pockets, in order (the rest emptied). */
export function pockets(sim: Sim, ...ids: string[]) {
  const inv = sim.state.items.inv;
  for (let k = 0; k < 6; k++) inv[k] = ids[k] ? slot(n(ids[k])) : 0;
}
/** The player's desk (container index). */
export const myDesk = (sim: Sim) => playerDesk(sim.world);
/** Empties a container, then puts items in from its first slot (hidden ones first). */
export function fill(sim: Sim, box: number, ...ids: string[]) {
  const c = sim.state.items.containers[box];
  c.fill(0);
  ids.forEach((id, k) => (c[k] = id ? slot(n(id)) : 0));
}
export const holds = (sim: Sim, id: string) => itemOf(sim.state.items.inv[sim.state.items.hand]) === n(id);
export const carries = (sim: Sim, id: string) => sim.state.items.inv.slice(0, 6).some((v) => itemOf(v) === n(id));
export const count = (sim: Sim, id: string) => sim.state.items.inv.slice(0, 6).filter((v) => itemOf(v) === n(id)).length;
export const zone = (z: string) => (c: LessonCtx) => c.sim.playerZone === z;
/** Lying on the floor somewhere (dropped, to be picked up again). */
export const onFloor = (sim: Sim, id: string) => sim.state.items.ground.some(([, v]) => itemOf(v) === n(id));
/** A hole of this kind in a wall of the player's cell. */
export const cellHole = (sim: Sim, kind: number) => sim.world.ground.kind.some((k, i) => k === kind && touchesMyCell(sim.world, i));

/** A quiet morning of free time: no block to keep, nothing due. */
export const MORNING = at(10, 30);

/** The nearest open floor tile to (x, z), searching outwards (the tile itself if it's open). */
export function near(sim: Sim, x: number, z: number): [number, number] {
  for (let r = 0; r < 6; r++)
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (isFloor(sim.world, x + dx, z + dz)) return [x + dx, z + dz];
      }
  return [x, z];
}
/** Someone's tile (a body in units). */
/** Tiles between two bodies, as the crow flies. */
export const apart = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z) / UNIT;
/** An inmate stood still somewhere, waiting for the player (the fight lesson's sparring partner). */
export function waitAt(sim: Sim, who: number, x: number, z: number, facing = 9) {
  const m = sim.state.inmates[who];
  m.body.x = x * UNIT + UNIT / 2;
  m.body.z = z * UNIT + UNIT / 2;
  m.goal = -1;
  m.plan = sim.state.routine;
  m.wait = 5 * 60 * STEPS_PER_MINUTE;
  m.body.facing = facing;
}
/** The other inmate's desk on the Training Block (Sparky's). */
export const sparkyDesk = (sim: Sim) => containersOf(sim.world).findIndex((c) => !c.mine && c.prop.kind === 'desk');

/** A Center Perks seed whose day-1 delivery search is a quick look (tutorialtest holds it to that). */
export const STOW_SEED = 51;
/** Center Perks' corrupt guard (P15): Officer Pratt. */
export const PRATT = 1;
/** The second prison day (P19: the dogs' first) at a step of the day (`at`). */
export const DAY_TWO = DAY_STEPS;

/** The seat before the parole board (P39). */
export const hearingSeat = (sim: Sim) => {
  const h = HEARINGS[sim.prison.id];
  return h ? tile(h.seat.x, h.seat.z) : null;
};
/** The parole lesson's dead ends: the hearing missed, walked out of, the board saying no. */
export function paroleLost(e: SimEvent): Key | null {
  if (e.type !== 'parole') return null;
  if (e.what === 'missed') return 'lesson.parole.late';
  if (e.what === 'walkedOut') return 'lesson.parole.walked';
  return e.what === 'denied' ? 'lesson.parole.denied' : null;
}
/** The manhunt's lesson (P41): tiles from where the player came over the wall. */
export function huntWalked(h: Hunt): number {
  const a = h.tile;
  return Math.max(Math.abs((a % MAP_W) - (h.start % MAP_W)), Math.abs(Math.floor(a / MAP_W) - Math.floor(h.start / MAP_W)));
}
/** A searcher out within this many tiles of the player. */
export function searcherWithin(h: Hunt, tiles: number): boolean {
  const p = h.state.player;
  return h.state.searchers.some((m) => m.mode !== SEEK.OFF && Math.hypot(m.body.x - p.x, m.body.z - p.z) <= tiles * UNIT);
}
/** The searcher came close while the player kept hidden, then went on by: well away again, the player still in cover. */
export const passing = new WeakMap<Hunt, boolean>();
export function goneBy(h: Hunt): boolean {
  if (h.state.hidden && searcherWithin(h, 6)) passing.set(h, true);
  return !!passing.get(h) && h.out.cover[h.tile] === 1 && !searcherWithin(h, 9);
}
/** The washing lines not yet used, as tiles beside them (within reach of the clothes). */
export function lineGoal(h: Hunt): ((i: number) => boolean) | null {
  const at = h.def.lines.filter((_, k) => !(h.state.lines & (1 << k))).map((l) => spotTile(l, h.out.ox, h.out.oz));
  return at.length ? (i) => at.includes(i) : null;
}
/** Recaptured: the lesson is tried again. */
export function huntCaught(c: LessonCtx): Key | null {
  return c.hunt?.state.over === OVER.CAUGHT ? 'lesson.manhunt.caught' : null;
}

/** The release desk's first tile (P36). */
export const releaseTile = (sim: Sim) => {
  const q = sim.prison.comms!.release.at[0];
  return tile(q.x, q.z);
};
/** The forgery lesson's dead end: 22:00 and no form in the tray. */
export function forgeryLate(c: LessonCtx): Key | null {
  return !c.sim.state.release[0] && dayMinute(c.sim.state.step) >= RECORDS_MINUTE ? 'lesson.forgery.late' : null;
}
/** The release lesson's dead ends, each saying why: turned away at the desk (heat, contraband, a lockdown), not reported by 10:30. */
export function releaseTurned(e: SimEvent): Key | null {
  if (e.type !== 'paper') return null;
  if (e.what === 'turnedAway') return `lesson.release.turned.${e.why ?? 'heat'}` as Key;
  return e.what === 'missed' ? 'lesson.release.late' : null;
}
/** Cleared, and the doors shut again before the player was out. */
export function releaseShut(c: LessonCtx): Key | null {
  const s = c.sim.state;
  return !s.escaped && !freedNow(s) ? 'lesson.release.shut' : null;
}

/** Whether a lookout posted on a tile would ever see a guard's round (any tile of it within WATCH_RANGE and in sight). */
export function seesRound(sim: Sim, post: number, guard: number): boolean {
  const beat = sim.prison.guards[guard].beat;
  const from = centre(post);
  for (let k = 0; k < beat.length; k++) {
    const a = beat[k];
    const b = beat[(k + 1) % beat.length];
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.z - a.z), 1);
    for (let j = 0; j <= n; j++) {
      const to = centre(Math.round(a.z + ((b.z - a.z) * j) / n) * MAP_W + Math.round(a.x + ((b.x - a.x) * j) / n));
      if (apart(from, to) <= WATCH_RANGE && lineOfSight(sim.world, from.x, from.z, to.x, to.z)) return true;
    }
  }
  return false;
}

/** A Center Perks merchant (the first in its list: an inmate whose stall opens in free time). */
export function merchantAt(sim: Sim): number {
  return inmateInCell(sim.state, sim.prison.merchants[0]);
}
/** The talk lesson's dead end: the magazine for the favor gone (given away, dropped) with none left in the desk. */
export function talkFail(c: LessonCtx): Key | null {
  const it = c.sim.state.items;
  const mag = n('magazine');
  const somewhere = it.inv.some((v) => itemOf(v) === mag) || it.containers.some((box, k) => box.some((v) => itemOf(v) === mag) && containersOf(c.sim.world)[k]?.mine) || it.ground.some(([, v]) => itemOf(v) === mag);
  if (favorPaid(c.sim)) return null;
  // (Left untaken overnight, his favor lapses: something else asked for, or nothing.)
  if (!magazineFavor(c.sim)) return 'lesson.talk.lapsed';
  return !somewhere ? 'lesson.talk.lost' : null;
}
/** Sparky's favor in the talk lesson: a magazine, while it's still on. */
export const magazineFavor = (sim: Sim) => sim.state.favors.find((f) => f.by === 0 && f.item === n('magazine'));
/** A favor handed in and paid (the ledger counts them). */
export const favorPaid = (sim: Sim) => sim.state.feats[FEAT.favors] > 0;
/** The trade lesson's dead end: the stalls shut (free time over). */
export function tradeFail(c: LessonCtx): Key | null {
  return !c.sim.shopsOpen ? 'lesson.trade.closed' : null;
}
/** The job lesson's dead end: the Work Period over without a load done. */
/** The tunnel lesson: up on the ground outside the fence (any side of it). */
export function outside(sim: Sim): boolean {
  const zone = sim.playerZone;
  return sim.state.layer === LAYER.GROUND && (zone === 'perimeter' || zone === 'outside');
}
/** The tunnel lesson: dug up inside the fence (never a hole dug down, nor climbing back out through the desk). */
export function upInside(e: SimEvent, sim: Sim): Key | null {
  return e.type === 'layer' && e.how === 'digUp' && !outside(sim) ? 'lesson.tunnel.early' : null;
}
/** The laps lesson (P31): free time over with the sports field's gate shut (the lesson can't go on). */
export function lapsFail(c: LessonCtx): Key | null {
  return OPEN_HOURS.sports!.includes(ROUTINE[c.sim.state.routine].id) || c.sim.state.lockdown ? null : 'lesson.laps.late';
}
/** The machine of a job's room nearest the player (the gardener's planters, P31). */
export function nearestMachine(sim: Sim, job: number): number {
  const p = sim.state.player;
  const d2 = (i: number) => {
    const q = sim.world.props[i];
    return ((q.x + q.w / 2) * UNIT - p.x) ** 2 + ((q.z + q.d / 2) * UNIT - p.z) ** 2;
  };
  return jobRooms(sim.world)[job].machines.reduce((a, b) => (d2(b) < d2(a) ? b : a));
}
/** The track's next corner on the lap under way (P31), else the nearest one to begin from. */
export function nextCorner(sim: Sim): number | null {
  const r = sim.prison.leisure?.track;
  if (!r) return null;
  const corners = cornersOf(r);
  const lap = sim.state.lap;
  if (lap.length) {
    const c = corners[(lap[1] + (lap[2] || 1) + 4) % 4];
    return c.z * MAP_W + c.x;
  }
  const p = sim.state.player;
  const best = corners.reduce((a, b) => ((a.x + 0.5) * UNIT - p.x) ** 2 + ((a.z + 0.5) * UNIT - p.z) ** 2 <= ((b.x + 0.5) * UNIT - p.x) ** 2 + ((b.z + 0.5) * UNIT - p.z) ** 2 ? a : b);
  return best.z * MAP_W + best.x;
}
export function jobFail(c: LessonCtx): Key | null {
  return ROUTINE[c.sim.state.routine].id !== 'work' && c.sim.state.quota === 0 ? 'lesson.job.late' : null;
}
/** An open floor tile beside a prop (where the player stands to use it), the first found round it. */
export function besideProp(sim: Sim, prop: number): number | null {
  const p = sim.world.props[prop];
  if (!p) return null;
  for (let x = p.x; x < p.x + p.w; x++)
    for (const z of [p.z - 1, p.z + p.d]) if (isFloor(sim.world, x, z)) return z * MAP_W + x;
  for (let z = p.z; z < p.z + p.d; z++) for (const x of [p.x - 1, p.x + p.w]) if (isFloor(sim.world, x, z)) return z * MAP_W + x;
  return null;
}
/** Where the player stands to work at their desk: below it if that's open floor (the Training Block's chair is at its side), else beside it. */
export function deskStand(sim: Sim): number {
  const below = deskTile(sim) + MAP_W;
  return isFloor(sim.world, below % MAP_W, Math.floor(below / MAP_W)) ? below : placesOf(sim.world).deskside[1];
}
/** The laundry machine with a load in it (the first, if none has). */
export function loadedMachine(sim: Sim, job = LAUNDRY): number {
  const room = jobRooms(sim.world)[job];
  return room.machines.find((i) => sim.state.machines[i] !== undefined) ?? room.machines[0];
}
/** Center Perks' laundry job (its place in the jobs list), and its gardener's (P31). */
export const LAUNDRY = 0;
export const GARDENER = CENTER_PERKS.jobs.findIndex((j) => j.id === 'gardener');
/** A machine at work in the player's job room (a load in it). */
export function machineOn(sim: Sim, job = LAUNDRY): boolean {
  const room = jobRooms(sim.world)[job];
  return !!room && room.machines.some((i) => sim.state.machines[i] !== undefined);
}
/** The player's desk's tile (where a tunnel's entrance goes, under it). */
export function deskTile(sim: Sim): number {
  const p = containersOf(sim.world)[myDesk(sim)].prop;
  return p.z * MAP_W + p.x;
}
/** The delivery's vehicle's tail (where the player climbs in). */
export function tailOf(sim: Sim): number {
  return sim.prison.delivery!.tail.z * MAP_W + sim.prison.delivery!.tail.x;
}
/** The stowaway lesson's dead end: the vehicle gone without the player. */
export function stowFail(c: LessonCtx): Key | null {
  const s = c.sim.state;
  if (s.escaped || s.stowed) return null;
  // (From the sign-off on the supervisor stands at the tail: nobody climbs in unseen any more.)
  const p = planOf(c.sim);
  return dayMinute(s.step) >= searchMinute(p) - SIGN_OFF_MINUTES || (!vehicleIn(c.sim) && dayMinute(s.step) > p.at) ? 'lesson.stowaway.missed' : null;
}
/** The lockpick lesson's dead end: the lockpick broken before the door is open. */
export function pickFail(c: LessonCtx): Key | null {
  // (Dropped, it lies there to pick up again.)
  return !carries(c.sim, 'lockpick') && !onFloor(c.sim, 'lockpick') && !c.sim.state.picked.length && c.sim.playerZone !== 'generator' ? 'lesson.lockpick.broke' : null;
}
/** The bluff lesson's dead end: the shift change over and the player not waved through. */
export function bluffFail(c: LessonCtx): Key | null {
  const s = c.sim.state;
  return !s.waved && !s.escaped && clockAt(s.step).minuteOfDay >= SHIFT_TO ? 'lesson.bluff.late' : null;
}
/** The glider lesson's dead end: glided and come down inside (the glider wrecked). */
export function glideFail(c: LessonCtx): Key | null {
  if (c.sim.state.escaped) return null;
  // (Dropped on the roof, it lies there to pick up again.)
  if (!carries(c.sim, 'glider') && !onFloor(c.sim, 'glider')) return 'lesson.glider.inside';
  return c.sim.state.lockdown ? 'lesson.glider.lockdown' : null;
}
/** The guards lesson's dead ends: the heat cooled off by itself (nothing left to pay off), or the money spent elsewhere. */
export function guardsFail(c: LessonCtx): Key | null {
  if (c.sim.state.heat <= 0) return 'lesson.guards.cooled';
  return c.sim.state.cash < 40 ? 'lesson.guards.broke' : null;
}
/** The rat lesson's dead ends before it's tame: the caught rat gone from the pockets (thrown, dropped), or nothing left to feed it. */
export function ratFail(c: LessonCtx): Key | null {
  const s = c.sim.state;
  if (petOf(s)) return null;
  if (!carries(c.sim, 'caught_rat')) return 'lesson.rat.lost';
  return baitSlot(s.items.inv) < 0 ? 'lesson.rat.hungry' : null;
}
/** The games lesson's dead end: free time over (and no game on the table) before it's through. */
/** A hand of Cheat folded (walked away from) or broken off: the lesson can't go on. */
export function cheatOff(e: SimEvent): Key | null {
  return e.type === 'cheat' && (e.what === 'folded' || e.what === 'off') ? 'lesson.cards.folded' : null;
}
/** A spot on the court, as a tile. */
export function spotOn(sim: Sim, k: number): number {
  const q = sim.prison.leisure!.hoop.spots[k];
  return tile(q.x, q.z);
}

/** Bags of pruno in the player's own desk and toilet tank. */
export function bagsHidden(sim: Sim): number {
  const list = containersOf(sim.world);
  let k = 0;
  list.forEach((c, i) => {
    if (c.mine && (c.prop.kind === 'desk' || c.prop.kind === 'toilet')) for (const v of sim.state.items.containers[i]) if (itemOf(v) === n('pruno_bag')) k++;
  });
  return k;
}
/** The garden lesson's wilted bed (the plot's last). */
export const wiltedBed = (sim: Sim) => {
  const g = sim.prison.leisure!.garden;
  return g.w * g.d - 1;
};
/** A garden bed's tile, a row (dz) off it: where to stand to face it. */
export function gardenBed(sim: Sim, k: number, dz: number): number {
  const g = sim.prison.leisure!.garden;
  return tile(g.x + (k % g.w), g.z + Math.floor(k / g.w) + (dz > 0 ? g.d - Math.floor(k / g.w) : -1 - Math.floor(k / g.w)));
}
/** Tonight's race as the state has it (races.ts RACE: 1 the lane bet on, 4 entered), -1 none today. */
export function raceState(sim: Sim, k: number): number {
  const r = sim.state.race;
  return r[0] === prisonDay(sim.state.step) ? r[k] : -1;
}
/** Past the off (the card down for tonight). */
export const pastOff = (sim: Sim) => dayMinute(sim.state.step) >= RACE_MINUTE - ROUTINE[0].start && !cardUp(sim);
/** The race lesson's dead end: past the off with no bet placed, or no cash to bet. */
export function raceFail(c: LessonCtx): Key | null {
  if (raceState(c.sim, 1) >= 0) return null;
  if (pastOff(c.sim)) return 'lesson.ratRace.late';
  return c.sim.state.cash < 5 ? 'lesson.ratRace.broke' : null;
}
/** The track's first tile (the arrows). */
export const trackStart = (sim: Sim) => {
  const r = sim.prison.leisure!.race;
  return tile(r.x, r.z);
};

/** Up from the old-timer's board with free time over: no sitting down again until the next. */
export function boardFail(c: LessonCtx): Key | null {
  return !c.sim.state.board?.seated && !gamesOpen(c.sim) ? 'lesson.games.closed' : null;
}

/** Why the games can't go on (free time over, nothing under way). */
export function gamesFail(c: LessonCtx): Key | null {
  return !gamesOpen(c.sim) && !gameOn(c.sim.state) ? 'lesson.games.closed' : null;
}

/** A tile's middle (units), to measure from. */
export const centre = (t: number) => ({ x: centerX(t), z: centerZ(t) });
/** The drone's order gone wrong: turned back for tomorrow night (a guard watching where it would land), or seized where it fell. */
export function smuggleFail(sim: Sim): Key | null {
  const s = sim.state;
  if (s.order.length === 3 && s.order[2] > prisonDay(s.step)) return 'lesson.smuggle.turned';
  if (!s.order.length && !s.drops.length && !carries(sim, 'battery')) return 'lesson.smuggle.seized';
  return null;
}

/** The football lesson's dead ends: the match off (gone from the pitch, the sirens), a foul, the whistle before a kick. */
/** The stage's own tile (where the performer stands). */
export const stageTile = (sim: Sim) => {
  const st = sim.prison.leisure?.stage;
  return st ? tile(st.x, st.z) : null;
};
/** The quiz walked away from or given up. */
export function quizFail(e: SimEvent): Key | null {
  return e.type === 'quiz' && (e.what === 'off' || e.what === 'quit') ? 'lesson.quiz.off' : null;
}
export function matchFail(e: SimEvent): Key | null {
  if (e.type !== 'football') return null;
  if (e.what === 'off') return 'lesson.football.off';
  if (e.what === 'foul') return 'lesson.football.foul';
  if (e.what === 'won' || e.what === 'lost' || e.what === 'draw') return 'lesson.football.noKick';
  return null;
}
/** The net the player's side shoots at (the far end's middle tile). */
export function farNet(sim: Sim): number | null {
  const p = sim.prison.leisure?.pitch;
  if (!p || !sim.state.match) return null;
  return p.w >= p.d ? tile(p.x + p.w - 1, p.z + Math.floor(p.d / 2)) : tile(p.x + Math.floor(p.w / 2), p.z + p.d - 1);
}
/** The tattoo lesson's dead ends: the makings gone (the gun not made and its parts gone; no ink left for what's still to do). */
export function inkFail(c: LessonCtx): Key | null {
  const sim = c.sim;
  if (sim.state.ink) return null;
  const gun = carries(sim, 'tattoo_gun') || (carries(sim, 'toothbrush') && carries(sim, 'battery') && carries(sim, 'razor_blade'));
  if (!gun) return 'lesson.tattoo.noGun';
  if (!carries(sim, 'ink')) return 'lesson.tattoo.noInk';
  return null;
}
/** A sitting given up or broken off. */
export function inkOff(e: SimEvent): Key | null {
  return e.type === 'tattoo' && (e.what === 'quit' || e.what === 'off') ? 'lesson.tattoo.off' : null;
}
