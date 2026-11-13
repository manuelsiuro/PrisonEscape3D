import { BETS } from '../content/long';
import { currentLang, t, textStamp } from '../i18n';
import { EXT, OP } from '../sim/command';
import { RACE_ENTER } from '../sim/systems/races';
import { arrowStep, esc, h, type Send, setText } from './dom';
import { icon } from './icons';

/**
 * Long games (P28) on screen: the race card at the track on a race night (the rats, their form
 * and the bookie's odds, a bet, the pet entered; then the race as it's run, and the result). It's
 * drawn from a view the play layer fills from the sim (play/long.ts): the card, the odds and the
 * race are the sim's own pure functions. Every button is an OP.EXT RACE.
 */

/** A lane on the card. */
export interface RaceLane {
  name: string;
  /** Whose rat ('' the player's own). */
  owner: string;
  /** Its speed, 0–100 (the form bar). */
  speed: number;
  /** The bookie's odds now (tenths). */
  odds: number;
  mine: boolean;
  /** The player's own rat ate today (null: a rival's, not known). 2.41: a rival's as gossip told it (`heard`). */
  fed: boolean | null;
  heard: boolean;
  /** 2.41: in front now, as it's run. */
  lead: boolean;
  /** How far along the track it is (0–1), and where it finished (1 first; 0 not yet). */
  pos: number;
  place: number;
}

/** The race card as shown. */
export interface RaceView {
  /** 'card' bets taken until the off; 'running'; 'result' a moment after the finish. */
  phase: 'card' | 'running' | 'result';
  /** The off's time ("21:00"). */
  at: string;
  lanes: RaceLane[];
  /** The player's bet ({lane, stake $, odds}), null none. */
  bet: { lane: number; stake: number; odds: number } | null;
  /** The pet can be entered now (its name), '' not; entered (its name), '' not. */
  enter: string;
  entered: string;
  /** Why no bet can be placed now ('' it can). */
  why: string;
  /** The result's line ('' none yet). */
  result: string;
  /** The player's cash (stakes they can't cover are dimmed). */
  cash: number;
  /** Tonight's race (the card closed for it stays closed until the player leaves the track). */
  day: number;
  /** 2.41: the race called as it's run ('' none); the gambling heat a guard's eyes cost ('' none to say), a guard seeing now. */
  call: string;
  risk: string;
  seen: boolean;
}

/** Lane colours, in lane order (the 3D's rats wear the same); the player's own rat is gold. */
const LANE_COLORS = ['#e0574a', '#3a8ed8', '#9a5ad8', '#5aa846'];
const PET_COLOR = '#ffd34a';

/** Odds (tenths) as the language writes them: ×2,5 in French, ×2 for a whole number. */
const oddsText = (odds: number) => `×${new Intl.NumberFormat(currentLang(), { maximumFractionDigits: 1 }).format(odds / 10)}`;
/** What a winning bet pays back at odds (tenths), stake included: the sim's own rule (races.ts payout). */
const pays = (stake: number, odds: number) => Math.floor((stake * odds) / 10);

/**
 * The race card (P28), docked as the court's card is: the stake chooser ($5/$10/$20), the pet's
 * entry, a row per rat (its colour, name, owner and speed, the odds, a Bet button with what it
 * pays); then the lanes' progress as the race is run, and the winner. It can be closed for the
 * night (it comes back once the player has left the track and come back).
 */
