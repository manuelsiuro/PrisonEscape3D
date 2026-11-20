import { STEPS_PER_MINUTE } from '../../sim/tuning';
import { MAP_W } from '../../sim/world/World';
import { pieceOf } from '../content/build';
import { cityItem, cityItemNumber } from '../content/items';
import {
  BARREL,
  DIRTY_DRINK,
  FISHING,
  FOG,
  GARDEN,
  HEAT_THIRST,
  MOOD,
  MOOD_TIME,
  MOODS,
  PERISH,
  SPOIL_AT,
  SURVIVAL_REV,
  THIRST,
  WEATHER,
  WEATHER_WEIGHT,
} from '../content/survival';
import { isBuilding } from '../content/districts';
import { TUNNEL } from '../gen/tunnel';
import { builtHere, type Built } from './build';
import type { City } from './City';
import { noise } from './dead';
import { BAG } from './gear';
import { atFire } from './light';

/**
 * Survival with weight (C5 batch 5, 2.70), a part of the city's simulation, in a city begun from then (`state.rev` 6): thirst, the
 * states (well fed, refreshed, rested, queasy, soaked), fresh food going off at dawn, the weather a day at a time from the seed,
 * dirty water drunk at a pond or the sea, fishing there with a rod, a planter's garden, a rain barrel, a smoker.
 */

const FULL = 100_000;
const ROD = cityItemNumber('fishing_rod');
const SEEDS = cityItemNumber('seeds');
const WATER = cityItemNumber('water');
const BOTTLE = cityItemNumber('bottle');
const FISH = cityItemNumber('fish');
const VEG = cityItemNumber('veg');
const HERBS = cityItemNumber('herbs');

/** The save's part: thirst (0–FULL), and the step each state lasts till (by MOOD's place; 0: none). */
export const freshNeeds = () => ({ thirst: FULL, moods: [0, 0, 0, 0, 0] as number[], sleptAt: 0 });

/** A save's fields made sound before the city is built from it. */
export function soundNeeds(st: { thirst?: unknown; moods?: unknown; sleptAt?: unknown }) {
  if (!Number.isInteger(st.sleptAt) || (st.sleptAt as number) < 0) st.sleptAt = 0;
  if (!Number.isInteger(st.thirst) || (st.thirst as number) < 0 || (st.thirst as number) > FULL) st.thirst = FULL;
  const m = st.moods;
  st.moods = Array.isArray(m) && m.length === MOODS.length && m.every((v) => Number.isInteger(v) && v >= 0) ? m : [0, 0, 0, 0, 0];
}

/** Whether the city has these rules (begun from 2.70). */
export const needsOn = (c: City) => c.state.rev >= SURVIVAL_REV;
/** A state on now. */
export const moodOn = (c: City, k: number) => needsOn(c) && c.state.moods[k] > c.state.step;
/** A state begun (or lengthened to its full time). */
export function setMood(c: City, k: number) {
  if (!needsOn(c)) return;
  const was = moodOn(c, k);
  c.state.moods[k] = c.state.step + MOOD_TIME[MOODS[k]] * STEPS_PER_MINUTE;
  if (!was) c.events.push({ type: 'mood', mood: k, on: true });
}
export function clearMood(c: City, k: number) {
  if (!moodOn(c, k)) return;
  c.state.moods[k] = 0;
  c.events.push({ type: 'mood', mood: k, on: false });
}

// ------------------------------------------------------------------ the weather

/** The weather's day: from 06:00 to the next. */
export const weatherDay = (c: City) => (c.minute >= SPOIL_AT ? c.day : c.day - 1);
/** A day's weather (its place in WEATHER): day 1 clear; after, drawn from the city's seed (no draw from the state). */
export function weatherOf(c: City, day: number): number {
  if (!needsOn(c) || day <= 1) return 0;
  const total = WEATHER_WEIGHT.reduce((n, w) => n + w, 0);
  let roll = (c.salt(9000 + day) >>> 0) % total;
  return WEATHER_WEIGHT.findIndex((w) => (roll -= w) < 0);
}
export const weatherNow = (c: City) => (c.state.district === TUNNEL ? 0 : weatherOf(c, weatherDay(c)));
const RAIN = WEATHER.indexOf('rain');
const STORM = WEATHER.indexOf('storm');
const FOGGY = WEATHER.indexOf('fog');
const HEAT = WEATHER.indexOf('heat');
export const rainy = (c: City, day: number) => [RAIN, STORM].includes(weatherOf(c, day));
export const rainingNow = (c: City) => [RAIN, STORM].includes(weatherNow(c));
/** In the morning fog: everyone sees this far at the most (tiles; 0: no fog). */
export const fogSight = (c: City) => (weatherNow(c) === FOGGY && c.minute >= SPOIL_AT && c.minute < FOG.until ? FOG.sight : 0);
/** Out under the sky: not in a building (the tunnel's roof counts). */
export const outdoors = (c: City) => {
  if (c.state.district === TUNNEL) return false;
  const lot = c.district.lotAt[c.tile] - 1;
  return lot < 0 || !isBuilding(c.district.lots[lot].use);
};

