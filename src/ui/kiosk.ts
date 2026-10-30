import { currentLang, t } from '../i18n';
import { APPS, COURSE_QUESTIONS, KIOSK } from '../content/kiosk';
import { EXT, OP } from '../sim/command';
import { esc, h, type Send, setText, TOUCH } from './dom';
import { icon } from './icons';


/**
 * The internet kiosk (P35) on screen: its card at the terminal. Logged out, what it costs and Log
 * in; logged in, the time left on the block paid for and the bill, and four apps in tabs: Mail
 * (a letter home, what's coming, the drawings on the wall), Shop (legal goods, each with its
 * price and why not), News (the days ahead, the next delivery and visiting day, the run's
 * headlines) and Courses (five questions: 1–4 answer). Drawn from a view the play layer fills
 * from the sim (play/kiosk.ts): the sim's own functions decide everything shown.
 */


export type App = (typeof APPS)[number];

/** A day the news forecasts. */
interface NewsDay {
  name: string;
  event: string;
  weather: string;
  wind: string;
}

/** The kiosk as its card shows it. */
export interface KioskView {
  /** 'off' logged out at it, 'on' logged in. */
  phase: 'off' | 'on';
  cash: number;
  /** Why it's shut now ('' open), why logging in is refused ('' it isn't); the price of a block. */
  closed: string;
  loginWhy: string;
  /** The block paid for: how much is left (0–1), in seconds; the dollars spent since logging in. */
  left: number;
  secs: number;
  spent: number;
  /** Mail: why no letter now ('' one can be written), what a letter does, what's on its way, the drawings on the wall. */
  mailWhy: string;
  mailNote: string;
  coming: string[];
  photos: string[];
  /** Shop: its rows, the order on its way ('' none). */
  shop: Array<{ k: number; name: string; price: string; why: string }>;
  ordered: string;
  /** News: the days ahead, the next delivery and visiting day, headlines. */
  days: NewsDay[];
  next: string[];
  headlines: string[];
  /** Courses: offered (why not), a question asked or its answer shown, or how it ended (a moment). */
  course: 'offer' | 'ask' | 'reveal' | 'result';
  courseWhy: string;
  q: number;
  right: number;
  question: string;
  choices: string[];
  answer: number;
  said: number;
  result: string;
  good: boolean;
}

