import { t, textStamp } from '../../i18n';
import { keyLabel } from '../../i18n/keys';
import { h, setText } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { MAP_H, MAP_W } from '../../sim/world/grid';

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
  private shownNight: boolean | null = null;
  private lang = '';
  onPause: () => void = () => {};
  onMap: () => void = () => {};

  constructor() {
    this.el = h(
      'div',
      'hud city-hud hidden',
      `<div class="hud-row">
        <span class="pill big city-where" role="status"><i class="cw-ic">${icon('pin', 16)}</i><span class="cw-text"><b></b><small></small></span></span>
        <span class="pill big city-clock"><i class="cc-ic"></i><span class="cw-text"><b></b><small></small></span></span>
        <button class="icon-btn hud-pause city-pause">${icon('pause')}</button>
      </div>`,
    );
    const q = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
    this.name = q('.city-where b');
    this.place = q('.city-where small');
    this.time = q('.city-clock b');
    this.day = q('.city-clock small');
    this.sky = q('.cc-ic');
    q('.city-pause').addEventListener('click', () => this.onPause());
    this.mapBtn = h('button', 'city-minimap hidden', `<canvas width="${MAP_W}" height="${MAP_H}"></canvas><i class="cm-dot"></i>`);
    this.canvas = this.mapBtn.querySelector('canvas')!;
    this.mapBtn.addEventListener('click', () => this.onMap());
    document.body.append(this.el, this.mapBtn);
  }

  show(on: boolean) {
    this.el.classList.toggle('hidden', !on);
    this.mapBtn.classList.toggle('hidden', !on);
    this.shownRev = -1;
    this.shownNight = null;
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
    if (s.pictureRev !== this.shownRev) {
      this.shownRev = s.pictureRev;
      this.canvas.getContext('2d')!.putImageData(s.picture, 0, 0);
    }
    // The picture slid under the dot: a window on the tiles round the player (the whole city is the map's, M).
    this.canvas.style.transform = `translate(${(50 - (s.x / MAP_W) * 100 * ZOOM).toFixed(2)}%, ${(50 - (s.z / MAP_H) * 100 * ZOOM).toFixed(2)}%) scale(${ZOOM})`;
  }
}
