import { buzz } from '../app/haptics';
import { DESIGNS, GOAL_PAUSE, INK_HEAT, INK_ME_STEPS, INK_TIME, KICK_HOLD, KICK_REACH, LEAD_IN, RING_AHEAD, TEAM_CROWD_OPINION } from '../content/team';
import { GAME_OPINION, GAMES_A_DAY } from '../content/games';
import { t, type Key } from '../i18n';
import { EXT, needleArgs, OP } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import { eyesOn } from '../sim/systems/games';
import { kickPower, matchRefusal, matchSteps, pitchOf, sideOf, TEAM } from '../sim/systems/football';
import { inkRefusal, lineQuality, payOf, penAt, pointAt, qualityOf, ringAt, TATTOO_GUN, tracedShare, traceSteps } from '../sim/systems/tattoo';
import { HOTBAR, itemOf } from '../sim/systems/items';
import { STEPS_PER_MINUTE, STEPS_PER_SECOND, UNIT } from '../sim/tuning';
import { routineEnd } from '../content/routine';
import { LAYER } from '../sim/world/World';
import type { InkView, MatchView } from '../ui/team';
import type { TeamFrame } from '../render/Team';
import { banner, inkCard, itemsUI, sound } from './context';
import { play, sendOp } from './game';
import { coachOnce } from './tips';
import { TOUCH } from '../ui/dom';
import { floatUp } from './floats';
import { refusedText } from './refusals';
import { inmateName } from '../ui/names';

/**
 * Team & ink (P29) on screen: the match's card and the tattoo's, filled from the sim; the talk
 * panel's rows for them; Space (or the Kick pad) for a kick; the sounds and toasts of their
 * events; what the picture shows of the ball. The sim's own functions decide everything shown.
 */


/** The line the needle has inked (its points, each inked on from the last or the needle set down there; the sitting's step and inked steps it was taken at): the card draws it. Not state. */
const trail: Array<[number, number, boolean]> = [];
let trailStep = -1;
let trailInked = 0;
/** The last goal, as the card says it a moment. */
let lastGoal = { ours: false, by: '', own: false };
/** When the ball was last at the player's feet (ms): the card's word on it held half a second, never flickering. */
let feetAt = -1e9;

/** A new game (or a load): nothing to show. */
export function resetTeam() {
  trail.length = 0;
  trailStep = -1;
  trailInked = 0;
  kicking = false;
  pressed = false;
  lastGoal = { ours: false, by: '', own: false };
  feetAt = -1e9;
}

// ------------------------------------------------------------------ the talk panel's rows

/** The match on offer with the inmate talked to: there's a pitch; he'd play now (else why not). */
export function footballOffer(sim: Sim, who: number): { open: boolean; why: string } | null {
  if (!pitchOf(sim)) return null;
  const why = matchRefusal(sim, who);
  // (Away from the pitch, no row at all: it's only for when one could play.)
  if (why === 'noPitch') return null;
  return { open: !why, why: why ? refusalText(sim, why) : t('football.note') };
}

/** The tattoo rows with the inmate talked to (null without a gun in the hotbar): the designs for him (their prices), one from him on the player's arm. */
export function inkOffer(sim: Sim, who: number): { why: string; designs: Array<{ k: number; price: number }>; mineWhy: string; inked: number[] } | null {
  const s = sim.state;
  if (!s.items.inv.slice(0, HOTBAR).some((v) => itemOf(v) === TATTOO_GUN)) return null;
  const why = inkRefusal(sim, who, false);
  // (The player's own: the first design they haven't got decides the note; each button checks its own.)
  const mineWhy = inkRefusal(sim, who, true, DESIGNS.findIndex((_, k) => !s.inked.includes(k)));
  return { why: why ? refusalText(sim, why) : '', designs: DESIGNS.map((d, k) => ({ k, price: d.price })), mineWhy: mineWhy ? refusalText(sim, mineWhy) : '', inked: s.inked };
}

/** Why not, in words (the talk panel's notes). */
function refusalText(sim: Sim, why: string): string {
  switch (why) {
    case 'gamesClosed':
      return t('games.closed');
    case 'gamesLockdown':
      return t('refused.gamesLockdown');
    case 'gameOpinion':
      return t('games.needOpinion', { n: GAME_OPINION });
    case 'played':
      return t('games.playedOut', { n: GAMES_A_DAY });
    case 'seated':
      return t('refused.seated');
    default:
      return refusedText(sim, why);
  }
}

// ------------------------------------------------------------------ the match's card

const matchView: MatchView = { name: '', phase: 'gather', left: 0, of: 0, score: [0, 0], ours: false, by: '', own: false, holding: false, power: 0, atFeet: false, mates: [], rivals: [] };

