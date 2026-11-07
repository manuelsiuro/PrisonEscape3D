/**
 * 2.36: what an item does, for its card (the tap on a slot): worked out from its data where there is
 * some (a tool's job, strikes and energy; a weapon's blow; an outfit's softening; a key's doors; what a
 * food gives back), else its own line (`use.<id>`), else what it's for (crafting, the day's work).
 * Never a word the rules don't back: `itemtest`'s card checks hold every number here to the data.
 */
import { itemDef, ITEM, KEY_ITEM_COLORS } from '../content/items';
import { CAKE_ENERGY } from '../content/phone';
import { RECIPES, choices } from '../content/recipes';
import { type Key, listOf, lowerFirst, t } from '../i18n';
import { saleOf } from '../sim/systems/pantry';
import { CHOCOLATE_ENERGY, FENCE_HP, FLOOR_HP, GRATE_HP, RAT_MEALS, THROW_RANGE, UNIT, WALL_HP } from '../sim/tuning';

/** What each kind of tool goes through, and the hit points of the usual one (a tile of floor for a shovel). */
const TOOL_JOB: Record<string, { key: Key; hp: number; thing: Key }> = {
  dig: { key: 'fact.tool.dig', hp: FLOOR_HP, thing: 'fact.thing.floor' },
  chip: { key: 'fact.tool.chip', hp: WALL_HP, thing: 'fact.thing.wall' },
  cut: { key: 'fact.tool.cut', hp: FENCE_HP, thing: 'fact.thing.fence' },
  unscrew: { key: 'fact.tool.unscrew', hp: GRATE_HP, thing: 'fact.thing.grate' },
  multi: { key: 'fact.tool.multi', hp: WALL_HP, thing: 'fact.thing.wall' },
};

/** Items with a line of their own (`use.<id>` in the i18n): what the use button, a throw or a place does with them. */
export const OWN_LINE: readonly string[] = [
  'pouch',
  'bed_dummy',
  'poster',
  'fake_wall',
  'fake_vent',
  'fake_fence',
  'timber_brace',
  'sheet_rope',
  'grappling_hook',
  'grapnel',
  'raft',
  'lockpick',
  'glider',
  'burner_phone',
  'firecracker',
  'alarm_clock',
  'jerky',
  'pepper',
  'sleepy_jerky',
  'rat_trap',
  'caught_rat',
  'soap',
  'duct_tape',
  'toothpaste',
  'pruno',
  'pruno_bag',
  'rat_track',
  'veg_seeds',
  'fruit_seeds',
  'plastic_cup',
  'hollow_book',
  'tattoo_gun',
  'guitar',
  'dirt',
  'wall_chunk',
  'gift',
  'pumpkin',
  'mop',
  'fake_id',
  'forged_release',
  'costume',
  'own_clothes',
];

/** Eaten from the hand without a `food` of their own (chocolate's energy; the cake its own). */
const SWEETS: readonly string[] = ['chocolate', 'choc_egg', 'ice_lolly'];

/** Whether an item goes into some recipe. */
const INGREDIENT = new Set(RECIPES.flatMap((r) => r.ingredients.flatMap(choices)));

const keyName = (key: number) => t(`keyColor.${KEY_ITEM_COLORS[key - 1]?.[0] ?? 'yellow'}` as Key);

/** The card's lines for an item (by number): what it does, then its numbers. */
export function itemFacts(n: number): string[] {
  const d = itemDef(n);
  const out: string[] = [];
  if (d.tool) {
    const job = TOOL_JOB[d.tool.kind];
    // (The plastic knife cuts and unscrews: structure.ts toolFits.)
    out.push(t(d.id === 'plastic_knife' ? 'fact.tool.knife' : job.key));
    const strikes = Math.ceil(job.hp / d.tool.damage);
    out.push(
      t((d.uses ?? 0) < strikes ? 'fact.strikesShort' : 'fact.strikes', {
        n: strikes,
        thing: t(job.thing),
        e: d.tool.energy,
        k: Math.ceil(strikes / (d.uses ?? 1)),
      }),
    );
    return out;
  }
  if (d.cat === 'weapon') {
    if (d.thrown) out.push(t('fact.thrown', { n: THROW_RANGE / UNIT }));
    if (d.attack) out.push(t('fact.attack', { n: d.attack }));
    if (d.haste) out.push(t('fact.haste', { n: Math.round(d.haste * 100) }));
    if (d.reach) out.push(t('fact.reach', { n: d.reach }));
    return out;
  }
  if (d.cat === 'outfit') {
    const soft = Math.floor((d.defense ?? 0) / 3);
    if (soft) out.push(t('fact.defense', { n: soft }));
    if (d.id === 'guard_outfit') out.push(t('fact.disguise'));
    if (d.id === 'cushioned_outfit' || d.id === 'plated_outfit') out.push(t('fact.warm'));
    if (OWN_LINE.includes(d.id)) out.push(t(`use.${d.id}` as Key));
    return out;
  }
  if (d.cat === 'key' && d.key) {
    out.push(t('fact.key', { key: keyName(d.key) }));
    if (d.uses) out.push(t('fact.plasticKey'));
    return out;
  }
  if (d.cat === 'mold' && d.key) {
    out.push(t('fact.mold', { key: keyName(d.key) }));
    return out;
  }
  if (d.food) {
    const parts = [
      d.food.energy ? t('fact.energy', { n: d.food.energy }) : '',
      d.food.health ? t('fact.health', { n: d.food.health }) : '',
    ].filter(Boolean);
    out.push(t(d.food.drink ? 'fact.drink' : 'fact.eat', { what: parts.join(', ') }));
  }
  if (SWEETS.includes(d.id)) out.push(t('fact.eat', { what: t('fact.energy', { n: CHOCOLATE_ENERGY }) }));
  if (d.id === 'cake') out.push(t('fact.cake', { n: CAKE_ENERGY }));
  if (OWN_LINE.includes(d.id)) out.push(t(`use.${d.id}` as Key, { n: RAT_MEALS }));
  // (What a merchant buys, at what it pays: pantry.ts saleOf.)
  const sale = saleOf(n);
  if (sale) out.push(t('fact.sold', { n: sale }));
  if (d.from.includes('job') && !out.length) out.push(t('fact.work'));
  if (d.from.includes('oddjob') && !out.length) out.push(t('fact.oddjob'));
  if (INGREDIENT.has(d.id)) out.push(t('fact.ingredient'));
  return out;
}

/** Every item's number (for the tests). */
export const ALL_ITEMS: readonly number[] = Object.values(ITEM);

/** At most this many names in a list of what was taken (the rest: "and 3 more"). */
const TAKEN_SHOWN = 4;

/** 2.36: what a search or a capture took, by name: the same thing counted ("lighter ×2"), the first few, then how many more. */
export function itemsText(items: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const n of items) counts.set(n, (counts.get(n) ?? 0) + 1);
  const name = (n: number) => lowerFirst(t(`item.${itemDef(n).id}` as Key));
  const names = [...counts].map(([n, k]) => (k > 1 ? t('items.times', { item: name(n), n: k }) : name(n)));
  const shown =
    names.length > TAKEN_SHOWN ? [...names.slice(0, TAKEN_SHOWN - 1), t('items.more', { n: names.length - TAKEN_SHOWN + 1 })] : names;
  return listOf(shown);
}
