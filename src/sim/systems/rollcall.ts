/**
 * Roll call (2.27): the player is counted on their own square, and the warden walks the line, calling
 * each in turn, the player first (cell 1). When they're called the action button says "Here!"; left
 * unanswered, a little heat. The badge's 30 minutes (2.23) and the lockdown for not coming at all stay
 * as they were. A run logged before 2.27 (Sim.rules226) has neither: anywhere in the yard counts, and
 * the warden stands at the post.
 */
import { ROUTINE } from '../../content/routine';
import { placesOf } from '../ai/places';
import type { SimContext } from '../context';
import { COUNT_ANSWER_STEPS, COUNT_HEAT, COUNT_LAST, COUNT_NOD_STEPS, COUNT_START, CHASE_HEAT } from '../tuning';
import { tileAt } from '../world/grid';
import { LAYER } from '../world/World';
import { clockAt } from './clock';
import { assign, GUARD, type Guard } from './guards';
import { closeBox } from './items';
import { endTalk } from './social';
import { addHeat } from './watch';

type Reader = Pick<SimContext, 'state' | 'world' | 'rules226'>;

const isRollCall = (routine: number) => {
  const id = ROUTINE[routine].id;
  return id === 'rollCall' || id === 'eveningRollCall';
};

/** This block counts the player on their own square, not just in the yard. */
export function squareNeeded(sim: Reader): boolean {
  return !sim.rules226 && isRollCall(sim.state.routine) && !sim.world.def.rules?.relaxed && placesOf(sim.world).rollCall.length > 0;
}

/** Standing on their own square (cell 1's, the first). */
export function onOwnSquare(sim: Reader): boolean {
  const s = sim.state;
  return s.layer === LAYER.GROUND && tileAt(s.player.x, s.player.z) === placesOf(sim.world).rollCall[0]?.tile;
}

/** The action button's "Here!": called by name, and on the square to answer from. */
export const canAnswer = (sim: Reader) => sim.state.calling > 0 && onOwnSquare(sim);

/** The guard who takes roll call (its index, -1 none). */
export const wardenOf = (sim: Pick<SimContext, 'world'>) => sim.world.def.guards.findIndex((g) => g.posts?.rollCall);

/** The press: answered; the warden moves on. */
export function answerCount(sim: SimContext) {
  const s = sim.state;
  s.calling = 0;
  const g = s.guards[wardenOf(sim)];
  if (g && g.mode === GUARD.COUNT) g.timer = Math.min(g.timer, COUNT_NOD_STEPS);
  sim.events.push({ type: 'count', what: 'answered', who: -1 });
}

/** The warden has come to a square: its inmate answers by itself; the player is called on to. */
export function reachedSquare(sim: SimContext, index: number, guard: Guard) {
  const s = sim.state;
  // (Called off and back again, a noise, a chase: nobody is called twice.)
  if (index < s.countAt) return;
  s.countAt = index + 1;
  if (index !== 0) {
    const who = s.inmates.findIndex((m) => m.cell === index + 1);
    sim.events.push({ type: 'count', what: 'called', who });
    return;
  }
  // (Counted already, they're free to go: nothing to answer.)
  const here = !s.attended && !sim.away && !s.sleeping && !s.stowed && !s.lockdown && s.solitary <= 0 && s.layer === LAYER.GROUND && sim.playerZone === 'rollCall';
  sim.events.push({ type: 'count', what: here ? 'you' : 'called', who: -1 });
  if (!here) return;
  // (Whatever's open is put away, so that the button is there to press.)
  endTalk(sim);
  closeBox(sim);
  s.calling = COUNT_ANSWER_STEPS;
  guard.timer = COUNT_ANSWER_STEPS;
}

/** Each step of a roll call: the warden sets off once the line has formed; an unanswered call runs out. */
export function rollCall(sim: SimContext) {
  if (sim.rules226) return;
  const s = sim.state;
  if (s.calling > 0) {
    // (Carried off, gone from the yard, counted by now: that's for the block's own rule to settle. Nor is anyone left answering to a warden called away.)
    const w = s.guards[wardenOf(sim)];
    if (sim.away || s.lockdown || s.attended || sim.playerZone !== 'rollCall' || !w || w.ko > 0 || w.mode !== GUARD.COUNT) s.calling = 0;
    else if (--s.calling === 0) {
      // (Stopping short of a chase, as a forgotten tray does: and with nothing to add, nothing said.)
      const heat = Math.min(COUNT_HEAT, Math.max(0, CHASE_HEAT - 1 - s.heat));
      if (heat > 0) {
        addHeat(sim, heat);
        sim.events.push({ type: 'count', what: 'missed', who: -1, heat });
      }
    }
  }
  if (s.countDone || !squareNeeded(sim) || s.lockdown) return;
  const into = clockAt(s.step).minuteOfDay - ROUTINE[s.routine].start;
  if (into < COUNT_START || into > COUNT_LAST) return;
  const k = wardenOf(sim);
  const g = s.guards[k];
  if (!g || g.ko > 0 || g.mode !== GUARD.DUTY) return;
  s.countDone = true;
  assign(g, GUARD.COUNT, placesOf(sim.world).countStops.map((_, i) => i));
}

