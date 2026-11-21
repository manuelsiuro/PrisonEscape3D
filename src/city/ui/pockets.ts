import { COOP } from '../content/alive';
import { t, textStamp, type Key } from '../../i18n';
import { keyLabel } from '../../i18n/keys';
import { photos } from '../../render/itemIcons';
import { h, setText, TOUCH } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { CITY_ITEMS, cityItem, cityItemNumber } from '../content/items';
import { PEOPLE } from '../content/people';
import { CITY_RECIPES } from '../content/recipes';
import { COP, GEAR_OPS, PIECE_OPS, POCKETS, REPAIR_OPS, type Stack, type Target } from '../sim/City';
import { REPAIR } from '../content/recipes';
import { PIECES } from '../content/build';
import { TRAP } from '../content/rush';

/** 2.67: each piece's icon in the Build panel. */
const PIECE_ICONS: Record<string, Parameters<typeof icon>[0]> = {
  barricade: 'shield',
  plankWall: 'board',
  metalWall: 'shield',
  door: 'home',
  chest: 'box',
  cot: 'moon',
  workbench: 'wrench',
  campfire: 'flame',
  table: 'utensils',
  chair: 'person',
  rug: 'sparkle',
  spikes: 'pick',
  barbedWire: 'needle',
  snare: 'hook',
  cans: 'bell',
  scarecrow: 'shirt',
  sentry: 'target',
};

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
  /** 2.64: the box open is a bed that can be slept in from its card (not one the story still has something in). */
  sleepable: boolean;
  /** 2.65: a bed by day is a rest till dusk. */
  rest: boolean;
  /** 2.66: the open piece breaks up into these (null: it doesn't), and something carried can break it. */
  breaks: readonly Stack[] | null;
  breakCan: boolean;
  /** 2.67: the Build panel's pieces, what each lacks ('ok': it can go up); the piece being placed (-1 none) and whether it can go where it would; the open built piece. */
  builds: ReadonlyArray<'ok' | 'hammer' | 'parts' | 'unknown' | 'none'>;
  /** 2.71: what each piece takes (a Handy player's, less). */
  buildFrom: ReadonlyArray<ReadonlyArray<readonly [string, number]>>;
  placing: number;
  placeWhy: string;
  piece: PieceCard | null;
  /** 2.64: the torch: on, and its battery's game minutes left (its card says both). */
  torchOn: boolean;
  torchLeft: number;
  searched: boolean;
  searching: number;
  asleep: boolean;
  /** A door in reach is barred (the button takes its boards down). */
  barred: boolean;
  /** What each recipe lacks now ('ok': it can be made). */
  recipes: ReadonlyArray<'ok' | 'parts' | 'bench' | 'stove' | 'unknown' | 'shop' | 'smoker' | 'none'>;
  /** 2.69: what's worn: armour [item, bites left] ([0, 0] none); a bag (its item, 0 none), its slots and how many hold something. */
  armour: Stack;
  bag: number;
  bagSlots: number;
  bagUsed: number;
  bagThings: readonly Stack[];
  /** 2.70: a fishing rod in the pockets (the button at water fishes). */
  rod: boolean;
  /** The survivor in reach (their id; '' none). */
  person: string;
  /** The way out in reach: what the button does with it ('begin1'–'3', 'go2', 'go3'; '' none). */
  way: string;
  /** 2.60: the weapon that strikes (its item number; 0: fists), the blows left in it and those it had new; whether the arm is ready for another blow. */
  weapon: number;
  blows: number;
  blowsOf: number;
  ready: boolean;
}

/** 2.67: a built piece's card: its kind, health, a repair's cost and whether it can be done, a campfire's minutes left (-1: not one). */
export interface PieceCard {
  kind: number;
  hp: number;
  max: number;
  repair: readonly Stack[];
  canRepair: 'ok' | 'hammer' | 'parts' | 'full';
  fire: number;
  chest: boolean;
  /** 2.68: a sentry's bolts (-1: not one). */
  bolts: number;
  /** 2.70: a planter's stage (-1 not one; 0 empty, 1–3 growing, 4 ready) and whether it's been watered today; a barrel's drinks (-1 not one). */
  planter: number;
  watered: boolean;
  drinks: number;
  /** 2.71: a coop's hens and eggs (-1: not one). */
  hens: number;
  eggs: number;
}

/** The city's things photographed (by item number; 0 unused), once. */
let icons: string[] | null = null;
const iconOf = (n: number) => (icons ??= ['', ...photos(CITY_ITEMS.map((d) => ({ ...d, id: `city.${d.id}` })))])[n] ?? '';

