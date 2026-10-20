/**
 * Inmates and the player (GDD §10.3–10.4): talking, opinion, trades and gifts, favors,
 * followers and the foes they go after, and grudges that turn into ambushes.
 */
import { twist } from './twists';
import { RAT } from './rats';
import { itemDef, itemNumber } from '../../content/items';
import { ROUTINE } from '../../content/routine';
import { lineOfSight } from '../ai/sight';
import { ORDER, TALK } from '../command';
import type { SimContext } from '../context';
import { randomInt } from '../rng';
import type { Refusal } from '../state';
import { AMBUSH_ODDS, AMBUSH_RANGE, ANGRY_STEPS, BUY_OPINION, CHASE_HEAT, FAVOR_OFFERS, FAVOR_OPINION, FAVORS_TAKEN, FOLLOW_GAP, GUARD_RANGE, MAX_FOLLOWERS, OPINION_HIGH, OPINION_LOW, TALK_REACH, TIP_OPINION, UNIT } from '../tuning';
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
import { bribe, canChat } from './ways';
import { fixerOf, PHONE } from './smuggling';
import { PHONE_OPINION, PHONE_PRICE } from '../../content/smuggling';
import { endBout, reroll, settleDice, startBout, startDice, stopPick } from './games';
import { crewOrder, crewTargets, dropCrew, nightOf, stopAmbush } from './crew';
import { callLiar, endCheat, playCards, startCheat } from './cards';
import { hoopsPartner, startShootout } from './hoops';
import { checkersOp, elderOf, getUp, moveOn } from './checkers';
import { HOOPS_GAP } from '../../content/games';
import { SHOP_SLOTS } from '../../content/loot';
import { buyStaple, sell } from './pantry';

/** A blow of the player's this recent (steps) knocked the Cheat partner out: their own doing, the game folded. */
const CHEAT_BLOW_STEPS = 40;

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
  stopPick(sim);
  closeBox(sim);
  // (P22: from one talk to another, the last one ends first: dice on the table stand, a bout is broken off.)
  if (s.talk >= 0 && s.talk !== who) endTalk(sim);
  if (s.talk !== who) {
    s.talk = who;
    sim.events.push({ type: 'talk', who });
  }
}

/** Whether the player can go on talking to someone (Cast id): an inmate up and calm, a guard who'd talk (P15); close, nothing between. */
function talkable(sim: SimContext, who: number): boolean {
  const s = sim.state;
  const n = s.inmates.length;
  const m = who < n ? s.inmates[who] : null;
  if (who >= n ? !canChat(sim, who - n) : !m || m.ko > 0 || m.angry > 0) return false;
  if (sim.away || s.layer !== LAYER.GROUND) return false;
  const p = s.player;
  const b = m ? m.body : s.guards[who - n].body;
  return Math.max(Math.abs(b.x - p.x), Math.abs(b.z - p.z)) <= TALK_REACH + UNIT / 4 && lineOfSight(sim.world, p.x, p.z, b.x, b.z);
}

export function keepTalk(sim: SimContext) {
  if (sim.state.talk >= 0 && !talkable(sim, sim.state.talk)) endTalk(sim);
}

export function endTalk(sim: SimContext) {
  const s = sim.state;
  if (s.talk < 0) return;
  // (P22: the dice still on the table, the player stands on them; a bout is broken off.)
  settleDice(sim);
  endBout(sim, 'off');
  // (P27: up and away from a hand of Cheat folds it, unless it's the sirens or a knockout that ended it; up from the old-timer's board, which stays set up.)
  if (s.cheat) {
    // (The inmate knocked out by someone else, not by the player's own blow a moment ago: off, the stake back.)
    const m = s.inmates[s.cheat.who];
    const theirs = !!m && m.ko > 0 && s.step - s.swingAt > CHEAT_BLOW_STEPS;
    endCheat(sim, sim.away || s.lockdown || theirs ? 'off' : 'folded');
  }
  getUp(sim);
  s.talk = -1;
  sim.events.push({ type: 'talk', who: -1 });
}

/** Talking to a guard (P15): the guard's index, -1 when it's an inmate or nobody. */
export const guardTalking = (s: { talk: number; inmates: readonly unknown[] }) => (s.talk >= s.inmates.length ? s.talk - s.inmates.length : -1);

