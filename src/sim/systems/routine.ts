/** The daily routine (GDD §2): blocks starting and ending, and the player checking in to them. */
import { quickFix } from './twists';
import { BLOCK, ROUTINE, routineAt } from '../../content/routine';
import type { SimContext } from '../context';
import { MISSED_ROUTINE_HEAT, STEPS_PER_MINUTE } from '../tuning';
import type { Clock } from './clock';
import { cancelTasks, GUARD } from './guards';
import { restock } from './items';
import { newDay, settleWork, startWork } from './jobs';
import { shakedown } from './justice';
import { dismissForNight } from './social';
import { addHeat } from './watch';
import { treats } from './k9';
import { ferment } from './pruno';
import { growGarden } from './garden';
import { reissueKit } from './keys';

/**
 * A new block settles the last one: a missed block costs heat (2.23: a roll call the player left
 * before it counted them, no lockdown: the meals' heat), the Work Period pays or fires, 08:00
 * starts a new day.
 */
export function nextBlock(sim: SimContext, clock: Clock) {
  const s = sim.state;
  const w = sim.world;
  const now = routineAt(clock.minuteOfDay);
  if (now === s.routine) return;
  const past = ROUTINE[s.routine];
  if (past.miss && !s.attended && !s.excused && !sim.world.def.rules?.relaxed) {
    const early = !sim.rules222 && s.present > 0;
    const heat = past.miss === 'lockdown' && !early ? 100 : MISSED_ROUTINE_HEAT;
    sim.events.push(early ? { type: 'missed', routine: s.routine, heat, early } : { type: 'missed', routine: s.routine, heat });
    addHeat(sim, heat);
    s.blocks[s.routine] = early ? BLOCK.LEFT : BLOCK.MISSED;
  } else if (past.miss && !s.attended && s.excused) s.blocks[s.routine] = BLOCK.EXCUSED;
  // The Work Period settled (GDD §11), while the block's own excuse still stands: wages were paid
  // as quotas were met; an unmet one costs the job.
  if (past.id === 'work') settleWork(sim);
  s.routine = now;
  s.attended = false;
  if (!sim.rules222) s.present = 0;
  s.eaten = 0;
  // Night jobs end with the night, the morning's with Lights Out (a long chase may have held them up).
  const night = ROUTINE[now].id === 'lightsOut';
  s.guards.forEach((g, i) => {
    const duties = w.def.guards[i].duties ?? [];
    if (!night && duties.includes('bedCheck')) cancelTasks(g, GUARD.BED_CHECK);
    if (night && duties.includes('shakedown')) cancelTasks(g, GUARD.SHAKEDOWN);
  });
  s.excused = s.lockdown || sim.away;
  sim.events.push({ type: 'routine', routine: now });
  // A new day: desks, shelves and counters are stocked again (GDD §6.2), and two cells
  // are named for the shakedown during roll call.
  if (now === 0) {
    s.blocks.fill(0);
    restock(w, s.items, s);
    // (P19: the dogs' treats, and the pills, where there are dogs.)
    treats(sim);
    // (P28: pruno ferments a day more; the garden's beds look back on yesterday.)
    ferment(sim);
    growGarden(sim);
    reissueKit(sim);
    sim.events.push({ type: 'restock' });
    if (!sim.world.def.rules?.relaxed) shakedown(sim);
    // (P26: a Quick Fix Daily, the night's damage mended.)
    quickFix(sim);
    newDay(sim);
  }
  if (ROUTINE[now].id === 'work') startWork(sim);
  // Lights Out: followers go to their beds (P23: but for those staying on through tonight).
  if (night) dismissForNight(sim);
}

/**
 * The player checks in to the block in its zones: 2.23, once they've been there its `stay` (the
 * minutes add up, in and out); a block without one (Lights Out, the job's room, the parole
 * board, the drill's muster), and before 2.23, on arrival.
 */
export function attendance(sim: SimContext) {
  const s = sim.state;
  const zone = sim.playerZone;
  // (Hidden in the delivery's vehicle, P18, the player is nowhere a block wants them.)
  if (!s.attended && !s.stowed && sim.dutyZones.includes(zone)) {
    if (!sim.rules222 && ++s.present < presenceNeeded(sim)) {
      if (s.present === 1) sim.events.push({ type: 'arrived', routine: s.routine });
      return;
    }
    s.attended = true;
    s.blocks[s.routine] = BLOCK.ATTENDED;
    sim.events.push({ type: 'attended', routine: s.routine });
  }
}

/** 2.23: the steps in its zones the block running takes to check in (0: on arrival). */
export function presenceNeeded(sim: Pick<SimContext, 'state' | 'rules222'>): number {
  return sim.rules222 ? 0 : (ROUTINE[sim.state.routine].stay ?? 0) * STEPS_PER_MINUTE;
}
