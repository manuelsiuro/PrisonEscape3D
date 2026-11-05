/**
 * The canteen's menu board (2.33, docs/PLAN.md §2): the day's dishes, each tray giving what its dish does (content/menu.ts).
 *
 * - **The dishes**: one for breakfast and one for dinner, drawn for the day by roll() (never the state's RNG), never the
 *   same as the day before; the first day the plain tray (+35 at each meal, as ever). A feast beats whatever was on.
 * - **Up to it** (the action button, facing the wall it hangs on, EXT.MENU OPEN): its card opens with today's and
 *   tomorrow's dishes. Walked off, hit, a lockdown: it shuts.
 * - **A scribble** (SCRIBBLE): two seconds at it, once a day. Seen at it by a guard, they say something (a little heat,
 *   never a chase) and it isn't finished. Done, it stays up till the morning, and the inmates who see it laugh, once
 *   each, liking the player a little more.
 *
 * A run from before 2.33 (Sim.rules232) has none of it: every tray +35, the board decoration.
 */
import { HOLIDAY_DAY, type HolidayDay } from '../../content/holidays';
import { BREAKFASTS, DINNERS, HOUSE_DINNER, MEAL, MENU, SCRIBBLE_HEAT, SCRIBBLE_OPINION, SCRIBBLE_REACH, SCRIBBLE_STEPS, SCRIBBLES, type Dish, type Feast } from '../../content/menu';
import { ROUTINE } from '../../content/routine';
import { canSee, lineOfSight } from '../ai/sight';
import { DIR_X, DIR_Z } from '../command';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import { CHASE_HEAT, UNIT } from '../tuning';
import { LAYER } from '../world/World';
import { planOf, prisonDay } from './calendar';
import { awake } from './guards';
import { holidayDays } from './holiday';
import { DOING } from './inmates';
import { playerUp } from './presence';
import { changeOpinion, refuse } from './social';
import { closeMenu } from './menuState';
import { addHeat } from './watch';

type MenuSim = Pick<SimContext, 'world' | 'state' | 'rules232' | 'away'>;

/** The prison's board (a run before 2.33: none). */
export const menuOf = (sim: Pick<SimContext, 'world' | 'rules232'>) => (sim.rules232 ? undefined : sim.world.def.menu);

/** What dinner can be here: the shared dishes and the prison's own. */
const dinnersOf = (prison: string): readonly Dish[] => (HOUSE_DINNER[prison] ? [...DINNERS, HOUSE_DINNER[prison]] : DINNERS);

/** A meal's dish on a prison day, by roll(): the plain one the first day, never the same as the day before's. */
export function dishOn(salt: number, prison: string, day: number, meal: number): Dish {
  const all = meal === MEAL.BREAKFAST ? BREAKFASTS : dinnersOf(prison);
  return all[dishIndex(salt, all.length, day, meal)];
}

/** Its place in the list (0 the plain one on the first day), each day's drawn against what the day before served. */
function dishIndex(salt: number, n: number, day: number, meal: number): number {
  let served = 0;
  for (let d = 2; d <= day; d++) {
    const pick = rollInt(salt, SALT.MENU, d * 2 + meal, 0, n);
    // (Never yesterday's: another, by a second draw that can't land on it.)
    served = pick === served ? (pick + 1 + rollInt(salt, SALT.MENU, d * 2 + meal, 1, n - 1)) % n : pick;
  }
  return served;
}

/** The holiday's day a feast is held on, and what it is. */
const HOLIDAY_FEAST: Partial<Record<HolidayDay, Feast>> = { eggHunt: 'lamb', waterFight: 'barbecue', christmasDay: 'christmas' };

/** A feast at dinner on a prison day (the day's event, a holiday's), or null. */
export function feastOn(sim: Pick<SimContext, 'prison' | 'state' | 'world'>, day: number): Feast | null {
  const hol = holidayDays(sim, day).find((id) => HOLIDAY_DAY[id].feast);
  if (hol) return HOLIDAY_FEAST[hol] ?? 'roast';
  return planOf(sim, day).event === 'feast' ? 'roast' : null;
}

/** The meal now (MEAL), or -1 when it's neither breakfast nor dinner. */
export function mealNow(sim: Pick<SimContext, 'state'>): number {
  const id = ROUTINE[sim.state.routine].id;
  return id === 'breakfast' ? MEAL.BREAKFAST : id === 'dinner' ? MEAL.DINNER : -1;
}

/** This meal's dish (null in a run before 2.33, or out of a meal). */
export function dishNow(sim: Pick<SimContext, 'state' | 'prison' | 'rules232'>): Dish | null {
  const meal = mealNow(sim);
  if (sim.rules232 || meal < 0) return null;
  return dishOn(sim.state.salt, sim.prison.id, prisonDay(sim.state.step), meal);
}

/** Close enough to read it: up on the ground floor, on the tiles in front of it or the row behind them (within a quarter tile either side), against its wall. */
export function atMenu(sim: MenuSim): boolean {
  const m = menuOf(sim);
  const s = sim.state;
  if (!m || s.layer !== LAYER.GROUND || !playerUp(sim)) return false;
  const p = s.player;
  const inX = p.x >= m.x * UNIT - UNIT / 4 && p.x <= (m.x + m.w) * UNIT + UNIT / 4;
  const inZ = p.z >= m.z * UNIT && p.z <= (m.z + 1) * UNIT + UNIT / 2;
  return inX && inZ && sim.world.zoneAt(Math.floor(p.x / UNIT), Math.floor(p.z / UNIT)) === sim.world.zoneAt(m.x, m.z);
}

