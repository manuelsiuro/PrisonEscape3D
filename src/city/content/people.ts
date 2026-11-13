import type { LotUse } from './districts';
import type { Thing } from './story';

/**
 * City Escape's survivors (C3b): four people still alive in the city, each holding a building of their
 * own (no dead are put down in it). Each asks two errands in turn (things brought from the pockets, or
 * so many of the dead put down since it was asked), pays for them, teaches a recipe after the first,
 * and trades. Append only: saves store a survivor's place in the list.
 */
export interface Errand {
  /** Things to bring: [item id, how many]; or the dead to put down since it was asked. */
  bring?: readonly [string, number];
  kills?: number;
  /** What's handed over for it: things, and (the fence) the police armoury's key. */
  gives: ReadonlyArray<readonly [string, number]>;
  key?: true;
}

export interface Person {
  id: 'fence' | 'nurse' | 'mechanic' | 'ranger';
  /** The buildings they may hold, the first found in the city (most wanted first), and the kind of district looked in first. */
  uses: readonly LotUse[];
  errands: readonly [Errand, Errand];
  /** Swaps, as often as wanted: [given: item, n], [got: item, n]. */
  trades: ReadonlyArray<readonly [readonly [string, number], readonly [string, number]]>;
}

export const PEOPLE: readonly Person[] = [
  {
    // Rook: the fourth name on the bus's list was the player's; his was the third.
    id: 'fence',
    uses: ['mall'],
    errands: [
      { bring: ['cloth', 3], gives: [['tin', 2]], key: true },
      {
        bring: ['battery', 2],
        gives: [
          ['crowbar', 1],
          ['chocolate', 2],
        ],
      },
    ],
    trades: [
      [
        ['cloth', 2],
        ['tin', 1],
      ],
      [
        ['scrap', 2],
        ['nails', 1],
      ],
      [
        ['soda', 2],
        ['battery', 1],
      ],
    ],
  },
  {
    id: 'nurse',
    uses: ['clinic', 'hospital'],
    errands: [
      { bring: ['bottle', 2], gives: [['bandage', 2]] },
      { kills: 10, gives: [['pills', 3]] },
    ],
    trades: [
      [
        ['cloth', 2],
        ['bandage', 1],
      ],
      [
        ['water', 2],
        ['pills', 1],
      ],
      [
        ['chocolate', 1],
        ['bandage', 1],
      ],
    ],
  },
  {
    id: 'mechanic',
    uses: ['garage', 'factory'],
    errands: [
      {
        bring: ['scrap', 2],
        gives: [
          ['pipe', 1],
          ['tape', 1],
        ],
      },
      {
        bring: ['fuel', 1],
        gives: [
          ['plank', 4],
          ['nails', 2],
        ],
      },
    ],
    trades: [
      [
        ['wire', 1],
        ['tape', 1],
      ],
      [
        ['tin', 1],
        ['blade', 1],
      ],
      [
        ['battery', 1],
        ['fuel', 1],
      ],
    ],
  },
  {
    id: 'ranger',
    uses: ['rangers'],
    errands: [
      {
        bring: ['dried', 2],
        gives: [
          ['veg', 2],
          ['fruit', 2],
        ],
      },
      { kills: 15, gives: [['spear', 1]] },
    ],
    trades: [
      [
        ['bottle', 2],
        ['water', 1],
      ],
      [
        ['cloth', 1],
        ['veg', 1],
      ],
      [
        ['nails', 1],
        ['dried', 1],
      ],
    ],
  },
];

/** The story's things kept in the police armoury: found only with its key (the fence's first errand). */
export const LOCKED: readonly Thing[] = ['flare', 'keycard'];
