/**
 * The run's ledger (P16): what the player has done this run, counted from each step's events
 * after the step (so it never changes what happens), for achievements, medals and the stats.
 * `feats` holds counters (FEAT), `days` a set of DAY bits per prison day (index day − 1).
 * A game saved before the ledger existed loads PARTIAL: its earlier days are UNKNOWN, and
 * anything that needs the whole run (a clean record, a pacifist) can't be earned in it.
 */
import { itemNumber } from '../../content/items';
import type { Sim } from '../Sim';
import { clockAt } from './clock';
import { CHASE_HEAT, UNIT } from '../tuning';

/** The ledger's counters, in `feats` order. Stored as numbers: append only, never renumber. */
export const FEATS = [
  'partial',
  'blows',
  'koGuards',
  'koInmates',
  'thrown',
  'decoys',
  'bangs',
  'caught',
  'solitary',
  'lockdowns',
  'missed',
  'spotted',
  'maxHeat',
  'bought',
  'crafted',
  'wages',
  'favors',
  'chocolate',
  'meals',
  'dummy',
  'powerCuts',
  'taped',
  'bribes',
  'paperwork',
  'shocked',
  'caveIns',
  'floods',
  'blasts',
  'potatoes',
  'walked',
  'searched',
  'recruits',
  'tips',
  'trained',
  // v1.10.1: molten chocolate thrown at someone (a blow all the same), and the most followers at once.
  'flung',
  'crew',
  // v1.11 (P17, the day): an inspection's commendation, the drill's muster made and missed, a feast eaten, blows landed in a food fight, baked by a heatwave.
  'commended',
  'mustered',
  'drillsMissed',
  'feasts',
  'foodBlows',
  'baked',
  // v1.12 (P18, delivery day): times hidden in the delivery's vehicle, waved through on a day its search would have been thorough, found in it.
  'stowed',
  'slipped',
  'stowFound',
] as const;
export type Feat = (typeof FEATS)[number];
/** A counter's index in `feats`. */
export const FEAT = Object.fromEntries(FEATS.map((f, k) => [f, k])) as Record<Feat, number>;

/** What a prison day held (bits in `days`). Append only. */
export const DAY = {
  SPOTTED: 1,
  WANTED: 2,
  LOCKDOWN: 4,
  CAUGHT: 8,
  FIGHT: 16,
  ESCAPED: 32,
  /** Played before the ledger was kept (an older save): nothing known. */
  UNKNOWN: 64,
  SOLITARY: 128,
} as const;

/** A fresh run's counters. */
export const freshFeats = (): number[] => new Array(FEATS.length).fill(0);

/** The ledger of a game loaded from a save made before it existed: partial, its days so far unknown. */
export function partialLedger(step: number): { feats: number[]; days: number[] } {
  const feats = freshFeats();
  feats[FEAT.partial] = 1;
  return { feats, days: new Array(clockAt(step).day).fill(DAY.UNKNOWN) };
}

const CHOCOLATE = itemNumber('chocolate');

