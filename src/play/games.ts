import { footballOffer, inkHeatNow, inkOffer } from './team';
import { buzz } from '../app/haptics';
import {
  BAR,
  BOUT_ENERGY,
  BOUT_STEPS,
  CROWD_OPINION,
  DICE_HEAT,
  GAME_OPINION,
  GAMES_A_DAY,
  PICK_MISS_NOISE,
  PICK_SPEED,
  SPORTS_OPINION,
  SPORTS_PRIZE,
  SPORTS_WINS,
  STAKES,
  WRESTLE_BEAT,
  WRESTLE_WINDOW,
} from '../content/games';
import { KEY_ITEM_COLORS } from '../content/items';
import { t } from '../i18n';
import { OP } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import { DOING } from '../sim/systems/inmates';
import {
  boutBeat,
  eyesOn,
  gameRefusal,
  LOCKPICK,
  pinsOf,
  playedToday,
  sportsOn,
  sportsWins,
  surging,
  sweetSpot,
} from '../sim/systems/games';
import { itemOf, usesOf } from '../sim/systems/items';
import { wouldHear } from '../sim/systems/noise';
import { energyCost } from '../sim/systems/weather';
import { cameraSeesPlayer } from '../sim/systems/power';
import { STEPS_PER_SECOND, TIRED } from '../sim/tuning';
import { LAYER } from '../sim/world/World';
import type { GamesFrame } from '../render/Games';
import type { DiceShow, DiceView, GamesView, PickView, WrestleView } from '../ui/games';
import { banner, itemsUI, sound, talk } from './context';
import { gameCards, whenCards } from './lazy';
import { play, sendOp } from './game';
import { coachOnce } from './tips';
import { crewTalk } from './crew';
import { atCourt, courtOf } from '../sim/systems/hoops';
import { elderOffer } from './pastimes';
import { floatAt, floatUp } from './floats';
import { inmateName } from '../ui/names';

/**
 * The side games on screen (P22): the talk panel's games (what's on offer, the dice in play and
 * how the last game went), the arm-wrestle's card, the lockpick's card, the dice and the poses in
 * the picture, and what the games' events say. The marker, the sweet spots and the surges are the
 * sim's own functions (games.ts): what the cards show is what the rules judge.
 */

/** How long a die takes from the hand to rest (Games.ts FLIGHT), and the result's wait after it, in ms. */
const LAND_MS = 550;
const SETTLE_MS = 120;
/** How long the last game's dice and its result stay up (ms; 2.40: on its card, until it's closed or the talk ends). */
const SHOW_MS = 4200;
/** 2.40: the inmate's second die leaves the hand this long after its first (ms): one, then the other. */
const SECOND_MS = 380;

/** The last dice game as it's shown (presentation only: the sim settled it already). */
const show: DiceShow = {
  id: 0,
  who: -1,
  stake: 0,
  mine: [0, 0],
  theirs: [0, 0],
  at: [0, 0, 0, 0],
  what: 'rolled',
  shownAt: 0,
  until: 0,
  paid: 0,
};
/** Taps at a lock and throws of the dice so far (the view twitches the arm at each new one). */
let taps = 0;
/** 2.40: cheers so far (a win, a basket in a shootout): those watching the player's game throw a fist up at each. */
let cheers = 0;
export const cheersSoFar = () => cheers;
/** A cheer from the crowd at the player's game; `fans`, those whose opinion rose for it, a +2 over each. */
export function cheer(fans?: readonly number[]) {
  cheers++;
  for (const k of fans ?? []) floatAt(k, `+${CROWD_OPINION}`, 'gain');
}
/** When the last surge began (ms, for the card's flash), and the last bar (for the grunts). */
let lastGrunt = 0;
/** The bout's bar a step ago (the card eases toward it). */
let barSeen = 0.5;

/** A new game (or a load): nothing to show. */
export function resetGames() {
  show.who = -1;
  show.until = 0;
  show.id++;
  taps = 0;
  barSeen = 0.5;
}

