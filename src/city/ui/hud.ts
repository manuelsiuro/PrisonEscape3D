import { t, textStamp } from '../../i18n';
import { keyLabel } from '../../i18n/keys';
import { h, setText } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { MAP_H, MAP_W } from '../../sim/world/grid';
import { LEVEL } from '../content/light';

/** What City Escape's HUD shows (C1), worked out by the play layer each frame. */
export interface CityHudState {
  /** The district's name and what it is; where the player stands in it. */
  name: string;
  kind: string;
  place: string;
  day: number;
  time: string;
  night: boolean;
  /** The district's picture (what's been seen), and where the player is in it (tiles) and faces (radians). */
  picture: ImageData;
  pictureRev: number;
  x: number;
  z: number;
  /** Health, hunger and energy (0–1). */
  health: number;
  hunger: number;
  energy: number;
  /** How many of the dead are after the player. */
  chasing: number;
  /** 2.52: the light where the player stands (LEVEL; -1: by day, not shown), and the torch's minutes left while it's on (0: off). */
  light: number;
  torch: number;
  /** The story's line now ('' none), and where it points in this district (tiles; `marksKey` changes with them). */
  goal: string;
  marks: readonly number[];
  marksKey: string;
}

/** How much the corner map is enlarged: about a third of the district's width shows. */
const ZOOM = 3;

/**
 * City Escape's HUD (C1): along the top, where the player is (the district, the place in it) and
 * the clock (the day, the time, a sun or a moon), the pause; in the corner, the district's map as
 * seen so far, the tiles round the player under a dot in its middle; it opens the city's map (M).
 */
export class CityHud {
  readonly el: HTMLElement;
  private readonly name: HTMLElement;
  private readonly place: HTMLElement;
  private readonly day: HTMLElement;
  private readonly time: HTMLElement;
  private readonly sky: HTMLElement;
  private readonly mapBtn: HTMLButtonElement;
  private readonly canvas: HTMLCanvasElement;
  private shownRev = -1;
  private shownLight = '?';
  private shownChasing = -1;
  private meters: Record<string, number> = {};
  private shownNight: boolean | null = null;
  private lang = '';
  onPause: () => void = () => {};
  onMap: () => void = () => {};
  onJournal: () => void = () => {};
  private readonly goal: HTMLButtonElement;
  private readonly radio: HTMLElement;
  private shownGoal = '';
  private shownMarks = '?';
  private markEls: HTMLElement[] = [];
  /** Dispatch's lines waiting their turn, and the one up now. */
  private lines: string[] = [];
  private talking = 0;

  constructor() {
    this.el = h(
      'div',
      'hud city-hud hidden',
      `<div class="hud-row">
        <span class="pill big city-where" role="status"><i class="cw-ic">${icon('pin', 16)}</i><span class="cw-text"><b></b><small></small></span></span>
        <span class="pill big city-clock"><i class="cc-ic"></i><span class="cw-text"><b></b><small></small></span></span>
        <button class="icon-btn hud-pause city-pause">${icon('pause')}</button>
      </div>
      <div class="hud-row city-meters">
        <span class="city-meter cm-health" role="meter" aria-valuemin="0" aria-valuemax="100">${icon('heart', 14)}<i><i></i></i></span>
        <span class="city-meter cm-hunger" role="meter" aria-valuemin="0" aria-valuemax="100">${icon('utensils', 14)}<i><i></i></i></span>
        <span class="city-meter cm-energy" role="meter" aria-valuemin="0" aria-valuemax="100">${icon('bolt', 14)}<i><i></i></i></span>
        <span class="pill hud-alert city-chased hidden" role="status">${icon('siren', 15)}<span></span></span>
      </div>
      <div class="hud-row city-goal-row">
        <button class="pill city-goal hidden">${icon('clipboard', 15)}<span></span></button>
      </div>
      <div class="hud-row city-light-row">
        <span class="pill city-light hidden" role="status">${icon('flame', 14)}<span></span></span>
      </div>
      <div class="city-radio hidden" role="status" aria-live="polite">${icon('megaphone', 18)}<div><b></b><p></p></div></div>`,
    );
    const q = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
    this.name = q('.city-where b');
    this.place = q('.city-where small');
    this.time = q('.city-clock b');
    this.day = q('.city-clock small');
    this.sky = q('.cc-ic');
    q('.city-pause').addEventListener('click', () => this.onPause());
    this.goal = q<HTMLButtonElement>('.city-goal');
    this.goal.addEventListener('click', () => this.onJournal());
    this.radio = q('.city-radio');
    this.mapBtn = h('button', 'city-minimap hidden', `<canvas width="${MAP_W}" height="${MAP_H}"></canvas><i class="cm-dot"></i>`);
    this.canvas = this.mapBtn.querySelector('canvas')!;
    this.mapBtn.addEventListener('click', () => this.onMap());
    document.body.append(this.el, this.mapBtn);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    this.mapBtn.classList.toggle('hidden', !on);
    this.shownRev = -1;
    this.shownChasing = -1;
    this.shownLight = '?';
    this.shownNight = null;
    this.meters = {};
    this.shownGoal = '';
    this.shownMarks = '?';
    if (!on) {
      this.lines = [];
      clearTimeout(this.talking);
      this.talking = 0;
      this.radio.classList.add('hidden');
    }
  }

