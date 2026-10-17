import { itemDef, itemNumber } from '../content/items';
import { handlersOf, pillsDesk } from '../sim/systems/k9';
import { containersOf } from '../sim/world/containers';
import { ROUTINE } from '../content/routine';
import type { ZoneId } from '../content/zones';
import type { Sim } from '../sim/Sim';
import { FAVOR_STATE, HOLDER, jobRooms } from '../sim/systems/economy';
import { itemOf } from '../sim/systems/items';
import { generatorsOf } from '../sim/systems/power';
import { traitOf } from '../sim/systems/guards';
import { shakedownCells } from '../sim/systems/justice';
import { dayMinute, planOf, today } from '../sim/systems/calendar';
import { prisonDay } from '../sim/systems/clock';
import { searchMinute, thorough } from '../sim/systems/delivery';
import type { GuardDef } from '../content/prisons/types';
import { grateAt, underSea } from '../sim/systems/structure';
import { BED_CHECK_MINUTES, CAMERA_BLIND_STEPS, KO_STEPS, NAP_FROM, OPINION_LOW, POTATO_STEPS, POWER_OFF_STEPS, SOLITARY_STEPS, STEPS_PER_MINUTE, STEPS_PER_SECOND, TAKEOVER_SHARE, TOILET_LOADS, UNBRACED_RUN, DOG_DAY_FROM, DOG_DAY_TO, DOG_NIGHT_FROM, DOG_NIGHT_TO, DOG_FIRST_DAY } from '../sim/tuning';

const PILLS = itemNumber('sleeping_pills');
const DOG_FACTS: ReadonlySet<string> = new Set(['dogShift', 'dogNight', 'dogTreat', 'dogWash', 'dogPepper']);
import { TILE } from '../sim/world/tiles';
import { MAP_H, MAP_W } from '../sim/world/World';
import { CHAT_ITEMS, PUBLIC_PLACES } from '../i18n/barks/grammar';

/**
 * Gossip (P13): what inmates tell a friend, always true ("warnings proven never wrong").
 * Every fact is worked out here from the game's own rules and state at the moment it's told:
 * the rules' numbers come from the same constants the simulation uses, the rest from what
 * the state holds now (a merchant's stock, an open job, a grudge). The phrasings in the
 * banks type no number of their own; scripts/gossiptest.ts checks each kind against the
 * running game.
 */
export const GOSSIP = ['bedChecks', 'dummy', 'fenceOff', 'brace', 'takeover', 'keyColor', 'grate', 'toilets', 'camera', 'pouch', 'shell', 'craters', 'flood', 'heli', 'solitary', 'koTime', 'stock', 'job', 'favor', 'grudge', 'heat', 'takeoverAll', 'steady', 'lazy', 'strict', 'corrupt', 'shakedown', 'shakedownYou', 'nextInspection', 'nextDrill', 'nextFoodFight', 'stormCut', 'nextDelivery', 'searchClose', 'searchQuick', 'dogShift', 'dogNight', 'dogTreat', 'dogWash', 'dogPepper', 'pills'] as const;
export type GossipKind = (typeof GOSSIP)[number];

/** Facts that hold for as long as the game is played (the rest are about now). */
export const LASTING: ReadonlySet<GossipKind> = new Set(['bedChecks', 'dummy', 'fenceOff', 'brace', 'takeover', 'takeoverAll', 'keyColor', 'grate', 'toilets', 'camera', 'pouch', 'shell', 'craters', 'flood', 'heli', 'solitary', 'koTime', 'steady', 'lazy', 'strict', 'corrupt', 'dogShift', 'dogNight', 'dogTreat', 'dogWash', 'dogPepper']);

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
  const cached = lasting.get(def.id);
  if (cached) return cached;
  const out: Fact[] = [];
  const add = (f: Omit<Fact, 'key'> & { key?: string }) => out.push({ ...f, key: f.key ?? f.kind });
  const relaxed = !!def.rules?.relaxed;
  const duty = (d: 'bedCheck' | 'shakedown') => def.guards.some((g) => g.duties?.includes(d));
  if (!relaxed && duty('bedCheck')) {
    add({ kind: 'bedChecks', t1: BED_CHECK_MINUTES[0], t2: BED_CHECK_MINUTES[1] });
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
  }
  lasting.set(def.id, out);
  return out;
}

/** Everything true worth telling right now (the speaker's own business left out). */
export function facts(sim: Sim, speaker = -1): Fact[] {
  const s = sim.state;
  // (The dogs' facts once they've started work, P19: on day 1 they're still in their kennels.)
  const dogsOut = prisonDay(s.step) >= DOG_FIRST_DAY && !sim.noDogs;
  const out = lastingFacts(sim).filter((f) => dogsOut || !DOG_FACTS.has(f.kind));
  // A merchant's stock (items people know how to say), if the merchant would sell to the player.
  sim.prison.merchants.forEach((cell, k) => {
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
  // The next 08:00 shakedown's cells (P15: drawn ahead with roll(), so known): whose, and the player's.
  const clock = sim.clock;
  const day = clock.minuteOfDay >= ROUTINE[0].start ? clock.day + 1 : clock.day;
  for (const cell of shakedownCells(sim.world, s.salt, day, planOf(sim, day).event === 'inspection')) {
    if (cell === 1) out.push({ kind: 'shakedownYou', key: `shakedown:${day}:1`, n: day });
    else {
      const who = s.inmates.findIndex((m) => m.cell === cell);
      if (who >= 0 && who !== speaker) out.push({ kind: 'shakedown', key: `shakedown:${day}:${cell}`, inmate: who, n: day });
    }
  }
  // The day (P17): tomorrow's inspection, drill or food fight (the plan is drawn ahead: true), and tonight's storm's first power cut still to come.
  const plan = today(sim);
  const next = planOf(sim, plan.day + 1);
  const ahead = next.event === 'inspection' ? 'nextInspection' : next.event === 'drill' ? 'nextDrill' : next.event === 'foodFight' ? 'nextFoodFight' : next.event === 'delivery' ? 'nextDelivery' : null;
  if (ahead && !sim.prison.rules?.relaxed) out.push({ kind: ahead, key: `${ahead}:${next.day}`, n: next.day });
  const m = dayMinute(s.step);
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