/** Opinion of the player goes up or down (0–100). */
export function changeOpinion(sim: SimContext, who: number, by: number) {
  const m = sim.state.inmates[who];
  if (!m || !by) return;
  const was = m.opinion;
  m.opinion = Math.max(0, Math.min(100, m.opinion + by));
  if (m.opinion !== was) sim.events.push({ type: 'opinion', who, by: m.opinion - was });
}

/** What the player asks of the inmate they're talking to (OP.TALK; c: P27's MOVE, the square to). */
export function talkOp(sim: SimContext, a: number, b: number, c = 0) {
  const s = sim.state;
  const it = s.items;
  const who = s.talk;
  if (who < 0) return;
  // A guard (P15): a bribe is all there is to ask; offered the very step the player is wanted, it's refused.
  if (who >= s.inmates.length && a === TALK.BRIBE && (s.heat >= CHASE_HEAT || s.lockdown)) return refuse(sim, 'tooHot');
  if (!talkable(sim, who)) return;
  if (who >= s.inmates.length) {
    if (a === TALK.BRIBE) bribe(sim, who - s.inmates.length, b);
    return;
  }
  const m = s.inmates[who];
  const free = it.inv.slice(0, HOTBAR).indexOf(0);
  it.rev++;
  switch (a) {
    case TALK.BUY: {
      // (P28: past the shop's own slots, the staples every merchant sells.)
      if (b >= SHOP_SLOTS) return buyStaple(sim, who, b - SHOP_SLOTS);
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
    case TALK.SELL:
      sell(sim, who, b);
      return;
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
      // (P23: not someone in the middle of a brawl with the crew.)
      if (s.crew.some((e) => e[1] === ORDER.BRAWL && e[3] === who)) return refuse(sim, 'crewBusy');
      // (P26: Lone Wolf, nobody signs up.)
      if (twist(s, 'loneWolf')) return refuse(sim, 'loneWolf');
      if (m.opinion < OPINION_HIGH) return refuse(sim, 'opinion');
      if (s.followers.length >= MAX_FOLLOWERS) return refuse(sim, 'followers');
      s.followers.push(who);
      sim.events.push({ type: 'recruit', who, on: true });
      return;
    case TALK.DISMISS:
      dismiss(sim, who);
      return;
    case TALK.PHONE: {
      // A burner phone (P21), from the fixer only, in the merchants' hours, to a friend; one at a time.
      if (who !== fixerOf(sim)) return;
      if (!sim.fixerOpen) return refuse(sim, 'closed');
      if (m.opinion < PHONE_OPINION) return refuse(sim, 'opinion');
      if (it.inv.slice(0, HOTBAR).some((v) => itemOf(v) === PHONE)) return refuse(sim, 'havePhone');
      if (s.cash < PHONE_PRICE) return refuse(sim, 'cash');
      if (free < 0) return refuse(sim, 'room');
      it.inv[free] = slot(PHONE);
      s.cash -= PHONE_PRICE;
      sim.events.push({ type: 'bought', who, item: PHONE, price: PHONE_PRICE }, { type: 'cash', n: -PHONE_PRICE, why: 'buy' });
      changeOpinion(sim, who, BUY_OPINION);
      return;
    }
    // Side games (P22): dice for a stake, a second throw (or standing), an arm-wrestle.
    case TALK.DICE:
      startDice(sim, who, b);
      return;
    case TALK.REROLL:
      if (s.dice[0] === who) reroll(sim, b & 3);
      return;
    case TALK.WRESTLE:
      startBout(sim, who);
      return;
    // P27: a game of Cheat for a stake, cards laid, a call; a shootout at the hoop; the old-timer's board and a step on it.
    case TALK.CHEAT:
      startCheat(sim, who, b);
      return;
    case TALK.PLAY:
      if (s.cheat?.who === who) playCards(sim, b);
      return;
    case TALK.LIAR:
      if (s.cheat?.who === who) callLiar(sim);
      return;
    case TALK.HOOPS:
      startShootout(sim, who);
      return;
    case TALK.CHECKERS:
      if (who === elderOf(sim)) checkersOp(sim, b);
      return;
    case TALK.MOVE:
      if (who === elderOf(sim)) moveOn(sim, b, c);
      return;
    // The crew (P23): an order to a follower, in his line of work.
    case TALK.CREW:
      crewOrder(sim, who, b);
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
  dropCrew(sim, who);
  s.followers.splice(k, 1);
  sim.events.push({ type: 'recruit', who, on: false });
}

/** Every follower leaves (the player caught or floored). */
export function dismissAll(sim: SimContext) {
  for (const id of [...sim.state.followers]) dismiss(sim, id);
}

/** Lights Out: followers go to their beds, but for those staying on through tonight (P23). */
export function dismissForNight(sim: SimContext) {
  for (const id of [...sim.state.followers]) {
    if (!nightOf(sim.state, id)) dismiss(sim, id);
    else sim.events.push({ type: 'crew', what: 'nightOut', who: id });
  }
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
    // (Alone on the block, the Training Block's one inmate: nobody else to rob or beat up.)
    if ((kind === FAVOR.RETRIEVE || kind === FAVOR.BEATDOWN) && n < 2) continue;
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

/** Where grudges are settled: at meals and in the showers; in a hostile prison, free time and the yard too. */
const GRUDGE_BLOCKS: readonly string[] = ['breakfast', 'dinner', 'showers'];
const HOSTILE_BLOCKS: readonly string[] = [...GRUDGE_BLOCKS, 'freeTime', 'exercise', 'eveningFreeTime'];

/**
 * An inmate with a grudge (opinion 25 or less) may jump the player at a meal or in the
 * showers (GDD §10.3): close by, in the same room, now and then. In a lawless prison (San
 * Pancho, GDD §4.4) anywhere they meet in free time or the yard.
 */
export function grudges(sim: SimContext) {
  const s = sim.state;
  const id = ROUTINE[s.routine].id;
  if (!(hostile(sim) ? HOSTILE_BLOCKS : GRUDGE_BLOCKS).includes(id) || sim.away || s.layer !== LAYER.GROUND || s.lockdown || s.stowed) return;
  const p = s.player;
  const zone = sim.playerZone;
  // At a block with its own rooms, in them; in free time, wherever the two meet.
  const zones = ROUTINE[s.routine].zones;
  if (zones.length ? !zones.includes(zone) : zone === 'playerCell') return;
  s.inmates.forEach((m, who) => {
    if (m.opinion > OPINION_LOW || m.angry > 0 || m.ko > 0 || s.followers.includes(who)) return;
    if (dist2(m.body, p) > AMBUSH_RANGE * AMBUSH_RANGE || inmateZone(sim.world, m) !== zone) return;
    if (!lineOfSight(sim.world, m.body.x, m.body.z, p.x, p.z) || randomInt(s, AMBUSH_ODDS) !== 0) return;
    // (P23: a muscle watching the player's back close by: they think better of it.)
    if (stopAmbush(sim, who)) return;
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
  so.follow.length = so.gap.length = so.work.length = so.doing.length = sim.scratch.allyFoe.length = n;
  so.follow.fill(null);
  so.gap.fill(0);
  so.doing.fill(0);
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
  // Rats running loose (P20): the inmates near one flee it.
  so.scare.length = 0;
  for (const r of s.rats) if (r.mode === RAT.LOOSE) so.scare.push(r);
  // The crew's orders (P23) send some where the player isn't: a post, the drop, the shaft, a brawl.
  const placed = s.followers.length ? crewTargets(sim, so) : 0;
  const about = s.layer === LAYER.GROUND && !sim.away;
  if (!about) return so;
  // A shootout's partner (P27) keeps near the player at the court.
  const partner = hoopsPartner(s);
  if (partner >= 0 && !s.followers.includes(partner) && s.inmates[partner]?.ko === 0) {
    so.follow[partner] = s.player;
    so.gap[partner] = HOOPS_GAP;
  }
  s.followers.forEach((id, k) => {
    const m = s.inmates[id];
    if (!m || m.ko > 0 || placed & (1 << k)) return;
    const foe = foeOf(sim, m);
    sim.scratch.allyFoe[id] = foe;
    so.follow[id] = foe >= 0 ? personOf(s, foe)!.body : s.player;
    so.gap[id] = foe >= 0 ? STAND_OFF : FOLLOW_GAP;
  });
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

/** A lawless interior (San Pancho, GDD §4.4), or a Bad Blood Daily (P26): grudges from day 1, settled in free time and the yard too. */
export const hostile = (sim: SimContext): boolean => !!sim.world.def.rules?.hostile || twist(sim.state, 'badBlood');
