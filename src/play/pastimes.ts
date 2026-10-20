import { buzz } from '../app/haptics';
import { CHIPS, CROWD_OPINION, ELDER_OPINION, PRACTICE_MAKES, SHOOT_SPOTS, STAKES, SUDDEN_DEATH } from '../content/games';
import { t, type Key } from '../i18n';
import { EXT, OP } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import { canCall, canPlay, tellOf } from '../sim/systems/cards';
import { elderOf, elderRefusal, PIECE, stepsOf, type Step } from '../sim/systems/checkers';
import { prisonDay } from '../sim/systems/clock';
import { courtOf, powerAt, rimOf, shotWindow, spotAt, spotOf, windAlong, type ShotResult } from '../sim/systems/hoops';
import { DOING } from '../sim/systems/inmates';
import { today } from '../sim/systems/calendar';
import { UNIT } from '../sim/tuning';
import { LAYER, MAP_W } from '../sim/world/World';
import type { PastimesFrame } from '../render/Pastimes';
import type { BoardView, CheatView, CourtView } from '../ui/pastimes';
import { inmateName } from '../ui/social';
import { banner, cheatCard, combatUI, courtCard, itemsUI, matchCard, sound, stageCard, view } from './context';
import { lanePress, setLaneFlash } from './nights';
import { kickKey } from './team';
import { play, sendOp } from './game';
import { coachOnce } from './tips';
import { director } from './chatter';
import { TOUCH } from '../ui/dom';
import { PausableClock } from './pausableClock';

/**
 * Card sharks (P27) on screen: Cheat's card, the court's card and the old-timer's board, filled
 * from the sim; the sounds, toasts and floats of their events; and what the picture shows (the
 * ball in the hands and in flight, the cards on the ground between the two, the board). The
 * sim's own functions (cards.ts, hoops.ts, checkers.ts) decide everything shown.
 */

const nameOf = (sim: Sim, who: number) => inmateName(sim, who);

/** A number (or word) floating up from the player. */
const floatPoint = { x: 0, y: 0 };
function floatUp(text: string, kind: 'cash' | 'gain' | 'taken') {
  const at = view.screenOf(-1, floatPoint);
  if (at) combatUI.float(text, at.x, at.y, kind);
}

// ------------------------------------------------------------------ what's shown between steps

/** A call's cards turned over, while the sim holds them up (and the game's last, for a moment after it ends). */
const reveal = { cards: [] as number[], by: 0, lie: false, loser: 0 };
/** The last hand shown when the game ended on a call: held a moment so the verdict can be read. */
let endView: CheatView | null = null;
let endUntil = 0;
/** Deals so far (the card clears its choice at each). */
let deals = 0;

/** The last shot at the hoop as it's shown: who (−1 the player, else the inmate), from where, how it went, when it left the hand. */
export interface BallShow {
  by: number;
  fromX: number;
  fromZ: number;
  result: ShotResult;
  /** Short of the rim (an airball that fell short; else long). */
  short: boolean;
  at: number;
}
let ball: BallShow | null = null;
/** How long a shot is in the air (s), and how long a miss rolls about after (s). */
export const FLIGHT_S = 0.9;
export const AFTER_S = 1.2;

/**
 * The shots' clock (ms): it runs only while the game does, so a ball in the air holds still
 * under the pause menu (and in a paused replay), and what happens as it lands (the sound, the
 * toast) waits for it. Read once a frame from the picture, and at each event.
 */
const shotClock = new PausableClock();

/** A new game (or a load): nothing to show. */
export function resetPastimes() {
  endView = null;
  endUntil = 0;
  ball = null;
  shotClock.clear();
  deals++;
}

/** The clock now (ms): runs it on while the game isn't paused, then whatever was due. */
const shotNow = () => shotClock.tick(performance.now(), !play.game || play.game.paused);

// ------------------------------------------------------------------ the events

