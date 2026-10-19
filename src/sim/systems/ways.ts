/**
 * Guard ways (P15): guards one can talk to, and the bribes a corrupt one takes. Their traits,
 * the lazy ones' naps and the strict ones' thoroughness live with the guards (guards.ts), the
 * shakedown's cells with the justice (justice.ts), what a bribed guard won't see with the
 * watch (watch.ts).
 */
import { twist } from './twists';
import { BRIBE } from '../command';
import type { SimContext } from '../context';
import { BRIBE_PER_LEVEL, BRIBE_REPORT_HEAT, CHASE_HEAT, LOOK_AWAY_PRICE, LOOK_AWAY_STEPS, PAPER_HEAT, PAPER_PRICE } from '../tuning';
import { clockAt } from './clock';
import { awake, GUARD, traitOf, type Guard } from './guards';
import { refuse } from './social';
import { addHeat, inDisguise } from './watch';

/** What a bribe costs in this prison: dearer the harder the prison. */
export const lookAwayPrice = (difficulty: number) => LOOK_AWAY_PRICE + BRIBE_PER_LEVEL * difficulty;
export const paperPrice = (difficulty: number) => PAPER_PRICE + BRIBE_PER_LEVEL * difficulty;

/** A guard bribed to look the other way, still looking away now. */
export const lookingAway = (g: Guard, step: number) => g.bribed > step;

/**
 * Whether the player can talk to a guard (guard index): awake and about its ordinary duty
 * (not chasing, looking into something, checking beds or searching), no lockdown or takeover,
 * the player not wanted, and not in a guard's uniform (face to face, a guard would know a
 * colleague it never met: the talk would only end in a lockdown).
 */
export function canChat(sim: SimContext, k: number): boolean {
  const s = sim.state;
  const g = s.guards[k];
  return !!g && awake(g) && g.mode === GUARD.DUTY && !s.lockdown && !s.takeover && s.heat < CHASE_HEAT && !sim.away && !inDisguise(sim);
}

/**
 * A bribe offered (TALK.BRIBE, with BRIBE.LOOK or BRIBE.PAPER) to the guard the player talks
 * to. Only a corrupt guard takes one; a strict one reports it (heat); the others just say no.
 * Never with the heat at CHASE_HEAT or more (in a lockdown there's no talking at all).
 */
export function bribe(sim: SimContext, k: number, kind: number) {
  const s = sim.state;
  const g = s.guards[k];
  const def = sim.world.def;
  if (!g || (kind !== BRIBE.LOOK && kind !== BRIBE.PAPER)) return;
  if (s.heat >= CHASE_HEAT || s.lockdown) return refuse(sim, 'tooHot');
  const trait = traitOf(def.guards[k]);
  if (trait === 'strict') {
    refuse(sim, 'reported');
    addHeat(sim, BRIBE_REPORT_HEAT);
    return;
  }
  // (P26: a Straight-Laced Daily, not even the corrupt one.)
  if (trait !== 'corrupt' || twist(s, 'straightLaced')) return refuse(sim, 'honest');
  const look = kind === BRIBE.LOOK;
  const day = clockAt(s.step).day;
  if (look && lookingAway(g, s.step)) return refuse(sim, 'lookingAway');
  if (!look && s.heat <= 0) return refuse(sim, 'clean');
  if (!look && g.paperDay === day) return refuse(sim, 'paperToday');
  const price = look ? lookAwayPrice(def.difficulty) : paperPrice(def.difficulty);
  if (s.cash < price) return refuse(sim, 'cash');
  s.cash -= price;
  s.items.rev++;
  if (look) g.bribed = s.step + LOOK_AWAY_STEPS;
  else {
    g.paperDay = day;
    s.heat = Math.max(0, s.heat - PAPER_HEAT);
  }
  sim.events.push({ type: 'bribe', guard: k, kind: look ? 'look' : 'paper', price }, { type: 'cash', n: -price, why: 'bribe' });
}

/**
 * Each step, after the guards have looked: a look the other way runs out after its 2 game
 * hours, and is off at once when the player is wanted (CHASE_HEAT) or the sirens go.
 */
export function bribesWearOff(sim: SimContext) {
  const s = sim.state;
  const hot = s.heat >= CHASE_HEAT || s.lockdown;
  s.guards.forEach((g, k) => {
    if (!g.bribed || (g.bribed > s.step && !hot)) return;
    g.bribed = 0;
    sim.events.push({ type: 'bribe', guard: k, kind: 'over', price: 0 });
  });
}
