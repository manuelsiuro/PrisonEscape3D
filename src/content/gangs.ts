/**
 * Gangs and turf (2.36, session 16): the cliques a prison's inmates belong to, what each wears and
 * wants. Who is in which, and the turf each holds (a canteen table, a corner of the yard), are the
 * prison's data (PrisonDef.gangs); how it plays out is src/sim/systems/gangs.ts.
 */

/** The gangs. Stored as numbers (a gang's place here, + 1, in `state.gang`): append only, never renumber. */
export const GANGS = ['kitchen', 'lifers', 'gymRats'] as const;
export type GangId = (typeof GANGS)[number];

/** What each gang wears (a bandana round the neck, a band on the arm: render/Character.ts), as a 3D colour. The UI's are tokens (`--gang-<id>`). */
export const GANG_COLOR: Record<GangId, number> = {
  kitchen: 0xc0242c,
  lifers: 0x2f5fd0,
  gymRats: 0x3fa535,
};

/** What a gang's boss asks of someone who wants in (the initiation favor): this, taken from a rival boss's desk. */
export const TRIBUTE: Record<GangId, string> = {
  kitchen: 'sugar',
  lifers: 'ink',
  gymRats: 'talcum',
};

/**
 * A gang in a prison (PrisonDef.gangs): its boss (a merchant's cell: the one who asks the player in,
 * whose prices drop for a member), its members by cell (the boss among them), the canteen table it
 * holds at dinner (the table and its two benches) and the corner of the yard it holds in the evening.
 */
export interface GangDef {
  id: GangId;
  boss: number;
  members: readonly number[];
  table: readonly [number, number, number, number];
  corner: readonly [number, number, number, number];
}
