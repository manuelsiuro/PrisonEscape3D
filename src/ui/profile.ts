import { ROUTINE } from '../content/routine';
import { FAVOR, FAVOR_STATE, jobRooms } from '../sim/systems/economy';
import { ATTRS, type Sim } from '../sim/Sim';
import { ATTR_MAX, ATTR_MIN, ATTR_START } from '../sim/tuning';
import { currentLang, t, type Key } from '../i18n';
import { h } from './dom';
import { icon } from './icons';
import { favorText, inmateName } from './social';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ATTR_ICONS = { str: 'dumbbell', spd: 'run', int: 'brain' } as const;

/**
 * The prisoner's file (GDD §13.2 stats: STR, SPD, INT, CASH): the three attributes with
 * where to train them (and whether they were trained today: untrained, they slip), the cash,
 * the job and today's quota, followers and favors under way. Opened from the cash pill (or I).
 */
export class ProfilePanel {
  readonly el: HTMLElement;
  private drawn = '';
  isOpen = false;
  /** The rumors heard (P13), newest first: the speech bubbles' director fills this in. */
  notebook: () => ReadonlyArray<{ text: string; old: boolean; day: number }> = () => [];

  constructor(private readonly click: () => void) {
    this.el = h('div', 'item-panel profile-panel hidden');
    this.el.setAttribute('role', 'dialog');
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-close]')) {
        this.click();
        this.close();
      }
    });
    document.body.append(this.el);
  }

  toggle() {
    this.isOpen = !this.isOpen;
    this.drawn = '';
    if (!this.isOpen) this.el.classList.add('hidden');
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
    this.el.classList.remove('hidden');
    const s = sim.state;
    const favors = s.favors.filter((f) => f.state !== FAVOR_STATE.OFFERED);
    const rumors = this.notebook();
    const key = [rumors.map((r) => `${r.text}${r.old ? '~' : ''}`).join('/'), s.str, s.spd, s.items.int, s.trained, s.cash, s.jobs.join(','), s.jobDay, s.quota, s.paid, s.followers.join(','), favors.map((f) => `${f.by}:${f.state}`).join(','), sim.today, currentLang()].join('|');
    if (key === this.drawn) return;
    this.drawn = key;
    const attrs = ATTRS.map((a, k) => {
      const v = sim.attr(a);
      const trained = (s.trained >> k) & 1;
      const pct = Math.round(((v - ATTR_MIN) / (ATTR_MAX - ATTR_MIN)) * 100);
      const state = trained ? `<em class="ok">${icon('check', 12)}${t('profile.trained')}</em>` : v > ATTR_START ? `<em class="slip">${t('profile.slips')}</em>` : '';
      return `<div class="stat-row" data-attr="${a}"><span class="stat-ic">${icon(ATTR_ICONS[a], 18)}</span><span class="stat-text"><b>${t(`attr.${a}` as Key)}</b><small>${t(`attrWhere.${a}` as Key)}</small></span><i class="stat-bar"><i style="width:${pct}%"></i></i><b class="stat-v">${v}</b>${state}</div>`;
    }).join('');
    const job = sim.playerJob;
    let jobHtml: string;
    if (job < 0) jobHtml = `<p class="talk-note">${t('profile.noJob')}</p>`;
    else {
      const d = jobRooms(sim.world)[job].def;
      const later = s.jobDay > sim.today;
      const today = later ? t('board.tomorrow') : s.paid ? t('profile.paid', { n: d.wage }) : t('profile.quota', { n: s.quota, of: d.quota });
      jobHtml = `<div class="profile-job"><span class="board-ic">${icon('briefcase', 18)}</span><span class="board-text"><b>${esc(t(`job.${d.id}` as Key))}</b><small>${esc(t(`jobTask.${d.id}` as Key, { n: d.quota }))}</small></span><span class="profile-quota${s.paid ? ' done' : ''}">${esc(today)}</span></div>`;
    }
    const allies = s.followers.length ? `<div class="talk-chips">${s.followers.map((id) => `<span class="chip ally">${icon('star', 13)}${esc(inmateName(sim, id))}</span>`).join('')}</div>` : `<p class="talk-note">${t('profile.noFollowers')}</p>`;
    const favorList = favors.length
      ? favors
          .map((f) => {
            const ready = f.state === FAVOR_STATE.DONE;
            const bring = f.kind === FAVOR.SCAVENGE || f.kind === FAVOR.RETRIEVE;
            return `<div class="profile-favor${ready ? ' ready' : ''}"><b>${esc(inmateName(sim, f.by))}<em>$${f.reward}</em></b><small>${esc(favorText(sim, f))}</small><span>${ready ? t('profile.favorReady') : bring ? t('talk.bringIt') : t('talk.underWay')}</span></div>`;
          })
          .join('')
      : `<p class="talk-note">${t('profile.noFavors')}</p>`;
    const rumorList = rumors.length
      ? rumors.map((r) => `<div class="rumor${r.old ? ' old' : ''}">${icon('ear', 14)}<span>${esc(r.text)}</span><small>${t('profile.rumorDay', { n: r.day })}</small></div>`).join('')
      : `<p class="talk-note">${t('profile.noRumors')}</p>`;
    const working = ROUTINE[s.routine].id === 'work';
    this.el.innerHTML = `<div class="panel-head"><b>${icon('book', 20)}${t('profile.title')}</b><span class="profile-cash">${icon('coin', 16)}$${s.cash}</span><button class="icon-btn small" data-close aria-label="${t('box.close')}">${icon('close', 18)}</button></div>
      <div class="box-section"><div class="box-label"><span>${t('profile.stats')}</span><em>${t('profile.statsNote')}</em></div>${attrs}</div>
      <div class="box-section"><div class="box-label"><span>${t('profile.job')}</span>${working && job >= 0 ? `<em>${t('profile.workNow')}</em>` : ''}</div>${jobHtml}</div>
      <div class="box-section"><div class="box-label"><span>${t('profile.favors')}</span></div>${favorList}</div>
      <div class="box-section"><div class="box-label"><span>${t('profile.followers')}</span></div>${allies}</div>
      <div class="box-section"><div class="box-label"><span>${t('profile.rumors')}</span><em>${t('profile.rumorsNote')}</em></div>${rumorList}</div>`;
    this.el.setAttribute('aria-label', t('profile.title'));
  }
}
