/**
 * Checkers with the old-timer (P27): English draughts on the 32 dark squares (0–31, row by row
 * from his side: row = square >> 2, the even rows' squares one column in). The player's men start
 * on 20–31 and move up the board, his on 0–11 and move down; a man reaching the far row is
 * crowned (and its move ends there); kings move both ways. A capture is forced, a jump that can
 * go on must, and a piece jumped comes off at once (the same rule for his search and the player's
 * steps). No stakes and no heat: he plays anyone who thinks ELDER_OPINION of him, in the games'
 * hours (TALK.CHECKERS: 1 to the board, 0 up from it, 2 to resign), and the board stays set up
 * between times. The player moves a step at a time (TALK.MOVE, b: from, c: to); his move is a
 * search ELDER_DEPTH plies deep (deeper with every game the player has won off him), its ties
 * broken by roll(). A win teaches the player a point of Intellect (and he lets slip a secret: the
 * play layer's); any game finished, a point once a day.
 */
import { DRAW_PLIES, ELDER_DEPTH, ELDER_OPINION, ELDER_SLIP, ELDER_THINK, ELDER_THINK_MORE, ELDER_WIN_OPINION, PLAY_OPINION } from '../../content/games';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import { ATTRS, type Refusal } from '../state';
import { ATTR_MAX } from '../tuning';
import { gameOn, gamesOpen } from './games';
import { prisonDay } from './clock';
import { changeOpinion, refuse } from './social';
import { inmateInCell } from './inmates';

/** The pieces: the player's man and king, his man and king. */
export const PIECE = { EMPTY: 0, MAN: 1, KING: 2, HIS_MAN: 3, HIS_KING: 4 } as const;

/** A game on the old-timer's board (P27): plain data in the state. */
export interface Board {
  /** The 32 dark squares (PIECE). */
  sq: number[];
  /** Whose move: 0 the player's, 1 his. */
  turn: number;
  /** The player's piece half way through a jump that must go on (-1 none). */
  chain: number;
  /** Plies since a capture or a crowning (DRAW_PLIES: drawn), and plies in all. */
  quiet: number;
  plies: number;
  /** The step he moves at (his turn, with the player at the board). */
  at: number;
  /** The last move: its square from, then each square it landed on. */
  last: number[];
  /** 0 under way, 1 the player won, 2 he won, 3 drawn. */
  over: number;
  /** The player is at the board now. */
  seated: boolean;
}

/** What happened at the board (the 'checkers' event). */
export type CheckersNews = 'sat' | 'up' | 'moved' | 'won' | 'lost' | 'drawn';

// ------------------------------------------------------------------ the board's geometry

/** A square's row (0 his back row … 7 the player's) and column (0–7). */
const rowOf = (i: number) => i >> 2;
const colOf = (i: number) => ((i >> 2) % 2 === 0 ? 2 * (i & 3) + 1 : 2 * (i & 3));
/** The square at a row and column (-1 off the board or a light square). */
export function squareAt(r: number, c: number): number {
  if (r < 0 || r > 7 || c < 0 || c > 7 || (r + c) % 2 === 0) return -1;
  return r * 4 + (c >> 1);
}
/** The four diagonals: up-left, up-right (the player's men's way), down-left, down-right (his). */
const DIRS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];
/** Each square's neighbour and the square beyond it, by diagonal (-1 none). */
const NEXT: number[][] = [];
const BEYOND: number[][] = [];
for (let i = 0; i < 32; i++) {
  NEXT.push(DIRS.map(([dr, dc]) => squareAt(rowOf(i) + dr, colOf(i) + dc)));
  BEYOND.push(DIRS.map(([dr, dc]) => squareAt(rowOf(i) + 2 * dr, colOf(i) + 2 * dc)));
}

/** Whose a piece is: 0 the player's, 1 his, -1 an empty square. */
const sideOf = (p: number) => (p === PIECE.MAN || p === PIECE.KING ? 0 : p === PIECE.HIS_MAN || p === PIECE.HIS_KING ? 1 : -1);
/** The diagonals a piece moves along. */
const dirsOf = (p: number): readonly number[] => (p === PIECE.MAN ? [0, 1] : p === PIECE.HIS_MAN ? [2, 3] : [0, 1, 2, 3]);
/** A man on its far row is crowned. */
const crowned = (p: number, to: number) => (p === PIECE.MAN && rowOf(to) === 0) || (p === PIECE.HIS_MAN && rowOf(to) === 7);

