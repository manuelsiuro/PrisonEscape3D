import { ACHIEVEMENT_GROUPS, ACHIEVEMENTS, type Achievement, type Career } from '../../content/achievements';
import { MEDAL_DAYS, MEDALS, type Medal } from '../../content/medals';
import type { Prisoner } from '../../content/prisoner';
import { escapesOf, PRISONS } from '../../content/prisons';
import { isOpen } from '../../game/campaign';
import { recordOf } from '../../game/records';
import { currentLang, t, type Key } from '../../i18n';
import { h } from '../dom';
import { icon } from '../icons';

/**
 * The trophy shelf (P16), from the title: your prisoner (and the way to the Intake), then
 * three tabs: the achievements by group (earned in gold, the rest with what they take; mishaps
 * a mystery until they happen), each prison's medals by way out, and the lifetime stats.
 * Resolves with 'intake' to edit your prisoner, or null when closed.
 */
type Tab = 'trophies' | 'medals' | 'stats';
const TABS: Tab[] = ['trophies', 'medals', 'stats'];

/** Each way out's icon (as on the victory card). */
export const ROUTE_ICON: Record<string, string> = { fence: 'cutters', tunnel: 'shovel', roof: 'hook', takeover: 'users', gate: 'key', raft: 'boat', helicopter: 'heli', stowaway: 'truck' };
/** A way out's icon in a prison (P18: Irongate's stowaway rides the helicopter). */
export const routeIcon = (route: string, prison: string) => (route === 'stowaway' && PRISONS.find((p) => p.id === prison)?.delivery?.vehicle === 'helicopter' ? 'heli' : (ROUTE_ICON[route] ?? 'route'));

/** The stats shown, in order: the stat, its icon, and how it's written. */
const STATS: Array<[string, string, ((n: number) => string)?]> = [
  ['games', 'play'],
  ['escapes', 'run'],
  ['days', 'sun'],
  ['walked', 'walk'],
  ['crafted', 'hammer'],
  ['walls', 'pick'],
  ['dug', 'shovel'],
  ['cash', 'coin', (n) => `$${n}`],
  ['wages', 'briefcase'],
  ['favors', 'gift'],
  ['bought', 'cart'],
  ['blows', 'fist'],
  ['koGuards', 'shield'],
  ['koInmates', 'users'],
  ['caught', 'siren'],
  ['solitary', 'potato'],
  ['lockdowns', 'bell'],
  ['spotted', 'eye'],
  ['maxHeat', 'flame', (n) => `${n}%`],
  ['rumors', 'ear'],
  ['thrown', 'toss'],
  ['bribes', 'hand'],
  ['chocolate', 'cookie'],
  ['meals', 'clock'],
];

/** A medal as a little disc (none: an empty ring). */
export const medalDisc = (m: Medal | null | undefined, size = 26) =>
  `<span class="medal ${m ?? 'none'}" style="--s:${size}px" role="img" aria-label="${t(m ? (`medal.${m}` as Key) : 'trophy.noMedal')}" ${m ? `title="${t(`medal.${m}` as Key)}"` : ''}>${m ? icon('star', Math.round(size * 0.5)) : ''}</span>`;

const fmt = (n: number) => new Intl.NumberFormat(currentLang()).format(n);

export interface Shelf {
  earned: Record<string, number>;
  unseen: readonly string[];
  career: Career;
  prisoner: Prisoner | null;
}

