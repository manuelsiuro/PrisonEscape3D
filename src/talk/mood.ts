import { ROUTINE } from '../content/routine';
import type { BankId } from '../i18n/barks/en';
import type { Sim } from '../sim/Sim';
import { maxHealth } from '../sim/systems/combat';
import { GUARD, awake } from '../sim/systems/guards';
import { lookingAway } from '../sim/systems/ways';
import { DOING } from '../sim/systems/inmates';
import { tileOfBody, type Body } from '../sim/systems/movement';
import { OPINION_LOW, UNIT } from '../sim/tuning';
import { MAP_W } from '../sim/world/World';
import { TILE_INFO } from '../sim/world/tiles';
import type { Style } from './types';
import { dayMinute, drillOn, eventOn, feastNow, sunBites, today, weatherNow } from '../sim/systems/calendar';
import type { ZoneId } from '../content/zones';
import { HOLIDAY } from '../content/holidays';
import { holidayDays, holidayOf, soaked } from '../sim/systems/holiday';

/**
 * Moods (P13): what someone feels right now, read from the game (never stored): the bank a
 * line comes from, how strongly (0–1: the director lets the strongest speak first), and how
 * it's said. Inmates panic at blasts and sirens, glare when they hold a grudge, moan about
 * the food on the way to the canteen, grumble when bumped; guards shout when they chase,
 * wonder aloud when they investigate, yawn on night duty, gloat after a catch.
 */
export interface Mood {
  bank: BankId;
  intensity: number;
  style: Style;
  /** Other banks that fit the moment too (a line now and then from one of them: variety). */
  alt?: readonly BankId[];
}

/** Something that just happened somewhere (seconds on the presentation clock, tiles). */
export interface Incident {
  kind: 'fight' | 'ko' | 'blast' | 'shot' | 'alarm';
  x: number;
  z: number;
  at: number;
}

/** What the director remembers of the last moments (presentation only). */
export interface Recent {
  now: number;
  incidents: readonly Incident[];
  /** Cells searched today (their inmates are nervous). */
  searched: ReadonlySet<number>;
  /** When the player was last caught (seconds; -1e9 never). */
  caughtAt: number;
  /** Who came round, and when (Cast id → seconds). */
  cameTo: ReadonlyMap<number, number>;
  /** Who the player bumped into, and when. */
  bumped: ReadonlyMap<number, number>;
  /** The prison was the inmates' a moment ago, the lights went out… */
  powerOutAt: number;
}

const tiles = (a: Body, b: Body) => Math.hypot(a.x - b.x, a.z - b.z) / UNIT;

/** Whether someone stands in a zone (ground floor). */
function inZone(sim: Sim, b: Body, zone: ZoneId): boolean {
  const t = tileOfBody(b);
  return sim.world.zoneAt(t.x, t.z) === zone;
}

/** The generator's service is today, and hasn't been yet (or is on). */
function maintenanceDay(sim: Sim): boolean {
  const p = today(sim);
  return p.event === 'maintenance' && dayMinute(sim.state.step) < p.until;
}

function near(r: Recent, b: Body, kinds: ReadonlyArray<Incident['kind']>, range: number, within: number): boolean {
  const x = b.x / UNIT;
  const z = b.z / UNIT;
  return r.incidents.some((i) => kinds.includes(i.kind) && r.now - i.at <= within && Math.hypot(i.x - x, i.z - z) <= range);
}

/** Whether someone stands outdoors (in the snow, the sun, the sea air). */
export function outdoors(sim: Sim, b: Body): boolean {
  const t = tileOfBody(b);
  return !!TILE_INFO[sim.world.ground.kind[t.z * MAP_W + t.x]]?.outdoor;
}

const mood = (bank: BankId, intensity: number, style: Style = 'say', alt?: readonly BankId[]): Mood => ({ bank, intensity, style, alt });

