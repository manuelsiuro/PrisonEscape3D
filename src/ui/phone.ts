import { currentLang, t } from '../i18n';
import { itemIcons } from '../render/itemIcons';
import { h, setText, TOUCH } from './dom';
import { icon } from './icons';
import { confirmed } from './social';

/** A way an order can come (P21): by drone, with a visitor or in a Red Cross parcel. */
export interface PhoneWay {
  way: number;
  icon: string;
  label: string;
  /** What it adds to the price. */
  fee: number;
  /** When and where an order placed now would come ("Tonight at 21:20, in the yard"). */
  when: string;
  /** Something can come this way in the weeks ahead (else its orders are off). */
  open: boolean;
}

/** An entry of the catalogue. */
export interface PhoneRow {
  k: number;
  item: number;
  name: string;
  price: number;
  contraband: boolean;
}

/** What the phone's panel shows (P21). */
export interface PhoneView {
  /** The order on its way (a sentence, '' none), its icon, and the same for a screen reader. */
  status: string;
  statusIcon: string;
  say: string;
  /** An order can be placed now (the phone in hand, nothing on its way); else why not. */
  ready: boolean;
  note: string;
  ways: PhoneWay[];
  rows: PhoneRow[];
  cash: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The burner phone's panel (P21): the order on its way (a polite live region, written in
 * place), then the ways an order can come (each with its fee and when it would come) and the
 * catalogue, each entry's price with the chosen way's fee and an Order button that asks twice.
 * Opened from the phone in hand (its tool button, P on a keyboard) or the order's pill on the
 * HUD; it closes once an order is placed, and whenever the game can't take it.
 */
export class PhonePanel {
  readonly el: HTMLElement;
  private readonly status: HTMLElement;
  private readonly say: HTMLElement;
  private readonly body: HTMLElement;
  private drawn = '';
  private focusNext = false;
  /** The way chosen (WAY), kept while the panel is open and after. */
  private way = 0;
  isOpen = false;
  /** An order placed: the catalogue entry and the way. */
  onOrder: (k: number, way: number) => void = () => {};

  constructor(private readonly click: () => void) {
    this.el = h(
      'div',
      'item-panel board-panel phone-panel hidden',
      `<div class="panel-head"><b>${icon('phone', 20)}<span></span></b><button class="icon-btn small" data-phone="close">${icon('close', 18)}</button></div><p class="phone-status" aria-hidden="true"><i></i><span></span></p><span class="sr-only phone-say" role="status"></span><div class="phone-body"></div>`,
    );
    this.el.setAttribute('role', 'dialog');
    this.status = this.el.querySelector('.phone-status')!;
    this.say = this.el.querySelector('.phone-say')!;
    this.body = this.el.querySelector('.phone-body')!;
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-phone]');
      if (!b || b.disabled) return;
      this.click();
      const what = b.dataset.phone!;
      if (what === 'close') this.close();
      else if (what === 'way') {
        this.way = Number(b.dataset.way);
        this.drawn = '';
      } else if (what === 'order' && confirmed(b)) this.onOrder(Number(b.dataset.k), this.way);
    });
    document.body.append(this.el);
  }

  /** Open or shut (`focus`: opened from the keyboard, its first button takes the focus). */
  toggle(focus = false) {
    if (this.isOpen) this.close();
    else {
      this.isOpen = true;
      this.drawn = '';
      this.focusNext = focus;
    }
  }

  close() {
    if (this.isOpen && this.el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    this.isOpen = false;
    this.el.classList.add('hidden');
  }

  update(v: PhoneView | null, busy: boolean) {
    if (!v || busy) this.close();
    if (!this.isOpen || !v) {
      this.el.classList.add('hidden');
      return;
    }
    this.el.classList.remove('hidden');
    setText(this.el.querySelector('.panel-head span')!, t('item.burner_phone'));
    this.el.setAttribute('aria-label', t('item.burner_phone'));
    this.status.classList.toggle('none', !v.status);
    this.status.querySelector('i')!.innerHTML = icon(v.statusIcon, 16);
    setText(this.status.querySelector('span')!, v.status || t('phone.nothing'));
    setText(this.say, v.say);
    // (A way nothing can come by: the first open one instead, never a panel of dead buttons.)
    if (!v.ways.some((w) => w.way === this.way && w.open)) this.way = (v.ways.find((w) => w.open) ?? v.ways[0])?.way ?? 0;
    const key = JSON.stringify([v.ready, v.note, v.ways, v.rows, v.cash, this.way]) + currentLang();
    if (key === this.drawn) return;
    this.drawn = key;
    this.el.querySelector('[data-phone="close"]')!.setAttribute('aria-label', t('box.close'));
    const chosen = v.ways.find((w) => w.way === this.way) ?? v.ways[0];
    const ways = v.ways
      .map((w) => `<button class="phone-way${w.way === this.way ? ' on' : ''}" data-phone="way" data-way="${w.way}" role="radio" aria-checked="${w.way === this.way}"><i>${icon(w.icon, 18)}</i><span><b>${esc(w.label)} <em>${esc(t('phone.fee', { n: w.fee }))}</em></b><small>${esc(w.when)}</small></span></button>`)
      .join('');
    const rows = v.rows
      .map((r) => {
        const price = r.price + (chosen?.fee ?? 0);
        const ok = v.ready && !!chosen?.open && v.cash >= price;
        return `<div class="board-row phone-row"><span class="phone-img"><img src="${itemIcons()[r.item]}" alt="" draggable="false">${r.contraband ? '<i class="slot-cb"></i>' : ''}</span><span class="board-text"><b>${esc(r.name)}</b><small>${t('phone.priceNote', { n: r.price, fee: chosen?.fee ?? 0 })}</small></span><button class="big-btn ${ok ? 'primary' : 'ghost'} small" data-phone="order" data-k="${r.k}" ${ok ? '' : 'disabled'} data-confirm="${esc(t('phone.confirm', { n: price }))}" aria-describedby="phone-note" aria-label="${esc(t('phone.orderAria', { item: r.name, n: price, way: chosen?.label ?? '' }))}">${icon('cart', 16)}<span>$${price}</span></button></div>`;
      })
      .join('');
    const note = v.note ? `<p class="phone-note" id="phone-note">${icon(v.ready ? 'coin' : 'phone', 14)}<span>${esc(v.note)}</span></p>` : '';
    const had = this.body.contains(document.activeElement) ? (document.activeElement as HTMLElement) : null;
    const was = had ? `${had.dataset.phone}|${had.dataset.way ?? had.dataset.k ?? ''}` : '';
    this.body.innerHTML = `<div class="phone-ways" role="radiogroup" aria-label="${esc(t('phone.ways'))}">${ways}</div>${note}<div class="board-list">${rows}</div>${TOUCH ? '' : `<p class="rat-keys">${t('phone.keys')}</p>`}`;
    if (was) {
      const [what, arg] = was.split('|');
      const sel = what === 'way' ? `button[data-phone="way"][data-way="${arg}"]` : `button[data-phone="${what}"][data-k="${arg}"]:not([disabled])`;
      (this.body.querySelector<HTMLButtonElement>(sel) ?? this.body.querySelector<HTMLButtonElement>('button:not([disabled])') ?? this.el.querySelector<HTMLButtonElement>('[data-phone="close"]'))?.focus();
    }
    if (this.focusNext) {
      this.focusNext = false;
      (this.body.querySelector<HTMLButtonElement>('button[data-phone="way"].on') ?? this.el.querySelector<HTMLButtonElement>('[data-phone="close"]'))?.focus();
    }
  }
}
