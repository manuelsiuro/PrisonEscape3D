import { t, type Key } from '../../i18n';
import { h } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { MAP_H, MAP_W } from '../../sim/world/grid';
import { CITY_N, CITY_W, gateOpen, LANES, laneAt, neighbour, ROAD_W, SIDE } from '../gen/plan';
import type { City } from '../sim/City';
import { MODE } from '../sim/City';
import { LANDMARKS, paintDistrict, useColour } from './mapPaint';

/** A screen over the game: shown until one of its `[data-c]` buttons is pressed (Escape: `esc`). */
function modal<T extends string>(html: string, esc: T, focus: string, setup?: (el: HTMLElement) => void): Promise<T> {
  const el = h('div', 'modal', html);
  setup?.(el);
  return new Promise((resolve) => {
    const done = (c: T) => {
      removeEventListener('keydown', key);
      el.remove();
      resolve(c);
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || (esc === 'close' && e.code === 'KeyM' && !e.repeat)) done(esc);
    };
    addEventListener('keydown', key);
    el.onclick = (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
      if (btn?.dataset.pick) {
        for (const b of el.querySelectorAll('[data-pick]')) b.setAttribute('aria-pressed', String(b === btn));
        return;
      }
      if (btn) done(btn.dataset.c as T);
      else if (e.target === el) done(esc);
    };
    document.body.append(el);
    el.querySelector<HTMLElement>(focus)?.focus();
  });
}

/** A new city: what it is, and how death is taken (chosen once). Null: not now. */
export async function showNewCity(click: () => void): Promise<number | null> {
  let mode: number = MODE.SURVIVOR;
  const choice = await modal<'start' | 'back'>(
    `<div class="card city-new">
      <h2>${icon('map', 20)}${t('city.title')}</h2>
      <p class="card-note">${t('city.new.about')}</p>
      <div class="city-modes" role="group" aria-label="${t('city.new.mode')}">
        <button class="city-mode" data-c="mode" data-pick="${MODE.SURVIVOR}" aria-pressed="true">${icon('heart', 20)}<b>${t('city.mode.survivor')}</b><small>${t('city.mode.survivorSub')}</small></button>
        <button class="city-mode" data-c="mode" data-pick="${MODE.HARDCORE}" aria-pressed="false">${icon('flame', 20)}<b>${t('city.mode.hardcore')}</b><small>${t('city.mode.hardcoreSub')}</small></button>
      </div>
      <p class="card-note city-preview">${icon('wrench', 14)}${t('city.preview')}</p>
      <div class="actions">
        <button class="big-btn ghost" data-c="back">${icon('chevronLeft', 18)}${t('city.new.back')}</button>
        <button class="big-btn primary" data-c="start">${icon('play', 18)}${t('city.new.start')}</button>
      </div>
    </div>`,
    'back',
    '[data-c="start"]',
    (el) =>
      el.addEventListener('click', (e) => {
        const pick = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]')?.dataset.pick;
        if (pick !== undefined) {
          click();
          mode = Number(pick);
        }
      }),
  );
  click();
  return choice === 'start' ? mode : null;
}

/** City Escape's own menu, a city in progress: carry on, a new one, or back. */
export async function showCityMenu(where: string, click: () => void): Promise<'continue' | 'new' | 'back'> {
  const el = `<div class="card city-new">
      <h2>${icon('map', 20)}${t('city.title')}</h2>
      <p class="card-note">${t('city.tagline')}</p>
      <div class="city-menu">
        <button class="hero-card play-card" data-c="continue"><span class="hero-ic">${icon('play', 22)}</span><span class="hero-text"><b>${t('title.continue')}</b><small></small></span></button>
        <button class="menu-btn" data-c="new" style="--tone:var(--orange);--tone-2:var(--orange-2)"><span class="menu-ic">${icon('replay', 18)}</span><span class="menu-text"><span class="menu-label">${t('city.new.title')}</span></span>${icon('chevronRight', 16)}</button>
      </div>
      <div class="actions"><button class="big-btn ghost" data-c="back">${icon('chevronLeft', 18)}${t('city.new.back')}</button></div>
    </div>`;
  const choice = await modal<'continue' | 'new' | 'back'>(el, 'back', '[data-c="continue"]', (m) => {
    m.querySelector('.hero-text small')!.textContent = where;
  });
  click();
  return choice;
}

