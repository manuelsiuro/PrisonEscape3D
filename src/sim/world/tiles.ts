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
};

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
  y: { kind: TILE.DOOR, key: KEY.YELLOW },
  c: { kind: TILE.DOOR, key: KEY.CYAN },
  p: { kind: TILE.DOOR, key: KEY.PURPLE },
  r: { kind: TILE.DOOR, key: KEY.RED },
  g: { kind: TILE.DOOR, key: KEY.GREEN },
};
