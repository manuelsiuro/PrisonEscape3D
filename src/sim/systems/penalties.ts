/**
 * Penalties (2.44, in the place of P29's football match; docs/decisions/free-time.md): the pitch's
 * far goal (its `a1` end) and the spot SPOT_OUT before it.
 *
 * A shootout (TALK.PENALTIES, with an inmate at the pitch in the games' hours; one of the day's
 * games): five kicks each, the player first, then a pair at a time once level (SUDDEN at most, then a
 * draw), over as soon as one side can't be caught; at the bell for the next block (the games' hours
 * over) it ends as it stands, called off when nobody's won it yet. The shootout walks the two to
 * their places (the kicker behind the ball, the keeper on his line): the player's moves aren't
 * theirs meanwhile.
 *
 * The player's kick (EXT.KICK 0): a marker sweeps across the goal (`aimAt`, slower with Speed) and
 * the ball goes where it stood (that step or the one before, whichever is inside the posts). The
 * inmate in goal dives by roll(): staying saves the middle, a dive the right way saves out to his
 * reach, and a corner past it is a goal; past the post it's the post, then wide.
 *
 * Keeping goal (EXT.KICK 2, c: 0 left, 1 stay, 2 right, as the kicker sees it): the inmate's run-up
 * takes RUN_UP steps; he looks at a corner first (where he'll put it, LOOK_TRUE times in 100). A
 * dive more than DIVE_EARLY steps before his kick shows him the way: he puts it the other way.
 * The player's reach grows with Speed.
 *
 * On one's own (who -1): a press at the spot in the yard's open hours puts the ball down; the same
 * marker and an empty net; CORNERS_A_DAY goals in a corner are worth a point of Speed.
 *
 * The cover: guards outdoors near a shootout watch the kicks (sightFor: anything off the pitch at
 * half their range); a goal turns them to the net a moment. Won: the loser's respect, the crowd's,
 * a point of Speed, a win towards sports day. Everything here is a pure function of the state and
 * roll(): the card shows what the rule judges.
 */
import { CROWD_RANGE, GAME_BLOCKS, SPORTS_WINS } from '../../content/games';
import {
  AFTER_KICK,
  AIM_PACE,
  AIM_PACE_SLOW,
  AIM_POST,
  AIM_SETTLE,
  AIM_SWEEP,
  AIM_WIDE,
  CENTRE,
  CORNER,
  CORNERS_A_DAY,
  DIVE_EARLY,
  DIVE_IN,
  FLIGHT,
  GOAL_LOOK,
  KEEP_BASE,
  KEEP_PER_SPEED,
  KEEPER_BASE,
  KEEPER_SPREAD,
  KICK_CLOCK,
  KICK_NOISE,
  LOOK_TRUE,
  MISS_BASE,
  MISS_SPREAD,
  MOUTH_HALF,
  PEN_CROWD_OPINION,
  PEN_KICKS,
  PEN_LEAVE,
  PEN_PLAY_OPINION,
  PEN_RANGE,
  PEN_WIN_OPINION,
  PLACES_STEPS,
  RUN_UP,
  SPOT_NEAR,
  SPOT_OUT,
  STAY_ODDS,
  STAY_REACH,
  SUDDEN,
  YARD_EYES,
} from '../../content/penalties';
import type { Pitch } from '../../content/prisons/types';
import { ROUTINE, routineEnd } from '../../content/routine';
import { nearestDir } from '../ai/path';
import { lineOfSight } from '../ai/sight';
import type { SimContext } from '../context';
import { ATTRS } from '../events';
import { rollInt, SALT } from '../rng';
import type { SimState } from '../state';
import { ATTR_MAX, UNIT, walkSpeed } from '../tuning';
import { TILE_INFO } from '../world/tiles';
import { LAYER, MAP_W } from '../world/World';
import { sightOf } from './calendar';
import { clockAt, prisonDay } from './clock';
import { countGame, gameOn, gameRefusal, sportsPrizeIfDue, sportsWin } from './games';
import { awake, GUARD, type Guard } from './guards';
import { DOING } from './inmates';
import { bodyAt, type Body } from './movement';
import { makeNoise } from './noise';
import { changeOpinion, endTalk, refuse } from './social';
import { stopTraining } from './training';

/** A shootout (or kicks on one's own) under way: plain data in the state. */
export interface Pens {
  /** The inmate (index); -1 kicks on one's own at the empty net. */
  who: number;
  /** The kick pair under way (0–4, then sudden death). */
  k: number;
  /** Goals each (bit per pair): the player's, the inmate's. */
  mine: number;
  theirs: number;
  /** Whose kick: 0 the player's, 1 the inmate's. */
  turn: number;
  /** PH: walking to places, set (the marker sweeping, or his run-up), the ball in the air, the result shown. From step `at`. */
  phase: number;
  at: number;
  /** Where the kick goes across the goal (-AIM_POST the kicker's left post … AIM_POST the right; past them the post, then wide). */
  aim: number;
  /** The keeper's dive: -1 left, 0 stays, 1 right (as the kicker sees it); the player's step of it when keeping (0 none yet). */
  dive: number;
  dived: number;
  /** The inmate kicking: the corner he looks at first (-1, 1). The player kicking: where the marker starts. */
  look: number;
  /** How the kick went (KICK): set as it's struck, shown as the ball arrives. */
  result: number;
}

