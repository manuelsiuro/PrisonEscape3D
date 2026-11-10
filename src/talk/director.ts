import { itemDef } from '../content/items';
import { ROUTINE } from '../content/routine';
import { barksOf, t, type Key, type Lang } from '../i18n';
import { enBarks, type BankId, type Barks } from '../i18n/barks/en';
import { itemPhrase, type DayEvent } from '../i18n/barks/grammar';
import type { Sim, SimEvent } from '../sim/Sim';
import { clockAt } from '../sim/systems/clock';
import { DOING } from '../sim/systems/inmates';
import { lookingAway } from '../sim/systems/ways';
import { awake } from '../sim/systems/guards';
import { itemOf } from '../sim/systems/items';
import type { Body } from '../sim/systems/movement';
import { DIR_X, DIR_Z, ORDER } from '../sim/command';
import { GOSSIP_OPINION, OPINION_HIGH, OPINION_LOW, UNIT } from '../sim/tuning';
import { LAYER } from '../sim/world/World';
import { fill, nameOf, type FillContext } from './fill';
import { react, type Reactor } from './reactions';
import { facts, keepRumors, LASTING, type Fact, type Rumor } from './gossip';
import { guardMood, inmateMood, outdoors, type Incident, type Mood, type Recent } from './mood';
import type { Line, LineDef, Style, Tag, Voice } from './types';
import { CHATTY, guardVoice, inmateVoice, PAUSE, PITCH } from './voice';
import { hash32, randomFrom } from '../sim/rng';
import { FROM } from '../content/oddjobs';
import { twoAtCooler } from '../sim/systems/cooler';
import { HUDDLE } from '../content/huddles';
import { huddlesNow, type HuddleView } from '../sim/systems/huddles';
import { gameRefusal } from '../sim/systems/games';

/**
 * The speech bubbles' director (P13): who says what, and when. Presentation only: it reads
 * the game, never changes it, and its randomness is its own (seeded per prison and day), so
 * a line said can never change a run.
 *
 * Every quarter of a second: reactions to what just happened come first (the guard who
 * spotted the player says why, watchers cheer a fight), then a piece of gossip from a friend
 * close by, then an ambient line from someone on screen, picked by how chatty their voice is,
 * how strongly they feel and how close they are. A line is never one of its speaker's last
 * six, nor one of the last forty heard anywhere; lines said less often weigh more, lines
 * that fit the moment (night, the snow, a fat wallet) more still. When nothing fresh is
 * left, the speaker stays quiet: silence beats repetition.
 */

/** A language's lines (French once loaded, English in its place until then). */
const banksOf = (lang: Lang): Barks => barksOf(lang) ?? enBarks;
const BANK_IDS = Object.keys(enBarks) as BankId[];
const BANK_INDEX = new Map<BankId, number>(BANK_IDS.map((b, i) => [b, i]));
/** Lines per bank, at most (line ids are bank × this + index). */
const BANK_SPAN = 1024;
/** Lines no speaker repeats (its last few), and lines nobody repeats (the last heard anywhere). */
export const SPEAKER_MEMORY = 6;
export const GLOBAL_MEMORY = 40;

export interface Bubble {
  /** Who speaks (Cast id: inmates, then guards). */
  speaker: number;
  guard: boolean;
  text: string;
  style: Style;
  start: number;
  until: number;
  /** The murmur's pitch (Hz), and the line said (bank × 1024 + index). */
  pitch: number;
  line: number;
  bank: BankId;
  /** Who it is (shown on gossip: the friend worth thanking). */
  name?: string;
  /** What happened made them say it (a reaction outranks an idle line for the room on screen). */
  reaction?: boolean;
  /** The gossip told (the notebook keeps it once the bubble has been seen). */
  fact?: Fact;
  /** On screen at least once (set by the bubbles' layer): a line never seen is let go. */
  shown?: boolean;
}

/** What the screen tells the director each tick. */
export interface Stage {
  /** Seconds (the presentation clock). */
  now: number;
  /** Bubbles allowed on screen at once (by screen size and the chatter setting). */
  max: number;
  /** Seconds between ambient lines, before jitter. */
  gap: number;
  /** Bubbles stay up longer on a phone. */
  phone: boolean;
  /** Whether someone is on screen and could have a bubble. */
  sees(id: number): boolean;
  /** Who the player is talking to (the talk panel shows their line instead). */
  partner: number;
}

interface Pending {
  bank: BankId;
  speakers: number[];
  prio: number;
  at: number;
  expires: number;
  trigger: string;
  style?: Style;
  /** An exchange's reply: the line is already chosen (and its id, for the memory). */
  text?: string;
  line?: number;
}

const lineDef = (l: Line): LineDef => (typeof l === 'string' ? { t: l } : l);
const NO_TAGS: ReadonlySet<Tag> = new Set();

/** 2.33: how near the water cooler the player has to stand to overhear what's said at it, how far to walk off before another visit; how much a day. */
const COOLER_EARSHOT = 3;
const COOLER_LEAVE = 6;
const COOLER_TALES = 3;
/** 2.39: free time's chats likewise: how near one to overhear, how far off before another, how much a day. */
const RING_EARSHOT = 3;
const RING_LEAVE = 6;
const RING_TALES = 3;
/** What's said over an inmates' game, by its kind (a chat: what's said anywhere). */
const GAME_TALK: Partial<Record<number, BankId>> = { [HUDDLE.DICE]: 'ex.dice', [HUDDLE.CARDS]: 'ex.cards', [HUDDLE.HOOPS]: 'ex.hoops' };
const dist = (a: Body, b: Body) => Math.hypot(a.x - b.x, a.z - b.z) / UNIT;

