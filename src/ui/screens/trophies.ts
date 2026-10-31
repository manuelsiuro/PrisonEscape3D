import { ACHIEVEMENT_GROUPS, ACHIEVEMENTS, type Achievement, type Career } from '../../content/achievements';
import { MEDAL_DAYS, MEDALS, type Medal } from '../../content/medals';
import type { Prisoner } from '../../content/prisoner';
import { escapesOf, prisonById, PRISONS } from '../../content/prisons';
import { isOpen } from '../../game/campaign';
import { recordOf } from '../../game/records';
import { readPrisoner } from '../../game/prisoner';
import { FILE_MAX, readReplayFile, replayDay, replayFile, replayFileName, replaysKept, type Replay } from '../../game/replays';
import type { RunLog } from '../../sim/runlog';
import { clockAt, formatTime } from '../../sim/systems/clock';
import { STEPS_PER_MINUTE } from '../../sim/tuning';
import { currentLang, t, type Key } from '../../i18n';
import { h } from '../dom';
import { icon } from '../icons';

/**
 * The trophy shelf (P16), from the title: your prisoner (and the way to the Intake), then
 * three tabs: the achievements by group (earned in gold, the rest with what they take; mishaps
 * a mystery until they happen), each prison's medals by way out (and the escapes to watch
 * again, P25), and the lifetime stats. Resolves with 'intake' to edit your prisoner, a replay
 * to watch, or null when closed.
 */
type Tab = 'trophies' | 'medals' | 'stats';
const TABS: Tab[] = ['trophies', 'medals', 'stats'];

/** Each way out's icon (as on the victory card). */
const ROUTE_ICON: Record<string, string> = { fence: 'cutters', tunnel: 'shovel', roof: 'hook', takeover: 'users', gate: 'key', raft: 'boat', helicopter: 'heli', stowaway: 'truck', bluff: 'idCard', glider: 'glider', paperwork: 'clipboard', parole: 'scale' };
/** A way out's icon in a prison (P18: Irongate's stowaway rides the helicopter). */
export const routeIcon = (route: string, prison: string) => (route === 'stowaway' && prisonById(prison)?.delivery?.vehicle === 'helicopter' ? 'heli' : (ROUTE_ICON[route] ?? 'route'));

