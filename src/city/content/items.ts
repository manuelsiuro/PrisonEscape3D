/**
 * City Escape's things (C2): what's found in the city, eaten, used and (later) made. A list of its
 * own: the prisons' items are not these and never see them. An item's number is its place + 1 (0: no
 * item): append only, saves store the numbers. Its look is one of the item models' shapes
 * (render/itemModels.ts) in its own colours.
 */
export type CityItemKind = 'food' | 'med' | 'material' | 'tool' | 'weapon' | 'manual' | 'armour' | 'bag';

export interface CityItem {
  id: string;
  kind: CityItemKind;
  /** How many share a pocket. */
  stack: number;
  shape: string;
  color: number;
  accent?: number;
  /** Eaten, drunk or applied from the pockets: what it gives back (hunger, energy, health; 2.70: thirst; a minus takes). */
  use?: { hunger?: number; energy?: number; health?: number; thirst?: number };
  /** 2.70 (a city begun from then): the state it brings (content/survival.ts's MOODS), and the one it settles. */
  mood?: 'wellFed' | 'refreshed' | 'queasy';
  settles?: 'queasy';
  /** 2.70: it stops a wound bleeding, whatever the health it gives. */
  stanch?: true;
  /** 2.70: worn, never soaked by the rain (a raincoat). */
  dry?: true;
  /** A weapon in hand (C2b): its blow, its reach in tiles past the fists'. */
  attack?: number;
  reach?: number;
  /** Blows it lasts (C2c): a weapon's count in its pocket is the blows left in it, not how many there are. */
  wear?: number;
  /** 2.61: a blade or a point: what it puts down stays down (the others' are only knocked down). */
  edge?: true;
  /** 2.66: how it breaks things (a row of salvage.ts's BREAK_RATE); a weapon without one goes by its edge. */
  smash?: 'axe' | 'sledge' | 'cleaver' | 'crowbar';
  /** 2.69: a ranged weapon (Hit with it carried and its ammunition): what it shoots, its harm, reach (tiles), steps between shots, how far it's heard. */
  shoots?: { ammo: string; harm: number; reach: number; every: number; heard: number };
  /** 2.69: a manual: read, it teaches the recipes that name it (its place in MANUALS). */
  manual?: number;
  /** 2.69: worn (armour): the share of a bite it takes (in a hundred); seen this many tiles less; a walk this much slower (thousandths). Its count is its wear left. */
  armour?: number;
  hidden?: number;
  slow?: number;
  /** 2.69: worn on the back (a bag): the slots it holds. */
  slots?: number;
}

