import { PRISONS } from '../content/prisons';
import type { PrisonDef } from '../content/prisons/types';
import { recordOf } from './records';

/**
 * The campaign (GDD §4, §13.1): the prisons in order, each opened by escaping the one before
 * it, any way out. Worked out from the escape records, so nothing more is stored.
 */
export function isOpen(k: number): boolean {
  return k === 0 || (k < PRISONS.length && recordOf(PRISONS[k - 1].id).routes.length > 0);
}

/** The prisons open now, in campaign order. */
export const openPrisons = (): PrisonDef[] => PRISONS.filter((_, k) => isOpen(k));

/** The prison after this one in the campaign (none after the last). */
export function nextPrison(def: PrisonDef): PrisonDef | undefined {
  return PRISONS[PRISONS.indexOf(def) + 1];
}
