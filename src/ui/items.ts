import { itemDef, ITEMS } from '../content/items';
import { RECIPES } from '../content/recipes';
import { OP, SLOT } from '../sim/command';
import { benchCheck, HOTBAR, ingredientSlots, itemOf, maskOf, usesOf, type ItemState } from '../sim/systems/items';
import { itemIcons } from '../render/itemIcons';
import { t, type Key } from '../i18n';
import { h, setText, TOUCH } from './dom';
import { icon } from './icons';

/** What the item UI shows each frame. */
export interface ItemsView {
  items: ItemState;
  /** The open container's title and its hidden slot count. */
  boxTitle: string;
  boxHidden: number;
  /** What the action button would do now: a verb ("Search") and what to ("your desk"), or null. */
  action: { verb: string; what: string } | null;
  sleeping: boolean;
}

type Send = (op: number, a?: number, b?: number) => void;

export const itemName = (n: number) => t(`item.${itemDef(n).id}` as Key);

/** A slot's inner HTML: the icon, a contraband mark and a durability bar. */
function slotInner(v: number): string {
  if (!v) return '';
  const n = itemOf(v);
  const d = itemDef(n);
  const uses = d.uses ? usesOf(v) / d.uses : 1;
  return `<img src="${itemIcons()[n]}" alt="" draggable="false">${d.contraband ? '<i class="slot-cb"></i>' : ''}${d.uses ? `<i class="slot-dur"><i style="width:${Math.round(uses * 100)}%"></i></i>` : ''}`;
}

/**
 * The item UI (GDD §6, §8, §13): the hotbar of 6 slots plus weapon and outfit, the action
 * button (touch) or prompt (keys), the open container as a panel (hidden compartment and
 * drawers), and the crafting workbench with its handbook. Moving items is tap an item, tap
 * where it goes, on touch and mouse alike. Everything is sent as ops; the panels redraw
 * from the simulation state, so they never disagree with it.
 */
export class ItemsUI {
  private readonly bar: HTMLElement;
  private readonly slots: HTMLElement[] = [];
  private readonly act: HTMLButtonElement;
  private readonly prompt: HTMLElement;
  private readonly box: HTMLElement;
  private readonly boxHidden: HTMLElement;
  private readonly boxDrawers: HTMLElement;
  private readonly boxTitle: HTMLElement;
  private readonly craft: HTMLElement;
  private readonly info: HTMLElement;
  private readonly toastEl: HTMLElement;
  private view: ItemsView | null = null;
  /** The slot address picked up to move (tap item, tap destination). */
  private picked: number | null = null;
  /** The workbench: carried slot addresses put on it (UI only until Craft). */
  private bench: number[] = [];
  private tab: 'bench' | 'book' = 'bench';
  private craftOpen = false;
  /** The hand slot whose item menu (drop, wear) is open. */
  private menu: number | null = null;
  /** Bumped by any UI-side change (picked, bench, tab…); with the sim's rev it decides a redraw. */
  private uiRev = 0;
  private drawn = '';
  private simRev = -1;
  private drawnUi = -1;
  /** What each carried slot held at the last redraw (an arrival pops the slot). */
  private lastInv: number[] = [];
  /** Called when the player wants to interact (the action button). */
  onAction: () => void = () => {};

