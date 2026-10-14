/**
 * What the player asks for during one step, packed in one integer so command logs stay
 * small: bits 0–4 the direction (0 = stand still, 1–16 = a compass point), the bits above
 * the action buttons. Keyboard, touch and bots all produce the same commands.
 */
export const DIRS = 16;

/** Action bits (shifted above the direction). Filled in as the systems arrive. */
export const ACT = {} as const;

export const command = (dir: number, actions = 0) => (dir & 31) | (actions << 5);
export const dirOf = (cmd: number) => cmd & 31;
export const actionsOf = (cmd: number) => cmd >>> 5;

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
