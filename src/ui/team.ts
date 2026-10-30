import { DESIGNS } from '../content/team';
import { currentLang, t } from '../i18n';
import { EXT, OP } from '../sim/command';
import { esc, h, type Send, setText, TOUCH } from './dom';
import { icon } from './icons';
import { pad2 } from '../sim/systems/clock';


/**
 * Team & ink (P29) on screen: the match's card (the score, the clock, what to do, the Kick pad
 * and its power) and the tattoo's (the design, the pen to follow, the needle and the line it has
 * inked; or a friend's work on the player's arm). Drawn from views the play layer fills from the
 * sim (play/team.ts): the sim's own functions decide everything shown.
 */


/** A match as its card shows it. */
export interface MatchView {
  /** The captain's name (the other side's). */
  name: string;
  /** 'gather' walking on; 'play'; 'goal' the ball in a net a moment. */
  phase: 'gather' | 'play' | 'goal';
  /** Seconds left (the whole match before the whistle). */
  left: number;
  /** Goals: the player's side's, the other's. */
  score: [number, number];
  /** The last goal was the player's side's (for the 'goal' phase). */
  ours: boolean;
  /** Who scored it ('' the player; else a name), and whether into his own side's net. */
  by: string;
  own: boolean;
  /** The match's length (seconds): the clock's bar runs down from it. */
  of: number;
  /** Space or the pad held for a kick: its power 0–1; the ball at the player's feet (a kick would reach it). */
  holding: boolean;
  power: number;
  atFeet: boolean;
  /** The team-mates' names, and the other side's. */
  mates: string[];
  rivals: string[];
}

