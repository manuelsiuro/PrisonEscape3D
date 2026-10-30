/**
 * Bluff & glider (P24): two more ways out.
 * - The bluff: at the checkpoint's shift change (19:50–20:10), when the gatekeeper coming on
 *   doesn't know a face yet, a player in a guard's uniform with a fake ID in the hotbar and the
 *   heat under BLUFF_HEAT shows it at the booth's window (Interact): the checkpoint's gates
 *   (and Irongate's drawbridge) open for them alone for WAVED_STEPS, and out through them is
 *   route `bluff`. The gatekeeper is drawn, never simulated: the rule is the whole of him.
 * - The glider: off a roof's edge as far as the day's wind carries it (structure.ts
 *   glideFrom); landing out on the road is route `glider`. Played out in actions.ts.
 * Both are solo: no crew slips out with them (crew.ts).
 */
import { BLUFF_HEAT, SHIFT_FROM, SHIFT_TO, WAVED_STEPS } from '../../content/getaways';
import { itemNumber } from '../../content/items';
import type { CheckpointDef } from '../../content/prisons/types';
import type { SimContext } from '../context';
import type { Refusal } from '../state';
import { BODY_HALF, CHASE_HEAT, UNIT } from '../tuning';
import { LAYER, MAP_H, MAP_W } from '../world/World';
import { today } from './calendar';
import { clockAt } from './clock';
import { hotbarSlotOf } from './items';
import { glideFrom, type Air } from './structure';
import type { World } from '../world/World';
import { TILE } from '../world/tiles';
import { inDisguise } from './watch';
import { tileAt } from '../world/grid';

const FAKE_ID = itemNumber('fake_id');

/** The prison's checkpoint (none in a relaxed prison). */
export const checkpointOf = (sim: Pick<SimContext, 'world'>): CheckpointDef | undefined => (sim.world.def.rules?.relaxed ? undefined : sim.world.def.checkpoint);

/** The checkpoint's shift change is on at this step: 19:50–20:10. */
export function shiftChange(step: number): boolean {
  const m = clockAt(step).minuteOfDay;
  return m >= SHIFT_FROM && m < SHIFT_TO;
}

/** A fake ID somewhere in the hotbar. */
const hasPapers = (sim: Pick<SimContext, 'state'>) => hotbarSlotOf(sim.state.items.inv, FAKE_ID) >= 0;

/**
 * The player stands at the checkpoint's window with a fake ID in the hotbar (Interact shows
 * it): on the ground floor, up and about, not hidden, not in a takeover (the gates are open then).
 */
export function atWindow(sim: SimContext): boolean {
  const c = checkpointOf(sim);
  const s = sim.state;
  if (!c || s.layer !== LAYER.GROUND || s.stowed || s.takeover || sim.away || !hasPapers(sim)) return false;
  const x = Math.floor(s.player.x / UNIT);
  const z = Math.floor(s.player.z / UNIT);
  return c.window.some((q) => q.x === x && q.z === z);
}

/**
 * Why the gatekeeper wouldn't wave the player through now, null when he would: wanted or a
 * lockdown, not in a guard's uniform, not the shift change, too much heat (a face the radio has
 * been talking about). Pure: the button says the same.
 */
export function bluffRefusal(sim: SimContext): Refusal | null {
  const s = sim.state;
  if (s.heat >= CHASE_HEAT || s.lockdown) return 'hunted';
  if (!inDisguise(sim)) return 'notGuard';
  if (!shiftChange(s.step)) return 'notShift';
  if (s.heat >= BLUFF_HEAT) return 'papersHot';
  return null;
}

/**
 * Whether showing the papers comes before whatever else is in reach at the window: at the shift
 * change before being waved through; otherwise only with nothing else to do there (and never
 * once waved through: the gates are open, nothing to show).
 */
export function windowFirst(sim: SimContext, other: boolean): boolean {
  const s = sim.state;
  if (s.waved > 0) return false;
  return shiftChange(s.step) || !other;
}

/** The fake ID shown at the window (Interact): waved through, or why not (nothing lost either way). */
export function showId(sim: SimContext) {
  const s = sim.state;
  if (s.waved > 0) return;
  const why = bluffRefusal(sim);
  if (why) {
    sim.events.push({ type: 'refused', why });
    return;
  }
  s.waved = s.step + WAVED_STEPS;
  sim.events.push({ type: 'bluff', on: true });
}

