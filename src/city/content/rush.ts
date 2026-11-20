/**
 * Nights (C5 batch 3, 2.68): the Rush, the traps' numbers, a base left to the nights. The rules are sim/rush.ts (the Rush, a base
 * left) and sim/dead.ts (the traps, the Rush's dead); the pieces themselves are content/build.ts's.
 */

/**
 * The Rush: every third night from the third (cities begun from 2.68, `state.rev` 4), said at dawn and at dusk, no sleep from 20:00;
 * waves at 22:00, midnight, 02:00 and 04:00, after the player wherever they are (through boards and what's built); held to 05:00,
 * supplies dropped beside them.
 */
export const RUSH = {
  /** The rules' revision it comes with. */
  rev: 4,
  /** Every so many nights, from that one. */
  every: 3,
  /** The waves' hours (game minutes). */
  waves: [22 * 60, 0, 2 * 60, 4 * 60],
  /** Said at dawn and an hour before dark, on a Rush's day. */
  warn: [6 * 60, 19 * 60],
  /** A wave's size: so many, more each Rush, more each wave of the night, more for each step of the district's danger; at most. */
  base: 3,
  perRush: 1,
  perWave: 1,
  perDanger: 1,
  most: 14,
  /** A brute in the second and the last wave from the second Rush; a bloater in each from the third. */
  bruteFrom: 2,
  bloaterFrom: 3,
  /** Steps between two looks at where the player is now (they know). */
  retarget: 40,
  /** A district crossed into mid-Rush: so many in a hundred of the Rush's dead about follow (2.68, the review: all of them). */
  follow: 100,
} as const;

/** What's dropped for a Rush held: by how many have been held (the last for every one after). [item id, how many]. */
export const SUPPLIES: ReadonlyArray<ReadonlyArray<readonly [string, number]>> = [
  [
    ['plank', 4],
    ['nails', 2],
    ['tin', 2],
    ['water', 1],
    ['bandage', 1],
  ],
  [
    ['plank', 4],
    ['nails', 2],
    ['scrap', 3],
    ['wire', 2],
    ['ration', 1],
    ['bandage', 2],
    ['bolt', 3],
  ],
  [
    ['plank', 6],
    ['nails', 3],
    ['scrap', 4],
    ['wire', 2],
    ['ration', 2],
    ['medkit', 1],
    ['bolt', 4],
    ['fuel', 1],
  ],
];

/**
 * A sleeper in a base (pieces built within comfort's reach) is looked for as one behind boards is (SIEGE), the way through what's
 * built; in a light, a few chances in a hundred more.
 */
export const BASE_SIEGE = { litMore: 3 } as const;

/**
 * A base left: on coming back after nights away, each piece the dead could walk up to takes so much a night, more for the district's
 * danger, more lit; a Rush's night counts as so many. A piece walked over (a rug, a trap) takes half.
 */
export const LEFT = { perNight: 10, perDanger: 6, litMore: 50, rushTimes: 3 } as const;

/** The traps (pieces that work on the dead by themselves). */
export const TRAP = {
  /** Spikes: one of the dead on them takes this much every so many steps, and they wear a point. */
  spikesEvery: 8,
  spikesHarm: 5,
  /** Barbed wire: one of the dead in it walks at this pace (thousandths), takes this much every so many steps, and it wears a point. */
  wireSlow: 450,
  wireEvery: 20,
  wireHarm: 2,
  /** A snare: holds one of the dead this many steps (it wears a point a catch), then can't catch again for so many. */
  snareHold: 120,
  snareRearm: 60,
  /** Cans on a wire: one of the dead within a tile rattles them, heard (tiles) and waking a sleeper within so many; again after so many steps. */
  cansReach: 1,
  cansWake: 14,
  cansHeard: 6,
  cansRearm: 400,
  /** A scarecrow: those within so many tiles who are after nobody make for it, each game minute at night. */
  scareReach: 8,
  /** A sentry crossbow: shoots one of the dead within so many tiles it can see, every so many steps, a bolt's harm; holds this many bolts. */
  sentryReach: 6,
  sentryEvery: 40,
  sentryHarm: 26,
  sentryMost: 12,
} as const;