export class RaceCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly at: HTMLElement;
  private readonly stakes: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly note: HTMLElement;
  private readonly call: HTMLElement;
  private readonly risk: HTMLElement;
  private readonly enter: HTMLButtonElement;
  private drawn = '';
  private stakesDrawn = '';
  /** The stake chosen (a place in BETS). */
  private stake = 0;
  /** Closed for this race night (its day), 0 not. */
  private closedDay = 0;

  constructor(
    private readonly send: Send,
    private readonly click: () => void,
  ) {
    this.el = h(
      'div',
      'train-card race-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('race', 18)}</i><b></b><span class="train-value"></span><button class="icon-btn small race-close">${icon('close', 16)}</button></div>
      <div class="race-stakes" role="radiogroup"></div>
      <button class="big-btn primary small race-enter hidden">${icon('rat', 18)}<span></span></button>
      <p class="race-risk"></p>
      <p class="race-call" role="status" aria-live="polite"></p>
      <div class="race-rows"></div>
      <p class="train-note" role="status"></p>`,
    );
    this.title = this.el.querySelector('.train-head b')!;
    this.at = this.el.querySelector('.train-value')!;
    this.stakes = this.el.querySelector('.race-stakes')!;
    this.rows = this.el.querySelector('.race-rows')!;
    this.call = this.el.querySelector('.race-call')!;
    this.risk = this.el.querySelector('.race-risk')!;
    this.note = this.el.querySelector('.train-note')!;
    this.enter = this.el.querySelector('.race-enter')!;
    this.el.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      if (el.closest('.race-close')) {
        this.click();
        this.closedDay = this.day;
        this.el.classList.add('hidden');
        return;
      }
      const stake = el.closest<HTMLElement>('[data-stake]');
      if (stake) {
        this.click();
        this.pick(Number(stake.dataset.stake));
        return;
      }
      const bet = el.closest<HTMLElement>('[data-bet]');
      if (bet) {
        this.click();
        this.send(OP.EXT, EXT.RACE, Number(bet.dataset.bet), this.stake);
        return;
      }
      if (el.closest('.race-enter')) {
        this.click();
        this.send(OP.EXT, EXT.RACE, RACE_ENTER);
      }
    });
    // The stakes as a radio group: arrow keys move the choice (and the focus) along it.
    this.stakes.addEventListener('keydown', (e) => {
      const d = arrowStep(e);
      if (!d) return;
      this.pick((this.stake + d + BETS.length) % BETS.length);
      this.stakes.querySelector<HTMLElement>(`[data-stake="${this.stake}"]`)?.focus();
    });
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  private day = 0;

  get open() {
    return !this.el.classList.contains('hidden');
  }

  /** A stake chosen: the radio buttons updated in place (the focus stays), the rows' payouts redrawn. */
  private pick(k: number) {
    this.stake = k;
    this.stakes.querySelectorAll<HTMLElement>('[data-stake]').forEach((b) => {
      const on = Number(b.dataset.stake) === k;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    this.drawn = '';
  }

  /** The view (null: no card). Returns whether it's shown (closed for the night, it isn't). */
  update(v: RaceView | null): boolean {
    // (Closed for tonight: until the card goes away, the player having left the track.)
    if (!v) this.closedDay = 0;
    if (v) this.day = v.day;
    const show = !!v && this.closedDay !== v.day;
    this.el.classList.toggle('hidden', !show);
    if (!show || !v) {
      this.drawn = '';
      return false;
    }
    const card = v.phase === 'card';
    const betting = card && !v.bet;
    // The stakes: drawn when they come and go (and the language or the cash changes), toggled in place otherwise.
    const sk = `${betting}|${v.cash}|${textStamp()}`;
    if (sk !== this.stakesDrawn) {
      this.stakesDrawn = sk;
      if (betting && BETS[this.stake] > v.cash)
        this.stake = Math.max(
          0,
          BETS.reduce((best, n, k) => (n <= v.cash ? k : best), 0),
        );
      this.stakes.classList.toggle('hidden', !betting);
      this.stakes.setAttribute('aria-label', t('race.stake'));
      this.stakes.innerHTML = betting
        ? BETS.map(
            (n, k) =>
              `<button class="seg${k === this.stake ? ' on' : ''}${n > v.cash ? ' poor' : ''}" role="radio" aria-checked="${k === this.stake}" tabindex="${k === this.stake ? 0 : -1}" data-stake="${k}">$${n}</button>`,
          ).join('')
        : '';
    }
    const key = [
      v.phase,
      v.at,
      v.lanes.map((l) => `${l.name}:${l.owner}:${l.speed}:${l.odds}:${l.place}:${l.fed}:${l.heard}`).join(','),
      v.bet ? `${v.bet.lane}:${v.bet.stake}` : '',
      v.enter,
      v.entered,
      v.why,
      v.result,
      v.cash,
      this.stake,
      textStamp(),
    ].join('|');
    if (key !== this.drawn) {
      this.drawn = key;
      setText(this.title, t('race.title'));
      setText(this.at, card ? t('race.at', { time: v.at }) : v.phase === 'running' ? t('race.running') : t('race.over'));
      this.el.querySelector('.race-close')!.setAttribute('aria-label', t('race.close'));
      const stake = BETS[this.stake];
      this.rows.innerHTML = v.lanes
        .map((l, k) => {
          const who = l.mine ? t('race.yours') : t('race.whose', { name: esc(l.owner) });
          // (2.41: a rival's as the gossip told it.)
          const fed =
            l.fed === null ? '' : ` · ${t(l.heard ? (l.fed ? 'race.fedHeard' : 'race.hungryHeard') : l.fed ? 'race.fed' : 'race.hungry')}`;
          const odds = oddsText(l.odds);
          const betHere = v.bet?.lane === k;
          const tag = betHere ? `<em class="race-tag">${t('race.yourBet', { n: v.bet!.stake })}</em>` : '';
          const place = l.place
            ? `<em class="race-place">${t(l.place === 1 ? 'race.first' : (`race.place${Math.min(4, l.place)}` as 'race.place2'))}</em>`
            : '';
          const ok = betting && !v.why;
          const label = t('race.betOn', { n: stake, name: l.name, odds, m: pays(stake, l.odds), speed: l.speed });
          const action = ok
            ? `<button class="big-btn small primary${stake > v.cash ? ' poor' : ''}" data-bet="${k}" aria-label="${esc(label)}"><span>${t('race.bet')}</span><small>${t('race.pays', { n: pays(stake, l.odds) })}</small></button>`
            : '';
          return `<div class="race-row${l.mine ? ' mine' : ''}${betHere ? ' backed' : ''}${l.place === 1 ? ' won' : ''}"><i class="race-dot" style="--lane:${l.mine ? PET_COLOR : LANE_COLORS[k % LANE_COLORS.length]}"></i><span class="race-name"><b>${esc(l.name)}</b><small>${who}${fed}</small></span><span class="race-speed"><i class="race-form" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${l.speed}" aria-label="${esc(t('race.form', { n: l.speed }))}"><i style="width:${l.speed}%"></i></i><small aria-hidden="true">${l.speed}</small></span><span class="race-odds">${odds}</span>${action}${tag}${place}<i class="race-run" aria-hidden="true"><i></i></i></div>`;
        })
        .join('');
      const note =
        v.result ||
        (card
          ? v.why ||
            (v.bet
              ? t('race.betPlaced', { n: v.bet.stake, odds: oddsText(v.bet.odds), m: pays(v.bet.stake, v.bet.odds) })
              : v.entered
                ? t('race.stay', { name: v.entered, time: v.at })
                : t('race.pick'))
          : t('race.watch'));
      setText(this.note, note);
      this.enter.classList.toggle('hidden', !v.enter || !card);
      setText(this.enter.querySelector('span')!, v.enter ? t('race.enter', { name: v.enter }) : '');
    }
    // The race as it's run (every frame): each lane's rat along its bar, the one in front marked (2.41), the race called.
    const bars = this.rows.querySelectorAll<HTMLElement>('.race-run i');
    const rows = this.rows.children;
    v.lanes.forEach((l, k) => {
      const bar = bars[k];
      if (bar) bar.style.width = `${(l.pos * 100).toFixed(1)}%`;
      rows[k]?.classList.toggle('lead', l.lead);
    });
    setText(this.call, v.call);
    this.call.classList.toggle('hidden', !v.call);
    // (2.41: a guard's eyes and the heat they cost, before a bet and while it's on: red when one sees the player now.)
    setText(this.risk, v.risk);
    this.risk.classList.toggle('hidden', !v.risk);
    this.risk.classList.toggle('seen', v.seen);
    this.el.classList.toggle('running', v.phase !== 'card');
    return true;
  }
}

