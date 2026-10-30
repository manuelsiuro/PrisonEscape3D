import { buzz } from '../app/haptics';
import { COURSE_INT, COURSE_PASS, COURSE_QUESTIONS, COURSE_STEPS, KIOSK, KIOSK_BLOCK, NEWS_AHEAD, NEWS_DAYS, PHOTOS, SHOP, shopPrice } from '../content/kiosk';
import { MONEY_EVERY } from '../content/phone';
import { phoneOpen } from '../sim/systems/phone';
import { UNIT } from '../sim/tuning';
import { DAY_BOOKS } from '../content/days';
import { itemNumber } from '../content/items';
import { t, type Key } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { dayRoll, planOf, prisonDay, type DayPlan } from '../sim/systems/calendar';
import { atKiosk, courseQuestion, kioskOf, kioskOpen, kioskRefusal, loggedIn } from '../sim/systems/kiosk';
import { DAY, FEAT } from '../sim/systems/ledger';
import type { KioskView } from '../ui/kiosk';
import { itemName } from '../ui/items';
import { banner, itemsUI, kioskCard, sound } from './context';
import { vehicleName, weatherName } from './day';
import { play, playNow } from './game';
import { questionText } from './nights';
import { coachOnce } from './tips';
import { dayTime } from './warden';

/**
 * The internet kiosk on screen (P35): its card (logged out: Log in; logged in: the clock, the
 * bill and the apps), filled from the sim's own functions; the toasts, sounds and banners of what
 * happens (mail call's goods and drawings among them); the keys of a course's answers.
 */

/** How long a course's ending stays on its card (ms). */
const RESULT_MS = 4200;
let result: { text: string; good: boolean; at: number } | null = null;
/** The dollars spent since logging in (counted from the events: the sim keeps only the block's end). */
let spent = 0;

/** A new game: nothing left over. */
export function resetKiosk() {
  result = null;
  spent = 0;
}

const view: KioskView = { phase: 'off', cash: 0, closed: '', loginWhy: '', left: 0, secs: 0, spent: 0, mailWhy: '', mailNote: '', coming: [], photos: [], shop: [], ordered: '', days: [], next: [], headlines: [], course: 'offer', courseWhy: '', q: 0, right: 0, question: '', choices: [], answer: 0, said: -1, result: '', good: true };

const why = (k: string | null) => (k ? t(`refused.${k}` as Key) : '');

/** A day the news names: tomorrow, or its number (`low`: after a colon, in lower case). */
const dayName = (sim: Sim, d: number, low = false) => (d === prisonDay(sim.state.step) + 1 ? t(low ? 'kiosk.news.tomorrowLow' : 'profile.tomorrow') : t(low ? 'kiosk.news.dayLow' : 'kiosk.news.day', { n: d }));

/** What a day ahead holds, in the news's words (a food fight is never announced: a rowdy canteen). */
function newsDay(sim: Sim, p: DayPlan) {
  const ev = p.event === 'foodFight' ? 'rowdy' : p.event;
  const when = p.event === 'none' || p.event === 'foodFight' ? '' : p.event === 'drill' ? t('day.whenBell') : t('day.when', { from: dayTime(p.at), to: dayTime(p.until) });
  const title = p.event === 'delivery' ? vehicleName(sim) : t(`day.event.${ev}` as Key);
  return {
    name: dayName(sim, p.day),
    event: when ? `${title} · ${when}` : title,
    weather: t(`weather.${weatherName(sim, p.weather)}` as Key),
    wind: t(`windForce.${p.windForce}` as Key, { dir: t(`wind.${p.wind}` as Key) }),
  };
}

/** Headlines from the run: a lockdown lately, the stage's and the quiz's winners, then the outside world's (by the day). */
function headlines(sim: Sim): string[] {
  const s = sim.state;
  const day = prisonDay(s.step);
  const prison = t(`prison.${sim.prison.id}` as Key);
  const out: string[] = [];
  if ((s.days[day - 1] ?? 0) & DAY.LOCKDOWN || (s.days[day - 2] ?? 0) & DAY.LOCKDOWN) out.push(t('kiosk.head.lockdown', { prison }));
  if (s.feats[FEAT.quizWins] > 0) out.push(t('kiosk.head.quiz', { prison }));
  if (s.feats[FEAT.actWins] > 0) out.push(t('kiosk.head.talent', { prison }));
  // (Two of the world's, the day's own: the same all day.)
  const a = Math.floor(dayRoll(s.salt, day, 11) * WORLD);
  const b = (a + 1 + Math.floor(dayRoll(s.salt, day, 12) * (WORLD - 1))) % WORLD;
  out.push(t(`kiosk.head.world.${a}` as Key), t(`kiosk.head.world.${b}` as Key));
  return out.slice(0, 4);
}
const WORLD = 8;

