import { LINE_DAY } from '../content/phone';
import { commsOf, phoneUsed, wantsCall } from '../sim/systems/phone';
import { SHIFT_FROM, SHIFT_TO } from '../content/getaways';
import { twist } from '../sim/systems/twists';
import { checkpointOf, glideOutToday } from '../sim/systems/getaway';
import { itemDef, itemNumber } from '../content/items';
import { handlersOf, pillsDesk, dogsFrom } from '../sim/systems/k9';
import { RAT_ROOMS } from '../sim/systems/rats';
import { floorOf } from '../sim/ai/places';
import { containersOf } from '../sim/world/containers';
import { ROUTINE } from '../content/routine';
import type { ZoneId } from '../content/zones';
import type { Sim } from '../sim/Sim';
import { FAVOR_STATE, HOLDER, jobRooms } from '../sim/systems/economy';
import { itemOf } from '../sim/systems/items';
import { generatorsOf } from '../sim/systems/power';
import { traitOf } from '../sim/systems/guards';
import { RECORDS_HEAT, RECORDS_MINUTE } from '../content/paperwork';
import { shakedownCells } from '../sim/systems/justice';
import { dayMinute, planOf, today } from '../sim/systems/calendar';
import { prisonDay } from '../sim/systems/clock';
import { searchMinute, thorough } from '../sim/systems/delivery';
import { fixerOf } from '../sim/systems/smuggling';
import { elderOf } from '../sim/systems/checkers';
import { raceNight, rivals } from '../sim/systems/races';
import { RACE_MINUTE } from '../content/long';
import { DICE_HEAT } from '../content/games';
import { SPECIALITIES } from '../content/crew';
import { specialityOf } from '../sim/systems/crew';
import type { GuardDef } from '../content/prisons/types';
import { grateAt, underSea } from '../sim/systems/structure';
import { BED_CHECK_MINUTES, CAMERA_BLIND_STEPS, KO_STEPS, NAP_FROM, OPINION_LOW, POTATO_STEPS, POWER_OFF_STEPS, SOLITARY_STEPS, STEPS_PER_MINUTE, STEPS_PER_SECOND, TAKEOVER_SHARE, TOILET_LOADS, UNBRACED_RUN, DOG_DAY_FROM, DOG_DAY_TO, DOG_NIGHT_FROM, DOG_NIGHT_TO } from '../sim/tuning';

const PILLS = itemNumber('sleeping_pills');
const DOG_FACTS: ReadonlySet<string> = new Set(['dogShift', 'dogNight', 'dogTreat', 'dogWash', 'dogPepper', 'ratDogs']);
import { TILE } from '../sim/world/tiles';
import { MAP_H, MAP_W } from '../sim/world/World';
import { CHAT_ITEMS, PUBLIC_PLACES } from '../i18n/barks/grammar';
import { boardNow } from '../sim/systems/oddjobs';

/**
 * Gossip (P13): what inmates tell a friend, always true ("warnings proven never wrong").
 * Every fact is worked out here from the game's own rules and state at the moment it's told:
 * the rules' numbers come from the same constants the simulation uses, the rest from what
 * the state holds now (a merchant's stock, an open job, a grudge). The phrasings in the
 * banks type no number of their own; scripts/gossiptest.ts checks each kind against the
 * running game.
 */
export const GOSSIP = ['bedChecks', 'dummy', 'fenceOff', 'brace', 'takeover', 'keyColor', 'grate', 'toilets', 'camera', 'pouch', 'shell', 'craters', 'flood', 'heli', 'solitary', 'koTime', 'stock', 'job', 'favor', 'grudge', 'heat', 'takeoverAll', 'steady', 'lazy', 'strict', 'corrupt', 'shakedown', 'shakedownYou', 'nextInspection', 'nextDrill', 'nextFoodFight', 'stormCut', 'nextDelivery', 'searchClose', 'searchQuick', 'dogShift', 'dogNight', 'dogTreat', 'dogWash', 'dogPepper', 'pills', 'ratTrap', 'ratTunnel', 'ratKey', 'ratDogs', 'fixer', 'droneDrop', 'visitArches', 'nextVisiting', 'champ', 'gambling', 'lockpick', 'nextSports', 'lookout', 'digger', 'muscle', 'smuggler', 'shiftChange', 'fakeId', 'glideDay', 'oldTimer', 'pruno', 'gardenHole', 'raceNight', 'ratFed', 'ratHungry', 'nextTalent', 'nextQuiz', 'phoneCall', 'guardNick', 'guardHome', 'guardTeam', 'releaseForms', 'recordsCheck', 'boardJob'] as const;
export type GossipKind = (typeof GOSSIP)[number];