/** Facing the wall it hangs on (north), within 45°. */
const facingIt = (facing: number) => (DIR_Z[facing] ?? 0) < 0 && Math.abs(DIR_X[facing] ?? 0) <= Math.abs(DIR_Z[facing] ?? 0);

/** The board as the action button's target: in reach, faced, on their feet with nothing else on. */
export function menuOffer(sim: MenuSim): boolean {
  const s = sim.state;
  if (!atMenu(sim) || s.tray || s.seat >= 0 || s.train >= 0 || s.vendOpen || s.menuOpen || s.talk >= 0 || s.items.open >= 0) return false;
  return facingIt(s.player.facing);
}

/** Why it can't be scribbled on now (null: it can). */
export function scribbleRefusal(sim: MenuSim): 'menuFar' | 'menuScribbled' | null {
  const s = sim.state;
  if (!atMenu(sim)) return 'menuFar';
  return s.menu.scribbled === prisonDay(s.step) ? 'menuScribbled' : null;
}

/** At the board (EXT.MENU b). */
export function menuOp(sim: SimContext, b: number) {
  const s = sim.state;
  if (!menuOf(sim)) return;
  if (b === MENU.CLOSE) return closeMenu(sim);
  if (b === MENU.OPEN) {
    if (!atMenu(sim)) return refuse(sim, 'menuFar');
    if (s.tray || s.seat >= 0 || s.train >= 0 || s.menuOpen) return;
    s.menuOpen = true;
    sim.events.push({ type: 'menu', what: 'open' });
    return;
  }
  if (b === MENU.SCRIBBLE) {
    if (s.menu.until) return;
    const why = scribbleRefusal(sim);
    if (why) return refuse(sim, why);
    s.menuOpen = true;
    s.menu.until = s.step + SCRIBBLE_STEPS;
    sim.events.push({ type: 'menu', what: 'scribbling' });
  }
}

/** A guard awake who sees the player now. */
const seen = (sim: SimContext) => sim.state.guards.some((g) => awake(g) && canSee(sim.world, g.body, sim.state.player));

/** Each step: the morning's wipe, the card shut on walking off, a scribble done or caught, the laughs. */
export function menu(sim: SimContext) {
  const m = menuOf(sim);
  if (!m) return;
  const s = sim.state;
  const day = prisonDay(s.step);
  // Wiped every morning.
  if (s.menu.scribbled && s.menu.scribbled !== day) {
    s.menu.scribbled = 0;
    s.menu.laughed = [];
    sim.events.push({ type: 'menu', what: 'wiped' });
  }
  if (s.menuOpen && (s.lockdown || !atMenu(sim))) closeMenu(sim, true);
  if (s.menu.until) {
    // (Walking about while at it: it stops.)
    if (s.player.moving) {
      s.menu.until = 0;
      sim.events.push({ type: 'menu', what: 'stopped' });
    } else if (seen(sim)) {
      // Seen at it: told off, not caught at anything. A little heat, never a chase; the board as it was.
      s.menu.until = 0;
      const heat = Math.min(SCRIBBLE_HEAT, Math.max(0, CHASE_HEAT - 1 - s.heat));
      if (heat > 0) addHeat(sim, heat);
      sim.events.push({ type: 'menu', what: 'caught', n: heat });
    } else if (s.step >= s.menu.until) {
      s.menu.until = 0;
      s.menu.scribbled = day;
      s.menu.joke = rollInt(s.salt, SALT.MENU, day, 7, SCRIBBLES);
      s.menu.laughed = [];
      sim.events.push({ type: 'menu', what: 'scribbled' });
    }
  }
  if (s.menu.scribbled && s.step % 10 === 0) laughs(sim, m);
}

/** Those who see the scribble laugh, once a day each, and like the player for it. */
function laughs(sim: SimContext, m: { x: number; z: number; w: number }) {
  const s = sim.state;
  const cx = (m.x + m.w / 2) * UNIT;
  const cz = m.z * UNIT + UNIT / 2;
  const reach = SCRIBBLE_REACH * UNIT;
  const zone = sim.world.zoneAt(m.x, m.z);
  s.inmates.forEach((im, k) => {
    if (im.ko > 0 || im.angry > 0 || im.doing === DOING.SLEEP || s.menu.laughed.includes(k)) return;
    if (Math.abs(im.body.x - cx) > reach || Math.abs(im.body.z - cz) > reach) return;
    if (sim.world.zoneAt(Math.floor(im.body.x / UNIT), Math.floor(im.body.z / UNIT)) !== zone || !lineOfSight(sim.world, im.body.x, im.body.z, cx, cz)) return;
    s.menu.laughed.push(k);
    changeOpinion(sim, k, SCRIBBLE_OPINION);
    sim.events.push({ type: 'menu', what: 'laugh', who: k });
  });
}
