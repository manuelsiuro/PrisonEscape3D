import type { PropKind } from './props';
import type { ZoneId } from './zones';

/**
 * Furniture that holds items (GDD §6.2, §7 "whereabouts") and what it is stocked with.
 * Every morning at 08:00 the stock is topped up (GDD §6.2 daily scavenging), never past
 * `max` items, never over what is already there. The player's own desk and bed are theirs:
 * nobody restocks them.
 */
export interface LootTable {
  /** Items rolled per restock: [least, most]. */
  rolls: readonly [number, number];
  /** Never more than this many items in the container after a restock. */
  max: number;
  /** [item id, weight]. */
  items: ReadonlyArray<readonly [string, number]>;
  /** Always there after a restock (a bed's pillow and sheet). */
  fixed?: readonly string[];
}

export const LOOT: Record<string, LootTable> = {
  inmateDesk: {
    rolls: [2, 4],
    max: 6,
    items: [
      ['plastic_comb', 10],
      ['toothbrush', 10],
      ['toilet_paper', 7],
      ['sock', 8],
      ['soap', 6],
      ['battery', 4],
      ['ink', 4],
      ['magazine', 6],
      ['talcum', 6],
      ['toothpaste', 6],
      ['plastic_cup', 5],
      ['chocolate', 6],
      ['plastic_spoon', 3],
      ['plastic_fork', 3],
      ['plastic_knife', 3],
      // Contraband turns up now and then.
      ['lighter', 2],
      ['glue', 2],
      ['duct_tape', 2],
      ['metal_file', 1],
      ['wire', 2],
      ['razor_blade', 1],
      ['nail_file', 1],
    ],
  },
  playerDesk: { rolls: [0, 0], max: 0, items: [] },
  bed: { rolls: [0, 0], max: 2, items: [], fixed: ['pillow', 'bed_sheet'] },
  toilet: { rolls: [0, 1], max: 1, items: [['toilet_paper', 1]] },
  libraryShelf: { rolls: [1, 2], max: 3, items: [['ink', 3], ['magazine', 4]] },
  canteenCounter: {
    rolls: [2, 4],
    max: 6,
    items: [
      ['plastic_cup', 3],
      ['chocolate', 3],
      ['plastic_spoon', 2],
      ['plastic_fork', 2],
      ['plastic_knife', 2],
    ],
  },
  shower: { rolls: [0, 1], max: 1, items: [['soap', 1]] },
  woodshopBin: { rolls: [0, 2], max: 3, items: [['timber', 3], ['balsa', 1]] },
  laundryBin: { rolls: [1, 2], max: 3, items: [['sock', 4], ['bleach', 2], ['inmate_outfit', 2], ['guard_outfit', 1]] },
  janitorBin: { rolls: [1, 2], max: 3, items: [['broom', 2], ['mop', 2], ['bleach', 2]] },
  kitchenFreezer: { rolls: [1, 2], max: 3, items: [['foil', 2], ['potato', 3]] },
  /** What an inmate carries (looted when it's knocked out, GDD §10.2); topped up at 08:00. */
  pockets: {
    rolls: [1, 2],
    max: 2,
    items: [
      ['plastic_comb', 4],
      ['toothbrush', 4],
      ['sock', 4],
      ['soap', 3],
      ['chocolate', 5],
      ['plastic_cup', 3],
      ['toilet_paper', 3],
      ['plastic_spoon', 2],
      ['battery', 2],
      ['lighter', 1],
      ['razor_blade', 1],
      ['duct_tape', 1],
    ],
  },
};

/** Slots in a person's pockets (inmates and guards, GDD §10.2). */
export const POCKET_SLOTS = 4;

/** How many slots a container prop has, and how many of them are hidden (GDD §6.2: 6 of a desk's 16). */
export const CONTAINER_SLOTS: Partial<Record<PropKind, { slots: number; hidden: number }>> = {
  desk: { slots: 16, hidden: 6 },
  bed: { slots: 2, hidden: 0 },
  toilet: { slots: 1, hidden: 0 },
  shelf: { slots: 4, hidden: 0 },
  counter: { slots: 6, hidden: 0 },
  bin: { slots: 4, hidden: 0 },
  freezer: { slots: 4, hidden: 0 },
  shower: { slots: 1, hidden: 0 },
};

/**
 * Which table stocks a container: by its kind, the zone it stands in, and whether it is in
 * the player's cell. Null: not a container there (a counter in visitation, a shelf in the
 * mailroom…).
 */
export function lootTableFor(kind: PropKind, zone: ZoneId, playerCell: boolean): string | null {
  switch (kind) {
    case 'desk':
      return playerCell ? 'playerDesk' : zone === 'inmateCell' ? 'inmateDesk' : null;
    case 'bed':
      return zone === 'playerCell' || zone === 'inmateCell' ? 'bed' : null;
    case 'toilet':
      return 'toilet';
    case 'shelf':
      return zone === 'library' ? 'libraryShelf' : null;
    case 'counter':
      return zone === 'canteen' ? 'canteenCounter' : null;
    case 'shower':
      return 'shower';
    case 'bin':
      return zone === 'woodshop' ? 'woodshopBin' : zone === 'laundry' ? 'laundryBin' : zone === 'janitor' ? 'janitorBin' : null;
    case 'freezer':
      return zone === 'kitchen' ? 'kitchenFreezer' : null;
    default:
      return null;
  }
}