/** The card's view now (null: not at the kiosk and logged out). */
export function kioskNow(sim: Sim): KioskView | null {
  const s = sim.state;
  if (!kioskOf(sim)) return null;
  const on = loggedIn(s);
  const held = result && playNow() - result.at < RESULT_MS ? result : null;
  // (Logged out, on its own tile only: not beside it, studying at the shelf next door.)
  const k = kioskOf(sim)!;
  if (!on && !(atKiosk(sim) && Math.floor(s.player.x / UNIT) === k.x && Math.floor(s.player.z / UNIT) === k.z)) return null;
  const v = view;
  v.phase = on ? 'on' : 'off';
  v.cash = s.cash;
  v.closed = kioskOpen(sim) ? '' : t(s.lockdown ? 'refused.gamesLockdown' : phoneOpen(sim) ? 'refused.kioskDark' : 'refused.kioskClosed');
  v.loginWhy = why(kioskRefusal(sim, KIOSK.LOGIN));
  v.spent = spent;
  v.left = on ? Math.max(0, (s.kiosk - s.step) / KIOSK_BLOCK) : 0;
  v.secs = on ? Math.max(0, s.kiosk - s.step) / 20 : 0;
  if (!on) return v;
  const day = prisonDay(s.step);
  // Mail: a letter, what's coming, the wall.
  v.mailWhy = why(kioskRefusal(sim, KIOSK.WRITE));
  const moneyDue = !s.phoned[0] || day - s.phoned[0] >= MONEY_EVERY;
  v.mailNote = moneyDue ? t('kiosk.write.money') : t('kiosk.write.reply', { n: s.phoned[0] + MONEY_EVERY });
  v.coming = [];
  if (s.phoned[1] > 0) v.coming.push(t('phone.mail', { n: s.phoned[1] }));
  if (s.post[1]) v.coming.push(t('kiosk.replyComing'));
  if (s.post[3]) v.coming.push(t('kiosk.orderComing', { item: itemName(s.post[3]) }));
  v.photos = s.photos.map((d) => t(`kiosk.photo.${PHOTOS[d]}` as Key));
  // Shop: each row's own refusal; one shared by every row (an order coming, today's placed) said once.
  const shared = kioskRefusal(sim, KIOSK.ORDER, 0);
  const once = shared === 'orderComing' || shared === 'shopToday';
  v.ordered = shared === 'orderComing' ? t('kiosk.orderComing', { item: itemName(s.post[3]) }) : shared === 'shopToday' ? t('refused.shopToday') : '';
  v.shop = SHOP.map((id, k) => {
    const r = once ? shared : kioskRefusal(sim, KIOSK.ORDER, k);
    return { k, name: itemName(itemNumber(id)), price: t('phone.price', { n: shopPrice(id) }), why: once ? ' ' : why(r) };
  });
  // News: the days ahead, the next delivery and visiting day (where the deck deals them), headlines.
  v.days = [];
  for (let d = 1; d <= NEWS_DAYS; d++) v.days.push(newsDay(sim, planOf(sim, day + d)));
  v.next = [];
  const deck = DAY_BOOKS[sim.prison.id]?.deck ?? [];
  for (const ev of ['delivery', 'visiting'] as const) {
    if (!deck.includes(ev)) continue;
    let found = 0;
    for (let d = 1; d <= NEWS_AHEAD && !found; d++) if (planOf(sim, day + d).event === ev) found = day + d;
    v.next.push(found ? t(`kiosk.news.next.${ev}` as Key, { day: dayName(sim, found, true), what: ev === 'delivery' ? vehicleName(sim) : '' }) : t(`kiosk.news.none.${ev}` as Key, { n: NEWS_AHEAD }));
  }
  v.headlines = headlines(sim);
  // Courses.
  const c = s.course;
  v.said = -1;
  if (held && !c.length) {
    v.course = 'result';
    v.result = held.text;
    v.good = held.good;
  } else if (c.length) {
    const q = courseQuestion(sim)!;
    const words = questionText(sim, q);
    v.course = c[5] ? 'reveal' : 'ask';
    v.q = c[1];
    v.right = c[2];
    v.question = words.text;
    v.choices = words.choices;
    v.answer = q.answer;
    v.said = c[4];
    // (While asked, the bar is the question's clock.)
    if (!c[5]) {
      v.left = Math.max(0, 1 - (s.step - c[3]) / COURSE_STEPS);
      v.secs = Math.max(0, c[3] + COURSE_STEPS - s.step) / 20;
    }
  } else {
    v.course = 'offer';
    v.courseWhy = why(kioskRefusal(sim, KIOSK.COURSE));
  }
  return v;
}

