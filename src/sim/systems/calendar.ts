/**
 * The day (P17): a prison day runs from 08:00 to 08:00. What it holds (its event, its weather,
 * the wind, the warden's mood, when things happen) is a pure function of the prison, the run's
 * salt and the day (`dayPlan`), so it's known ahead: the warden's forecast and the inmates'
 * talk are true. Day 1 is always quiet (and clear). `state.calendar` can force a day's event
 * and weather (bots, tests, the Daily), and `state.mods` the Daily's twists.
 *
 * Each step (`theDay`) starts and ends the day's event on the minute: the inspection, the fire
 * drill and its muster, the feast, the generator's service, movie night, the food fight, the
 * delivery (P18, delivery.ts: its search and departure), visiting day (P21, smuggling.ts: the visitors and the
 * arches at the visiting room's doors), sports day (P22, games.ts: the prize for three bouts won); and a storm's power cuts in the night. What they change is asked of this module by the systems:
 * how far a guard sees (`sightOf`), how far a noise carries (`muffled`), the inmates' plan
 * (`crowdPlan`), the snipers in the weather, the heat of the sun.
 */
import { COMMENDATION, DAY_BOOKS, DAY_EVENTS, DRILL_HEAT, EVENT_TIMES, FOG_FROM, FOG_UNTIL, HEAT_FROM, HEAT_UNTIL, INSPECTION_SIGHT, MOVIE_NOISE, MUSTER_MINUTES, OUTAGE_FROM, OUTAGE_TO, WEATHER_NOISE, WEATHER_SIGHT, WEATHERS, type DayEvent, type Weather } from '../../content/days';
import { ROUTINE } from '../../content/routine';
import { floorOf } from '../ai/places';
import type { SimContext } from '../context';
import { roll, rollInt, SALT } from '../rng';
import type { SimState } from '../state';
import { POWER_OFF_STEPS, STEPS_PER_MINUTE, UNIT } from '../tuning';
import { TILE_INFO } from '../world/tiles';
import { LAYER, MAP_W } from '../world/World';
import type { Guard } from './guards';
import { dayMinute, DAY_STEPS, prisonDay } from './clock';
import { cutPower, generatorsOf, offFor, summon } from './power';
import { addHeat } from './watch';
import { deliveryMinute } from './delivery';
import { musicOn } from './talent';
import { EAGLE_SIGHT, twist } from './twists';

export { DAY_STEPS, dayMinute, prisonDay };

export interface DayPlan {
  day: number;
  event: DayEvent;
  weather: Weather;
  /** Where the wind blows from (0 north, clockwise in eighths) and how hard (0 calm – 3 a gale). */
  wind: number;
  windForce: number;
  /** The warden's mood this morning (0 cheerful, 1 businesslike, 2 grumpy): what they say, not what happens. */
  mood: number;
  /** When the event starts and ends (minutes into the prison day; -1 without one). */
  at: number;
  until: number;
  /** A storm's power cuts (minutes into the prison day). */
  outages: number[];
}

/**
 * A day forced: [day (0: every day), event (DAY_EVENTS index, -1: as drawn), weather (WEATHERS
 * index, -1: as drawn)], and (P24: bots and tests, a glide's day) the wind too: [..., where it
 * blows from (0–7), its strength (0–3)], -1 as drawn.
 */
export type ForcedDay = [number, number, number] | [number, number, number, number, number];

/** Every day quiet and clear: the multi-day tests that aren't about the day keep their numbers. */
export const quietCalendar = (): ForcedDay[] => [[0, 0, 0]];

/** The weather drawn for each day, by prison and salt (it follows from yesterday's: worked out once). */
const drawn = new Map<string, number[]>();

