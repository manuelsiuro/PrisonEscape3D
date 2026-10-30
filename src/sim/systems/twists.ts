/**
 * The Daily's twists (P26, content/twists.ts): `state.mods` names them, and the systems ask
 * here whether one is on. None in the campaign (and every rule as it always was).
 */
import type { TwistId } from '../../content/twists';
import { itemNumber } from '../../content/items';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import { HEAT_DECAY_STEPS, HOSTILE_GRUDGE, HOSTILE_OPINION, UNIT } from '../tuning';
import { LAYER, layerOfKey, MAP_W, placeKey, tileOfKey } from '../world/World';
import { damageShows, setTile } from './watch';
import { underMyDesk } from './structure';
import { containersOf } from '../world/containers';
import { slot } from './items';
import { treats } from './k9';

/** Whether a twist is on for this run. */
export const twist = (s: { readonly mods: readonly string[] }, id: TwistId): boolean => s.mods.length > 0 && s.mods.includes(id);

/** Eagle Eyes: how many tiles further guards see (the weather still caps them out in the open). */
export const EAGLE_SIGHT = 2;
/** Short Fuse: what a guard watching adds, ×3/2 (rounded up); heat cools at half the pace. */
const FUSE_DECAY = 2;
/** How often heat cools a point while nobody looks (steps). */
export const coolEvery = (s: { readonly mods: readonly string[] }) => (twist(s, 'shortFuse') ? HEAT_DECAY_STEPS * FUSE_DECAY : HEAT_DECAY_STEPS);
/** What a guard's eye adds to the heat as it trickles in (a step's worth: under 100). */
export const trickle = (s: { readonly mods: readonly string[] }, heat: number) => (heat < 100 && twist(s, 'shortFuse') ? Math.ceil((heat * 3) / 2) : heat);
/** Crackdown: cells more at the morning shakedown. */
export const CRACKDOWN_CELLS = 2;
/** Night Owl: the bed checks besides 00:30 and 04:00 (clock minutes: 02:00, 05:30). */
export const OWL_CHECKS: readonly number[] = [120, 330];
/** Three Days: the run is over as the fourth day begins (08:00). */
export const LAST_DAY = 3;
/** Care Package: the cash in it. */
export const CARE_CASH = 40;

/** Care Package: what may be in it (three of them, drawn for the run). */
export const CARE_ITEMS: readonly string[] = ['duct_tape', 'metal_file', 'timber', 'wire', 'battery', 'glue', 'screwdriver', 'crowbar', 'sheet_metal', 'chocolate'];

/**
 * Day 1 under the Daily's twists, as the game is made (before the coins and the favors; never
 * a draw from the RNG, so everything else is dealt as it would be): Bad Blood's grudges, the
 * Care Package in the player's desk (its last slots, outside the hidden compartment), Dog
 * Day's treats already out.
 */
export function dayOneTwists(sim: SimContext) {
  const s = sim.state;
  if (twist(s, 'badBlood')) for (const m of s.inmates) m.opinion = m.cell % 4 === 0 ? HOSTILE_GRUDGE : HOSTILE_OPINION;
  if (twist(s, 'carePackage')) {
    const desk = containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'desk');
    const box = s.items.containers[desk];
    const pool = [...CARE_ITEMS];
    for (let k = 0; k < 3 && box; k++) {
      const [id] = pool.splice(rollInt(s.salt, SALT.CARE, 0, k, pool.length), 1);
      box[box.length - 1 - k] = slot(itemNumber(id));
    }
    s.cash += CARE_CASH;
    s.items.rev++;
  }
  if (twist(s, 'dogDay')) treats(sim);
}

/**
 * Quick Fix, at 08:00: every bit of damage left in plain sight (as a guard would see it: a hole,
 * a cut in a fence, an open grate, a shaft, never the one under the player's desk) is mended,
 * and what was chipped at on the ground floor heals (never the floor under the desk, nor the
 * tunnels' soil). Nothing while the player is off the ground floor (never shut in) nor under their feet.
 */
export function quickFix(sim: SimContext) {
  const s = sim.state;
  if (!twist(s, 'quickFix') || s.layer !== LAYER.GROUND) return;
  const here = placeKey(LAYER.GROUND, Math.floor(s.player.z / UNIT) * MAP_W + Math.floor(s.player.x / UNIT));
  let n = 0;
  for (const k of Object.keys(s.tiles)) {
    const key = Number(k);
    const layer = layerOfKey(key);
    if (key === here || !damageShows(sim, key)) continue;
    setTile(sim, layer, tileOfKey(key), -1);
    n++;
  }
  for (const k of Object.keys(s.wear)) {
    const key = Number(k);
    if (layerOfKey(key) !== LAYER.GROUND || underMyDesk(sim.world, tileOfKey(key))) continue;
    delete s.wear[key];
    sim.wearRev++;
  }
  s.found = s.found.filter((key) => key in s.tiles);
  if (n) sim.events.push({ type: 'repaired', n, quick: true });
}
