/**
 * Every item (GDD §7). The simulation stores items as numbers: an item's number is its
 * place in ITEMS plus one (0 is an empty slot), so **never reorder or remove entries, only
 * append**. Names go through t() as `item.<id>`. `shape` and `color` say how the item is
 * drawn (render/itemModels.ts); `from` says where it comes from besides crafting, so the
 * tests can prove every item can be had.
 */
type ItemCategory = 'material' | 'tool' | 'weapon' | 'outfit' | 'key' | 'mold' | 'gear';
type ToolKind = 'dig' | 'chip' | 'cut' | 'unscrew' | 'multi';

/** Sources other than crafting. Later phases bring most of them (merchants P6, guards P5…; P19's 'treats': a dog prison's canteen counter, and one desk, every morning; P20's 'trap': a rat trap left out overnight; P21's 'fixer': the inmate who sells burner phones; P24's 'phone': only ever ordered on one; P28's goods taken on request, never stocked: 'meal' at a canteen counter, 'freezer' in a kitchen, 'library' off its shelf, 'staple' from any merchant; 'garden' a bed's harvest, 'brew' a bag fermented; P35's 'kiosk': ordered off the internet kiosk's shop; P36's 'release': handed back at the gate on the morning out; P40's 'oddjob': handed over for an odd job, or planted for one; P42's 'holiday': a holiday's eggs and treats, only in a run that has the holiday). */
export type Source = 'desk' | 'bed' | 'toilet' | 'shelf' | 'canteen' | 'shower' | 'woodshop' | 'laundry' | 'janitor' | 'kitchen' | 'metalshop' | 'merchant' | 'guard' | 'sharpen' | 'dig' | 'chip' | 'solitary' | 'start' | 'job' | 'treats' | 'trap' | 'fixer' | 'phone' | 'meal' | 'freezer' | 'library' | 'staple' | 'garden' | 'brew' | 'kiosk' | 'release' | 'oddjob' | 'holiday';

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
  /** How it lands when thrown (P14): 0 soft (unset), 1 hard, 2 metal; the noise carries THUD_NOISE[thud] tiles. */
  thud?: number;
  /** Small enough for a rat to carry (P20). */
  small?: boolean;
  /** Plain to see in hand (P21, the burner phone): a guard who sees it there reacts as to a contraband tool or weapon. */
  obvious?: boolean;
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

