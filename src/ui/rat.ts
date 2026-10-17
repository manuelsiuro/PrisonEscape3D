import { currentLang, t } from '../i18n';
import { h, setText, TOUCH } from './dom';
import { icon } from './icons';

/** One place the rat can be sent (P20). */
export interface RatRow {
  /** The container (furniture, or someone's pockets). */
  container: number;
  icon: string;
  name: string;
  /** "asleep · 8 tiles away, north". */
  meta: string;
  /** A sleeping guard with his key on him: its colour for the chip ('' none). */
  key: string;
}

/** What the rat panel shows (P20). */
export interface RatView {
  name: string;
  /** Where it is and what it's doing (a sentence). */
  status: string;
  /** On the player's shoulder: it can be sent now. */
  ready: boolean;
  rows: RatRow[];
  /** Places in its reach past those listed. */
  more: number;
  /** The small item in hand it could take along (its name), '' none; why not, when there's something in hand too big. */
  leave: string;
  leaveNo: string;
  /** Letting it loose: whether it can, the line beside the button. */
  loose: boolean;
  looseNote: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The pet rat's panel (P20): its name and what it's up to (a polite live region, written in
 * place), letting it loose, and the places in its reach (the sleepers first, then the nearest
 * furniture), each with Fetch, and Leave when a small item is in hand. Opened from the rat pill
 * on the HUD (or T on a keyboard, the focus on its first button); it closes once the rat is
 * sent, and whenever the game can't take it (asleep, out cold, a vehicle, paused).
 */
export class RatPanel {
  readonly el: HTMLElement;
  private readonly status: HTMLElement;
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private drawn = '';
  private focusNext = false;
  isOpen = false;
  /** Fetch from a container (`leave`: take the item in hand there), let loose. */
  onSend: (container: number, leave: boolean) => void = () => {};
  onLoose: () => void = () => {};

  constructor(private readonly click: () => void) {
    this.el = h(
      'div',
      'item-panel board-panel rat-panel hidden',
      `<div class="panel-head"><b>${icon('rat', 20)}<span></span></b><button class="icon-btn small" data-rat="close">${icon('close', 18)}</button></div><p class="rat-status" role="status"></p><div class="rat-body"></div>`,
    );
    this.el.setAttribute('role', 'dialog');
    this.title = this.el.querySelector('.panel-head span')!;
    this.status = this.el.querySelector('.rat-status')!;
    this.body = this.el.querySelector('.rat-body')!;
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-rat]');
      if (!b || b.disabled) return;
      this.click();
      const what = b.dataset.rat!;
      if (what === 'close') this.close();
      else if (what === 'loose') this.onLoose();
      else this.onSend(Number(b.dataset.box), what === 'leave');
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

  update(v: RatView | null, busy: boolean) {
    // (Nothing to show, or the game can't take it now: shut, never waiting to pop open later.)
    if (!v || busy) this.close();
    if (!this.isOpen || !v) {
      this.el.classList.add('hidden');
      return;
    }
    this.el.classList.remove('hidden');
    setText(this.title, v.name);
    setText(this.status, v.status);
    this.el.setAttribute('aria-label', v.name);
    const key = JSON.stringify([v.ready, v.rows, v.more, v.leave, v.leaveNo, v.loose, v.looseNote]) + currentLang();
    if (key === this.drawn) return;
    this.drawn = key;
    this.el.querySelector('[data-rat="close"]')!.setAttribute('aria-label', t('box.close'));
    const rows = v.rows
      .map((r) => {
        const chip = r.key ? `<i class="rat-key" style="--key:${r.key}" role="img" aria-label="${esc(t('rat.hasKey'))}" title="${esc(t('rat.hasKey'))}">${icon('key', 12)}</i>` : '';
        const leave = v.leave ? `<button class="big-btn ghost small" data-rat="leave" data-box="${r.container}" aria-label="${esc(t('rat.leaveAt', { item: v.leave, where: `${r.name}, ${r.meta}` }))}">${icon('down', 16)}<span>${t('rat.leave')}</span></button>` : '';
        return `<div class="board-row rat-row"><span class="board-ic">${icon(r.icon, 20)}</span><span class="board-text"><b>${esc(r.name)}${chip}</b><small>${esc(r.meta)}</small></span><span class="rat-acts"><button class="big-btn primary small" data-rat="fetch" data-box="${r.container}" aria-label="${esc(t('rat.fetchFrom', { where: `${r.name}, ${r.meta}` }))}">${icon('up', 16)}<span>${t('rat.fetch')}</span></button>${leave}</span></div>`;
      })
      .join('');
    const more = v.more ? `<p class="rat-empty">${esc(t('rat.more', { n: v.more }))}</p>` : '';
    const list = !v.ready ? '' : v.rows.length ? `<div class="board-list">${rows}</div>${more}` : `<p class="rat-empty">${t('rat.nothing')}</p>`;
    const carry = v.ready && v.rows.length ? `<p class="board-note">${esc(v.leave ? t('rat.carry', { item: v.leave }) : v.leaveNo || t('rat.carryNone'))}</p>` : '';
    const loose = v.ready
      ? `<div class="rat-loose"><button class="big-btn ${v.loose ? 'danger' : 'ghost'} small" data-rat="loose" aria-describedby="rat-loose-why" ${v.loose ? '' : 'disabled'}>${icon('siren', 16)}<span>${t('rat.loose')}</span></button><small id="rat-loose-why">${esc(v.looseNote)}</small></div>`
      : '';
    this.body.innerHTML = `${loose}${carry}${list}${TOUCH ? '' : `<p class="rat-keys">${t('rat.keys')}</p>`}`;
    if (this.focusNext) {
      this.focusNext = false;
      this.el.querySelector<HTMLButtonElement>('.rat-body button:not([disabled]), [data-rat="close"]')?.focus();
    }
  }
}
