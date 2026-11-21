/**
 * Building a base (C5 batch 2, 2.67): what the player puts up, what each takes, how much it stands, whether it stops a body
 * (and the dead's sight), what it gives a sleeper's comfort. A piece stands on one tile; walls and doors stand across the way the
 * player faced when building them. Never renumber: saves store a piece's place in this list.
 */
export interface PieceDef {
  id: string;
  /** What it takes: [item id, how many]. */
  from: ReadonlyArray<readonly [string, number]>;
  /** Its health (the dead's blows take it down a point at a time; a brute's four). */
  hp: number;
  /** Nobody walks through it (else: walked over, as a rug or a chair). */
  solid: boolean;
  /** It hides what's behind it from the dead (a wall, a door). */
  veil?: true;
  /** A door: the player walks through it, the dead don't. */
  door?: true;
  /** What it adds to a sleeper's comfort within `BUILD.comfortReach` tiles. */
  comfort: number;
  /** Stands across the way (a wall, a door): drawn turned to the facing it was built from. */
  across?: true;
  /** 2.68: a trap, working on the dead by itself (content/rush.ts's TRAP; sim/dead.ts). */
  trap?: 'spikes' | 'wire' | 'snare' | 'cans' | 'scare' | 'sentry';
  /** 2.69: what goes into it whole and comes back whole when it's taken down (never in a repair's cost): a workshop's toolkit. */
  keeps?: string;
  /** 2.70: built only once its manual is read (MANUALS' place), in a city begun from then. */
  manual?: number;
  /** 2.70: what it does: a planter grows, a rain barrel fills, a smoker smokes (sim/survival.ts); 2.71: a coop's hens lay. */
  grows?: 'planter' | 'barrel' | 'smoker' | 'coop';
  /** 2.71: only in a city begun from this revision (`state.rev`). */
  rev?: number;
}

