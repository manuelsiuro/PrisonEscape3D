/**
 * Cheat (P27): a card game of bluff with an inmate, for a stake (TALK.CHEAT; it counts as one of
 * the day's games). Each round deals five cards each from the 14 (DECK) and turns up the table
 * card (a King, a Queen or an Ace; the Joker is wild). Turn about, a player lays 1–3 cards face
 * down "as" the table card (TALK.PLAY, b: the hand's cards as bits), or calls "Liar!" on the last
 * play (TALK.LIAR): the cards turn over, and whoever was wrong (the liar, or the caller) loses a
 * chip. A hand played out must be called. The last chip lost loses the stake. The player has
 * TURN_STEPS for each move (2.5.1), and a game still on at roll call or Lights Out is settled on
 * the chips there and then.
 *
 * The inmate plays true when it can and bluffs when it can't; it calls a claim its own cards prove
 * false, and otherwise as the claim's size and its own plight make it doubt. Its tell (by cell)
 * shows on most of its lies (more with the player's Intellect) and on a few of its truths. Every
 * shuffle and every choice comes from roll(): nothing here touches the state's rng, and nothing
 * happens without the player asking.
 */
import { CALL_DOUBT, CALL_FLOOR, CALL_MAX, CALL_STUCK, CARD, CHIPS, CLAIM_MAX, DECK, DICE_HEAT, FALSE_TELL, HAND, PLAY_OPINION, REVEAL_STEPS, STAKES, TELL_BASE, TELL_MAX, TELLS, THINK_STEPS, TURN_STEPS, type Tell } from '../../content/games';
import { ROUTINE } from '../../content/routine';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import { countGame, eyesOn, gameOn, gameRefusal } from './games';
import { changeOpinion, refuse } from './social';
import { stopTraining } from './training';
import { addHeat } from './watch';
import { closeBox } from './items';

/** A game of Cheat under way (P27): plain data in the state. */
export interface Cheat {
  /** The inmate (index), and the stake's place in STAKES (on the table since the deal). */
  who: number;
  stake: number;
  /** Chips left: the player's, the inmate's. */
  chips: [number, number];
  /** The round (from 0), and its table card (CARD.KING, QUEEN or ACE). */
  round: number;
  table: number;
  /** The hands (CARD values), in the order dealt. */
  mine: number[];
  theirs: number[];
  /** Whose move: 0 the player's, 1 the inmate's (at step `at`), 2 a call's cards face up (the next deal at `at`). */
  turn: number;
  at: number;
  /** The last play this round, face down: its cards, who laid them (0 the player, 1 the inmate, -1 none yet). */
  last: number[];
  by: number;
  /** Cards on the pile this round. */
  pile: number;
  /** The inmate's tell showed on its last play. */
  tell: boolean;
  /** Who leads the next round (the loser of the call). */
  lead: number;
  /** Cards the inmate has laid itself this round, and how many of them true (it knows they're out of play). */
  laid: number;
  spent: number;
  /** The step the player's move is due by (2.5.1; 0 or missing: not their move, or the clock not yet started). */
  due?: number;
}

/** What a game of Cheat did (the 'cheat' event). */
export type CheatNews = 'dealt' | 'played' | 'called' | 'won' | 'lost' | 'folded' | 'off';

/** An inmate's tell (by cell: always the same one). */
export const tellOf = (cell: number): Tell => TELLS[(cell * 7 + 3) % TELLS.length];

/** A card that's what's claimed: the table card, or the Joker. */
export const isTrue = (card: number, table: number) => card === table || card === CARD.JOKER;

/** The odds (out of 100) the inmate's tell shows on a lie, for the player's Intellect. */
export const tellOdds = (int: number) => Math.min(TELL_MAX, TELL_BASE + Math.floor(Math.max(0, int) / 4));

/** The 14 cards, shuffled for a deal at a step: every card's place from roll(). */
function shuffled(salt: number, step: number): number[] {
  const deck: number[] = [];
  DECK.forEach((n, k) => {
    for (let j = 0; j < n; j++) deck.push(k + 1);
  });
  for (let j = deck.length - 1; j > 0; j--) {
    const k = rollInt(salt, SALT.CARDS, step, j, j + 1);
    [deck[j], deck[k]] = [deck[k], deck[j]];
  }
  return deck;
}