/** The banks of a language with lines tied to moments (`when`). */
function whenBanks(lang: Lang): ReadonlySet<BankId> {
  return new Set(BANK_IDS.filter((b) => banksOf(lang)[b].some((l) => typeof l !== 'string' && !!l.when)));
}
/** How many reactions may wait at once (the rest are dropped, the least pressing first). */
const QUEUE_MAX = 24;

export class Director {
  readonly active: Bubble[] = [];
  rumors: Rumor[] = [];
  /** Called for each new bubble (the murmur, the screen reader's log). */
  onSay: ((b: Bubble) => void) | null = null;
  /** Lines said, and how many of them were heard among the last GLOBAL_MEMORY (the tests and the dev hook). */
  readonly stats = { said: 0, repeats: 0, relaxed: 0, distinct: new Set<number>(), silent: 0 };

  private lang: Lang = 'en';
  private random = randomFrom(1);
  private counts = new Map<number, number>();
  private ring = new Int32Array(GLOBAL_MEMORY).fill(-1);
  private ringAt = 0;
  private bySpeaker = new Map<number, number[]>();
  private once = new Set<number>();
  private recentSlots = new Map<string, string[]>();
  private speakerNext = new Map<number, number>();
  private triggerNext = new Map<string, number>();
  private queue: Pending[] = [];
  private nextAmbient = 0;
  private nextTick = 0;
  private gossipNext = 0;
  /** 2.33: the water cooler's talk: ready for the player's next visit, how much was overheard today; ever (the hint's). */
  private coolerArmed = true;
  private coolerToday = 0;
  overheard = 0;
  /** 2.39: a free time's chats: ready for the player's next visit to one, how much was overheard today; the gatherings this tick. */
  private ringArmed = true;
  /** 2.40: when one of those watching the player's game next calls out (seconds, the stage's clock). */
  private watchNext = 0;
  private ringToday = 0;
  private rings: HuddleView[] = [];
  private told = new Set<string>();
  private catchDay = new Map<number, number>();
  private incidents: Incident[] = [];
  private searched = new Set<number>();
  private grumble = new Map<number, number>();
  private day = 0;
  private caughtAt = -1e9;
  private powerOutAt = -1e9;
  private cameTo = new Map<number, number>();
  private bumped = new Map<number, number>();
  private dayEvent: DayEvent | null = null;
  /** The dog the last dog event was about (P19: its handler's lines and the inmates' name it), -1 none. */
  private dogAbout = -1;
  private voices: Voice[] = [];
  private prisonId = '';
  /** Each inmate's last greetings (the talk panel's lines, apart from the bubbles' memory). */
  private greeted = new Map<number, number[]>();
  /** The guards who let something about themselves slip today (P36): `day|guard`. */
  private slipped = new Set<string>();
  /** Banks with lines tied to moments (only those need the moment worked out). */
  private timed = whenBanks('en');
  /** What `react` (reactions.ts) may do here. */
  private readonly reactor: Reactor = {
    queueUp: (...a) => this.queueUp(...a),
    inmatesNear: (...a) => this.inmatesNear(...a),
    guardsNear: (...a) => this.guardsNear(...a),
    incident: (...a) => this.incident(...a),
    noteDay: (e) => this.noteDay(e),
    bodyOf: (sim, id) => this.bodyOf(sim, id),
    answerBank: (e, sim) => this.answerBank(e, sim),
    random: () => this.random(),
    caught: (now) => void (this.caughtAt = now),
    cameTo: (who, now) => void this.cameTo.set(who, now),
    searched: (cell) => void this.searched.add(cell),
    grumble: (cell, at) => void this.grumble.set(cell, at),
    powerOut: (now) => void (this.powerOutAt = now),
    aboutDog: (dog) => void (this.dogAbout = dog),
  };

  /** A new game (or a game loaded): everything forgotten, the voices of this prison. */
  reset(sim: Sim, seed = 0) {
    this.active.length = 0;
    this.rumors = [];
    this.slipped.clear();
    this.forget();
    this.queue = [];
    this.speakerNext.clear();
    this.triggerNext.clear();
    this.told.clear();
    this.catchDay.clear();
    this.incidents = [];
    this.searched.clear();
    this.grumble.clear();
    this.cameTo.clear();
    this.bumped.clear();
    this.greeted.clear();
    this.caughtAt = this.powerOutAt = -1e9;
    this.nextAmbient = this.nextTick = this.gossipNext = 0;
    this.coolerArmed = true;
    this.coolerToday = 0;
    this.ringArmed = true;
    this.ringToday = 0;
    this.day = sim.clock.day;
    this.dayEvent = null;
    this.dogAbout = -1;
    this.prisonId = sim.prison.id;
    this.random = randomFrom(hash32(sim.prison.id) ^ (seed + sim.clock.day * 7919));
    const s = sim.state;
    this.voices = [
      ...s.inmates.map((m) => inmateVoice(sim.prison, m.cell) as Voice),
      ...s.guards.map((_, k) => guardVoice(sim.prison, k) as Voice),
    ];
  }

  /** The language changed: the memory of lines said goes with the old lines. */
  setLang(lang: Lang) {
    if (lang === this.lang) return;
    this.lang = lang;
    this.timed = whenBanks(lang);
    this.forget();
    this.active.length = 0;
    this.queue = [];
    this.greeted.clear();
  }

  /** The game went quiet (paused, asleep, out cold, in solitary): what was up or waiting goes. */
  quiet() {
    this.active.length = 0;
    this.queue = [];
  }

