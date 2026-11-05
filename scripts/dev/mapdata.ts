// Dev tool: what the map viewer knows besides its pictures, worked out from the game's own data and
// rules (never run): each prison's sheet (ways out, rules, power, jobs, people, days, its story), the
// overlays drawn over its maps (exit, restricted zones, snipers, the routine, jobs, loot, rat traps)
// and where a grapnel or a glider leaves its roofs. English only, like the rest of the viewer.
import { CHAINS, KIND } from '../../src/content/oddjobs';
import { DAY_BOOKS, EVENT_TIMES } from '../../src/content/days';
import { DRONE_HOURS } from '../../src/content/smuggling';
import { SHIFT_FROM, SHIFT_TO } from '../../src/content/getaways';
import { HEARINGS } from '../../src/content/parole';
import { JOBS } from '../../src/content/jobs';
import { LOOT } from '../../src/content/loot';
import { placesOf } from '../../src/sim/ai/places';
import { OPEN_HOURS, ROUTINE, zonesOf, type RoutineId } from '../../src/content/routine';
import { RESTRICTED, ZONES, zoneIndex, type ZoneId } from '../../src/content/zones';
import { escapesOf } from '../../src/content/prisons';
import type { EscapeRoute, PrisonDef } from '../../src/content/prisons/types';
import { en } from '../../src/i18n/en';
import { jobRooms } from '../../src/sim/systems/economy';
import { launchSpots } from '../../src/sim/systems/getaway';
import { generatorsOf } from '../../src/sim/systems/power';
import { trapChance } from '../../src/sim/systems/rats';
import { sniperOn, towers } from '../../src/sim/systems/security';
import { visitExits } from '../../src/sim/systems/smuggling';
import { grapnelSwing } from '../../src/sim/systems/structure';
import { GRAPNEL_REACH, COUNT_HEAT, TRAY_HEAT, MEAL_ENERGY, SNIPER_RANGE, SOLITARY_HEAT, TAKEOVER_SHARE, UNBRACED_RUN, UNIT } from '../../src/sim/tuning';
import { containersOf } from '../../src/sim/world/containers';
import { centerX, centerZ } from '../../src/sim/world/grid';
import { TILE, TILE_INFO } from '../../src/sim/world/tiles';
import { LAYER, MAP_H, MAP_W, type World } from '../../src/sim/world/World';

const tr = (key: string, fallback: string) => ((en as Record<string, unknown>)[key] as string | undefined) ?? fallback;

/** A line of the sheet; `at`: the tile a click on it goes to. */
export interface SheetRow {
  label: string;
  text: string;
  at?: readonly [number, number];
}
export interface SheetSection {
  title: string;
  rows: SheetRow[];
}
/** A set of tiles the viewer can tint over a prison's pictures; `tips`: a tile's own words, instead of `tip`. */
export interface MapLayer {
  id: string;
  group: string;
  name: string;
  color: string;
  about: string;
  tip: string;
  tiles: number[];
  tips?: Record<number, string>;
}
/** A routine block, for the viewer's "where to be" overlay: the zones it wants, the doors that open for it. */
export interface RoutineBlock {
  id: string;
  label: string;
  note: string;
  zones: number[];
  doors: number[];
}

const clock = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
/** A day event's minutes are counted from 08:00. */
const dayClock = (at: number) => clock(480 + at);
const nameOfCell = (def: PrisonDef, cell: number) => (cell === 1 ? 'the player' : (def.names[cell - 2] ?? `cell ${cell}`));
const guardName = (def: PrisonDef, k: number) => def.guards[k]?.name ?? `guard ${k + 1}`;
const list = (a: readonly string[]) => a.join(', ');
const propAt = (w: World, kind: string): readonly [number, number] | undefined => {
  const p = w.props.find((q) => q.kind === kind);
  return p ? [p.x, p.z] : undefined;
};
const firstTile = (w: World, kind: number): readonly [number, number] | undefined => {
  const i = w.ground.kind.indexOf(kind);
  return i >= 0 ? [i % MAP_W, Math.floor(i / MAP_W)] : undefined;
};