/** A round dealt (pure): five cards each, the table card turned up; `lead` moves first (the inmate after THINK_STEPS). */
export function dealRound(c: Cheat, salt: number, step: number, lead: number) {
  const deck = shuffled(salt, step);
  c.mine = deck.slice(0, HAND);
  c.theirs = deck.slice(HAND, HAND * 2);
  c.table = 1 + rollInt(salt, SALT.CARDS, step, 100, 3);
  c.last = [];
  c.by = -1;
  c.pile = 0;
  c.tell = false;
  c.spent = 0;
  c.laid = 0;
  c.turn = lead;
  c.at = lead === 1 ? step + THINK_STEPS : 0;
}

function deal(sim: SimContext, c: Cheat, lead: number) {
  dealRound(c, sim.state.salt, sim.state.step, lead);
  sim.events.push({ type: 'cheat', what: 'dealt', who: c.who, round: c.round });
}

/** A game of Cheat for a stake (TALK.CHEAT, b: the stake's place in STAKES): the stake goes on the table, the first round is dealt, the player leads. */
export function startCheat(sim: SimContext, who: number, b: number) {
  const s = sim.state;
  const stake = STAKES[b];
  if (stake === undefined || gameOn(s)) return;
  const why = gameRefusal(sim, who);
  if (why) return refuse(sim, why);
  if (s.cash < stake) return refuse(sim, 'cash');
  countGame(sim, who);
  stopTraining(sim);
  closeBox(sim);
  s.cash -= stake;
  sim.events.push({ type: 'cash', n: -stake, why: 'dice' });
  const c: Cheat = { who, stake: b, chips: [CHIPS, CHIPS], round: 0, table: CARD.KING, mine: [], theirs: [], turn: 0, at: 0, last: [], by: -1, pile: 0, tell: false, lead: 0, laid: 0, spent: 0 };
  s.cheat = c;
  deal(sim, c, 0);
  changeOpinion(sim, who, PLAY_OPINION);
  // Gambling under a guard's nose: heat (as dice).
  if (eyesOn(s, s.step - 1)) {
    sim.events.push({ type: 'spotted', reason: 'gambling' });
    addHeat(sim, DICE_HEAT);
  }
}

/** The cards picked by a mask over a hand (bit k: the k-th card), or null if the mask isn't 1–CLAIM_MAX of them. */
function picked(hand: readonly number[], mask: number): number[] | null {
  const out: number[] = [];
  for (let k = 0; k < hand.length; k++) if (mask & (1 << k)) out.push(k);
  if (!out.length || out.length > CLAIM_MAX || mask >> hand.length) return null;
  return out;
}

/** Whether the player may lay cards now: their move, cards in hand, and the inmate's hand not played out (that must be called). */
export const canPlay = (c: Cheat) => c.turn === 0 && c.mine.length > 0 && !(c.by === 1 && c.theirs.length === 0);
/** Whether the player may call: their move, on the inmate's play. */
export const canCall = (c: Cheat) => c.turn === 0 && c.by === 1;

/** The player lays cards face down as the table card (TALK.PLAY, b: which of the hand, as bits). */
export function playCards(sim: SimContext, mask: number) {
  const s = sim.state;
  const c = s.cheat;
  if (!c || !canPlay(c)) return;
  const ks = picked(c.mine, mask);
  if (!ks) return;
  lay(c, 0, ks, false, s.step);
  sim.events.push({ type: 'cheat', what: 'played', who: c.who, by: 0, n: ks.length });
}

/** The player calls "Liar!" on the inmate's last play (TALK.LIAR). */
export function callLiar(sim: SimContext) {
  const c = sim.state.cheat;
  if (!c || !canCall(c)) return;
  reveal(sim, c, 0);
}