  private forget() {
    this.counts.clear();
    this.ring.fill(-1);
    this.ringAt = 0;
    this.bySpeaker.clear();
    this.once.clear();
    this.recentSlots.clear();
    this.stats.said = this.stats.repeats = this.stats.relaxed = this.stats.silent = 0;
    this.stats.distinct.clear();
  }

  voiceOf(id: number): Voice {
    return this.voices[id] ?? 'rookie';
  }

  private bodyOf(sim: Sim, id: number): Body | undefined {
    const s = sim.state;
    return id < s.inmates.length ? s.inmates[id]?.body : s.guards[id - s.inmates.length]?.body;
  }

  private speaking(id: number) {
    return this.active.some((b) => b.speaker === id);
  }

  private recent(now: number): Recent {
    return {
      now,
      incidents: this.incidents,
      searched: this.searched,
      caughtAt: this.caughtAt,
      cameTo: this.cameTo,
      bumped: this.bumped,
      powerOutAt: this.powerOutAt,
    };
  }

  /** The moments a line may be tied to, for one speaker. */
  private tags(sim: Sim, id: number): Set<Tag> {
    const s = sim.state;
    const c = sim.clock;
    const out = new Set<Tag>();
    const block = ROUTINE[s.routine].id;
    if (block === 'lightsOut') out.add('night');
    if (c.minuteOfDay >= 8 * 60 && c.minuteOfDay < 12 * 60) out.add('morning');
    if (c.minuteOfDay >= 18 * 60 && c.minuteOfDay < 23 * 60) out.add('evening');
    if (c.day === 1) out.add('day1');
    if (c.day <= 2) out.add('newbie');
    if (c.day >= 5) out.add('veteran');
    if (block === 'freeTime' || block === 'eveningFreeTime') out.add('freeTime');
    out.add(sim.prison.theme ?? 'suburban');
    if (s.cash >= 100) out.add('rich');
    if (s.cash < 5) out.add('broke');
    if (s.heat >= 50) out.add('heatHigh');
    if (sim.prison.rules?.hostile) out.add('hostile');
    const b = this.bodyOf(sim, id);
    if (b) out.add(outdoors(sim, b) ? 'outdoors' : 'indoors');
    return out;
  }

  private context(sim: Sim, speaker: number, fact?: Fact, items?: readonly string[]): FillContext {
    return {
      lang: this.lang,
      sim,
      speaker,
      random: this.random,
      recent: this.recentSlots,
      fact,
      dayEvent: this.dayEvent,
      items,
      dog: this.dogAbout >= 0 ? this.dogAbout : undefined,
    };
  }

  /** What a merchant has on sale (the items the banks can name): what its dealing lines may mention. */
  private stockOf(sim: Sim, speaker: number): string[] {
    const k = sim.merchantOf(speaker);
    const shop = k >= 0 ? sim.state.shops[k] : [];
    return shop
      .filter((v) => v > 0)
      .map((v) => itemDef(itemOf(v)).id)
      .filter((id) => itemPhrase(this.lang, id, 'a') !== null);
  }

  /**
   * A line from a bank for a speaker: fitting its voice and the moment, fresh (not among its
   * last lines nor the last heard), weighted to the rarely said. Null when none is left.
   */
  private pickLine(
    sim: Sim,
    bank: BankId,
    speaker: number,
    fact?: Fact,
    relax = true,
    avoid?: readonly number[],
  ): { line: number; text: string; def: LineDef; slots: Map<string, string> } | null {
    const lines = banksOf(this.lang)[bank];
    if (!lines?.length) return null;
    const voice = this.voiceOf(speaker);
    const tags = this.timed.has(bank) ? this.tags(sim, speaker) : NO_TAGS;
    const base = BANK_INDEX.get(bank)! * BANK_SPAN;
    const mine = this.bySpeaker.get(speaker) ?? [];
    for (const relaxed of relax ? [false, true] : [false]) {
      const pool: Array<{ id: number; def: LineDef; w: number }> = [];
      lines.forEach((l, i) => {
        const def = lineDef(l);
        const id = base + i;
        if (def.v && !def.v.includes(voice)) return;
        if (def.when && !def.when.every((tg) => tags.has(tg))) return;
        if (def.once && this.once.has(id)) return;
        if ((avoid ?? mine).includes(id)) return;
        if (!relaxed && !avoid && this.ring.includes(id)) return;
        const w = ((def.w ?? 1) * (def.v ? 3 : 1) * (def.when ? 2 : 1)) / (1 + (this.counts.get(id) ?? 0));
        pool.push({ id, def, w });
      });
      // A merchant's dealing lines name what's actually on sale.
      const ctx = this.context(sim, speaker, fact, bank === 'in.dealing' ? this.stockOf(sim, speaker) : undefined);
      while (pool.length) {
        let total = 0;
        for (const c of pool) total += c.w;
        let r = this.random() * total;
        let k = 0;
        while (k < pool.length - 1 && (r -= pool[k].w) > 0) k++;
        const c = pool[k];
        const slots = new Map<string, string>();
        const text = fill(c.def.t, ctx, slots);
        if (text !== null) {
          if (relaxed) this.stats.relaxed++;
          if (c.def.once) this.once.add(c.id);
          return { line: c.id, text, def: c.def, slots };
        }
        pool.splice(k, 1);
      }
    }
    return null;
  }

  /** Remembers a line said (the speaker's last lines, the last heard, how often). */
  private remember(speaker: number, line: number) {
    if (this.ring.includes(line)) this.stats.repeats++;
    this.stats.said++;
    this.stats.distinct.add(line);
    this.ring[this.ringAt] = line;
    this.ringAt = (this.ringAt + 1) % GLOBAL_MEMORY;
    const mine = this.bySpeaker.get(speaker) ?? [];
    mine.push(line);
    if (mine.length > SPEAKER_MEMORY) mine.shift();
    this.bySpeaker.set(speaker, mine);
    this.counts.set(line, (this.counts.get(line) ?? 0) + 1);
  }