/** The cash the HUD shows: what comes back off the table waits until the dice are down (the sim settled it already). */
export function cashShown(s: { cash: number }, now = performance.now()): number {
  return show.who >= 0 && now < show.shownAt ? s.cash - show.paid : s.cash;
}

/** The dice game shown now (null when nothing is: it's over and gone). */
function diceShown(now = performance.now()): DiceShow | null {
  return show.who >= 0 && now < show.until ? show : null;
}

/** 2.40: the dice's card closed (Done, or the talk over): the game's result put away. */
export function dismissDice() {
  show.who = -1;
  show.until = 0;
}

const diceView: DiceView = {
  name: '',
  stake: 0,
  k: 0,
  phase: 'mine',
  mine: [0, 0],
  theirs: [0, 0],
  down: [false, false],
  fresh: [false, false, false, false],
  what: 'rolled',
  paid: 0,
  again: false,
  left: 0,
  seen: false,
  heat: DICE_HEAT,
  id: 0,
};

/**
 * 2.40: the dice's card (null: none up): the player's throw to keep or throw again, then the inmate's, one die and the
 * other, and how it went, held until it's closed. Only with the one the player is talking to; a run from before has
 * the talk panel's dice instead.
 */
export function diceNow(sim: Sim): DiceView | null {
  const s = sim.state;
  // (The talk over, or with someone else: the last game's put away, never brought back by talking to them again.)
  if (show.who >= 0 && show.who !== s.talk && show.what !== 'rolled' && !sim.rules239) dismissDice();
  if (sim.rules239 || s.talk < 0 || s.talk >= s.inmates.length) return null;
  const now = performance.now();
  const on = s.dice.length > 0 && s.dice[0] === s.talk;
  const shown = diceShown(now);
  const mine = shown && shown.who === s.talk ? shown : null;
  if (!on && !mine) return null;
  const v = diceView;
  v.name = inmateName(sim, s.talk);
  v.id = show.id;
  if (on) {
    v.phase = 'mine';
    v.k = s.dice[1];
    v.stake = STAKES[s.dice[1]];
    v.mine[0] = s.dice[2];
    v.mine[1] = s.dice[3];
    v.theirs[0] = v.theirs[1] = 0;
    v.down[0] = v.down[1] = false;
    v.what = 'rolled';
  } else {
    const d = mine!;
    v.stake = d.stake;
    v.k = Math.max(0, STAKES.indexOf(d.stake));
    v.mine[0] = d.mine[0];
    v.mine[1] = d.mine[1];
    v.theirs[0] = d.theirs[0];
    v.theirs[1] = d.theirs[1];
    // (Each of theirs face up once it's down; the verdict once both are.)
    v.down[0] = d.at[2] > 0 && now >= d.at[2] + LAND_MS;
    v.down[1] = d.at[3] > 0 && now >= d.at[3] + LAND_MS;
    v.phase = now >= d.shownAt ? 'done' : 'theirs';
    v.what = d.what;
    v.paid = d.paid;
  }
  // (A die just thrown tumbles in on the card as it does on the table.)
  for (let k = 0; k < 4; k++) v.fresh[k] = show.who === s.talk && show.at[k] > 0 && now >= show.at[k] && now - show.at[k] < 450;
  const why = gameRefusal(sim, s.talk);
  v.left = GAMES_A_DAY - playedToday(s, s.talk);
  v.again = v.phase === 'done' && why === null && s.cash >= v.stake;
  v.seen = eyesOn(s, s.step);
  return v;
}