/** Cards laid face down (pure): out of the hand onto the pile, as the last play; the other's move (the inmate's after THINK_STEPS). */
export function lay(c: Cheat, by: number, ks: readonly number[], tell: boolean, step: number) {
  const hand = by === 0 ? c.mine : c.theirs;
  c.last = ks.map((k) => hand[k]);
  const rest = hand.filter((_, k) => !ks.includes(k));
  if (by === 0) c.mine = rest;
  else c.theirs = rest;
  c.by = by;
  c.pile += ks.length;
  c.tell = tell;
  if (by === 1) {
    c.laid += ks.length;
    c.spent += c.last.filter((card) => isTrue(card, c.table)).length;
  }
  c.turn = 1 - by;
  c.at = by === 0 ? step + THINK_STEPS : 0;
}

/**
 * A call (pure; `caller`: 0 the player, 1 the inmate): the last play turns over. A lie loses its
 * layer a chip, the truth the caller one. Unless that was the loser's last chip, the cards stay
 * face up REVEAL_STEPS and the loser leads the next round. Returns whether it was a lie, and who lost the chip.
 */
export function callOn(c: Cheat, caller: number, step: number): { lie: boolean; loser: number } {
  const lie = c.last.some((card) => !isTrue(card, c.table));
  const loser = lie ? c.by : caller;
  c.chips[loser]--;
  c.turn = 2;
  c.at = step + REVEAL_STEPS;
  c.lead = loser;
  return { lie, loser };
}

/** A call made: the cards turned over, a chip lost, the game over on the last one. */
function reveal(sim: SimContext, c: Cheat, caller: number) {
  const cards = c.last.slice();
  const { lie, loser } = callOn(c, caller, sim.state.step);
  sim.events.push({ type: 'cheat', what: 'called', who: c.who, by: caller, lie, cards, loser });
  if (c.chips[loser] <= 0) endCheat(sim, loser === 1 ? 'won' : 'lost');
}

/**
 * How a game of Cheat ended: won or lost on the chips, folded (the player walked away from the
 * table, or let their move's clock run out: the stake is the inmate's), or off (the sirens,
 * someone knocked out, not behind at the roll call's bell: the stake comes back). A game begun plays
 * out past the games' hours, up to roll call or Lights Out.
 */
export function endCheat(sim: SimContext, how: 'won' | 'lost' | 'folded' | 'off', late = false) {
  const s = sim.state;
  const c = s.cheat;
  if (!c) return;
  s.cheat = null;
  const stake = STAKES[c.stake];
  const back = how === 'won' ? stake * 2 : how === 'off' ? stake : 0;
  if (back) {
    s.cash += back;
    sim.events.push({ type: 'cash', n: back, why: 'dice' });
  }
  sim.events.push(late ? { type: 'cheat', what: how, who: c.who, stake, late } : { type: 'cheat', what: how, who: c.who, stake });
}

/**
 * The inmate's move (pure): call the player's play, or the cards it lays and whether its tell
 * shows. It calls a hand played out, and any claim its own cards prove false (there are only so
 * many of the table card and the Jokers); else as much as it doubts (the claim's odds as it sees
 * them, nothing true of its own to lay). It lays some of its true cards (table cards before
 * Jokers: one to three, as many as roll() says, the rest kept back), and with none a bluff of one
 * to three: the size of a play gives nothing away. (What
 * it knows: its own hand, and the true cards it has laid itself this round.)
 */
export function decide(c: Cheat, salt: number, step: number, int: number): { call: true } | { call: false; ks: number[]; tell: boolean } {
  const r = (k: number, n: number) => rollInt(salt, SALT.CARDS, step, k, n);
  const own = c.theirs.filter((card) => isTrue(card, c.table)).length;
  if (c.by === 0) {
    if (!c.mine.length) return { call: true };
    const odds = claimOdds(c);
    if (odds === 0) return { call: true };
    // Else as much as it doubts: the less likely the claim, the likelier the call (more so with nothing true of its own to lay, and with the player nearly out).
    const doubt = Math.max(0, 100 - odds - CALL_FLOOR);
    if (r(1, 100) < Math.min(CALL_MAX, Math.floor((doubt * CALL_DOUBT) / 100) + (own ? 0 : CALL_STUCK))) return { call: true };
  }
  const order = c.theirs.map((card, k) => ({ card, k })).filter((x) => isTrue(x.card, c.table));
  order.sort((a, b) => (a.card === CARD.JOKER ? 1 : 0) - (b.card === CARD.JOKER ? 1 : 0) || a.k - b.k);
  // (How many it lays tells nothing: some of its true cards, kept back for later plays, or a bluff of any size.)
  let ks: number[];
  if (order.length) ks = order.slice(0, 1 + r(5, Math.min(CLAIM_MAX, order.length))).map((x) => x.k);
  else ks = Array.from({ length: 1 + r(3, Math.min(CLAIM_MAX, c.theirs.length)) }, (_, k) => k);
  const lie = ks.some((k) => !isTrue(c.theirs[k], c.table));
  return { call: false, ks, tell: r(4, 100) < (lie ? tellOdds(int) : FALSE_TELL) };
}

