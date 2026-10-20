/**
 * The garden plot (P28, docs/PLAN.md §9): a rectangle of beds in the yard (`leisure.garden`, a
 * tile each). A seed packet plants a bed, a plastic cup waters it; it grows a stage each prison
 * day it was watered (rain and storms water it; a heatwave's day takes two cupfuls) and is ripe
 * at GROWN. A dry day wilts it, DRY_DEATH in a row kill it. Ripe, the use button harvests it,
 * whatever is in hand.
 *
 * The secret: a hole dug down through a planted bed doesn't show (watch.ts damageShows). A dog on
 * the trail still finds it; harvested or dead, the hole is plain to see again.
 */
import { CROP, DRY_DEATH, GROWN, HARVEST, HEATWAVE_WATER, WATER_MAX } from '../../content/long';
import { itemNumber } from '../../content/items';
import type { Plot } from '../../content/prisons/types';
import type { SimContext } from '../context';
import { MAP_W, LAYER, type World } from '../world/World';
import { TILE } from '../world/tiles';
import { prisonDay } from './clock';
import { give, itemOf } from './items';
import type { Body } from './movement';
import { planOf } from './calendar';
import { DIR_X, DIR_Z } from '../command';
import { UNIT } from '../tuning';

const VEG_SEEDS = itemNumber('veg_seeds');
const FRUIT_SEEDS = itemNumber('fruit_seeds');
const CUP = itemNumber('plastic_cup');
const VEGETABLE = itemNumber('vegetable');
const FRUIT = itemNumber('fruit');
/** What a packet plants, and what a bed of each crop gives. */
export const SEEDS: ReadonlyMap<number, number> = new Map([
  [VEG_SEEDS, CROP.VEG],
  [FRUIT_SEEDS, CROP.FRUIT],
]);
export const YIELD: readonly number[] = [0, VEGETABLE, FRUIT];

/** A bed as the state keeps it: [crop (CROP), stages grown, dry days in a row, cupfuls today]. */
export const BED = { CROP: 0, GROWN: 1, DRY: 2, WATER: 3 } as const;

/** The prison's garden plot, if it has one. */
export const plotOf = (w: World): Plot | null => w.def.leisure?.garden ?? null;

/** How many beds a prison's plot has. */
export const bedCount = (w: World): number => {
  const p = plotOf(w);
  return p ? p.w * p.d : 0;
};

/** The bed (its index in the plot) on a ground tile, -1 none. */
export function bedAt(w: World, tile: number): number {
  const p = plotOf(w);
  if (!p || tile < 0) return -1;
  const x = tile % MAP_W;
  const z = Math.floor(tile / MAP_W);
  return x >= p.x && x < p.x + p.w && z >= p.z && z < p.z + p.d ? (z - p.z) * p.w + (x - p.x) : -1;
}

/** A bed's ground tile. */
export function bedTile(w: World, bed: number): number {
  const p = plotOf(w)!;
  return (p.z + Math.floor(bed / p.w)) * MAP_W + p.x + (bed % p.w);
}

/** A bed's state (an empty one when the state has none for it yet). */
export const bedOf = (plots: readonly number[][], bed: number): readonly number[] => plots[bed] ?? EMPTY;
const EMPTY: readonly number[] = [CROP.NONE, 0, 0, 0];

export const ripe = (b: readonly number[]) => b[BED.CROP] !== CROP.NONE && b[BED.GROWN] >= GROWN;
export const wilted = (b: readonly number[]) => b[BED.CROP] !== CROP.NONE && !ripe(b) && b[BED.DRY] > 0;

/** What the use button does at the garden (null: nothing here). */
export interface BedTarget {
  action: 'plant' | 'water' | 'harvest';
  bed: number;
  tile: number;
  /** It can be done now (water: not already watered twice today). */
  fits: boolean;
}

/**
 * The bed the use button works on: the one ahead (the tile the player faces), else the one
 * underfoot. Ripe, it's harvested whatever is in hand; a seed packet plants an empty one; a cup
 * waters a growing one. Null: nothing to do here (a shovel digs, as anywhere).
 */
