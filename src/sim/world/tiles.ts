/**
 * Tile kinds and what each one means to the rules. Numbers are stored in the world's typed
 * arrays and in saves: never renumber, only add.
 */
export const TILE = {
  EMPTY: 0,
  GRASS: 1,
  ROAD: 2,
  CONCRETE: 3,
  TILED: 4,
  WOOD: 5,
  ASPHALT: 6,
  DIRT: 7,
  BRICK: 10,
  REINFORCED: 11,
  FENCE: 12,
  ELECTRIC: 13,
  DOOR: 14,
  DETECTOR: 15,
  TOWER: 16,
  WATER: 17,
  // Damage and what covers it (GDD §9), ground floor.
  /** A wall chipped through: walkable for the player (inmates and guards keep to their ways). */
  HOLE: 18,
  /** A hole behind a wall poster, or plugged with a fake wall block: looks and acts like the wall. */
  HOLE_POSTER: 19,
  HOLE_FAKE: 20,
  /** A fence cut open, and one patched with a fake fence cover. */
  FENCE_CUT: 21,
  FENCE_FAKE: 22,
  /** A tunnel entrance dug in the floor (a hole down to the tunnels; nobody walks over it). */
  SHAFT: 23,
  // Tunnels (layer -1).
  /** Packed earth: dig through it. */
  SOIL: 24,
  TUNNEL: 25,
  /** A tunnel tile shored up with a timber brace (it and its 8 neighbours never cave in). */
  BRACED: 26,
  // Vents (layer +1) and roofs (layer +2).
  DUCT: 27,
  /** A ceiling vent grate: a duct over a ground floor tile, screwed shut, unscrewed, or behind a fake cover. */
  GRATE: 28,
  GRATE_OPEN: 29,
  GRATE_FAKE: 30,
  /** A duct (or roof) tile with the ladder that links the ground floor and the vents to the roof. */
  LADDER: 31,
  ROOF: 32,
  /** Granite under the ground (layer -1, GDD §4.2): no tool digs it; tunnels go round. */
  BOULDER: 33,
  /** A landmine buried in the sand (GDD §4.4): walkable, and it goes off underfoot. */
  MINE: 34,
  /** A wooden pier over the sea (HMP Irongate, GDD §4.5): walkable, and the sea under it floods a tunnel. */
  PIER: 35,
} as const;

export type TileKind = (typeof TILE)[keyof typeof TILE];

export interface TileInfo {
  name: string;
  /** Blocks walking (doors decide for themselves: see doors.ts). */
  solid: boolean;
  /** Blocks sight (guards' vision, later). */
  opaque: boolean;
  /** Open sky above it (roofs are not drawn over it). */
  outdoor: boolean;
}

const info = (name: string, solid: boolean, opaque: boolean, outdoor: boolean): TileInfo => ({ name, solid, opaque, outdoor });

export const TILE_INFO: Record<number, TileInfo> = {
  [TILE.EMPTY]: info('empty', true, false, true),
  [TILE.GRASS]: info('grass', false, false, true),
  [TILE.ROAD]: info('road', false, false, true),
  [TILE.CONCRETE]: info('concrete', false, false, false),
  [TILE.TILED]: info('tiled', false, false, false),
  [TILE.WOOD]: info('wood', false, false, false),
  [TILE.ASPHALT]: info('asphalt', false, false, true),
  [TILE.DIRT]: info('dirt', false, false, true),
  [TILE.BRICK]: info('brick', true, true, false),
  [TILE.REINFORCED]: info('reinforced', true, true, false),
  [TILE.FENCE]: info('fence', true, false, true),
  [TILE.ELECTRIC]: info('electric', true, false, true),
  [TILE.DOOR]: info('door', false, true, false),
  [TILE.DETECTOR]: info('detector', false, false, false),
  [TILE.TOWER]: info('tower', true, true, true),
  [TILE.WATER]: info('water', true, false, true),
  [TILE.HOLE]: info('hole', false, false, false),
  [TILE.HOLE_POSTER]: info('holePoster', true, true, false),
  [TILE.HOLE_FAKE]: info('holeFake', true, true, false),
  [TILE.FENCE_CUT]: info('fenceCut', false, false, true),
  [TILE.FENCE_FAKE]: info('fenceFake', true, false, true),
  [TILE.SHAFT]: info('shaft', true, false, false),
  [TILE.SOIL]: info('soil', true, true, false),
  [TILE.TUNNEL]: info('tunnel', false, false, false),
  [TILE.BRACED]: info('braced', false, false, false),
  [TILE.DUCT]: info('duct', false, false, false),
  [TILE.GRATE]: info('grate', false, false, false),
  [TILE.GRATE_OPEN]: info('grateOpen', false, false, false),
  [TILE.GRATE_FAKE]: info('grateFake', false, false, false),
  [TILE.LADDER]: info('ladder', false, false, false),
  [TILE.ROOF]: info('roof', false, false, true),
  [TILE.BOULDER]: info('boulder', true, true, false),
  [TILE.MINE]: info('mine', false, false, true),
  [TILE.PIER]: info('pier', false, false, true),
};