/** The weather a day draws (before anything is forced): day 1 clear; then yesterday's again, or one by the climate's weights. */
function drawnWeather(prison: string, salt: number, day: number): number {
  const book = DAY_BOOKS[prison];
  if (!book || day <= 1) return 0;
  const key = `${prison}:${salt}`;
  let list = drawn.get(key);
  if (!list) drawn.set(key, (list = [0, 0]));
  const { weights, keep } = book.climate;
  const total = weights.reduce((a, b) => a + b, 0);
  for (let d = list.length; d <= day; d++) {
    const was = list[d - 1];
    const stays = WEATHERS[was] === 'storm' || WEATHERS[was] === 'heatwave' ? keep / 2 : keep;
    if (d > 2 && rollInt(salt, SALT.WEATHER, d, 0, 100) < stays) {
      list.push(was);
      continue;
    }
    let r = rollInt(salt, SALT.WEATHER, d, 1, total);
    let k = 0;
    while (r >= weights[k]) r -= weights[k++];
    list.push(k);
  }
  return list[day];
}

/** The event a day deals from the week's shuffled deck (day 1: none). */
function drawnEvent(prison: string, salt: number, day: number): number {
  const book = DAY_BOOKS[prison];
  if (!book || day <= 1) return 0;
  const week = Math.floor((day - 2) / book.deck.length);
  const order = book.deck.map((_, k) => k);
  for (let j = order.length - 1; j > 0; j--) {
    const k = rollInt(salt, SALT.DECK, week, j, j + 1);
    [order[j], order[k]] = [order[k], order[j]];
  }
  return DAY_EVENTS.indexOf(book.deck[order[(day - 2) % book.deck.length]]);
}

/** Cards a day is forced to only where the prison's deck has them (a vehicle to come, a room to visit in). */
const DECK_ONLY: ReadonlySet<DayEvent> = new Set(['delivery', 'visiting']);

/** The Daily's twists that set every day's weather (P26; dormant in the campaign). */
const MOD_WEATHER: Record<string, Weather> = { fogDays: 'fog', storm: 'storm' };

/**
 * What a prison day holds: pure, the same for every caller (the sim, the warden's forecast,
 * the inmates' talk, the tests). A prison without a day book (the Training Block) is always
 * quiet; day 1 is always quiet and clear (the escape bots' day, untouched).
 */
export function dayPlan(prison: string, salt: number, day: number, calendar: readonly ForcedDay[] = [], mods: readonly string[] = []): DayPlan {
  let event = drawnEvent(prison, salt, day);
  let weather = drawnWeather(prison, salt, day);
  // Forced days: an exact day wins over every day (0). (Never a delivery where no vehicle comes, nor visiting day where nobody visits: a deck without the card.)
  const book = DAY_BOOKS[prison];
  let forcedWind = -1;
  let forcedForce = -1;
  for (const pass of [0, 1])
    for (const [d, e, wx, wd = -1, wf = -1] of calendar) {
      if (pass === 0 ? d !== 0 : d !== day) continue;
      if (e >= 0 && e < DAY_EVENTS.length && (!DECK_ONLY.has(DAY_EVENTS[e]) || book?.deck.includes(DAY_EVENTS[e]))) event = e;
      if (wx >= 0 && wx < WEATHERS.length) weather = wx;
      if (wd >= 0 && wd < 8) forcedWind = wd;
      if (wf >= 0 && wf <= 3) forcedForce = wf;
    }
  // (Not on day 1: it stays clear whatever the twist.)
  if (day > 1) for (const m of mods) if (MOD_WEATHER[m]) weather = WEATHERS.indexOf(MOD_WEATHER[m]);
  // (Big Freeze: no heatwave, no rain; the cold's dry days.)
  if (mods.includes('bigFreeze') && (WEATHERS[weather] === 'heatwave' || WEATHERS[weather] === 'rain')) weather = WEATHERS.indexOf('clear');
  // (Truck Strike: no vehicle comes; the day deals the card the delivery took the place of.)
  if (DAY_EVENTS[event] === 'delivery' && mods.includes('truckStrike')) event = DAY_EVENTS.indexOf(book?.before ?? 'none');
  const id = DAY_EVENTS[event];
  const w = WEATHERS[weather];
  // The wind: the prevailing one most days, else from anywhere; calm in fog, strong in a storm.
  const prevailing = book?.climate.wind ?? 0;
  const turn = rollInt(salt, SALT.WIND, day, 0, 10);
  const wind = turn < 6 ? prevailing : turn < 8 ? (prevailing + 1) % 8 : turn < 9 ? (prevailing + 7) % 8 : rollInt(salt, SALT.WIND, day, 1, 8);
  const drawnForce = w === 'fog' ? 0 : w === 'storm' ? 2 + rollInt(salt, SALT.WIND, day, 2, 2) : rollInt(salt, SALT.WIND, day, 2, 3);
  // (Forced, P24: still calm in fog.)
  const windForce = forcedForce >= 0 && w !== 'fog' ? forcedForce : drawnForce;
  const mood = rollInt(salt, SALT.MOOD, day, 0, 3);
  let at = -1;
  let until = -1;
  if (id !== 'none') {
    const t = EVENT_TIMES[id];
    if (typeof t.at === 'number') at = t.at;
    else {
      const windows = t.at;
      const [from, to] = windows[rollInt(salt, SALT.EVENT_TIME, day, 0, windows.length)];
      at = from + rollInt(salt, SALT.EVENT_TIME, day, 1, to - from + 1);
    }
    until = at + t.length;
  }
  const outages: number[] = [];
  if (w === 'storm' && book) {
    const n = 2 + rollInt(salt, SALT.OUTAGE, day, 0, 2);
    const span = Math.floor((OUTAGE_TO - OUTAGE_FROM) / n);
    // One in each part of the night, a cut always over before the next can start.
    for (let k = 0; k < n; k++) outages.push(OUTAGE_FROM + k * span + rollInt(salt, SALT.OUTAGE, day, k + 1, Math.max(1, span - 50)));
  }
  return { day, event: id, weather: w, wind: forcedWind >= 0 ? forcedWind : wind, windForce, mood, at, until, outages };
}

