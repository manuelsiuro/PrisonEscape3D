import type { Speciality } from '../content/crew';
import { currentLang, t } from '../i18n';
import { ORDER, TALK } from '../sim/command';
import { h, setText, TOUCH } from './dom';
import { icon } from './icons';

/** Each line of work's icon (P23): the talk panel, the crew's pill and panel, the chips over their heads, the prisoner's file. */
export const SPEC_ICON: Readonly<Record<Speciality, string>> = { lookout: 'eye', digger: 'shovel', muscle: 'fist', smuggler: 'box' };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One order in the talk panel (P23): what it says, the line under it (what it does, or why not now), whether it can be given, whether it's the one in force. */
export interface CrewOrderView {
  order: number;
  icon: string;
  label: string;
  note: string;
  ok: boolean;
  on: boolean;
  /** Asks twice (a brawl: once a day). */
  confirm?: string;
}

/** The talk panel's crew section, for a follower (P23). */
export interface CrewTalkView {
  spec: Speciality;
  /** What he's doing now. */
  status: string;
  orders: CrewOrderView[];
}

/**
 * A follower's crew section: his line of work, what he's at, then his orders as a list of
 * full-width actions on two lines each (its name, then what it does or why not now), the one in
 * force lit (tonight's the night stays pressable to call it off).
 */
export function crewSection(v: CrewTalkView): string {
  const rows = v.orders
    .map((o) => {
      const toggle = o.order === ORDER.NIGHT;
      const live = o.ok && (!o.on || toggle);
      const confirm = o.confirm && live ? ` data-confirm="${esc(o.confirm)}"` : '';
      const tag = o.on ? `<em class="crew-act-tag" aria-hidden="true">${t('crew.tagOn')}</em>` : '';
      // (A toggle says so either way; an order says it's in force.)
      const pressed = toggle ? ` aria-pressed="${o.on}"` : o.on ? ' aria-pressed="true"' : '';
      return `<button class="crew-act${o.on ? ' on' : ''}" data-act="${TALK.CREW}" data-arg="${o.order}" ${live ? '' : 'disabled'}${pressed}${confirm}><span class="crew-act-ic">${icon(o.icon, 18)}</span><span class="crew-act-text"><b>${esc(o.label)}</b>${o.note ? `<small>${esc(o.note)}</small>` : ''}</span>${tag}</button>`;
    })
    .join('');
  return `<section class="talk-crew"><div class="box-label">${icon(SPEC_ICON[v.spec], 14)}<span>${t('crew.title', { spec: t(`spec.${v.spec}`) })}</span></div>
    <p class="talk-note crew-status">${esc(v.status)}</p><div class="crew-orders">${rows}</div></section>`;
}

/** One of the crew in their panel (P23). */
export interface CrewRow {
  who: number;
  name: string;
  spec: Speciality;
  status: string;
  /** He has an order to be whistled back from (EXT.RECALL). */
  recall: boolean;
  night: boolean;
}

/** A chip over one of the crew's heads (P23): who, their line, on an order, a lookout's whistle ringing, another badge beside it. */
export interface CrewChip {
  id: number;
  spec: Speciality;
  busy: boolean;
  alert: boolean;
  badge: boolean;
}

/** The crew's pill on the HUD (P23): shown while someone has an order. */
export interface CrewHud {
  icons: string[];
  text: string;
  /** A lookout just whistled (it flashes). */
  alert: boolean;
}

/**
 * The crew's panel (P23): who's in the crew, their line of work and what they're at, and the
 * whistle to call back someone with an order, from anywhere. Opened from the crew's pill on
 * the HUD (or G on a keyboard, the focus on its first button); a polite live region says what
 * changes.
 */
export class CrewPanel {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly say: HTMLElement;
  private drawn = '';
  private last: CrewRow[] = [];
  private focusNext = false;
  isOpen = false;
  onRecall: (who: number) => void = () => {};

