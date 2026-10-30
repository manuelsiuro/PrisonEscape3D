import { currentLang, t } from '../i18n';
import { BOARD } from '../content/oddjobs';
import { EXT, OP } from '../sim/command';
import { esc, h, type Send, setText, TOUCH } from './dom';
import { icon } from './icons';


/**
 * The odd jobs board (P40) on screen: its card at the board (the day's three pins and the story's
 * card, each with who asks, what, how long, the pay and what comes with it, and Take it or why
 * not), the job held (its steps, the time left, Give up), opened from the job's chip anywhere;
 * and a story's short cards as its steps are taken and handed in. Drawn from a view the play layer
 * fills from the sim (play/oddjobs.ts): the sim's own functions decide everything shown.
 */


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
  private readonly closeBtn: HTMLButtonElement;
  private drawn = '';
  /** The keyboard's focus goes into the card the next time it shows (opened from its chip or B). */
  private focusNext = false;
  /** The job's own card's Close button (the play layer closes it). */
  onClose: () => void = () => {};

  constructor(
    private readonly send: Send,
    private readonly click: () => void,
  ) {
    this.el = h(
      'div',
      'train-card oddjobs-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('pin', 18)}</i><b id="oddjobs-title"></b><button class="icon-btn small oddjobs-close" data-close>${icon('close', 16)}</button></div>
      <p class="train-note oddjobs-note"></p>
      <div class="oddjobs-body"></div>`,
    );
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-labelledby', 'oddjobs-title');
    this.el.tabIndex = -1;
    this.title = this.el.querySelector('.train-head b')!;
    this.note = this.el.querySelector('.oddjobs-note')!;
    this.body = this.el.querySelector('.oddjobs-body')!;
    this.closeBtn = this.el.querySelector('.oddjobs-close')!;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || b.disabled) return;
      const d = b.dataset;
      if (d.close !== undefined) {
        this.click();
        this.onClose();
        return;
      }
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

  /** What it shows: the board's card or the job's own. */
  get mode(): OddJobsView['mode'] | '' {
    return (this.el.dataset.mode as OddJobsView['mode'] | undefined) ?? '';
  }

  /** Opened from its chip or B: the focus goes into it as it shows. */
  focusOnShow() {
    this.focusNext = true;
  }

  /** Closed: the focus, if it was in the card, back to the job's chip (or let go, the chip gone with the job). */
  returnFocus() {
    this.focusNext = false;
    if (!this.el.contains(document.activeElement)) return;
    const chip = document.querySelector<HTMLElement>('.hud:not(.hidden) .hud-job:not(.hidden)');
    if (chip) chip.focus();
    else (document.activeElement as HTMLElement | null)?.blur();
  }

  update(v: OddJobsView | null) {
    const shown = !!v && this.el.classList.contains('hidden');
    // (Hidden with the focus in it: given back to the chip, never left on a hidden button.)
    if (!v && this.open) this.returnFocus();
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
    // (Both close with the button or Escape; the job's own with its chip too, the board's by walking away too.)
    this.closeBtn.setAttribute('aria-label', t('common.close'));
    this.closeBtn.title = TOUCH ? '' : `${t('common.close')} (Esc)`;
    setText(this.note, v.note);
    const held = v.job ? heldHtml(v.job, v.mode === 'job') : '';
    const pins = v.pins.map(pinHtml).join('');
    // (Redrawn with the focus on a button that goes: kept on the card, not dropped to the page.)
    const lost = this.body.contains(document.activeElement);
    this.body.innerHTML = `${held}${pins ? `<div class="oddjobs-pins">${pins}</div>` : ''}`;
    if (lost) this.el.focus({ preventScroll: true });
    // (Opened from its chip or B: the focus into it, on its Close button.)
    if (this.focusNext) {
      this.focusNext = false;
      if (v.mode === 'job') this.closeBtn.focus({ preventScroll: true });
    }
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
  /** Put aside for another card (see wait). */
  private waiting = false;

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
    this.waiting = false;
    this.el.classList.remove('hidden');
    document.body.classList.add('story-up');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), ms);
  }

  hide() {
    clearTimeout(this.timer);
    this.waiting = false;
    this.el.classList.add('hidden');
    document.body.classList.remove('story-up');
  }

  /** Put aside while another card is docked where it docks (one card at a time), shown again after for a while. */
  wait(on: boolean) {
    if (on && this.open) {
      clearTimeout(this.timer);
      this.waiting = true;
      this.el.classList.add('hidden');
      document.body.classList.remove('story-up');
    } else if (!on && this.waiting) {
      this.waiting = false;
      this.el.classList.remove('hidden');
      document.body.classList.add('story-up');
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.hide(), 9000);
    }
  }
}
