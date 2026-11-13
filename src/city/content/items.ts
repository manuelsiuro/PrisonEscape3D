/**
 * City Escape's things (C2): what's found in the city, eaten, used and (later) made. A list of its
 * own: the prisons' items are not these and never see them. An item's number is its place + 1 (0: no
 * item): append only, saves store the numbers. Its look is one of the item models' shapes
 * (render/itemModels.ts) in its own colours.
 */
export type CityItemKind = 'food' | 'med' | 'material' | 'tool' | 'weapon';

export interface CityItem {
  id: string;
  kind: CityItemKind;
  /** How many share a pocket. */
  stack: number;
  shape: string;
  color: number;
  accent?: number;
  /** Eaten, drunk or applied from the pockets: what it gives back (hunger, energy, health; a minus takes). */
  use?: { hunger?: number; energy?: number; health?: number };
  /** A weapon in hand (C2b): its blow, its reach in tiles past the fists'. */
  attack?: number;
  reach?: number;
  /** Blows it lasts (C2c): a weapon's count in its pocket is the blows left in it, not how many there are. */
  wear?: number;
}

const food = (
  id: string,
  shape: string,
  color: number,
  hunger: number,
  more: { energy?: number; health?: number } = {},
  accent?: number,
): CityItem => ({
  id,
  kind: 'food',
  stack: 3,
  shape,
  color,
  accent,
  use: { hunger, ...more },
});
const part = (id: string, shape: string, color: number, accent?: number): CityItem => ({
  id,
  kind: 'material',
  stack: 4,
  shape,
  color,
  accent,
});

export const CITY_ITEMS: readonly CityItem[] = [
  food('tin', 'can', 0xb8bec4, 30, {}, 0xc24a3a),
  food('dried', 'packet', 0xc9a25a, 18, {}, 0x6a4a2a),
  food('water', 'bottle', 0x6fb4e0, 6, { energy: 12 }, 0xe8f2fa),
  food('soda', 'can', 0xd23a3a, 9, { energy: 10 }, 0xf4f1ea),
  food('fruit', 'fruit', 0xd9483b, 12, { health: 2 }),
  food('veg', 'veg', 0xe08a2a, 14, { health: 2 }, 0x4a8a3a),
  food('chocolate', 'packet', 0x5a3320, 14, { energy: 14 }, 0xd8b04a),
  // (Raw, it's a meal that costs a little health: cooked on a fire, C2c.)
  food('fish', 'fish', 0x8fa4b0, 16, { health: -4 }),
  { id: 'bandage', kind: 'med', stack: 3, shape: 'roll', color: 0xf0ece2, accent: 0xc24a3a, use: { health: 28 } },
  { id: 'pills', kind: 'med', stack: 3, shape: 'pills', color: 0xf2f2ee, accent: 0x3a7ac2, use: { health: 10, energy: 20 } },
  part('plank', 'plank', 0x9a7748),
  part('nails', 'jar', 0x9aa1ab, 0x5a5f66),
  part('tape', 'tape', 0x8a8f96),
  part('cloth', 'cloth', 0xb9a98a),
  part('pipe', 'bar', 0x7c8794),
  part('blade', 'blade', 0xc4cad0),
  part('battery', 'battery', 0x2f8f5a, 0xd8b04a),
  part('wire', 'coil', 0xb87333),
  part('bottle', 'bottle', 0x6a8a5a),
  part('fuel', 'jar', 0xc24a3a, 0x2a2a2a),
  part('scrap', 'sheet', 0x8a8f96),
  { id: 'crowbar', kind: 'tool', stack: 1, shape: 'crowbar', color: 0xb03a30 },
  { id: 'torch', kind: 'tool', stack: 1, shape: 'tube', color: 0x2a2f36, accent: 0xf2c230 },
  { id: 'cutters', kind: 'tool', stack: 1, shape: 'cutters', color: 0xd9822b },
  { id: 'bat', kind: 'weapon', stack: 1, shape: 'bat', color: 0xa9824e, attack: 6, wear: 40 },
  { id: 'knife', kind: 'weapon', stack: 1, shape: 'knife', color: 0xc4cad0, accent: 0x3a2a1c, attack: 8, wear: 30 },
  // C2c: what's made (content/recipes.ts).
  { id: 'nail_bat', kind: 'weapon', stack: 1, shape: 'mace', color: 0xa9824e, accent: 0x9aa1ab, attack: 10, wear: 50 },
  { id: 'spear', kind: 'weapon', stack: 1, shape: 'broom', color: 0x7c8794, accent: 0xc4cad0, attack: 8, reach: 1, wear: 35 },
  /** Planks nailed across a street door: one bars one door (and comes back when it's taken down). */
  { id: 'boards', kind: 'tool', stack: 4, shape: 'plank', color: 0x8a6a40, accent: 0x9aa1ab },
  /** A camp stove: carried, it cooks. */
  { id: 'stove', kind: 'tool', stack: 1, shape: 'pack', color: 0x4a5560, accent: 0xc24a3a },
  food('cooked_fish', 'fish', 0xc98a4a, 32, { health: 3 }),
  food('stew', 'bowl', 0xb5673a, 55, { health: 5, energy: 8 }, 0xe8e2d0),
  // C3b: what the survivors teach.
  { id: 'medkit', kind: 'med', stack: 2, shape: 'pack', color: 0xf0ece2, accent: 0xc24a3a, use: { health: 70 } },
  { id: 'cleaver', kind: 'weapon', stack: 1, shape: 'knife', color: 0x9aa1ab, accent: 0x5a3320, attack: 14, wear: 60 },
  food('ration', 'packet', 0x6a7a4a, 60, { energy: 20 }, 0xd8b04a),
];

export const cityItem = (n: number): CityItem | undefined => CITY_ITEMS[n - 1];
export function cityItemNumber(id: string): number {
  const k = CITY_ITEMS.findIndex((d) => d.id === id);
  if (k < 0) throw new Error(`no city item '${id}'`);
  return k + 1;
}
