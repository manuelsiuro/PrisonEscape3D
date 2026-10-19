import { t, type Key } from '../i18n';
import { HIGHLIGHT_ICON, type Highlight } from '../replay/scout';
import { clockAt, formatTime } from '../sim/systems/clock';
import { START_MINUTE, STEPS_PER_MINUTE } from '../sim/tuning';
import { h } from './dom';
import { icon } from './icons';

/**
 * The replay viewer's bar (P25), at the foot of the screen: what is being watched and the way
 * out of it; the scrubber (the days marked, the highlights as icons, how far the scout has
 * checked), then play or pause, the speed, skipping the quiet times, the time shown and the
 * jump to the escape. It only shows and reports: play/replay.ts does what is asked.
 */

/** The speeds, in the order the button goes through them (0: Auto, the director's). */
export const SPEEDS = [0, 1, 4, 16, 64] as const;

export interface BarView {
  /** The step shown. */
  at: number;
  /** How far the scrubber can be taken (the scout's progress, then the end that plays). */
  reach: number;
  playing: boolean;
  ended: boolean;
  speed: number;
  /** The director's pace right now (shown beside Auto). */
  pace: number;
  quiet: boolean;
  /** The scout's progress (0–1) while it runs; null once it's done. */
  checking: number | null;
}

/** "Day 2 · 14:05" for a step, in one piece (never broken across two lines). */
export const whenOf = (step: number) => `${t('hud.day', { n: clockAt(step).day }).replace(/ /g, '\u00a0')}\u00a0·\u00a0${formatTime(clockAt(step))}`;

export class ReplayBar {
  readonly el: HTMLElement;
  private readonly track: HTMLElement;
  private readonly scrub: HTMLElement;
  private readonly played: HTMLElement;
  private readonly scouted: HTMLElement;
  private readonly head: HTMLElement;
  private readonly marks: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly quietBtn: HTMLButtonElement;
  private readonly finaleBtn: HTMLButtonElement;
  private readonly time: HTMLElement;
  private readonly cap: HTMLElement;
  private readonly noteEl: HTMLElement;
  private capTimer = 0;
  private shown = { at: -1, reach: -1, playing: null as boolean | null, ended: null as boolean | null, speed: -1, pace: -1, quiet: null as boolean | null, checking: -2 as number | null, lang: '' };
  private dragging = false;

  onClose: () => void = () => {};
  onToggle: () => void = () => {};
  onSpeed: () => void = () => {};
  onQuiet: () => void = () => {};
  onFinale: () => void = () => {};
  /** To a step (`done`: let go of the scrubber). */
  onSeek: (step: number, done: boolean) => void = () => {};
  /** A key on the scrubber: an hour either way, the next or last highlight, the start or the escape. */
  onKey: (key: 'back' | 'fwd' | 'prev' | 'next' | 'home' | 'end') => void = () => {};

