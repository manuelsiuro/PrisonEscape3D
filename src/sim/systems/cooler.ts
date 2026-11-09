/**
 * The canteen's water cooler (2.33, docs/decisions/routine.md): a paper cup of water.
 *
 * - **A cup** (the action button at it, faced; EXT.COOLER DRINK): +5 energy, then nothing more for half an hour
 *   ("not thirsty"); on a heatwave's day it cools the player down at once, as a shower does. Full and cool, it's
 *   refused and nothing is counted.
 * - **Inmates** stop at it in the free times from the second day (the first plays as it always did), at a few rushes,
 *   by roll() (never the state's RNG): up to two, each on its place beside it, a cup and a word for a few seconds. What they say there is the director's (talk/director.ts:
 *   standing by while two are at it, the player overhears something true).
 *
 * A run from before 2.33 (Sim.rules232) has none of it, the cooler walked through as decoration. The Training Block's
 * is the player's alone: its lessons ask for inmates by name.
 */
import {
  COOLER,
  COOLER_FROM_DAY,
  CUP_ENERGY,
  DRINK_ODDS,
  DRINK_RUSH,
  DRINK_SPREAD,
  DRINK_STALL_STEPS,
  INMATE_DRINK_STEPS,
  THIRST_STEPS,
} from '../../content/cooler';
import { ROUTINE } from '../../content/routine';
import { DOING } from '../ai/doing';
import { DIR_X, DIR_Z } from '../command';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import { STEPS_PER_MINUTE, UNIT } from '../tuning';
import { LAYER, MAP_W, type Prop } from '../world/World';
import { crowdPlan, dayMinute, drillOn, prisonDay } from './calendar';
import { REACH } from './items';
import { bodyAt, type Body } from './movement';
import { playerUp } from './presence';
import { propReach } from './rest';
import { refuse } from './social';
import { blockNow, freeToGo, staysPut } from './vending';
import { baking } from './weather';

type CoolerSim = Pick<SimContext, 'world' | 'state' | 'rules232'>;

/** The prison's cooler (a run before 2.33: none). */
export const coolerOf = (sim: Pick<SimContext, 'world' | 'rules232'>) => (sim.rules232 ? undefined : sim.world.def.cooler);

/** Its prop. */
export function coolerProp(sim: Pick<SimContext, 'world' | 'rules232'>): Prop | null {
  const c = coolerOf(sim);
  return c ? (sim.world.props.find((p) => p.kind === 'cooler' && p.x === c.x && p.z === c.z) ?? null) : null;
}

/** Close enough to drink from it: up on the ground floor, a tile's reach, in its own room. */
export function atCooler(sim: CoolerSim & Pick<SimContext, 'away'>): boolean {
  const p = coolerProp(sim);
  const s = sim.state;
  return (
    !!p &&
    s.layer === LAYER.GROUND &&
    playerUp(sim) &&
    propReach(p, s.player.x, s.player.z) <= REACH &&
    sim.world.zoneAt(Math.floor(s.player.x / UNIT), Math.floor(s.player.z / UNIT)) === sim.world.zoneAt(p.x, p.z)
  );
}

/** The cooler as the action button's target: faced (within 60°), in reach, on their feet with nothing else on. It comes ahead of whoever's drinking beside it. */
export function coolerOffer(sim: CoolerSim & Pick<SimContext, 'away'>): boolean {
  const s = sim.state;
  if (!atCooler(sim) || s.seat >= 0 || s.train >= 0 || s.vendOpen || s.menuOpen || s.talk >= 0 || s.items.open >= 0) return false;
  const p = coolerProp(sim)!;
  const dx = (p.x + 0.5) * UNIT - s.player.x;
  const dz = (p.z + 0.5) * UNIT - s.player.z;
  const ahead = (DIR_X[s.player.facing] ?? 0) * dx + (DIR_Z[s.player.facing] ?? 0) * dz;
  return ahead > 0 && ahead * ahead * 4 >= (dx * dx + dz * dz) * 1024 * 1024;
}

/** Hot from a heatwave's sun (the heat that a shower washes off). */
const hot = (sim: SimContext) => baking(sim) && sim.state.cold > 0;

/** Why a cup does nothing now (null: it does). */
export function drinkRefusal(sim: SimContext): 'coolerTray' | 'notThirsty' | null {
  const s = sim.state;
  if (s.tray) return 'coolerTray';
  const soon = s.drank > 0 && s.step - s.drank < THIRST_STEPS;
  return soon || (s.energy >= 100 && !hot(sim)) ? 'notThirsty' : null;
}

/** At the cooler (EXT.COOLER b). */
export function coolerOp(sim: SimContext, b: number) {
  const s = sim.state;
  if (!coolerOf(sim) || b !== COOLER.DRINK) return;
  if (!atCooler(sim)) return;
  const why = drinkRefusal(sim);
  if (why) return refuse(sim, why);
  s.drank = s.step;
  const n = Math.min(CUP_ENERGY, 100 - s.energy);
  s.energy += n;
  const cooled = hot(sim);
  // (A heatwave's heat goes at once, as under a shower: weather.ts lets go of it at the next step.)
  if (cooled) s.cold = 0;
  sim.events.push(cooled ? { type: 'cooler', what: 'drank', n, cooled } : { type: 'cooler', what: 'drank', n });
}

