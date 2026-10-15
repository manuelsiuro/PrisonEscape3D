/**
 * Inmates and the player (GDD §10.3–10.4): talking, opinion, trades and gifts, favors,
 * followers and the foes they go after, and grudges that turn into ambushes.
 */
import { itemDef, itemNumber } from '../../content/items';
import { ROUTINE } from '../../content/routine';
import { lineOfSight } from '../ai/sight';
import { TALK } from '../command';
import type { SimContext } from '../context';
import { randomInt } from '../rng';
import type { Refusal } from '../state';
import { AMBUSH_ODDS, AMBUSH_RANGE, ANGRY_STEPS, BUY_OPINION, FAVOR_OFFERS, FAVOR_OPINION, FAVORS_TAKEN, FOLLOW_GAP, GUARD_RANGE, MAX_FOLLOWERS, OPINION_HIGH, OPINION_LOW, TALK_REACH, TIP_OPINION, UNIT } from '../tuning';
import { LAYER, MAP_W } from '../world/World';
import { closeBox } from './actions';
import { dist2, type Fighter, personOf } from './combat';
import { CASH_GIFTS, cashOpinion, type Favor, FAVOR, FAVOR_ITEMS, FAVOR_STATE, giftOpinion, jobRooms, priceOf } from './economy';
import { awake, GUARD } from './guards';
import { DOING, type Inmate, inmateZone, type Social, STAND_OFF } from './inmates';
import { HOTBAR, itemOf, pocketOf, slot, usesOf } from './items';
import { quotaUp } from './jobs';
import { seatSpot } from './rest';
import { clockAt } from './clock';
import { revealTip, tippedToday } from './recipes';
import { stopTraining } from './training';

/** Why a trade, a gift, a favor, a recruit or a job application didn't go through. */
export function refuse(sim: SimContext, why: Refusal) {
  sim.events.push({ type: 'refused', why });
}

/** Walking up to an inmate: their letter if the player carries it (the mail round), else a talk. */
export function approach(sim: SimContext, who: number) {
  const s = sim.state;
  const it = s.items;
  const letter = itemNumber('letter');
  const k = it.inv.slice(0, HOTBAR).findIndex((v) => itemOf(v) === letter && usesOf(v) - 1 === who);
  if (k >= 0 && sim.onDuty && s.mail.includes(who)) {
    it.inv[k] = 0;
    it.rev++;
    s.mail.splice(s.mail.indexOf(who), 1);
    sim.events.push({ type: 'delivered', who });
    quotaUp(sim);
    return;
  }
  stopTraining(sim);
  closeBox(sim);
  if (s.talk !== who) {
    s.talk = who;
    sim.events.push({ type: 'talk', who });
  }
}

/** Whether the player can go on talking to an inmate: up, calm, close, nothing between. */
function talkable(sim: SimContext, who: number): boolean {
  const s = sim.state;
  const m = s.inmates[who];
  if (!m || m.ko > 0 || m.angry > 0 || sim.away || s.layer !== LAYER.GROUND) return false;
  const p = s.player;
  return Math.max(Math.abs(m.body.x - p.x), Math.abs(m.body.z - p.z)) <= TALK_REACH + UNIT / 4 && lineOfSight(sim.world, p.x, p.z, m.body.x, m.body.z);
}

export function keepTalk(sim: SimContext) {
  if (sim.state.talk >= 0 && !talkable(sim, sim.state.talk)) endTalk(sim);
}

export function endTalk(sim: SimContext) {
  const s = sim.state;
  if (s.talk < 0) return;
  s.talk = -1;
  sim.events.push({ type: 'talk', who: -1 });
}

/** Opinion of the player goes up or down (0–100). */
export function changeOpinion(sim: SimContext, who: number, by: number) {
  const m = sim.state.inmates[who];
  if (!m || !by) return;
  const was = m.opinion;
  m.opinion = Math.max(0, Math.min(100, m.opinion + by));
  if (m.opinion !== was) sim.events.push({ type: 'opinion', who, by: m.opinion - was });
}