/** A new game: twelve men each on the dark squares at either end. */
export function newBoard(): Board {
  const sq = new Array(32).fill(PIECE.EMPTY);
  for (let i = 0; i < 12; i++) sq[i] = PIECE.HIS_MAN;
  for (let i = 20; i < 32; i++) sq[i] = PIECE.MAN;
  return { sq, turn: 0, chain: -1, quiet: 0, plies: 0, at: 0, last: [], over: 0, seated: true };
}

/** One step of a move: a square to the next, and the piece jumped (-1: a plain move). */
export interface Step {
  from: number;
  to: number;
  cap: number;
}

/** A piece's jumps from a square. */
function jumpsFrom(sq: readonly number[], i: number, out: Step[]) {
  const p = sq[i];
  const me = sideOf(p);
  for (const d of dirsOf(p)) {
    const mid = NEXT[i][d];
    const to = BEYOND[i][d];
    if (mid < 0 || to < 0 || sq[to] !== PIECE.EMPTY || sideOf(sq[mid]) !== 1 - me) continue;
    out.push({ from: i, to, cap: mid });
  }
}

/**
 * The steps a side may take now: a jump if it has one (from `chain` alone, half way through
 * one), else any plain move. Pure: the card lights the same squares the rule takes.
 */
export function stepsOf(sq: readonly number[], side: number, chain = -1, out: Step[] = []): Step[] {
  out.length = 0;
  if (chain >= 0) {
    jumpsFrom(sq, chain, out);
    return out;
  }
  for (let i = 0; i < 32; i++) if (sideOf(sq[i]) === side) jumpsFrom(sq, i, out);
  if (out.length) return out;
  for (let i = 0; i < 32; i++) {
    const p = sq[i];
    if (sideOf(p) !== side) continue;
    for (const d of dirsOf(p)) {
      const to = NEXT[i][d];
      if (to >= 0 && sq[to] === PIECE.EMPTY) out.push({ from: i, to, cap: -1 });
    }
  }
  return out;
}

/** A step taken on a board: the piece moved, one jumped off, a man on the far row crowned. Returns whether it was crowned. */
function take(sq: number[], st: Step): boolean {
  const p = sq[st.from];
  sq[st.from] = PIECE.EMPTY;
  if (st.cap >= 0) sq[st.cap] = PIECE.EMPTY;
  const crown = crowned(p, st.to);
  sq[st.to] = crown ? (p === PIECE.MAN ? PIECE.KING : PIECE.HIS_KING) : p;
  return crown;
}

// ------------------------------------------------------------------ his moves: whole moves, and a search

/** A whole move: its steps (a plain move, or every jump of a capture). */
type Move = Step[];

/** Every whole move a side has (captures forced, each jump that can go on gone on with). */
function movesOf(sq: number[], side: number): Move[] {
  const first = stepsOf(sq, side);
  if (!first.length || first[0].cap < 0) return first.map((st) => [st]);
  const out: Move[] = [];
  const walk = (path: Step[]) => {
    const st = path[path.length - 1];
    const was = [sq[st.from], sq[st.cap], sq[st.to]];
    const crown = take(sq, st);
    const more = crown ? [] : stepsOf(sq, side, st.to, []);
    if (more.length) for (const nx of more) walk([...path, nx]);
    else out.push(path);
    sq[st.from] = was[0];
    sq[st.cap] = was[1];
    sq[st.to] = was[2];
  };
  for (const st of first) walk([st]);
  return out;
}

/** A whole move made (`undo` gets back what it changed). */
function makeMove(sq: number[], mv: Move, undo: number[]) {
  undo.length = 0;
  for (const st of mv) {
    undo.push(st.from, sq[st.from], st.cap, st.cap >= 0 ? sq[st.cap] : 0, st.to, sq[st.to]);
    take(sq, st);
  }
}
function unmakeMove(sq: number[], undo: number[]) {
  for (let k = undo.length - 6; k >= 0; k -= 6) {
    sq[undo[k]] = undo[k + 1];
    if (undo[k + 2] >= 0) sq[undo[k + 2]] = undo[k + 3];
    sq[undo[k + 4]] = undo[k + 5];
  }
}

/** How good a board is for a side (integers): men 100 and further up the board better, kings 160, the middle and the back row held a little. */
function evaluate(sq: readonly number[], side: number): number {
  let v = 0;
  for (let i = 0; i < 32; i++) {
    const p = sq[i];
    if (!p) continue;
    const r = rowOf(i);
    const c = colOf(i);
    let w = p === PIECE.KING || p === PIECE.HIS_KING ? 160 : 100;
    if (p === PIECE.MAN) w += (7 - r) * 4 + (r === 7 ? 6 : 0);
    if (p === PIECE.HIS_MAN) w += r * 4 + (r === 0 ? 6 : 0);
    if (r >= 2 && r <= 5 && c >= 2 && c <= 5) w += 4;
    v += sideOf(p) === side ? w : -w;
  }
  return v;
}

