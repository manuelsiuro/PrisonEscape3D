import { currentLang, t, type Key } from '../i18n';
import { OP, TALK } from '../sim/command';
import { confirmed } from './social';
import { h, setText, TOUCH } from './dom';
import { icon } from './icons';

type Send = (op: number, a?: number, b?: number, c?: number) => void;

/**
 * Card sharks (P27) on screen: the card for a hand of Cheat, the court's card (the power meter,
 * the shootout's scoreboard, the Shoot pad), and the old-timer's checkers board. Each is drawn
 * from a view the play layer fills from the sim (play/pastimes.ts): what they show is what the
 * rules judge. Every button is an OP.TALK (or the shot's EXT.SHOOT), redrawn from the sim.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A card's letter and name key (CARD: 1 King, 2 Queen, 3 Ace, 4 Joker). */
const RANK = ['', 'K', 'Q', 'A', '★'];
const CARD_KEY = ['', 'king', 'queen', 'ace', 'joker'] as const;
export const cardName = (card: number, many = false) => t(`cheat.${CARD_KEY[card]}${many ? 's' : ''}` as Key);

/** A playing card as a little face (0: face down). */
export function cardFace(card: number, cls = ''): string {
  if (!card) return `<span class="pcard back ${cls}" aria-hidden="true"><i></i></span>`;
  return `<span class="pcard ${cls}" data-card="${card}" aria-hidden="true"><b>${RANK[card]}</b><i>${RANK[card]}</i></span>`;
}

// ------------------------------------------------------------------ Cheat

/** A hand of Cheat as the card shows it (P27). */
export interface CheatView {
  name: string;
  stake: number;
  /** Chips left: the player's, the inmate's. */
  chips: [number, number];
  of: number;
  table: number;
  mine: number[];
  theirs: number;
  pile: number;
  /** Whose move: the player's, the inmate's (thinking), or a call's cards face up. */
  phase: 'yours' | 'theirs' | 'reveal';
  /** The last play face down: who laid it (0 the player, 1 the inmate), how many. */
  last: { by: number; n: number } | null;
  /** The inmate's tell on its last play (its words), or ''. */
  tell: string;
  /** A call's cards face up: who called, whether it was a lie, who lost a chip. */
  reveal: { cards: number[]; by: number; lie: boolean; loser: number } | null;
  canPlay: boolean;
  canCall: boolean;
  /** The inmate's hand is played out: the player must call. */
  mustCall: boolean;
  /** Bumps with each deal (the selection clears). */
  deal: number;
}

/**
 * The card for a hand of Cheat (P27): the chips each side has left, the table card, the pile,
 * the inmate's last play and its tell, a call's cards turned over, and the player's hand: tap
 * 1–3 cards and Lay them as the table card, or call Liar! (keys 1–5, Enter, L). Close folds
 * (asking twice: the stake is lost).
 */
export class CheatCard {
  private readonly el: HTMLElement;
  private readonly say: HTMLElement;
  private drawn = '';
  private sel = 0;
  private deal = -1;
  private said = '';