/** A shootout's phases. */
export const PH = { PLACES: 0, SET: 1, FLIGHT: 2, AFTER: 3 } as const;
/** How a kick goes: a goal, saved, off the post, wide. */
export const KICK = { NONE: 0, GOAL: 1, SAVED: 2, POST: 3, WIDE: 4 } as const;
export type KickResult = (typeof KICK)[keyof typeof KICK];
/** What the 'pens' event says. */
export type PensNews = 'bell' | 'start' | 'kick' | 'result' | 'won' | 'lost' | 'draw' | 'off' | 'practice' | 'corners';

// ------------------------------------------------------------------ the pitch's goal and spot

/** The prison's pitch (null: none; a replay of before 2.5.1, where it was then: Sim.rules250). */
export const pitchOf = (sim: Pick<SimContext, 'world'> & { rules250?: boolean }): Pitch | null =>
  (sim.rules250 ? sim.world.def.leisure?.pitchWas : null) ?? sim.world.def.leisure?.pitch ?? null;

/**
 * The goal and its spot, in units: the way the kick goes (`along` x, else z, towards +), the goal
 * line `line` (where the far net's tile begins), the spot `spot` before it, the mouth's middle `mid`
 * across; `left`: which way across is the kicker's left (-1 or 1).
 */
export interface Goal {
  along: boolean;
  line: number;
  spot: number;
  mid: number;
  left: number;
}
export function goalOf(p: Pitch): Goal {
  const along = p.w >= p.d;
  const line = along ? (p.x + p.w - 1) * UNIT : (p.z + p.d - 1) * UNIT;
  const mid = along ? (p.z + Math.floor(p.d / 2)) * UNIT : (p.x + Math.floor(p.w / 2)) * UNIT;
  // (Kicking east the kicker's left is north, -z; kicking south it's east, +x.)
  return { along, line, spot: line - SPOT_OUT, mid, left: along ? -1 : 1 };
}
/** A point at a place along the kick's way and across it. */
export function goalPoint(g: Goal, a: number, l: number, out: { x: number; z: number }) {
  out.x = g.along ? a : l;
  out.z = g.along ? l : a;
  return out;
}
/** Where an aim crosses the goal line, across (units). */
export const acrossOf = (g: Goal, aim: number) => g.mid + Math.trunc((-g.left * aim * MOUTH_HALF) / AIM_POST);

/** Whether a tile is on the pitch (its rectangle, the nets' end tiles too). */
export function onPitch(p: Pitch, x: number, z: number): boolean {
  const tx = Math.floor(x / UNIT);
  const tz = Math.floor(z / UNIT);
  return tx >= p.x && tx < p.x + p.w && tz >= p.z && tz < p.z + p.d;
}
/** How far (tiles, the larger way) a point is from the pitch's rectangle (0 on it). */
export function offBy(p: Pitch, x: number, z: number): number {
  const tx = Math.floor(x / UNIT);
  const tz = Math.floor(z / UNIT);
  return Math.max(p.x - tx, tx - (p.x + p.w - 1), p.z - tz, tz - (p.z + p.d - 1), 0);
}

/** The box a shootout's camera keeps in the picture (tiles): from a tile behind the spot to the net's back, two tiles either side of the mouth. */
export function shootoutBox(p: Pitch): Pitch {
  const g = goalOf(p);
  const a0 = Math.floor(g.spot / UNIT) - 1;
  const a1 = Math.floor(g.line / UNIT) + 1;
  const l0 = Math.floor(g.mid / UNIT) - 2;
  return g.along ? { x: a0, z: l0, w: a1 - a0 + 1, d: 4 } : { x: l0, z: a0, w: 4, d: a1 - a0 + 1 };
}

/** The places: the kicker behind the ball (KICKER_BACK), the keeper on his line (KEEPER_IN in from the net's tile). */
const KICKER_BACK = 560;
const KEEPER_IN = 200;
/** The inmate's run-up: from RUN_FROM behind the ball, over the run-up's last RUN steps. */
const RUN_FROM = 1300;
const RUN = 14;
const scratch = { x: 0, z: 0 };
const net = { x: 0, z: 0 };

/** The kicker's place (units). */
export const kickerPlace = (g: Goal, out: { x: number; z: number }, back = KICKER_BACK) => goalPoint(g, g.spot - back, g.mid, out);
/** The keeper's place (units). */
export const keeperPlace = (g: Goal, out: { x: number; z: number }) => goalPoint(g, g.line - KEEPER_IN, g.mid, out);

