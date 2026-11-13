import { t, textStamp } from '../i18n';
import { EXT, OP } from '../sim/command';
import { esc, h, type Send, setText } from './dom';
import { icon } from './icons';

/**
 * Penalties (2.44) on screen: the card at the pitch's spot. The goal seen from the spot, the keeper
 * in it, the marker sweeping over it while the player kicks (one press: the Kick button, Space or
 * the action button), three buttons to dive while they keep goal, the tally. It's drawn from a view
 * the play layer fills from the sim (play/penalties.ts): the marker, the keeper's reach and the
 * tally are the sim's own numbers (the gold: a shootout's from past any keeper's reach; on one's own, where a
 * corner counts). Every button is an OP.EXT KICK.
 */

/** A kick's mark in the tally: in, missed (saved, the post, wide), to come. */
export type PenMark = 'goal' | 'miss' | 'todo';

export interface PensView {
  /** The inmate ('' kicks on one's own). */
  name: string;
  /** At the spot with no ball down yet ('ready'), the player's kick, keeping goal, or walking to places / a result shown ('wait'). */
  mode: 'ready' | 'kick' | 'keep' | 'wait';
  /** The marker across the goal (-1 the left post … 1 the right; past them, wide), shown while it sweeps. */
  marker: number | null;
  /** Where the corners begin (out of the mouth's half: a keeper's least reach). */
  corner: number;
  /** The keeper on the card: there (an empty net: false), across (-1 … 1), how far down in his dive (0–1, signed by side). */
  keeper: boolean;
  keeperAt: number;
  dive: number;
  /** The keeper is the player (drawn in their colour). */
  keeperMe: boolean;
  /** The ball on the card: across (-1 the left post … 1), up from the spot (0) to the goal line (1), and past it (into the net, out), its size (1 at the spot). Null: none. */
  ball: { x: number; y: number; s: number } | null;
  /** How the last kick went, while it's shown ('' none). */
  result: '' | 'goal' | 'saved' | 'post' | 'wide';
  /** Who took it: the player ('me') or the inmate. */
  by: 'me' | 'him';
  /** The tally: the player's kicks, the inmate's (empty on one's own). */
  mine: PenMark[];
  theirs: PenMark[];
  /** Keeping: the corner he looks at (-1, 1; 0 not yet), his run-up (0–1), where a dive stops being early (0–1), the dive chosen (null none). */
  look: number;
  run: number;
  early: number;
  dived: number | null;
  /** On one's own: the goals in a corner today, of those worth a point of Speed. */
  corners: number;
  of: number;
  /** The kick clock left (0–1), shown in its last seconds (-1: not). */
  clock: number;
  /** What to do now, in words. */
  note: string;
}

/** The goal on the card: posts at x 40 and 220 (the mouth's half 90 wide), the bar at y 22, the line at y 92. */
const MID = 130;
const HALF = 90;
const BAR = 22;
const LINE = 92;
const SPOT_Y = 118;

const NET = (() => {
  let p = '';
  for (let x = MID - HALF + 12; x < MID + HALF; x += 12) p += `M${x} ${BAR}V${LINE}`;
  for (let y = BAR + 12; y < LINE; y += 12) p += `M${MID - HALF} ${y}H${MID + HALF}`;
  return p;
})();

/** The keeper's figure, feet at (0, 0): head, body, arms out a little. */
const KEEPER = `<g class="pens-keeper"><circle cx="0" cy="-44" r="7"/><rect x="-8" y="-37" width="16" height="22" rx="5"/><path d="M-8 -33 L-19 -24 M8 -33 L19 -24" class="pen-arms"/><path d="M-4 -16 L-6 0 M4 -16 L6 0" class="pen-legs"/></g>`;

