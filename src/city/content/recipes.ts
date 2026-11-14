import { cityItemNumber } from './items';

/**
 * What the player makes (C2c): each recipe turns things from the pockets into one other. Some need a
 * workbench beside them, some a camp stove carried. Every recipe is known from the start: finding what
 * goes into them is the game. Append only: a command names a recipe by its place.
 */
export interface CityRecipe {
  /** The thing made (an item's id), and how many. */
  makes: string;
  n: number;
  /** What it takes: [item id, how many]. */
  from: ReadonlyArray<readonly [string, number]>;
  /** Made only beside a workbench; only with a camp stove in the pockets. */
  bench?: true;
  stove?: true;
  /** Known only once a survivor's first errand is done (their place in PEOPLE). */
  taught?: number;
}

export const CITY_RECIPES: readonly CityRecipe[] = [
  {
    makes: 'bandage',
    n: 1,
    from: [
      ['cloth', 2],
      ['tape', 1],
    ],
  },
  {
    makes: 'boards',
    n: 1,
    from: [
      ['plank', 2],
      ['nails', 1],
    ],
  },
  {
    makes: 'nail_bat',
    n: 1,
    from: [
      ['bat', 1],
      ['nails', 2],
      ['tape', 1],
    ],
  },
  {
    makes: 'spear',
    n: 1,
    from: [
      ['pipe', 1],
      ['blade', 1],
      ['tape', 1],
    ],
    bench: true,
  },
  {
    makes: 'knife',
    n: 1,
    from: [
      ['blade', 1],
      ['cloth', 1],
      ['tape', 1],
    ],
    bench: true,
  },
  {
    makes: 'stove',
    n: 1,
    from: [
      ['scrap', 2],
      ['fuel', 1],
      ['wire', 1],
    ],
    bench: true,
  },
  { makes: 'cooked_fish', n: 1, from: [['fish', 1]], stove: true },
  {
    makes: 'stew',
    n: 1,
    from: [
      ['tin', 1],
      ['veg', 1],
      ['water', 1],
    ],
    stove: true,
  },
  // C3b: taught by the nurse, the mechanic, the ranger.
  {
    makes: 'medkit',
    n: 1,
    from: [
      ['bandage', 2],
      ['pills', 1],
      ['tape', 1],
    ],
    taught: 1,
  },
  {
    makes: 'cleaver',
    n: 1,
    from: [
      ['blade', 2],
      ['pipe', 1],
      ['tape', 1],
    ],
    bench: true,
    taught: 2,
  },
  {
    makes: 'ration',
    n: 1,
    from: [
      ['dried', 1],
      ['fruit', 1],
      ['chocolate', 1],
    ],
    taught: 3,
  },
  // 2.52: a lantern (a bottle, a wick, a can of fuel), by hand.
  {
    makes: 'lantern',
    n: 1,
    from: [
      ['bottle', 1],
      ['cloth', 1],
      ['fuel', 1],
    ],
  },
];

/** A recipe's ingredients and result as item numbers. */
export const recipeParts = (r: CityRecipe) => ({
  makes: cityItemNumber(r.makes),
  from: r.from.map(([id, n]) => [cityItemNumber(id), n] as const),
});
