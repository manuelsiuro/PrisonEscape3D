import { currentLang, t } from '../i18n';
import { EXT, OP } from '../sim/command';
import { h, setText, TOUCH } from './dom';
import { icon } from './icons';

type Send = (op: number, a?: number, b?: number, c?: number) => void;

/**
 * The parole board's card (P39): at the release desk, how the application stands, the record's
 * lines for and against and Apply; before the board, the member asking, the question, what the
 * file says on it, three answers (1–3) and the time; the member's word on each; the verdict and
 * the two lines that weighed most. Drawn from a view the play layer fills from the sim
 * (play/parole.ts).
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface ParoleView {
  /** 'desk' at the release desk, 'sat' sitting down before the board, 'ask' a question put, 'weigh' its answer weighed, 'verdict' the board's word a moment. */
  phase: 'desk' | 'sat' | 'ask' | 'weigh' | 'verdict';
  title: string;
  /** How it stands (the hearing's day, granted, denied…), and its tone. */
  status: string;
  statusTone: 'ok' | 'bad' | 'job' | 'quiet';
  /** The record's lines (for, against), the score so far ('' not shown). */
  lines: ReadonlyArray<{ text: string; pts: string; tone: 'good' | 'bad' | 'quiet' }>;
  score: string;
  /** Apply: whether it would go, why not (words), its label. */
  canApply: boolean;
  why: string;
  apply: string;
  /** The member asking (name, place 0–2), the question (its place), its words, what the file says on it, the three answers, the answer said (-1 none, -2 silence). */
  member: string;
  memberK: number;
  q: number;
  question: string;
  file: string;
  answers: string[];
  said: number;
  /** The member's word on the answer, and whether it went down well. */
  react: string;
  reactGood: boolean;
  /** The time left to answer (0–1), in seconds. */
  left: number;
  secs: number;
  /** The verdict's words, granted or not, and the lines that weighed most. */
  verdict: string;
  verdictGood: boolean;
  weighed: string[];
  note: string;
}

/** The board's three, by place: their faces' colours on the card. */
const MEMBER_COLOR = ['#8a6bd1', '#3d9fb0', '#c2853a'];

