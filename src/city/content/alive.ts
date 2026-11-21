/**
 * A city that doesn't wait (C5 batch 6, 2.71): the numbers. Skills learnt by doing, the day's happenings (a supply drop, a cry for
 * help, a horde crossing, a crashed army truck, the fence's runner, a stash's note), the dog, the hens, Holdout. The rules are
 * sim/skills.ts, sim/happen.ts, sim/dog.ts, sim/holdout.ts and sim/survival.ts's coop. Everything here is in a city begun from 2.71
 * (`state.rev` 7) only.
 */

/** The rules' revision these come with. */
export const ALIVE_REV = 7;

// ------------------------------------------------------------------ skills

/** The four skills, by their place in `state.skills` (never renumber: saves store them). */
export const SKILLS = ['scavenger', 'handy', 'fighter', 'survivalist'] as const;
export type Skill = (typeof SKILLS)[number];
export const SKILL = { SCAVENGER: 0, HANDY: 1, FIGHTER: 2, SURVIVALIST: 3 } as const;

/**
 * The points each level begins at (level 1 at none, level 5 the last), times the skill's scale: a player searches far more often than
 * they do anything else (the scavenger bot, about 280 pieces a week: at a scale of 1 it was at level 5 by its third day).
 */
export const SKILL_AT = [0, 12, 35, 70, 120] as const;
export const SKILL_SCALE = [3, 1, 1, 1] as const;

/** What earns a point (or more). */
export const SKILL_POINTS = {
  /** Scavenger: a piece of furniture or a car searched the first time; something broken up; a happening's crate, truck or stash opened. */
  search: 1,
  salvage: 1,
  find: 3,
  /** Handy: a piece built, repaired; a thing made; a worn thing mended. */
  build: 2,
  repair: 1,
  make: 1,
  mend: 1,
  /** Fighter: one of the dead put down (a brute three). */
  kill: 1,
  brute: 3,
  /** Survivalist: a cooked meal (well fed), a night's rest, a fish caught, a planter planted or harvested, eggs taken, a Rush held. */
  meal: 2,
  rest: 3,
  fish: 1,
  plant: 1,
  harvest: 3,
  eggs: 2,
  rush: 6,
} as const;

/**
 * What each level above the first gives (by the levels above 1, `b` 0–4). Scavenger: a search this much quicker (thousandths a level),
 * this many fewer empty draws (in a thousand, a level), a draw more at level 5. Handy: work quicker; from level 3 a piece takes one
 * fewer of what it takes most of; the dead's blows on a piece miss one in (8 − b). Fighter: a blow's energy less, and one blow in
 * (7 − b) doesn't wear the weapon. Survivalist: the good states last longer and queasy shorter (in a hundred, a level).
 */
export const SKILL_GIVES = {
  searchQuicker: 80,
  fewerEmpty: 50,
  workQuicker: 80,
  cheaperFrom: 3,
  blowEnergy: 100,
  statesLonger: 15,
} as const;

// ------------------------------------------------------------------ happenings

/** The kinds of the day's happenings (never renumber: saves store them). */
export const HAPPENINGS = ['drop', 'cry', 'horde', 'truck', 'runner', 'stash'] as const;
export type Happening = (typeof HAPPENINGS)[number];
export const HAPPEN_WEIGHT = [22, 18, 16, 16, 14, 14] as const;

export const HAPPEN = {
  /** From this day; one a day, two in so many days in a hundred (never two of a kind). */
  fromDay: 2,
  twoIn: 40,
  /** Said at dawn (with the weather). */
  said: 6 * 60,
  /** A supply drop lands at one of these half hours (from, to), heard so far round it, and so many of the dead come for it. */
  dropFrom: 10 * 60,
  dropTo: 15 * 60,
  dropHeard: 24,
  dropDead: 3,
  /** A cry for help: from dawn till this hour; so many of the dead in the building with the stranger. */
  cryTo: 19 * 60,
  cryDead: 4,
  /** A horde: crossing for so long (minutes), from one of these hours; so many walking across. */
  hordeFrom: 11 * 60,
  hordeTo: 16 * 60,
  hordeFor: 120,
  hordeDead: 10,
  /** A truck: forced with a crowbar (steps), heard so far. */
  truckSteps: 100,
  truckHeard: 12,
  /** The runner: at the market from, to. */
  runnerFrom: 10 * 60,
  runnerTo: 16 * 60,
  /** Kept clear of a checkpoint (tiles). */
  gateClear: 5,
} as const;

