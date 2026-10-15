/**
 * Learning recipes (P8+, PLAN §2): beyond crafting one by chance (GDD §8, the handbook), the
 * handbook shows every recipe within the player's Intellect as a mystery whose ingredients
 * appear once the player has carried them; studying in the library (every few points of
 * Intellect) and inmates who like the player (once a day each) tell them a recipe outright.
 */
import { itemNumber } from '../../content/items';
import { RECIPES } from '../../content/recipes';
import type { SimContext } from '../context';
import { clockAt } from './clock';
import { itemOf } from './items';

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

/** The recipe a tip teaches next: the simplest the player has the Intellect for and doesn't know yet (-1 none). */
export function nextTip(sim: SimContext): number {
  const s = sim.state;
  let best = -1;
  RECIPES.forEach((r, k) => {
    if (r.int > s.items.int || s.items.known.includes(k) || s.tips.includes(k)) return;
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
