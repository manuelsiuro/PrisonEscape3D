/**
 * Rat racing (P28, docs/PLAN.md §9; builds on P20's pet rat).
 *
 * - **Training:** the rat track (a magazine taped into a run) used in the player's cell in evening
 *   free time, once a prison day, with bait in the hotbar: the rat eats it (fed today) and runs,
 *   gaining TRACK_GAIN + what's left to 100 / TRACK_SLOW of speed.
 * - **Race nights:** odd prison days at RACE_MINUTE, on the track in the cell block
 *   (`leisure.race`). From CARD_MINUTE (`cardMinute`) the card is up: RIVALS inmates' rats (drawn by cell with
 *   roll(), each with its own speed and fed or not today), and the player's pet after them if
 *   entered. At the track before the off, one bet a night ($5–$20 on a lane), at the bookie's
 *   odds then (from the speeds alone: he can't know who ate).
 * - **The race:** LEGS legs; each leg a rat runs its speed, FED_BONUS more if it ate today, and up to
 *   LUCK more by roll(): the furthest at the end wins (a dead heat to the lower lane). A pure
 *   function of the card and the day, as the 3D draws it. The player's pet winning: a PURSE.
 * - **Risks:** the cheering is noise; a guard who sees the player at it with a bet on gives
 *   gambling heat (DICE_HEAT), once a race. A lockdown calls it off (stakes back).
 *
 * Nothing happens in the simulation unless the player bets or enters: the card is worked out, never stored.
 */
import { BET_RANGE, BETS, CARD_MINUTE, CARD_MINUTE_215, FED_BONUS, START_RANGE, LEGS, LUCK, ODDS_MARGIN, ODDS_MAX, ODDS_MIN, ODDS_SAMPLES, PURSE, RACE_MINUTE, RACE_NOISE, RACE_STEPS, RAT_NAMES, RAT_START_SPEED, RIVAL_FED, RIVAL_SPEED, RIVAL_SPREAD, RIVALS, TRACK_GAIN, TRACK_SLOW, TRACK_STEPS } from '../../content/long';
import { DICE_HEAT } from '../../content/games';
import { ROUTINE } from '../../content/routine';
import type { Track } from '../../content/prisons/types';
import { rollInt, SALT } from '../rng';
import type { SimContext } from '../context';
import type { SimState } from '../state';
import { STEPS_PER_MINUTE, UNIT } from '../tuning';
import { LAYER, MAP_W, type World } from '../world/World';
import { clockAt, prisonDay } from './clock';
import { eyesOn } from './games';
import { itemOf } from './items';
import { makeNoise } from './noise';
import { baitSlot, petOf, RAT } from './rats';
import { refuse } from './social';
import { addHeat } from './watch';

/** A rat on a night's card: whose (an inmate's index; -1 the player's pet), its name (`ratName.<n>`; -1 the pet's own), speed and whether it ate today. */
export interface Entrant {
  owner: number;
  name: number;
  speed: number;
  fed: boolean;
}

/** state.race: [the day, the lane bet on (-1 none), the stake (BETS index, -1), the odds then, entered (0/1), under way (0/1), the step it started, gambling seen (0/1)]; [] none. */
export const RACE = { DAY: 0, LANE: 1, STAKE: 2, ODDS: 3, ENTERED: 4, ON: 5, AT: 6, SEEN: 7 } as const;
/** The pet's lane on a card (the last, after the rivals), -1 not on it. */
export const petLane = (card: readonly Entrant[]) => card.findIndex((e) => e.owner < 0);

/** The prison's rat track, if it has one. */
export const trackOf = (w: World): Track | null => w.def.leisure?.race ?? null;

/** The track's tiles, from the start along its length. */
export function trackTiles(t: Track): number[] {
  const [sx, sz] = t.dir === 1 ? [1, 0] : t.dir === 5 ? [0, 1] : t.dir === 9 ? [-1, 0] : [0, -1];
  return Array.from({ length: t.len }, (_, k) => (t.z + sz * k) * MAP_W + t.x + sx * k);
}

/** Odd prison days are race nights. */
export const raceNight = (day: number) => day % 2 === 1;

