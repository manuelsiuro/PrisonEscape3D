import { buzz } from '../app/haptics';
import { DESIGNS, FRIEND_INK, GOAL_PAUSE, INK_HEAT, INK_ME_STEPS, INK_OPINION, KICK_HOLD, KICK_REACH, LEAD_IN, MATCH_STEPS, TEAM_CROWD_OPINION } from '../content/team';
import { GAMES_A_DAY } from '../content/games';
import { t, type Key } from '../i18n';
import { EXT, OP } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import { eyesOn } from '../sim/systems/games';
import { kickPower, matchRefusal, pitchOf, TEAM } from '../sim/systems/football';
import { inkRefusal, payOf, qualityOf, TATTOO_GUN, traceSteps, penAt } from '../sim/systems/tattoo';
import { HOTBAR, itemOf } from '../sim/systems/items';
import { STEPS_PER_SECOND, UNIT } from '../sim/tuning';
import { LAYER } from '../sim/world/World';
import type { InkView, MatchView } from '../ui/team';
import type { TeamFrame } from '../render/Team';
import { inmateName } from '../ui/social';
import { banner, combatUI, itemsUI, sound, view } from './context';
import { play, sendOp } from './game';
import { coachOnce } from './tips';
import { TOUCH } from '../ui/dom';

/**
 * Team & ink (P29) on screen: the match's card and the tattoo's, filled from the sim; the talk
 * panel's rows for them; Space (or the Kick pad) for a kick; the sounds and toasts of their
 * events; what the picture shows of the ball. The sim's own functions decide everything shown.
 */

const nameOf = (sim: Sim, who: number) => inmateName(sim, who);

const floatPoint = { x: 0, y: 0 };
function floatUp(text: string, kind: 'cash' | 'gain' | 'taken') {
  const at = view.screenOf(-1, floatPoint);
  if (at) combatUI.float(text, at.x, at.y, kind);
}

/** The line the needle has inked (its points, the sitting's steps it was taken at): the card draws it. Not state. */
const trail: Array<[number, number]> = [];
let trailStep = -1;
/** The last goal, as the card says it a moment. */
let lastGoal = { ours: false, by: '' };

/** A new game (or a load): nothing to show. */
export function resetTeam() {
  trail.length = 0;
  trailStep = -1;
  kicking = false;
  lastGoal = { ours: false, by: '' };
}

// ------------------------------------------------------------------ the talk panel's rows

/** The match on offer with the inmate talked to: there's a pitch; he'd play now (else why not). */
export function footballOffer(sim: Sim, who: number): { open: boolean; why: string } | null {
  if (!pitchOf(sim)) return null;
  const why = matchRefusal(sim, who);
  return { open: !why, why: why ? refusalText(why) : t('football.note') };
}

/** The tattoo rows with the inmate talked to (null without a gun in the hotbar): the designs for him (their prices), one from him on the player's arm. */
export function inkOffer(sim: Sim, who: number): { why: string; designs: Array<{ k: number; price: number }>; mineWhy: string; inked: number[] } | null {
  const s = sim.state;
  if (!s.items.inv.slice(0, HOTBAR).some((v) => itemOf(v) === TATTOO_GUN)) return null;
  const why = inkRefusal(sim, who, false);
  // (The player's own: the first design they haven't got decides the note; each button checks its own.)
  const mineWhy = inkRefusal(sim, who, true, DESIGNS.findIndex((_, k) => !s.inked.includes(k)));
  return { why: why ? refusalText(why) : '', designs: DESIGNS.map((d, k) => ({ k, price: d.price })), mineWhy: mineWhy ? refusalText(mineWhy) : '', inked: s.inked };
}

/** Why not, in words (the talk panel's notes). */
function refusalText(why: string): string {
  switch (why) {
    case 'gamesClosed':
      return t('games.closed');
    case 'gamesLockdown':
      return t('refused.gamesLockdown');
    case 'gameOpinion':
      return t('games.needOpinion', { n: 40 });
    case 'played':
      return t('games.playedOut', { n: GAMES_A_DAY });
    case 'seated':
      return t('refused.seated');
    case 'inkOpinion':
      return t('refused.inkOpinion', { n: INK_OPINION });
    case 'inkFriend':
      return t('refused.inkFriend', { n: FRIEND_INK });
    default:
      return t(`refused.${why}` as Key);
  }
}

// ------------------------------------------------------------------ the match's card

const matchView: MatchView = { name: '', phase: 'gather', left: 0, score: [0, 0], ours: false, by: '', holding: false, power: 0, atFeet: false, mates: [], rivals: [] };

/** The match under way (null: none), between steps (`a`). */
export function matchNow(sim: Sim, a: number): MatchView | null {
  const s = sim.state;
  const o = s.match;
  if (!o || s.layer !== LAYER.GROUND) return null;
  const v = matchView;
  v.name = nameOf(sim, o.who);
  v.phase = !o.at ? 'gather' : o.pause ? 'goal' : 'play';
  const played = o.at ? s.step - o.at : 0;
  v.left = Math.max(0, Math.ceil((MATCH_STEPS - played) / STEPS_PER_SECOND));
  v.score = [o.goals[0], o.goals[1]];
  v.ours = lastGoal.ours;
  v.by = lastGoal.by;
  v.holding = o.hold > 0;
  v.power = o.hold ? (kickPower(s.step - o.hold + a) - kickPower(0)) / (kickPower(KICK_HOLD) - kickPower(0)) : 0;
  const [bx, bz] = o.ball;
  v.atFeet = !!o.at && !o.pause && (bx - s.player.x) ** 2 + (bz - s.player.z) ** 2 <= KICK_REACH * KICK_REACH;
  v.mates = [o.team[TEAM.KEEPER], o.team[TEAM.MATE]].map((k) => nameOf(sim, k));
  v.rivals = [o.team[TEAM.CAPTAIN], o.team[TEAM.RIVAL], o.team[TEAM.RIVAL_KEEPER]].map((k) => nameOf(sim, k));
  return v;
}

