import { CENTER_PERKS } from './center-perks';
import { SAN_PANCHO } from './san-pancho';
import { SHANKTON } from './shankton';
import { STALAG_FLUCHT } from './stalag-flucht';
import type { EscapeRoute, PrisonDef } from './types';

/** The campaign in order (GDD §4). Level 5 arrives in phase P12. The tutorial's Training Block is apart (content/prisons/training). */
export const PRISONS: readonly PrisonDef[] = [CENTER_PERKS, STALAG_FLUCHT, SHANKTON, SAN_PANCHO];

/** The ways out of a prison (GDD §12), in the victory screen's order. */
export const escapesOf = (def: PrisonDef): readonly EscapeRoute[] => def.escapes ?? ['fence', 'tunnel', 'roof', 'takeover'];
