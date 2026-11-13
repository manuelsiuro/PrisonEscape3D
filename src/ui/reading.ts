/**
 * Reading a book (2.31): the page on screen, a marker going along it word by word, the key words to underline as it
 * reaches them. The rule is the sim's (training.ts, content/books.ts): here each language's words are laid over its
 * key words, however many words lie between them. Word by word, so reduced motion has nothing to change. 2.34: half
 * the speed, and the marker waits at each lit key word, the time it has left shown under it.
 */
import { keyAt, keyFrom, pageTokens, READ_GAPS, READ_KEYS, READ_PAGE_STEPS, READ_TAIL, SUBJECTS, type Token } from '../content/books';
import { t, textStamp, type Key } from '../i18n';
import { OP } from '../sim/command';
import type { Sim } from '../sim/Sim';
import { nextUnlock, suggestSubject, toLearn } from '../sim/systems/recipes';
import { headFull, readPace } from '../sim/systems/training';
import { READ_LEAD, READ_SETS_A_DAY, READ_WAIT, READ_WINDOW } from '../sim/tuning';
import { setText, touchWords } from './dom';
import { icon } from './icons';
import type { ShelfBooks } from './items';

const SUBJECT_ICON: readonly string[] = ['wrench', 'lockpick', 'fist', 'bulb'];

/** The librarian's word for the player now: the day's reading done, the subject with the most for them, or what's next. */
export function librarianLine(sim: Sim): string {
  if (headFull(sim)) return t('talk.librarianFull');
  const k = suggestSubject(sim);
  if (k < 0) return t('talk.librarianNothing', { next: nextLine(sim) });
  const n = toLearn(sim, k);
  return t(n === 1 ? 'talk.librarianTryOne' : 'talk.librarianTry', { subject: t(`book.${SUBJECTS[k]}` as Key), n });
}

/** What a library shelf's panel shows (2.31). */
export function shelfBooks(sim: Sim): ShelfBooks {
  return {
    subjects: SUBJECTS.map((id, k) => {
      const n = toLearn(sim, k);
      return {
        id: k,
        name: t(`book.${id}` as Key),
        icon: SUBJECT_ICON[k],
        learn: n ? t('box.readToLearn', { n }) : t('box.readNothing'),
        some: n > 0,
      };
    }),
    note: t('box.readNote', { n: sim.setCost('int'), d: sim.state.readToday, max: READ_SETS_A_DAY }),
    next: nextLine(sim),
    full: headFull(sim) ? t('box.readFull') : '',
  };
}

/** "At 50: Mailman ($55), 3 recipes". */
export function nextLine(sim: Sim): string {
  const n = nextUnlock(sim);
  if (!n) return t('read.nextNone');
  const parts = [
    ...n.jobs.map((id) => t('read.job', { job: t(`job.${id}` as Key), wage: n.wage })),
    ...(n.recipes ? [t(n.recipes === 1 ? 'read.recipe' : 'read.recipes', { n: n.recipes })] : []),
  ];
  return t('read.next', { at: n.at, what: parts.join(', ') });
}

export class ReadCard {
  private readonly el: HTMLElement;
  private readonly page: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly title: HTMLElement;
  private readonly value: HTMLElement;
  private readonly note: HTMLElement;
  private readonly next: HTMLElement;
  /** What's drawn: the book, the page and the language; then the words and which are key. */
  private drawn = '';
  private words: HTMLElement[] = [];
  private keys: number[] = [];
  /** The marker's word, the first key word on the page (its number), those underlined (by number). */
  private at = -1;
  private first = 0;
  private readonly hits = new Set<number>();
  private seen = '';
  /** The game whose page this is (its state): a game loaded in its place starts with nothing underlined. */
  private game: object | null = null;
  onPage: () => void = () => {};