const WIN = 100000;

/** Negamax with alpha-beta: the best a side can make of a board, looking `depth` plies ahead. */
function search(sq: number[], side: number, depth: number, alpha: number, beta: number, ply: number): number {
  const moves = movesOf(sq, side);
  if (!moves.length) return -WIN + ply;
  if (depth <= 0) return evaluate(sq, side);
  const undo: number[] = [];
  for (const mv of moves) {
    makeMove(sq, mv, undo);
    const v = -search(sq, 1 - side, depth - 1, -beta, -alpha, ply + 1);
    unmakeMove(sq, undo);
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return alpha;
}

/**
 * His move: every move he has, in an order roll() shuffles for this ply of this game, searched
 * `depth` plies; the first of the best is played. Now and then (ELDER_SLIP) he plays one at
 * random. Pure: the same board, salt and count give the same move.
 */
export function elderMove(sq: readonly number[], salt: number, game: number, ply: number, level: number): Move | null {
  const board = sq.slice();
  const moves = movesOf(board, 1);
  if (!moves.length) return null;
  for (let j = moves.length - 1; j > 0; j--) {
    const k = rollInt(salt, SALT.CHECKERS, game * 1000 + ply, j, j + 1);
    [moves[j], moves[k]] = [moves[k], moves[j]];
  }
  const lv = Math.min(level, ELDER_DEPTH.length - 1);
  if (rollInt(salt, SALT.CHECKERS, game * 1000 + ply, 0, 100) < ELDER_SLIP[lv]) return moves[0];
  let best = moves[0];
  let bestV = -Infinity;
  const undo: number[] = [];
  for (const mv of moves) {
    makeMove(board, mv, undo);
    const v = -search(board, 0, ELDER_DEPTH[lv] - 1, -WIN - 1, -bestV, 1);
    unmakeMove(board, undo);
    if (v > bestV) {
      bestV = v;
      best = mv;
    }
  }
  return best;
}

// ------------------------------------------------------------------ the old-timer and the board

/** The old-timer (inmate index), -1 in a prison without one. */
export function elderOf(sim: Pick<SimContext, 'world' | 'state'>): number {
  const cell = sim.world.def.leisure?.oldTimer ?? -1;
  return inmateInCell(sim.state, cell);
}

/** Why the old-timer won't play now (null: he will). */
export function elderRefusal(sim: SimContext): Refusal | null {
  const s = sim.state;
  const who = elderOf(sim);
  const m = s.inmates[who];
  if (!m || s.talk !== who) return 'gamesClosed';
  if (s.lockdown) return 'gamesLockdown';
  if (!gamesOpen(sim)) return 'gamesClosed';
  if (m.opinion < ELDER_OPINION) return 'elderOpinion';
  return null;
}

/** Whether the player can stay at the board: talking to him, no sirens (a sitting begun goes on past the games' hours). */
function atBoard(sim: SimContext): boolean {
  const s = sim.state;
  const m = s.inmates[elderOf(sim)];
  return !!m && s.talk === elderOf(sim) && !s.lockdown && m.ko <= 0 && m.angry <= 0 && !sim.away && !s.sleeping;
}

/** The games played with him so far: won, lost, drawn, and the prison day a game last taught the player a point. */
const ELDER = { WON: 0, LOST: 1, DRAWN: 2, TAUGHT: 3 } as const;
/** How well he plays now: the games the player has won off him. */
const elderLevel = (s: { elder: number[] }) => s.elder[ELDER.WON] ?? 0;

/** To the board (TALK.CHECKERS 1: a new game if there's none, or the last is over), up from it (0), or resigning (2). */
export function checkersOp(sim: SimContext, b: number) {
  const s = sim.state;
  if (b === 0) return getUp(sim);
  // (At the board already, a sitting begun goes on: resigning, or a new game once one's over.)
  const sitting = !!s.board?.seated && atBoard(sim);
  if (b === 2) {
    if (sitting && !s.board!.over) finish(sim, 2, true);
    return;
  }
  const why = sitting ? null : elderRefusal(sim);
  if (why) return refuse(sim, why);
  // (Not in the middle of another game: dice on the table, a bout, a hand of Cheat, a shootout.)
  if (!sitting && gameOn(s)) return;
  if (!s.board || s.board.over) {
    s.board = newBoard();
  } else s.board.seated = true;
  // (His move waiting while the player was away: he thinks again from now.)
  if (s.board.turn === 1) s.board.at = s.step + thinkOf(sim);
  sim.events.push({ type: 'checkers', what: 'sat', who: elderOf(sim) });
}

/** Up from the board: it stays as it is for next time. */
export function getUp(sim: SimContext) {
  const b = sim.state.board;
  if (!b || !b.seated) return;
  b.seated = false;
  sim.events.push({ type: 'checkers', what: 'up', who: elderOf(sim) });
}

/** How long he thinks over his next move (steps). */
const thinkOf = (sim: SimContext) => ELDER_THINK + rollInt(sim.state.salt, SALT.CHECKERS, sim.state.step, 7, ELDER_THINK_MORE + 1);

const steps: Step[] = [];

/** The player's step at the board (TALK.MOVE, b: from, c: to): legal, taken; the move goes on if the jump can, else it's his turn. */
export function moveOn(sim: SimContext, from: number, to: number) {
  const s = sim.state;
  const b = s.board;
  if (!b || !b.seated || b.over || b.turn !== 0 || !atBoard(sim)) return;
  const st = stepsOf(b.sq, 0, b.chain, steps).find((x) => x.from === from && x.to === to);
  if (!st) return;
  if (b.chain < 0) b.last = [from];
  const crown = take(b.sq, st);
  b.last.push(to);
  b.quiet = st.cap >= 0 || crown ? 0 : b.quiet + 1;
  // A jump that can go on must (not once crowned: that ends the move).
  if (st.cap >= 0 && !crown && stepsOf(b.sq, 0, to, steps).length) {
    b.chain = to;
    sim.events.push({ type: 'checkers', what: 'moved', who: elderOf(sim), by: 0, path: b.last.slice(), more: true });
    return;
  }
  b.chain = -1;
  b.plies++;
  b.turn = 1;
  b.at = s.step + thinkOf(sim);
  sim.events.push({ type: 'checkers', what: 'moved', who: elderOf(sim), by: 0, path: b.last.slice() });
  settle(sim);
}

/** After a move: the side to move with none left has lost; DRAW_PLIES quiet plies, a draw. */
function settle(sim: SimContext) {
  const b = sim.state.board!;
  if (!stepsOf(b.sq, b.turn, -1, steps).length) return finish(sim, b.turn === 0 ? 2 : 1);
  if (b.quiet >= DRAW_PLIES) finish(sim, 3);
}

/** A game over (1 the player won, 2 he did, 3 drawn): what it brings, the board left as it ended. */
function finish(sim: SimContext, over: number, resigned = false) {
  const s = sim.state;
  const b = s.board!;
  b.over = over;
  b.chain = -1;
  const who = elderOf(sim);
  const m = s.inmates[who];
  const was = m?.opinion ?? 0;
  while (s.elder.length < 4) s.elder.push(0);
  s.elder[over === 1 ? ELDER.WON : over === 2 ? ELDER.LOST : ELDER.DRAWN]++;
  // (A game resigned brings nothing: no respect, no lesson. Played to its end, it does.)
  if (!resigned) changeOpinion(sim, who, over === 1 ? ELDER_WIN_OPINION : PLAY_OPINION);
  // A point of Intellect: for a win always, for any game played to its end once a prison day.
  const day = prisonDay(s.step);
  const teach = !resigned && (over === 1 || s.elder[ELDER.TAUGHT] !== day) && s.items.int < ATTR_MAX;
  if (teach) {
    s.items.int++;
    s.items.rev++;
    s.elder[ELDER.TAUGHT] = day;
    s.trained |= 1 << ATTRS.indexOf('int');
  }
  sim.events.push({ type: 'checkers', what: over === 1 ? 'won' : over === 2 ? 'lost' : 'drawn', who, int: teach ? 1 : 0, gain: (m?.opinion ?? 0) - was });
}

/** Each step at the board: the player gone from it (up), his move when he's done thinking. */
export function keepCheckers(sim: SimContext) {
  const s = sim.state;
  const b = s.board;
  if (!b || !b.seated) return;
  if (!atBoard(sim)) return getUp(sim);
  if (b.over || b.turn !== 1 || s.step < b.at) return;
  const mv = elderMove(b.sq, s.salt, (s.elder[0] ?? 0) + (s.elder[1] ?? 0) + (s.elder[2] ?? 0), b.plies, elderLevel(s));
  if (!mv) return finish(sim, 1);
  b.last = [mv[0].from];
  let reset = false;
  for (const st of mv) {
    if (take(b.sq, st) || st.cap >= 0) reset = true;
    b.last.push(st.to);
  }
  b.quiet = reset ? 0 : b.quiet + 1;
  b.plies++;
  b.turn = 0;
  sim.events.push({ type: 'checkers', what: 'moved', who: elderOf(sim), by: 1, path: b.last.slice() });
  settle(sim);
}