/** What the games' events say: sounds, toasts, the dice's timeline. */
export function announceGames(sim: Sim, e: SimEvent) {
  const now = performance.now();
  const g = play.game;
  switch (e.type) {
    case 'dice':
      if (e.what === 'rolled') {
        show.id++;
        show.who = e.who;
        show.stake = e.stake;
        show.mine = [e.mine[0], e.mine[1]];
        show.theirs = [0, 0];
        show.at = [now, now, 0, 0];
        // (The stake goes down on the table: said, as the HUD drops by it.)
        floatUp(`−$${e.stake}`, 'taken');
        show.what = 'rolled';
        show.until = Infinity;
        taps++;
        sound.diceRattle();
        window.setTimeout(() => play.game === g && sound.diceLand(), LAND_MS - 80);
        coachOnce('dice', 'hint.dice');
      } else if (e.what === 'rerolled') {
        show.mine = [e.mine[0], e.mine[1]];
        if ((e.mask ?? 0) & 1) show.at[0] = now;
        if ((e.mask ?? 0) & 2) show.at[1] = now;
        taps++;
        sound.diceRattle();
        window.setTimeout(() => play.game === g && sound.diceLand(), LAND_MS - 80);
      } else {
        // The inmate throws once the player's dice are down.
        const again = sim.events.some((x) => x.type === 'dice' && x.what === 'rerolled');
        const throwAt = now + (again ? LAND_MS + 150 : 250);
        show.mine = [e.mine[0], e.mine[1]];
        show.theirs = [e.theirs?.[0] ?? 0, e.theirs?.[1] ?? 0];
        // (2.40: one die, then the other; the result held on the dice's card until it's closed.)
        const second = sim.rules239 ? 0 : SECOND_MS;
        show.at[2] = throwAt;
        show.at[3] = throwAt + second;
        show.what = e.what;
        // (What comes back off the table: the HUD shows it once the dice are down.)
        show.paid = e.what === 'won' ? e.stake * 2 : e.what === 'push' ? e.stake : 0;
        show.shownAt = throwAt + second + LAND_MS + SETTLE_MS;
        show.until = sim.rules239 ? show.shownAt + SHOW_MS : Infinity;
        const id = show.id;
        const who = e.who;
        const stake = e.stake;
        const what = e.what;
        window.setTimeout(() => play.game === g && show.id === id && sound.diceRattle(), throwAt - now - 250);
        window.setTimeout(() => play.game === g && show.id === id && sound.diceLand(), throwAt - now + LAND_MS - 80);
        if (second) window.setTimeout(() => play.game === g && show.id === id && sound.diceLand(), throwAt - now + second + LAND_MS - 80);
        window.setTimeout(() => {
          if (play.game !== g || show.id !== id) return;
          const name = inmateName(sim, who);
          // (2.40: the dice's card says how it went, and keeps saying it: no toast over it.)
          const said = !sim.rules239;
          if (what === 'won') {
            sound.coin(stake >= 20);
            buzz('attended');
            // (What lands back in the pocket: the stake, and the winnings.)
            floatUp(`+$${stake * 2}`, 'cash');
            if (!said) banner.toast(t('toast.diceWon', { n: stake, name }), 'good', 3600);
          } else if (what === 'lost') {
            sound.sting();
            if (!said) banner.toast(t('toast.diceLost', { n: stake, name }), 'bad', 3600);
          } else {
            sound.click();
            floatUp(`+$${stake}`, 'cash');
            if (!said) banner.toast(t('toast.dicePush', { name }), undefined, 3200);
          }
        }, show.shownAt - now);
      }
      break;
    case 'bout': {
      const name = inmateName(sim, e.who);
      if (e.what === 'push') {
        // (2.40: a press that counted, on the beat or off it: heard, felt, the card's line lit.)
        if (e.hit) sound.repHit();
        else sound.rep();
        buzz('strike');
        gameCards()?.wrestleCard.flash(!!e.hit);
      } else if (e.what === 'start') {
        // (2.40: the count-in's beats say it's starting; before, a grunt as the hands locked.)
        if (sim.rules239) sound.grunt();
        buzz('strike');
        // (2.40: the beat's advice, a new hint: anyone who had the old one is told the new way.)
        coachOnce(sim.rules239 ? 'wrestle' : 'wrestleBeat', sim.rules239 ? 'hint.wrestle' : 'hint.wrestleBeat');
        barSeen = 0.5;
      } else if (e.what === 'won') {
        if ((e.crowd ?? 0) > 0) sound.cheer();
        cheer(e.fans);
        sound.levelUp();
        buzz('attended');
        if (e.str) floatUp(`+1 ${t('attr.strShort')}`, 'gain');
        // (What it actually brought: opinion as it moved, Strength unless at its top, the crowd who cheered.)
        const parts = [
          e.gain ? t('toast.partOpinion', { n: e.gain }) : '',
          e.str ? t('toast.partStr') : t('toast.partStrTop'),
          e.crowd ? t('toast.partCrowd', { m: CROWD_OPINION }) : '',
        ].filter(Boolean);
        banner.toast(`${t('toast.boutBeat', { name })} ${parts.join(', ')}`, 'good', 4200);
        const left = SPORTS_WINS - (e.wins ?? 0);
        if ((e.wins ?? 0) > 0 && left > 0)
          itemsUI.toast(t(left === 1 ? 'toast.sportsWin1' : 'toast.sportsWins', { left, prize: SPORTS_PRIZE }));
      } else if (e.what === 'lost') {
        sound.sting();
        banner.toast(e.gain ? t('toast.boutLost', { name, n: e.gain }) : t('toast.boutLostNone', { name }), 'bad', 3600);
      } else if (e.what === 'draw') {
        sound.click();
        banner.toast(e.gain ? t('toast.boutDraw', { name, n: e.gain }) : t('toast.boutDrawNone'), undefined, 3600);
      } else if (e.what === 'gaveUp') {
        sound.click();
        itemsUI.toast(t('toast.boutGaveUp', { name }));
      } else if (e.what === 'off' && !sim.state.escaped) {
        // Broken off (the sirens, a knockout, the talk over, the games' hours done): said, never silent.
        itemsUI.toast(t('toast.boutOff'));
      }
      break;
    }
    case 'pick':
      if (e.what === 'start') coachOnce('lockpick', 'hint.lockpick');
      else if (e.what === 'set') {
        taps++;
        sound.pickClick();
        buzz('strike');
      } else if (e.what === 'slip') {
        taps++;
        sound.pickSlip();
        buzz('missed');
      } else if (e.what === 'open') {
        sound.unlock();
        buzz('attended');
        banner.toast(t('toast.picked'), 'good', 3600);
      }
      break;
    case 'today':
      if (e.event === 'sports' && e.phase === 'prize') {
        sound.fanfare();
        buzz('attended');
        floatUp(`+$${SPORTS_PRIZE}`, 'cash');
        banner.show(t('banner.champion'), t('banner.championSub', { n: SPORTS_PRIZE, m: SPORTS_OPINION }), 'routine', 4600);
      }
      break;
  }
}

