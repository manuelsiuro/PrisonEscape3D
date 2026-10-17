import { SPEC_ICON } from './crew';
import { specialityOf } from '../sim/systems/crew';
import { ROUTINE } from '../content/routine';
import { dogDef } from '../sim/systems/k9';
import { prisonDay } from '../sim/systems/clock';
import { DOG_FIRST_DAY, TRUST_FRIEND } from '../sim/tuning';
import { FAVOR, FAVOR_STATE, jobRooms } from '../sim/systems/economy';
import { ATTRS, type Sim } from '../sim/Sim';
import { ATTR_MAX, ATTR_MIN, ATTR_START } from '../sim/tuning';
import { currentLang, t, type Key } from '../i18n';
import { h } from './dom';
import { icon } from './icons';
import { favorText, inmateName } from './social';
import { PLAYER } from '../talk/fill';
import type { PaRow } from './pa';

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
  /** The day (P17): today's event and weather rows, tomorrow's once forecast, what the player did of it; the play layer fills this in. */
  day: () => { day: number; today: readonly PaRow[]; tomorrow: readonly PaRow[] | null; notes: readonly string[]; night: boolean; key: string } | null = () => null;
  /** The rumors heard (P13), newest first: the speech bubbles' director fills this in. */
  notebook: () => ReadonlyArray<{ text: string; old: boolean; day: number; by: string | null; self?: boolean }> = () => [];

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
    const day = this.day();
    const key = [day?.key ?? '', rumors.map((r) => `${r.text}${r.old ? '~' : ''}`).join('/'), s.str, s.spd, s.items.int, s.trained, s.cash, s.jobs.join(','), s.jobDay, s.quota, s.paid, s.followers.join(','), favors.map((f) => `${f.by}:${f.state}`).join(','), sim.today, currentLang(), PLAYER.name].join('|');
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
    // The guard dogs (P19), once they're at work: how far each trusts the player, and whether it's had today's jerky.
    const dogs =
      s.dogs.length && prisonDay(s.step) >= DOG_FIRST_DAY
        ? `<div class="box-section"><div class="box-label"><span>${t('profile.dogs')}</span></div><div class="talk-chips">${s.dogs
            .map((d, k) => {
              const name = esc(dogDef(sim.world, k).name);
              const fed = d.fed === prisonDay(s.step);
              return `<span class="chip dog" title="${esc(t(fed ? 'profile.dogFed' : 'profile.dogHungry'))}">${icon(d.trust >= TRUST_FRIEND ? 'heart' : 'paw', 13)}${name}<em>${t('profile.trust', { n: d.trust })}</em>${fed ? icon('check', 12) : ''}</span>`;
            })
            .join('')}</div></div>`
        : '';
    const allies = s.followers.length ? `<div class="talk-chips">${s.followers.map((id) => {
          // (P23: each one's line of work.)
          const spec = specialityOf(sim.world, id, s.inmates[id].cell);
          return `<span class="chip ally">${icon(SPEC_ICON[spec], 13)}${esc(inmateName(sim, id))} · ${t(`spec.${spec}`)}</span>`;
        }).join('')}</div>` : `<p class="talk-note">${t('profile.noFollowers')}</p>`;
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
      ? rumors.map((r) => `<div class="rumor${r.old ? ' old' : ''}">${icon(r.self ? 'eye' : 'ear', 14)}<span>${esc(r.text)}</span><small>${r.self ? `${t('profile.rumorSelf')} · ` : r.by ? `${esc(r.by)} · ` : ''}${t('profile.rumorDay', { n: r.day })}</small></div>`).join('')
      : `<p class="talk-note">${t('profile.noRumors')}</p>`;
    const working = ROUTINE[s.routine].id === 'work';
    // Your prisoner's name on the file (P16), when they have one.
    const title = PLAYER.name ? t('profile.titleOf', { name: esc(PLAYER.name) }) : t('profile.title');
    const row = (r: PaRow) => `<div class="pa-row"><span class="pa-ic" style="--c:${r.color}">${icon(r.icon, 18)}</span><span class="pa-text"><small>${esc(r.label)}</small><b>${esc(r.title)}${r.when ? `<em>${esc(r.when)}</em>` : ''}</b><span>${esc(r.sub)}</span>${r.note ? `<i class="pa-note">${icon('wind', 13)}${esc(r.note)}</i>` : ''}</span></div>`;
    // (Notes on their own line: short screens hide the label's aside.)
    const dayNote = day && day.notes.length ? `<p class="file-note">${icon('check', 13)}${day.notes.map(esc).join(' · ')}</p>` : '';
    const dayHtml = day
      ? `<div class="box-section"><div class="box-label"><span>${t(day.night ? 'profile.tonight' : 'profile.today')}</span></div><div class="file-day">${day.today.map(row).join('')}${dayNote}</div></div>${
          day.tomorrow ? `<div class="box-section"><div class="box-label"><span>${t(day.night ? 'profile.fromMorning' : 'profile.tomorrow')}</span></div><div class="file-day">${day.tomorrow.map(row).join('')}<p class="file-note">${icon('megaphone', 13)}${t('profile.tomorrowNote')}</p></div></div>` : ''
        }`
      : '';
    this.el.innerHTML = `<div class="panel-head"><b>${icon('book', 20)}${title}</b><span class="profile-cash">${icon('coin', 16)}$${s.cash}</span><button class="icon-btn small" data-close aria-label="${t('box.close')}">${icon('close', 18)}</button></div>
      ${dayHtml}
      <div class="box-section"><div class="box-label"><span>${t('profile.stats')}</span><em>${t('profile.statsNote')}</em></div>${attrs}</div>
      <div class="box-section"><div class="box-label"><span>${t('profile.job')}</span>${working && job >= 0 ? `<em>${t('profile.workNow')}</em>` : ''}</div>${jobHtml}</div>
      <div class="box-section"><div class="box-label"><span>${t('profile.favors')}</span></div>${favorList}</div>
      <div class="box-section"><div class="box-label"><span>${t('profile.followers')}</span></div>${allies}</div>
      ${dogs}
      <div class="box-section"><div class="box-label"><span>${t('profile.rumors')}</span><em>${t('profile.rumorsNote')}</em></div>${rumorList}</div>`;
    this.el.setAttribute('aria-label', PLAYER.name ? t('profile.titleOf', { name: PLAYER.name }) : t('profile.title'));
  }
}