export function announcePastimes(sim: Sim, e: SimEvent) {
  const g = play.game;
  const now = performance.now();
  switch (e.type) {
    case 'cheat': {
      const name = nameOf(sim, e.who);
      if (e.what === 'dealt') {
        deals++;
        sound.cardDeal();
        if (e.round === 0) coachOnce('cheat', 'hint.cheat');
      } else if (e.what === 'played') sound.cardLay(e.n ?? 1);
      else if (e.what === 'called') {
        sound.slap();
        window.setTimeout(() => play.game === g && sound.cardFlip(), 220);
        reveal.cards = e.cards ?? [];
        reveal.by = e.by ?? 0;
        reveal.lie = !!e.lie;
        reveal.loser = e.loser ?? 0;
        buzz(e.loser === 0 ? 'missed' : 'strike');
      } else if (e.what === 'won' || e.what === 'lost') {
        // The last call's cards stay up a moment with the verdict.
        if (lastCheat) {
          endView = { ...lastCheat, chips: [lastCheat.chips[0] - (reveal.loser === 0 ? 1 : 0), lastCheat.chips[1] - (reveal.loser === 1 ? 1 : 0)] as [number, number], phase: 'reveal', reveal: { ...reveal }, canPlay: false, canCall: false, mustCall: false, last: null, tell: '' };
          endUntil = now + 2600;
        }
        const n = e.stake ?? 0;
        window.setTimeout(() => {
          if (play.game !== g) return;
          if (e.what === 'won') {
            sound.coin(n >= 20);
            buzz('attended');
            floatUp(`+$${n * 2}`, 'cash');
            banner.toast(t('toast.cheatWon', { name, n }), 'good', 3600);
          } else {
            sound.sting();
            banner.toast(t('toast.cheatLost', { name, n }), 'bad', 3600);
          }
        }, 650);
      } else if (e.what === 'folded') {
        sound.click();
        itemsUI.toast(t('toast.cheatFolded', { name, n: e.stake ?? 0 }));
      } else if (e.what === 'off' && !sim.state.escaped) {
        floatUp(`+$${e.stake ?? 0}`, 'cash');
        itemsUI.toast(t('toast.cheatOff', { n: e.stake ?? 0 }));
      }
      break;
    }
    case 'hoopShot': {
      const c = courtOf(sim);
      if (!c) break;
      const m = e.by >= 0 ? sim.state.inmates[e.by] : null;
      const from = m ? m.body : sim.state.player;
      // (On the shots' clock: the flight, and what happens as it lands, hold still while paused.)
      ball = { by: e.by >= 0 ? e.by : -1, fromX: from.x / UNIT, fromZ: from.z / UNIT, result: e.result, short: e.by < 0 ? e.power < e.need : (e.power + e.spot) % 2 === 0, at: shotNow() };
      const land = FLIGHT_S * 1000;
      shotClock.after(land, () => {
        if (play.game !== g) return;
        if (e.result === 'swish') sound.swish();
        else if (e.result === 'in') {
          sound.rimClang(0.6);
          shotClock.after(160, () => play.game === g && sound.swish(0.6));
        } else if (e.result === 'rim') sound.rimClang();
        else sound.bounce();
        if (e.by < 0) {
          floatUp(t(e.result === 'swish' ? 'toast.swish' : e.result === 'in' ? 'toast.basket' : e.result === 'rim' ? 'toast.rimOut' : 'toast.airball'), e.result === 'swish' || e.result === 'in' ? 'gain' : 'taken');
          if (e.result === 'swish' || e.result === 'in') buzz('attended');
        } else itemsUI.toast(t(e.result === 'swish' || e.result === 'in' ? 'toast.theyScore' : 'toast.theyMiss', { name: nameOf(sim, e.by) }));
      });
      shotClock.after(land + 420, () => play.game === g && e.result !== 'air' && sound.bounce(0.6));
      break;
    }
    case 'hoops': {
      const name = e.who >= 0 ? nameOf(sim, e.who) : '';
      const m = e.mine ?? 0;
      const n = e.theirs ?? 0;
      // (After the last ball has come down, on the shots' clock.)
      shotNow();
      const later = (f: () => void) => shotClock.after(FLIGHT_S * 1000 + 300, () => play.game === g && f());
      if (e.what === 'start') {
        coachOnce('hoops', 'hint.hoops');
        sound.whistle();
      } else if (e.what === 'practice') {
        later(() => {
          sound.levelUp();
          floatUp(`+1 ${t('attr.spdShort')}`, 'gain');
          itemsUI.toast(t('toast.practiceSpd', { n: PRACTICE_MAKES }));
        });
      } else if (e.what === 'won')
        later(() => {
          if ((e.crowd ?? 0) > 0) sound.cheer();
          sound.levelUp();
          buzz('attended');
          if (e.spd) floatUp(`+1 ${t('attr.spdShort')}`, 'gain');
          const parts = [e.gain ? t('toast.partOpinion', { n: e.gain }) : '', e.spd ? t('toast.partSpd') : t('toast.partSpdTop'), e.crowd ? t('toast.partCrowd', { m: CROWD_OPINION }) : ''].filter(Boolean);
          banner.toast(`${t('toast.hoopsWon', { m, n })} ${parts.join(', ')}`, 'good', 4200);
        });
      else if (e.what === 'lost')
        later(() => {
          sound.sting();
          banner.toast(e.gain ? t('toast.hoopsLost', { name, m: n, n: m, g: e.gain }) : t('toast.hoopsLostNone', { name, m: n, n: m }), 'bad', 3600);
        });
      else if (e.what === 'draw') later(() => banner.toast(e.gain ? t('toast.hoopsDraw', { m, n, g: e.gain }) : t('toast.hoopsDrawNone', { m, n }), undefined, 3600));
      else if (e.what === 'off' && !sim.state.escaped) itemsUI.toast(t('toast.hoopsOff'));
      break;
    }
    case 'checkers': {
      const name = nameOf(sim, e.who);
      if (e.what === 'sat') coachOnce('checkers', TOUCH ? 'hint.checkersTouch' : 'hint.checkers');
      else if (e.what === 'moved') sound.checker((e.path?.length ?? 0) > 2 || Math.abs((e.path?.[1] ?? 0) - (e.path?.[0] ?? 0)) > 5);
      else if (e.what === 'won') {
        sound.fanfare();
        buzz('attended');
        if (e.int) floatUp(`+1 ${t('attr.intShort')}`, 'gain');
        // His secret, as he lets it slip.
        const secret = director.secret(sim, e.who);
        if (secret) banner.show(t('banner.secret', { name }), secret, 'routine', 7000);
        else banner.toast(t('toast.checkersWon', { name }), 'good', 3600);
      } else if (e.what === 'lost' || e.what === 'drawn') {
        sound.click();
        if (e.int) floatUp(`+1 ${t('attr.intShort')}`, 'gain');
        banner.toast(t(e.what === 'lost' ? (e.int ? 'toast.checkersLostInt' : 'toast.checkersLost') : e.int ? 'toast.checkersDrawnInt' : 'toast.checkersDrawn', { name }), undefined, 3600);
      }
      break;
    }
  }
}