// ------------------------------------------------------------------ the talk panel's games

const gamesView: GamesView = {
  id: 0,
  open: true,
  why: '',
  left: 0,
  stakes: [],
  seen: false,
  heat: DICE_HEAT,
  dice: null,
  show: null,
  arm: 'even',
  tired: false,
  energy: BOUT_ENERGY,
  sports: null,
  name: '',
  hasCourt: false,
  court: false,
  elder: null,
  football: null,
  ink: null,
  inkHeat: 0,
};

/** The games on offer with the inmate the player is talking to (null for a guard, or nobody). */
function gamesOffer(sim: Sim): GamesView | null {
  const s = sim.state;
  const who = s.talk;
  if (who < 0 || who >= s.inmates.length) return null;
  const v = gamesView;
  const m = s.inmates[who];
  const why = gameRefusal(sim, who);
  v.name = inmateName(sim, who);
  v.open = why === null;
  v.why =
    why === 'gamesClosed'
      ? t('games.closed')
      : why === 'gamesLockdown'
        ? t('refused.gamesLockdown')
        : why === 'seated'
          ? t('refused.seated')
          : why === 'gameOpinion'
            ? t('games.needOpinion', { n: GAME_OPINION })
            : why === 'played'
              ? t('games.playedOut', { n: GAMES_A_DAY })
              : '';
  v.left = GAMES_A_DAY - playedToday(s, who);
  v.stakes.length = 0;
  for (let k = 0; k < STAKES.length; k++) v.stakes.push({ k, n: STAKES[k], ok: s.cash >= STAKES[k] });
  v.seen = eyesOn(s, s.step);
  // The dice on the table, the player's to throw again or stand on.
  // (2.40: on the dice's own card; the panel's are a run from before's.)
  v.dice = sim.rules239 && s.dice.length && s.dice[0] === who ? { mine: [s.dice[2], s.dice[3]], stake: STAKES[s.dice[1]] } : null;
  const shown = sim.rules239 ? diceShown() : null;
  v.show = shown && shown.who === who ? shown : null;
  v.arm = m.str > s.str + 5 ? 'stronger' : m.str < s.str - 5 ? 'weaker' : 'even';
  v.tired = s.energy < TIRED;
  // (What a bout costs now: twice as much when chilled, as the sim charges it.)
  v.energy = energyCost(sim, BOUT_ENERGY);
  v.sports = sportsOn(sim) ? { wins: sportsWins(s), of: SPORTS_WINS, prize: SPORTS_PRIZE, won: (s.eventFlags & 4096) !== 0 } : null;
  v.id = show.id;
  // P27: the hoop (a shootout from the court), the old-timer's board.
  v.hasCourt = !!courtOf(sim);
  v.court = v.hasCourt && atCourt(sim, who);
  v.elder = elderOffer(sim, who);
  // P29: football at the pitch, the tattoo parlour.
  v.football = footballOffer(sim, who);
  v.ink = inkOffer(sim, who);
  v.inkHeat = v.ink ? inkHeatNow(sim) : 0;
  return v;
}