/** Damage a guard would notice (GDD §9.3): an open hole, a cut fence, a missing grate, a tunnel entrance. */
export const DAMAGE_SHOWS: ReadonlySet<number> = new Set([TILE.HOLE, TILE.FENCE_CUT, TILE.GRATE_OPEN, TILE.SHAFT]);

/** The sea is under it (HMP Irongate, GDD §4.5): a tunnel dug beneath floods at once. */
export const isSea = (k: number) => k === TILE.WATER || k === TILE.PIER;
/** Tunnel floor (walkable, layer -1). */
export const isTunnel = (k: number) => k === TILE.TUNNEL || k === TILE.BRACED;
/** Grate tiles of any state. */
export const isGrate = (k: number) => k === TILE.GRATE || k === TILE.GRATE_OPEN || k === TILE.GRATE_FAKE;

/** Door and key colors (GDD §4.0). 0 = no key. */
export const KEY = { NONE: 0, YELLOW: 1, CYAN: 2, PURPLE: 3, RED: 4, GREEN: 5 } as const;
export type KeyColor = (typeof KEY)[keyof typeof KEY];

/** What each map character stands for. Doors stand on concrete. */
export const LEGEND: Record<string, { kind: TileKind; key?: KeyColor }> = {
  ',': { kind: TILE.ROAD },
  '.': { kind: TILE.GRASS },
  _: { kind: TILE.CONCRETE },
  ':': { kind: TILE.TILED },
  w: { kind: TILE.WOOD },
  a: { kind: TILE.ASPHALT },
  d: { kind: TILE.DIRT },
  '#': { kind: TILE.BRICK },
  '@': { kind: TILE.REINFORCED },
  '=': { kind: TILE.FENCE },
  '%': { kind: TILE.ELECTRIC },
  D: { kind: TILE.DETECTOR },
  T: { kind: TILE.TOWER },
  '~': { kind: TILE.WATER },
  '*': { kind: TILE.MINE },
  P: { kind: TILE.PIER },
  y: { kind: TILE.DOOR, key: KEY.YELLOW },
  c: { kind: TILE.DOOR, key: KEY.CYAN },
  p: { kind: TILE.DOOR, key: KEY.PURPLE },
  r: { kind: TILE.DOOR, key: KEY.RED },
  g: { kind: TILE.DOOR, key: KEY.GREEN },
};

/** The underground picture (layer -1): packed earth, and the boulders a tunnel must go round. */
export const UNDER_LEGEND: Record<string, number> = {
  '.': TILE.SOIL,
  O: TILE.BOULDER,
};

/** The vents picture (layer +1): ducts over the rooms, grates down into them, the ladder to the roof. */
export const VENT_LEGEND: Record<string, number> = {
  '.': TILE.EMPTY,
  v: TILE.DUCT,
  V: TILE.GRATE,
  L: TILE.LADDER,
};