// ------------------------------------------------------------------ a minute

/** Thirst's drain this minute (thousandths): asleep less, in the heat more, queasy twice. */
function thirstDrain(c: City): number {
  let d = c.state.sleeping ? THIRST.asleep : THIRST.awake;
  if (weatherNow(c) === HEAT && !c.state.sleeping) d += Math.floor((d * HEAT_THIRST) / 100);
  if (moodOn(c, MOOD.QUEASY)) d *= 2;
  return d;
}
/** Hunger's drain, queasy twice; energy's, refreshed half, soaked half again. */
export const hungerTimes = (c: City) => (moodOn(c, MOOD.QUEASY) ? 2 : 1);
export const energyShare = (c: City) => (moodOn(c, MOOD.REFRESHED) ? 500 : 1000) + (moodOn(c, MOOD.SOAKED) ? 500 : 0);
/** Health mended twice as often well fed. */
export const mendDivisor = (c: City) => (moodOn(c, MOOD.WELL_FED) ? 2 : 1);
/** A blow's energy, rested: half. */
export const blowShare = (c: City) => (moodOn(c, MOOD.RESTED) ? 500 : 1000);
/** Thirsty enough to walk slower. */
export const parched = (c: City) => needsOn(c) && c.state.thirst < (FULL * THIRST.weak) / 100;

/** A game minute (City's): thirst, the states' ends, the rain soaking, a fire drying; at dawn the weather said and fresh food off. */
export function needsMinute(c: City) {
  if (!needsOn(c)) return;
  const s = c.state;
  const minute = Math.floor(s.step / STEPS_PER_MINUTE);
  const was = s.thirst;
  s.thirst = Math.max(0, s.thirst - thirstDrain(c));
  if (s.thirst === 0) {
    // (Said once, as it runs out.)
    if (was > 0) c.events.push({ type: 'thirsty' });
    if (minute % THIRST.hurtEvery === 0) c.hurt(1, 'thirst');
  }
  if (s.over) return;
  // (The states that end: said.)
  for (let k = 0; k < MOODS.length; k++)
    if (s.moods[k] && s.moods[k] <= s.step) {
      s.moods[k] = 0;
      c.events.push({ type: 'mood', mood: k, on: false });
    }
  // (Out in the rain without a raincoat: soaked, an hour after it stops. By a fire: dried at once.)
  const dry = cityItem(s.armour[0])?.dry === true;
  if (rainingNow(c) && outdoors(c) && !dry && !s.sleeping) setMood(c, MOOD.SOAKED);
  else if (moodOn(c, MOOD.SOAKED) && atFire(c)) clearMood(c, MOOD.SOAKED);
  if (c.minute === SPOIL_AT) {
    // (Not said under the ground: the review found the tunnel saying "clear" on a rainy day.)
    if (s.district !== TUNNEL) c.events.push({ type: 'weather', kind: weatherNow(c), day: c.day });
    // (A new day's rain grows the planters and fills the barrels: drawn again.)
    c.piecesRev++;
    spoil(c);
  }
}

/** 06:00: what's fresh in the pockets and the bag goes off, half of each stack (rounded down). Said, with how much. */
function spoil(c: City) {
  const s = c.state;
  let lost = 0;
  const stacks = [...s.inv, ...(s.bag ? (s.boxes[BAG] ?? []) : [])];
  for (const st of stacks) {
    if (!st[0] || !PERISH.includes(cityItem(st[0])?.id ?? '')) continue;
    // (Half, rounded up: the review found a single one kept for ever.)
    const gone = Math.ceil(st[1] / 2);
    if (!gone) continue;
    lost += gone;
    st[1] -= gone;
    // (Gone altogether: the slot freed, not left holding none of it.)
    if (st[1] <= 0) st[0] = st[1] = 0;
  }
  if (lost) c.events.push({ type: 'spoiled', n: lost });
}