  /** A bubble up over a speaker. */
  private show(sim: Sim, stage: Stage, speaker: number, bank: BankId, line: number, text: string, style: Style, reaction = false) {
    const guard = speaker >= sim.state.inmates.length;
    const chars = text.length;
    const read = Math.max(2.4, 1.2 + chars / 14) * (style === 'gossip' ? 1.5 : 1) * (stage.phone ? 1.2 : 1);
    // Gossip says who tells it: the friend worth thanking.
    const name = style === 'gossip' ? (nameOf(sim, speaker) ?? undefined) : undefined;
    const b: Bubble = {
      speaker,
      guard,
      text,
      style,
      start: stage.now,
      until: stage.now + read,
      pitch: PITCH[this.voiceOf(speaker)],
      line,
      bank,
      name,
      reaction,
    };
    this.active.push(b);
    this.remember(speaker, line);
    const pause = PAUSE[this.voiceOf(speaker)];
    this.speakerNext.set(speaker, stage.now + read + pause * (0.8 + 0.4 * this.random()));
    this.onSay?.(b);
    return b;
  }

  /** Says a line from a bank, if one is left: the bubble, or null (silence). */
  private say(
    sim: Sim,
    stage: Stage,
    speaker: number,
    bank: BankId,
    style: Style,
    fact?: Fact,
    relax = true,
    reaction = false,
  ): Bubble | null {
    const got = this.pickLine(sim, bank, speaker, fact, relax);
    if (!got) {
      this.stats.silent++;
      return null;
    }
    return this.show(sim, stage, speaker, bank, got.line, got.text, style, reaction);
  }

  // ---------------------------------------------------------------- what happened

  /** Inmates within some tiles of a point (Cast ids), nearest first. */
  private inmatesNear(sim: Sim, x: number, z: number, range: number, but = -1): number[] {
    const s = sim.state;
    return s.inmates
      .map((m, k) => ({ k, d: Math.hypot(m.body.x / UNIT - x, m.body.z / UNIT - z), m }))
      .filter((o) => o.k !== but && o.m.ko <= 0 && o.m.doing !== DOING.SLEEP && o.d <= range)
      .sort((a, b) => a.d - b.d)
      .map((o) => o.k);
  }

  /** Guards awake within some tiles of a point (Cast ids), nearest first. */
  private guardsNear(sim: Sim, x: number, z: number, range: number, but = -1): number[] {
    const s = sim.state;
    const n = s.inmates.length;
    return s.guards
      .map((g, k) => ({ id: n + k, d: Math.hypot(g.body.x / UNIT - x, g.body.z / UNIT - z), g }))
      .filter((o) => o.id !== but && awake(o.g) && o.d <= range)
      .sort((a, b) => a.d - b.d)
      .map((o) => o.id);
  }

  private queueUp(now: number, bank: BankId, speakers: number[], prio: number, trigger: string, style?: Style, delay = 0, life = 2.5) {
    if (!speakers.length) return;
    // What matters most waits a little longer for its turn on screen.
    this.queue.push({ bank, speakers, prio, at: now + delay, expires: now + delay + life + (prio >= 4 ? 1.5 : 0), trigger, style });
    if (this.queue.length > QUEUE_MAX) {
      this.queue.sort((a, b) => b.prio - a.prio || b.at - a.at);
      this.queue.length = QUEUE_MAX;
    }
  }

  private incident(kind: Incident['kind'], x: number, z: number, now: number) {
    this.incidents.push({ kind, x, z, at: now });
    if (this.incidents.length > 24) this.incidents.shift();
  }

  private noteDay(e: DayEvent) {
    this.dayEvent = e;
  }

  /** Reads one event of the step just run (called for each, in order): reactions.ts. */
  react(e: SimEvent, sim: Sim, now: number) {
    react(this.reactor, e, sim, now);
  }

  // ---------------------------------------------------------------- every frame

  /** Bubbles that have had their time go; every quarter second, someone may speak. */
  tick(sim: Sim, stage: Stage) {
    const now = stage.now;
    const s = sim.state;
    // A bubble goes when its time is up, when its speaker leaves the screen or is knocked out,
    // and when it never found room on screen (it isn't kept waiting: it's let go).
    for (let i = this.active.length - 1; i >= 0; i--) {
      const b = this.active[i];
      const out = b.guard ? s.guards[b.speaker - s.inmates.length]?.ko : s.inmates[b.speaker]?.ko;
      if (now >= b.until || !stage.sees(b.speaker) || (out ?? 0) > 0 || (!b.shown && now - b.start > 0.8)) this.active.splice(i, 1);
    }
    if (now < this.nextTick) return;
    this.nextTick = now + 0.25;
    if (sim.clock.day !== this.day) {
      this.day = sim.clock.day;
      this.searched.clear();
      this.dayEvent = null;
      this.told.clear();
      this.coolerToday = 0;
      this.ringToday = 0;
    }
    this.incidents = this.incidents.filter((i) => now - i.at < 10);
    // Only on the ground floor (from the vents and tunnels nobody is seen talking).
    if (s.layer !== LAYER.GROUND) {
      this.quiet();
      return;
    }
    this.bumps(sim, now);
    this.reactions(sim, stage);
    this.coolerTalk(sim, stage);
    huddlesNow(sim, this.rings);
    this.ringTalk(sim, stage);
    this.watchTalk(sim, now);
    if (now >= this.nextAmbient && this.active.length < stage.max) {
      this.nextAmbient = now + stage.gap * (0.7 + 0.6 * this.random());
      this.ambient(sim, stage);
    }
  }

