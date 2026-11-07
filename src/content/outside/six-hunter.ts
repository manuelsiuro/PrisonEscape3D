import type { OutsideDef } from './types';

/**
 * The Six Hunter (2.36): the wooded valley of the Hollowrun past the wall. The logging road runs north from the gate,
 * over the river on its bridge and through the sawmill's deer fence to the siding, where the night's timber train is
 * loading (safety, the whole yard by the rails). The river bends across the valley, a ford in each reach (wading
 * washes the trail); culverts under the road where the gullies cross; the woodcutters' track west along the clearings,
 * up to the west ford, and north of the river to the hut; thickets along the banks and in the gullies; pines all
 * through. The Six come out after the player, the Huntmaster's bloodhound and Larch's mastiff with them; roadblocks at
 * the bridge and below the fence; the county's helicopter late.
 */
export const SIX_HUNTER_OUTSIDE: OutsideDef = {
  prison: 'six-hunter',
  map: `
............................................................
rrrrrrrrccccccrrrrrrrrccccccrrrrrrrrrrrrrrrrrrccccccrrrrrrrr
gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg
gggggggggggggggggggggggggggggggggggggggggggggggggggggggggggg
..########.cc........T.T.T..T.T.T.T.....,,.T..TTTT..........
..########.cc........T..T....TTT....T...,,......TT....T.T..T
..########.cc.............T.T...TT.T....,,.T.T....TTTTTT.T.T
..########...........T...TT..........T..,,......T...TT.....T
..TTT....T..........TTT.T.T....T........,,...T....T..T.....T
FFFFFF.FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF,,FFFFFFFFFFFFF.FFFF
T.........TT...TT.T......T...T.....TTT..,,.....TTTT......T.T
.T........T........T.T.........T.T......,,.........T.T.....T
..........T..T..T...T.TTT.hhhh..TTT.T...,,...T....T......T..
T.........TT...T..T...T..Thhhh.T.TT.T.T.,,........T.......T.
T.........T.....................T.T.....,,.T..............T.
..T.........T.T.....#####TT.....TTTT..T.,,.T.........T......
................T.T.#####......T........,,...........T.TTT..
.T..T..TT...T.T....T#####..T.T.T........uu...........TTT..T.
T..TT...T...............................,,............TTT...
.T..T.T......ddddddddddddddddddddddddddd,,.T.........T.T..T.
....TT...T...d..........................,,............T.T.T.
...hhhh..T...d.....T..T......T.T......T.,,...T...T..T....T..
..Thhhh......d..........TT....TTT.......,,...............T.T
..T.TT..T....d....T.T......TT...T..T....,,.T.T..TT..TT......
.................................TT..TT.,,.T..T.....TT...T..
~~~~~~~~~~~ff~~~~~~~~~~~~~~~~~TTThhhh...,,....hhhh.....T....
~~~~~~~~~~~ff~~~~~~~~~~~~~~~~~...hhhh.T.,,..T.hhhh.TTT...TTT
~~~~~~~~~~~ff~~~~~~~~~~~~~~~~~..........,,..................
~~~~~~~~~~~ff~~~~~~~~~~~~~~~~~~~~~~~~~~~PP~~~~~~~~~~ff~~~~~~
..............................~~~~~~~~~~PP~~~~~~~~~~ff~~~~~~
...T.T.......dd.......hhhh....~~~~~~~~~~PP~~~~~~~~~~ff~~~~~~
.T..T.hhhh...Td...T...hhhh.TTT~~~~~~~~~~PP~~~~~~~~~~ff~~~~~~
.T.T..hhhh...Td.TT...TT......TT.........,,..................
T..TTT.......Td........T..T.T...T.......,,...T.T..TT........
...T.....T.T..d........TTT...T.TT..hhh..,,.....Thhhh......T.
T.......T.....d...........TTT..T.TThhh..,,.....Thhhh......T.
..............d........TT..T..T..T....T.,,...T.............T
T.....T.TT....d.........hhTT..TT.T.T....,,............TTTT..
TT..TT.T......d.........hh...T..........uu..TT....T.T.T.T...
TTT..TT..T....d..T.......h.T............,,....TT....T.TT.TT.
T.Thhhh......Td...T.......Thhh.....TT...,,.T...T..T....TT...
..Thhhh.T.T...d..T.T.......hhhT.TTTT.T..,,.T.T.........T..T.
.T...TT...T..Td...T.......T.............,,..hhhh.TT.........
.T.T.T.TT..T..d.........................,,.ThhhhT....T..T...
.........TT...dddddddddddddddddddddddddd,,..TT....TT......T.
..........T.T...........................,,..T.....T..T.T..T.
T.TT.T............T......T.........T....,,.T..T.TT..hhhhTT.T
T..T.TT.T......T.Thhhh.T.T........TT.T..,,..TT.....ThhhhTTTT
T...TT.TTT....T..Thhhh............hhhT..,,....T.TT..TTTT....
T.T.T....hhh..TTT..T..............hhh.T.,,..T.T.T..T.T.T..TT
......TT.hhh......TT....T.........T.....,,..T........TTT....
.TTTT..T.T.TTTT...T..T..T..T..T....T....,,.....T.T....T.T...
.T..T...........TT.....T.....Thhhh......,,...TT.......T..TT.
T...TT............T.TTT.T.T...T..TT.....,,.......T.T........
........................................,,..................
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@,,@@@@@@@@@@@@@@@@@@
`,
  starts: {
    wall: { x: 8, z: 53, face: 13 },
    gate: { x: 40, z: 53, face: 13 },
    van: { x: 43, z: 35, face: 13 },
    glider: { x: 22, z: 40, face: 13 },
    sea: { x: 54, z: 32, face: 13 },
  },
  safe: [0, 1, 59, 3],
  safeKind: 'train',
  safeAt: { x: 30, z: 1, face: 1 },
  lou: { x: 30, z: 44, face: 1 },
  lines: [
    { x: 22, z: 18, face: 1 },
    { x: 30, z: 47, face: 1 },
  ],
  roadblocks: [
    { area: [40, 27, 41, 27], post: { x: 42, z: 27, face: 9 }, at: 2 },
    { area: [40, 15, 41, 15], post: { x: 39, z: 15, face: 1 }, at: 5 },
  ],
  searchers: [
    {
      name: 'Harrow',
      beat: [
        { x: 43, z: 10, face: 5 },
        { x: 54, z: 10, face: 5 },
      ],
      at: -1,
    },
    {
      name: 'Quiller',
      beat: [
        { x: 22, z: 10 },
        { x: 38, z: 10 },
      ],
      at: -1,
    },
    {
      name: 'Garrow',
      from: { x: 41, z: 54 },
      beat: [
        { x: 41, z: 50 },
        { x: 36, z: 44 },
        { x: 48, z: 37 },
        { x: 36, z: 44 },
      ],
      at: 0,
      dog: { name: 'Duchess', coat: 'bloodhound' },
    },
    {
      name: 'Fell',
      from: { x: 40, z: 54 },
      beat: [
        { x: 39, z: 34 },
        { x: 21, z: 36 },
        { x: 15, z: 33 },
        { x: 21, z: 36 },
      ],
      at: 0,
    },
    {
      name: 'Bracken',
      from: { x: 40, z: 0 },
      beat: [
        { x: 39, z: 24 },
        { x: 47, z: 21 },
        { x: 55, z: 23 },
        { x: 47, z: 21 },
      ],
      at: 5,
    },
    {
      name: 'Larch',
      from: { x: 41, z: 0 },
      beat: [
        { x: 41, z: 13 },
        { x: 48, z: 12 },
        { x: 55, z: 12 },
        { x: 48, z: 12 },
      ],
      at: 8,
      dog: { name: 'Brutus', coat: 'mastiff' },
    },
  ],
  heli: {
    at: 12,
    route: [
      { x: 10, z: 50 },
      { x: 50, z: 50 },
      { x: 50, z: 38 },
      { x: 10, z: 38 },
      { x: 10, z: 22 },
      { x: 50, z: 22 },
      { x: 50, z: 12 },
      { x: 10, z: 12 },
    ],
  },
  lookout: { x: 18, z: 35, face: 5 },
};
