/**
 * Zones: what a tile is for (routines check them, guards guard them, the HUD names them).
 * Numbers are stored per tile and in saves: never renumber, only add. Names go through t()
 * as `zone.<id>`.
 */
export const ZONES = [
  'none',
  'outside',
  'perimeter',
  'playerCell',
  'inmateCell',
  'cellBlock',
  'rollCall',
  'canteen',
  'kitchen',
  'corridor',
  'gym',
  'showers',
  'library',
  'infirmary',
  'yard',
  'laundry',
  'woodshop',
  'metalshop',
  'mailroom',
  'janitor',
  'generator',
  'solitary',
  'visitation',
  'guardQuarters',
  'controlRoom',
  // Off the ground floor (P4): what the HUD calls where the player is.
  'tunnels',
  'vents',
  'roof',
  // P9 (Stalag Flucht): cabin A's locked storeroom.
  'storeroom',
  // P11 (San Pancho): the guards' walkway inside the inner wall, the minefield beyond it.
  'walkway',
  'minefield',
  // P12 (HMP Irongate): the helipad's walled court, the dock behind its electric fence.
  'helipad',
  'dock',
  // P31 (sports grounds & gardens): the fenced sports ground, the vegetable garden.
  'sports',
  'garden',
  // The Six Hunter: the kennels (and their run), the smokehouse, the boathouse on the river.
  'kennels',
  'smokehouse',
  'boathouse',
] as const;

export type ZoneId = (typeof ZONES)[number];

export const zoneIndex = (id: ZoneId): number => ZONES.indexOf(id);

/** Zones lit by daylight only (open sky); every other zone has ceiling lights at night (the 3D's pools, and the dark's rule, 2.35). */
export const OPEN_AIR: ReadonlySet<string> = new Set(['outside', 'perimeter', 'rollCall', 'yard', 'none', 'sports', 'garden']);
/** Where the lights go out at Lights Out (2.28), past the walk home. */
export const CELL_BLOCK: ReadonlySet<string> = new Set(['cellBlock', 'playerCell', 'inmateCell']);

/** Staff only: seen in one without a guard outfit means instant 100% heat (GDD §5.2). */
export const RESTRICTED: readonly ZoneId[] = [
  'generator',
  'guardQuarters',
  'controlRoom',
  'vents',
  'roof',
  'walkway',
  'minefield',
  'helipad',
  'dock',
];