  constructor(
    title: string,
    sub: string,
    private readonly from: number,
    private readonly to: number,
  ) {
    this.el = h(
      'div',
      'rp',
      `<div class="rp-cap" aria-live="polite"></div>
      <div class="rp-note hidden" role="status"></div>
      <div class="rp-panel">
        <div class="rp-head">
          <span class="rp-badge">${icon('film', 16)}<b>${t('replay.badge')}</b></span>
          <span class="rp-title"><b></b><small></small></span>
          <button class="icon-btn rp-close" aria-label="${t('replay.close')}">${icon('close')}</button>
        </div>
        <div class="rp-scrub" role="slider" tabindex="0" aria-label="${t('replay.scrub')}" aria-valuemin="0" aria-valuemax="100">
          <div class="rp-track"><i class="rp-scouted"></i><i class="rp-played"></i><div class="rp-days"></div><div class="rp-marks" aria-hidden="true"></div><i class="rp-knob"></i></div>
        </div>
        <div class="rp-row">
          <button class="rp-btn rp-play"></button>
          <button class="rp-btn rp-speed"><b></b><small></small></button>
          <button class="rp-btn rp-quiet" aria-label="${t('replay.quiet')}" title="${t('replay.quiet')}">${icon('moon', 18)}<i>${icon('chevronRight', 12)}${icon('chevronRight', 12)}</i></button>
          <span class="rp-time"></span>
          <button class="rp-btn rp-finale">${icon('run', 18)}<span>${t('replay.finale')}</span></button>
        </div>
      </div>`,
    );
    const q = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
    q('.rp-panel').setAttribute('role', 'region');
    q('.rp-panel').setAttribute('aria-label', t('replay.region', { title }));
    q('.rp-title b').textContent = title;
    q('.rp-title small').textContent = sub;
    this.track = q('.rp-track');
    this.scrub = q('.rp-scrub');
    this.played = q('.rp-played');
    this.scouted = q('.rp-scouted');
    this.head = q('.rp-knob');
    this.marks = q('.rp-marks');
    this.playBtn = q('.rp-play');
    this.speedBtn = q('.rp-speed');
    this.quietBtn = q('.rp-quiet');
    this.finaleBtn = q('.rp-finale');
    this.time = q('.rp-time');
    this.cap = q('.rp-cap');
    this.noteEl = q('.rp-note');
    this.days();
    q('.rp-close').addEventListener('click', () => this.onClose());
    this.playBtn.addEventListener('click', () => this.onToggle());
    this.speedBtn.addEventListener('click', () => this.onSpeed());
    this.quietBtn.addEventListener('click', () => this.onQuiet());
    this.finaleBtn.addEventListener('click', () => this.onFinale());
    // The scrubber: press anywhere along it, and drag.
    const stepAt = (e: PointerEvent) => {
      const r = this.track.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
      return Math.round(this.from + f * (this.to - this.from));
    };
    this.scrub.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.scrub.setPointerCapture(e.pointerId);
      this.onSeek(stepAt(e), false);
    });
    this.scrub.addEventListener('pointermove', (e) => {
      if (this.dragging) this.onSeek(stepAt(e), false);
    });
    const up = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.onSeek(stepAt(e), true);
    };
    this.scrub.addEventListener('pointerup', up);
    this.scrub.addEventListener('pointercancel', up);
    this.scrub.addEventListener('keydown', (e) => {
      const k = ({ ArrowLeft: 'back', ArrowDown: 'back', ArrowRight: 'fwd', ArrowUp: 'fwd', PageUp: 'prev', PageDown: 'next', Home: 'home', End: 'end' } as const)[e.code as 'ArrowLeft'];
      if (!k) return;
      e.preventDefault();
      e.stopPropagation();
      this.onKey(k);
    });
    document.body.append(this.el);
    addEventListener('resize', this.relay);
  }

  private readonly relay = () => this.setMarks(this.list);

  /** Where a step falls along the scrubber (0–100). */
  private pct(step: number): number {
    return 100 * Math.max(0, Math.min(1, (step - this.from) / Math.max(1, this.to - this.from)));
  }

  /** Each new day marked along the scrubber, at midnight (as the clock counts the days). */
  private days() {
    const box = this.el.querySelector<HTMLElement>('.rp-days')!;
    const startOf = (d: number) => ((d - 1) * 1440 - START_MINUTE) * STEPS_PER_MINUTE;
    let html = '';
    for (let d = clockAt(this.from).day + 1; startOf(d) < this.to; d++) html += `<i style="left:${this.pct(startOf(d))}%"><span>${t('replay.dayShort', { n: d })}</span></i>`;
    box.innerHTML = html;
  }

  /** The highlights found so far, as icons along the scrubber. */
  setMarks(list: readonly Highlight[]) {
    this.list = list;
    // (Marks too close to sit side by side stack up, two high at most.)
    const w = this.track.clientWidth || 600;
    const ends = [-Infinity, -Infinity];
    this.marks.innerHTML = list
      .map((m) => {
        const x = (this.pct(m.step) / 100) * w;
        let row = ends.findIndex((e) => x - e >= 19);
        if (row < 0) row = ends.indexOf(Math.min(...ends));
        ends[row] = x;
        return `<i class="rp-mark ${m.kind}" style="left:${this.pct(m.step)}%;--row:${row}" title="${t(`replay.h.${m.kind}` as Key)} · ${whenOf(m.step)}">${icon(HIGHLIGHT_ICON[m.kind], 11)}</i>`;
      })
      .join('');
  }
  private list: readonly Highlight[] = [];

  /** A line over the bar for a moment (a highlight as it plays). */
  caption(text: string, ms = 2600) {
    this.cap.textContent = text;
    this.cap.classList.add('on');
    clearTimeout(this.capTimer);
    this.capTimer = window.setTimeout(() => this.cap.classList.remove('on'), ms);
  }

  /** A standing note (a replay that stops early: why); null takes it away. */
  note(text: string | null) {
    this.noteEl.textContent = text ?? '';
    this.noteEl.classList.toggle('hidden', !text);
  }

  /** "To the escape" only where there is one (a replay that stops early has none). */
  finale(on: boolean) {
    this.finaleBtn.classList.toggle('hidden', !on);
  }

  /** The bar out of the way (the escape camera's moment). */
  hide(on: boolean) {
    this.el.classList.toggle('away', on);
  }

  update(v: BarView) {
    const s = this.shown;
    const lang = document.documentElement.lang;
    if (v.at !== s.at) {
      s.at = v.at;
      const p = `${this.pct(v.at)}%`;
      this.played.style.width = p;
      this.head.style.left = p;
      const when = whenOf(v.at);
      this.time.textContent = when;
      this.scrub.setAttribute('aria-valuenow', String(Math.round(this.pct(v.at))));
      this.scrub.setAttribute('aria-valuetext', when);
    }
    if (v.reach !== s.reach) {
      s.reach = v.reach;
      this.scouted.style.width = `${this.pct(v.reach)}%`;
    }
    if (v.playing !== s.playing || v.ended !== s.ended || lang !== s.lang) {
      s.playing = v.playing;
      s.ended = v.ended;
      this.playBtn.innerHTML = icon(v.ended ? 'replay' : v.playing ? 'pause' : 'play', 20);
      this.playBtn.setAttribute('aria-label', t(v.ended ? 'replay.again' : v.playing ? 'replay.pause' : 'replay.play'));
      // (Focus on "To the escape" as it greys out: on to Watch again, not lost.)
      if (v.ended && document.activeElement === this.finaleBtn) this.playBtn.focus();
      this.finaleBtn.disabled = v.ended;
    }
    // (The director's pace shown under Auto, rounded: it eases all the time.)
    const pace = v.speed === 0 ? Math.max(1, Math.round(v.pace)) : 0;
    if (v.speed !== s.speed || pace !== s.pace || lang !== s.lang) {
      s.speed = v.speed;
      s.pace = pace;
      this.speedBtn.querySelector('b')!.textContent = v.speed === 0 ? t('replay.auto') : `${v.speed}×`;
      this.speedBtn.querySelector('small')!.textContent = v.speed === 0 ? `${pace}×` : '';
      this.speedBtn.setAttribute('aria-label', t('replay.speed', { speed: v.speed === 0 ? `${t('replay.auto')} (${pace}×)` : `${v.speed}×` }));
    }
    if (v.quiet !== s.quiet) {
      s.quiet = v.quiet;
      this.quietBtn.classList.toggle('on', v.quiet);
      this.quietBtn.setAttribute('aria-pressed', String(v.quiet));
    }
    if (v.checking !== s.checking) {
      s.checking = v.checking;
      this.el.classList.toggle('checking', v.checking !== null);
      this.scouted.title = v.checking !== null ? t('replay.checking', { n: Math.floor(v.checking * 100) }) : '';
    }
    s.lang = lang;
  }

  remove() {
    removeEventListener('resize', this.relay);
    clearTimeout(this.capTimer);
    this.el.remove();
  }
}