/** What the player asks of the inmate they're talking to (OP.TALK). */
export function talkOp(sim: SimContext, a: number, b: number) {
  const s = sim.state;
  const it = s.items;
  const who = s.talk;
  if (who < 0 || !talkable(sim, who)) return;
  const m = s.inmates[who];
  const free = it.inv.slice(0, HOTBAR).indexOf(0);
  it.rev++;
  switch (a) {
    case TALK.BUY: {
      const shop = s.shops[sim.merchantOf(who)];
      const v = shop?.[b];
      if (!v) return;
      if (!sim.shopsOpen) return refuse(sim, 'closed');
      if (m.opinion <= OPINION_LOW) return refuse(sim, 'grudge');
      const item = itemOf(v);
      const price = priceOf(itemDef(item).value, m.opinion);
      if (s.cash < price) return refuse(sim, 'cash');
      if (free < 0) return refuse(sim, 'room');
      shop[b] = 0;
      it.inv[free] = v;
      s.cash -= price;
      sim.events.push({ type: 'bought', who, item, price }, { type: 'cash', n: -price, why: 'buy' });
      changeOpinion(sim, who, BUY_OPINION);
      return;
    }
    case TALK.GIFT: {
      const v = b < HOTBAR ? it.inv[b] : 0;
      if (!v) return;
      const item = itemOf(v);
      if (itemDef(item).value <= 0) return refuse(sim, 'worthless');
      it.inv[b] = 0;
      sim.events.push({ type: 'gift', who, item, cash: 0 });
      changeOpinion(sim, who, giftOpinion(itemDef(item).value));
      return;
    }
    case TALK.GIFT_CASH:
      if (!CASH_GIFTS.includes(b)) return;
      if (s.cash < b) return refuse(sim, 'cash');
      s.cash -= b;
      sim.events.push({ type: 'gift', who, item: 0, cash: b }, { type: 'cash', n: -b, why: 'gift' });
      changeOpinion(sim, who, cashOpinion(b));
      return;
    case TALK.ACCEPT: {
      const f = s.favors.find((x) => x.by === who && x.state === FAVOR_STATE.OFFERED);
      if (!f) return;
      if (s.favors.filter((x) => x.state !== FAVOR_STATE.OFFERED).length >= FAVORS_TAKEN) return refuse(sim, 'favors');
      f.state = FAVOR_STATE.TAKEN;
      // The stolen thing is in the thief's pockets from now on.
      if (f.kind === FAVOR.RETRIEVE) {
        const pockets = it.containers[pocketOf(sim.world, f.target)];
        const k = pockets.indexOf(0);
        pockets[k >= 0 ? k : pockets.length - 1] = slot(f.item);
      }
      sim.events.push({ type: 'favor', who, kind: f.kind, state: 'taken' });
      return;
    }
    case TALK.HAND_IN: {
      const f = s.favors.find((x) => x.by === who && x.state !== FAVOR_STATE.OFFERED);
      if (!f) return;
      if (f.kind === FAVOR.SCAVENGE || f.kind === FAVOR.RETRIEVE) {
        const k = it.inv.slice(0, HOTBAR).findIndex((v) => itemOf(v) === f.item);
        if (k < 0) return refuse(sim, 'missing');
        it.inv[k] = 0;
      } else if (f.state !== FAVOR_STATE.DONE) return refuse(sim, 'notDone');
      s.favors.splice(s.favors.indexOf(f), 1);
      s.cash += f.reward;
      sim.events.push({ type: 'favor', who, kind: f.kind, state: 'paid' }, { type: 'cash', n: f.reward, why: 'favor' });
      s.tally[3] += f.reward;
      changeOpinion(sim, who, FAVOR_OPINION);
      return;
    }
    case TALK.RECRUIT:
      if (s.followers.includes(who)) return;
      if (m.opinion < OPINION_HIGH) return refuse(sim, 'opinion');
      if (s.followers.length >= MAX_FOLLOWERS) return refuse(sim, 'followers');
      s.followers.push(who);
      sim.events.push({ type: 'recruit', who, on: true });
      return;
    case TALK.DISMISS:
      dismiss(sim, who);
      return;
    case TALK.TIP:
      // A recipe they know (P8+): from those who like the player, once a day each.
      if (m.opinion < TIP_OPINION) return refuse(sim, 'tipOpinion');
      if (tippedToday(sim, who)) return refuse(sim, 'tipToday');
      if (!revealTip(sim, who)) return refuse(sim, 'noTips');
      while (s.tipDay.length <= who) s.tipDay.push(0);
      s.tipDay[who] = clockAt(s.step).day;
      return;
  }
}

export function dismiss(sim: SimContext, who: number) {
  const s = sim.state;
  const k = s.followers.indexOf(who);
  if (k < 0) return;
  s.followers.splice(k, 1);
  sim.events.push({ type: 'recruit', who, on: false });
}

/** Every follower leaves (Lights Out, the player caught or floored). */
export function dismissAll(sim: SimContext) {
  for (const id of [...sim.state.followers]) dismiss(sim, id);
}

/**
 * 08:00 (and day 1): offers not taken up lapse, and inmates with nothing asked yet offer new
 * favors (GDD §10.4), up to FAVOR_OFFERS at a time: $20–50 each.
 */
