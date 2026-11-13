/**
 * City Escape's districts (C1): the nine kinds a city is made of (one of each), their street names, and
 * what their blocks are filled with. Data only: the generator (city/gen/) reads it. Never reorder KINDS
 * or USES: saves and the minimap store their numbers.
 */
export const KINDS = ['suburbs', 'downtown', 'industrial', 'hospital', 'docks', 'park', 'market', 'precinct', 'metro'] as const;
export type DistrictKind = (typeof KINDS)[number];

/** Where a way out of the city starts (the story's three ends): never beside the district the player starts in. */
export const ESCAPE_KINDS: readonly DistrictKind[] = ['hospital', 'docks', 'metro'];

/** What a lot is: a building's use, or open ground. */
export const USES = [
  'none',
  'house',
  'shop',
  'office',
  'warehouse',
  'clinic',
  'garage',
  'parking',
  'green',
  'plaza',
  'yard',
  // The districts' landmarks, one each.
  'station',
  'tower',
  'factory',
  'hospital',
  'boathouse',
  'rangers',
  'mall',
  'police',
  'metro',
] as const;
export type LotUse = (typeof USES)[number];
export const useIndex = (u: LotUse) => USES.indexOf(u);

/** A building (walls, a door) rather than open ground. */
export const isBuilding = (u: LotUse) => u !== 'none' && u !== 'parking' && u !== 'green' && u !== 'plaza' && u !== 'yard';

export interface DistrictSpec {
  /** Its landmark, in its largest block. */
  landmark: LotUse;
  /** What its other blocks are, by weight. */
  blocks: ReadonlyArray<readonly [LotUse, number]>;
  /** Wrecks and rubble on its streets, in a thousand road tiles. */
  clutter: number;
  /** Proper names (never translated): one is drawn per city. */
  names: readonly string[];
}

export const DISTRICTS: Record<DistrictKind, DistrictSpec> = {
  suburbs: {
    landmark: 'station',
    blocks: [
      ['house', 8],
      ['green', 2],
      ['shop', 1],
      ['garage', 1],
    ],
    clutter: 30,
    names: ['Ashford Row', 'Linden Hollow', 'Maple Rise', 'Quarry Lane', 'Orchard End', 'Fennel Close'],
  },
  downtown: {
    landmark: 'tower',
    blocks: [
      ['office', 6],
      ['shop', 3],
      ['plaza', 2],
      ['parking', 2],
    ],
    clutter: 60,
    names: ['Meridian', 'Kings Cross', 'The Exchange', 'Carver Square', 'Old Mint', 'Halloran'],
  },
  industrial: {
    landmark: 'factory',
    blocks: [
      ['warehouse', 6],
      ['yard', 3],
      ['garage', 2],
      ['parking', 1],
    ],
    clutter: 45,
    names: ['Ironworks', 'Slag Reach', 'Furnace Row', 'Coldharbour', 'Tannery', 'Boiler Gate'],
  },
  hospital: {
    landmark: 'hospital',
    blocks: [
      ['clinic', 3],
      ['house', 3],
      ['parking', 3],
      ['green', 2],
      ['shop', 1],
    ],
    clutter: 50,
    names: ['Saint Odile', 'Mercy Hill', 'Lazarus Field', 'Whitecross', 'Hope Park', 'Bethany'],
  },
  docks: {
    landmark: 'boathouse',
    blocks: [
      ['warehouse', 6],
      ['yard', 3],
      ['shop', 1],
      ['parking', 1],
    ],
    clutter: 40,
    names: ['Gull Wharf', 'Saltmarket', 'Anchor Reach', 'Tidewater', 'Ropewalk', 'Breakwater'],
  },
  park: {
    landmark: 'rangers',
    blocks: [
      ['green', 8],
      ['house', 2],
      ['plaza', 1],
    ],
    clutter: 15,
    names: ['Hart Common', 'Willow Green', 'The Arboretum', 'Foxglove Park', 'Elder Mead', 'Rookery'],
  },
  market: {
    landmark: 'mall',
    blocks: [
      ['shop', 7],
      ['parking', 3],
      ['house', 1],
      ['plaza', 1],
    ],
    clutter: 55,
    names: ['Cornmarket', 'Galleria', 'Haymarket', 'Butter Cross', 'Arcade', 'Tollgate'],
  },
  precinct: {
    landmark: 'police',
    blocks: [
      ['office', 4],
      ['house', 3],
      ['parking', 2],
      ['garage', 2],
    ],
    clutter: 50,
    names: ['Ninth Precinct', 'Bridewell', 'Marshal Street', 'Constable Yard', 'Watch Hill', 'Assize'],
  },
  metro: {
    landmark: 'metro',
    blocks: [
      ['shop', 4],
      ['office', 3],
      ['house', 3],
      ['plaza', 2],
    ],
    clutter: 55,
    names: ['Central Line', 'Junction', 'Undercroft', 'Terminus', 'Viaduct', 'Crossrail'],
  },
};
