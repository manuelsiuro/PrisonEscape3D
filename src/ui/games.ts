import { currentLang, t, type Key } from '../i18n';
import { OP, TALK } from '../sim/command';
import { h, setText, TOUCH } from './dom';
import { icon } from './icons';
import { DESIGNS } from '../content/team';

type Send = (op: number, a?: number, b?: number) => void;

/** The last dice game as it's shown (P22; presentation only: the sim settled it already). */
export interface DiceShow {
  /** Bumps with each game (and each load): what's drawn knows it's another one. */
  id: number;
  who: number;
  stake: number;
  mine: [number, number];
  /** The inmate's throw (0 0 until it comes). */
  theirs: [number, number];
  /** When each die left the hand (ms, performance.now; 0 not thrown): the player's two, the inmate's two. */
  at: [number, number, number, number];
  what: 'rolled' | 'won' | 'lost' | 'push';
  /** When the result is shown (the inmate's dice down), and until when the game stays up. */
  shownAt: number;
  until: number;
  /** What came back off the table (the stake twice over, the stake, nothing). */
  paid: number;
}

/** The games in the talk panel (P22): what's on offer with this inmate, the dice in play, the last game's result. */
export interface GamesView {
  /** Bumps with each dice game. */
  id: number;
  /** They'll play now (else `why`). */
  open: boolean;
  why: string;
  /** Games left with them today. */
  left: number;
  stakes: Array<{ k: number; n: number; ok: boolean }>;
  /** A guard sees the player now: gambling costs `heat`. */
  seen: boolean;
  heat: number;
  /** The dice on the table (the player's two, the stake), the player's to throw again or stand on. */
  dice: { mine: [number, number]; stake: number } | null;
  /** The last game with them, while it's shown. */
  show: DiceShow | null;
  /** Their arm against the player's. */
  arm: 'stronger' | 'even' | 'weaker';
  tired: boolean;
  energy: number;
  /** Sports day: bouts won today, of the prize's count; the prize already won. */
  sports: { wins: number; of: number; prize: number; won: boolean } | null;
  name: string;
  /** P27: the prison has a hoop, and the two are at it (a shootout can start). */
  hasCourt: boolean;
  court: boolean;
  /** P27: the old-timer's board (null: this isn't him): he'll play now (else `why`), a game set up, over, or none. */
  elder: { open: boolean; why: string; game: 'none' | 'on' | 'over'; won: number } | null;
  /** P29: football on the pitch (null: no pitch): he'll play now (else `why`). */
  football: { open: boolean; why: string } | null;
  /** P29: a tattoo gun in the hotbar (null: none): a design for him (else `why`), one from him on the player's arm (else `mineWhy`), those inked already; a guard sees it (`heat`). */
  ink: { why: string; designs: Array<{ k: number; price: number }>; mineWhy: string; inked: number[] } | null;
  inkHeat: number;
}

const PIPS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  1: [[12, 12]],
  2: [[7.5, 7.5], [16.5, 16.5]],
  3: [[7, 7], [12, 12], [17, 17]],
  4: [[7.5, 7.5], [16.5, 7.5], [7.5, 16.5], [16.5, 16.5]],
  5: [[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]],
  6: [[7.5, 6.5], [16.5, 6.5], [7.5, 12], [16.5, 12], [7.5, 17.5], [16.5, 17.5]],
};

