import { MAP_H, MAP_W } from '../../sim/world/World';
import { cityItem, cityItemNumber, MANUALS } from '../content/items';
import { LIGHT_KIND } from '../content/light';
import { CITY_RECIPES, REPAIR, type CityRecipe } from '../content/recipes';
import { GEAR } from '../content/gear';
import type { City, Stack } from './City';
import { noise } from './dead';
import { addLight } from './light';
import { landing } from './ranged';

/**
 * Crafting that grows (C5 batch 4, 2.69), a part of the city's simulation: manuals read (their recipes learnt), what's worn (armour
 * against bites, a bag on the back whose things count for making and building), a worn thing repaired at a bench, and three
 * tricks: a smoke bomb thrown (a cloud the dead don't see through), a noisemaker set down (it rings, later), a flare thrown (a strong
 * light where it lands).
 */

const N = MAP_W * MAP_H;
const SMOKE = cityItemNumber('smoke_bomb');
const NOISE = cityItemNumber('noisemaker');
const FLARE = cityItemNumber('flare');

/** The bag's box: one for the whole city, carried (not a district's). */
export const BAG = 'B';

/**
 * The save's part: the manuals read (a bit each), what's worn ([armour, its wear left]; a bag's item), the smoke clouds and the
 * noisemakers set down in the district the player is in ([tile, until] and [tile, the step it rings]).
 */
export const freshGear = () => ({ manuals: 0, armour: [0, 0] as Stack, bag: 0, smoke: [] as number[][], ticks: [] as number[][] });

/** A save's fields made sound before the city is built from it. */
export function soundGear(st: { manuals?: unknown; armour?: unknown; bag?: unknown; smoke?: unknown; ticks?: unknown }) {
  const whole = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  if (!whole(st.manuals, 0, (1 << MANUALS.length) - 1)) st.manuals = 0;
  const a = st.armour;
  st.armour =
    Array.isArray(a) && a.length === 2 && cityItem(a[0])?.kind === 'armour' && whole(a[1], 1, cityItem(a[0])!.wear ?? 1) ? a : [0, 0];
  if (!(st.bag === 0 || cityItem(st.bag as number)?.kind === 'bag')) st.bag = 0;
  const pairs = (v: unknown) =>
    Array.isArray(v) &&
    v.length <= 32 &&
    v.every((p) => Array.isArray(p) && p.length === 2 && whole(p[0], 0, N - 1) && whole(p[1], 0, 1e9));
  if (!pairs(st.smoke)) st.smoke = [];
  if (!pairs(st.ticks)) st.ticks = [];
}

/** 2.69: a recipe's workshop wanted (a city begun before 2.69 has no toolkit to build one: a bench does there). */
export const wantsShop = (c: City, r: CityRecipe) => !!r.shop && c.state.rev >= 5;
/** Whether a recipe is known: a survivor's teaching aside, its manual read (a city begun before 2.69 knows them all). */
export const knows = (c: City, r: CityRecipe) => r.manual === undefined || knowsManual(c, r.manual);
/** A manual's recipes known: read, or a city begun before its revision's loot held it (2.69's three: 5; 2.70's three: 6). */
export const knowsManual = (c: City, m: number) =>
  m < 3 ? c.state.rev < 5 || (c.state.manuals & (1 << m)) !== 0 : c.state.rev >= 6 && (c.state.manuals & (1 << m)) !== 0;
/** 2.70, the review: 2.70's manuals' recipes and pieces don't exist in a city begun before (no weather, no seeds, no water to fish): hidden. */
export const manualExists = (c: City, m: number) => m < 3 || c.state.rev >= 6;
/** The bag's slots (0: none worn), and its things (read only). */
export const bagSlots = (c: City) => cityItem(c.state.bag)?.slots ?? 0;
export const bagThings = (c: City): readonly Stack[] => (c.state.bag ? (c.state.boxes[BAG] ?? []) : []);

/**
 * Used from the pockets (COP.USE): a manual read, armour or a bag put on (what was worn goes into its pocket). True when it was
 * one of them, whatever came of it.
 */
