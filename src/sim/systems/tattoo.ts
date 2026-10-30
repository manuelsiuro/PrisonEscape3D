/**
 * The tattoo parlour (P29, docs/PLAN.md §9). With a homemade gun and a jar of ink in the hotbar:
 *
 * - **A job** (TALK.TATTOO, b = the design): an inmate at INK_OPINION or more, in the games'
 *   hours (one of the day's games with them), takes a heart, a skull or an eagle. The player
 *   traces it (2.22): the needle draws where the finger or the mouse takes it (EXT.NEEDLE, and
 *   EXT.NEEDLE_DOWN for a fresh touch), or the way the stick or the keys point (the player's moves
 *   steer it, Sim.playerMoves: they don't walk meanwhile), pulled a little onto the line. The line
 *   counts as traced as far as the needle has followed it, and the ring ahead waits there; how
 *   far the needle strays from the design while it inks makes the line's quality, and that the
 *   pay (half the price to half as much again) and the opinion. Run out of time (INK_TIME), it
 *   counts as far as it got. Before 2.22 (Sim.rules221) a pen ran along the path on a clock and
 *   the needle was scored by its distance from the pen. Everything is a pure function of the commands.
 * - **The player's own** (TALK.INK_ME): a friend (FRIEND_INK) inks the design on the player's arm
 *   (MAX_INKED of them; the view and the file show them).
 *
 * Either way the ink's used as it starts. A guard who sees it going on: INK_HEAT, once a sitting.
 */
import { DESIGNS, FRIEND_INK, INK_GAIN, INK_GAIN_BASE, INK_HEAT, INK_ME_STEPS, INK_OPINION, INK_POOR, INK_PULL, INK_QUIT, INK_SLACK, INK_TIME, LEAD_IN, LINE_AHEAD, LINE_END, LINE_POOR, LINE_SLACK, MAX_INKED, NEEDLE_KEYS, NEEDLE_REACH, NEEDLE_SPEED, ON_LINE, PAY_MIN, PAY_SPAN, PEN_SPEED, INK_LINGER, INKS_A_DAY } from '../../content/team';
import { GAMES_A_DAY } from '../../content/games';
import { itemNumber } from '../../content/items';
import { DIR_X, DIR_Z, needlePoint } from '../command';
import type { SimContext } from '../context';
import type { SimState } from '../state';
import type { Refusal } from '../events';
import { countGame, eyesOn, gameOn, gamesOpen, playedToday } from './games';
import { hotbarSlotOf } from './items';
import { changeOpinion, endTalk, refuse } from './social';
import { stopTraining } from './training';
import { addHeat } from './watch';
import { prisonDay } from './clock';
import { LAYER } from '../world/World';
import { UNIT } from '../tuning';

/** Further apart than this (units, the larger way), a sitting is off; its first steps give the other time to come over. */
const INK_APART = 3 * UNIT;
const INK_GATHER = 60;
import { crowdPlan } from './calendar';
import { tileAt } from '../world/grid';

export const TATTOO_GUN = itemNumber('tattoo_gun');
const INK = itemNumber('ink');

/** A sitting under way (P29): plain data in the state. */
export interface Ink {
  /** The inmate (index): the client, or the friend at work on the player. */
  who: number;
  /** The design (its place in DESIGNS). */
  design: number;
  /** Steps since it began. */
  k: number;
  /** The needle (the design's box, 0–1000). */
  nx: number;
  nz: number;
  /** The needle's distance from the pen, added up step by step (box units). */
  err: number;
  /** 1: the friend inking the player (nothing to trace). */
  mine: number;
  /** 1: a guard has seen it (its heat given). */
  seen: number;
  /** 2.22: how far along the design the line's been traced (box units), and the steps the needle has inked (err is their distances from the design). */
  at: number;
  n: number;
}

/** The design's path's length, and each corner's distance along it (box units). */
const lengths: number[][] = DESIGNS.map((d) => {
  const at = [0];
  for (let k = 1; k < d.path.length; k++) {
    const [x0, y0] = d.path[k - 1];
    const [x1, y1] = d.path[k];
    at.push(at[k - 1] + Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2));
  }
  return at;
});
export const pathLength = (design: number) => lengths[design][lengths[design].length - 1];

/** How long a tracing takes (steps): the lead-in, then the pen along the whole path. */
export const traceSteps = (design: number) => LEAD_IN + Math.ceil(pathLength(design) / PEN_SPEED);