/**
 * Each step, after the guards have looked: waved through, the gates shut on the player again
 * after their minute, or at once if they're wanted or the sirens go; never on the player
 * standing in the way out (the doors follow `waved`, so a save made there loads the same).
 */
export function checkpointGates(sim: SimContext) {
  const s = sim.state;
  if (!s.waved) return;
  if (s.waved > s.step && s.heat < CHASE_HEAT && !s.lockdown) return;
  if (inTheWay(sim)) return;
  s.waved = 0;
  sim.events.push({ type: 'bluff', on: false });
}

/** The player's footprint on the checkpoint's way out (a gate, the lowered drawbridge), or on ground only it leads back from (Irongate's rock outside the gate). */
function inTheWay(sim: SimContext): boolean {
  const s = sim.state;
  if (s.layer !== LAYER.GROUND) return false;
  const w = sim.world;
  const b = s.player;
  if (w.pastCheckpoint(tileAt(b.x, b.z))) return true;
  for (const x of [b.x - BODY_HALF, b.x + BODY_HALF - 1])
    for (const z of [b.z - BODY_HALF, b.z + BODY_HALF - 1]) if (w.checkpoint[tileAt(x, z)]) return true;
  return false;
}

/** The air today (P24: what a glider flies in), from the day's plan. One object, refilled. */
const air: Air = { wind: 0, force: 0, weather: 'clear' };
export function airOf(sim: Pick<SimContext, 'prison' | 'state'> & { rules250?: boolean }): Air {
  const p = today(sim);
  air.wind = p.wind;
  air.force = p.windForce;
  air.weather = p.weather;
  air.old = !!sim.rules250;
  return air;
}

/** Where a glide could take off (P24): a roof tile the ladder's roof reaches, and the way to face (1–16). Worked out once per world. */
const spotsOf = new WeakMap<World, ReadonlyArray<readonly [number, number]>>();
export function launchSpots(w: World): ReadonlyArray<readonly [number, number]> {
  let list = spotsOf.get(w);
  if (list) return list;
  const roof = w.layers[LAYER.ROOF].kind;
  const walk = (i: number) => roof[i] === TILE.ROOF || roof[i] === TILE.LADDER;
  const seen = new Uint8Array(MAP_W * MAP_H);
  const queue: number[] = [];
  for (let i = 0; i < MAP_W * MAP_H; i++) if (roof[i] === TILE.LADDER) (seen[i] = 1), queue.push(i);
  for (let k = 0; k < queue.length; k++) {
    const t = queue[k];
    const x = t % MAP_W;
    for (const [j, ok] of [
      [t - 1, x > 0],
      [t + 1, x < MAP_W - 1],
      [t - MAP_W, t >= MAP_W],
      [t + MAP_W, t < MAP_W * (MAP_H - 1)],
    ] as const)
      if (ok && !seen[j] && walk(j)) (seen[j] = 1), queue.push(j);
  }
  const out: Array<readonly [number, number]> = [];
  const b = { x: 0, z: 0, facing: 1, moving: false };
  const still: Air = { wind: 0, force: 0, weather: 'clear' };
  for (const t of queue)
    for (const facing of [1, 5, 9, 13]) {
      b.x = (t % MAP_W) * UNIT + UNIT / 2;
      b.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
      b.facing = facing;
      const g = glideFrom(w, b, still);
      if (g && g.why !== 'runUp') out.push([t, facing]);
    }
  spotsOf.set(w, (list = out));
  return list;
}

/** Whether today's wind would carry a glider off one of the roofs the ladder reaches clear out to the road (the gossip tells it). */
export function glideOutToday(sim: SimContext): boolean {
  const a = airOf(sim);
  if (a.weather === 'storm') return false;
  const b = { x: 0, z: 0, facing: 1, moving: false };
  for (const [t, facing] of launchSpots(sim.world)) {
    b.x = (t % MAP_W) * UNIT + UNIT / 2;
    b.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
    b.facing = facing;
    const g = glideFrom(sim.world, b, a);
    if (g && !g.why && g.out) return true;
  }
  return false;
}
