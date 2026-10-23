import { currentLang, t } from '../i18n';
import { BOARD } from '../content/oddjobs';
import { EXT, OP } from '../sim/command';
import { h, setText, TOUCH } from './dom';
import { icon } from './icons';

type Send = (op: number, a?: number, b?: number, c?: number) => void;

/**
 * The odd jobs board (P40) on screen: its card at the board (the day's three pins and the story's
 * card, each with who asks, what, how long, the pay and what comes with it, and Take it or why
 * not), the job held (its steps, the time left, Give up), opened from the job's chip anywhere;
 * and a story's short cards as its steps are taken and handed in. Drawn from a view the play layer
 * fills from the sim (play/oddjobs.ts): the sim's own functions decide everything shown.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A job as a pin shows it. */
export interface PinView {
  /** Its pin (EXT.BOARD TAKE's c: 0–2, 3 the story's). */
  pin: number;
  icon: string;
  kind: string;
  who: string;
  ask: string;
  /** How long and what it pays; what comes with it ('' nothing more). */
  meta: string;
  perk: string;
  /** Why it can't be taken now ('' it can, or the reason is the card's note: one job at a time). */
  why: string;
  /** It can't be taken now. */
  off: boolean;
  /** The Take button's name for a screen reader (the kind and who asks). */
  label: string;
  /** The story's card: its title and step ('' a pin). */
  story: string;
}

/** The job held as the card shows it. */
export interface HeldView {
  icon: string;
  kind: string;
  who: string;
  ask: string;
  steps: Array<{ text: string; done: boolean; now: boolean }>;
  left: string;
  /** On watch for a dig: the whistle's button. */
  whistle: boolean;
  /** A guard coming at the dig: the whistle urgent. */
  urgent: boolean;
}

export interface OddJobsView {
  /** At the board, or the job's own card (from its chip). */
  mode: 'board' | 'job';
  note: string;
  pins: PinView[];
  job: HeldView | null;
}

