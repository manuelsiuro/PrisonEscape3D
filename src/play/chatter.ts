import { currentLang } from '../i18n';
import { rumorHeard } from '../game/trophies';
import type { Sim, SimEvent } from '../sim/Sim';
import { UNIT } from '../sim/tuning';
import { Director, keepRumors, type Rumor, type Stage } from '../talk/director';
import { factOk } from '../talk/gossip';
import { BUBBLE_HEIGHT, Bubbles } from '../ui/bubbles';
import { TOUCH } from '../ui/dom';
import { profile, settings, sound, talk, view } from './context';
import { play, type Game } from './game';

/**
 * The speech bubbles in play (P13): the director hears every event of the game and is asked
 * each frame who speaks; the bubbles follow the speakers' heads. Nothing here touches the
 * simulation. Quiet while paused, asleep, out cold or in solitary, and off the ground floor.
 */
export const director = new Director();
const bubbles = new Bubbles();
const at = { x: 0, y: 0 };
/** Where someone is on screen at a height over their feet (-1: the player). */
const head = (id: number, out: { x: number; y: number }, height: number) => view.screenOf(id, out, height);
let murmurAt = 0;

/** Whether someone's head is on screen, below the HUD (a bubble may fit over it). */
function sees(id: number): boolean {
  const p = view.screenOf(id, at, BUBBLE_HEIGHT);
  return !!p && bubbles.roomAt(p);
}

const stage: Stage = { now: 0, max: 3, gap: 2.2, phone: TOUCH, sees, partner: -1 };

// What happens when a bubble is first seen (a line nobody saw makes no sound, reaches no
// screen reader, adds nothing to the notebook).
bubbles.onShow = (b) => {
  const g = play.game;
  if (!g) return;
  const sim = g.rec.sim;
  const s = sim.state;
  // A rumor never heard before (P16: counted for the stats and All Ears).
  const fresh = !!b.fact && !g.lesson && !director.rumors.some((r) => r.fact.key === b.fact!.key);
  director.seen(b, sim);
  if (fresh) rumorHeard();
  // The murmur: closer is louder, never more than one every 0.4 s.
  const now = performance.now() / 1000;
  if (settings.voices && now - murmurAt >= 0.4) {
    murmurAt = now;
    const body = b.speaker < s.inmates.length ? s.inmates[b.speaker]?.body : s.guards[b.speaker - s.inmates.length]?.body;
    const d = body ? Math.hypot(body.x - s.player.x, body.z - s.player.z) / UNIT : 99;
    const loud = b.style === 'shout' ? 1.3 : b.style === 'whisper' ? 0.45 : 1;
    sound.murmur(b.pitch, Math.min(6, 2 + Math.round(b.text.length / 18)), Math.max(0, 1 - d / 14) * loud);
  }
  // The screen reader hears what matters: gossip and guards' warnings.
  if (b.style === 'gossip' || (b.guard && b.style === 'shout')) bubbles.announce(b.name ? `${b.name}: ${b.text}` : b.text);
};

/**
 * A guard's ways show in the talk panel once a rumor told them, or the player found out
 * first-hand (P15). With the chatter off nobody gossips: the panel just shows them.
 */
talk.knows = (key) => settings.chatter === 'off' || director.rumors.some((r) => r.fact.key === key);

/**
 * Who the player talks to, as the events tell it: a report that makes the player wanted ends
 * the talk in the same step, so the state has already let go of the guard by then.
 */
let partner = -1;

/** A guard's ways found out first-hand (P15): one that took the money is corrupt, one that reported the offer strict (`by` -1: the player). */
function learn(e: SimEvent, sim: Sim) {
  const n = sim.state.inmates.length;
  const k = e.type === 'bribe' && e.kind !== 'over' ? e.guard : e.type === 'refused' && e.why === 'reported' && partner >= n ? partner - n : -1;
  if (e.type === 'talk') partner = e.who;
  if (k < 0) return;
  const key = `trait:${k}`;
  if (director.rumors.some((r) => r.fact.key === key)) return;
  director.rumors = keepRumors([{ fact: { kind: e.type === 'bribe' ? 'corrupt' : 'strict', key, guard: k }, step: sim.state.step, by: -1 }, ...director.rumors]);
}

/** The prisoner's file lists the rumors: worked out again only when something may have changed. */
let notes: ReturnType<Director['notebook']> = [];
let notesKey = '';
profile.notebook = () => {
  const g = play.game;
  if (!g) return [];
  const sim = g.rec.sim;
  const key = `${director.rumors.length}|${director.rumors[0]?.step ?? 0}|${Math.floor(sim.state.step / 100)}|${currentLang()}`;
  if (key !== notesKey) {
    notesKey = key;
    notes = director.notebook(sim);
  }
  return notes;
};

/** A game starts (new or loaded): a fresh director for this prison, the rumors the save kept. */
export function chatterStart(sim: Sim, rumors: readonly Rumor[] = []) {
  director.reset(sim, sim.state.rng >>> 0);
  partner = sim.state.talk;
  // Only rumors this version can tell again truly (a save from a newer one, or a damaged one, may hold others).
  director.rumors = keepRumors(rumors.filter((r) => factOk(r.fact, sim)));
  talk.greeting = '';
}

export function chatterStop() {
  bubbles.hide();
  director.active.length = 0;
  talk.greeting = '';
}

/** Each event of a step, as it happens. */
export function chatterEvent(e: SimEvent, sim: Sim) {
  learn(e, sim);
  if (settings.chatter === 'off') {
    if (e.type === 'talk') talk.greeting = '';
    return;
  }
  director.react(e, sim, performance.now() / 1000);
  // Talking to someone: what they say on seeing the player, once a talk; then their answers (a gift, a favor paid…).
  if (e.type === 'talk') talk.greeting = e.who >= 0 ? director.greeting(sim, e.who) : '';
  else {
    const answer = director.answer(e, sim);
    if (answer) talk.greeting = answer;
  }
}

/** Each frame, after the draw: the director's turn, then the bubbles over the heads. */
export function chatterFrame(g: Game, busy: boolean) {
  const sim = g.rec.sim;
  const st = sim.state;
  director.setLang(currentLang());
  // Quiet too while time runs fast (the dev tools' ×30): nobody could read a word.
  if (busy || settings.chatter === 'off' || g.speed > 1 || st.sleeping || st.ko > 0 || st.solitary > 0) {
    // Nothing kept for later: waking at 07:55 nobody announces the 04:00 bed check.
    director.quiet();
    bubbles.hide();
    return;
  }
  // As many as the screen has room for: fewer, further apart, on a phone held upright.
  const portrait = innerWidth <= 600 && innerHeight > 520;
  const landscape = innerHeight <= 520;
  const some = settings.chatter === 'some';
  stage.now = performance.now() / 1000;
  stage.max = Math.max(1, (portrait ? 2 : landscape ? 3 : 4) - (some ? 1 : 0));
  stage.gap = (portrait ? 2.8 : landscape ? 2.2 : 1.8) * (some ? 2 : 1);
  stage.partner = st.talk;
  director.tick(sim, stage);
  bubbles.update(director.active, head, false, !settings.reducedMotion);
}

/** For the dev tools: what has been said so far. */
export function chatterStats() {
  const s = director.stats;
  return { said: s.said, distinct: s.distinct.size, repeats: s.repeats, relaxed: s.relaxed, silent: s.silent, rumors: director.rumors.length };
}
