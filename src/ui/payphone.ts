import { currentLang, t } from '../i18n';
import { CALLEE, JOB, LAWYER } from '../content/phone';
import { EXT, LINE, OP } from '../sim/command';
import { esc, h, type Send, setText, TOUCH } from './dom';
import { icon } from './icons';
import { pad2 } from '../sim/systems/clock';


/**
 * The pay phone (P34) on screen: its card at the phone. The dial (home, the lawyer, cousin Lou,
 * an anonymous tip, each with its price and why not), the queue (who's on it, who waits, the
 * player's place: get in line, leave it, cut in), a call under way (its clock, Hang up) and Lou's
 * tapped line (who's listening in, three phrases a line, 1–3). Drawn from a view the play layer
 * fills from the sim (play/payphone.ts): the sim's own functions decide everything shown.
 */


/** What can be called, as the dial lists it: `id` names its text, `b` and `c` what's sent. */
export interface DialRow {
  id: 'home' | 'appeal' | 'retainer' | 'parole' | 'diversion' | 'cake' | 'car' | 'tip';
  b: number;
  c: number;
  price: string;
  /** Why not now ('' it can be called), and the row's second line. */
  why: string;
  note: string;
}

/** The pay phone as its card shows it. */
export interface PayphoneView {
  /** 'dial' at the phone free to call, 'queue' waiting or watching others, 'call' a call under way, 'lou' on Lou's line, 'result' how a call ended a moment. */
  phase: 'dial' | 'queue' | 'call' | 'lou' | 'result';
  cash: number;
  /** Who's on it (''), walking over to it; who waits (names, "You" for the player); the player's place (-1 not in line), the turn's time left (0–1; -1 no turn). */
  on: string;
  walking: boolean;
  waiting: string[];
  place: number;
  turnLeft: number;
  canJoin: boolean;
  canCut: boolean;
  /** The dial's rows (for the menu open), the dollars at mail call, the next money order's day. */
  rows: DialRow[];
  mail: string;
  /** A call under way: what it is, how far along (0–1). */
  calling: string;
  progress: number;
  /** Lou's line: the line said now (0–2), the guard listening in, the phrases (and those Lou knows), the time left (0–1). */
  line: number;
  ear: string;
  phrases: string[];
  known: boolean[];
  /** How the last call ended (shown a moment), good news or not. */
  result: string;
  good: boolean;
  /** Seconds left on the clock the bar shows (its label). */
  secs: number;
  /** Why the phone's off now ('' it's on: the dial shows), the note under the queue (you're next; a place to buy), the second line's name for Lou's job (how, or where). */
  closed: string;
  hint: string;
  second: string;
}

/** What the card's menus have picked (UI only: the play layer reads it to say why not). */
export interface PhonePick {
  menu: 'main' | 'lawyer' | 'cousin' | 'tip';
  hour: number;
  cell: number;
}