// ------------------------------------------------------------------ the arm-wrestle's card

const wrestleView: WrestleView = {
  name: '',
  bar: 0.5,
  surge: false,
  left: 0,
  next: 1,
  push: 0,
  str: 0,
  beat: null,
  count: 0,
};
const beatView = { off: 0, n: 0, of: WRESTLE_BEAT, window: WRESTLE_WINDOW };
/** The step last seen and when (ms), for the beat's marker to move between steps. */
let boutStepSeen = -1;
let boutStepAt = 0;

/** The arm-wrestle under way (null: none), the bar where the step and the frame have it. */
export function wrestleNow(sim: Sim, dt: number): WrestleView | null {
  const s = sim.state;
  if (!s.bout.length) return null;
  const [who, bar, side, from] = s.bout;
  const v = wrestleView;
  v.name = inmateName(sim, who);
  // Eased toward the step's bar (the sim moves it in 20 steps a second).
  barSeen += (bar / BAR - barSeen) * Math.min(1, dt * 14);
  v.bar = barSeen;
  const t0 = s.step - from;
  v.surge = t0 >= 0 && surging(s.salt, from, t0);
  // 2.40: the beat (the gym's way) and the count-in before it, where the frame has them (between steps too).
  if (sim.rules239) {
    v.beat = null;
    v.count = 0;
  } else {
    const now = performance.now();
    if (s.step !== boutStepSeen) {
      boutStepSeen = s.step;
      boutStepAt = now;
    }
    const at = s.step + Math.min(1, (now - boutStepAt) / 50);
    const { n, off } = boutBeat(at, from);
    beatView.n = n;
    beatView.off = off;
    v.beat = beatView;
    v.count = at < from ? Math.ceil((from - at) / WRESTLE_BEAT) : 0;
  }
  v.left = Math.max(0, Math.min(BOUT_STEPS / STEPS_PER_SECOND, Math.ceil((BOUT_STEPS - t0) / STEPS_PER_SECOND)));
  v.next = side === 1 ? 2 : 1;
  v.str = s.str;
  // A grunt now and then while it's close.
  const now = performance.now();
  if (now - lastGrunt > 900 && Math.abs(bar / BAR - 0.5) < 0.3) {
    lastGrunt = now;
    if (Math.random() < 0.5) sound.grunt();
  }
  return v;
}

