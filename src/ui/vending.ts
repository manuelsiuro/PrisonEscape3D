/**
 * The vending machine on screen (2.32): its front, up close. Lit rows behind the glass, each with its code, what's
 * in it, how many are left and its price; the money in the machine's window; a flap at the bottom that what's bought
 * drops into. Everything shown comes from the sim by way of play/vending.ts; the moving parts are CSS, and reduced
 * motion turns them off.
 */
import { itemIcons } from '../render/itemIcons';
import { t } from '../i18n';
import { EXT, OP } from '../sim/command';
import { VEND } from '../content/vending';
import { esc, h, type Send } from './dom';
import { icon } from './icons';

export interface VendRow {
  k: number;
  code: string;
  item: number;
  name: string;
  price: string;
  left: number;
  /** What it gives, in a few words ("+12 energy"). */
  gives: string;
  /** Why not, right now ('' it can be had). */
  why: string;
}

export interface VendView {
  cash: number;
  rows: VendRow[];
  /** The window's words, and their tone. */
  screen: string;
  tone: 'idle' | 'busy' | 'jam' | 'wait' | 'off';
  /** The row turning (-1 none), what's stuck (-1 nothing). */
  coil: number;
  jam: number;
  /** Who's ahead of the player (0: it's theirs), whether they've taken a place, whether either can be asked for. */
  ahead: number;
  inLine: boolean;
  /** Pushing in would pass someone. */
  canCut: boolean;
  /** What the thump button says, in the player's keys. */
  thumpKeys: string;
  /** The key words under the rows. */
  note: string;
}

export class VendCard {
  private readonly el: HTMLElement;
  private readonly led: HTMLElement;
  private readonly window: HTMLElement;
  private readonly glass: HTMLElement;
  private readonly flap: HTMLElement;
  private readonly note: HTMLElement;
  private readonly actions: HTMLElement;
  private drawn = '';
  private actionsDrawn = '';

  constructor(
    private readonly send: Send,
    private readonly click: () => void,
  ) {
    this.el = h(
      'div',
      'train-card vend-card hidden',
      `<div class="vend-head"><b class="vend-brand">SNAX</b><span class="vend-led" role="status"></span><button class="icon-btn train-stop vend-close">${icon('close', 16)}</button></div>
      <div class="vend-body">
        <div class="vend-glass" role="group"></div>
        <div class="vend-side">
          <p class="vend-window" role="status"></p>
          <div class="vend-actions"></div>
          <div class="vend-flap" aria-hidden="true"><i></i></div>
        </div>
      </div>
      <p class="train-note vend-note"></p>`,
    );
    this.led = this.el.querySelector('.vend-led')!;
    this.window = this.el.querySelector('.vend-window')!;
    this.glass = this.el.querySelector('.vend-glass')!;
    this.flap = this.el.querySelector('.vend-flap')!;
    this.note = this.el.querySelector('.vend-note')!;
    this.actions = this.el.querySelector('.vend-actions')!;
    this.el.querySelector('.vend-close')!.addEventListener('click', () => this.ask(VEND.CLOSE));
    this.glass.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.vend-row');
      if (b && !b.disabled) this.choose(Number(b.dataset.k));
    });
    this.actions.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-ask]');
      if (b) this.ask(Number(b.dataset.ask));
    });
    // (Keeps the keyboard with the game.)
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  private ask(b: number, c = 0) {
    this.click();
    this.send(OP.EXT, EXT.VEND, b, c);
  }

  /** A row chosen, whatever it says about it: a refused one is told why. */
  choose(k: number) {
    this.ask(VEND.BUY, k);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  /** It's come down: the flap shows it dropping. */
  dropped(item: number) {
    const i = this.flap.querySelector('i')!;
    i.innerHTML = `<img src="${itemIcons()[item]}" alt="" draggable="false">`;
    this.flap.classList.remove('drop');
    void this.flap.offsetWidth;
    this.flap.classList.add('drop');
  }

  /** A thump: the whole front shakes. */
  shake() {
    this.el.classList.remove('thumped');
    void this.el.offsetWidth;
    this.el.classList.add('thumped');
  }

  update(v: VendView | null) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      this.actionsDrawn = '';
      // (Or they'd play again when it next opens.)
      this.el.classList.remove('thumped');
      this.flap.classList.remove('drop');
      return;
    }
    const rows = JSON.stringify(v.rows) + v.coil + v.jam;
    if (rows !== this.drawn) {
      this.drawn = rows;
      const icons = itemIcons();
      this.glass.innerHTML = v.rows
        .map((r) => {
          const out = r.left <= 0;
          const cls = `vend-row${out ? ' out' : ''}${r.why ? ' no' : ''}${v.coil === r.k ? ' turning' : ''}${v.jam === r.k ? ' stuck' : ''}`;
          const pips = Array.from({ length: Math.min(5, r.left) }, () => '<i></i>').join('');
          return `<button class="${cls}" data-k="${r.k}" aria-label="${esc(`${r.code} ${r.name} ${r.price}${r.gives ? `, ${r.gives}` : ''}${r.why ? `. ${r.why}` : ''}`)}">
            <span class="vend-code">${r.code}</span>
            <span class="vend-item"><img src="${icons[r.item]}" alt="" draggable="false"></span>
            <span class="vend-name">${esc(r.name)}</span>
            <span class="vend-gives">${esc(r.gives)}</span>
            <span class="vend-foot"><b>${esc(r.price)}</b><span class="vend-pips">${out ? `<em>${esc(t('vend.soldOut'))}</em>` : pips}</span></span>
          </button>`;
        })
        .join('');
    }
    this.led.textContent = `$${v.cash}`;
    this.window.textContent = v.screen;
    this.window.dataset.tone = v.tone;
    this.note.textContent = v.note;
    const acts = `${v.jam}|${v.ahead}|${v.inLine}|${v.canCut}|${v.thumpKeys}`;
    if (acts !== this.actionsDrawn) {
      this.actionsDrawn = acts;
      const parts: string[] = [];
      if (v.jam >= 0 && v.ahead === 0)
        parts.push(
          `<button class="big-btn primary vend-thump" data-ask="${VEND.THUMP}">${icon('fist', 18)}<span>${esc(t('vend.thump'))}</span></button>`,
        );
      else if (v.ahead > 0) {
        if (!v.inLine) parts.push(`<button class="big-btn ghost" data-ask="${VEND.WAIT}">${esc(t('vend.wait'))}</button>`);
        if (v.canCut) parts.push(`<button class="big-btn ghost vend-cut" data-ask="${VEND.CUT}">${esc(t('vend.cut'))}</button>`);
      }
      this.actions.innerHTML = parts.join('');
    }
  }
}