/** Eaten or drunk (City's use): its state brought on, the one it settles settled. */
export function ate(c: City, item: number) {
  const def = cityItem(item);
  if (!def || !needsOn(c)) return;
  if (def.settles) clearMood(c, MOOD.QUEASY);
  if (def.mood) setMood(c, MOOD[def.mood === 'wellFed' ? 'WELL_FED' : def.mood === 'refreshed' ? 'REFRESHED' : 'QUEASY']);
}

/** Woken in the morning after a night in a bed (City's wake): rested. */
export const wokeRested = (c: City) => {
  if (c.state.step - c.state.sleptAt >= REST_STEPS) setMood(c, MOOD.RESTED);
};
/** A night's rest: six hours slept. */
const REST_STEPS = 6 * 60 * STEPS_PER_MINUTE;

// ------------------------------------------------------------------ water: drunk, fished

/** The water faced or beside (a pond, the sea), for the action button (-1: none). */
export function waterBeside(c: City): number {
  if (!needsOn(c) || c.state.district === TUNNEL) return -1;
  const here = c.tile;
  const x = here % MAP_W;
  const rows = c.district.rows;
  for (const t of [here - MAP_W, here + 1, here + MAP_W, here - 1]) {
    if (t < 0 || Math.abs((t % MAP_W) - x) > 1) continue;
    const ch = rows[Math.floor(t / MAP_W)]?.[t % MAP_W];
    if (ch === '~') return t;
  }
  return -1;
}
/** The action at water: a rod in the pockets, a cast (the work: `FISHING.steps`, heard); else a drink of it (queasy). */
export function atWater(c: City, tile: number) {
  const s = c.state;
  if (fishesAt(c)) {
    if (s.search === `F${tile}`) return;
    c.close();
    s.search = `F${tile}`;
    s.searchLeft = FISHING.steps;
    noise(c, c.tile, FISHING.heard);
    return void c.events.push({ type: 'casting' });
  }
  if (s.thirst >= FULL - 2000) return void c.events.push({ type: 'refused', why: 'notThirsty' });
  s.thirst = Math.min(FULL, s.thirst + DIRTY_DRINK * 1000);
  setMood(c, MOOD.QUEASY);
  c.events.push({ type: 'drank', dirty: true });
}
/** What the button at water does: a cast with a rod in the pockets, unless thirsty (under half): then a drink first. */
export const fishesAt = (c: City) => c.carried(ROD) > 0 && c.state.thirst >= FULL / 2;
/** A cast done: a fish one time in two (the sea's are two), the rod a cast more worn. No draw: the city's seed and the step. */
export function castDone(c: City, tile: number) {
  const s = c.state;
  if (!c.carried(ROD)) return;
  const sea = c.district.rows[Math.floor(tile / MAP_W)][tile % MAP_W] === '~' && c.plan.kinds[s.district] === 'docks';
  const caught = (c.salt(40_000 + s.step) >>> 0) % FISHING.oneIn === 0 ? (sea ? 2 : 1) : 0;
  if (caught) c.hand(FISH, caught);
  c.wearItem(ROD);
  c.events.push({ type: 'fished', n: caught });
}

// ------------------------------------------------------------------ what's built: a planter, a rain barrel, a smoker

/** A planter's state: planted or not, the days it has grown, the last weather day it was watered (or rained on). */
const gardenOf = (p: Built) => (p[4] ? { grown: Math.floor(p[4] / 10_000) - 1, last: p[4] % 10_000 } : null);
const setGarden = (p: Built, grown: number, last: number) => (p[4] = (grown + 1) * 10_000 + Math.max(0, last));
/** A planter brought up to date: each day it rained since it was last watered counts as a day watered. */
export function garden(c: City, p: Built, write = true): { planted: boolean; grown: number; ready: boolean; watered: boolean } {
  const g = gardenOf(p);
  if (!g) return { planted: false, grown: 0, ready: false, watered: false };
  const today = weatherDay(c);
  let { grown, last } = g;
  for (let d = last + 1; d <= today && grown < GARDEN.days; d++)
    if (rainy(c, d)) {
      grown++;
      last = d;
    }
  // (The view asks without writing: the same answer, the state left as it was.)
  if (write) setGarden(p, grown, last);
  return { planted: true, grown, ready: grown >= GARDEN.days, watered: last >= today };
}
/** A rain barrel brought up to date: so much more for each day of rain since it was last looked at; the drinks in it. */
export function barrel(c: City, p: Built, write = true): number {
  const today = weatherDay(c);
  let units = p[4] % 16;
  const last = Math.floor(p[4] / 16);
  for (let d = last + 1; d <= today; d++) if (rainy(c, d)) units = Math.min(BARREL.most, units + BARREL.perRain);
  if (write) p[4] = today * 16 + units;
  return units;
}
/** A piece just built: a barrel's rain counted from today, a planter empty. */
export function newGrowing(c: City, p: Built) {
  const def = pieceOf(p[1]);
  if (def?.grows === 'barrel') p[4] = (weatherDay(c) - 1) * 16;
}

