/**
 * Every item (GDD §7). The simulation stores items as numbers: an item's number is its
 * place in ITEMS plus one (0 is an empty slot), so **never reorder or remove entries, only
 * append**. Names go through t() as `item.<id>`. `shape` and `color` say how the item is
 * drawn (render/itemModels.ts); `from` says where it comes from besides crafting, so the
 * tests can prove every item can be had.
 */
export type ItemCategory = 'material' | 'tool' | 'weapon' | 'outfit' | 'key' | 'mold' | 'gear';
export type ToolKind = 'dig' | 'chip' | 'cut' | 'unscrew' | 'multi';

/** Sources other than crafting. Later phases bring most of them (merchants P6, guards P5…). */
export type Source = 'desk' | 'bed' | 'toilet' | 'shelf' | 'canteen' | 'shower' | 'woodshop' | 'laundry' | 'janitor' | 'kitchen' | 'metalshop' | 'merchant' | 'guard' | 'sharpen' | 'dig' | 'chip' | 'solitary' | 'start';

export interface ItemDef {
  id: string;
  cat: ItemCategory;
  contraband: boolean;
  /** Base value in dollars (merchants, P6). */
  value: number;
  /** Uses before it breaks (tools, plastic keys, the pouch). */
  uses?: number;
  tool?: { kind: ToolKind; tier: number; damage: number; energy: number };
  /** Melee attack bonus (weapons) and defense (outfits). */
  attack?: number;
  defense?: number;
  /** Weapons: swings this much faster (0.15 = 15%), a longer reach (tiles), thrown for an instant knockout. */
  haste?: number;
  reach?: number;
  thrown?: boolean;
  /** Door color for keys, molds and plastic keys (tiles.ts KEY). */
  key?: number;
  shape: string;
  color: number;
  /** A second color for the model (handles, labels, trims). */
  accent?: number;
  from: readonly Source[];
}

const m = (id: string, contraband: boolean, value: number, shape: string, color: number, from: Source[], accent?: number): ItemDef => ({
  id,
  cat: 'material',
  contraband,
  value,
  shape,
  color,
  accent,
  from,
});

const tool = (id: string, kind: ToolKind, tier: number, uses: number, damage: number, energy: number, contraband: boolean, shape: string, color: number, accent: number, from: Source[] = []): ItemDef => ({
  id,
  cat: 'tool',
  contraband,
  value: 10 + tier * 15,
  uses,
  tool: { kind, tier, damage, energy },
  shape,
  color,
  accent,
  from,
});

const weapon = (id: string, attack: number, shape: string, color: number, accent: number, from: Source[] = [], extra: Partial<ItemDef> = {}): ItemDef => ({
  id,
  cat: 'weapon',
  contraband: true,
  value: attack * 2,
  attack,
  shape,
  color,
  accent,
  from,
  ...extra,
});

const outfit = (id: string, defense: number, contraband: boolean, color: number, accent: number, from: Source[] = []): ItemDef => ({
  id,
  cat: 'outfit',
  contraband,
  value: defense * 2,
  defense,
  shape: 'outfit',
  color,
  accent,
  from,
});

const gear = (id: string, value: number, shape: string, color: number, accent?: number, uses?: number): ItemDef => ({
  id,
  cat: 'gear',
  contraband: true,
  value,
  uses,
  shape,
  color,
  accent,
  from: [],
});

/** Key colors in KEY order (1–5), with the color each is painted. */
export const KEY_ITEM_COLORS: ReadonlyArray<[string, number, number]> = [
  ['yellow', 1, 0xe8b828],
  ['cyan', 2, 0x2fb6c8],
  ['purple', 3, 0x8e4fc4],
  ['red', 4, 0xd23f36],
  ['green', 5, 0x36a447],
];

