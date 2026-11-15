/**
 * City Escape's dead (C2b): the numbers their rules run on. Shamblers only for now: slow, dull-eyed,
 * dangerous in numbers. By day they keep indoors, where it's dark; at night they're in the streets.
 */
export const DEAD = {
  /** A shambler's health; its walk when it wanders and when it's after someone (units a step; the player's is 184). */
  health: 30,
  wander: 70,
  chase: 126,
  /** How far it sees with a clear line (tiles): by day, at night, and someone lying asleep. */
  sightDay: 6,
  sightNight: 4,
  sightAsleep: 2,
  /** Steps without seeing them before it gives up the chase (and goes to where it saw them last). */
  lose: 120,
  /** A bite: how near (units), its harm, the steps between two, and the steps it takes to lunge once in reach (struck meanwhile, it starts again). */
  reach: 900,
  bite: 8,
  biteEvery: 24,
  lunge: 9,
  /** Struck, it reels this many steps and is pushed back this far (units). */
  reel: 10,
  shove: 420,
  /** Indoors by day: three, two more a step of danger, one more a day (six more at most); outdoors, the danger's worth. */
  dayBase: 3,
  dayPerDanger: 2,
  dayPerDay: 1,
  dayMost: 6,
  /** 2.53: by day they wait in the dark indoors, no more than one to this many dark tiles (the rest indoors anywhere). */
  darkEach: 8,
  /** 2.53: at dawn one in the street goes to ground in the dark when a dark room is within this many tiles' walk; else indoors anywhere. */
  darkNear: 10,
  /** At night: six, three more a step of danger, two more a night (sixteen more at most). */
  nightBase: 6,
  nightPerDanger: 3,
  nightPerNight: 2,
  nightMost: 16,
  /** Never put down nearer the player than this (tiles); the night's come a few at a time, this many game minutes apart. */
  clear: 10,
  trickle: 20,
  /** Up out of the metro's tunnel (C3): this near at the least. */
  clearUp: 5,
} as const;

/**
 * The dead's other kinds (C3b), at night only: runners from the third night (one arrival in eight: as
 * fast as a tired player, frail), and from the fifth one brute in a district two or more steps of
 * danger (slow, hard to put down, a worse bite; it pounds a barred door in its way open). Never renumber.
 */
export const ZKIND = { SHAMBLER: 0, RUNNER: 1, BRUTE: 2, CRAWLER: 3, SCREAMER: 4, BLOATER: 5 } as const;
/**
 * 2.60: three more. A crawler: by day, in the dark indoors, from the second day (one in five put down there): low, slow, frail; it
 * sees only three tiles, lunges quicker, and its bite holds a leg (the player slowed for `hold` steps). A screamer: at night from the
 * second (one arrival in ten): frail, a weak bite; seeing the player it screams, and the dead within `reach` tiles of them come.
 * A bloater: at night from the fourth (one arrival in twelve): slow, swollen; put down, it bursts: `harm` to the player within
 * `within` units, `dead` to each of the dead there, heard `noise` tiles off. Struck from a spear's length, shot or burnt, it is safe.
 */
export const CRAWLER = { health: 18, chase: 92, bite: 5, fromDay: 2, oneIn: 5, sight: 3, lunge: 4, hold: 40 } as const;
export const SCREAMER = { health: 14, chase: 112, bite: 4, fromNight: 2, oneIn: 10, reach: 12 } as const;
export const BLOATER = { health: 44, chase: 92, bite: 8, fromNight: 4, oneIn: 12, harm: 12, within: 1700, dead: 16, noise: 9 } as const;
export const RUNNER = { health: 16, chase: 168, bite: 6, fromNight: 3, oneIn: 8 } as const;
export const BRUTE = { health: 90, chase: 108, bite: 14, fromNight: 5, danger: 2, reel: 4, shove: 140, pound: 80 } as const;

/**
 * 2.58: a sleeper's barred door found by the dead. From this night on, each hour asleep in a shelter: so many chances in a hundred
 * a night past it (no more than `most`) that one of them within `near` tiles comes to the boards; they give after `pound` of its steps there.
 */
export const SIEGE = { fromNight: 3, perNight: 2, most: 8, near: 16, pound: 300 } as const;

/** The player's blow (C2b; the city's weapons add their own). */
export const BLOW = {
  /** Bare hands; a weapon adds twice its `attack`. */
  fists: 6,
  /** How far it lands (units), a weapon's `reach` in tiles more; the steps between two; what it costs (thousandths of energy); worn out, half the harm. */
  reach: 1300,
  every: 12,
  energy: 1500,
  /** How far its noise carries (tiles); a search's rustle. */
  noise: 7,
  rustle: 4,
  /** 2.60: a blow on one that isn't after anyone (it never saw it coming): this many times the harm. */
  unseen: 2,
} as const;

/** What a kind is made of: its health, its pace after someone, its bite, the steps it reels, how far a blow shoves it, the steps of its lunge. */
export interface KindStats {
  health: number;
  chase: number;
  bite: number;
  reel: number;
  shove: number;
  lunge: number;
}
const base = { reel: DEAD.reel, shove: DEAD.shove, lunge: DEAD.lunge };
const KINDS: readonly KindStats[] = [
  { ...base, health: DEAD.health, chase: DEAD.chase, bite: DEAD.bite },
  { ...base, health: RUNNER.health, chase: RUNNER.chase, bite: RUNNER.bite },
  { ...base, health: BRUTE.health, chase: BRUTE.chase, bite: BRUTE.bite, reel: BRUTE.reel, shove: BRUTE.shove },
  { ...base, health: CRAWLER.health, chase: CRAWLER.chase, bite: CRAWLER.bite, lunge: CRAWLER.lunge },
  { ...base, health: SCREAMER.health, chase: SCREAMER.chase, bite: SCREAMER.bite },
  { ...base, health: BLOATER.health, chase: BLOATER.chase, bite: BLOATER.bite, reel: 6, shove: 260 },
];
export const kindStats = (kind: number | undefined): KindStats => KINDS[kind ?? 0] ?? KINDS[0];
