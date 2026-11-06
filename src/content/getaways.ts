/**
 * Bluff & glider (P24): two more ways out, the numbers they work by. How they play out is
 * src/sim/systems/getaway.ts.
 */

/** The checkpoint's shift change, when the new gatekeeper doesn't know a face yet: 19:50–20:10 (minutes of the day). */
export const SHIFT_FROM = 19 * 60 + 50;
export const SHIFT_TO = 20 * 60 + 10;
/** Waved through, the gates stay open for the player this long (steps: 60 s). */
export const WAVED_STEPS = 1200;
/** Papers are only looked at kindly with the heat under this (%). */
export const BLUFF_HEAT = 40;

/** A glide goes this far (tiles) in still air, from the roof's edge tile. */
export const GLIDE_BASE = 3;
/** A tailwind adds this much per point of the wind's strength (half that from a quarter behind); a headwind takes off one a point (half that from a quarter ahead). */
export const GLIDE_TAIL = 2;
/** Rain weighs the sheet down: a tile less. */
export const GLIDE_RAIN = 1;
/** However the wind blows: never less than this, never more (tiles). */
export const GLIDE_MIN = 1;
export const GLIDE_MAX = 10;
/** The run-up it needs: this many tiles of roof behind the player. */
export const RUN_UP = 2;