  constructor(
    private readonly send: Send,
    private readonly click: () => void,
  ) {
    this.bar = h('div', 'hotbar hidden');
    for (let k = 0; k < SLOT.CONTAINER; k++) {
      if (k === HOTBAR) this.bar.append(h('i', 'hotbar-gap'));
      const s = h('button', `slot${k === SLOT.WEAPON ? ' weapon' : k === SLOT.OUTFIT ? ' outfit' : ''}`);
      s.dataset.addr = String(k);
      if (k < HOTBAR && !TOUCH) s.dataset.key = String(k + 1);
      this.slots.push(s);
      this.bar.append(s);
    }
    const craftBtn = h('button', 'slot craft-btn', `${icon('hammer', 22)}<span>${t('craft.open')}</span>`);
    craftBtn.addEventListener('click', () => this.toggleCraft());
    this.bar.append(craftBtn);
    this.bar.addEventListener('click', (e) => this.slotClick(e));

    this.act = h('button', 'act-btn hidden');
    this.act.addEventListener('click', () => {
      this.click();
      this.onAction();
    });
    this.prompt = h('div', 'act-prompt hidden');

    this.box = h(
      'div',
      'item-panel box-panel hidden',
      `<div class="panel-head"><b></b><button class="icon-btn small" data-close aria-label="${t('box.close')}">${icon('close', 18)}</button></div>
      <div class="box-section box-hidden-wrap"><div class="box-label">${icon('lock', 14)}<span>${t('box.hidden')}</span><em>${t('box.hiddenNote')}</em></div><div class="slot-grid box-hidden"></div></div>
      <div class="box-section"><div class="box-label"><span>${t('box.drawers')}</span></div><div class="slot-grid box-drawers"></div></div>`,
    );
    this.boxTitle = this.box.querySelector('.panel-head b')!;
    this.boxHidden = this.box.querySelector('.box-hidden')!;
    this.boxDrawers = this.box.querySelector('.box-drawers')!;
    this.box.querySelector('[data-close]')!.addEventListener('click', () => {
      this.click();
      this.send(OP.CLOSE);
    });
    this.box.addEventListener('click', (e) => this.slotClick(e));

    this.craft = h('div', 'item-panel craft-panel hidden');
    this.craft.addEventListener('click', (e) => this.craftClick(e));

    this.info = h('div', 'item-info hidden');
    this.info.addEventListener('click', (e) => this.infoClick(e));
    this.toastEl = h('div', 'item-toast hidden');
    document.body.append(this.bar, this.act, this.prompt, this.box, this.craft, this.info, this.toastEl);
    // Clicking a slot must not leave it focused: Space and Enter belong to the game.
    for (const el of [this.bar, this.act, this.box, this.craft, this.info]) el.addEventListener('mousedown', (e) => e.preventDefault());
  }

  show(on: boolean) {
    for (const el of [this.bar]) el.classList.toggle('hidden', !on);
    if (!on) {
      for (const el of [this.act, this.prompt, this.box, this.craft, this.info]) el.classList.add('hidden');
      this.craftOpen = false;
      this.picked = this.menu = null;
      this.bench = [];
      this.tab = 'bench';
      this.uiRev++;
      this.view = null;
      this.lastInv = [];
    }
  }

  /** A panel (container or workbench) is open: Escape closes it before pausing. */
  get panelOpen() {
    return this.craftOpen || (this.view?.items.open ?? -1) >= 0;
  }

  closePanels() {
    if (this.craftOpen) this.toggleCraft();
    if ((this.view?.items.open ?? -1) >= 0) this.send(OP.CLOSE);
    this.picked = this.menu = null;
  }

  /** The workbench, if open, closes (a container opening takes the panel's place). */
  closeCraft() {
    if (this.craftOpen) this.toggleCraft();
  }

  get craftIsOpen() {
    return this.craftOpen;
  }

  toggleCraft() {
    this.click();
    this.craftOpen = !this.craftOpen;
    this.bench = [];
    this.picked = this.menu = null;
    if (this.craftOpen && (this.view?.items.open ?? -1) >= 0) this.send(OP.CLOSE);
    this.uiRev++;
  }

