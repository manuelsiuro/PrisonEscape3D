import { HUNT, startKindOf } from '../../content/manhunt';
import { ROUTINE } from '../../content/routine';
import { SLOT } from '../command';
import { ESCAPES, type Sim } from '../Sim';
import { GUARD } from '../systems/guards';
import { itemOf } from '../systems/items';
import { BED_CHECK_MINUTES, CHASE_HEAT } from '../tuning';
import type { Carry } from './state';

/**
 * What the player takes out over the wall into the manhunt (P41), read once from the inside
 * run as it ends (its state is never changed): the way out and where it leaves them, their
 * Speed, what they wear and carry, the crew out with them, Lou's car, the time, and the head
 * start: none if they were seen going (a lockdown, a chase, the heat that brings one, a
 * takeover), else the game minutes to the next headcount (a bed check, a block that takes the
 * roll), at most HUNT.headStartMax.
 */
export function carryFrom(sim: Sim): Carry {
  const s = sim.state;
  const via = ESCAPES[s.via];
  const minute = sim.clock.minuteOfDay;
  const inv = s.items.inv;
  const kit: number[] = [];
  for (let k = 0; k <= SLOT.WEAPON; k++) {
    const n = itemOf(inv[k]);
    if (n) kit.push(n);
  }
  const seen = s.lockdown || s.takeover || s.seen || s.heat >= CHASE_HEAT || s.guards.some((g) => g.mode === GUARD.CHASE);
  return {
    prison: sim.prison.id,
    via,
    kind: startKindOf(via, sim.prison),
    spd: s.spd,
    outfit: itemOf(inv[SLOT.OUTFIT]),
    kit,
    crew: s.crewOut.length,
    lou: s.lou[5] < 0,
    headStart: seen ? 0 : headStartAt(minute),
    minute,
    salt: s.salt,
  };
}

/** The minutes of the day someone counts heads: the night's bed checks, and each block that takes the roll. */
const HEADCOUNTS: readonly number[] = [...BED_CHECK_MINUTES, ...ROUTINE.filter((r) => r.zones.length).map((r) => r.start)];

/** Seconds of head start out of the wall at a minute of the day (a game minute a second): to the next headcount, at least 5, at most HUNT.headStartMax. */
export function headStartAt(minute: number): number {
  let next = 1440;
  for (const m of HEADCOUNTS) next = Math.min(next, (m - minute + 1440) % 1440 || 1440);
  return Math.max(5, Math.min(HUNT.headStartMax, next));
}
