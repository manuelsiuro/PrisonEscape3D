import { t, textStamp, type Key } from '../../i18n';
import { keyLabel } from '../../i18n/keys';
import { photos } from '../../render/itemIcons';
import { h, setText, TOUCH } from '../../ui/dom';
import { icon } from '../../ui/icons';
import { CITY_ITEMS, cityItem, cityItemNumber } from '../content/items';
import { PEOPLE } from '../content/people';
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
  /** 2.64: the box open is a bed that can be slept in from its card (not one the story still has something in). */
  sleepable: boolean;
  /** 2.65: a bed by day is a rest till dusk. */
  rest: boolean;
  /** 2.66: the open piece breaks up into these (null: it doesn't), and something carried can break it. */
  breaks: readonly Stack[] | null;
  breakCan: boolean;
  /** 2.64: the torch: on, and its battery's game minutes left (its card says both). */
  torchOn: boolean;
  torchLeft: number;
  searched: boolean;
  searching: number;
  asleep: boolean;
  /** A door in reach is barred (the button takes its boards down). */
  barred: boolean;
  /** What each recipe lacks now ('ok': it can be made). */
  recipes: ReadonlyArray<'ok' | 'parts' | 'bench' | 'stove' | 'unknown'>;
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
};

export function useLine(n: number): string {
  const light = LIGHTS[cityItem(n)?.id ?? ''];
  if (light) return t(light.line);
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
  private shownHit = '';
  private shownKeys = '';
  private lang = '';
  /** The pocket whose card is up (-1 none). */
  picked = -1;
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
    this.act = h('button', 'act-btn city-act hidden');
    this.act.addEventListener('click', () => this.onAct());
    this.hit = h(
      'button',
      'tool-btn city-hit hidden',
      `<i class="tool-round"><i class="tool-ring"></i><i class="hit-icon">${icon('fist', 22)}</i><span></span></i><b class="hit-left hidden"></b>`,
    );
    this.hit.addEventListener('click', () => this.onHit());
    this.bar.addEventListener('click', (e) => {
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
    this.shownInv = this.shownBox = this.shownAct = this.shownMake = this.shownHit = '';
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
      this.shownInv = this.shownBox = this.shownAct = this.shownMake = this.shownHit = '';
      this.bar.setAttribute('aria-label', t('city.pockets'));
      setText(this.hit.querySelector('span')!, t('city.act.hit'));
      this.hit.setAttribute('aria-keyshortcuts', keyLabel('Space'));
    }
    // (The thing whose card was up is gone: the card too.)
    if (this.picked >= 0 && !s.inv[this.picked]?.[0]) this.picked = -1;
    const inv = `${JSON.stringify(s.inv)}|${this.picked}|${s.box}|${s.torchOn}|${s.torchLeft >= 60 ? Math.round(s.torchLeft / 60) : s.torchLeft}|${textStamp()}`;
    if (inv !== this.shownInv) {
      this.shownInv = inv;
      this.bar.innerHTML = Array.from({ length: POCKETS }, (_, k) => {
        const [item, n] = s.inv[k] ?? [0, 0];
        return `<button class="slot${item ? ' filled' : ''}${k === this.picked ? ' picked' : ''}" data-k="${k}" data-key="${k + 1}"${item ? ` title="${itemName(item)}" aria-label="${counted(item, n)}"` : ` aria-label="${t('city.pocketEmpty', { n: k + 1 })}" disabled`}>${item ? slotInner(item, n) : ''}</button>`;
      }).join('');
      this.bar.insertAdjacentHTML(
        'beforeend',
        `<i class="hotbar-gap"></i><button class="slot craft-btn${this.makeOpen ? ' picked' : ''}" aria-label="${t('city.make.title')}" aria-keyshortcuts="${keyLabel('KeyC')}">${icon('hammer', 22)}<span>${t('city.make.open')}</span></button>`,
      );
      this.card.classList.toggle('hidden', this.picked < 0);
      if (this.picked >= 0) {
        const [item, n] = s.inv[this.picked];
        const torch = cityItem(item)!.id === 'torch';
        // (2.64: the torch's card says whether it's on and what's left of its battery, and its button what a press does.)
        const line = torch
          ? `${useLine(item)} · ${s.torchLeft >= 60 ? t('city.thing.torchLeft', { h: Math.round(s.torchLeft / 60) }) : s.torchLeft > 0 ? t('city.thing.torchMinutes', { n: s.torchLeft }) : t('city.thing.torchEmpty')}`
          : useLine(item);
        this.card.innerHTML = `<div class="ct-head"><i class="slot filled"><img src="${iconOf(item)}" alt=""></i><div><b>${counted(item, n)}</b><small>${line || (cityItem(item)!.wear !== undefined ? t(cityItem(item)!.id === 'crossbow' ? 'city.thing.shots' : 'city.thing.blows', { n, of: cityItem(item)!.wear! }) : t(`city.kindOf.${cityItem(item)!.kind}` as Key))}</small></div></div>
          <div class="ct-actions">${line ? `<button class="big-btn primary" data-c="use">${icon(LIGHTS[cityItem(item)!.id]?.icon ?? (cityItem(item)!.kind === 'med' ? 'heart' : 'utensils'), 16)}${t(torch ? (s.torchOn ? 'city.thing.torchOff' : 'city.thing.torchOn') : (LIGHTS[cityItem(item)!.id]?.verb ?? (cityItem(item)!.kind === 'med' ? 'city.thing.apply' : 'city.thing.eat')))}</button>` : ''}${s.box ? `<button class="big-btn ghost" data-c="store">${icon('box', 16)}${t('city.thing.store')}</button>` : ''}<button class="big-btn ghost" data-c="drop">${icon('down', 16)}${t('city.thing.drop')}</button></div>`;
      }
    }
    const box = `${s.box}|${JSON.stringify(s.slots)}|${s.sleepable && s.rest}|${s.sleepable}|${JSON.stringify(s.breaks)}|${s.breakCan}|${textStamp()}`;
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
        this.panel.innerHTML = `<div class="box-head"><b>${t(s.box as Key)}</b><button class="icon-btn" data-c="close" aria-label="${t('city.box.close')}">${icon('close', 18)}</button></div>
          ${
            filled
              ? `<div class="slot-grid">${s.slots.map((st, k) => (st[0] ? `<button class="slot filled" data-slot="${k}" title="${itemName(st[0])}" aria-label="${t('city.box.take', { what: counted(st[0], st[1]) })}">${slotInner(st[0], st[1])}</button>` : '')).join('')}</div>
          <p class="box-names">${s.slots
            .filter((st) => st[0])
            .map((st) => counted(st[0], st[1]))
            .join(' · ')}</p>
          ${smash}<div class="ct-actions">${sleep}${smashBtn}<button class="big-btn primary" data-c="all">${icon('hand', 16)}${t('city.box.takeAll')}</button></div>`
              : `<p class="card-note">${t('city.box.empty')}</p>${smash}${sleep || smashBtn ? `<div class="ct-actions">${sleep}${smashBtn}</div>` : ''}`
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
            // (Not shown how yet: who can.)
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
            const need = r.bench ? t('city.make.bench') : r.stove ? t('city.make.stove') : '';
            return `<li><button class="city-recipe${why === 'ok' ? '' : ' cant'}" data-r="${k}" aria-disabled="${why !== 'ok'}"><i class="slot filled result"><img src="${iconOf(made)}" alt=""></i><span class="cr-text"><b>${itemName(made)}</b><small class="${why === 'bench' || why === 'stove' || missing ? 'lack' : ''}">${(why === 'bench' || why === 'stove' ? need : '') || (missing && need ? `${missing} · ${need}` : missing) || need || useLine(made) || t(`city.kindOf.${cityItem(made)!.kind}` as Key)}</small></span><span class="cr-parts">${parts}</span></button></li>`;
          }).join('')}</ul>`;
      }
    }
    // The action button: what's in reach, a search's ring.
    const tg = s.asleep ? null : s.target;
    const verb = !tg
      ? ''
      : tg.kind === 'npc'
        ? 'city.act.talk'
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
                        : tg.kind === 'pile' || s.searched
                          ? 'city.act.look'
                          : 'city.act.search';
    const key = `${verb}|${tg?.prop ?? tg?.kind ?? ''}|${s.person}|${textStamp()}`;
    if (key !== this.shownAct) {
      this.shownAct = key;
      this.act.classList.toggle('hidden', !tg);
      if (tg) {
        const what = t(
          tg.kind === 'npc'
            ? (`city.person.${s.person}.name` as Key)
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
                        : tg.prop
                          ? (`city.box.${tg.prop}` as Key)
                          : 'city.box.pile',
        );
        // (2.64: on a keyboard, the key on the button; an open box's button shuts it, and says so by its icon too.)
        const cap = TOUCH ? '' : `<kbd class="city-key">${keyLabel('KeyE')}</kbd>`;
        this.act.innerHTML = `<i class="act-round">${cap}${icon(s.targetOpen ? 'close' : tg.kind === 'bed' ? 'moon' : tg.kind === 'door' ? 'hammer' : tg.kind === 'lock' ? 'lock' : tg.kind === 'pane' ? 'fist' : tg.kind === 'fence' ? 'cutters' : tg.kind === 'wall' ? 'hammer' : tg.kind === 'way' ? 'flag' : tg.kind === 'npc' ? 'chat' : 'search', 24)}<span></span></i><b class="act-what"></b>`;
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