/** The match under way (null: none), between steps (`a`). */
export function matchNow(sim: Sim, a: number): MatchView | null {
  const s = sim.state;
  const o = s.match;
  if (!o || s.layer !== LAYER.GROUND) return null;
  const v = matchView;
  v.name = inmateName(sim, o.who);
  v.phase = !o.at ? 'gather' : o.pause ? 'goal' : 'play';
  // (Full time, or the bell for the next block if it comes first: the match ends there, so the clock does too.)
  const from = o.at || s.step;
  const bell = s.step + ((routineEnd(s.routine) - sim.clock.minuteOfDay + 1440) % 1440) * STEPS_PER_MINUTE - (s.step % STEPS_PER_MINUTE);
  const end = Math.min(from + matchSteps(sim), bell);
  v.of = Math.max(1, (end - from) / STEPS_PER_SECOND);
  v.left = Math.max(0, Math.ceil((end - s.step) / STEPS_PER_SECOND));
  v.score = [o.goals[0], o.goals[1]];
  v.ours = lastGoal.ours;
  v.by = lastGoal.by;
  v.own = lastGoal.own;
  v.holding = o.hold > 0;
  v.power = o.hold ? (kickPower((o.late || s.step + a) - o.hold) - kickPower(0)) / (kickPower(KICK_HOLD) - kickPower(0)) : 0;
  const [bx, bz] = o.ball;
  const now = performance.now();
  if (o.at && !o.pause && o.kick !== 1 && (bx - s.player.x) ** 2 + (bz - s.player.z) ** 2 <= KICK_REACH * KICK_REACH) feetAt = now;
  v.atFeet = !!o.at && !o.pause && now - feetAt < 500;
  v.mates = [o.team[TEAM.KEEPER], o.team[TEAM.MATE]].map((k) => inmateName(sim, k));
  v.rivals = [o.team[TEAM.CAPTAIN], o.team[TEAM.RIVAL], o.team[TEAM.RIVAL_KEEPER]].map((k) => inmateName(sim, k));
  return v;
}

// ------------------------------------------------------------------ the tattoo's card

const inkView: InkView = { name: '', design: 0, mine: false, pen: [0, 0], needle: [0, 0], next: [], trail, progress: 0, lead: true, left: 0, quality: 100, pays: 0, seen: false };
/** The design's stretch ahead of what's traced, as far as NEXT_SPAN (box units): the card draws it bold. */
const NEXT_SPAN = 260;
const nextPoints: Array<[number, number]> = [];
/** The needle as the last two steps left it (the card draws it between them). Not state. */
const needleSteps = { k: -1, x0: 0, y0: 0, x1: 0, y1: 0 };

/** The sitting under way (null: none), between steps (`a`). */
export function inkNow(sim: Sim, a: number): InkView | null {
  const s = sim.state;
  const o = s.ink;
  if (!o) return null;
  const v = inkView;
  v.name = inmateName(sim, o.who);
  v.design = o.design;
  v.mine = !!o.mine;
  v.seen = !!o.seen;
  if (o.mine) {
    v.progress = Math.min(1, o.k / INK_ME_STEPS);
    return v;
  }
  // (Each step's needle point onto the line: inked on, or set down; before 2.22, every step once the pen's off.)
  if (o.k !== trailStep) {
    if (o.k < trailStep || o.k <= 1) {
      trail.length = 0;
      trailInked = 0;
    }
    trailStep = o.k;
    const last = trail[trail.length - 1];
    if (sim.rules221) {
      if (o.k > LEAD_IN) trail.push([o.nx, o.nz, true]);
    } else if (!last || last[0] !== o.nx || last[1] !== o.nz) trail.push([o.nx, o.nz, o.n > trailInked]);
    trailInked = o.n;
  }
  const st = needleSteps;
  if (o.k !== st.k) {
    const after = o.k === st.k + 1;
    Object.assign(st, { k: o.k, x0: after ? st.x1 : o.nx, y0: after ? st.y1 : o.nz, x1: o.nx, y1: o.nz });
  }
  v.needle[0] = Math.round(st.x0 + (st.x1 - st.x0) * a);
  v.needle[1] = Math.round(st.y0 + (st.y1 - st.y0) * a);
  nextPoints.length = 0;
  v.next = nextPoints;
  if (sim.rules221) {
    penAt(o.design, o.k + 1, v.pen);
    v.lead = o.k < LEAD_IN;
    v.progress = Math.max(0, Math.min(1, (o.k - LEAD_IN) / (traceSteps(o.design) - LEAD_IN)));
    v.quality = qualityOf(o.err, Math.max(1, o.k - LEAD_IN));
    v.left = 0;
  } else {
    ringAt(o, RING_AHEAD, v.pen);
    for (let d = 0; d <= NEXT_SPAN; d += 20) nextPoints.push(pointAt(o.design, o.at + d));
    v.lead = false;
    v.progress = tracedShare(o);
    // (The line so far: a needle not yet at work, a clean one.)
    v.quality = o.n ? lineQuality(o.err, o.n) : 100;
    const left = Math.ceil((INK_TIME - o.k) / STEPS_PER_SECOND);
    v.left = left <= 10 ? Math.max(0, left) : 0;
  }
  v.pays = payOf(o.design, v.quality);
  return v;
}

