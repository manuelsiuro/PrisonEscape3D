import { CENTER_PERKS_OUTSIDE } from './center-perks';
import { IRONGATE_OUTSIDE } from './irongate';
import { SAN_PANCHO_OUTSIDE } from './san-pancho';
import { SHANKTON_OUTSIDE } from './shankton';
import { STALAG_FLUCHT_OUTSIDE } from './stalag-flucht';
import type { OutsideDef } from './types';

/** The outside of each campaign prison (P41), by prison id. The Training Block has none. */
export const OUTSIDES: readonly OutsideDef[] = [CENTER_PERKS_OUTSIDE, STALAG_FLUCHT_OUTSIDE, SHANKTON_OUTSIDE, SAN_PANCHO_OUTSIDE, IRONGATE_OUTSIDE];

export const outsideOf = (prison: string): OutsideDef | undefined => OUTSIDES.find((o) => o.prison === prison);
