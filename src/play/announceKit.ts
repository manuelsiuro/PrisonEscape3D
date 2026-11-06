import { ROUTINE } from '../content/routine';
import type { Sim } from '../sim/Sim';

// What the announcements share across their files (v2.34.2).

/** When a refusal was last said (real ms): repeats keep quiet for a while. */
export const cant = { at: 0 };

/** Too tired at night (2.28): sitting down won't help now. */
export const nightTired = (sim: Sim) => !sim.rules227 && !sim.world.def.rules?.relaxed && ROUTINE[sim.state.routine].id === 'lightsOut';
