import { buzz } from '../app/haptics';
import {
  AFTER_KICK,
  AIM_SETTLE,
  AIM_POST,
  CORNERS_A_DAY,
  DIVE_EARLY,
  FLIGHT,
  KEEPER_BASE,
  KEEPER_SPREAD,
  KICK_CLOCK,
  LOOK_AT,
  PEN_CROWD_OPINION,
  PEN_KICKS,
  RUN_UP,
} from '../content/penalties';
import { t } from '../i18n';
import { EXT, OP } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import {
  canPractise,
  cornersToday,
  goalOf,
  KICK,
  markerOf,
  minutesLeft,
  type Pens,
  pensRefusal,
  PH,
  pitchOf,
  shootoutBox,
} from '../sim/systems/penalties';
import { STEPS_PER_SECOND, UNIT } from '../sim/tuning';
import { LAYER } from '../sim/world/World';
import type { PitchFrame } from '../render/Pitch';
import type { Pitch } from '../content/prisons/types';
import type { PenMark, PensView } from '../ui/pens';
import { TOUCH } from '../ui/dom';
import { inmateName } from '../ui/names';
import { banner, itemsUI, sound } from './context';
import { floatUp } from './floats';
import { play, sendOp } from './game';
import { refusalText } from './team';
import { coachOnce } from './tips';

/**
 * Penalties (2.44) on screen: the card at the spot and in a shootout, the talk panel's row, Space
 * (or the card's buttons) for the kick and the dives, the sounds and toasts of its events, and the
 * ball and the keeper's dive in the picture. The sim's own functions decide everything shown; the
 * ball's flight between the spot and the net is drawn from the kick's step, its aim and result.
 */

// ------------------------------------------------------------------ the talk panel's row

/** The shootout on offer with the inmate talked to: there's a pitch and they're at it; he'd play now (else why not). */
export function pensOffer(sim: Sim, who: number): { open: boolean; why: string } | null {
  if (!pitchOf(sim)) return null;
  const why = pensRefusal(sim, who);
  // (Away from the pitch, no row at all: it's only for when one could play.)
  if (why === 'noPitch') return null;
  // (Short of the time a shootout takes before the bell, said so: called off there unsettled, nobody's win.)
  const left = minutesLeft(sim.state);
  return { open: !why, why: why ? refusalText(sim, why) : left < SHOOTOUT_MINUTES ? t('pens.shortTime', { n: left }) : t('pens.note') };
}

/** About how long a shootout takes (game minutes: a second each), for the talk row's warning. */
const SHOOTOUT_MINUTES = 50;
/** The card says the bell is coming in its last minutes. */
const BELL_SOON = 15;

// ------------------------------------------------------------------ the ball's way

/**
 * Where the ball is, in the goal's terms: across (aim units over AIM_POST: -1 the left post … 1),
 * along (0 the spot … 1 the goal line; past it into the net or out), up (tiles off the ground).
 */
export interface BallAt {
  across: number;
  along: number;
  up: number;
}
const ballAt: BallAt = { across: 0, along: 0, up: 0 };
/** The keeper meets a saved kick this far along its flight. */
const SAVE_AT = 0.88;
const ease = (x: number) => 1 - (1 - x) * (1 - x);

