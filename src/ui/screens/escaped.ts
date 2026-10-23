import { h } from '../dom';
import { routeIcon } from './trophies';
import { icon } from '../icons';
import { listOf, t, type Key } from '../../i18n';
import type { Achievement } from '../../content/achievements';
import type { Medal } from '../../content/medals';
import { medalDisc } from './trophies';

/** What the victory screen shows (GDD §13.2). */
export interface Victory {
  prison: string;
  /** Its id (the icons). */
  prisonId: string;
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
  /** The next prison in the campaign, opened by this escape (its name and security level), offered to go on to. */
  unlocked?: { name: string; security: string };
  /** The last prison broken out of for the first time (P12): every prison of the campaign beaten. */
  campaign?: boolean;
  /** P16: the medal this escape earned (null: too slow), whether it's the route's best yet, and the day bronze needed. */
  medal?: Medal | null;
  newMedal?: boolean;
  routeBest?: boolean;
  bronzeBy?: number;
  /** Achievements this escape earned. */
  earned?: readonly Achievement[];
  /** The crew who got out too (P23), by name. */
  crew?: readonly string[];
  /** P34: away in cousin Lou's car. */
  wheels?: boolean;
  /** P25: the escape can be watched again (its replay). */
  watch?: boolean;
  /**
   * P41, the manhunt: offered (Keep running or Skip), skipped, or how it went (safe or caught;
   * how close it got, the seconds out there, where it ended: the safe point's kind or 'lou').
   * `goal` is the safe point's kind; `lou`: his car waits out there.
   */
  hunt?: { state: 'offer' | 'skipped' | 'safe' | 'caught'; goal: string; lou?: boolean; progress?: number; secs?: number; reached?: string };
}

export type VictoryChoice = 'again' | 'next' | 'title' | 'watch' | 'run' | 'skip';

/** The manhunt's line on the card (P41): the offer, a clean getaway, or recaptured and how close. */
function huntRow(v: Victory): string {
  const hu = v.hunt;
  if (!hu || hu.state === 'skipped') return '';
  const time = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
  if (hu.state === 'offer') return `<div class="v-hunt offer">${icon('run', 20)}<span><b>${t('manhunt.offer')}</b><small>${t(hu.lou ? 'manhunt.offerLou' : 'manhunt.offerSub', { goal: t(`manhunt.goal.${hu.goal}` as Key) })}</small></span></div>`;
  if (hu.state === 'safe') return `<div class="v-hunt safe" role="status"><span class="v-star">${icon('star', 20)}</span><span><b>${t('manhunt.clean')}</b><small>${t(`manhunt.awaySub.${hu.reached === 'lou' ? 'lou' : hu.goal}` as Key)} · ${time(hu.secs ?? 0)}</small></span></div>`;
  return `<div class="v-hunt caught" role="status">${icon('siren', 20)}<span><b>${t('manhunt.caught')}</b><small>${t('manhunt.caughtCard', { n: Math.round((hu.progress ?? 0) * 100), goal: t(`manhunt.goal.${hu.goal}` as Key) })}</small></span></div>`;
}

/** The medal won (P16), or how quick bronze needed to be. */
function medalRow(v: Victory): string {
  if (v.medal === undefined) return '';
  if (!v.medal) return v.bronzeBy ? `<div class="v-medal none">${medalDisc(null, 30)}<span><b>${t('victory.noMedal')}</b><small>${t('victory.bronzeBy', { n: v.bronzeBy })}</small></span></div>` : '';
  return `<div class="v-medal ${v.medal}">${medalDisc(v.medal, 34)}<span><b>${t(`medal.${v.medal}` as Key)}</b><small>${t(v.newMedal ? 'victory.medalNew' : 'victory.medalKept')}</small></span></div>`;
}

/** Achievements the escape earned (P16): a chip each, the first few. */
export function earnedRow(list: readonly Achievement[]): string {
  if (!list.length) return '';
  const shown = list.slice(0, 5);
  const more = list.length - shown.length;
  return `<div class="v-earned"><small>${t('victory.earned')}</small><div>${shown.map((a) => `<span class="v-ach">${icon(a.icon, 14)}${t(`ach.${a.id}` as Key)}</span>`).join('')}${more > 0 ? `<span class="v-ach more" aria-label="${t('victory.earnedMore', { n: more })}">+${more}</span>` : ''}</div></div>`;
}

/**
 * The victory screen (GDD §13.2): how the player got out, the days it took and the tally
 * (walls chipped, tunnel dug, guards knocked out, cash earned), the ways out of this prison
 * found so far; then play again or back to the title (or watch it again, P25: `back`, the card
 * shown again after the replay, without its confetti).
 */
