/**
 * Merchants and money (2.36's polish pass), in all five prisons, by real commands:
 * - **every merchant:** an inmate of the prison with 2 to 4 things of the merchant table on day 1,
 *   walked up to in free time; each thing bought at the price the talk panel shows (priceOf, the one
 *   function both use), the cash and the event saying the same, +2 opinion; the staples at the same
 *   price, no opinion; a vegetable sold at what the panel says (saleOf), four sales a day;
 * - **when they deal:** free time only (not the Work Period, not a lockdown, not a Closed Shop
 *   Daily), never at 25 or under, and at 26 again;
 * - **stock:** sold out, the badge over them still says open (the staples, the buying), and 08:00
 *   brings 2 or 3 new things;
 * - **prices:** half at 100, never under $1;
 * - **a day's money:** what a prison's jobs pay, the change lying about each morning, the favors
 *   on offer and what a merchant's stock costs, over three days of the model prisoner.
 */
import { itemDef } from '../src/content/items';
import { LOOT, SHOP_SLOTS } from '../src/content/loot';
import { SALES_A_DAY, STAPLES } from '../src/content/long';
import { PRISONS } from '../src/content/prisons';
import { JOBS } from '../src/content/jobs';
import { ROUTINE } from '../src/content/routine';
import { badgeOf } from '../src/play/badges';
import { OP, TALK } from '../src/sim/command';
import { type SimEvent } from '../src/sim/Sim';
import { FAVOR_STATE, priceOf } from '../src/sim/systems/economy';
import { HOTBAR, itemOf, slot } from '../src/sim/systems/items';
import { saleOf, stapleSlot } from '../src/sim/systems/pantry';
import { BUY_OPINION, OPINION_LOW, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot, DIR, n } from './bots';

const MIN = STEPS_PER_MINUTE;
const tileOfBody = (b: { x: number; z: number }) => Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);
const dist = (a: number, b: number) => Math.abs((a % MAP_W) - (b % MAP_W)) + Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W));
const dirTo = (from: number, to: number) => {
  const dx = (to % MAP_W) - (from % MAP_W);
  const dz = Math.floor(to / MAP_W) - Math.floor(from / MAP_W);
  return dx > 0 ? DIR.EAST : dx < 0 ? DIR.WEST : dz > 0 ? DIR.SOUTH : DIR.NORTH;
};
const besides = (bot: Bot, t: number) =>
  [1, -1, MAP_W, -MAP_W].map((d) => t + d).filter((k) => !bot.sim.world.blocked(k % MAP_W, Math.floor(k / MAP_W)));

/** Walked up to an inmate, followed if they move, until talking. */
function meet(bot: Bot, who: number): boolean {
  const s = bot.st;
  const m = s.inmates[who];
  for (let k = 0; k < 40 && s.talk !== who; k++) {
    const here = tileOfBody(s.player);
    const sides = besides(bot, tileOfBody(m.body)).sort((a, b) => dist(a, here) - dist(b, here));
    if (!sides.length) {
      bot.step();
      continue;
    }
    if (here !== sides[0]) bot.walkTo(sides[0], 300);
    if (tileOfBody(s.player) !== sides[0]) continue;
    bot.face(dirTo(sides[0], tileOfBody(m.body)));
    bot.act();
  }
  return s.talk === who;
}
/** Said across the talk (met again if they walked off), them held still for it; the step's events. */
function say(bot: Bot, who: number, a: number, b = 0): readonly SimEvent[] {
  const m = bot.st.inmates[who];
  for (let k = 0; k < 3; k++) {
    if (bot.st.talk !== who) meet(bot, who);
    m.path = [];
    m.goal = -1;
    m.wait = 1_000_000;
    bot.op(OP.TALK, a, b);
    if (!bot.sim.events.some((e) => e.type === 'talk' && e.who < 0)) break;
  }
  return bot.sim.events;
}
const why = (ev: readonly SimEvent[]) => (ev.find((e) => e.type === 'refused') as { why: string } | undefined)?.why ?? '';

