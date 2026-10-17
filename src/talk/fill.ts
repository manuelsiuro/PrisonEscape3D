import { ROUTINE } from '../content/routine';
import type { ZoneId } from '../content/zones';
import { t, type Key, type Lang } from '../i18n';
import { CHAT_ITEMS, EVENTS, guardFull, itemPhrase, MEALS, NICKS, placePhrase, PUBLIC_PLACES, WEEKDAYS, type DayEvent, type Nick } from '../i18n/barks/grammar';
import type { Sim } from '../sim/Sim';
import { formatTime } from '../sim/systems/clock';
import { tileOfBody } from '../sim/systems/movement';
import { MAP_W } from '../sim/world/World';
import { handlersOf } from '../sim/systems/k9';
import type { Fact } from './gossip';
import { hashStr } from './voice';

/**
 * Fills a line's {slots} (P13). A slot that can't be filled (no event today, a place the
 * prison doesn't have) makes the whole line unusable, and the director picks another. A slot
 * named with a capital ({You}, {Place.the}) starts its sentence. The same slot twice in a
 * line says the same thing twice; a slot's last few values aren't picked again, so the same
 * name or item doesn't come back line after line.
 *
 * Slots: {you} what the prison calls the player · {me} the speaker · {inmate} another inmate
 * · {guard} {guard.full} a guard · {here.at} {here.the} where the speaker stands ·
 * {place.at} {place.the} a room · {item} {item.a} {item.the} {item.my} · {time} {block}
 * {next} {day} {weekday} · {meal} today's dish (the meal at hand), {dinner} tonight's · {event}
 * what happened today · and gossip's own: {n} {m} {t1} {t2} {key}.
 */
export interface FillContext {
  lang: Lang;
  sim: Sim;
  /** Cast id of who speaks. */
  speaker: number;
  random: () => number;
  /** What was filled lately, per slot (not picked again for a while). */
  recent: Map<string, string[]>;
  /** The gossip being told (its slots win). */
  fact?: Fact;
  /** Today's talking point, if anything happened. */
  dayEvent: DayEvent | null;
  /** The things {item} may name (a merchant names what's on sale), instead of everyday things. */
  items?: readonly string[];
  /** The dog a reaction is about (P19, {dog}). */
  dog?: number;
}

const SLOT = /\{([A-Za-z][A-Za-z0-9]*)(?:\.([a-z]+))?\}/g;

/** The slots a line uses (parsed once per text). */
const slotCache = new Map<string, string[]>();
export function slotsOf(text: string): string[] {
  let out = slotCache.get(text);
  if (!out) {
    out = [...text.matchAll(SLOT)].map((m) => (m[2] ? `${m[1]}.${m[2]}` : m[1]).replace(/^./, (c) => c.toLowerCase()));
    slotCache.set(text, out);
  }
  return out;
}

/** The slots the director can fill (chattertest checks every line's against it). */
export const SLOTS: ReadonlySet<string> = new Set(['you', 'me', 'inmate', 'guard', 'guard.full', 'here.at', 'here.the', 'place.at', 'place.the', 'item', 'item.a', 'item.the', 'item.my', 'time', 'block', 'next', 'day', 'weekday', 'meal', 'dinner', 'event', 'n', 'm', 't1', 't2', 'key', 'dog']);

const hhmm = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** French typography: a narrow no-break space before ! ? : ; and inside « ». */
export function typo(lang: Lang, s: string): string {
  if (lang !== 'fr') return s;
  return s.replace(/ ([!?:;»])/g, ' $1').replace(/« /g, '« ');
}

/** Your prisoner's name (P16; empty: none given). Friends use it, now and then, instead of the nickname. */
export const PLAYER = { name: '' };

/** What the prison calls the player: the fish for two days, then a name earned (or "kid"). */
export function nickOf(sim: Sim): Nick {
  const s = sim.state;
  if (sim.clock.day <= 2) return 'fish';
  if (s.tally[1] >= 8) return 'mole';
  if (s.tally[2] >= 2) return 'champ';
  if (sim.attr('int') >= 70) return 'brains';
  if (s.str >= 70) return 'muscles';
  if (s.cash >= 150) return 'moneybags';
  return 'kid';
}

/** An inmate's nickname (Cast id), a guard's name: who people are in the bubbles. */
export function nameOf(sim: Sim, id: number): string | null {
  const s = sim.state;
  if (id < 0) return null;
  if (id < s.inmates.length) return sim.prison.names[s.inmates[id].cell - 2] ?? null;
  return sim.prison.guards[id - s.inmates.length]?.name ?? null;
}

/** Today's dish for the meal at hand (breakfast until free time, then the evening meal), or tonight's. */
export function mealOf(lang: Lang, sim: Sim, tonight = false): string {
  const c = sim.clock;
  const kind = !tonight && c.minuteOfDay < 10 * 60 ? 'breakfast' : 'dinner';
  const list = MEALS[lang][kind];
  return list[hashStr(`${sim.prison.id}:${c.day}:${kind}`) % list.length];
}

/** A pick from a list, avoiding what this slot said lately (null when the list is empty). */
function pick<T extends string>(ctx: FillContext, slot: string, list: readonly T[]): T | null {
  if (!list.length) return null;
  const recent = ctx.recent.get(slot) ?? [];
  const fresh = list.filter((v) => !recent.includes(v));
  const from = fresh.length ? fresh : list;
  const v = from[Math.floor(ctx.random() * from.length)];
  recent.push(v);
  if (recent.length > 4) recent.shift();
  ctx.recent.set(slot, recent);
  return v;
}