/** What a thing does when used, in a line ("+30 hunger · +12 energy"); '' for what isn't used. */
/** 2.52: the pockets' lights, used to light something: their line and their button. */
const LIGHTS: Record<string, { line: Key; verb: Key; icon: 'flame' | 'bulb' | 'hand' }> = {
  torch: { line: 'city.gives.torch', verb: 'city.thing.torchOn', icon: 'bulb' },
  lantern: { line: 'city.gives.lantern', verb: 'city.thing.setDown', icon: 'flame' },
  fuel: { line: 'city.gives.fuel', verb: 'city.thing.light', icon: 'flame' },
  // (2.55: thrown.)
  bottle: { line: 'city.gives.bottle', verb: 'city.thing.throw', icon: 'hand' },
  molotov: { line: 'city.gives.molotov', verb: 'city.thing.throw', icon: 'flame' },
  // (2.69: the tricks.)
  smoke_bomb: { line: 'city.gives.smoke', verb: 'city.thing.throw', icon: 'hand' },
  flare: { line: 'city.gives.flare', verb: 'city.thing.throw', icon: 'flame' },
  noisemaker: { line: 'city.gives.noisemaker', verb: 'city.thing.setDown', icon: 'hand' },
};

/** 2.69: what a press of a worn thing's or a manual's card button does, and its icon. */
const WEAR: Partial<Record<string, { verb: Key; icon: 'book' | 'shield' | 'box' }>> = {
  manual: { verb: 'city.thing.read', icon: 'book' },
  armour: { verb: 'city.thing.wear', icon: 'shield' },
  bag: { verb: 'city.thing.wearBag', icon: 'box' },
};

