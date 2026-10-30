/**
 * The player's upkeep: bed and seats (lying down, sitting, keeping the seat, getting up),
 * health and energy coming back, and the showers.
 */
import { ROUTINE } from '../../content/routine';
import { centerX, centerZ, tileAt } from '../world/grid';
import { placesOf } from '../ai/places';
import type { SimContext } from '../context';
import { freshMeals } from './grounds';
import { ENERGY_REGEN_STEPS, FRESH_ENERGY, FRESH_HEALTH, HEALTH_REGEN_STEPS, MEAL_ENERGY, MEAL_STEPS, SHOWER_ENERGY_STEPS, SIT_ENERGY_STEPS, STEPS_PER_MINUTE } from '../tuning';
import { LAYER, MAP_W } from '../world/World';
import { maxHealth } from './combat';
import { closeBox, REACH } from './items';
import { feastNow, TODAY } from './calendar';
import { FEAST_ENERGY } from '../../content/days';
import { atProp, seatSpot } from './rest';
import { endTalk } from './social';
import { stopTraining } from './training';
import { washScent } from './k9';

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

/** Sits down on a seat, bench or chair, or lies down on an infirmary bed: facing the table, the body still. */
export function sitDown(sim: SimContext, prop: number, use: 'sit' | 'rest') {
  const s = sim.state;
  // No sitting down in a lockdown (it would only get up again).
  if (s.lockdown || sim.away) return;
  // Someone sitting there already, or on the way to (on their routine, not following or fighting): the player stays up.
  const spot = seatSpot(sim.world, prop, s.player);
  const at = spot.z * MAP_W + spot.x;
  if (s.inmates.some((m) => m.ko === 0 && m.angry <= 0 && m.plan >= 0 && (m.goal === at || tileAt(m.body.x, m.body.z) === at))) {
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
 * tray is eaten (GDD §2: +35, once a meal).
 */
export function keepSeat(sim: SimContext) {
  const s = sim.state;
  if (s.seat < 0) return;
  if (sim.away || s.sleeping || s.lockdown || s.layer !== LAYER.GROUND || !atProp(sim.world, s.seat, s.player, REACH)) {
    standUp(sim);
    return;
  }
  if (s.energy < 100 && s.step % SIT_ENERGY_STEPS === 0) s.energy++;
  const p = sim.world.props[s.seat];
  const id = ROUTINE[s.routine].id;
  if (p.kind === 'seat' && (id === 'breakfast' || id === 'dinner') && !s.lockdown && s.eaten < MEAL_STEPS && sim.world.zoneAt(p.x, p.z) === 'canteen') {
    if (++s.eaten === MEAL_STEPS) {
      // A feast (P17): a tray piled high, and health back to full.
      const feast = feastNow(sim);
      // (P31: fresh from the garden, a little more.)
      const fresh = freshMeals(sim);
      s.energy = Math.min(100, s.energy + (feast ? FEAST_ENERGY : MEAL_ENERGY) + (fresh ? FRESH_ENERGY : 0));
      if (fresh) s.health = Math.min(maxHealth(s.str), s.health + FRESH_HEALTH);
      if (feast) {
        s.health = Math.max(s.health, maxHealth(s.str));
        s.eventFlags |= TODAY.FEASTED;
      }
      sim.events.push(feast ? { type: 'meal', feast, ...(fresh ? { fresh } : {}) } : fresh ? { type: 'meal', fresh } : { type: 'meal' });
    }
  }
}

/** Energy: a point back every couple of minutes, one a minute asleep. Health: a point a minute, two asleep (or resting). */
export function regenerate(sim: SimContext) {
  const s = sim.state;
  const resting = s.sleeping || (s.seat >= 0 && sim.world.props[s.seat].kind === 'bed');
  if (s.energy < 100 && (s.step % ENERGY_REGEN_STEPS === 0 || (s.sleeping && s.step % STEPS_PER_MINUTE === 0))) s.energy++;
  if (s.ko === 0 && s.health < maxHealth(s.str) && (s.step % HEALTH_REGEN_STEPS === 0 || (resting && s.step % (HEALTH_REGEN_STEPS / 2) === 0))) s.health++;
}

/** Under a running shower in the showers block, standing still (GDD §3.1): energy back, 2 a second. */
export function shower(sim: SimContext) {
  const s = sim.state;
  if (s.energy < 100 && s.step % SHOWER_ENERGY_STEPS === 0 && underShower(sim)) s.energy++;
  // (P19: and the scent washes off.)
  if (s.scent.length && underShower(sim)) washScent(sim);
}

/** Standing still under a running shower in the showers block (not out cold, carried off or in a lockdown). */
export function underShower(sim: SimContext): boolean {
  const s = sim.state;
  if (s.player.moving || sim.away || s.lockdown || s.layer !== LAYER.GROUND || ROUTINE[s.routine].id !== 'showers') return false;
  return sim.showerTiles.has(tileAt(s.player.x, s.player.z));
}