/** A sim's plan for a day (today by default). */
export function planOf(sim: Pick<SimContext, 'prison' | 'state'>, day = prisonDay(sim.state.step)): DayPlan {
  const s = sim.state;
  return dayPlan(sim.prison.id, s.salt, day, s.calendar, s.mods);
}

/** Today's plan, kept while the day and the forced days stay the same (it's asked every step, by every guard). */
const cached = new WeakMap<SimState, { day: number; calendar: readonly ForcedDay[]; length: number; mods: readonly string[]; plan: DayPlan }>();
export function today(sim: Pick<SimContext, 'prison' | 'state'>): DayPlan {
  const s = sim.state;
  const day = prisonDay(s.step);
  const c = cached.get(s);
  if (c && c.day === day && c.calendar === s.calendar && c.length === s.calendar.length && c.mods === s.mods) return c.plan;
  const plan = planOf(sim, day);
  cached.set(s, { day, calendar: s.calendar, length: s.calendar.length, mods: s.mods, plan });
  return plan;
}

/** Whether the day's event is on now (from its start to its end). */
export function eventOn(sim: Pick<SimContext, 'prison' | 'state'>, event: DayEvent): boolean {
  const p = today(sim);
  if (p.event !== event) return false;
  const m = dayMinute(sim.state.step);
  return m >= p.at && m < p.until;
}

/** The fire drill's bell has gone and everyone is out at roll call. */
export const drillOn = (sim: Pick<SimContext, 'prison' | 'state'>) => eventOn(sim, 'drill');

/** Fog lies thick now (the morning, and from the evening through the night). */
export function fogNow(sim: Pick<SimContext, 'prison' | 'state'>): boolean {
  if (today(sim).weather !== 'fog') return false;
  const m = dayMinute(sim.state.step);
  return m < FOG_UNTIL || m >= FOG_FROM;
}

/** The weather that holds outdoors now: fog only while it lies thick (what sight and the snipers go by). */
export function weatherNow(sim: Pick<SimContext, 'prison' | 'state'>): Weather {
  const w = today(sim).weather;
  return w === 'fog' && !fogNow(sim) ? 'clear' : w;
}

