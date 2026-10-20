/**
 * Side games (P22): dice and arm-wrestling with the inmates (TALK.DICE, TALK.REROLL,
 * TALK.WRESTLE, in the games' hours with someone who'd play, GAMES_A_DAY each a day), sports
 * day's prize, and the lockpick on a keyed door (its pins set one by one as a marker sweeps).
 *
 * Every throw of the dice and every surge of an arm comes from roll() (never the state's rng),
 * and the lockpick's marker and sweet spots are pure functions of the state: the cards on
 * screen show exactly what the rules will judge. Nothing here happens without the player
 * asking, so the escape bots' runs are untouched.
 */
import { keepActs, keepShow } from './talent';
import { keepQuiz } from './quiz';
import { itemNumber } from '../../content/items';
import { ROUTINE } from '../../content/routine';
import { BAR, BOUT_ENERGY, BOUT_STEPS, CROWD_OPINION, CROWD_RANGE, DICE_HEAT, DRAIN_BASE, GAME_BLOCKS, GAME_OPINION, GAMES_A_DAY, PICK_HIT_NOISE, PICK_MISS_NOISE, PICK_SPEED, PICK_ZONE, PICKED_STEPS, PINS, PLAY_OPINION, PUSH_BASE, SPORTS_OPINION, SPORTS_PRIZE, SPORTS_WINS, STAKES, SURGE_ODDS, WIN_OPINION } from '../../content/games';
import { nearestDir } from '../ai/path';
import { lineOfSight } from '../ai/sight';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import { ATTRS, type Refusal, type SimState } from '../state';
import { ATTR_MAX, BODY_HALF, TIRED, UNIT } from '../tuning';
import { TILE } from '../world/tiles';
import { LAYER, MAP_W, type World } from '../world/World';
import { closeBox } from './actions';
import { eventOn, prisonDay, TODAY } from './calendar';
import { DOING } from './inmates';
import { itemOf, slot, usesOf } from './items';
import { makeNoise } from './noise';
import { changeOpinion, endTalk, refuse } from './social';
import { stopTraining } from './training';
import { addHeat } from './watch';
import { lookingAway } from './ways';
import { energyCost } from './weather';
import { keepCheat } from './cards';
import { keepHoops } from './hoops';
import { keepCheckers } from './checkers';
import { keepMatch } from './football';
import { keepInk } from './tattoo';

export const LOCKPICK = itemNumber('lockpick');

// ------------------------------------------------------------------ who plays, and when

/** The games are on: free time or the exercise hour, and no lockdown. */
export function gamesOpen(sim: Pick<SimContext, 'state'>): boolean {
  const s = sim.state;
  return GAME_BLOCKS.includes(ROUTINE[s.routine].id) && !s.lockdown;
}

/** The games the player has played with an inmate today (prison day: from 08:00). */
export function playedToday(s: Pick<SimState, 'played' | 'step'>, who: number): number {
  const v = s.played[who] ?? 0;
  return Math.floor(v / 4) === prisonDay(s.step) ? v % 4 : 0;
}

/** Why an inmate won't play the player now (null: they will). */
export function gameRefusal(sim: SimContext, who: number): Refusal | null {
  const s = sim.state;
  const m = s.inmates[who];
  if (!m) return 'gamesClosed';
  // (In a lockdown the sirens are the reason, said so.)
  if (s.lockdown) return 'gamesLockdown';
  if (!gamesOpen(sim)) return 'gamesClosed';
  // Sat down (on a bench, at a table): not getting up for a game.
  if (SEATED.has(m.doing)) return 'seated';
  if (m.opinion < GAME_OPINION) return 'gameOpinion';
  if (playedToday(s, who) >= GAMES_A_DAY) return 'played';
  return null;
}

/** What an inmate does sat down. */
const SEATED: ReadonlySet<number> = new Set([DOING.SIT, DOING.SIT_READ, DOING.EAT]);

/** A game played with an inmate today (one of GAMES_A_DAY). */
export function countGame(sim: SimContext, who: number) {
  const s = sim.state;
  while (s.played.length <= who) s.played.push(0);
  s.played[who] = prisonDay(s.step) * 4 + playedToday(s, who) + 1;
}

/**
 * A guard has the player in sight (not one bribed to look away): what a game of dice risks.
 * Judged by the guards' last look (`sees`, and a bribe as it stood then: `at`, that step), so
 * the card (reading the state after a step) and the rule (in the next one) never disagree.
 */
export function eyesOn(s: Pick<SimState, 'guards'>, at: number): boolean {
  return s.guards.some((g) => g.sees && !lookingAway(g, at));
}

