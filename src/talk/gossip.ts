import { itemDef } from '../content/items';
import { ROUTINE } from '../content/routine';
import type { ZoneId } from '../content/zones';
import type { Sim } from '../sim/Sim';
import { FAVOR_STATE, HOLDER, jobRooms } from '../sim/systems/economy';
import { itemOf } from '../sim/systems/items';
import { generatorsOf } from '../sim/systems/power';
import { grateAt, underSea } from '../sim/systems/structure';
import { BED_CHECK_MINUTES, CAMERA_BLIND_STEPS, KO_STEPS, OPINION_LOW, POTATO_STEPS, POWER_OFF_STEPS, SOLITARY_STEPS, STEPS_PER_MINUTE, STEPS_PER_SECOND, TAKEOVER_SHARE, TOILET_LOADS, UNBRACED_RUN } from '../sim/tuning';
import { TILE } from '../sim/world/tiles';
import { LAYER, MAP_H, MAP_W } from '../sim/world/World';
import { CHAT_ITEMS, PUBLIC_PLACES } from '../i18n/barks/grammar';

/**
 * Gossip (P13): what inmates tell a friend, always true ("warnings proven never wrong").
 * Every fact is worked out here from the game's own rules and state at the moment it's told:
 * the rules' numbers come from the same constants the simulation uses, the rest from what
 * the state holds now (a merchant's stock, an open job, a grudge). The phrasings in the
 * banks type no number of their own; scripts/gossiptest.ts checks each kind against the
 * running game.
 */
export const GOSSIP = ['bedChecks', 'dummy', 'fenceOff', 'brace', 'takeover', 'keyColor', 'grate', 'toilets', 'camera', 'pouch', 'shell', 'craters', 'flood', 'heli', 'solitary', 'koTime', 'stock', 'job', 'favor', 'grudge', 'heat'] as const;
export type GossipKind = (typeof GOSSIP)[number];

/** Facts that hold for as long as the game is played (the rest are about now). */
export const LASTING: ReadonlySet<GossipKind> = new Set(['bedChecks', 'dummy', 'fenceOff', 'brace', 'takeover', 'keyColor', 'grate', 'toilets', 'camera', 'pouch', 'shell', 'craters', 'flood', 'heli', 'solitary', 'koTime']);

/** One true thing to tell: its kind, what it's about, its numbers (minutes of the day for times). */
export interface Fact {
  kind: GossipKind;
  /** Tells facts apart (the same fact is told once a day by each inmate, kept once in the notebook). */
  key: string;
  inmate?: number;
  guard?: number;
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
  if (routes.includes('takeover') && def.guards.length > 1) add({ kind: 'takeover', n: Math.ceil(def.guards.length * TAKEOVER_SHARE), m: def.guards.length });
  def.guards.forEach((g, k) => g.name && add({ kind: 'keyColor', key: `keyColor:${k}`, guard: k, color: g.key }));
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
  lasting.set(def.id, out);
  return out;
}

/** Everything true worth telling right now (the speaker's own business left out). */
export function facts(sim: Sim, speaker = -1): Fact[] {
  const s = sim.state;
  const out = lastingFacts(sim).slice();
  // A merchant's stock (items people know how to say).
  sim.prison.merchants.forEach((cell, k) => {
    const who = s.inmates.findIndex((m) => m.cell === cell);
    if (who < 0 || who === speaker) return;
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
  if (s.heat >= 50 && s.layer === LAYER.GROUND) out.push({ kind: 'heat', key: 'heat' });
  return out;
}

/** The merchants' wares the banks can name (grammar.ts has their words). */
const STOCK_WORDS: ReadonlySet<string> = new Set(['lighter', 'glue', 'duct_tape', 'metal_file', 'timber', 'sheet_metal', 'crowbar', 'wire', 'razor_blade', 'foil', 'rope', 'trowel', 'nail_file', 'screwdriver']);