/** The player is at the spot (on the ground floor, up and about). */
export function atSpot(sim: SimContext): boolean {
  const p = pitchOf(sim);
  const s = sim.state;
  if (!p || s.layer !== LAYER.GROUND || sim.away || s.stowed) return false;
  const g = goalOf(p);
  kickerPlace(g, scratch);
  return Math.abs(s.player.x - scratch.x) <= SPOT_NEAR && Math.abs(s.player.z - scratch.z) <= SPOT_NEAR;
}

// ------------------------------------------------------------------ the aim and the save

/** The marker's pace (aim units a step) at a Speed. */
export const aimPace = (spd: number) => AIM_PACE - Math.floor((spd * AIM_PACE_SLOW) / 100);

/** Where the marker is `t` steps into its sweep, from `start` (both ways, -AIM_SWEEP … AIM_SWEEP and back). */
export function aimAt(t: number, start: number, pace: number): number {
  const span = 2 * AIM_SWEEP;
  const p = (((start + AIM_SWEEP + Math.max(0, t) * pace) % (2 * span)) + 2 * span) % (2 * span);
  return (p <= span ? p : 2 * span - p) - AIM_SWEEP;
}

/** The marker now in a shootout's set phase (or kicks on one's own), from the state. */
export function markerOf(o: Pens, step: number, spd: number): number {
  return aimAt(step - o.at - AIM_SETTLE, o.look, aimPace(spd));
}

/** How a kick at an aim goes against a keeper's dive (0 an empty net: never saved) and reach. */
export function judgeKick(aim: number, dive: number, reach: number, keeper = true): KickResult {
  const a = Math.abs(aim);
  if (a > AIM_WIDE) return KICK.WIDE;
  if (a > AIM_POST) return KICK.POST;
  if (!keeper) return KICK.GOAL;
  if (dive === 0) return a <= STAY_REACH ? KICK.SAVED : KICK.GOAL;
  return Math.sign(aim) === dive && a >= DIVE_IN && a <= reach ? KICK.SAVED : KICK.GOAL;
}
/** A kick in a corner: past a keeper's least reach, inside the post. */
export const inCorner = (aim: number) => Math.abs(aim) > KEEPER_BASE && Math.abs(aim) <= AIM_POST;

/** An inmate's reach in goal (drawn once for the run, by cell). */
export const keeperReach = (salt: number, cell: number) => KEEPER_BASE + rollInt(salt, SALT.PENS, cell, 0, KEEPER_SPREAD + 1);
/** The player's reach in goal. */
export const playerReach = (spd: number) => KEEP_BASE + Math.floor((spd * KEEP_PER_SPEED) / 100);
/** How often an inmate misses (out of 100, by cell). */
const missOf = (salt: number, cell: number) => MISS_BASE + rollInt(salt, SALT.PENS, cell, 1, MISS_SPREAD + 1);

/** Goals, from a shootout's bits. */
export function goals(bits: number): number {
  let n = 0;
  for (let b = bits; b; b &= b - 1) n++;
  return n;
}

// ------------------------------------------------------------------ the cover

/**
 * A shootout is on and a guard is watching it: awake and on duty, outdoors near the pitch, the
 * spot in plain view (a guard round a corner doesn't watch what he can't see).
 */
export function watchingPens(sim: Pick<SimContext, 'world' | 'state'>, g: Guard): boolean {
  const s = sim.state;
  const p = pitchOf(sim);
  const o = s.pens;
  if (!p || !o || o.who < 0 || !awake(g) || g.mode !== GUARD.DUTY) return false;
  const tx = Math.floor(g.body.x / UNIT);
  const tz = Math.floor(g.body.z / UNIT);
  if (!TILE_INFO[sim.world.ground.kind[tz * MAP_W + tx]].outdoor || offBy(p, g.body.x, g.body.z) > YARD_EYES) return false;
  const goal = goalOf(p);
  goalPoint(goal, goal.spot, goal.mid, scratch);
  return lineOfSight(sim.world, g.body.x, g.body.z, scratch.x, scratch.z);
}

/** How far a guard sees a point now (units): its sight today, halved for a point off the pitch while it watches a shootout. */
export function sightFor(sim: SimContext, g: Guard, x: number, z: number): number {
  const r = sightOf(sim, g);
  const p = pitchOf(sim);
  return p && watchingPens(sim, g) && !onPitch(p, x, z) ? Math.floor(r / 2) : r;
}

// ------------------------------------------------------------------ starting