/** A heatwave's sun is up and biting (11:00–18:00). */
export function sunBites(sim: Pick<SimContext, 'prison' | 'state'>): boolean {
  if (today(sim).weather !== 'heatwave') return false;
  const m = dayMinute(sim.state.step);
  return m >= HEAT_FROM && m < HEAT_UNTIL;
}

/** The towers can't see through fog or a storm: the snipers stand down. */
export function snipersBlind(sim: Pick<SimContext, 'prison' | 'state'>): boolean {
  const w = weatherNow(sim);
  return w === 'fog' || w === 'storm';
}

/** Whether a ground tile is out in the open. */
const outdoors = (sim: SimContext, x: number, z: number) => TILE_INFO[sim.world.ground.kind[z * MAP_W + x]].outdoor;

/**
 * How far a guard sees now (units): 7 tiles (or the prison's own), a tile more while the
 * inspectors are in; out in the open, no further than the weather lets anyone (fog, rain, a
 * storm). The cones on screen are drawn with it: what they show is the rule.
 */
export function sightOf(sim: SimContext, g: Guard): number {
  let r = sim.world.def.rules?.sightRange ?? 7;
  if (eventOn(sim, 'inspection')) r += INSPECTION_SIGHT;
  // (P26: Eagle Eyes, further still.)
  if (twist(sim.state, 'eagleEyes')) r += EAGLE_SIGHT;
  const cap = WEATHER_SIGHT[weatherNow(sim)];
  if (cap !== undefined && r > cap && outdoors(sim, Math.floor(g.body.x / UNIT), Math.floor(g.body.z / UNIT))) r = cap;
  return r * UNIT;
}

/**
 * How far a noise made now carries (tiles): out in the open, the rain and a storm drown it;
 * in the canteen during movie night, the film's soundtrack does. The ear on the tool button
 * and the aim's preview ask the same.
 */
export function muffled(sim: SimContext, layer: number, tile: number, reach: number): number {
  if (reach <= 0 || tile < 0) return reach;
  const x = tile % MAP_W;
  const z = Math.floor(tile / MAP_W);
  let share = 10;
  // (A wall being chipped from the yard is out in the open too: its noise is the yard's.)
  const open = layer === LAYER.ROOF || (layer === LAYER.GROUND && (outdoors(sim, x, z) || (TILE_INFO[sim.world.ground.kind[tile]].solid && openBeside(sim, x, z))));
  if (open) share = WEATHER_NOISE[weatherNow(sim)] ?? 10;
  // (P30: talent night's music while it plays, as loud.)
  if (layer === LAYER.GROUND && (eventOn(sim, 'movie') || (eventOn(sim, 'talent') && musicOn(sim))) && sim.world.zoneAt(x, z) === 'canteen') share = Math.min(share, MOVIE_NOISE);
  return share === 10 ? reach : Math.max(1, Math.floor((reach * share) / 10));
}

/** A tile beside open ground (a wall facing the yard). */
const openBeside = (sim: SimContext, x: number, z: number) => outdoorFloor(sim, x + 1, z) || outdoorFloor(sim, x - 1, z) || outdoorFloor(sim, x, z + 1) || outdoorFloor(sim, x, z - 1);
function outdoorFloor(sim: SimContext, x: number, z: number): boolean {
  if (!sim.world.inside(x, z)) return false;
  const info = TILE_INFO[sim.world.ground.kind[z * MAP_W + x]];
  return info.outdoor && !info.solid;
}

/** The inmates' plan now (a ROUTINE index): the drill sends everyone to roll call, movie night and talent night (P30) to the canteen's seats. */
export function crowdPlan(sim: SimContext, routine: number): number {
  if (drillOn(sim)) return ROLL_CALL;
  if ((eventOn(sim, 'movie') || eventOn(sim, 'talent')) && ROUTINE[routine].id === 'eveningFreeTime') return DINNER;
  return routine;
}

const ROLL_CALL = ROUTINE.findIndex((r) => r.id === 'rollCall');
const DINNER = ROUTINE.findIndex((r) => r.id === 'dinner');