  /** Dispatch says a line: up for as long as it takes to read, the next after it. */
  say(text: string) {
    this.lines.push(text);
    if (!this.talking) this.next();
  }
  private next() {
    const text = this.lines.shift();
    this.talking = 0;
    this.radio.classList.toggle('hidden', !text);
    if (!text) return;
    setText(this.radio.querySelector('b')!, t('city.dispatch'));
    setText(this.radio.querySelector('p')!, text);
    this.radio.classList.remove('in');
    void this.radio.offsetWidth;
    this.radio.classList.add('in');
    this.talking = window.setTimeout(() => this.next(), Math.min(14000, 3500 + text.length * 55));
  }

  update(s: CityHudState) {
    if (textStamp() !== this.lang) {
      this.lang = textStamp();
      this.el.querySelector('.city-pause')!.setAttribute('aria-label', t('hud.pause'));
      this.mapBtn.setAttribute('aria-label', t('city.map.title'));
      this.mapBtn.setAttribute('aria-keyshortcuts', keyLabel('KeyM'));
    }
    setText(this.name, s.name);
    setText(this.place, s.place ? `${s.kind} · ${s.place}` : s.kind);
    setText(this.time, s.time);
    setText(this.day, t('city.hud.day', { n: s.day }));
    if (s.night !== this.shownNight) {
      this.shownNight = s.night;
      this.sky.innerHTML = icon(s.night ? 'moon' : 'sun', 16);
      this.el.querySelector('.city-clock')!.classList.toggle('night', s.night);
    }
    for (const [cls, v, label] of [
      ['cm-health', s.health, 'city.meter.health'],
      ['cm-hunger', s.hunger, 'city.meter.hunger'],
      ['cm-energy', s.energy, 'city.meter.energy'],
    ] as const) {
      const pct = Math.round(v * 100);
      if (this.meters[cls] === pct) continue;
      this.meters[cls] = pct;
      const el = this.el.querySelector<HTMLElement>(`.${cls}`)!;
      el.style.setProperty('--v', `${pct}%`);
      el.classList.toggle('low', pct <= 25);
      el.setAttribute('aria-valuenow', String(pct));
      el.setAttribute('aria-label', t(label));
    }
    if (s.chasing !== this.shownChasing) {
      this.shownChasing = s.chasing;
      const pill = this.el.querySelector<HTMLElement>('.city-chased')!;
      pill.classList.toggle('hidden', !s.chasing);
      if (s.chasing) setText(pill.querySelector('span')!, t(s.chasing === 1 ? 'city.chased.one' : 'city.chased.many', { n: s.chasing }));
    }
    const lightKey = s.light < 0 ? '' : `${s.light}:${s.light === LEVEL.DIM ? s.torch : 0}`;
    if (lightKey !== this.shownLight) {
      this.shownLight = lightKey;
      const pill = this.el.querySelector<HTMLElement>('.city-light')!;
      pill.classList.toggle('hidden', s.light < 0);
      pill.classList.toggle('dark', s.light === LEVEL.DARK);
      pill.classList.toggle('lit', s.light === LEVEL.LIT);
      if (s.light >= 0)
        setText(
          pill.querySelector('span')!,
          s.light === LEVEL.LIT
            ? t('city.light.lit')
            : s.light === LEVEL.DIM
              ? t('city.light.dim', { t: `${Math.floor(s.torch / 60)}:${String(s.torch % 60).padStart(2, '0')}` })
              : t('city.light.dark'),
        );
    }
    if (s.goal !== this.shownGoal) {
      this.shownGoal = s.goal;
      this.goal.classList.toggle('hidden', !s.goal);
      setText(this.goal.querySelector('span')!, s.goal);
      this.goal.setAttribute('aria-keyshortcuts', keyLabel('KeyJ'));
      this.goal.title = t('city.journal.open');
    }
    if (s.marksKey !== this.shownMarks) {
      this.shownMarks = s.marksKey;
      for (const el of this.markEls) el.remove();
      this.markEls = s.marks.map(() => h('i', 'cm-mark'));
      this.mapBtn.append(...this.markEls);
    }
    // (Where the story points: on the corner map, or at its edge toward it.)
    s.marks.forEach((tile, k) => {
      const mx = 50 + (((tile % MAP_W) + 0.5 - s.x) / MAP_W) * 100 * ZOOM;
      const mz = 50 + ((Math.floor(tile / MAP_W) + 0.5 - s.z) / MAP_H) * 100 * ZOOM;
      const el = this.markEls[k];
      el.style.left = `${Math.max(7, Math.min(93, mx)).toFixed(1)}%`;
      el.style.top = `${Math.max(7, Math.min(93, mz)).toFixed(1)}%`;
      el.classList.toggle('off', mx < 7 || mx > 93 || mz < 7 || mz > 93);
    });
    if (s.pictureRev !== this.shownRev) {
      this.shownRev = s.pictureRev;
      this.canvas.getContext('2d')!.putImageData(s.picture, 0, 0);
    }
    // The picture slid under the dot: a window on the tiles round the player (the whole city is the map's, M).
    this.canvas.style.transform = `translate(${(50 - (s.x / MAP_W) * 100 * ZOOM).toFixed(2)}%, ${(50 - (s.z / MAP_H) * 100 * ZOOM).toFixed(2)}%) scale(${ZOOM})`;
  }
}