function achievementRow(a: Achievement, s: Shelf): string {
  const at = s.earned[a.id];
  const got = at !== undefined;
  const mystery = a.hidden && !got;
  const name = mystery ? t('trophy.mystery') : t(`ach.${a.id}` as Key);
  const desc = mystery ? t('trophy.mysteryD') : t(`ach.${a.id}.d` as Key);
  const prog = !got && a.progress ? a.progress(s.career) : null;
  const when = got ? new Intl.DateTimeFormat(currentLang(), { day: 'numeric', month: 'short', year: 'numeric' }).format(at) : '';
  return `<li class="ach${got ? ' got' : ''}${mystery ? ' mystery' : ''}">
    <span class="ach-medal" aria-hidden="true">${icon(mystery ? 'help' : a.icon, 22)}${got ? '' : `<i>${icon('lock', 11)}</i>`}</span>
    <span class="ach-text"><b>${mystery ? `<span aria-hidden="true">${name}</span><span class="sr-only">${t('trophy.mysterySr')}</span>` : name}${s.unseen.includes(a.id) ? `<em class="ach-new">${t('trophy.new')}</em>` : ''}<span class="sr-only">, ${t(got ? 'trophy.earnedSr' : 'trophy.lockedSr')}</span></b><small>${desc}</small>
      ${prog ? `<span class="ach-bar" role="progressbar" aria-label="${t(`ach.${a.id}` as Key)}" aria-valuemin="0" aria-valuemax="${prog[1]}" aria-valuenow="${prog[0]}"><i style="width:${(100 * prog[0]) / prog[1]}%"></i></span><small class="ach-count">${fmt(prog[0])} / ${fmt(prog[1])}</small>` : ''}
      ${a.gives && !mystery ? `<small class="ach-gift">${icon('shirt', 12)}${t(got ? 'trophy.gave' : 'trophy.unlocks', { what: t(`look.${a.gives}` as Key) })}</small>` : ''}
    </span>
    ${got ? `<small class="ach-when">${when}</small>` : ''}
  </li>`;
}

function trophiesTab(s: Shelf): string {
  return ACHIEVEMENT_GROUPS.map((g) => {
    const list = ACHIEVEMENTS.filter((a) => a.group === g);
    const got = list.filter((a) => a.id in s.earned).length;
    return `<h3 class="shelf-sub">${t(`achGroup.${g}` as Key)}<span>${got} / ${list.length}</span></h3><ul class="ach-list">${list.map((a) => achievementRow(a, s)).join('')}</ul>`;
  }).join('');
}

function medalsTab(): string {
  // Prisons still shut: one line for them all (no spoilers of their ways out).
  const shut = PRISONS.filter((_, k) => !isOpen(k)).length;
  const more = shut ? `<section class="medal-prison locked"><h3 class="shelf-sub">${icon('lock', 14)}${t('trophy.prisonsLocked', { n: shut })}</h3></section>` : '';
  return PRISONS.map((p, k) => {
    if (!isOpen(k)) return '';
    const r = recordOf(p.id);
    const rows = escapesOf(p)
      .map((route) => {
        const found = r.routes.includes(route);
        const b = r.byRoute[route];
        const days = MEDAL_DAYS[p.id]?.[route];
        // Each medal named (not by its colour alone): "Gold by day 3".
        const goal = days ? MEDALS.map((m, j) => `<span class="mg ${m}">${t(`trophy.${m}By` as Key, { n: days[j] })}</span>`).join('') : '';
        return `<li class="medal-row${found ? '' : ' unfound'}">
          <span class="mr-ic" aria-hidden="true">${icon(found ? routeIcon(route, p.id) : 'lock', 18)}</span>
          <span class="mr-text"><b>${found ? t(`route.${route}` as Key) : t('victory.unknownRoute')}</b><small>${goal}</small></span>
          <span class="mr-best">${b ? t('hud.day', { n: b.day }) : found ? t('trophy.dayUnknown') : '—'}</span>
          ${medalDisc(b?.medal)}
        </li>`;
      })
      .join('');
    return `<section class="medal-prison"><h3 class="shelf-sub">${t(`prison.${p.id}` as Key)}<span>${r.routes.length} / ${escapesOf(p).length}</span></h3><ul class="medal-list">${rows}</ul></section>`;
  }).join('') + more;
}

function statsTab(s: Shelf): string {
  const st = s.career.stats;
  const cards = STATS.map(([k, ic, write]) => `<li class="stat"><span class="stat-ic">${icon(ic, 18)}</span><b>${write ? write(st[k] ?? 0) : fmt(st[k] ?? 0)}</b><small>${t(`stat.${k}` as Key)}</small></li>`).join('');
  return `<ul class="stat-grid">${cards}</ul><p class="help-foot">${t('trophy.statsNote')}</p>`;
}

