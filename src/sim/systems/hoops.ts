/**
 * Hoops (P27): the hoop on the yard's wall (PrisonDef.leisure.hoop) and its five spots. A shot
 * (EXT.SHOOT: b 0 held, 1 let go; or held too long) from a spot is judged by where the power
 * marker stood as it went (that step or the one before, as the lockpick's pins): in the middle
 * third of the window a swish, in it a basket off the rim, just out a rim-out, else an airball.
 * The window is centred on the power the spot needs (further out more; a tailwind less, a
 * headwind more) and as wide as the player's Speed makes it (narrower further out, and in the
 * rain). Everything here is a pure function of the state: the card shows what the rule judges.
 *
 * A shootout (TALK.HOOPS, with an inmate at the court in the games' hours; one of the day's
 * games): five shots each from the five spots in turn, the inmate's by roll() and its skill;
 * level after five, sudden death from the first spot again, then a draw. Won: the loser's
 * respect and the crowd's (as an arm-wrestle), a point of Speed, a win towards sports day.
 * Shots on one's own count too: PRACTICE_MAKES baskets in a day are worth a point of Speed.
 */
import { COURT_LEAVE, COURT_RANGE, CROWD_OPINION, HOLD_MAX, INMATE_SHOT, NEED_BASE, NEED_PER_TILE, NEED_WIND, PLAY_OPINION, POWER_SPEED, PRACTICE_MAKES, RIM_NOISE, RIM_OUT, SHOOT_SPOTS, SKILL_BASE, SKILL_PER_TILE, SKILL_SPREAD, SPORTS_WINS, SUDDEN_DEATH, WIN_OPINION, WINDOW_BASE, WINDOW_MIN, WINDOW_PER_TILE, WINDOW_RAIN } from '../../content/games';
import type { Court } from '../../content/prisons/types';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import { ATTRS, type SimState } from '../state';
import { ATTR_MAX, UNIT } from '../tuning';
import { LAYER, MAP_W } from '../world/World';
import { today } from './calendar';
import { prisonDay } from './clock';
import { countGame, gameOn, gameRefusal, sportsPrizeIfDue, sportsWin, watchers } from './games';
import { makeNoise } from './noise';
import { changeOpinion, endTalk, refuse } from './social';
import { stopTraining } from './training';

/** A shootout under way (P27): plain data in the state. */
export interface Shootout {
  /** The inmate (index). */
  who: number;
  /** The shot pair under way (0–4 the five spots, then sudden death from the first again). */
  k: number;
  /** Baskets each (bit per shot pair): the player's, the inmate's. */
  mine: number;
  theirs: number;
  /** Whose shot: 0 the player's, 1 the inmate's (at step `at`). */
  turn: number;
  at: number;
}

/** How a shot went: nothing but net, in off the rim, off the rim and out, nowhere near. */
export type ShotResult = 'swish' | 'in' | 'rim' | 'air';
export const made = (r: ShotResult) => r === 'swish' || r === 'in';

/** The prison's court (null: no hoop). */
export const courtOf = (sim: Pick<SimContext, 'world'>): Court | null => sim.world.def.leisure?.hoop ?? null;

/** The rim in units: over the middle of its tile (the hoop's pole stands at the back of it). */
export const rimOf = (c: Court): { x: number; z: number } => ({ x: c.x * UNIT + UNIT / 2, z: c.z * UNIT + UNIT / 2 });

/** The spot (its place in the court's list) the player stands on, -1 none (on the ground floor, up and about). */
export function spotAt(sim: SimContext): number {
  const c = courtOf(sim);
  const s = sim.state;
  if (!c || s.layer !== LAYER.GROUND || sim.away || s.stowed) return -1;
  const x = Math.floor(s.player.x / UNIT);
  const z = Math.floor(s.player.z / UNIT);
  return c.spots.findIndex((p) => p.x === x && p.z === z);
}

/** The spot a shootout's shot pair is taken from. */
export const spotOf = (k: number) => k % SHOOT_SPOTS;