/** The inmates' rats on a night's card (the first lanes): drawn by roll(), each with its cell's rat. */
export function rivals(s: Pick<SimState, 'salt' | 'inmates'>, day: number): Entrant[] {
  const n = s.inmates.length;
  const out: Entrant[] = [];
  const count = Math.min(RIVALS, n);
  for (let j = 0; out.length < count && j < 64; j++) {
    const k = rollInt(s.salt, SALT.RACE, day, j, n);
    if (out.some((e) => e.owner === k)) continue;
    const cell = s.inmates[k].cell;
    // (A name of its own on the card: two cells 12 apart would share one.)
    let name = (cell + RAT_NAMES - 2) % RAT_NAMES;
    while (out.some((e) => e.name === name)) name = (name + 1) % RAT_NAMES;
    out.push({
      owner: k,
      name,
      speed: RIVAL_SPEED + rollInt(s.salt, SALT.RACE, 0, 1000 + cell, RIVAL_SPREAD + 1),
      fed: rollInt(s.salt, SALT.RACE, day, 2000 + cell, 100) < RIVAL_FED,
    });
  }
  return out;
}

/** A night's card: the rivals, and the player's pet if entered (its lane the card's last). */
export function raceCard(s: SimState, day: number): Entrant[] {
  const card = rivals(s, day);
  const pet = petOf(s);
  if (pet && s.race[RACE.DAY] === day && s.race[RACE.ENTERED] === 1) card.push({ owner: -1, name: -1, speed: pet.speed ?? RAT_START_SPEED, fed: pet.fed === day });
  return card;
}

/** The bookie's odds for each lane on a card (tenths, ODDS_MIN–ODDS_MAX): pure, worked out once a card (cached). */
export function oddsOf(salt: number, day: number, card: readonly Entrant[]): number[] {
  const key = `${salt}:${day}:${card.map((e) => e.speed).join(',')}`;
  const hit = oddsCache.get(key);
  if (hit) return hit;
  const wins = new Array<number>(card.length).fill(0);
  const at = new Array<number>(card.length).fill(0);
  for (let k = 0; k < ODDS_SAMPLES; k++) {
    let best = -1;
    for (let lane = 0; lane < card.length; lane++) {
      const fed = rollInt(salt, SALT.RACE, 7_000_000 + day * 1024 + k, lane, 100) < RIVAL_FED;
      let d = 0;
      for (let l = 0; l < LEGS; l++) d += card[lane].speed + (fed ? FED_BONUS : 0) + rollInt(salt, SALT.RACE, 8_000_000 + (day * 1024 + k) * 16 + l, lane, LUCK + 1);
      at[lane] = d;
      if (best < 0 || d > at[best]) best = lane;
    }
    wins[best]++;
  }
  const odds = wins.map((w) => Math.max(ODDS_MIN, Math.min(ODDS_MAX, Math.floor((ODDS_MARGIN * ODDS_SAMPLES) / Math.max(1, w) / 50) * 5)));
  if (oddsCache.size > 64) oddsCache.clear();
  oddsCache.set(key, odds);
  return odds;
}
const oddsCache = new Map<string, number[]>();

/** What a winning bet pays back (stake included) at odds in tenths. */
export const payout = (stake: number, odds: number) => Math.floor((stake * odds) / 10);

/** A race run: each lane's distance after each leg (cumulative), and the finishing order (lanes). */
export interface RaceRun {
  legs: number[][];
  order: number[];
}

/** The race on a night's card: pure (the sim settles it, the 3D shows it). */
export function runRace(salt: number, day: number, card: readonly Entrant[]): RaceRun {
  const legs = card.map((e, lane) => {
    let at = 0;
    const out: number[] = [];
    for (let l = 0; l < LEGS; l++) {
      at += e.speed + (e.fed ? FED_BONUS : 0) + rollInt(salt, SALT.RACE, day * 16 + l, 4000 + (e.owner < 0 ? 999 : e.owner) * 8 + lane, LUCK + 1);
      out.push(at);
    }
    return out;
  });
  const order = card.map((_, i) => i).sort((a, b) => legs[b][LEGS - 1] - legs[a][LEGS - 1] || a - b);
  return { legs, order };
}

/** Within `range` tiles of the track (BET_RANGE: at it), on the ground floor. */
export function atTrack(sim: SimContext, range = BET_RANGE): boolean {
  const s = sim.state;
  const t = trackOf(sim.world);
  if (!t || s.layer !== LAYER.GROUND || sim.away || s.stowed) return false;
  const px = Math.floor(s.player.x / UNIT);
  const pz = Math.floor(s.player.z / UNIT);
  return trackTiles(t).some((i) => Math.max(Math.abs((i % MAP_W) - px), Math.abs(Math.floor(i / MAP_W) - pz)) <= range);
}