/** The ball now (`a`: between steps), or null when it isn't on the pitch's spot or in play. */
export function ballOf(o: Pens, step: number, a: number): BallAt {
  const b = ballAt;
  const k = step - o.at + a;
  const aim = o.aim / AIM_POST;
  b.across = 0;
  b.along = 0;
  b.up = 0;
  if (o.phase === PH.FLIGHT) {
    const u = Math.min(1, k / FLIGHT);
    const u2 = o.result === KICK.SAVED ? Math.min(u, SAVE_AT) : u;
    b.across = aim * u2;
    b.along = u2;
    // (A low drive rising to about the height of a man at the line.)
    b.up = 0.05 + Math.sin(u2 * Math.PI * 0.5) * 0.32;
  } else if (o.phase === PH.AFTER) {
    const v = Math.min(1, k / AFTER_KICK);
    const fall = (from: number, by: number) => from * Math.max(0, 1 - v / by);
    switch (o.result) {
      case KICK.GOAL: {
        // Into the net, dropping and rolling to its back.
        const e = ease(Math.min(1, v / 0.25));
        b.across = aim * (1 + 0.12 * e);
        b.along = 1 + 0.22 * e;
        b.up = fall(0.37, 0.3) + Math.abs(Math.sin(Math.min(1, v / 0.5) * Math.PI)) * 0.06 * (1 - v);
        break;
      }
      case KICK.SAVED: {
        // Off the keeper's gloves, back out and away to the side.
        const e = ease(Math.min(1, v / 0.5));
        b.across = aim * SAVE_AT + Math.sign(aim || 1) * 0.45 * e;
        b.along = SAVE_AT - 0.42 * e;
        b.up = fall(0.33, 0.35);
        break;
      }
      case KICK.POST: {
        const e = ease(Math.min(1, v / 0.5));
        b.across = Math.sign(aim) * (1 + 0.5 * e);
        b.along = 1 - 0.45 * e;
        b.up = fall(0.37, 0.4);
        break;
      }
      default: {
        // Wide: on past the post and away.
        const e = ease(Math.min(1, v / 0.6));
        b.across = aim * (1 + 0.35 * e);
        b.along = 1 + 0.6 * e;
        b.up = fall(0.37, 0.5);
      }
    }
  }
  return b;
}

/** The keeper's dive now (-1 … 1 across, as the kicker sees it: how far down and which way), from the step it began. */
function diveOf(o: Pens, step: number, a: number): number {
  if (!o.dive) return 0;
  // (The player's from their press; the inmate's as the ball's struck; up again as the next kick comes.)
  const from =
    o.turn === 1 && o.dived ? o.dived : o.phase === PH.FLIGHT || o.phase === PH.AFTER ? o.at - (o.phase === PH.AFTER ? FLIGHT : 0) : -1;
  if (from < 0 || (o.phase !== PH.FLIGHT && o.phase !== PH.AFTER && !(o.turn === 1 && o.phase === PH.SET))) return 0;
  const k = (step - from + a) / 8;
  const down = Math.min(1, Math.max(0, k));
  const up = o.phase === PH.AFTER ? Math.max(0, (step - o.at + a - AFTER_KICK * 0.6) / (AFTER_KICK * 0.4)) : 0;
  return o.dive * ease(down) * (1 - Math.min(1, up));
}

// ------------------------------------------------------------------ the card

const view: PensView = {
  name: '',
  mode: 'ready',
  marker: null,
  corner: KEEPER_BASE / AIM_POST,
  keeper: true,
  keeperAt: 0,
  dive: 0,
  keeperMe: false,
  ball: null,
  result: '',
  by: 'me',
  mine: [],
  theirs: [],
  look: 0,
  run: 0,
  early: (RUN_UP - DIVE_EARLY) / RUN_UP,
  dived: null,
  corners: 0,
  of: CORNERS_A_DAY,
  clock: -1,
  note: '',
};
const cardBall = { x: 0, y: 0, s: 1 };
const RESULTS = ['', 'goal', 'saved', 'post', 'wide'] as const;

/** The tally's marks for one side's bits, `taken` kicks so far, at least the five. */
function marks(out: PenMark[], bits: number, taken: number) {
  out.length = 0;
  const n = Math.max(PEN_KICKS, taken);
  for (let k = 0; k < n; k++) out.push(k >= taken ? 'todo' : bits & (1 << k) ? 'goal' : 'miss');
}

