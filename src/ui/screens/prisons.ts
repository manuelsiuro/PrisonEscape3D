import { PRISONS, escapesOf } from '../../content/prisons';
import type { PrisonDef } from '../../content/prisons/types';
import { isOpen } from '../../game/campaign';
import { recordOf } from '../../game/records';
import { t, type Key } from '../../i18n';
import { h } from '../dom';
import { icon } from '../icons';

/** Each way out's icon (as on the victory screen). */
const ROUTE_ICON: Record<string, string> = { fence: 'cutters', tunnel: 'shovel', roof: 'hook', takeover: 'users', gate: 'key', raft: 'boat', helicopter: 'heli' };

/** The prison's name, and its security level in words ("Medium security"). */
export const prisonName = (def: PrisonDef) => t(`prison.${def.id}` as Key);
export const securityOf = (def: PrisonDef) => t(`security.${def.difficulty}` as Key);

/**
 * The campaign (GDD §13.1): a card per prison, in order, with its security level, what makes
 * it what it is, and the ways out found there; the next one locked until the one before it is
 * escaped. Resolves with the prison picked, or null when closed.
 */
export function showPrisons(click: () => void): Promise<PrisonDef | null> {
  const el = h('div', 'modal prisons-modal');
  const cards = PRISONS.map((def, k) => {
    const open = isOpen(k);
    const rec = recordOf(def.id);
    const routes = escapesOf(def);
    const stars = Array.from({ length: 5 }, (_, i) => `<i class="${i < def.difficulty ? 'on' : ''}">${icon('star', 12)}</i>`).join('');
    const pips = routes.map((r) => `<span class="pc-pip${rec.routes.includes(r) ? ' found' : ''}">${icon(rec.routes.includes(r) ? ROUTE_ICON[r] ?? 'star' : 'lock', 13)}</span>`).join('');
    const foot = open
      ? `<span class="pc-pips" role="img" aria-label="${t('title.record', { n: rec.routes.length, of: routes.length })}">${pips}</span><small>${rec.routes.length ? t('prisons.best', { n: rec.bestDay }) : t('prisons.fresh')}</small>`
      : `<span class="pc-lock">${icon('lock', 14)}${t('prisons.locked', { name: prisonName(PRISONS[k - 1]) })}</span>`;
    // Locked cards stay focusable (aria-disabled), so a keyboard can reach what opens them.
    return `<button class="prison-card theme-${def.theme ?? 'suburban'}${open ? '' : ' locked'}" data-k="${k}" ${open ? '' : 'aria-disabled="true"'} style="--i:${k}">
      <span class="pc-scene" aria-hidden="true"><span class="pc-level">${k + 1}</span></span>
      <span class="pc-body">
        <span class="pc-head"><b>${prisonName(def)}</b><span class="pc-stars" aria-hidden="true">${stars}</span></span>
        <small class="pc-sec">${securityOf(def)}</small>
        <span class="pc-pitch">${t(`prisonInfo.${def.id}` as Key)}</span>
        <span class="pc-foot">${foot}</span>
      </span>
    </button>`;
  }).join('');
  el.innerHTML = `<div class="card prisons-card" role="dialog" aria-modal="true" aria-labelledby="prisons-title">
    <div class="settings-head"><h2 id="prisons-title">${t('prisons.title')}</h2><button class="icon-btn" data-close aria-label="${t('common.close')}">${icon('close')}</button></div>
    <p class="card-note">${t('prisons.note')}</p>
    <div class="prison-list">${cards}</div>
  </div>`;
  return new Promise((resolve) => {
    const done = (def: PrisonDef | null) => {
      removeEventListener('keydown', key, true);
      el.remove();
      resolve(def);
    };
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.stopImmediatePropagation();
      click();
      done(null);
    };
    addEventListener('keydown', key, true);
    el.onclick = (e) => {
      const target = e.target as HTMLElement;
      if (target === el || target.closest('[data-close]')) {
        click();
        return done(null);
      }
      const card = target.closest<HTMLButtonElement>('[data-k]');
      if (!card || card.getAttribute('aria-disabled') === 'true') return;
      click();
      done(PRISONS[Number(card.dataset.k)]);
    };
    document.body.append(el);
    // The furthest prison open is where the player is headed: focused (and in view).
    const open = el.querySelectorAll<HTMLButtonElement>('.prison-card:not(.locked)');
    const last = open[open.length - 1];
    last?.focus();
    // Scrolled to again once it has slid in (its entrance moves it while focus scrolls).
    last?.addEventListener('animationend', () => last.scrollIntoView({ block: 'nearest' }), { once: true });
  });
}