export type ShelfTab = Tab;

/** `start`: the tab shown; `fromIntake`: back from the Intake (its button keeps the focus). */
export function showTrophies(shelf: Shelf, click: () => void, start: Tab = 'trophies', fromIntake = false): Promise<{ to: 'intake'; tab: Tab } | null> {
  let tab = start;
  const got = ACHIEVEMENTS.filter((a) => a.id in shelf.earned).length;
  const medals = shelf.career.prisons.flatMap((p) => p.medals);
  const count = (m: Medal) => medals.filter((x) => x === m).length;
  const name = shelf.prisoner?.name;
  const el = h(
    'div',
    'modal shelf-modal',
    `<div class="card shelf-card" role="dialog" aria-modal="true" aria-labelledby="shelf-title">
      <div class="settings-head"><h2 id="shelf-title">${t('trophy.title')}</h2><button class="icon-btn" data-done aria-label="${t('common.close')}">${icon('close')}</button></div>
      <button class="shelf-you" data-intake>
        <span class="sy-ic">${icon('shirt', 20)}</span>
        <span class="sy-text"><b></b><small>${t(shelf.prisoner ? 'trophy.editYou' : 'trophy.makeYou')}</small></span>
        ${icon('chevronRight', 16)}
      </button>
      <div class="shelf-sum">
        <span class="ss-count">${icon('trophy', 16)}<b>${got}</b>/${ACHIEVEMENTS.length}</span>
        ${MEDALS.map((m) => `<span class="ss-medal">${medalDisc(m, 18)}<b>${count(m)}</b><span class="sr-only">${t(`medal.${m}` as Key)}</span></span>`).join('')}
      </div>
      <div class="seg help-tabs" role="tablist">${TABS.map((k) => `<button role="tab" id="shelf-tab-${k}" aria-controls="shelf-pane" data-tab="${k}">${t(`trophy.tab.${k}` as Key)}</button>`).join('')}</div>
      <div class="help-body shelf-body" id="shelf-pane" role="tabpanel" tabindex="-1"></div>
    </div>`,
  );
  el.querySelector('.sy-text b')!.textContent = name || t(shelf.prisoner ? 'trophy.noName' : 'trophy.makeYou');
  // No prisoner yet: the one line says it all.
  if (!shelf.prisoner) el.querySelector('.sy-text small')!.remove();
  const pane = el.querySelector<HTMLElement>('.shelf-body')!;
  const show = () => {
    for (const b of el.querySelectorAll<HTMLElement>('[data-tab]')) {
      b.classList.toggle('on', b.dataset.tab === tab);
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    }
    pane.innerHTML = tab === 'trophies' ? trophiesTab(shelf) : tab === 'medals' ? medalsTab() : statsTab(shelf);
    pane.setAttribute('aria-labelledby', `shelf-tab-${tab}`);
    pane.scrollTop = 0;
  };
  show();
  return new Promise((resolve) => {
    const done = (v: { to: 'intake'; tab: Tab } | null) => {
      click();
      removeEventListener('keydown', key, true);
      el.remove();
      resolve(v);
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.stopImmediatePropagation();
        done(null);
      }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
        e.stopImmediatePropagation();
        tab = TABS[(TABS.indexOf(tab) + (e.code === 'ArrowLeft' ? TABS.length - 1 : 1)) % TABS.length];
        click();
        show();
      }
    };
    addEventListener('keydown', key, true);
    el.onclick = (e) => {
      const target = e.target as HTMLElement;
      const k = target.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
      if (k && k !== tab) {
        click();
        tab = k;
        return show();
      }
      if (target.closest('[data-intake]')) return done({ to: 'intake', tab });
      if (target.closest('[data-done]') || target === el) done(null);
    };
    document.body.append(el);
    (fromIntake ? el.querySelector<HTMLElement>('[data-intake]') : pane)?.focus();
  });
}
