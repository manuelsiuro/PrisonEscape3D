/**
 * Survival with weight (C5 batch 5, 2.70): the numbers. Thirst, the states that come and go (well fed, refreshed, rested, queasy,
 * soaked), fresh food going off, the weather, the garden, the rain barrel, fishing. The rules are sim/survival.ts's.
 */

/** The rules' revision these come with (a city under way keeps its meters as they were). */
export const SURVIVAL_REV = 6;

/** Thirst (thousandths a game minute): a full bar lasts about 24 hours awake; asleep, about 55. Under a quarter, a slower walk; at none, a point of health every so many minutes. */
export const THIRST = { awake: 70, asleep: 30, weak: 25, hurtEvery: 4 } as const;

/** The states, by their place in `state.moods` (never renumber: saves store them). */
export const MOOD = { WELL_FED: 0, REFRESHED: 1, RESTED: 2, QUEASY: 3, SOAKED: 4 } as const;
export const MOODS = ['wellFed', 'refreshed', 'rested', 'queasy', 'soaked'] as const;

/**
 * How long each lasts (game minutes) and what it does. Well fed: health back twice as fast. Refreshed: energy drains half as fast.
 * Rested (a whole night in a bed): a blow costs half the energy. Queasy: hunger and thirst go twice as fast (tea or pills settle
 * it). Soaked (out in the rain without a raincoat): energy drains half again; dried in an hour out of the rain, at once by a fire.
 */
export const MOOD_TIME = { wellFed: 360, refreshed: 180, rested: 720, queasy: 240, soaked: 60 } as const;

/** Fresh food in the pockets or the bag goes off at dawn: half of each stack (rounded down) gone. A chest, a fridge keep it. */
export const PERISH: readonly string[] = ['fruit', 'veg', 'fish', 'cooked_fish', 'roast_veg', 'fish_soup', 'egg', 'omelette'];
export const SPOIL_AT = 6 * 60;

/** The weather, a day at a time from the city's seed (day 1 always clear), said at 06:00; [kind, weight]. */
export const WEATHER = ['clear', 'rain', 'fog', 'heat', 'storm'] as const;
export const WEATHER_WEIGHT = [45, 20, 15, 12, 8] as const;
/** Fog lies till this hour (game minutes); in it, everyone sees this many tiles at most. */
export const FOG = { until: 11 * 60, sight: 3 } as const;
/** Heat: thirst goes this much faster (in a hundred more). Rain and storm: the dead hear this share as far (in a hundred). */
export const HEAT_THIRST = 50;
export const RAIN_HEARING = 50;

/** The garden: a planter's seeds grow a day for each day watered (or rained on); ready after so many, harvested for so many vegetables and herbs. */
export const GARDEN = { days: 3, veg: 2, herbs: 1 } as const;
/** A rain barrel: so many drinks at the most, so many more each day it rains. */
export const BARREL = { most: 8, perRain: 3, thirst: 40 } as const;
/** Fishing: steps a cast takes, a catch one time in so many (two at sea), the rod's wear a cast, how far it's heard. */
export const FISHING = { steps: 160, oneIn: 2, heard: 2 } as const;
/** Water drunk from a pond or the sea: the thirst it gives (and queasy). */
export const DIRTY_DRINK = 25;
