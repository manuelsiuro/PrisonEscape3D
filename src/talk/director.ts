import { ROUTINE } from '../content/routine';
import { t, type Key, type Lang } from '../i18n';
import { enBarks, type BankId, type Barks } from '../i18n/barks/en';
import { frBarks } from '../i18n/barks/fr';
import type { DayEvent } from '../i18n/barks/grammar';
import type { Sim, SimEvent } from '../sim/Sim';
import { clockAt } from '../sim/systems/clock';
import { DOING } from '../sim/systems/inmates';
import type { Body } from '../sim/systems/movement';
import { DIR_X, DIR_Z } from '../sim/command';
import { OPINION_LOW, UNIT } from '../sim/tuning';
import { LAYER } from '../sim/world/World';
import { fill, nameOf, type FillContext } from './fill';
import { facts, LASTING, type Fact } from './gossip';
import { guardMood, inmateMood, outdoors, type Incident, type Mood, type Recent } from './mood';
import type { Line, LineDef, Style, Tag, Voice } from './types';
import { CHATTY, guardVoice, hashStr, inmateVoice, PAUSE, PITCH } from './voice';

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

const BANKS: Record<Lang, Barks> = { en: enBarks, fr: frBarks };
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

/** A gossip fact the player heard, and when (the step): the prisoner's file lists them. */
export interface Rumor {
  fact: Fact;
  step: number;
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

function mulberry(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const dist = (a: Body, b: Body) => Math.hypot(a.x - b.x, a.z - b.z) / UNIT;

export class Director {
  readonly active: Bubble[] = [];
  rumors: Rumor[] = [];
  /** Called for each new bubble (the murmur, the screen reader's log). */
  onSay: ((b: Bubble) => void) | null = null;
  /** Lines said, and how many of them were heard among the last GLOBAL_MEMORY (the tests and the dev hook). */
  readonly stats = { said: 0, repeats: 0, relaxed: 0, distinct: new Set<number>(), silent: 0 };

  private lang: Lang = 'en';
  private random = mulberry(1);
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
  private voices: Voice[] = [];
  private prisonId = '';

  /** A new game (or a game loaded): everything forgotten, the voices of this prison. */
  reset(sim: Sim, seed = 0) {
    this.active.length = 0;
    this.rumors = [];
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
    this.caughtAt = this.powerOutAt = -1e9;
    this.nextAmbient = this.nextTick = this.gossipNext = 0;
    this.day = sim.clock.day;
    this.dayEvent = null;
    this.prisonId = sim.prison.id;
    this.random = mulberry(hashStr(sim.prison.id) ^ (seed + sim.clock.day * 7919));
    const s = sim.state;
    this.voices = [...s.inmates.map((m) => inmateVoice(sim.prison, m.cell) as Voice), ...s.guards.map((_, k) => guardVoice(sim.prison, k) as Voice)];
  }

  /** The language changed: the memory of lines said goes with the old lines. */
  setLang(lang: Lang) {
    if (lang === this.lang) return;
    this.lang = lang;
    this.forget();
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
    return { now, incidents: this.incidents, searched: this.searched, caughtAt: this.caughtAt, cameTo: this.cameTo, bumped: this.bumped, powerOutAt: this.powerOutAt };
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
    if (c.day >= 5) out.add('veteran');
    out.add(sim.prison.theme ?? 'suburban');
    if (s.cash >= 100) out.add('rich');
    if (s.cash < 5) out.add('broke');
    if (s.heat >= 50) out.add('heatHigh');
    if (sim.prison.rules?.hostile) out.add('hostile');
    const b = this.bodyOf(sim, id);
    if (b) out.add(outdoors(sim, b) ? 'outdoors' : 'indoors');
    return out;
  }

  private context(sim: Sim, speaker: number, fact?: Fact): FillContext {
    return { lang: this.lang, sim, speaker, random: this.random, recent: this.recentSlots, fact, dayEvent: this.dayEvent };
  }

  /**
   * A line from a bank for a speaker: fitting its voice and the moment, fresh (not among its
   * last lines nor the last heard), weighted to the rarely said. Null when none is left.
   */
  private pickLine(sim: Sim, bank: BankId, speaker: number, fact?: Fact, relax = true): { line: number; text: string; def: LineDef } | null {
    const lines = BANKS[this.lang][bank];
    if (!lines?.length) return null;
    const voice = this.voiceOf(speaker);
    const tags = this.tags(sim, speaker);
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
        if (mine.includes(id)) return;
        if (!relaxed && this.ring.includes(id)) return;
        const w = (def.w ?? 1) * (def.v ? 3 : 1) * (def.when ? 2 : 1) / (1 + (this.counts.get(id) ?? 0));
        pool.push({ id, def, w });
      });
      const ctx = this.context(sim, speaker, fact);
      while (pool.length) {
        let total = 0;
        for (const c of pool) total += c.w;
        let r = this.random() * total;
        let k = 0;
        while (k < pool.length - 1 && (r -= pool[k].w) > 0) k++;
        const c = pool[k];
        const text = fill(c.def.t, ctx);
        if (text !== null) {
          if (relaxed) this.stats.relaxed++;
          return { line: c.id, text, def: c.def };
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
  private show(sim: Sim, stage: Stage, speaker: number, bank: BankId, line: number, text: string, style: Style) {
    const guard = speaker >= sim.state.inmates.length;
    const chars = text.length;
    const read = Math.max(2.4, 1.2 + chars / 14) * (style === 'gossip' ? 1.5 : 1) * (stage.phone ? 1.2 : 1);
    const b: Bubble = { speaker, guard, text, style, start: stage.now, until: stage.now + read, pitch: PITCH[this.voiceOf(speaker)], line, bank };
    this.active.push(b);
    this.remember(speaker, line);
    const pause = PAUSE[this.voiceOf(speaker)];
    this.speakerNext.set(speaker, stage.now + read + pause * (0.8 + 0.4 * this.random()));
    this.onSay?.(b);
    return b;
  }

  /** Says a line from a bank, if one is left: the bubble, or null (silence). */
  private say(sim: Sim, stage: Stage, speaker: number, bank: BankId, style: Style, fact?: Fact, relax = true): Bubble | null {
    const got = this.pickLine(sim, bank, speaker, fact, relax);
    if (!got) {
      this.stats.silent++;
      return null;
    }
    return this.show(sim, stage, speaker, bank, got.line, got.text, style);
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
      .filter((o) => o.id !== but && o.g.ko <= 0 && o.g.doing !== DOING.SLEEP && o.d <= range)
      .sort((a, b) => a.d - b.d)
      .map((o) => o.id);
  }

  private queueUp(now: number, bank: BankId, speakers: number[], prio: number, trigger: string, style?: Style, delay = 0, life = 2.5) {
    if (!speakers.length) return;
    this.queue.push({ bank, speakers, prio, at: now + delay, expires: now + delay + life, trigger, style });
  }

  private incident(kind: Incident['kind'], x: number, z: number, now: number) {
    this.incidents.push({ kind, x, z, at: now });
    if (this.incidents.length > 24) this.incidents.shift();
  }

  private noteDay(e: DayEvent) {
    this.dayEvent = e;
  }

  /** Reads one event of the step just run (called for each, in order). */
  react(e: SimEvent, sim: Sim, now: number) {
    const s = sim.state;
    const n = s.inmates.length;
    const px = s.player.x / UNIT;
    const pz = s.player.z / UNIT;
    const at = (id: number) => {
      const b = this.bodyOf(sim, id);
      return b ? { x: b.x / UNIT, z: b.z / UNIT } : { x: px, z: pz };
    };
    switch (e.type) {
      case 'spotted': {
        if (e.reason === 'none') break;
        const seeing = s.guards.map((g, k) => ({ id: n + k, g })).filter((o) => o.g.sees && o.g.ko <= 0).sort((a, b) => dist(a.g.body, s.player) - dist(b.g.body, s.player)).map((o) => o.id);
        const own = ['night', 'restricted', 'contraband', 'recognized', 'wanted', 'damage', 'tampering', 'fight'] as const;
        const bank = ((own as readonly string[]).includes(e.reason) ? `re.spotted.${e.reason}` : 're.spotted.other') as BankId;
        this.queueUp(now, bank, seeing, 5, `spotted:${e.reason}`, 'shout');
        break;
      }
      case 'caught':
        this.caughtAt = now;
        this.queueUp(now, 're.caught.gu', this.guardsNear(sim, px, pz, 4), 5, 'caught');
        this.queueUp(now, 're.caught.in', this.inmatesNear(sim, px, pz, 9), 3, 'caughtIn', undefined, 1.2);
        break;
      case 'bedCheck':
        if (e.result === 'start') {
          const k = s.guards.findIndex((_, i) => sim.prison.guards[i].duties?.includes('bedCheck'));
          if (k >= 0) this.queueUp(now, 'gu.bedCheck', [n + k], 2, 'bedCheck', undefined, 0, 30);
        } else if (e.result === 'fail') this.queueUp(now, 're.bedFail.gu', this.guardsNear(sim, px, pz, 30), 5, 'bedFail', 'shout');
        break;
      case 'scanned':
        if (e.tripped) {
          this.incident('alarm', px, pz, now);
          this.noteDay('detector');
          this.queueUp(now, 're.detector.in', this.inmatesNear(sim, px, pz, 7), 3, 'detector');
        }
        break;
      case 'cameTo':
        this.cameTo.set(e.who, now);
        this.queueUp(now, e.who >= n ? 're.cameTo.gu' : 're.cameTo.in', [e.who], 4, 'cameTo', undefined, 0.4);
        break;
      case 'hit': {
        const p = at(e.who);
        this.incident(e.ko ? 'ko' : 'fight', p.x, p.z, now);
        this.noteDay('fight');
        if (e.ko) {
          this.queueUp(now, 're.ko.in', this.inmatesNear(sim, p.x, p.z, 8, e.who), 3, 'ko', undefined, 0.5);
          if (e.who >= n) this.queueUp(now, 're.ko.gu', this.guardsNear(sim, p.x, p.z, 9, e.who), 4, 'koGuard', 'shout', 0.3);
        } else this.queueUp(now, 're.fight.in', this.inmatesNear(sim, p.x, p.z, 7, e.who), 3, 'fight', 'shout', 0.3);
        break;
      }
      case 'allyHit': {
        const p = at(e.who);
        this.incident(e.ko ? 'ko' : 'fight', p.x, p.z, now);
        this.queueUp(now, 're.fight.in', this.inmatesNear(sim, p.x, p.z, 7, e.who), 3, 'fight', 'shout', 0.3);
        break;
      }
      case 'hurt':
        if (e.by >= 0 && e.by < n) this.queueUp(now, 're.taunt.in', [e.by], 4, 'taunt', 'shout');
        break;
      case 'ambush':
        this.queueUp(now, 're.ambush.in', [e.who], 5, 'ambush', 'shout');
        break;
      case 'thrown': {
        const p = at(e.who);
        this.incident('fight', p.x, p.z, now);
        this.queueUp(now, 're.thrown.in', this.inmatesNear(sim, p.x, p.z, 8, e.who), 3, 'thrown', undefined, 0.4);
        break;
      }
      case 'lockdown':
        if (e.on) {
          this.incident('alarm', px, pz, now);
          this.noteDay('lockdown');
          this.queueUp(now, 're.lockdown.gu', this.guardsNear(sim, px, pz, 40), 4, 'lockdown', 'shout', 0.6);
          this.queueUp(now, 're.lockdown.in', this.inmatesNear(sim, px, pz, 40), 3, 'lockdownIn', undefined, 1.6);
        } else this.queueUp(now, 're.lockdownOff.in', this.inmatesNear(sim, px, pz, 40), 2, 'lockdownOff', undefined, 1);
        break;
      case 'shakedown':
        this.noteDay('shakedown');
        this.queueUp(now, 're.shakedown.in', this.inmatesNear(sim, px, pz, 30), 2, 'shakedown', undefined, 1.5, 6);
        break;
      case 'searched': {
        this.searched.add(e.cell);
        // Its inmate grumbles about it the next time it's on screen (a minute or so).
        this.grumble.set(e.cell, now + 90);
        break;
      }
      case 'power':
        if (!e.on) {
          this.powerOutAt = now;
          this.noteDay('power');
          this.queueUp(now, 're.power.in', this.inmatesNear(sim, px, pz, 30), 3, 'power', undefined, 0.5);
          this.queueUp(now, 're.power.gu', this.guardsNear(sim, px, pz, 30), 3, 'powerGu', 'shout', 1.4);
        }
        break;
      case 'shot':
        this.incident('shot', px, pz, now);
        this.noteDay('shot');
        this.queueUp(now, 're.shot.in', this.inmatesNear(sim, px, pz, 12), 3, 'shot', 'shout', 0.3);
        break;
      case 'blast': {
        const x = e.tile % 64;
        const z = Math.floor(e.tile / 64);
        this.incident('blast', x, z, now);
        this.noteDay('blast');
        this.queueUp(now, 're.blast.in', this.inmatesNear(sim, x, z, 16), 3, 'blast', 'shout', 0.4);
        break;
      }
      case 'shocked':
        this.queueUp(now, 're.shocked.in', this.inmatesNear(sim, px, pz, 9), 3, 'shocked', undefined, 0.6);
        break;
      case 'takeover':
        if (e.on) {
          this.noteDay('takeover');
          this.queueUp(now, 're.takeover.in', this.inmatesNear(sim, px, pz, 40), 4, 'takeover', 'shout', 0.4);
          this.queueUp(now, 're.takeover.gu', this.guardsNear(sim, px, pz, 40), 4, 'takeoverGu', 'shout', 1.4);
        }
        break;
      case 'gift':
        this.queueUp(now, 're.gift.in', [e.who], 3, 'gift');
        break;
      case 'opinion':
        if (e.by < 0 && (s.inmates[e.who]?.angry ?? 0) <= 0) this.queueUp(now, 're.opinionDown.in', [e.who], 3, 'opinionDown');
        break;
      case 'favor':
        if (e.state === 'paid') this.queueUp(now, 're.favorDone.in', [e.who], 3, 'favorDone');
        break;
      case 'recruit':
        this.queueUp(now, e.on ? 're.recruit.in' : 're.dismiss.in', [e.who], 3, 'recruit');
        break;
      case 'tip':
        if (e.who >= 0) this.queueUp(now, 're.tip.in', [e.who], 3, 'tip');
        break;
      case 'routine':
        if (this.random() < 0.5) this.queueUp(now, 're.bell.in', this.inmatesNear(sim, px, pz, 14), 2, 'bell', undefined, 1);
        break;
    }
  }

  // ---------------------------------------------------------------- every frame

  /** Bubbles that have had their time go; every quarter second, someone may speak. */
  tick(sim: Sim, stage: Stage) {
    const now = stage.now;
    for (let i = this.active.length - 1; i >= 0; i--) if (now >= this.active[i].until || !stage.sees(this.active[i].speaker)) this.active.splice(i, 1);
    if (now < this.nextTick) return;
    this.nextTick = now + 0.25;
    const s = sim.state;
    if (sim.clock.day !== this.day) {
      this.day = sim.clock.day;
      this.searched.clear();
      this.dayEvent = null;
      this.told.clear();
    }
    this.incidents = this.incidents.filter((i) => now - i.at < 10);
    // Only on the ground floor (from the vents and tunnels nobody is seen talking).
    if (s.layer !== LAYER.GROUND) {
      this.queue = [];
      return;
    }
    this.bumps(sim, now);
    this.reactions(sim, stage);
    if (now >= this.nextAmbient && this.active.length < stage.max) {
      this.nextAmbient = now + stage.gap * (0.7 + 0.6 * this.random());
      this.ambient(sim, stage);
    }
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
    for (let q = 0; q < this.queue.length && this.active.length < stage.max; q++) {
      const p = this.queue[q];
      if (now < p.at) continue;
      if (now < (this.triggerNext.get(p.trigger) ?? 0) && !p.text) {
        this.queue.splice(q--, 1);
        continue;
      }
      const who = p.speakers.find((id) => stage.sees(id) && !this.speaking(id) && now >= (this.triggerNext.get(`${p.trigger}:${id}`) ?? 0));
      if (who === undefined) continue;
      let said: Bubble | null;
      if (p.text) said = this.show(sim, stage, who, p.bank, p.line ?? 0, p.text, p.style ?? 'say');
      else {
        const mood = who < sim.state.inmates.length ? inmateMood(sim, who, this.recent(now)) : guardMood(sim, who, this.recent(now));
        // Someone out cold says nothing; a shout stays a shout.
        said = mood === null ? null : this.say(sim, stage, who, p.bank, p.style ?? 'say');
      }
      this.queue.splice(q--, 1);
      if (said) {
        this.triggerNext.set(p.trigger, now + 6);
        this.triggerNext.set(`${p.trigger}:${who}`, now + 20);
      }
    }
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
      if (mood.style === 'whisper' && d > 5) continue;
      const prox = d <= 4 ? 1 : Math.max(0.3, 1 - ((d - 4) / 8) * 0.7);
      const fx = DIR_X[b.facing] ?? 0;
      const fz = DIR_Z[b.facing] ?? 0;
      const facing = d > 0.1 && ((s.player.x - b.x) * fx + (s.player.z - b.z) * fz) / (d * UNIT * 1024) > 0.5 ? 1.5 : 1;
      const w = CHATTY[this.voiceOf(id)] * mood.intensity * prox * facing * (id >= n ? 0.8 : 1);
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
    if (calm && m.opinion >= 55 && d <= 3 && now >= this.gossipNext && this.random() < 0.6 && this.gossip(sim, stage, id)) return;
    // Two idle inmates side by side: a line and its reply.
    if (calm && this.random() < 0.25 && this.exchange(sim, stage, id)) return;
    // Its own catchphrase, once a day.
    const name = nameOf(sim, id);
    const catchBank = `catch.${name}` as BankId;
    if (calm && name && BANK_INDEX.has(catchBank) && this.catchDay.get(id) !== sim.clock.day && this.random() < 0.1 && this.say(sim, stage, id, catchBank, 'say')) {
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
    this.told.add(`${day}|${id}|${fact.key}`);
    this.gossipNext = stage.now + 45;
    this.rumors = [{ fact, step: sim.state.step }, ...this.rumors.filter((r) => r.fact.key !== fact.key)].slice(0, 12);
    return true;
  }

  /** Two idle inmates side by side: a line, and the other's reply a moment later. */
  private exchange(sim: Sim, stage: Stage, id: number): boolean {
    const s = sim.state;
    const m = s.inmates[id];
    const idle = (k: number) => {
      const o = s.inmates[k];
      return !!o && o.ko <= 0 && o.angry <= 0 && (o.doing === DOING.NOTHING || o.doing === DOING.SIT || o.doing === DOING.EAT || o.doing === DOING.LINE_UP);
    };
    if (!idle(id)) return false;
    const other = s.inmates.findIndex((o, k) => k !== id && idle(k) && k !== stage.partner && dist(o.body, m.body) <= 1.5 && stage.sees(k) && !this.speaking(k) && stage.now >= (this.speakerNext.get(k) ?? 0) && !s.followers.includes(k));
    if (other < 0) return false;
    const meal = m.doing === DOING.EAT || ROUTINE[s.routine].id === 'breakfast' || ROUTINE[s.routine].id === 'dinner';
    const topics: BankId[] = meal ? ['ex.food', 'ex.food', 'ex.life', 'ex.guards'] : ['ex.life', 'ex.guards', 'ex.escape', 'ex.food'];
    const bank = topics[Math.floor(this.random() * topics.length)];
    const got = this.pickLine(sim, bank, id);
    if (!got?.def.r) return false;
    const reply = fill(got.def.r, this.context(sim, other));
    if (reply === null) return false;
    this.show(sim, stage, id, bank, got.line, got.text, 'say');
    this.queue.push({ bank, speakers: [other], prio: 6, at: stage.now + 1.2, expires: stage.now + 3, trigger: `reply:${other}`, text: reply, line: got.line + BANK_SPAN / 2 });
    return true;
  }

  /** What an inmate says on opening the talk panel (by how it feels about the player). */
  greeting(sim: Sim, who: number): string {
    const s = sim.state;
    const m = s.inmates[who];
    if (!m) return '';
    const bank: BankId = s.followers.includes(who) ? 'gr.in.follower' : sim.merchantOf(who) >= 0 && sim.shopsOpen ? 'gr.in.merchant' : m.opinion <= OPINION_LOW ? 'gr.in.low' : m.opinion >= 60 ? 'gr.in.high' : 'gr.in.neutral';
    const got = this.pickLine(sim, bank, who);
    if (!got) return '';
    this.remember(who, got.line);
    return got.text;
  }

  /** The rumors heard, newest first, as the prisoner's file lists them (stale news marked). */
  notebook(sim: Sim): Array<{ text: string; old: boolean; day: number }> {
    if (!this.rumors.length) return [];
    const now = new Set(facts(sim).map((f) => f.key));
    return this.rumors.map((r) => {
      const text = fill(t(`rumor.${r.fact.kind}` as Key), this.context(sim, -1, r.fact)) ?? '';
      return { text, old: !LASTING.has(r.fact.kind) && !now.has(r.fact.key), day: clockAt(r.step).day };
    });
  }

  /** The prison this director is set up for (a reset is needed for another). */
  get prison() {
    return this.prisonId;
  }
}