/** Why a shootout can't start with an inmate now (null: it can). */
export function pensRefusal(sim: SimContext, who: number): ReturnType<typeof gameRefusal> | 'noPitch' | 'crewBusy' {
  const s = sim.state;
  const p = pitchOf(sim);
  const m = s.inmates[who];
  if (!p || !m) return 'noPitch';
  const why = gameRefusal(sim, who);
  if (why) return why;
  if (s.layer !== LAYER.GROUND || offBy(p, s.player.x, s.player.z) > PEN_RANGE || offBy(p, m.body.x, m.body.z) > PEN_RANGE)
    return 'noPitch';
  if (s.crew.some((e) => e[0] === who && e[1] !== 0)) return 'crewBusy';
  // (The shootout walks the player straight to the spot: from a pocket walled off from it, not from here.)
  const g = goalOf(p);
  kickerPlace(g, scratch);
  if (!lineOfSight(sim.world, s.player.x, s.player.z, scratch.x, scratch.z)) return 'noPitch';
  return null;
}

/** A fresh shootout, or kicks on one's own (who -1). */
function newPens(who: number, step: number, look: number): Pens {
  return {
    who,
    k: 0,
    mine: 0,
    theirs: 0,
    turn: 0,
    phase: who < 0 ? PH.SET : PH.PLACES,
    at: step,
    aim: 0,
    dive: 0,
    dived: 0,
    look,
    result: 0,
  };
}

/** A shootout with the inmate the player is talking to (TALK.PENALTIES): the two walk to their places. */
export function startPens(sim: SimContext, who: number) {
  const s = sim.state;
  if (gameOn(s) || !pitchOf(sim)) return;
  const why = pensRefusal(sim, who);
  if (why) return refuse(sim, why);
  countGame(sim, who);
  stopTraining(sim);
  endTalk(sim);
  const m = s.inmates[who];
  m.wait = 0;
  m.path = [];
  s.pens = newPens(who, s.step, 0);
  s.player.moving = false;
  sim.events.push({ type: 'pens', what: 'start', who });
}

/** Game minutes until the games' hours end (the bell that ends a shootout: the next blocks of free time run on). */
export function minutesLeft(s: Pick<SimState, 'routine' | 'step'>): number {
  const now = clockAt(s.step).minuteOfDay;
  let k = s.routine;
  let end = routineEnd(k);
  for (let n = 0; n < ROUTINE.length && GAME_BLOCKS.includes(ROUTINE[(k + 1) % ROUTINE.length].id); n++) {
    k = (k + 1) % ROUTINE.length;
    end = routineEnd(k);
  }
  return (end - now + 1440) % 1440;
}

/** The yard is open for a kick: no sirens, not the night. */
const yardOpen = (s: SimState) => !s.lockdown && ROUTINE[s.routine].id !== 'lightsOut';

/** A ball may be put down at the spot now, on one's own (the card offers it, Space takes it): the yard open, nothing else on, at the spot. */
export const canPractise = (sim: SimContext) => !!pitchOf(sim) && yardOpen(sim.state) && !busy(sim.state) && atSpot(sim);

/** Something else the player is busy with (locked on in a fight too): no kicks on one's own then. */
const busy = (s: SimState) =>
  s.lock >= 0 ||
  s.shot.length > 0 ||
  s.bout.length > 0 ||
  s.pick.length > 0 ||
  !!s.cheat ||
  !!s.ink ||
  s.seat >= 0 ||
  s.train >= 0 ||
  s.sleeping ||
  gameOn(s);

// ------------------------------------------------------------------ the player's commands

/** EXT.KICK: b 0 the kick; 2 a dive (c: 0 left, 1 stay, 2 right); 3 leave the shootout (or the spot). */
export function pensCommand(sim: SimContext, b: number, c: number) {
  const s = sim.state;
  const o = s.pens;
  // (On one's own: the first press at the spot puts the ball down, the marker off.)
  if (!o) {
    if (b === 0 && canPractise(sim)) {
      s.pens = newPens(-1, s.step, rollInt(s.salt, SALT.PENS, s.step, 7, 2 * AIM_SWEEP) - AIM_SWEEP);
      s.player.moving = false;
      sim.events.push({ type: 'pens', what: 'practice', who: -1 });
    }
    return;
  }
  if (b === 3) return o.who < 0 ? void (s.pens = null) : endPens(sim, 'off');
  if (o.phase !== PH.SET) return;
  if (b === 0 && o.turn === 0) return playerKick(sim, o);
  if (b === 2 && o.turn === 1 && !o.dived && c <= 2) {
    o.dive = c - 1;
    o.dived = s.step;
  }
}

/** The player's kick: at the marker (this step's or the last's, whichever is inside the posts). */
function playerKick(sim: SimContext, o: Pens) {
  const s = sim.state;
  if (s.step - o.at < AIM_SETTLE) return;
  const a = markerOf(o, s.step, s.spd);
  const b = markerOf(o, s.step - 1, s.spd);
  const aim = Math.abs(a) > AIM_POST && Math.abs(b) <= AIM_POST && s.step - 1 - o.at >= AIM_SETTLE ? b : a;
  const m = o.who >= 0 ? s.inmates[o.who] : null;
  // The inmate in goal dives by roll() as it's struck.
  const r = m ? rollInt(s.salt, SALT.PENS, s.step, 2, 100) : 0;
  o.dive = !m ? 0 : r < STAY_ODDS ? 0 : r % 2 === 0 ? -1 : 1;
  o.aim = aim;
  o.result = judgeKick(aim, o.dive, m ? keeperReach(s.salt, m.cell) : 0, !!m);
  struck(sim, o);
}