/** The match's card (P29), docked as the court's: the score, the clock, a word on what to do, the Kick pad. */
export class MatchCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly score: HTMLElement;
  private readonly teams: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly note: HTMLElement;
  private readonly pad: HTMLButtonElement;
  private readonly power: HTMLElement;
  private drawn = '';
  /** The Kick pad pressed (on the way down) and let go. */
  onHold: (down: boolean) => void = () => {};

  constructor() {
    this.el = h(
      'div',
      'train-card match-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('ball', 18)}</i><b></b><span class="train-value match-score"></span></div>
      <p class="match-teams"></p>
      <i class="match-clock" role="timer"><i></i></i>
      <p class="train-note"></p>
      <button class="pick-pad match-pad">${icon('ball', 22)}<span></span><i class="match-power" aria-hidden="true"><i></i></i></button>`,
    );
    this.title = this.el.querySelector('.train-head b')!;
    this.score = this.el.querySelector('.match-score')!;
    this.teams = this.el.querySelector('.match-teams')!;
    this.clock = this.el.querySelector('.match-clock')!;
    this.note = this.el.querySelector('.train-note')!;
    this.pad = this.el.querySelector('.match-pad')!;
    this.power = this.el.querySelector('.match-power i')!;
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

  update(v: MatchView | null) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      return;
    }
    const key = [v.name, v.phase, v.left, v.score.join(), v.ours, v.by, v.own, v.atFeet, v.mates.join(), v.rivals.join(), currentLang(), TOUCH].join('|');
    if (key !== this.drawn) {
      this.drawn = key;
      setText(this.title, t('football.title', { name: v.name }));
      setText(this.score, `${v.score[0]}–${v.score[1]}`);
      this.score.setAttribute('aria-label', t('football.scoreAria', { m: v.score[0], n: v.score[1] }));
      this.teams.innerHTML = `<span class="ours">${esc([t('games.you'), ...v.mates].join(', '))}</span><em>${t('football.vs')}</em><span>${esc(v.rivals.join(', '))}</span>`;
      const m = Math.floor(v.left / 60);
      const s = v.left % 60;
      this.clock.setAttribute('aria-label', t('football.left', { time: `${m}:${pad2(s)}` }));
      const note =
        v.phase === 'gather'
          ? t('football.gather')
          : v.phase === 'goal'
            ? v.own
              ? v.by
                ? t('football.ownGoalBy', { name: v.by })
                : t('football.ownGoal')
              : v.ours
                ? v.by
                  ? t('football.goalBy', { name: v.by })
                  : t('football.goalYou')
                : t('football.goalThem', { name: v.by })
            : v.atFeet
              ? t(TOUCH ? 'football.kickTouch' : 'football.kickKeys')
              : t(TOUCH ? 'football.playTouch' : 'football.playKeys');
      setText(this.note, note);
      setText(this.pad.querySelector('span')!, t('football.kick'));
      this.el.dataset.phase = v.phase;
      this.el.classList.toggle('at-feet', v.atFeet);
    }
    (this.clock.firstElementChild as HTMLElement).style.width = `${Math.min(100, (v.left / Math.max(1, v.of)) * 100).toFixed(1)}%`;
    this.el.classList.toggle('holding', v.holding);
    this.power.style.width = `${(v.power * 100).toFixed(1)}%`;
  }
}

/** A tattoo sitting as its card shows it. */
export interface InkView {
  name: string;
  /** The design (DESIGNS place). */
  design: number;
  /** The friend at work on the player's arm (nothing to trace). */
  mine: boolean;
  /** The ring to follow and the needle (the design's box, 0–1000); the stretch of the design ahead of what's traced. */
  pen: [number, number];
  needle: [number, number];
  next: ReadonlyArray<readonly [number, number]>;
  /** The line inked so far: the needle's points step by step, each inked on from the last or (false) the needle set down there; the last one's the needle's, drawn up to `needle`. */
  trail: ReadonlyArray<readonly [number, number, boolean]>;
  /** How far along (0–1); 'lead' while the pen waits at the start (before 2.22). */
  progress: number;
  lead: boolean;
  /** Seconds left, near the end of the time (0: plenty). */
  left: number;
  /** The line so far (0–100), and what it pays at that. */
  quality: number;
  pays: number;
  /** A guard has seen it. */
  seen: boolean;
}

/** The design's path as an SVG polyline's points, in a 0–100 box. */
const pointsOf = (path: ReadonlyArray<readonly [number, number]>) => path.map(([x, y]) => `${(x / 10).toFixed(1)},${(y / 10).toFixed(1)}`).join(' ');
/** The line inked as an SVG path, its strokes broken where the needle was set down. */
const strokesOf = (trail: ReadonlyArray<readonly [number, number, boolean]>, n: number) =>
  trail
    .slice(0, n)
    .map(([x, y, inked], k) => `${k && inked ? 'L' : 'M'}${(x / 10).toFixed(1)} ${(y / 10).toFixed(1)}`)
    .join('');

/**
 * The tattoo's card (P29): the design faint, its next stretch bold, the ring to follow, the
 * needle's dot and the line it has inked; the line's quality and the pay; Give up. Since 2.22
 * the design is drawn on: a finger or the mouse button down on it is `touch`, which the game
 * sends as the needle's way each step.
 */
export class InkCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly value: HTMLElement;
  private readonly guide: SVGPolylineElement;
  private readonly line: SVGPathElement;
  private readonly pen: SVGCircleElement;
  private readonly needle: SVGCircleElement;
  private readonly bar: HTMLElement;
  private readonly note: HTMLElement;
  private readonly quit: HTMLButtonElement;
  private readonly next: SVGPolylineElement;
  private readonly tip: SVGLineElement;
  private drawn = '';
  private trailN = -1;
  private nextAt = '';
  /** The finger or the mouse on the design (box units) while it's down; `fresh` until its first point is sent (the needle set down there). */
  readonly touch = { down: false, fresh: false, x: 0, y: 0, id: -1 };

  constructor(private readonly send: Send, private readonly click: () => void) {
    this.el = h(
      'div',
      'train-card ink-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('needle', 18)}</i><b></b><span class="train-value"></span></div>
      <div class="ink-art" aria-hidden="true"><svg viewBox="-4 -4 108 108"><rect class="ink-skin" x="-4" y="-4" width="108" height="108" rx="10"/><polyline class="ink-guide"/><polyline class="ink-next"/><path class="ink-line"/><line class="ink-line ink-tip"/><circle class="ink-pen" r="4.2"/><circle class="ink-needle" r="2.2"/></svg></div>
      <i class="match-clock ink-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></i>
      <p class="train-note" role="status"></p>
      <button class="big-btn ghost small ink-quit">${icon('close', 16)}<span></span></button>`,
    );
    this.title = this.el.querySelector('.train-head b')!;
    this.value = this.el.querySelector('.train-value')!;
    this.guide = this.el.querySelector('.ink-guide')!;
    this.line = this.el.querySelector('.ink-line')!;
    this.pen = this.el.querySelector('.ink-pen')!;
    this.needle = this.el.querySelector('.ink-needle')!;
    this.next = this.el.querySelector('.ink-next')!;
    this.tip = this.el.querySelector('.ink-tip')!;
    this.bar = this.el.querySelector('.ink-bar')!;
    this.note = this.el.querySelector('.train-note')!;
    this.quit = this.el.querySelector('.ink-quit')!;
    this.quit.addEventListener('click', () => {
      this.click();
      this.send(OP.EXT, EXT.INK, 0);
    });
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    // (The design drawn on: a finger, or the mouse's main button, held down on it.)
    const art = this.el.querySelector<SVGSVGElement>('.ink-art svg')!;
    const at = (e: PointerEvent) => {
      const r = art.getBoundingClientRect();
      this.touch.x = Math.max(0, Math.min(1000, (((e.clientX - r.left) / r.width) * 108 - 4) * 10));
      this.touch.y = Math.max(0, Math.min(1000, (((e.clientY - r.top) / r.height) * 108 - 4) * 10));
    };
    art.addEventListener('pointerdown', (e) => {
      if (this.touch.down || e.button !== 0 || this.el.classList.contains('mine')) return;
      e.preventDefault();
      try {
        art.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable (synthetic events) */
      }
      Object.assign(this.touch, { down: true, fresh: true, id: e.pointerId });
      at(e);
    });
    art.addEventListener('pointermove', (e) => {
      if (this.touch.down && e.pointerId === this.touch.id) at(e);
    });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
      art.addEventListener(ev, (e) => {
        if (e.pointerId === this.touch.id) this.lift();
      });
    document.body.append(this.el);
  }

  /** The finger or the mouse off the design. */
  lift() {
    this.touch.down = false;
    this.touch.id = -1;
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  update(v: InkView | null) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      this.trailN = -1;
      this.nextAt = '';
      this.lift();
      return;
    }
    const d = DESIGNS[v.design];
    const key = [v.name, v.design, v.mine, v.lead, v.seen, v.left, v.mine ? '' : v.pays, currentLang(), TOUCH].join('|');
    if (key !== this.drawn) {
      this.drawn = key;
      const design = t(`design.${d.id}` as 'design.heart');
      const designA = t(`designA.${d.id}` as 'designA.heart');
      setText(this.title, v.mine ? t('ink.mineTitle', { design: designA, name: v.name }) : t('ink.title', { design, name: v.name }));
      setText(this.value, v.mine ? '' : `$${v.pays}`);
      this.value.setAttribute('aria-label', v.mine ? '' : t('ink.paysAria', { n: v.pays }));
      this.guide.setAttribute('points', pointsOf(d.path));
      this.el.style.setProperty('--ink', `#${d.color.toString(16).padStart(6, '0')}`);
      const seen = v.seen ? ` · ${t('ink.seen')}` : '';
      const left = v.left ? ` · ${t('ink.left', { n: v.left })}` : '';
      setText(this.note, v.mine ? `${t('ink.mineNote', { name: v.name })}${seen}` : `${t(TOUCH ? 'ink.traceTouch' : 'ink.traceDraw')}${left}${seen}`);
      this.note.classList.toggle('ink-hurry', !!v.left);
      setText(this.quit.querySelector('span')!, t('ink.quit'));
      this.quit.classList.toggle('hidden', v.mine);
      this.el.classList.toggle('mine', v.mine);
    }
    if (!v.mine) {
      // (The line inked: redrawn as it grows, up to the step before; from there to the needle, as it goes.)
      const n = v.trail.length;
      if (n !== this.trailN) {
        this.trailN = n;
        this.line.setAttribute('d', strokesOf(v.trail, n - 1));
      }
      const from = v.trail[n - 2];
      const inking = n >= 2 && v.trail[n - 1][2];
      this.tip.classList.toggle('hidden', !inking);
      if (inking) {
        this.tip.setAttribute('x1', (from[0] / 10).toFixed(1));
        this.tip.setAttribute('y1', (from[1] / 10).toFixed(1));
        this.tip.setAttribute('x2', (v.needle[0] / 10).toFixed(1));
        this.tip.setAttribute('y2', (v.needle[1] / 10).toFixed(1));
      }
      const next = pointsOf(v.next);
      if (next !== this.nextAt) {
        this.nextAt = next;
        this.next.setAttribute('points', next);
      }
      this.pen.setAttribute('cx', (v.pen[0] / 10).toFixed(1));
      this.pen.setAttribute('cy', (v.pen[1] / 10).toFixed(1));
      this.needle.setAttribute('cx', (v.needle[0] / 10).toFixed(1));
      this.needle.setAttribute('cy', (v.needle[1] / 10).toFixed(1));
      this.el.classList.toggle('lead', v.lead);
    }
    (this.bar.firstElementChild as HTMLElement).style.width = `${(v.progress * 100).toFixed(1)}%`;
    this.bar.setAttribute('aria-valuenow', String(Math.round(v.progress * 100)));
    this.bar.setAttribute('aria-label', v.mine ? t('ink.mineBar') : t('ink.lineAria', { n: v.quality }));
  }
}