const work = (id: string, shape: string, color: number, accent: number): ItemDef => ({ id, cat: 'material', contraband: false, value: 0, shape, color, accent, from: ['job'] });

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
  m('metal_file', true, 20, 'file', 0x8d949e, ['desk', 'merchant', 'metalshop'], 0x2b3038),
  m('timber', true, 15, 'plank', 0xb07a45, ['woodshop', 'merchant']),
  m('sheet_metal', true, 20, 'sheet', 0xa8b0ba, ['metalshop', 'merchant']),
  m('crowbar', true, 35, 'crowbar', 0xc0392b, ['merchant']),
  m('pillow', false, 5, 'pillow', 0xf2f2ee, ['bed']),
  m('bed_sheet', false, 5, 'cloth', 0x9fb7d0, ['bed']),
  m('sock', false, 3, 'sock', 0xe8e8e2, ['desk', 'laundry']),
  m('soap', false, 5, 'bar', 0xf6c6d8, ['shower', 'desk']),
  m('battery', false, 10, 'battery', 0x2b3038, ['desk'], 0xe8b828),
  m('wire', true, 12, 'coil', 0xc97b3d, ['desk', 'merchant', 'metalshop']),
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
  // ---------------------------------------------------------------- the day's work (P6, GDD §11): worth nothing outside the job
  work('dirty_laundry', 'cloth', 0x9a8f78, 0x6f6656),
  work('clean_laundry', 'cloth', 0xf2701c, 0xf2f2ee),
  work('raw_food', 'pack', 0xd86a6a, 0xf4f4ef),
  work('meal_tray', 'tray', 0x9aa2ad, 0xe8b828),
  work('furniture', 'stool', 0xb07a45, 0x8a5a2e),
  work('letter', 'letter', 0xf4efe0, 0xd23f36),
  // P9 (Stalag Flucht's metalshop): appended, so every earlier item keeps its number in saves.
  work('license_plate', 'plate', 0xf2d23c, 0x1d2a5a),
  // P14 (noise and distractions): thrown, a firecracker goes off after its fuse; wound, an alarm clock rings wherever it is.
  m('firecracker', true, 15, 'firecracker', 0xd23f36, [], 0xf2d23c),
  m('alarm_clock', false, 12, 'clock', 0xc0392b, [], 0xf4f4ef),
  // P19 (guard dogs): thrown to a dog, jerky wins it over (once a day), pepper sets it sneezing, sleepy jerky puts it to sleep.
  m('jerky', false, 6, 'jerky', 0x8a3f22, ['treats'], 0xb5653a),
  m('pepper', false, 6, 'shaker', 0xf4f4ef, ['treats'], 0x2b3038),
  m('sleeping_pills', true, 15, 'pills', 0xe8eef6, ['treats'], 0x6a8fd8),
  m('sleepy_jerky', true, 20, 'jerky', 0x6a3f5a, [], 0x9a7ad0),
  // P20 (the pet rat): a trap left on the floor overnight, and a rat caught in it (fed twice, it's yours).
  m('rat_trap', false, 6, 'trap', 0xf4f4ef, [], 0xb8925a),
  m('caught_rat', true, 10, 'caughtRat', 0xf4f4ef, ['trap'], 0x8a7f78),
  // P21 (smuggling): the fixer's burner phone, for ordering from outside (plain to see in hand).
  { ...m('burner_phone', true, 60, 'phone', 0x2b3038, ['fixer'], 0x5fd3a0), obvious: true },
  // P22 (side games): a bent wire and a nail file, for the pins of a keyed door (a slip wears it).
  gear('lockpick', 25, 'lockpick', 0xc0c8d2, 0xd8a0b8, 12),
  // P24 (bluff & glider): a blank ID card off the phone, printed up into a guard's papers; a glider for a roof's edge.
  { ...gear('blank_id', 40, 'card', 0xf4f4ef, 0x9aa2ad), from: ['phone'] },
  gear('fake_id', 60, 'idCard', 0xf4efe0, 0x1e3a5f),
  gear('glider_frame', 40, 'frame', 0xe8d2a0, 0xb07a45),
  gear('glider', 80, 'glider', 0x9fb7d0, 0xe8d2a0),
  // P28 (long games): fruit off the canteen counter at meals, sugar from the kitchen, seed packets off the library shelf (the merchants sell both);
  // a bag of pruno fermenting (its uses: the prison days left), ripe pruno; what a bed in the garden gives; a track for the rat.
  m('fruit', false, 4, 'fruit', 0xe0573a, ['meal', 'garden'], 0x4f8a2e),
  m('sugar', false, 6, 'sack', 0xf4f0e6, ['freezer', 'staple'], 0x3a6fd8),
  { ...m('pruno_bag', true, 10, 'brew', 0xd9c27a, [], 0x9aa2ad), uses: 2 },
  m('pruno', true, 40, 'brew', 0xc98a2e, ['brew'], 0x6a3f22),
  m('veg_seeds', false, 5, 'packet', 0x5aa846, ['library', 'staple'], 0xf2d23c),
  m('fruit_seeds', false, 5, 'packet', 0xd23f6a, ['library', 'staple'], 0xf2d23c),
  m('vegetable', false, 8, 'veg', 0xe8862e, ['garden'], 0x4f8a2e),
  m('rat_track', false, 12, 'track', 0xe0574a, [], 0x9aa2ad),
  // P29 (team & ink): a homemade tattoo gun (a toothbrush, a battery's motor, a razor blade's needle); each tattoo uses a jar of ink.
  gear('tattoo_gun', 30, 'inkGun', 0x3fb8a8, 0x2b3038),
  // P30 (stage nights): a guitar for talent night (a plank's body and neck, wire for strings: nothing wrong with it).
  { ...gear('guitar', 25, 'guitar', 0xc98a4a, 0x5e3a1e), contraband: false },
  // P31 (sports grounds & gardens): the gardener's work, a tray of seedlings from the shed for a planter, a crate of what it grew for the kitchen.
  work('seedlings', 'seedTray', 0x5aa846, 0x8a5a2e),
  work('produce', 'vegCrate', 0xb07a45, 0xe8862e),
  // P34 (the pay phone): the cake cousin Lou sends in at a visit, a metal file baked inside (nothing wrong with a cake).
  m('cake', false, 15, 'cake', 0xf2d9a8, ['phone'], 0xd23f6a),
  // P35 (the internet kiosk): a thick book off its shop, and the same cut hollow with a razor blade (one small item hidden inside: content/kiosk.ts).
  m('thick_book', false, 12, 'tome', 0x2f5a8a, ['kiosk'], 0xe8e0c8),
  m('hollow_book', false, 12, 'tome', 0x6a2f2a, [], 0xe8e0c8),
  // P36 (the paperwork escape): a blank release form off the strict guard (it carries a few; worth more than its key, so a rat sent to its pockets brings the form), the same filled in and signed in its hand; the player's own clothes, handed back on release.
  { ...gear('release_form', 55, 'formBlank', 0xf4efe0, 0x9aa2ad), from: ['guard'] },
  gear('forged_release', 40, 'form', 0xf4efe0, 0x1e3a5f),
  outfit('own_clothes', 0, false, 0xe2ddd0, 0x4a6a96, ['release']),
  // P40 (the odd jobs board): a parcel to drop or deliver, a stash to frame someone with, a note for the rat to carry; what a Lift it job lifts (a guard's
  // whistle, the head cook's mug, a chain's keepsake: an old pocket watch); the birthday cake smuggled in at a visit.
  m('parcel', false, 5, 'pack', 0xb08a5a, ['oddjob'], 0xd8c39a),
  m('stash', true, 20, 'pouch', 0x5a4632, ['oddjob'], 0xd8c39a),
  m('note', false, 2, 'letter', 0xf6efd2, ['oddjob'], 0x2b3a55),
  m('whistle', false, 6, 'lighter', 0xc0c8d2, ['oddjob'], 0x2b3038),
  m('mug', false, 4, 'cup', 0xf4f1ea, ['oddjob'], 0x2f6fd1),
  m('birthday_cake', false, 15, 'cake', 0xfbe3ec, ['oddjob'], 0x3fb8a8),
  m('pocket_watch', false, 30, 'clock', 0xd8b04a, ['oddjob'], 0x2b3038),
  // v2.21 (P42, holidays): a chocolate egg in foil (the egg hunt: eaten, or sold to a merchant), an ice lolly (the summer's
  // water fight day), a witch's costume that fools no one (costume night), a pumpkin from the kitchen and the same carved
  // into a lantern there, a present from under the tree (given to an inmate, it's the gift swap).
  m('choc_egg', false, 8, 'egg', 0x7a4a2a, ['holiday'], 0xe8b828),
  m('ice_lolly', false, 4, 'lolly', 0xff6fa0, ['holiday'], 0xe8d2a0),
  { ...outfit('costume', 0, false, 0x4b2a6e, 0x1d1a22, ['holiday']), value: 10 },
  m('pumpkin', false, 6, 'pumpkin', 0xf28c28, ['holiday'], 0x4f8a2e),
  m('jack_lantern', false, 14, 'lantern', 0xf28c28, ['holiday'], 0xffd23f),
  m('gift', false, 30, 'gift', 0xd23f36, ['holiday'], 0xf4c542),
];