/** A kick struck (either side's): the thud, the ball away (`early`: his, the other way from a dive he saw coming). */
function struck(sim: SimContext, o: Pens, early = false) {
  const s = sim.state;
  o.phase = PH.FLIGHT;
  o.at = s.step;
  const p = pitchOf(sim)!;
  const g = goalOf(p);
  goalPoint(g, g.spot, g.mid, scratch);
  makeNoise(sim, 'thud', LAYER.GROUND, Math.floor(scratch.z / UNIT) * MAP_W + Math.floor(scratch.x / UNIT), KICK_NOISE);
  sim.events.push({ type: 'pens', what: 'kick', who: o.who, by: o.turn === 0 ? -1 : o.who, aim: o.aim, dive: o.dive, early });
}

// ------------------------------------------------------------------ the inmate's kick

/** His kick planned as his run-up starts: where it goes, and the corner he looks at. */
function planKick(sim: SimContext, o: Pens) {
  const s = sim.state;
  const m = s.inmates[o.who];
  const r = rollInt(s.salt, SALT.PENS, s.step, 3, 100);
  const side = rollInt(s.salt, SALT.PENS, s.step, 4, 2) === 0 ? -1 : 1;
  const span = (lo: number, hi: number) => lo + rollInt(s.salt, SALT.PENS, s.step, 5, hi - lo + 1);
  const miss = missOf(s.salt, m.cell);
  let aim: number;
  if (r < miss) aim = side * span(AIM_POST + 20, AIM_WIDE + 120);
  else if (r < miss + CORNER) aim = side * span(KEEPER_BASE + 60, AIM_POST - 40);
  else if (r < miss + CORNER + CENTRE) aim = span(-STAY_REACH + 100, STAY_REACH - 100);
  else aim = side * span(DIVE_IN + 160, KEEPER_BASE - 40);
  o.aim = aim;
  // (He looks where he'll put it most times; at a kick down the middle, at either corner.)
  const honest = rollInt(s.salt, SALT.PENS, s.step, 6, 100) < LOOK_TRUE;
  o.look = Math.abs(aim) < DIVE_IN ? side : honest ? Math.sign(aim) : -Math.sign(aim);
  o.dive = 0;
  o.dived = 0;
}

/** His kick, as the run-up ends: a dive he saw coming sends it the other way. */
function inmateKick(sim: SimContext, o: Pens) {
  const s = sim.state;
  const early = o.dived > 0 && o.dive !== 0 && s.step - o.dived > DIVE_EARLY;
  const a = Math.abs(o.aim);
  if (early && a <= AIM_POST && (Math.sign(o.aim) === o.dive || a < DIVE_IN)) o.aim = -o.dive * Math.max(a, DIVE_IN + 260);
  o.result = judgeKick(o.aim, o.dive, playerReach(s.spd));
  struck(sim, o, early);
}

// ------------------------------------------------------------------ the course of it

/** A shootout settled as it stands (between kicks: one side can't be caught), else null. */
function settled(o: Pens): 'won' | 'lost' | null {
  const mine = goals(o.mine);
  const theirs = goals(o.theirs);
  if (o.k >= PEN_KICKS) return null;
  // (Kicks still to come in the five, the one under way among them.)
  const myLeft = PEN_KICKS - o.k - (o.turn === 1 ? 1 : 0);
  const theirLeft = PEN_KICKS - o.k;
  return mine > theirs + theirLeft ? 'won' : theirs > mine + myLeft ? 'lost' : null;
}

/** The tally after a kick: whether it's decided (one side can't be caught in the five; then a pair at a time, level after it). */
function decided(o: Pens): 'won' | 'lost' | 'draw' | null {
  const mine = goals(o.mine);
  const theirs = goals(o.theirs);
  if (o.k < PEN_KICKS) {
    // (The player kicks first in a pair: they've taken k + 1, the inmate k, or k + 1 once he has.)
    const myLeft = PEN_KICKS - (o.k + 1);
    const theirLeft = PEN_KICKS - (o.k + o.turn);
    if (mine > theirs + theirLeft) return 'won';
    if (theirs > mine + myLeft) return 'lost';
    return null;
  }
  if (o.turn === 0) return null;
  if (mine !== theirs) return mine > theirs ? 'won' : 'lost';
  return o.k + 1 >= PEN_KICKS + SUDDEN ? 'draw' : null;
}