/**
 * The open piece's card buttons (COP.BUILD, PIECE_OPS + 3 and on): a planter's seeds planted, watered, harvested; a barrel drunk
 * from, a bottle filled at it.
 */
export function growingOp(c: City, p: Built, what: number) {
  // (The review: a city under way has no weather to fill a barrel or water a planter.)
  if (!needsOn(c)) return;
  const def = pieceOf(p[1]);
  const s = c.state;
  if (def?.grows === 'planter') {
    const g = garden(c, p);
    if (what === 3) {
      if (g.planted) return;
      if (!c.count(SEEDS)) return void c.events.push({ type: 'refused', why: 'noSeeds' });
      c.spend(SEEDS, 1);
      // (Planted, not watered: the rain of today counts from now.)
      setGarden(p, 0, weatherDay(c) - 1);
      c.piecesRev++;
      return void c.events.push({ type: 'grow', what: 'planted', tile: p[0] });
    }
    if (what === 4) {
      if (!g.planted || g.ready) return;
      if (g.watered) return void c.events.push({ type: 'refused', why: 'watered' });
      if (!c.count(WATER)) return void c.events.push({ type: 'refused', why: 'noWater' });
      c.spend(WATER, 1);
      setGarden(p, g.grown + 1, weatherDay(c));
      c.piecesRev++;
      return void c.events.push({ type: 'grow', what: 'watered', tile: p[0] });
    }
    if (what === 5) {
      if (!g.ready) return;
      p[4] = 0;
      c.piecesRev++;
      // (A few more or fewer, the same for a city and a tile: no draw.)
      c.hand(VEG, GARDEN.veg + ((c.salt(50_000 + p[0] + s.step) >>> 0) % 2));
      c.hand(HERBS, GARDEN.herbs);
      c.hand(SEEDS, 1);
      return void c.events.push({ type: 'grow', what: 'harvested', tile: p[0] });
    }
  }
  if (def?.grows === 'barrel') {
    const units = barrel(c, p);
    if (!units) return void c.events.push({ type: 'refused', why: 'barrelDry' });
    if (what === 6) {
      if (s.thirst >= FULL - 2000) return void c.events.push({ type: 'refused', why: 'notThirsty' });
      s.thirst = Math.min(FULL, s.thirst + BARREL.thirst * 1000);
      p[4]--;
      c.piecesRev++;
      return void c.events.push({ type: 'drank', dirty: false });
    }
    if (what === 7) {
      if (!c.count(BOTTLE)) return void c.events.push({ type: 'refused', why: 'noBottle' });
      c.spend(BOTTLE, 1);
      c.hand(WATER, 1);
      p[4]--;
      c.piecesRev++;
      return void c.events.push({ type: 'grow', what: 'filled', tile: p[0] });
    }
  }
}

/** A smoker built beside a tile (for what wants one). */
export const smokerBeside = (c: City, tile: number) =>
  [tile - MAP_W, tile + 1, tile + MAP_W, tile - 1].some((t) => pieceOf((c.pieceAt[t] ?? 0) - 1)?.grows === 'smoker');

/** The planters and barrels of the district, for the view: [tile, stage] (a planter: 0 empty, 1–3 growing, 4 ready; a barrel: its drinks). */
export function growingHere(c: City): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const p of builtHere(c)) {
    const def = pieceOf(p[1]);
    if (def?.grows === 'planter') {
      const g = gardenOf(p);
      out.push([p[0], g ? Math.min(4, g.grown + 1) : 0]);
    } else if (def?.grows === 'barrel') out.push([p[0], p[4] % 16]);
  }
  return out;
}