/** What happened today so far (bits in `state.eventFlags`, cleared at 08:00). */
export const TODAY = {
  /** Seen at something, caught or a block missed during the inspection: no commendation. */
  BLOT: 1,
  COMMENDED: 2,
  /** At roll call in time for the drill; missed it. */
  MUSTERED: 4,
  MISSED_DRILL: 8,
  /** A feast's tray eaten. */
  FEASTED: 16,
  /** Out cold, in solitary or in a lockdown during the drill's muster: no heat for missing it. */
  EXCUSED: 32,
  /** Delivery day (P18): the vehicle searched (a quick look; thoroughly), or waved through with nobody there to search. */
  SEARCHED: 64,
  SEARCHED_CLOSE: 128,
  WAVED: 256,
  /** Visiting day (P21): the player's visitor came today. */
  VISITED: 512,
  /** Sports day (P22): bouts won today (a count in these two bits: SPORTS_WIN each), and the prize handed out. */
  SPORTS_WIN: 1024,
  SPORTS_WINS: 3072,
  SPORTS_PRIZE: 4096,
  /** The pay phone (P34): a call home, the lawyer's appeal, a tip, Lou's diversion booked, today. */
  CALLED_HOME: 8192,
  APPEALED: 16384,
  TIPPED: 32768,
  DIVERTED: 65536,
} as const;

/** A food fight's guards: this many drawn into the canteen for as long as it lasts. */
const FIGHT_GUARDS = 2;

/** The middle of the canteen's floor (-1 without one). */
function canteenMiddle(sim: SimContext): number {
  const f = floorOf(sim.world, ['canteen']);
  return f.length ? f[f.length >> 1] : -1;
}

/**
 * A step of the day, on each minute's first step: 08:00 starts a new day (and what happened
 * yesterday is forgotten); the event starts and ends; the drill's muster is called; the
 * inspection's commendation is handed out; a storm cuts the power.
 */
export function theDay(sim: SimContext) {
  const s = sim.state;
  if (s.step % STEPS_PER_MINUTE !== 0) return;
  const m = dayMinute(s.step);
  const p = today(sim);
  if (m === 0) {
    s.eventFlags = 0;
    sim.events.push({ type: 'day', day: p.day });
  }
  const relaxed = sim.world.def.rules?.relaxed;
  if (p.event !== 'none' && !relaxed) {
    if (m === p.at) startEvent(sim, p);
    if (p.event === 'drill' && m === p.at + MUSTER_MINUTES && !(s.eventFlags & TODAY.MUSTERED)) {
      // Not at roll call in time: heat (excused if out cold, in solitary or in a lockdown at any point of the muster, or out already).
      if (!sim.away && !s.lockdown && !s.escaped && !(s.eventFlags & TODAY.EXCUSED)) {
        s.eventFlags |= TODAY.MISSED_DRILL;
        sim.events.push({ type: 'today', event: 'drill', phase: 'missed' });
        addHeat(sim, DRILL_HEAT);
      }
    }
    deliveryMinute(sim, p, m);
    if (m === p.until) endEvent(sim, p);
  }
  // A storm's power cuts, each generator still running (one already off: the lightning finds nothing to cut there).
  if (p.outages.includes(m) && !relaxed) {
    for (const gen of generatorsOf(sim.world).keys()) if (offFor(s, gen) === 0) cutPower(sim, gen, 'storm');
  }
}

function startEvent(sim: SimContext, p: DayPlan) {
  sim.events.push({ type: 'today', event: p.event, phase: 'start' });
  if (p.event === 'maintenance') {
    // The generator off for its service (a cut already under way just lasts the service out).
    for (const gen of generatorsOf(sim.world).keys()) cutPower(sim, gen, 'maintenance', POWER_OFF_STEPS);
  }
  if (p.event === 'foodFight') {
    const mid = canteenMiddle(sim);
    if (mid >= 0) summon(sim, mid, FIGHT_GUARDS, (p.until - p.at) * STEPS_PER_MINUTE);
  }
  if (p.event === 'drill') {
    if (sim.away || sim.state.lockdown) sim.state.eventFlags |= TODAY.EXCUSED;
    else if (musterHere(sim)) muster(sim);
  }
}