export function useGear(c: City, item: number, slot: number): boolean {
  const def = cityItem(item);
  const s = c.state;
  const st = s.inv[slot];
  if (def?.manual !== undefined) {
    const bit = 1 << def.manual;
    if (s.manuals & bit) return (c.events.push({ type: 'refused', why: 'known' }), true);
    s.manuals |= bit;
    st[0] = st[1] = 0;
    const n = CITY_RECIPES.filter((r) => r.manual === def.manual).length;
    c.events.push({ type: 'learnt', manual: def.manual, n });
    return true;
  }
  if (def?.kind === 'armour') {
    const was: Stack = [...s.armour];
    s.armour = [st[0], st[1]];
    st[0] = was[0];
    st[1] = was[1];
    c.events.push({ type: 'worn', item, on: true });
    return true;
  }
  if (def?.kind === 'bag') {
    // (A bag taken off with things in it: they'd have nowhere to go. Swapped for a bigger, they move in; a smaller must hold them.)
    const held = (s.boxes[BAG] ?? []).filter((x) => x[0]);
    if (held.length > (def.slots ?? 0)) return (c.events.push({ type: 'refused', why: 'bagFull' }), true);
    const was = s.bag;
    s.bag = item;
    s.boxes[BAG] = held;
    st[0] = was;
    st[1] = was ? 1 : 0;
    c.events.push({ type: 'worn', item, on: true });
    return true;
  }
  return false;
}

/** Taken off (COP.USE's GEAR_OFF + 0 armour, + 1 the bag): into a free pocket; a bag only empty. */
export function takeOff(c: City, what: number) {
  const s = c.state;
  const free = s.inv.find((x) => !x[0]);
  if (!free) return void c.events.push({ type: 'full' });
  if (what === 0 && s.armour[0]) {
    free[0] = s.armour[0];
    free[1] = s.armour[1];
    c.events.push({ type: 'worn', item: s.armour[0], on: false });
    s.armour = [0, 0];
  } else if (what === 1 && s.bag) {
    if ((s.boxes[BAG] ?? []).some((x) => x[0])) return void c.events.push({ type: 'refused', why: 'bagFull' });
    free[0] = s.bag;
    free[1] = 1;
    c.events.push({ type: 'worn', item: s.bag, on: false });
    // (2.69, the review: taken off from its own panel, the panel shuts.)
    if (s.open === BAG) c.close();
    s.bag = 0;
    delete s.boxes[BAG];
  }
}

/** A bite's harm through what's worn: its share taken off, the armour a bite more worn (at none, it falls apart: said). */
export function armourBite(c: City, harm: number): number {
  const s = c.state;
  const def = cityItem(s.armour[0]);
  if (!def?.wear) return harm;
  const left = Math.max(1, harm - Math.floor((harm * (def.armour ?? 0)) / 100));
  if (--s.armour[1] <= 0) {
    c.events.push({ type: 'broke', item: s.armour[0] });
    s.armour = [0, 0];
  }
  return left;
}
/** How far the dead see less, for what's worn (a poncho's tile). */
export const hiddenBy = (c: City) => cityItem(c.state.armour[0])?.hidden ?? 0;
/** The walk's share kept (thousandths), for what's worn (scrap armour's weight). */
export const walkKept = (c: City) => 1000 - (cityItem(c.state.armour[0])?.slow ?? 0);

/**
 * A worn thing in a pocket mended at a bench (COP.MAKE's REPAIR_OPS + its slot): tape and scrap for a weapon or a tool, cloth and
 * tape for armour; half its full blows back. Refused, and said: no bench, nothing to mend, not enough.
 */
export function repairItem(c: City, slot: number) {
  const st = c.state.inv[slot];
  const def = st ? cityItem(st[0]) : undefined;
  if (!def?.wear) return void c.events.push({ type: 'cantMake', why: 'parts' });
  if (st[1] >= def.wear) return void c.events.push({ type: 'refused', why: 'noNeed' });
  if (!c.atBench()) return void c.events.push({ type: 'cantMake', why: 'bench' });
  const cost = repairCostOf(def.kind);
  if (cost.some(([id, n]) => c.count(cityItemNumber(id)) < n)) return void c.events.push({ type: 'cantMake', why: 'parts' });
  for (const [id, n] of cost) c.spend(cityItemNumber(id), n);
  st[1] = Math.min(def.wear, st[1] + Math.ceil((def.wear * REPAIR.share) / 100));
  c.events.push({ type: 'mended', item: st[0] });
}
export const repairCostOf = (kind: string) => (kind === 'armour' ? REPAIR.armour : REPAIR.weapon);

