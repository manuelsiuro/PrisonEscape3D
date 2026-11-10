import { HOOPS_TURN_S, HUDDLE } from '../content/huddles';
import type { GamesFrame } from '../render/Games';
import type { PastimesFrame } from '../render/Pastimes';
import type { Sim } from '../sim/Sim';
import { huddlesNow, type HuddleView } from '../sim/systems/huddles';
import { STEPS_PER_SECOND, UNIT } from '../sim/tuning';
import { MAP_W } from '../sim/world/grid';
import { TILE_INFO } from '../sim/world/tiles';
import { LAYER } from '../sim/world/World';
import { sound } from './context';
import { play, playLater, playNow } from './game';
import { gainAt } from './loudness';
import { rimInTiles } from './pastimes';

/**
 * Free time's gatherings in the picture (2.39; the rules are sim/systems/huddles.ts): the inmates' own games. Two at
 * dice throw in turn, a pair each, a few seconds apart; a card game has its pile between them; at the hoop, the one
 * whose turn it is puts the ball up and lets it go (the rim's clang or the net's swish when the player is near
 * enough to hear). Nothing here touches the simulation: what lands where is the picture's own, from the gathering's
 * start (a chat's poses and words are Character's and the director's).
 *
 * 2.39.1 (the review's fixes): the ball on the frame's own time between steps (it moved 20 times a second), let go
 * from where it was held; the dice picked up and shaken before each throw, the thrower's arm flinging them
 * (viewCrowd.ts, by `by`); the shots heard by how far off they are, and only from the hoop's own space (outdoors with
 * it, or in its zone: through a wall, they were heard as loud as beside it).
 */

const views: HuddleView[] = [];
/** When each gathering was first seen on play time (by the step it formed and its slot), so its games run smoothly between steps. */
const seen = new Map<number, number>();
const live = new Set<number>();
/** A die thrown every this long (s), each pair from the one whose turn it is, after this long shaken in the hand. */
const DICE_EVERY = 3.4;
const DICE_SHAKE = 0.9;
/** A shot's hold (steps, as the sim's SHOOT), its flight and roll (s: Pastimes' FLIGHT and play/pastimes.ts' AFTER_S). */
const SHOT_STEPS = Math.round(1.2 * STEPS_PER_SECOND);
const TURN_STEPS = HOOPS_TURN_S * STEPS_PER_SECOND;
const FLIGHT_S = 0.9;
const AFTER_S = 1.5;
/** Where the ball is let go: over the head, at the top of the hold's sweep (Pastimes' HOLD_Y, plus its 0.1 at full power). */
const RELEASE_Y = 1.55;
/** Heard at the hoop from this near (tiles), at most this loud (quieter further off: loudness.ts). */
const EARSHOT = 14;
const QUIET = 0.45;

/** A number in [0, 1) from a few integers (the same each frame). */
const jit = (a: number, b: number) => Math.abs(Math.sin(a * 12.9898 + b * 78.233) * 43758.5453) % 1;

type At = { x: number; z: number } | undefined;

type Writable<T> = T extends ReadonlyArray<infer U> ? U[] : never;
type DiceFrame = {
  by: number;
  x: number;
  z: number;
  fromX: number;
  fromZ: number;
  oppX: number;
  oppZ: number;
  faces: [number, number];
  t: number;
  seed: number;
};
type CardFrame = { x: number; z: number; angle: number; pile: number };
/** The frames handed on (refilled each frame from pools, never made anew). */
const diceFrames: Writable<NonNullable<GamesFrame['crowd']>> = [];
const cardFrames: Writable<NonNullable<PastimesFrame['crowdCards']>> = [];
const dicePool: DiceFrame[] = [];
const cardPool: CardFrame[] = [];
const ballFrame: NonNullable<PastimesFrame['ball']> = {
  show: { by: 0, fromX: 0, fromZ: 0, result: 'air', short: false, at: 0 },
  t: 0,
  fromY: RELEASE_Y,
};
const holdFrame = { who: 0, power: 0, dx: 0, dz: 0, x: 0, z: 0 };
/** The last shot heard (its gathering and number), so each lands once. */
let heard = -1;

/**
 * The inmates' games into this frame's side games (dice) and card sharks' (cards, the ball when the player's isn't up).
 * `frac`: how far the frame is between the last step and the next (the bodies are drawn that far along).
 */