// ------------------------------------------------------------------ the lockpick's card

const pickView: PickView = { key: 'yellow', pins: 0, of: 0, marker: 0, from: 0, to: 0, uses: 0, heard: false, watched: false };
const spot: [number, number] = [0, 0];
const missNoise = { layer: LAYER.GROUND as number, tile: -1, reach: PICK_MISS_NOISE };
const pickMemo = { step: -1, heard: false, watched: false };

/** The lock being picked (null: none): the pins, the marker where the frame has it (`a`: the step's fraction), the sweet spot, the pick's uses, whether a guard would hear a slip. */
export function pickNow(sim: Sim, a: number): PickView | null {
  const s = sim.state;
  if (!s.pick.length) return null;
  const [tile, set, from] = s.pick;
  const v = pickView;
  v.key = KEY_ITEM_COLORS[sim.world.ground.key[tile] - 1]?.[0] ?? 'yellow';
  v.pins = set;
  v.of = pinsOf(sim.world, tile);
  // (The sim's marker, between steps: the key sent now lands on the next step, which judges this and the step before.)
  const k = s.step - from + a;
  const p = (((k * PICK_SPEED) % 2000) + 2000) % 2000;
  v.marker = (p <= 1000 ? p : 2000 - p) / 1000;
  sweetSpot(s.salt, tile, set, s.items.int, spot);
  v.from = spot[0] / 1000;
  v.to = spot[1] / 1000;
  const held = s.items.inv[s.items.hand];
  v.uses = itemOf(held) === LOCKPICK ? usesOf(held) : 0;
  // A guard in earshot of a slip (the sim's own rule), worked out once a step.
  if (pickMemo.step !== s.step) {
    missNoise.tile = tile;
    // (And who sees the player at it now: any guard's eyes, bribed or not, or a camera filming: work on a lock is tampering.)
    pickMemo.step = s.step;
    pickMemo.heard = wouldHear(sim, missNoise);
    pickMemo.watched = s.guards.some((g) => g.sees) || cameraSeesPlayer(sim);
  }
  v.heard = pickMemo.heard;
  v.watched = pickMemo.watched;
  return v;
}

/** 2.40: keys for the dice's card: 1 or 2 choose a die, Enter throws it again (or stands), or Done once it's over. */
export function diceKey(code: string): boolean {
  const card = gameCards()?.diceCard;
  if (!card?.open) return false;
  const digit = /^Digit([12])$/.exec(code);
  if (digit && card.phase === 'mine') {
    card.pick(Number(digit[1]) - 1);
    sound.click();
    return true;
  }
  // (Enter on a button of the card with the focus: that button's.)
  if ((code === 'Enter' || code === 'NumpadEnter') && !(document.activeElement as HTMLElement | null)?.closest('.dice-card button')) {
    card.primary();
    return true;
  }
  return false;
}

/** The talk panel's games, and the lockpick card's Set (a fresh use of the pick) and Step back. */
export function wireGames() {
  talk.games = gamesOffer;
  talk.gameCard = (sim) => !!diceNow(sim);
  talk.crew = crewTalk;
  whenCards(({ pickCard, wrestleCard, diceCard }) => {
    diceCard.onDone = () => dismissDice();
    // (2.40: the bout's beat heard as the gym's is; the count-in's beats too, its Go! a grunt.)
    wrestleCard.onBeat = (_count, go) => {
      if (go) sound.grunt();
      else sound.setBeat();
    };
    pickCard.onSet = () => {
      const g = play.game;
      if (!g || g.paused) return;
      sendOp(OP.USE, 1);
    };
    pickCard.onStop = () => {
      sound.click();
      sendOp(OP.CLOSE);
    };
  });
}