/** The ball arrived: the goal counted, the guards' heads turned. */
function arrived(sim: SimContext, o: Pens) {
  const s = sim.state;
  o.phase = PH.AFTER;
  o.at = s.step;
  const goal = o.result === KICK.GOAL;
  if (goal && o.who >= 0) {
    if (o.turn === 0) o.mine |= 1 << o.k;
    else o.theirs |= 1 << o.k;
  }
  const p = pitchOf(sim)!;
  const g = goalOf(p);
  if (o.result === KICK.POST) {
    goalPoint(g, g.line, g.mid, scratch);
    makeNoise(sim, 'thud', LAYER.GROUND, Math.floor(scratch.z / UNIT) * MAP_W + Math.floor(scratch.x / UNIT), KICK_NOISE);
  }
  sim.events.push({
    type: 'pens',
    what: 'result',
    who: o.who,
    by: o.turn === 0 ? -1 : o.who,
    result: o.result,
    aim: o.aim,
    mine: goals(o.mine),
    theirs: goals(o.theirs),
  });
  if (o.who < 0) return practiceGoal(sim, o);
  if (!goal) return;
  // Every eye on the shootout goes to the net (a guard on his round or post stops to look).
  // (Its own point: watchingPens uses the scratch one.)
  goalPoint(g, g.line, acrossOf(g, o.aim), net);
  for (const guard of s.guards) {
    if (!watchingPens(sim, guard)) continue;
    guard.wait = Math.max(guard.wait, GOAL_LOOK);
    guard.body.moving = false;
    if (net.x !== guard.body.x || net.z !== guard.body.z) guard.body.facing = nearestDir(net.x - guard.body.x, net.z - guard.body.z);
  }
}

/** On one's own: a goal in a corner counts towards the day's point of Speed. */
function practiceGoal(sim: SimContext, o: Pens) {
  const s = sim.state;
  if (o.result !== KICK.GOAL || !inCorner(o.aim)) return;
  const day = prisonDay(s.step);
  const n = cornersToday(s) + 1;
  s.penCorners = day * 16 + Math.min(15, n);
  if (n !== CORNERS_A_DAY) return;
  const spd = s.spd < ATTR_MAX ? 1 : 0;
  s.spd += spd;
  s.trained |= 1 << ATTRS.indexOf('spd');
  sim.events.push({ type: 'pens', what: 'corners', who: -1, spd });
}

/** The corners in a corner today, on one's own. */
export const cornersToday = (s: Pick<SimState, 'penCorners' | 'step'>) =>
  s.penCorners !== undefined && Math.floor(s.penCorners / 16) === prisonDay(s.step) ? s.penCorners % 16 : 0;

/** A shootout as a save holds it (2.44): its inmate there is, its tally and phase in range, begun no later than now. */
export function pensOk(o: Pens | null, n: number, step: number): boolean {
  if (o === null) return true;
  if (!o || typeof o !== 'object') return false;
  const ok = [o.who, o.k, o.mine, o.theirs, o.turn, o.phase, o.at, o.aim, o.dive, o.dived, o.look, o.result].every((x) =>
    Number.isInteger(x),
  );
  return (
    ok &&
    o.who >= -1 &&
    o.who < n &&
    o.k >= 0 &&
    o.k < PEN_KICKS + SUDDEN &&
    o.mine >= 0 &&
    o.theirs >= 0 &&
    (o.turn === 0 || o.turn === 1) &&
    o.phase >= PH.PLACES &&
    o.phase <= PH.AFTER &&
    o.at >= 0 &&
    o.at <= step &&
    o.dive >= -1 &&
    o.dive <= 1 &&
    o.dived >= 0 &&
    o.dived <= step &&
    o.result >= KICK.NONE &&
    o.result <= KICK.WIDE
  );
}

/** The next kick after a result: the other side's, the next pair's, or the end. */
function nextKick(sim: SimContext, o: Pens) {
  const s = sim.state;
  if (o.who < 0) {
    // (On one's own: the ball back on the spot, the marker off again.)
    o.phase = PH.SET;
    o.at = s.step;
    o.look = rollInt(s.salt, SALT.PENS, s.step, 7, 2 * AIM_SWEEP) - AIM_SWEEP;
    return;
  }
  const end = decided(o);
  if (end) return endPens(sim, end);
  if (o.turn === 0) o.turn = 1;
  else {
    o.turn = 0;
    o.k++;
  }
  o.phase = PH.PLACES;
  o.at = s.step;
  o.result = 0;
  o.dive = 0;
  o.dived = 0;
}

/** Both at their places: the marker starts (the player kicking), or his run-up (keeping). */
function set(sim: SimContext, o: Pens) {
  const s = sim.state;
  o.phase = PH.SET;
  o.at = s.step;
  if (o.turn === 0) o.look = rollInt(s.salt, SALT.PENS, s.step, 7, 2 * AIM_SWEEP) - AIM_SWEEP;
  else planKick(sim, o);
  o.result = 0;
}

