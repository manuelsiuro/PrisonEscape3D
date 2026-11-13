/**
 * The garden plot (P28, docs/phases/3-free-time.md): a rectangle of beds in the yard (`leisure.garden`, a
 * tile each). A seed packet plants a bed, a plastic cup waters it; it grows a stage each prison
 * day it was watered (rain and storms water it; a heatwave's day takes two cupfuls) and is ripe
 * at GROWN. A dry day wilts it, DRY_DEATH in a row kill it. Ripe, the use button harvests it,
 * whatever is in hand.
 *
 * The secret: a hole dug down through a planted bed doesn't show (watch.ts damageShows). A dog on
 * the trail still finds it; harvested or dead, the hole is plain to see again.
 */
import {
  CROP,
  DRY_DEATH,
  GARDEN_FAVOR,
  GARDEN_LATE,
  GARDEN_PER_BLOCK,
  GARDEN_REACH,
  GARDEN_SEE,
  GARDEN_SHARE,
  GARDEN_THEFT,
  GARDEN_USE_MIN,
  GARDEN_USE_SPAN,
  GARDEN_WANT,
  GARDEN_WITHIN,
  GROWN,
  HARVEST,
  HEATWAVE_WATER,
  WATER_MAX,
} from '../../content/long';
import { ROUTINE, routineEnd } from '../../content/routine';
import { DOING } from '../ai/doing';
import { lineOfSight } from '../ai/sight';
import { rollInt, SALT } from '../rng';
import type { SimState } from '../state';
import { STEPS_PER_MINUTE, UNIT } from '../tuning';
import { clockAt } from './clock';
import { bodyAt } from './movement';
import { changeOpinion } from './social';
import { blockNow, freeToGo, staysPut } from './vending';
import { itemDef, itemNumber } from '../../content/items';
import type { Plot } from '../../content/prisons/types';
import type { SimContext } from '../context';
import { MAP_W, LAYER, type World } from '../world/World';
import { TILE } from '../world/tiles';
import { prisonDay } from './clock';
import { give, itemOf } from './items';
import type { Body } from './movement';
import { crowdPlan, dayMinute, planOf } from './calendar';
import { sideX, sideZ } from '../command';
import { tileAt } from '../world/grid';

const VEG_SEEDS = itemNumber('veg_seeds');
const FRUIT_SEEDS = itemNumber('fruit_seeds');
const CUP = itemNumber('plastic_cup');
const VEGETABLE = itemNumber('vegetable');
const FRUIT = itemNumber('fruit');
/** What a packet plants, and what a bed of each crop gives. */
const SEEDS: ReadonlyMap<number, number> = new Map([
  [VEG_SEEDS, CROP.VEG],
  [FRUIT_SEEDS, CROP.FRUIT],
]);
const YIELD: readonly number[] = [0, VEGETABLE, FRUIT];

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
  /** 2.43: whose bed it is (an inmate's index, -1 nobody's). */
  owner: number;
}

/**
 * The bed the use button works on: the one ahead (the tile the player faces), else the one
 * underfoot. Ripe, it's harvested whatever is in hand; a seed packet plants an empty one; a cup
 * waters a growing one. Null: nothing to do here (a shovel digs, as anywhere).
 *
 * 2.43 (`owners`, the state's `gardenBy`): a neighbour's bed is never planted by the player, and his ripe one is picked
 * only with an empty hand (taken on purpose, never by a press meant for watering or digging); watering it is a favour.
 */