  constructor(private readonly click: () => void) {
    this.el = h('div', 'item-panel board-panel crew-panel hidden', `<div class="panel-head"><b>${icon('users', 20)}<span></span></b><button class="icon-btn small" data-crew="close">${icon('close', 18)}</button></div><span class="sr-only" role="status"></span><div class="crew-body"></div>`);
    this.el.setAttribute('role', 'dialog');
    this.body = this.el.querySelector('.crew-body')!;
    this.say = this.el.querySelector('[role="status"]')!;
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-crew]');
      if (!b || b.disabled) return;
      this.click();
      if (b.dataset.crew === 'close') this.close();
      else this.onRecall(Number(b.dataset.who));
    });
    document.body.append(this.el);
  }

  toggle(focus = false) {
    if (this.isOpen) this.close();
    else {
      this.isOpen = true;
      this.drawn = '';
      this.focusNext = focus;
      setText(this.say, '');
    }
  }

  close() {
    if (this.isOpen && this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.isOpen = false;
    this.el.classList.add('hidden');
  }

  update(rows: CrewRow[] | null, busy: boolean) {
    if (!rows?.length || busy) this.close();
    if (!this.isOpen || !rows?.length) {
      this.el.classList.add('hidden');
      return;
    }
    this.el.classList.remove('hidden');
    setText(this.el.querySelector('.panel-head span')!, t('crew.panelTitle'));
    this.el.setAttribute('aria-label', t('crew.panelTitle'));
    const key = JSON.stringify(rows) + currentLang();
    if (key === this.drawn) return;
    const shape = JSON.stringify(rows.map((r) => [r.who, r.recall, r.night])) + currentLang();
    const was = this.drawn ? this.last : [];
    this.drawn = key;
    this.last = rows;
    // (What's new for a screen reader: someone's status changed; a countdown ticking isn't news.)
    const bare = (x: string) => x.replace(/\d/g, '');
    const changed = rows.find((r) => was.some((w) => w.who === r.who && bare(w.status) !== bare(r.status)));
    if (changed) setText(this.say, t('crew.say', { name: changed.name, status: changed.status }));
    this.el.querySelector('[data-crew="close"]')!.setAttribute('aria-label', t('box.close'));
    const rowsEl = this.body.querySelectorAll<HTMLElement>('.crew-row');
    if (rowsEl.length === rows.length && this.body.dataset.shape === shape) {
      // Only the statuses changed: written in place (the focus stays put).
      rows.forEach((r, k) => setText(rowsEl[k].querySelector('small')!, r.status));
      return;
    }
    this.body.dataset.shape = shape;
    const had = this.body.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.who : undefined;
    this.body.innerHTML = `<div class="board-list">${rows
      .map(
        (r) =>
          `<div class="board-row crew-row"><span class="board-ic crew-act-ic">${icon(SPEC_ICON[r.spec], 20)}</span><span class="board-text"><b>${esc(r.name)}<em>${t(`spec.${r.spec}`)}</em>${r.night ? `<i class="crew-moon" title="${esc(t('crew.nightOn'))}">${icon('moon', 12)}</i><span class="sr-only">${esc(t('crew.nightOn'))}</span>` : ''}</b><small>${esc(r.status)}</small></span>${r.recall ? `<button class="big-btn primary small" data-crew="recall" data-who="${r.who}" aria-label="${esc(t('crew.recallAria', { name: r.name }))}">${icon('bell', 16)}<span>${t('crew.recall')}</span></button>` : ''}</div>`,
      )
      .join('')}</div><p class="board-note">${t('crew.panelNote')}</p>${TOUCH ? '' : `<p class="rat-keys">${t('crew.keys')}</p>`}`;
    if (had !== undefined) (this.body.querySelector<HTMLElement>(`[data-who="${had}"]`) ?? this.el.querySelector<HTMLElement>('[data-crew="close"]'))?.focus();
    if (this.focusNext) {
      this.focusNext = false;
      (this.body.querySelector<HTMLElement>('button[data-crew="recall"]') ?? this.el.querySelector<HTMLElement>('[data-crew="close"]'))?.focus();
    }
  }
}

/** A chip over each of the crew's heads (P23): their line of work, lit while on an order, ringing as a lookout whistles. */
export class CrewChips {
  private readonly pool: HTMLElement[] = [];
  private readonly at = { x: 0, y: 0 };

  /** `unit`: CSS pixels per world unit at the chips' height (the zoom): the chips grow and shrink with the world's badges. */
  update(list: readonly CrewChip[], project: (id: number, out: { x: number; y: number }, height: number) => { x: number; y: number } | null, hidden: boolean, unit = 57) {
    let n = 0;
    // A badge is half a unit across: the chip a little smaller, beside it just clear of its edge when there's one.
    const badge = unit * 0.5;
    const size = Math.max(16, Math.min(30, badge * 0.84));
    const aside = badge * 0.385 + size / 2 + 2;
    if (!hidden)
      for (const c of list) {
        // (Where a follower's badge used to be; beside another badge when he has one.)
        const p = project(c.id, this.at, 1.9);
        if (!p) continue;
        const el = (this.pool[n] ??= this.make());
        n++;
        el.style.transform = `translate(${Math.round(p.x + (c.badge ? aside : 0))}px, ${Math.round(p.y)}px) scale(${(size / 24).toFixed(2)})`;
        if (el.dataset.spec !== c.spec) {
          el.dataset.spec = c.spec;
          el.innerHTML = icon(SPEC_ICON[c.spec], 13);
        }
        el.classList.toggle('busy', c.busy);
        el.classList.toggle('alert', c.alert);
      }
    for (let k = 0; k < this.pool.length; k++) this.pool[k].classList.toggle('hidden', k >= n);
  }

  hide() {
    for (const el of this.pool) el.classList.add('hidden');
  }

  private make(): HTMLElement {
    const el = h('div', 'crew-chip hidden', '');
    el.setAttribute('aria-hidden', 'true');
    document.body.append(el);
    return el;
  }
}
