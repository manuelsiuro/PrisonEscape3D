/**
 * The player's upkeep: bed and seats (lying down, sitting, keeping the seat, getting up),
 * health and energy coming back, and the showers.
 */
import { centerX, centerZ, tileAt } from '../world/grid';
import { placesOf } from '../ai/places';
import type { SimContext } from '../context';
import { freshMeals } from './grounds';
import { ENERGY_REGEN_STEPS, FRESH_ENERGY, FRESH_HEALTH, HEALTH_REGEN_STEPS, MEAL_ENERGY, NIGHT_ENERGY_FLOOR, SHOWER_ENERGY_STEPS, SHOWER_HEAT_BELOW, SHOWER_HEAT_STEPS, SIT_ENERGY_STEPS, STEPS_PER_MINUTE } from '../tuning';
import { LAYER, MAP_W } from '../world/World';
import { maxHealth } from './combat';
import { closeBox, REACH } from './items';
import { feastNow, TODAY } from './calendar';
import { dishNow } from './menu';
import { eatingNow, mealSteps, TRAY } from './canteen';
import { FEAST_ENERGY } from '../../content/days';
import { atProp, seatSpot } from './rest';
import { endTalk } from './social';
import { stopTraining } from './training';
import { washScent } from './k9';
import { underShower } from './showers';
import { ROUTINE } from '../../content/routine';
import { freeHotbar, HOTBAR, itemOf } from './items';
import { containersOf } from '../world/containers';
import { itemNumber } from '../../content/items';

/** Into bed: the player lies down beside it (the view puts them in it). */
export function sleep(sim: SimContext) {
  const s = sim.state;
  const t = placesOf(sim.world).bedside[1];
  if (t < 0) return;
  s.player.x = centerX(t);
  s.player.z = centerZ(t);
  s.player.moving = false;
  s.sleeping = true;
  closeBox(sim);
  endTalk(sim);
  stopTraining(sim);
  sim.events.push({ type: 'sleep', on: true });
}

type NightReader = Pick<SimContext, 'state' | 'world' | 'rules227'>;
const BED_DUMMY = itemNumber('bed_dummy');

/**
 * What the action button does at the player's own bed at night (2.28), before sleep: a dummy in the
 * bed comes out (the morning's search would find it, and they can't lie on it), a dummy in hand goes in.
 * Null: they lie down. Tucked in, taken out and tucked in again: nothing is lost by a wrong press.
 */
export function bedOffer(sim: NightReader, index: number): 'tuck' | 'takeOut' | null {
  if (sim.rules227) return null;
  const it = sim.state.items;
  if (it.containers[index].some((v) => itemOf(v) === BED_DUMMY)) return 'takeOut';
  return itemOf(it.inv[it.hand]) === BED_DUMMY ? 'tuck' : null;
}

/** The dummy from the hand into the bed: its first free slot, or (a bed has two, its pillow and sheet) in place of what's first there, which comes into the hand. */
export function tuckDummy(sim: SimContext, index: number) {
  const it = sim.state.items;
  const box = it.containers[index];
  const from = containersOf(sim.world)[index].hidden;
  const free = box.indexOf(0, from);
  const k = free < 0 ? from : free;
  const was = box[k];
  box[k] = it.inv[it.hand];
  it.inv[it.hand] = was;
  it.rev++;
  sim.events.push({ type: 'bedDummy', in: true });
}

/**
 * The dummy out of the bed into the pockets: a slot other than the hand if there is one, so that the next
 * press is Sleep and not the dummy going back in. Pockets full: it changes places with what's in hand (a bed
 * starts full, so tucking in brings its pillow to the hand; nobody is ever kept from lying down by this).
 */
export function takeOutDummy(sim: SimContext, index: number) {
  const it = sim.state.items;
  const box = it.containers[index];
  const from = box.findIndex((v) => itemOf(v) === BED_DUMMY);
  let to = it.inv.slice(0, HOTBAR).findIndex((v, k) => !v && k !== it.hand);
  if (to < 0) to = freeHotbar(it.inv);
  const swapped = to < 0 ? itemOf(it.inv[it.hand]) : 0;
  if (to < 0) to = it.hand;
  const was = it.inv[to];
  it.inv[to] = box[from];
  box[from] = was;
  it.rev++;
  sim.events.push(swapped ? { type: 'bedDummy', in: false, swapped } : { type: 'bedDummy', in: false });
}

/**
 * Up at Lights Out (2.28): energy comes back at night only asleep (GDD §2: sleep, or the dummy and a night's
 * work). Not when it isn't their choice: out cold, in solitary, in a lockdown. Not at Training, which has no nights.
 */
export function awakeAtNight(sim: Pick<SimContext, 'state' | 'world' | 'rules227'>): boolean {
  const s = sim.state;
  return !sim.rules227 && ROUTINE[s.routine].id === 'lightsOut' && !s.sleeping && s.ko === 0 && s.solitary <= 0 && !s.lockdown && !sim.world.def.rules?.relaxed;
}