/** Facts that hold for as long as the game is played (the rest are about now). */
export const LASTING: ReadonlySet<GossipKind> = new Set(['bedChecks', 'dummy', 'fenceOff', 'brace', 'takeover', 'takeoverAll', 'keyColor', 'grate', 'toilets', 'camera', 'pouch', 'shell', 'craters', 'flood', 'heli', 'solitary', 'koTime', 'steady', 'lazy', 'strict', 'corrupt', 'dogShift', 'dogNight', 'dogTreat', 'dogWash', 'dogPepper', 'ratTrap', 'ratTunnel', 'ratKey', 'ratDogs', 'droneDrop', 'visitArches', 'gambling', 'lockpick', 'lookout', 'digger', 'muscle', 'smuggler', 'shiftChange', 'fakeId', 'pruno', 'gardenHole', 'raceNight', 'guardNick', 'guardHome', 'guardTeam', 'releaseForms', 'recordsCheck']);

/** One true thing to tell: its kind, what it's about, its numbers (minutes of the day for times). */
export interface Fact {
  kind: GossipKind;
  /** Tells facts apart (the same fact is told once a day by each inmate, kept once in the notebook). */
  key: string;
  inmate?: number;
  guard?: number;
  /** A guard dog (P19: its place in the state's dogs). */
  dog?: number;
  item?: string;
  place?: ZoneId;
  color?: string;
  n?: number;
  m?: number;
  t1?: number;
  t2?: number;
}

const lasting = new Map<string, Fact[]>();

/** Whether a prison has a tile of a kind on its ground floor (as built). */
function hasTile(sim: Sim, kind: number): boolean {
  const base = sim.world.ground.base;
  for (let i = 0; i < base.length; i++) if (base[i] === kind) return true;
  return false;
}