  constructor(private readonly send: Send, private readonly click: () => void) {
    this.el = h('div', 'train-card cheat-card hidden');
    this.el.setAttribute('role', 'dialog');
    this.say = h('span', 'sr-only');
    this.say.setAttribute('role', 'status');
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
      if (card) {
        this.click();
        this.toggle(Number(card.dataset.pick));
        return;
      }
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-do]');
      if (!b || (b as HTMLButtonElement).disabled) return;
      this.click();
      if (!confirmed(b)) return;
      const what = b.dataset.do;
      if (what === 'lay') this.lay();
      else if (what === 'liar') this.liar();
      else if (what === 'fold') this.send(OP.CLOSE);
    });
    document.body.append(this.el);
    this.el.append(this.say);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  /** A card of the hand chosen or let go (at most three). */
  toggle(k: number) {
    const bit = 1 << k;
    if (this.sel & bit) this.sel &= ~bit;
    else if (bitsOf(this.sel) < 3) this.sel |= bit;
    this.drawn = '';
  }

  lay() {
    if (!this.sel) return;
    this.send(OP.TALK, TALK.PLAY, this.sel);
    this.sel = 0;
    this.drawn = '';
  }

  liar() {
    this.send(OP.TALK, TALK.LIAR);
  }

  update(v: CheatView | null) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      this.sel = 0;
      return;
    }
    if (v.deal !== this.deal) {
      this.deal = v.deal;
      this.sel = 0;
    }
    // (A card gone from the hand: the selection can't point past it.)
    this.sel &= (1 << v.mine.length) - 1;
    const key = JSON.stringify(v) + this.sel + currentLang() + TOUCH;
    if (key === this.drawn) return;
    this.drawn = key;
    const had = this.el.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const again = had?.dataset.pick !== undefined ? `[data-pick="${had.dataset.pick}"]` : had?.dataset.do ? `[data-do="${had.dataset.do}"]` : '';
    const chips = (n: number) => Array.from({ length: v.of }, (_, k) => `<i class="${k < n ? 'on' : ''}"></i>`).join('');
    const table = `<div class="cheat-table"><span class="cheat-label">${t('cheat.table')}</span>${cardFace(v.table, 'big')}<b>${esc(cardName(v.table, true))}</b><small>${t('cheat.jokerWild')}</small></div>`;
    // What's happening now: the inmate's last play and its tell, a call turned over, whose move.
    let now: string;
    if (v.reveal) {
      const r = v.reveal;
      const caller = r.by === 0 ? t('games.you') : esc(v.name);
      const verdict = r.lie ? (r.by === 0 ? t('cheat.caught', { name: esc(v.name) }) : t('cheat.youCaught')) : r.by === 0 ? t('cheat.wrongCall') : t('cheat.theyWrong', { name: esc(v.name) });
      now = `<div class="cheat-reveal" data-lie="${r.lie}" data-loser="${r.loser}"><p class="cheat-call">${t('cheat.called', { who: caller })}</p><div class="cheat-flip">${r.cards.map((c) => cardFace(c, 'flip')).join('')}</div><p class="cheat-verdict">${verdict}</p></div>`;
    } else {
      const last = v.last
        ? v.last.by === 1
          ? `<p class="cheat-claim">${t(v.last.n === 1 ? 'cheat.theyLay1' : 'cheat.theyLay', { name: esc(v.name), n: v.last.n, card: esc(cardName(v.table, v.last.n > 1)) })}</p>`
          : `<p class="cheat-claim mine">${t(v.last.n === 1 ? 'cheat.youLaid1' : 'cheat.youLaid', { n: v.last.n, card: esc(cardName(v.table, v.last.n > 1)) })}</p>`
        : '';
      const tell = v.tell ? `<p class="cheat-tell">${icon('eye', 13)}<span>${esc(v.tell)}</span></p>` : '';
      const status = v.phase === 'theirs' ? t('cheat.thinking', { name: esc(v.name) }) : v.mustCall ? t('cheat.mustCall', { name: esc(v.name) }) : v.canCall ? t('cheat.yourMoveCall') : t('cheat.yourMove', { card: esc(cardName(v.table, true)) });
      now = `${last}${tell}<p class="train-note cheat-status">${status}</p>`;
    }
    const hand = v.mine.map((c, k) => `<button class="pcard-btn${(this.sel >> k) & 1 ? ' on' : ''}" data-pick="${k}" aria-pressed="${(this.sel >> k) & 1 ? 'true' : 'false'}" aria-label="${esc(cardName(c))}" ${v.canPlay ? '' : 'disabled'}>${cardFace(c)}${TOUCH ? '' : `<kbd>${k + 1}</kbd>`}</button>`).join('');
    const n = bitsOf(this.sel);
    const layLabel = n ? t(n === 1 ? 'cheat.lay1' : 'cheat.lay', { n, card: esc(cardName(v.table, n > 1)) }) : t('cheat.pick');
    const acts = `<div class="dice-acts cheat-acts"><button class="big-btn ${n && v.canPlay ? 'primary' : 'ghost'} small" data-do="lay" ${n && v.canPlay ? '' : 'disabled'}>${icon('cards', 16)}<span>${layLabel}</span></button><button class="big-btn ${v.canCall ? 'danger' : 'ghost'} small" data-do="liar" ${v.canCall ? '' : 'disabled'}>${icon('siren', 16)}<span>${t('cheat.liar')}</span>${TOUCH ? '' : '<kbd>L</kbd>'}</button></div>`;
    this.el.innerHTML = `<div class="train-head"><i class="train-ic">${icon('cards', 18)}</i><b>${esc(t('cheat.title', { name: v.name }))}</b><span class="train-value">${icon('coin', 13)}$${v.stake}</span><button class="icon-btn small train-stop" data-do="fold" data-confirm="${esc(t('cheat.foldConfirm', { n: v.stake }))}" aria-label="${esc(t('cheat.fold'))}">${icon('close', 16)}</button></div>
      <div class="cheat-chips"><span><em>${t('games.you')}</em><span class="chips">${chips(v.chips[0])}</span></span><span class="pile">${cardFace(0, 'pile')}<b>${v.pile}</b></span><span class="them"><span class="chips">${chips(v.chips[1])}</span><em>${esc(v.name)}</em><small>${t(v.theirs === 1 ? 'cheat.cards1' : 'cheat.cards', { n: v.theirs })}</small></span></div>
      ${table}<div class="cheat-now">${now}</div><div class="cheat-hand" role="group" aria-label="${esc(t('cheat.hand'))}">${hand}</div>${acts}`;
    this.el.append(this.say);
    this.el.setAttribute('aria-label', t('cheat.title', { name: v.name }));
    if (again) (this.el.querySelector<HTMLElement>(`${again}:not([disabled])`) ?? this.el.querySelector<HTMLElement>('.cheat-acts button:not([disabled])'))?.focus();
    // What a screen reader hears: the call's verdict, the inmate's play and tell, whose move.
    const said = this.el.querySelector('.cheat-now')!.textContent!.replace(/\s+/g, ' ').trim();
    if (said !== this.said) {
      this.said = said;
      setText(this.say, said);
    }
  }
}

