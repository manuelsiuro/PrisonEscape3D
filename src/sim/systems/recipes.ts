/**
 * Learning recipes (P8+, PLAN §2): beyond crafting one by chance (GDD §8, the handbook), the
 * handbook shows every recipe within the player's Intellect as a mystery whose ingredients
 * appear once the player has carried them; studying in the library (every few points of
 * Intellect) and inmates who like the player (once a day each) tell them a recipe outright.
 */
import { ITEMS, itemNumber, type Source } from '../../content/items';
import { LOOT } from '../../content/loot';
import { RECIPES } from '../../content/recipes';
import type { SimContext } from '../context';
import { containersOf } from '../world/containers';
import type { World } from '../world/World';
import { clockAt } from './clock';
import { guardKit, itemOf } from './items';

/** Every item ingredient of a recipe can be (an ingredient may be one of several). */
const OPTIONS = RECIPES.map((r) => r.ingredients.map((ing) => ing.split('|').map(itemNumber)));

/** What a recipe's ingredient slot k can be (item numbers). */
export const ingredientOptions = (recipe: number, k: number): readonly number[] => OPTIONS[recipe][k];

/** Each step: whatever is in the player's pockets (hotbar, weapon, outfit) is something they've carried. */
export function noteCarried(sim: SimContext) {
  const s = sim.state;
  for (let k = 0; k < 8; k++) {
    const item = itemOf(s.items.inv[k]);
    if (item && !s.carried.includes(item)) {
      s.carried.push(item);
      s.items.rev++;
    }
  }
}

/** Made anywhere, whatever the furniture: dirt and chunks dug and chipped, shivs, potatoes, what the player starts with. */
const ANYWHERE: readonly Source[] = ['start', 'sharpen', 'dig', 'chip', 'solitary'];
const obtainableOf = new WeakMap<World, ReadonlySet<number>>();

/**
 * Every item that can be had in this prison: what its furniture, the inmates' pockets, its
 * merchants and jobs stock, its guards' keys and kit, and what's made anywhere; then all a
 * recipe makes from those, until nothing new comes. A recipe whose result isn't in it is no
 * use here (a mold for a key no guard carries): no tip teaches it, the handbook leaves it out.
 */
export function obtainable(w: World): ReadonlySet<number> {
  let set = obtainableOf.get(w);
  if (set) return set;
  const have = new Set<string>();
  const tables = new Set(['pockets', ...containersOf(w).map((c) => c.table), ...(w.def.merchants.length ? ['merchant'] : [])]);
  for (const name of tables) for (const id of [...(LOOT[name]?.items.map(([i]) => i) ?? []), ...(LOOT[name]?.fixed ?? [])]) have.add(id);
  w.def.guards.forEach((_, k) => guardKit(w, k).forEach((n) => have.add(ITEMS[n - 1].id)));
  for (const d of ITEMS) if (d.from.some((f) => ANYWHERE.includes(f) || (f === 'job' && w.def.jobs.length > 0))) have.add(d.id);
  for (let changed = true; changed; ) {
    changed = false;
    for (const r of RECIPES) {
      if (have.has(r.result) || !r.ingredients.every((ing) => ing.split('|').some((c) => have.has(c)))) continue;
      have.add(r.result);
      changed = true;
    }
  }
  set = new Set([...have].map(itemNumber));
  obtainableOf.set(w, set);
  return set;
}

/** Whether a recipe is any use in this prison (its result can be had here). */
export const usableHere = (w: World, recipe: number) => obtainable(w).has(itemNumber(RECIPES[recipe].result));

/** Copying a guard's key is learnt with the key in hand, never told: the molds and what they cast. */
const NEVER_TOLD = new Set(RECIPES.flatMap((r, k) => (r.keep || r.ingredients.some((ing) => ing.startsWith('mold_')) ? [k] : [])));

/** The recipe a tip teaches next: the simplest the player has the Intellect for and doesn't know yet (-1 none). */
export function nextTip(sim: SimContext): number {
  const s = sim.state;
  let best = -1;
  RECIPES.forEach((r, k) => {
    if (r.int > s.items.int || s.items.known.includes(k) || s.tips.includes(k) || NEVER_TOLD.has(k) || !usableHere(sim.world, k)) return;
    if (best < 0 || r.int < RECIPES[best].int) best = k;
  });
  return best;
}

/** A recipe told to the player (by studying, or by an inmate: `who`); whether there was one to tell. */
export function revealTip(sim: SimContext, who = -1): boolean {
  const recipe = nextTip(sim);
  if (recipe < 0) return false;
  sim.state.tips.push(recipe);
  sim.state.items.rev++;
  sim.events.push({ type: 'tip', recipe, who });
  return true;
}

/** Whether an inmate has told the player a recipe today already. */
export function tippedToday(sim: SimContext, who: number): boolean {
  return (sim.state.tipDay[who] ?? 0) === clockAt(sim.state.step).day;
}
