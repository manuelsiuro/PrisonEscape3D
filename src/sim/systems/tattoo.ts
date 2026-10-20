/**
 * The tattoo parlour (P29, docs/PLAN.md §9). With a homemade gun and a jar of ink in the hotbar:
 *
 * - **A job** (TALK.TATTOO, b = the design): an inmate at INK_OPINION or more, in the games'
 *   hours (one of the day's games with them), takes a heart, a skull or an eagle. The player
 *   traces it: a pen runs along the design's path at PEN_SPEED and the needle follows the stick or
 *   the keys (the player's moves steer it, Sim.playerMoves: they don't walk meanwhile). How far the
 *   needle strays, step by step, makes the line's quality, and that the pay (half the price to
 *   half as much again) and the opinion. Everything is a pure function of the commands.
 * - **The player's own** (TALK.INK_ME): a friend (FRIEND_INK) inks the design on the player's arm
 *   (MAX_INKED of them; the view and the file show them).
 *
 * Either way the ink's used as it starts. A guard who sees it going on: INK_HEAT, once a sitting.
 */
import { DESIGNS, FRIEND_INK, INK_GAIN, INK_GAIN_BASE, INK_HEAT, INK_ME_STEPS, INK_OPINION, INK_POOR, INK_QUIT, INK_SLACK, LEAD_IN, MAX_INKED, NEEDLE_SPEED, PAY_MIN, PAY_SPAN, PEN_SPEED } from '../../content/team';
import { GAMES_A_DAY } from '../../content/games';
import { itemNumber } from '../../content/items';
import { DIR_X, DIR_Z } from '../command';
import type { SimContext } from '../context';
import type { Refusal, SimState } from '../state';
import { countGame, eyesOn, gameOn, gamesOpen, playedToday } from './games';
import { HOTBAR, itemOf } from './items';
import { changeOpinion, endTalk, refuse } from './social';
import { stopTraining } from './training';
import { addHeat } from './watch';

export const TATTOO_GUN = itemNumber('tattoo_gun');
export const INK = itemNumber('ink');

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

/** Where the pen is `k` steps into a tracing (rounded to the box's units). */
export function penAt(design: number, k: number, out: [number, number] = [0, 0]): [number, number] {
  const d = DESIGNS[design];
  const at = lengths[design];
  const dist = Math.max(0, Math.min(at[at.length - 1], (k - LEAD_IN) * PEN_SPEED));
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

/** A tracing's quality (0–100) from the needle's mean distance from the pen. */
export function qualityOf(err: number, steps: number): number {
  const mean = steps > 0 ? err / steps : 0;
  return Math.max(0, Math.min(100, 100 - Math.floor(((mean - INK_SLACK) * 100) / INK_POOR)));
}
/** What a design traced at a quality pays (dollars). */
export const payOf = (design: number, quality: number) => Math.floor((DESIGNS[design].price * (PAY_MIN + Math.floor((PAY_SPAN * quality) / 100))) / 100);
/** What it does for the client's opinion. */
export const gainOf = (quality: number) => INK_GAIN_BASE + Math.floor((INK_GAIN * quality) / 100);

/** The hotbar slot holding an item (-1 none). */
const carried = (s: Pick<SimState, 'items'>, item: number) => s.items.inv.slice(0, HOTBAR).findIndex((v) => itemOf(v) === item);

/** Why an inmate won't sit for a tattoo now, or ink the player's (null: they will). */
export function inkRefusal(sim: SimContext, who: number, mine: boolean, design = 0): Refusal | null {
  const s = sim.state;
  const m = s.inmates[who];
  if (!m) return 'gamesClosed';
  if (s.lockdown) return 'gamesLockdown';
  if (!gamesOpen(sim)) return 'gamesClosed';
  if (m.opinion < (mine ? FRIEND_INK : INK_OPINION)) return mine ? 'inkFriend' : 'inkOpinion';
  if (!mine && playedToday(s, who) >= GAMES_A_DAY) return 'played';
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
  if (!mine) countGame(sim, who);
  stopTraining(sim);
  endTalk(sim);
  // The ink goes into the gun.
  s.items.inv[carried(s, INK)] = 0;
  s.items.rev++;
  const [x, z] = d.path[0];
  s.ink = { who, design, k: 0, nx: x, nz: z, err: 0, mine: mine ? 1 : 0, seen: 0 };
  s.player.moving = false;
  sim.events.push({ type: 'tattoo', what: 'start', who, design, mine });
  seenInking(sim);
}

/** The needle steered this step (Sim.playerMoves, in place of the walk): the way the stick or the keys point. */
export function steerNeedle(s: Pick<SimState, 'ink'>, dir: number) {
  const o = s.ink;
  if (!o || o.mine || !dir) return;
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
  if (!m || m.ko > 0 || m.angry > 0 || s.lockdown || sim.away || s.sleeping || s.stowed) return endInk(sim, 'off');
  seenInking(sim);
  o.k++;
  if (o.mine) {
    if (o.k >= INK_ME_STEPS) {
      s.inked.push(o.design);
      s.ink = null;
      sim.events.push({ type: 'tattoo', what: 'inked', who: o.who, design: o.design, mine: true });
    }
    return;
  }
  if (o.k > LEAD_IN) {
    penAt(o.design, o.k, pen);
    o.err += Math.min(400, Math.round(Math.sqrt((o.nx - pen[0]) ** 2 + (o.nz - pen[1]) ** 2)));
  }
  if (o.k >= traceSteps(o.design)) endInk(sim, 'done');
}

/** A sitting over: traced (paid), given up (EXT.INK 0: no pay, and a client let down), or off. */
export function endInk(sim: SimContext, how: 'done' | 'quit' | 'off') {
  const s = sim.state;
  const o = s.ink;
  if (!o) return;
  s.ink = null;
  const m = s.inmates[o.who];
  if (how === 'done') {
    const quality = qualityOf(o.err, o.k - LEAD_IN);
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
export { INK_OPINION, FRIEND_INK };