/** The kiosk's card. */
export class KioskCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly value: HTMLElement;
  private readonly bill: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly body: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly note: HTMLElement;
  private readonly actions: HTMLElement;
  private drawn = '';
  /** The app open (UI only). */
  app: App = 'mail';

  constructor(
    private readonly send: Send,
    private readonly click: () => void,
  ) {
    this.el = h(
      'div',
      'train-card kiosk-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('monitor', 18)}</i><b></b><span class="train-value"></span></div>
      <p class="kiosk-bill"></p>
      <i class="match-clock kiosk-bar" role="timer"><i></i></i>
      <div class="kiosk-tabs" role="tablist"></div>
      <div class="kiosk-body" role="tabpanel"></div>
      <p class="train-note"></p>
      <div class="kiosk-actions"></div>`,
    );
    this.title = this.el.querySelector('.train-head b')!;
    this.value = this.el.querySelector('.train-value')!;
    this.bill = this.el.querySelector('.kiosk-bill')!;
    this.bar = this.el.querySelector('.kiosk-bar')!;
    this.tabs = this.el.querySelector('.kiosk-tabs')!;
    this.body = this.el.querySelector('.kiosk-body')!;
    this.note = this.el.querySelector('.train-note')!;
    this.actions = this.el.querySelector('.kiosk-actions')!;
    // An answer on the press (as the quiz's: the card is redrawn as time runs); from the keyboard, on Enter or Space.
    const answer = (c: HTMLButtonElement | null) => {
      if (!c || c.disabled) return false;
      this.click();
      this.send(OP.EXT, EXT.KIOSK, KIOSK.ANSWER, Number(c.dataset.choice));
      return true;
    };
    this.el.addEventListener('pointerdown', (e) => {
      if (answer((e.target as HTMLElement).closest<HTMLButtonElement>('[data-choice]'))) e.preventDefault();
    });
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!b || b.disabled) return;
      const d = b.dataset;
      if (d.choice !== undefined) {
        if ((e as MouseEvent).detail === 0) answer(b);
        return;
      }
      this.click();
      if (d.app) this.app = d.app as App;
      else if (d.op !== undefined) this.send(OP.EXT, EXT.KIOSK, Number(d.op), Number(d.arg ?? 0));
      this.drawn = '';
    });
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  /** An answer by its number (1–4 on the keyboard): sent if a question is up. */
  choose(k: number) {
    if (this.el.classList.contains('hidden') || this.el.dataset.course !== 'ask') return false;
    const b = this.body.querySelector<HTMLButtonElement>(`[data-choice="${k}"]`);
    if (!b || b.disabled) return false;
    this.click();
    this.send(OP.EXT, EXT.KIOSK, KIOSK.ANSWER, k);
    return true;
  }

  update(v: KioskView | null) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      this.app = 'mail';
      return false;
    }
    // (Logged out: Mail first, the next time.)
    if (v.phase === 'off') this.app = 'mail';
    // (A course under way, or just over: its tab, and nothing else.)
    const inCourse = v.phase === 'on' && v.course !== 'offer';
    if (inCourse) this.app = 'course';
    const key = [v.phase, v.closed, v.loginWhy, v.cash, v.spent, v.mailWhy, v.mailNote, v.coming.join(), v.photos.join(), v.shop.map((r) => r.name + r.price + r.why).join(), v.ordered, v.days.map((d) => d.name + d.event + d.weather + d.wind).join(), v.next.join(), v.headlines.join(), v.course, v.courseWhy, v.q, v.right, v.question, v.said, v.result, this.app, currentLang(), TOUCH].join('|');
    if (key !== this.drawn) {
      this.drawn = key;
      this.el.dataset.phase = v.phase;
      this.el.dataset.course = v.phase === 'on' ? v.course : '';
      setText(this.title, t('kiosk.title'));
      setText(this.value, t('phone.price', { n: v.cash }));
      setText(this.bill, v.phase === 'on' ? t('kiosk.bill', { n: v.spent }) : '');
      this.tabs.innerHTML =
        v.phase === 'on' && !inCourse
          ? APPS.map((a) => `<button role="tab" aria-selected="${a === this.app}" class="kiosk-tab${a === this.app ? ' on' : ''}" data-app="${a}">${icon(APP_ICON[a], 15)}<span>${esc(t(`kiosk.app.${a}`))}</span></button>`).join('')
          : '';
      this.body.innerHTML = v.phase === 'on' ? this.appHtml(v) : v.closed ? '' : `<p class="kiosk-intro">${esc(t('kiosk.intro'))}</p>`;
      setText(this.note, v.phase === 'off' ? v.closed || v.loginWhy : this.app !== 'course' ? '' : v.course === 'ask' ? t(TOUCH ? 'kiosk.course.askTouch' : 'kiosk.course.askKeys') : v.course === 'reveal' && v.said === -2 ? t('kiosk.course.tooSlow') : '');
      this.actions.innerHTML =
        v.phase === 'off'
          ? v.closed
            ? ''
            : `<button class="big-btn primary small" data-op="${KIOSK.LOGIN}" ${v.loginWhy ? 'disabled' : ''}>${icon('monitor', 16)}<span>${esc(t('kiosk.login'))}</span></button>`
          : `${inCourse && v.course !== 'result' ? `<button class="big-btn ghost small" data-op="${KIOSK.QUIT}">${icon('close', 16)}<span>${esc(t('kiosk.course.quit'))}</span></button>` : ''}<button class="big-btn ghost small" data-op="${KIOSK.LOGOUT}">${icon('close', 16)}<span>${esc(t('kiosk.logout'))}</span></button>`;
    }
    (this.bar.firstElementChild as HTMLElement).style.width = `${(Math.max(0, Math.min(1, v.left)) * 100).toFixed(1)}%`;
    this.bar.classList.toggle('hidden', v.phase !== 'on');
    this.bar.setAttribute('aria-label', t('kiosk.leftAria', { n: Math.ceil(v.secs) }));
    return true;
  }

  private appHtml(v: KioskView): string {
    switch (this.app) {
      case 'mail': {
        const write = `<button class="phone-row" data-op="${KIOSK.WRITE}" ${v.mailWhy ? 'disabled' : ''}><span><b>${esc(t('kiosk.write'))}</b><small>${esc(v.mailWhy || v.mailNote)}</small></span><em>${icon('letter', 14)}</em></button>`;
        const coming = v.coming.map((c) => `<li>${esc(c)}</li>`).join('');
        const wall = v.photos.length ? `<p class="kiosk-sub">${esc(t('kiosk.wall'))}</p><ul class="kiosk-list">${v.photos.map((p) => `<li>${icon('picture', 13)}<span>${esc(p)}</span></li>`).join('')}</ul>` : '';
        return `${write}${coming ? `<ul class="kiosk-list">${coming}</ul>` : ''}${wall}`;
      }
      case 'shop': {
        const rows = v.shop.map((r) => `<button class="phone-row kiosk-item" data-op="${KIOSK.ORDER}" data-arg="${r.k}" ${r.why ? 'disabled' : ''}><span><b>${esc(r.name)}</b>${r.why ? `<small>${esc(r.why)}</small>` : ''}</span><em>${esc(r.price)}</em></button>`).join('');
        return `<p class="kiosk-sub">${esc(v.ordered || t('kiosk.shop.note'))}</p><div class="kiosk-shop">${rows}</div>`;
      }
      case 'news': {
        const days = v.days.map((d) => `<li><b>${esc(d.name)}</b><span>${esc(d.event)}</span><small>${esc(`${d.weather} · ${d.wind}`)}</small></li>`).join('');
        const lines = v.headlines.map((l) => `<li>${icon('news', 13)}<span>${esc(l)}</span></li>`).join('');
        return `<ul class="kiosk-days">${days}</ul>${v.next.map((n) => `<p class="kiosk-sub">${esc(n)}</p>`).join('')}${lines ? `<ul class="kiosk-list kiosk-heads">${lines}</ul>` : ''}`;
      }
      case 'course': {
        if (v.course === 'offer') return `<button class="phone-row" data-op="${KIOSK.COURSE}" ${v.courseWhy ? 'disabled' : ''}><span><b>${esc(t('kiosk.course.take'))}</b><small>${esc(v.courseWhy || t('kiosk.course.d'))}</small></span><em>${icon('brain', 14)}</em></button>`;
        if (v.course === 'result') return `<p class="phone-result ${v.good ? 'good' : 'bad'}">${esc(v.result)}</p>`;
        const head = `<p class="phone-step"><b>${esc(t('kiosk.course.of', { n: v.q + 1, of: COURSE_QUESTIONS }))}</b> · ${esc(t('kiosk.course.right', { n: v.right }))}</p>`;
        const choices = v.choices
          .map((c, k) => {
            const right = v.course === 'reveal' && k === v.answer;
            const mine = v.said === k;
            const cls = ['quiz-choice', right ? 'right' : '', mine && !right ? 'wrong' : '', mine ? 'mine' : ''].join(' ');
            return `<button class="${cls}" data-choice="${k}" ${v.course === 'reveal' ? 'disabled' : ''}>${TOUCH ? '' : `<kbd>${k + 1}</kbd>`}<span>${esc(c)}</span></button>`;
          })
          .join('');
        return `${head}<p class="quiz-q">${esc(v.question)}</p><div class="quiz-choices">${choices}</div>`;
      }
    }
  }
}

const APP_ICON: Record<App, string> = { mail: 'letter', shop: 'cart', news: 'news', course: 'brain' };