  constructor(private readonly send: (op: number, a?: number) => void) {
    this.el = document.createElement('div');
    this.el.className = 'read-card train-card hidden';
    this.el.innerHTML = `
      <div class="train-head"><span class="train-ic">${icon('book', 18)}</span><b></b><span class="train-value"></span><button class="icon-btn train-stop">${icon('close', 16)}</button></div>
      <p class="read-page"></p>
      <div class="train-bar"><i></i></div>
      <p class="train-note read-note"></p>
      <p class="train-note read-next"></p>
      <button class="big-btn primary read-btn"></button>`;
    this.page = this.el.querySelector('.read-page')!;
    this.fill = this.el.querySelector('.train-bar i')!;
    this.title = this.el.querySelector('.train-head b')!;
    this.value = this.el.querySelector('.train-value')!;
    this.note = this.el.querySelector('.read-note')!;
    this.next = this.el.querySelector('.read-next')!;
    // (Anywhere on the page, or the button: pressed on touching, not on letting go, to be on time.)
    for (const b of [this.page, this.el.querySelector<HTMLElement>('.read-btn')!]) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.send(OP.TRAIN, 1);
      });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    this.el.querySelector('.train-stop')!.addEventListener('click', () => this.send(OP.TRAIN, 3));
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  /** A press that counted: the key word underlined; a stray one spends the next, and the page says so. */
  mark(key: number, hit: boolean) {
    if (hit) this.hits.add(key);
    else {
      this.page.classList.remove('stray');
      void this.page.offsetWidth;
      this.page.classList.add('stray');
    }
  }

  private draw(tokens: Token[]) {
    this.page.textContent = '';
    this.words = tokens.map((w) => {
      const span = document.createElement('span');
      span.textContent = w.text;
      span.className = w.key ? 'key' : '';
      this.page.append(span, ' ');
      return span;
    });
    this.keys = tokens.flatMap((w, k) => (w.key ? [k] : []));
    this.at = -1;
  }

  /** The word the marker's on, `within` steps into the page: evenly along the words between two key words. */
  private wordAt(page: number, within: number, pace: number): number {
    const gaps = READ_GAPS[page % READ_GAPS.length].map((g) => g * pace);
    let from = -READ_TAIL * pace;
    let word = 0;
    for (let k = 0; k < READ_KEYS; k++) {
      const to = from + gaps[k];
      const end = this.keys[k] ?? this.words.length - 1;
      if (within <= to) return Math.round(word + ((within - from) / gaps[k]) * (end - word));
      from = to;
      word = end;
    }
    return this.words.length - 1;
  }

  update(sim: Sim, busy: boolean) {
    const s = sim.state;
    const on = !sim.rules230 && s.train >= 0 && sim.world.props[s.train].kind === 'shelf' && !busy;
    this.el.classList.toggle('hidden', !on);
    document.body.classList.toggle('reading', on);
    if (!on) {
      this.drawn = '';
      this.seen = '';
      return;
    }
    // (A book begun again starts from its first key word, and another game is another book: what was underlined before
    // is another reading's.)
    if (this.game !== s) {
      this.game = s;
      this.hits.clear();
    }
    for (const n of this.hits) if (n >= s.repBeat) this.hits.delete(n);
    const subject = SUBJECTS[Math.max(0, s.book - 1)];
    const pace = readPace(sim);
    const pos = s.step - s.readFrom;
    const page = Math.floor(pos / (READ_PAGE_STEPS * pace));
    const within = pos - page * READ_PAGE_STEPS * pace;
    const lang = textStamp();
    const key = `${subject}|${page % READ_GAPS.length}|${page}|${lang}`;
    if (key !== this.drawn) {
      // (A turned page, not the first.)
      if (this.drawn && this.drawn.split('|')[2] !== String(page)) this.onPage();
      this.drawn = key;
      this.first = page * READ_KEYS;
      this.draw(pageTokens(t(`book.${subject}.p${page % READ_GAPS.length}` as Key)));
    }
    // The marker goes along; the key words light as they come into reach, and stay underlined or go dim.
    const at = this.wordAt(page, within, pace);
    if (at !== this.at) {
      this.words[this.at]?.classList.remove('at');
      this.words[at]?.classList.add('at');
      this.at = at;
    }
    const grace = sim.rules233 ? READ_WINDOW : 0;
    const near = keyFrom(pos, grace, pace);
    const live = keyAt(near, pace) <= pos + (sim.rules233 ? READ_WINDOW : READ_LEAD) ? near : -1;
    this.keys.forEach((w, k) => {
      const n = this.first + k;
      const el = this.words[w];
      const lit = n === live && n >= s.repBeat;
      el.classList.toggle('hit', this.hits.has(n));
      el.classList.toggle('near', lit);
      el.classList.toggle('gone', !this.hits.has(n) && (keyAt(n, pace) < pos - grace || n < s.repBeat));
      // (2.34: the marker waiting on it, the time left as a bar under the word.)
      if (lit && !sim.rules233) el.style.setProperty('--left', String(1 - s.readWait / READ_WAIT));
      else el.style.removeProperty('--left');
    });
    this.fill.style.width = `${s.reps}%`;
    const shown = `${subject}|${s.items.int}|${s.readToday}|${sim.setCost('int')}|${lang}`;
    if (shown !== this.seen) {
      const pop = this.seen !== '' && this.seen.split('|')[1] !== String(s.items.int);
      this.seen = shown;
      this.title.textContent = t(`book.${subject}.title` as Key);
      this.value.textContent = `${t('attr.int')} ${s.items.int}`;
      setText(
        this.note,
        `${touchWords() ? t('read.touch') : t('read.keys')} · ${t('train.cost', { n: sim.setCost('int') })} · ${t('read.today', { n: s.readToday, max: READ_SETS_A_DAY })}`,
      );
      this.next.textContent = nextLine(sim);
      this.el.querySelector('.train-stop')!.setAttribute('aria-label', t('read.stop'));
      this.el.querySelector('.read-btn')!.textContent = t('read.underline');
      if (pop) {
        this.value.classList.remove('pop');
        void this.value.offsetWidth;
        this.value.classList.add('pop');
      }
    }
  }
}