/** Thrown or set down from the pockets (COP.USE): a smoke bomb, a flare (thrown ahead), a noisemaker (at the feet). */
export function useTrick(c: City, item: number, slot: number): boolean {
  if (item !== SMOKE && item !== FLARE && item !== NOISE) return false;
  const s = c.state;
  const st = s.inv[slot];
  if (item === NOISE) {
    if (s.ticks.length >= GEAR.ticksMost) return (c.events.push({ type: 'refused', why: 'tooMany' }), true);
    s.ticks.push([c.tile, s.step + GEAR.tickSteps]);
    if (--st[1] <= 0) st[0] = st[1] = 0;
    c.ticksRev++;
    c.events.push({ type: 'set', item, tile: c.tile });
    return true;
  }
  const to = landing(c, 0);
  if (to < 0) return (c.events.push({ type: 'refused', why: 'noRoom' }), true);
  if (--st[1] <= 0) st[0] = st[1] = 0;
  c.events.push({ type: 'thrown', item, from: c.tile, to });
  if (item === SMOKE) {
    s.smoke.push([to, s.step + GEAR.smokeSteps]);
    while (s.smoke.length > 8) s.smoke.shift();
    noise(c, to, GEAR.smokeHeard);
    blindIn(c);
  } else addLight(c, to, LIGHT_KIND.FLARE, GEAR.flareMinutes);
  return true;
}

/** Whether a tile is in a smoke cloud (within its reach of where one landed, while it lasts). */
export function inSmoke(c: City, tile: number): boolean {
  const s = c.state;
  if (!s.smoke.length) return false;
  const x = tile % MAP_W;
  const z = Math.floor(tile / MAP_W);
  return s.smoke.some(
    ([t, until]) => until > s.step && Math.max(Math.abs((t % MAP_W) - x), Math.abs(Math.floor(t / MAP_W) - z)) <= GEAR.smokeReach,
  );
}

/** The dead in a cloud: blind for its time (15 seconds from being caught in it), and one after the player loses them. */
function blindIn(c: City) {
  const s = c.state;
  for (const z of s.zeds) {
    if (!inSmoke(c, Math.floor(z.body.z / 1024) * MAP_W + Math.floor(z.body.x / 1024))) continue;
    if (!(z.blind !== undefined && z.blind > s.step)) z.blind = s.step + GEAR.smokeSteps;
    z.seen = -9999;
  }
}

/** A step of the tricks: smoke gone when its time is up, the dead walking into it blinded; a noisemaker ringing, then done. */
export function stepGear(c: City) {
  const s = c.state;
  if (s.smoke.length && s.smoke.some(([, until]) => until <= s.step)) s.smoke = s.smoke.filter(([, until]) => until > s.step);
  if (s.smoke.length && s.step % 5 === 0) blindIn(c);
  if (!s.ticks.length) return;
  let changed = false;
  for (const tk of s.ticks) {
    const [tile, at] = tk;
    if (s.step < at) continue;
    if (s.step === at) c.events.push({ type: 'ring', tile });
    if ((s.step - at) % GEAR.ringEvery === 0) noise(c, tile, GEAR.ringHeard, s.step !== at);
  }
  const left = s.ticks.filter(([, at]) => s.step < at + GEAR.ringSteps);
  if (left.length !== s.ticks.length) changed = true;
  s.ticks = left;
  if (changed) c.ticksRev++;
}

/** A district left: its smoke and its noisemakers aren't carried along (as its fires and alarms aren't). */
export function leaveGear(c: City) {
  c.state.smoke = [];
  c.state.ticks = [];
  c.ticksRev++;
}
