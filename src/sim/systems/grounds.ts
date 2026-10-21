/**
 * The sports ground and the garden (P31): laps of the running track (Speed, as a treadmill
 * set), and the gardener's produce in the kitchen (fresh meals).
 */
import { cornersOf, onTrack } from '../../content/grounds';
import type { SimContext } from '../context';
import { ATTRS } from '../state';
import { ATTR_MAX, FRESH_FOR, GYM_ENERGY, TIRED, TRAIN_GAIN } from '../tuning';
import { LAYER } from '../world/World';
import { tileOfBody } from './movement';
import { energyCost } from './weather';

/**
 * A lap (each step): the corners passed in order, one way round, without stepping off the
 * lanes; back at the corner it began from after all four, it's a lap: +2 Speed and a set's
 * energy, as the treadmill gives (too tired or as fast as it gets, nothing). `s.lap` is
 * [the first corner, the last, the way round (1 clockwise, -1 not, 0 not yet), corners passed].
 */
export function laps(sim: SimContext) {
  const r = sim.prison.leisure?.track;
  if (!r) return;
  const s = sim.state;
  const t = tileOfBody(s.player);
  if (sim.away || s.sleeping || s.stowed || s.layer !== LAYER.GROUND || !onTrack(r, t.x, t.z)) {
    if (s.lap.length) s.lap = [];
    return;
  }
  const k = cornersOf(r).findIndex((c) => c.x === t.x && c.z === t.z);
  if (k < 0) return;
  if (!s.lap.length) {
    s.lap = [k, k, 0, 0];
    return;
  }
  const [first, last, way, passed] = s.lap;
  if (k === last) return;
  const turn = (k - last + 4) % 4 === 1 ? 1 : (k - last + 4) % 4 === 3 ? -1 : 0;
  // (Turned back, or across: a lap from here.)
  if (!turn || (way && turn !== way)) {
    s.lap = [k, k, 0, 0];
    return;
  }
  if (k !== first || passed + 1 < 4) {
    s.lap = [first, k, turn, passed + 1];
    return;
  }
  s.lap = [k, k, turn, 0];
  sim.events.push({ type: 'lap' });
  if (s.energy < TIRED || s.spd >= ATTR_MAX) {
    sim.events.push({ type: 'cantTrain', why: s.energy < TIRED ? 'tired' : 'max' });
    return;
  }
  s.spd = Math.min(ATTR_MAX, s.spd + TRAIN_GAIN);
  s.trained |= 1 << ATTRS.indexOf('spd');
  s.energy = Math.max(0, s.energy - energyCost(sim, GYM_ENERGY));
  sim.events.push({ type: 'trained', attr: 'spd', value: s.spd });
}

/** The garden's produce in the kitchen: the day's crates filled (the gardener's quota), the meals for a day after are fresh. */
export function gardenDelivered(sim: SimContext) {
  sim.state.fresh = sim.state.step + 1;
}

/** Whether the meals now are fresh from the garden. */
export function freshMeals(sim: SimContext): boolean {
  const s = sim.state;
  return s.fresh > 0 && s.step - (s.fresh - 1) < FRESH_FOR;
}