/** Sits down on a seat, bench or chair, or lies down on an infirmary bed: facing the table, the body still. */
export function sitDown(sim: SimContext, prop: number, use: 'sit' | 'rest') {
  const s = sim.state;
  // No sitting down in a lockdown (it would only get up again).
  if (s.lockdown || sim.away) return;
  // Someone sitting there already, or on the way to (on their routine, not following or fighting): the player stays up.
  const spot = seatSpot(sim.world, prop, s.player);
  const at = spot.z * MAP_W + spot.x;
  if (s.inmates.some((m) => m.ko === 0 && m.angry <= 0 && m.plan >= 0 && (m.goal === at || m.seat === at || tileAt(m.body.x, m.body.z) === at))) {
    sim.events.push({ type: 'refused', why: 'seatTaken' });
    return;
  }
  endTalk(sim);
  closeBox(sim);
  s.player.moving = false;
  if (use === 'sit') s.player.facing = spot.facing;
  s.seat = prop;
  sim.events.push({ type: 'sit', on: true, use });
}

export function standUp(sim: SimContext) {
  const s = sim.state;
  if (s.seat < 0) return;
  const use = sim.world.props[s.seat].kind === 'bed' ? 'rest' : 'sit';
  s.seat = -1;
  sim.events.push({ type: 'sit', on: false, use });
}

/**
 * Each step seated: up when carried off, knocked out, asleep or out of reach of the seat;
 * else energy back a point every SIT_ENERGY_STEPS, and at a canteen table during a meal the
 * tray in front of them is eaten (GDD §2: +35, once a meal; canteen.ts).
 */
export function keepSeat(sim: SimContext) {
  const s = sim.state;
  if (s.seat < 0) return;
  if (sim.away || s.sleeping || s.lockdown || s.layer !== LAYER.GROUND || !atProp(sim.world, s.seat, s.player, REACH)) {
    standUp(sim);
    return;
  }
  // (2.31: not over a book: a set costs what the card says, on a chair as at the shelf.)
  const readingHere = !sim.rules230 && s.train >= 0 && sim.world.props[s.train].kind === 'shelf';
  if (s.energy < 100 && s.step % SIT_ENERGY_STEPS === 0 && !awakeAtNight(sim) && !readingHere) s.energy++;
  if (eatingNow(sim)) {
    if (++s.eaten >= mealSteps(sim)) {
      if (s.tray === TRAY.FULL) {
        s.tray = TRAY.EMPTY;
        s.trayDone = s.step;
      }
      // A feast (P17): a tray piled high, and health back to full.
      const feast = feastNow(sim);
      // (P31: fresh from the garden, a little more.)
      const fresh = freshMeals(sim);
      // (2.33: the day's dish, as the menu board has it; before, every tray the same.)
      const dish = feast ? null : dishNow(sim);
      const n = (feast ? FEAST_ENERGY : dish ? dish.energy : MEAL_ENERGY) + (fresh ? FRESH_ENERGY : 0);
      const hp = (dish?.health ?? 0) + (fresh ? FRESH_HEALTH : 0);
      s.energy = Math.min(100, s.energy + n);
      if (hp) s.health = Math.min(maxHealth(s.str), s.health + hp);
      if (feast) {
        s.health = Math.max(s.health, maxHealth(s.str));
        s.eventFlags |= TODAY.FEASTED;
      }
      const what = sim.rules232 ? {} : { n, ...(hp ? { hp } : {}), ...(dish ? { dish: dish.id } : {}) };
      sim.events.push(feast ? { type: 'meal', feast, ...(fresh ? { fresh } : {}), ...what } : fresh ? { type: 'meal', fresh, ...what } : { type: 'meal', ...what });
    }
  }
}

/** Energy: a point back every couple of minutes (2.28: at night only asleep; before, one more a minute asleep). Health: a point a minute, two asleep (or resting). */
export function regenerate(sim: SimContext) {
  const s = sim.state;
  const resting = s.sleeping || (s.seat >= 0 && sim.world.props[s.seat].kind === 'bed');
  // (2.28: up at night, only as far as a little to go on with, so nobody is stranded down a tunnel. Asleep, the same rate; Training's nights as they were.)
  const heldBack = awakeAtNight(sim) && s.energy >= NIGHT_ENERGY_FLOOR;
  const oldSleep = (sim.rules227 || sim.world.def.rules?.relaxed) && s.sleeping && s.step % STEPS_PER_MINUTE === 0;
  if (s.energy < 100 && !heldBack && (s.step % ENERGY_REGEN_STEPS === 0 || oldSleep)) s.energy++;
  if (s.ko === 0 && s.health < maxHealth(s.str) && (s.step % HEALTH_REGEN_STEPS === 0 || (resting && s.step % (HEALTH_REGEN_STEPS / 2) === 0))) s.health++;
}

/** Under a running shower (GDD §2, §3.1): energy back, 2 a second; 2.26: minor heat washed off too. */
export function shower(sim: SimContext) {
  const s = sim.state;
  if (s.energy < 100 && s.step % SHOWER_ENERGY_STEPS === 0 && underShower(sim)) s.energy++;
  if (!sim.rules225 && s.heat > 0 && s.heat < SHOWER_HEAT_BELOW && s.step % SHOWER_HEAT_STEPS === 0 && underShower(sim)) s.heat--;
  // (P19: and the scent washes off.)
  if (s.scent.length && underShower(sim)) washScent(sim);
}
