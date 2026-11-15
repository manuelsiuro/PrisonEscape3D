import type { District } from './gen/district';

/**
 * Which district a World was built from (2.57): the view dresses a district's walls, floors and streets by
 * its lots (a house, a shop, a car park), which the prisons' World knows nothing of. Kept beside the world,
 * never in it: nothing of the rules reads it.
 */
const towns = new WeakMap<object, District>();
export const setTown = (world: object, district: District) => void towns.set(world, district);
export const townOf = (world: object): District | undefined => towns.get(world);