/** How far a spot is from the rim, in tenths of a tile. */
export function spotDistance(c: Court, spot: number): number {
  const r = rimOf(c);
  const p = c.spots[spot];
  const dx = p.x * UNIT + UNIT / 2 - r.x;
  const dz = p.z * UNIT + UNIT / 2 - r.z;
  return Math.round((Math.sqrt(dx * dx + dz * dz) * 10) / UNIT);
}

/** Where the power marker is `k` steps into a hold: 0 → 1000 → 0, POWER_SPEED a step. */
export function powerAt(k: number): number {
  const p = (((k * POWER_SPEED) % 2000) + 2000) % 2000;
  return p <= 1000 ? p : 2000 - p;
}

/**
 * The nearest of the eight ways a vector points (0 north, 2 east, 4 south, 6 west), in integers
 * (no trigonometry in the rules: every browser must judge a shot the same; tan 22.5° ≈ 0.414).
 */
export function eighthOf(dx: number, dz: number): number {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  if (ax * 1000 <= az * 414) return dz < 0 ? 0 : 4;
  if (az * 1000 <= ax * 414) return dx > 0 ? 2 : 6;
  return dx > 0 ? (dz < 0 ? 1 : 3) : dz < 0 ? 7 : 5;
}

/** The wind along a shot from a spot to the rim (P24's wind: from, in eighths, 0 north; its strength 0–3): + behind it, − against it. */
export function windAlong(sim: Pick<SimContext, 'prison' | 'state'>, c: Court, spot: number): number {
  const p = today(sim);
  if (!p.windForce) return 0;
  const r = rimOf(c);
  const s = c.spots[spot];
  const heading = eighthOf(r.x - (s.x * UNIT + UNIT / 2), r.z - (s.z * UNIT + UNIT / 2));
  const off = ((((p.wind + 4) % 8) - heading) % 8 + 8) % 8;
  const f = p.windForce;
  return off === 0 ? f * 2 : off === 1 || off === 7 ? f : off === 4 ? -f * 2 : off === 3 || off === 5 ? -f : 0;
}

/** The window a shot from a spot must land its power in (out of 1000): [the power it needs, half the window]. */
export function shotWindow(sim: Pick<SimContext, 'prison' | 'state' | 'world'>, spot: number, out: [number, number] = [0, 0]): [number, number] {
  const c = courtOf(sim)!;
  const d = spotDistance(c, spot);
  const wx = today(sim).weather;
  // (A half point of wind each way: wind along it ×2, so NEED_WIND / 2 a step of it.)
  out[0] = NEED_BASE + Math.round((NEED_PER_TILE * d) / 10) - Math.round((NEED_WIND * windAlong(sim, c, spot)) / 2);
  out[1] = Math.max(WINDOW_MIN, WINDOW_BASE + Math.floor(sim.state.spd / 2) - Math.round((WINDOW_PER_TILE * Math.max(0, d - 20)) / 10) - (wx === 'rain' || wx === 'storm' ? WINDOW_RAIN : 0));
  return out;
}

/** How a shot with a power goes, against a window. */
export function judge(power: number, need: number, half: number): ShotResult {
  const off = Math.abs(power - need);
  return off * 3 <= half ? 'swish' : off <= half ? 'in' : off <= half + RIM_OUT ? 'rim' : 'air';
}
const RANK: Record<ShotResult, number> = { swish: 3, in: 2, rim: 1, air: 0 };
const win: [number, number] = [0, 0];

/** An inmate's eye for a basket (out of 100), drawn once for the run, by cell. */
export const skillOf = (salt: number, cell: number) => SKILL_BASE + rollInt(salt, SALT.HOOPS, cell, 0, SKILL_SPREAD + 1);

/** Whether a shootout may start with an inmate now: both at the court. */
export function atCourt(sim: SimContext, who: number): boolean {
  const c = courtOf(sim);
  const m = sim.state.inmates[who];
  if (!c || !m || sim.state.layer !== LAYER.GROUND) return false;
  const r = rimOf(c);
  const near = (b: { x: number; z: number }) => Math.max(Math.abs(b.x - r.x), Math.abs(b.z - r.z)) <= COURT_RANGE * UNIT;
  return near(sim.state.player) && near(m.body);
}