/** The weather's bank for someone outdoors (the day's fog, rain, storm or heatwave, P17; else the snow, the sun, the sea), if any. A storm is heard indoors too. */
function weatherBank(sim: Sim, b: Body, guard: boolean): BankId | null {
  const wx = weatherNow(sim);
  const out = outdoors(sim, b);
  if (wx === 'storm' && sim.prison.theme !== 'alpine') return guard ? 'gu.wx.storm' : 'in.wx.storm';
  if (!out) return null;
  if (wx === 'fog' || wx === 'rain' || (wx === 'heatwave' && sunBites(sim))) return (guard ? `gu.wx.${wx}` : `in.wx.${wx}`) as BankId;
  const theme = sim.prison.theme;
  if (theme === 'alpine') return guard ? 'gu.cold' : 'in.cold';
  if (theme === 'desert') return guard ? 'gu.hot' : 'in.hot';
  if (theme === 'island') return guard ? 'gu.sea' : 'in.sea';
  return null;
}

const some = (...banks: Array<BankId | null | false>): BankId[] => banks.filter((b): b is BankId => !!b);

/** An inmate's mood (Cast id = its index), or null when it can't speak (out cold). */
export function inmateMood(sim: Sim, id: number, r: Recent): Mood | null {
  const s = sim.state;
  const m = s.inmates[id];
  if (!m || m.ko > 0) return null;
  const b = m.body;
  const player = s.player;
  const d = tiles(b, player);
  if (m.doing === DOING.SLEEP) return mood('sl.in', 0.25, 'whisper');
  if (near(r, b, ['blast', 'shot'], 9, 5) || (s.lockdown && near(r, b, ['alarm'], 99, 6))) return mood('in.panicked', 1, 'shout');
  if (m.angry > 0) return mood('in.hostile', 1, 'shout');
  if (s.takeover || near(r, b, ['fight', 'ko'], 8, 6) || r.now - r.powerOutAt < 20) return mood('in.excited', 0.8);
  if (s.lockdown) return mood('in.lockdown', 0.6);
  if (m.opinion <= OPINION_LOW && d <= 3) return mood('in.hostile', 0.8);
  if (m.hp < maxHealth(m.str) / 2 || r.now - (r.cameTo.get(id) ?? -1e9) < 20) return mood('in.hurt', 0.7);
  if (r.now - (r.bumped.get(id) ?? -1e9) < 30) return mood('in.grumpy', 0.7);
  // The day's event (P17): a food fight in the canteen, the drill out at roll call.
  if (eventOn(sim, 'foodFight') && inZone(sim, b, 'canteen')) return mood('in.day.foodFight', 0.95, 'shout');
  if (drillOn(sim)) return mood('in.day.drill', 0.65, 'say', ['in.lineup']);
  if (s.followers.includes(id)) return mood('in.loyal', 0.6, 'say', ['in.idle', 'in.friendly']);
  const block = ROUTINE[s.routine].id;
  const minute = sim.clock.minuteOfDay;
  const weather = weatherBank(sim, b, false);
  const friend = m.opinion >= 60 && d <= 4 && 'in.friendly';
  const evening = block === 'eveningFreeTime' || block === 'dinner';
  switch (m.doing) {
    case DOING.EAT:
      // Movie night in the canteen's seats, or a feast's tray (P17).
      if (eventOn(sim, 'movie')) return mood('in.day.movie', 0.5, 'say', some('in.idle', friend));
      if (feastNow(sim)) return mood('in.day.feast', 0.65, 'say', some('in.eating', friend));
      return mood('in.eating', 0.6, 'say', some('in.idle', friend, evening && 'in.homesick'));
    case DOING.EXERCISE:
    case DOING.LIFT:
    case DOING.RUN:
      return mood('in.exercising', 0.5, 'say', some('in.idle', weather, friend));
    case DOING.SHOWER:
      return mood('in.showering', 0.5, 'say', some('in.idle', 'in.bored'));
    case DOING.READ:
    case DOING.SIT_READ:
      return mood('in.reading', 0.35, 'say', some('in.idle', 'in.bored'));
    // The odd jobs board (P40): digging under his bed, the player keeping watch.
    case DOING.DIG:
      return mood('in.dig', 0.6, 'whisper', ['in.nervous']);
    // The pay phone (P34): on it, and waiting for it.
    case DOING.PHONE:
      return mood('in.phone', 0.8, 'say', ['in.homesick']);
    case DOING.QUEUE:
      return mood('in.queue', 0.55, 'say', some('in.idle', 'in.bored', friend));
    case DOING.LINE_UP:
      return mood('in.lineup', 0.5, 'say', some('in.idle', 'in.bored', block === 'rollCall' ? 'in.hungry' : 'in.sleepy', weather, friend));
    case DOING.WORK: {
      const job = s.jobs.indexOf(id);
      const jobId = job >= 0 ? sim.prison.jobs[job]?.id : undefined;
      return mood(jobId ? (`in.work.${jobId}` as BankId) : 'in.work', 0.5, 'say', some(!!jobId && 'in.work', 'in.bored'));
    }
  }
  if (sim.merchantOf(id) >= 0 && sim.shopsOpen && d <= 5) return mood('in.dealing', 0.6, 'say', ['in.idle']);
  if (r.searched.has(m.cell) || (s.heat >= 50 && d <= 3)) return mood('in.nervous', 0.5);
  if (m.opinion <= 40 && d <= 3) return mood('in.grumpy', 0.5);
  // What the day holds, talked over (P17): the inspectors, the generator's service.
  const today = eventOn(sim, 'inspection') ? 'in.day.inspection' : maintenanceDay(sim) ? 'in.day.maintenance' : null;
  if (today && (id + sim.clock.hour) % 2 === 0) return mood(today, 0.45, 'say', some('in.idle', weather, friend));
  // The holiday (P42): its own talk now and then; a ghost story after Lights Out on costume night.
  const hol = holidayBank(sim, id);
  if (block === 'lightsOut' && hol && holidayDays(sim).includes('costumeNight')) return mood('in.hol.ghost', 0.5, 'whisper', ['in.sleepy']);
  if (hol && (id + sim.clock.hour) % 3 === 1) return mood(hol, 0.45, 'say', some('in.idle', friend));
  if (friend) return mood('in.friendly', 0.6, 'say', some('in.idle', weather, today));
  if (block === 'lightsOut' || block === 'eveningRollCall') return mood('in.sleepy', 0.5, 'say', ['in.idle']);
  if (block === 'rollCall' || (minute >= 16 * 60 + 30 && minute < 17 * 60) || (minute >= 8 * 60 + 30 && minute < 9 * 60)) return mood('in.hungry', 0.5, 'say', some('in.idle', weather));
  if (weather) return mood(weather, weather === 'in.sea' ? 0.35 : 0.5, 'say', ['in.idle', 'in.bored']);
  if (block === 'eveningFreeTime' && (id + sim.clock.hour) % 3 === 0) return mood('in.homesick', 0.3, 'say', ['in.idle']);
  if (block === 'freeTime' || block === 'eveningFreeTime' || block === 'work') return mood('in.bored', 0.4, 'say', some('in.idle', block === 'eveningFreeTime' && 'in.homesick'));
  return mood('in.idle', 0.3, 'say', ['in.bored']);
}

