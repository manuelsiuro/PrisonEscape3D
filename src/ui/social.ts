import { itemDef, itemNumber } from '../content/items';
import { JOBS, type JobId } from '../content/jobs';
import { ROUTINE } from '../content/routine';
import { BRIBE, OP, TALK } from '../sim/command';
import { traitOf } from '../sim/systems/guards';
import { lookAwayPrice, lookingAway, paperPrice } from '../sim/systems/ways';
import { CASH_GIFTS, cashOpinion, discountOf, FAVOR, FAVOR_KINDS, FAVOR_STATE, giftOpinion, HOLDER, jobRooms, priceOf, qualifies } from '../sim/systems/economy';
import { HOTBAR, itemOf } from '../sim/systems/items';
import type { Sim } from '../sim/Sim';
import { nextTip } from '../sim/systems/recipes';
import { LOOK_AWAY_STEPS, MAX_FOLLOWERS, OPINION_HIGH, OPINION_LOW, PAPER_HEAT, STEPS_PER_MINUTE, TIP_OPINION } from '../sim/tuning';
import { itemIcons } from '../render/itemIcons';
import { currentLang, t, type Key } from '../i18n';
import { h, setText, TOUCH } from './dom';
import { icon } from './icons';
import { itemName } from './items';

type Send = (op: number, a?: number, b?: number) => void;

/** An inmate's nickname (the same in every language), else "Inmate · cell n". */
export function inmateName(sim: Sim, who: number): string {
  const m = sim.state.inmates[who];
  if (!m) return '';
  return sim.prison.names[m.cell - 2] ?? t('combat.inmate', { n: m.cell });
}

/** What an inmate thinks of the player, in three bands (GDD §10.3). */
export const moodOf = (opinion: number) => (opinion <= OPINION_LOW ? 'low' : opinion >= OPINION_HIGH ? 'high' : 'neutral');

/** A favor told in the asker's words. */
export function favorText(sim: Sim, f: { kind: number; item: number; target: number }): string {
  const kind = FAVOR_KINDS[f.kind];
  // Mid-sentence, the item's name in lower case ("stole my magazine").
  const item = f.item ? itemName(f.item) : '';
  return t(`favor.${kind}` as Key, { item: item.charAt(0).toLowerCase() + item.slice(1), name: f.target >= 0 ? inmateName(sim, f.target) : '' });
}

/**
 * Costly taps ask twice (a gift, quitting a job, swapping one): the first arms the button
 * (it shows its question), the second within a few seconds does it. Returns whether to go ahead.
 */
function confirmed(b: HTMLElement): boolean {
  if (!b.dataset.confirm || b.classList.contains('armed')) return true;
  b.closest('.item-panel')?.querySelectorAll('.armed').forEach((o) => o.classList.remove('armed'));
  b.classList.add('armed');
  setTimeout(() => b.classList.remove('armed'), 2800);
  return false;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Talking to an inmate (GDD §10.3–10.4): what they think of the player, their favor (take it
 * on, hand it in), their shop if they're a merchant (free time only, cheaper the more they
 * like the player), gifts (an item from the hotbar, or cash) and recruiting. A side panel on
 * wide screens, a bottom sheet on phones; everything is sent as OP.TALK and redrawn from the
 * simulation, so it never disagrees with it.
 */
export class TalkPanel {
  readonly el: HTMLElement;
  private drawn = '';
  private who = -1;
  private opinion = -1;
  /** What the inmate says on seeing the player (P13: chosen once a talk, by the speech bubbles' director). */
  greeting = '';
  /** Whether the player has heard a rumor (its fact key): a guard's ways show once gossip told them (P15). */
  knows: (key: string) => boolean = () => false;