export function offerFavors(sim: SimContext) {
  const s = sim.state;
  s.favors = s.favors.filter((f) => f.state !== FAVOR_STATE.OFFERED);
  const n = s.inmates.length;
  for (let tries = 0; tries < n * 2 && s.favors.filter((f) => f.state === FAVOR_STATE.OFFERED).length < FAVOR_OFFERS; tries++) {
    const by = randomInt(s, n);
    if (s.favors.some((f) => f.by === by) || s.followers.includes(by)) continue;
    const kind = randomInt(s, 4);
    let target = -1;
    if (kind === FAVOR.RETRIEVE || kind === FAVOR.BEATDOWN) {
      target = randomInt(s, n - 1);
      if (target >= by) target++;
    }
    const item = kind === FAVOR.SCAVENGE || kind === FAVOR.RETRIEVE ? itemNumber(FAVOR_ITEMS[randomInt(s, FAVOR_ITEMS.length)]) : 0;
    s.favors.push({ by, kind, item, target, reward: 20 + randomInt(s, 31), state: FAVOR_STATE.OFFERED });
    sim.events.push({ type: 'favor', who: by, kind, state: 'offered' });
  }
}

/** A favor done (it's handed in next time they talk). */
export function favorDone(sim: SimContext, f: Favor) {
  f.state = FAVOR_STATE.DONE;
  sim.events.push({ type: 'favor', who: f.by, kind: f.kind, state: 'done' });
}

/**
 * An inmate with a grudge (opinion 25 or less) may jump the player at a meal or in the
 * showers (GDD §10.3): close by, in the same room, now and then.
 */
export function grudges(sim: SimContext) {
  const s = sim.state;
  const id = ROUTINE[s.routine].id;
  if ((id !== 'breakfast' && id !== 'dinner' && id !== 'showers') || sim.away || s.layer !== LAYER.GROUND || s.lockdown) return;
  const p = s.player;
  const zone = sim.playerZone;
  if (!ROUTINE[s.routine].zones.includes(zone)) return;
  s.inmates.forEach((m, who) => {
    if (m.opinion > OPINION_LOW || m.angry > 0 || m.ko > 0 || s.followers.includes(who)) return;
    if (dist2(m.body, p) > AMBUSH_RANGE * AMBUSH_RANGE || inmateZone(sim.world, m) !== zone) return;
    if (!lineOfSight(sim.world, m.body.x, m.body.z, p.x, p.z) || randomInt(s, AMBUSH_ODDS) !== 0) return;
    m.angry = ANGRY_STEPS;
    m.doing = DOING.NOTHING;
    m.wait = 0;
    if (s.talk === who) endTalk(sim);
    sim.events.push({ type: 'ambush', who });
  });
}

export function socialNow(sim: SimContext): Social {
  const s = sim.state;
  const so = sim.scratch.social;
  const n = s.inmates.length;
  so.follow.length = so.gap.length = so.work.length = sim.scratch.allyFoe.length = n;
  so.follow.fill(null);
  so.gap.fill(0);
  so.work.fill(-1);
  sim.scratch.allyFoe.fill(-1);
  so.talk = s.talk;
  // The seat's own tile (the player may have sat down from the next one): what sitDown and the view use.
  const sp = s.seat >= 0 ? seatSpot(sim.world, s.seat, s.player) : null;
  so.seat = sp ? sp.z * MAP_W + sp.x : -1;
  const rooms = jobRooms(sim.world);
  s.jobs.forEach((who, j) => {
    if (who >= 0 && who < n) so.work[who] = rooms[j].zone;
  });
  const about = s.layer === LAYER.GROUND && !sim.away;
  if (!about) return so;
  for (const id of s.followers) {
    const m = s.inmates[id];
    if (!m || m.ko > 0) continue;
    const foe = foeOf(sim, m);
    sim.scratch.allyFoe[id] = foe;
    so.follow[id] = foe >= 0 ? personOf(s, foe)!.body : s.player;
    so.gap[id] = foe >= 0 ? STAND_OFF : FOLLOW_GAP;
  }
  return so;
}

/** The nearest one coming for the player that a follower can see: a chasing guard, an angry inmate (-1 none). */
function foeOf(sim: SimContext, m: Inmate): number {
  const s = sim.state;
  let best = -1;
  let bestD = GUARD_RANGE * GUARD_RANGE;
  const consider = (id: number, f: Fighter) => {
    const d = dist2(f.body, m.body);
    if (f.ko > 0 || d > bestD || !lineOfSight(sim.world, m.body.x, m.body.z, f.body.x, f.body.z)) return;
    bestD = d;
    best = id;
  };
  s.inmates.forEach((o, id) => {
    if (o !== m && o.angry > 0 && !s.followers.includes(id)) consider(id, o);
  });
  s.guards.forEach((g, k) => {
    if (g.mode === GUARD.CHASE && awake(g)) consider(s.inmates.length + k, g);
  });
  return best;
}