/** Counts the step just run (`x`, `z`: where the player stood before it). */
export function ledger(sim: Sim, x: number, z: number) {
  const s = sim.state;
  const f = s.feats;
  const day = clockAt(s.step).day - 1;
  while (s.days.length <= day) s.days.push(0);
  let bits = 0;
  // Walked (in UNIT steps; the stats show tiles): on foot, not carried off somewhere.
  const moved = Math.abs(s.player.x - x) + Math.abs(s.player.z - z);
  if (moved > 0 && moved < UNIT) f[FEAT.walked] += moved;
  if (s.heat > f[FEAT.maxHeat]) f[FEAT.maxHeat] = s.heat;
  if (s.followers.length > f[FEAT.crew]) f[FEAT.crew] = s.followers.length;
  for (const e of sim.events) {
    switch (e.type) {
      case 'hit':
        f[FEAT.blows]++;
        if (e.free) f[FEAT.foodBlows]++;
        bits |= DAY.FIGHT;
        break;
      case 'koed':
        if (e.who >= s.inmates.length) f[FEAT.koGuards]++;
        else f[FEAT.koInmates]++;
        break;
      // (Things tossed for noise, P14; not at anyone.)
      case 'tossed':
        f[FEAT.thrown]++;
        break;
      case 'thrown':
        f[FEAT.flung]++;
        if (e.free) f[FEAT.foodBlows]++;
        bits |= DAY.FIGHT;
        break;
      case 'noise':
        if (e.kind !== 'strike' && e.sent.length > 0) f[FEAT.decoys]++;
        break;
      case 'bang':
        f[FEAT.bangs]++;
        break;
      case 'caught':
        f[FEAT.caught]++;
        bits |= DAY.CAUGHT;
        break;
      case 'solitary':
        if (e.on) {
          f[FEAT.solitary]++;
          bits |= DAY.SOLITARY;
        }
        break;
      case 'lockdown':
        if (e.on) {
          f[FEAT.lockdowns]++;
          bits |= DAY.LOCKDOWN;
        }
        break;
      case 'missed':
        f[FEAT.missed]++;
        break;
      case 'spotted':
        f[FEAT.spotted]++;
        bits |= DAY.SPOTTED;
        if (e.reason === 'wanted') bits |= DAY.WANTED;
        break;
      case 'bought':
        f[FEAT.bought]++;
        break;
      case 'crafted':
        f[FEAT.crafted]++;
        break;
      case 'cash':
        if (e.why === 'wage') f[FEAT.wages]++;
        break;
      case 'favor':
        if (e.state === 'paid') f[FEAT.favors]++;
        break;
      case 'ate':
        if (e.item === CHOCOLATE) f[FEAT.chocolate]++;
        break;
      case 'meal':
        f[FEAT.meals]++;
        if (e.feast) f[FEAT.feasts]++;
        break;
      case 'today':
        if (e.phase === 'commend') f[FEAT.commended]++;
        else if (e.phase === 'muster') f[FEAT.mustered]++;
        else if (e.phase === 'missed') f[FEAT.drillsMissed]++;
        else if (e.phase === 'waved' && e.thorough && s.stowed) f[FEAT.slipped]++;
        break;
      case 'stow':
        if (e.on) f[FEAT.stowed]++;
        else if (e.found) f[FEAT.stowFound]++;
        break;
      case 'cold':
        if (e.on && e.hot) f[FEAT.baked]++;
        break;
      case 'bedCheck':
        // Passed with nobody in the cell: the dummy under the blanket did it.
        if (e.dummy) f[FEAT.dummy]++;
        break;
      case 'power':
        if (!e.on && e.by === 'player') f[FEAT.powerCuts]++;
        break;
      case 'camera':
        if (e.blind) f[FEAT.taped]++;
        break;
      case 'bribe':
        if (e.kind === 'look') f[FEAT.bribes]++;
        else if (e.kind === 'paper') f[FEAT.paperwork]++;
        break;
      case 'shocked':
        f[FEAT.shocked]++;
        break;
      case 'caveIn':
        f[FEAT.caveIns]++;
        break;
      case 'flood':
        f[FEAT.floods]++;
        break;
      case 'blast':
        f[FEAT.blasts]++;
        break;
      case 'peel':
        if (e.done) f[FEAT.potatoes]++;
        break;
      case 'searched':
        if (e.cell === 1) f[FEAT.searched]++;
        break;
      case 'recruit':
        if (e.on) f[FEAT.recruits]++;
        break;
      case 'tip':
        f[FEAT.tips]++;
        break;
      case 'trained':
        f[FEAT.trained]++;
        break;
      case 'escaped':
        bits |= DAY.ESCAPED;
        break;
    }
  }
  // Wanted: heat at chase level, however it got there.
  if (s.heat >= CHASE_HEAT) bits |= DAY.WANTED;
  s.days[day] |= bits;
}