  constructor(private readonly send: Send, private readonly click: () => void) {
    this.el = h('div', 'item-panel talk-panel hidden');
    this.el.setAttribute('role', 'dialog');
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!b || (b as HTMLButtonElement).disabled) return;
      this.click();
      if (!confirmed(b)) return;
      if (b.dataset.act === 'close') this.send(OP.CLOSE);
      else this.send(OP.TALK, Number(b.dataset.act), Number(b.dataset.arg ?? 0));
    });
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
    this.drawn = '';
    this.who = -1;
  }

  update(sim: Sim, busy: boolean) {
    const s = sim.state;
    const who = s.talk;
    if (who < 0 || busy) {
      if (this.open) this.hide();
      return;
    }
    if (who >= s.inmates.length) {
      this.updateGuard(sim, who);
      return;
    }
    const m = s.inmates[who];
    const merchant = sim.merchantOf(who);
    const shop = merchant >= 0 ? s.shops[merchant] : null;
    const favor = s.favors.find((f) => f.by === who);
    const inv = s.items.inv.slice(0, HOTBAR);
    const key = [who, m.opinion, favor ? `${favor.kind}:${favor.state}:${favor.item}:${favor.target}:${favor.reward}` : '', shop?.join(',') ?? '', sim.shopsOpen, s.cash, inv.join(','), s.followers.join(','), s.jobs.join(','), s.tipDay[who] ?? 0, s.tips.length, s.items.known.length, s.items.int, sim.clock.day, currentLang(), this.greeting].join('|');
    if (key === this.drawn) return;
    this.drawn = key;
    const first = this.who !== who;
    const delta = first ? 0 : m.opinion - this.opinion;
    this.who = who;
    this.opinion = m.opinion;
    const mood = moodOf(m.opinion);
    const following = s.followers.includes(who);
    const job = s.jobs.indexOf(who);
    const chips = [
      merchant >= 0 ? `<span class="chip shop">${icon('cart', 13)}${t('role.merchant')}</span>` : '',
      job >= 0 ? `<span class="chip">${icon('briefcase', 13)}${esc(t(`job.${sim.prison.jobs[job].id}` as Key))}</span>` : '',
      following ? `<span class="chip ally">${icon('star', 13)}${t('role.follower')}</span>` : '',
    ].join('');
    // The favor: what they ask, what it pays, what can be done about it now.
    let favorHtml = '';
    if (favor) {
      const carrying = favor.item ? inv.some((v) => itemOf(v) === favor.item) : false;
      const ready = favor.state === FAVOR_STATE.DONE || ((favor.kind === FAVOR.SCAVENGE || favor.kind === FAVOR.RETRIEVE) && favor.state === FAVOR_STATE.TAKEN && carrying);
      const status =
        favor.state === FAVOR_STATE.OFFERED
          ? `<button class="big-btn primary small" data-act="${TALK.ACCEPT}">${icon('check', 16)}<span>${t('talk.accept')}</span></button>`
          : ready
            ? `<button class="big-btn primary small" data-act="${TALK.HAND_IN}">${icon('coin', 16)}<span>${t('talk.handIn')}</span></button>`
            : `<span class="talk-status">${t(favor.kind === FAVOR.SCAVENGE || favor.kind === FAVOR.RETRIEVE ? 'talk.bringIt' : 'talk.underWay')}</span>`;
      favorHtml = `<section class="talk-favor" data-state="${favor.state}"><div class="box-label">${icon('chat', 14)}<span>${t('talk.favor')}</span></div>
        <p class="talk-quote">${esc(favorText(sim, favor))}</p>
        <div class="talk-row"><span class="talk-reward">${icon('coin', 14)}$${favor.reward}<em>${t('talk.opinionGain', { n: 15 })}</em></span>${status}</div></section>`;
    }
    // The shop: only during free time, never for someone who despises the player.
    let shopHtml = '';
    if (shop) {
      const off = Math.round(discountOf(m.opinion) * 100);
      const closed = !sim.shopsOpen;
      const grudge = m.opinion <= OPINION_LOW;
      const items = shop
        .map((v, k) => {
          if (!v) return '';
          const n = itemOf(v);
          const d = itemDef(n);
          const price = priceOf(d.value, m.opinion);
          const afford = s.cash >= price;
          return `<button class="shop-item${afford ? '' : ' poor'}" data-act="${TALK.BUY}" data-arg="${k}" ${closed || grudge ? 'disabled' : ''} aria-label="${esc(t('talk.buy', { item: itemName(n), price }))}"><img src="${itemIcons()[n]}" alt="" draggable="false">${d.contraband ? '<i class="slot-cb"></i>' : ''}<span>${esc(itemName(n))}</span><b>$${price}</b>${price < d.value ? `<s>$${d.value}</s>` : ''}</button>`;
        })
        .join('');
      const note = grudge ? t('talk.shopGrudge') : closed ? t('talk.shopClosed') : !items ? t('talk.soldOut') : '';
      shopHtml = `<section class="talk-shop"><div class="box-label">${icon('cart', 14)}<span>${t('talk.shop')}</span>${off > 0 && !grudge ? `<em class="discount">${t('talk.discount', { n: off })}</em>` : ''}</div>
        ${items ? `<div class="shop-list">${items}</div>` : ''}${note ? `<p class="talk-note">${note}</p>` : ''}</section>`;
    }
    // Gifts: anything worth something from the hotbar, or a little cash.
    const gifts = inv
      .map((v, k) => {
        if (!v) return '';
        const n = itemOf(v);
        const value = itemDef(n).value;
        if (value <= 0) return '';
        return `<button class="slot gift" data-act="${TALK.GIFT}" data-arg="${k}" data-confirm="${esc(t('talk.confirmGive'))}" aria-label="${esc(t('talk.giveItem', { item: itemName(n) }))}"><img src="${itemIcons()[n]}" alt="" draggable="false"><i class="gift-gain">+${giftOpinion(value)}</i></button>`;
      })
      .join('');
    const cashBtns = CASH_GIFTS.map((d) => `<button class="cash-btn" data-act="${TALK.GIFT_CASH}" data-arg="${d}" ${s.cash < d ? 'disabled' : ''}>$${d}<i>+${cashOpinion(d)}</i></button>`).join('');
    const giftHtml = `<section class="talk-gift"><div class="box-label">${icon('gift', 14)}<span>${t('talk.gifts')}</span><em>${t('talk.giftsNote')}</em></div>
      ${gifts ? `<div class="slot-grid gift-grid">${gifts}</div>` : ''}<div class="cash-row">${cashBtns}</div></section>`;
    // A recipe tip (P8+): from those who like the player enough, once a day each.
    const tipped = (s.tipDay[who] ?? 0) === sim.clock.day;
    const none = nextTip(sim) < 0;
    const tipOk = m.opinion >= TIP_OPINION && !tipped && !none;
    const tipHtml = `<button class="big-btn ${tipOk ? 'primary' : 'ghost'} small" data-act="${TALK.TIP}" ${tipOk ? '' : 'disabled'}>${icon('book', 16)}<span>${t('talk.tip')}</span></button><span class="talk-note">${none ? t('talk.tipNone') : tipped ? t('talk.tipDone') : tipOk ? t('talk.tipNote') : t('talk.tipNeed', { n: TIP_OPINION })}</span>`;
    // Recruiting (GDD §10.3): from 80 opinion, two at most.
    let foot: string;
    if (following) foot = `<button class="big-btn ghost small" data-act="${TALK.DISMISS}">${icon('close', 16)}<span>${t('talk.dismiss')}</span></button><span class="talk-note">${t('talk.followingNote')}</span>`;
    else {
      const full = s.followers.length >= MAX_FOLLOWERS;
      const ok = m.opinion >= OPINION_HIGH && !full;
      foot = `<button class="big-btn ${ok ? 'primary' : 'ghost'} small" data-act="${TALK.RECRUIT}" ${ok ? '' : 'disabled'}>${icon('users', 16)}<span>${t('talk.recruit')}</span></button><span class="talk-note">${ok ? t('talk.recruitNote') : full ? t('talk.recruitFull', { n: MAX_FOLLOWERS }) : t('talk.recruitNeed', { n: OPINION_HIGH })}</span>`;
    }
    this.el.innerHTML = `<div class="panel-head"><span class="talk-face" data-cell="${m.cell}">${esc(inmateName(sim, who).charAt(0))}</span><span class="talk-who"><b>${esc(inmateName(sim, who))}</b><small>${t('talk.cell', { n: m.cell })}</small></span><button class="icon-btn small" data-act="close" aria-label="${t('box.close')}">${icon('close', 18)}</button></div>
      ${this.greeting ? `<p class="talk-greet">${esc(this.greeting)}</p>` : ''}<div class="talk-opinion" data-mood="${mood}"><span class="talk-mood">${t(`mood.${mood}` as Key)}</span><i class="talk-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${m.opinion}" aria-label="${t('talk.opinion')}"><i class="fill" style="width:${m.opinion}%"></i><i class="tick low"></i><i class="tick high"></i></i><b>${m.opinion}</b>${delta ? `<em class="talk-delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta}</em>` : ''}</div>
      ${chips ? `<div class="talk-chips">${chips}</div>` : ''}${favorHtml}${shopHtml}${giftHtml}<div class="talk-acts">${tipHtml}${foot}</div>`;
    if (first) {
      this.el.classList.remove('hidden');
      this.el.setAttribute('aria-label', inmateName(sim, who));
    }
  }

  /**
   * Talking to a guard (P15): who it is, its key, its ways once a rumor told them, what it says,
   * and the two bribes. Any guard can be offered one (only a corrupt one takes it, a strict one
   * reports it: that's the gamble), each asking twice before the money changes hands.
   */
  private updateGuard(sim: Sim, who: number) {
    const s = sim.state;
    const k = who - s.inmates.length;
    const g = s.guards[k];
    const def = sim.prison.guards[k];
    const trait = this.knows(`trait:${k}`) ? traitOf(def) : null;
    const look = lookAwayPrice(sim.prison.difficulty);
    const paper = paperPrice(sim.prison.difficulty);
    const left = lookingAway(g, s.step) ? Math.ceil((g.bribed - s.step) / STEPS_PER_MINUTE) : 0;
    const paperDone = g.paperDay === sim.today;
    // The look away's countdown is written in place (a redraw every game minute would disarm a button asking twice).
    const clock = left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '';
    const key = ['g', who, s.cash, s.heat > 0, left > 0, paperDone, trait, currentLang(), this.greeting].join('|');
    if (key === this.drawn) {
      const time = this.el.querySelector('.bribe-left');
      if (time) setText(time as HTMLElement, t('bribe.lookingAway', { time: clock }));
      return;
    }
    this.drawn = key;
    const first = this.who !== who;
    this.who = who;
    const name = guardTitle(sim, k);
    const keyName = t(`keyColor.${def.key}` as Key);
    const chip = trait ? `<span class="chip trait" data-trait="${trait}">${icon(TRAIT_ICON[trait], 13)}${t(`trait.${trait}` as Key)}</span>` : `<span class="chip trait unknown">${icon('ear', 13)}${t('trait.unknown')}</span>`;
    const pay = (kind: number, price: number) =>
      `<button class="big-btn primary small" data-act="${TALK.BRIBE}" data-arg="${kind}" data-confirm="${esc(t('bribe.confirm', { n: price }))}" ${s.cash < price ? 'disabled' : ''}>${icon('coin', 16)}<span>$${price}</span></button>`;
    const hours = LOOK_AWAY_STEPS / STEPS_PER_MINUTE / 60;
    const lookEnd = left ? `<span class="talk-status bribe-on">${icon('eyeOff', 14)}<span class="bribe-left">${t('bribe.lookingAway', { time: clock })}</span></span>` : pay(BRIBE.LOOK, look);
    const paperEnd = paperDone ? `<span class="talk-status">${t('bribe.paperDone')}</span>` : s.heat > 0 ? pay(BRIBE.PAPER, paper) : `<span class="talk-status">${t('bribe.noHeat')}</span>`;
    this.el.innerHTML = `<div class="panel-head"><span class="talk-face guard" data-key="${def.key}">${icon('shield', 20)}</span><span class="talk-who"><b>${esc(name)}</b><small>${esc(t('talk.guardKey', { key: keyName }))}</small></span><button class="icon-btn small" data-act="close" aria-label="${t('box.close')}">${icon('close', 18)}</button></div>
      ${this.greeting ? `<p class="talk-greet guard">${esc(this.greeting)}</p>` : ''}<div class="talk-chips">${chip}</div>
      <section class="talk-bribe"><div class="box-label">${icon('coin', 14)}<span>${t('bribe.title')}</span><em>${t('bribe.note')}</em></div>
        <div class="bribe-row"><span class="bribe-text"><b>${t('bribe.look')}</b><small>${t('bribe.lookNote', { n: hours })}</small></span>${lookEnd}</div>
        <div class="bribe-row"><span class="bribe-text"><b>${t('bribe.paper')}</b><small>${t('bribe.paperNote', { n: PAPER_HEAT })}</small></span>${paperEnd}</div>
        <p class="talk-note bribe-risk">${icon('eye', 13)}<span>${t('bribe.risk')}</span></p></section>`;
    if (first) {
      this.el.classList.remove('hidden');
      this.el.setAttribute('aria-label', name);
    }
  }
}

/** The icon of each of a guard's ways. */
const TRAIT_ICON: Record<string, string> = { steady: 'check', lazy: 'moon', strict: 'shield', corrupt: 'coin' };

/** A guard as the player addresses it: "Officer Pratt" (or "a guard" for one without a name). */
export function guardTitle(sim: Sim, k: number): string {
  const d = sim.prison.guards[k];
  return d?.name ? t('guard.title', { name: d.name }) : t('guard.nameless');
}

/**
 * The job board (GDD §11): every job, what it needs and pays, who holds it; apply for an
 * open one the player has the Intellect for, or quit. Opened from the board, closed out of
 * its reach.
 */
export class BoardPanel {
  readonly el: HTMLElement;
  private drawn = '';
  isOpen = false;

  constructor(private readonly send: Send, private readonly click: () => void) {
    this.el = h('div', 'item-panel board-panel hidden');
    this.el.setAttribute('role', 'dialog');
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-job]');
      if (!b || (b as HTMLButtonElement).disabled) return;
      this.click();
      if (!confirmed(b)) return;
      if (b.dataset.job === 'close') this.close();
      else this.send(OP.JOB, Number(b.dataset.job));
    });
    document.body.append(this.el);
  }

  show() {
    this.isOpen = true;
    this.drawn = '';
  }

  close() {
    this.isOpen = false;
    this.el.classList.add('hidden');
  }

  update(sim: Sim, busy: boolean) {
    if (!this.isOpen || busy) {
      this.el.classList.add('hidden');
      return;
    }
    const s = sim.state;
    const key = [s.jobs.join(','), s.items.int, s.jobDay, sim.today, s.paid, s.quota, currentLang()].join('|');
    this.el.classList.remove('hidden');
    if (key === this.drawn) return;
    this.drawn = key;
    const mine = sim.playerJob;
    const rows = jobRooms(sim.world)
      .map((room, j) => {
        const d = room.def;
        const holder = s.jobs[j];
        const you = holder === HOLDER.PLAYER;
        const open = holder === HOLDER.NOBODY;
        const can = qualifies(sim.world, s.items.int, j);
        const who = you ? t('board.you') : open ? t('board.open') : inmateName(sim, holder);
        // Quitting, or applying while holding a job (it's left), asks twice.
        const swap = mine >= 0 ? ` data-confirm="${esc(t('board.confirmSwap'))}" title="${esc(t('board.swapNote', { job: t(`job.${sim.prison.jobs[mine].id}` as Key) }))}"` : '';
        const action = you
          ? `<button class="big-btn ghost small" data-job="0" data-confirm="${esc(t('board.confirmQuit'))}">${t('board.quit')}</button>`
          : open
            ? `<button class="big-btn ${can ? 'primary' : 'ghost'} small" data-job="${j + 1}" ${can ? swap : 'disabled'}>${can ? t('board.apply') : t('board.needInt', { n: d.int })}</button>`
            : `<span class="board-taken">${t('board.taken')}</span>`;
        const later = you && s.jobDay > sim.today ? `<em class="board-later">${t('board.tomorrow')}</em>` : '';
        // The job the prison gave on day 1 (above the player's Intellect): theirs to take back.
        const first = !you && can && s.items.int < d.int ? `<em class="board-later">${t('board.firstJob')}</em>` : '';
        return `<div class="board-row${you ? ' mine' : ''}${open ? ' open' : ''}"><span class="board-ic">${icon(JOB_ICONS[d.id], 20)}</span><span class="board-text"><b>${esc(t(`job.${d.id}` as Key))}${later}${first}</b><small>${esc(t(`jobTask.${d.id}` as Key, { n: d.quota }))}</small><span class="board-meta"><i class="${s.items.int >= d.int || you || can ? '' : 'short'}">${icon('brain', 12)}${d.int}</i><i class="wage">${icon('coin', 12)}$${d.wage}</i><i class="holder${open ? ' open' : you ? ' you' : ''}">${esc(who)}</i></span></span>${action}</div>`;
      })
      .join('');
    this.el.innerHTML = `<div class="panel-head"><b>${icon('board', 20)}${t('board.title')}</b><button class="icon-btn small" data-job="close" aria-label="${t('box.close')}">${icon('close', 18)}</button></div>
      <p class="board-note">${t(mine >= 0 ? 'board.note' : 'board.noteNone')}</p><div class="board-list">${rows}</div>`;
    this.el.setAttribute('aria-label', t('board.title'));
  }
}

/** Every job's icon (typed by JobId: a new job can't be left without one). */
const JOB_ICONS: Record<JobId, string> = { laundry: 'shirt', janitor: 'drop', kitchen: 'flame', woodshop: 'hammer', mailman: 'letter', metalshop: 'gear' };

/**
 * Training (GDD §3.2): the set's bar, filled by pressing left and right in turn (A and D, or
 * the arrows; on touch the two big buttons), drained while idle. A full bar is +2 and costs
 * energy. Shown while the player is on the equipment.
 */
export class TrainCard {
  private readonly el: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly title: HTMLElement;
  private readonly value: HTMLElement;
  private readonly note: HTMLElement;
  private readonly sides: HTMLButtonElement[];
  private shown = '';
  private lastSide = -1;

  constructor(private readonly send: Send) {
    this.el = h(
      'div',
      'train-card hidden',
      `<div class="train-head"><i class="train-ic"></i><b></b><span class="train-value"></span><button class="icon-btn small train-stop">${icon('close', 16)}</button></div>
      <i class="train-bar"><i></i></i><p class="train-note"></p>
      <div class="train-pads"><button class="train-pad left" data-side="1">${icon('chevronLeft', 30)}</button><button class="train-pad right" data-side="2">${icon('chevronRight', 30)}</button></div>`,
    );
    this.fill = this.el.querySelector('.train-bar i')!;
    this.title = this.el.querySelector('.train-head b')!;
    this.value = this.el.querySelector('.train-value')!;
    this.note = this.el.querySelector('.train-note')!;
    this.sides = [...this.el.querySelectorAll<HTMLButtonElement>('.train-pad')];
    for (const b of this.sides) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.send(OP.TRAIN, Number(b.dataset.side));
      });
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    this.el.querySelector('.train-stop')!.addEventListener('click', () => this.send(OP.TRAIN, 3));
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.append(this.el);
  }

  get open() {
    return !this.el.classList.contains('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
    this.shown = '';
  }

  update(sim: Sim, busy: boolean) {
    const s = sim.state;
    const a = s.train >= 0 ? sim.trainsOn(s.train) : null;
    const on = !!a && !busy;
    this.el.classList.toggle('hidden', !on);
    document.body.classList.toggle('training', on);
    if (!on || !a) {
      this.shown = '';
      return;
    }
    const value = sim.attr(a);
    const key = `${s.train}|${value}|${currentLang()}`;
    if (key !== this.shown) {
      const was = this.shown;
      this.shown = key;
      const kind = sim.world.props[s.train].kind;
      this.el.dataset.attr = a;
      this.el.querySelector('.train-ic')!.innerHTML = icon(a === 'str' ? 'dumbbell' : a === 'spd' ? 'run' : 'book', 18);
      setText(this.title, t(`train.${kind === 'shelf' ? 'study' : kind}` as Key));
      setText(this.value, `${t(`attr.${a}` as Key)} ${value}`);
      setText(this.note, `${TOUCH ? t('train.touch') : t('train.keys')} · ${t('train.cost', { n: a === 'int' ? 10 : 12 })}`);
      this.el.querySelector('.train-stop')!.setAttribute('aria-label', t('train.stop'));
      this.sides[0].setAttribute('aria-label', t('train.left'));
      this.sides[1].setAttribute('aria-label', t('train.right'));
      // A set done: the value pops.
      if (was && was.split('|')[0] === String(s.train)) {
        this.value.classList.remove('pop');
        void this.value.offsetWidth;
        this.value.classList.add('pop');
      }
    }
    this.fill.style.width = `${s.reps}%`;
    // The side to press next glows.
    if (s.repSide !== this.lastSide) {
      this.lastSide = s.repSide;
      this.sides[0].classList.toggle('next', s.repSide !== 1);
      this.sides[1].classList.toggle('next', s.repSide === 1);
      this.el.dataset.next = s.repSide === 1 ? 'right' : 'left';
    }
  }
}

/**
 * Job stations at work (GDD §11): a chip over each machine with a load in, its ring filling
 * until the load is ready (then a tick that bobs). Placed on screen each frame.
 */
export class WorkChips {
  private readonly pool: HTMLElement[] = [];
  private readonly at = { x: 0, y: 0 };

  update(sim: Sim, project: (x: number, y: number, z: number, out: { x: number; y: number }) => { x: number; y: number } | null, busy: boolean) {
    const s = sim.state;
    let n = 0;
    if (!busy && ROUTINE[s.routine].id === 'work') {
      const job = sim.jobActive();
      const room = job >= 0 ? jobRooms(sim.world)[job] : null;
      const cycle = (room?.def.cycle ?? 3) * 20;
      for (const k in room ? s.machines : {}) {
        const prop = sim.world.props[Number(k)];
        if (!prop) continue;
        const p = project(prop.x + prop.w / 2, 1.35, prop.z + prop.d / 2, this.at);
        if (!p) continue;
        const left = s.machines[k] - s.step;
        const el = (this.pool[n] ??= this.make());
        n++;
        el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
        const ready = left <= 0;
        el.classList.toggle('ready', ready);
        el.style.setProperty('--p', `${Math.round((1 - Math.max(0, left) / cycle) * 100)}%`);
        const item = room?.def.done ? itemIcons()[itemNumber(room.def.done)] : '';
        const img = el.querySelector('img')!;
        if (img.getAttribute('src') !== item) img.setAttribute('src', item);
      }
    }
    for (let k = 0; k < this.pool.length; k++) this.pool[k].classList.toggle('hidden', k >= n);
  }

  hide() {
    for (const el of this.pool) el.classList.add('hidden');
  }

  private make(): HTMLElement {
    const el = h('div', 'work-chip hidden', `<i class="work-ring"></i><img alt="" draggable="false"><i class="work-tick">${icon('check', 14)}</i>`);
    el.setAttribute('aria-hidden', 'true');
    document.body.append(el);
    return el;
  }
}

/** The job names in the board's order for this prison (for toasts). */
export const jobName = (sim: Sim, job: number) => t(`job.${sim.prison.jobs[job]?.id ?? 'laundry'}` as Key);
export { JOBS };
