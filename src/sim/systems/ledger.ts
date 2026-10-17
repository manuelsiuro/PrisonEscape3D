/**
 * The run's ledger (P16): what the player has done this run, counted from each step's events
 * after the step (so it never changes what happens), for achievements, medals and the stats.
 * `feats` holds counters (FEAT), `days` a set of DAY bits per prison day (index day − 1).
 * A game saved before the ledger existed loads PARTIAL: its earlier days are UNKNOWN, and
 * anything that needs the whole run (a clean record, a pacifist) can't be earned in it.
 */
import { itemDef, itemNumber } from '../../content/items';
import type { Sim } from '../Sim';
import { clockAt } from './clock';
import { ORDER } from '../command';
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
  // v1.13 (P19, guard dogs): smelled out by a dog, a dog's trail that found the way the player went, dogs given jerky, peppered, put to sleep, won over (trust at its most), the scent washed off.
  'sniffed',
  'dogDug',
  'dogsFed',
  'dogsPeppered',
  'dogsAsleep',
  'dogFriends',
  'washed',
  // v1.14 (P20, the pet rat): rats caught in a trap, tamed, errands that brought something back (a key from a guard's pockets among them), things left by the rat, panics started, a guard's own key put back in his pockets while he slept, guards who woke to find their key gone.
  'ratsCaught',
  'ratsTamed',
  'ratFetched',
  'ratKeys',
  'ratLeft',
  'ratPanics',
  'keyHeists',
  'keyless',
  // v1.15 (P21, smuggling): burner phones bought, orders placed, drone drops picked up and seized, visits, orders a visitor or a parcel brought in, parcels seized.
  'phones',
  'orders',
  'drops',
  'dropsSeized',
  'visits',
  'smuggled',
  'parcelsSeized',
  // v1.16 (P22, side games): dice games played and won, a $20 pot won, snake eyes thrown (a pair of ones, at the last), arm-wrestles and wins, sports day's prize, locks picked open, slips of the pick.
  'dice',
  'diceWon',
  'bigPots',
  'snakeEyes',
  'bouts',
  'boutsWon',
  'champion',
  'locksPicked',
  'slips',
  // v1.17 (P23, the crew): orders given, lookouts' whistles, brawls started, drops fetched by a smuggler, loads of dirt or rubble a digger took, ambushes a muscle stopped, nights out with company.
  'crewOrders',
  'whistles',
  'brawls',
  'crewFetched',
  'dirtTaken',
  'ambushesStopped',
  'nightsOut',
  // v1.18 (P24, bluff & glider): waved through the checkpoint, glides off a roof, the longest (tiles), glides that came down inside.
  'waved',
  'glides',
  'glideFar',
  'glidesIn',
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
const PHONE = itemNumber('burner_phone');

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
        // (Not the drone's buzz, P21: the player didn't make that noise.)
        if (e.kind !== 'strike' && e.kind !== 'buzz' && e.sent.length > 0) f[FEAT.decoys]++;
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
        if (e.item === PHONE) f[FEAT.phones]++;
        break;
      case 'smuggle':
        if (e.what === 'ordered') f[FEAT.orders]++;
        else if (e.what === 'collected') f[FEAT.drops]++;
        else if (e.what === 'seized') f[FEAT.dropsSeized]++;
        else if (e.what === 'visit') {
          f[FEAT.visits]++;
          if (e.item) f[FEAT.smuggled]++;
        } else if (e.what === 'parcel') f[FEAT.smuggled]++;
        else if (e.what === 'parcelSeized') f[FEAT.parcelsSeized]++;
        break;
      case 'dice':
        if (e.what === 'rolled') f[FEAT.dice]++;
        else if (e.what === 'won') {
          f[FEAT.diceWon]++;
          if (e.stake >= 20) f[FEAT.bigPots]++;
        }
        if (e.theirs && e.mine[0] === 1 && e.mine[1] === 1) f[FEAT.snakeEyes]++;
        break;
      case 'bout':
        if (e.what === 'start') f[FEAT.bouts]++;
        else if (e.what === 'won') f[FEAT.boutsWon]++;
        break;
      case 'pick':
        if (e.what === 'open') f[FEAT.locksPicked]++;
        else if (e.what === 'slip') f[FEAT.slips]++;
        break;
      case 'crew':
        if (e.what === 'order') {
          f[FEAT.crewOrders]++;
          if (e.order === ORDER.BRAWL) f[FEAT.brawls]++;
        } else if (e.what === 'whistle') f[FEAT.whistles]++;
        else if (e.what === 'handed') f[FEAT.crewFetched]++;
        else if (e.what === 'nightOut') f[FEAT.nightsOut]++;
        else if (e.what === 'dirt') f[FEAT.dirtTaken]++;
        else if (e.what === 'stopped') f[FEAT.ambushesStopped]++;
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
        else if (e.phase === 'prize') f[FEAT.champion]++;
        break;
      case 'stow':
        if (e.on) f[FEAT.stowed]++;
        else if (e.found) f[FEAT.stowFound]++;
        break;
      case 'bluff':
        if (e.on) f[FEAT.waved]++;
        break;
      case 'glide':
        f[FEAT.glides]++;
        if (e.dist > f[FEAT.glideFar]) f[FEAT.glideFar] = e.dist;
        if (!s.escaped) f[FEAT.glidesIn]++;
        break;
      case 'cold':
        if (e.on && e.hot) f[FEAT.baked]++;
        break;
      case 'dog':
        if (e.what === 'sniff') f[FEAT.sniffed]++;
        else if (e.what === 'dug') f[FEAT.dogDug]++;
        else if (e.what === 'fed') f[FEAT.dogsFed]++;
        else if (e.what === 'friend') f[FEAT.dogFriends]++;
        else if (e.what === 'dazed') f[FEAT.dogsPeppered]++;
        else if (e.what === 'asleep') f[FEAT.dogsAsleep]++;
        break;
      case 'washed':
        f[FEAT.washed]++;
        break;
      case 'rat': {
        const guard = (e.who ?? -1) >= s.inmates.length;
        if (e.what === 'caught') f[FEAT.ratsCaught]++;
        else if (e.what === 'tamed') f[FEAT.ratsTamed]++;
        else if (e.what === 'loose') f[FEAT.ratPanics]++;
        else if (e.what === 'took' && e.item) {
          f[FEAT.ratFetched]++;
          if (guard && itemDef(e.item)?.cat === 'key') f[FEAT.ratKeys]++;
        } else if (e.what === 'left') {
          f[FEAT.ratLeft]++;
          if (guard && e.heist) f[FEAT.keyHeists]++;
        }
        break;
      }
      case 'keyless':
        f[FEAT.keyless]++;
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