// ------------------------------------------------------------------ Cheat's card

const cheatView: CheatView = { name: '', stake: 0, chips: [CHIPS, CHIPS], of: CHIPS, table: 1, mine: [], theirs: 0, pile: 0, phase: 'yours', last: null, tell: '', reveal: null, canPlay: false, canCall: false, mustCall: false, deal: 0 };
let lastCheat: CheatView | null = null;

/** The hand of Cheat under way (null: none), or the last one's verdict for a moment after. */
export function cheatNow(sim: Sim): CheatView | null {
  const s = sim.state;
  const c = s.cheat;
  if (!c) {
    lastCheat = null;
    return endView && performance.now() < endUntil ? endView : null;
  }
  endView = null;
  const v = cheatView;
  const m = s.inmates[c.who];
  v.name = nameOf(sim, c.who);
  v.stake = STAKES[c.stake];
  v.chips = [c.chips[0], c.chips[1]];
  v.of = CHIPS;
  v.table = c.table;
  v.mine = c.mine;
  v.theirs = c.theirs.length;
  v.pile = c.pile;
  v.phase = c.turn === 2 ? 'reveal' : c.turn === 1 ? 'theirs' : 'yours';
  v.last = c.by >= 0 && c.last.length ? { by: c.by, n: c.last.length } : null;
  v.tell = c.tell && c.by === 1 && m ? t(`cheat.tell.${tellOf(m.cell)}` as Key, { name: v.name }) : '';
  v.reveal = c.turn === 2 ? { ...reveal } : null;
  v.canPlay = canPlay(c);
  v.canCall = canCall(c);
  v.mustCall = c.by === 1 && c.theirs.length === 0 && c.turn === 0;
  v.deal = deals;
  lastCheat = { ...v, chips: [v.chips[0], v.chips[1]], mine: v.mine.slice() };
  return v;
}

