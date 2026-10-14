/**
 * What the player asks for during one step, packed in one integer so command logs stay
 * small: bits 0–4 the direction (0 = stand still, 1–16 = a compass point), bits 5–8 a
 * one-step operation (OP), bits 9–16 and 17–24 its two arguments. Keyboard, touch and
 * bots all produce the same commands; an operation is sent for exactly one step.
 */
export const DIRS = 16;

/** One-step operations (an item moved, a desk opened…). Never renumber: logs store them. */
export const OP = {
  NONE: 0,
  /** Use what is in front: pick up, open a container, sleep in your bed, climb, cover damage. a = 1: down the tunnel under the open desk. */
  INTERACT: 1,
  /** Close the open container. */
  CLOSE: 2,
  /** Move an item from slot a to slot b (see SLOT), swapping if b is taken. */
  MOVE: 3,
  /** Drop the item in slot a on the floor. */
  DROP: 4,
  /** Craft from the carried slots in mask a (bit k = slot k): the workbench; b = previewed recipe + 1 (0: any). */
  CRAFT: 5,
  /** Wear or wield the item in slot a (outfit or weapon slot). */
  EQUIP: 6,
  /** Hold hotbar slot a in hand. */
  SELECT: 7,
  /** Strike with the tool in hand (chip, cut, unscrew, dig), or eat what is in hand; locked on to someone, a blow at them. Sent every step while held; strikes and blows land at their own pace. a = 1: a fresh press. */
  USE: 8,
  /** Lock on to the next nearest person in reach (past the last: none). a = 1: let go of the lock; a = 2 + id: that person (Cast id). */
  LOCK: 9,
} as const;

/** Slot addresses for OP.MOVE / DROP / EQUIP: 0–5 the hotbar, then the weapon, the outfit, then the open container's slots. */
export const SLOT = { HOTBAR: 0, WEAPON: 6, OUTFIT: 7, CONTAINER: 8 } as const;

export const command = (dir: number, op = 0, a = 0, b = 0) => (dir & 31) | ((op & 15) << 5) | ((a & 255) << 9) | ((b & 255) << 17);
export const dirOf = (cmd: number) => cmd & 31;
export const opOf = (cmd: number) => (cmd >>> 5) & 15;
export const argA = (cmd: number) => (cmd >>> 9) & 255;
export const argB = (cmd: number) => (cmd >>> 17) & 255;

/**
 * Unit vectors for the 16 directions, scaled to 1024 and rounded, so every platform gets
 * the same integers. Direction 1 is east (+x), 5 south (+z), 9 west, 13 north.
 */
export const DIR_X = new Int16Array(DIRS + 1);
export const DIR_Z = new Int16Array(DIRS + 1);
for (let d = 1; d <= DIRS; d++) {
  const a = ((d - 1) * Math.PI * 2) / DIRS;
  DIR_X[d] = Math.round(Math.cos(a) * 1024);
  DIR_Z[d] = Math.round(Math.sin(a) * 1024);
}

/** The direction closest to a vector (screen or world, x right and z down); 0 when it's (0, 0). */
export function dirFromVector(x: number, z: number): number {
  if (x === 0 && z === 0) return 0;
  const a = Math.atan2(z, x);
  return (((Math.round((a / (Math.PI * 2)) * DIRS) % DIRS) + DIRS) % DIRS) + 1;
}
