import { t, textStamp, type Key } from '../../i18n';
import { keyLabel } from '../../i18n/keys';
import { photos } from '../../render/itemIcons';
import { h, setText } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { CITY_ITEMS, cityItem, cityItemNumber } from '../content/items';
import { CITY_RECIPES } from '../content/recipes';
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
  /** A door in reach is barred (the button takes its boards down). */
  barred: boolean;
  /** What each recipe lacks now ('ok': it can be made). */
  recipes: ReadonlyArray<'ok' | 'parts' | 'bench' | 'stove'>;
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

/** What a slot shows of its thing: how many, or a weapon's blows left as a bar. */
function slotInner(item: number, n: number): string {
  const wear = cityItem(item)?.wear;
  return `<img src="${iconOf(item)}" alt="" draggable="false">${
    wear !== undefined
      ? `<i class="slot-dur"><i style="width:${Math.round((100 * n) / wear)}%"></i></i>`
      : n > 1
        ? `<i class="slot-n">${n}</i>`
        : ''
  }`;
}
/** A thing and how many, in words (a weapon: its name alone). */
const counted = (item: number, n: number) => `${itemName(item)}${cityItem(item)?.wear === undefined && n > 1 ? ` × ${n}` : ''}`;

/**
 * City Escape's pockets (C2): eight slots along the bottom (a tap or its digit opens a thing's card:
 * what it is, Use, Drop, or Store while a box is open), the open box's panel (a tap takes a thing, Take
 * all, Close), and the action button (Search, Look, Sleep) with a first search's ring round it.
 */
export class CityPockets {
  readonly bar: HTMLElement;
  readonly panel: HTMLElement;
  readonly card: HTMLElement;
  /** The Make panel (its button on the pockets' bar). */
  readonly make: HTMLElement;
  makeOpen = false;
  private shownMake = '';
  readonly act: HTMLButtonElement;
  /** The blow: always there in play (Space). */
  readonly hit: HTMLButtonElement;
  private shownInv = '';
  private shownBox = '';
  private shownAct = '';
  private lang = '';
  /** The pocket whose card is up (-1 none). */
  picked = -1;
  /** A command for the simulation (op, a), and the action button. */
  onOp: (op: number, a?: number) => void = () => {};
  onAct: () => void = () => {};
  onHit: () => void = () => {};

