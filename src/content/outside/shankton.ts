import type { OutsideDef } from './types';

/** Shankton: the industrial estate past the perimeter road, warehouses and container yards, the workers' terrace, the rail yard behind its wire and the night freight at its far end. */
export const SHANKTON_OUTSIDE: OutsideDef = {
  prison: 'shankton',
  map: `
...T.T..T.....T...T..............T..............T.......T...
..T....TT.T...TT.T..#####....T.............T.....T.T...T....
..........TTT..T..T.#####...T.TTT...TT..................T...
....................#####...................................
gggggggggggggggggggggggggggggg,,gggggggggggggggggggggggggggg
gggggggggggggggggggggggggggggg,,gggggggggggggggggggggggggggg
rrrrccccccccrrrrrrrrrrrrrrrrrr,,rrrrrrrrrrrrrrrrrrcccccccrrr
gggggggggggggggggggggggggggggg,,gggggggggggggggggggggggggggg
rrrrrrrrrrrrrrrrcccccccrrrrrrr,,rrrrrrrrrrrrrrrrrrrrrrrrrrrr
gggggggggggggggggggggggggggggg,,gggggggggggggggggggggggggggg
gggggggggggggggggggggggggggggg,,gggggggggggggggggggggggggggg
rrrrrrrrrrrrrrrrrrrrrrrrrrrrcc,,cccrrrrrrrrrrrrrrrrrrrrrrrrr
gggggggggggggggggggggggggggggg,,gggggggggggggggggggggggggggg
rrrrrrccccccccrrrrrrrrrrrrrrrr,,rrrrrrcccccccccrrrrrrrrrrrrr
gggggggggggggggggggggggggggggg,,gggggggggggggggggggggggggggg
gggggggggggggggggggggggggggggg,,gggggggggggggggggggggggggggg
rrrrrrrrrrrrrrrrrrccccccccrrrr,,rrrrrrrrrrrrrrrrccccccccrrrr
gggggggggggggggggggggggggggggg,,gggggggggggggggggggggggggggg
rrrrrrrrrrrrrrrrrrrrrrrrrrrrrr,,rrccccccccrrrrrrrrrrrrrrrrrr
gggggggggggggggggggggggggggggg,,gggggggggggggggggggggggggggg
gggggggggggggggggggggggggggggg,,gggggggggggggggggggggggggggg
FFFFFFFFgFFFFFFFFFFFFFFFFFFFFF,,FFFFFFFFFFFFFFFFFFFFgFFFFFFF
,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,,,,,,u,,,,,,,,,,,,,,,,,u,,,,,,,,,,,,,,,u,,,,,,,,,,,,,,u,,,,
.......hhhh...,....hhhh.......,,....hhhh......,....hhhh.....
..##########..,..###########..,,..##########..,..#########..
..##########..,..###########..,,..##########..,..#########..
..##########..,..###########..,,..##########..,..#########..
..##########..,..###########..,,..##########..,..#########..
..##########..,..###########..,,..##########..,..#########..
..##########..,..###########..,,..##########..,..#########..
..##########..,...............,,..##########..,.............
..............,.FFFFFFgFFFFFF.,,..##########..,......cc.....
..............,.Fgggggggccggg.,,..............,.cc...cc.....
..............,.Fgccggggccggg.,,....cc........,.cc..........
..............,.Fgccgggggggcc.,,....cc........,.........cc..
..............,.Fggggggggggcc.,,..............,.........cc..
...hhhhh......,.....hhhhh.....,,....hhhhh.....,...hhhhh.....
,,,,,,,,u,,,,,,,,,,,,,,,u,,,,,,,,,,,,,,,u,,,,,,,,,,,,,u,,,,,
..............,...............,,..............,...........hh
..............,...............,,..............,...........hh
..##########..,..##########...,,..##########..,..#########hh
..##########..,..##########...,,..##########..,..#########hh
..##########..,..##########...,,..##########..,..#########hh
..............,..##########...,,..##########..,..#########hh
..hhh...hhhh..,..##########...,,..##########..,..#########hh
..##########..,..##########...,,..##########..,..#########hh
..##########..,...............,,..##########..,...........hh
..............,...............,,..............,.aaaaaaaaaahh
.hhhhhhhhhhh..,...............,,..............,.aaccaaaaaahh
..............,...............,,..............,.aaaaaaaccahh
..............,...............,,..............,.aaaaaaaaaahh
,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,
,,,,,,u,,,,,,,,,,,,,,,u,,,,,,,,,,,,,,,,,u,,,,,,,,,,,,,u,,,,,
..............................,,............................
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@,,@@@@@@@@@@@@@@@@@@@@@@@@@@@@
`,
  starts: {'wall': {'x': 10, 'z': 54, 'face': 13}, 'gate': {'x': 30, 'z': 54, 'face': 13}, 'glider': {'x': 25, 'z': 24, 'face': 13}},
  safe: [51, 7, 54, 7],
  safeKind: 'train',
  safeAt: {'x': 53, 'z': 6, 'face': 9},
  lou: {'x': 52, 'z': 49, 'face': 13},
  lines: [{'x': 5, 'z': 45, 'face': 1}, {'x': 6, 'z': 48, 'face': 1}, {'x': 33, 'z': 44, 'face': 5}],
  roadblocks: [{'area': [30, 21, 31, 21], 'post': {'x': 32, 'z': 20, 'face': 5}, 'at': 2}, {'area': [22, 38, 22, 39], 'post': {'x': 21, 'z': 39, 'face': 1}, 'at': 5}],
  searchers: [{'name': 'Reid', 'beat': [{'x': 29, 'z': 19}, {'x': 12, 'z': 15}, {'x': 29, 'z': 10}, {'x': 46, 'z': 15}], 'at': -1}, {'name': 'Quill', 'beat': [{'x': 46, 'z': 37}, {'x': 32, 'z': 37}, {'x': 16, 'z': 37}, {'x': 32, 'z': 37}], 'at': -1}, {'name': 'Cole', 'beat': [{'x': 31, 'z': 54}, {'x': 31, 'z': 39}, {'x': 14, 'z': 39}, {'x': 14, 'z': 50}, {'x': 31, 'z': 48}], 'at': 0}, {'name': 'Booker', 'beat': [{'x': 30, 'z': 54}, {'x': 46, 'z': 48}, {'x': 46, 'z': 33}, {'x': 31, 'z': 33}], 'at': 3, 'dog': {'name': 'Tank', 'coat': 'mastiff'}}, {'name': 'Vance', 'from': {'x': 0, 'z': 22}, 'beat': [{'x': 31, 'z': 24}, {'x': 46, 'z': 24}, {'x': 56, 'z': 24}, {'x': 46, 'z': 24}, {'x': 31, 'z': 24}, {'x': 4, 'z': 24}], 'at': 6}, {'name': 'Shaw', 'from': {'x': 31, 'z': 0}, 'beat': [{'x': 31, 'z': 20}, {'x': 40, 'z': 14}, {'x': 56, 'z': 9}, {'x': 40, 'z': 14}, {'x': 20, 'z': 9}, {'x': 6, 'z': 15}, {'x': 20, 'z': 9}], 'at': 9, 'dog': {'name': 'Duke', 'coat': 'shepherd'}}],
  heli: {'at': 10, 'route': [{'x': 8, 'z': 48}, {'x': 52, 'z': 48}, {'x': 52, 'z': 34}, {'x': 8, 'z': 34}, {'x': 8, 'z': 24}, {'x': 52, 'z': 24}, {'x': 52, 'z': 12}, {'x': 8, 'z': 12}]},
  lookout: {'x': 16, 'z': 24, 'face': 13},
};
