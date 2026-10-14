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
] as const;

export type ZoneId = (typeof ZONES)[number];

export const zoneIndex = (id: ZoneId): number => ZONES.indexOf(id);

/** Staff only: seen in one without a guard outfit means instant 100% heat (GDD §5.2). Roofs and vents join in P4. */
export const RESTRICTED: readonly ZoneId[] = ['generator', 'guardQuarters', 'controlRoom'];