export function useLine(n: number): string {
  const light = LIGHTS[cityItem(n)?.id ?? ''];
  if (light) return t(light.line);
  // (2.69: a manual, what's worn.)
  const def = cityItem(n);
  if (def?.manual !== undefined)
    return t('city.gives.manual', {
      what: CITY_RECIPES.filter((r) => r.manual === def.manual)
        .map((r) => itemName(cityItemNumber(r.makes)))
        .join(', '),
    });
  if (def?.kind === 'armour')
    return def.dry
      ? t('city.gives.raincoat')
      : def.hidden
        ? t('city.gives.poncho')
        : t(def.slow ? 'city.gives.armourSlow' : 'city.gives.armour', { n: def.armour ?? 0 });
  if (def?.kind === 'bag') return t('city.gives.bag', { n: def.slots ?? 0 });
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
  /** 2.67: the Build panel (its button beside Make's), and the button that stops placing pieces. */
  readonly build: HTMLElement;
  buildOpen = false;
  private shownBuild = '';
  readonly stop: HTMLButtonElement;
  onBuild: () => void = () => {};
  onPick: (kind: number) => void = () => {};
  onStop: () => void = () => {};
  private shownMake = '';
  readonly act: HTMLButtonElement;
  /** The blow: always there in play (Space). */
  readonly hit: HTMLButtonElement;
  private shownInv = '';
  private shownBox = '';
  private shownAct = '';
  private shownHit = '';
  private shownKeys = '';
  private lang = '';
  /** The pocket whose card is up (-1 none). */
  picked = -1;
  /** 2.69: what's worn: the armour's and the bag's buttons (under the corner map); the armour's card up instead of a pocket's. */
  readonly worn: HTMLElement;
  wornCard = false;
  private shownWorn = '';
  /** A command for the simulation (op, a), and the action button. */
  onOp: (op: number, a?: number) => void = () => {};
  onAct: () => void = () => {};
  onHit: () => void = () => {};
  onMake: () => void = () => {};

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
    this.build = h('div', 'item-panel city-make city-build hidden');
    this.build.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-b], [data-c]');
      if (!el) return;
      if (el.dataset.b !== undefined) this.onPick(Number(el.dataset.b));
      else this.toggleBuild(false);
    });
    this.stop = h('button', 'big-btn ghost city-stop hidden') as HTMLButtonElement;
    this.stop.addEventListener('click', () => this.onStop());
    this.act = h('button', 'act-btn city-act hidden');
    this.act.addEventListener('click', () => this.onAct());
    this.hit = h(
      'button',
      'tool-btn city-hit hidden',
      `<i class="tool-round"><i class="tool-ring"></i><i class="hit-icon">${icon('fist', 22)}</i><span></span></i><b class="hit-left hidden"></b>`,
    );
    this.hit.addEventListener('click', () => this.onHit());
    this.bar.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.build-btn')) return this.onBuild();
      if ((e.target as HTMLElement).closest('.craft-btn')) return this.onMake();
      const k = (e.target as HTMLElement).closest<HTMLElement>('[data-k]')?.dataset.k;
      if (k !== undefined) this.pick(Number(k));
    });
    this.panel.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-slot], [data-c]');
      if (!el) return;
      if (el.dataset.slot !== undefined) this.onOp(COP.TAKE, Number(el.dataset.slot));
      else if (el.dataset.c === 'all') this.onOp(COP.TAKE_ALL);
      else if (el.dataset.c === 'sleep') this.onOp(COP.SLEEP);
      else if (el.dataset.c === 'break') this.onOp(COP.BREAK);
      else if (el.dataset.c === 'repair') this.onOp(COP.BUILD, PIECE_OPS);
      else if (el.dataset.c === 'down') this.onOp(COP.BUILD, PIECE_OPS + 1);
      else if (el.dataset.c === 'feed') this.onOp(COP.BUILD, PIECE_OPS + 2);
      else if (el.dataset.c === 'bagOff') this.onOp(COP.USE, GEAR_OPS + 1);
      // (2.70: a planter's and a barrel's buttons.)
      else if (/^g[3-9]$/.test(el.dataset.c ?? '')) this.onOp(COP.BUILD, PIECE_OPS + Number(el.dataset.c!.slice(1)));
      else this.onOp(COP.CLOSE);
    });
    this.card.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>('[data-c]')?.dataset.c;
      if (!c) return;
      // (2.69: what's worn: taken off from its own card.)
      if (c === 'off') {
        this.onOp(COP.USE, GEAR_OPS);
        this.wornCard = false;
        this.shownInv = '';
        return;
      }
      if (c === 'use') this.onOp(COP.USE, this.picked);
      else if (c === 'mend') this.onOp(COP.MAKE, REPAIR_OPS + this.picked);
      else if (c === 'drop') this.onOp(COP.DROP, this.picked);
      else if (c === 'store') this.onOp(COP.STORE, this.picked);
      if (c !== 'use') this.pick(-1);
    });
    this.worn = h('div', 'city-worn hidden');
    this.worn.addEventListener('click', (e) => {
      const w = (e.target as HTMLElement).closest<HTMLElement>('[data-w]')?.dataset.w;
      if (w === 'bag') return this.onOp(COP.USE, GEAR_OPS + 2);
      if (w === 'armour') {
        this.wornCard = !this.wornCard;
        this.picked = -1;
        this.shownInv = '';
      }
    });
    document.body.append(this.bar, this.panel, this.card, this.make, this.build, this.act, this.hit, this.stop, this.worn);
  }

  show(on: boolean) {
    this.bar.classList.toggle('hidden', !on);
    this.hit.classList.toggle('hidden', !on);
    if (!on) for (const el of [this.panel, this.card, this.act, this.make, this.build, this.stop, this.worn]) el.classList.add('hidden');
    this.shownInv = this.shownBox = this.shownAct = this.shownMake = this.shownHit = this.shownBuild = this.shownWorn = '';
    this.wornCard = false;
    this.picked = -1;
    this.makeOpen = false;
    this.buildOpen = false;
  }

  /** A pocket's card opened (the same again, or -1: shut). */
  pick(k: number) {
    this.picked = k === this.picked ? -1 : k;
    this.wornCard = false;
    this.shownInv = '';
    if (this.picked >= 0) this.toggleMake(false);
  }

  /** The Make panel opened or shut. */
  toggleMake(on = !this.makeOpen) {
    this.makeOpen = on;
    if (on) {
      this.picked = -1;
      this.toggleBuild(false);
    }
    this.shownMake = this.shownInv = '';
  }
  /** 2.67: the Build panel opened or shut. */
  toggleBuild(on = !this.buildOpen) {
    this.buildOpen = on;
    if (on) {
      this.picked = -1;
      if (this.makeOpen) this.toggleMake(false);
    }
    this.shownBuild = this.shownInv = '';
  }

  /** Whether a card or the box is up (Escape shuts them first). */
  get open() {
    return this.picked >= 0 || this.makeOpen || this.buildOpen;
  }
  /** Escape: whichever of them is up, shut. */
  shut() {
    this.picked = -1;
    this.toggleMake(false);
    this.toggleBuild(false);
  }

  update(s: PocketsState) {
    if (textStamp() !== this.lang) {
      this.lang = textStamp();
      this.shownInv = this.shownBox = this.shownAct = this.shownMake = this.shownHit = '';
      this.bar.setAttribute('aria-label', t('city.pockets'));
      setText(this.hit.querySelector('span')!, t('city.act.hit'));
      this.hit.setAttribute('aria-keyshortcuts', keyLabel('Space'));
    }
    // 2.69: what's worn, under the corner map: the armour (its bites left, its card) and the bag (how full; it opens).
    if (this.wornCard && !s.armour[0]) this.wornCard = false;
    const wk = `${s.armour.join()}|${s.bag}|${s.bagUsed}|${s.bagSlots}|${s.box === 'city.box.bag'}|${this.wornCard}|${textStamp()}`;
    if (wk !== this.shownWorn) {
      this.shownWorn = wk;
      this.worn.classList.toggle('hidden', !s.armour[0] && !s.bag);
      const full = cityItem(s.armour[0])?.wear ?? 1;
      this.worn.innerHTML = `${s.armour[0] ? `<button class="slot filled city-worn-btn${this.wornCard ? ' picked' : ''}" data-w="armour" aria-label="${itemName(s.armour[0])}" title="${itemName(s.armour[0])}"><img src="${iconOf(s.armour[0])}" alt=""><i class="slot-dur"><i style="width:${Math.round((100 * s.armour[1]) / full)}%"></i></i></button>` : ''}${s.bag ? `<button class="slot filled city-worn-btn${s.box === 'city.box.bag' ? ' picked' : ''}" data-w="bag" aria-label="${itemName(s.bag)}" title="${itemName(s.bag)}"><img src="${iconOf(s.bag)}" alt=""><i class="slot-n">${s.bagUsed}/${s.bagSlots}</i></button>` : ''}`;
    }
    // (The thing whose card was up is gone: the card too.)
    if (this.picked >= 0 && !s.inv[this.picked]?.[0]) this.picked = -1;
    const inv = `${JSON.stringify(s.inv)}|${this.picked}|${this.wornCard}|${s.armour.join()}|${s.box}|${s.torchOn}|${s.torchLeft >= 60 ? Math.round(s.torchLeft / 60) : s.torchLeft}|${textStamp()}`;
    if (inv !== this.shownInv) {
      this.shownInv = inv;
      this.bar.innerHTML = Array.from({ length: POCKETS }, (_, k) => {
        const [item, n] = s.inv[k] ?? [0, 0];
        return `<button class="slot${item ? ' filled' : ''}${k === this.picked ? ' picked' : ''}" data-k="${k}" data-key="${k + 1}"${item ? ` title="${itemName(item)}" aria-label="${counted(item, n)}"` : ` aria-label="${t('city.pocketEmpty', { n: k + 1 })}" disabled`}>${item ? slotInner(item, n) : ''}</button>`;
      }).join('');
      this.bar.insertAdjacentHTML(
        'beforeend',
        `<i class="hotbar-gap"></i><button class="slot craft-btn${this.makeOpen ? ' picked' : ''}" aria-label="${t('city.make.title')}" aria-keyshortcuts="${keyLabel('KeyC')}">${icon('hammer', 22)}<span>${t('city.make.open')}</span></button><button class="slot craft-btn build-btn${this.buildOpen ? ' picked' : ''}" aria-label="${t('city.build.title')}" aria-keyshortcuts="${keyLabel('KeyB')}">${icon('home', 22)}<span>${t('city.build.open')}</span></button>`,
      );
      this.card.classList.toggle('hidden', this.picked < 0 && !this.wornCard);
      // (2.69: the armour worn: what it takes, what's left in it, Take off.)
      if (this.picked < 0 && this.wornCard) {
        const [item, n] = s.armour;
        const def = cityItem(item)!;
        this.card.innerHTML = `<div class="ct-head"><i class="slot filled"><img src="${iconOf(item)}" alt=""></i><div><b>${itemName(item)} · ${t('city.thing.worn')}</b><small>${useLine(item)} · ${t('city.thing.bites', { n, of: def.wear ?? n })}</small></div></div>
          <div class="ct-actions"><button class="big-btn ghost" data-c="off">${icon('down', 16)}${t('city.thing.takeOff')}</button></div>`;
      }
      if (this.picked >= 0) {
        const [item, n] = s.inv[this.picked];
        const torch = cityItem(item)!.id === 'torch';
        // (2.64: the torch's card says whether it's on and what's left of its battery, and its button what a press does.)
        const line = torch
          ? `${useLine(item)} · ${s.torchLeft >= 60 ? t('city.thing.torchLeft', { h: Math.round(s.torchLeft / 60) }) : s.torchLeft > 0 ? t('city.thing.torchMinutes', { n: s.torchLeft }) : t('city.thing.torchEmpty')}`
          : useLine(item);
        const def = cityItem(item)!;
        const wear = def.wear;
        // (2.69: what's left in a thing that wears: shots, bites, blows.)
        const left =
          wear === undefined
            ? ''
            : t(def.shoots ? 'city.thing.shots' : def.kind === 'armour' ? 'city.thing.bites' : 'city.thing.blows', { n, of: wear });
        const sub =
          [line, line && def.kind === 'armour' ? left : ''].filter(Boolean).join(' · ') || left || t(`city.kindOf.${def.kind}` as Key);
        const worn = WEAR[def.kind];
        const verb = torch
          ? s.torchOn
            ? 'city.thing.torchOff'
            : 'city.thing.torchOn'
          : (worn?.verb ?? LIGHTS[def.id]?.verb ?? (def.kind === 'med' ? 'city.thing.apply' : 'city.thing.eat'));
        const useIcon = worn?.icon ?? LIGHTS[def.id]?.icon ?? (def.kind === 'med' ? 'heart' : 'utensils');
        // (2.69: a worn thing mended at a bench: what it takes.)
        const mend =
          wear !== undefined && n < wear
            ? `<button class="big-btn ghost" data-c="mend" title="${REPAIR[def.kind === 'armour' ? 'armour' : 'weapon'].map(([id, k]) => `${k} ${t(`city.item.${id}` as Key)}`).join(', ')}">${icon('wrench', 16)}${t('city.thing.mend')}</button>`
            : '';
        this.card.innerHTML = `<div class="ct-head"><i class="slot filled"><img src="${iconOf(item)}" alt=""></i><div><b>${counted(item, n)}</b><small>${sub}</small></div></div>
          <div class="ct-actions">${line ? `<button class="big-btn primary" data-c="use">${icon(useIcon, 16)}${t(verb)}</button>` : ''}${mend}${s.box && (!s.piece || s.piece.chest) && s.box !== 'city.box.drop' && s.box !== 'city.box.truck' ? `<button class="big-btn ghost" data-c="store">${icon('box', 16)}${t('city.thing.store')}</button>` : ''}<button class="big-btn ghost" data-c="drop">${icon('down', 16)}${t('city.thing.drop')}</button></div>`;
      }
    }
    const box = `${s.box}|${JSON.stringify(s.slots)}|${s.sleepable && s.rest}|${s.sleepable}|${JSON.stringify(s.breaks)}|${s.breakCan}|${JSON.stringify(s.piece)}|${textStamp()}`;
    if (box !== this.shownBox) {
      this.shownBox = box;
      this.panel.classList.toggle('hidden', !s.box);
      if (s.box) {
        const filled = s.slots.some((st) => st[0]);
        // (2.64: a bed used as a stash is still slept in, from here: its button opens it while it holds something.)
        const sleep = s.sleepable
          ? `<button class="big-btn" data-c="sleep">${icon('moon', 16)}${t(s.rest ? 'city.act.rest' : 'city.act.sleep')}</button>`
          : '';
        // (2.66: a piece that breaks: its button, and what comes of it, or what it would take.)
        const gives = s.breaks?.map(([item, n]) => counted(item, n)).join(', ') ?? '';
        const smash = s.breaks
          ? `<p class="card-note city-breaks">${icon('hammer', 14)} ${t(s.breakCan ? 'city.box.breakGives' : 'city.box.breakMetal', { what: gives })}</p>`
          : '';
        const smashBtn = s.breaks
          ? `<button class="big-btn ghost" data-c="break"${s.breakCan ? '' : ' aria-disabled="true"'}>${icon('hammer', 16)}${t('city.act.break')}</button>`
          : '';
        // (2.67: a built piece: its health, a repair's cost, its buttons; a campfire's time left.)
        const pc = s.piece;
        const cost = pc?.repair.map(([item, n]) => counted(item, n)).join(', ') ?? '';
        const pieceNote = pc
          ? `<p class="card-note city-piece">${icon('shield', 14)} ${t('city.piece.health', { n: pc.hp, of: pc.max })}${pc.fire >= 0 ? ` · ${pc.fire > 0 ? t('city.piece.burns', { h: Math.max(1, Math.round(pc.fire / 60)) }) : t('city.piece.out')}` : ''}${pc.bolts >= 0 ? ` · ${t('city.piece.bolts', { n: pc.bolts, of: TRAP.sentryMost })}` : ''}${pc.planter >= 0 ? ` · ${t(pc.planter === 0 ? 'city.piece.empty' : pc.planter >= 4 ? 'city.piece.ripe' : pc.watered ? 'city.piece.growingWet' : 'city.piece.growing', { n: pc.planter - 1, of: 3 })}` : ''}${pc.drinks >= 0 ? ` · ${t('city.piece.drinks', { n: pc.drinks, of: 8 })}` : ''}${pc.hens >= 0 ? ` · ${t('city.piece.hens', { n: pc.hens, of: COOP.hens, e: pc.eggs })}` : ''}${pc.canRepair !== 'full' ? ` · ${t('city.piece.repairCost', { what: cost })}` : ''}</p>`
          : '';
        const pieceBtns = pc
          ? `${pc.fire >= 0 ? `<button class="big-btn" data-c="feed">${icon('flame', 16)}${t(pc.fire > 0 ? 'city.piece.feed' : 'city.piece.light')}</button>` : ''}${pc.bolts >= 0 && pc.bolts < TRAP.sentryMost ? `<button class="big-btn" data-c="feed">${icon('target', 16)}${t('city.piece.load')}</button>` : ''}${pc.planter === 0 ? `<button class="big-btn" data-c="g3">${icon('sprout', 16)}${t('city.piece.plant')}</button>` : ''}${pc.planter > 0 && pc.planter < 4 && !pc.watered ? `<button class="big-btn" data-c="g4">${icon('water', 16)}${t('city.piece.water')}</button>` : ''}${pc.planter >= 4 ? `<button class="big-btn primary" data-c="g5">${icon('hand', 16)}${t('city.piece.harvest')}</button>` : ''}${pc.drinks > 0 ? `<button class="big-btn" data-c="g6">${icon('water', 16)}${t('city.piece.drink')}</button><button class="big-btn ghost" data-c="g7">${icon('water', 16)}${t('city.piece.fill')}</button>` : ''}${pc.eggs > 0 ? `<button class="big-btn primary" data-c="g9">${icon('egg', 16)}${t('city.piece.takeEggs')}</button>` : ''}${pc.hens >= 0 && pc.hens < COOP.hens ? `<button class="big-btn" data-c="g8">${icon('egg', 16)}${t('city.piece.addHen')}</button>` : ''}${pc.canRepair !== 'full' ? `<button class="big-btn ghost" data-c="repair"${pc.canRepair === 'ok' ? '' : ' aria-disabled="true"'}>${icon('wrench', 16)}${t('city.piece.repair')}</button>` : ''}<button class="big-btn ghost" data-c="down">${icon('down', 16)}${t('city.piece.down')}</button>`
          : '';
        // (2.69: the bag on the back: its name and how full; empty, it can be taken off.)
        const bagged = s.box === 'city.box.bag';
        const title = bagged ? t('city.box.bag', { what: itemName(s.bag), n: s.bagUsed, of: s.bagSlots }) : t(s.box as Key);
        const bagOff =
          bagged && !filled ? `<button class="big-btn ghost" data-c="bagOff">${icon('down', 16)}${t('city.thing.takeOff')}</button>` : '';
        this.panel.innerHTML = `<div class="box-head"><b>${title}</b><button class="icon-btn" data-c="close" aria-label="${t('city.box.close')}">${icon('close', 18)}</button></div>
          ${
            filled
              ? `<div class="slot-grid">${s.slots.map((st, k) => (st[0] ? `<button class="slot filled" data-slot="${k}" title="${itemName(st[0])}" aria-label="${t('city.box.take', { what: counted(st[0], st[1]) })}">${slotInner(st[0], st[1])}</button>` : '')).join('')}</div>
          <p class="box-names">${s.slots
            .filter((st) => st[0])
            .map((st) => counted(st[0], st[1]))
            .join(' · ')}</p>
          ${smash}${pieceNote}<div class="ct-actions">${sleep}${smashBtn}${pieceBtns}<button class="big-btn primary" data-c="all">${icon('hand', 16)}${t('city.box.takeAll')}</button></div>`
              : `${bagged ? `<p class="card-note">${t('city.box.bagEmpty')}</p>` : !pc ? `<p class="card-note">${t('city.box.empty')}</p>` : pc.chest ? `<p class="card-note">${t('city.piece.chestEmpty')}</p>` : ''}${smash}${pieceNote}${sleep || smashBtn || pieceBtns || bagOff ? `<div class="ct-actions">${sleep}${smashBtn}${pieceBtns}${bagOff}</div>` : ''}`
          }`;
      }
    }
    // The Make panel: every recipe, what it takes (what's short greyed), what it needs beside.
    const mk = `${this.makeOpen}|${s.recipes.join()}|${JSON.stringify(s.inv)}|${JSON.stringify(s.bagThings)}|${textStamp()}`;
    if (mk !== this.shownMake) {
      this.shownMake = mk;
      this.make.classList.toggle('hidden', !this.makeOpen);
      if (this.makeOpen) {
        // (2.69: the bag's things count, as the rules count them.)
        const have = (id: string) =>
          [...s.inv, ...s.bagThings].reduce(
            (n, st) => n + (cityItem(st[0])?.id === id ? (cityItem(st[0])?.wear !== undefined ? 1 : st[1]) : 0),
            0,
          );
        this.make.innerHTML = `<div class="box-head"><b>${icon('hammer', 18)} ${t('city.make.title')}</b><button class="icon-btn" data-c="close" aria-label="${t('city.box.close')}">${icon('close', 18)}</button></div>
          <ul class="city-recipes">${CITY_RECIPES.map((r, k) => {
            const why = s.recipes[k] ?? 'parts';
            if (why === 'none') return '';
            const made = cityItemNumber(r.makes);
            // (Not shown how yet: who can.)
            // (2.69: from a manual not yet read: a question mark, and where such a manual may lie.)
            if (why === 'unknown' && r.manual !== undefined)
              return `<li><div class="city-recipe cant locked"><i class="slot filled result unknown">?</i><span class="cr-text"><b>${t('city.make.unknown')}</b><small class="lack">${icon('book', 12)} ${t(`city.make.manual.${r.manual}` as Key)}</small></span></div></li>`;
            if (why === 'unknown')
              return `<li><div class="city-recipe cant locked"><i class="slot filled result"><img src="${iconOf(made)}" alt=""></i><span class="cr-text"><b>${itemName(made)}</b><small class="lack">${icon('lock', 12)} ${t('city.make.taught', { who: t(`city.person.${PEOPLE[r.taught ?? 0].id}.name` as Key) })}</small></span></div></li>`;
            const parts = r.from
              .map(
                ([id, n]) =>
                  `<i class="slot filled${have(id) < n ? ' short' : ''}" title="${t(`city.item.${id}` as Key)}"><img src="${iconOf(cityItemNumber(id))}" alt="${t(`city.item.${id}` as Key)}">${n > 1 ? `<i class="slot-n">${n}</i>` : ''}</i>`,
              )
              .join('');
            // (2.57: what is missing, by name: a touch has no hover to read an icon by.)
            const short = r.from.filter(([id, n]) => have(id) < n).map(([id]) => t(`city.item.${id}` as Key));
            const missing = why === 'parts' && short.length ? t('city.make.missing', { what: short.join(', ') }) : '';
            // (2.69: a workshop's: said as such.)
            const need = r.shop
              ? t('city.make.shop')
              : r.smoker
                ? t('city.make.smoker')
                : r.bench
                  ? t('city.make.bench')
                  : r.stove
                    ? t('city.make.stove')
                    : '';
            const place = why === 'bench' || why === 'stove' || why === 'shop' || why === 'smoker';
            return `<li><button class="city-recipe${why === 'ok' ? '' : ' cant'}" data-r="${k}" aria-disabled="${why !== 'ok'}"><i class="slot filled result"><img src="${iconOf(made)}" alt=""></i><span class="cr-text"><b>${itemName(made)}</b><small class="${place || missing ? 'lack' : ''}">${(place ? need : '') || (missing && need ? `${missing} · ${need}` : missing) || need || useLine(made) || t(`city.kindOf.${cityItem(made)!.kind}` as Key)}</small></span><span class="cr-parts">${parts}</span></button></li>`;
          }).join('')}</ul>`;
      }
    }
    // 2.67: the Build panel: every piece, what it takes (what's short greyed), the hammer it wants.
    const bk = `${this.buildOpen}|${s.builds.join()}|${JSON.stringify(s.buildFrom)}|${JSON.stringify(s.inv)}|${JSON.stringify(s.bagThings)}|${textStamp()}`;
    if (bk !== this.shownBuild) {
      this.shownBuild = bk;
      this.build.classList.toggle('hidden', !this.buildOpen);
      if (this.buildOpen) {
        const have = (id: string) =>
          [...s.inv, ...s.bagThings].reduce(
            (n, st) => n + (cityItem(st[0])?.id === id ? (cityItem(st[0])?.wear !== undefined ? 1 : st[1]) : 0),
            0,
          );
        this.build.innerHTML = `<div class="box-head"><b>${icon('home', 18)} ${t('city.build.title')}</b><button class="icon-btn" data-c="close" aria-label="${t('city.box.close')}">${icon('close', 18)}</button></div>
          ${s.builds[0] === 'hammer' ? `<p class="card-note lack">${icon('hammer', 14)} ${t('city.build.needHammer')}</p>` : ''}
          <ul class="city-recipes">${PIECES.map((p, k) => {
            const why = s.builds[k] ?? 'parts';
            // (2.70: not in this city at all: left out.)
            if (why === 'none') return '';
            // (2.70: from a manual not yet read: a question mark, and where it may lie.)
            if (why === 'unknown' && p.manual !== undefined)
              return `<li><div class="city-recipe cant locked"><i class="slot filled result unknown">?</i><span class="cr-text"><b>${t('city.make.unknown')}</b><small class="lack">${icon('book', 12)} ${t(`city.make.manual.${p.manual}` as Key)}</small></span></div></li>`;
            const from = s.buildFrom[k] ?? p.from;
            const parts = from
              .map(
                ([id, n]) =>
                  `<i class="slot filled${have(id) < n ? ' short' : ''}" title="${t(`city.item.${id}` as Key)}"><img src="${iconOf(cityItemNumber(id))}" alt="${t(`city.item.${id}` as Key)}">${n > 1 ? `<i class="slot-n">${n}</i>` : ''}</i>`,
              )
              .join('');
            const short = from.filter(([id, n]) => have(id) < n).map(([id]) => t(`city.item.${id}` as Key));
            const line =
              why === 'parts' && short.length ? t('city.make.missing', { what: short.join(', ') }) : t(`city.piece.${p.id}.d` as Key);
            return `<li><button class="city-recipe${why === 'ok' ? '' : ' cant'}" data-b="${k}" aria-disabled="${why !== 'ok'}"><i class="slot filled result piece-ic">${icon(PIECE_ICONS[p.id] ?? 'home', 22)}</i><span class="cr-text"><b>${t(`city.piece.${p.id}` as Key)}</b><small class="${why === 'parts' ? 'lack' : ''}">${line}</small></span><span class="cr-parts">${parts}</span></button></li>`;
          }).join('')}</ul>`;
      }
    }
    // (2.67: placing a piece: the stop button, by the action button.)
    this.stop.classList.toggle('hidden', s.placing < 0);
    if (s.placing >= 0) setText(this.stop, `✕ ${t('city.build.stop')}`);
    // The action button: what's in reach, a search's ring.
    const tg = s.asleep ? null : s.target;
    const verb = !tg
      ? ''
      : tg.kind === 'npc'
        ? 'city.act.talk'
        : tg.kind === 'dog'
          ? 'city.act.feed'
          : tg.kind === 'event'
            ? 'city.act.force'
            : tg.kind === 'way'
              ? `city.act.${s.way}`
              : tg.kind === 'lock'
                ? 'city.act.force'
                : tg.kind === 'pane'
                  ? 'city.act.smash'
                  : tg.kind === 'fence'
                    ? 'city.act.cut'
                    : tg.kind === 'wall'
                      ? 'city.act.break'
                      : tg.kind === 'water'
                        ? s.rod
                          ? 'city.act.fish'
                          : 'city.act.drink'
                        : tg.kind === 'door'
                          ? s.barred
                            ? 'city.act.unbar'
                            : 'city.act.bar'
                          : s.targetOpen
                            ? 'city.act.close'
                            : tg.kind === 'bed'
                              ? s.rest
                                ? 'city.act.rest'
                                : 'city.act.sleep'
                              : tg.kind === 'pile' || tg.kind === 'piece' || s.searched
                                ? 'city.act.look'
                                : 'city.act.search';
    // (2.67: placing a piece, the button puts it up, or says why it can't go there.)
    const placing = s.placing >= 0;
    const key = placing
      ? `place|${s.placing}|${s.placeWhy}|${textStamp()}`
      : `${verb}|${tg?.prop ?? tg?.kind ?? ''}|${tg?.piece ?? ''}|${s.person}|${textStamp()}`;
    if (key !== this.shownAct) {
      this.shownAct = key;
      this.act.classList.toggle('hidden', !tg && !placing);
      this.act.classList.toggle('cant', placing && s.placeWhy !== 'ok');
      if (placing) {
        const cap = TOUCH ? '' : `<kbd class="city-key">${keyLabel('KeyE')}</kbd>`;
        const name = t(`city.piece.${PIECES[s.placing]?.id ?? 'barricade'}` as Key);
        const what = s.placeWhy === 'ok' ? name : t(`city.build.why.${s.placeWhy || 'here'}` as Key);
        this.act.innerHTML = `<i class="act-round">${cap}${icon('home', 24)}<span></span></i><b class="act-what"></b>`;
        setText(this.act.querySelector('.act-round span')!, t('city.act.build'));
        setText(this.act.querySelector('.act-what')!, what);
        this.act.setAttribute('aria-label', `${t('city.act.build')} ${name}: ${what}`);
        this.act.setAttribute('aria-keyshortcuts', keyLabel('KeyE'));
      } else if (tg) {
        const what = t(
          tg.kind === 'npc'
            ? s.person === 'runner'
              ? 'city.runner.name'
              : (`city.person.${s.person}.name` as Key)
            : tg.kind === 'dog'
              ? 'city.box.dog'
              : tg.kind === 'way'
                ? s.way === 'up3'
                  ? 'city.box.stairs'
                  : (`city.box.way${s.way.slice(-1)}${s.way.startsWith('go') ? 'go' : ''}` as Key)
                : tg.kind === 'door'
                  ? 'city.box.door'
                  : tg.kind === 'lock'
                    ? 'city.box.lock'
                    : tg.kind === 'pane'
                      ? 'city.box.pane'
                      : tg.kind === 'fence'
                        ? 'city.box.fence'
                        : tg.kind === 'wall'
                          ? 'city.box.wall'
                          : tg.kind === 'water'
                            ? 'city.box.water'
                            : tg.kind === 'piece'
                              ? (`city.piece.${PIECES[tg.piece ?? 0]?.id ?? 'barricade'}` as Key)
                              : tg.prop
                                ? (`city.box.${tg.prop}` as Key)
                                : 'city.box.pile',
        );
        // (2.64: on a keyboard, the key on the button; an open box's button shuts it, and says so by its icon too.)
        const cap = TOUCH ? '' : `<kbd class="city-key">${keyLabel('KeyE')}</kbd>`;
        this.act.innerHTML = `<i class="act-round">${cap}${icon(s.targetOpen ? 'close' : tg.kind === 'bed' ? 'moon' : tg.kind === 'door' ? 'hammer' : tg.kind === 'lock' ? 'lock' : tg.kind === 'pane' ? 'fist' : tg.kind === 'fence' ? 'cutters' : tg.kind === 'wall' ? 'hammer' : tg.kind === 'water' ? (s.rod ? 'fish' : 'water') : tg.kind === 'piece' ? 'home' : tg.kind === 'way' ? 'flag' : tg.kind === 'npc' ? 'chat' : tg.kind === 'dog' ? 'paw' : tg.kind === 'event' ? 'lock' : 'search', 24)}<span></span></i><b class="act-what"></b>`;
        setText(this.act.querySelector('.act-round span')!, t(verb as Key));
        setText(this.act.querySelector('.act-what')!, what);
        this.act.setAttribute('aria-label', `${t(verb as Key)} ${what}`);
        this.act.setAttribute('aria-keyshortcuts', keyLabel('KeyE'));
      }
    }
    // (2.60) The blow's button: what strikes, the blows left in it round the button and by number, greyed while the arm comes back.
    if (!TOUCH && this.shownKeys !== textStamp()) {
      this.shownKeys = textStamp();
      const cap = this.hit.querySelector('.city-key') ?? this.hit.querySelector('.tool-round')!.appendChild(h('kbd', 'city-key'));
      cap.textContent = keyLabel('Space');
    }
    const hitKey = `${s.weapon}|${s.blows}`;
    if (hitKey !== this.shownHit) {
      this.shownHit = hitKey;
      const armed = s.weapon > 0;
      this.hit.querySelector('.hit-icon')!.innerHTML = armed ? `<img src="${iconOf(s.weapon)}" alt="">` : icon('fist', 22);
      this.hit
        .querySelector<HTMLElement>('.tool-ring')!
        .style.setProperty('--p', armed ? `${Math.round((s.blows / Math.max(1, s.blowsOf)) * 100)}%` : '0%');
      const left = this.hit.querySelector<HTMLElement>('.hit-left')!;
      left.classList.toggle('hidden', !armed);
      setText(left, armed ? String(s.blows) : '');
      this.hit.classList.toggle('low', armed && s.blows <= 5);
      this.hit.setAttribute(
        'aria-label',
        armed ? `${t('city.act.hit')} (${itemName(s.weapon)}, ${t('city.thing.blows', { n: s.blows, of: s.blowsOf })})` : t('city.act.hit'),
      );
    }
    this.hit.classList.toggle('cooling', !s.ready);
    this.act.style.setProperty('--cut', String(s.searching));
    this.act.classList.toggle('cutting', s.searching > 0);
  }
}