/** Where the pen was `k` steps into a tracing before 2.22 (Sim.rules221). */
export const penAt = (design: number, k: number, out: [number, number] = [0, 0]) => pointAt(design, (k - LEAD_IN) * PEN_SPEED, out);

/** The point `dist` along a design's path (rounded to the box's units). */
export function pointAt(design: number, dist: number, out: [number, number] = [0, 0]): [number, number] {
  const d = DESIGNS[design];
  const at = lengths[design];
  dist = Math.max(0, Math.min(at[at.length - 1], dist));
  let seg = 1;
  while (seg < at.length - 1 && at[seg] < dist) seg++;
  const span = at[seg] - at[seg - 1] || 1;
  const t = (dist - at[seg - 1]) / span;
  const [x0, y0] = d.path[seg - 1];
  const [x1, y1] = d.path[seg];
  out[0] = Math.round(x0 + (x1 - x0) * t);
  out[1] = Math.round(y0 + (y1 - y0) * t);
  return out;
}

/** The point of a design's path nearest (x, y) between `from` and `to` along it: how far along it is, how far from (x, y), and where. */
const near = { at: 0, d: 0, x: 0, y: 0 };
function nearest(design: number, x: number, y: number, from: number, to: number) {
  const p = DESIGNS[design].path;
  const at = lengths[design];
  near.d = Infinity;
  for (let k = 1; k < p.length; k++) {
    const a0 = at[k - 1];
    const len = at[k] - a0;
    if (at[k] < from || a0 > to || len === 0) continue;
    const [x0, y0] = p[k - 1];
    const [x1, y1] = p[k];
    const t = Math.max((Math.max(from, a0) - a0) / len, Math.min((Math.min(to, at[k]) - a0) / len, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / (len * len)));
    const px = x0 + (x1 - x0) * t;
    const py = y0 + (y1 - y0) * t;
    const d = Math.sqrt((px - x) ** 2 + (py - y) ** 2);
    if (d < near.d) Object.assign(near, { at: a0 + t * len, d, x: px, y: py });
  }
  return near;
}

/** Where the ring waits (2.22): `ahead` past what's been traced. */
export const ringAt = (o: Pick<Ink, 'design' | 'at'>, ahead: number, out: [number, number] = [0, 0]) => pointAt(o.design, o.at + ahead, out);

/** The share of the design traced so far (0–1). */
export const tracedShare = (o: Pick<Ink, 'design' | 'at'>) => Math.min(1, o.at / (pathLength(o.design) - LINE_END));

/** The needle moved to (x, y) (2.22): inking the way there, or set down (`ink` false, nothing inked). Inking, it's pulled INK_PULL% onto the line; its distance from it added up; the line traced on as far as it followed it. */
function needleTo(o: Ink, x: number, y: number, ink: boolean) {
  x = Math.max(0, Math.min(1000, x));
  y = Math.max(0, Math.min(1000, y));
  if (x === o.nx && y === o.nz) return;
  if (ink) {
    const n = nearest(o.design, x, y, Math.max(0, o.at - LINE_AHEAD), Math.min(pathLength(o.design), o.at + LINE_AHEAD));
    const moved = Math.sqrt((x - o.nx) ** 2 + (y - o.nz) ** 2);
    x += Math.trunc(((n.x - x) * INK_PULL) / 100);
    y += Math.trunc(((n.y - y) * INK_PULL) / 100);
    const d = Math.sqrt((n.x - x) ** 2 + (n.y - y) ** 2);
    o.err += Math.min(400, Math.round(d));
    o.n++;
    // (Only as far on as the needle went: a needle set down ahead skips nothing.)
    if (d <= ON_LINE) o.at = Math.max(o.at, Math.floor(Math.min(n.at, o.at + moved + 10)));
  }
  o.nx = x;
  o.nz = y;
}

/** The finger or the mouse on the design (EXT.NEEDLE, b and c the point; EXT.NEEDLE_DOWN, a fresh touch): the needle drawn toward it (NEEDLE_REACH at most), or set down there. */
export function drawNeedle(sim: Pick<SimContext, 'state' | 'rules221'>, b: number, c: number, down: boolean) {
  const o = sim.state.ink;
  if (!o || o.mine || sim.rules221) return;
  let [x, y] = needlePoint(b, c);
  const len = Math.sqrt((x - o.nx) ** 2 + (y - o.nz) ** 2);
  if (!down && len > NEEDLE_REACH) {
    x = o.nx + Math.trunc(((x - o.nx) * NEEDLE_REACH) / len);
    y = o.nz + Math.trunc(((y - o.nz) * NEEDLE_REACH) / len);
  }
  needleTo(o, x, y, !down);
}