/** What lands with a clatter when thrown (P14): hard things, and metal ones loudest; the rest land soft. */
const HARD = ['guitar', 'glider_frame', 'glider', 'lockpick', 'timber', 'balsa', 'wall_chunk', 'potato', 'plastic_cup', 'lighter', 'battery', 'duct_tape', 'bleach', 'broom', 'mop', 'tool_handle', 'timber_brace', 'fake_wall', 'raft', 'bat', 'spiked_bat', 'baton', 'nunchucks', 'furniture', ...KEY_ITEM_COLORS.map(([c]) => `key_${c}`)];
const METAL = ['crowbar', 'sheet_metal', 'metal_file', 'trowel', 'flimsy_shovel', 'light_shovel', 'sturdy_shovel', 'flimsy_pickaxe', 'light_pickaxe', 'sturdy_pickaxe', 'flimsy_cutters', 'light_cutters', 'sturdy_cutters', 'screwdriver', 'powered_screwdriver', 'multitool', 'grappling_hook', 'grapnel', 'plated_outfit', 'meal_tray', 'license_plate', 'alarm_clock'];
for (const d of ITEMS) if (HARD.includes(d.id) || METAL.includes(d.id)) d.thud = METAL.includes(d.id) ? 2 : 1;

/** What a rat can carry in its teeth (P20): keys, molds and odds and ends; nothing long, heavy or bulky. */
const SMALL = [
  'choc_egg', 'ice_lolly',
  'plastic_comb', 'toothbrush', 'lighter', 'toilet_paper', 'glue', 'duct_tape', 'metal_file', 'sock', 'soap', 'battery', 'wire', 'razor_blade', 'ink', 'foil', 'talcum', 'toothpaste', 'putty', 'molten_plastic',
  'chocolate', 'plastic_spoon', 'plastic_fork', 'plastic_knife', 'nail_file', 'comb_shiv', 'toothbrush_shiv', 'comb_blade', 'pouch', 'firecracker', 'jerky', 'pepper', 'sleeping_pills', 'sleepy_jerky', 'burner_phone', 'lockpick', 'blank_id', 'fake_id', 'release_form', 'forged_release',
  'stash', 'note', 'whistle', 'pocket_watch',
  ...KEY_ITEM_COLORS.flatMap(([c]) => [`key_${c}`, `mold_${c}`, `plastic_key_${c}`]),
];
for (const d of ITEMS) if (SMALL.includes(d.id)) d.small = true;

/** An item's number in saves and slots (1 + its place in ITEMS). */
export const ITEM: Record<string, number> = Object.fromEntries(ITEMS.map((d, i) => [d.id, i + 1]));
export const itemDef = (n: number): ItemDef => ITEMS[n - 1];
export const itemNumber = (id: string): number => {
  const n = ITEM[id];
  if (!n) throw new Error(`unknown item ${id}`);
  return n;
};