/** A game under way (the dice on the table, an arm-wrestle; P27: a hand of Cheat, a shootout, the player at the old-timer's board; P29: a match, a tattoo sitting). */
export const gameOn = (s: Pick<SimState, 'dice' | 'bout' | 'cheat' | 'shootout' | 'board' | 'match' | 'ink' | 'show' | 'quiz'>) => s.dice.length > 0 || s.bout.length > 0 || !!s.cheat || !!s.shootout || !!s.board?.seated || !!s.match || !!s.ink || !!s.show || !!s.quiz;

// ------------------------------------------------------------------ dice

/** A die thrown (1–6) at a step: the k-th of that step's throws. */
const die = (salt: number, step: number, k: number) => 1 + rollInt(salt, SALT.DICE, step, k, 6);

/**
 * Two dice each, the higher total takes the stake (a tie: nobody pays). The player throws
 * first (TALK.DICE, b: the stake's place in STAKES) and may throw either or both again once
 * (TALK.REROLL); then the inmate throws, and behind or level, throws its lower die again. The
 * stake goes on the table as the dice are thrown (it can't be spent meanwhile): back twice over
 * on a win, back as it was on a tie.
 */
export function startDice(sim: SimContext, who: number, b: number) {
  const s = sim.state;
  const stake = STAKES[b];
  if (stake === undefined || gameOn(s)) return;
  const why = gameRefusal(sim, who);
  if (why) return refuse(sim, why);
  if (s.cash < stake) return refuse(sim, 'cash');
  countGame(sim, who);
  s.cash -= stake;
  sim.events.push({ type: 'cash', n: -stake, why: 'dice' });
  s.dice = [who, b, die(s.salt, s.step, 0), die(s.salt, s.step, 1)];
  sim.events.push({ type: 'dice', what: 'rolled', who, stake, mine: [s.dice[2], s.dice[3]] });
  changeOpinion(sim, who, PLAY_OPINION);
  // Gambling under a guard's nose: heat.
  if (eyesOn(s, s.step - 1)) {
    sim.events.push({ type: 'spotted', reason: 'gambling' });
    addHeat(sim, DICE_HEAT);
  }
}

/** The player's second throw (`mask`: bit 0 the first die, bit 1 the second; 0 stands on what they have), then the inmate's: settled. */
export function reroll(sim: SimContext, mask: number) {
  const s = sim.state;
  if (!s.dice.length) return;
  // (One die thrown again at most: both is no choice.)
  if ((mask & 3) === 3) return;
  if (mask & 1) s.dice[2] = die(s.salt, s.step, 2);
  if (mask & 2) s.dice[3] = die(s.salt, s.step, 3);
  if (mask & 3) sim.events.push({ type: 'dice', what: 'rerolled', who: s.dice[0], stake: STAKES[s.dice[1]], mine: [s.dice[2], s.dice[3]], mask: mask & 3 });
  settleDice(sim);
}

/** The inmate throws and the stake changes hands (also when a talk ends with the dice still on the table: the player stands). */
export function settleDice(sim: SimContext) {
  const s = sim.state;
  if (!s.dice.length) return;
  const [who, b, a1, a2] = s.dice;
  s.dice = [];
  const stake = STAKES[b];
  const mine = a1 + a2;
  let t1 = die(s.salt, s.step, 4);
  let t2 = die(s.salt, s.step, 5);
  // Behind or level, it throws its lower die again.
  if (t1 + t2 <= mine) {
    if (t1 <= t2) t1 = die(s.salt, s.step, 6);
    else t2 = die(s.salt, s.step, 6);
  }
  const theirs = t1 + t2;
  const what = mine > theirs ? 'won' : mine < theirs ? 'lost' : 'push';
  // (The stake was on the table: back twice over, back, or gone.)
  const n = what === 'won' ? stake * 2 : what === 'push' ? stake : 0;
  if (n) {
    s.cash += n;
    sim.events.push({ type: 'cash', n, why: 'dice' });
  }
  sim.events.push({ type: 'dice', what, who, stake, mine: [a1, a2], theirs: [t1, t2] });
}

// ------------------------------------------------------------------ arm-wrestling