/** A shootout with the inmate the player is talking to (TALK.HOOPS). */
export function startShootout(sim: SimContext, who: number) {
  const s = sim.state;
  if (gameOn(s) || !courtOf(sim)) return;
  const why = gameRefusal(sim, who);
  if (why) return refuse(sim, why);
  if (!atCourt(sim, who)) return refuse(sim, 'noCourt');
  countGame(sim, who);
  stopTraining(sim);
  // (Off to the spots: the talk is over, the partner comes along.)
  endTalk(sim);
  s.shootout = { who, k: 0, mine: 0, theirs: 0, turn: 0, at: 0 };
  s.shot = [];
  sim.events.push({ type: 'hoops', what: 'start', who });
}

/** The ball held up for a shot (EXT.SHOOT 0): on a spot (in a shootout, the spot it's at, on the player's turn). */
export function aimShot(sim: SimContext) {
  const s = sim.state;
  if (s.shot.length || s.bout.length || s.pick.length || s.cheat || s.seat >= 0 || s.train >= 0 || s.sleeping) return;
  const spot = spotAt(sim);
  if (spot < 0) return;
  const o = s.shootout;
  if (o && (o.turn !== 0 || spot !== spotOf(o.k))) return;
  s.shot = [s.step, spot];
  s.player.moving = false;
}

/** The ball let go (EXT.SHOOT 1, or held to HOLD_MAX): judged at this step's power or the last's, whichever is closer. */
export function releaseShot(sim: SimContext) {
  const s = sim.state;
  if (!s.shot.length) return;
  const [from, spot] = s.shot;
  s.shot = [];
  const c = courtOf(sim);
  if (!c) return;
  const k = s.step - from;
  shotWindow(sim, spot, win);
  const a = judge(powerAt(k), win[0], win[1]);
  const b = judge(powerAt(k - 1), win[0], win[1]);
  const result = RANK[a] >= RANK[b] ? a : b;
  const power = RANK[a] >= RANK[b] ? powerAt(k) : powerAt(k - 1);
  sim.events.push({ type: 'hoopShot', by: -1, spot, result, power, need: win[0] });
  if (result === 'in' || result === 'rim') makeNoise(sim, 'thud', LAYER.GROUND, c.z * MAP_W + c.x, RIM_NOISE);
  const o = s.shootout;
  if (o) {
    if (made(result)) o.mine |= 1 << o.k;
    o.turn = 1;
    o.at = s.step + INMATE_SHOT;
    return;
  }
  // On one's own: the day's baskets, and a point of Speed at PRACTICE_MAKES.
  if (!made(result)) return;
  const day = prisonDay(s.step);
  const n = Math.floor(s.practice / 16) === day ? (s.practice % 16) + 1 : 1;
  s.practice = day * 16 + Math.min(15, n);
  if (n === PRACTICE_MAKES && s.spd < ATTR_MAX) {
    s.spd++;
    s.trained |= 1 << ATTRS.indexOf('spd');
    sim.events.push({ type: 'hoops', what: 'practice', who: -1, spd: 1 });
  }
}

/** The inmate's shot from the spot of the pair under way, then the pair's tally: on, decided, or a draw. */
function inmateShot(sim: SimContext, o: Shootout) {
  const s = sim.state;
  const c = courtOf(sim)!;
  const m = s.inmates[o.who];
  const spot = spotOf(o.k);
  const odds = skillOf(s.salt, m.cell) - Math.round((SKILL_PER_TILE * Math.max(0, spotDistance(c, spot) - 20)) / 10);
  const r = rollInt(s.salt, SALT.HOOPS, s.step, 1, 100);
  const result: ShotResult = r < odds ? (r * 3 < odds ? 'swish' : 'in') : r < odds + 25 ? 'rim' : 'air';
  sim.events.push({ type: 'hoopShot', by: o.who, spot, result, power: 0, need: 0 });
  if (result === 'in' || result === 'rim') makeNoise(sim, 'thud', LAYER.GROUND, c.z * MAP_W + c.x, RIM_NOISE);
  if (made(result)) o.theirs |= 1 << o.k;
  o.k++;
  o.turn = 0;
  o.at = 0;
  const mine = baskets(o.mine);
  const theirs = baskets(o.theirs);
  // Five each, then a pair at a time once it's level.
  if (o.k < SHOOT_SPOTS) return;
  if (mine !== theirs) return endShootout(sim, mine > theirs ? 'won' : 'lost');
  if (o.k >= SHOOT_SPOTS + SUDDEN_DEATH) endShootout(sim, 'draw');
}