/** The zone someone stands in (a cell is "my cell" only to its own inmate). */
function zoneOfSpeaker(sim: Sim, id: number): ZoneId | null {
  const s = sim.state;
  const body = id < s.inmates.length ? s.inmates[id]?.body : s.guards[id - s.inmates.length]?.body;
  if (!body) return null;
  const tile = tileOfBody(body);
  const zone = sim.world.zoneAt(tile.x, tile.z);
  if (zone === 'inmateCell') return id < s.inmates.length && sim.world.cellOf[tile.z * MAP_W + tile.x] === s.inmates[id].cell ? zone : null;
  return zone;
}

/** Zones of this prison a random {place} may name. */
const placeCache = new Map<string, ZoneId[]>();
function placesHere(sim: Sim): ZoneId[] {
  let out = placeCache.get(sim.prison.id);
  if (!out) {
    const seen = new Set<string>();
    for (let z = 0; z < 64; z++) for (let x = 0; x < MAP_W; x++) seen.add(sim.world.zoneAt(x, z));
    out = PUBLIC_PLACES.filter((p) => seen.has(p));
    placeCache.set(sim.prison.id, out);
  }
  return out;
}

/** One slot's words, or null when it can't be said here and now. */
function slotValue(ctx: FillContext, slot: string, line: Map<string, string>): string | null {
  const known = line.get(slot);
  if (known !== undefined) return known;
  const { lang, sim, fact } = ctx;
  const s = sim.state;
  const [name, form = ''] = slot.split('.');
  let v: string | null = null;
  switch (name) {
    case 'you': {
      const friend = ctx.speaker >= 0 && ctx.speaker < s.inmates.length && s.inmates[ctx.speaker].opinion >= 60;
      v = PLAYER.name && friend && ctx.random() < 0.5 ? PLAYER.name : NICKS[lang][nickOf(sim)];
      break;
    }
    case 'me':
      v = nameOf(sim, ctx.speaker);
      break;
    case 'inmate': {
      if (fact?.inmate !== undefined) v = nameOf(sim, fact.inmate);
      else {
        const others = s.inmates.map((_, k) => k).filter((k) => k !== ctx.speaker && nameOf(sim, k));
        const who = pick(ctx, 'inmate', others.map(String));
        v = who === null ? null : nameOf(sim, Number(who));
      }
      break;
    }
    case 'guard': {
      const k = fact?.guard ?? Number(pick(ctx, 'guard', sim.prison.guards.map((g, i) => (g.name ? String(i) : '')).filter(Boolean)) ?? -1);
      const n = sim.prison.guards[k]?.name;
      v = n ? (form === 'full' ? guardFull(lang, n) : n) : null;
      break;
    }
    case 'here': {
      const z = zoneOfSpeaker(sim, ctx.speaker);
      const w = z && placePhrase(lang, z);
      v = w ? (form === 'the' ? w.the : w.at) : null;
      break;
    }
    case 'place': {
      const here = zoneOfSpeaker(sim, ctx.speaker);
      const z = fact?.place ?? pick(ctx, 'place', placesHere(sim).filter((p) => p !== here));
      const w = z && placePhrase(lang, z);
      v = w ? (form === 'the' ? w.the : w.at) : null;
      break;
    }
    case 'item': {
      const id = fact?.item ?? pick(ctx, 'item', ctx.items ?? CHAT_ITEMS);
      v = id ? itemPhrase(lang, id, form as 'a' | 'the' | 'my' | '') : null;
      break;
    }
    case 'time':
      v = formatTime(sim.clock);
      break;
    case 'block':
      v = t(`routine.${ROUTINE[s.routine].id}` as Key).toLowerCase();
      break;
    case 'next':
      v = t(`routine.${ROUTINE[(s.routine + 1) % ROUTINE.length].id}` as Key).toLowerCase();
      break;
    case 'day':
      v = String(sim.clock.day);
      break;
    case 'weekday':
      v = WEEKDAYS[lang][(sim.clock.day - 1) % 7];
      break;
    case 'meal':
      v = mealOf(lang, sim);
      break;
    case 'dinner':
      v = mealOf(lang, sim, true);
      break;
    case 'event':
      v = ctx.dayEvent ? EVENTS[lang][ctx.dayEvent] : null;
      break;
    case 'n':
    case 'm':
      v = fact?.[name] !== undefined ? String(fact[name]) : null;
      break;
    case 't1':
    case 't2':
      v = fact?.[name] !== undefined ? hhmm(fact[name]!) : null;
      break;
    case 'key':
      v = fact?.color ? t(`keyColor.${fact.color}` as Key) : null;
      break;
    // A guard dog (P19): the fact's, the dog of the guard speaking, else one of the prison's.
    case 'dog': {
      const dogs = handlersOf(sim.world);
      const own = dogs.indexOf(ctx.speaker - s.inmates.length);
      const k = fact?.dog ?? ctx.dog ?? (own >= 0 ? own : Number(pick(ctx, 'dog', dogs.map((_, i) => String(i))) ?? -1));
      v = k >= 0 && k < dogs.length ? sim.prison.guards[dogs[k]].dog!.name : null;
      break;
    }
  }
  if (v !== null) line.set(slot, v);
  return v;
}

/**
 * The line with its slots filled (French typography applied), or null if one can't be.
 * `line` holds what each slot said: pass the same map to a reply so it names the same guard.
 */
export function fill(text: string, ctx: FillContext, line = new Map<string, string>()): string | null {
  let ok = true;
  const out = text.replace(SLOT, (_, a: string, b?: string) => {
    const slot = (b ? `${a}.${b}` : a).replace(/^./, (c) => c.toLowerCase());
    const v = slotValue(ctx, slot, line);
    if (v === null) {
      ok = false;
      return '';
    }
    return /^[A-Z]/.test(a) ? cap(v) : v;
  });
  return ok ? typo(ctx.lang, out) : null;
}