export class ParoleCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly value: HTMLElement;
  private readonly body: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly note: HTMLElement;
  private readonly apply: HTMLButtonElement;
  private drawn = '';

  constructor(
    private readonly send: Send,
    private readonly click: () => void,
  ) {
    this.el = h(
      'div',
      'train-card parole-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('scale', 18)}</i><b></b><span class="train-value"></span></div>
      <div class="parole-body"></div>
      <i class="match-clock parole-bar" role="timer"><i></i></i>
      <p class="train-note"></p>
      <button class="big-btn primary small parole-apply">${icon('clipboard', 18)}<span></span></button>`,
    );
    this.title = this.el.querySelector('.train-head b')!;
    this.value = this.el.querySelector('.train-value')!;
    this.body = this.el.querySelector('.parole-body')!;
    this.bar = this.el.querySelector('.parole-bar')!;
    this.note = this.el.querySelector('.train-note')!;
    this.apply = this.el.querySelector('.parole-apply')!;
    // An answer on the press (as the quiz's: the buttons are redrawn as the card moves on); from the keyboard, on Enter or Space.
    const answer = (c: HTMLButtonElement | null) => {
      if (!c || c.disabled) return false;
      this.click();
      this.flash(Number(c.dataset.answer));
      this.send(OP.EXT, EXT.PAROLE, 1, Number(c.dataset.answer));
      return true;
    };
    this.el.addEventListener('pointerdown', (e) => {
      if (answer((e.target as HTMLElement).closest<HTMLButtonElement>('[data-answer]'))) e.preventDefault();
    });
    this.el.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const c = el.closest<HTMLButtonElement>('[data-answer]');
      if (c) {
        if ((e as MouseEvent).detail === 0) answer(c);
        return;
      }
      if (el.closest('.parole-apply') && !this.apply.disabled) {
        this.click();
        this.send(OP.EXT, EXT.PAROLE, 0);
      }
    });
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  /** The answer just given (a key or a press), marked at once while the sim weighs it. */
  private picked = -1;
  flash(k: number) {
    this.picked = k;
    this.drawn = '';
  }

  update(v: ParoleView | null) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      this.picked = -1;
      return false;
    }
    if (v.phase !== 'ask') this.picked = -1;
    const key = [v.phase, v.status, v.lines.map((l) => l.text + l.pts).join(), v.score, v.canApply, v.why, v.q, v.question, v.file, v.said, v.react, v.verdict, v.weighed.join(), this.picked, currentLang(), TOUCH].join('|');
    if (key !== this.drawn) {
      this.drawn = key;
      this.el.dataset.phase = v.phase;
      setText(this.title, v.title);
      const asking = v.phase === 'ask' || v.phase === 'weigh';
      setText(this.value, asking ? t('parole.qOf', { n: v.q + 1, of: 3 }) : v.phase === 'verdict' || v.phase === 'desk' ? v.score : '');
      this.body.innerHTML = this.bodyHtml(v);
      setText(this.apply.querySelector('span')!, v.apply);
      this.apply.classList.toggle('hidden', v.phase !== 'desk' || (!v.canApply && !v.why));
      this.apply.disabled = !v.canApply;
    }
    setText(this.note, v.phase === 'desk' && v.why ? v.why : v.note);
    (this.bar.firstElementChild as HTMLElement).style.width = `${(Math.max(0, Math.min(1, v.left)) * 100).toFixed(1)}%`;
    this.bar.classList.toggle('hidden', v.phase !== 'ask');
    this.bar.setAttribute('aria-label', t('parole.leftAria', { n: v.secs }));
    return true;
  }

  private bodyHtml(v: ParoleView): string {
    const status = v.status ? `<p class="parole-status ${v.statusTone}">${esc(v.status)}</p>` : '';
    const lines = v.lines.length ? `<ul class="parole-lines">${v.lines.map((l) => `<li class="${l.tone}"><span>${esc(l.text)}</span><b>${esc(l.pts)}</b></li>`).join('')}</ul>` : '';
    const weighed = v.weighed.length ? `<ul class="parole-weighed">${v.weighed.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
    if (v.phase === 'desk') return `${status}${weighed}${lines}`;
    if (v.phase === 'verdict') return `<p class="parole-verdict ${v.verdictGood ? 'good' : 'bad'}">${icon(v.verdictGood ? 'check' : 'close', 18)}<span>${esc(v.verdict)}</span></p>${status}${weighed}`;
    const board = `<ol class="parole-board">${[0, 1, 2].map((k) => `<li class="${k === v.memberK && v.phase !== 'sat' ? 'on' : ''}" style="--member:${MEMBER_COLOR[k]}"><i>${icon('person', 14)}</i></li>`).join('')}${v.phase !== 'sat' ? `<li class="who">${esc(v.member)}</li>` : ''}</ol>`;
    if (v.phase === 'sat') return `${status}${board}`;
    const said = v.said >= 0 ? v.said : this.picked;
    const answers = v.answers
      .map((a, k) => {
        const cls = ['parole-answer', said === k ? 'mine' : '', v.phase === 'weigh' && said === k ? (v.reactGood ? 'good' : 'bad') : ''].join(' ');
        const off = v.phase === 'weigh' || said >= 0;
        return `<button class="${cls}" data-answer="${k}" ${off ? 'disabled' : ''}><kbd>${k + 1}</kbd><span>${esc(a)}</span></button>`;
      })
      .join('');
    const react = v.phase === 'weigh' && v.react ? `<p class="parole-react ${v.reactGood ? 'good' : 'bad'}">${esc(v.react)}</p>` : '';
    return `${board}<p class="parole-q" role="status">${esc(v.question)}</p><p class="parole-file">${icon('clipboard', 12)}<span>${esc(v.file)}</span></p><div class="parole-answers">${answers}</div>${react}`;
  }
}
