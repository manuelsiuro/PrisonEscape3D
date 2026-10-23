import { currentLang, t, type Key } from '../i18n';
import { h, setText } from './dom';
import { icon } from './icons';

/** What the manhunt's HUD shows (P41), worked out by the play layer each frame. */
export interface HuntHudState {
  /** The nearest way to safety: the safe point's kind, or Lou's car. */
  goal: string;
  /** Walking tiles to it, and its way on screen (radians, 0 = up the screen, clockwise). */
  dist: number;
  angle: number;
  /** Seconds until the alarm (positive) or since it went up (zero or negative). */
  alarm: number;
  /** What's out after the player now. */
  dogs: boolean;
  roadblocks: boolean;
  heli: boolean;
  /** How the player stands: hidden in cover, lit by the helicopter, being chased, a dog on their trail, crossing cover, or nothing to say. */
  state: 'hidden' | 'lit' | 'chased' | 'tracked' | 'cover' | '';
  /** The crew member keeping watch, by name ('' none). */
  lookout: string;
  /** The action button: its icon, its verb, what it's for (null: hidden); a cut's progress (0–1). */
  act: { icon: string; verb: Key; what: string } | null;
  cut: number;
  /** The stone button: shown, and how far it has come back (0–1, 1 ready). */
  stone: number;
}

const GOAL_ICON: Record<string, string> = { bus: 'ticket', coach: 'ticket', border: 'flag', train: 'route', truck: 'truck', lou: 'truck' };

/**
 * The manhunt's HUD (P41): along the top, the way to safety (its name, how far, an arrow
 * pointing the way) and the alarm (counting down to it, then how long it's been up, with what
 * has come out since: dogs, roadblocks, the helicopter), the pause; under them how the player
 * stands (hidden, in the light, chased) and the lookout keeping watch. At the bottom right,
 * the action button (clothes off a line, cut the wire, a treat for a dog) and the stone.
 */
export class HuntHud {
  readonly el: HTMLElement;
  private readonly goal: HTMLElement;
  private readonly goalName: HTMLElement;
  private readonly goalDist: HTMLElement;
  private readonly goalIcon: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly alarmPill: HTMLElement;
  private readonly alarmTime: HTMLElement;
  private readonly alarmLabel: HTMLElement;
  private readonly tiers: HTMLElement;
  private readonly statePill: HTMLElement;
  private readonly crewPill: HTMLElement;
  readonly act: HTMLButtonElement;
  readonly stoneBtn: HTMLButtonElement;
  private shownGoal = '';
  private shownAct = '';
  private shownState = '';
  private shownTiers = '';
  /** The language the words were written in (changed in the settings, from the pause card: all written again). */
  private lang = '';
  /** The pause button, the action button, the stone. */
  onPause: () => void = () => {};
  onAct: () => void = () => {};
  onStone: () => void = () => {};

  constructor() {
    this.el = h(
      'div',
      'hud hunt-hud hidden',
      `<div class="hud-row">
        <span class="pill big hunt-goal" role="status"><i class="hg-ic"></i><span class="hg-text"><b></b><small></small></span><i class="hg-arrow" aria-hidden="true">${icon('up', 16)}</i></span>
        <span class="pill big hunt-alarm"><i class="ha-ic">${icon('siren', 16)}</i><span class="ha-text"><b></b><small></small></span><i class="ha-tiers" aria-hidden="true"></i></span>
        <button class="icon-btn hud-pause hunt-pause" aria-label="${t('hud.pause')}">${icon('pause')}</button>
      </div>
      <div class="hud-row hud-alerts">
        <span class="pill hud-alert hunt-state hidden" role="status"></span>
        <span class="pill hud-alert hunt-crew hidden">${icon('users', 15)}<span></span></span>
      </div>`,
    );
    const q = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
    this.goal = q('.hunt-goal');
    this.goalName = q('.hg-text b');
    this.goalDist = q('.hg-text small');
    this.goalIcon = q('.hg-ic');
    this.arrow = q('.hg-arrow');
    this.alarmPill = q('.hunt-alarm');
    this.alarmTime = q('.ha-text b');
    this.alarmLabel = q('.ha-text small');
    this.tiers = q('.ha-tiers');
    this.statePill = q('.hunt-state');
    this.crewPill = q('.hunt-crew');
    q('.hunt-pause').addEventListener('click', () => this.onPause());
    this.act = h('button', 'act-btn hunt-act hidden');
    this.act.addEventListener('click', () => this.onAct());
    this.stoneBtn = h('button', 'tool-btn hunt-stone hidden', `<i class="tool-round"><i class="tool-ring"></i>${icon('toss', 22)}<span></span></i>`);
    this.stoneBtn.setAttribute('aria-keyshortcuts', 'Space');
    this.stoneBtn.addEventListener('click', () => this.onStone());
    document.body.append(this.el, this.act, this.stoneBtn);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    if (!on) {
      this.act.classList.add('hidden');
      this.stoneBtn.classList.add('hidden');
    }
    this.shownGoal = this.shownAct = this.shownState = this.shownTiers = '';
    // (A new hunt starts clean: no state pill or tiers left from the last one.)
    this.statePill.className = 'pill hud-alert hunt-state hidden';
    this.statePill.innerHTML = '';
    this.tiers.innerHTML = '';
    this.alarmPill.classList.remove('up');
  }