/** The roof tiles the ladder reaches (the only roofs anyone stands on). */
export function reachableRoof(w: World): Set<number> {
  const roof = w.layers[LAYER.ROOF].kind;
  const seen = new Set<number>();
  const queue: number[] = [];
  for (let i = 0; i < roof.length; i++) if (roof[i] === TILE.LADDER) (seen.add(i), queue.push(i));
  for (let k = 0; k < queue.length; k++) {
    const t = queue[k];
    const x = t % MAP_W;
    for (const j of [x > 0 ? t - 1 : -1, x < MAP_W - 1 ? t + 1 : -1, t - MAP_W, t + MAP_W]) {
      if (j < 0 || j >= roof.length || seen.has(j) || (roof[j] !== TILE.ROOF && roof[j] !== TILE.LADDER)) continue;
      seen.add(j);
      queue.push(j);
    }
  }
  return seen;
}

/** Each roof-edge tile a grapnel can be thrown from, and where it lands (one per way it can face). */
export function grapnelSpots(w: World): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const t of reachableRoof(w))
    for (const facing of [1, 5, 9, 13]) {
      const g = grapnelSwing(w, { x: centerX(t), z: centerZ(t), facing, moving: false });
      if (!g) continue;
      const x = g.land % MAP_W;
      const z = Math.floor(g.land / MAP_W);
      const where = g.roof ? `onto the roof at (${x}, ${z})` : ZONES[w.ground.zone[g.land]] === 'outside' ? `out, onto the road at (${x}, ${z})` : `down between the fences at (${x}, ${z})`;
      out.set(t, [...(out.get(t) ?? []), `grapnel lands ${where}`]);
    }
  return out;
}

/** The roof tiles a glider can run off, where gliding is a way out (a tile each, the ways it can face). */
export function launchTiles(w: World): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (!w.def.escapes?.includes('glider')) return out;
  for (const [t, facing] of launchSpots(w)) out.set(t, [...(out.get(t) ?? []), facing]);
  return out;
}

/** Whether a tower's sniper covers a tile's middle, on the ground floor or up on the roof. */
export const inSights = (w: World, tile: number, layer: number) => sniperOn(w, { x: centerX(tile), z: centerZ(tile), facing: 1, moving: false }, layer) >= 0;

/** How far a tower's sniper covers, in tiles. */
export const SNIPER_TILES = SNIPER_RANGE / UNIT;

const SIDE: Record<number, string> = { 1: 'east', 5: 'south', 9: 'west', 13: 'north' };

/** How each way out works and where it ends: the rule in Sim.out and the system it comes from. */
function wayOut(route: EscapeRoute, def: PrisonDef, w: World): SheetRow {
  const label = route[0].toUpperCase() + route.slice(1);
  switch (route) {
    case 'fence':
      return { label, text: 'Cut through the outer fence (where it is electric, with the power off) and step onto the road: the exit line.' };
    case 'tunnel':
      return { label, text: `Dig out from a shaft, under the wall, never more than ${UNBRACED_RUN} tiles in a row without a brace, and dig up on a tile past the exit line.` };
    case 'roof':
      return { label, text: `From a roof's edge, with a sheet rope in the pockets, a grapnel over a fence up to ${GRAPNEL_REACH} tiles away, landing past the exit line (Roof view).` };
    case 'takeover':
      return { label, text: `${Math.round(TAKEOVER_SHARE * 100)}% of the guards out cold at once: every door and gate opens while they stay down. Then walk over the exit line.` };
    case 'gate':
      return { label, text: 'Keys through the compound, out of a door onto the road.' };
    case 'raft':
      return { label, text: 'Build a raft and launch it from a pier tile, facing open water.', at: firstTile(w, TILE.PIER) };
    case 'helicopter':
      return { label, text: `Board it at the helipad during Lights Out (it sets down at 23:00), the helipad guards (${list(def.guards.flatMap((g, k) => (g.helipad ? [guardName(def, k)] : [])))}) out cold, wearing a guard's uniform.`, at: propAt(w, 'helipad') };
    case 'stowaway': {
      const d = def.delivery;
      return { label, text: `Climb in at the delivery's tail and stay in until it drives off after the 14:30 search${d ? ` (thorough ${d.thorough}% of days)` : ''}.`, at: d ? [d.tail.x, d.tail.z] : undefined };
    }
    case 'bluff': {
      const c = def.checkpoint;
      return { label, text: `A guard's uniform and a fake ID at the ID window, at the evening shift change (${clock(SHIFT_FROM)}–${clock(SHIFT_TO)}): its gates then open for the player${c?.bridge ? ' and the drawbridge comes down' : ''}.`, at: c ? [c.window[0].x, c.window[0].z] : undefined };
    }
    case 'glider': {
      const first = launchSpots(w)[0];
      return { label, text: 'Run off a roof with 2 tiles of run-up and no storm, and land past the exit line. Not on a mine, in the sea or between the fences (Roof view).', at: first ? [first[0] % MAP_W, Math.floor(first[0] / MAP_W)] : undefined };
    }
    case 'paperwork': {
      const r = def.comms?.release;
      return { label, text: `A forged release form in the release desk's tray. Report there at 10:00 when called, and its doors open for the player${r?.bridge ? ' and the drawbridge comes down' : ''}.`, at: r ? [r.at[0].x, r.at[0].z] : undefined };
    }
    case 'parole': {
      const h = HEARINGS[def.id];
      return { label, text: 'A clean record for a week, then win the hearing at 10:00. The release doors open as for paperwork.', at: h ? [h.seat.x, h.seat.z] : undefined };
    }
    default: {
      const never: never = route;
      throw new Error(`The map viewer has no words for the way out ${String(never)}`);
    }
  }
}