  /**
   * 2.33: two inmates having a drink at the water cooler, the player standing by: one tells the other something true,
   * and it's overheard (into the file, as a friend's gossip). Once a visit (walk off and come back for another), a few
   * times a day.
   */
  private coolerTalk(sim: Sim, stage: Stage) {
    const c = sim.world.def.cooler;
    if (!c || sim.rules232) return;
    const s = sim.state;
    const d = Math.hypot(s.player.x / UNIT - (c.x + 0.5), s.player.z / UNIT - (c.z + 0.5));
    if (d > COOLER_LEAVE) this.coolerArmed = true;
    if (!this.coolerArmed || d > COOLER_EARSHOT || this.coolerToday >= COOLER_TALES || !twoAtCooler(sim)) return;
    const pair = s.cooler.who.filter((k) => k >= 0 && stage.sees(k) && !this.speaking(k) && this.canSpeak(sim, k, stage.now));
    if (pair.length < 2 || this.active.length >= stage.max) return;
    const id = pair[Math.floor(this.random() * pair.length)];
    if (!this.gossip(sim, stage, id)) return;
    this.coolerArmed = false;
    this.coolerToday++;
    this.overheard++;
  }

  /**
   * 2.39: a ring of inmates chatting in free time, the player standing by: one tells something true, overheard (into the
   * file, as at the cooler). Once a visit (walk off from every chat and come back for another), a few times a day.
   */
  private ringTalk(sim: Sim, stage: Stage) {
    const s = sim.state;
    const chats = this.rings.filter((r) => r.kind === HUDDLE.CHAT && r.who.length >= 2);
    let near = Infinity;
    let ring: HuddleView | null = null;
    for (const r of chats) {
      const d = Math.hypot(s.player.x / UNIT - (r.x + 0.5), s.player.z / UNIT - (r.z + 0.5));
      if (d < near) {
        near = d;
        ring = r;
      }
    }
    if (near > RING_LEAVE) this.ringArmed = true;
    if (!ring || !this.ringArmed || near > RING_EARSHOT || this.ringToday >= RING_TALES) return;
    const who = ring.who.filter((k) => stage.sees(k) && !this.speaking(k) && this.canSpeak(sim, k, stage.now));
    if (who.length < 2 || this.active.length >= stage.max) return;
    const id = who[Math.floor(this.random() * who.length)];
    if (!this.gossip(sim, stage, id)) return;
    this.ringArmed = false;
    this.ringToday++;
    this.overheard++;
  }

  /**
   * 2.40: the crowd at the player's game calls out now and then (one of those standing there watching, every 5 to 8
   * seconds): encouragement, mostly.
   */
  private watchTalk(sim: Sim, now: number) {
    const w = sim.state.watch;
    if (!w?.length || now < this.watchNext) return;
    const there = w.filter((k) => sim.state.inmates[k]?.doing === DOING.WATCH);
    if (!there.length) return;
    this.watchNext = now + 5 + 3 * this.random();
    this.queueUp(now, 're.watch.in', there, 2, 'watch', 'shout', 0.2, 2.2);
  }

  /** 2.39: the gathering an inmate's in now (from this tick's list), null none. */
  private ringOf(k: number): HuddleView | null {
    for (const r of this.rings) if (r.who.includes(k)) return r;
    return null;
  }

  /** The player walking into someone: they say so (once in a while each). */
  private bumps(sim: Sim, now: number) {
    const s = sim.state;
    if (!s.player.moving) return;
    s.inmates.forEach((m, k) => {
      if (m.ko > 0 || m.doing === DOING.SLEEP || dist(m.body, s.player) > 0.75) return;
      if (now - (this.bumped.get(k) ?? -1e9) < 20) return;
      this.bumped.set(k, now);
      this.queueUp(now, 're.bumped.in', [k], 2, 'bumped', undefined, 0.15, 1.5);
    });
  }

  private reactions(sim: Sim, stage: Stage) {
    const now = stage.now;
    this.queue = this.queue.filter((p) => now <= p.expires);
    this.queue.sort((a, b) => b.prio - a.prio || a.at - b.at);
    for (let q = 0; q < this.queue.length; q++) {
      const p = this.queue[q];
      if (now < p.at) continue;
      // An exchange's reply isn't held back by cooldowns (it's half of a line already said).
      if (now < (this.triggerNext.get(p.trigger) ?? 0) && !p.text) {
        this.queue.splice(q--, 1);
        continue;
      }
      // What matters (a guard saying why it noticed the player, a reply) may take the place of an
      // idle line: its speaker's own, or the oldest one on screen when the screen is full.
      const urgent = p.prio >= 4;
      const idle = (id: number) => this.active.find((b) => b.speaker === id && !b.reaction);
      const who = p.speakers.find(
        (id) =>
          stage.sees(id) &&
          (!this.speaking(id) || (urgent && !!idle(id))) &&
          (!!p.text || now >= (this.triggerNext.get(`${p.trigger}:${id}`) ?? 0)) &&
          this.canSpeak(sim, id, now),
      );
      if (who === undefined) continue;
      const own = idle(who);
      if (own) this.drop(own);
      else if (this.active.length >= stage.max) {
        const oldest = urgent ? this.active.find((b) => !b.reaction) : undefined;
        if (!oldest) continue;
        this.drop(oldest);
      }
      const said = p.text
        ? this.show(sim, stage, who, p.bank, p.line ?? 0, p.text, p.style ?? 'say', true)
        : this.say(sim, stage, who, p.bank, p.style ?? 'say', undefined, true, true);
      this.queue.splice(q--, 1);
      if (said && !p.text) {
        this.triggerNext.set(p.trigger, now + 6);
        this.triggerNext.set(`${p.trigger}:${who}`, now + 20);
      }
    }
  }

