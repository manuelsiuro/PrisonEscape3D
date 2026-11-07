// How a character holds each item (session 15, v2.36.0), by the item's model (content/items.ts `shape`):
// a tool out of the fist, a cup upright, a mop by its handle with its head down, a bundle in both hands,
// a book by its edge (open between both hands to read). A model made later and not listed here is held
// out of the fist, as every item was before.

/** The ways of holding. */
export const GRIP = {
  /** Out of the fist, pointing forward (tools and weapons: a strike swings it). */
  FIST: 0,
  /** The same, smaller, closer in (a key, a comb, a pill). */
  SMALL: 1,
  /** Upright in the fist, whatever the arm does (a cup, a can, a bottle). */
  UPRIGHT: 2,
  /** By the handle, the head down by the feet (a mop, a broom); in both hands, sweeping, at work with it. */
  POLE: 3,
  /** In both hands before the belly, the arms out under it (a bundle, a plank, a crate). */
  CARRY: 4,
  /** By its edge, standing up at the side (a book, a letter, a form); open before the face to read. */
  FLAT: 5,
} as const;

const BY_SHAPE: Record<string, number> = {
  comb: GRIP.SMALL,
  brush: GRIP.SMALL,
  lighter: GRIP.SMALL,
  file: GRIP.SMALL,
  blade: GRIP.SMALL,
  key: GRIP.SMALL,
  mold: GRIP.SMALL,
  lockpick: GRIP.SMALL,
  spoon: GRIP.SMALL,
  fork: GRIP.SMALL,
  knife: GRIP.SMALL,
  pills: GRIP.SMALL,
  firecracker: GRIP.SMALL,
  battery: GRIP.SMALL,
  bar: GRIP.SMALL,
  shaker: GRIP.SMALL,
  sock: GRIP.SMALL,
  jerky: GRIP.SMALL,
  cup: GRIP.UPRIGHT,
  can: GRIP.UPRIGHT,
  bottle: GRIP.UPRIGHT,
  jar: GRIP.UPRIGHT,
  bag: GRIP.UPRIGHT,
  egg: GRIP.UPRIGHT,
  brew: GRIP.UPRIGHT,
  mop: GRIP.POLE,
  broom: GRIP.POLE,
  cloth: GRIP.CARRY,
  plank: GRIP.CARRY,
  sheet: GRIP.CARRY,
  plate: GRIP.CARRY,
  pack: GRIP.CARRY,
  tray: GRIP.CARRY,
  stool: GRIP.CARRY,
  pillow: GRIP.CARRY,
  outfit: GRIP.CARRY,
  seedTray: GRIP.CARRY,
  vegCrate: GRIP.CARRY,
  cake: GRIP.CARRY,
  gift: GRIP.CARRY,
  pumpkin: GRIP.CARRY,
  lantern: GRIP.CARRY,
  raft: GRIP.CARRY,
  dummy: GRIP.CARRY,
  frame: GRIP.CARRY,
  glider: GRIP.CARRY,
  track: GRIP.CARRY,
  caughtRat: GRIP.CARRY,
  book: GRIP.FLAT,
  tome: GRIP.FLAT,
  letter: GRIP.FLAT,
  card: GRIP.FLAT,
  idCard: GRIP.FLAT,
  form: GRIP.FLAT,
  formBlank: GRIP.FLAT,
  packet: GRIP.FLAT,
  poster: GRIP.FLAT,
  // 2.36 (The Six Hunter's).
  tarPot: GRIP.UPRIGHT,
  bowl: GRIP.UPRIGHT,
  net: GRIP.CARRY,
  ghillie: GRIP.CARRY,
  seeds: GRIP.SMALL,
  fish: GRIP.SMALL,
  dragLine: GRIP.SMALL,
  soapCake: GRIP.SMALL,
  horn: GRIP.SMALL,
};

/** How an item of this model is held. */
export function gripOf(shape: string): number {
  return BY_SHAPE[shape] ?? GRIP.FIST;
}

/** Its size in the hand against the model's (a mop as tall as the waist, a key not as long as the forearm). */
export const GRIP_SCALE = [1.05, 0.8, 1, 1.5, 0.95, 0.9];

/** Where a mop or broom is gripped along its length (the model's x; the head at +0.24): low on one hand, higher up with two. */
export const POLE_ONE_HAND = 0.03;
export const POLE_TWO_HANDS = -0.2;