const POWER_NAME: Record<string, string> = { fence: 'electric fence', detectors: 'detector arches', cameras: 'cameras', searchlights: 'searchlights', lights: 'lights' };

/** Where each day event happens (its rules: calendar.ts, games.ts, smuggling.ts, power.ts). */
const EVENT_PLACE: Record<string, string> = {
  inspection: 'Everywhere: inspectors walk the prison.',
  drill: 'Everyone musters in the roll-call zone for 20 minutes.',
  feast: 'The canteen, at dinner.',
  maintenance: 'Every generator is off for its service.',
  movie: 'The canteen: inmates seated, and its noise covers yours.',
  foodFight: 'The canteen, during a meal.',
  delivery: 'The delivery bay (People view).',
  visiting: 'The visiting room, its ways out scanned as detector arches (Overlays).',
  sports: 'Games in free time and the exercise hour.',
  talent: 'The stage in the canteen.',
  quiz: 'The quiz seats in the library.',
};
const EVENT_NAME: Record<string, string> = {
  inspection: 'Inspection', drill: 'Fire drill', feast: 'Feast', maintenance: 'Generator service', movie: 'Movie night', foodFight: 'Food fight', delivery: 'Delivery', visiting: 'Visiting day', sports: 'Sports day', talent: 'Talent night', quiz: 'Quiz night',
};

function eventTime(id: keyof typeof EVENT_TIMES): string {
  const t = EVENT_TIMES[id];
  if (typeof t.at === 'number') return `${dayClock(t.at)}–${dayClock(t.at + t.length)}`;
  return `${t.length} min, starting ${t.at.map(([a, b]) => `${dayClock(a)}–${dayClock(b)}`).join(' or ')}`;
}

/** What an inmate does, by cell. */
function rolesOf(def: PrisonDef, cell: number): string[] {
  const roles: string[] = [];
  if (def.merchants.includes(cell)) roles.push('merchant');
  if (def.smuggling?.fixer === cell) roles.push('the fixer (burner phones)');
  if (def.leisure?.oldTimer === cell) roles.push('the old-timer (checkers)');
  const crew = def.crew[cell - 2];
  if (crew) roles.push(crew);
  return roles;
}

