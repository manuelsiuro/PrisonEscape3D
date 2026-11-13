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
export const ZKIND = { SHAMBLER: 0, RUNNER: 1, BRUTE: 2 } as const;
export const RUNNER = { health: 16, chase: 168, bite: 6, fromNight: 3, oneIn: 8 } as const;
export const BRUTE = { health: 90, chase: 108, bite: 14, fromNight: 5, danger: 2, reel: 4, shove: 140, pound: 80 } as const;

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
} as const;