export function crowdGames(sim: Sim, inmates: readonly At[], px: number, pz: number, games: GamesFrame, past: PastimesFrame, frac: number) {
  diceFrames.length = 0;
  cardFrames.length = 0;
  games.crowd = diceFrames;
  past.crowdCards = cardFrames;
  if (sim.state.layer !== LAYER.GROUND || sim.away) return;
  const now = playNow();
  huddlesNow(sim, views);
  live.clear();
  for (const v of views) {
    if (!v.on || v.kind === HUDDLE.CHAT) continue;
    const key = v.since * 4 + v.slot;
    live.add(key);
    if (!seen.has(key)) seen.set(key, now);
    const t = (now - seen.get(key)!) / 1000;
    const a = inmates[v.who[0]];
    const b = inmates[v.who[1]];
    if (!a || !b) continue;
    if (v.kind === HUDDLE.DICE) {
      const n = Math.floor(t / DICE_EVERY);
      const into = t - n * DICE_EVERY;
      const from = n % 2 ? b : a;
      const to = n % 2 ? a : b;
      const d = (dicePool[diceFrames.length] ??= {
        by: -1,
        x: 0,
        z: 0,
        fromX: 0,
        fromZ: 0,
        oppX: 0,
        oppZ: 0,
        faces: [1, 1],
        t: 0,
        seed: 0,
      });
      d.by = v.who[n % 2];
      d.x = v.x + 0.5;
      d.z = v.z + 0.5;
      d.fromX = from.x;
      d.fromZ = from.z;
      d.oppX = to.x;
      d.oppZ = to.z;
      d.faces[0] = 1 + Math.floor(jit(v.since, n * 2) * 6);
      d.faces[1] = 1 + Math.floor(jit(v.since, n * 2 + 1) * 6);
      d.t = into - DICE_SHAKE;
      d.seed = v.since + n;
      diceFrames.push(d);
    } else if (v.kind === HUDDLE.CARDS) {
      const c = (cardPool[cardFrames.length] ??= { x: 0, z: 0, angle: 0, pile: 0 });
      c.x = v.x + 0.5;
      c.z = v.z + 0.62;
      c.angle = Math.atan2(b.x - a.x, b.z - a.z);
      c.pile = 3 + (Math.floor(t / 5) % 4);
      cardFrames.push(c);
    } else if (v.kind === HUDDLE.HOOPS && !past.ball && !past.holding) hoops(sim, v, inmates, px, pz, past, frac);
  }
  for (const k of seen.keys()) if (!live.has(k)) seen.delete(k);
}

/**
 * The shot of the one whose turn it is: held up (the sim's SHOOT), then away, by the gathering's step clock, on the
 * frame's time between steps (as the bodies: the last step's to the next's, `frac` along).
 */
function hoops(sim: Sim, v: HuddleView, inmates: readonly At[], px: number, pz: number, past: PastimesFrame, frac: number) {
  const rim = rimInTiles(sim);
  if (!rim) return;
  // (hoopsTurn's, in fractions of a step: whose turn and how far into it.)
  const now = Math.max(0, sim.state.step - 1 + frac - v.since);
  const n = Math.floor(now / TURN_STEPS);
  const into = now - n * TURN_STEPS;
  const who = v.who[n % 2];
  const at = inmates[who];
  if (!at) return;
  const len = Math.hypot(rim.x - at.x, rim.z - at.z) || 1;
  if (into < SHOT_STEPS) {
    holdFrame.who = who;
    holdFrame.x = at.x;
    holdFrame.z = at.z;
    holdFrame.dx = (rim.x - at.x) / len;
    holdFrame.dz = (rim.z - at.z) / len;
    holdFrame.power = into / SHOT_STEPS;
    past.holding = holdFrame;
    return;
  }
  const t = (into - SHOT_STEPS) / STEPS_PER_SECOND;
  if (t > FLIGHT_S + AFTER_S) return;
  const r = jit(v.since, n);
  const result = r < 0.25 ? 'swish' : r < 0.55 ? 'in' : r < 0.8 ? 'rim' : 'air';
  ballFrame.show.by = who;
  ballFrame.show.fromX = at.x;
  ballFrame.show.fromZ = at.z;
  ballFrame.show.result = result;
  ballFrame.show.short = jit(v.since + 1, n) < 0.5;
  ballFrame.t = t;
  past.ball = ballFrame;
  // (Heard once, as it lands, as the player's own shot is: the clang then the swish for one that drops, a bounce after.)
  const shot = v.since * 1000 + n;
  if (t >= FLIGHT_S && heard !== shot && Math.hypot(px - rim.x, pz - rim.z) <= EARSHOT && withHoop(sim, rim)) {
    heard = shot;
    const tile = Math.floor(rim.z) * MAP_W + Math.floor(rim.x);
    const gain = QUIET * gainAt(sim, tile);
    // (The later ones only while this game is still the one on: not after a quit or a load.)
    const g = play.game;
    const later = (ms: number, f: () => void) => playLater(ms, () => play.game === g && f());
    if (result === 'swish') sound.swish(gain);
    else if (result === 'in') {
      sound.rimClang(gain * 0.6);
      later(160, () => sound.swish(gain * 0.6));
    } else if (result === 'rim') sound.rimClang(gain);
    else sound.bounce(gain);
    if (result !== 'air') later(420, () => sound.bounce(gain * 0.6));
  }
}

/** Whether the player shares the hoop's space: both out of doors, or in the same zone (no wall between to speak of). */
function withHoop(sim: Sim, rim: { x: number; z: number }): boolean {
  const s = sim.state;
  if (s.layer !== LAYER.GROUND) return false;
  const w = sim.world;
  const hx = Math.floor(rim.x);
  const hz = Math.floor(rim.z);
  const px = Math.floor(s.player.x / UNIT);
  const pz = Math.floor(s.player.z / UNIT);
  const out = (x: number, z: number) => !!TILE_INFO[w.ground.kind[z * MAP_W + x]]?.outdoor;
  return (out(px, pz) && out(hx, hz)) || w.zoneAt(px, pz) === w.zoneAt(hx, hz);
}