/** When the card goes up (minutes of the day): 19:00, 20:00 before 2.16. */
export const cardMinute = (sim: Pick<SimContext, 'rules215'>) => (sim.rules215 ? CARD_MINUTE_215 : CARD_MINUTE);

/** The card is up and bets are taken: a race night, from the card's minute to the off, no lockdown. */
export function cardUp(sim: SimContext): boolean {
  const s = sim.state;
  const m = clockAt(s.step).minuteOfDay;
  return !!trackOf(sim.world) && raceNight(prisonDay(s.step)) && m >= cardMinute(sim) && m < RACE_MINUTE && !s.lockdown;
}

/** Today's race state (a fresh one if there's none for today). */
function today(s: SimState): number[] {
  const day = prisonDay(s.step);
  if (s.race[RACE.DAY] !== day) s.race = [day, -1, -1, 0, 0, 0, 0, 0];
  return s.race;
}

/** Why a bet or an entry can't be made now (null: it can). */
export function raceCheck(sim: SimContext): 'raceClosed' | 'gamesLockdown' | 'raceFar' | null {
  const s = sim.state;
  if (s.lockdown && raceNight(prisonDay(s.step))) return 'gamesLockdown';
  if (!cardUp(sim)) return 'raceClosed';
  if (!atTrack(sim)) return 'raceFar';
  return null;
}

/** EXT.RACE: a bet on a lane (b, the card's place; c the stake's place in BETS), or the pet entered (b = RACE_ENTER). */
export const RACE_ENTER = 8;
export function raceOp(sim: SimContext, b: number, c: number) {
  const s = sim.state;
  const why = raceCheck(sim);
  if (why) return refuse(sim, why);
  const day = prisonDay(s.step);
  if (b === RACE_ENTER) {
    const pet = petOf(s);
    if (!pet || pet.mode !== RAT.SHOULDER) return refuse(sim, 'noRat');
    const r = today(s);
    if (r[RACE.ENTERED]) return;
    // (Entered before any bet: a bet's odds are quoted on the field as it will run.)
    if (r[RACE.LANE] >= 0) return refuse(sim, 'enterFirst');
    r[RACE.ENTERED] = 1;
    sim.events.push({ type: 'race', what: 'entered', lane: petLane(raceCard(s, day)) });
    return;
  }
  const stake = BETS[c];
  const card = raceCard(s, day);
  if (stake === undefined || b >= card.length) return;
  if (s.race[RACE.DAY] === day && s.race[RACE.LANE] >= 0) return refuse(sim, 'betPlaced');
  if (s.cash < stake) return refuse(sim, 'cash');
  const r = today(s);
  const odds = oddsOf(s.salt, day, card)[b];
  r[RACE.LANE] = b;
  r[RACE.STAKE] = c;
  r[RACE.ODDS] = odds;
  s.cash -= stake;
  sim.events.push({ type: 'race', what: 'bet', lane: b, stake, odds }, { type: 'cash', n: -stake, why: 'bet' });
}

/** Each step: the off at RACE_MINUTE (the cheering heard; a lockdown calls it off), a guard seeing the player at it, the finish. */
export function races(sim: SimContext) {
  const s = sim.state;
  if (!s.race.length) return;
  const day = prisonDay(s.step);
  const r = s.race;
  // (Yesterday's, never run: gone, its stake with it already refunded or settled.)
  if (r[RACE.DAY] !== day) {
    s.race = [];
    return;
  }
  const t = trackOf(sim.world);
  if (!t) return;
  if (!r[RACE.ON]) {
    if (s.step % STEPS_PER_MINUTE !== 0 || clockAt(s.step).minuteOfDay !== RACE_MINUTE) return;
    if (r[RACE.LANE] < 0 && !r[RACE.ENTERED]) {
      s.race = [];
      return;
    }
    if (s.lockdown) return off(sim, 'off');
    // The pet away on an errand (or the player nowhere near: since 2.16, START_RANGE away): it isn't at the start: scratched (a bet on it void).
    const pet = petOf(s);
    if (r[RACE.ENTERED] && !(pet && pet.mode === RAT.SHOULDER && atTrack(sim, sim.rules215 ? BET_RANGE : START_RANGE))) {
      // (Every bet void, its stake back: the odds were quoted on a field with the pet in it.)
      if (r[RACE.LANE] >= 0) return off(sim, 'scratched');
      const lane = petLane(raceCard(s, day));
      r[RACE.ENTERED] = 0;
      sim.events.push({ type: 'race', what: 'scratched', lane });
    }
    r[RACE.ON] = 1;
    r[RACE.AT] = s.step;
    sim.events.push({ type: 'race', what: 'start' });
    const tiles = trackTiles(t);
    makeNoise(sim, 'cheer', LAYER.GROUND, tiles[tiles.length >> 1], RACE_NOISE);
    return;
  }
  // Seen at it with a bet on: gambling (once a race).
  if (r[RACE.LANE] >= 0 && !r[RACE.SEEN] && eyesOn(s, s.step) && atTrack(sim)) {
    r[RACE.SEEN] = 1;
    sim.events.push({ type: 'spotted', reason: 'gambling' });
    addHeat(sim, DICE_HEAT);
  }
  if (s.step - r[RACE.AT] < RACE_STEPS) return;
  settle(sim, day);
}