/** In a course, 1–4 answer (taken: true, so the hotbar doesn't have them). */
export function kioskKey(code: string): boolean {
  const g = play.game;
  if (!g || g.paused || g.replay || !g.rec.sim.state.course.length) return false;
  const d = /^(?:Digit|Numpad)([1-4])$/.exec(code);
  if (d) {
    kioskCard.choose(Number(d[1]) - 1);
    return true;
  }
  return /^(?:Digit|Numpad)[5-6]$/.test(code);
}

/** What the kiosk does on screen: toasts, sounds, a course's last word. */
export function announceKiosk(e: Extract<SimEvent, { type: 'kiosk' }>) {
  const end = (text: string, good: boolean) => (result = { text, good, at: playNow() });
  switch (e.what) {
    case 'login':
      spent = 1;
      sound.keys();
      coachOnce('kiosk', 'hint.kiosk');
      return;
    case 'paid':
      spent++;
      return;
    case 'logout':
      sound.blip();
      if (e.why === 'broke') return banner.toast(t('toast.kiosk.broke'), 'bad', 3200);
      if (e.why === 'closed') return itemsUI.toast(t('toast.kiosk.closed'));
      if (e.why === 'left') return itemsUI.toast(t('toast.kiosk.left'));
      return;
    case 'wrote':
      sound.keys();
      // (A money order with it has its own banner: phone.ts askMoney.)
      return itemsUI.toast(t('toast.kiosk.wrote'));
    case 'ordered':
      sound.coin();
      return itemsUI.toast(t('toast.kiosk.ordered', { item: itemName(e.item ?? 0) }));
    case 'goods':
      sound.pickup();
      return banner.toast(t('toast.kiosk.goods', { item: itemName(e.item ?? 0) }), 'good', 3600);
    case 'goodsWait':
      return banner.toast(t('toast.kiosk.goodsWait', { item: itemName(e.item ?? 0) }), 'bad', 3600);
    case 'photo':
      sound.chime();
      return banner.toast(t('toast.kiosk.photo', { what: t(`kiosk.photo.${PHOTOS[e.n ?? 0]}` as Key) }), 'good', 4200);
    case 'course':
      sound.keys();
      return;
    case 'question':
      sound.blip();
      return;
    case 'answer':
      if (e.right) sound.chime();
      else sound.sting();
      buzz(e.right ? 'attended' : 'missed');
      return;
    case 'timeUp':
      sound.sting();
      return;
    case 'passed':
      sound.chime();
      {
        const said = t(e.int === 0 ? 'kiosk.course.passedTop' : 'kiosk.course.passed', { n: e.n ?? 0, of: COURSE_QUESTIONS, m: e.int ?? COURSE_INT });
        end(said, true);
        return banner.toast(said, 'good', 3600);
      }
    case 'failed':
      end(t('kiosk.course.failed', { n: e.n ?? 0, of: COURSE_QUESTIONS, need: COURSE_PASS }), false);
      return;
    case 'quit':
      return;
    case 'hidden':
      sound.pickup();
      return itemsUI.toast(t('toast.kiosk.hidden', { item: itemName(e.item ?? 0) }));
    case 'unhidden':
      sound.pickup();
      return itemsUI.toast(t('toast.kiosk.unhidden', { item: itemName(e.item ?? 0) }));
  }
}
