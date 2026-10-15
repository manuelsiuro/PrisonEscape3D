import { h } from '../dom';
import { icon } from '../icons';
import { t, type Key } from '../../i18n';

/** What the victory screen shows (GDD §13.2). */
export interface Victory {
  prison: string;
  day: number;
  time: string;
  /** The way out (ESCAPES name) and every way this prison has, with those found so far. */
  via: string;
  routes: readonly string[];
  found: readonly string[];
  newRoute: boolean;
  best: boolean;
  /** Walls chipped, tunnel tiles dug, guards knocked out, cash earned. */
  tally: readonly number[];
  /** The quickest escape's day (this one's, when it's the quickest). */
  bestDay: number;
}

export type VictoryChoice = 'again' | 'title';

/** Each way out's icon. */
const ROUTE_ICON: Record<string, string> = { fence: 'cutters', tunnel: 'shovel', roof: 'hook', takeover: 'users' };

/**
 * The victory screen (GDD §13.2): how the player got out, the days it took and the tally
 * (walls chipped, tunnel dug, guards knocked out, cash earned), the ways out of this prison
 * found so far; then play again or back to the title.
 */
export function showVictory(v: Victory, click: () => void): Promise<VictoryChoice> {
  const stat = (ic: string, n: string | number, label: Key) => `<div class="v-stat">${icon(ic, 18)}<b>${n}</b><small>${t(label)}</small></div>`;
  const [walls, dug, guards, cash] = v.tally;
  const pips = v.routes
    .map((r) => {
      const found = v.found.includes(r);
      return `<span class="v-route${found ? ' found' : ''}${r === v.via ? ' now' : ''}" title="${found ? t(`route.${r}` as Key) : t('victory.unknownRoute')}">${icon(found ? ROUTE_ICON[r] ?? 'star' : 'lock', 16)}</span>`;
    })
    .join('');
  const el = h(
    'div',
    'modal escaped victory',
    `<div class="card">
      <div class="escaped-icon">${icon('trophy', 34)}</div>
      <h2>${t('escaped.title')}</h2>
      <p class="v-sub"></p>
      <div class="v-method">${icon(ROUTE_ICON[v.via] ?? 'route', 20)}<span><small>${t('victory.method')}</small><b>${t(`route.${v.via}` as Key)}</b></span>${v.newRoute ? `<em>${t('victory.newRoute')}</em>` : ''}</div>
      <div class="v-stats">
        ${stat('clock', v.day, 'victory.days')}
        ${stat('pick', walls, 'victory.walls')}
        ${stat('shovel', dug, 'victory.dug')}
        ${stat('fist', guards, 'victory.guards')}
        ${stat('coin', `$${cash}`, 'victory.cash')}
        ${v.best ? stat('star', t('victory.bestYes'), 'victory.best') : stat('star', t('hud.day', { n: v.bestDay }), 'victory.bestWas')}
      </div>
      <div class="v-routes"><span class="v-routes-label"></span><span class="v-pips">${pips}</span></div>
      <div class="actions">
        <button class="big-btn primary" data-c="again">${icon('replay', 18)}${t('victory.again')}</button>
        <button class="big-btn ghost" data-c="title">${icon('home', 18)}${t('escaped.back')}</button>
      </div>
    </div>`,
  );
  // A burst of confetti behind the card (none with reduced motion: the stylesheet hides it).
  const burst = h('div', 'v-confetti');
  const colors = ['#ffc23d', '#f26b1d', '#3fb950', '#2fb6c8', '#ffffff', '#8e4fc4'];
  for (let k = 0; k < 36; k++) {
    const bit = document.createElement('i');
    bit.style.cssText = `--x:${(Math.random() * 100).toFixed(1)}vw;--d:${(Math.random() * 0.6).toFixed(2)}s;--t:${(1.8 + Math.random() * 1.4).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg;--s:${(Math.random() * 30 - 15).toFixed(0)}vw;background:${colors[k % colors.length]}`;
    burst.append(bit);
  }
  el.prepend(burst);
  el.querySelector('.v-sub')!.textContent = t('escaped.sub', { prison: v.prison, day: v.day, time: v.time });
  el.querySelector('.v-routes-label')!.textContent = t('victory.routes', { n: v.found.length, of: v.routes.length });
  return new Promise((resolve) => {
    el.onclick = (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c as VictoryChoice | undefined;
      if (!c) return;
      click();
      el.remove();
      resolve(c);
    };
    document.body.append(el);
    el.querySelector<HTMLElement>('[data-c="again"]')?.focus();
  });
}
