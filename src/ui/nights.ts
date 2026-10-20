import { CHARTS, INSTRUMENT, QUIZ_QUESTIONS, SONGS } from '../content/nights';
import { currentLang, t, type Key } from '../i18n';
import { withKeys } from '../i18n/keys';
import { EXT, OP } from '../sim/command';
import { STAGE_QUIT } from '../sim/systems/talent';
import { arrowStep, h, setText, TOUCH } from './dom';
import { icon } from './icons';

type Send = (op: number, a?: number, b?: number, c?: number) => void;

/**
 * Stage nights (P30) on screen: talent night's card (the night's acts; the song and the
 * instrument picked, Perform; then the notes coming down three lanes to the line, the lanes'
 * pads, the mark so far; the verdict) and quiz night's (Join; the question, its four answers, the
 * time running down, the contestants' points and buzzes; the winner). Drawn from views the play
 * layer fills from the sim (play/nights.ts): the sim's own functions decide everything shown.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One of the night's acts, as the card lists it. */
export interface ActRow {
  name: string;
  inst: number;
  song: number;
  /** Its mark once it's played (-1 not yet), on the stage now. */
  mark: number;
  on: boolean;
  /** When it's on ("19:12"). */
  at: string;
}

/** Talent night as its card shows it. */
export interface StageView {
  /** 'offer' at the stage, 'play' the player's song (counted in, then played), 'result' the verdict a moment. */
  phase: 'offer' | 'play' | 'result';
  acts: ActRow[];
  /** The offer: why not now ('' they can), the player's turn ("19:34"), a guitar in the hotbar, each song's prize for first. */
  why: string;
  /** Played tonight already (the pick is put away). */
  played: boolean;
  turnAt: string;
  hasGuitar: boolean;
  prizes: number[];
  /** The song being played, where it is (steps into it, fractional; below 0 counted in), each note's judgement, the mark so far. */
  song: number;
  inst: number;
  t: number;
  hits: readonly number[];
  mark: number;
  /** The last judgement (0 none, 1 missed, 2 good, 3 perfect, 4 a stray press) and when (ms), for its flash. */
  judged: number;
  judgedAt: number;
  /** The verdict: the place (0 first) of how many acts, the prize, the crowd won over, the heat let go. */
  place: number;
  of: number;
  prize: number;
  crowd: number;
  heat: number;
}

/** The lanes: their colours and shapes (a circle, a diamond, a square: never told apart by colour alone). */
const LANE_COLOR = ['#ff7a6b', '#ffd166', '#5fd3c8'];
/** How far ahead the lanes show (steps). */
const LOOK = 36;