  /** Whether someone can speak now (awake or sleep-talking, not out cold). */
  private canSpeak(sim: Sim, id: number, now: number): boolean {
    return (id < sim.state.inmates.length ? inmateMood(sim, id, this.recent(now)) : guardMood(sim, id, this.recent(now))) !== null;
  }

  private drop(b: Bubble) {
    const i = this.active.indexOf(b);
    if (i >= 0) this.active.splice(i, 1);
  }

  /** Someone on screen says something, if anyone is in the mood. */
  private ambient(sim: Sim, stage: Stage) {
    const s = sim.state;
    const now = stage.now;
    const n = s.inmates.length;
    const recent = this.recent(now);
    let total = 0;
    const pool: Array<{ id: number; w: number; mood: Mood; d: number }> = [];
    const total_ = n + s.guards.length;
    for (let id = 0; id < total_; id++) {
      if (id === stage.partner || this.speaking(id) || now < (this.speakerNext.get(id) ?? 0) || !stage.sees(id)) continue;
      const mood = id < n ? inmateMood(sim, id, recent) : guardMood(sim, id, recent);
      if (!mood) continue;
      const b = this.bodyOf(sim, id)!;
      const d = dist(b, s.player);
      // Sleep-talk only close by (a whisper).
      // Sleep-talk only close by (a whisper through the bars), and now and then.
      if (mood.style === 'whisper' && (d > 7 || this.random() > 0.4)) continue;
      const prox = d <= 4 ? 1 : Math.max(0.3, 1 - ((d - 4) / 8) * 0.7);
      const fx = DIR_X[b.facing] ?? 0;
      const fz = DIR_Z[b.facing] ?? 0;
      const facing = d > 0.1 && ((s.player.x - b.x) * fx + (s.player.z - b.z) * fz) / (d * UNIT * 1024) > 0.5 ? 1.5 : 1;
      // (2.39: gathered with others, they talk more.)
      const w = CHATTY[this.voiceOf(id)] * mood.intensity * prox * facing * (id >= n ? 0.8 : this.ringOf(id) ? 1.8 : 1);
      if (w <= 0) continue;
      total += w;
      pool.push({ id, w, mood, d });
    }
    if (!pool.length) return;
    let r = this.random() * total;
    let k = 0;
    while (k < pool.length - 1 && (r -= pool[k].w) > 0) k++;
    const { id, mood, d } = pool[k];
    if (id >= n) {
      this.moodLine(sim, stage, id, mood);
      return;
    }
    const m = s.inmates[id];
    // Its cell was searched today: it has to tell someone.
    const grumble = this.grumble.get(m.cell);
    if (grumble !== undefined) {
      this.grumble.delete(m.cell);
      if (now < grumble && this.say(sim, stage, id, 're.searched.in', 'say')) return;
    }
    const calm = mood.intensity < 0.9 && mood.style === 'say';
    // A friend close by has something true to tell.
    if (calm && m.opinion >= GOSSIP_OPINION && d <= 3 && now >= this.gossipNext && this.random() < 0.6 && this.gossip(sim, stage, id))
      return;
    // Two idle inmates side by side: a line and its reply.
    // (2.39: in a ring or at a game, more often than not.)
    if (calm && this.random() < (this.ringOf(id) ? 0.7 : 0.25) && this.exchange(sim, stage, id)) return;
    // Its own catchphrase, once a day.
    const name = nameOf(sim, id);
    const catchBank = `catch.${name}` as BankId;
    if (
      calm &&
      name &&
      BANK_INDEX.has(catchBank) &&
      this.catchDay.get(id) !== sim.clock.day &&
      this.random() < 0.07 &&
      this.say(sim, stage, id, catchBank, 'say')
    ) {
      this.catchDay.set(id, sim.clock.day);
      return;
    }
    this.moodLine(sim, stage, id, mood);
  }

  /**
   * A line in the mood of the moment: from its own bank, or now and then from another that
   * fits too; only lines not heard lately (nothing fresh anywhere: silence, never a repeat).
   */
  private moodLine(sim: Sim, stage: Stage, id: number, mood: Mood) {
    const alt = mood.alt ?? [];
    const first = alt.length && this.random() < 0.45 ? alt[Math.floor(this.random() * alt.length)] : mood.bank;
    const order = [first, mood.bank, ...alt].filter((b, i, all) => all.indexOf(b) === i);
    for (const bank of order) if (this.say(sim, stage, id, bank, bank === mood.bank ? mood.style : 'say', undefined, false)) return;
  }

  /** A true fact the speaker hasn't told today, the ones the player never heard first. */
  private gossip(sim: Sim, stage: Stage, id: number): boolean {
    const day = sim.clock.day;
    const heard = new Set(this.rumors.map((r) => r.fact.key));
    const all = facts(sim, id).filter((f) => !this.told.has(`${day}|${id}|${f.key}`));
    if (!all.length) return false;
    const fresh = all.filter((f) => !heard.has(f.key));
    const from = fresh.length ? fresh : all;
    const fact = from[Math.floor(this.random() * from.length)];
    const b = this.say(sim, stage, id, `go.${fact.kind}` as BankId, 'gossip', fact);
    if (!b) return false;
    b.fact = fact;
    this.told.add(`${day}|${id}|${fact.key}`);
    this.gossipNext = stage.now + 45;
    return true;
  }