export class PensCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly score: HTMLElement;
  private readonly tally: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly marker: SVGElement;
  private readonly keeper: SVGGElement;
  private readonly ball: SVGCircleElement;
  private readonly word: SVGTextElement;
  private readonly look: SVGElement;
  private readonly corners: SVGElement;
  private readonly run: HTMLElement;
  private readonly runFill: HTMLElement;
  private readonly note: HTMLElement;
  private readonly kick: HTMLButtonElement;
  private readonly dives: HTMLElement;
  private drawn = '';

  constructor(private readonly send: Send) {
    this.el = h(
      'div',
      'train-card pens-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('football', 18)}</i><b></b><span class="pens-score"></span><button class="icon-btn small train-stop">${icon('close', 16)}</button></div>
      <div class="pens-tally" role="img"></div>
      <svg class="pens-goal" viewBox="0 0 260 128" aria-hidden="true">
        <rect class="pens-grass" x="0" y="${LINE}" width="260" height="${128 - LINE}"/>
        <g class="pens-corners"><rect x="0" y="${BAR}" width="0" height="${LINE - BAR}"/><rect x="0" y="${BAR}" width="0" height="${LINE - BAR}"/></g>
        <rect class="pens-look" x="0" y="${BAR}" width="${HALF * 0.6}" height="${LINE - BAR}"/>
        <path class="pens-net" d="${NET}"/>
        <path class="pens-frame" d="M${MID - HALF} ${LINE}V${BAR}H${MID + HALF}V${LINE}"/>
        <path class="pens-line" d="M8 ${LINE}H252"/>
        <circle class="pens-spot" cx="${MID}" cy="${SPOT_Y}" r="2.5"/>
        ${KEEPER}
        <circle class="pens-ball" r="7"/>
        <path class="pens-marker" d="M-8 2 L8 2 L0 15 Z"/>
        <text class="pens-word" x="${MID}" y="64" text-anchor="middle"></text>
      </svg>
      <div class="pens-run" aria-hidden="true"><i></i><b></b></div>
      <p class="train-note"></p>
      <button class="big-btn primary pens-kick">${icon('football', 20)}<span></span></button>
      <div class="pens-dives">
        <button class="big-btn primary pens-dive" data-c="0">${icon('chevronLeft', 20)}<span></span></button>
        <button class="big-btn ghost pens-dive" data-c="1"><span></span></button>
        <button class="big-btn primary pens-dive" data-c="2"><span></span>${icon('chevronRight', 20)}</button>
      </div>`,
    );
    this.title = this.el.querySelector('.train-head b')!;
    this.score = this.el.querySelector('.pens-score')!;
    this.tally = this.el.querySelector('.pens-tally')!;
    this.svg = this.el.querySelector('.pens-goal')!;
    this.marker = this.svg.querySelector('.pens-marker')!;
    this.keeper = this.svg.querySelector('.pens-keeper')!;
    this.ball = this.svg.querySelector('.pens-ball')!;
    this.word = this.svg.querySelector('.pens-word')!;
    this.look = this.svg.querySelector('.pens-look')!;
    this.corners = this.svg.querySelector('.pens-corners')!;
    this.run = this.el.querySelector('.pens-run')!;
    this.runFill = this.run.querySelector('i')!;
    this.note = this.el.querySelector('.train-note')!;
    this.kick = this.el.querySelector('.pens-kick')!;
    this.dives = this.el.querySelector('.pens-dives')!;
    // (Pressed on the way down, as the rat's button: a tap's lag off the timing.)
    const press = (b: HTMLElement, go: () => void) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        go();
      });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      b.addEventListener('click', (e) => {
        if (e.detail === 0) go();
      });
    };
    press(this.kick, () => this.send(OP.EXT, EXT.KICK, 0));
    press(this.svg as unknown as HTMLElement, () => {
      if (this.el.dataset.mode === 'kick' || this.el.dataset.mode === 'ready') this.send(OP.EXT, EXT.KICK, 0);
    });
    for (const b of this.dives.querySelectorAll<HTMLElement>('.pens-dive'))
      press(b, () => this.send(OP.EXT, EXT.KICK, 2, Number(b.dataset.c)));
    this.el.querySelector('.train-stop')!.addEventListener('click', () => this.send(OP.EXT, EXT.KICK, 3));
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  update(v: PensView | null) {
    this.el.classList.toggle('hidden', !v);
    document.body.classList.toggle('kicking', !!v && v.mode !== 'ready');
    if (!v) {
      this.drawn = '';
      return;
    }
    this.el.dataset.mode = v.mode;
    const mine = v.mine.filter((m) => m === 'goal').length;
    const theirs = v.theirs.filter((m) => m === 'goal').length;
    const key = `${textStamp()}|${v.name}|${v.mode}|${v.mine.join()}|${v.theirs.join()}|${v.result}|${v.by}|${v.corners}|${v.dived}|${v.note}|${v.corner}`;
    if (key !== this.drawn) {
      this.drawn = key;
      setText(this.title, v.name ? t('pens.title', { name: v.name }) : t('pens.practice'));
      setText(this.score, v.name ? `${mine}–${theirs}` : t('pens.corners', { n: v.corners, of: v.of }));
      const pips = (marks: PenMark[]) => marks.map((m) => `<i class="${m}"></i>`).join('');
      this.tally.innerHTML = v.name
        ? `<span><em>${esc(t('pens.you'))}</em>${pips(v.mine)}</span><span><em>${esc(v.name)}</em>${pips(v.theirs)}</span>`
        : '';
      this.tally.setAttribute('aria-label', v.name ? t('pens.tallyAria', { m: mine, n: theirs, name: v.name }) : '');
      setText(this.note, v.note);
      setText(this.kick.querySelector('span')!, v.mode === 'ready' ? t('pens.takeKick') : t('pens.kick'));
      const [l, s, r] = this.dives.querySelectorAll('span');
      setText(l, t('pens.diveLeft'));
      setText(s, t('pens.stay'));
      setText(r, t('pens.diveRight'));
      const [bl, , br] = this.dives.querySelectorAll('button');
      bl.setAttribute('aria-label', t('pens.diveLeftAria'));
      br.setAttribute('aria-label', t('pens.diveRightAria'));
      for (const b of this.dives.querySelectorAll<HTMLElement>('.pens-dive'))
        b.classList.toggle('chosen', v.dived !== null && Number(b.dataset.c) - 1 === v.dived);
      const word = v.result ? t(`pens.${v.result}` as 'pens.goal') : '';
      setText(this.word, word);
      this.word.setAttribute('class', `pens-word ${v.result} ${v.by}`);
      // (The corners: from a keeper's least reach to the post, either side.)
      const [a, b] = this.corners.querySelectorAll('rect');
      const w = HALF * (1 - v.corner);
      a.setAttribute('x', `${MID - HALF}`);
      a.setAttribute('width', w.toFixed(1));
      b.setAttribute('x', (MID + HALF - w).toFixed(1));
      b.setAttribute('width', w.toFixed(1));
    }
    this.el.classList.toggle('keeping', v.mode === 'keep');
    // (Nothing to leave with no ball down: the × only once there is.)
    this.el.querySelector<HTMLElement>('.train-stop')!.classList.toggle('hidden', v.mode === 'ready');
    this.el.classList.toggle('dived', v.dived !== null);
    // (Hidden while he takes his: the player's button only for the player's own kick.)
    this.kick.classList.toggle('hidden', v.mode === 'keep' || (v.mode === 'wait' && v.by === 'him'));
    this.kick.disabled = v.mode === 'wait';
    this.dives.classList.toggle('hidden', v.mode !== 'keep');
    // The marker sweeping (kicking), hidden otherwise.
    this.marker.style.display = v.marker === null ? 'none' : '';
    if (v.marker !== null) this.marker.setAttribute('transform', `translate(${(MID + v.marker * HALF).toFixed(1)} 4)`);
    this.corners.style.display = v.mode === 'kick' || v.mode === 'ready' ? '' : 'none';
    // The keeper: across, and down in his dive (turned about his feet).
    this.keeper.style.display = v.keeper ? '' : 'none';
    this.keeper.setAttribute(
      'transform',
      `translate(${(MID + (v.keeperAt + v.dive * 0.42) * HALF).toFixed(1)} ${(LINE - 2 - Math.abs(v.dive) * 6).toFixed(1)}) rotate(${(v.dive * 72).toFixed(1)})`,
    );
    this.keeper.classList.toggle('me', v.keeperMe);
    // His glance at a corner (keeping): that side of the goal lit up.
    this.look.style.display = v.look ? '' : 'none';
    if (v.look) this.look.setAttribute('x', (v.look < 0 ? MID - HALF : MID + HALF * 0.4).toFixed(1));
    // The ball: from the spot to the line (smaller as it goes), and on.
    this.ball.style.display = v.ball ? '' : 'none';
    if (v.ball) {
      const y = SPOT_Y + (LINE - 30 - SPOT_Y) * Math.min(1, v.ball.y) - Math.max(0, v.ball.y - 1) * 10;
      this.ball.setAttribute('cx', (MID + v.ball.x * HALF).toFixed(1));
      this.ball.setAttribute('cy', y.toFixed(1));
      this.ball.setAttribute('r', (7 * v.ball.s).toFixed(2));
    }
    // His run-up: the bar fills to his kick; diving before the line shows him the way.
    this.run.classList.toggle('hidden', v.mode !== 'keep');
    this.runFill.style.width = `${(v.run * 100).toFixed(1)}%`;
    (this.run.querySelector('b') as HTMLElement).style.left = `${(v.early * 100).toFixed(1)}%`;
    this.el.classList.toggle('late', v.mode === 'keep' && v.run >= v.early);
    this.el.classList.toggle('clock', v.clock >= 0);
    this.el.style.setProperty('--pens-clock', v.clock >= 0 ? v.clock.toFixed(3) : '1');
  }
}