  update(s: HuntHudState) {
    if (currentLang() !== this.lang) {
      this.lang = currentLang();
      // (Not a value any of them takes: each is written again.)
      this.shownGoal = this.shownAct = this.shownState = this.shownTiers = '?';
      setText(this.stoneBtn.querySelector('span')!, t('manhunt.stone'));
      this.el.querySelector('.hunt-pause')!.setAttribute('aria-label', t('hud.pause'));
    }
    if (s.goal !== this.shownGoal) {
      this.shownGoal = s.goal;
      this.goalIcon.innerHTML = icon(GOAL_ICON[s.goal] ?? 'flag', 18);
      setText(this.goalName, t(`manhunt.place.${s.goal}` as Key));
      this.goal.classList.toggle('lou', s.goal === 'lou');
    }
    const n = Math.max(0, s.dist);
    const dist = t(n === 1 ? 'manhunt.tile' : 'manhunt.tiles', { n });
    setText(this.goalDist, dist);
    this.arrow.style.transform = `rotate(${s.angle.toFixed(2)}rad)`;
    this.goal.setAttribute('aria-label', `${t(`manhunt.place.${s.goal}` as Key)}, ${dist}`);
    // The alarm: counting down, then how long it's been up.
    const up = s.alarm <= 0;
    const secs = Math.abs(Math.ceil(s.alarm));
    setText(this.alarmTime, `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
    setText(this.alarmLabel, t(up ? 'manhunt.alarmUp' : 'manhunt.alarmIn'));
    this.alarmPill.classList.toggle('up', up);
    const tiers = `${s.dogs ? 'd' : ''}${s.roadblocks ? 'r' : ''}${s.heli ? 'h' : ''}`;
    if (tiers !== this.shownTiers) {
      this.shownTiers = tiers;
      this.tiers.innerHTML = `${s.dogs ? icon('paw', 14) : ''}${s.roadblocks ? icon('bars', 14) : ''}${s.heli ? icon('heli', 14) : ''}`;
      this.alarmPill.setAttribute('aria-label', [t(up ? 'manhunt.alarmUp' : 'manhunt.alarmIn'), s.dogs ? t('manhunt.tier.dogs') : '', s.roadblocks ? t('manhunt.tier.roadblocks') : '', s.heli ? t('manhunt.tier.heli') : ''].filter(Boolean).join(', '));
    }
    if (s.state !== this.shownState) {
      this.shownState = s.state;
      this.statePill.className = `pill hud-alert hunt-state${s.state ? ` st-${s.state}` : ' hidden'}`;
      if (s.state) this.statePill.innerHTML = `${icon(s.state === 'hidden' ? 'eyeOff' : s.state === 'lit' ? 'sun' : s.state === 'chased' ? 'siren' : s.state === 'tracked' ? 'paw' : 'eye', 15)}<span>${t(`manhunt.state.${s.state}` as Key)}</span>`;
    }
    this.crewPill.classList.toggle('hidden', !s.lookout);
    if (s.lookout) setText(this.crewPill.querySelector('span')!, t('manhunt.lookout', { name: s.lookout }));
    // The action button.
    const key = s.act ? `${s.act.icon}|${s.act.verb}|${s.act.what}` : '';
    if (key !== this.shownAct) {
      this.shownAct = key;
      this.act.classList.toggle('hidden', !s.act);
      if (s.act) {
        this.act.innerHTML = `<i class="act-round">${icon(s.act.icon, 24)}<span></span></i>${s.act.what ? '<b class="act-what"></b>' : ''}`;
        this.act.querySelector('.act-round span')!.textContent = t(s.act.verb);
        if (s.act.what) this.act.querySelector('.act-what')!.textContent = s.act.what;
        this.act.setAttribute('aria-label', `${t(s.act.verb)}${s.act.what ? ` ${s.act.what}` : ''}`);
        this.act.setAttribute('aria-keyshortcuts', 'E');
      }
    }
    this.act.style.setProperty('--cut', String(s.cut));
    this.act.classList.toggle('cutting', s.cut > 0);
    this.stoneBtn.classList.toggle('hidden', s.stone < 0);
    this.stoneBtn.classList.toggle('cooling', s.stone >= 0 && s.stone < 1);
    this.stoneBtn.style.setProperty('--ready', String(Math.max(0, s.stone)));
  }
}