/** A blow at the player (fights.ts hurt): a shootout off at once, the ball put down (the keys and moves theirs again, to answer it). */
export function pensHit(sim: SimContext) {
  const o = sim.state.pens;
  if (!o) return;
  if (o.who < 0) sim.state.pens = null;
  else endPens(sim, 'off');
}

/** How a shootout ended: won, lost, drawn, called off at the bell unsettled, or off (the sirens, someone gone, the player left, a blow or a chase). */
function endPens(sim: SimContext, how: 'won' | 'lost' | 'draw' | 'bell' | 'off') {
  const s = sim.state;
  const o = s.pens;
  if (!o) return;
  s.pens = null;
  const who = o.who;
  const m = s.inmates[who];
  const was = m?.opinion ?? 0;
  // (The player kicks first in a pair: k + 1 taken, whoever's kick it ended on.)
  const score = { mine: goals(o.mine), theirs: goals(o.theirs), taken: o.k + 1 };
  if (how === 'off') return void sim.events.push({ type: 'pens', what: 'off', who, ...score });
  if (how === 'bell') {
    changeOpinion(sim, who, PEN_PLAY_OPINION);
    return void sim.events.push({ type: 'pens', what: 'bell', who, gain: (m?.opinion ?? 0) - was, ...score });
  }
  if (how !== 'won') {
    changeOpinion(sim, who, PEN_PLAY_OPINION);
    return void sim.events.push({ type: 'pens', what: how, who, gain: (m?.opinion ?? 0) - was, ...score });
  }
  changeOpinion(sim, who, PEN_WIN_OPINION);
  // Those watching think more of the player too (each once a day, as at arm-wrestling).
  const day = prisonDay(s.step);
  const p = pitchOf(sim)!;
  const g = goalOf(p);
  goalPoint(g, g.spot, g.mid, scratch);
  const fans: number[] = [];
  let crowd = 0;
  s.inmates.forEach((im, k) => {
    if (k === who || im.ko > 0 || im.angry > 0 || im.doing === DOING.SLEEP || (s.cheered[k] ?? 0) === day) return;
    if (offBy(p, im.body.x, im.body.z) > CROWD_RANGE || !lineOfSight(sim.world, im.body.x, im.body.z, scratch.x, scratch.z)) return;
    crowd++;
    while (s.cheered.length <= k) s.cheered.push(0);
    s.cheered[k] = day;
    const before = im.opinion;
    changeOpinion(sim, k, PEN_CROWD_OPINION);
    if (im.opinion > before) fans.push(k);
  });
  const spd = s.spd < ATTR_MAX ? 1 : 0;
  s.spd += spd;
  s.trained |= 1 << ATTRS.indexOf('spd');
  const wins = sportsWin(sim);
  sim.events.push({ type: 'pens', what: 'won', who, gain: (m?.opinion ?? 0) - was, crowd, fans, spd, wins, ...score });
  if (wins >= SPORTS_WINS) sportsPrizeIfDue(sim);
}

/** Whether the player stands at their place in a shootout (and the inmate at his). */
const KEEPER_SET = 280;

/**
 * The player's walk in a shootout (Sim.playerMoves): the way to their place (0: there), their own
 * moves set aside. Kicking: behind the ball; keeping: on the line.
 */
export function pensWalk(sim: SimContext): number {
  const s = sim.state;
  const o = s.pens;
  const p = pitchOf(sim);
  if (!o || o.who < 0 || !p) return -1;
  const g = goalOf(p);
  if (o.turn === 0) kickerPlace(g, scratch);
  else keeperPlace(g, scratch);
  const dx = scratch.x - s.player.x;
  const dz = scratch.z - s.player.z;
  const pace = walkSpeed(s.spd);
  if (Math.abs(dx) <= pace && Math.abs(dz) <= pace) {
    // (There: on the mark, facing the other end.)
    s.player.x = scratch.x;
    s.player.z = scratch.z;
    goalPoint(g, o.turn === 0 ? g.line : g.spot, g.mid, scratch);
    s.player.facing = nearestDir(scratch.x - s.player.x, scratch.z - s.player.z);
    return 0;
  }
  return nearestDir(dx, dz);
}

/** The player at their place (within a step of it). */
function playerSet(sim: SimContext, g: Goal, o: Pens): boolean {
  const s = sim.state;
  if (o.turn === 0) kickerPlace(g, scratch);
  else keeperPlace(g, scratch);
  return Math.abs(scratch.x - s.player.x) <= KEEPER_SET && Math.abs(scratch.z - s.player.z) <= KEEPER_SET;
}

/** The inmate at his place. */
function inmateSet(sim: SimContext, g: Goal, o: Pens): boolean {
  const m = sim.state.inmates[o.who];
  if (o.turn === 0) keeperPlace(g, scratch);
  else kickerPlace(g, scratch, RUN_FROM);
  return Math.abs(scratch.x - m.body.x) <= KEEPER_SET && Math.abs(scratch.z - m.body.z) <= KEEPER_SET;
}

