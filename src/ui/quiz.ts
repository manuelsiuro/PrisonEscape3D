/**
 * Quiz night (P30) on screen: Join; the question, its four answers, the time running down, the
 * contestants' points and buzzes; the winner. Drawn from a view the play layer fills from the
 * sim (play/nights.ts): the sim's own functions decide everything shown.
 */
import { QUIZ_QUESTIONS } from '../content/nights';
import { currentLang, t } from '../i18n';
import { EXT, OP } from '../sim/command';
import { esc, h, type Send, setText, TOUCH } from './dom';
import { icon } from './icons';

/** Quiz night as its card shows it. */
export interface QuizView {
  /** 'offer' at the table, 'gather' the contestants walking over, 'ask' a question put, 'reveal' its answer shown, 'result' the end a moment. */
  phase: 'offer' | 'gather' | 'ask' | 'reveal' | 'result';
  why: string;
  /** The four at the table (the player first: "You"), their points; what each said to this question (-1 nothing), who took it (-1 nobody). */
  names: string[];
  pts: number[];
  said: number[];
  got: number;
  /** The question (its place, 0–7), its text and answers, the right one (shown in the reveal), the time left (0–1: of the head start while it's read, then of the answering); the seconds left of it all. */
  q: number;
  question: string;
  choices: string[];
  answer: number;
  left: number;
  secs: number;
  /** While it's read, before the others' buzzers open: the seconds of that head start left (0: open). */
  reading: number;
  /** The end: won, a tie, lost; the prize and the Intellect. */
  end: 'won' | 'tie' | 'lost' | '';
  prize: number;
  int: number;
}