/** An arm-wrestle (TALK.WRESTLE): the bar from the middle, the player facing the inmate; it costs energy. */
export function startBout(sim: SimContext, who: number) {
  const s = sim.state;
  if (gameOn(s)) return;
  const why = gameRefusal(sim, who);
  if (why) return refuse(sim, why);
  if (s.energy < TIRED) return refuse(sim, 'tired');
  countGame(sim, who);
  stopTraining(sim);
  closeBox(sim);
  s.energy = Math.max(0, s.energy - energyCost(sim, BOUT_ENERGY));
  s.bout = [who, BAR / 2, 0, s.step];
  const b = s.inmates[who].body;
  const p = s.player;
  p.moving = false;
  if (b.x !== p.x || b.z !== p.z) p.facing = nearestDir(b.x - p.x, b.z - p.z);
  sim.events.push({ type: 'bout', what: 'start', who });
}

/** How hard a press pushes (Strength helps). */
export const pushOf = (str: number) => PUSH_BASE + Math.floor(str / 4);

/** Whether the inmate surges at a step of the bout (`t` steps in): the first half of some seconds, drawn for the bout. */
export const surging = (salt: number, from: number, t: number) => t % 20 < 10 && rollInt(salt, SALT.SURGE, from, Math.floor(t / 20), 100) < SURGE_ODDS;

/** How hard the inmate pushes back a step (`t` steps into the bout). */
export const drainOf = (str: number, surge: boolean) => Math.floor(((str + DRAIN_BASE) * (surge ? 3 : 2)) / 20);

/** A press in a bout (OP.TRAIN 1 or 2): only one on the other side from the last counts. */
export function push(sim: SimContext, side: number) {
  const s = sim.state;
  if (!s.bout.length || side === s.bout[2]) return;
  s.bout[2] = side;
  s.bout[1] = Math.min(BAR, s.bout[1] + pushOf(s.str));
  if (s.bout[1] >= BAR) endBout(sim, 'won');
}

/**
 * How a bout ended: the player won, lost, it was a draw at the bell (BOUT_STEPS), they gave up
 * (OP.TRAIN 3, or stepped away), or it was broken off (the talk over, a lockdown, a knockout).
 */
type BoutEnd = 'won' | 'lost' | 'draw' | 'gaveUp' | 'off';

export function endBout(sim: SimContext, how: BoutEnd) {
  const s = sim.state;
  if (!s.bout.length) return;
  const who = s.bout[0];
  s.bout = [];
  if (how === 'won') {
    const m = s.inmates[who];
    const was = m.opinion;
    changeOpinion(sim, who, WIN_OPINION);
    // Those watching think more of the player too (each once a day: no cheering the same faces up all afternoon).
    const day = prisonDay(s.step);
    const crowd = watchers(sim, who).filter((k) => (s.cheered[k] ?? 0) !== day);
    for (const k of crowd) {
      while (s.cheered.length <= k) s.cheered.push(0);
      s.cheered[k] = day;
      changeOpinion(sim, k, CROWD_OPINION);
    }
    const str = s.str < ATTR_MAX ? 1 : 0;
    s.str += str;
    s.trained |= 1 << ATTRS.indexOf('str');
    const wins = sportsWin(sim);
    sim.events.push({ type: 'bout', what: 'won', who, crowd: crowd.length, wins, str, gain: m.opinion - was });
    if (wins >= SPORTS_WINS) sportsPrizeIfDue(sim);
    return;
  }
  const was = s.inmates[who]?.opinion ?? 0;
  if (how === 'lost' || how === 'draw') changeOpinion(sim, who, PLAY_OPINION);
  sim.events.push({ type: 'bout', what: how, who, gain: (s.inmates[who]?.opinion ?? 0) - was });
}

/** Inmates who see a bout or a shootout (up and calm, close enough, a clear line), but the one playing. */
export function watchers(sim: SimContext, who: number): number[] {
  const s = sim.state;
  const p = s.player;
  const out: number[] = [];
  s.inmates.forEach((m, k) => {
    if (k === who || m.ko > 0 || m.angry > 0 || m.doing === DOING.SLEEP) return;
    const dx = m.body.x - p.x;
    const dz = m.body.z - p.z;
    if (dx * dx + dz * dz > (CROWD_RANGE * UNIT) ** 2 || !lineOfSight(sim.world, m.body.x, m.body.z, p.x, p.z)) return;
    out.push(k);
  });
  return out;
}

/** Sports day (P22): a bout won while it's on counts toward the prize (P27: a shootout too; the wins so far today, else 0). */
export function sportsWin(sim: SimContext): number {
  const s = sim.state;
  if (!sportsOn(sim)) return 0;
  const wins = Math.min(SPORTS_WINS, sportsWins(s) + 1);
  s.eventFlags = (s.eventFlags & ~TODAY.SPORTS_WINS) | (wins * TODAY.SPORTS_WIN);
  return wins;
}