export const PIECES: readonly PieceDef[] = [
  {
    id: 'barricade',
    from: [
      ['plank', 2],
      ['nails', 1],
    ],
    hp: 60,
    solid: true,
    comfort: 0,
    across: true,
  },
  {
    id: 'plankWall',
    from: [
      ['plank', 4],
      ['nails', 2],
    ],
    hp: 120,
    solid: true,
    veil: true,
    comfort: 0,
    across: true,
  },
  {
    id: 'metalWall',
    from: [
      ['scrap', 4],
      ['nails', 2],
      ['wire', 1],
    ],
    hp: 250,
    solid: true,
    veil: true,
    comfort: 0,
    across: true,
  },
  {
    id: 'door',
    from: [
      ['plank', 3],
      ['nails', 1],
      ['scrap', 1],
    ],
    hp: 100,
    solid: false,
    veil: true,
    door: true,
    comfort: 0,
    across: true,
  },
  {
    id: 'chest',
    from: [
      ['plank', 4],
      ['nails', 2],
    ],
    hp: 60,
    solid: true,
    comfort: 1,
  },
  {
    id: 'cot',
    from: [
      ['plank', 3],
      ['cloth', 4],
    ],
    hp: 50,
    solid: true,
    comfort: 3,
  },
  {
    id: 'workbench',
    from: [
      ['plank', 4],
      ['nails', 2],
      ['scrap', 2],
    ],
    hp: 80,
    solid: true,
    comfort: 0,
  },
  {
    id: 'campfire',
    from: [
      ['plank', 3],
      ['scrap', 1],
    ],
    hp: 40,
    solid: true,
    comfort: 2,
  },
  {
    id: 'table',
    from: [
      ['plank', 3],
      ['nails', 1],
    ],
    hp: 50,
    solid: true,
    comfort: 1,
  },
  { id: 'chair', from: [['plank', 2]], hp: 30, solid: false, comfort: 1 },
  { id: 'rug', from: [['cloth', 3]], hp: 20, solid: false, comfort: 1 },
  // 2.68: the traps. Walked over by everyone (the player knows where they are), but the scarecrow and the sentry.
  {
    id: 'spikes',
    from: [
      ['plank', 2],
      ['nails', 3],
    ],
    hp: 30,
    solid: false,
    comfort: 0,
    across: true,
    trap: 'spikes',
  },
  {
    id: 'barbedWire',
    from: [
      ['wire', 2],
      ['scrap', 1],
    ],
    hp: 40,
    solid: false,
    comfort: 0,
    across: true,
    trap: 'wire',
  },
  {
    id: 'snare',
    from: [
      ['wire', 1],
      ['plank', 1],
    ],
    hp: 3,
    solid: false,
    comfort: 0,
    trap: 'snare',
  },
  {
    id: 'cans',
    from: [
      ['scrap', 1],
      ['wire', 1],
    ],
    hp: 20,
    solid: false,
    comfort: 0,
    across: true,
    trap: 'cans',
  },
  {
    id: 'scarecrow',
    from: [
      ['plank', 2],
      ['cloth', 2],
    ],
    hp: 40,
    solid: true,
    comfort: 0,
    trap: 'scare',
  },
  {
    id: 'sentry',
    from: [
      ['crossbow', 1],
      ['scrap', 2],
      ['wire', 1],
    ],
    hp: 60,
    solid: true,
    comfort: 0,
    trap: 'sentry',
  },
  // 2.69: the workshop: a bench with the toolkit's vise and tools (works as a workbench, and makes what wants a workshop).
  {
    id: 'workshop',
    from: [
      ['toolkit', 1],
      ['plank', 4],
      ['scrap', 2],
      ['nails', 2],
    ],
    hp: 100,
    solid: true,
    comfort: 0,
    keeps: 'toolkit',
  },
  // 2.70: what feeds and waters a base: a planter, a rain barrel (the garden's manual), a smoker (the fishing's).
  {
    id: 'planter',
    from: [
      ['plank', 3],
      ['nails', 1],
    ],
    hp: 40,
    solid: true,
    comfort: 1,
    manual: 3,
    grows: 'planter',
  },
  {
    id: 'rainBarrel',
    from: [
      ['scrap', 3],
      ['plank', 1],
    ],
    hp: 60,
    solid: true,
    comfort: 0,
    manual: 3,
    grows: 'barrel',
  },
  {
    id: 'smoker',
    from: [
      ['scrap', 3],
      ['plank', 2],
      ['nails', 1],
    ],
    hp: 60,
    solid: true,
    comfort: 1,
    manual: 4,
    grows: 'smoker',
  },
  // 2.71: a coop for the ranger's hens: an egg a day each.
  {
    id: 'coop',
    from: [
      ['plank', 4],
      ['nails', 2],
      ['wire', 1],
    ],
    hp: 50,
    solid: true,
    comfort: 1,
    grows: 'coop',
    rev: 7,
  },
];

export const pieceOf = (kind: number): PieceDef | undefined => PIECES[kind];
export const PIECE = Object.fromEntries(PIECES.map((p, k) => [p.id, k])) as Record<string, number>;

export const BUILD = {
  /** Steps to put a piece up, to repair a quarter of one, to take one down; how far the hammering is heard (tiles). */
  steps: 60,
  repairSteps: 30,
  downSteps: 30,
  noise: 7,
  /** The most pieces in a district (a phone draws them all). */
  most: 120,
  /** A chest's slots. */
  chestSlots: 12,
  /** A campfire burns this long when built, and a plank fed to it this much more (game minutes), to this at the most. */
  fireMinutes: 360,
  feedMinutes: 240,
  fireMost: 720,
  /** Nothing built within this many tiles of a checkpoint's street ends, nor beside a survivor or the way out. */
  gateClear: 2,
  /** One of the dead at a piece in its way: a blow every so many steps, a point of its health (a brute's four). */
  poundEvery: 10,
  bruteHarm: 4,
  /** A sleeper's comfort: what's built (and a light burning) within this many tiles; a Hideout from this much, a Home from this. */
  comfortReach: 6,
  hideout: 3,
  home: 6,
  /** 2.68: a sentry's `more`: its bolts, and its crossbow's blows left times this. */
  sentryWear: 16,
} as const;

/** How a sleeper's comfort tells: energy back asleep (thousandths a game minute) and a point of health every so many minutes. */
export const COMFORT = [
  { energy: 250, mend: 4 },
  { energy: 312, mend: 3 },
  { energy: 375, mend: 2 },
] as const;