const bitsOf = (m: number) => {
  let n = 0;
  for (let b = m; b; b &= b - 1) n++;
  return n;
};

// ------------------------------------------------------------------ the court

/** The court as its card shows it (P27): shots on one's own, or a shootout. */
export interface CourtView {
  /** The shootout's partner's name ('' shots on one's own). */
  name: string;
  /** The spot to shoot from (1–5), and whether the player stands on it. */
  spot: number;
  onSpot: boolean;
  /** The ball held up: the marker (0–1), the power the shot needs and half the window (0–1), its swish third. */
  holding: boolean;
  marker: number;
  need: number;
  half: number;
  /** The wind on this shot: 'behind', 'against', '' calm or across. */
  wind: '' | 'behind' | 'against';
  rain: boolean;
  /** The shootout's shots so far, by pair (1 a basket, 0 a miss, -1 not yet), and whose shot. */
  mine: number[];
  theirs: number[];
  turn: number;
  /** Baskets on one's own today, of the day's count for a point of Speed (0 once it's earned). */
  practice: number;
  of: number;
}

/**
 * The court's card (P27): while the player is on a spot (or in a shootout). The scoreboard (the
 * five shots each, then sudden death), the power marker with the window this spot needs (green,
 * its swish third brighter) once the ball is up, the wind on the shot; hold Space or the Shoot
 * pad and let go in the green.
 */
