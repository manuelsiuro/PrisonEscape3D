import { t, textStamp, type Key } from '../../i18n';
import { keyLabel } from '../../i18n/keys';
import { photos } from '../../render/itemIcons';
import { h, setText } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { CITY_ITEMS, cityItem } from '../content/items';
import { COP, POCKETS, type Stack, type Target } from '../sim/City';

/** What the pockets, the open box and the action button show (C2), worked out by the play layer each frame. */
export interface PocketsState {
  inv: readonly Stack[];
  /** The box open now (its name's key; '' none) and its slots. */
  box: string;
  slots: readonly Stack[];
  /** What the action button would do (null: nothing in reach), and a first search's progress (0–1; 0: none). */
  target: Target | null;
  /** The target is the box open now (the button shuts it); it has been looked into before. */
  targetOpen: boolean;
  searched: boolean;
  searching: number;
  asleep: boolean;
}

/** The city's things photographed (by item number; 0 unused), once. */
let icons: string[] | null = null;
const iconOf = (n: number) => (icons ??= ['', ...photos(CITY_ITEMS.map((d) => ({ ...d, id: `city.${d.id}` })))])[n] ?? '';

/** What a thing does when used, in a line ("+30 hunger · +12 energy"); '' for what isn't used. */
export function useLine(n: number): string {
  const use = cityItem(n)?.use;
  if (!use) return '';
  const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  return [
    use.hunger ? t('city.gives.hunger', { n: sign(use.hunger) }) : '',
    use.energy ? t('city.gives.energy', { n: sign(use.energy) }) : '',
    use.health ? t('city.gives.health', { n: sign(use.health) }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export const itemName = (n: number) => t(`city.item.${cityItem(n)?.id ?? 'tin'}` as Key);

/**
 * City Escape's pockets (C2): eight slots along the bottom (a tap or its digit opens a thing's card:
 * what it is, Use, Drop, or Store while a box is open), the open box's panel (a tap takes a thing, Take
 * all, Close), and the action button (Search, Look, Sleep) with a first search's ring round it.
 */
export class CityPockets {
  readonly bar: HTMLElement;
  readonly panel: HTMLElement;
  readonly card: HTMLElement;
  readonly act: HTMLButtonElement;
  private shownInv = '';
  private shownBox = '';
  private shownAct = '';
  private lang = '';
  /** The pocket whose card is up (-1 none). */
  picked = -1;
  /** A command for the simulation (op, a), and the action button. */
  onOp: (op: number, a?: number) => void = () => {};
  onAct: () => void = () => {};

  constructor() {
    this.bar = h('div', 'hotbar city-pockets hidden');
    this.bar.setAttribute('role', 'toolbar');
    this.panel = h('div', 'item-panel city-box hidden');
    this.card = h('div', 'item-panel city-thing hidden');
    this.act = h('button', 'act-btn city-act hidden');
    this.act.addEventListener('click', () => this.onAct());
    this.bar.addEventListener('click', (e) => {
      const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k;
      if (k !== undefined) this.pick(Number(k));
    });
    this.panel.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-slot], [data-c]');
      if (!el) return;
      if (el.dataset.slot !== undefined) this.onOp(COP.TAKE, Number(el.dataset.slot));
      else if (el.dataset.c === 'all') this.onOp(COP.TAKE_ALL);
      else this.onOp(COP.CLOSE);
    });
    this.card.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c;
      if (!c) return;
      if (c === 'use') this.onOp(COP.USE, this.picked);
      else if (c === 'drop') this.onOp(COP.DROP, this.picked);
      else if (c === 'store') this.onOp(COP.STORE, this.picked);
      if (c !== 'use') this.pick(-1);
    });
    document.body.append(this.bar, this.panel, this.card, this.act);
  }

  show(on: boolean) {
    this.bar.classList.toggle('hidden', !on);
    if (!on) for (const el of [this.panel, this.card, this.act]) el.classList.add('hidden');
    this.shownInv = this.shownBox = this.shownAct = '';
    this.picked = -1;
  }

  /** A pocket's card opened (the same again, or -1: shut). */
  pick(k: number) {
    this.picked = k === this.picked ? -1 : k;
    this.shownInv = '';
  }

  /** Whether a card or the box is up (Escape shuts them first). */
  get open() {
    return this.picked >= 0;
  }

  update(s: PocketsState) {
    if (textStamp() !== this.lang) {
      this.lang = textStamp();
      this.shownInv = this.shownBox = this.shownAct = '';
      this.bar.setAttribute('aria-label', t('city.pockets'));
    }
    // (The thing whose card was up is gone: the card too.)
    if (this.picked >= 0 && !s.inv[this.picked]?.[0]) this.picked = -1;
    const inv = `${JSON.stringify(s.inv)}|${this.picked}|${s.box}`;
    if (inv !== this.shownInv) {
      this.shownInv = inv;
      this.bar.innerHTML = Array.from({ length: POCKETS }, (_, k) => {
        const [item, n] = s.inv[k] ?? [0, 0];
        return `<button class="slot${item ? ' filled' : ''}${k === this.picked ? ' picked' : ''}" data-k="${k}" data-key="${k + 1}"${item ? ` title="${itemName(item)}" aria-label="${itemName(item)}${n > 1 ? ` × ${n}` : ''}"` : ` aria-label="${t('city.pocketEmpty', { n: k + 1 })}" disabled`}>${item ? `<img src="${iconOf(item)}" alt="" draggable="false">${n > 1 ? `<i class="slot-n">${n}</i>` : ''}` : ''}</button>`;
      }).join('');
      this.card.classList.toggle('hidden', this.picked < 0);
      if (this.picked >= 0) {
        const [item, n] = s.inv[this.picked];
        const line = useLine(item);
        this.card.innerHTML = `<div class="ct-head"><i class="slot filled"><img src="${iconOf(item)}" alt=""></i><div><b>${itemName(item)}${n > 1 ? ` × ${n}` : ''}</b><small>${line || t(`city.kindOf.${cityItem(item)!.kind}` as Key)}</small></div></div>
          <div class="ct-actions">${line ? `<button class="big-btn primary" data-c="use">${icon(cityItem(item)!.kind === 'med' ? 'heart' : 'utensils', 16)}${t(cityItem(item)!.kind === 'med' ? 'city.thing.apply' : 'city.thing.eat')}</button>` : ''}${s.box ? `<button class="big-btn ghost" data-c="store">${icon('box', 16)}${t('city.thing.store')}</button>` : ''}<button class="big-btn ghost" data-c="drop">${icon('down', 16)}${t('city.thing.drop')}</button></div>`;
      }
    }
    const box = `${s.box}|${JSON.stringify(s.slots)}`;
    if (box !== this.shownBox) {
      this.shownBox = box;
      this.panel.classList.toggle('hidden', !s.box);
      if (s.box) {
        const filled = s.slots.some((st) => st[0]);
        this.panel.innerHTML = `<div class="box-head"><b>${t(s.box as Key)}</b><button class="icon-btn" data-c="close" aria-label="${t('city.box.close')}">${icon('close', 18)}</button></div>
          ${
            filled
              ? `<div class="slot-grid">${s.slots.map((st, k) => (st[0] ? `<button class="slot filled" data-slot="${k}" title="${itemName(st[0])}" aria-label="${t('city.box.take', { what: itemName(st[0]) })}"><img src="${iconOf(st[0])}" alt="" draggable="false">${st[1] > 1 ? `<i class="slot-n">${st[1]}</i>` : ''}</button>` : '')).join('')}</div>
          <div class="ct-actions"><button class="big-btn primary" data-c="all">${icon('hand', 16)}${t('city.box.takeAll')}</button></div>`
              : `<p class="card-note">${t('city.box.empty')}</p>`
          }`;
      }
    }
    // The action button: what's in reach, a search's ring.
    const tg = s.asleep ? null : s.target;
    const verb = !tg
      ? ''
      : tg.kind === 'bed'
        ? 'city.act.sleep'
        : s.targetOpen
          ? 'city.act.close'
          : tg.kind === 'pile' || s.searched
            ? 'city.act.look'
            : 'city.act.search';
    const key = `${verb}|${tg?.prop ?? ''}`;
    if (key !== this.shownAct) {
      this.shownAct = key;
      this.act.classList.toggle('hidden', !tg);
      if (tg) {
        const what = t(tg.prop ? (`city.box.${tg.prop}` as Key) : 'city.box.pile');
        this.act.innerHTML = `<i class="act-round">${icon(tg.kind === 'bed' ? 'moon' : 'search', 24)}<span></span></i><b class="act-what"></b>`;
        setText(this.act.querySelector('.act-round span')!, t(verb as Key));
        setText(this.act.querySelector('.act-what')!, what);
        this.act.setAttribute('aria-label', `${t(verb as Key)} ${what}`);
        this.act.setAttribute('aria-keyshortcuts', keyLabel('KeyE'));
      }
    }
    this.act.style.setProperty('--cut', String(s.searching));
    this.act.classList.toggle('cutting', s.searching > 0);
  }
}