const food = (
  id: string,
  shape: string,
  color: number,
  hunger: number,
  more: { energy?: number; health?: number; thirst?: number } = {},
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
  // (2.70: what's drunk quenches thirst, in a city begun from then.)
  food('water', 'bottle', 0x6fb4e0, 6, { energy: 12, thirst: 50 }, 0xe8f2fa),
  { ...food('soda', 'can', 0xd23a3a, 9, { energy: 10, thirst: 20 }, 0xf4f1ea), mood: 'refreshed' },
  food('fruit', 'fruit', 0xd9483b, 12, { health: 2, thirst: 8 }),
  food('veg', 'veg', 0xe08a2a, 14, { health: 2 }, 0x4a8a3a),
  food('chocolate', 'packet', 0x5a3320, 14, { energy: 14 }, 0xd8b04a),
  // (Raw, it's a meal that costs a little health: cooked on a fire, C2c.)
  food('fish', 'fish', 0x8fa4b0, 16, { health: -4 }),
  { id: 'bandage', kind: 'med', stack: 3, shape: 'roll', color: 0xf0ece2, accent: 0xc24a3a, use: { health: 28 } },
  {
    id: 'pills',
    kind: 'med',
    stack: 3,
    shape: 'pills',
    color: 0xf2f2ee,
    accent: 0x3a7ac2,
    use: { health: 10, energy: 20 },
    settles: 'queasy',
  },
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
  { id: 'crowbar', kind: 'tool', stack: 1, shape: 'crowbar', color: 0xb03a30, smash: 'crowbar' },
  { id: 'torch', kind: 'tool', stack: 1, shape: 'tube', color: 0x2a2f36, accent: 0xf2c230 },
  { id: 'cutters', kind: 'tool', stack: 1, shape: 'cutters', color: 0xd9822b },
  { id: 'bat', kind: 'weapon', stack: 1, shape: 'bat', color: 0xa9824e, attack: 6, wear: 40 },
  { id: 'knife', kind: 'weapon', stack: 1, shape: 'knife', color: 0xc4cad0, accent: 0x3a2a1c, attack: 8, wear: 30, edge: true },
  // C2c: what's made (content/recipes.ts).
  { id: 'nail_bat', kind: 'weapon', stack: 1, shape: 'mace', color: 0xa9824e, accent: 0x9aa1ab, attack: 10, wear: 50 },
  { id: 'spear', kind: 'weapon', stack: 1, shape: 'broom', color: 0x7c8794, accent: 0xc4cad0, attack: 8, reach: 1, wear: 35, edge: true },
  /** Planks nailed across a street door: one bars one door (and comes back when it's taken down). */
  { id: 'boards', kind: 'tool', stack: 4, shape: 'plank', color: 0x8a6a40, accent: 0x9aa1ab },
  /** A camp stove: carried, it cooks. */
  { id: 'stove', kind: 'tool', stack: 1, shape: 'pack', color: 0x4a5560, accent: 0xc24a3a },
  { ...food('cooked_fish', 'fish', 0xc98a4a, 32, { health: 3 }), mood: 'wellFed' },
  // (2.58: a full meal, and worth the cooking: its tin, vegetable and water eaten as they are give 50, 2 and 12.)
  { ...food('stew', 'bowl', 0xb5673a, 75, { health: 8, energy: 15, thirst: 10 }, 0xe8e2d0), mood: 'wellFed' },
  // C3b: what the survivors teach.
  { id: 'medkit', kind: 'med', stack: 2, shape: 'pack', color: 0xf0ece2, accent: 0xc24a3a, use: { health: 100 } },
  {
    id: 'cleaver',
    kind: 'weapon',
    stack: 1,
    shape: 'knife',
    color: 0x9aa1ab,
    accent: 0x5a3320,
    attack: 14,
    wear: 60,
    edge: true,
    smash: 'cleaver',
  },
  food('ration', 'packet', 0x6a7a4a, 60, { energy: 20 }, 0xd8b04a),
  // 2.52: a lantern, made; set down where the player stands, it burns the night through.
  { id: 'lantern', kind: 'tool', stack: 2, shape: 'jar', color: 0xe8b04a, accent: 0x3a3a3a },
  // 2.55: thrown (a bottle of fuel with a rag: fire where it breaks) and shot (the crossbow's count is the shots left in it).
  { id: 'molotov', kind: 'weapon', stack: 3, shape: 'bottle', color: 0xc24a3a, accent: 0xe8d8b0 },
  {
    id: 'crossbow',
    kind: 'weapon',
    stack: 1,
    shape: 'crowbar',
    color: 0x6a4a2a,
    accent: 0x9aa1ab,
    wear: 40,
    // (2.69: as RANGED had it alone before.)
    shoots: { ammo: 'bolt', harm: 26, reach: 7, every: 30, heard: 2 },
  },
  { id: 'bolt', kind: 'material', stack: 6, shape: 'bar', color: 0x9aa1ab, accent: 0xc24a3a },
  // 2.66 (C5): what breaks things. An axe chops wood fast and has an edge; a sledgehammer breaks metal and inner walls, and knocks down.
  { id: 'axe', kind: 'weapon', stack: 1, shape: 'axe', color: 0x6a7078, accent: 0x8a6a40, attack: 9, wear: 45, edge: true, smash: 'axe' },
  {
    id: 'sledgehammer',
    kind: 'weapon',
    stack: 1,
    shape: 'sledge',
    color: 0x4a5058,
    accent: 0x9a7748,
    attack: 11,
    wear: 50,
    smash: 'sledge',
  },
  // 2.67 (C5 batch 2): what builds. Carried, it puts pieces up and repairs them (content/build.ts).
  { id: 'hammer', kind: 'tool', stack: 1, shape: 'hammer', color: 0x6a7078, accent: 0x9a7748 },
  // 2.69 (C5 batch 4): crafting that grows. Manuals (read: their recipes learnt), the workshop's kit.
  { id: 'manual_weapons', kind: 'manual', stack: 1, shape: 'book', color: 0x8a2a22, accent: 0xe8d8b0, manual: 0 },
  { id: 'manual_sewing', kind: 'manual', stack: 1, shape: 'book', color: 0x3f6a8c, accent: 0xf2e6c8, manual: 1 },
  { id: 'manual_tricks', kind: 'manual', stack: 1, shape: 'book', color: 0xd9822b, accent: 0x2a2a2a, manual: 2 },
  { id: 'toolkit', kind: 'material', stack: 1, shape: 'pack', color: 0xb03a30, accent: 0x5a5f66 },
  // Weapons and their upgrades.
  {
    id: 'machete',
    kind: 'weapon',
    stack: 1,
    shape: 'machete',
    color: 0xc4cad0,
    accent: 0x2a2a2a,
    attack: 9,
    wear: 45,
    edge: true,
    smash: 'cleaver',
  },
  { id: 'barbed_bat', kind: 'weapon', stack: 1, shape: 'mace', color: 0xa9824e, accent: 0x7a7f86, attack: 12, wear: 55 },
  {
    id: 'long_spear',
    kind: 'weapon',
    stack: 1,
    shape: 'broom',
    color: 0x5a626c,
    accent: 0xd8dde2,
    attack: 8,
    reach: 2,
    wear: 35,
    edge: true,
  },
  {
    id: 'slingshot',
    kind: 'weapon',
    stack: 1,
    shape: 'slingshot',
    color: 0x7a5434,
    accent: 0xb87333,
    wear: 60,
    shoots: { ammo: 'scrap', harm: 12, reach: 6, every: 24, heard: 1 },
  },
  {
    id: 'steel_crossbow',
    kind: 'weapon',
    stack: 1,
    shape: 'crowbar',
    color: 0x4a5058,
    accent: 0xc4cad0,
    wear: 60,
    shoots: { ammo: 'bolt', harm: 40, reach: 9, every: 30, heard: 2 },
  },
  // Thrown or set down.
  { id: 'smoke_bomb', kind: 'tool', stack: 3, shape: 'can', color: 0x8a8f96, accent: 0xe8e2d0 },
  { id: 'noisemaker', kind: 'tool', stack: 2, shape: 'clock', color: 0xd23a3a, accent: 0xf2f2ee },
  { id: 'flare', kind: 'tool', stack: 3, shape: 'firecracker', color: 0xe0563a, accent: 0xf2c230 },
  // Worn: armour (its count is the bites it has left in it), and bags.
  { id: 'padded_jacket', kind: 'armour', stack: 1, shape: 'outfit', color: 0x5a6a4a, accent: 0x3a4a2a, wear: 30, armour: 25 },
  { id: 'sports_pads', kind: 'armour', stack: 1, shape: 'outfit', color: 0x2a5aa8, accent: 0xf2f2ee, wear: 25, armour: 20 },
  { id: 'scrap_armour', kind: 'armour', stack: 1, shape: 'outfit', color: 0x7c8590, accent: 0x8a5a3a, wear: 50, armour: 45, slow: 60 },
  { id: 'riot_gear', kind: 'armour', stack: 1, shape: 'outfit', color: 0x1e2a3a, accent: 0xe8b828, wear: 60, armour: 50 },
  { id: 'poncho', kind: 'armour', stack: 1, shape: 'ghillie', color: 0x4f6a3a, accent: 0x7a6a4a, wear: 30, armour: 0, hidden: 1 },
  { id: 'satchel', kind: 'bag', stack: 1, shape: 'pouch', color: 0x8a6a40, accent: 0x5a4a2a, slots: 4 },
  { id: 'hiking_pack', kind: 'bag', stack: 1, shape: 'pack', color: 0x3f6a8c, accent: 0xd9822b, slots: 8 },
  // 2.70 (C5 batch 5): survival with weight. Water that isn't clean, what grows, what's cooked, what keeps.
  { ...food('dirty_water', 'bottle', 0x8a8a5a, 0, { thirst: 25 }, 0xc8c8a0), mood: 'queasy' },
  { id: 'seeds', kind: 'material', stack: 6, shape: 'seeds', color: 0x9a7a3a, accent: 0x4a8a3a },
  { id: 'herbs', kind: 'material', stack: 6, shape: 'veg', color: 0x4a8a3a, accent: 0x6aa84a },
  { ...food('tea', 'cup', 0x8a5a2a, 0, { thirst: 30, energy: 5 }, 0xe8e2d0), mood: 'refreshed', settles: 'queasy' },
  { ...food('coffee', 'can', 0x4a3220, 0, { thirst: 10, energy: 18 }, 0xd8b04a), mood: 'refreshed' },
  { ...food('roast_veg', 'bowl', 0xd98a3a, 40, { health: 3 }, 0x6a4a2a), mood: 'wellFed' },
  { ...food('fish_soup', 'bowl', 0xd8c8a0, 55, { health: 4, thirst: 20 }, 0x8a5a3a), mood: 'wellFed' },
  food('jerky', 'jerky', 0x7a3a2a, 35, { energy: 5 }),
  food('preserves', 'jar', 0xc24a5a, 30, { energy: 8 }, 0xe8d8b0),
  { id: 'poultice', kind: 'med', stack: 3, shape: 'cloth', color: 0x6a8a4a, accent: 0xe8e2d0, use: { health: 10 }, stanch: true },
  { id: 'fishing_rod', kind: 'tool', stack: 1, shape: 'broom', color: 0x9a7748, accent: 0xb87333, wear: 30 },
  { id: 'raincoat', kind: 'armour', stack: 1, shape: 'outfit', color: 0xe8c02a, accent: 0x2a2a2a, wear: 40, armour: 0, dry: true },
  { id: 'manual_garden', kind: 'manual', stack: 1, shape: 'book', color: 0x4a8a3a, accent: 0xf2e6c8, manual: 3 },
  { id: 'manual_fishing', kind: 'manual', stack: 1, shape: 'book', color: 0x2a6a8a, accent: 0xf2e6c8, manual: 4 },
  { id: 'manual_cooking', kind: 'manual', stack: 1, shape: 'book', color: 0xb5673a, accent: 0xf2e6c8, manual: 5 },
];

/** 2.69: the manuals, by their place: what each is about (its recipes name it). */
export const MANUALS = ['weapons', 'sewing', 'tricks', 'garden', 'fishing', 'cooking'] as const;

export const cityItem = (n: number): CityItem | undefined => CITY_ITEMS[n - 1];
export function cityItemNumber(id: string): number {
  const k = CITY_ITEMS.findIndex((d) => d.id === id);
  if (k < 0) throw new Error(`no city item '${id}'`);
  return k + 1;
}
