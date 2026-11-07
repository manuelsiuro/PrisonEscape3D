import type { OutsideDef } from './types';

/**
 * The Six Hunter (2.36): the wooded valley past the wall. Pines and thickets, the Hollowrun with its road bridge and a
 * ford upstream, the logging tracks and the woodcutter's hut, the sawmill's deer fence across the valley; beyond it the
 * siding where the night's timber train is loading (safety). The Six come out after the player, two of them with
 * their hounds (Fell's foxhound stays home: two hounds out, as in the valley the bots know). A raft comes ashore on the river's south bank below the bridge. (Its first layout follows Stalag
 * Flucht's valley, which the getaway bots know; the look's pass draws it as a forest.)
 */
export const SIX_HUNTER_OUTSIDE: OutsideDef = {
  prison: 'six-hunter',
  map: `
T.....TT..T...T..T.........................T,,.....T....T..T
rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr,,rrrrrrrrrrrrrr
T.T...T...cccccc....T..TT.cccccc..TT.T.....T,,.........T...T
TTT...T...T.....T.T......T.................T,,.T.T...T.....T
TTTTTT...TT..........T.T...T.....T..TT...T..,,.......TT...TT
TTT......TT.............TTT.........TT......,,..T..TT...T.TT
............................................,,.####.......TT
............................................,,.####.......T.
FFFFFF.FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF,,F####FFFFFFFFF
............................................,,.####.......TT
TT..TT..T.T.........T....TT....T....TT...T..,,...T....T.T.TT
TT...............T...T.....T.....T.T.....T..,,.....T....T.TT
.TT...hhhhh....T..T.......T.......hhhT..T...,,T.T.........TT
TTTTT..T......T.......T..T....T.............,,.....TT.....TT
TT..T.....TT...TT..TT..T..dTT.TTT.T..T..T..T,,.TT.hT.TTT..TT
TTT...TT.T...T..TT........dTTTT.T.T....TT..T,,TT..h...T...TT
T.........T..T..........TTd..T.....TTT...T..,,TT..h...T...TT
TT...T..T.TT....T...#####.dT......T.T..TT...,,....hTT.T..TTT
TT.TT......T....T...#####.d.TT.............T,,.............T
.TT..TT.TTTTT..TT...#####.dT.TT....TT.....T.,,.T.T...T..T.TT
TT...T...T...TTTT........TdT.....T.....TT.TT,,.T......TTTTTT
TT.T.T....T..T.T.......T.Td...TT..T..T....TT,,.....TTTT..TTT
TTT.T.....T..........T.T..dddddddddddddddddd,,..........T.TT
TTT............T..T.T.T..TT...........TT....,,.T.......TTTTT
TT.........TT..TT.TT.T.....T..T.T..T........,,..T.........TT
T.......TT............TT.......T.T.TTT.T...T,,...T...T....TT
TTT.TTT..T.TT.hhhhh...TTT.....hhhhh.....T...,,..TT.TT..TT..T
TT...T.T.............TT....T.....T..T.TT.T..,,....T..T....TT
~~~~~~~~~~ff~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~PP~~~~~~~~~~~~~~
~~~~~~~~~~ff~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~PP~~~~~~~~~~~~~~
~~~~~~~~~~ff~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~PP~~~~~~~~~~~~~~
~~~~~~~~~~ff~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~PP~~~~~~~~~~~~~~
............................................,,............T.
TT..TT..TT.T.T..T..ThhhhhT.....T.TTTTT....TT,,............TT
TTT.T.....T..T.T.T.....TT.T.........hhh....T,,..T......TT.TT
TT.T.T..T...T......T..TT...........T...T....,,...T..TT..TTTT
TTTT.T.TTT.T..TT.....T.............T.T......,,...T.....T.TTT
T.T....TT.......TT.TTT.......T.T.......T...T,,T...T...T...TT
TT...T...TTTTT.T.TT....T...T...TT......TT...uuTTTT...TT..TT.
TT...T.T..TT.T.TT........T.T.T.T...TT.T....T,,..T..T..T...TT
TT..T.T..T...TT..T...T...T.....T........TT..,,.T.TTThh..T.T.
TT.TTTT...T.T.....T..TT..T.T...T..TT.......T,,TT....T.TT.TTT
TTT.......TTT..T...T..TT..T......T...TT...T.,,....TT.TTTTTTT
TT.....T.T..T.....T...TTTTTTT....TT..T.T....,,TT..T.T.T..T.T
T.............T....Tdddddddddddddddddddddddd,,.TT.T.T.TT..TT
TT...TT..T....TT...Td...T.T..T...T..T.T.....,,T.T.....TTT.T.
TTT....Thh.TT....T..d.T....TT.T..T....TT....,,T.....T.T.T.T.
TT.TT..ThhT..T.T...Td.........T....T...T.T..,,.T.T.T.....TTT
.T.T.TTTT...T.T.T..Td.TTT....T.T..T.T....T..,,..T.TTT..T.TTT
TTT.......T.TT..T...d.TT....T.TTTTTT....T.TT,,....TT.TT...T.
T.T..T......T.....T.d.......TThhh..........T,,..T.T.......TT
TT..T...........T....T.TTT.T......T.....T.T.,,.T..T....T..TT
TT......TT............TTTT......T.......T..T,,T..TT.T.T.T.TT
TT......T....T.T......T..T.TT..TT...T.......,,T....T......TT
TT..........................................,,............TT
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@,,@@@@@@@@@@@@@@
`,
  starts: {
    wall: { x: 12, z: 53, face: 13 },
    gate: { x: 44, z: 53, face: 13 },
    van: { x: 46, z: 35, face: 13 },
    glider: { x: 26, z: 24, face: 13 },
    sea: { x: 38, z: 32, face: 13 },
  },
  safe: [0, 0, 59, 5],
  safeKind: 'train',
  safeAt: { x: 22, z: 1, face: 1 },
  lou: { x: 30, z: 44, face: 1 },
  lines: [
    { x: 18, z: 18, face: 5 },
    { x: 40, z: 50, face: 1 },
  ],
  roadblocks: [
    { area: [44, 27, 45, 27], post: { x: 46, z: 27, face: 9 }, at: 2 },
    { area: [44, 16, 45, 16], post: { x: 43, z: 16, face: 1 }, at: 5 },
  ],
  searchers: [
    { name: 'Harrow', beat: [{ x: 43, z: 9, face: 5 }], at: -1 },
    {
      name: 'Quiller',
      beat: [
        { x: 4, z: 9 },
        { x: 40, z: 9 },
      ],
      at: -1,
    },
    {
      name: 'Garrow',
      beat: [
        { x: 44, z: 54 },
        { x: 36, z: 44 },
        { x: 20, z: 44 },
        { x: 20, z: 50 },
        { x: 10, z: 46 },
        { x: 20, z: 44 },
        { x: 36, z: 44 },
      ],
      at: 0,
      dog: { name: 'Duchess', coat: 'bloodhound' },
    },
    {
      name: 'Fell',
      from: { x: 45, z: 54 },
      beat: [
        { x: 43, z: 32 },
        { x: 26, z: 33 },
        { x: 12, z: 32 },
        { x: 26, z: 33 },
      ],
      at: 0,
    },
    {
      name: 'Bracken',
      from: { x: 44, z: 0 },
      beat: [
        { x: 45, z: 27 },
        { x: 38, z: 22 },
        { x: 26, z: 22 },
        { x: 26, z: 14 },
        { x: 26, z: 22 },
      ],
      at: 5,
    },
    {
      name: 'Larch',
      from: { x: 45, z: 0 },
      beat: [
        { x: 45, z: 20 },
        { x: 38, z: 13 },
        { x: 20, z: 12 },
        { x: 8, z: 14 },
        { x: 20, z: 12 },
        { x: 38, z: 13 },
      ],
      at: 8,
      dog: { name: 'Brutus', coat: 'mastiff' },
    },
  ],
  heli: {
    at: 10,
    route: [
      { x: 10, z: 50 },
      { x: 50, z: 50 },
      { x: 50, z: 36 },
      { x: 10, z: 36 },
      { x: 10, z: 24 },
      { x: 50, z: 24 },
      { x: 50, z: 12 },
      { x: 10, z: 12 },
    ],
  },
  lookout: { x: 30, z: 36, face: 5 },
};