const table = new Set(LOOT.merchant.items.map(([id]) => n(id)));
const lines: string[] = [];
for (const prison of PRISONS) {
  const bot = new Bot(prison, 3);
  const { sim, st } = bot;
  bot.routineUntil(1, 10 * 60 + 2);
  const merchants = prison.merchants.map((cell) => st.inmates.findIndex((m) => m.cell === cell));
  check(merchants.length >= 3 && merchants.every((k) => k >= 0), `${prison.id}: ${merchants.length} merchants, each an inmate`);
  st.cash = 1000;
  // (A favor's "!" outranks the shop's badge: none on offer here. A lawless prison's merchant may
  // start with a grudge, and won't deal until won over: said, then won over for the test.)
  st.favors = [];
  bot.step();
  const grudges = merchants.filter((k) => st.inmates[k].opinion <= OPINION_LOW);
  for (const k of grudges) {
    check(
      meet(bot, k) && why(say(bot, k, TALK.BUY, stapleSlot(0))) === 'grudge',
      `${prison.id}: merchant ${k} starts with a grudge: no deal`,
    );
    check(badgeOf(sim, k) !== 'shop', `${prison.id}: and no shop's badge over them`);
    st.inmates[k].opinion = 50;
  }
  if (grudges.length) lines.push(`${prison.id}: ${grudges.map((k) => `merchant ${k} starts with a grudge`).join(', ')}`);
  let bought = 0;
  let spent = 0;
  for (const who of merchants) {
    const shop = st.shops[sim.merchantOf(who)];
    const stock = shop.filter((v) => v);
    check(
      shop.length === SHOP_SLOTS && stock.length >= 2 && stock.length <= 4 && stock.every((v) => table.has(itemOf(v))),
      `${prison.id}: merchant ${who} opens with 2 to 4 things of the merchant table (${stock.length})`,
    );
    check(badgeOf(sim, who) === 'shop', `${prison.id}: the badge over merchant ${who} says open`);
    check(meet(bot, who), `${prison.id}: walked up to merchant ${who}`);
    for (let k = 0; k < SHOP_SLOTS; k++) {
      const v = shop[k];
      if (!v) continue;
      st.items.inv.fill(0, 0, HOTBAR);
      const m = st.inmates[who];
      const op = m.opinion;
      const shown = priceOf(itemDef(itemOf(v)).value, op);
      const cash = st.cash;
      const ev = say(bot, who, TALK.BUY, k);
      const e = ev.find((x) => x.type === 'bought') as { price: number; item: number } | undefined;
      check(
        !!e && e.price === shown && st.cash === cash - shown && e.item === itemOf(v) && !shop[k] && st.items.inv.includes(v),
        `${prison.id}: ${itemDef(itemOf(v)).id} bought for the $${shown} shown`,
      );
      check(m.opinion === Math.min(100, op + BUY_OPINION), `${prison.id}: a purchase: +${BUY_OPINION} opinion`);
      bought++;
      spent += shown;
    }
    // The staples: always there, at the price shown, no opinion for them.
    STAPLES.forEach((id, k) => {
      st.items.inv.fill(0, 0, HOTBAR);
      const m = st.inmates[who];
      const op = m.opinion;
      const shown = priceOf(itemDef(n(id)).value, op);
      const cash = st.cash;
      say(bot, who, TALK.BUY, stapleSlot(k));
      check(st.cash === cash - shown && st.items.inv.includes(slot(n(id))) && m.opinion === op, `${prison.id}: ${id} for $${shown}`);
    });
    // Sold out, still open: the badge, and a new stock in the morning.
    check(shop.every((v) => !v) && badgeOf(sim, who) === 'shop', `${prison.id}: merchant ${who} sold out, the badge still says open`);
  }
  // A vegetable sold at what the panel says, four a day.
  const seller = merchants[0];
  const veg = n('vegetable');
  let sold = 0;
  for (let k = 0; k < SALES_A_DAY + 1; k++) {
    st.items.inv.fill(0, 0, HOTBAR);
    st.items.inv[0] = slot(veg);
    const cash = st.cash;
    const ev = say(bot, seller, TALK.SELL, 0);
    if (st.cash === cash + saleOf(veg)) sold++;
    else check(k === SALES_A_DAY && why(ev) === 'soldEnough', `${prison.id}: a ${k + 1}th sale refused: ${why(ev)}`);
  }
  check(sold === SALES_A_DAY, `${prison.id}: ${SALES_A_DAY} vegetables sold at $${saleOf(veg)} each`);
  // Never to someone they despise; at 26 again. Half price at 100, never under $1.
  const m0 = st.inmates[seller];
  st.items.inv.fill(0, 0, HOTBAR);
  m0.opinion = OPINION_LOW;
  check(why(say(bot, seller, TALK.BUY, stapleSlot(0))) === 'grudge', `${prison.id}: at ${OPINION_LOW}, no deal`);
  m0.opinion = OPINION_LOW + 1;
  const c26 = st.cash;
  say(bot, seller, TALK.BUY, stapleSlot(0));
  check(st.cash < c26, `${prison.id}: at ${OPINION_LOW + 1}, a deal again`);
  check(
    priceOf(40, 100) === 20 && priceOf(15, 100) === 8 && priceOf(1, 100) === 1 && priceOf(40, 50) === 40,
    'prices: half at 100 (rounded), never under $1, full at 50',
  );
  bot.op(OP.CLOSE);
  // The Work Period: closed, the badge off.
  bot.routineUntil(1, 12 * 60 + 2);
  check(badgeOf(sim, seller) !== 'shop', `${prison.id}: at 12:00 the badge is off`);
  check(why(say(bot, seller, TALK.BUY, stapleSlot(0))) === 'closed', `${prison.id}: at 12:00, shut`);
  bot.op(OP.CLOSE);
  // A lockdown shuts them too.
  bot.routineUntil(1, 18 * 60 + 2);
  st.lockdown = true;
  check(!sim.shopsOpen, `${prison.id}: in a lockdown, shut`);
  st.lockdown = false;
  check(sim.shopsOpen, `${prison.id}: evening free time, open again`);
  // 08:00: new stock, 2 or 3 things into each emptied shop.
  bot.routineUntil(2, 8 * 60 + 1);
  for (const who of merchants) {
    const k = st.shops[sim.merchantOf(who)].filter((v) => v).length;
    check(k >= 2 && k <= 3, `${prison.id}: merchant ${who} restocked at 08:00 with ${k}`);
  }
  lines.push(`${prison.id}: ${merchants.length} merchants, ${bought} things bought for $${spent} as shown`);
}