  constructor() {
    this.bar = h('div', 'hotbar city-pockets hidden');
    this.bar.setAttribute('role', 'toolbar');
    this.panel = h('div', 'item-panel city-box hidden');
    this.card = h('div', 'item-panel city-thing hidden');
    this.make = h('div', 'item-panel city-make hidden');
    this.make.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-r], [data-c]');
      if (!el) return;
      if (el.dataset.r !== undefined) this.onOp(COP.MAKE, Number(el.dataset.r));
      else this.toggleMake(false);
    });
    this.act = h('button', 'act-btn city-act hidden');
    this.act.addEventListener('click', () => this.onAct());
    this.hit = h(
      'button',
      'tool-btn city-hit hidden',
      `<i class="tool-round"><i class="tool-ring"></i>${icon('fist', 22)}<span></span></i>`,
    );
    this.hit.addEventListener('click', () => this.onHit());
    this.bar.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.craft-btn')) return this.toggleMake();
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
    document.body.append(this.bar, this.panel, this.card, this.make, this.act, this.hit);
  }

  show(on: boolean) {
    this.bar.classList.toggle('hidden', !on);
    this.hit.classList.toggle('hidden', !on);
    if (!on) for (const el of [this.panel, this.card, this.act, this.make]) el.classList.add('hidden');
    this.shownInv = this.shownBox = this.shownAct = this.shownMake = '';
    this.picked = -1;
    this.makeOpen = false;
  }

  /** A pocket's card opened (the same again, or -1: shut). */
  pick(k: number) {
    this.picked = k === this.picked ? -1 : k;
    this.shownInv = '';
    if (this.picked >= 0) this.toggleMake(false);
  }

  /** The Make panel opened or shut. */
  toggleMake(on = !this.makeOpen) {
    this.makeOpen = on;
    if (on) this.picked = -1;
    this.shownMake = this.shownInv = '';
  }

  /** Whether a card or the box is up (Escape shuts them first). */
  get open() {
    return this.picked >= 0 || this.makeOpen;
  }
  /** Escape: whichever of them is up, shut. */
  shut() {
    this.picked = -1;
    this.toggleMake(false);
  }

  update(s: PocketsState) {
    if (textStamp() !== this.lang) {
      this.lang = textStamp();
      this.shownInv = this.shownBox = this.shownAct = this.shownMake = '';
      this.bar.setAttribute('aria-label', t('city.pockets'));
      setText(this.hit.querySelector('span')!, t('city.act.hit'));
      this.hit.setAttribute('aria-keyshortcuts', keyLabel('Space'));
    }
    // (The thing whose card was up is gone: the card too.)
    if (this.picked >= 0 && !s.inv[this.picked]?.[0]) this.picked = -1;
    const inv = `${JSON.stringify(s.inv)}|${this.picked}|${s.box}`;
    if (inv !== this.shownInv) {
      this.shownInv = inv;
      this.bar.innerHTML = Array.from({ length: POCKETS }, (_, k) => {
        const [item, n] = s.inv[k] ?? [0, 0];
        return `<button class="slot${item ? ' filled' : ''}${k === this.picked ? ' picked' : ''}" data-k="${k}" data-key="${k + 1}"${item ? ` title="${itemName(item)}" aria-label="${counted(item, n)}"` : ` aria-label="${t('city.pocketEmpty', { n: k + 1 })}" disabled`}>${item ? slotInner(item, n) : ''}</button>`;
      }).join('');
      this.bar.insertAdjacentHTML(
        'beforeend',
        `<i class="hotbar-gap"></i><button class="slot craft-btn${this.makeOpen ? ' picked' : ''}" aria-label="${t('city.make.title')}" aria-keyshortcuts="C">${icon('hammer', 22)}<span>${t('city.make.open')}</span></button>`,
      );
      this.card.classList.toggle('hidden', this.picked < 0);
      if (this.picked >= 0) {
        const [item, n] = s.inv[this.picked];
        const line = useLine(item);
        this.card.innerHTML = `<div class="ct-head"><i class="slot filled"><img src="${iconOf(item)}" alt=""></i><div><b>${counted(item, n)}</b><small>${line || (cityItem(item)!.wear !== undefined ? t('city.thing.blows', { n, of: cityItem(item)!.wear! }) : t(`city.kindOf.${cityItem(item)!.kind}` as Key))}</small></div></div>
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
              ? `<div class="slot-grid">${s.slots.map((st, k) => (st[0] ? `<button class="slot filled" data-slot="${k}" title="${itemName(st[0])}" aria-label="${t('city.box.take', { what: counted(st[0], st[1]) })}">${slotInner(st[0], st[1])}</button>` : '')).join('')}</div>
          <div class="ct-actions"><button class="big-btn primary" data-c="all">${icon('hand', 16)}${t('city.box.takeAll')}</button></div>`
              : `<p class="card-note">${t('city.box.empty')}</p>`
          }`;
      }
    }
    // The Make panel: every recipe, what it takes (what's short greyed), what it needs beside.
    const mk = `${this.makeOpen}|${s.recipes.join()}|${JSON.stringify(s.inv)}`;
    if (mk !== this.shownMake) {
      this.shownMake = mk;
      this.make.classList.toggle('hidden', !this.makeOpen);
      if (this.makeOpen) {
        const have = (id: string) =>
          s.inv.reduce((n, st) => n + (cityItem(st[0])?.id === id ? (cityItem(st[0])?.wear !== undefined ? 1 : st[1]) : 0), 0);
        this.make.innerHTML = `<div class="box-head"><b>${icon('hammer', 18)} ${t('city.make.title')}</b><button class="icon-btn" data-c="close" aria-label="${t('city.box.close')}">${icon('close', 18)}</button></div>
          <ul class="city-recipes">${CITY_RECIPES.map((r, k) => {
            const why = s.recipes[k] ?? 'parts';
            const made = cityItemNumber(r.makes);
            const parts = r.from
              .map(
                ([id, n]) =>
                  `<i class="slot filled${have(id) < n ? ' short' : ''}" title="${t(`city.item.${id}` as Key)}"><img src="${iconOf(cityItemNumber(id))}" alt="">${n > 1 ? `<i class="slot-n">${n}</i>` : ''}</i>`,
              )
              .join('');
            const need = r.bench ? t('city.make.bench') : r.stove ? t('city.make.stove') : '';
            return `<li><button class="city-recipe${why === 'ok' ? '' : ' cant'}" data-r="${k}" aria-disabled="${why !== 'ok'}"><i class="slot filled result"><img src="${iconOf(made)}" alt=""></i><span class="cr-text"><b>${itemName(made)}</b><small class="${why === 'bench' || why === 'stove' ? 'lack' : ''}">${need || useLine(made) || t(`city.kindOf.${cityItem(made)!.kind}` as Key)}</small></span><span class="cr-parts">${parts}</span></button></li>`;
          }).join('')}</ul>`;
      }
    }
    // The action button: what's in reach, a search's ring.
    const tg = s.asleep ? null : s.target;
    const verb = !tg
      ? ''
      : tg.kind === 'door'
        ? s.barred
          ? 'city.act.unbar'
          : 'city.act.bar'
        : s.targetOpen
          ? 'city.act.close'
          : tg.kind === 'bed'
            ? 'city.act.sleep'
            : tg.kind === 'pile' || s.searched
              ? 'city.act.look'
              : 'city.act.search';
    const key = `${verb}|${tg?.prop ?? tg?.kind ?? ''}`;
    if (key !== this.shownAct) {
      this.shownAct = key;
      this.act.classList.toggle('hidden', !tg);
      if (tg) {
        const what = t(tg.kind === 'door' ? 'city.box.door' : tg.prop ? (`city.box.${tg.prop}` as Key) : 'city.box.pile');
        this.act.innerHTML = `<i class="act-round">${icon(tg.kind === 'bed' ? 'moon' : tg.kind === 'door' ? 'hammer' : 'search', 24)}<span></span></i><b class="act-what"></b>`;
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