/** The needle's op this step (2.22): with the finger or the mouse down on the design, the needle set down where it first touched, then drawn after it. Null otherwise. */
export function needleOp(sim: Sim): [number, number, number, number] | null {
  const o = sim.state.ink;
  const p = inkCard.touch;
  if (!o || o.mine || !p.down || sim.rules221) return null;
  const [b, c] = needleArgs(p.x, p.y);
  const fresh = p.fresh;
  p.fresh = false;
  return [OP.EXT, fresh ? EXT.NEEDLE_DOWN : EXT.NEEDLE, b, c];
}

// ------------------------------------------------------------------ Space and the Kick pad

/**
 * Space (or the Kick pad) held and let go in a match: the kick. Returns whether it was taken as
 * one. (Let go while paused, or the focus lost: the release still goes, taken on the resume, so a
 * kick never stays armed with nothing held.)
 */
export function kickKey(down: boolean): boolean {
  const g = play.game;
  if (!g || g.replay) return false;
  const s = g.rec.sim.state;
  if (!down) {
    pressed = false;
    if (!kicking) return false;
    kicking = false;
    sendOp(OP.EXT, EXT.KICK, 1);
    return true;
  }
  if (g.paused || !s.match || s.layer !== LAYER.GROUND) return false;
  pressed = true;
  if (!kicking) sendOp(OP.EXT, EXT.KICK, 0);
  kicking = true;
  return true;
}
/** A kick held from the keys or the pad (its release is owed); the key or pad still down (2.16: a kick on contact goes, and the next one is armed while it's held). */
let kicking = false;
let pressed = false;

// ------------------------------------------------------------------ the events

export function announceTeam(sim: Sim, e: SimEvent) {
  const g = play.game;
  switch (e.type) {
    case 'football': {
      const name = e.who !== undefined && e.who >= 0 ? inmateName(sim, e.who) : '';
      const sc = e.score ?? [0, 0];
      if (e.what === 'start') {
        coachOnce('football', TOUCH ? 'hint.footballTouch' : 'hint.football');
        itemsUI.toast(t('toast.footballStart', { name }));
      } else if (e.what === 'kickoff' || e.what === 'restart') sound.whistle();
      else if (e.what === 'kick') {
        sound.kick(Math.min(1, ((e.power ?? 0) - kickPower(0)) / (kickPower(KICK_HOLD) - kickPower(0))));
        // (Still held: the next kick armed, for the next touch of the ball.)
        kicking = pressed && !!sim.state.match && !g?.paused;
        if (kicking) sendOp(OP.EXT, EXT.KICK, 0);
      } else if (e.what === 'whiff') {
        sound.whoosh();
        kicking = false;
      } else if (e.what === 'goal') {
        // (Whose side the scorer is on against the net it went in: an own goal said so.)
        const place = e.by === undefined || e.by < 0 ? -1 : (sim.state.match?.team.indexOf(e.by) ?? -1);
        const side = place < 0 ? 0 : sideOf(place);
        lastGoal = { ours: !!e.mine, by: e.by === undefined || e.by < 0 ? '' : inmateName(sim, e.by), own: (side === 0) !== !!e.mine };
        sound.swish();
        sound.cheer();
        if (e.mine) {
          buzz('attended');
          if (e.by === -1) floatUp(t('toast.goal'), 'gain');
        } else buzz('missed');
        window.setTimeout(() => play.game === g && sound.whistle(), (GOAL_PAUSE / STEPS_PER_SECOND) * 1000 - 120);
      } else if (e.what === 'won') {
        sound.whistle();
        window.setTimeout(() => {
          if (play.game !== g) return;
          sound.levelUp();
          if ((e.crowd ?? 0) > 0) sound.cheer();
          if (e.spd) floatUp(`+1 ${t('attr.spdShort')}`, 'gain');
          const parts = [e.spd ? t('toast.partSpd') : t('toast.partSpdTop'), e.crowd ? t('toast.partCrowd', { m: TEAM_CROWD_OPINION }) : ''].filter(Boolean);
          banner.toast(`${t('toast.matchWon', { m: sc[0], n: sc[1] })} ${parts.join(', ')}`, 'good', 4200);
        }, 500);
      } else if (e.what === 'lost') {
        sound.whistle();
        window.setTimeout(() => play.game === g && (sound.sting(), banner.toast(t('toast.matchLost', { name, m: sc[1], n: sc[0] }), 'bad', 3600)), 500);
      } else if (e.what === 'draw') {
        sound.whistle();
        window.setTimeout(() => play.game === g && banner.toast(t('toast.matchDraw', { m: sc[0], n: sc[1] }), undefined, 3600), 500);
      } else if (e.what === 'foul') {
        sound.whistle();
        sound.sting();
        banner.toast(t('toast.matchFoul', { name }), 'bad', 4200);
      } else if (e.what === 'off' && !sim.state.escaped) itemsUI.toast(t('toast.matchOff'));
      break;
    }
    case 'tattoo': {
      const name = inmateName(sim, e.who);
      const design = t(`design.${DESIGNS[e.design]?.id ?? 'heart'}` as Key);
      const designA = t(`designA.${DESIGNS[e.design]?.id ?? 'heart'}` as Key);
      if (e.what === 'start') {
        trail.length = 0;
        trailStep = -1;
        trailInked = 0;
        coachOnce(e.mine ? 'inkMe' : 'tattoo', e.mine ? 'hint.inkMe' : TOUCH ? 'hint.tattooTouch' : 'hint.tattoo');
        sound.needle();
      } else if (e.what === 'done') {
        sound.coin((e.pay ?? 0) >= 30);
        if ((e.quality ?? 0) >= 90) sound.levelUp();
        floatUp(`+$${e.pay ?? 0}`, 'cash');
        banner.toast(t('toast.tattooDone', { name, design, q: e.quality ?? 0, n: e.pay ?? 0, g: e.gain ?? 0 }), (e.quality ?? 0) >= 50 ? 'good' : undefined, 4200);
      } else if (e.what === 'inked') {
        sound.levelUp();
        banner.toast(t('toast.inked', { name, design: designA }), 'good', 4200);
      } else if (e.what === 'quit') itemsUI.toast(t(e.mine ? 'toast.inkMeQuit' : 'toast.tattooQuit', { name }));
      else if (e.what === 'off' && !sim.state.escaped) itemsUI.toast(t('toast.tattooOff', { name }));
      break;
    }
  }
}

