import { CENTER_PERKS } from './center-perks';
import { STALAG_FLUCHT } from './stalag-flucht';
import type { EscapeRoute, PrisonDef } from './types';

/** The campaign in order (GDD §4). Levels 3–5 arrive in phases P10–P12. The tutorial's Training Block is apart (content/prisons/training). */
export const PRISONS: readonly PrisonDef[] = [CENTER_PERKS, STALAG_FLUCHT];

/** The ways out of a prison (GDD §12), in the victory screen's order. */
export const escapesOf = (def: PrisonDef): readonly EscapeRoute[] => def.escapes ?? ['fence', 'tunnel', 'roof', 'takeover'];