/** Everything about a prison that isn't a place on its pictures. */
export function sheetOf(def: PrisonDef, w: World): SheetSection[] {
  const out: SheetSection[] = [];
  const routes = escapesOf(def);
  out.push({ title: `Ways out (${routes.length})`, rows: routes.map((r) => wayOut(r, def, w)) });

  const rules: SheetRow[] = [];
  const r = def.rules ?? {};
  if (towers(w).length) rules.push({ label: 'Snipers', text: `${towers(w).length} towers. They fire at ${SOLITARY_HEAT}% heat or more, ${r.snipers === 'always' ? 'day and night' : 'except during Lights Out (searchlights then)'}, and not in fog or a storm.` });
  if (r.cold) rules.push({ label: 'Cold', text: 'A minute outdoors without a warm outfit doubles what energy costs.' });
  if (r.hostile) rules.push({ label: 'Hostile', text: 'A few inmates hold a grudge from day 1, settled in free time and the yard as well as at meals and in the showers.' });
  if (r.relaxed) rules.push({ label: 'Tutorial', text: 'Missed blocks cost nothing; no shakedowns, bed checks or generator duty.' });
  if (r.contrabandEvery) rules.push({ label: 'Contraband', text: `Heat for contraband in sight rises one step in ${r.contrabandEvery}.` });
  if (r.sightRange) rules.push({ label: 'Sight', text: `Guards see ${r.sightRange} tiles.` });
  if (def.under) rules.push({ label: 'Underground', text: 'Granite boulders no tunnel digs through (Vents view).' });
  if (rules.length) out.push({ title: 'Rules', rows: rules });

  const gens = generatorsOf(w);
  if (gens.length) {
    out.push({
      title: 'Power',
      rows: gens.map((prop, k) => {
        const p = w.props[prop];
        return { label: `Generator ${k + 1}`, text: def.grid ? list((def.grid[k] ?? []).map((u) => POWER_NAME[u])) : 'Everything: electric fence, cameras, detector arches, searchlights, lights.', at: [p.x, p.z] as const };
      }),
    });
  }

  if (def.jobs.length) {
    const rooms = jobRooms(w);
    out.push({
      title: 'Jobs',
      rows: def.jobs.map(({ id, cell }, k) => {
        const job = JOBS[id];
        const room = rooms[k];
        const first = w.props[room.take >= 0 ? room.take : (room.machines[0] ?? room.put)];
        const holder = cell === 0 ? 'Open on day 1' : cell === 1 ? 'The player\'s on day 1' : `${nameOfCell(def, cell)}'s on day 1`;
        return { label: tr(`job.${id}`, id), text: `${holder}. Intellect ${job.int}, $${job.wage} a day, quota ${job.quota}.`, at: first ? ([first.x, first.z] as const) : undefined };
      }),
    });
    // (2.30: a rule of the rooms rather than a place.)
    out[out.length - 1].rows.push({ label: 'Work rooms', text: 'Off limits to others in the Work Period (12:00–15:00), the garden apart: a guard tells you to go, and staying costs heat up to 30%. A janitor or mailman goes anywhere. Holders work their stations; a janitor mops the corridors, a mailman walks to people.' });
  }

  const people: SheetRow[] = [];
  def.names.forEach((name, k) => {
    const cell = k + 2;
    const c = def.cells[k + 1];
    people.push({ label: `${name}, cell ${cell}`, text: rolesOf(def, cell).join(', '), at: c ? [c[0], c[1]] : undefined });
  });
  // 2.31: who sits at the library's table, and the day's reading.
  const lib = def.leisure?.librarian;
  if (lib) people.push({ label: 'The library', text: `Readers at the shelves and chairs in free time; the librarian (cell ${lib.cell}) at the end of a table. Six sets of reading a day, four subjects.`, at: [lib.x, lib.z] });
  if (people.length) out.push({ title: 'Inmates', rows: people });

  const book = DAY_BOOKS[def.id];
  const smuggle: SheetRow[] = [];
  const dl = def.delivery;
  if (dl) smuggle.push({ label: 'Delivery', text: `${dl.vehicle === 'redCross' ? 'Red Cross truck' : dl.vehicle === 'produce' ? 'Produce truck' : dl.vehicle === 'helicopter' ? 'Supply helicopter' : 'Supply truck'}, 12:30–14:31, supervised by ${guardName(def, dl.supervisor)}. A thorough search ${dl.thorough}% of days${def.guards[dl.supervisor]?.trait === 'strict' ? ' (always, with this strict supervisor)' : ''}.`, at: [dl.tail.x, dl.tail.z] });
  const sm = def.smuggling;
  if (sm) {
    smuggle.push({ label: 'Drone', text: `Drops orders in the drone zone, ${dayClock((sm.droneHours ?? DRONE_HOURS)[0])}–${dayClock((sm.droneHours ?? DRONE_HOURS)[1])}, drifting downwind of the middle.`, at: [sm.drop[0], sm.drop[1]] });
    smuggle.push({ label: 'Visitors', text: sm.parcel ? 'No visits: what a visitor would bring comes in a Red Cross parcel on delivery day.' : 'Visitors sit in the visiting room on visiting day.', at: sm.visits ? [sm.visits[0], sm.visits[1]] : undefined });
  }
  if (smuggle.length) out.push({ title: 'Getting things in', rows: smuggle });

  if (book) {
    const seen = [...new Set(book.deck)].filter((e) => e !== 'none') as Array<keyof typeof EVENT_TIMES>;
    out.push({
      title: 'Day events (the week\'s cards)',
      rows: seen.map((e) => ({ label: EVENT_NAME[e], text: `${eventTime(e)}. ${EVENT_PLACE[e]}` })),
    });
  }

  const chain = CHAINS[def.id];
  if (chain) {
    const kindName = (k: number) => {
      const id = Object.entries(KIND).find(([, v]) => v === k)?.[0].toLowerCase() ?? '';
      return tr(`oddjob.kind.${id}`, id);
    };
    out.push({
      title: `Odd jobs story: ${nameOfCell(def, chain.who)} asks`,
      rows: chain.steps.map((s, k) => ({ label: `Step ${k + 1}`, text: `${kindName(s.kind)}${s.target > 0 ? `, with ${nameOfCell(def, s.target)}` : ''}. Pays $${s.pay}.` })),
    });
  }

  if (book) {
    out.push({
      title: 'Holidays',
      rows: [
        { label: 'Easter', text: 'The egg hunt: 6 eggs in inmates\' desks and 6 on the yard, drawn by the run.' },
        { label: 'Summer', text: 'The water fight on the sports ground; ice lollies from the canteen counter.' },
        { label: 'Halloween', text: 'Costumes from the canteen counter, pumpkins from the kitchen freezer (carved in the kitchen).' },
        { label: 'Christmas', text: 'Gifts from the canteen counter. New Year\'s fireworks cover noise everywhere.' },
      ],
    });
  }
  return out;
}

