/** Work on screen: the job board, the training card (the gym, the library, a lap of the yard) and the work chips over the HUD. */
import { wageOf } from '../sim/systems/jobs';
import { itemNumber } from '../content/items';
import type { JobId } from '../content/jobs';
import { ROUTINE } from '../content/routine';
import { OP } from '../sim/command';
import { HOLDER, jobRooms, qualifies } from '../sim/systems/economy';
import type { Sim } from '../sim/Sim';
import { itemIcons } from '../render/itemIcons';
import { currentLang, type Key, t } from '../i18n';
import { confirmed, esc, h, type Send, setText, TOUCH } from './dom';
import { icon } from './icons';
import { inmateName } from './names';

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
        return `<div class="board-row${you ? ' mine' : ''}${open ? ' open' : ''}"><span class="board-ic">${icon(JOB_ICONS[d.id], 20)}</span><span class="board-text"><b>${esc(t(`job.${d.id}` as Key))}${later}${first}</b><small>${esc(t(`jobTask.${d.id}` as Key, { n: d.quota }))}</small><span class="board-meta"><i class="${s.items.int >= d.int || you || can ? '' : 'short'}">${icon('brain', 12)}${d.int}</i><i class="wage">${icon('coin', 12)}$${wageOf(s, d.wage)}</i><i class="holder${open ? ' open' : you ? ' you' : ''}">${esc(who)}</i></span></span>${action}</div>`;
      })
      .join('');
    this.el.innerHTML = `<div class="panel-head"><b>${icon('board', 20)}${t('board.title')}</b><button class="icon-btn small" data-job="close" aria-label="${t('box.close')}">${icon('close', 18)}</button></div>
      <p class="board-note">${t(mine >= 0 ? 'board.note' : 'board.noteNone')}</p><div class="board-list">${rows}</div>`;
    this.el.setAttribute('aria-label', t('board.title'));
  }
}

/** Every job's icon (typed by JobId: a new job can't be left without one). */
const JOB_ICONS: Record<JobId, string> = { laundry: 'shirt', janitor: 'drop', kitchen: 'flame', woodshop: 'hammer', mailman: 'letter', metalshop: 'gear', gardener: 'sprout' };

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