export const ITEMS: readonly ItemDef[] = [
  // ---------------------------------------------------------------- raw materials (§7.1)
  m('plastic_comb', false, 5, 'comb', 0x3a6fd8, ['desk']),
  m('toothbrush', false, 5, 'brush', 0x3fb8a8, ['desk'], 0xffffff),
  m('lighter', true, 15, 'lighter', 0xd23f36, ['desk', 'merchant'], 0xc0c4ca),
  m('toilet_paper', false, 3, 'roll', 0xf4f4ef, ['toilet', 'desk']),
  m('glue', true, 12, 'tube', 0xf2d23c, ['desk', 'merchant'], 0xffffff),
  m('duct_tape', true, 20, 'tape', 0x9aa2ad, ['desk', 'merchant']),
  m('metal_file', true, 20, 'file', 0x8d949e, ['desk', 'merchant'], 0x2b3038),
  m('timber', true, 15, 'plank', 0xb07a45, ['woodshop', 'merchant']),
  m('sheet_metal', true, 20, 'sheet', 0xa8b0ba, ['metalshop', 'merchant']),
  m('crowbar', true, 35, 'crowbar', 0xc0392b, ['merchant']),
  m('pillow', false, 5, 'pillow', 0xf2f2ee, ['bed']),
  m('bed_sheet', false, 5, 'cloth', 0x9fb7d0, ['bed']),
  m('sock', false, 3, 'sock', 0xe8e8e2, ['desk', 'laundry']),
  m('soap', false, 5, 'bar', 0xf6c6d8, ['shower', 'desk']),
  m('battery', false, 10, 'battery', 0x2b3038, ['desk'], 0xe8b828),
  m('wire', true, 12, 'coil', 0xc97b3d, ['desk', 'merchant']),
  m('razor_blade', true, 12, 'blade', 0xd8dde3, ['desk', 'merchant']),
  m('ink', false, 8, 'jar', 0x1d2a5a, ['shelf', 'desk'], 0x2b3038),
  m('magazine', false, 8, 'book', 0xe0574a, ['shelf', 'desk'], 0xf2d23c),
  m('foil', true, 15, 'roll', 0xd8dde3, ['kitchen', 'merchant']),
  m('talcum', false, 8, 'bottle', 0xf4f0e6, ['desk'], 0x8fb8e8),
  m('toothpaste', false, 5, 'tube', 0xffffff, ['desk'], 0x3a6fd8),
  m('putty', true, 25, 'blob', 0xd9c7a0, []),
  m('molten_plastic', true, 20, 'blob', 0x3a6fd8, []),
  m('papier_mache', true, 15, 'blob', 0xe8e0c8, []),
  m('tool_handle', true, 18, 'handle', 0xa06a3a, []),
  m('plastic_cup', false, 3, 'cup', 0xf4f4ef, ['canteen', 'desk']),
  m('chocolate', false, 8, 'bar', 0x6b3d22, ['canteen', 'desk'], 0xd23f36),
  m('broom', false, 10, 'broom', 0xb07a45, ['janitor'], 0xe8c45a),
  m('mop', false, 10, 'mop', 0xb07a45, ['janitor'], 0xe8e8e2),
  m('bleach', false, 12, 'bottle', 0xf4f4ef, ['laundry', 'janitor'], 0x2fb6c8),
  m('balsa', true, 15, 'plank', 0xe8d2a0, ['woodshop']),
  m('rope', true, 25, 'coil', 0xc8a86a, ['merchant']),
  m('dirt', true, 0, 'blob', 0x7a5a3a, ['dig']),
  m('wall_chunk', true, 0, 'chunk', 0x9a4a3a, ['chip']),
  m('potato', false, 1, 'potato', 0xb8925a, ['solitary', 'kitchen']),
  // ---------------------------------------------------------------- tools (§7.2)
  tool('plastic_spoon', 'dig', 1, 10, 4, 8, false, 'spoon', 0xf4f4ef, 0xf4f4ef, ['canteen', 'desk']),
  tool('trowel', 'dig', 2, 20, 10, 6, true, 'trowel', 0x8d949e, 0x2e9e55, ['merchant']),
  tool('flimsy_shovel', 'dig', 1, 18, 10, 6, true, 'shovel', 0xa8b0ba, 0xa06a3a),
  tool('light_shovel', 'dig', 2, 30, 18, 5, true, 'shovel', 0xc0c8d2, 0x8a5a2e),
  tool('sturdy_shovel', 'dig', 3, 50, 25, 4, true, 'shovel', 0x6a737e, 0x5a3a20),
  tool('plastic_fork', 'chip', 1, 10, 4, 8, false, 'fork', 0xf4f4ef, 0xf4f4ef, ['canteen', 'desk']),
  tool('flimsy_pickaxe', 'chip', 1, 18, 10, 6, true, 'pickaxe', 0xa8b0ba, 0xa06a3a),
  tool('light_pickaxe', 'chip', 2, 30, 18, 5, true, 'pickaxe', 0xc0c8d2, 0x8a5a2e),
  tool('sturdy_pickaxe', 'chip', 3, 50, 25, 4, true, 'pickaxe', 0x6a737e, 0x5a3a20),
  tool('plastic_knife', 'cut', 1, 10, 4, 8, false, 'knife', 0xf4f4ef, 0xf4f4ef, ['canteen', 'desk']),
  tool('flimsy_cutters', 'cut', 1, 18, 10, 6, true, 'cutters', 0xa8b0ba, 0xd23f36),
  tool('light_cutters', 'cut', 2, 30, 18, 5, true, 'cutters', 0xc0c8d2, 0xe8b828),
  tool('sturdy_cutters', 'cut', 3, 50, 25, 4, true, 'cutters', 0x6a737e, 0x2fb6c8),
  tool('nail_file', 'unscrew', 1, 8, 12, 6, true, 'file', 0xd8a0b8, 0xd8a0b8, ['desk', 'merchant']),
  tool('screwdriver', 'unscrew', 2, 25, 25, 4, true, 'screwdriver', 0xc0c8d2, 0xe8b828, ['merchant']),
  tool('powered_screwdriver', 'unscrew', 4, 50, 50, 2, true, 'drill', 0xe8b828, 0x2b3038),
  tool('multitool', 'multi', 4, 80, 35, 3, true, 'multitool', 0xd23f36, 0xc0c8d2),
  // ---------------------------------------------------------------- weapons (§7.3)
  weapon('comb_shiv', 6, 'shiv', 0x3a6fd8, 0xd8dde3, ['sharpen']),
  weapon('toothbrush_shiv', 6, 'shiv', 0x3fb8a8, 0xd8dde3, ['sharpen']),
  weapon('comb_blade', 10, 'shiv', 0x3a6fd8, 0xf4f4ff),
  weapon('sock_mace', 10, 'mace', 0xe8e8e2, 0xf6c6d8),
  weapon('super_sock_mace', 16, 'mace', 0xe8e8e2, 0x2b3038),
  weapon('bat', 14, 'bat', 0xb07a45, 0x8d949e),
  weapon('spiked_bat', 20, 'bat', 0x8a5a2e, 0xd8dde3),
  weapon('baton', 18, 'baton', 0x1d2026, 0x5a6270, ['guard']),
  weapon('nunchucks', 22, 'nunchucks', 0xb07a45, 0xc97b3d, [], { haste: 0.15 }),
  weapon('razor_whip', 20, 'whip', 0x8a5a2e, 0xd8dde3, [], { reach: 2.5 }),
  weapon('molten_chocolate', 0, 'cup', 0x6b3d22, 0xf4f4ef, [], { thrown: true, value: 30 }),
  // ---------------------------------------------------------------- outfits
  outfit('inmate_outfit', 5, false, 0xf2701c, 0xf2f2ee, ['start', 'laundry']),
  outfit('cushioned_outfit', 15, true, 0xf2701c, 0xf2f2ee),
  outfit('plated_outfit', 30, true, 0xf2701c, 0xa8b0ba),
  outfit('guard_outfit', 15, true, 0x1e3a5f, 0xe8b828, ['guard', 'laundry']),
  // ---------------------------------------------------------------- keys, molds, plastic keys (one per door color)
  ...KEY_ITEM_COLORS.map(([c, key, color]): ItemDef => ({ id: `key_${c}`, cat: 'key', contraband: true, value: 50, key, shape: 'key', color, accent: 0x8d949e, from: ['guard'] })),
  ...KEY_ITEM_COLORS.map(([c, key, color]): ItemDef => ({ id: `mold_${c}`, cat: 'mold', contraband: true, value: 30, key, shape: 'mold', color: 0xd9c7a0, accent: color, from: [] })),
  ...KEY_ITEM_COLORS.map(([c, key, color]): ItemDef => ({ id: `plastic_key_${c}`, cat: 'key', contraband: true, value: 40, key, uses: 15, shape: 'key', color, accent: 0xf4f4ef, from: [] })),
  // ---------------------------------------------------------------- stealth, concealment and escape gear
  gear('pouch', 30, 'pouch', 0xd8dde3, 0x9aa2ad, 20),
  gear('bed_dummy', 20, 'dummy', 0xf2f2ee, 0x9fb7d0),
  gear('poster', 15, 'poster', 0xe0574a, 0xf2d23c),
  gear('fake_wall', 25, 'block', 0x9a4a3a, 0x5e646e),
  gear('fake_vent', 20, 'vent', 0x9aa2ad, 0x5e646e),
  gear('fake_fence', 25, 'fence', 0x9aa2ad, 0x6a737e),
  gear('timber_brace', 20, 'brace', 0xb07a45, 0x8a5a2e),
  gear('sheet_rope', 20, 'coil', 0x9fb7d0, 0xf2f2ee),
  gear('grappling_hook', 40, 'hook', 0x8d949e, 0xc0392b),
  gear('grapnel', 60, 'grapnel', 0x8d949e, 0xc8a86a),
  gear('raft', 60, 'raft', 0xe8d2a0, 0x9fb7d0),
];

/** An item's number in saves and slots (1 + its place in ITEMS). */
export const ITEM: Record<string, number> = Object.fromEntries(ITEMS.map((d, i) => [d.id, i + 1]));
export const itemDef = (n: number): ItemDef => ITEMS[n - 1];
export const itemNumber = (id: string): number => {
  const n = ITEM[id];
  if (!n) throw new Error(`unknown item ${id}`);
  return n;
};
