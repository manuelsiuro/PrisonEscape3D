import type { Achievement } from '../content/achievements';
import { recordGetaway } from '../game/records';
import { huntQuit, huntRun } from '../game/trophies';
import { HFEAT, OVER } from '../sim/hunt/state';
import type { Sim } from '../sim/Sim';
import type { HuntResult } from './hunt';

/**
 * A manhunt over (P41), its run's escape already counted at the wall: a clean getaway stars the
 * way out on the shelf; the stats and achievements hear how it went. What it earned, for the card.
 */
export function huntOver(sim: Sim, via: string, r: Exclude<HuntResult, 'quit'>): Achievement[] {
  const safe = r.over !== OVER.CAUGHT;
  if (safe) recordGetaway(sim.prison.id, via);
  return huntRun({ prison: sim.prison.id, via, safe, lou: r.over === OVER.LOU, progress: r.progress, spotted: r.feats[HFEAT.spotted], swapped: r.feats[HFEAT.swaps] > 0, lit: r.feats[HFEAT.lit] });
}

/** A manhunt left under way (the pause card's quit): a recapture in the stats, nothing earned. */
export function huntLeft() {
  huntQuit();
}