export function bedTarget(w: World, layer: number, b: Body, held: number, plots: readonly number[][]): BedTarget | null {
  if (layer !== LAYER.GROUND || !plotOf(w)) return null;
  const here = Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);
  const fx = DIR_X[b.facing] ?? 0;
  const fz = DIR_Z[b.facing] ?? 0;
  const sx = Math.abs(fx) >= Math.abs(fz) ? Math.sign(fx) : 0;
  const sz = Math.abs(fx) >= Math.abs(fz) ? 0 : Math.sign(fz);
  const ahead = here + sz * MAP_W + sx;
  for (const tile of [ahead, here]) {
    const bed = bedAt(w, tile);
    if (bed < 0) continue;
    const st = bedOf(plots, bed);
    if (ripe(st)) return { action: 'harvest', bed, tile, fits: true };
    if (SEEDS.has(held) && st[BED.CROP] === CROP.NONE) return { action: 'plant', bed, tile, fits: true };
    if (held === CUP && st[BED.CROP] !== CROP.NONE) return { action: 'water', bed, tile, fits: st[BED.WATER] < WATER_MAX };
  }
  return null;
}

/** The plot as the state holds it: a bed each (filled in as first planted). */
function beds(sim: SimContext): number[][] {
  const s = sim.state;
  const n = bedCount(sim.world);
  while (s.plots.length < n) s.plots.push([CROP.NONE, 0, 0, 0]);
  return s.plots;
}

/** The use button at the garden: planted, watered, harvested. */
export function tend(sim: SimContext, t: BedTarget) {
  const s = sim.state;
  const it = s.items;
  const bed = beds(sim)[t.bed];
  const held = itemOf(it.inv[it.hand]);
  if (t.action === 'plant') {
    const crop = SEEDS.get(held);
    if (!crop) return;
    it.inv[it.hand] = 0;
    it.rev++;
    bed.splice(0, 4, crop, 0, 0, 0);
    sim.events.push({ type: 'garden', what: 'planted', bed: t.bed, crop });
    return;
  }
  if (t.action === 'water') {
    if (bed[BED.WATER] >= WATER_MAX) {
      sim.events.push({ type: 'garden', what: 'refused', bed: t.bed, why: 'watered' });
      return;
    }
    bed[BED.WATER]++;
    sim.events.push({ type: 'garden', what: 'watered', bed: t.bed, n: bed[BED.WATER] });
    return;
  }
  // The harvest: into the hotbar (or at the player's feet); the bed empty again.
  const crop = bed[BED.CROP];
  for (let k = 0; k < HARVEST; k++) give(it, YIELD[crop], s.player, s.layer);
  it.rev++;
  bed.splice(0, 4, CROP.NONE, 0, 0, 0);
  sim.events.push({ type: 'garden', what: 'harvested', bed: t.bed, crop, n: HARVEST });
}

/**
 * 08:00 (routine.ts, a new prison day): every bed planted looks back on the day that ended. Watered
 * enough (or rained on), it grows a stage and isn't dry; otherwise it wilts, and dies at DRY_DEATH.
 * A ripe bed waits to be picked. Today's cupfuls start again.
 */
export function growGarden(sim: SimContext) {
  const s = sim.state;
  if (!s.plots.length) return;
  const day = prisonDay(s.step) - 1;
  const weather = day >= 1 ? planOf(sim, day).weather : 'clear';
  const rained = weather === 'rain' || weather === 'storm';
  const need = weather === 'heatwave' ? HEATWAVE_WATER : 1;
  s.plots.forEach((bed, k) => {
    const crop = bed[BED.CROP];
    if (crop === CROP.NONE) return;
    const watered = rained || bed[BED.WATER] >= need;
    bed[BED.WATER] = 0;
    if (ripe(bed)) return;
    if (watered) {
      bed[BED.DRY] = 0;
      bed[BED.GROWN]++;
      sim.events.push({ type: 'garden', what: ripe(bed) ? 'ripe' : 'grew', bed: k, crop, n: bed[BED.GROWN] });
      return;
    }
    bed[BED.DRY]++;
    if (bed[BED.DRY] >= DRY_DEATH) {
      bed.splice(0, 4, CROP.NONE, 0, 0, 0);
      sim.events.push({ type: 'garden', what: 'died', bed: k, crop });
    } else sim.events.push({ type: 'garden', what: 'wilted', bed: k, crop });
  });
}

/** A hole in a planted bed (P28): out of sight under the plant (no guard sees it as damage). */
export function underPlant(sim: Pick<SimContext, 'world' | 'state'>, tile: number): boolean {
  const bed = bedAt(sim.world, tile);
  return bed >= 0 && sim.world.ground.kind[tile] === TILE.SHAFT && bedOf(sim.state.plots, bed)[BED.CROP] !== CROP.NONE;
}