/** The minute into the prison day an inmate wants a drink in a free time (-1: not this one), by roll(). */
export function wantsDrink(salt: number, day: number, b: number, k: number): number {
  if (rollInt(salt, SALT.COOLER, day * 2 + b, k, 100) >= DRINK_ODDS) return -1;
  const id = b ? 'eveningFreeTime' : 'freeTime';
  const at = ROUTINE.findIndex((r) => r.id === id);
  const from = ROUTINE[at].start - 8 * 60;
  const to = ROUTINE[at + 1].start - 8 * 60;
  const rush =
    DRINK_RUSH[rollInt(salt, SALT.COOLER, day * 2 + b, 1000 + k, DRINK_RUSH.length)] +
    rollInt(salt, SALT.COOLER, day * 2 + b, 2000 + k, DRINK_SPREAD);
  return from + Math.min(rush, to - from - 10);
}

/** Each step: who comes for a drink, who's got there, who's done. */
export function cooler(sim: SimContext) {
  const c = coolerOf(sim);
  if (!c || sim.world.def.rules?.relaxed) return;
  const s = sim.state;
  const q = s.cooler;
  const day = prisonDay(s.step);
  if (q.day !== day) {
    q.day = day;
    q.asked = [0, 0];
  }
  const elsewhere = crowdPlan(sim, s.routine) !== s.routine;
  // A lockdown, a drill, the day's event: everyone's off elsewhere.
  if (s.lockdown || drillOn(sim) || elsewhere) {
    for (let i = 0; i < q.who.length; i++) leave(sim, i);
    return;
  }
  // Inmates want a drink at their minute, in the free times, from the second day.
  const b = blockNow(sim);
  if (b >= 0 && s.step % STEPS_PER_MINUTE === 0 && day >= COOLER_FROM_DAY) {
    const minute = dayMinute(s.step);
    for (let k = 0; k < s.inmates.length && k < 30; k++) {
      if (q.asked[b] & (1 << k) || q.who.includes(k)) continue;
      const at = wantsDrink(s.salt, day, b, k);
      if (at < 0 || minute < at) continue;
      // (2.39: gathered for a chat or a game: the drink waits till it's over.)
      if (s.huddle?.who.includes(k)) continue;
      q.asked[b] |= 1 << k;
      const free = q.who.indexOf(-1);
      if (free < 0 || staysPut(sim, k) || !freeToGo(sim, k) || s.vend.line.includes(k)) continue;
      q.who[free] = k;
      q.sent[free] = s.step;
      q.there[free] = 0;
      s.inmates[k].path = [];
    }
  }
  for (let i = 0; i < q.who.length; i++) {
    const k = q.who[i];
    if (k < 0) continue;
    // Someone who can't stay now goes (the vending machine's queue joined, a fight, the player's crew).
    if (!freeToGo(sim, k, true) || s.vend.line.includes(k)) {
      leave(sim, i);
      continue;
    }
    const m = s.inmates[k];
    const spot = c.spots[i];
    if (!q.there[i]) {
      const on =
        !m.body.moving &&
        Math.max(Math.abs(m.body.x - (spot.x * UNIT + UNIT / 2)), Math.abs(m.body.z - (spot.z * UNIT + UNIT / 2))) <= UNIT / 2;
      if (on) q.there[i] = s.step;
      // (A way there wedged, someone standing in its place: not for ever.)
      else if (s.step - q.sent[i] > DRINK_STALL_STEPS) leave(sim, i);
      continue;
    }
    if (s.step - q.there[i] >= INMATE_DRINK_STEPS + (k % 4) * 20) {
      sim.events.push({ type: 'cooler', what: 'inmateDrank', who: k });
      leave(sim, i);
    }
  }
}

/** The place beside it free again. */
function leave(sim: SimContext, i: number) {
  const q = sim.state.cooler;
  q.who[i] = -1;
  q.sent[i] = 0;
  q.there[i] = 0;
}

/** Two inmates at it, both there (the director's moment for a word overheard). */
export const twoAtCooler = (sim: Pick<SimContext, 'state'>) =>
  sim.state.cooler.there.every((t) => t > 0) && sim.state.cooler.who.every((k) => k >= 0);

const marks: Body[] = [0, 1].map(() => bodyAt(0, 0));

/** The way from a tile to another (1 east, 5 south, 9 west, 13 north). */
function faceTo(from: { x: number; z: number }, to: { x: number; z: number }): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) >= Math.abs(dz)) return dx > 0 ? 1 : 9;
  return dz > 0 ? 5 : 13;
}

/** Those at it, where they stand (socialNow): each on its place, facing the cooler, a cup once there. */
export function coolerTargets(sim: SimContext, so: { follow: Array<Body | null>; gap: number[]; doing: number[]; face: number[] }) {
  const s = sim.state;
  const c = coolerOf(sim);
  if (!c) return;
  const q = s.cooler;
  q.who.forEach((k, i) => {
    if (k < 0) return;
    const m = s.inmates[k];
    if (!m || m.ko > 0 || m.angry > 0) return;
    m.wait = 0;
    const spot = c.spots[i];
    const at = marks[i];
    at.x = spot.x * UNIT + UNIT / 2;
    at.z = spot.z * UNIT + UNIT / 2;
    so.follow[k] = at;
    so.gap[k] = 0;
    so.doing[k] = q.there[i] ? DOING.DRINK : DOING.NOTHING;
    so.face[k] = faceTo(spot, c);
  });
}

/** The tile of its place, for the tests. */
export const spotTile = (sim: Pick<SimContext, 'world'>, i: number) => {
  const c = sim.world.def.cooler;
  return c ? c.spots[i].z * MAP_W + c.spots[i].x : -1;
};