// ------------------------------------------------------------------ the court's card

const courtView: CourtView = { name: '', spot: 1, onSpot: false, holding: false, marker: 0, need: 0.5, half: 0.05, wind: '', rain: false, mine: [], theirs: [], turn: 0, practice: 0, of: PRACTICE_MAKES };
const win: [number, number] = [0, 0];

/** The court's card (null: not on a spot and no shootout): the shot from the step's power, between steps (`a`). */
export function courtNow(sim: Sim, a: number): CourtView | null {
  const s = sim.state;
  const c = courtOf(sim);
  if (!c || s.layer !== LAYER.GROUND) return null;
  // (Another game under way has its own card: the court's waits.)
  if (s.cheat || s.board?.seated || s.bout.length || s.pick.length || s.dice.length) return null;
  const o = s.shootout;
  const at = spotAt(sim);
  if (!o && at < 0) return null;
  const v = courtView;
  const spot = o ? spotOf(o.k) : at;
  v.name = o ? nameOf(sim, o.who) : '';
  v.spot = spot + 1;
  v.onSpot = at === spot;
  v.holding = s.shot.length > 0;
  v.marker = v.holding ? powerAt(s.step - s.shot[0] + a) / 1000 : 0;
  shotWindow(sim, spot, win);
  v.need = Math.min(1, win[0] / 1000);
  v.half = win[1] / 1000;
  const along = windAlong(sim, c, spot);
  v.wind = along > 0 ? 'behind' : along < 0 ? 'against' : '';
  const wx = today(sim).weather;
  v.rain = wx === 'rain' || wx === 'storm';
  v.turn = o?.turn ?? 0;
  v.mine.length = 0;
  v.theirs.length = 0;
  if (o) {
    const pairs = Math.max(SHOOT_SPOTS, Math.min(SHOOT_SPOTS + SUDDEN_DEATH, o.k + 1));
    for (let k = 0; k < pairs; k++) {
      v.mine.push(k < o.k || (k === o.k && o.turn === 1) ? (o.mine >> k) & 1 : -1);
      v.theirs.push(k < o.k ? (o.theirs >> k) & 1 : -1);
    }
  }
  const day = prisonDay(s.step);
  const made = Math.floor(s.practice / 16) === day ? s.practice % 16 : 0;
  v.practice = made;
  v.of = made >= PRACTICE_MAKES ? 0 : PRACTICE_MAKES;
  return v;
}

// ------------------------------------------------------------------ the old-timer's board

const boardView: BoardView = { name: '', sq: [], steps: [], chain: -1, last: [], over: 0, thinking: false, won: 0, lost: 0, drawn: 0, mine: 0, his: 0 };
const steps: Step[] = [];

/** The board, while the player is at it (null: not). */
export function boardNow(sim: Sim): BoardView | null {
  const s = sim.state;
  const b = s.board;
  if (!b || !b.seated) return null;
  const v = boardView;
  v.name = nameOf(sim, elderOf(sim));
  v.sq = b.sq;
  v.steps = b.turn === 0 && !b.over ? stepsOf(b.sq, 0, b.chain, steps).map((x) => ({ from: x.from, to: x.to })) : [];
  v.chain = b.chain;
  v.last = b.last;
  v.over = b.over;
  v.thinking = b.turn === 1 && !b.over;
  v.won = s.elder[0] ?? 0;
  v.lost = s.elder[1] ?? 0;
  v.drawn = s.elder[2] ?? 0;
  v.mine = b.sq.filter((p) => p === PIECE.MAN || p === PIECE.KING).length;
  v.his = b.sq.filter((p) => p === PIECE.HIS_MAN || p === PIECE.HIS_KING).length;
  return v;
}