/** The quiz night's card (P30): Join; the question, the answers (1–4), the points; Give up. */
export class QuizCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly value: HTMLElement;
  private readonly board: HTMLElement;
  private readonly question: HTMLElement;
  private readonly choices: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly note: HTMLElement;
  private readonly join: HTMLButtonElement;
  private readonly quit: HTMLButtonElement;
  private drawn = '';

  constructor(
    private readonly send: Send,
    private readonly click: () => void,
  ) {
    this.el = h(
      'div',
      'train-card quiz-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('brain', 18)}</i><b></b><span class="train-value"></span></div>
      <ol class="quiz-board"></ol>
      <p class="quiz-q" role="status"></p>
      <div class="quiz-choices"></div>
      <i class="match-clock quiz-bar" role="timer"><i></i></i>
      <p class="train-note"></p>
      <button class="big-btn primary small quiz-join">${icon('brain', 18)}<span></span></button>
      <button class="big-btn ghost small quiz-quit">${icon('close', 16)}<span></span></button>`,
    );
    this.title = this.el.querySelector('.train-head b')!;
    this.value = this.el.querySelector('.train-value')!;
    this.board = this.el.querySelector('.quiz-board')!;
    this.question = this.el.querySelector('.quiz-q')!;
    this.choices = this.el.querySelector('.quiz-choices')!;
    this.bar = this.el.querySelector('.quiz-bar')!;
    this.note = this.el.querySelector('.train-note')!;
    this.join = this.el.querySelector('.quiz-join')!;
    this.quit = this.el.querySelector('.quiz-quit')!;
    // An answer on the press (the buttons are redrawn as others buzz: a click could miss them between down and up); from the keyboard, on Enter or Space.
    const answer = (c: HTMLButtonElement | null) => {
      if (!c || c.disabled) return false;
      this.click();
      this.send(OP.EXT, EXT.ANSWER, Number(c.dataset.choice));
      return true;
    };
    this.el.addEventListener('pointerdown', (e) => {
      if (answer((e.target as HTMLElement).closest<HTMLButtonElement>('[data-choice]'))) e.preventDefault();
    });
    this.el.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const c = el.closest<HTMLButtonElement>('[data-choice]');
      if (c) {
        if ((e as MouseEvent).detail === 0) answer(c);
        return;
      }
      if (el.closest('.quiz-join')) {
        this.click();
        this.send(OP.EXT, EXT.QUIZ, 0);
      } else if (el.closest('.quiz-quit')) {
        this.click();
        this.send(OP.EXT, EXT.QUIZ, 1);
      }
    });
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  update(v: QuizView | null) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      return false;
    }
    const key = [v.phase, v.why, v.names.join(), v.pts.join(), v.said.join(), v.got, v.q, v.question, v.end, currentLang(), TOUCH].join('|');
    if (key !== this.drawn) {
      this.drawn = key;
      this.el.dataset.phase = v.phase;
      setText(this.title, t('quiz.title'));
      const asking = v.phase === 'ask' || v.phase === 'reveal';
      setText(this.value, asking ? t('quiz.of', { n: v.q + 1, of: QUIZ_QUESTIONS }) : '');
      this.board.innerHTML =
        v.phase === 'offer'
          ? ''
          : v.names
              .map((n, k) => {
                const cls = [k === 0 ? 'me' : '', v.got === k ? 'got' : '', v.said[k] >= 0 && v.got !== k ? 'out' : ''].join(' ');
                return `<li class="${cls}"><span>${esc(n)}</span><b>${v.pts[k]}</b></li>`;
              })
              .join('');
      setText(this.question, asking ? v.question : '');
      this.choices.innerHTML = asking
        ? v.choices
            .map((c, k) => {
              const right = v.phase === 'reveal' && k === v.answer;
              const mine = v.said[0] === k;
              const theirs = v.said.slice(1).some((x, j) => x === k && v.got !== j + 1);
              const cls = ['quiz-choice', right ? 'right' : '', mine && !right ? 'wrong' : '', mine ? 'mine' : '', theirs && !right ? 'struck' : ''].join(' ');
              const off = v.phase === 'reveal' || v.said[0] >= 0;
              return `<button class="${cls}" data-choice="${k}" ${off ? 'disabled' : ''}><kbd>${k + 1}</kbd><span>${esc(c)}</span></button>`;
            })
            .join('')
        : '';

      setText(this.join.querySelector('span')!, t('quiz.join'));
      setText(this.quit.querySelector('span')!, t('quiz.quit'));
      this.join.classList.toggle('hidden', v.phase !== 'offer');
      this.join.disabled = !!v.why;
      this.quit.classList.toggle('hidden', v.phase === 'offer' || v.phase === 'result');
    }
    // (The note outside the redraw: the head start counts down each second, the answers left as they are.)
    const note =
      v.phase === 'offer'
        ? v.why || t('quiz.offer')
        : v.phase === 'gather'
          ? t('quiz.gather')
          : v.phase === 'reveal'
            ? v.got === 0
              ? t('quiz.gotYou')
              : v.got > 0
                ? t('quiz.gotThem', { name: v.names[v.got] })
                : t('quiz.nobody')
            : v.phase === 'ask'
              ? v.said[0] >= 0
                ? t('quiz.outYou')
                : v.reading
                  ? t('quiz.reading', { n: v.reading })
                  : t(TOUCH ? 'quiz.askTouch' : 'quiz.askKeys')
              : v.end === 'won'
                ? t('quiz.won', { n: v.prize, m: v.int })
                : v.end === 'tie'
                  ? t('quiz.tie', { n: v.prize, m: v.int })
                  : t('quiz.lost');
    setText(this.note, note);
    this.el.classList.toggle('reading', v.phase === 'ask' && v.reading > 0 && v.said[0] < 0);
    (this.bar.firstElementChild as HTMLElement).style.width = `${(Math.max(0, Math.min(1, v.left)) * 100).toFixed(1)}%`;
    this.bar.classList.toggle('hidden', v.phase !== 'ask');
    // (The head start in gold while the question is read, then the answering's own clock.)
    this.bar.classList.toggle('reading', v.reading > 0);
    this.bar.setAttribute('aria-label', t('quiz.leftAria', { n: v.secs }));
    return true;
  }
}
