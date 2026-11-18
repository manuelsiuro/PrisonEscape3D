import { MAPLE_GROVE_OUTSIDE } from './maple-grove';
import { GULL_ROCK_OUTSIDE } from './gull-rock';
import { SIERRA_SECA_OUTSIDE } from './sierra-seca';
import { GRAVEL_POINT_OUTSIDE } from './gravel-point';
import { SIX_HUNTER_OUTSIDE } from './six-hunter';
import { FROSTBERG_OUTSIDE } from './frostberg';
import type { OutsideDef } from './types';

/** The outside of each campaign prison (P41), by prison id. The Training Block has none. */
export const OUTSIDES: readonly OutsideDef[] = [
  MAPLE_GROVE_OUTSIDE,
  FROSTBERG_OUTSIDE,
  GRAVEL_POINT_OUTSIDE,
  SIERRA_SECA_OUTSIDE,
  GULL_ROCK_OUTSIDE,
  SIX_HUNTER_OUTSIDE,
];

export const outsideOf = (prison: string): OutsideDef | undefined => OUTSIDES.find((o) => o.prison === prison);