  /**
   * A bubble reached the screen (the bubbles' layer says so, once): gossip goes in the
   * notebook only now, so nothing the player never saw is "heard".
   */
  seen(b: Bubble, sim: Sim) {
    b.shown = true;
    const fact = b.fact;
    if (fact)
      this.rumors = keepRumors([{ fact, step: sim.state.step, by: b.speaker }, ...this.rumors.filter((r) => r.fact.key !== fact.key)]);
  }

  /** Two idle inmates side by side: a line, and the other's reply a moment later. */
  private exchange(sim: Sim, stage: Stage, id: number): boolean {
    const s = sim.state;
    const m = s.inmates[id];
    const idle = (k: number) => {
      const o = s.inmates[k];
      return (
        !!o &&
        o.ko <= 0 &&
        o.angry <= 0 &&
        (o.doing === DOING.NOTHING ||
          o.doing === DOING.SIT ||
          o.doing === DOING.EAT ||
          o.doing === DOING.LINE_UP ||
          o.doing === DOING.CHAT ||
          o.doing === DOING.DICE ||
          o.doing === DOING.CARDS)
      );
    };
    // (2.39: in a gathering, its own: the reply from someone in it, about its game.)
    const ring = this.ringOf(id);
    // Room for both lines on screen (a phone held upright has room for two at most).
    if (!idle(id) || stage.max - this.active.length < 2) return false;
    const other = s.inmates.findIndex(
      (o, k) =>
        k !== id &&
        idle(k) &&
        k !== stage.partner &&
        (ring ? ring.who.includes(k) : dist(o.body, m.body) <= 1.5) &&
        stage.sees(k) &&
        !this.speaking(k) &&
        stage.now >= (this.speakerNext.get(k) ?? 0) &&
        !s.followers.includes(k),
    );
    if (other < 0) return false;
    const meal = m.doing === DOING.EAT || ROUTINE[s.routine].id === 'breakfast' || ROUTINE[s.routine].id === 'dinner';
    const topics: BankId[] = meal ? ['ex.food', 'ex.food', 'ex.life', 'ex.guards'] : ['ex.life', 'ex.guards', 'ex.escape', 'ex.food'];
    const game = ring && ring.on ? GAME_TALK[ring.kind] : undefined;
    const bank = game && this.random() < 0.7 ? game : topics[Math.floor(this.random() * topics.length)];
    const got = this.pickLine(sim, bank, id);
    if (!got?.def.r) return false;
    // The reply talks about the same guard, meal or event (its own speaker and place aside).
    for (const k of [...got.slots.keys()]) if (k === 'me' || k.startsWith('here')) got.slots.delete(k);
    const reply = fill(got.def.r, this.context(sim, other), got.slots);
    if (reply === null) return false;
    this.show(sim, stage, id, bank, got.line, got.text, 'say');
    this.queue.push({
      bank,
      speakers: [other],
      prio: 6,
      at: stage.now + 1.2,
      expires: stage.now + 3,
      trigger: `reply:${other}`,
      text: reply,
      line: got.line + BANK_SPAN / 2,
    });
    return true;
  }

  /** How an inmate answers something the player did with it (a gift, a favor paid, joining up…), if at all. */
  private answerBank(e: SimEvent, sim: Sim): BankId | null {
    switch (e.type) {
      // (2.39: walked up to an inmates' game and talked to one at it: asked in, if they'll play the player.)
      case 'huddle':
        if (gameRefusal(sim, e.who)) return null;
        return e.kind === HUDDLE.DICE ? 'gr.join.dice' : e.kind === HUDDLE.CARDS ? 'gr.join.cards' : 'gr.join.hoops';
      case 'gift':
        return 're.gift.in';
      case 'opinion':
        // (2.36: a favor let go says its own line, not "what was that for?")
        if (sim.events.some((o) => o.type === 'favor' && o.state === 'dropped' && o.who === e.who)) return null;
        return e.by < 0 && (sim.state.inmates[e.who]?.angry ?? 0) <= 0 ? 're.opinionDown.in' : null;
      case 'favor':
        return e.state === 'paid' ? 're.favorDone.in' : e.state === 'dropped' ? 're.favorDropped.in' : null;
      // (P40: an odd job taken from him, handed in, failed.)
      case 'oddjob':
        return e.what === 'paid'
          ? 're.jobPaid.in'
          : e.what === 'failed'
            ? 're.jobFailed.in'
            : e.what === 'taken' && e.from === FROM.FIXER
              ? 're.jobTaken.in'
              : null;
      case 'recruit':
        return e.on ? 're.recruit.in' : 're.dismiss.in';
      case 'tip':
        return e.who >= 0 ? 're.tip.in' : null;
      case 'crew':
        if (e.what !== 'order') return null;
        return e.order === ORDER.WATCH
          ? 're.crewWatch.in'
          : e.order === ORDER.DIG
            ? 're.crewDig.in'
            : e.order === ORDER.BACK
              ? 're.crewBack.in'
              : e.order === ORDER.FETCH
                ? 're.crewFetch.in'
                : e.order === ORDER.NIGHT
                  ? 're.crewNight.in'
                  : e.order === ORDER.FOLLOW
                    ? 're.crewFollow.in'
                    : null;
      default:
        return null;
    }
  }