/** The card now (null: none), between steps (`a`). */
export function pensNow(sim: Sim, a: number): PensView | null {
  const s = sim.state;
  if (s.layer !== LAYER.GROUND || s.escaped) return null;
  const o = s.pens;
  const v = view;
  if (!o) {
    // (At the spot with no ball down: the card offers a kick, on one's own.)
    if (s.player.moving || sim.away || !canPractise(sim)) return null;
    v.corner = KEEPER_BASE / AIM_POST;
    Object.assign(v, {
      name: '',
      mode: 'ready',
      marker: null,
      keeper: false,
      dive: 0,
      ball: null,
      result: '',
      look: 0,
      dived: null,
      clock: -1,
    });
    v.mine.length = v.theirs.length = 0;
    v.corners = cornersToday(s);
    v.note = TOUCH ? t('pens.readyTouch') : t('pens.readyKeys');
    return v;
  }
  const step = s.step;
  v.name = o.who >= 0 ? inmateName(sim, o.who) : '';
  // (The gold: past any keeper's reach in a shootout, the rule's own; on one's own, where a corner counts.)
  v.corner = (o.who >= 0 ? KEEPER_BASE + KEEPER_SPREAD : KEEPER_BASE) / AIM_POST;
  v.corners = cornersToday(s);
  const done = o.phase === PH.FLIGHT || o.phase === PH.AFTER;
  // The tally: a kick counts once it's arrived.
  const shown = o.phase === PH.AFTER;
  marks(v.mine, o.mine, o.k + (o.turn === 1 || (shown && o.turn === 0) ? 1 : 0));
  marks(v.theirs, o.theirs, o.k + (shown && o.turn === 1 ? 1 : 0));
  if (o.who < 0) v.mine.length = v.theirs.length = 0;
  v.keeper = o.who >= 0;
  v.keeperMe = o.turn === 1;
  v.keeperAt = 0;
  v.dive = diveOf(o, step, a);
  v.by = o.turn === 0 ? 'me' : 'him';
  v.result = shown ? RESULTS[o.result] : '';
  v.look = o.turn === 1 && o.phase === PH.SET && step - o.at >= LOOK_AT ? o.look : 0;
  v.run = o.turn === 1 && o.phase === PH.SET ? Math.min(1, (step - o.at + a) / RUN_UP) : o.turn === 1 && done ? 1 : 0;
  v.dived = o.turn === 1 && o.dived ? o.dive : null;
  v.marker = o.turn === 0 && o.phase === PH.SET ? markerOf(o, step, s.spd) / AIM_POST : null;
  // (Smooth between steps: the marker's next place, eased toward.)
  if (v.marker !== null) {
    const next = markerOf(o, step + 1, s.spd) / AIM_POST;
    if (Math.abs(next - v.marker) < 0.5) v.marker += (next - v.marker) * a;
    if (step - o.at < AIM_SETTLE) v.marker = null;
  }
  const clockLeft = o.who >= 0 && o.turn === 0 && o.phase === PH.SET ? KICK_CLOCK - (step - o.at) : -1;
  v.clock = clockLeft >= 0 && clockLeft <= 3 * STEPS_PER_SECOND ? clockLeft / (3 * STEPS_PER_SECOND) : -1;
  // The ball: on the spot, on its way, in the net or out.
  if (o.phase === PH.PLACES && o.who >= 0) v.ball = null;
  else {
    const b = ballOf(o, step, a);
    cardBall.x = b.across;
    cardBall.y = b.along;
    cardBall.s = 1 - Math.min(1, b.along) * 0.45;
    v.ball = cardBall;
  }
  v.mode = o.phase === PH.SET ? (o.turn === 0 ? 'kick' : 'keep') : 'wait';
  v.note =
    o.phase === PH.PLACES
      ? t(o.turn === 0 ? 'pens.toSpot' : 'pens.toGoal')
      : o.phase === PH.SET
        ? o.turn === 0
          ? t(o.who < 0 ? (TOUCH ? 'pens.practiceTouch' : 'pens.practiceKeys') : TOUCH ? 'pens.kickTouch' : 'pens.kickKeys')
          : o.dived
            ? t('pens.dived')
            : t(TOUCH ? 'pens.keepTouch' : 'pens.keepKeys')
        : v.result === 'goal' && o.who < 0
          ? Math.abs(o.aim) > KEEPER_BASE
            ? t('pens.cornerGoal')
            : t('pens.middleGoal')
          : '';
  const left = o.who >= 0 ? minutesLeft(s) : 99;
  if (left <= BELL_SOON) v.note = `${t('pens.bellSoon', { n: left })} ${v.note}`.trim();
  return v;
}

