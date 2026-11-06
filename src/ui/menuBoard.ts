/**
 * The canteen's menu board on screen (2.33): the chalkboard up close. Today's breakfast and dinner, each with its time,
 * its dish and what its tray gives (the meal on now or eaten marked), tomorrow's along the bottom, what else the day
 * holds for a tray (a feast, the garden's produce); a scribble button, and the scribble itself once it's up, in chalk
 * across the board. Everything shown comes from the sim by way of play/menuBoard.ts.
 */
import { t } from '../i18n';
import { EXT, OP } from '../sim/command';
import { MENU } from '../content/menu';
import { esc, h, type Send } from './dom';
import { icon } from './icons';

export interface MenuMeal {
  /** Breakfast, dinner; its time; the dish's name and what it gives. */
  label: string;
  time: string;
  dish: string;
  gives: string;
  /** 'now' being served, 'eaten' (this meal's tray done), 'over' (gone by), '' still to come. */
  state: 'now' | 'eaten' | 'over' | '';
  /** A feast (gold). */
  feast: boolean;
}

export interface MenuView {
  /** "Day 3". */
  day: string;
  today: MenuMeal[];
  /** Tomorrow's two dishes, in a line. */
  tomorrow: string;
  /** What else today holds for a tray. */
  notes: string[];
  /** The scribble on the board ('' clean). */
  joke: string;
  /** The scribble button: there to press, under way (0–1 done), done today. */
  scribble: 'can' | 'doing' | 'done';
  progress: number;
  /** A guard sees the player now (the button says so). */
  seen: boolean;
  /** The key words at the bottom. */
  note: string;
}

export class MenuCard {
  private readonly el: HTMLElement;
  private readonly day: HTMLElement;
  private readonly meals: HTMLElement;
  private readonly tomorrow: HTMLElement;
  private readonly notes: HTMLElement;
  private readonly joke: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly note: HTMLElement;
  private drawn = '';
  private actionsDrawn = '';

  constructor(
    private readonly send: Send,
    private readonly click: () => void,
  ) {
    this.el = h(
      'div',
      'train-card menu-card hidden',
      `<div class="menu-head"><b class="menu-brand">${icon('utensils', 18)}<span class="menu-title"></span></b><span class="menu-day"></span><button class="icon-btn train-stop menu-close">${icon('close', 16)}</button></div>
      <div class="menu-board">
        <div class="menu-meals" role="list"></div>
        <p class="menu-joke" aria-live="polite"></p>
        <p class="menu-tomorrow"></p>
        <div class="menu-notes"></div>
      </div>
      <div class="menu-actions"></div>
      <p class="train-note menu-note"></p>`,
    );
    this.day = this.el.querySelector('.menu-day')!;
    this.meals = this.el.querySelector('.menu-meals')!;
    this.tomorrow = this.el.querySelector('.menu-tomorrow')!;
    this.notes = this.el.querySelector('.menu-notes')!;
    this.joke = this.el.querySelector('.menu-joke')!;
    this.actions = this.el.querySelector('.menu-actions')!;
    this.note = this.el.querySelector('.menu-note')!;
    this.el.querySelector('.menu-close')!.addEventListener('click', () => this.ask(MENU.CLOSE));
    this.actions.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-ask]');
      if (b && !b.disabled) this.ask(Number(b.dataset.ask));
    });
    // (Keeps the keyboard with the game.)
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  private ask(b: number) {
    this.click();
    this.send(OP.EXT, EXT.MENU, b, 0);
  }

  /** The scribble begun (its key). */
  scribble() {
    this.ask(MENU.SCRIBBLE);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  update(v: MenuView | null) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      this.actionsDrawn = '';
      return;
    }
    const board = JSON.stringify([v.day, v.today, v.tomorrow, v.notes, v.joke]);
    if (board !== this.drawn) {
      this.drawn = board;
      this.el.querySelector('.menu-title')!.textContent = t('menu.title');
      this.day.textContent = v.day;
      this.meals.innerHTML = v.today
        .map((m) => {
          const tag =
            m.state === 'now'
              ? `<em class="menu-tag now">${esc(t('menu.now'))}</em>`
              : m.state === 'eaten'
                ? `<em class="menu-tag eaten">${icon('check', 12)}${esc(t('menu.eaten'))}</em>`
                : '';
          return `<div class="menu-meal${m.feast ? ' feast' : ''}${m.state === 'over' || m.state === 'eaten' ? ' done' : ''}" role="listitem">
            <span class="menu-when"><b>${esc(m.label)}</b><i>${esc(m.time)}</i></span>
            <span class="menu-dish">${esc(m.dish)}${tag}</span>
            <span class="menu-gives">${esc(m.gives)}</span>
          </div>`;
        })
        .join('');
      this.tomorrow.innerHTML = `<b>${esc(t('menu.tomorrow'))}</b> ${esc(v.tomorrow)}`;
      this.notes.innerHTML = v.notes.map((n) => `<p class="menu-extra">${esc(n)}</p>`).join('');
      this.joke.textContent = v.joke;
      this.el.classList.toggle('scribbled', !!v.joke);
    }
    this.note.textContent = v.note;
    const acts = `${v.scribble}|${v.seen}|${v.scribble === 'doing' ? Math.round(v.progress * 20) : 0}`;
    if (acts !== this.actionsDrawn) {
      this.actionsDrawn = acts;
      const label = v.scribble === 'doing' ? t('menu.scribbling') : v.scribble === 'done' ? t('menu.scribbled') : t('menu.scribble');
      const warn = v.seen && v.scribble === 'can' ? `<small class="menu-seen">${icon('eye', 14)}${esc(t('menu.seen'))}</small>` : '';
      const fill = v.scribble === 'doing' ? `<i class="menu-fill" style="width:${Math.round(v.progress * 100)}%"></i>` : '';
      this.actions.innerHTML = `<button class="big-btn ghost menu-scribble${v.seen ? ' seen' : ''}" data-ask="${MENU.SCRIBBLE}"${v.scribble === 'can' ? '' : ' disabled'}>${fill}${icon('chalk', 18)}<span>${esc(label)}</span></button>${warn}`;
    }
  }
}
