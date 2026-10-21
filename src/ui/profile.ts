import { wageOf } from '../sim/systems/jobs';
import { SPEC_ICON } from './crew';
import { specialityOf } from '../sim/systems/crew';
import { ROUTINE } from '../content/routine';
import { dogDef, dogsFrom } from '../sim/systems/k9';
import { prisonDay } from '../sim/systems/clock';
import { TRUST_FRIEND } from '../sim/tuning';
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
 * the job and today's quota, followers and favors under way. Opened from the HUD's button with your face and cash (or I).
 */
export class ProfilePanel {
  readonly el: HTMLElement;
  private drawn = '';
  isOpen = false;
  /** The day (P17): today's event and weather rows, tomorrow's once forecast, what the player did of it; the play layer fills this in. */
  day: () => { day: number; today: readonly PaRow[]; tomorrow: readonly PaRow[] | null; notes: readonly string[]; night: boolean; key: string } | null = () => null;
  /** The rumors heard (P13), newest first: the speech bubbles' director fills this in. */
  notebook: () => ReadonlyArray<{ text: string; old: boolean; day: number; by: string | null; self?: boolean }> = () => [];
  /** What one of the crew is at (P23, play/crew.ts). */
  crewLine: (sim: Sim, who: number) => string = () => '';
  /** Your prisoner's face at the file's head (render/portrait.ts; the book until it's taken). */
  face = '';
  /** What the file held when last opened (its news: newsFor). */
  private seen = new Set<string>();
  private newsSim: Sim | null = null;
  private newsLang = '';
  private newsTick = -1;
  private news = false;

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

  /**
   * Whether the file holds something new since it was last open (a dot on the HUD's button):
   * a rumor heard, a favor taken on or ready, a job, tomorrow's forecast. A game begun (or the
   * language changed: the rumors are told again) starts with nothing new. Checked once a game
   * second, every frame while open (it's all seen then).
   */
  newsFor(sim: Sim): boolean {
    const tick = Math.floor(sim.state.step / 20);
    if (sim !== this.newsSim || currentLang() !== this.newsLang) {
      this.newsSim = sim;
      this.newsLang = currentLang();
      this.seen = new Set(this.newsKeys(sim));
      this.newsTick = tick;
      return (this.news = false);
    }
    if (tick === this.newsTick && !this.isOpen) return this.news;
    this.newsTick = tick;
    const now = this.newsKeys(sim);
    if (this.isOpen) {
      this.seen = new Set(now);
      return (this.news = false);
    }
    return (this.news = now.some((k) => !this.seen.has(k)));
  }