// ------------------------------------------------------------------ the keys

/** Space (or E, or the action button) at the spot or in a shootout: the kick, or the ball put down for one. Returns whether it was taken. */
export function kickKey(): boolean {
  const g = play.game;
  if (!g || g.replay || g.paused) return false;
  const sim = g.rec.sim;
  const o = sim.state.pens;
  if (o) {
    if (o.who >= 0 && o.turn === 1) return true;
    sendOp(OP.EXT, EXT.KICK, 0);
    return true;
  }
  if (sim.state.player.moving || !canPractise(sim)) return false;
  sendOp(OP.EXT, EXT.KICK, 0);
  return true;
}

/** A dive key in goal (c: 0 left, 1 stay, 2 right). Returns whether it was taken. */
export function diveKey(c: number): boolean {
  const g = play.game;
  if (!g || g.replay || g.paused) return false;
  const o = g.rec.sim.state.pens;
  if (!o || o.who < 0 || o.turn !== 1) return false;
  if (o.phase === PH.SET && !o.dived) sendOp(OP.EXT, EXT.KICK, 2, c);
  return true;
}

/** Whether the shootout has the keys (the moves are the shootout's: the player walks to places on their own). */
export const pensHasKeys = (sim: Sim) => !!sim.state.pens && sim.state.pens.who >= 0;

// ------------------------------------------------------------------ the events

export function announcePens(sim: Sim, e: Extract<SimEvent, { type: 'pens' }>) {
  const g = play.game;
  const name = e.who >= 0 ? inmateName(sim, e.who) : '';
  const score = { m: e.mine ?? 0, n: e.theirs ?? 0 };
  switch (e.what) {
    case 'start':
      coachOnce('pens', TOUCH ? 'hint.pensTouch' : 'hint.pens');
      sound.whistle();
      itemsUI.toast(t('toast.pensStart', { name }));
      break;
    case 'practice':
      coachOnce('pensPractice', 'hint.pensPractice');
      break;
    case 'kick':
      sound.kick(0.8);
      if (e.early) itemsUI.toast(t('toast.pensEarly', { name }));
      break;
    case 'result': {
      const mine = e.by === -1;
      if (e.result === KICK.GOAL) {
        sound.swish();
        if (e.who >= 0) sound.cheer();
        if (mine) {
          buzz('attended');
          floatUp(t('toast.goal'), 'gain');
        } else if (e.who >= 0) buzz('missed');
      } else if (e.result === KICK.SAVED) {
        sound.slap();
        if (!mine) {
          buzz('attended');
          floatUp(t('pens.saved'), 'gain');
          sound.cheer();
        }
      } else if (e.result === KICK.POST) sound.rimClang();
      else sound.whoosh();
      break;
    }
    case 'won':
      sound.whistle();
      window.setTimeout(() => {
        if (play.game !== g) return;
        sound.levelUp();
        if ((e.crowd ?? 0) > 0) sound.cheer();
        if (e.spd) floatUp(`+1 ${t('attr.spdShort')}`, 'gain');
        const parts = [
          e.spd ? t('toast.partSpd') : t('toast.partSpdTop'),
          e.gain ? t('toast.partOpinion', { name, n: e.gain }) : '',
          e.crowd ? t('toast.partCrowd', { m: PEN_CROWD_OPINION }) : '',
        ].filter(Boolean);
        banner.toast(`${t('toast.pensWon', score)} ${parts.join(', ')}`, 'good', 4200);
      }, 500);
      break;
    case 'lost':
      sound.whistle();
      window.setTimeout(
        () => play.game === g && (sound.sting(), banner.toast(t('toast.pensLost', { name, m: score.n, n: score.m }), 'bad', 3600)),
        500,
      );
      break;
    case 'draw':
      sound.whistle();
      window.setTimeout(() => play.game === g && banner.toast(t('toast.pensDraw', score), undefined, 3600), 500);
      break;
    case 'off':
      if (!sim.state.escaped) itemsUI.toast(t('toast.pensOff'));
      break;
    case 'bell':
      sound.whistle();
      banner.toast(t('toast.pensBell', score), undefined, 3600);
      break;
    case 'corners':
      sound.levelUp();
      if (e.spd) floatUp(`+1 ${t('attr.spdShort')}`, 'gain');
      banner.toast(e.spd ? t('toast.pensCorners', { n: CORNERS_A_DAY }) : t('toast.pensCornersTop', { n: CORNERS_A_DAY }), 'good', 3600);
      break;
  }
}