/** The facts that never change in a prison (worked out once). */
function lastingFacts(sim: Sim): Fact[] {
  const def = sim.prison;
  // (Keyed by the Daily's twists too, P26: a Night Owl's checks aren't the usual two.)
  const id = `${def.id}|${sim.state.mods.join(',')}`;
  const cached = lasting.get(id);
  if (cached) return cached;
  const out: Fact[] = [];
  const add = (f: Omit<Fact, 'key'> & { key?: string }) => out.push({ ...f, key: f.key ?? f.kind });
  const relaxed = !!def.rules?.relaxed;
  const duty = (d: 'bedCheck' | 'shakedown') => def.guards.some((g) => g.duties?.includes(d));
  if (!relaxed && duty('bedCheck')) {
    if (!twist(sim.state, 'nightOwl')) add({ kind: 'bedChecks', t1: BED_CHECK_MINUTES[0], t2: BED_CHECK_MINUTES[1] });
    add({ kind: 'dummy' });
  }
  // One generator powering an electric fence (Irongate's two split it: no simple rule to tell).
  if (!def.grid && generatorsOf(sim.world).length === 1 && hasTile(sim, TILE.ELECTRIC)) add({ kind: 'fenceOff', n: POWER_OFF_STEPS / STEPS_PER_SECOND });
  add({ kind: 'brace', n: UNBRACED_RUN });
  const routes = def.escapes ?? ['fence', 'tunnel', 'roof', 'takeover'];
  if (routes.includes('takeover') && def.guards.length > 1) {
    // "5 of the 5" reads oddly: when it takes every guard, it's said so.
    const n = Math.ceil(def.guards.length * TAKEOVER_SHARE);
    add(n === def.guards.length ? { kind: 'takeoverAll', n } : { kind: 'takeover', n, m: def.guards.length });
  }
  def.guards.forEach((g, k) => g.name && add({ kind: 'keyColor', key: `keyColor:${k}`, guard: k, color: g.key }));
  // Each guard's ways (P15); a lazy one's, with where and from when it naps.
  def.guards.forEach((g, k) => {
    if (!g.name) return;
    const trait = traitOf(g);
    // (P26: a Straight-Laced Daily, none takes a bribe or naps: nothing to tell of those.)
    if ((trait === 'lazy' || trait === 'corrupt') && twist(sim.state, 'straightLaced')) return;
    if (trait !== 'lazy') return add({ kind: trait, key: `trait:${k}`, guard: k });
    const at = napStop(g);
    const place = at && sim.world.zoneAt(at.x, at.z);
    if (place && place !== 'none') add({ kind: 'lazy', key: `trait:${k}`, guard: k, place, t1: NAP_FROM });
  });
  // Rooms with a ceiling grate into the vents.
  const w = sim.world;
  const grated = new Set<ZoneId>();
  for (let i = 0; i < MAP_W * MAP_H; i++) if (grateAt(w, i)) grated.add(w.zoneAt(i % MAP_W, Math.floor(i / MAP_W)));
  for (const z of grated) if (z !== 'none' && z !== 'outside' && z !== 'perimeter' && z !== 'inmateCell') add({ kind: 'grate', key: `grate:${z}`, place: z });
  add({ kind: 'toilets', n: TOILET_LOADS });
  if (def.cameras?.length) add({ kind: 'camera', n: CAMERA_BLIND_STEPS / STEPS_PER_SECOND });
  if (hasTile(sim, TILE.DETECTOR)) add({ kind: 'pouch' });
  if (hasTile(sim, TILE.REINFORCED)) add({ kind: 'shell' });
  if (hasTile(sim, TILE.MINE)) add({ kind: 'craters', t1: ROUTINE[0].start });
  let sea = false;
  for (let i = 0; i < MAP_W * MAP_H && !sea; i++) sea = underSea(w, i);
  if (sea) add({ kind: 'flood' });
  if (routes.includes('helicopter')) add({ kind: 'heli', t1: ROUTINE.find((r) => r.id === 'lightsOut')!.start, t2: ROUTINE[0].start });
  if (!relaxed) add({ kind: 'solitary', n: SOLITARY_STEPS / STEPS_PER_MINUTE / 60, m: POTATO_STEPS / STEPS_PER_MINUTE });
  add({ kind: 'koTime', n: KO_STEPS / STEPS_PER_SECOND });
  // The guard dogs (P19): whose each is and its hours, and what works on them.
  const handlers = handlersOf(w);
  handlers.forEach((h, k) => {
    const dog = def.guards[h].dog!;
    add({ kind: 'dogShift', key: `dogShift:${k}`, guard: h, dog: k, t1: DOG_DAY_FROM, t2: DOG_DAY_TO });
    if (dog.night) add({ kind: 'dogNight', key: `dogNight:${k}`, dog: k, t1: DOG_NIGHT_FROM, t2: DOG_NIGHT_TO });
  });
  if (handlers.length) {
    add({ kind: 'dogTreat' });
    add({ kind: 'dogWash' });
    add({ kind: 'dogPepper' });
    add({ kind: 'ratDogs' });
  }
  // The pet rat (P20): where to trap one, and what a guard does without his key.
  if (floorOf(w, RAT_ROOMS).length) add({ kind: 'ratTrap' });
  add({ kind: 'ratTunnel' });
  if (!relaxed) add({ kind: 'ratKey' });
  // Smuggling (P21): where the drone drops, and the arches at the visiting room's doors on visiting day.
  const sm = relaxed ? undefined : def.smuggling;
  if (sm) {
    add({ kind: 'droneDrop', place: w.zoneAt((sm.drop[0] + sm.drop[2]) >> 1, (sm.drop[1] + sm.drop[3]) >> 1) });
    if (sm.visits) add({ kind: 'visitArches', place: w.zoneAt((sm.visits[0] + sm.visits[2]) >> 1, (sm.visits[1] + sm.visits[3]) >> 1) });
  }
  // Side games (P22): what a game of dice under a guard's nose costs, and what a lockpick won't open.
  if (!relaxed) add({ kind: 'gambling', n: DICE_HEAT });
  add({ kind: 'lockpick' });
  // Bluff & glider (P24): when the gate changes shifts, and what a guard's papers are made of.
  if (checkpointOf(sim)) {
    add({ kind: 'shiftChange', t1: SHIFT_FROM, t2: SHIFT_TO });
    add({ kind: 'fakeId' });
  }
  // Long games (P28): where pruno's safe from a search (not from a dog), the hole under a plant, the race nights.
  if (!relaxed) add({ kind: 'pruno' });
  if (def.leisure?.garden) add({ kind: 'gardenHole' });
  if (def.leisure?.race) add({ kind: 'raceNight', t1: RACE_MINUTE });
  // A guard's life outside the job (P36): its nickname, home town and team (a password is one of them, or its dog's name).
  def.guards.forEach((g, k) => {
    if (!g.name || !g.about) return;
    for (const kind of ['guardNick', 'guardHome', 'guardTeam'] as const) add({ kind, key: `${kind}:${k}`, guard: k });
  });
  // The paperwork escape (P36): who carries the blank release forms, and when the records are checked (with the heat that gets a name a second look).
  const strict = def.guards.findIndex((g) => g.duties?.includes('shakedown'));
  if (def.comms && !relaxed && strict >= 0 && def.guards[strict].name) {
    add({ kind: 'releaseForms', guard: strict });
    add({ kind: 'recordsCheck', t1: (RECORDS_MINUTE + ROUTINE[0].start) % 1440, n: RECORDS_HEAT });
  }
  lasting.set(id, out);
  return out;
}