/** The talent night's card (P30): the acts, the pick, the lanes and pads, the verdict. */
export class StageCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly value: HTMLElement;
  private readonly acts: HTMLElement;
  private readonly songs: HTMLElement;
  private readonly insts: HTMLElement;
  private readonly go: HTMLButtonElement;
  private readonly lanes: HTMLCanvasElement;
  private readonly pads: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly judge: HTMLElement;
  private readonly note: HTMLElement;
  private drawn = '';
  private pickDrawn = '';
  /** The song and the instrument picked. */
  private song = 0;
  private inst: number = INSTRUMENT.DRUMS;
  private judgedShown = 0;
  private counting = false;
  /** An arrow key moved a pick: its checked radio takes the focus back once redrawn. */
  private refocus: HTMLElement | null = null;
  /** A lane's pad pressed (the play layer sends it), lit a moment. */
  onLane: (lane: number) => void = () => {};
  private lit = [0, 0, 0];

  constructor(
    private readonly send: Send,
    private readonly click: () => void,
  ) {
    this.el = h(
      'div',
      'train-card stage-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('music', 18)}</i><b></b><span class="train-value"></span></div>
      <ol class="stage-acts"></ol>
      <div class="stage-pick">
        <div class="stage-songs" role="radiogroup"></div>
        <div class="seg stage-insts" role="radiogroup"></div>
        <button class="big-btn primary small stage-go">${icon('music', 18)}<span></span></button>
      </div>
      <div class="stage-play" aria-hidden="true"><canvas class="stage-lanes"></canvas><b class="stage-judge"></b></div>
      <div class="stage-pads">${[0, 1, 2].map((k) => `<button class="pick-pad stage-pad" data-lane="${k}" style="--lane:${LANE_COLOR[k]}"><i class="lane-shape s${k}"></i><kbd></kbd></button>`).join('')}</div>
      <i class="match-clock stage-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></i>
      <p class="train-note"></p>
      <button class="big-btn ghost small stage-quit">${icon('close', 16)}<span></span></button>`,
    );
    this.title = this.el.querySelector('.train-head b')!;
    this.value = this.el.querySelector('.train-value')!;
    this.acts = this.el.querySelector('.stage-acts')!;
    this.songs = this.el.querySelector('.stage-songs')!;
    this.insts = this.el.querySelector('.stage-insts')!;
    this.go = this.el.querySelector('.stage-go')!;
    this.lanes = this.el.querySelector('.stage-lanes')!;
    this.pads = this.el.querySelector('.stage-pads')!;
    this.bar = this.el.querySelector('.stage-bar')!;
    this.judge = this.el.querySelector('.stage-judge')!;
    this.note = this.el.querySelector('.train-note')!;
    this.el.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const song = el.closest<HTMLElement>('[data-song]');
      if (song) {
        this.click();
        this.song = Number(song.dataset.song);
        this.pickDrawn = '';
        return;
      }
      const inst = el.closest<HTMLElement>('[data-inst]');
      if (inst && !(inst as HTMLButtonElement).disabled) {
        this.click();
        this.inst = Number(inst.dataset.inst);
        this.pickDrawn = '';
        return;
      }
      if (el.closest('.stage-quit')) {
        this.click();
        this.send(OP.EXT, EXT.STAGE, STAGE_QUIT);
        return;
      }
      if (el.closest('.stage-go')) {
        this.click();
        this.send(OP.EXT, EXT.STAGE, this.song, this.inst);
      }
    });
    // The pads: on the press, not the click (a rhythm wants the moment the finger lands).
    this.pads.addEventListener('pointerdown', (e) => {
      const pad = (e.target as HTMLElement).closest<HTMLElement>('[data-lane]');
      if (!pad) return;
      e.preventDefault();
      this.onLane(Number(pad.dataset.lane));
    });
    this.pads.addEventListener('contextmenu', (e) => e.preventDefault());
    // The song and the instrument as radio groups: arrow keys move the choice (and the focus) along them.
    this.songs.addEventListener('keydown', (e) => {
      const d = arrowStep(e);
      if (!d) return;
      this.song = (this.song + d + SONGS.length) % SONGS.length;
      this.pickDrawn = '';
      this.refocus = this.songs;
    });
    this.insts.addEventListener('keydown', (e) => {
      const d = arrowStep(e);
      if (!d) return;
      const on = [...this.insts.querySelectorAll<HTMLButtonElement>('[data-inst]')].filter((b) => !b.disabled).map((b) => Number(b.dataset.inst));
      const k = on.indexOf(this.inst);
      this.inst = on[(k + d + on.length) % on.length] ?? this.inst;
      this.pickDrawn = '';
      this.refocus = this.insts;
    });
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  /** A lane played (from the keys or a pad): its pad lit a moment. */
  flash(lane: number) {
    this.lit[lane] = performance.now();
  }

  update(v: StageView | null) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      return false;
    }
    const lang = currentLang();
    const key = [v.phase, v.why, v.turnAt, v.acts.map((a) => `${a.name}${a.mark}${a.on}`).join(), v.song, v.inst, v.place, v.prize, v.crowd, v.heat, lang, TOUCH].join('|');
    if (key !== this.drawn) {
      this.drawn = key;
      this.pickDrawn = '';
      this.el.dataset.phase = v.phase;
      this.el.classList.toggle('played', v.played);
      setText(this.title, t('stage.title'));
      this.acts.innerHTML = v.acts
        .map((a) => {
          const state = a.mark >= 0 ? `<b>${a.mark}%</b>` : a.on ? `<em>${t('stage.onNow')}</em>` : `<span>${a.at}</span>`;
          return `<li class="${a.on ? 'on' : ''}">${icon(a.inst === INSTRUMENT.GUITAR ? 'guitar' : 'drum', 14)}<span class="stage-who">${esc(a.name)}</span><span class="stage-song">${t(`song.${SONGS[a.song].id}` as Key)}</span>${state}</li>`;
        })
        .join('');
      for (const b of this.pads.querySelectorAll('kbd')) b.textContent = TOUCH ? '' : withKeys(['← %KeyA%', '↓ %KeyS%', '→ %KeyD%'][Number((b.parentElement as HTMLElement).dataset.lane)]);
      this.pads.querySelectorAll<HTMLElement>('[data-lane]').forEach((p, k) => p.setAttribute('aria-label', t('stage.laneAria', { n: k + 1 })));
      if (v.phase === 'offer') setText(this.note, v.why || t('stage.pickNote'));
      else if (v.phase === 'play') setText(this.note, t(TOUCH ? 'stage.playTouch' : 'stage.playKeys'));
      else setText(this.note, this.verdict(v));
      setText(this.go.querySelector('span')!, t('stage.go'));
      setText(this.el.querySelector('.stage-quit span')!, t('stage.quit'));
      this.go.disabled = !!v.why;
    }
    // The pick (redrawn as it changes, the song's prize with it).
    if (v.phase === 'offer') {
      if (this.inst === INSTRUMENT.GUITAR && !v.hasGuitar) this.inst = INSTRUMENT.DRUMS;
      const pk = [this.song, this.inst, v.hasGuitar, v.prizes.join(), lang].join('|');
      if (pk !== this.pickDrawn) {
        this.pickDrawn = pk;
        this.songs.innerHTML = SONGS.map(
          (s, k) =>
            `<button role="radio" data-song="${k}" class="stage-song-btn${k === this.song ? ' on' : ''}" aria-checked="${k === this.song}" tabindex="${k === this.song ? 0 : -1}"><b>${t(`song.${s.id}` as Key)}</b><span>${'★'.repeat(s.level)}${'☆'.repeat(3 - s.level)} · ${t('stage.firstPrize', { n: v.prizes[k] })}</span></button>`,
        ).join('');
        this.insts.innerHTML = [INSTRUMENT.DRUMS, INSTRUMENT.GUITAR]
          .map((k) => `<button role="radio" data-inst="${k}" class="${k === this.inst ? 'on' : ''}" aria-checked="${k === this.inst}" tabindex="${k === this.inst ? 0 : -1}" ${k === INSTRUMENT.GUITAR && !v.hasGuitar ? 'disabled' : ''}>${icon(k === INSTRUMENT.GUITAR ? 'guitar' : 'drum', 15)}${t(k === INSTRUMENT.GUITAR ? 'stage.guitar' : 'stage.drums')}</button>`)
          .join('');
        this.songs.setAttribute('aria-label', t('stage.songsAria'));
        this.insts.setAttribute('aria-label', t('stage.instsAria'));
        // (Moved by an arrow key: the new choice keeps the focus.)
        this.refocus?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
        this.refocus = null;
      }
      setText(this.value, '');
    } else if (v.phase === 'play') {
      setText(this.value, `${v.mark}%`);
      this.draw(v);
      const n = CHARTS[v.song].length;
      const done = v.hits.filter((x) => x > 0).length;
      (this.bar.firstElementChild as HTMLElement).style.width = `${((done / n) * 100).toFixed(1)}%`;
      this.bar.setAttribute('aria-valuenow', String(Math.round((done / n) * 100)));
      this.bar.setAttribute('aria-label', t('stage.markAria', { n: v.mark }));
      if (v.judgedAt !== this.judgedShown && v.judged) {
        this.judgedShown = v.judgedAt;
        this.judge.textContent = v.judged === 3 ? t('stage.perfect') : v.judged === 2 ? t('stage.good') : t('stage.miss');
        this.judge.dataset.grade = String(v.judged);
        this.judge.classList.remove('pop');
        void this.judge.offsetWidth;
        this.judge.classList.add('pop');
      }
      // The count-in: 4, 3, 2, 1 on its four beats (as the clicks), gone with the first note.
      const beatLen = SONGS[v.song].steps * 2;
      if (v.t < 0) {
        this.judge.textContent = String(Math.min(4, Math.ceil(-v.t / beatLen)));
        this.judge.dataset.grade = '0';
        this.counting = true;
      } else if (this.counting) {
        this.counting = false;
        this.judge.textContent = '';
        this.judge.dataset.grade = '';
      }
    } else setText(this.value, v.prize ? `+$${v.prize}` : `${v.mark}%`);
    const now = performance.now();
    this.pads.querySelectorAll<HTMLElement>('[data-lane]').forEach((p, k) => p.classList.toggle('lit', now - this.lit[k] < 120));
    return true;
  }

  private verdict(v: StageView): string {
    const place = v.place < v.of ? t(`stage.place${Math.min(v.place, 3)}` as Key, { n: v.place + 1 }) : '';
    const parts = [t('stage.verdict', { n: v.mark, place, of: v.of })];
    if (v.prize) parts.push(t('stage.prize', { n: v.prize }));
    if (v.crowd) parts.push(t('stage.crowd', { n: v.crowd }));
    if (v.heat) parts.push(t('stage.goodwill', { n: v.heat }));
    return parts.join(' · ');
  }

  /** The lanes: the notes coming down to the line (shapes by lane), those played gone, those missed greyed. */
  private draw(v: StageView) {
    const c = this.lanes;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const hgt = c.clientHeight;
    if (!w || !hgt) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hgt * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(hgt * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const lw = w / 3;
    const line = hgt - 18;
    const per = line / LOOK;
    // The lanes' floors and the line.
    for (let k = 0; k < 3; k++) {
      g.fillStyle = k % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.08)';
      g.fillRect(k * lw, 0, lw, hgt);
    }
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillRect(0, line - 1, w, 2);
    const chart = CHARTS[v.song];
    const r = Math.min(13, lw * 0.26);
    for (let i = 0; i < chart.length; i++) {
      const [at, lane] = chart[i];
      const dt = at - v.t;
      if (dt > LOOK) break;
      const hit = v.hits[i];
      if (dt < -8 || hit >= 2) continue;
      const x = lane * lw + lw / 2;
      const y = line - dt * per;
      g.globalAlpha = hit === 1 ? 0.3 : 1;
      g.fillStyle = hit === 1 ? '#8a94a3' : LANE_COLOR[lane];
      shape(g, lane, x, y, r);
    }
    g.globalAlpha = 1;
    // The targets on the line: each lane's shape, hollow (lit as it's played).
    const now = performance.now();
    for (let k = 0; k < 3; k++) {
      g.strokeStyle = LANE_COLOR[k];
      g.lineWidth = now - this.lit[k] < 120 ? 4 : 2;
      shape(g, k, k * lw + lw / 2, line, r + 3, true);
    }
  }
}

/** A lane's shape at (x, y): 0 a circle, 1 a diamond, 2 a square. */
function shape(g: CanvasRenderingContext2D, lane: number, x: number, y: number, r: number, stroke = false) {
  g.beginPath();
  if (lane === 0) g.arc(x, y, r, 0, Math.PI * 2);
  else if (lane === 1) {
    g.moveTo(x, y - r * 1.15);
    g.lineTo(x + r * 1.15, y);
    g.lineTo(x, y + r * 1.15);
    g.lineTo(x - r * 1.15, y);
    g.closePath();
  } else g.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
  if (stroke) g.stroke();
  else g.fill();
}

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
  /** The question (its place, 0–7), its text and answers, the right one (shown in the reveal), the time left (0–1). */
  q: number;
  question: string;
  choices: string[];
  answer: number;
  left: number;
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
                  : t(TOUCH ? 'quiz.askTouch' : 'quiz.askKeys')
                : v.end === 'won'
                  ? t('quiz.won', { n: v.prize, m: v.int })
                  : v.end === 'tie'
                    ? t('quiz.tie', { n: v.prize, m: v.int })
                    : t('quiz.lost');
      setText(this.note, note);
      setText(this.join.querySelector('span')!, t('quiz.join'));
      setText(this.quit.querySelector('span')!, t('quiz.quit'));
      this.join.classList.toggle('hidden', v.phase !== 'offer');
      this.join.disabled = !!v.why;
      this.quit.classList.toggle('hidden', v.phase === 'offer' || v.phase === 'result');
    }
    (this.bar.firstElementChild as HTMLElement).style.width = `${(Math.max(0, Math.min(1, v.left)) * 100).toFixed(1)}%`;
    this.bar.classList.toggle('hidden', v.phase !== 'ask');
    this.bar.setAttribute('aria-label', t('quiz.leftAria', { n: Math.ceil(v.left * 10) }));
    return true;
  }
}
