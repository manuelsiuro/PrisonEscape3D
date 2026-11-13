import { MAP_H, MAP_W } from '../../sim/world/grid';
import { USES, isBuilding, type LotUse } from '../content/districts';
import { DECO, type District } from '../gen/district';

/**
 * A district as the map shows it (C1): a pixel a tile, coloured by what the tile is (street, pavement,
 * a building by its use, grass, water, walls), dark where it hasn't been seen. Painted into a 64 × 64
 * picture the HUD's corner map and the city's map both draw from.
 */
type RGB = readonly [number, number, number];
const hex = (c: number): RGB => [(c >> 16) & 255, (c >> 8) & 255, c & 255];

const GROUND: Record<string, RGB> = {
  ',': hex(0x3a3d44),
  a: hex(0x62656b),
  '.': hex(0x4a6b3a),
  d: hex(0x6e5c44),
  '~': hex(0x2c5a7c),
  P: hex(0x8a6b45),
  '#': hex(0x17191d),
  '@': hex(0xb8443a),
  '=': hex(0x8f949c),
  y: hex(0xd9b25a),
};
/** A building's floor, by what it is: homes warm, shops teal, work grey-blue, the landmarks bright. */
const FLOOR: Partial<Record<LotUse, RGB>> = {
  house: hex(0x9a7a58),
  shop: hex(0x4f9a94),
  office: hex(0x7386a8),
  warehouse: hex(0x7d7468),
  clinic: hex(0xc9d2d6),
  garage: hex(0x8a8172),
  station: hex(0xe0913a),
  tower: hex(0x9fb4e0),
  factory: hex(0xb07a4a),
  hospital: hex(0xf0f2f2),
  boathouse: hex(0x5fb0d8),
  rangers: hex(0x7fc46a),
  mall: hex(0x58d0c4),
  police: hex(0x5a7ee0),
  metro: hex(0xe6c84a),
};
const UNSEEN: RGB = hex(0x0d1014);
const WRECK: RGB = hex(0x24262b);
const TREE: RGB = hex(0x2f4a26);

/** The colour of a tile. */
function colourOf(d: District, i: number): RGB {
  const c = d.rows[Math.floor(i / MAP_W)][i % MAP_W];
  const deco = d.deco[i];
  if (deco === DECO.TREE || deco === DECO.BUSH) return TREE;
  if (deco && deco !== DECO.CONE && deco !== DECO.DEAD_TREE && c === ',') return WRECK;
  const lot = d.lotAt[i];
  const use = lot ? d.lots[lot - 1].use : 'none';
  if (c !== '#' && c !== 'y' && isBuilding(use) && (c === 'w' || c === ':' || c === '_')) return FLOOR[use] ?? GROUND.a;
  return GROUND[c] ?? GROUND.a;
}

/** A district's picture (64 × 64 pixels): what's been seen in colour, the rest dark (`seen` null: all of it shown). */
export function paintDistrict(d: District, seen: Uint8Array | null, into?: ImageData): ImageData {
  const img = into ?? new ImageData(MAP_W, MAP_H);
  const px = img.data;
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    const [r, g, b] = !seen || seen[i] ? colourOf(d, i) : UNSEEN;
    px[i * 4] = r;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = b;
    px[i * 4 + 3] = 255;
  }
  return img;
}

/** The colour of a use, as CSS (the map's legend). */
export const useColour = (u: LotUse) => {
  const [r, g, b] = FLOOR[u] ?? GROUND.a;
  return `rgb(${r}, ${g}, ${b})`;
};
/** (Every use has a number: the legend lists the landmarks.) */
export const LANDMARKS = USES.slice(11);