function endEvent(sim: SimContext, p: DayPlan) {
  sim.events.push({ type: 'today', event: p.event, phase: 'end' });
}

/** A clean inspection: a commendation (and the cash it brings), once the last step's blots are counted. */
function commend(sim: SimContext) {
  const s = sim.state;
  // (Out cold at 16:00 after a clean day: still commended. Solitary means caught: a blot already.)
  if (s.eventFlags & (TODAY.BLOT | TODAY.COMMENDED) || s.escaped) return;
  s.eventFlags |= TODAY.COMMENDED;
  s.cash += COMMENDATION;
  s.tally[3] += COMMENDATION;
  sim.events.push({ type: 'cash', n: COMMENDATION, why: 'commend' });
  sim.events.push({ type: 'today', event: 'inspection', phase: 'commend' });
}

/** The player stands at roll call (where the drill musters). */
const musterHere = (sim: SimContext) => sim.state.layer === LAYER.GROUND && sim.playerZone === 'rollCall';

function muster(sim: SimContext) {
  sim.state.eventFlags |= TODAY.MUSTERED;
  sim.events.push({ type: 'today', event: 'drill', phase: 'muster' });
}

/**
 * After the guards have looked (each step): the drill's muster taken as the player reaches
 * roll call in time, and the inspection's blots (anything seen, a capture, a block missed).
 */
export function dayWatch(sim: SimContext) {
  const s = sim.state;
  const p = today(sim);
  if (p.event === 'none' || sim.world.def.rules?.relaxed) return;
  const m = dayMinute(s.step);
  if (p.event === 'drill' && m >= p.at && m < p.at + MUSTER_MINUTES && !(s.eventFlags & (TODAY.MUSTERED | TODAY.MISSED_DRILL))) {
    if (sim.away || s.lockdown) s.eventFlags |= TODAY.EXCUSED;
    else if (musterHere(sim)) muster(sim);
  }
  if (p.event === 'inspection') {
    // The inspectors see from the step after 10:00 (a block missed before them settles at 10:00) to 16:00's own step (the block missed while they were in settles then).
    const into = s.step % DAY_STEPS;
    if (into > p.at * STEPS_PER_MINUTE && into <= p.until * STEPS_PER_MINUTE && !(s.eventFlags & TODAY.BLOT)) {
      // Seen at anything (whatever began before 10:00 and still goes on), in a lockdown, caught, a block missed.
      if (s.spotted !== 0 || s.lockdown || s.solitary > 0 || sim.events.some((e) => e.type === 'spotted' || e.type === 'caught' || e.type === 'missed' || e.type === 'lockdown')) s.eventFlags |= TODAY.BLOT;
    }
    if (into === p.until * STEPS_PER_MINUTE) commend(sim);
  }
}

/** The food fight is on, and the player in the thick of it (blows at inmates in the canteen cost no heat). */
export function inFoodFight(sim: SimContext): boolean {
  if (sim.state.layer !== LAYER.GROUND || !eventOn(sim, 'foodFight')) return false;
  const p = sim.state.player;
  return byCanteen(sim, Math.floor(p.x / UNIT), Math.floor(p.z / UNIT));
}

/** In the canteen or at its edge (a doorway, the corridor tile it opens onto): where a food fight is fought. */
export function byCanteen(sim: SimContext, x: number, z: number): boolean {
  const w = sim.world;
  return w.zoneAt(x, z) === 'canteen' || w.zoneAt(x + 1, z) === 'canteen' || w.zoneAt(x - 1, z) === 'canteen' || w.zoneAt(x, z + 1) === 'canteen' || w.zoneAt(x, z - 1) === 'canteen';
}

/** A feast's tray (dinner on a feast day). */
export const feastNow = (sim: SimContext) => eventOn(sim, 'feast') && ROUTINE[sim.state.routine].id === 'dinner';

/** A number in [0, 1) for presentation that wants the day's own randomness (the warden's lines), never the sim's. */
export const dayRoll = (salt: number, day: number, k: number) => roll(salt, SALT.MOOD, day, k + 1) / 4294967296;
