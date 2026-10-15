/** The daily routine (GDD §2): blocks starting and ending, and the player checking in to them. */
import { ROUTINE, routineAt } from '../../content/routine';
import type { SimContext } from '../context';
import { MISSED_ROUTINE_HEAT } from '../tuning';
import type { Clock } from './clock';
import { reissueKit } from './fights';
import { cancelTasks, GUARD } from './guards';
import { restock } from './items';
import { newDay, settleWork, startWork } from './jobs';
import { shakedown } from './justice';
import { dismissAll } from './social';
import { addHeat } from './watch';

/** A new block settles the last one: a missed block costs heat, the Work Period pays or fires, 08:00 starts a new day. */
export function nextBlock(sim: SimContext, clock: Clock) {
  const s = sim.state;
  const w = sim.world;
  const now = routineAt(clock.minuteOfDay);
  if (now === s.routine) return;
  const past = ROUTINE[s.routine];
  if (past.miss && !s.attended && !s.excused && !sim.world.def.rules?.relaxed) {
    const heat = past.miss === 'lockdown' ? 100 : MISSED_ROUTINE_HEAT;
    sim.events.push({ type: 'missed', routine: s.routine, heat });
    addHeat(sim, heat);
  }
  // The Work Period settled (GDD §11), while the block's own excuse still stands: wages were paid
  // as quotas were met; an unmet one costs the job.
  if (past.id === 'work') settleWork(sim);
  s.routine = now;
  s.attended = false;
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
    restock(w, s.items, s);
    reissueKit(sim);
    sim.events.push({ type: 'restock' });
    if (!sim.world.def.rules?.relaxed) shakedown(sim);
    newDay(sim);
  }
  if (ROUTINE[now].id === 'work') startWork(sim);
  // Lights Out: followers go to their beds.
  if (night) dismissAll(sim);
}

/** The player checks in to the block on reaching one of its zones. */
export function attendance(sim: SimContext) {
  const s = sim.state;
  const zone = sim.playerZone;
  if (!s.attended && sim.dutyZones.includes(zone)) {
    s.attended = true;
    sim.events.push({ type: 'attended', routine: s.routine });
  }
}