/** The board's card. */
export class OddJobsCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly note: HTMLElement;
  private drawn = '';

  constructor(
    private readonly send: Send,
    private readonly click: () => void,
  ) {
    this.el = h(
      'div',
      'train-card oddjobs-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('pin', 18)}</i><b></b></div>
      <p class="train-note oddjobs-note"></p>
      <div class="oddjobs-body"></div>`,
    );
    this.el.setAttribute('role', 'dialog');
    this.title = this.el.querySelector('.train-head b')!;
    this.note = this.el.querySelector('.oddjobs-note')!;
    this.body = this.el.querySelector('.oddjobs-body')!;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || b.disabled) return;
      const d = b.dataset;
      // (Giving up asks twice: the first press arms it.)
      if (d.confirm && !b.classList.contains('armed')) {
        this.click();
        b.classList.add('armed');
        setText(b.querySelector('span')!, d.confirm);
        setTimeout(() => {
          if (!b.isConnected) return;
          b.classList.remove('armed');
          this.drawn = '';
        }, 3500);
        return;
      }
      this.click();
      if (d.whistle !== undefined) this.send(OP.EXT, EXT.WHISTLE);
      else if (d.op !== undefined) this.send(OP.EXT, EXT.BOARD, Number(d.op), Number(d.arg ?? 0));
      this.drawn = '';
    });
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  update(v: OddJobsView | null) {
    const shown = !!v && this.el.classList.contains('hidden');
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      return false;
    }
    const key = JSON.stringify(v) + currentLang() + TOUCH;
    if (key === this.drawn) return true;
    // (A Give up armed stays armed across a redraw of the rest.)
    if (this.el.querySelector('.armed')) return true;
    this.drawn = key;
    this.el.dataset.mode = v.mode;
    setText(this.title, t(v.mode === 'board' ? 'oddjob.title' : 'oddjob.yourJob'));
    setText(this.note, v.note);
    const held = v.job ? heldHtml(v.job, v.mode === 'job') : '';
    const pins = v.pins.map(pinHtml).join('');
    this.body.innerHTML = `${held}${pins ? `<div class="oddjobs-pins">${pins}</div>` : ''}`;
    // (Shown again: from its top, not where it was last scrolled to; once it's displayed and drawn, and again a frame on.)
    if (shown) {
      this.el.scrollTop = 0;
      requestAnimationFrame(() => (this.el.scrollTop = 0));
    }
    return true;
  }
}

function heldHtml(j: HeldView, alone: boolean): string {
  const steps = j.steps.map((s) => `<li class="${s.done ? 'done' : s.now ? 'now' : ''}">${icon(s.done ? 'check' : s.now ? 'chevronRight' : 'clock', 13)}<span>${esc(s.text)}</span></li>`).join('');
  const whistle = j.whistle ? `<button class="big-btn ${j.urgent ? 'primary urgent' : 'ghost'} small" data-whistle>${icon('megaphone', 16)}<span>${esc(t(TOUCH ? 'oddjob.whistle' : 'oddjob.whistleKey'))}</span></button>` : '';
  return `<section class="oddjobs-held">${alone ? '' : `<div class="box-label">${icon('briefcase', 14)}<span>${esc(t('oddjob.yourJob'))}</span></div>`}
    <div class="oddjob-pin held"><i class="oddjob-ic">${icon(j.icon, 16)}</i><span class="oddjob-text"><b>${esc(j.kind)} · ${esc(j.who)}</b><small>${esc(j.ask)}</small></span></div>
    <ul class="oddjob-steps">${steps}</ul>
    <div class="oddjob-foot"><span class="oddjob-left">${icon('clock', 13)}${esc(j.left)}</span>${whistle}<button class="big-btn ghost small" data-op="${BOARD.QUIT}" data-confirm="${esc(t('oddjob.quitSure'))}">${icon('close', 16)}<span>${esc(t('oddjob.quit'))}</span></button></div></section>`;
}

function pinHtml(p: PinView): string {
  return `<div class="oddjob-pin${p.story ? ' story' : ''}">
    <i class="oddjob-ic">${icon(p.icon, 16)}</i>
    <span class="oddjob-text">${p.story ? `<em>${esc(p.story)}</em>` : ''}<b>${esc(p.kind)} · ${esc(p.who)}</b><small>${esc(p.ask)}</small><span class="oddjob-meta">${esc(p.meta)}${p.perk ? ` · <strong>${esc(p.perk)}</strong>` : ''}</span>${p.why ? `<small class="oddjob-why">${esc(p.why)}</small>` : ''}</span>
    <button class="big-btn ${p.off ? 'ghost' : 'primary'} small" data-op="${BOARD.TAKE}" data-arg="${p.pin}" aria-label="${esc(p.label)}" ${p.off ? 'disabled' : ''}>${icon('check', 16)}<span>${esc(t('oddjob.take'))}</span></button></div>`;
}

/**
 * A story's short card (P40): who tells it, the story's title and step, a few lines. Up until
 * tapped (OK) or for a while; docked like the board's card.
 */
export class StoryCard {
  private readonly el: HTMLElement;
  private timer = 0;

  constructor(private readonly click: () => void) {
    this.el = h('div', 'story-card hidden', `<div class="story-head"><i>${icon('book', 18)}</i><span><b></b><small></small></span></div><p class="story-text"></p><button class="big-btn primary small story-ok">${icon('check', 16)}<span></span></button>`);
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-live', 'polite');
    this.el.querySelector('.story-ok')!.addEventListener('click', () => {
      this.click();
      this.hide();
    });
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  show(title: string, sub: string, text: string, ms = 14000) {
    setText(this.el.querySelector('.story-head b')!, title);
    setText(this.el.querySelector('.story-head small')!, sub);
    setText(this.el.querySelector('.story-text')!, text);
    setText(this.el.querySelector('.story-ok span')!, t('oddjob.storyOk'));
    this.el.classList.remove('hidden');
    document.body.classList.add('story-up');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), ms);
  }

  hide() {
    clearTimeout(this.timer);
    this.el.classList.add('hidden');
    document.body.classList.remove('story-up');
  }
}