/** Everything true worth telling right now (the speaker's own business left out). */
export function facts(sim: Sim, speaker = -1): Fact[] {
  const s = sim.state;
  // (The dogs' facts once they've started work, P19: on day 1 they're still in their kennels.)
  const dogsOut = prisonDay(s.step) >= dogsFrom(s) && !sim.noDogs;
  const out = lastingFacts(sim).filter((f) => dogsOut || !DOG_FACTS.has(f.kind));
  // A merchant's stock (items people know how to say), if the merchant would sell to the player.
  // (P26: none on a Closed Shop Daily.)
  if (!twist(s, 'closedShop')) sim.prison.merchants.forEach((cell, k) => {
    const who = s.inmates.findIndex((m) => m.cell === cell);
    if (who < 0 || who === speaker || s.inmates[who].opinion <= OPINION_LOW) return;
    for (const v of s.shops[k] ?? []) {
      const id = v ? itemDef(itemOf(v)).id : '';
      if (id && (CHAT_ITEMS.includes(id) || STOCK_WORDS.has(id))) out.push({ kind: 'stock', key: `stock:${who}:${id}`, inmate: who, item: id });
    }
  });
  // Open jobs, by their room.
  jobRooms(sim.world).forEach((room, j) => {
    if (s.jobs[j] === HOLDER.NOBODY && PUBLIC_PLACES.includes(room.def.zone)) out.push({ kind: 'job', key: `job:${room.def.zone}`, place: room.def.zone });
  });
  for (const f of s.favors) if (f.state === FAVOR_STATE.OFFERED && f.by !== speaker) out.push({ kind: 'favor', key: `favor:${f.by}`, inmate: f.by });
  s.inmates.forEach((m, k) => {
    if (k !== speaker && m.opinion <= OPINION_LOW) out.push({ kind: 'grudge', key: `grudge:${k}`, inmate: k });
  });
  if (s.heat >= 50) out.push({ kind: 'heat', key: 'heat' });
  // Smuggling (P21): who sells burner phones (not the fixer about himself).
  const fixer = fixerOf(sim);
  if (fixer >= 0 && fixer !== speaker) out.push({ kind: 'fixer', key: 'fixer', inmate: fixer });
  // Side games (P22): the strongest arm in the prison (not the speaker bragging).
  let champ = -1;
  s.inmates.forEach((m, k) => {
    if (champ < 0 || m.str > s.inmates[champ].str) champ = k;
  });
  if (champ >= 0 && champ !== speaker && !sim.prison.rules?.relaxed) out.push({ kind: 'champ', key: `champ:${champ}`, inmate: champ });
  // Card sharks (P27): who the old-timer is (not him about himself).
  const elder = elderOf(sim);
  if (elder >= 0 && elder !== speaker) out.push({ kind: 'oldTimer', key: `oldTimer:${elder}`, inmate: elder });
  // The crew (P23): someone good at each line of work (the first of them, not the speaker himself).
  for (const spec of SPECIALITIES) {
    const who = s.inmates.findIndex((m, k) => k !== speaker && specialityOf(sim.world, k, m.cell) === spec);
    if (who >= 0 && !sim.prison.rules?.relaxed) out.push({ kind: spec, key: `${spec}:${who}`, inmate: who });
  }
  // The next 08:00 shakedown's cells (P15: drawn ahead with roll(), so known): whose, and the player's.
  const clock = sim.clock;
  const day = clock.minuteOfDay >= ROUTINE[0].start ? clock.day + 1 : clock.day;
  for (const cell of shakedownCells(sim.world, s.salt, day, planOf(sim, day).event === 'inspection', twist(s, 'crackdown'))) {
    if (cell === 1) out.push({ kind: 'shakedownYou', key: `shakedown:${day}:1`, n: day });
    else {
      const who = s.inmates.findIndex((m) => m.cell === cell);
      if (who >= 0 && who !== speaker) out.push({ kind: 'shakedown', key: `shakedown:${day}:${cell}`, inmate: who, n: day });
    }
  }
  // The day (P17): tomorrow's inspection, drill or food fight (the plan is drawn ahead: true), and tonight's storm's first power cut still to come.
  const plan = today(sim);
  const next = planOf(sim, plan.day + 1);
  const ahead = next.event === 'inspection' ? 'nextInspection' : next.event === 'drill' ? 'nextDrill' : next.event === 'foodFight' ? 'nextFoodFight' : next.event === 'delivery' ? 'nextDelivery' : next.event === 'visiting' ? 'nextVisiting' : next.event === 'sports' ? 'nextSports' : next.event === 'talent' ? 'nextTalent' : next.event === 'quiz' ? 'nextQuiz' : null;
  if (ahead && !sim.prison.rules?.relaxed) out.push({ kind: ahead, key: `${ahead}:${next.day}`, n: next.day });
  const m = dayMinute(s.step);
  // The pay phone (P34): who rings home in a free time still to come today, and when (drawn ahead with roll(): true; once the player has used it, inmates queue).
  if (commsOf(sim) && plan.day >= LINE_DAY && phoneUsed(s) && !sim.noQueue)
    s.inmates.forEach((_, k) => {
      if (k === speaker) return;
      for (const b of [0, 1]) {
        const at = wantsCall(s.salt, plan.day, b, k);
        if (at > m) out.push({ kind: 'phoneCall', key: `phoneCall:${plan.day}:${b}:${k}`, inmate: k, t1: (at + ROUTINE[0].start) % 1440 });
      }
    });
  const cut = plan.outages.find((o) => o > m);
  if (cut !== undefined && !sim.prison.rules?.relaxed) out.push({ kind: 'stormCut', key: `stormCut:${plan.day}:${cut}`, t1: (cut + ROUTINE[0].start) % 1440 });
  // The dogs (P19): whose desk the day's sleeping pills are in, while they're still there.
  const desk = pillsDesk(sim);
  if (desk >= 0 && s.items.containers[desk].some((v) => itemOf(v) === PILLS)) {
    const prop = containersOf(sim.world)[desk].prop;
    const who = s.inmates.findIndex((m) => m.cell === sim.world.cellOf[prop.z * MAP_W + prop.x]);
    if (who >= 0 && who !== speaker) out.push({ kind: 'pills', key: `pills:${plan.day}:${who}`, inmate: who });
  }
  // Delivery day (P18): before the search, how thorough today's will be (drawn for the day: true; a catch changes only the days after).
  const dv = sim.prison.delivery;
  if (dv && plan.event === 'delivery' && m < searchMinute(plan) && !sim.prison.rules?.relaxed) {
    const kind = thorough(sim, plan.day) ? 'searchClose' : 'searchQuick';
    out.push({ kind, key: `search:${plan.day}`, guard: dv.supervisor });
  }
  // A race night (P28), before the off: whose rat ate today and whose didn't (true: the card is drawn for the day). Not the speaker's own.
  if (sim.prison.leisure?.race && raceNight(plan.day) && m < RACE_MINUTE - ROUTINE[0].start)
    for (const e of rivals(s, plan.day)) if (e.owner !== speaker) out.push({ kind: e.fed ? 'ratFed' : 'ratHungry', key: `ratFed:${plan.day}:${e.owner}`, inmate: e.owner });
  // The odd jobs board (P40): who pinned a job up today that's still there (the deals are the day's own: true). Not the speaker's own.
  for (const d of boardNow(sim as never).pins) if (d && d.giver !== speaker) out.push({ kind: 'boardJob', key: `boardJob:${plan.day}:${d.giver}`, inmate: d.giver });
  // A glider's day (P24): today's wind would carry one off the roof clear out to the road.
  if ((sim.prison.escapes ?? []).includes('glider') && !sim.prison.rules?.relaxed && glideOutToday(sim)) out.push({ kind: 'glideDay', key: `glideDay:${plan.day}` });
  return out;
}