/** A stat shown: the stat, its icon, and how it's written. */
type StatDef = [string, string, ((n: number) => string)?];
/** The stats by group, in order, each an even count (no card alone on a row); the escapes, days served and the records lead, as the headline. */
const STAT_GROUPS: Array<[string, string, StatDef[]]> = [
  // P41: the manhunts run, the clean getaways, the recaptures.
  ['escapes', 'run', [['games', 'play'], ['hunts', 'map'], ['getaways', 'star'], ['recaptured', 'lock'], ['dailies', 'calendar'], ['dailyStreak', 'flame']]],
  ['inside', 'sun', [['walked', 'walk'], ['meals', 'utensils'], ['chocolate', 'cookie'], ['rumors', 'ear'], ['favors', 'gift']]],
  ['money', 'coin', [['cash', 'coin', (n) => `$${fmt(n)}`], ['wages', 'briefcase'], ['bought', 'cart'], ['bribes', 'hand']]],
  ['tools', 'hammer', [['crafted', 'hammer'], ['walls', 'pick'], ['dug', 'shovel'], ['thrown', 'toss']]],
  ['trouble', 'siren', [['blows', 'fist'], ['koGuards', 'shield'], ['koInmates', 'users'], ['caught', 'siren'], ['spotted', 'eye'], ['solitary', 'potato'], ['lockdowns', 'bell'], ['maxHeat', 'flame', (n) => `${n}%`]]],
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

/** One replay kept: which escape, and its buttons (watch it, save it as a file). */
function replayRow(id: string, label: string, log: RunLog, quickest = false): string {
  const prison = t(`prison.${log.prison}` as Key);
  const where = [log.daily !== undefined ? t('daily.name', { n: log.daily + 1 }) : '', prison, log.via ? t(`route.${log.via}` as Key) : '', t('hud.day', { n: replayDay(log) }), quickest ? t('replay.quickest') : ''].filter(Boolean).join(' · ');
  return `<li class="replay-row">
    <span class="rr-ic" aria-hidden="true">${icon(log.via ? routeIcon(log.via, log.prison) : 'film', 18)}</span>
    <span class="rr-text"><b>${label}</b><small>${where}</small></span>
    <button class="rr-watch" data-watch="${id}" aria-label="${t('replay.rowLabel', { act: t('replay.watch'), what: `${label}, ${where}` })}">${icon('play', 14)}<span>${t('replay.watchShort')}</span></button>
    <button class="icon-btn rr-save" data-save="${id}" aria-label="${t('replay.rowLabel', { act: t('replay.save'), what: `${label}, ${where}` })}" title="${t('replay.save')}">${icon('save', 18)}</button>
  </li>`;
}

/** The escapes to watch again (P25): the last, each prison's quickest; a replay file to open. */
function replaysBlock(): string {
  const kept = replaysKept();
  const same = (a: RunLog, b: RunLog) => a.prison === b.prison && a.from === b.from && a.steps === b.steps && a.data === b.data;
  const rows = [kept.last ? replayRow('last', t('replay.last'), kept.last, kept.best.some((b) => same(b.log, kept.last!))) : '', ...kept.best.filter((b) => !kept.last || !same(b.log, kept.last)).map((b) => replayRow(b.prison, t('replay.best'), b.log))].join('');
  return `<section class="replays"><h3 class="shelf-sub">${icon('film', 14)}${t('replay.list')}</h3>
    ${rows ? `<ul class="replay-list">${rows}</ul>` : `<p class="replay-none">${t('replay.none')}</p>`}
    <div class="replay-open"><button class="rr-open" data-open>${icon('folder', 16)}<span>${t('replay.open')}</span></button><input type="file" class="replay-file" accept=".json,application/json" tabindex="-1" aria-hidden="true" hidden><span class="replay-msg" role="status"></span></div>
  </section>`;
}

/** A replay kept, by its row's id ('last', else the prison's quickest). */
function keptLog(id: string): RunLog | null {
  const kept = replaysKept();
  return id === 'last' ? kept.last : (kept.best.find((b) => b.prison === id)?.log ?? null);
}

/** Saves a text as a file (the browser's download). */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
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
          ${b?.clean ? `<span class="mr-clean" role="img" aria-label="${t('trophy.cleanSr')}" title="${t('manhunt.clean')}">${icon('star', 14)}</span>` : ''}
          ${medalDisc(b?.medal)}
        </li>`;
      })
      .join('');
    return `<section class="medal-prison"><h3 class="shelf-sub">${t(`prison.${p.id}` as Key)}<span>${r.routes.length} / ${escapesOf(p).length}</span></h3><ul class="medal-list">${rows}</ul>${r.crew ? `<p class="medal-crew">${icon('users', 14)}<span>${t('trophy.bestCrew', { n: r.crew })}</span></p>` : ''}</section>`;
  }).join('') + more;
}

export type ShelfResult = { to: 'intake'; tab: Tab } | { to: 'watch'; replay: Replay; tab: Tab; from: string } | null;

/** The quickest escape of all (an escape timed before minutes were kept counts at its day's end). */
function quickest(): { prison: string; route: string; day: number; minute: number } | null {
  let best: { prison: string; route: string; day: number; minute: number } | null = null;
  const at = (b: { day: number; minute: number }) => b.minute || b.day * 1440;
  for (const p of PRISONS) for (const [route, b] of Object.entries(recordOf(p.id).byRoute)) if (!best || at(b) < at(best)) best = { prison: p.id, route, day: b.day, minute: b.minute };
  return best;
}

/** One stat's card: its icon and number side by side, then what it counts (dimmed at zero); `more`: a line under it. */
function statCard(ic: string, value: number, shown: string, label: string, more = ''): string {
  return `<li class="stat${value ? '' : ' zero'}"><span class="stat-top"><span class="stat-ic">${icon(ic, 18)}</span><b>${shown}</b></span><small>${label}</small>${more}</li>`;
}

const share = (n: number, of: number) => `${fmt(n)}<span class="stat-of">/${fmt(of)}</span>`;

/** The lifetime stats: the headline (escapes, days, prisons escaped, the quickest), then each group. */
function statsTab(s: Shelf): string {
  const st = s.career.stats;
  const ps = s.career.prisons;
  const out = ps.filter((p) => p.routes.length).length;
  const fast = quickest();
  const where = fast ? `<em>${icon(routeIcon(fast.route, fast.prison), 13)}<span>${[t(`prison.${fast.prison}` as Key), fast.minute ? formatTime(clockAt(fast.minute * STEPS_PER_MINUTE)) : ''].filter(Boolean).join(' · ')}</span><span class="sr-only">, ${t(`route.${fast.route}` as Key)}</span></em>` : '';
  const hero = [
    statCard('run', st.escapes ?? 0, fmt(st.escapes ?? 0), t('stat.escapes')),
    statCard('sun', st.days ?? 0, fmt(st.days ?? 0), t('stat.days')),
    statCard('home', out, share(out, ps.length), t('stat.prisons')),
    statCard('clock', fast ? 1 : 0, fast ? `<span class="stat-day">${t('hud.day', { n: `<span>${fmt(fast.day)}</span>` })}</span>` : '—', t('stat.quickest'), where),
  ].join('');
  const medals = ps.flatMap((p) => p.medals);
  const routes = ps.reduce((n, p) => n + p.routes.length, 0);
  const extra: Record<string, string> = {
    escapes:
      statCard('route', routes, share(routes, ps.reduce((n, p) => n + p.of, 0)), t('stat.routes')) +
      statCard('trophy', medals.length, fmt(medals.length), t('stat.medals'), `<em class="stat-medals">${MEDALS.map((m) => `${medalDisc(m, 14)}<span>${medals.filter((x) => x === m).length}</span>`).join('')}</em>`),
    inside: statCard('book', s.career.lessons, share(s.career.lessons, s.career.lessonsOf), t('stat.lessons')),
  };
  const groups = STAT_GROUPS.map(([g, gic, list]) => {
    const cards = list.map(([k, ic, write]) => statCard(ic, st[k] ?? 0, write ? write(st[k] ?? 0) : fmt(st[k] ?? 0), t(`stat.${k}` as Key))).join('');
    return `<h3 class="shelf-sub">${icon(gic, 14)}${t(`statGroup.${g}` as Key)}</h3><ul class="stat-grid">${cards}${extra[g] ?? ''}</ul>`;
  }).join('');
  return `<ul class="stat-grid stat-hero">${hero}</ul>${groups}<p class="help-foot">${t('trophy.statsNote')}</p>`;
}

/** `start`: the tab shown; `focus`: back from the Intake or a replay, the button that opened it (a selector). */
export function showTrophies(shelf: Shelf, click: () => void, start: Tab = 'trophies', focus: string | null = null): Promise<ShelfResult> {
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
    pane.innerHTML = tab === 'trophies' ? trophiesTab(shelf) : tab === 'medals' ? replaysBlock() + medalsTab() : statsTab(shelf);
    pane.querySelector<HTMLInputElement>('.replay-file')?.addEventListener('change', openFile);
    pane.setAttribute('aria-labelledby', `shelf-tab-${tab}`);
    pane.scrollTop = 0;
  };
  /** A word under the replays (saved; a file that won't open). */
  const say = (text: string, bad = false) => {
    const m = pane.querySelector<HTMLElement>('.replay-msg');
    if (!m) return;
    m.textContent = text;
    m.classList.toggle('bad', bad);
  };
  let opened: ((r: Replay) => void) | null = null;
  /** A replay file chosen: read, checked, then watched (a guest's: it counts for nothing). */
  async function openFile(this: HTMLInputElement) {
    const f = this.files?.[0];
    this.value = '';
    if (!f) return;
    if (f.size > FILE_MAX) return say(t('replay.err.tooBig'), true);
    let text = '';
    try {
      text = await f.text();
    } catch {
      return say(t('replay.err.notReplay'), true);
    }
    const r = readReplayFile(text);
    if (typeof r === 'string') return say(t(`replay.err.${r}` as Key), true);
    opened?.(r);
  }
  show();
  return new Promise((resolve) => {
    const done = (v: ShelfResult) => {
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
    opened = (replay) => done({ to: 'watch', replay, tab, from: '[data-open]' });
    el.onclick = (e) => {
      const target = e.target as HTMLElement;
      const k = target.closest<HTMLElement>('[data-tab]')?.dataset.tab as Tab | undefined;
      if (k && k !== tab) {
        click();
        tab = k;
        return show();
      }
      if (target.closest('[data-intake]')) return done({ to: 'intake', tab });
      // The replays (P25): watch one, save one as a file, open one from a file.
      const watch = target.closest<HTMLElement>('[data-watch]')?.dataset.watch;
      if (watch) {
        const log = keptLog(watch);
        return log ? done({ to: 'watch', replay: { log, guest: false, by: null }, tab, from: `[data-watch="${watch}"]` }) : say(t('replay.cantPlay'), true);
      }
      const save = target.closest<HTMLElement>('[data-save]')?.dataset.save;
      if (save) {
        click();
        const log = keptLog(save);
        if (!log) return say(t('replay.cantPlay'), true);
        download(replayFileName(log), replayFile(log, readPrisoner()));
        return say(t('replay.saved'));
      }
      if (target.closest('[data-open]')) {
        click();
        return pane.querySelector<HTMLInputElement>('.replay-file')?.click();
      }
      if (target.closest('[data-done]') || target === el) done(null);
    };
    document.body.append(el);
    ((focus && el.querySelector<HTMLElement>(focus)) || pane)?.focus();
  });
}
