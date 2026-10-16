import { currentLang } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { UNIT } from '../sim/tuning';
import { Director, type Rumor, type Stage } from '../talk/director';
import { GOSSIP } from '../talk/gossip';
import { Bubbles } from '../ui/bubbles';
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
/** Where the head is on screen (a little above the "!" marks). */
const head = (id: number, out: { x: number; y: number }) => view.screenOf(id, out, 2.15);
let murmurAt = 0;

/** Whether someone's head is on screen, below the HUD (a bubble may fit over it). */
function sees(id: number): boolean {
  const p = view.screenOf(id, at, 2.15);
  return !!p && bubbles.roomAt(p);
}

const stage: Stage = { now: 0, max: 3, gap: 2.2, phone: TOUCH, sees, partner: -1 };

director.onSay = (b) => {
  const g = play.game;
  if (!g) return;
  const s = g.rec.sim.state;
  // The murmur: closer is louder, never more than one every 0.4 s.
  if (settings.voices && b.start - murmurAt >= 0.4) {
    murmurAt = b.start;
    const body = b.speaker < s.inmates.length ? s.inmates[b.speaker]?.body : s.guards[b.speaker - s.inmates.length]?.body;
    const d = body ? Math.hypot(body.x - s.player.x, body.z - s.player.z) / UNIT : 99;
    const loud = b.style === 'shout' ? 1.3 : b.style === 'whisper' ? 0.45 : 1;
    sound.murmur(b.pitch, Math.min(6, 2 + Math.round(b.text.length / 18)), Math.max(0, 1 - d / 14) * loud);
  }
  // The screen reader hears what matters: gossip and guards' warnings.
  if (b.style === 'gossip' || (b.guard && b.style === 'shout')) bubbles.announce(b.text, b.start);
};

profile.notebook = () => (play.game ? director.notebook(play.game.rec.sim) : []);

/** A game starts (new or loaded): a fresh director for this prison, the rumors the save kept. */
export function chatterStart(sim: Sim, rumors: readonly Rumor[] = []) {
  director.reset(sim, sim.state.rng >>> 0);
  // Only kinds this version knows (a save from a newer one may hold others).
  director.rumors = rumors.filter((r) => (GOSSIP as readonly string[]).includes(r.fact.kind)).slice(0, 12);
  talk.greeting = '';
}

export function chatterStop() {
  bubbles.hide();
  director.active.length = 0;
  talk.greeting = '';
}

/** Each event of a step, as it happens. */
export function chatterEvent(e: SimEvent, sim: Sim) {
  director.react(e, sim, performance.now() / 1000);
  // Talking to someone: what they say on seeing the player, once a talk.
  if (e.type === 'talk') talk.greeting = e.who >= 0 && settings.chatter !== 'off' ? director.greeting(sim, e.who) : '';
}

/** Each frame, after the draw: the director's turn, then the bubbles over the heads. */
export function chatterFrame(g: Game, busy: boolean) {
  const sim = g.rec.sim;
  const st = sim.state;
  director.setLang(currentLang());
  // Quiet too while time runs fast (the dev tools' ×30): nobody could read a word.
  if (busy || settings.chatter === 'off' || g.speed > 1 || st.sleeping || st.ko > 0 || st.solitary > 0) {
    director.active.length = 0;
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
  bubbles.update(director.active, head, false);
}

/** For the dev tools: what has been said so far. */
export function chatterStats() {
  const s = director.stats;
  return { said: s.said, distinct: s.distinct.size, repeats: s.repeats, relaxed: s.relaxed, silent: s.silent, rumors: director.rumors.length };
}
