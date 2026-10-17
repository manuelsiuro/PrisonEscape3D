import { buzz } from '../app/haptics';
import { BACK_REACH, BRAWL_GUARDS, BRAWL_RANGE, NIGHT_OPINION, WATCH_RANGE } from '../content/crew';
import { currentLang, t, type Key } from '../i18n';
import { EXT, OP, ORDER } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import { brawlWith, cantOrder, carryingOf, crewEntry, nightOf, orderOf, ORDERS_OF, shaftOf, specialityOf } from '../sim/systems/crew';
import { HOTBAR } from '../sim/systems/items';
import { STEPS_PER_SECOND } from '../sim/tuning';
import { LAYER, MAP_W } from '../sim/world/World';
import { type CrewChip, type CrewHud, type CrewOrderView, type CrewRow, type CrewTalkView } from '../ui/crew';
import { itemName } from '../ui/items';
import { guardTitle, inmateName } from '../ui/social';
import { banner, closeSocial, crewPanel, hud, itemsUI, profile, sound } from './context';
import { play, sendOp } from './game';
import { coachOnce } from './tips';
import { badgeOf } from './frame';

/**
 * The crew on screen (P23): the orders in the talk panel (each greyed by the sim's own
 * cantOrder, its line saying what it does or why not), the crew's pill and panel (with the
 * whistle back), the chips over their heads, and what the crew's events say. What a lookout's
 * whistle warns of is the sim's whistle: a guard come within range in his sight.
 */

/** When each lookout last whistled (ms; by inmate index): the chip and the pill flash for a moment. */
const whistled = new Map<number, number>();
const ALERT_MS = 1600;

/** A new game (or a load): nothing ringing. */
export function resetCrew() {
  whistled.clear();
}

const ORDER_ICON: Record<number, string> = { [ORDER.FOLLOW]: 'walk', [ORDER.WATCH]: 'eye', [ORDER.DIG]: 'shovel', [ORDER.BACK]: 'shield', [ORDER.BRAWL]: 'fist', [ORDER.FETCH]: 'box', [ORDER.NIGHT]: 'moon' };
const ORDER_KEY: Record<number, string> = { [ORDER.FOLLOW]: 'follow', [ORDER.WATCH]: 'watch', [ORDER.DIG]: 'dig', [ORDER.BACK]: 'back', [ORDER.BRAWL]: 'brawl', [ORDER.FETCH]: 'fetch', [ORDER.NIGHT]: 'night' };

/** An item's name mid-sentence ("Bringing you a tube of glue": lower case, as the favors say it). */
const lowItem = (n: number) => {
  const name = itemName(n);
  return name.charAt(0).toLowerCase() + name.slice(1);
};

