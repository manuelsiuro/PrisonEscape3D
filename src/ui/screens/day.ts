import { t } from '../../i18n';
import { TOUCH, h } from '../dom';
import { icon } from '../icons';

/** A chip at the card's head: today's event, the weather (or tomorrow's). */
export interface DayChip {
  icon: string;
  color: string;
  text: string;
  /** Its time ("19:00–21:30", "when the bell rings"), '' none. */
  when: string;
}

/** The day's event, pinned to the block it falls in. */
export interface DayPin {
  icon: string;
  color: string;
  title: string;
  when: string;
  sub: string;
  /** Over for today (quieter). */
  over: boolean;
  /** How the player did at it (the drill: present, missed), '' nothing to say. */
  tag: string;
  tagTone: 'ok' | 'bad' | 'quiet' | '';
}

/** One block of the routine as the card shows it. */
export interface DayBlock {
  time: string;
  icon: string;
  name: string;
  /** Where it wants the player ("Canteen", "Laundry", "Anywhere legal"). */
  place: string;
  /** Before, during or after the clock. */
  at: 'past' | 'now' | 'next';
  /** Something is asked of the player (a filled dot), or it's free (a ring). */
  must: boolean;
  /** The tag at the end: how it went, what missing it costs, the quota. */
  tag: { text: string; tone: 'ok' | 'bad' | 'warn' | 'quiet' | 'job'; icon?: string } | null;
  /** The block under way: how far through (0–1) and what's left ("27 min left"). */
  through?: number;
  left?: string;
  pin?: DayPin;
}

export interface DayView {
  /** "Day 3". */
  title: string;
  /** "Center Perks · 17:33". */
  sub: string;
  /** The sky by the clock (sun, moon). */
  sky: string;
  chips: DayChip[];
  /** Something over the routine right now (a lockdown, solitary). */
  alert: { icon: string; title: string; sub: string } | null;
  blocks: DayBlock[];
  /** Tomorrow's chips, once the warden has forecast it; its label ("Tomorrow", "From 08:00"). */
  tomorrow: { label: string; chips: DayChip[] } | null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const chip = (c: DayChip) =>
  `<span class="dc-chip" style="--c:${c.color}"><span class="dc-chip-ic">${icon(c.icon, 14)}</span><b>${esc(c.text)}</b>${c.when ? `<em>${esc(c.when)}</em>` : ''}</span>`;

function block(b: DayBlock): string {
  const tag = b.tag ? `<em class="dc-tag ${b.tag.tone}">${b.tag.icon ? icon(b.tag.icon, 12) : ''}${esc(b.tag.text)}</em>` : '';
  const now =
    b.at === 'now' && b.through !== undefined
      ? `<span class="dc-now"><span class="dc-now-tag">${t('dayCard.now')}</span><i class="dc-bar"><i style="width:${Math.round(b.through * 100)}%"></i></i><small>${esc(b.left ?? '')}</small></span>`
      : '';
  const p = b.pin;
  const pin = p
    ? `<div class="dc-pin${p.over ? ' over' : ''}" style="--c:${p.color}"><span class="dc-pin-ic">${icon(p.icon, 14)}</span><span class="dc-pin-text"><b>${esc(p.title)}${p.when ? `<em>${esc(p.when)}</em>` : ''}</b><small>${esc(p.sub)}</small></span>${p.tag ? `<em class="dc-tag ${p.tagTone}">${p.tagTone === 'ok' ? icon('check', 12) : ''}${esc(p.tag)}</em>` : ''}</div>`
    : '';
  return `<li class="dc-block ${b.at}${b.must ? ' must' : ''}"${b.at === 'now' ? ' aria-current="time"' : ''}>
    <time datetime="${b.time}">${b.time}</time><span class="dc-dot" aria-hidden="true"></span>
    <span class="dc-body"><span class="dc-row"><span class="dc-ic">${icon(b.icon, 16)}</span><span class="dc-text"><b>${esc(b.name)}</b><small>${esc(b.place)}</small></span>${tag}</span>${now}${pin}</span>
  </li>`;
}

/**
 * The day (the clock in the HUD, or J), over the paused game: today's event and weather, then
 * the routine block by block down a line: where each wants the player, how the ones gone by
 * went, the one under way lit with what's left of it, what missing the ones ahead costs; the
 * event pinned where it falls; tomorrow's forecast once the warden has given it.
 */
export function showDay(v: DayView, click: () => void): Promise<void> {
  const el = h(
    'div',
    'modal day-modal',
    `<div class="card day-card">
      <div class="dc-head"><span class="dc-sky ${v.sky}">${icon(v.sky, 22)}</span><span class="dc-title"><h2 id="day-h">${esc(v.title)}</h2><small>${esc(v.sub)}</small></span><button class="icon-btn small dc-close" data-c="close" aria-label="${t('box.close')}">${icon('close', 18)}</button></div>
      ${v.chips.length ? `<div class="dc-chips">${v.chips.map(chip).join('')}</div>` : ''}
      ${v.alert ? `<div class="dc-alert"><span class="dc-alert-ic">${icon(v.alert.icon, 18)}</span><span><b>${esc(v.alert.title)}</b><small>${esc(v.alert.sub)}</small></span></div>` : ''}
      <ol class="dc-line${v.alert ? ' held' : ''}">${v.blocks.map(block).join('')}</ol>
      ${v.tomorrow ? `<div class="dc-tomorrow"><span class="dc-label">${icon('megaphone', 13)}${esc(v.tomorrow.label)}</span><div class="dc-chips">${v.tomorrow.chips.map(chip).join('')}</div></div>` : ''}
      <div class="actions">
        <button class="big-btn primary" data-c="resume">${icon('play', 18)}${t('pause.resume')}</button>
      </div>
      ${TOUCH ? '' : `<p class="dc-keys">${t('dayCard.keys')}</p>`}
    </div>`,
  );
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'day-h');
  // (Focus goes back where it was: the clock, for a keyboard.)
  const back = document.activeElement as HTMLElement | null;
  return new Promise((resolve) => {
    const done = () => {
      click();
      removeEventListener('keydown', key, true);
      el.remove();
      if (back?.isConnected && back !== document.body) back.focus({ preventScroll: true });
      resolve();
    };
    // Escape or J again: back to the game (the pause key must not reach the game behind).
    const key = (e: KeyboardEvent) => {
      if (e.repeat || (e.code !== 'Escape' && e.code !== 'KeyJ')) return;
      e.stopImmediatePropagation();
      done();
    };
    addEventListener('keydown', key, true);
    el.onclick = (e) => {
      if (e.target === el || (e.target as HTMLElement).closest('[data-c]')) done();
    };
    document.body.append(el);
    // The block under way in sight (a short screen scrolls the line to it).
    el.querySelector('.dc-block.now')?.scrollIntoView({ block: 'center' });
    el.querySelector<HTMLElement>('[data-c="resume"]')?.focus({ preventScroll: true });
  });
}