/** The talk panel's checkers row, for the old-timer (null: not him). */
export function elderOffer(sim: Sim, who: number): { open: boolean; why: string; game: 'none' | 'on' | 'over'; won: number } | null {
  if (who < 0 || who !== elderOf(sim)) return null;
  const why = elderRefusal(sim);
  const b = sim.state.board;
  return {
    open: !why,
    why: why === 'gamesLockdown' ? t('refused.gamesLockdown') : why === 'elderOpinion' ? t('refused.elderOpinion', { n: ELDER_OPINION }) : why ? t('games.closed') : '',
    game: !b ? 'none' : b.over ? 'over' : 'on',
    won: sim.state.elder[0] ?? 0,
  };
}

// ------------------------------------------------------------------ wiring

/** Space (or the Shoot pad) held and let go on a spot: the shot. Returns whether it was taken as one. */
export function shootKey(down: boolean): boolean {
  const g = play.game;
  if (!g || g.paused || g.replay) return false;
  const sim = g.rec.sim;
  const s = sim.state;
  if (!down) {
    if (!s.shot.length && !shooting) return false;
    shooting = false;
    sendOp(OP.EXT, EXT.SHOOT, 1);
    return true;
  }
  if (s.match || s.ink || spotAt(sim) < 0 || (s.shootout && (s.shootout.turn !== 0 || spotAt(sim) !== spotOf(s.shootout.k)))) return false;
  shooting = true;
  sendOp(OP.EXT, EXT.SHOOT, 0);
  return true;
}
/** A shot held from the keys or the pad (its release is owed). */
let shooting = false;

export function wirePastimes() {
  courtCard.onHold = (down) => shootKey(down);
  // (P29: the match's Kick pad.)
  matchCard.onHold = (down) => kickKey(down);
  // (P30: the stage's lane pads, and their flash from the keys.)
  stageCard.onLane = (lane) => lanePress(lane);
  setLaneFlash((lane) => stageCard.flash(lane));
}