/** Baskets made, from a shootout's bits. */
export function baskets(bits: number): number {
  let n = 0;
  for (let b = bits; b; b &= b - 1) n++;
  return n;
}

/** How a shootout ended: won, lost, drawn, or off (the sirens, someone gone from the court). */
export function endShootout(sim: SimContext, how: 'won' | 'lost' | 'draw' | 'off') {
  const s = sim.state;
  const o = s.shootout;
  if (!o) return;
  s.shootout = null;
  s.shot = [];
  const who = o.who;
  const m = s.inmates[who];
  const was = m?.opinion ?? 0;
  if (how === 'won') {
    changeOpinion(sim, who, WIN_OPINION);
    // Those watching think more of the player too (each once a day, as at arm-wrestling).
    const day = prisonDay(s.step);
    const crowd = watchers(sim, who).filter((k) => (s.cheered[k] ?? 0) !== day);
    for (const k of crowd) {
      while (s.cheered.length <= k) s.cheered.push(0);
      s.cheered[k] = day;
      changeOpinion(sim, k, CROWD_OPINION);
    }
    const spd = s.spd < ATTR_MAX ? 1 : 0;
    s.spd += spd;
    s.trained |= 1 << ATTRS.indexOf('spd');
    const wins = sportsWin(sim);
    sim.events.push({ type: 'hoops', what: 'won', who, crowd: crowd.length, wins, spd, gain: (m?.opinion ?? 0) - was, mine: baskets(o.mine), theirs: baskets(o.theirs) });
    if (wins >= SPORTS_WINS) sportsPrizeIfDue(sim);
    return;
  }
  if (how === 'lost' || how === 'draw') changeOpinion(sim, who, PLAY_OPINION);
  sim.events.push({ type: 'hoops', what: how, who, gain: (m?.opinion ?? 0) - was, mine: baskets(o.mine), theirs: baskets(o.theirs) });
}

/** Each step of the court: a shot held too long goes up; a shootout's inmate shoots; the shootout off when either can't go on. */
export function keepHoops(sim: SimContext) {
  const s = sim.state;
  if (s.shot.length) {
    // (Off the spot, out cold, asleep, something else in hand to do: the ball's put down.)
    if (spotAt(sim) !== s.shot[1] || s.bout.length || s.pick.length || s.cheat) s.shot = [];
    else if (s.step - s.shot[0] >= HOLD_MAX) releaseShot(sim);
  }
  const o = s.shootout;
  if (!o) return;
  const m = s.inmates[o.who];
  const c = courtOf(sim);
  const r = c ? rimOf(c) : null;
  const far = !r || s.layer !== LAYER.GROUND || Math.max(Math.abs(s.player.x - r.x), Math.abs(s.player.z - r.z)) > COURT_LEAVE * UNIT;
  // (Begun, it plays out past the games' hours: the sirens break it off.)
  if (!m || m.ko > 0 || m.angry > 0 || s.lockdown || sim.away || s.sleeping || s.stowed || far) return endShootout(sim, 'off');
  if (o.turn === 1 && s.step >= o.at) inmateShot(sim, o);
}

/** The shootout's partner keeps near the player meanwhile (inmates.ts follows it). */
export const hoopsPartner = (s: Pick<SimState, 'shootout'>) => s.shootout?.who ?? -1;