/** A tracing's quality (0–100) before 2.22 (Sim.rules221), from the needle's mean distance from the pen. */
export function qualityOf(err: number, steps: number): number {
  const mean = steps > 0 ? err / steps : 0;
  return Math.max(0, Math.min(100, 100 - Math.floor(((mean - INK_SLACK) * 100) / INK_POOR)));
}
/** The line's quality (0–100) from the needle's mean distance from the design while it inked (nothing inked: 0). */
export function lineQuality(err: number, n: number): number {
  if (n <= 0) return 0;
  return Math.max(0, Math.min(100, 100 - Math.floor(((err / n - LINE_SLACK) * 100) / LINE_POOR)));
}
/** A tracing's quality (0–100): the line's, cut to the share of the design traced. */
const inkQuality = (o: Ink) => Math.floor(lineQuality(o.err, o.n) * tracedShare(o));
/** What a design traced at a quality pays (dollars). */
export const payOf = (design: number, quality: number) => Math.floor((DESIGNS[design].price * (PAY_MIN + Math.floor((PAY_SPAN * quality) / 100))) / 100);
/** What it does for the client's opinion. */
const gainOf = (quality: number) => INK_GAIN_BASE + Math.floor((INK_GAIN * quality) / 100);

/** Tattoos given to inmates today. */
export const inksToday = (s: Pick<SimState, 'inkDays' | 'step'>) => s.inkDays.filter((d) => d === prisonDay(s.step)).length;

/** The hotbar slot holding an item (-1 none). */
const carried = (s: Pick<SimState, 'items'>, item: number) => hotbarSlotOf(s.items.inv, item);

/** Why an inmate won't sit for a tattoo now, or ink the player's (null: they will). */
export function inkRefusal(sim: SimContext, who: number, mine: boolean, design = 0): Refusal | null {
  const s = sim.state;
  const m = s.inmates[who];
  if (!m) return 'gamesClosed';
  if (s.lockdown) return 'gamesLockdown';
  if (!gamesOpen(sim)) return 'gamesClosed';
  if (m.opinion < (mine ? FRIEND_INK : INK_OPINION)) return mine ? 'inkFriend' : 'inkOpinion';
  if (!mine && playedToday(s, who) >= GAMES_A_DAY) return 'played';
  // (One a day for each, a few a day in all: a gun and a steady hand aren't a mint.)
  if (!mine && (s.inkDays[who] ?? 0) === prisonDay(s.step)) return 'inkedToday';
  if (!mine && inksToday(s) >= INKS_A_DAY) return 'inkedEnough';
  if (carried(s, TATTOO_GUN) < 0) return 'noGun';
  if (carried(s, INK) < 0) return 'noInk';
  if (mine && s.inked.length >= MAX_INKED) return 'armsFull';
  if (mine && s.inked.includes(design)) return 'haveIt';
  return null;
}

/** A tattoo for the inmate the player is talking to (TALK.TATTOO), or one from them (TALK.INK_ME). */
export function startInk(sim: SimContext, who: number, design: number, mine: boolean) {
  const s = sim.state;
  const d = DESIGNS[design];
  if (!d || gameOn(s)) return;
  const why = inkRefusal(sim, who, mine, design);
  if (why) return refuse(sim, why);
  if (!mine) {
    countGame(sim, who);
    while (s.inkDays.length <= who) s.inkDays.push(0);
    s.inkDays[who] = prisonDay(s.step);
  }
  stopTraining(sim);
  endTalk(sim);
  // The ink goes into the gun.
  s.items.inv[carried(s, INK)] = 0;
  s.items.rev++;
  const [x, z] = d.path[0];
  s.ink = { who, design, k: 0, nx: x, nz: z, err: 0, mine: mine ? 1 : 0, seen: 0, at: 0, n: 0 };
  s.player.moving = false;
  sim.events.push({ type: 'tattoo', what: 'start', who, design, mine });
  seenInking(sim);
}