/** The finish: the bet paid (stake × odds) if its rat won, the purse if the pet did. */
function settle(sim: SimContext, day: number) {
  const s = sim.state;
  const r = s.race;
  const card = raceCard(s, day);
  const run = runRace(s.salt, day, card);
  const winner = run.order[0];
  const lane = r[RACE.LANE];
  const stake = lane >= 0 ? BETS[r[RACE.STAKE]] : 0;
  const won = lane === winner ? payout(stake, r[RACE.ODDS]) : 0;
  const purse = card[winner]?.owner === -1 ? PURSE : 0;
  const odds = r[RACE.ODDS];
  s.race = [];
  if (won) {
    s.cash += won;
    s.tally[3] += won - stake;
    sim.events.push({ type: 'cash', n: won, why: 'bet' });
  }
  if (purse) {
    s.cash += purse;
    s.tally[3] += purse;
    sim.events.push({ type: 'cash', n: purse, why: 'purse' });
  }
  sim.events.push({ type: 'race', what: 'result', order: run.order, lane, stake, odds: lane >= 0 ? odds : 0, won, purse });
}

/** Called off (a lockdown at the off; a bet on a pet scratched): the stake back. */
function off(sim: SimContext, what: 'off' | 'scratched') {
  const s = sim.state;
  const r = s.race;
  const stake = r[RACE.LANE] >= 0 ? BETS[r[RACE.STAKE]] : 0;
  s.race = [];
  if (stake) {
    s.cash += stake;
    sim.events.push({ type: 'cash', n: stake, why: 'bet' });
  }
  sim.events.push({ type: 'race', what, stake });
}

// ------------------------------------------------------------------ the track at home

/** Why the rat can't run the track now (null: it can). */
export type TrackRefusal = 'noRat' | 'notCell' | 'notEvening' | 'today' | 'hungry' | 'entered';
export function trackCheck(sim: SimContext): TrackRefusal | null {
  const s = sim.state;
  const pet = petOf(s);
  if (!pet || pet.mode !== RAT.SHOULDER) return 'noRat';
  if (sim.playerZone !== 'playerCell') return 'notCell';
  if (ROUTINE[s.routine].id !== 'eveningFreeTime' || s.lockdown) return 'notEvening';
  if (pet.fed === prisonDay(s.step)) return 'today';
  // (Entered in tonight's race: its form as the bets were quoted on it, until the race is run.)
  if (s.race[RACE.DAY] === prisonDay(s.step) && s.race[RACE.ENTERED] === 1) return 'entered';
  if (baitSlot(s.items.inv) < 0) return 'hungry';
  return null;
}

/** The speed a session on the track adds to a rat this fast. */
export const trackGain = (speed: number) => Math.min(100 - speed, TRACK_GAIN + Math.floor((100 - speed) / TRACK_SLOW));

/** The use button with the track in hand: the rat eats the bait and runs its laps (faster for it). */
export function trainRat(sim: SimContext) {
  const s = sim.state;
  const why = trackCheck(sim);
  if (why) {
    sim.events.push({ type: 'track', what: 'refused', why });
    return;
  }
  const pet = petOf(s)!;
  const k = baitSlot(s.items.inv);
  const food = itemOf(s.items.inv[k]);
  s.items.inv[k] = 0;
  s.items.rev++;
  const speed = pet.speed ?? RAT_START_SPEED;
  const gain = trackGain(speed);
  pet.speed = speed + gain;
  pet.fed = prisonDay(s.step);
  pet.lap = s.step + TRACK_STEPS;
  sim.events.push({ type: 'track', what: 'trained', speed: pet.speed, gain, item: food });
}