/** n choose k (small numbers: exact). */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let v = 1;
  for (let j = 1; j <= k; j++) v = (v * (n - k + j)) / j;
  return Math.round(v);
}

/**
 * How likely (out of 100) the player's last claim is true, as the inmate sees it: the cards it
 * can't see (all but its hand and what it laid itself this round) hold the true ones it doesn't;
 * the player's hand as it was held at least as many as were laid. Exact, in integers.
 */
function claimOdds(c: Cheat): number {
  const n = c.last.length;
  const total = DECK[c.table - 1] + DECK[CARD.JOKER - 1];
  const laid = c.laid;
  const unseen = DECK.reduce((a, b) => a + b, 0) - c.theirs.length - laid;
  const trueUnseen = total - c.theirs.filter((card) => isTrue(card, c.table)).length - c.spent;
  const hand = c.mine.length + n;
  let yes = 0;
  for (let x = n; x <= Math.min(hand, trueUnseen); x++) yes += choose(trueUnseen, x) * choose(unseen - trueUnseen, hand - x);
  const all = choose(unseen, hand);
  return all ? Math.floor((yes * 100) / all) : 0;
}

/** The inmate's move, made. */
function inmateMove(sim: SimContext, c: Cheat) {
  const s = sim.state;
  const d = decide(c, s.salt, s.step, s.items.int);
  if (d.call) return reveal(sim, c, 1);
  lay(c, 1, d.ks, d.tell, s.step);
  sim.events.push({ type: 'cheat', what: 'played', who: c.who, by: 1, n: d.ks.length, tell: d.tell });
}

/** Blocks a game of Cheat (or a shootout) can't run on into (2.5.1): the roll calls and Lights Out. */
export const gamesBell = (s: { routine: number }) => {
  const id = ROUTINE[s.routine]?.id;
  return id === 'rollCall' || id === 'eveningRollCall' || id === 'lightsOut';
};

/**
 * Each step of a game of Cheat: the sirens or the inmate in no state to play (off), the inmate's
 * move, the next deal; 2.5.1: the player's move on a clock, the roll call's bell settling it.
 */
export function keepCheat(sim: SimContext) {
  const s = sim.state;
  const c = s.cheat;
  if (!c) return;
  const m = s.inmates[c.who];
  // (A game begun plays out past the games' hours: only the sirens, or the inmate in no state to play, break it off.)
  if (!m || m.ko > 0 || m.angry > 0 || s.lockdown) return endCheat(sim, 'off');
  if (s.talk !== c.who) return endCheat(sim, sim.away ? 'off' : 'folded');
  if (!sim.rules250) {
    // Roll call or Lights Out: behind, the hand is lost; else the stake comes back (never won at the bell: a lead stalled to it would be a sure profit), never stalled into the sirens a missed roll call brings.
    if (gamesBell(s)) return endCheat(sim, c.chips[0] < c.chips[1] ? 'lost' : 'off');
    // (No clock in the lessons: the tutorial's prison takes its time.)
    if (c.turn !== 0 || sim.world.def.rules?.relaxed) c.due = 0;
    else if (!c.due) c.due = s.step + TURN_STEPS;
    else if (s.step >= c.due) {
      // The clock out: the call made for them if that's all they could do, else they've left the table.
      c.due = 0;
      if (!canPlay(c) && canCall(c)) return reveal(sim, c, 0);
      return endCheat(sim, 'folded', true);
    }
  }
  if (c.turn === 1 && s.step >= c.at) inmateMove(sim, c);
  else if (c.turn === 2 && s.step >= c.at) {
    c.round++;
    deal(sim, c, c.lead);
  }
}