/** The needle steered this step (Sim.playerMoves, in place of the walk): the way the stick or the keys point (NEEDLE_SPEED before 2.22, unpulled). */
export function steerNeedle(sim: Pick<SimContext, 'state' | 'rules221'>, dir: number) {
  const o = sim.state.ink;
  if (!o || o.mine || !dir) return;
  if (!sim.rules221) return needleTo(o, o.nx + Math.trunc((DIR_X[dir] * NEEDLE_KEYS) / 1024), o.nz + Math.trunc((DIR_Z[dir] * NEEDLE_KEYS) / 1024), true);
  o.nx = Math.max(0, Math.min(1000, o.nx + Math.trunc((DIR_X[dir] * NEEDLE_SPEED) / 1024)));
  o.nz = Math.max(0, Math.min(1000, o.nz + Math.trunc((DIR_Z[dir] * NEEDLE_SPEED) / 1024)));
}

/** A guard who sees tattooing (the guards' last look, as the dice): INK_HEAT, once a sitting. */
function seenInking(sim: SimContext) {
  const s = sim.state;
  const o = s.ink;
  if (!o || o.seen || !eyesOn(s, s.step - 1)) return;
  o.seen = 1;
  sim.events.push({ type: 'spotted', reason: 'tattooing' });
  addHeat(sim, INK_HEAT);
}

const pen: [number, number] = [0, 0];

/** Each step of a sitting (with the side games): off when it can't go on; the line traced, finished. */
export function keepInk(sim: SimContext) {
  const s = sim.state;
  const o = s.ink;
  if (!o) return;
  const m = s.inmates[o.who];
  // (Off: the sirens, either of them out of it, the two apart, the player off the ground floor.)
  const apart = !m || Math.max(Math.abs(m.body.x - s.player.x), Math.abs(m.body.z - s.player.z)) > INK_APART;
  if (!m || m.ko > 0 || m.angry > 0 || s.lockdown || sim.away || s.sleeping || s.stowed || s.layer !== LAYER.GROUND || (o.k > INK_GATHER && apart)) return endInk(sim, 'off');
  seenInking(sim);
  o.k++;
  if (o.mine) {
    if (o.k >= INK_ME_STEPS) {
      s.inked.push(o.design);
      s.ink = null;
      linger(sim, o.who);
      sim.events.push({ type: 'tattoo', what: 'inked', who: o.who, design: o.design, mine: true });
    }
    return;
  }
  if (!sim.rules221) {
    // (Traced to the end, or out of time: done, as far as it got.)
    if (o.at >= pathLength(o.design) - LINE_END || o.k >= INK_TIME) endInk(sim, 'done');
    return;
  }
  if (o.k > LEAD_IN) {
    penAt(o.design, o.k, pen);
    o.err += Math.min(400, Math.round(Math.sqrt((o.nx - pen[0]) ** 2 + (o.nz - pen[1]) ** 2)));
  }
  if (o.k >= traceSteps(o.design)) endInk(sim, 'done');
}

/** The client (or the friend) stays where they are a moment after a sitting, admiring it: time for the player to ask for another. */
function linger(sim: SimContext, who: number) {
  const m = sim.state.inmates[who];
  if (!m || m.ko > 0 || m.angry > 0) return;
  m.plan = crowdPlan(sim, sim.state.routine);
  m.goal = tileAt(m.body.x, m.body.z);
  m.path = [];
  m.doing = 0;
  m.then = 0;
  m.wait = INK_LINGER;
}

/** A sitting over: traced (paid), given up (EXT.INK 0: no pay, and a client let down), or off. */
export function endInk(sim: SimContext, how: 'done' | 'quit' | 'off') {
  const s = sim.state;
  const o = s.ink;
  if (!o) return;
  s.ink = null;
  const m = s.inmates[o.who];
  if (how !== 'off') linger(sim, o.who);
  if (how === 'done') {
    const quality = sim.rules221 ? qualityOf(o.err, o.k - LEAD_IN) : inkQuality(o);
    const pay = payOf(o.design, quality);
    const was = m?.opinion ?? 0;
    changeOpinion(sim, o.who, gainOf(quality));
    s.cash += pay;
    s.tally[3] += pay;
    sim.events.push({ type: 'tattoo', what: 'done', who: o.who, design: o.design, mine: false, quality, pay, gain: (m?.opinion ?? 0) - was }, { type: 'cash', n: pay, why: 'tattoo' });
    return;
  }
  if (how === 'quit' && !o.mine) changeOpinion(sim, o.who, -INK_QUIT);
  sim.events.push({ type: 'tattoo', what: how, who: o.who, design: o.design, mine: !!o.mine });
}

/** The client (or the friend) stays by the player meanwhile (socialNow). */
export const inkPartner = (s: Pick<SimState, 'ink'>) => s.ink?.who ?? -1;
