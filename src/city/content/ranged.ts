/**
 * City Escape's weapons thrown or shot (2.55): the numbers. An empty bottle thrown is a noise where it
 * lands; a molotov (a bottle, fuel, tape) leaves a patch of fire that burns whoever stands in it; a
 * crossbow shoots a bolt at one of the dead out of arm's reach, quietly.
 */
export const RANGED = {
  /** How far a thing is thrown (tiles), and how wide of the way faced one of the dead may stand and still be thrown or shot at (the square of the angle's cosine, `aim` over `aimOf`: about 37 degrees either side). */
  throwReach: 6,
  aim: 16,
  aimOf: 25,
  /** A bottle breaking: how far it's heard (tiles). */
  bottleNoise: 8,
  /** A molotov: its noise (a whoosh, not a crash: it burns those it's thrown at, it doesn't call the street into the fire), how far the fire spreads from where it lands (tiles), how long it burns (steps), the steps between two burns, what each takes from the dead and from the player. */
  fireNoise: 4,
  fireSpread: 1,
  fireSteps: 240,
  burnEvery: 10,
  burnDead: 8,
  burnPlayer: 4,
  /** The most tiles burning at once in a district (the oldest go out for more). */
  fireMost: 36,
  /** A crossbow: how far it shoots (tiles), a bolt's harm, the steps between two shots, how far it's heard (tiles), a bolt found again one time in this many. */
  shotReach: 7,
  shotHarm: 26,
  shotEvery: 30,
  shotNoise: 2,
  boltBack: 2,
} as const;
