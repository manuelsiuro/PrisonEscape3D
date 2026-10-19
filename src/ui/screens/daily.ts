import type { Achievement } from '../../content/achievements';
import { dailyDate, dailyOf } from '../../content/daily';
import type { Medal } from '../../content/medals';
import { twistOf } from '../../content/twists';
import { STRIP, STRIP_EMOJI, type DailyRecord } from '../../game/daily';
import { currentLang, t, type Key } from '../../i18n';
import { h, TOUCH } from '../dom';
import { icon } from '../icons';
import { medalDisc, routeIcon } from './trophies';
import { earnedRow } from './escaped';
import { prisonName, securityOf } from './prisons';

/**
 * The Daily Escape's screens (P26): the day's card (the prison, the twists, the tries so far,
 * the best, the streak; yesterday's still to play a day late), the result card to share, and
 * a Three Days run's time up.
 */

/** "Monday 2 November" in the player's language (the Daily's own date, wherever they are). */
export const dailyDay = (n: number) => new Intl.DateTimeFormat(currentLang(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(dailyDate(n));

/** The share text: the Daily, the medal and the day, the tries, the strip, the streak and the check code (nothing of how). */
export function shareText(n: number, best: { medal: Medal | null; day: number; tries: number; strip: readonly number[]; code: string }, streak: number): string {
  return [
    `Prison Escape 3D · ${t('daily.name', { n: n + 1 })}`,
    `${best.medal ? `${t(`medal.${best.medal}` as Key)} · ` : ''}${t('hud.day', { n: best.day })} · ${t(best.tries === 1 ? 'daily.tries1' : 'daily.tries', { n: best.tries })}`,
    best.strip.map((k) => STRIP_EMOJI[k]).join(''),
    `${streak > 1 ? `${t('daily.streak', { n: streak })} · ` : ''}${t('daily.check', { code: best.code })}`,
    location.origin + location.pathname,
  ].join('\n');
}

/** Shares through the phone's share sheet (Web Share), or copies to the clipboard (a desktop's sheet is no handier than a paste); what happened, for a word on the button. */
export async function share(text: string): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  try {
    if (TOUCH && navigator.share) {
      await navigator.share({ text });
      return 'shared';
    }
  } catch (e) {
    // (Closed without sharing: nothing to say.)
    if ((e as Error)?.name === 'AbortError') return 'cancelled';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/**
 * Shares from a card: the button says how it went; where neither the share sheet nor the
 * clipboard is allowed, the text shows under the button, selected, to copy by hand.
 */
async function shareFrom(card: HTMLElement, text: string) {
  const how = await share(text);
  const label = card.querySelector('.share-label');
  if (label) label.textContent = how === 'copied' ? t('daily.copied') : how === 'shared' ? t('daily.shared') : t('daily.share');
  if (how !== 'failed') return;
  let box = card.querySelector<HTMLTextAreaElement>('.share-text');
  if (!box) {
    box = document.createElement('textarea');
    box.className = 'share-text';
    box.readOnly = true;
    box.rows = 5;
    box.setAttribute('aria-label', t('daily.copyBelow'));
    card.querySelector('.actions')!.after(box);
  }
  box.value = text;
  box.focus();
  box.select();
}

/** The day strip as coloured squares (read out as words). */
function stripHtml(strip: readonly number[]): string {
  const words = strip.map((k, d) => `${t('hud.day', { n: d + 1 })}: ${t(`daily.strip.${STRIP[k]}` as Key)}`).join(', ');
  return `<span class="daily-strip" role="img" aria-label="${words}">${strip.map((k) => `<i class="s-${STRIP[k]}"></i>`).join('')}</span>`;
}

/** The twists as rows: icon, name, what it does. */
function twistRows(ids: readonly string[]): string {
  return ids
    .map((id) => twistOf(id))
    .filter((x) => !!x)
    .map((x) => `<li class="twist-row${x!.cost < 0 ? ' gift' : ''}"><span class="tw-ic">${icon(x!.icon, 18)}</span><span><b>${t(`twist.${x!.id}` as Key)}</b><small>${t(`twist.${x!.id}.d` as Key)}</small></span></li>`)
    .join('');
}

export interface DailyInfo {
  /** Today's Daily. */
  today: number;
  /** Each one's record: today's, and yesterday's (still open a day late until escaped). */
  record: (n: number) => DailyRecord;
  /** The Daily whose run is saved (Continue), if any. */
  saved: number | null;
  /** Where that run is ("Day 2 · 14:20 · Laundry"). */
  savedWhen: string;
  streak: number;
}

export type DailyChoice = { act: 'play' | 'continue'; n: number } | null;

/**
 * The Daily's card: today's (or yesterday's, a day late: a tab while it's still to escape), its
 * prison and twists, how it went so far; Play (a try more), Continue its saved run, Share the
 * best. Resolves with what to play, or null when closed.
 */
export function showDaily(info: DailyInfo, click: () => void): Promise<DailyChoice> {
  const el = h('div', 'modal daily-modal');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'daily-h');
  const yesterday = info.today - 1;
  // (Yesterday's, a day late, while it's still to escape, or its run is saved.)
  const late = yesterday >= 0 && (!info.record(yesterday).best || info.saved === yesterday);
  let n = info.saved === yesterday && late ? yesterday : info.today;
  const draw = () => {
    const d = dailyOf(n);
    const rec = info.record(n);
    const best = rec.best;
    const stars = Array.from({ length: 5 }, (_, i) => `<i class="${i < d.prison.difficulty ? 'on' : ''}">${icon('star', 11)}</i>`).join('');
    const tabs = late
      ? `<div class="daily-tabs" role="tablist">${[info.today, yesterday]
          .map((k) => `<button role="tab" class="daily-tab${k === n ? ' on' : ''}" aria-selected="${k === n}" data-n="${k}">${t(k === info.today ? 'daily.today' : 'daily.yesterday')}<small>${t('daily.num', { n: k + 1 })}</small></button>`)
          .join('')}</div>`
      : '';
    const saved = info.saved === n;
    const play = saved
      ? `<button class="big-btn primary" data-c="continue">${icon('play', 18)}<span>${t('title.continue')}<small>${info.savedWhen}</small></span></button>`
      : `<button class="big-btn primary" data-c="play">${icon(rec.tries ? 'replay' : 'play', 18)}${t(rec.tries ? 'daily.tryAgain' : 'daily.play')}</button>`;
    const bestRow = best
      ? `<div class="v-medal ${best.medal ?? 'none'}">${medalDisc(best.medal, 30)}<span class="vm-text"><b>${best.medal ? t(`medal.${best.medal}` as Key) : t('daily.escaped')}</b><small>${t('daily.best', { day: best.day, via: t(`route.${best.via}` as Key) })}</small></span>${stripHtml(best.strip)}</div>`
      : '';
    el.innerHTML = `<div class="card daily-card">
      <div class="settings-head"><h2 id="daily-h">${icon('calendar', 22)}${t('daily.title')}</h2><button class="icon-btn" data-close aria-label="${t('common.close')}">${icon('close')}</button></div>
      <div class="dc-cols"><div class="dc-left">
      ${tabs}
      <p class="daily-when"><b>${t('daily.name', { n: n + 1 })}</b><span>${dailyDay(n)}</span>${n < info.today ? `<em>${t('daily.lateNote')}</em>` : ''}</p>
      <div class="daily-prison theme-${d.prison.theme ?? 'suburban'}"><span class="pc-scene" aria-hidden="true"></span><span class="dp-text"><b>${prisonName(d.prison)}</b><small>${securityOf(d.prison)}</small></span><span class="pc-stars" aria-hidden="true">${stars}</span></div>
      <ul class="daily-twists" aria-label="${t('daily.twists')}">${twistRows(d.twists)}</ul>
      </div><div class="dc-right">
      ${bestRow}
      <div class="daily-stats">
        <span>${icon('replay', 14)}${t(rec.tries === 1 ? 'daily.tries1' : 'daily.tries', { n: rec.tries })}</span>
        ${info.streak ? `<span class="hot">${icon('flame', 14)}${t('daily.streak', { n: info.streak })}</span>` : ''}
        ${best ? `<span>${icon('check', 14)}${t('daily.check', { code: best.code })}</span>` : ''}
      </div>
      <p class="card-note">${t(best ? 'daily.noteBest' : 'daily.note')}</p>
      <div class="actions">
        ${best ? `<button class="big-btn ghost" data-c="share">${icon('chat', 18)}<span class="share-label">${t('daily.share')}</span></button>` : ''}
        ${play}
      </div>
      </div></div>
    </div>`;
  };
  draw();
  return new Promise((resolve) => {
    const done = (c: DailyChoice) => {
      removeEventListener('keydown', key, true);
      el.remove();
      resolve(c);
    };
    const key = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      e.stopImmediatePropagation();
      click();
      done(null);
    };
    addEventListener('keydown', key, true);
    el.onclick = async (e) => {
      const target = e.target as HTMLElement;
      if (target === el || target.closest('[data-close]')) {
        click();
        return done(null);
      }
      const tab = target.closest<HTMLElement>('[data-n]');
      if (tab) {
        click();
        n = Number(tab.dataset.n);
        draw();
        el.querySelector<HTMLElement>(`[data-n="${n}"]`)?.focus();
        return;
      }
      const c = target.closest<HTMLElement>('[data-c]')?.dataset.c;
      if (!c) return;
      click();
      if (c === 'share') {
        await shareFrom(el.querySelector('.card')!, shareText(n, info.record(n).best!, info.streak));
        return;
      }
      done({ act: c === 'continue' ? 'continue' : 'play', n });
    };
    document.body.append(el);
    el.querySelector<HTMLElement>('.big-btn.primary')?.focus();
  });
}

export interface DailyResult {
  n: number;
  /** Escaped a day late (yesterday's Daily). */
  late: boolean;
  prison: string;
  prisonId: string;
  twists: readonly string[];
  via: string;
  day: number;
  time: string;
  tries: number;
  medal: Medal | null;
  /** This escape is the Daily's best yet; the best's day otherwise. */
  best: boolean;
  bestDay: number;
  streak: number;
  strip: readonly number[];
  code: string;
  earned: readonly Achievement[];
  /** P25: the escape can be watched again (its replay). */
  watch?: boolean;
}

/** Out of a Daily: the medal, the day and time, the tries, the strip, the streak, the check code; Share, Try again, the title (and Watch, P25; `back`: shown again after it). */
export function showDailyResult(v: DailyResult, click: () => void, back = false): Promise<'again' | 'title' | 'watch'> {
  const stat = (ic: string, n: string | number, label: string) => `<div class="v-stat">${icon(ic, 18)}<b>${n}</b><small>${label}</small></div>`;
  const earned = earnedRow(v.earned);
  const el = h(
    'div',
    `modal escaped victory daily-result${back ? ' back' : ''}`,
    `<div class="card">
      <div class="escaped-icon">${icon('calendar', 34)}</div>
      <h2 id="daily-result-h">${t('daily.out', { n: v.n + 1 })}</h2>
      <p class="v-sub"></p>
      <div class="v-left">
        <div class="v-method">${icon(routeIcon(v.via, v.prisonId), 20)}<span><small>${t('victory.method')}</small><b>${t(`route.${v.via}` as Key)}</b></span>${v.late ? `<em>${t('daily.late')}</em>` : ''}${v.watch ? `<button class="v-watch" data-c="watch" aria-label="${t('replay.watch')}" title="${t('replay.watch')}">${icon('film', 16)}<span>${t('replay.watchShort')}</span></button>` : ''}</div>
        <div class="v-stats">
          ${stat('clock', v.day, t('victory.days'))}
          ${stat('replay', v.tries, t('daily.triesLabel'))}
          ${stat('flame', v.streak, t('daily.streakLabel'))}
        </div>
        <div class="daily-share-row">${stripHtml(v.strip)}<span class="daily-code">${t('daily.check', { code: v.code })}</span></div>
        <ul class="daily-twists small" aria-label="${t('daily.twists')}">${twistRows(v.twists)}</ul>
      </div>
      <div class="v-right">
        ${v.medal ? `<div class="v-medal ${v.medal}">${medalDisc(v.medal, 34)}<span><b>${t(`medal.${v.medal}` as Key)}</b><small>${t(v.best ? 'daily.bestYes' : 'daily.bestWas', { n: v.bestDay })}</small></span></div>` : `<div class="v-medal none">${medalDisc(null, 30)}<span><b>${t('victory.noMedal')}</b><small>${t(v.best ? 'daily.bestYes' : 'daily.bestWas', { n: v.bestDay })}</small></span></div>`}
        ${earned}
        <div class="actions">
          <button class="big-btn primary" data-c="share">${icon('chat', 18)}<span class="share-label">${t('daily.share')}</span></button>
          <button class="big-btn ghost" data-c="again">${icon('replay', 18)}${t('daily.tryAgain')}</button>
          <button class="big-btn ghost" data-c="title">${icon('home', 18)}${t('escaped.back')}</button>
        </div>
      </div>
    </div>`,
  );
  el.querySelector('.v-sub')!.textContent = t('escaped.sub', { prison: v.prison, day: v.day, time: v.time });
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'daily-result-h');
  return new Promise((resolve) => {
    el.onclick = async (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c;
      if (!c) return;
      click();
      if (c === 'share') {
        await shareFrom(el.querySelector('.card')!, shareText(v.n, { medal: v.medal, day: v.day, tries: v.tries, strip: v.strip, code: v.code }, v.streak));
        return;
      }
      el.remove();
      resolve(c === 'again' ? 'again' : c === 'watch' ? 'watch' : 'title');
    };
    document.body.append(el);
    el.querySelector<HTMLElement>(back ? '[data-c="watch"]' : '[data-c="share"]')?.focus();
  });
}

/** A Three Days run's time up: transferred before getting out. Try again, or the title. */
export function showTimeUp(v: { n: number; prison: string; tries: number }, click: () => void): Promise<'again' | 'title'> {
  const el = h(
    'div',
    'modal lesson-result daily-timeup',
    `<div class="card">
      <div class="escaped-icon">${icon('calendar', 32)}</div>
      <h2 id="timeup-h">${t('daily.timeUp')}</h2>
      <p class="card-note"></p>
      <div class="actions">
        <button class="big-btn ghost" data-c="title">${icon('home', 18)}${t('escaped.back')}</button>
        <button class="big-btn primary" data-c="again">${icon('replay', 18)}${t('daily.tryAgain')}</button>
      </div>
    </div>`,
  );
  el.querySelector('.card-note')!.textContent = t('daily.timeUpNote', { n: v.n + 1, prison: v.prison });
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'timeup-h');
  return new Promise((resolve) => {
    el.onclick = (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c;
      if (!c) return;
      click();
      el.remove();
      resolve(c === 'again' ? 'again' : 'title');
    };
    document.body.append(el);
    el.querySelector<HTMLElement>('[data-c="again"]')?.focus();
  });
}
