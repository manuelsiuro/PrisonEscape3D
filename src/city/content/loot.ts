import type { PropKind } from '../../content/props';
import type { LotUse } from './districts';
import { cityItemNumber } from './items';

/**
 * What's found where (C2): each piece of furniture that can be searched holds a few draws from its
 * building's list, with the furniture's own leanings added (a freezer leans to food, a workbench to
 * tools). Most draws come up empty: the city was picked over before the player woke.
 */

/** How many draws a piece of furniture gets (not listed: not searched). */
export const SEARCHED: Partial<Record<PropKind, number>> = {
  desk: 2,
  shelf: 2,
  counter: 2,
  bin: 1,
  freezer: 3,
  crate: 2,
  workbench: 2,
  vending: 3,
  bed: 1,
  table: 1,
};
/** Pockets a piece of furniture has, for what's put back or stashed in it. */
export const BOX_SLOTS = 6;
/** A draw in a thousand that finds nothing. */
export const EMPTY_DRAWS = 560;
/** Game steps a first search takes (later looks are at once). */
export const SEARCH_STEPS = 30;

type Weights = ReadonlyArray<readonly [string, number]>;

const HOME: Weights = [
  ['tin', 10],
  ['dried', 6],
  ['water', 7],
  ['soda', 3],
  ['fruit', 2],
  ['chocolate', 3],
  ['bandage', 3],
  ['pills', 2],
  ['cloth', 6],
  ['tape', 3],
  ['battery', 3],
  ['bottle', 4],
  ['knife', 1],
  ['bat', 1],
  ['torch', 1],
];
const STORE: Weights = [
  ['tin', 12],
  ['dried', 9],
  ['water', 9],
  ['soda', 8],
  ['chocolate', 6],
  ['fruit', 3],
  ['veg', 3],
  ['battery', 3],
  ['tape', 2],
  ['bottle', 3],
  ['bandage', 1],
];
const WORK: Weights = [
  ['water', 4],
  ['soda', 3],
  ['chocolate', 3],
  ['tape', 5],
  ['battery', 5],
  ['cloth', 2],
  ['pills', 2],
  ['wire', 3],
  ['bottle', 2],
  ['torch', 1],
];
const SHED: Weights = [
  ['plank', 9],
  ['nails', 8],
  ['pipe', 6],
  ['scrap', 7],
  ['wire', 5],
  ['tape', 4],
  ['fuel', 3],
  ['cloth', 3],
  ['blade', 2],
  ['crowbar', 2],
  ['cutters', 1],
  ['tin', 2],
  ['water', 2],
];
const CARE: Weights = [
  ['bandage', 12],
  ['pills', 9],
  ['water', 6],
  ['cloth', 6],
  ['tape', 3],
  ['blade', 2],
  ['tin', 2],
  ['battery', 2],
];

/** A building's list, by what it is. */
export const LOOT_BY_USE: Partial<Record<LotUse, Weights>> = {
  house: HOME,
  rangers: HOME,
  shop: STORE,
  mall: STORE,
  station: STORE,
  metro: STORE,
  office: WORK,
  tower: WORK,
  police: WORK,
  warehouse: SHED,
  garage: SHED,
  factory: SHED,
  boathouse: [...SHED, ['fish', 8]],
  clinic: CARE,
  hospital: CARE,
};

/** What a piece of furniture adds to its building's list. */
export const LOOT_BY_PROP: Partial<Record<PropKind, Weights>> = {
  freezer: [
    ['tin', 10],
    ['veg', 8],
    ['fruit', 6],
    ['fish', 5],
    ['water', 6],
  ],
  vending: [
    ['soda', 14],
    ['chocolate', 12],
    ['dried', 8],
    ['water', 8],
  ],
  workbench: [
    ['nails', 8],
    ['tape', 6],
    ['blade', 4],
    ['pipe', 4],
    ['crowbar', 2],
    ['cutters', 1],
  ],
  bin: [
    ['bottle', 8],
    ['cloth', 5],
    ['scrap', 5],
  ],
  bed: [
    ['cloth', 6],
    ['pills', 2],
    ['knife', 1],
  ],
};

/** The list a piece of furniture draws from, as [item number, weight], and the weights' sum. */
export function lootList(use: LotUse, prop: PropKind): { list: Array<[number, number]>; total: number } {
  const list: Array<[number, number]> = [];
  for (const [id, w] of [...(LOOT_BY_USE[use] ?? HOME), ...(LOOT_BY_PROP[prop] ?? [])]) list.push([cityItemNumber(id), w]);
  return { list, total: list.reduce((n, [, w]) => n + w, 0) };
}