// A Closed Shop Daily: they don't open, the fixer does.
{
  Bot.mods = ['closedShop'];
  const bot = new Bot(PRISONS[0], 3);
  Bot.mods = [];
  bot.routineUntil(1, 10 * 60 + 2);
  check(!bot.sim.shopsOpen && bot.sim.fixerOpen, 'a Closed Shop Daily: merchants shut, the fixer open');
  check(
    badgeOf(
      bot.sim,
      bot.st.inmates.findIndex((m) => m.cell === PRISONS[0].merchants[0]),
    ) !== 'shop',
    'and no badge',
  );
}

// A day's money, three days of the model prisoner: the change lying about each morning, the favors
// on offer, what each prison's jobs pay, what a merchant's stock costs.
for (const prison of PRISONS) {
  const bot = new Bot(prison, 7);
  const { st } = bot;
  const change: number[] = [];
  const favors: number[] = [];
  for (let day = 1; day <= 3; day++) {
    bot.routineUntil(day, 8 * 60 + 1);
    change.push(Object.values(st.coins).reduce((a, b) => a + (b ?? 0), 0));
    favors.push(st.favors.filter((f) => f.state === FAVOR_STATE.OFFERED).reduce((a, f) => a + f.reward, 0));
  }
  const wages = prison.jobs.map((j) => JOBS[j.id].wage);
  const prices = LOOT.merchant.items.map(([id]) => itemDef(n(id)).value);
  check(
    Math.max(...prices) <= 2 * Math.min(...wages),
    `${prison.id}: the dearest thing a merchant sells within two days of the poorest wage`,
  );
  lines.push(
    `${prison.id}: change about each morning $${change.join('/$')}, favors on offer $${favors.join('/$')}, wages $${Math.min(...wages)}–$${Math.max(...wages)}, merchant goods $${Math.min(...prices)}–$${Math.max(...prices)}`,
  );
}
check(ROUTINE.some((r) => r.id === 'freeTime') && MIN > 0, 'the routine has free time');
for (const line of lines) console.log(line);