/** What a crate, a truck, a stash holds: things always in it, then one of a list (drawn from the city's seed and the happening). */
export const HAPPEN_LOOT: Record<
  'drop' | 'truck' | 'stash' | 'cry',
  { always: ReadonlyArray<readonly [string, number]>; one: ReadonlyArray<readonly [string, number]> }
> = {
  drop: {
    always: [
      ['water', 3],
      ['tin', 2],
      ['bandage', 2],
    ],
    one: [
      ['battery', 2],
      ['bolt', 6],
      ['seeds', 3],
      ['pills', 2],
      ['ration', 2],
      ['medkit', 1],
    ],
  },
  truck: {
    always: [
      ['bolt', 8],
      ['ration', 2],
      ['water', 2],
    ],
    one: [
      ['riot_gear', 30],
      ['padded_jacket', 20],
      ['steel_crossbow', 40],
      ['hiking_pack', 1],
      ['smoke_bomb', 3],
      ['flare', 2],
    ],
  },
  stash: {
    always: [
      ['tin', 2],
      ['battery', 1],
    ],
    one: [
      ['manual_weapons', 1],
      ['manual_tricks', 1],
      ['manual_cooking', 1],
      ['chocolate', 3],
      ['knife', 30],
      ['satchel', 1],
    ],
  },
  cry: {
    always: [['bandage', 1]],
    one: [
      ['medkit', 1],
      ['crossbow', 40],
      ['manual_garden', 1],
      ['manual_fishing', 1],
      ['coffee', 3],
      ['fishing_rod', 30],
    ],
  },
};

/** The runner's swaps: [given: item, n], [got: item, n]. Four at most (the trade command carries a swap in two bits); append only. */
export const RUNNER_TRADES: ReadonlyArray<readonly [readonly [string, number], readonly [string, number]]> = [
  [
    ['scrap', 4],
    ['manual_weapons', 1],
  ],
  [
    ['cloth', 3],
    ['manual_sewing', 1],
  ],
  [
    ['tin', 2],
    ['seeds', 3],
  ],
  [
    ['battery', 2],
    ['manual_garden', 1],
  ],
];

// ------------------------------------------------------------------ the dog

/**
 * A hungry stray in the park: fed twice, it follows. It barks at the dead it sees (and wakes a sleeper before a bite), digs something
 * up once a day, never fights and can't die. Its food: what it will take from the pockets, in this order (jerky last: the ranger's errand wants it).
 */
export const DOG = {
  /** Fed this many times, it follows. */
  fed: 2,
  /** It sees the dead this far (tiles); a sleeper is woken by one this near the bed. */
  sees: 7,
  wakes: 5,
  /** Steps between two barks. */
  barkEvery: 60,
  /** Its pace (thousandths of a walk), how near it keeps, how far before it comes straight to heel (tiles). */
  pace: 1150,
  heel: 2,
  lost: 12,
  /** Digs once a day, from this hour, outdoors. */
  digFrom: 9 * 60,
  digTo: 17 * 60,
} as const;
export const DOG_FOOD: readonly string[] = ['tin', 'dried', 'fish', 'ration', 'cooked_fish', 'jerky'];
/** What it digs up: one of these, drawn from the city's seed and the day. */
export const DOG_DIGS: ReadonlyArray<readonly [string, number]> = [
  ['tin', 1],
  ['battery', 1],
  ['seeds', 2],
  ['cloth', 2],
  ['nails', 2],
  ['bandage', 1],
  ['bolt', 3],
  ['herbs', 2],
];

// ------------------------------------------------------------------ hens

/** A coop: so many hens at most, an egg a day each (counted at dawn), so many eggs kept in it at most. */
export const COOP = { hens: 2, eggs: 6 } as const;

// ------------------------------------------------------------------ Holdout

/**
 * Holdout: no story, no way out; the nights worse each time; a fall ends it. The score is the nights held and the Rushes. The dead of
 * a night: so many more for each night held (at most), on top of the city's own; the Rush every third night as in the story.
 */
export const HOLDOUT = {
  perNight: 2,
  most: 24,
} as const;
