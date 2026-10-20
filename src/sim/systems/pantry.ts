/**
 * The makings of P28's long games, had on request (docs/PLAN.md §9): fruit off an open canteen
 * counter at a meal (one piece a meal), sugar from an open kitchen freezer and a seed packet off an
 * open library shelf (one a prison day each); every merchant's staples (sugar and seed packets,
 * whatever its stock); and what a merchant buys (ripe pruno, vegetables) at its value. Nothing is
 * stocked: the furniture holds what it always did, and no draw is made.
 */
import { itemDef, itemNumber } from '../../content/items';
import { PANTRY_GOODS, STAPLES, TAKE, WANTED } from '../../content/long';
import { ROUTINE } from '../../content/routine';
import { SHOP_SLOTS } from '../../content/loot';
import type { SimContext } from '../context';
import { BUY_OPINION, OPINION_LOW } from '../tuning';
import { containersOf } from '../world/containers';
import { prisonDay } from './clock';
import { priceOf } from './economy';
import { HOTBAR, itemOf, slot } from './items';
import { changeOpinion, refuse } from './social';

const STAPLE_ITEMS = STAPLES.map(itemNumber);
const WANTED_ITEMS = WANTED.map(itemNumber);
/** state.pantry: [the meal fruit was last taken at, the day sugar was, the day a seed packet was]. */
const MEAL = 0;
const SUGAR_DAY = 1;
const SEED_DAY = 2;

/** The meal now (breakfast or dinner) as a number a day apart (0: not a meal). */
function mealNow(sim: SimContext): number {
  const id = ROUTINE[sim.state.routine].id;
  if (id !== 'breakfast' && id !== 'dinner') return 0;
  return prisonDay(sim.state.step) * 2 + (id === 'dinner' ? 1 : 0);
}

/** Whether a TAKE can be had from the open furniture now: null yes, else why not (null `what` when it isn't that furniture). */
export function takeCheck(sim: SimContext, what: number): 'notMeal' | 'takenToday' | 'room' | 'notHere' | null {
  const s = sim.state;
  const good = PANTRY_GOODS[what];
  const open = s.items.open;
  const c = open >= 0 ? containersOf(sim.world)[open] : undefined;
  if (!good || !c || c.table !== good[1]) return 'notHere';
  const day = prisonDay(s.step);
  if (what === TAKE.FRUIT) {
    const meal = mealNow(sim);
    if (!meal) return 'notMeal';
    if (s.pantry[MEAL] === meal) return 'takenToday';
  } else if (s.pantry[what === TAKE.SUGAR ? SUGAR_DAY : SEED_DAY] === day) return 'takenToday';
  if (s.items.inv.slice(0, HOTBAR).indexOf(0) < 0) return 'room';
  return null;
}

/** EXT.TAKE (b: TAKE): fruit, sugar or a seed packet from the open furniture, into the hotbar. */
export function take(sim: SimContext, what: number) {
  const s = sim.state;
  const why = takeCheck(sim, what);
  if (why === 'notHere') return;
  if (why) return refuse(sim, why);
  const item = itemNumber(PANTRY_GOODS[what][0]);
  const pantry = s.pantry.length === 3 ? s.pantry : (s.pantry = [0, 0, 0]);
  if (what === TAKE.FRUIT) pantry[MEAL] = mealNow(sim);
  else pantry[what === TAKE.SUGAR ? SUGAR_DAY : SEED_DAY] = prisonDay(s.step);
  s.items.inv[s.items.inv.slice(0, HOTBAR).indexOf(0)] = slot(item);
  s.items.rev++;
  sim.events.push({ type: 'pickup', item });
}

/** TALK.BUY past the shop's own slots: one of the staples (b − SHOP_SLOTS), always in stock. */
export function buyStaple(sim: SimContext, who: number, k: number) {
  const s = sim.state;
  const item = STAPLE_ITEMS[k];
  if (!item || sim.merchantOf(who) < 0) return;
  const m = s.inmates[who];
  if (!sim.shopsOpen) return refuse(sim, 'closed');
  if (m.opinion <= OPINION_LOW) return refuse(sim, 'grudge');
  const price = priceOf(itemDef(item).value, m.opinion);
  if (s.cash < price) return refuse(sim, 'cash');
  const free = s.items.inv.slice(0, HOTBAR).indexOf(0);
  if (free < 0) return refuse(sim, 'room');
  s.items.inv[free] = slot(item);
  s.cash -= price;
  sim.events.push({ type: 'bought', who, item, price }, { type: 'cash', n: -price, why: 'buy' });
  changeOpinion(sim, who, BUY_OPINION);
}

/** The slot TALK.BUY asks for a staple by (its place after the shop's own). */
export const stapleSlot = (k: number) => SHOP_SLOTS + k;

/** What a merchant pays for an item (its value), 0 for what it doesn't buy. */
export const saleOf = (item: number): number => (WANTED_ITEMS.includes(item) ? itemDef(item).value : 0);

/** TALK.SELL (b: the hotbar slot): ripe pruno or a vegetable sold to a merchant, at its value. */
export function sell(sim: SimContext, who: number, b: number) {
  const s = sim.state;
  const it = s.items;
  const v = b < HOTBAR ? it.inv[b] : 0;
  if (!v || sim.merchantOf(who) < 0) return;
  const item = itemOf(v);
  const price = saleOf(item);
  if (!price) return refuse(sim, 'notWanted');
  if (!sim.shopsOpen) return refuse(sim, 'closed');
  if (s.inmates[who].opinion <= OPINION_LOW) return refuse(sim, 'grudge');
  it.inv[b] = 0;
  it.rev++;
  s.cash += price;
  s.tally[3] += price;
  sim.events.push({ type: 'sold', who, item, price }, { type: 'cash', n: price, why: 'sale' });
}
