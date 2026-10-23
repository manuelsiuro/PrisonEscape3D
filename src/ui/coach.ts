import { currentLang, t } from '../i18n';
import { TOUCH, h } from './dom';
import { icon } from './icons';

/** What the first-day guide watches, read from the game every frame. */
export interface CoachState {
  /** The routine block's id and whether it's attended. */
  routine: string;
  attended: boolean;
  /** The container open now is the player's desk / someone else's furniture. */
  openMine: boolean;
  openOther: boolean;
  /** Something picked up since the last frame. */
  pickedUp: boolean;
  craftOpen: boolean;
  boardOpen: boolean;
  /** This meal's tray eaten (sat at a canteen table long enough). */
  ate: boolean;
}

interface Step {
  id: string;
  ic: string;
  text: () => string;
  done: (s: CoachState) => boolean;
  /** Its moment has passed (the block is over): the guide moves on without it. */
  gone?: (s: CoachState) => boolean;
}

const STEPS: Step[] = [
  { id: 'rollCall', ic: 'pin', text: () => t('coach.rollCall'), done: (s) => s.routine === 'rollCall' && s.attended, gone: (s) => s.routine !== 'rollCall' },
  { id: 'desk', ic: 'briefcase', text: () => t(TOUCH ? 'coach.desk' : 'coach.deskKeys'), done: (s) => s.openMine },
  {
    id: 'meal',
    ic: 'cookie',
    text: () => t('coach.meal'),
    done: (s) => s.routine === 'breakfast' && s.ate,
    gone: (s) => s.routine !== 'breakfast' && s.routine !== 'rollCall',
  },
  { id: 'loot', ic: 'hand', text: () => t('coach.loot'), done: (s) => s.openOther || s.pickedUp },
  { id: 'craft', ic: 'hammer', text: () => t(TOUCH ? 'coach.craft' : 'coach.craftKeys'), done: (s) => s.craftOpen },
  { id: 'board', ic: 'board', text: () => t('coach.board'), done: (s) => s.boardOpen },
];

/**
 * The first day's guide (the tutorial coach): one small objective card at a time under the
 * HUD (line up for roll call, search your desk, breakfast, search other desks, crafting, the
 * job board), each ticked off when the player does it, then a closing line. Shown on the
 * first game only (and again once the tips are reset); the cross skips it.
 */
export class FirstDay {
  private readonly el = h('div', 'coach hidden');
  private k = -1;
  /** Seconds left showing the tick (a step done) or the closing line. */
  private hold = 0;
  private finishing = false;
  private shownKey = '';

  /** The card goes in `parent` (under the HUD's rows). */
  constructor(
    parent: HTMLElement,
    private readonly onEnd: (skipped: boolean) => void,
    click: () => void,
  ) {
    this.el.setAttribute('role', 'status');
    this.el.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('[data-skip]')) return;
      click();
      this.end(true);
    });
    parent.append(this.el);
  }

  get active() {
    return this.k >= 0;
  }

  /** The step showing now (its id), '' when none. */
  get step(): string {
    return this.k >= 0 && !this.finishing ? (STEPS[this.k]?.id ?? '') : '';
  }

  start() {
    this.k = 0;
    this.hold = 0;
    this.finishing = false;
    this.shownKey = '';
  }

  /** Put away (the game is over); nothing is marked done. */
  stop() {
    this.k = -1;
    this.el.classList.add('hidden');
  }

  private end(skipped: boolean) {
    this.stop();
    this.onEnd(skipped);
  }

  /** Every frame: ticks steps off, moves on, shows the card (not while `hidden`). */
  update(s: CoachState, dt: number, hidden: boolean) {
    if (this.k < 0) return;
    // The tick and the closing line wait while the card is hidden (a panel open): never missed.
    if (this.hold > 0 && !hidden) {
      this.hold -= dt;
      if (this.hold <= 0) {
        if (this.finishing) return this.end(false);
        this.k++;
      }
    }
    if (this.hold <= 0) {
      // Past steps whose moment is gone; the end of the list: the closing line.
      while (this.k < STEPS.length && STEPS[this.k].gone?.(s)) this.k++;
      const step = STEPS[this.k];
      if (!step) {
        this.finishing = true;
        this.hold = 6;
      } else if (step.done(s)) this.hold = 1.1;
    }
    this.el.classList.toggle('hidden', hidden);
    const doneNow = this.hold > 0 && !this.finishing;
    // (The language changed meanwhile, in the settings: drawn again in it.)
    const key = `${this.k}:${doneNow}:${this.finishing}:${currentLang()}`;
    if (key === this.shownKey) return;
    this.shownKey = key;
    if (this.finishing) {
      this.el.className = `coach finish${hidden ? ' hidden' : ''}`;
      this.el.innerHTML = `<span class="coach-ic">${icon('star', 18)}</span><span class="coach-text"><small>${t('coach.title')}</small><b>${t('coach.done')}</b></span>`;
      return;
    }
    const step = STEPS[this.k];
    this.el.className = `coach${doneNow ? ' done' : ''}${hidden ? ' hidden' : ''}`;
    this.el.innerHTML = `<span class="coach-ic">${icon(doneNow ? 'check' : step.ic, 18)}</span>
      <span class="coach-text"><small>${t('coach.title')} · ${this.k + 1}/${STEPS.length}</small><b>${step.text()}</b></span>
      <button class="coach-skip" data-skip aria-label="${t('coach.skip')}" title="${t('coach.skip')}">${icon('close', 14)}</button>`;
  }
}