/** Each step (with the side games): kicks on one's own begun and left, a shootout's course, off when it can't go on. */
export function keepPens(sim: SimContext) {
  const s = sim.state;
  const p = pitchOf(sim);
  if (!p) return;
  let o = s.pens;
  if (!o) return;
  if (o.who < 0) {
    // (Off the spot or moving with no ball in the air, the sirens, something else begun: put down.)
    const flying = o.phase === PH.FLIGHT || o.phase === PH.AFTER;
    if (!yardOpen(s) || s.ko > 0 || busy(s) || (!flying && (s.player.moving || !atSpot(sim)))) {
      s.pens = null;
      return;
    }
  } else {
    const m = s.inmates[o.who];
    // (Off: the sirens, a knockout, either gone.)
    const far = s.layer !== LAYER.GROUND || offBy(p, s.player.x, s.player.z) > PEN_LEAVE || !m || offBy(p, m.body.x, m.body.z) > PEN_LEAVE;
    // (A guard after the player: they run, and the shootout's walk would hold them.)
    const chased = s.guards.some((g) => g.mode === GUARD.CHASE);
    if (!m || m.ko > 0 || m.angry > 0 || s.ko > 0 || s.lockdown || sim.away || s.sleeping || s.stowed || far || chased)
      return endPens(sim, 'off');
    // (The games' hours over, it's over too, as football's full time was: settled, as it stands; else called off, nobody's win.
    // The shootout walks the player: never kept from lunch or roll call by it.)
    // (A kick already counted, the result shown: decided by the tally as it stands after it.)
    if (!GAME_BLOCKS.includes(ROUTINE[s.routine].id)) return endPens(sim, (o.phase === PH.AFTER ? decided(o) : settled(o)) ?? 'bell');
  }
  o = s.pens!;
  const g = goalOf(p);
  switch (o.phase) {
    case PH.PLACES:
      if ((playerSet(sim, g, o) && inmateSet(sim, g, o)) || s.step - o.at >= PLACES_STEPS) set(sim, o);
      break;
    case PH.SET:
      if (o.turn === 0) {
        // (Held up: the ball goes where the marker is.)
        if (o.who >= 0 && s.step - o.at >= KICK_CLOCK) playerKick(sim, o);
      } else {
        runUp(sim, o, g);
        if (s.step - o.at >= RUN_UP) inmateKick(sim, o);
      }
      break;
    case PH.FLIGHT:
      if (s.step - o.at >= FLIGHT) arrived(sim, o);
      break;
    case PH.AFTER:
      if (s.step - o.at >= AFTER_KICK) nextKick(sim, o);
      break;
  }
}

/** His run-up: over its last RUN steps, from his mark to the ball (straight; the pitch is open). */
function runUp(sim: SimContext, o: Pens, g: Goal) {
  const s = sim.state;
  const m = s.inmates[o.who];
  const t = s.step - o.at - (RUN_UP - RUN);
  if (t < 0) return;
  const back = RUN_FROM - Math.floor(((RUN_FROM - PEN_BALL_BACK) * Math.min(RUN, t)) / RUN);
  kickerPlace(g, scratch, back);
  m.body.x = scratch.x;
  m.body.z = scratch.z;
  m.body.moving = t < RUN;
  m.path = [];
  goalPoint(g, g.line, g.mid, scratch);
  m.body.facing = nearestDir(scratch.x - m.body.x, scratch.z - m.body.z);
}
/** How far behind the ball's middle he plants his foot. */
const PEN_BALL_BACK = 300;

/** The marks the inmate walks to (inmates.ts follows them). */
const mark: Body = bodyAt(0, 0);

/** The shootout's inmate where it wants him: in goal while the player kicks, at his mark to kick. */
export function pensTargets(sim: SimContext, so: { follow: Array<Body | null>; gap: number[]; doing: number[]; face: number[] }) {
  const s = sim.state;
  const o = s.pens;
  const p = pitchOf(sim);
  if (!o || o.who < 0 || !p) return;
  const m = s.inmates[o.who];
  if (!m || m.ko > 0 || m.angry > 0) return;
  const g = goalOf(p);
  m.wait = 0;
  if (o.turn === 0) keeperPlace(g, mark);
  else kickerPlace(g, mark, RUN_FROM);
  so.follow[o.who] = mark;
  so.gap[o.who] = 0;
  so.doing[o.who] = DOING.NOTHING;
  // (Facing the other end: the keeper the kicker, the kicker the goal.)
  goalPoint(g, o.turn === 0 ? g.spot : g.line, g.mid, scratch);
  so.face[o.who] = nearestDir(scratch.x - mark.x, scratch.z - mark.z);
}