/** Sports day's games are on now (a prison without the day's events never has one). */
export const sportsOn = (sim: SimContext) => eventOn(sim, 'sports') && !sim.world.def.rules?.relaxed;

/** Bouts won today on sports day (0 – SPORTS_WINS). */
export const sportsWins = (s: Pick<SimState, 'eventFlags'>) => (s.eventFlags & TODAY.SPORTS_WINS) / TODAY.SPORTS_WIN;

/** The day's prize, once: SPORTS_WINS won today. */
export function sportsPrizeIfDue(sim: SimContext) {
  if (!(sim.state.eventFlags & TODAY.SPORTS_PRIZE)) sportsPrize(sim);
}

/** The day's champion: the prize, and everyone thinks a little more of the player. */
function sportsPrize(sim: SimContext) {
  const s = sim.state;
  s.eventFlags |= TODAY.SPORTS_PRIZE;
  s.cash += SPORTS_PRIZE;
  s.tally[3] += SPORTS_PRIZE;
  sim.events.push({ type: 'cash', n: SPORTS_PRIZE, why: 'prize' });
  for (let k = 0; k < s.inmates.length; k++) changeOpinion(sim, k, SPORTS_OPINION);
  sim.events.push({ type: 'today', event: 'sports', phase: 'prize' });
}

/** Each step of a bout: the inmate pushes back; the bar at either end, or the bell, ends it; anything that takes either of them away breaks it off. */
function keepBout(sim: SimContext) {
  const s = sim.state;
  if (!s.bout.length) return;
  const [who, , , from] = s.bout;
  const m = s.inmates[who];
  if (!m || m.ko > 0 || m.angry > 0 || s.talk !== who || sim.away || s.lockdown || s.sleeping || s.layer !== LAYER.GROUND) return endBout(sim, 'off');
  const t = s.step - from;
  s.bout[1] = Math.max(0, s.bout[1] - drainOf(m.str, surging(s.salt, from, t)));
  if (s.bout[1] <= 0) return endBout(sim, 'lost');
  if (t >= BOUT_STEPS) endBout(sim, 'draw');
}

// ------------------------------------------------------------------ the lockpick

/** Pins to set in a door (by its colour). */
export const pinsOf = (w: World, tile: number) => PINS[w.ground.key[tile]] ?? 0;

/** Whether the lockpick works on a ground tile: a keyed door shut for the player (`gate`: a perimeter gate, never). */
export function lockAt(w: World, tile: number): 'lock' | 'gate' | null {
  if (tile < 0 || w.ground.kind[tile] !== TILE.DOOR || !w.ground.key[tile] || !w.block[tile] || w.parked[tile]) return null;
  return w.gate[tile] ? 'gate' : 'lock';
}

/** Where the marker is `k` steps into the sweep: 0 → 1000 → 0, at PICK_SPEED a step. */
export function markerAt(k: number): number {
  const p = (((k * PICK_SPEED) % 2000) + 2000) % 2000;
  return p <= 1000 ? p : 2000 - p;
}

/** A pin's sweet spot: [from, to] out of 1000, its middle drawn for the door and the pin, as wide as PICK_ZONE + Intellect. */
export function sweetSpot(salt: number, tile: number, pin: number, int: number, out: [number, number] = [0, 0]): [number, number] {
  const mid = 100 + rollInt(salt, SALT.PINS, tile, pin, 801);
  const half = (PICK_ZONE + Math.max(0, int)) / 2;
  out[0] = Math.max(0, mid - half);
  out[1] = Math.min(1000, mid + half);
  return out;
}
const spot: [number, number] = [0, 0];

/** The lockpick in hand on the door ahead (the tool button): picking starts, or a pin is tried. */
export function pickLock(sim: SimContext, tile: number) {
  const s = sim.state;
  if (s.pick.length && s.pick[0] === tile) return setPin(sim);
  // (Standing in a door picked open, another is left alone: only one stays open, and it never shuts on the player.)
  if (s.picked.length && inDoor(s, s.picked[0])) return;
  endTalk(sim);
  closeBox(sim);
  stopTraining(sim);
  const p = s.player;
  p.moving = false;
  const dx = (tile % MAP_W) * UNIT + UNIT / 2 - p.x;
  const dz = Math.floor(tile / MAP_W) * UNIT + UNIT / 2 - p.z;
  if (dx || dz) p.facing = nearestDir(dx, dz);
  s.pick = [tile, 0, s.step];
  sim.events.push({ type: 'pick', what: 'start', tile, pin: 0, of: pinsOf(sim.world, tile) });
}