// ------------------------------------------------------------------ the tattoo's card

const inkView: InkView = { name: '', design: 0, mine: false, pen: [0, 0], needle: [0, 0], trail, progress: 0, lead: true, quality: 100, pays: 0, seen: false };

/** The sitting under way (null: none). */
export function inkNow(sim: Sim): InkView | null {
  const s = sim.state;
  const o = s.ink;
  if (!o) return null;
  const v = inkView;
  v.name = nameOf(sim, o.who);
  v.design = o.design;
  v.mine = !!o.mine;
  v.seen = !!o.seen;
  if (o.mine) {
    v.progress = Math.min(1, o.k / INK_ME_STEPS);
    return v;
  }
  // (Each step's needle point onto the line, once the pen's off.)
  if (o.k !== trailStep) {
    if (o.k < trailStep || o.k <= 1) trail.length = 0;
    trailStep = o.k;
    if (o.k > LEAD_IN) trail.push([o.nx, o.nz]);
  }
  penAt(o.design, o.k + 1, v.pen);
  v.needle[0] = o.nx;
  v.needle[1] = o.nz;
  v.lead = o.k < LEAD_IN;
  v.progress = Math.max(0, Math.min(1, (o.k - LEAD_IN) / (traceSteps(o.design) - LEAD_IN)));
  v.quality = qualityOf(o.err, Math.max(1, o.k - LEAD_IN));
  v.pays = payOf(o.design, v.quality);
  return v;
}

// ------------------------------------------------------------------ Space and the Kick pad

/** Space (or the Kick pad) held and let go in a match: the kick. Returns whether it was taken as one. */
export function kickKey(down: boolean): boolean {
  const g = play.game;
  if (!g || g.paused || g.replay) return false;
  const s = g.rec.sim.state;
  if (!down) {
    if (!kicking) return false;
    kicking = false;
    sendOp(OP.EXT, EXT.KICK, 1);
    return true;
  }
  if (!s.match || s.layer !== LAYER.GROUND) return false;
  if (!kicking) sendOp(OP.EXT, EXT.KICK, 0);
  kicking = true;
  return true;
}
/** A kick held from the keys or the pad (its release is owed). */
let kicking = false;

// ------------------------------------------------------------------ the events

export function announceTeam(sim: Sim, e: SimEvent) {
  const g = play.game;
  switch (e.type) {
    case 'football': {
      const name = e.who !== undefined && e.who >= 0 ? nameOf(sim, e.who) : '';
      const sc = e.score ?? [0, 0];
      if (e.what === 'start') {
        coachOnce('football', 'hint.football');
        itemsUI.toast(t('toast.footballStart', { name }));
      } else if (e.what === 'kickoff' || e.what === 'restart') sound.whistle();
      else if (e.what === 'kick') {
        sound.kick(Math.min(1, ((e.power ?? 0) - kickPower(0)) / (kickPower(KICK_HOLD) - kickPower(0))));
        kicking = false;
      } else if (e.what === 'whiff') {
        sound.whoosh();
        kicking = false;
      } else if (e.what === 'goal') {
        lastGoal = { ours: !!e.mine, by: e.by === undefined || e.by < 0 ? '' : nameOf(sim, e.by) };
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
      const name = nameOf(sim, e.who);
      const design = t(`design.${DESIGNS[e.design]?.id ?? 'heart'}` as Key);
      if (e.what === 'start') {
        trail.length = 0;
        trailStep = -1;
        coachOnce(e.mine ? 'inkMe' : 'tattoo', e.mine ? 'hint.inkMe' : TOUCH ? 'hint.tattooTouch' : 'hint.tattoo');
        sound.needle();
      } else if (e.what === 'done') {
        sound.coin((e.pay ?? 0) >= 30);
        if ((e.quality ?? 0) >= 90) sound.levelUp();
        floatUp(`+$${e.pay ?? 0}`, 'cash');
        banner.toast(t('toast.tattooDone', { name, design, q: e.quality ?? 0, n: e.pay ?? 0, g: e.gain ?? 0 }), (e.quality ?? 0) >= 50 ? 'good' : undefined, 4200);
      } else if (e.what === 'inked') {
        sound.levelUp();
        banner.toast(t('toast.inked', { name, design }), 'good', 4200);
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

const frame: TeamFrame = { pitch: null, ball: null };
const ballAt = { x: 0, z: 0, moving: false };

/** What the 3D shows of P29 this frame: the pitch, the ball where it is between steps (`a`). */
export function teamFrameOf(sim: Sim, a: number): TeamFrame {
  const o = sim.state.match;
  frame.pitch = pitchOf(sim);
  if (!o) {
    frame.ball = null;
    return frame;
  }
  const [x, z, vx, vz] = o.ball;
  ballAt.x = (x + vx * a) / UNIT;
  ballAt.z = (z + vz * a) / UNIT;
  ballAt.moving = vx !== 0 || vz !== 0;
  frame.ball = ballAt;
  return frame;
}

/** The heat a sitting under a guard's eye would cost (for the talk panel's warning): INK_HEAT if seen now, else 0. */
export const inkHeatNow = (sim: Sim) => (eyesOn(sim.state, sim.state.step) ? INK_HEAT : 0);