/** The tattoo gun's buzz while it works (every frame: a buzz every quarter second). */
let lastBuzz = 0;
export function teamSounds(sim: Sim, paused: boolean) {
  if (!sim.state.ink || paused) return;
  const now = performance.now();
  if (now - lastBuzz < 240) return;
  lastBuzz = now;
  sound.needle(sim.state.ink.mine ? 0.7 : 1);
}

// ------------------------------------------------------------------ the picture

const frame: TeamFrame = { pitch: null, theme: '', ball: null, mates: [], rivals: [] };
/** The ball as the last two steps left it (the picture draws it between them, as it draws everyone). Not state. */
const ballSteps = { step: -1, x0: 0, z0: 0, x1: 0, z1: 0 };
const NONE: number[] = [];
const mates: number[] = [];
const rivals: number[] = [];
const ballAt = { x: 0, z: 0, moving: false };

/** What the 3D shows of P29 this frame: the pitch, the ball where it is between steps (`a`). */
export function teamFrameOf(sim: Sim, a: number): TeamFrame {
  const o = sim.state.match;
  frame.pitch = pitchOf(sim);
  frame.theme = sim.world.def.theme ?? 'suburban';
  if (!o) {
    ballSteps.step = -1;
    frame.ball = null;
    frame.mates = frame.rivals = NONE;
    return frame;
  }
  mates.length = rivals.length = 0;
  o.team.forEach((k, i) => (i < 2 ? mates : rivals).push(k));
  frame.mates = mates;
  frame.rivals = rivals;
  const [x, z, vx, vz] = o.ball;
  // (A new step: the last one's place becomes the one it's drawn from; a jump, back to the spot or into the net, isn't eased.)
  const st = sim.state.step;
  if (ballSteps.step !== st) {
    const jump = ballSteps.step < 0 || st - ballSteps.step > 1 || Math.abs(x - ballSteps.x1) + Math.abs(z - ballSteps.z1) > 2 * UNIT;
    ballSteps.x0 = jump ? x : ballSteps.x1;
    ballSteps.z0 = jump ? z : ballSteps.z1;
    ballSteps.x1 = x;
    ballSteps.z1 = z;
    ballSteps.step = st;
  }
  ballAt.x = (ballSteps.x0 + (x - ballSteps.x0) * a) / UNIT;
  ballAt.z = (ballSteps.z0 + (z - ballSteps.z0) * a) / UNIT;
  ballAt.moving = vx !== 0 || vz !== 0;
  frame.ball = ballAt;
  return frame;
}

/** The heat a sitting under a guard's eye would cost (for the talk panel's warning): INK_HEAT if seen now, else 0. */
export const inkHeatNow = (sim: Sim) => (eyesOn(sim.state, sim.state.step) ? INK_HEAT : 0);