/** A die's face as a little picture (n: 1–6; 0 a blank, not thrown yet). */
export function dieFace(n: number, size = 34): string {
  const pips = (PIPS[n] ?? []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${n === 1 ? 2.6 : 2}"${n === 1 ? ' class="ace"' : ''}/>`).join('');
  return `<svg class="die-face" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><rect x="1.5" y="1.5" width="21" height="21" rx="5"/>${pips}</svg>`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The talk panel's games section (P22): dice for a stake and an arm-wrestle, with what they
 * risk; the dice on the table to throw again (tapped to choose: `mask`) or stand on; the last
 * game's throw and how it went. Every button is OP.TALK; the panel redraws from the sim.
 */
export function gamesSection(v: GamesView, mask: number, now: number): string {
  const label = `<div class="box-label">${icon('dice', 14)}<span>${t('games.title')}</span><em>${v.open || v.why === '' ? t('games.left', { n: v.left }) : ''}</em></div>`;
  const sports = v.sports
    ? `<p class="games-sports${v.sports.won ? ' won' : ''}">${icon('trophy', 14)}<span>${esc(v.sports.won ? t('games.sportsWon', { n: v.sports.prize }) : t('games.sports', { n: v.sports.wins, of: v.sports.of, prize: v.sports.prize }))}</span></p>`
    : '';
  // The dice on the table: the player's to throw again (the dice tapped) or stand on.
  if (v.dice) {
    const [a, b] = v.dice.mine;
    const die = (k: number, n: number) => `<button class="die${(mask >> k) & 1 ? ' on' : ''}${fresh(v.show, k, now) ? ' fresh' : ''}" data-die="${k}" aria-pressed="${(mask >> k) & 1 ? 'true' : 'false'}" aria-label="${esc(t('games.dieAria', { n }))}">${dieFace(n)}</button>`;
    // (One die at most: choosing one lets go of the other.)
    const again = mask & 1 ? 1 : mask & 2 ? 2 : 0;
    return `<section class="talk-games playing">${label}<div class="dice-play">
      <div class="dice-row" role="radiogroup" aria-label="${esc(t('games.rerollNote', { name: v.name }))}"><span class="dice-who">${t('games.you')}</span>${die(0, a)}${die(1, b)}<b class="dice-sum">= ${a + b}</b></div>
      <p class="dice-stake">${icon('coin', 13)}<span>${t('games.onTable', { n: v.dice.stake })}</span></p>
      <p class="talk-note">${t('games.rerollNote', { name: esc(v.name) })}</p>
      <div class="dice-acts"><button class="big-btn ${again ? 'primary' : 'ghost'} small" data-act="${TALK.REROLL}" data-arg="${again}" ${again ? '' : 'disabled'}>${icon('dice', 16)}<span>${t('games.reroll')}</span></button><button class="big-btn ${again ? 'ghost' : 'primary'} small" data-act="${TALK.REROLL}" data-arg="0" data-stand="1">${icon('check', 16)}<span>${t('games.stand', { n: a + b })}</span></button></div>
    </div></section>`;
  }
  // The last game: both throws and how it went (theirs once their dice are down).
  let result = '';
  if (v.show && v.show.what !== 'rolled') {
    const s = v.show;
    const down = now >= s.shownAt;
    const [a, b] = s.mine;
    const [c, d] = s.theirs;
    const verdict = !down ? t('games.theyThrow', { name: esc(v.name) }) : s.what === 'won' ? t('games.won', { n: s.stake, m: s.stake * 2 }) : s.what === 'lost' ? t('games.lost', { n: s.stake }) : t('games.push', { n: s.stake });
    result = `<div class="dice-result" data-what="${down ? s.what : 'wait'}">
      <div class="dice-row"><span class="dice-who">${t('games.you')}</span>${dieFace(a, 28)}${dieFace(b, 28)}<b class="dice-sum">= ${a + b}</b></div>
      <div class="dice-row theirs"><span class="dice-who">${esc(v.name)}</span>${down ? `${dieFace(c, 28)}${dieFace(d, 28)}<b class="dice-sum">= ${c + d}</b>` : `<span class="dice-wait">${dieFace(0, 28)}${dieFace(0, 28)}</span>`}</div>
      <p class="dice-verdict">${verdict}</p></div>`;
  }
  const why = !v.open && v.why ? `<p class="talk-note">${esc(v.why)}</p>` : '';
  const stakes = v.stakes
    .map((s) => {
      const ok = v.open && s.ok;
      return `<button class="cash-btn stake" data-act="${TALK.DICE}" data-arg="${s.k}" ${ok ? '' : 'disabled'} data-confirm="${esc(t('games.confirm', { n: s.n }))}" aria-label="${esc(t('games.stakeAria', { n: s.n }))}">$${s.n}</button>`;
    })
    .join('');
  const warn = v.open && v.seen ? `<p class="talk-note games-warn">${icon('eye', 13)}<span>${t('games.seen', { n: v.heat })}</span></p>` : '';
  const armOk = v.open && !v.tired;
  const armNote = v.tired ? t('games.tired') : t(`games.arm.${v.arm}` as Key, { n: v.energy });
  // P27: Cheat for the same stakes, a shootout at the hoop, the old-timer's checkers.
  const cheatStakes = v.stakes
    .map((s) => {
      const ok = v.open && s.ok;
      return `<button class="cash-btn stake" data-act="${TALK.CHEAT}" data-arg="${s.k}" ${ok ? '' : 'disabled'} data-confirm="${esc(t('cheat.confirm', { n: s.n }))}" aria-label="${esc(t('cheat.stakeAria', { n: s.n }))}">$${s.n}</button>`;
    })
    .join('');
  const hoopsOk = v.open && v.court;
  const hoops = v.hasCourt
    ? `<div class="bribe-row"><span class="bribe-text"><b>${t('hoops.title')}</b><small>${esc(v.court ? t('hoops.note') : t('hoops.notHere'))}</small></span><button class="big-btn ${hoopsOk ? 'primary' : 'ghost'} small" data-act="${TALK.HOOPS}" ${hoopsOk ? '' : 'disabled'} aria-label="${esc(t('hoops.goAria'))}">${icon('ball', 16)}<span>${t('hoops.go')}</span></button></div>`
    : '';
  const e = v.elder;
  const elder = e
    ? `<div class="bribe-row elder-row"><span class="bribe-text"><b>${t('checkers.name')}</b><small>${esc(!e.open ? e.why : e.game === 'on' ? t('checkers.onNote') : t('checkers.note', { name: v.name }))}</small></span><button class="big-btn ${e.open ? 'primary' : 'ghost'} small" data-act="${TALK.CHECKERS}" data-arg="1" ${e.open ? '' : 'disabled'} aria-label="${esc(t(e.game === 'on' ? 'checkers.resumeAria' : 'checkers.playAria', { name: v.name }))}">${icon('checkers', 16)}<span>${t(e.game === 'on' ? 'checkers.resume' : 'checkers.play')}</span></button></div>`
    : '';
  // P29: a match he captains; a tattoo for him (its price), one from him (on the player's arm).
  const f = v.football;
  const football = f
    ? `<div class="bribe-row"><span class="bribe-text"><b>${t('football.name')}</b><small>${esc(f.why)}</small></span><button class="big-btn ${f.open ? 'primary' : 'ghost'} small" data-act="${TALK.FOOTBALL}" ${f.open ? '' : 'disabled'} aria-label="${esc(t('football.goAria', { name: v.name }))}">${icon('ball', 16)}<span>${t('football.go')}</span></button></div>`
    : '';
  const ink = v.ink;
  const designName = (k: number) => t(`design.${DESIGNS[k].id}` as Key);
  const tattoo = ink
    ? `<div class="bribe-row ink-row"><span class="bribe-text"><b>${t('ink.name')}</b><small>${esc(ink.why || t('ink.note'))}</small></span><div class="stake-row">${ink.designs.map((d) => `<button class="cash-btn stake design" data-act="${TALK.TATTOO}" data-arg="${d.k}" ${ink.why ? 'disabled' : ''} aria-label="${esc(t('ink.forAria', { design: designName(d.k), n: d.price, name: v.name }))}">${designIcon(d.k)}<span>$${d.price}</span></button>`).join('')}</div></div>
      <div class="bribe-row ink-row"><span class="bribe-text"><b>${t('ink.mine')}</b><small>${esc(ink.mineWhy || t('ink.mineOffer', { name: v.name }))}</small></span><div class="stake-row">${ink.designs.map((d) => `<button class="cash-btn stake design" data-act="${TALK.INK_ME}" data-arg="${d.k}" ${ink.mineWhy || ink.inked.includes(d.k) ? 'disabled' : ''} aria-label="${esc(t('ink.mineAria', { design: designName(d.k), name: v.name }))}">${designIcon(d.k)}<span>${esc(designName(d.k))}</span></button>`).join('')}</div></div>${v.inkHeat ? `<p class="talk-note games-warn">${icon('eye', 13)}<span>${t('ink.seenWarn', { n: v.inkHeat })}</span></p>` : ''}`
    : '';
  return `<section class="talk-games">${label}${sports}${result}${why}${elder}${football}${tattoo}
    <div class="bribe-row"><span class="bribe-text"><b>${t('games.dice')}</b><small>${t('games.diceNote')}</small></span><div class="stake-row">${stakes}</div></div>
    <div class="bribe-row"><span class="bribe-text"><b>${t('cheat.name')}</b><small>${t('cheat.note')}</small></span><div class="stake-row">${cheatStakes}</div></div>${warn}
    <div class="bribe-row"><span class="bribe-text"><b>${t('games.wrestle')}</b><small>${esc(armNote)}</small></span><button class="big-btn ${armOk ? 'primary' : 'ghost'} small" data-act="${TALK.WRESTLE}" ${armOk ? '' : 'disabled'}>${icon('arm', 16)}<span>${t('games.wrestleGo')}</span></button></div>${hoops}</section>`;
}

/** A tattoo design as a small picture (its path in its ink). */
function designIcon(k: number): string {
  const d = DESIGNS[k];
  const pts = d.path.map(([x, y]) => `${(x / 1000) * 20 + 2},${(y / 1000) * 20 + 2}`).join(' ');
  return `<svg class="design-ic" viewBox="0 0 24 24" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="#${d.color.toString(16).padStart(6, '0')}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

/** A die just thrown (its tumble still playing in the picture): the panel's face tumbles in too. */
const fresh = (s: DiceShow | null, k: number, now: number) => !!s && s.at[k] > 0 && now - s.at[k] < 450;

// ------------------------------------------------------------------ the arm-wrestle

/** The arm-wrestle under way (P22). */
export interface WrestleView {
  name: string;
  /** Where the bar is: 0 their win … 1 the player's. */
  bar: number;
  /** They're surging (pushing harder) right now. */
  surge: boolean;
  /** Seconds to the bell. */
  left: number;
  /** The side to press next (1 left, 2 right). */
  next: number;
  push: number;
  str: number;
}

/**
 * The arm-wrestle's card (P22): the tug between the two (their side, the knot, the player's),
 * the bell's countdown, left and right in turn to push (A and D, or the arrows; on touch the two
 * big pads), Close to give up. Shown while a bout is on.
 */
export class WrestleCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly knot: HTMLElement;
  private readonly them: HTMLElement;
  private readonly note: HTMLElement;
  private readonly surgeLine: HTMLElement;
  private readonly sides: HTMLButtonElement[];
  private shown = '';
  private lastNext = -1;

  constructor(private readonly send: Send) {
    this.el = h(
      'div',
      'train-card wrestle-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('arm', 18)}</i><b></b><span class="train-value"></span><button class="icon-btn small train-stop">${icon('close', 16)}</button></div>
      <div class="tug"><span class="tug-them"></span><i class="tug-bar" role="meter" aria-valuemin="0" aria-valuemax="100"><i class="tug-mid"></i><i class="tug-knot"></i></i><span class="tug-you"></span></div>
      <p class="train-note"></p><p class="wrestle-surge" aria-hidden="true"></p>
      <div class="train-pads"><button class="train-pad left" data-side="1">${icon('chevronLeft', 30)}</button><button class="train-pad right" data-side="2">${icon('chevronRight', 30)}</button></div>`,
    );
    this.title = this.el.querySelector('.train-head b')!;
    this.clock = this.el.querySelector('.train-value')!;
    this.knot = this.el.querySelector('.tug-knot')!;
    this.them = this.el.querySelector('.tug-them')!;
    this.note = this.el.querySelector('.train-note')!;
    this.surgeLine = this.el.querySelector('.wrestle-surge')!;
    this.sides = [...this.el.querySelectorAll<HTMLButtonElement>('.train-pad')];
    for (const b of this.sides) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.send(OP.TRAIN, Number(b.dataset.side));
      });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      // (A key on the focused pad: its press too. Pointer clicks were sent on the way down.)
      b.addEventListener('click', (e) => {
        if (e.detail === 0) this.send(OP.TRAIN, Number(b.dataset.side));
      });
    }
    this.el.querySelector('.train-stop')!.addEventListener('click', () => this.send(OP.TRAIN, 3));
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  update(v: WrestleView | null) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.shown = '';
      return;
    }
    const key = `${v.name}|${currentLang()}`;
    if (key !== this.shown) {
      this.shown = key;
      setText(this.title, t('wrestle.title', { name: v.name }));
      setText(this.them, v.name);
      setText(this.el.querySelector('.tug-you')!, t('games.you'));
      this.el.querySelector('.train-stop')!.setAttribute('aria-label', t('wrestle.giveUp'));
      this.el.querySelector('.tug-bar')!.setAttribute('aria-label', t('wrestle.meter'));
      this.sides[0].setAttribute('aria-label', t('train.left'));
      this.sides[1].setAttribute('aria-label', t('train.right'));
    }
    setText(this.clock, `0:${String(v.left).padStart(2, '0')}`);
    this.knot.style.left = `${(v.bar * 100).toFixed(1)}%`;
    const bar = this.el.querySelector('.tug-bar')!;
    bar.setAttribute('aria-valuenow', String(Math.round(v.bar * 100)));
    bar.setAttribute('aria-valuetext', v.bar > 0.52 ? t('wrestle.ahead') : v.bar < 0.48 ? t('wrestle.behind', { name: v.name }) : t('wrestle.even'));
    this.el.classList.toggle('surge', v.surge);
    this.el.classList.toggle('winning', v.bar > 0.75);
    this.el.classList.toggle('losing', v.bar < 0.25);
    setText(this.note, TOUCH ? t('wrestle.touch') : t('wrestle.keys'));
    setText(this.surgeLine, v.surge ? t('wrestle.surge', { name: v.name }) : '');
    if (v.next !== this.lastNext) {
      this.lastNext = v.next;
      this.sides[0].classList.toggle('next', v.next === 1);
      this.sides[1].classList.toggle('next', v.next === 2);
    }
  }
}