/** The pay phone's card. */
export class PayphoneCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly value: HTMLElement;
  private readonly queue: HTMLElement;
  private readonly body: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly note: HTMLElement;
  private readonly actions: HTMLElement;
  private drawn = '';
  private cutArmed = 0;
  readonly pick: PhonePick = { menu: 'main', hour: 22, cell: 2 };
  /** The cells there are to tip off (set by the play layer each frame): [cell, name]. */
  cells: Array<[number, string]> = [];

  constructor(
    private readonly send: Send,
    private readonly click: () => void,
  ) {
    this.el = h(
      'div',
      'train-card phone-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('phone', 18)}</i><b></b><span class="train-value"></span></div>
      <div class="phone-queue"></div>
      <div class="phone-body"></div>
      <i class="match-clock phone-bar" role="timer"><i></i></i>
      <p class="train-note"></p>
      <div class="phone-actions"></div>`,
    );
    this.title = this.el.querySelector('.train-head b')!;
    this.value = this.el.querySelector('.train-value')!;
    this.queue = this.el.querySelector('.phone-queue')!;
    this.body = this.el.querySelector('.phone-body')!;
    this.bar = this.el.querySelector('.phone-bar')!;
    this.note = this.el.querySelector('.train-note')!;
    this.actions = this.el.querySelector('.phone-actions')!;
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || b.disabled) return;
      this.click();
      const d = b.dataset;
      if (d.say !== undefined) this.send(OP.EXT, EXT.SAY, Number(d.say));
      else if (d.menu) this.pick.menu = d.menu as PhonePick['menu'];
      else if (d.call) {
        this.send(OP.EXT, EXT.CALL, Number(d.call), Number(d.arg ?? 0));
        this.pick.menu = 'main';
      } else if (d.hour) this.pick.hour = (this.pick.hour + Number(d.hour) + 24) % 24;
      else if (d.cell) this.stepCell(Number(d.cell));
      else if (d.line === 'join') this.send(OP.EXT, EXT.LINE, LINE.JOIN);
      else if (d.line === 'leave') this.send(OP.EXT, EXT.LINE, LINE.LEAVE);
      else if (d.line === 'cut') {
        // Asked twice: the line won't like it.
        if (this.cutArmed && performance.now() - this.cutArmed < 4000) {
          this.cutArmed = 0;
          this.send(OP.EXT, EXT.LINE, LINE.CUT);
        } else this.cutArmed = performance.now();
      } else if (d.hang !== undefined) this.send(OP.EXT, EXT.SAY, 3);
      this.drawn = '';
    });
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  /** The next (or previous) cell to tip off. */
  private stepCell(by: number) {
    if (!this.cells.length) return;
    const at = Math.max(0, this.cells.findIndex(([c]) => c === this.pick.cell));
    this.pick.cell = this.cells[(at + by + this.cells.length) % this.cells.length][0];
  }

  /** A phrase said by its number (1–3 on the keyboard): sent if Lou's line is up. */
  say(k: number) {
    if (this.el.dataset.phase !== 'lou' || this.el.classList.contains('hidden')) return false;
    this.click();
    this.send(OP.EXT, EXT.SAY, k);
    return true;
  }

  update(v: PayphoneView | null) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      this.pick.menu = 'main';
      return false;
    }
    if (!this.cells.some(([c]) => c === this.pick.cell) && this.cells.length) this.pick.cell = this.cells[0][0];
    const armed = this.cutArmed > 0 && performance.now() - this.cutArmed < 4000;
    const key = [v.phase, v.closed, v.hint, v.second, v.cash, v.on, v.walking, v.waiting.join(), v.place, v.turnLeft >= 0, v.canJoin, v.canCut, v.rows.map((r) => r.id + r.why + r.note + r.price).join(), v.mail, v.calling, v.line, v.ear, v.phrases.join(), v.known.join(), v.result, this.pick.menu, this.pick.hour, this.pick.cell, armed, currentLang(), TOUCH].join('|');
    if (key !== this.drawn) {
      this.drawn = key;
      this.el.dataset.phase = v.phase;
      setText(this.title, t('phone.title'));
      setText(this.value, t('phone.price', { n: v.cash }));
      // The queue: who's on it, who waits.
      const q: string[] = [];
      if (v.on) q.push(`<p class="phone-on">${icon('phone', 14)}<span>${esc(t(v.walking ? 'phone.walking' : 'phone.onIt', { name: v.on }))}</span></p>`);
      if (v.waiting.length) q.push(`<ol class="phone-line">${v.waiting.map((n, k) => `<li class="${k === v.place ? 'me' : ''}">${esc(n)}</li>`).join('')}</ol>`);
      this.queue.innerHTML = v.phase === 'call' || v.phase === 'lou' || v.phase === 'result' ? '' : q.join('');
      this.body.innerHTML = this.bodyHtml(v);
      // The notes: a turn, a place, the mail; Lou's how-to.
      const note =
        v.phase === 'lou'
          ? t(TOUCH ? 'phone.pickTouch' : 'phone.pickKeys')
          : v.phase === 'result' || v.phase === 'call'
            ? ''
            : v.closed
              ? v.closed
              : v.place > 0
                ? [t('phone.place', { n: v.place + 1 }), v.hint].filter(Boolean).join(' · ')
                : v.turnLeft >= 0
                  ? t('phone.yourTurn')
                  : v.place === 0
                    ? t('phone.next')
                    : v.mail;
      setText(this.note, note);
      this.actions.innerHTML = this.actionsHtml(v, armed);
    }
    const left = v.phase === 'lou' || v.phase === 'call' ? (v.phase === 'call' ? 1 - v.progress : v.progress) : v.turnLeft;
    (this.bar.firstElementChild as HTMLElement).style.width = `${(Math.max(0, Math.min(1, left)) * 100).toFixed(1)}%`;
    this.bar.classList.toggle('hidden', !(v.phase === 'lou' || v.phase === 'call' || v.turnLeft >= 0));
    this.bar.setAttribute('aria-label', t('phone.leftAria', { n: Math.ceil(v.secs) }));
    return true;
  }

  private bodyHtml(v: PayphoneView): string {
    if (v.phase === 'result') return `<p class="phone-result ${v.good ? 'good' : 'bad'}">${esc(v.result)}</p>`;
    if (v.phase === 'call') return `<p class="phone-calling">${icon('phone', 16)}<span>${esc(v.calling)}</span></p>`;
    if (v.phase === 'lou') {
      const names = [t('phone.lines.what'), v.second, t('phone.lines.when')];
      return `<p class="phone-ear">${icon('ear', 14)}<span>${esc(v.ear)}</span></p>
        <p class="phone-step"><b>${esc(t('phone.line', { n: v.line + 1 }))}</b> · ${esc(names[v.line] ?? '')}</p>
        <div class="phone-says">${v.phrases
          .map((p, k) => `<button class="phone-say${v.known[k] ? ' known' : ''}" data-say="${k}">${TOUCH ? '' : `<kbd>${k + 1}</kbd>`}<span>${esc(p)}</span>${v.known[k] ? `<i class="phone-known" title="${esc(t('phone.known'))}">${icon('star', 12)}</i>` : ''}</button>`)
          .join('')}</div>`;
    }
    if (v.phase === 'queue' || v.closed) return '';
    // The dial: the main menu, or one caller's options.
    const row = (r: DialRow) => {
      const label = t(`phone.${r.id === 'home' || r.id === 'tip' ? r.id : r.id === 'appeal' || r.id === 'retainer' || r.id === 'parole' ? r.id : `job.${r.id}`}` as never);
      return `<button class="phone-row" data-call="${r.b}" data-arg="${r.c}" ${r.why ? 'disabled' : ''}><span><b>${esc(label)}</b><small>${esc(r.why || r.note)}</small></span><em>${esc(r.price)}</em></button>`;
    };
    const rows = (ids: DialRow['id'][]) => v.rows.filter((r) => ids.includes(r.id)).map(row).join('');
    const back = `<button class="phone-back" data-menu="main">${icon('chevronLeft', 14)}<span>${esc(t('phone.back'))}</span></button>`;
    switch (this.pick.menu) {
      case 'lawyer':
        return `${back}${rows(['appeal', 'retainer', 'parole'])}`;
      case 'cousin': {
        const hour = `<div class="phone-pick"><button data-hour="-1" aria-label="${esc(t('phone.earlier'))}">${icon('chevronLeft', 14)}</button><span>${esc(t('phone.at', { hour: `${pad2(this.pick.hour)}:00` }))}</span><button data-hour="1" aria-label="${esc(t('phone.later'))}">${icon('chevronRight', 14)}</button></div>`;
        return `${back}${hour}${rows(['diversion'])}${rows(['cake', 'car'])}`;
      }
      case 'tip': {
        const name = this.cells.find(([c]) => c === this.pick.cell)?.[1] ?? '';
        const cell = `<div class="phone-pick"><button data-cell="-1" aria-label="${esc(t('phone.prevCell'))}">${icon('chevronLeft', 14)}</button><span>${esc(t('phone.cellOf', { n: this.pick.cell, name }))}</span><button data-cell="1" aria-label="${esc(t('phone.nextCell'))}">${icon('chevronRight', 14)}</button></div>`;
        return `${back}${cell}${rows(['tip'])}`;
      }
      default: {
        const menu = (id: 'lawyer' | 'cousin' | 'tip', ic: string) => `<button class="phone-row" data-menu="${id}"><span><b>${esc(t(`phone.${id}`))}</b><small>${esc(t(`phone.${id}.d`))}</small></span><em>${icon(ic, 14)}</em></button>`;
        return `${rows(['home'])}${menu('lawyer', 'briefcase')}${menu('cousin', 'route')}${menu('tip', 'ear')}`;
      }
    }
  }

  private actionsHtml(v: PayphoneView, armed: boolean): string {
    if (v.phase === 'call' || v.phase === 'lou') return `<button class="big-btn ghost small" data-hang>${icon('close', 16)}<span>${esc(t('phone.hangUp'))}</span></button>`;
    const out: string[] = [];
    if (v.canJoin) out.push(`<button class="big-btn primary small" data-line="join">${icon('users', 16)}<span>${esc(t('phone.join'))}</span></button>`);
    if (v.place >= 0) out.push(`<button class="big-btn ghost small" data-line="leave">${icon('close', 16)}<span>${esc(t('phone.leave'))}</span></button>`);
    if (v.canCut) out.push(`<button class="big-btn ghost small${armed ? ' armed' : ''}" data-line="cut">${icon('bolt', 16)}<span>${esc(t(armed ? 'phone.cutSure' : 'phone.cut'))}</span></button>`);
    return out.join('');
  }
}

/** What each dial row sends (EXT.CALL's b). */
export const DIAL_B = {
  home: CALLEE.HOME * 16,
  appeal: CALLEE.LAWYER * 16 + LAWYER.APPEAL,
  retainer: CALLEE.LAWYER * 16 + LAWYER.RETAINER,
  parole: CALLEE.LAWYER * 16 + LAWYER.PAROLE,
  diversion: CALLEE.COUSIN * 16 + JOB.DIVERSION,
  cake: CALLEE.COUSIN * 16 + JOB.CAKE,
  car: CALLEE.COUSIN * 16 + JOB.CAR,
  tip: CALLEE.TIP * 16,
} as const;