  private newsKeys(sim: Sim): string[] {
    const s = sim.state;
    const keys = this.notebook().map((r) => `r:${r.text}`);
    for (const f of s.favors) if (f.state !== FAVOR_STATE.OFFERED) keys.push(`f:${f.by}:${f.kind}:${f.state}`);
    if (sim.playerJob >= 0) keys.push(`j:${sim.playerJob}`);
    const day = this.day();
    if (day?.tomorrow) keys.push(`w:${day.day}`);
    return keys;
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
    const crewLines = s.followers.map((id) => this.crewLine(sim, id));
    // (A brawl's countdown is written in place: the file isn't rebuilt every second for it.)
    s.followers.forEach((id, k) => {
      const line = this.el.querySelector(`.file-row[data-who="${id}"] small`);
      if (line && line.textContent !== crewLines[k]) line.textContent = crewLines[k];
    });
    const key = [crewLines.join('/').replace(/\d+:\d\d/g, ''), s.crew.map((e) => e[4]).join(','), s.dogs.map((d) => `${d.trust}:${d.fed}`).join(','), day?.key ?? '', rumors.map((r) => `${r.text}${r.old ? '~' : ''}`).join('/'), s.str, s.spd, s.items.int, s.trained, s.cash, s.jobs.join(','), s.jobDay, s.quota, s.paid, s.followers.join(','), favors.map((f) => `${f.by}:${f.state}`).join(','), sim.today, currentLang(), PLAYER.name, this.face].join('|');
    if (key === this.drawn) return;
    this.drawn = key;
    const attrs = ATTRS.map((a, k) => {
      const v = sim.attr(a);
      const trained = (s.trained >> k) & 1;
      const pct = Math.round(((v - ATTR_MIN) / (ATTR_MAX - ATTR_MIN)) * 100);
      const state = trained ? `<em class="ok">${icon('check', 12)}${t('profile.trained')}</em>` : v > ATTR_START ? `<em class="slip">${t('profile.slips')}</em>` : '';
      return `<div class="stat-row" data-attr="${a}"><span class="stat-ic">${icon(ATTR_ICONS[a], 18)}</span><span class="stat-text"><b>${t(`attr.${a}` as Key)}</b><small>${t(`attrWhere.${a}` as Key)}</small></span><i class="stat-bar"><i style="width:${pct}%"></i></i><b class="stat-v">${v}</b>${state}</div>`;
    }).join('');
    // The file's rows: a tile, a title, a line under it (and a tag at the end); a muted one says what would go there.
    const fileRow = (ic: string, color: string, title: string, sub: string, opts: { tag?: string; tagCls?: string; cls?: string; quote?: boolean; state?: string; stateCls?: string; aside?: string; who?: number } = {}) =>
      `<div class="file-row${opts.cls ? ` ${opts.cls}` : ''}" style="--c:${color}"${opts.who !== undefined ? ` data-who="${opts.who}"` : ''}><span class="file-ic">${icon(ic, 18)}</span><span class="file-text"><b>${title}${opts.aside ? `<em>${opts.aside}</em>` : ''}</b>${sub ? `<small${opts.quote ? ' class="quote"' : ''}>${sub}</small>` : ''}${opts.state ? `<span class="file-state${opts.stateCls ? ` ${opts.stateCls}` : ''}">${opts.state}</span>` : ''}</span>${opts.tag ? `<span class="file-tag${opts.tagCls ? ` ${opts.tagCls}` : ''}">${opts.tag}</span>` : ''}</div>`;
    const empty = (ic: string, title: Key, sub: Key) => fileRow(ic, '', t(title), t(sub), { cls: 'empty' });
    const job = sim.playerJob;
    let jobHtml: string;
    if (job < 0) jobHtml = empty('briefcase', 'profile.noJobT', 'profile.noJobS');
    else {
      const d = jobRooms(sim.world)[job].def;
      const later = s.jobDay > sim.today;
      const today = later ? t('board.tomorrow') : s.paid ? t('profile.paid', { n: wageOf(s, d.wage) }) : t('profile.quota', { n: s.quota, of: d.quota });
      jobHtml = fileRow('briefcase', '#c99a12', esc(t(`job.${d.id}` as Key)), esc(t(`jobTask.${d.id}` as Key, { n: d.quota })), { tag: esc(today), tagCls: s.paid ? 'done' : '' });
    }
    // The guard dogs (P19), once they're at work: how far each trusts the player, and whether it's had today's jerky.
    const dogs =
      s.dogs.length && prisonDay(s.step) >= dogsFrom(s)
        ? `<div class="box-section"><div class="box-label"><span>${t('profile.dogs')}</span></div><div class="file-list">${s.dogs
            .map((d, k) => {
              const fed = d.fed === prisonDay(s.step);
              return fileRow(d.trust >= TRUST_FRIEND ? 'heart' : 'paw', '#b07a3c', esc(dogDef(sim.world, k).name), esc(t(fed ? 'profile.dogFed' : 'profile.dogHungry')), { tag: t('profile.trust', { n: d.trust }), tagCls: d.trust >= TRUST_FRIEND ? 'done' : '' });
            })
            .join('')}</div></div>`
        : '';
    // The crew (P23): each one's line of work and what he's at.
    const allies = s.followers.length
      ? `<div class="file-list">${s.followers
          .map((id, k) => {
            const spec = specialityOf(sim.world, id, s.inmates[id].cell);
            const night = s.crew.some((e) => e[0] === id && e[4] === 1);
            return fileRow(SPEC_ICON[spec], '#ffa94d', esc(inmateName(sim, id)), esc(crewLines[k]), { who: id, aside: esc(t(`spec.${spec}`)), tag: night ? `${icon('moon', 12)}${esc(t('profile.tonight'))}` : '', tagCls: 'night' });
          })
          .join('')}</div>`
      : empty('users', 'profile.noFollowersT', 'profile.noFollowersS');
    const favorList = favors.length
      ? `<div class="file-list">${favors
          .map((f) => {
            const ready = f.state === FAVOR_STATE.DONE;
            const bring = f.kind === FAVOR.SCAVENGE || f.kind === FAVOR.RETRIEVE;
            return fileRow('chat', '#3fb07a', esc(inmateName(sim, f.by)), esc(favorText(sim, f)), { quote: true, tag: `$${f.reward}`, tagCls: 'cash', state: ready ? t('profile.favorReady') : bring ? t('talk.bringIt') : t('talk.underWay'), stateCls: ready ? 'ok' : '', cls: ready ? 'ready' : '' });
          })
          .join('')}</div>`
      : empty('chat', 'profile.noFavorsT', 'profile.noFavorsS');
    const rumorList = rumors.length
      ? `<div class="file-list rumors">${rumors.map((r) => `<div class="rumor${r.old ? ' old' : ''}"><span class="rumor-ic">${icon(r.self ? 'eye' : 'ear', 14)}</span><span class="rumor-text"><span>${esc(r.text)}${r.old ? `<i class="sr-only"> (${esc(t('profile.rumorOld'))})</i>` : ''}</span><small>${r.self ? `${t('profile.rumorSelf')} · ` : r.by ? `${esc(r.by)} · ` : ''}${t('profile.rumorDay', { n: r.day })}</small></span></div>`).join('')}</div>`
      : empty('ear', 'profile.noRumorsT', 'profile.noRumorsS');
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
    // (A rebuild keeps the keyboard's place on the close button.)
    const hadClose = this.el.contains(document.activeElement) && !!(document.activeElement as HTMLElement).closest('[data-close]');
    this.el.innerHTML = `<div class="panel-head"><b>${this.face ? `<img class="profile-face" src="${this.face}" alt="">` : icon('book', 20)}${title}</b><span class="profile-cash">${icon('coin', 16)}$${s.cash}</span><button class="icon-btn small" data-close aria-label="${t('box.close')}">${icon('close', 18)}</button></div>
      ${dayHtml}
      <div class="box-section"><div class="box-label"><span>${t('profile.stats')}</span><em>${t('profile.statsNote')}</em></div><div class="file-list">${attrs}</div></div>
      <div class="box-section"><div class="box-label"><span>${t('profile.job')}</span>${working && job >= 0 ? `<em>${t('profile.workNow')}</em>` : ''}</div>${jobHtml}</div>
      <div class="box-section"><div class="box-label"><span>${t('profile.favors')}</span></div>${favorList}</div>
      <div class="box-section"><div class="box-label"><span>${t('profile.followers')}</span></div>${allies}</div>
      ${dogs}
      <div class="box-section"><div class="box-label"><span>${t('profile.rumors')}</span><em>${t('profile.rumorsNote')}</em></div>${rumorList}</div>`;
    this.el.setAttribute('aria-label', PLAYER.name ? t('profile.titleOf', { name: PLAYER.name }) : t('profile.title'));
    if (hadClose) this.el.querySelector<HTMLElement>('[data-close]')?.focus();
  }
}
