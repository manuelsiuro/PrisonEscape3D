import { itemDef, ITEMS } from '../content/items';
import { RECIPES } from '../content/recipes';
import { EXT, OP, SLOT } from '../sim/command';
import { ingredientOptions } from '../sim/systems/recipes';
import { benchCheck, HOTBAR, ingredientSlots, itemOf, maskOf, usesOf, type ItemState } from '../sim/systems/items';
import { clockRinging, clockSecs } from '../sim/systems/noise';
import { ALARM_CLOCK } from '../sim/systems/structure';
import { itemIcons } from '../render/itemIcons';
import { currentLang, t, type Key } from '../i18n';
import { h, setText, TOUCH } from './dom';
import { icon } from './icons';

/** What the item UI shows each frame. */
export interface ItemsView {
  items: ItemState;
  /** The open container's title and its hidden slot count. */
  boxTitle: string;
  boxHidden: number;
  /** The open container is the player's own (their desk: the hidden compartment comes first). */
  boxMine: boolean;
  /** Items the player has carried, and recipes they were told (the handbook's mysteries and tips). */
  carried: readonly number[];
  tips: readonly number[];
  /** Whether a recipe is any use in this prison (its result can be had here). */
  usable: (recipe: number) => boolean;
  /** What the action button would do now: a verb ("Search") and what to ("your desk"), or null. */
  action: { verb: string; what: string; no?: boolean } | null;
  sleeping: boolean;
  /** The open container is the player's desk with a tunnel dug under it (GDD §9.3): offer the way down. */
  deskTunnel: boolean;
  /** The open container is a library shelf (GDD §3.2): offer a book to study. */
  study: boolean;
  /** P28: what can be taken on request from the open furniture (fruit at a meal, sugar, seed packets): TAKE, its label, why not ('' it can be). */
  take: ReadonlyArray<{ what: number; label: string; why: string }>;
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

/** What a wound alarm clock shows (P14): its seconds to go, 'ring' while it rings, '' stopped or not a clock. */
const clockFace = (v: number) => (itemOf(v) === ALARM_CLOCK && usesOf(v) > 0 ? (clockRinging(v) ? 'ring' : String(clockSecs(v))) : '');
/** What the item card says of an alarm clock. */
const clockText = (v: number) => (clockRinging(v) ? t('items.ringing') : clockSecs(v) ? t('items.clockIn', { n: clockSecs(v) }) : t('items.clockOff'));

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
  private lang = '';
  private simRev = -1;
  private drawnUi = -1;
  /** What each carried slot held at the last redraw (an arrival pops the slot). */
  private lastInv: number[] = [];
  /**
   * Alarm clocks (P14) count down once a second: their faces are kept up to date in place, not
   * by a redraw (a button replaced under a click loses it). What each pocket's face shows, and
   * the item card's line about a clock.
   */
  private clocks: string[] = [];
  private cardClock: HTMLElement | null = null;
  private cardAddr = -1;
  /** Called when the player wants to interact (the action button). */
  onAction: () => void = () => {};
  /** Called when the player picks Throw for the item in hand (P14): the aim takes over. */
  onThrow: () => void = () => {};

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
    const craftBtn = h('button', 'slot craft-btn', `${icon('hammer', 22)}<span data-t="craft.open"></span>`);
    craftBtn.addEventListener('click', () => this.toggleCraft());
    this.bar.append(craftBtn);
    this.craftBtn = craftBtn;
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
      `<div class="panel-head"><b></b><button class="icon-btn small" data-close data-t-label="box.close">${icon('close', 18)}</button></div>
      <div class="box-tunnel hidden"><span data-t="box.tunnel"></span><button class="big-btn primary small" data-climb>${icon('down', 18)}<span data-t="box.climbDown"></span></button></div>
      <div class="box-tunnel box-study hidden"><span><b data-t="box.study"></b><small data-t="box.studyNote"></small></span><button class="big-btn primary small" data-study>${icon('book', 18)}<span data-t="train.study"></span></button></div>
      <div class="box-take hidden"></div>
      <div class="box-section box-hidden-wrap"><div class="box-label">${icon('lock', 14)}<span data-t="box.hidden"></span><em data-t="box.hiddenNote"></em></div><div class="slot-grid box-hidden"></div></div>
      <div class="box-section"><div class="box-label"><span data-t="box.drawers"></span></div><div class="slot-grid box-drawers"></div></div>`,
    );
    this.boxTitle = this.box.querySelector('.panel-head b')!;
    this.boxHidden = this.box.querySelector('.box-hidden')!;
    this.boxDrawers = this.box.querySelector('.box-drawers')!;
    this.box.querySelector('[data-close]')!.addEventListener('click', () => {
      this.click();
      this.send(OP.CLOSE);
    });
    this.box.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-climb]')) {
        this.click();
        this.send(OP.INTERACT, 1);
        return;
      }
      if ((e.target as HTMLElement).closest('[data-study]')) {
        this.click();
        this.send(OP.TRAIN, 0);
        return;
      }
      const take = (e.target as HTMLElement).closest<HTMLElement>('[data-take]');
      if (take) {
        this.click();
        this.send(OP.EXT, EXT.TAKE, Number(take.dataset.take));
        return;
      }
      this.slotClick(e);
    });

    this.craft = h('div', 'item-panel craft-panel hidden');
    this.craft.addEventListener('click', (e) => this.craftClick(e));

    this.info = h('div', 'item-info hidden');
    this.info.addEventListener('click', (e) => this.infoClick(e));
    this.toastEl = h('div', 'item-toast hidden');
    document.body.append(this.bar, this.act, this.prompt, this.box, this.craft, this.info, this.toastEl);
    // Clicking a slot must not leave it focused: Space and Enter belong to the game.
    for (const el of [this.bar, this.act, this.box, this.craft, this.info]) el.addEventListener('mousedown', (e) => e.preventDefault());
  }

  /** Writes the fixed labels in the current language (at start, and when it changes). */
  private relabel() {
    this.lang = currentLang();
    for (const root of [this.bar, this.box]) {
      root.querySelectorAll<HTMLElement>('[data-t]').forEach((el) => (el.textContent = t(el.dataset.t as Key)));
      root.querySelectorAll<HTMLElement>('[data-t-label]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.tLabel as Key)));
    }
    this.uiRev++;
  }

  show(on: boolean) {
    for (const el of [this.bar]) el.classList.toggle('hidden', !on);
    if (!on) {
      for (const el of [this.act, this.prompt, this.box, this.craft, this.info]) el.classList.add('hidden');
      document.body.classList.remove('item-card');
      this.craftOpen = false;
      this.newRecipe = false;
      this.craftBtn.classList.remove('has-new');
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

  private craftBtn!: HTMLElement;
  /** A recipe was told and the handbook not looked at since: a dot on the Craft button and the tab. */
  private newRecipe = false;

  /** A recipe told (a tip): the dot until the handbook is opened. */
  markNewRecipe() {
    this.newRecipe = true;
    this.craftBtn.classList.add('has-new');
    this.uiRev++;
  }

  /** Called as the workbench opens: whatever social panel is up (a talk, the board, the file) goes. */
  onCraftOpen: (() => void) | null = null;

  toggleCraft() {
    this.click();
    this.craftOpen = !this.craftOpen;
    if (this.craftOpen) this.onCraftOpen?.();
    // A recipe told since the handbook was last looked at: straight to it.
    if (this.craftOpen && this.newRecipe) this.tab = 'book';
    this.bench = [];
    this.picked = this.menu = null;
    if (this.craftOpen && (this.view?.items.open ?? -1) >= 0) this.send(OP.CLOSE);
    this.uiRev++;
  }

  /** A short note over the hotbar ("Your pockets are full", "Crafted: …"). */
  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden', 'show');
    // Long notes (what a tool needs) stay up long enough to read.
    this.toastEl.classList.toggle('long', text.length > 34);
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
      // Tap an item, then where it goes; the same item twice sends it across (the first free
      // pocket, or the container's first free slot: the hidden compartment first in a desk).
      if (this.picked === null) {
        if (value) this.picked = addr;
      } else {
        let to = addr;
        if (addr === this.picked) {
          const box = it.containers[it.open] ?? [];
          // Someone else's desk: its drawers first (their hidden compartment is no place for the player's things).
          const from = v.boxMine ? 0 : v.boxHidden;
          const inBox = box.findIndex((x, k) => k >= from && !x);
          const free = addr >= SLOT.CONTAINER ? it.inv.slice(0, HOTBAR).findIndex((x) => !x) : inBox >= 0 ? inBox : box.findIndex((x) => !x);
          to = free < 0 ? addr : addr >= SLOT.CONTAINER ? free : SLOT.CONTAINER + free;
          if (free < 0) this.toast(t(addr >= SLOT.CONTAINER ? 'items.full' : 'items.boxFull'));
        }
        if (to !== this.picked) this.send(OP.MOVE, this.picked, to);
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
      case 'throw':
        this.onThrow();
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
      this.send(OP.CRAFT, maskOf(this.bench), benchCheck(this.view!.items, maskOf(this.bench)).recipe + 1);
      this.bench = [];
      this.uiRev++;
      return;
    }
    // A mystery with ingredients still unseen: how to see them.
    if (target.closest('[data-mystery]')) {
      this.click();
      this.toast(t('craft.mysteryHint'));
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
    if (this.lang !== currentLang()) this.relabel();
    const it = v.items;
    // Bench entries that emptied (crafted, dropped) fall off; picks of a closed box go.
    for (let k = this.bench.length - 1; k >= 0; k--) if (!it.inv[this.bench[k]]) (this.bench.splice(k, 1), this.uiRev++);
    if (this.picked !== null && it.open < 0) (this.picked = null), this.uiRev++;
    if (this.menu !== null && !it.inv[this.menu]) (this.menu = null), this.uiRev++;
    this.updateAction(v);
    this.bar.classList.toggle('asleep', v.sleeping);
    // Redraw only on a change: the sim's item revision, the UI's own, or the language.
    const drawn = `${v.boxTitle}|${v.deskTunnel}|${v.study}|${v.take.map((x) => `${x.what}:${x.label}:${x.why}`).join(',')}`;
    if (it.rev === this.simRev && this.uiRev === this.drawnUi && drawn === this.drawn) {
      this.tickClocks(it);
      return;
    }
    this.simRev = it.rev;
    this.drawnUi = this.uiRev;
    this.drawn = drawn;

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
    // The redraw wiped the clocks' faces: put them back.
    this.clocks.length = 0;
    this.tickClocks(it);
    // The open container.
    const box = it.containers[it.open];
    this.box.classList.toggle('hidden', !box);
    if (box) {
      setText(this.boxTitle, v.boxTitle);
      const cell = (k: number) => `<button class="slot${box[k] ? ' filled' : ''}${this.picked === SLOT.CONTAINER + k ? ' picked' : ''}" data-addr="${SLOT.CONTAINER + k}" title="${box[k] ? itemName(itemOf(box[k])) : ''}">${slotInner(box[k])}</button>`;
      this.box.querySelector('.box-hidden-wrap')!.classList.toggle('hidden', v.boxHidden === 0);
      this.box.classList.toggle('plain', v.boxHidden === 0);
      this.box.querySelector('.box-tunnel:not(.box-study)')!.classList.toggle('hidden', !v.deskTunnel);
      this.box.querySelector('.box-study')!.classList.toggle('hidden', !v.study);
      // (P28: fruit, sugar, a seed packet, taken on request.)
      const take = this.box.querySelector<HTMLElement>('.box-take')!;
      take.classList.toggle('hidden', !v.take.length);
      take.innerHTML = v.take.map((x) => `<button class="big-btn small${x.why ? '' : ' primary'}" data-take="${x.what}"${x.why ? ' aria-disabled="true"' : ''}>${icon(x.what === 0 ? 'fruit' : x.what === 1 ? 'box' : 'sprout', 18)}<span><b>${x.label}</b>${x.why ? `<small>${x.why}</small>` : ''}</span></button>`).join('');
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
    const label = `${a.verb}|${a.what}|${!!a.no}`;
    // (P24: something there that won't do now, and says why: greyed, as the tool button is.)
    this.act.classList.toggle('no', !!a.no);
    this.prompt.classList.toggle('no', !!a.no);
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
    const book = this.drawBook(it);
    // The handbook looked at: the new recipe's dot goes.
    if (this.tab === 'book' && this.newRecipe) {
      this.newRecipe = false;
      this.craftBtn.classList.remove('has-new');
    }
    this.craft.innerHTML = `<div class="panel-head"><div class="tabs"><button data-tab="bench" class="${this.tab === 'bench' ? 'on' : ''}">${icon('hammer', 16)}${t('craft.title')}</button><button data-tab="book" class="${this.tab === 'book' ? 'on' : ''}${this.newRecipe ? ' has-new' : ''}">${icon('book', 16)}${t('craft.handbook')}</button></div><button class="icon-btn small" data-close aria-label="${t('box.close')}">${icon('close', 18)}</button></div>
      ${
        this.tab === 'bench'
          ? `<div class="bench">${bench}<i class="bench-arrow">${icon('chevronRight', 20)}</i><i class="slot result${resultN ? ' filled' : ''}${r >= 0 && !can ? ' locked' : ''}">${resultN ? slotInner(resultN) : ''}</i></div>
        <p class="bench-msg${r >= 0 && !can ? ' warn' : ''}">${msg}</p>
        <div class="bench-actions"><button class="big-btn ghost small" data-clear ${this.bench.length ? '' : 'disabled'}>${t('craft.clear')}</button><button class="big-btn primary small" ${can ? 'data-make' : 'disabled'}>${icon('hammer', 18)}${t('craft.open')}</button></div>
        <p class="bench-int">${t('craft.int', { n: it.int })}</p>`
          : `<div class="book">${book}</div>`
      }`;
  }

  /**
   * The handbook: recipes crafted, then recipes the player was told (a tip), then the mysteries
   * (P8+): every other recipe within their Intellect, its result hidden, each ingredient shown
   * once they've carried it (the most nearly known first), and how many more need more Intellect.
   */
  private drawBook(it: ItemState): string {
    const v = this.view!;
    const icons = itemIcons();
    const seen = (k: number, j: number) => ingredientOptions(k, j).find((n) => v.carried.includes(n)) ?? 0;
    const row = (k: number, tip: boolean) => {
      const rec = RECIPES[k];
      const res = ITEMS.findIndex((d) => d.id === rec.result) + 1;
      const have = !!ingredientSlots(it, k);
      // Each ingredient as the player knows it (the toothbrush they carried, not the comb).
      const ings = rec.ingredients.map((_, j) => `<img src="${icons[seen(k, j) || ingredientOptions(k, j)[0]]}" alt="">`).join('');
      return `<button class="book-row${have ? '' : ' missing'}" data-recipe="${k}"><img src="${icons[res]}" alt=""><span><b>${itemName(res)}${tip ? `<i class="book-tag">${t('craft.tip')}</i>` : ''}</b><em>${ings}</em></span><small>${t('craft.int', { n: rec.int })}</small></button>`;
    };
    const tips = v.tips.filter((k) => !it.known.includes(k));
    const mysteries = RECIPES.map((rec, k) => ({ rec, k, n: rec.ingredients.filter((_, j) => seen(k, j)).length }))
      .filter(({ rec, k }) => rec.int <= it.int && !it.known.includes(k) && !tips.includes(k) && v.usable(k))
      .sort((a, b) => b.n / b.rec.ingredients.length - a.n / a.rec.ingredients.length || a.k - b.k)
      .map(({ rec, k, n }) => {
        const all = n === rec.ingredients.length;
        const have = all && !!ingredientSlots(it, k);
        const ings = rec.ingredients.map((_, j) => (seen(k, j) ? `<img src="${icons[seen(k, j)]}" alt="">` : `<i class="book-q">?</i>`)).join('');
        return `<button class="book-row mystery${all && !have ? ' missing' : ''}" ${all ? `data-recipe="${k}"` : 'data-mystery'} aria-label="${t('craft.unknown')}"><i class="book-unknown">?</i><span><b>${t('craft.unknown')}</b><em>${ings}</em></span><small>${t('craft.int', { n: rec.int })}</small></button>`;
      });
    const locked = RECIPES.filter((rec, k) => rec.int > it.int && !it.known.includes(k) && !tips.includes(k) && v.usable(k)).length;
    return [
      ...it.known.map((k) => row(k, false)),
      ...tips.map((k) => row(k, true)),
      mysteries.length ? `<div class="box-label book-head">${icon('help', 14)}<span>${t('craft.mysteries')}</span><em>${t('craft.mysteriesNote')}</em></div>` : '',
      ...mysteries,
      locked ? `<p class="book-more">${icon('lock', 14)}${(locked === 1 ? t('craft.moreIntOne') : t('craft.moreInt', { n: locked }))}</p>` : '',
    ].join('');
  }

  /** Between redraws: each alarm clock's face in the pockets, and the card's line about one, where they changed. */
  private tickClocks(it: ItemState) {
    for (let k = 0; k < HOTBAR; k++) {
      const face = clockFace(it.inv[k]);
      if (face === (this.clocks[k] ?? '')) continue;
      this.clocks[k] = face;
      const slotEl = this.slots[k];
      let badge = slotEl.querySelector<HTMLElement>('.slot-clock');
      if (!face) {
        badge?.remove();
        continue;
      }
      if (!badge) {
        badge = h('i', 'slot-clock');
        slotEl.append(badge);
      }
      badge.classList.toggle('ringing', face === 'ring');
      badge.innerHTML = face === 'ring' ? icon('bell', 11) : face;
    }
    if (this.cardClock?.isConnected) {
      const v = this.cardAddr < SLOT.CONTAINER ? it.inv[this.cardAddr] : (it.containers[it.open]?.[this.cardAddr - SLOT.CONTAINER] ?? 0);
      if (itemOf(v) === ALARM_CLOCK) setText(this.cardClock, clockText(v));
    }
  }

  /** The item strip: what's picked or menu'd, with what can be done with it. */
  private drawInfo(v: ItemsView) {
    const it = v.items;
    const addr = this.menu ?? this.picked;
    const value = addr === null ? 0 : addr < SLOT.CONTAINER ? it.inv[addr] : (it.containers[it.open]?.[addr - SLOT.CONTAINER] ?? 0);
    this.info.classList.toggle('hidden', !value || this.craftOpen);
    // While an item's card is up, the prompts and the energy pill under it step aside.
    document.body.classList.toggle('item-card', !!value && !this.craftOpen);
    if (!value || addr === null) return;
    const n = itemOf(value);
    const d = itemDef(n);
    // An alarm clock says when it rings (P14), not how it wears.
    const clock = n === ALARM_CLOCK ? `<em class="clock">${clockText(value)}</em>` : '';
    const tags = [d.contraband ? `<em class="cb">${t('items.contraband')}</em>` : '', d.uses ? `<em>${d.id === 'pruno_bag' ? t('items.brewDays', { n: usesOf(value) }) : t('items.uses', { n: usesOf(value) })}</em>` : '', clock].join('');
    const buttons: string[] = [];
    if (this.menu !== null) {
      if (addr < HOTBAR && (d.cat === 'weapon' || d.cat === 'outfit')) buttons.push(`<button data-do="equip" data-addr="${addr}">${d.cat === 'weapon' ? t('items.wield') : t('items.equip')}</button>`);
      if (addr === SLOT.WEAPON || addr === SLOT.OUTFIT) buttons.push(`<button data-do="unequip" data-addr="${addr}">${t('items.take')}</button>`);
      // The item in hand can be thrown (P14), on the ground floor only (the sim says why not elsewhere).
      if (addr === it.hand) buttons.push(`<button data-do="throw" data-addr="${addr}">${icon('toss', 14)}${t('items.throw')}</button>`);
      buttons.push(`<button data-do="drop" data-addr="${addr}">${t('items.drop')}</button>`);
    }
    this.info.innerHTML = `<img src="${itemIcons()[n]}" alt=""><div><b>${itemName(n)}</b><span>${tags}</span></div>${buttons.join('')}`;
    // A clock's line counts down in place (see tickClocks).
    this.cardClock = this.info.querySelector('em.clock');
    this.cardAddr = addr;
  }
}