/**
 * A try at the next pin: the marker in its sweet spot (now, or a step ago: what the card showed
 * as the key went down) sets it with a click; else the pick slips, with a scrape, and wears.
 * Either is work on a door (a guard seeing it sees tampering). The last pin set, the door opens.
 */
function setPin(sim: SimContext) {
  const s = sim.state;
  const it = s.items;
  const [tile, set, from] = s.pick;
  const of = pinsOf(sim.world, tile);
  const k = s.step - from;
  sweetSpot(s.salt, tile, set, it.int, spot);
  const at = markerAt(k);
  const was = markerAt(k - 1);
  const hit = (at >= spot[0] && at <= spot[1]) || (was >= spot[0] && was <= spot[1]);
  s.struckAt = s.step;
  it.rev++;
  if (hit) {
    s.pick[1] = set + 1;
    makeNoise(sim, 'strike', LAYER.GROUND, tile, PICK_HIT_NOISE);
    sim.events.push({ type: 'pick', what: 'set', tile, pin: set + 1, of });
    if (set + 1 < of) return;
    s.pick = [];
    s.picked = [tile, s.step + PICKED_STEPS, 0];
    sim.events.push({ type: 'pick', what: 'open', tile, pin: of, of });
    return;
  }
  makeNoise(sim, 'strike', LAYER.GROUND, tile, PICK_MISS_NOISE);
  sim.events.push({ type: 'pick', what: 'slip', tile, pin: set, of });
  const v = it.inv[it.hand];
  const left = usesOf(v) - 1;
  if (left > 0) {
    it.inv[it.hand] = slot(itemOf(v), left);
    return;
  }
  it.inv[it.hand] = 0;
  sim.events.push({ type: 'broke', item: LOCKPICK });
  stopPick(sim);
}

/** Off the lock (a step away, Close, something else to do, the lockpick gone). */
export function stopPick(sim: SimContext) {
  const s = sim.state;
  if (!s.pick.length) return;
  const tile = s.pick[0];
  s.pick = [];
  sim.events.push({ type: 'pick', what: 'stop', tile });
}

/** Each step at a lock: still the player's to pick (the lockpick in hand, up and about, the door still shut for them). */
function keepPick(sim: SimContext) {
  const s = sim.state;
  if (!s.pick.length) return;
  const it = s.items;
  if (sim.away || s.sleeping || s.stowed || s.train >= 0 || s.seat >= 0 || s.layer !== LAYER.GROUND || itemOf(it.inv[it.hand]) !== LOCKPICK || lockAt(sim.world, s.pick[0]) !== 'lock') stopPick(sim);
}

/**
 * A door picked open stays so for the player until they've been through it (stood in it, then
 * off it), or PICKED_STEPS if they never go; it never shuts on them.
 */
function keepPicked(sim: SimContext) {
  const s = sim.state;
  if (!s.picked.length) return;
  const [tile, until] = s.picked;
  if (inDoor(s, tile)) s.picked[2] = 1;
  else if (s.picked[2] === 1 || s.step >= until) s.picked = [];
}

/** The player's body overlaps a ground tile (a doorway they stand in). */
function inDoor(s: SimState, tile: number): boolean {
  const p = s.player;
  const tx = (tile % MAP_W) * UNIT;
  const tz = Math.floor(tile / MAP_W) * UNIT;
  return s.layer === LAYER.GROUND && p.x + BODY_HALF > tx && p.x - BODY_HALF < tx + UNIT && p.z + BODY_HALF > tz && p.z - BODY_HALF < tz + UNIT;
}

/**
 * The games' step (after training): the games' hours over (the dice stand, a bout is broken off),
 * a bout's push and shove, a lock being picked, a door picked open; P27: a hand of Cheat (the
 * inmate's move, the next deal), the court (a shot held, the shootout's inmate), the old-timer's
 * board (his move).
 */
export function games(sim: SimContext) {
  const s = sim.state;
  if ((s.dice.length || s.bout.length) && !gamesOpen(sim)) {
    settleDice(sim);
    endBout(sim, 'off');
  }
  keepBout(sim);
  keepPick(sim);
  keepPicked(sim);
  keepCheat(sim);
  keepHoops(sim);
  keepCheckers(sim);
  keepMatch(sim);
  keepInk(sim);
  // Stage nights (P30): which acts stood, the player's act.
  keepActs(sim);
  keepShow(sim);
  keepQuiz(sim);
}