export function showVictory(v: Victory, click: () => void, back = false): Promise<VictoryChoice> {
  const stat = (ic: string, n: string | number, label: Key) => `<div class="v-stat">${icon(ic, 18)}<b>${n}</b><small>${t(label)}</small></div>`;
  const [walls, dug, guards, cash] = v.tally;
  const pips = v.routes
    .map((r) => {
      const found = v.found.includes(r);
      return `<span class="v-route${found ? ' found' : ''}${r === v.via ? ' now' : ''}" title="${found ? t(`route.${r}` as Key) : t('victory.unknownRoute')}">${icon(found ? routeIcon(r, v.prisonId) : 'lock', 16)}</span>`;
    })
    .join('');
  const el = h(
    'div',
    `modal escaped victory${back ? ' back' : ''}`,
    `<div class="card">
      <div class="escaped-icon">${icon('trophy', 34)}</div>
      <h2>${t('escaped.title')}</h2>
      <p class="v-sub"></p>
      <div class="v-left">
      <div class="v-method">${icon(routeIcon(v.via, v.prisonId), 20)}<span><small>${t('victory.method')}</small><b>${t(`route.${v.via}` as Key)}</b></span>${v.newRoute ? `<em>${t('victory.newRoute')}</em>` : ''}${v.watch && v.hunt?.state !== 'offer' ? `<button class="v-watch" data-c="watch" aria-label="${t('replay.watch')}" title="${t('replay.watch')}">${icon('film', 16)}<span>${t('replay.watchShort')}</span></button>` : ''}</div>
      ${v.wheels ? `<div class="v-crew">${icon('truck', 18)}<span>${t('victory.wheels')}</span></div>` : ''}
      ${v.crew?.length ? `<div class="v-crew">${icon('users', 18)}<span>${t(v.crew.length === 1 ? 'victory.crew1' : 'victory.crew', { names: listOf([...v.crew]) })}</span></div>` : ''}
      <div class="v-stats">
        ${stat('clock', v.day, 'victory.days')}
        ${stat('pick', walls, 'victory.walls')}
        ${stat('shovel', dug, 'victory.dug')}
        ${stat('fist', guards, 'victory.guards')}
        ${stat('coin', `$${cash}`, 'victory.cash')}
        ${v.best ? stat('star', t('victory.bestYes'), 'victory.best') : stat('star', t('hud.day', { n: v.bestDay }), 'victory.bestWas')}
      </div>
      </div>
      <div class="v-right">
      ${huntRow(v)}
      ${medalRow(v)}
      <div class="v-routes"><span class="v-routes-label"></span><span class="v-pips">${pips}</span></div>
      ${earnedRow(v.earned ?? [])}
      ${v.unlocked ? `<div class="v-unlock" role="status">${icon('map', 22)}<span><b></b><small></small></span></div>` : ''}
      ${v.campaign ? `<div class="v-unlock campaign" role="status">${icon('star', 22)}<span><b>${t('victory.campaign')}</b><small>${t('victory.campaignSub')}</small></span></div>` : ''}
      ${
        v.hunt?.state === 'offer'
          ? `<div class="actions v-hunt-actions">
        <button class="big-btn primary" data-c="run">${icon('run', 18)}${t('manhunt.keepRunning')}</button>
        <button class="big-btn ghost" data-c="skip">${icon('chevronRight', 18)}${t('manhunt.skip')}</button>
      </div>`
          : `<div class="actions">
        ${v.unlocked ? `<button class="big-btn primary" data-c="next">${icon('play', 18)}<span class="v-next"></span></button>` : ''}
        <button class="big-btn ${v.unlocked ? 'ghost' : 'primary'}" data-c="again">${icon('replay', 18)}${t('victory.again')}</button>
        <button class="big-btn ghost" data-c="title">${icon('home', 18)}${t('escaped.back')}</button>
      </div>`
      }
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
  if (!back) el.prepend(burst);
  el.querySelector('.v-sub')!.textContent = t('escaped.sub', { prison: v.prison, day: v.day, time: v.time });
  el.querySelector('.v-routes-label')!.textContent = t('victory.routes', { n: v.found.length, of: v.routes.length });
  if (v.unlocked) {
    el.querySelector('.v-unlock b')!.textContent = t('victory.unlocked', { name: v.unlocked.name });
    el.querySelector('.v-unlock small')!.textContent = v.unlocked.security;
    el.querySelector('.v-next')?.replaceChildren(t('victory.next', { name: v.unlocked.name }));
  }
  return new Promise((resolve) => {
    el.onclick = (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c as VictoryChoice | undefined;
      if (!c) return;
      click();
      el.remove();
      resolve(c);
    };
    document.body.append(el);
    el.querySelector<HTMLElement>(v.hunt?.state === 'offer' ? '[data-c="run"]' : back ? '[data-c="watch"]' : v.unlocked ? '[data-c="next"]' : '[data-c="again"]')?.focus();
  });
}