// ------------------------------------------------------------------ the picture

const frame: PitchFrame = { pitch: null, theme: '', ball: null, spot: null, keeper: null, frame: null };
const box: Pitch = { x: 0, z: 0, w: 0, d: 0 };
let boxOf: Pitch | null = null;
const ball3 = { x: 0, y: 0, z: 0 };
const spot3 = { x: 0, z: 0 };
const keeper3 = { who: -1, dive: 0, x: 0, z: 0 };

/** What the 3D shows of the pitch this frame: its paint and goals, the spot, the ball and the keeper's dive (`a`: between steps). */
export function pitchFrameOf(sim: Sim, a: number): PitchFrame {
  const p = pitchOf(sim);
  frame.pitch = p;
  frame.theme = sim.world.def.theme ?? 'suburban';
  frame.ball = null;
  frame.keeper = null;
  frame.spot = null;
  frame.frame = null;
  if (!p) return frame;
  const g = goalOf(p);
  // (In a shootout, the camera keeps the spot, the goal and its net in the picture.)
  if (sim.state.pens && sim.state.pens.who >= 0) {
    if (boxOf !== p) Object.assign(box, shootoutBox(p));
    boxOf = p;
    frame.frame = box;
  }
  spot3.x = (g.along ? g.spot : g.mid) / UNIT;
  spot3.z = (g.along ? g.mid : g.spot) / UNIT;
  frame.spot = spot3;
  const o = sim.state.pens;
  if (!o || (o.phase === PH.PLACES && o.who >= 0)) return frame;
  // The ball: from the spot along the kick's way to the goal line (and on), across by the aim, up off the ground.
  const b = ballOf(o, sim.state.step, a);
  const along = g.spot + (g.line - g.spot) * b.along;
  // (Across as the kicker sees it: his left is `left` across the field.)
  const across = g.mid - g.left * b.across * UNIT;
  ball3.x = (g.along ? along : across) / UNIT;
  ball3.z = (g.along ? across : along) / UNIT;
  ball3.y = b.up;
  frame.ball = ball3;
  // The keeper's dive: across the goal, the way the kicker sees it (the world's way given for the model to roll toward).
  const d = diveOf(o, sim.state.step, a);
  if (o.who >= 0 && d) {
    keeper3.who = o.turn === 0 ? o.who : -1;
    keeper3.dive = Math.abs(d);
    const side = -g.left * Math.sign(d);
    keeper3.x = g.along ? 0 : side;
    keeper3.z = g.along ? side : 0;
    frame.keeper = keeper3;
  }
  return frame;
}

/** The kicker winding up (the player in their kick's set phase; the inmate in his run-up's last steps): who (-1 the player, an inmate, -2 nobody). */
export function windingUp(sim: Sim): number {
  const o = sim.state.pens;
  if (!o || o.phase !== PH.SET) return -2;
  if (o.turn === 0) return -1;
  return sim.state.step - o.at >= RUN_UP - 4 ? o.who : -2;
}