/** A cell's inmate and what they do, for its line under the cursor. */
export function cellLine(def: PrisonDef, cell: number): string {
  if (cell === 1) return 'the player';
  const roles = rolesOf(def, cell);
  return `${def.names[cell - 2] ?? '?'}${roles.length ? ` (${roles.join(', ')})` : ''}`;
}

const propTiles = (p: { x: number; z: number; w: number; d: number }) => {
  const out: number[] = [];
  for (let z = p.z; z < p.z + p.d; z++) for (let x = p.x; x < p.x + p.w; x++) out.push(z * MAP_W + x);
  return out;
};

/** A loot table in words: the likeliest things first. */
function lootWords(table: string): string {
  const t = LOOT[table];
  if (!t) return table;
  const named = (id: string) => tr(`item.${id}`, id);
  const top = [...t.items].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => named(id));
  const more = t.items.length > 5 ? ', and more' : '';
  return `${[...(t.fixed ?? []).map(named), ...top].join(', ')}${more}`;
}

/** What the viewer can tint over a prison's maps. */
export function layersOf(w: World): MapLayer[] {
  const out: MapLayer[] = [];
  const add = (l: MapLayer) => {
    if (l.tiles.length) out.push(l);
  };
  const N = MAP_W * MAP_H;
  const every = (test: (i: number) => boolean) => Array.from({ length: N }, (_, i) => i).filter(test);
  const zone = w.ground.zone;
  const kind = w.ground.kind;

  add({ id: 'exit', group: 'Danger', name: 'Exit line', color: '#16a34a', about: 'Past it, on the ground floor, the escape counts.', tip: 'Past the exit line: on the ground floor here, the escape counts.', tiles: every((i) => ZONES[zone[i]] === 'outside') });
  const restricted = new Set<number>(RESTRICTED.map((z) => zoneIndex(z)));
  add({ id: 'restricted', group: 'Danger', name: 'Restricted zones', color: '#dc2626', about: 'Seen here without a guard\'s uniform: instant 100% heat.', tip: 'Restricted: seen here without a guard\'s uniform or a release clearance, instant 100% heat.', tiles: every((i) => restricted.has(zone[i])) });
  if (towers(w).length) {
    add({ id: 'snipers', group: 'Danger', name: 'Sniper range', color: '#ea580c', about: `Open ground within ${SNIPER_TILES} tiles of a tower. They fire at ${SOLITARY_HEAT}% heat. The road is safe, and they need no line of sight.`, tip: `In a sniper's sights: they fire at ${SOLITARY_HEAT}% heat or more.`, tiles: every((i) => !TILE_INFO[kind[i]].solid && kind[i] !== TILE.WATER && inSights(w, i, LAYER.GROUND)) });
  }
  const spots = launchTiles(w);
  if (spots.size) {
    const tips: Record<number, string> = {};
    for (const [t, f] of spots) tips[t] = `Glider launch (from the roof): faces ${f.map((q) => SIDE[q] ?? q).join(', ')}.`;
    add({ id: 'launch', group: 'Danger', name: 'Glider launches', color: '#0284c7', about: 'Roof tiles a glider can run off, given 2 tiles of run-up and no storm.', tip: 'Glider launch.', tiles: [...spots.keys()], tips });
  }
  const arches = [...visitExits(w)];
  add({ id: 'arches', group: 'Danger', name: 'Visiting arches', color: '#7c3aed', about: 'The visiting room\'s ways out: scanned as detector arches during visiting hours.', tip: 'A detector arch during visiting hours (10:00–12:00, visiting day).', tiles: arches });

  const jobTips: Record<number, string> = {};
  const say = (i: number, s: string) => {
    jobTips[i] = jobTips[i] ? `${jobTips[i]}; ${s}` : s;
  };
  for (const room of jobRooms(w)) {
    const name = tr(`job.${room.def.id}`, room.def.id);
    const mark = (prop: number, what: string) => {
      if (prop < 0) return;
      const p = w.props[prop];
      for (const i of propTiles(p)) say(i, `${name}: ${what} (${p.kind})`);
    };
    mark(room.take, room.def.raw ? `take ${tr(`item.${room.def.raw}`, room.def.raw)}` : 'take');
    for (const m of room.machines) mark(m, 'work station');
    mark(room.put, room.def.done ? `hand in ${tr(`item.${room.def.done}`, room.def.done)}` : 'hand in');
  }
  add({ id: 'jobs', group: 'Work & loot', name: 'Job stations', color: '#2563eb', about: 'Where each job takes, works and hands in.', tip: 'Job station.', tiles: Object.keys(jobTips).map(Number), tips: jobTips });

  const lootTips: Record<number, string> = {};
  for (const c of containersOf(w)) {
    const words = c.mine ? 'the player\'s own: nobody restocks it' : `restocked at 08:00: ${lootWords(c.table)}`;
    const hidden = c.hidden ? `, ${c.hidden} hidden compartment${c.hidden > 1 ? 's' : ''}` : '';
    for (const i of propTiles(c.prop)) lootTips[i] = `${c.prop.kind} (${c.slots} slots${hidden}): ${words}`;
  }
  add({ id: 'loot', group: 'Work & loot', name: 'Containers', color: '#ca8a04', about: 'Furniture that holds items, and what it holds.', tip: 'A container.', tiles: Object.keys(lootTips).map(Number), tips: lootTips });

  // Meals (2.25): the counter's places, and the tables. (With no counter, the tables serve.)
  const places = placesOf(w);
  const fetched = places.counters.length > 0;
  const mealTips: Record<number, string> = {};
  for (const q of places.counters) mealTips[q.tile] = 'At the serving counter: take a tray here at breakfast and dinner, and bring it back here empty.';
  for (const q of places.seats) mealTips[q.tile] = fetched ? `At a table: sit here with a tray to eat it, 6 seconds, +${MEAL_ENERGY} energy, once a meal.` : `At a table: sit here at breakfast or dinner to eat, +${MEAL_ENERGY} energy, once a meal.`;
  add({ id: 'meals', group: 'Work & loot', name: 'Meals', color: '#0d9488', about: fetched ? 'Where a tray is taken and given back, and the seats it is eaten at.' : 'The seats meals are eaten at: this prison has no serving counter.', tip: 'A place for meals.', tiles: Object.keys(mealTips).map(Number), tips: mealTips });

  // The showers (2.26): the heads, what they give. (Nothing to overlay where there are none.)
  const showerTips: Record<number, string> = {};
  for (const q of places.showers) showerTips[q.tile] = 'A shower: at 16:00–17:00 the action button turns it on. +2 energy a second while it runs, heat under 25% falls faster, a dog\'s trail washes off.';
  if (places.showers.length) add({ id: 'showers', group: 'Work & loot', name: 'Showers', color: '#3f9bd6', about: 'The heads: one at a time, inmates taking turns through the block.', tip: 'A shower head.', tiles: Object.keys(showerTips).map(Number), tips: showerTips });

  const under = trapChance(w, LAYER.UNDER, 0);
  const trap = every((i) => !TILE_INFO[kind[i]].solid && trapChance(w, LAYER.GROUND, i) > 0);
  const chance = trap.length ? trapChance(w, LAYER.GROUND, trap[0]) : 0;
  add({ id: 'rats', group: 'Work & loot', name: 'Rat traps', color: '#78716c', about: `A trap left here at night catches a rat ${chance}% of the time (in a tunnel, ${under}%; anywhere else, never).`, tip: `A rat trap left here catches a rat at 04:00, ${chance}% of the time.`, tiles: trap });
  return out;
}