export function bedTarget(
  w: World,
  layer: number,
  b: Body,
  held: number,
  plots: readonly number[][],
  owners?: readonly number[],
): BedTarget | null {
  if (layer !== LAYER.GROUND || !plotOf(w)) return null;
  const here = tileAt(b.x, b.z);
  const ahead = here + sideZ(b.facing) * MAP_W + sideX(b.facing);
  const tool = held > 0 && !!itemDef(held).tool;
  for (const tile of [ahead, here]) {
    const bed = bedAt(w, tile);
    if (bed < 0) continue;
    const st = bedOf(plots, bed);
    const owner = owners?.[GB.OWNERS + bed] ?? -1;
    // (A ripe bed underfoot never takes a tool's press meant for the tile ahead.)
    if (ripe(st) && (owner < 0 ? tile === ahead || !tool : held === 0)) return { action: 'harvest', bed, tile, fits: true, owner };
    if (SEEDS.has(held) && st[BED.CROP] === CROP.NONE && owner < 0) return { action: 'plant', bed, tile, fits: true, owner };
    if (held === CUP && st[BED.CROP] !== CROP.NONE && !ripe(st))
      return { action: 'water', bed, tile, fits: st[BED.WATER] < WATER_MAX, owner };
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
    firstBed(sim);
    // (2.43: the player's from now on: no neighbour takes it once it's picked or dead.)
    if (s.gardenBy && s.gardenBy[GB.OWNERS + t.bed] === NOBODY) s.gardenBy[GB.OWNERS + t.bed] = PLAYERS;
    return;
  }
  if (t.action === 'water') {
    if (bed[BED.WATER] >= WATER_MAX) {
      sim.events.push({ type: 'garden', what: 'refused', bed: t.bed, why: 'watered' });
      return;
    }
    const wanted = !sim.rules242 && bedWants(sim, t.bed);
    bed[BED.WATER]++;
    sim.events.push({ type: 'garden', what: 'watered', bed: t.bed, n: bed[BED.WATER] });
    favour(sim, t.bed, wanted);
    return;
  }
  // The harvest: into the hotbar (or at the player's feet); the bed empty again.
  const crop = bed[BED.CROP];
  for (let k = 0; k < HARVEST; k++) give(it, YIELD[crop], s.player, s.layer);
  it.rev++;
  bed.splice(0, 4, CROP.NONE, 0, 0, 0);
  // (2.43: a neighbour's crop is taken, not harvested: no Green Thumb, no garden for the parole board.)
  if (!sim.rules242 && bedOwner(s, t.bed) >= 0) return theft(sim, t.bed, crop);
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

// ------------------------------------------------------------------ 2.43: neighbours in the garden

/** `gardenBy`'s places (state.ts), then each bed's owner from OWNERS on. */
export const GB = { WHO: 0, UNTIL: 1, FROM: 2, BED: 3, DAY: 4, ASKED: 5, VISITS: 7, FAVOR: 9, OWNERS: 10 } as const;

/** A fresh `gardenBy` for a plot of `beds`: nobody at it, nobody drawn, every bed nobody's. */
export const newGardenBy = (beds: number) => [-1, 0, 0, -1, 0, 0, 0, 0, 0, 0, ...new Array<number>(beds).fill(-1)];

/** A save's `gardenBy`, as it can be (load.ts). */
export function gardenByOk(v: unknown, beds: number, inmates: number, step: number): boolean {
  if (!Array.isArray(v) || v.length !== GB.OWNERS + beds || !v.every((x) => Number.isInteger(x))) return false;
  const g = v as number[];
  if (g[GB.WHO] < -1 || g[GB.WHO] >= inmates || g[GB.FROM] > step || g[GB.BED] < -1 || g[GB.BED] >= beds) return false;
  if (g[GB.WHO] >= 0 && g[GB.BED] < 0) return false;
  return g.slice(GB.OWNERS).every((o) => o >= PLAYERS && o < inmates);
}

/** In `gardenBy`'s owners: a bed nobody has planted yet (-1), one the player has (-2: never a neighbour's). */
const NOBODY = -1;
const PLAYERS = -2;

/** Whose a bed is (an inmate's index; below 0 not a neighbour's: the player's to plant). */
export const bedOwner = (s: Pick<SimState, 'gardenBy'>, bed: number): number => s.gardenBy?.[GB.OWNERS + bed] ?? -1;

/** The inmate crouched at his bed now (-1 nobody, or one still on his way), and the bed. */
export const gardening = (s: Pick<SimState, 'gardenBy'>): number => (s.gardenBy && s.gardenBy[GB.UNTIL] > 0 ? s.gardenBy[GB.WHO] : -1);

/** The ways a body faces (command.ts's directions): south, toward the camera, and north. */
const FACE_SOUTH = 5;
const FACE_NORTH = 13;

/** Where an inmate tends a bed from: the tile beside the plot's edge in front of it (north of the first row, south of the last), else the bed itself. */
export function standFor(w: World, bed: number): { tile: number; face: number } {
  const p = plotOf(w)!;
  const tile = bedTile(w, bed);
  const row = Math.floor(bed / p.w);
  const tries: Array<[number, number]> = [];
  // (From the north side first, facing south to the bed: toward the camera, the cup and the face seen.)
  if (row === 0) tries.push([tile - MAP_W, FACE_SOUTH]);
  if (row === p.d - 1) tries.push([tile + MAP_W, FACE_NORTH]);
  for (const [t, face] of tries)
    if (t >= 0 && !w.npcBlock[t] && w.zoneAt(t % MAP_W, Math.floor(t / MAP_W)) === 'garden') return { tile: t, face };
  return { tile, face: FACE_SOUTH };
}

/** What a bed wants today: water (not enough yet, no rain), picking, planting. */
function bedWants(sim: SimContext, bed: number): boolean {
  const st = bedOf(sim.state.plots, bed);
  if (st[BED.CROP] === CROP.NONE || ripe(st)) return true;
  const weather = planOf(sim, prisonDay(sim.state.step)).weather;
  if (weather === 'rain' || weather === 'storm') return false;
  return st[BED.WATER] < (weather === 'heatwave' ? HEATWAVE_WATER : 1);
}

/** The minute into the prison day an inmate goes to the garden in a free time (-1: not this one), by roll(). */
function wantsGarden(sim: SimContext, day: number, b: number, k: number, owns: boolean): number {
  const salt = sim.state.salt;
  if (!owns && rollInt(salt, SALT.GARDEN, day * 2 + b, k, 100) >= GARDEN_WANT) return -1;
  const id = b ? 'eveningFreeTime' : 'freeTime';
  const at = ROUTINE.findIndex((r) => r.id === id);
  const from = ROUTINE[at].start - 8 * 60;
  const to = ROUTINE[at + 1].start - 8 * 60;
  return from + rollInt(salt, SALT.GARDEN, day * 2 + b, 1000 + k, Math.max(1, Math.min(GARDEN_WITHIN, to - from - GARDEN_LATE)));
}

/** A bed for an inmate starting one: the last one nobody has planted or owns (the player's tend to be the first), while the neighbours' share has room. */
function freeBed(sim: SimContext): number {
  const g = sim.state.gardenBy!;
  const n = bedCount(sim.world);
  const owned = g.slice(GB.OWNERS).filter((o) => o >= 0).length;
  if (owned >= Math.floor(n / GARDEN_SHARE)) return -1;
  for (let k = n - 1; k >= 0; k--) if (g[GB.OWNERS + k] === NOBODY && bedOf(sim.state.plots, k)[BED.CROP] === CROP.NONE) return k;
  return -1;
}

/** The one at his bed off (done, called away, given up on the way). */
function gardenerOff(sim: SimContext, why: 'done' | 'away') {
  const g = sim.state.gardenBy!;
  const who = g[GB.WHO];
  g[GB.WHO] = -1;
  g[GB.UNTIL] = 0;
  g[GB.FROM] = 0;
  g[GB.BED] = -1;
  if (who >= 0) sim.events.push({ type: 'garden', what: why === 'done' ? 'neighbourDone' : 'neighbourOff', bed: -1, who });
}

/** He's there: picks what's ripe, plants what's empty, waters it for the day. */
function tendHis(sim: SimContext, who: number, bed: number) {
  const s = sim.state;
  const st = beds(sim)[bed];
  const day = prisonDay(s.step);
  if (ripe(st)) {
    sim.events.push({ type: 'garden', what: 'neighbourPicked', bed, crop: st[BED.CROP], who });
    st.splice(0, 4, CROP.NONE, 0, 0, 0);
  }
  if (st[BED.CROP] === CROP.NONE) {
    const crop = rollInt(s.salt, SALT.GARDEN, day * 64 + bed, 2000 + who, 2) ? CROP.FRUIT : CROP.VEG;
    st.splice(0, 4, crop, 0, 0, 0);
    sim.events.push({ type: 'garden', what: 'neighbourPlanted', bed, crop, who });
  }
  const weather = planOf(sim, day).weather;
  st[BED.WATER] = Math.max(st[BED.WATER], weather === 'heatwave' ? HEATWAVE_WATER : 1);
  sim.events.push({ type: 'garden', what: 'neighbourWatered', bed, who });
}

/** Each step (from the player's first bed on): who sets off for his bed, who's there, who's done. */
export function neighbours(sim: SimContext) {
  const s = sim.state;
  const g = s.gardenBy;
  if (!g || sim.rules242 || !plotOf(sim.world)) return;
  const day = prisonDay(s.step);
  if (g[GB.DAY] !== day) {
    g[GB.DAY] = day;
    g[GB.ASKED] = 0;
    g[GB.ASKED + 1] = 0;
    g[GB.VISITS] = 0;
    g[GB.VISITS + 1] = 0;
    g[GB.FAVOR] = 0;
  }
  const b = blockNow(sim);
  const open = b >= 0 && !s.lockdown && crowdPlan(sim, s.routine) === s.routine;
  const who = g[GB.WHO];
  if (who >= 0) {
    const m = s.inmates[who];
    if (!open || !m || !freeToGo(sim, who, true, true)) gardenerOff(sim, 'away');
    else if (g[GB.UNTIL] > 0) {
      if (s.step >= g[GB.UNTIL]) gardenerOff(sim, 'done');
    } else {
      const at = standFor(sim.world, g[GB.BED]);
      if (tileAt(m.body.x, m.body.z) === at.tile && !m.body.moving) {
        g[GB.UNTIL] = s.step + (GARDEN_USE_MIN + rollInt(s.salt, SALT.GARDEN, day * 2 + b, 3000 + who, GARDEN_USE_SPAN)) * STEPS_PER_MINUTE;
        tendHis(sim, who, g[GB.BED]);
      } else if (s.step - g[GB.FROM] > GARDEN_REACH) gardenerOff(sim, 'away');
    }
  }
  if (!open || g[GB.WHO] >= 0 || s.step % STEPS_PER_MINUTE !== 0 || g[GB.VISITS + b] >= GARDEN_PER_BLOCK) return;
  if ((((routineEnd(s.routine) - clockAt(s.step).minuteOfDay) % 1440) + 1440) % 1440 < GARDEN_LATE) return;
  const minute = dayMinute(s.step);
  const n = bedCount(sim.world);
  for (let i = 0; i < s.inmates.length && i < 30; i++) {
    const bit = 1 << i;
    if (g[GB.ASKED + b] & bit) continue;
    let bed = -1;
    for (let k = 0; k < n; k++) if (g[GB.OWNERS + k] === i) bed = k;
    if (bed >= 0 && !bedWants(sim, bed)) continue;
    const at = wantsGarden(sim, day, b, i, bed >= 0);
    if (at < 0 || minute < at) continue;
    g[GB.ASKED + b] |= bit;
    if (s.huddle?.who.includes(i) || staysPut(sim, i) || !freeToGo(sim, i) || s.vend.line.includes(i)) continue;
    if (bed < 0) {
      bed = freeBed(sim);
      if (bed < 0) continue;
      g[GB.OWNERS + bed] = i;
    }
    g[GB.WHO] = i;
    g[GB.UNTIL] = 0;
    g[GB.FROM] = s.step;
    g[GB.BED] = bed;
    g[GB.VISITS + b]++;
    s.inmates[i].path = [];
    sim.events.push({ type: 'garden', what: 'neighbourGoes', bed, who: i });
    return;
  }
}

const mark: Body = bodyAt(0, 0);

/** The one at his bed where he stands (socialNow): on the tile in front of it, facing it, crouched with a cup once there. */
export function gardenTargets(sim: SimContext, so: { follow: Array<Body | null>; gap: number[]; doing: number[]; face: number[] }) {
  const s = sim.state;
  const g = s.gardenBy;
  if (!g || g[GB.WHO] < 0 || !plotOf(sim.world)) return;
  const who = g[GB.WHO];
  const m = s.inmates[who];
  if (!m || m.ko > 0 || m.angry > 0) return;
  const at = standFor(sim.world, g[GB.BED]);
  m.wait = 0;
  mark.x = (at.tile % MAP_W) * UNIT + UNIT / 2;
  mark.z = Math.floor(at.tile / MAP_W) * UNIT + UNIT / 2;
  so.follow[who] = mark;
  so.gap[who] = 0;
  so.doing[who] = g[GB.UNTIL] > 0 ? DOING.GARDEN : DOING.NOTHING;
  so.face[who] = at.face;
}

/** The player's first bed planted (2.43): the neighbours take up gardening from now on. */
function firstBed(sim: SimContext) {
  if (sim.rules242 || sim.state.gardenBy || sim.prison.id === 'training') return;
  // (Every bed the player has planted so far theirs: the one just planted, and any growing from a save of before.)
  const g = newGardenBy(bedCount(sim.world));
  sim.state.plots.forEach((b, k) => {
    if (b[BED.CROP] !== CROP.NONE) g[GB.OWNERS + k] = PLAYERS;
  });
  sim.state.gardenBy = g;
}

/** A neighbour's bed watered when it wanted it: his opinion, once a prison day each. */
function favour(sim: SimContext, bed: number, wanted: boolean) {
  const g = sim.state.gardenBy;
  const who = bedOwner(sim.state, bed);
  if (!g || who < 0 || !wanted || g[GB.FAVOR] & (1 << who)) return;
  g[GB.FAVOR] |= 1 << who;
  const was = sim.state.inmates[who].opinion;
  changeOpinion(sim, who, GARDEN_FAVOR);
  sim.events.push({ type: 'garden', what: 'favour', bed, who, n: sim.state.inmates[who].opinion - was });
}

/** A neighbour's ripe bed picked by the player: if he sees it, he thinks less of them. */
function theft(sim: SimContext, bed: number, crop: number) {
  const s = sim.state;
  const who = bedOwner(s, bed);
  if (who < 0) return;
  const m = s.inmates[who];
  const p = s.player;
  const dx = m.body.x - p.x;
  const dz = m.body.z - p.z;
  const seen =
    m.ko <= 0 &&
    m.doing !== DOING.SLEEP &&
    s.layer === LAYER.GROUND &&
    dx * dx + dz * dz <= (GARDEN_SEE * UNIT) ** 2 &&
    lineOfSight(sim.world, m.body.x, m.body.z, p.x, p.z);
  const was = m.opinion;
  if (seen) changeOpinion(sim, who, GARDEN_THEFT);
  sim.events.push({ type: 'garden', what: 'stolen', bed, who, crop, n: m.opinion - was, seen });
}