  /** A short note over the hotbar ("Your pockets are full", "Crafted: …"). */
  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden', 'show');
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
  }

  private slotClick(e: Event) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-addr]');
    const v = this.view;
    if (!el || !v) return;
    const addr = Number(el.dataset.addr);
    const it = v.items;
    const value = addr < SLOT.CONTAINER ? it.inv[addr] : (it.containers[it.open]?.[addr - SLOT.CONTAINER] ?? 0);
    this.click();
    if (this.craftOpen) {
      // On the workbench (or off it again).
      if (addr >= SLOT.CONTAINER || !value) return;
      const at = this.bench.indexOf(addr);
      if (at >= 0) this.bench.splice(at, 1);
      else if (this.bench.length < 3) this.bench.push(addr);
      this.uiRev++;
      return;
    }
    if (it.open >= 0) {
      // Tap an item, then where it goes.
      if (this.picked === null) {
        if (value) this.picked = addr;
      } else {
        if (addr !== this.picked) this.send(OP.MOVE, this.picked, addr);
        this.picked = null;
      }
      this.uiRev++;
      return;
    }
    // No panel: hold it in hand; tap the held item again for its menu.
    if (addr < HOTBAR) {
      if (it.hand !== addr) {
        this.send(OP.SELECT, addr);
        this.menu = null;
      } else this.menu = this.menu === addr || !value ? null : addr;
    } else this.menu = this.menu === addr || !value ? null : addr;
    this.uiRev++;
  }

  private infoClick(e: Event) {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-do]');
    const v = this.view;
    if (!b || !v) return;
    const addr = Number(b.dataset.addr);
    this.click();
    switch (b.dataset.do) {
      case 'drop':
        this.send(OP.DROP, addr);
        break;
      case 'equip':
        this.send(OP.EQUIP, addr);
        break;
      case 'unequip': {
        const free = v.items.inv.slice(0, HOTBAR).indexOf(0);
        if (free >= 0) this.send(OP.MOVE, addr, free);
        else this.toast(t('items.full'));
        break;
      }
    }
    this.menu = this.picked = null;
    this.uiRev++;
  }

  private craftClick(e: Event) {
    const target = e.target as HTMLElement;
    const v = this.view;
    if (!v) return;
    const tab = target.closest<HTMLElement>('[data-tab]')?.dataset.tab;
    if (tab === 'bench' || tab === 'book') {
      this.click();
      this.tab = tab;
      this.uiRev++;
      return;
    }
    if (target.closest('[data-close]')) return this.toggleCraft();
    if (target.closest('[data-clear]')) {
      this.click();
      this.bench = [];
      this.uiRev++;
      return;
    }
    const bench = target.closest<HTMLElement>('[data-bench]');
    if (bench) {
      this.click();
      this.bench.splice(Number(bench.dataset.bench), 1);
      this.uiRev++;
      return;
    }
    const make = target.closest<HTMLElement>('[data-make]');
    if (make) {
      this.click();
      // Exactly the slots on the bench: the sim crafts from those, not from look-alikes.
      this.send(OP.CRAFT, maskOf(this.bench));
      this.bench = [];
      this.uiRev++;
      return;
    }
    const recipe = target.closest<HTMLElement>('[data-recipe]');
    if (recipe) {
      // From the handbook: lay out what it takes, if it's all here.
      this.click();
      const used = ingredientSlots(v.items, Number(recipe.dataset.recipe));
      if (used) {
        this.bench = used;
        this.tab = 'bench';
      } else this.toast(t('craft.nothing'));
      this.uiRev++;
    }
  }

  update(v: ItemsView) {
    this.view = v;
    const it = v.items;
    // Bench entries that emptied (crafted, dropped) fall off; picks of a closed box go.
    for (let k = this.bench.length - 1; k >= 0; k--) if (!it.inv[this.bench[k]]) (this.bench.splice(k, 1), this.uiRev++);
    if (this.picked !== null && it.open < 0) (this.picked = null), this.uiRev++;
    if (this.menu !== null && !it.inv[this.menu]) (this.menu = null), this.uiRev++;
    this.updateAction(v);
    this.bar.classList.toggle('asleep', v.sleeping);
    // Redraw only on a change: the sim's item revision, the UI's own, or the language.
    if (it.rev === this.simRev && this.uiRev === this.drawnUi && v.boxTitle === this.drawn) return;
    this.simRev = it.rev;
    this.drawnUi = this.uiRev;
    this.drawn = v.boxTitle;

    this.slots.forEach((s, k) => {
      // Something new landed here: a little pop (not on the first draw).
      if (this.lastInv.length && it.inv[k] && itemOf(it.inv[k]) !== itemOf(this.lastInv[k] ?? 0)) {
        s.classList.remove('arrive');
        void s.offsetWidth;
        s.classList.add('arrive');
      }
      s.innerHTML = slotInner(it.inv[k]) || (k === SLOT.WEAPON ? icon('sword', 18) : k === SLOT.OUTFIT ? icon('shirt', 18) : '');
      s.classList.toggle('filled', !!it.inv[k]);
      s.classList.toggle('hand', k === it.hand && !this.craftOpen && it.open < 0);
      s.classList.toggle('picked', this.picked === k || this.menu === k);
      s.classList.toggle('on-bench', this.bench.includes(k));
      s.title = it.inv[k] ? itemName(itemOf(it.inv[k])) : k === SLOT.WEAPON ? t('items.weapon') : k === SLOT.OUTFIT ? t('items.outfit') : '';
    });

    this.lastInv = it.inv.slice();
    // The open container.
    const box = it.containers[it.open];
    this.box.classList.toggle('hidden', !box);
    if (box) {
      setText(this.boxTitle, v.boxTitle);
      const cell = (k: number) => `<button class="slot${box[k] ? ' filled' : ''}${this.picked === SLOT.CONTAINER + k ? ' picked' : ''}" data-addr="${SLOT.CONTAINER + k}" title="${box[k] ? itemName(itemOf(box[k])) : ''}">${slotInner(box[k])}</button>`;
      this.box.querySelector('.box-hidden-wrap')!.classList.toggle('hidden', v.boxHidden === 0);
      this.box.classList.toggle('plain', v.boxHidden === 0);
      this.boxHidden.innerHTML = Array.from({ length: v.boxHidden }, (_, k) => cell(k)).join('');
      this.boxDrawers.innerHTML = Array.from({ length: box.length - v.boxHidden }, (_, k) => cell(v.boxHidden + k)).join('');
    }

    this.craft.classList.toggle('hidden', !this.craftOpen);
    if (this.craftOpen) this.drawCraft(it);
    this.drawInfo(v);
  }

  /** The action button (touch) or the key prompt (keyboard), following what's in reach. */
  private updateAction(v: ItemsView) {
    const a = v.sleeping ? { verb: t('act.wake'), what: '' } : v.action;
    const show = !!a && !this.craftOpen;
    this.act.classList.toggle('hidden', !show || !TOUCH);
    this.prompt.classList.toggle('hidden', !show || TOUCH || v.sleeping);
    if (!show || !a) return;
    const label = `${a.verb}|${a.what}`;
    // A round button with the verb, and what it applies to on a tag beside it (long names fit).
    if (TOUCH) {
      if (this.act.dataset.label === label) return;
      this.act.dataset.label = label;
      this.act.innerHTML = `<i class="act-round">${icon(v.sleeping ? 'sun' : 'hand', 24)}<span></span></i>${a.what ? '<b class="act-what"></b>' : ''}`;
      this.act.querySelector('span')!.textContent = a.verb;
      if (a.what) this.act.querySelector('b')!.textContent = a.what;
      this.act.classList.remove('pop');
      void this.act.offsetWidth;
      this.act.classList.add('pop');
    } else if (this.prompt.dataset.label !== label) {
      this.prompt.dataset.label = label;
      this.prompt.innerHTML = `<kbd>E</kbd><span></span><b></b>`;
      this.prompt.querySelector('span')!.textContent = a.verb;
      this.prompt.querySelector('b')!.textContent = a.what;
    }
  }

  private drawCraft(it: ItemState) {
    const { recipe: r, check } = benchCheck(it, maskOf(this.bench));
    const resultN = r >= 0 ? ITEMS.findIndex((d) => d.id === RECIPES[r].result) + 1 : 0;
    const can = check === 'ok';
    let msg = TOUCH ? t('craft.pick') : t('craft.pickKeys');
    if (this.bench.length && r < 0) msg = t('craft.nothing');
    if (r >= 0) msg = can ? t('craft.make', { item: itemName(resultN) }) : t('craft.needInt', { n: RECIPES[r].int, have: it.int });
    const bench = [0, 1, 2]
      .map((k) => (this.bench[k] !== undefined ? `<button class="slot filled" data-bench="${k}">${slotInner(it.inv[this.bench[k]])}</button>` : `<i class="slot empty"></i>`))
      .join(`<i class="bench-plus">+</i>`);
    const book = it.known.length
      ? it.known
          .map((k) => {
            const rec = RECIPES[k];
            const res = ITEMS.findIndex((d) => d.id === rec.result) + 1;
            const have = !!ingredientSlots(it, k);
            const ings = rec.ingredients.map((ing) => `<img src="${itemIcons()[ITEMS.findIndex((d) => d.id === ing.split('|')[0]) + 1]}" alt="">`).join('');
            return `<button class="book-row${have ? '' : ' missing'}" data-recipe="${k}"><img src="${itemIcons()[res]}" alt=""><span><b>${itemName(res)}</b><em>${ings}</em></span><small>${t('craft.int', { n: rec.int })}</small></button>`;
          })
          .join('')
      : `<p class="book-empty">${t('craft.handbookEmpty')}</p>`;
    this.craft.innerHTML = `<div class="panel-head"><div class="tabs"><button data-tab="bench" class="${this.tab === 'bench' ? 'on' : ''}">${icon('hammer', 16)}${t('craft.title')}</button><button data-tab="book" class="${this.tab === 'book' ? 'on' : ''}">${icon('book', 16)}${t('craft.handbook')}</button></div><button class="icon-btn small" data-close aria-label="${t('box.close')}">${icon('close', 18)}</button></div>
      ${
        this.tab === 'bench'
          ? `<div class="bench">${bench}<i class="bench-arrow">${icon('chevronRight', 20)}</i><i class="slot result${resultN ? ' filled' : ''}${r >= 0 && !can ? ' locked' : ''}">${resultN ? slotInner(resultN) : ''}</i></div>
        <p class="bench-msg${r >= 0 && !can ? ' warn' : ''}">${msg}</p>
        <div class="bench-actions"><button class="big-btn ghost small" data-clear ${this.bench.length ? '' : 'disabled'}>${t('craft.clear')}</button><button class="big-btn primary small" ${can ? 'data-make' : 'disabled'}>${icon('hammer', 18)}${t('craft.open')}</button></div>
        <p class="bench-int">${t('craft.int', { n: it.int })}</p>`
          : `<div class="book">${book}</div>`
      }`;
  }

  /** The item strip: what's picked or menu'd, with what can be done with it. */
  private drawInfo(v: ItemsView) {
    const it = v.items;
    const addr = this.menu ?? this.picked;
    const value = addr === null ? 0 : addr < SLOT.CONTAINER ? it.inv[addr] : (it.containers[it.open]?.[addr - SLOT.CONTAINER] ?? 0);
    this.info.classList.toggle('hidden', !value || this.craftOpen);
    if (!value || addr === null) return;
    const n = itemOf(value);
    const d = itemDef(n);
    const tags = [d.contraband ? `<em class="cb">${t('items.contraband')}</em>` : '', d.uses ? `<em>${t('items.uses', { n: usesOf(value) })}</em>` : ''].join('');
    const buttons: string[] = [];
    if (this.menu !== null) {
      if (addr < HOTBAR && (d.cat === 'weapon' || d.cat === 'outfit')) buttons.push(`<button data-do="equip" data-addr="${addr}">${d.cat === 'weapon' ? t('items.wield') : t('items.equip')}</button>`);
      if (addr === SLOT.WEAPON || addr === SLOT.OUTFIT) buttons.push(`<button data-do="unequip" data-addr="${addr}">${t('items.take')}</button>`);
      buttons.push(`<button data-do="drop" data-addr="${addr}">${t('items.drop')}</button>`);
    }
    this.info.innerHTML = `<img src="${itemIcons()[n]}" alt=""><div><b>${itemName(n)}</b><span>${tags}</span></div>${buttons.join('')}`;
  }
}