/** The merchants' wares the banks can name (grammar.ts has their words). */
const STOCK_WORDS: ReadonlySet<string> = new Set(['lighter', 'glue', 'duct_tape', 'metal_file', 'timber', 'sheet_metal', 'crowbar', 'wire', 'razor_blade', 'foil', 'rope', 'trowel', 'nail_file', 'screwdriver']);

/** The fields each kind of fact needs (numbers, a guard, an inmate, an item, a place). */
const NEEDS: Record<GossipKind, ReadonlyArray<keyof Fact>> = {
  bedChecks: ['t1', 't2'],
  dummy: [],
  fenceOff: ['n'],
  brace: ['n'],
  takeover: ['n', 'm'],
  takeoverAll: ['n'],
  keyColor: ['guard', 'color'],
  grate: ['place'],
  toilets: ['n'],
  camera: ['n'],
  pouch: [],
  shell: [],
  craters: ['t1'],
  flood: [],
  heli: ['t1', 't2'],
  solitary: ['n', 'm'],
  koTime: ['n'],
  stock: ['inmate', 'item'],
  job: ['place'],
  favor: ['inmate'],
  grudge: ['inmate'],
  heat: [],
  steady: ['guard'],
  lazy: ['guard', 'place', 't1'],
  strict: ['guard'],
  corrupt: ['guard'],
  shakedown: ['inmate', 'n'],
  shakedownYou: ['n'],
  nextInspection: ['n'],
  nextDrill: ['n'],
  nextFoodFight: ['n'],
  stormCut: ['t1'],
  nextDelivery: ['n'],
  searchClose: ['guard'],
  searchQuick: ['guard'],
  dogShift: ['guard', 'dog', 't1', 't2'],
  dogNight: ['dog', 't1', 't2'],
  dogTreat: [],
  dogWash: [],
  dogPepper: [],
  pills: ['inmate'],
  ratTrap: [],
  ratTunnel: [],
  ratKey: [],
  ratDogs: [],
  fixer: ['inmate'],
  droneDrop: ['place'],
  visitArches: ['place'],
  nextVisiting: ['n'],
  champ: ['inmate'],
  oldTimer: ['inmate'],
  gambling: ['n'],
  lockpick: [],
  nextSports: ['n'],
  lookout: ['inmate'],
  digger: ['inmate'],
  muscle: ['inmate'],
  smuggler: ['inmate'],
  shiftChange: ['t1', 't2'],
  fakeId: [],
  glideDay: [],
  pruno: [],
  gardenHole: [],
  raceNight: ['t1'],
  ratFed: ['inmate'],
  ratHungry: ['inmate'],
  nextTalent: ['n'],
  nextQuiz: ['n'],
  phoneCall: ['inmate', 't1'],
  guardNick: ['guard'],
  guardHome: ['guard'],
  guardTeam: ['guard'],
  releaseForms: ['guard'],
  recordsCheck: ['t1', 'n'],
  boardJob: ['inmate'],
};

/** Where a lazy guard naps (its night round's nap stop), if it has one. */
export const napStop = (g: GuardDef) => g.night?.find((p) => p.nap) ?? null;

/** Whether a fact (from a save) is whole and about people of this prison: a kind this version knows, every field it needs. */
export function factOk(f: Partial<Fact> | undefined, sim: Sim): f is Fact {
  if (!f || typeof f.key !== 'string' || !(GOSSIP as readonly string[]).includes(f.kind as string)) return false;
  const kind = f.kind as GossipKind;
  if (!NEEDS[kind].every((k) => f[k] !== undefined && f[k] !== null)) return false;
  const s = sim.state;
  if (f.inmate !== undefined && !(Number.isInteger(f.inmate) && f.inmate >= 0 && f.inmate < s.inmates.length)) return false;
  if (f.guard !== undefined && !(Number.isInteger(f.guard) && f.guard >= 0 && f.guard < s.guards.length)) return false;
  if (f.dog !== undefined && !(Number.isInteger(f.dog) && f.dog >= 0 && f.dog < s.dogs.length)) return false;
  return true;
}
