import { MAPLE_GROVE } from './maple-grove';
import { GULL_ROCK } from './gull-rock';
import { SIERRA_SECA } from './sierra-seca';
import { GRAVEL_POINT } from './gravel-point';
import { SIX_HUNTER } from './six-hunter';
import { FROSTBERG } from './frostberg';
import type { EscapeRoute, PrisonDef } from './types';

/** The campaign in order (GDD §4; 2.36: the Six Hunter after Gull Rock). The tutorial's Training Block is apart (content/prisons/training). */
export const PRISONS: readonly PrisonDef[] = [MAPLE_GROVE, FROSTBERG, GRAVEL_POINT, SIERRA_SECA, GULL_ROCK, SIX_HUNTER];

/** A campaign prison by its id (undefined for none, the Training Block included). */
export const prisonById = (id: unknown): PrisonDef | undefined => PRISONS.find((p) => p.id === id);

/** The ways out of a prison (GDD §12), in the victory screen's order. */
export const escapesOf = (def: PrisonDef): readonly EscapeRoute[] => def.escapes ?? ['fence', 'tunnel', 'roof', 'takeover'];