  /** How a guard the player talks to answers a bribe (P15): taken, turned down, reported, too poor. */
  private guardAnswerBank(e: SimEvent, sim: Sim): BankId | null {
    const s = sim.state;
    if (s.talk < s.inmates.length) return null;
    if (e.type === 'bribe')
      return s.talk !== s.inmates.length + e.guard ? null : e.kind === 'look' ? 're.bribe.gu' : e.kind === 'paper' ? 're.paper.gu' : null;
    if (e.type !== 'refused') return null;
    return e.why === 'honest' ? 're.honest.gu' : e.why === 'reported' ? 're.reported.gu' : e.why === 'cash' ? 're.broke.gu' : null;
  }

  /** The talk partner's answer to what the player just did (shown in the talk panel), or null. */
  answer(e: SimEvent, sim: Sim): string | null {
    const guard = this.guardAnswerBank(e, sim);
    if (guard) {
      const got = this.pickLine(sim, guard, sim.state.talk);
      if (!got) return null;
      this.remember(sim.state.talk, got.line);
      return got.text;
    }
    if (!('who' in e) || e.who !== sim.state.talk || e.who < 0) return null;
    const bank = this.answerBank(e, sim);
    const got = bank && this.pickLine(sim, bank, e.who);
    if (!got) return null;
    this.remember(e.who, got.line);
    return got.text;
  }

  /** What an inmate says on opening the talk panel (by how it feels about the player). */
  greeting(sim: Sim, who: number): string {
    const s = sim.state;
    const m = s.inmates[who];
    const g = s.guards[who - s.inmates.length];
    if (!m && !g) return '';
    // A guard (P15): in its own voice; one already bribed winks.
    // A grudge shows first (a merchant who won't sell doesn't welcome anyone to the shop).
    // A guard lets something about itself slip (P36), once a prison day: a word of its the player hasn't heard.
    if (!m && !lookingAway(g, s.step)) {
      const slip = this.slip(sim, who);
      if (slip) return slip;
    }
    const bank: BankId = !m
      ? lookingAway(g, s.step)
        ? 'gu.bribed'
        : 'gr.gu'
      : m.opinion <= OPINION_LOW
        ? 'gr.in.low'
        : s.followers.includes(who)
          ? 'gr.in.follower'
          : sim.merchantOf(who) >= 0 && sim.shopsOpen
            ? 'gr.in.merchant'
            : m.opinion >= OPINION_HIGH
              ? 'gr.in.high'
              : 'gr.in.neutral';
    // Greetings keep their own memory: the last three aren't said again (the bubbles' memory untouched).
    const last = this.greeted.get(who) ?? [];
    const got = this.pickLine(sim, bank, who, undefined, true, last) ?? this.pickLine(sim, bank, who, undefined, true, []);
    if (!got) return '';
    this.greeted.set(who, [...last, got.line].slice(-3));
    return got.text;
  }

  /**
   * What a guard lets slip about itself on a chat (P36): its nickname, home town or team, the
   * first the player hasn't heard, once a prison day; kept in the file as told by it. Null when
   * it's said enough today, or there's nothing left to tell.
   */
  private slip(sim: Sim, who: number): string | null {
    const k = who - sim.state.inmates.length;
    const key = `${clockAt(sim.state.step).day}|${k}`;
    if (this.slipped.has(key) || !sim.prison.guards[k]?.about) return null;
    this.slipped.add(key);
    const heard = new Set(this.rumors.map((r) => r.fact.key));
    const kind = (['guardNick', 'guardHome', 'guardTeam'] as const).find((x) => !heard.has(`${x}:${k}`));
    if (!kind) return null;
    const fact: Fact = { kind, key: `${kind}:${k}`, guard: k };
    const got = this.pickLine(sim, `gu.slip.${kind.slice(5).toLowerCase()}` as BankId, who, fact);
    if (!got) return null;
    this.rumors = keepRumors([{ fact, step: sim.state.step, by: who }, ...this.rumors.filter((r) => r.fact.key !== fact.key)]);
    return got.text;
  }

  /**
   * The old-timer's secret (P27), for a game of checkers lost to the player: a lasting truth
   * about the prison the player hasn't heard yet (else any lasting one), kept in the file as
   * told by him. Returns the rumor's words, or null when there's nothing left to tell.
   */
  secret(sim: Sim, who: number): string | null {
    const heard = new Set(this.rumors.map((r) => r.fact.key));
    const lasting = facts(sim, who).filter((f) => LASTING.has(f.kind));
    const fresh = lasting.filter((f) => !heard.has(f.key));
    const from = fresh.length ? fresh : lasting;
    if (!from.length) return null;
    const fact = from[Math.floor(this.random() * from.length)];
    this.rumors = keepRumors([{ fact, step: sim.state.step, by: who }, ...this.rumors.filter((r) => r.fact.key !== fact.key)]);
    return fill(t(`rumor.${fact.kind}` as Key), this.context(sim, -1, fact));
  }

  /** The rumors heard, newest first, as the prisoner's file lists them (stale news marked). */
  notebook(sim: Sim): Array<{ text: string; old: boolean; day: number; by: string | null; self: boolean }> {
    if (!this.rumors.length) return [];
    const now = new Set(facts(sim).map((f) => f.key));
    return this.rumors.map((r) => {
      const text = fill(t(`rumor.${r.fact.kind}` as Key), this.context(sim, -1, r.fact)) ?? '';
      // Found out first-hand (P15: a bribe taken or reported) rather than told.
      const self = r.by === -1;
      return {
        text,
        old: !LASTING.has(r.fact.kind) && !now.has(r.fact.key),
        day: clockAt(r.step).day,
        by: r.by !== undefined && !self ? nameOf(sim, r.by) : null,
        self,
      };
    });
  }

  /** The prison this director is set up for (a reset is needed for another). */
  get prison() {
    return this.prisonId;
  }
}