export class CourtCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly score: HTMLElement;
  private readonly board: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly sweet: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly note: HTMLElement;
  private readonly pad: HTMLButtonElement;
  private drawn = '';
  /** The Shoot pad pressed (on the way down) and let go. */
  onHold: (down: boolean) => void = () => {};

  constructor() {
    this.el = h(
      'div',
      'train-card court-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('ball', 18)}</i><b></b><span class="train-value"></span></div>
      <div class="court-board" aria-hidden="true"></div>
      <i class="sweep court-meter" role="meter" aria-valuemin="0" aria-valuemax="100"><i class="sweep-zone"></i><i class="sweep-zone sweet"></i><i class="sweep-mark"></i></i>
      <p class="train-note"></p>
      <button class="pick-pad court-pad">${icon('ball', 22)}<span></span></button>`,
    );
    this.title = this.el.querySelector('.train-head b')!;
    this.score = this.el.querySelector('.train-value')!;
    this.board = this.el.querySelector('.court-board')!;
    this.meter = this.el.querySelector('.court-meter')!;
    this.zone = this.el.querySelector('.sweep-zone')!;
    this.sweet = this.el.querySelector('.sweep-zone.sweet')!;
    this.mark = this.el.querySelector('.sweep-mark')!;
    this.note = this.el.querySelector('.train-note')!;
    this.pad = this.el.querySelector('.court-pad')!;
    const up = (e: Event) => {
      e.preventDefault();
      this.onHold(false);
    };
    this.pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.pad.setPointerCapture?.(e.pointerId);
      this.onHold(true);
    });
    this.pad.addEventListener('pointerup', up);
    this.pad.addEventListener('pointercancel', up);
    this.pad.addEventListener('contextmenu', (e) => e.preventDefault());
    // (The keyboard on the focused pad: Space is the game's own key; Enter shoots at once.)
    this.pad.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.repeat) this.onHold(true);
    });
    this.pad.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') this.onHold(false);
    });
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  update(v: CourtView | null) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      return;
    }
    const shoot = !!v.name;
    const key = [v.name, v.spot, v.onSpot, v.holding, v.wind, v.rain, v.mine.join(), v.theirs.join(), v.turn, v.practice, v.of, currentLang(), TOUCH].join('|');
    if (key !== this.drawn) {
      this.drawn = key;
      setText(this.title, shoot ? t('hoops.shootout', { name: v.name }) : t('hoops.practice'));
      const made = (a: number[]) => a.filter((x) => x === 1).length;
      setText(this.score, shoot ? `${made(v.mine)}–${made(v.theirs)}` : v.of ? t('hoops.makes', { n: v.practice, of: v.of }) : t('hoops.makesDone', { n: v.practice }));
      const dots = (a: number[]) => a.map((x) => `<i class="${x === 1 ? 'in' : x === 0 ? 'out' : ''}"></i>`).join('');
      this.board.innerHTML = shoot ? `<div class="court-row"><em>${t('games.you')}</em>${dots(v.mine)}</div><div class="court-row them"><em>${esc(v.name)}</em>${dots(v.theirs)}</div>` : '';
      this.board.classList.toggle('hidden', !shoot);
      const where = !v.onSpot ? t('hoops.toSpot', { n: v.spot }) : shoot && v.turn === 1 ? t('hoops.theirShot', { name: v.name }) : TOUCH ? t('hoops.touch') : t('hoops.keys');
      const wind = v.wind ? ` · ${t(v.wind === 'behind' ? 'hoops.windBehind' : 'hoops.windAgainst')}` : '';
      setText(this.note, `${where}${v.onSpot ? `${wind}${v.rain ? ` · ${t('hoops.rain')}` : ''}` : ''}`);
      setText(this.pad.querySelector('span')!, t('hoops.shoot'));
      this.meter.setAttribute('aria-label', t('hoops.meter'));
      this.pad.disabled = !v.onSpot || (shoot && v.turn === 1);
      this.el.classList.toggle('off-spot', !v.onSpot);
    }
    this.el.classList.toggle('holding', v.holding);
    this.zone.style.left = `${((v.need - v.half) * 100).toFixed(1)}%`;
    this.zone.style.width = `${(v.half * 200).toFixed(1)}%`;
    this.sweet.style.left = `${((v.need - v.half / 3) * 100).toFixed(1)}%`;
    this.sweet.style.width = `${((v.half * 200) / 3).toFixed(1)}%`;
    this.mark.style.left = `${(v.marker * 100).toFixed(2)}%`;
    this.mark.classList.toggle('in', v.holding && Math.abs(v.marker - v.need) <= v.half);
    this.meter.setAttribute('aria-valuenow', String(Math.round(v.marker * 100)));
  }
}

// ------------------------------------------------------------------ checkers

/** The old-timer's board as its card shows it (P27). */
export interface BoardView {
  name: string;
  sq: number[];
  /** The player's legal steps now (empty: not their move): from, to. */
  steps: Array<{ from: number; to: number }>;
  /** A jump that must go on from this square (-1 none). */
  chain: number;
  last: number[];
  /** 0 under way, 1 won, 2 lost, 3 drawn. */
  over: number;
  thinking: boolean;
  /** Games the player has won off him (his level), lost, drawn. */
  won: number;
  lost: number;
  drawn: number;
  /** Pieces each: the player's, his. */
  mine: number;
  his: number;
}

/**
 * The old-timer's checkers board (P27): 8 × 8, the player's men at the bottom. Tap one of the
 * player's pieces that can move (lit), then where it goes (lit); a jump that must go on keeps
 * its piece chosen. His last move is traced. Get up (the board stays set up), resign (asking
 * twice), and once it's over, a new game.
 */
export class BoardCard {
  private readonly el: HTMLElement;
  private drawn = '';
  private chosen = -1;

  constructor(private readonly send: Send, private readonly click: () => void) {
    this.el = h('div', 'train-card board-card hidden');
    this.el.setAttribute('role', 'dialog');
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => {
      const sq = (e.target as HTMLElement).closest<HTMLElement>('[data-sq]');
      if (sq && !(sq as HTMLButtonElement).disabled) {
        this.click();
        this.tap(Number(sq.dataset.sq));
        return;
      }
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-do]');
      if (!b || (b as HTMLButtonElement).disabled) return;
      this.click();
      if (!confirmed(b)) return;
      const what = b.dataset.do;
      if (what === 'up') this.send(OP.TALK, TALK.CHECKERS, 0);
      else if (what === 'resign') this.send(OP.TALK, TALK.CHECKERS, 2);
      else if (what === 'new') this.send(OP.TALK, TALK.CHECKERS, 1);
    });
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  private v: BoardView | null = null;

  /** A square tapped: a piece of the player's that can move chosen, or the chosen one moved there. */
  private tap(i: number) {
    const v = this.v;
    if (!v) return;
    const to = v.steps.find((s) => s.from === this.chosen && s.to === i);
    if (to) {
      this.send(OP.TALK, TALK.MOVE, to.from, to.to);
      this.chosen = -1;
    } else this.chosen = v.steps.some((s) => s.from === i) ? i : -1;
    this.drawn = '';
  }

  update(v: BoardView | null) {
    this.v = v;
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      this.chosen = -1;
      return;
    }
    if (v.chain >= 0) this.chosen = v.chain;
    if (!v.steps.some((s) => s.from === this.chosen)) this.chosen = -1;
    // (One piece that can move: it's chosen already.)
    const froms = [...new Set(v.steps.map((s) => s.from))];
    if (this.chosen < 0 && froms.length === 1) this.chosen = froms[0];
    const key = JSON.stringify(v) + this.chosen + currentLang();
    if (key === this.drawn) return;
    this.drawn = key;
    const had = this.el.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const again = had?.dataset.sq !== undefined ? `[data-sq="${had.dataset.sq}"]` : had?.dataset.do ? `[data-do="${had.dataset.do}"]` : '';
    const targets = new Set(v.steps.filter((s) => s.from === this.chosen).map((s) => s.to));
    const movable = new Set(froms);
    const last = new Set(v.last);
    let cells = '';
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        if ((r + c) % 2 === 0) {
          cells += '<i class="light"></i>';
          continue;
        }
        const i = r * 4 + (c >> 1);
        const p = v.sq[i];
        const cls = [p ? `p${p}` : '', i === this.chosen ? 'chosen' : '', targets.has(i) ? 'target' : '', movable.has(i) && i !== this.chosen ? 'can' : '', last.has(i) ? 'last' : ''].filter(Boolean).join(' ');
        const live = targets.has(i) || movable.has(i);
        const label = p ? t(p === 1 ? 'checkers.yourMan' : p === 2 ? 'checkers.yourKing' : p === 3 ? 'checkers.hisMan' : 'checkers.hisKing', { name: v.name }) : t('checkers.empty');
        cells += `<button class="sq ${cls}" data-sq="${i}" ${live ? '' : 'disabled'} aria-label="${esc(`${label}, ${'abcdefgh'[c]}${8 - r}`)}">${p ? '<span class="piece"></span>' : ''}</button>`;
      }
    const status =
      v.over === 1 ? t('checkers.won', { name: v.name }) : v.over === 2 ? t('checkers.lost', { name: v.name }) : v.over === 3 ? t('checkers.drawn') : v.thinking ? t('checkers.thinking', { name: v.name }) : v.chain >= 0 ? t('checkers.jumpOn') : v.steps.some((s) => Math.abs(s.to - s.from) > 5) ? t('checkers.mustJump') : t('checkers.yourMove');
    const acts =
      v.over > 0
        ? `<button class="big-btn primary small" data-do="new">${icon('replay', 16)}<span>${t('checkers.newGame')}</span></button><button class="big-btn ghost small" data-do="up">${icon('close', 16)}<span>${t('checkers.getUp')}</span></button>`
        : `<button class="big-btn ghost small" data-do="up">${icon('close', 16)}<span>${t('checkers.later')}</span></button><button class="big-btn ghost small" data-do="resign" data-confirm="${esc(t('checkers.resignConfirm'))}">${icon('flag', 16)}<span>${t('checkers.resign')}</span></button>`;
    this.el.innerHTML = `<div class="train-head"><i class="train-ic">${icon('checkers', 18)}</i><b>${esc(t('checkers.title', { name: v.name }))}</b><span class="train-value">${v.mine}–${v.his}</span></div>
      <div class="checkers" role="grid" aria-label="${esc(t('checkers.board'))}">${cells}</div>
      <p class="train-note checkers-status" role="status" data-over="${v.over}">${esc(status)}</p>
      <p class="checkers-record">${esc(t('checkers.record', { name: v.name, w: v.won, l: v.lost, d: v.drawn }))}</p><div class="dice-acts">${acts}</div>`;
    this.el.setAttribute('aria-label', t('checkers.title', { name: v.name }));
    if (again) (this.el.querySelector<HTMLElement>(`${again}:not([disabled])`) ?? this.el.querySelector<HTMLElement>('.sq:not([disabled])') ?? this.el.querySelector<HTMLElement>('[data-do]'))?.focus();
  }
}