const secs = (steps: number) => {
  const s = Math.max(0, Math.ceil(steps / STEPS_PER_SECOND));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** What one of the crew is at, in a few words. */
export function crewStatus(sim: Sim, who: number): string {
  const s = sim.state;
  const m = s.inmates[who];
  if (!m) return '';
  if (m.ko > 0) return t('crew.s.ko');
  const e = crewEntry(s, who);
  const about = s.layer === LAYER.GROUND && !sim.away;
  switch (orderOf(s, who)) {
    case ORDER.WATCH: {
      const post = e![2];
      return t('crew.s.watch', { place: t(`zone.${sim.world.zoneAt(post % MAP_W, Math.floor(post / MAP_W))}` as Key) });
    }
    case ORDER.BRAWL:
      return t('crew.s.brawl', { name: inmateName(sim, e![3]), time: secs(e![2] - s.step) });
    case ORDER.FETCH: {
      const item = carryingOf(s, who);
      if (!item) return t('crew.s.fetch');
      const room = s.items.inv.slice(0, HOTBAR).includes(0);
      return t(room ? 'crew.s.carry' : 'crew.s.carryFull', { item: lowItem(item) });
    }
    case ORDER.DIG:
      if (shaftOf(s, who) >= 0) return t('crew.s.shaft');
      return about ? t('crew.s.dig') : t('crew.s.waiting');
    case ORDER.BACK:
      return about ? t('crew.s.back') : t('crew.s.waiting');
  }
  return about ? t('crew.s.follow') : t('crew.s.waiting');
}

/** The note under an order: what it does, or why it can't be given now. */
function orderNote(sim: Sim, who: number, order: number): string {
  const why = cantOrder(sim, who, order);
  if (why === 'brawlToday') return t('crew.brawlToday');
  if (why === 'noBrawl') return t('crew.brawlNobody', { n: BRAWL_RANGE });
  if (why === 'badPost') return t('crew.badPost');
  if (why === 'noDrop') return t('crew.fetchNone');
  if (why === 'crewLockdown') return t('refused.crewLockdown');
  if (why === 'nightOpinion') return t('crew.nightNeed', { n: NIGHT_OPINION });
  // (Mid-brawl, or bringing the drop: the status line says what he's at; the orders wait, quietly.)
  if (why === 'crewBusy') return '';
  switch (order) {
    case ORDER.WATCH:
      return t('crew.watchNote', { n: WATCH_RANGE });
    case ORDER.DIG:
      return t('crew.digNote');
    case ORDER.BACK:
      return t('crew.backNote', { n: BACK_REACH });
    case ORDER.BRAWL: {
      const other = brawlWith(sim, who);
      return t('crew.brawlNote', { name: other >= 0 ? inmateName(sim, other) : '', n: BRAWL_GUARDS });
    }
    case ORDER.FETCH:
      return t('crew.fetchNote');
    case ORDER.NIGHT:
      return nightOf(sim.state, who) ? t('crew.nightOnNote') : t('crew.nightNote');
  }
  return t('crew.followNote');
}

/** The talk panel's crew section for a follower (null: not one of the crew). */
export function crewTalk(sim: Sim, who: number): CrewTalkView | null {
  const s = sim.state;
  const m = s.inmates[who];
  if (!m || !s.followers.includes(who)) return null;
  const spec = specialityOf(sim.world, who, m.cell);
  const now = orderOf(s, who);
  const list = [...ORDERS_OF[spec]];
  if (now !== ORDER.FOLLOW) list.unshift(ORDER.FOLLOW);
  const orders: CrewOrderView[] = list.map((o) => ({
    order: o,
    icon: ORDER_ICON[o],
    label: t(`crew.${ORDER_KEY[o]}` as Key),
    note: orderNote(sim, who, o),
    ok: !cantOrder(sim, who, o),
    on: o === now && o !== ORDER.FOLLOW,
    confirm: o === ORDER.BRAWL ? t('crew.brawlConfirm') : undefined,
  }));
  const night = nightOf(s, who);
  orders.push({ order: ORDER.NIGHT, icon: 'moon', label: t('crew.night'), note: orderNote(sim, who, ORDER.NIGHT), ok: !cantOrder(sim, who, ORDER.NIGHT), on: night });
  return { spec, status: crewStatus(sim, who), orders };
}

/** Whether someone with an order can be whistled back now (the sim's recall()'s rule). */
const recallable = (sim: Sim, who: number) => {
  const o = orderOf(sim.state, who);
  return o === ORDER.WATCH || o === ORDER.DIG || o === ORDER.BACK || (o === ORDER.FETCH && !carryingOf(sim.state, who));
};

/** The crew's panel rows. */
export function crewRows(sim: Sim): CrewRow[] {
  const s = sim.state;
  return s.followers.map((who) => ({ who, name: inmateName(sim, who), spec: specialityOf(sim.world, who, s.inmates[who].cell), status: crewStatus(sim, who), recall: recallable(sim, who), night: nightOf(s, who) }));
}

const crewHud: CrewHud = { icons: [], text: '', alert: false };
/** The pill's text, worked out once a step (or on a language change), not every frame. */
let pillAt = -1;
let pillLang = '';

/** The crew's pill: while someone has an order (or stays the night), their icons and the status of the first with an order. */
export function crewPill(sim: Sim, now = performance.now()): CrewHud | null {
  const s = sim.state;
  if (!s.crew.length) return null;
  crewHud.alert = false;
  for (const e of s.crew) if (now - (whistled.get(e[0]) ?? -1e9) < ALERT_MS) crewHud.alert = true;
  if (pillAt === s.step && pillLang === currentLang()) return crewHud;
  pillAt = s.step;
  pillLang = currentLang();
  crewHud.icons.length = 0;
  let first = -1;
  for (const e of s.crew) {
    const o = orderOf(s, e[0]);
    crewHud.icons.push(o === ORDER.FOLLOW ? 'moon' : ORDER_ICON[o]);
    if (first < 0 && o !== ORDER.FOLLOW) first = e[0];
  }
  if (first < 0) first = s.crew[0][0];
  crewHud.text = `${inmateName(sim, first)} · ${crewStatus(sim, first)}`;
  return crewHud;
}

/** The chips over the crew's heads (pooled: asked for every frame). */
const chips: CrewChip[] = [];
const chipList: CrewChip[] = [];
export function crewChipList(sim: Sim, now = performance.now()): readonly CrewChip[] {
  const s = sim.state;
  chipList.length = 0;
  s.followers.forEach((who, k) => {
    const c = (chips[k] ??= { id: 0, spec: 'lookout', busy: false, alert: false, badge: false });
    c.id = who;
    c.spec = specialityOf(sim.world, who, s.inmates[who].cell);
    c.busy = orderOf(s, who) !== ORDER.FOLLOW;
    c.alert = now - (whistled.get(who) ?? -1e9) < ALERT_MS;
    // (Another badge over him, a favor or a shop: the chip steps aside.)
    c.badge = badgeOf(sim, who) !== '';
    chipList.push(c);
  });
  return chipList;
}

/** The pill and the panel's whistle. */
export function wireCrewPanel() {
  hud.onCrew = () => {
    sound.click();
    if (!crewPanel.isOpen) {
      closeSocial();
      itemsUI.closePanels();
    }
    toggleCrew();
  };
  crewPanel.onRecall = (who) => sendOp(OP.EXT, EXT.RECALL, who);
  profile.crewLine = crewStatus;
}

/** G (`focus`: into the panel), or the crew's pill: the panel open or shut (only with a crew). */
export function toggleCrew(focus = false) {
  const g = play.game;
  if (!g || g.paused || !g.rec.sim.state.followers.length) return;
  crewPanel.toggle(focus);
}

/** What a crew event says and sounds like. */
export function announceCrew(sim: Sim, e: Extract<SimEvent, { type: 'crew' }>) {
  const name = inmateName(sim, e.who);
  switch (e.what) {
    case 'order':
      if (e.order === ORDER.BRAWL) break;
      sound.click();
      banner.toast(t(`toast.crew.${ORDER_KEY[e.order ?? 0]}` as Key, { name }), 'good', 3600);
      if (e.order === ORDER.WATCH) coachOnce('crewWatch', 'hint.crewWatch');
      break;
    case 'whistle':
      whistled.set(e.who, performance.now());
      sound.lookout();
      buzz('missed');
      banner.toast(t('toast.whistle', { name, guard: guardTitle(sim, e.guard ?? 0) }), 'bad', 3600);
      break;
    case 'nightOff':
      sound.click();
      banner.toast(t('toast.crew.nightOff', { name }), 'info', 3600);
      break;
    case 'recalled':
      sound.lookout();
      banner.toast(t('toast.recalled', { name }), 'info');
      break;
    case 'brawl':
      sound.scuffle();
      banner.toast(t(e.guards?.length ? (e.guards.length === 1 ? 'toast.brawl1' : 'toast.brawl') : 'toast.brawlNone', { name, other: inmateName(sim, e.other ?? 0), n: e.guards?.length ?? 0 }), 'good', 4500);
      break;
    case 'brawlOver':
      banner.toast(t('toast.brawlOver', { name }), 'info');
      break;
    case 'fetched':
      sound.pickup();
      banner.toast(t('toast.fetched', { name, item: lowItem(e.item ?? 0) }), 'good');
      break;
    case 'handed':
      sound.pickup();
      itemsUI.toast(t('toast.handed', { name, item: lowItem(e.item ?? 0) }));
      break;
    case 'fetchFailed':
      banner.toast(t(e.why === 'gone' ? 'toast.fetchGone' : 'toast.fetchFar', { name }), 'bad');
      break;
    case 'stopped':
      sound.whistle();
      banner.toast(t('toast.stopped', { name, other: inmateName(sim, e.other ?? 0) }), 'good', 4000);
      break;
    case 'dirt':
      coachOnce('crewDirt', 'hint.crewDirt');
      break;
    case 'nightOver':
      banner.toast(t('toast.nightOver', { name }), 'info');
      break;
  }
}

