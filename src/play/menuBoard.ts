import { buzz } from '../app/haptics';
import { FEAST_ENERGY } from '../content/days';
import { MEAL, MENU, SCRIBBLE_STEPS, type Dish, type Feast } from '../content/menu';
import { CUP_ENERGY, THIRST_STEPS } from '../content/cooler';
import { ROUTINE } from '../content/routine';
import { t, type Key } from '../i18n';
import { EXT, OP } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import { canSee } from '../sim/ai/sight';
import { mealOn, mealSteps } from '../sim/systems/canteen';
import { prisonDay } from '../sim/systems/clock';
import { awake } from '../sim/systems/guards';
import { dishOn, feastOn, menuOf, mealNow } from '../sim/systems/menu';
import { freshMeals } from '../sim/systems/grounds';
import { FRESH_ENERGY, FRESH_HEALTH, UNIT } from '../sim/tuning';
import { twoAtCooler } from '../sim/systems/cooler';
import { TOUCH } from '../ui/dom';
import { powered } from '../sim/systems/power';
import type { Frame } from '../render/viewFrame';
import type { MenuMeal, MenuView } from '../ui/menuBoard';
import { banner, itemsUI, menuCard, sound } from './context';
import { floatAt } from './floats';
import { play, sendOp } from './game';
import { coachOnce } from './tips';

/**
 * The menu board and the water cooler on screen (2.33): the board's card, filled from the sim's own functions; the
 * sounds, toasts and hints of what happens at both; the card's keys (X a scribble, E or Esc away from it).
 */

/** A dish's name on the board. */
export const dishName = (d: Dish | Feast) => t(`dish.${typeof d === 'string' ? d : d.id}` as Key);

/** What a tray gives, in a few words. */
export function trayWords(energy: number, health: number, full = false): string {
  if (full) return t('menu.givesFull', { n: energy });
  return health ? t('menu.givesHp', { n: energy, h: health }) : t('menu.gives', { n: energy });
}

/** "09:00". */
const at = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

const MEAL_IDS = ['breakfast', 'dinner'] as const;
const meals: MenuMeal[] = MEAL_IDS.map(() => ({ label: '', time: '', dish: '', gives: '', state: '', feast: false }));
const view: MenuView = { day: '', today: meals, tomorrow: '', notes: [], joke: '', scribble: 'can', progress: 0, seen: false, note: '' };

/** A meal's line on a day: its dish (or the feast), what it gives with the garden's produce on top. */
function mealOf(sim: Sim, day: number, meal: number, fresh: boolean) {
  const feast = meal === MEAL.DINNER ? feastOn(sim, day) : null;
  const dish = dishOn(sim.state.salt, sim.prison.id, day, meal);
  const extra = fresh ? FRESH_ENERGY : 0;
  if (feast) return { name: dishName(feast), gives: trayWords(FEAST_ENERGY + extra, 0, true), feast: true, energy: FEAST_ENERGY };
  return {
    name: dishName(dish),
    gives: trayWords(dish.energy + extra, (dish.health ?? 0) + (fresh ? FRESH_HEALTH : 0)),
    feast: false,
    energy: dish.energy,
  };
}

/** The card now, or null with it shut. */
export function menuNow(sim: Sim): MenuView | null {
  const s = sim.state;
  if (!s.menuOpen || !menuOf(sim)) return null;
  const day = prisonDay(s.step);
  const fresh = freshMeals(sim);
  const now = mealNow(sim);
  view.day = t('hud.day', { n: day });
  MEAL_IDS.forEach((id, k) => {
    const m = meals[k];
    const line = mealOf(sim, day, k, fresh);
    m.label = t(`menu.${id}` as Key);
    m.time = at(ROUTINE.find((r) => r.id === id)!.start);
    m.dish = line.name;
    m.gives = line.gives;
    m.feast = line.feast;
    const eaten = now === k && s.eaten >= mealSteps(sim);
    // (The prison day runs from 08:00: past the meal's block, it's over for today.)
    const over = s.routine > ROUTINE.findIndex((r) => r.id === id);
    m.state = eaten ? 'eaten' : now === k && mealOn(sim) ? 'now' : over ? 'over' : '';
  });
  const tb = mealOf(sim, day + 1, MEAL.BREAKFAST, false);
  const td = mealOf(sim, day + 1, MEAL.DINNER, false);
  view.tomorrow = t('menu.tomorrowLine', { b: tb.name, d: td.name });
  view.notes = [];
  if (fresh) view.notes.push(t('menu.fresh', { n: FRESH_ENERGY, h: FRESH_HEALTH }));
  if (feastOn(sim, day)) view.notes.push(t('menu.feastNote'));
  view.joke = s.menu.scribbled === day ? t(`menu.joke.${s.menu.joke}` as Key) : '';
  view.scribble = s.menu.until ? 'doing' : s.menu.scribbled === day ? 'done' : 'can';
  view.progress = s.menu.until ? Math.min(1, 1 - (s.menu.until - s.step) / SCRIBBLE_STEPS) : 0;
  view.seen = s.guards.some((g) => awake(g) && canSee(sim.world, g.body, s.player));
  view.note = TOUCH ? t('menu.noteTouch') : t('menu.noteKeys');
  return view;
}