// ------------------------------------------------------------------ the lockpick

/** A lock being picked (P22). */
export interface PickView {
  /** The door's colour (keyColor id). */
  key: string;
  pins: number;
  of: number;
  /** The marker, and the sweet spot (0–1). */
  marker: number;
  from: number;
  to: number;
  /** The lockpick's uses left. */
  uses: number;
  /** A guard would hear a slip. */
  heard: boolean;
  /** A guard or a camera sees the player now: working the lock would be tampering. */
  watched: boolean;
}

/**
 * The lockpick's card (P22): the door's pins (set so far), the marker sweeping across with the
 * pin's sweet spot in green, Set (Space, the tool button, or on touch the big pad) when it's in
 * the green, Close to step back. A slip is loud (an ear when a guard would hear it) and wears
 * the pick (its uses left).
 */
export class PickCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly count: HTMLElement;
  private readonly pins: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly mark: HTMLElement;
  private readonly note: HTMLElement;
  private readonly ear: HTMLElement;
  private readonly eye: HTMLElement;
  private readonly pad: HTMLButtonElement;
  /** What a screen reader hears: the pins set, and the warnings as they come and go. */
  private readonly say: HTMLElement;
  private said = '';
  /** Slips at this lock so far (each one said). */
  private slips = 0;
  private shown = '';
  private pinsShown = -1;
  private usesShown = -1;
  onSet: () => void = () => {};
  onStop: () => void = () => {};

  constructor() {
    this.el = h(
      'div',
      'train-card pick-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('lockpick', 18)}</i><b></b><span class="train-value"></span><button class="icon-btn small train-stop">${icon('close', 16)}</button></div>
      <div class="pick-pins" aria-hidden="true"></div>
      <i class="sweep"><i class="sweep-zone"></i><i class="sweep-mark"></i></i>
      <p class="train-note"></p><p class="pick-eye hidden">${icon('eye', 13)}<span></span></p><p class="pick-ear hidden">${icon('ear', 13)}<span></span></p><span class="sr-only" role="status"></span>
      <button class="pick-pad">${icon('lockpick', 22)}<span></span></button>`,
    );
    this.title = this.el.querySelector('.train-head b')!;
    this.count = this.el.querySelector('.train-value')!;
    this.pins = this.el.querySelector('.pick-pins')!;
    this.zone = this.el.querySelector('.sweep-zone')!;
    this.mark = this.el.querySelector('.sweep-mark')!;
    this.note = this.el.querySelector('.train-note')!;
    this.ear = this.el.querySelector('.pick-ear')!;
    this.eye = this.el.querySelector('.pick-eye')!;
    this.pad = this.el.querySelector('.pick-pad')!;
    this.say = this.el.querySelector('[role="status"]')!;
    this.pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.onSet();
    });
    this.pad.addEventListener('contextmenu', (e) => e.preventDefault());
    this.pad.addEventListener('click', (e) => {
      if (e.detail === 0) this.onSet();
    });
    this.el.querySelector('.train-stop')!.addEventListener('click', () => this.onStop());
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  update(v: PickView | null, motion: boolean) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.shown = '';
      this.pinsShown = -1;
      this.usesShown = -1;
      this.slips = 0;
      return;
    }
    const key = `${v.key}|${v.of}|${currentLang()}`;
    if (key !== this.shown) {
      this.shown = key;
      this.el.dataset.key = v.key;
      setText(this.title, t('pick.title', { key: t(`keyColor.${v.key}` as Key) }));
      this.el.querySelector('.train-stop')!.setAttribute('aria-label', t('pick.stop'));
      setText(this.pad.querySelector('span')!, t('pick.set'));
      setText(this.ear.querySelector('span')!, t('pick.heard'));
      setText(this.eye.querySelector('span')!, t('pick.watched'));
      this.pinsShown = -1;
    }
    if (v.pins !== this.pinsShown || v.uses !== this.usesShown) {
      // A pin set: the row ticks over; a slip (uses down, pins the same): the card jolts red.
      const slipped = this.usesShown > v.uses && v.pins === this.pinsShown;
      const set = this.pinsShown >= 0 && v.pins > this.pinsShown;
      if (slipped) this.slips++;
      this.pins.innerHTML = Array.from({ length: v.of }, (_, k) => `<i class="${k < v.pins ? 'set' : k === v.pins ? 'now' : ''}"></i>`).join('');
      setText(this.count, t('pick.count', { n: v.pins, of: v.of }));
      setText(this.note, `${TOUCH ? t('pick.touch') : t('pick.keys')} · ${v.uses === 1 ? t('pick.uses1') : t('pick.uses', { n: v.uses })}`);
      this.pinsShown = v.pins;
      this.usesShown = v.uses;
      if (motion && (slipped || set)) {
        this.el.classList.remove('slip', 'set');
        void this.el.offsetWidth;
        this.el.classList.add(slipped ? 'slip' : 'set');
      }
    }
    this.zone.style.left = `${(v.from * 100).toFixed(1)}%`;
    this.zone.style.width = `${((v.to - v.from) * 100).toFixed(1)}%`;
    this.mark.style.left = `${(v.marker * 100).toFixed(2)}%`;
    this.mark.classList.toggle('in', v.marker >= v.from && v.marker <= v.to);
    this.ear.classList.toggle('hidden', !v.heard);
    this.eye.classList.toggle('hidden', !v.watched);
    const said = [this.slips ? t('pick.slipped', { n: this.slips }) : '', t('pick.sr', { n: v.pins, of: v.of }), v.watched ? t('pick.watched') : '', v.heard ? t('pick.heard') : ''].filter(Boolean).join('. ');
    if (said !== this.said) {
      this.said = said;
      setText(this.say, said);
    }
  }
}
