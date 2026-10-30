/**
 * Pruno (P28, docs/PLAN.md §9): fruit and sugar in a bag, left in a desk (any drawer) or a
 * toilet's tank, ferment for BREW_DAYS prison days (the bag's uses, counted down at 08:00);
 * carried or on the floor it doesn't. The smell carries: a dog on shift that passes close
 * (BREW_SNIFF, through the bars and walls) points at it and the bag is seized (k9.ts). A
 * shakedown finds it in a desk's standard drawers (it's contraband); never in the hidden one,
 * nor in a toilet's tank.
 *
 * Ripe, it sells for its value or makes a fine gift; drunk, the player is tipsy for TIPSY_STEPS:
 * blows hit harder, the walk is slower and stumbles now and then (a small noise), and a guard
 * who catches sight of it gives heat (watch.ts).
 */
import { itemNumber } from '../../content/items';
import { STUMBLE_NOISE, STUMBLE_STEPS, TIPSY_STEPS } from '../../content/long';
import type { SimContext } from '../context';
import { UNIT } from '../tuning';
import { containersOf } from '../world/containers';
import { MAP_W } from '../world/World';
import { itemOf, slot, usesOf } from './items';
import type { Body } from './movement';
import { makeNoise } from './noise';
import { tileAt } from '../world/grid';

const PRUNO_BAG = itemNumber('pruno_bag');
const PRUNO = itemNumber('pruno');
/** A bag fermenting or ripe pruno: what a dog smells. */
const isBrew = (n: number) => n === PRUNO_BAG || n === PRUNO;
/** How far a dog smells a brew in furniture (units from its footprint): through bars and walls. */
const BREW_SNIFF = 2 * UNIT;
/** The furniture a bag ferments in: a desk's drawers, a toilet's tank. */
const BREWERY: ReadonlySet<string> = new Set(['desk', 'toilet']);

/** Tipsy now (P28): the step it wears off is still to come. */
export const tipsyNow = (s: { readonly step: number; readonly tipsy: readonly number[] }) => s.tipsy.length > 0 && s.tipsy[0] > s.step;

/** 08:00 (routine.ts): every bag in a desk or a toilet ferments a day more; the last day, it's ripe. */
export function ferment(sim: SimContext) {
  const s = sim.state;
  const list = containersOf(sim.world);
  list.forEach((c, i) => {
    if (!BREWERY.has(c.prop.kind)) return;
    const slots = s.items.containers[i];
    for (let k = 0; k < slots.length; k++) {
      if (itemOf(slots[k]) !== PRUNO_BAG) continue;
      const left = usesOf(slots[k]) - 1;
      s.items.rev++;
      if (left > 0) {
        slots[k] = slot(PRUNO_BAG, left);
        continue;
      }
      slots[k] = slot(PRUNO);
      sim.events.push({ type: 'pruno', what: 'ripe', container: i, mine: c.mine });
    }
  });
}

/** The furniture (a containers index) with a brew in it within a dog's smell, -1 none. Furniture only: never anyone's pockets. */
export function brewNear(sim: SimContext, b: Body): number {
  const s = sim.state;
  const list = containersOf(sim.world);
  for (let i = 0; i < list.length; i++) {
    if (!s.items.containers[i].some((v) => isBrew(itemOf(v)))) continue;
    const p = list[i].prop;
    const dx = Math.max(p.x * UNIT - b.x, 0, b.x - (p.x + p.w) * UNIT);
    const dz = Math.max(p.z * UNIT - b.z, 0, b.z - (p.z + p.d) * UNIT);
    if (Math.max(dx, dz) <= BREW_SNIFF) return i;
  }
  return -1;
}

/** A brew found (by a dog): every bag and ripe pruno in that furniture taken. Returns how many; its tile for the handler to look at. */
export function seizeBrew(sim: SimContext, container: number): { n: number; tile: number } {
  const s = sim.state;
  const slots = s.items.containers[container];
  let n = 0;
  for (let k = 0; k < slots.length; k++)
    if (isBrew(itemOf(slots[k]))) {
      slots[k] = 0;
      n++;
    }
  if (n) s.items.rev++;
  const p = containersOf(sim.world)[container].prop;
  return { n, tile: p.z * MAP_W + p.x };
}

/** Ripe pruno drunk (the use button, pruno in hand): tipsy for TIPSY_STEPS from now. */
export function drink(sim: SimContext) {
  const s = sim.state;
  const it = s.items;
  if (itemOf(it.inv[it.hand]) !== PRUNO) return;
  it.inv[it.hand] = 0;
  it.rev++;
  s.tipsy = [s.step + TIPSY_STEPS, s.tipsy[1] ?? 0];
  sim.events.push({ type: 'pruno', what: 'drunk' });
}

/** Each step, tipsy: a stumble now and then on the move (heard close by), and sober again at the end. */
export function tipsy(sim: SimContext) {
  const s = sim.state;
  if (!s.tipsy.length) return;
  if (s.tipsy[0] === s.step) {
    sim.events.push({ type: 'pruno', what: 'sober' });
    return;
  }
  if (!tipsyNow(s) || !s.player.moving || sim.away || (s.tipsy[0] - s.step) % STUMBLE_STEPS !== 0) return;
  const tile = tileAt(s.player.x, s.player.z);
  sim.events.push({ type: 'pruno', what: 'stumble' });
  makeNoise(sim, 'stumble', s.layer, tile, STUMBLE_NOISE);
}