/** Its keys, while its card is up: X a scribble (S walks). */
export function menuKey(code: string): boolean {
  const g = play.game;
  if (!g || g.paused || g.replay || !menuCard.open) return false;
  if (code === 'KeyX') {
    menuCard.scribble();
    return true;
  }
  return false;
}

/** What the action button says with the card up. */
export function menuAction() {
  ACTION.verb = t('vend.stepAway');
  ACTION.what = t('thing.menu');
  return ACTION;
}
const ACTION = { verb: '', what: '' };

/** The action button and E with the card up: away from it. */
export function menuAct() {
  sendOp(OP.EXT, EXT.MENU, MENU.CLOSE);
}

/** What happens at the board on screen. */
export function announceMenu(e: Extract<SimEvent, { type: 'menu' }>) {
  switch (e.what) {
    case 'open':
      sound.click();
      coachOnce('menuBoard', 'hint.menuBoard');
      break;
    case 'scribbling':
      sound.chalk();
      break;
    case 'scribbled':
      buzz('attended');
      itemsUI.toast(t('menu.toast.scribbled'));
      break;
    case 'caught':
      buzz('missed');
      // (The heat stops short of a chase: what it really cost, or none.)
      banner.toast(e.n ? t('menu.toast.caught', { n: e.n }) : t('menu.toast.caughtNoHeat'), 'bad', 4000);
      break;
    case 'stopped':
      itemsUI.toast(t('menu.toast.stopped'));
      break;
    case 'laugh':
      if (e.who !== undefined) floatAt(e.who, t('float.laugh'), 'gain');
      break;
    default:
  }
}

/** What happens at the cooler on screen. */
export function announceCooler(e: Extract<SimEvent, { type: 'cooler' }>) {
  if (e.what !== 'drank') return;
  sound.glug();
  buzz('attended');
  if (e.n) floatAt(-1, t('float.cup', { n: e.n }), 'gain');
  if (e.cooled) banner.toast(t('toast.cooled'), 'good', 3500);
  coachOnce('cooler', 'hint.cooler', { n: CUP_ENERGY, m: THIRST_STEPS / 20 });
}

/** The meal just eaten: its dish, what it gave. */
export function announceMeal(e: Extract<SimEvent, { type: 'meal' }>, fallback: number) {
  floatAt(-1, t('float.meal', { n: e.n ?? fallback }), 'gain');
  if (e.hp && !e.feast) floatAt(-1, t('float.mealHp', { n: e.hp }), 'gain');
  if (e.dish && !e.feast) itemsUI.toast(t('menu.toast.ate', { dish: t(`dish.${e.dish}` as Key) }));
}

/** The board's face and the cooler's bubbles for the view (render/MenuBoard.ts). */
export function menuFrame(sim: Sim, f: Frame) {
  const s = sim.state;
  const m = f.menu;
  m.on = !!menuOf(sim);
  f.cooler.sips = s.drank + s.cooler.there.reduce((a, b) => a + b, 0);
  if (!m.on) return;
  m.lit = powered(sim.world, s, 'lights');
  const day = prisonDay(s.step);
  const fresh = freshMeals(sim);
  m.title = t('menu.title');
  m.dishes.length = m.gives.length = 0;
  for (const k of [MEAL.BREAKFAST, MEAL.DINNER]) {
    const line = mealOf(sim, day, k, fresh);
    m.dishes.push(line.name);
    m.gives.push(`+${line.energy + (fresh ? FRESH_ENERGY : 0)}`);
  }
  m.joke = s.menu.scribbled === day ? t(`menu.joke.${s.menu.joke}` as Key) : '';
}

/** Two inmates at the water cooler with the player close by: told once that standing by is worth it. */
export function coolerHint(sim: Sim) {
  const c = sim.world.def.cooler;
  if (!c || sim.rules232 || !twoAtCooler(sim)) return;
  const s = sim.state;
  if (Math.hypot(s.player.x / UNIT - c.x - 0.5, s.player.z / UNIT - c.z - 0.5) <= 5) coachOnce('coolerGossip', 'hint.coolerGossip');
}
