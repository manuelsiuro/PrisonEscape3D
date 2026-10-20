import { BETS } from '../content/long';
import { currentLang, t } from '../i18n';
import { EXT, OP } from '../sim/command';
import { RACE_ENTER } from '../sim/systems/races';
import { h, setText } from './dom';
import { icon } from './icons';

type Send = (op: number, a?: number, b?: number, c?: number) => void;

/**
 * Long games (P28) on screen: the race card at the track on a race night (the rats, their form
 * and the bookie's odds, a bet, the pet entered; then the race as it's run, and the result). It's
 * drawn from a view the play layer fills from the sim (play/long.ts): the card, the odds and the
 * race are the sim's own pure functions. Every button is an OP.EXT RACE.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

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
  /** The pet can be entered now (its name), '' not. */
  enter: string;
  /** Why no bet can be placed now ('' it can). */
  why: string;
  /** The result's line ('' none yet). */
  result: string;
}

/** Lane colours, in lane order (the 3D's rats wear the same). */
export const LANE_COLORS = ['#e0574a', '#3a8ed8', '#e8b828', '#5aa846'];

/**
 * The race card (P28), docked as the court's card is: the stake chooser ($5/$10/$20), a row per
 * rat (its colour, name and owner, a form bar, the odds, a Bet button), the pet's entry; then the
 * lanes' progress as the race is run, and the winner.
 */
export class RaceCard {
  private readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly at: HTMLElement;
  private readonly stakes: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly note: HTMLElement;
  private readonly enter: HTMLButtonElement;
  private drawn = '';
  /** The stake chosen (a place in BETS). */
  private stake = 0;

  constructor(
    private readonly send: Send,
    private readonly click: () => void,
  ) {
    this.el = h(
      'div',
      'train-card race-card hidden',
      `<div class="train-head"><i class="train-ic">${icon('race', 18)}</i><b></b><span class="train-value"></span></div>
      <div class="race-stakes" role="radiogroup"></div>
      <div class="race-rows"></div>
      <p class="train-note" role="status"></p>
      <button class="big-btn small race-enter hidden">${icon('rat', 18)}<span></span></button>`,
    );
    this.title = this.el.querySelector('.train-head b')!;
    this.at = this.el.querySelector('.train-value')!;
    this.stakes = this.el.querySelector('.race-stakes')!;
    this.rows = this.el.querySelector('.race-rows')!;
    this.note = this.el.querySelector('.train-note')!;
    this.enter = this.el.querySelector('.race-enter')!;
    this.el.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const stake = el.closest<HTMLElement>('[data-stake]');
      if (stake) {
        this.click();
        this.stake = Number(stake.dataset.stake);
        this.drawn = '';
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
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  update(v: RaceView | null) {
    this.el.classList.toggle('hidden', !v);
    if (!v) {
      this.drawn = '';
      return;
    }
    const key = [v.phase, v.at, v.lanes.map((l) => `${l.name}:${l.owner}:${l.speed}:${l.odds}:${l.place}`).join(','), v.bet ? `${v.bet.lane}:${v.bet.stake}` : '', v.enter, v.why, v.result, this.stake, currentLang()].join('|');
    if (key !== this.drawn) {
      this.drawn = key;
      const card = v.phase === 'card';
      setText(this.title, t('race.title'));
      setText(this.at, card ? t('race.at', { time: v.at }) : v.phase === 'running' ? t('race.running') : t('race.over'));
      // The stakes: only while a bet can still be placed.
      const betting = card && !v.bet;
      this.stakes.classList.toggle('hidden', !betting);
      this.stakes.setAttribute('aria-label', t('race.stake'));
      this.stakes.innerHTML = betting ? BETS.map((n, k) => `<button class="seg${k === this.stake ? ' on' : ''}" role="radio" aria-checked="${k === this.stake}" data-stake="${k}">$${n}</button>`).join('') : '';
      this.rows.innerHTML = v.lanes
        .map((l, k) => {
          const who = l.mine ? t('race.yours') : t('race.whose', { name: esc(l.owner) });
          const odds = `×${(l.odds / 10).toFixed(1)}`;
          const betHere = v.bet?.lane === k;
          const tag = betHere ? `<em class="race-tag">${t('race.yourBet', { n: v.bet!.stake })}</em>` : '';
          const place = l.place ? `<em class="race-place">${t(l.place === 1 ? 'race.first' : 'race.place', { n: l.place })}</em>` : '';
          const action = betting && !v.why ? `<button class="big-btn small primary" data-bet="${k}" aria-label="${esc(t('race.betOn', { n: BETS[this.stake], name: l.name, odds }))}">${t('race.bet')}</button>` : `<span class="race-odds">${odds}</span>`;
          return `<div class="race-row${l.mine ? ' mine' : ''}${betHere ? ' backed' : ''}${l.place === 1 ? ' won' : ''}"><i class="race-dot" style="--lane:${LANE_COLORS[k % LANE_COLORS.length]}"></i><span class="race-name"><b>${esc(l.name)}</b><small>${who}</small></span><i class="race-form" title="${esc(t('race.form', { n: l.speed }))}"><i style="width:${l.speed}%"></i></i>${betting && !v.why ? `<span class="race-odds">${odds}</span>` : ''}${action}${tag}${place}<i class="race-run" aria-hidden="true"><i></i></i></div>`;
        })
        .join('');
      const note = v.result || (card ? (v.why || (v.bet ? t('race.betPlaced', { n: v.bet.stake, odds: `×${(v.bet.odds / 10).toFixed(1)}` }) : t('race.pick'))) : t('race.watch'));
      setText(this.note, note);
      this.enter.classList.toggle('hidden', !v.enter || !card);
      setText(this.enter.querySelector('span')!, v.enter ? t('race.enter', { name: v.enter }) : '');
    }
    // The race as it's run (every frame): each lane's rat along its bar.
    const bars = this.rows.querySelectorAll<HTMLElement>('.race-run i');
    v.lanes.forEach((l, k) => {
      const bar = bars[k];
      if (bar) bar.style.width = `${(l.pos * 100).toFixed(1)}%`;
    });
    this.el.classList.toggle('running', v.phase !== 'card');
  }
}
