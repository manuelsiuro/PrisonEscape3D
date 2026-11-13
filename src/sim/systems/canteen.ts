/**
 * Meals at the serving counter (since 2.25, docs/decisions/routine.md): a tray taken from the canteen's
 * counter at breakfast or dinner, held in both hands (no hotbar slot) on the way to a table, eaten
 * sitting down, and carried back empty. Eaten and not brought back, it costs heat (taken out of the canteen, or still in hand when the meal ends). A prison with
 * no counter (Training's common room) and a run logged before 2.25 (Sim.rules224) eat as they did:
 * sit down at a table and the tray is there.
 */
import { ROUTINE } from '../../content/routine';
import { placesOf } from '../ai/places';
import type { SimContext } from '../context';
import { CHASE_HEAT, MEAL_STEPS, MEAL_STEPS_224, TRAY_GRACE_STEPS, TRAY_HEAT } from '../tuning';
import { containersOf } from '../world/containers';
import { LAYER } from '../world/World';
import { byCanteen } from './calendar';
import { REACH } from './items';
import { tileOfBody } from './movement';
import { propReach } from './rest';
import { facesProp } from './structure';
import { addHeat } from './watch';
import { TRAY } from './inmates';

export { TRAY };

/** What the counter offers the action button: a tray to take, one to give back. */
export type TrayOffer = 'take' | 'return';

/** Whether meals here are fetched from a counter. */
export const traysHere = (sim: Pick<SimContext, 'world' | 'rules224'>) => !sim.rules224 && placesOf(sim.world).counters.length > 0;

/** How long a tray takes to eat, by the rules of the run. */
export const mealSteps = (sim: Pick<SimContext, 'rules224'>) => (sim.rules224 ? MEAL_STEPS_224 : MEAL_STEPS);

/** Breakfast or dinner, and no lockdown: the counter is serving. */
export function mealOn(sim: Pick<SimContext, 'state'>): boolean {
  const id = ROUTINE[sim.state.routine].id;
  return (id === 'breakfast' || id === 'dinner') && !sim.state.lockdown;
}

/** Sitting at a canteen table with something to eat, this meal's tray not finished yet. */
export function eatingNow(sim: Pick<SimContext, 'world' | 'state' | 'rules224'>): boolean {
  const s = sim.state;
  if (s.seat < 0 || !mealOn(sim) || s.eaten >= mealSteps(sim)) return false;
  const p = sim.world.props[s.seat];
  return p.kind === 'seat' && sim.world.zoneAt(p.x, p.z) === 'canteen' && (s.tray === TRAY.FULL || !traysHere(sim));
}

/** What a container offers for a tray now (null: nothing, it's searched as ever). One tray a meal: none once this meal's is eaten. */
export function trayOffer(sim: Pick<SimContext, 'world' | 'state' | 'rules224'>, container: number): TrayOffer | null {
  const s = sim.state;
  if (containersOf(sim.world)[container]?.table !== 'canteenCounter' || !traysHere(sim) || !mealOn(sim)) return null;
  if (s.tray === TRAY.EMPTY) return 'return';
  return s.tray === TRAY.NONE && s.eaten < mealSteps(sim) ? 'take' : null;
}

/** The counter the player faces, with a tray to take or give back (its container; -1 none). */
export function servingCounter(sim: Pick<SimContext, 'world' | 'state' | 'rules224'>): number {
  const s = sim.state;
  if (s.layer !== LAYER.GROUND) return -1;
  const k = containersOf(sim.world).findIndex(
    (c) => c.table === 'canteenCounter' && propReach(c.prop, s.player.x, s.player.z) <= REACH && facesProp(s.player, c.prop),
  );
  return k >= 0 && trayOffer(sim, k) ? k : -1;
}

/** What that counter offers: ahead of whoever stands beside the player, in the crush at a meal. */
export function counterTray(sim: Pick<SimContext, 'world' | 'state' | 'rules224'>): TrayOffer | null {
  const k = servingCounter(sim);
  return k < 0 ? null : trayOffer(sim, k);
}

/** The action button at the counter: the tray taken, or given back. */
export function serveTray(sim: SimContext, offer: TrayOffer) {
  sim.state.tray = offer === 'take' ? TRAY.FULL : TRAY.NONE;
  sim.events.push({ type: 'tray', what: offer });
}

/** The tray gone from the player's hands. `owed`: not brought back, it costs heat (never enough by itself to start a chase). */
export function loseTray(sim: SimContext, what: 'dropped' | 'left' | 'over', owed = false) {
  const s = sim.state;
  if (s.tray === TRAY.NONE) return;
  s.tray = TRAY.NONE;
  const heat = owed ? Math.min(TRAY_HEAT, Math.max(0, CHASE_HEAT - 1 - s.heat)) : 0;
  if (heat > 0) addHeat(sim, heat);
  sim.events.push(heat > 0 ? { type: 'tray', what, heat } : { type: 'tray', what });
}

/** The hands did something since event `from` (a blow, a tool, chocolate, a throw; not one refused): the tray falls. */
export function handsUsed(sim: SimContext, from: number) {
  if (
    sim.state.tray !== TRAY.NONE &&
    sim.events.slice(from).some((e) => e.type !== 'cantStrike' && e.type !== 'cantHit' && e.type !== 'cantThrow' && e.type !== 'refused')
  )
    loseTray(sim, 'dropped');
}

/** Both hands taken: a game on the table, a lock being picked, equipment, the pay phone, the ball up, the stage. */
export function handsBusy(s: SimContext['state']): boolean {
  return (
    s.bout.length > 0 ||
    s.dice.length > 0 ||
    s.pick.length > 0 ||
    s.shot.length > 0 ||
    s.train >= 0 ||
    !!s.cheat ||
    !!s.shootout ||
    !!s.board?.seated ||
    !!s.pens ||
    !!s.ink ||
    !!s.show ||
    !!s.quiz ||
    !!s.call
  );
}

/** Each step with a tray: it stays with a player up and about in the canteen with their hands free, while the meal lasts. */
export function keepTray(sim: SimContext) {
  const s = sim.state;
  if (s.tray === TRAY.NONE) return;
  if (s.ko > 0 || s.sleeping || sim.away || s.stowed || handsBusy(s)) return loseTray(sim, 'dropped');
  // The meal over with the tray eaten and time enough to bring it back (not a lockdown, which takes it from anyone).
  if (!mealOn(sim)) return loseTray(sim, 'over', !s.lockdown && s.tray === TRAY.EMPTY && s.step - s.trayDone > TRAY_GRACE_STEPS);
  const t = tileOfBody(s.player);
  // (Full, it costs nothing: the counter's first press hands one to whoever only came to search it.)
  if (s.layer !== LAYER.GROUND || !byCanteen(sim, t.x, t.z)) loseTray(sim, 'left', s.tray === TRAY.EMPTY);
}