/** The day, block by block: where each wants the player and which doors open for it. */
export function routineOf(def: PrisonDef, w: World): RoutineBlock[] {
  const has = (z: ZoneId) => def.zones.some(([q]) => q === z) || z === 'playerCell' || z === 'inmateCell';
  const rooms = jobRooms(w);
  const doorsOf = (zones: ReadonlySet<number>) => Array.from(w.doorRoom.keys()).filter((i) => w.doorRoom[i] && zones.has(w.doorRoom[i]));
  return ROUTINE.map((r, k) => {
    const open = new Set<number>();
    for (const [z, blocks] of Object.entries(OPEN_HOURS)) if (blocks!.includes(r.id as RoutineId) && has(z as ZoneId)) open.add(zoneIndex(z as ZoneId));
    if (r.id === 'work') for (const room of rooms) open.add(room.zone);
    const wants = r.id === 'work' ? rooms.map((room) => room.zone) : zonesOf(k, has).filter(has).map((z) => zoneIndex(z));
    // (The tutorial's routine costs nothing: routine.ts skips it.)
    const miss = def.rules?.relaxed ? 'missing it costs nothing here' : r.miss === 'lockdown' ? 'missing it starts a lockdown' : r.miss === 'heat' ? 'missing it raises heat' : '';
    const note = r.id === 'work' ? (rooms.length ? 'Only with a job: its own room.' : 'No jobs here: anywhere legal.') : !wants.length ? 'Nowhere expected: anywhere legal.' : `${r.stay ? `${r.stay} minutes there to be counted` : 'Be here'}${miss ? `; ${miss}` : ''}.`;
    // (Where a meal is had, 2.25: a prison with no counter serves at its tables.)
    const tray = (r.id === 'breakfast' || r.id === 'dinner') && placesOf(w).counters.length ? ` Eat: a tray from the serving counter, to a table and back (+${MEAL_ENERGY} energy, once a meal; eaten and not brought back, +${TRAY_HEAT}% heat).` : '';
    const count = (r.id === 'rollCall' || r.id === 'eveningRollCall') && !def.rules?.relaxed ? ` Counted only on the player's own square (spot 1, orange). The guard taking it walks the line, the player first: the action button answers "Here!" (unanswered, +${COUNT_HEAT}% heat). In the yard but not counted by the end: heat, no lockdown.` : '';
    const wash = r.id === 'showers' && placesOf(w).showers.length ? ' Wash: the action button turns a shower on (+2 energy a second, minor heat falling faster); optional, being in the room is what counts.' : '';
    return { id: r.id, label: `${clock(r.start)} ${tr(`routine.${r.id}`, r.id)}`, note: note + tray + wash + count, zones: wants, doors: doorsOf(open) };
  });
}

/** Tiles of a rectangle, corners included, for a line under the cursor. */
export function rectTiles(r: readonly [number, number, number, number]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let z = r[1]; z <= r[3]; z++) for (let x = r[0]; x <= r[2]; x++) out.push([x, z]);
  return out;
}