// ------------------------------------------------------------------ the picture

const diceFrame: NonNullable<GamesFrame['dice']> = {
  who: -1,
  x: 0,
  z: 0,
  fromX: 0,
  fromZ: 0,
  oppX: 0,
  oppZ: 0,
  mine: [0, 0],
  theirs: [0, 0],
  t: [-1, -1, -1, -1],
  seed: 0,
};
const boutFrame: NonNullable<GamesFrame['bout']> = { who: -1, strain: 0, surge: false, crate: null };
const crateAt = { x: 0, z: 0, angle: 0 };
const gamesFrame: GamesFrame = { bout: null, dice: null, taps: 0, sports: false, lock: null };
const lockAt0 = { x: 0, z: 0 };

/**
 * The games in the frame: the arm-wrestle (how it's going for the player), the dice on the
 * ground between the two while the game is shown, the pick's taps, sports day's bunting. The
 * player's pose (and the dice partner's) follows: `doing` for the player, the partner's index.
 */
/** 2.40: the arm-wrestle's crates between the player and the one they're wrestling (where the frame has them). */
export function placeCrate(px: number, pz: number, them: { x: number; z: number } | null | undefined) {
  if (!them) return;
  crateAt.x = (px + them.x) / 2;
  crateAt.z = (pz + them.z) / 2;
  crateAt.angle = Math.atan2(them.x - px, them.z - pz);
}

export function gamesFrameOf(sim: Sim, px: number, pz: number, rival: { x: number; z: number } | null): GamesFrame {
  const s = sim.state;
  const f = gamesFrame;
  f.taps = taps;
  f.sports = sportsOn(sim);
  if (s.pick.length) {
    lockAt0.x = (s.pick[0] % 64) + 0.5;
    lockAt0.z = Math.floor(s.pick[0] / 64) + 0.5;
    f.lock = lockAt0;
  } else f.lock = null;
  if (s.bout.length) {
    boutFrame.who = s.bout[0];
    boutFrame.strain = (s.bout[1] / BAR) * 2 - 1;
    boutFrame.surge = s.step >= s.bout[3] && surging(s.salt, s.bout[3], s.step - s.bout[3]);
    // (2.40: the crates the two lean over, between them; frame.ts puts them there, where the two are drawn.)
    boutFrame.crate = sim.rules239 ? null : crateAt;
    f.bout = boutFrame;
  } else f.bout = null;
  const shown = diceShown();
  // (Only while they're still talking: the dice go when the talk does.)
  if (shown && rival && s.layer === LAYER.GROUND && s.talk === shown.who) {
    const now = performance.now();
    const d = diceFrame;
    d.who = shown.who;
    d.fromX = px;
    d.fromZ = pz;
    d.oppX = rival.x;
    d.oppZ = rival.z;
    d.x = (px + rival.x) / 2;
    d.z = (pz + rival.z) / 2;
    d.mine[0] = shown.mine[0];
    d.mine[1] = shown.mine[1];
    d.theirs[0] = shown.theirs[0];
    d.theirs[1] = shown.theirs[1];
    // (Each die from its own throw: one thrown again tumbles alone.)
    for (let k = 0; k < 4; k++) d.t[k] = shown.at[k] ? (now - shown.at[k]) / 1000 : -1;
    d.seed = shown.id * 7;
    f.dice = d;
  } else f.dice = null;
  return f;
}

/** Who the dice are with now (shown or on the table), -1 none: they crouch over them. */
export function diceRival(sim: Sim): number {
  const s = sim.state;
  if (s.dice.length) return s.dice[0];
  return diceShown()?.who ?? -1;
}

/** The player's pose for the games (DOING), or -1 for none. */
export function gamesDoing(sim: Sim): number {
  const s = sim.state;
  if (s.bout.length) return DOING.WRESTLE;
  if (s.pick.length) return DOING.PICK;
  if (diceRival(sim) >= 0 && s.talk === diceRival(sim)) return DOING.DICE;
  return -1;
}