/** The story so far, before the first steps. */
export async function showCityIntro(click: () => void): Promise<void> {
  await modal<'go'>(
    `<div class="card city-intro">
      <h2>${t('city.intro.title')}</h2>
      <p>${t('city.intro.one')}</p>
      <p>${t('city.intro.two')}</p>
      <p>${t('city.intro.three')}</p>
      <div class="actions"><button class="big-btn primary" data-c="go">${icon('walk', 18)}${t('city.intro.go')}</button></div>
    </div>`,
    'go',
    '[data-c="go"]',
  );
  click();
}

/** A tile's size on the city's map (CSS pixels are the canvas's own: it's scaled to fit). */
const GAP = 4;

/**
 * The city's map: the nine districts as seen so far (a district never entered is dark, its name
 * unknown), the streets that cross between them, the walls where none does, the sea, and the player.
 */
export async function showCityMap(city: City, click: () => void): Promise<void> {
  const plan = city.plan;
  const size = CITY_W * MAP_W + (CITY_W + 1) * GAP;
  const names = Array.from({ length: CITY_N }, (_, d) => {
    const been = ((city.state.visited >> d) & 1) === 1;
    const here = d === city.state.district;
    const pct = Math.round(city.seenShare(d) * 100);
    return `<li class="${here ? 'here' : ''}${been ? '' : ' unknown'}">${
      been
        ? `<b>${plan.names[d]}</b><small>${t(`city.kind.${plan.kinds[d]}` as Key)} · ${t('city.map.seen', { n: pct })}</small>`
        : `<b>${t('city.map.unknown')}</b><small>&nbsp;</small>`
    }</li>`;
  }).join('');
  const legend = LANDMARKS.map((u) => `<li><i style="background:${useColour(u)}"></i>${t(`city.use.${u}` as Key)}</li>`).join('');
  await modal<'close'>(
    `<div class="card city-map">
      <h2>${icon('map', 20)}${t('city.map.title')}</h2>
      <div class="city-map-body">
        <div class="city-map-pic"><canvas width="${size}" height="${size}" role="img" aria-label="${t('city.map.title')}"></canvas><ol class="city-map-names" aria-hidden="true">${names}</ol></div>
        <ul class="city-map-legend">${legend}<li><i class="lg-gate"></i>${t('city.map.gate')}</li><li><i class="lg-wall"></i>${t('city.map.wall')}</li><li><i class="lg-you"></i>${t('city.map.you')}</li></ul>
      </div>
      <div class="actions"><button class="big-btn primary" data-c="close">${icon('check', 18)}${t('city.map.close')}</button></div>
    </div>`,
    'close',
    '[data-c="close"]',
    (el) => {
      const c = el.querySelector('canvas')!.getContext('2d')!;
      c.fillStyle = '#07090c';
      c.fillRect(0, 0, size, size);
      for (let d = 0; d < CITY_N; d++) {
        const ox = GAP + (d % CITY_W) * (MAP_W + GAP);
        const oz = GAP + Math.floor(d / CITY_W) * (MAP_H + GAP);
        c.putImageData(paintDistrict(city.districtOf(d), city.seen[d]), ox, oz);
        // The streets across to the east and the south, once either side has been walked into.
        for (const side of [SIDE.E, SIDE.S]) {
          const n = neighbour(d, side);
          if (n < 0 || (((city.state.visited >> d) | (city.state.visited >> n)) & 1) === 0) continue;
          for (let k = 0; k < LANES; k++) {
            if (!gateOpen(plan, d, side, k)) continue;
            const at = laneAt(plan, d, side, k);
            c.fillStyle = '#f2c230';
            if (side === SIDE.E) c.fillRect(ox + MAP_W, oz + at, GAP, ROAD_W);
            else c.fillRect(ox + at, oz + MAP_H, ROAD_W, GAP);
          }
        }
      }
      // The player: a ring round a dot, in their district.
      const d = city.state.district;
      const px = GAP + (d % CITY_W) * (MAP_W + GAP) + (city.tile % MAP_W) + 0.5;
      const pz = GAP + Math.floor(d / CITY_W) * (MAP_H + GAP) + Math.floor(city.tile / MAP_W) + 0.5;
      c.fillStyle = '#ffffff';
      c.beginPath();
      c.arc(px, pz, 2.2, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#ff5a4a';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(px, pz, 4.5, 0, Math.PI * 2);
      c.stroke();
    },
  );
  click();
}