// ------------------------------------------------------------------ 2.43: the rat's training card

/** The rat's laps as shown (play/long.ts ratRunNow). */
export interface RatRunView {
  name: string;
  /** Its speed as it set off. */
  speed: number;
  /** Each lap's pass: 'hit' caught, 'miss' missed, '' still to come. */
  marks: Array<'hit' | 'miss' | ''>;
  /** Round the ring (0–1 from the bait, the way it runs), where the frame has it. */
  turn: number;
  /** Laps still to come before the first pass (the count-in), 0 once it's on. */
  count: number;
  /** How it's played, in the player's own keys or by touch. */
  how: string;
}

/**
 * The rat's training (2.43), as the gym's card is: a ring with the bait at its foot and the rat running round it, a pip a
 * lap (caught, missed, to come), the one big button (a press anywhere on the ring or the button: OP.TRAIN 1, on the way
 * down to be on time), and the close button (OP.TRAIN 3: what's caught so far still counts).
 */
export class RatRunCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly value: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly dot: HTMLElement;
  private readonly pips: HTMLElement;
  private readonly note: HTMLElement;
  private readonly countEl: HTMLElement;
  private drawn = '';

  constructor(private readonly send: Send) {
    this.el = h(
      'div',
      'train-card rat-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('rat', 18)}</i><b></b><span class="train-value"></span><button class="icon-btn small train-stop">${icon('close', 16)}</button></div>
      <div class="rat-ring" aria-hidden="true"><i class="rat-ring-track"></i><i class="rat-bait"></i><i class="rat-dot"></i><b class="rat-count" aria-live="assertive"></b></div>
      <div class="rat-pips" role="img"></div>
      <p class="train-note"></p>
      <button class="big-btn primary rat-btn">${icon('rat', 20)}<span></span></button>`,
    );
    this.title = this.el.querySelector('.train-head b')!;
    this.value = this.el.querySelector('.train-value')!;
    this.ring = this.el.querySelector('.rat-ring')!;
    this.dot = this.el.querySelector('.rat-dot')!;
    this.pips = this.el.querySelector('.rat-pips')!;
    this.note = this.el.querySelector('.train-note')!;
    this.countEl = this.el.querySelector('.rat-count')!;
    for (const b of [this.ring, this.el.querySelector<HTMLElement>('.rat-btn')!]) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.send(OP.TRAIN, 1);
      });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      // (A key on the focused button: its press too. Pointer presses were sent on the way down.)
      b.addEventListener('click', (e) => {
        if (e.detail === 0) this.send(OP.TRAIN, 1);
      });
    }
    this.el.querySelector('.train-stop')!.addEventListener('click', () => this.send(OP.TRAIN, 3));
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  /** A press that counted: the bait lights up for a catch, the ring dims for a miss. */
  flash(hit: boolean) {
    this.ring.classList.remove('hit', 'miss');
    void this.ring.offsetWidth;
    this.ring.classList.add(hit ? 'hit' : 'miss');
  }

  update(v: RatRunView | null) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      return;
    }
    const key = `${textStamp()}|${v.name}|${v.speed}|${v.marks.join(',')}|${v.how}`;
    if (key !== this.drawn) {
      this.drawn = key;
      setText(this.title, t('track.title', { name: v.name }));
      setText(this.value, t('track.speedNow', { n: v.speed }));
      setText(this.note, v.how);
      setText(this.el.querySelector('.rat-btn span')!, t('track.tap'));
      this.pips.innerHTML = v.marks.map((m) => `<i class="${m}"></i>`).join('');
      const caught = v.marks.filter((m) => m === 'hit').length;
      this.pips.setAttribute('aria-label', t('track.caught', { n: caught, of: v.marks.length }));
    }
    // (Round the ring from its foot, where the bait is: the way the rat runs in the picture.)
    this.dot.style.transform = `rotate(${(v.turn * 360).toFixed(1)}deg)`;
    setText(this.countEl, v.count > 0 ? t('track.ready') : '');
    this.el.classList.toggle('counting', v.count > 0);
  }
}