/** Keys for the cards (P27): 1–5 choose cards, Enter lays them, L calls; returns whether the key was theirs. */
export function pastimeKey(code: string): boolean {
  if (!cheatCard.open) return false;
  const digit = /^Digit([1-5])$/.exec(code);
  if (digit) {
    cheatCard.toggle(Number(digit[1]) - 1);
    sound.click();
    return true;
  }
  // (Enter on a button of the card with the focus: that button's, not a lay.)
  if ((code === 'Enter' || code === 'NumpadEnter') && !(document.activeElement as HTMLElement | null)?.closest('.cheat-card button')) {
    cheatCard.lay();
    return true;
  }
  if (code === 'KeyL') {
    cheatCard.liar();
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ the picture

const frame: PastimesFrame = { spot: -1, ball: null, holding: null, cards: null, board: null };
const ballFrame: NonNullable<PastimesFrame['ball']> = { show: { by: -1, fromX: 0, fromZ: 0, result: 'air', short: false, at: 0 }, t: 0, fromY: 1.5 };
const holdFrame = { who: -1, power: 0, dx: 0, dz: 0 };
const cardsFrame = { x: 0, z: 0, angle: 0, pile: 0, reveal: null as number[] | null };
const boardFrame = { x: 0, z: 0, angle: 0, sq: [] as number[], last: [] as number[] };

/**
 * The games in the frame: the lit spot, the ball (up in the hands, in flight, rolling off), the
 * cards on the ground between the two, the old-timer's board between him and the player.
 */
export function pastimesFrameOf(sim: Sim, px: number, pz: number, partner: { x: number; z: number } | null, elder: { x: number; z: number } | null): PastimesFrame {
  const s = sim.state;
  const f = frame;
  const o = s.shootout;
  const at = spotAt(sim);
  f.spot = o ? spotOf(o.k) : at;
  const now = performance.now();
  // (The ball on the shots' clock: held still while paused.)
  const shot = shotNow();
  if (ball && (shot - ball.at) / 1000 < FLIGHT_S + AFTER_S && s.layer === LAYER.GROUND) {
    ballFrame.show = ball;
    // (From over the shooter's head: where the hands held it.)
    ballFrame.t = (shot - ball.at) / 1000;
    f.ball = ballFrame;
  } else f.ball = null;
  if (s.shot.length) {
    holdFrame.who = -1;
    holdFrame.power = powerAt(s.step - s.shot[0]) / 1000;
    // (Toward the rim: held a little that way.)
    const rim = rimInTiles(sim);
    const len = rim ? Math.hypot(rim.x - px, rim.z - pz) || 1 : 1;
    holdFrame.dx = rim ? (rim.x - px) / len : 0;
    holdFrame.dz = rim ? (rim.z - pz) / len : 0;
    f.holding = holdFrame;
  } else f.holding = null;
  const c = s.cheat;
  if ((c || (endView && now < endUntil)) && partner && s.layer === LAYER.GROUND) {
    // (Between the two, pushed out to the side of the line between them that faces the camera: their bodies would hide them otherwise.)
    besideLine(px, pz, partner.x, partner.z, 0.36, cardsFrame);
    cardsFrame.angle = Math.atan2(partner.x - px, partner.z - pz);
    cardsFrame.pile = c ? c.pile : (endView?.pile ?? 0);
    cardsFrame.reveal = c ? (c.turn === 2 ? reveal.cards : null) : reveal.cards;
    f.cards = cardsFrame;
  } else f.cards = null;
  const b = s.board;
  if (b?.seated && elder && s.layer === LAYER.GROUND) {
    besideLine(px, pz, elder.x, elder.z, 0.22, boardFrame);
    boardFrame.angle = Math.atan2(elder.x - px, elder.z - pz);
    boardFrame.sq = b.sq;
    boardFrame.last = b.last;
    f.board = boardFrame;
  } else f.board = null;
  return f;
}

/**
 * The middle of the line between two people, pushed `by` (tiles) across it toward the camera
 * (south, +z); side by side north and south, across it to the east.
 */
function besideLine(ax: number, az: number, bx: number, bz: number, by: number, out: { x: number; z: number }) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz) || 1;
  let nx = -dz / len;
  let nz = dx / len;
  if (nz < -0.05 || (Math.abs(nz) <= 0.05 && nx < 0)) {
    nx = -nx;
    nz = -nz;
  }
  out.x = (ax + bx) / 2 + nx * by;
  out.z = (az + bz) / 2 + nz * by;
}

/** Who's shooting in the picture (a shot just let go: the arms still up, following through), -1 the player, else the inmate; null nobody. */
export function shooterNow(): number | null {
  return ball && (shotClock.time - ball.at) / 1000 < 0.35 ? ball.by : null;
}

/** The rim in the picture (tiles), for the ball's flight. */
export function rimInTiles(sim: Sim): { x: number; z: number } | null {
  const c = courtOf(sim);
  if (!c) return null;
  const r = rimOf(c);
  return { x: r.x / UNIT, z: r.z / UNIT };
}

/** The player's pose for the games (DOING), or -1 for none; and who they're playing (crouched too). */
export function pastimesDoing(sim: Sim): number {
  const s = sim.state;
  if (s.cheat) return DOING.CARDS;
  if (s.board?.seated) return DOING.BOARD;
  if (s.shot.length) return DOING.SHOOT;
  return -1;
}
/** Who's across the cards or the board from the player (-1 none). */
export function pastimesPartner(sim: Sim): { who: number; doing: number } | null {
  const s = sim.state;
  if (s.cheat) return { who: s.cheat.who, doing: DOING.CARDS };
  if (s.board?.seated) return { who: elderOf(sim), doing: DOING.BOARD };
  return null;
}

/** The court's spots and the shot's need as tiles, for the lesson's arrows and tests. */
export const spotTile = (sim: Sim, k: number) => {
  const c = courtOf(sim);
  return c ? c.spots[k].z * MAP_W + c.spots[k].x : -1;
};