/**
 * The holiday's talk for an inmate (P42): by the holiday, and at Christmas by the prison (snowballs
 * in the Alps, jokes about snow in the desert); null without one. Its talk of the day (the eggs, the
 * water fight at three, costume night, dinner at five, the fireworks) only on the holiday's own
 * days; the snow and the sand, out there all run long, any day of a Christmas run.
 */
function holidayBank(sim: Sim, id: number): BankId | null {
  const h = holidayOf(sim);
  if (!h) return null;
  const theme = sim.prison.theme;
  const seasonal = h === HOLIDAY.CHRISTMAS && (theme === 'alpine' || theme === 'desert') && (id + sim.clock.hour) % 2 === 0 ? (theme === 'alpine' ? 'in.hol.snow' : 'in.hol.desert') : null;
  if (!holidayDays(sim).length) return seasonal;
  if (h === HOLIDAY.EASTER) return 'in.hol.easter';
  if (h === HOLIDAY.SUMMER) return 'in.hol.summer';
  if (h === HOLIDAY.HALLOWEEN) return 'in.hol.halloween';
  if (holidayDays(sim).includes('newYearsEve')) return 'in.hol.newYear';
  return seasonal ?? 'in.hol.christmas';
}

/** A guard's mood (Cast id), or null when out cold. */
export function guardMood(sim: Sim, id: number, r: Recent): Mood | null {
  const s = sim.state;
  const g = s.guards[id - s.inmates.length];
  if (!g || g.ko > 0) return null;
  // Dozing on the night round (P15): its own mumbles, a little louder than a guard asleep in bed.
  if (g.doing === DOING.DOZE) return mood('sl.doze', 0.35, 'whisper');
  if (!awake(g)) return mood('sl.gu', 0.25, 'whisper');
  if (s.takeover) return mood('gu.scared', 1, 'shout');
  if (g.mode === GUARD.CHASE) return mood('gu.hostile', 1, 'shout');
  // Drawn into a food fight (P17): not a mystery to look into, a mess to stop.
  if (eventOn(sim, 'foodFight') && inZone(sim, g.body, 'canteen')) return mood('gu.day.foodFight', 0.9, 'shout');
  if (g.mode === GUARD.INVESTIGATE) return mood('gu.suspicious', 0.8);
  if (g.mode === GUARD.BED_CHECK) return mood('gu.bedCheck', 0.7);
  if (g.mode === GUARD.SHAKEDOWN) return mood('gu.stern', 0.7);
  if (s.lockdown) return mood('gu.lockdown', 0.7, 'shout');
  if (r.now - (r.cameTo.get(id) ?? -1e9) < 20) return mood('gu.groggy', 0.8);
  const d = tiles(g.body, s.player);
  if (r.now - r.caughtAt < 120 && d <= 6) return mood('gu.smug', 0.7);
  // Bribed to look the other way (P15), with the player close by: it makes a show of seeing nothing.
  if (lookingAway(g, s.step) && d <= 6) return mood('gu.bribed', 0.7);
  if (s.heat >= 50 && d <= 5) return mood('gu.wary', 0.6);
  // Soaked in the water fight (P42).
  if (s.holiday && soaked(sim, g)) return mood('gu.hol.soaked', 0.8, 'shout');
  const block = ROUTINE[s.routine].id;
  // Night duty: its own lines only (the day's grumbles don't fit after Lights Out; a storm's do).
  if (block === 'lightsOut') return mood('gu.drowsy', 0.5, 'say', some(weatherNow(sim) === 'storm' && sim.prison.theme !== 'alpine' && 'gu.wx.storm'));
  const weather = weatherBank(sim, g.body, true);
  // The day's event (P17): the drill, the inspectors, the film.
  if (drillOn(sim)) return mood('gu.day.drill', 0.7, 'shout');
  if (eventOn(sim, 'inspection')) return mood('gu.day.inspection', 0.45, 'say', some(g.body.moving ? 'gu.idle' : 'gu.bored', weather));
  if (eventOn(sim, 'movie') && inZone(sim, g.body, 'canteen')) return mood('gu.day.movie', 0.45, 'say', ['gu.bored']);
  const usual: BankId = g.body.moving ? 'gu.idle' : 'gu.bored';
  const other: BankId = usual === 'gu.idle' ? 'gu.bored' : 'gu.idle';
  // (P42: a word about the holiday now and then.)
  if (holidayOf(sim) && (id + sim.clock.hour) % 3 === 0) return mood('gu.hol.festive', 0.4, 'say', [usual]);
  // The moment's own lines first: the morning count, the canteen, the yard.
  const t = tileOfBody(g.body);
  const zone = sim.world.zoneAt(t.x, t.z);
  if (block === 'rollCall') return mood('gu.morning', 0.4, 'say', some(usual, weather));
  if ((block === 'breakfast' || block === 'dinner') && zone === 'canteen') return mood('gu.meal', 0.4, 'say', some(usual, other));
  if (block === 'exercise' && (zone === 'yard' || zone === 'gym')) return mood('gu.yard', 0.4, 'say', some(usual, weather));
  return mood(usual, g.body.moving ? 0.3 : 0.4, 'say', some(other, weather));
}
