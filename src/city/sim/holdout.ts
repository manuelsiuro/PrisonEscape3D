import { NIGHT_TO } from '../../sim/tuning';
import { HOLDOUT } from '../content/alive';
import { RUSH } from '../content/rush';
import { MODE, type City } from './City';
import { isRush } from './rush';

/**
 * Holdout (C5 batch 6, 2.71): City Escape with no story. No radio to find, no way out: the city's nights, worse each time, and the
 * Rush every third night as in the story. A fall ends it, as in Hardcore; the score is the nights held and the Rushes held. Everything
 * else is the story's city as it is: the survivors, the happenings, the dog, building, the garden.
 */

export const isHoldout = (c: City) => c.state.mode === MODE.HOLDOUT;

/** The nights held so far: each dawn (05:00) seen since the city began. */
export const nightsHeld = (c: City) => Math.max(0, c.minute >= NIGHT_TO ? c.day - 1 : c.day - 2);

/** So many more of the dead a night, for the nights held (Holdout only). */
export const holdoutMore = (c: City, night: number) =>
  isHoldout(c) ? Math.min(HOLDOUT.most, HOLDOUT.perNight * Math.max(0, night - 1)) : 0;

/** The nights to the next Rush from the coming one (0: tonight's is one). */
export function rushIn(c: City): number {
  const night = c.minute < NIGHT_TO ? c.day - 1 : c.day;
  for (let n = Math.max(1, night); n < night + RUSH.every + 1; n++) if (isRush(c, n)) return n - night;
  return RUSH.every;
}

/** What Holdout's journal and the line under the meters ask: the night to hold, and the next Rush. */
export function holdoutObjectives(c: City) {
  const night = c.minute < NIGHT_TO ? c.day - 1 : c.day;
  return [
    { id: 'holdNight', done: false, n: Math.max(1, night) },
    { id: 'holdRush', done: false, n: rushIn(c) },
  ];
}
