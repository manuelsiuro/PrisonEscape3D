/**
 * Smuggling (P21), rule by rule:
 * - the data: the burner phone is contraband and plain to see in hand; the catalogue's items
 *   exist; every prison but the Training Block has a fixer (one of its merchants), a drop area
 *   with somewhere to land, and visitors (a visiting room with seats across a counter or a
 *   table, and its ways out) or Stalag Flucht's Red Cross parcel; visiting day is dealt only
 *   where people visit;
 * - the phone: only the fixer sells it, in the merchants' hours, to a friend, for $60, one at a
 *   time; in hand in a guard's sight it's contraband seen (in the pocket it isn't);
 * - orders: the phone in hand, one at a time, paid on the spot (price and fee);
 * - the drone: tonight with notice enough, else tomorrow night; never in a storm; turned back
 *   by the sirens; exactly when and where `arrival` and `dropTile` say, downwind of the middle;
 *   its buzz sends guards; a guard who sees what it dropped takes it (one bribed doesn't), the
 *   player can pick it up first;
 * - visits: sat at a visiting seat in visiting hours, the visitor comes after VISIT_STEPS with a
 *   gift ($10–20) and the order, once a day; no room: kept for next time; the room's ways out
 *   scan as arches while the hours last (a pouch gets through), and 12:00 scans whoever is
 *   still in the room;
 * - the Red Cross parcel: into the desk at 14:45, unless a thorough search found it contraband;
 * - saves: an order on its way carries on the same; a save from before P21 keeps the card
 *   visiting day took the place of, today and tomorrow; an old run log replays with it.
 */
import { DAY_BOOKS, DAY_EVENTS } from '../src/content/days';
import { itemDef, itemNumber } from '../src/content/items';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { STALAG_FLUCHT } from '../src/content/prisons/stalag-flucht';
import { TRAINING } from '../src/content/prisons/training';
import type { PrisonDef } from '../src/content/prisons/types';
import { CATALOGUE, DRONE_GUARDS, DRONE_NOISE, FEES, GIFT_MAX, GIFT_MIN, ORDER_LEAD, PARCEL_MINUTE, PHONE_OPINION, PHONE_PRICE, VISIT_STEPS, WAY } from '../src/content/smuggling';
import { command, EXT, OP, TALK } from '../src/sim/command';
import { replayLog, RunRecorder } from '../src/sim/runlog';
import { Sim, type SimEvent, type Snapshot } from '../src/sim/Sim';
import { planOf, TODAY } from '../src/sim/systems/calendar';
import { dayMinute, DAY_STEPS, prisonDay } from '../src/sim/systems/clock';
import { HOTBAR, itemOf, slot } from '../src/sim/systems/items';
import { FEAT } from '../src/sim/systems/ledger';
import { landable } from '../src/sim/systems/noise';
import { seatSpot } from '../src/sim/systems/rest';
import { arrival, catalogueItem, droneMinute, dropTile, fixerOf, guestSpot, inRect, orderPrice, PHONE, smugglingOf, visitExits } from '../src/sim/systems/smuggling';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';

const n = (id: string) => itemNumber(id);
const putTile = (b: { x: number; z: number }, t: number) => {
  b.x = (t % MAP_W) * UNIT + UNIT / 2;
  b.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
};
const VISITING = DAY_EVENTS.indexOf('visiting');
const DELIVERY = DAY_EVENTS.indexOf('delivery');
/** A step count at a time: game day (from 1), hour, minute (days start at 08:00). */
const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;

/** A game kept out of trouble (every day quiet and clear unless forced, the heat kept at 0); `blind()` has every guard look the other way. */
function game(def: PrisonDef, seed = 5, calendar: Array<[number, number, number]> = [[0, 0, 0]]) {
  const sim = new Sim(def, seed);
  sim.state.calendar = calendar;
  const seen: SimEvent[] = [];
  const blind = () => {
    for (const g of sim.state.guards) g.bribed = sim.state.step + 1e7;
  };
  const step = (cmd = 0, calm = true) => {
    sim.step(cmd);
    seen.push(...sim.events);
    if (calm) {
      sim.state.heat = 0;
      if (sim.state.lockdown) sim.state.lockdown = false;
    }
  };
  const to = (day: number, hour: number, minute = 0, calm = true) => {
    const target = at(day, hour, minute);
    while (sim.state.step < target) step(0, calm);
  };
  /** The phone in hand (hotbar slot 0), and cash. */
  const phone = (cash = 500) => {
    sim.state.items.inv[0] = slot(PHONE);
    sim.state.items.hand = 0;
    sim.state.cash = cash;
  };
  const order = (k: number, way: number) => step(command(0, OP.EXT, EXT.ORDER, k, way));
  return { sim, seen, step, to, blind, phone, order };
}
const news = (seen: SimEvent[], what: string) => seen.filter((e) => e.type === 'smuggle' && e.what === what) as Array<Extract<SimEvent, { type: 'smuggle' }>>;
const refused = (seen: SimEvent[]) => seen.filter((e) => e.type === 'refused').map((e) => (e as { why: string }).why);

// ------------------------------------------------------------------ the data
{
  const d = itemDef(PHONE);
  check(d.contraband && !!d.obvious && d.from.includes('fixer'), 'the burner phone: contraband, plain to see in hand, from the fixer');
  check(CATALOGUE.every((c) => !!itemNumber(c.item) && c.price > 0), 'the catalogue lists items that exist, at a price');
  check(FEES[WAY.DRONE] === 20 && FEES[WAY.VISITOR] === 10 && PHONE_PRICE === 60 && PHONE_OPINION === 60 && GIFT_MIN === 10 && GIFT_MAX === 20 && VISIT_STEPS === 3 * STEPS_PER_MINUTE && ORDER_LEAD === 60 && DRONE_NOISE === 8 && DRONE_GUARDS === 2 && PARCEL_MINUTE === 405, 'the numbers the words say: drone +$20, visitor +$10, phone $60 at opinion 60, gifts $10–20, 3 minutes, an hour\'s notice, noise 8 sending 2, the parcel at 14:45');
  check(!TRAINING.smuggling, 'the Training Block has no smuggling');
  for (const p of PRISONS) {
    const sim = new Sim(p, 1);
    const sm = p.smuggling!;
    check(!!sm, `${p.id}: smuggling`);
    if (!sm) continue;
    check(p.merchants.includes(sm.fixer) && fixerOf(sim) >= 0, `${p.id}: the fixer (cell ${sm.fixer}) is a merchant`);
    let land = 0;
    for (let z = sm.drop[1]; z <= sm.drop[3]; z++) for (let x = sm.drop[0]; x <= sm.drop[2]; x++) if (landable(sim.world, z * MAP_W + x)) land++;
    check(land >= 20, `${p.id}: the drop area has open ground (${land} tiles)`);
    // One zone throughout (the phone and the gossip name it), the yard or its roll call square.
    const zones = new Set<string>();
    for (let z = sm.drop[1]; z <= sm.drop[3]; z++) for (let x = sm.drop[0]; x <= sm.drop[2]; x++) if (landable(sim.world, z * MAP_W + x)) zones.add(sim.world.zoneAt(x, z));
    check(zones.size === 1 && ['yard', 'rollCall'].includes([...zones][0]), `${p.id}: the drop area is one zone of the yard (${[...zones].join(', ')})`);
    const deck = DAY_BOOKS[p.id].deck;
    check(!!sm.visits === deck.includes('visiting') && !!sm.parcel === !sm.visits, `${p.id}: visiting day dealt where people visit (else a parcel)`);
    if (sm.parcel) check(deck.includes('delivery'), `${p.id}: the parcel comes with a vehicle`);
    if (sm.visits) {
      // Seats across a counter or a table, with a guest's seat opposite.
      const seats = sim.world.props.map((q, i) => ({ q, i })).filter(({ q }) => (q.kind === 'seat' || q.kind === 'chair') && inRect(sm.visits!, q.x, q.z));
      let pairs = 0;
      for (const { q, i } of seats) {
        for (let dx = 0; dx < q.w; dx++) {
          // Standing beside the seat (the side away from what it faces), sat down.
          sim.state.player.x = (q.x + dx) * UNIT + UNIT / 2;
          sim.state.player.z = q.z * UNIT + UNIT / 2;
          if (guestSpot(sim, i) >= 0) pairs++;
        }
      }
      const exits = visitExits(sim.world);
      check(pairs >= 4 && exits.size >= 1, `${p.id}: ${pairs} visiting seats, ${exits.size} arch tiles`);
      console.log(`${p.id}: fixer ${p.names[sm.fixer - 2]}, ${land} drop tiles, ${pairs} visiting seats, ${exits.size} arch tiles`);
    } else console.log(`${p.id}: fixer ${p.names[sm.fixer - 2]}, ${land} drop tiles, the Red Cross parcel`);
  }
}

// ------------------------------------------------------------------ the phone from the fixer
{
  const { sim, seen, step, to } = game(CENTER_PERKS);
  const s = sim.state;
  const fixer = fixerOf(sim);
  const other = s.inmates.findIndex((_, k) => k !== fixer);
  const talkTo = (who: number) => {
    s.talk = who;
    putTile(s.player, Math.floor(s.inmates[who].body.z / UNIT) * MAP_W + Math.floor(s.inmates[who].body.x / UNIT));
  };
  const buy = (who: number) => {
    talkTo(who);
    seen.length = 0;
    step(command(0, OP.TALK, TALK.PHONE));
  };
  to(1, 10, 30);
  s.cash = 200;
  s.inmates[fixer].opinion = 100;
  s.inmates[other].opinion = 100;
  buy(other);
  check(!s.items.inv.some((v) => itemOf(v) === PHONE), 'nobody but the fixer sells a phone');
  s.inmates[fixer].opinion = PHONE_OPINION - 1;
  buy(fixer);
  check(refused(seen).includes('opinion'), 'the fixer sells only to a friend (opinion 60)');
  s.inmates[fixer].opinion = PHONE_OPINION;
  s.cash = PHONE_PRICE - 1;
  buy(fixer);
  check(refused(seen).includes('cash'), '$60, or no phone');
  s.cash = 200;
  for (let k = 0; k < HOTBAR; k++) s.items.inv[k] = slot(n('sock'));
  buy(fixer);
  check(refused(seen).includes('room'), 'a full hotbar: no room');
  for (let k = 0; k < HOTBAR; k++) s.items.inv[k] = 0;
  buy(fixer);
  check(s.items.inv.some((v) => itemOf(v) === PHONE) && s.cash === 200 - PHONE_PRICE && s.feats[FEAT.phones] === 1, 'bought: the phone in the hotbar, $60 paid');
  buy(fixer);
  check(refused(seen).includes('havePhone') && s.cash === 200 - PHONE_PRICE, 'one phone at a time');
  // Out of the merchants' hours: closed.
  to(1, 12, 30);
  s.items.inv.fill(0, 0, HOTBAR);
  buy(fixer);
  check(refused(seen).includes('closed'), 'the fixer deals in free time only');
  console.log(`phone: the fixer is ${sim.prison.names[s.inmates[fixer].cell - 2]}; $${PHONE_PRICE} at opinion ${PHONE_OPINION}`);
}

// ------------------------------------------------------------------ plain to see in hand
{
  const { sim, seen, step, to } = game(CENTER_PERKS);
  const s = sim.state;
  to(1, 10, 30);
  const g = s.guards[0];
  // The player two tiles in front of a guard.
  const gt = Math.floor(g.body.z / UNIT) * MAP_W + Math.floor(g.body.x / UNIT);
  const look = (inHand: boolean) => {
    s.items.inv[0] = slot(PHONE);
    s.items.inv[1] = 0;
    s.items.hand = inHand ? 0 : 1;
    g.wait = 100;
    g.body.moving = false;
    g.body.facing = 1;
    putTile(s.player, gt + 2);
    seen.length = 0;
    s.spotted = 0;
    step(0, false);
    const spotted = seen.some((e) => e.type === 'spotted' && e.reason === 'contraband');
    s.heat = 0;
    return spotted;
  };
  check(look(true), 'a phone in hand in a guard\'s sight: contraband seen');
  check(!look(false), 'in the pocket, it isn\'t');
}

// ------------------------------------------------------------------ orders
{
  const { sim, seen, step, to, phone, order } = game(CENTER_PERKS, 5, [[0, 0, 0], [6, VISITING, 0]]);
  const s = sim.state;
  to(1, 10, 0);
  s.cash = 500;
  s.items.inv[0] = slot(PHONE);
  s.items.hand = 1;
  order(0, WAY.DRONE);
  check(!s.order.length && s.cash === 500, 'no order without the phone in hand');
  phone(orderPrice(0, WAY.DRONE) - 1);
  seen.length = 0;
  order(0, WAY.DRONE);
  check(refused(seen).includes('cash') && !s.order.length, 'the price and the fee, or no order');
  phone(500);
  seen.length = 0;
  order(2, WAY.VISITOR);
  check(s.order.join() === `2,${WAY.VISITOR},2` && s.cash === 500 - CATALOGUE[2].price - FEES[WAY.VISITOR] && news(seen, 'ordered')[0]?.item === catalogueItem(2), 'an order paid on the spot, a visitor from tomorrow');
  seen.length = 0;
  order(1, WAY.DRONE);
  check(refused(seen).includes('ordered') && s.order[0] === 2, 'one order at a time');
  // Nothing coming that way in the weeks ahead (every visiting day forced away): refused, nothing paid.
  {
    const q = game(CENTER_PERKS, 5);
    q.to(1, 10, 0);
    q.phone(500);
    q.order(0, WAY.VISITOR);
    check(refused(q.seen).includes('noWay') && !q.sim.state.order.length && q.sim.state.cash === 500, 'no visiting day in sight: no order, no money taken');
  }
  check(s.feats[FEAT.orders] === 1, 'the ledger counts the order');
}

// ------------------------------------------------------------------ the drone: when, where, the noise, seized or picked up
{
  // Tonight with notice enough; else tomorrow night.
  const { sim, seen, step, to, phone, order, blind } = game(CENTER_PERKS, 7);
  const s = sim.state;
  to(2, 9, 0);
  const tonight = droneMinute(sim, 2);
  phone();
  order(0, WAY.DRONE);
  check(s.order[2] === 2, 'ordered in the morning: tonight');
  const when = arrival(sim)!;
  check(when.day === 2 && when.minute === tonight, `arrival: day 2 at minute ${tonight}`);
  const tile = dropTile(sim, 2);
  blind();
  seen.length = 0;
  while (!news(seen, 'dropped').length && s.step < at(3, 8)) step();
  const dropped = news(seen, 'dropped')[0];
  check(!!dropped && prisonDay(s.step) === 2 && dayMinute(s.step) === tonight && s.step % STEPS_PER_MINUTE === 0, 'it came at the minute the phone said');
  check(dropped?.tile === tile && dropped.item === catalogueItem(0) && s.items.ground.some(([k, v]) => k === tile && itemOf(v) === catalogueItem(0)), 'where dropTile said, lying on the ground');
  const buzz = seen.find((e) => e.type === 'noise' && e.kind === 'buzz') as Extract<SimEvent, { type: 'noise' }> | undefined;
  check(!!buzz && buzz.tile === tile && buzz.reach <= DRONE_NOISE && buzz.sent.length <= DRONE_GUARDS, `its buzz: reach ${buzz?.reach}, ${buzz?.sent.length} sent to look`);
  check(!s.order.length && s.drops.length === 1, 'the order done, the drop lying there');
  // Guards looking the other way leave it be; the player picks it up.
  for (let k = 0; k < 40; k++) step();
  check(s.drops.length === 1, 'nobody seized it (every guard looking the other way)');
  putTile(s.player, tile);
  const ground = s.items.ground.findIndex(([k2, v]) => k2 === tile && itemOf(v) === catalogueItem(0));
  s.items.inv.fill(0, 1, HOTBAR);
  seen.length = 0;
  step(command(0, OP.INTERACT));
  step();
  check(ground >= 0 && news(seen, 'collected').length === 1 && s.items.inv.some((v) => itemOf(v) === catalogueItem(0)) && s.feats[FEAT.drops] === 1, 'picked up by the player: collected');
  // Ordered too late for tonight: tomorrow night.
  to(2, 8 + Math.floor((tonight - ORDER_LEAD + 1) / 60), (tonight - ORDER_LEAD + 1) % 60);
  if (s.step < at(2, 8) + tonight * STEPS_PER_MINUTE) {
    phone();
    order(1, WAY.DRONE);
    check(s.order[2] === 3, 'less than an hour\'s notice: tomorrow night');
  }
  console.log(`drone: ordered 09:00 day 2, came at minute ${tonight} (${Math.floor((480 + tonight) / 60) % 24}:${String(tonight % 60).padStart(2, '0')}) on tile ${tile % MAP_W},${Math.floor(tile / MAP_W)}`);
}
{
  // A guard who sees it takes it.
  const { sim, seen, step, to, phone, order } = game(CENTER_PERKS, 7);
  const s = sim.state;
  to(2, 9, 0);
  phone();
  order(0, WAY.DRONE);
  const when = arrival(sim)!;
  const tile = dropTile(sim, when.day);
  for (const g of s.guards) g.bribed = s.step + 1e7;
  to(when.day, 8 + Math.floor(when.minute / 60), when.minute % 60);
  step();
  check(s.drops.length === 1, 'dropped');
  const g = s.guards[1];
  g.bribed = 0;
  putTile(g.body, tile - 2);
  g.body.facing = 1;
  g.wait = 100;
  seen.length = 0;
  step();
  const seized = news(seen, 'seized')[0];
  check(!!seized && seized.guard === 1 && !s.drops.length && !s.items.ground.some(([k, v]) => k === tile && itemOf(v) === catalogueItem(0)) && s.feats[FEAT.dropsSeized] === 1, 'a guard who sees it takes it');
}
{
  // Never in a storm; the sirens turn it back.
  const { sim, seen, step, to, phone, order, blind } = game(CENTER_PERKS, 7, [[0, 0, 0], [2, 0, 3]]);
  const s = sim.state;
  to(2, 9, 0);
  phone();
  order(0, WAY.DRONE);
  const when = arrival(sim)!;
  check(planOf(sim, 2).weather === 'storm' && when.day === 3, 'a storm tonight: tomorrow night');
  blind();
  const due = 2 * DAY_STEPS + when.minute * STEPS_PER_MINUTE;
  while (s.step < due - 1) step();
  check(!news(seen, 'dropped').length, 'nothing came in the storm');
  s.lockdown = true;
  step(0, false);
  s.lockdown = false;
  check(news(seen, 'turnedBack').length === 1 && s.order[2] === 4 && !s.drops.length, 'the sirens on: turned back, tomorrow night');
  const again = arrival(sim)!;
  to(4, 8 + Math.floor(again.minute / 60), again.minute % 60);
  step();
  check(news(seen, 'dropped').length === 1 && prisonDay(s.step) === 4, 'and it came the night after');
}
{
  // Downwind: over many nights, a strong wind carries it off the middle the way it blows.
  let down = 0;
  let windy = 0;
  for (const p of PRISONS) {
    const sim = new Sim(p, 3);
    const r = p.smuggling!.drop;
    const mx = (r[0] + r[2]) >> 1;
    const mz = (r[1] + r[3]) >> 1;
    for (let day = 2; day < 60; day++) {
      const plan = planOf(sim, day);
      if (plan.windForce < 2) continue;
      const t = dropTile(sim, day);
      const to = (plan.wind + 4) % 8;
      const vx = [0, 1, 1, 1, 0, -1, -1, -1][to];
      const vz = [-1, -1, 0, 1, 1, 1, 0, -1][to];
      windy++;
      if ((t % MAP_W - mx) * vx + (Math.floor(t / MAP_W) - mz) * vz > 0) down++;
      check(inRect(r, t % MAP_W, Math.floor(t / MAP_W)) && landable(sim.world, t), `${p.id} day ${day}: it lands in the drop area, on open ground`);
    }
  }
  check(down / windy > 0.9, `downwind ${down} of ${windy} windy nights`);
  console.log(`drift: downwind on ${down} of ${windy} windy nights`);
}
{
  // What the phone says is what happens: every prison, a few seeds, orders at random times.
  let ok = 0;
  let tried = 0;
  for (const p of PRISONS)
    for (const seed of [2, 9]) {
      const { sim, seen, step, phone, order, blind } = game(p, seed, []);
      const s = sim.state;
      const start = at(3, 8 + ((seed * 5) % 20), seed * 7);
      s.step = start - 1;
      step();
      phone();
      order(seed % CATALOGUE.length, WAY.DRONE);
      const when = arrival(sim);
      if (!when) continue;
      tried++;
      const due = (when.day - 1) * DAY_STEPS + when.minute * STEPS_PER_MINUTE;
      blind();
      // (Straight to a minute before: nothing in between draws on the drone.)
      s.step = due - STEPS_PER_MINUTE - 1;
      seen.length = 0;
      for (let k = 0; k < 2 * STEPS_PER_MINUTE; k++) step();
      const d = news(seen, 'dropped')[0];
      if (d && d.tile === dropTile(sim, when.day)) ok++;
      else check(false, `${p.id} seed ${seed}: the drone came as arrival() said (day ${when.day} minute ${when.minute})`);
    }
  check(ok === tried && tried >= 8, `${ok} of ${tried} drones as the phone said`);
  console.log(`promises: ${ok} of ${tried} drones came when and where the phone said`);
}

// ------------------------------------------------------------------ visits and the arches
{
  const { sim, seen, step, to, phone, order } = game(CENTER_PERKS, 5, [[0, 0, 0], [3, VISITING, 0]]);
  const s = sim.state;
  const w = sim.world;
  to(2, 10, 30);
  phone();
  order(0, WAY.VISITOR);
  check(arrival(sim)?.day === 3 && arrival(sim)?.minute === 120, 'a visitor on the next visiting day, from 10:00');
  // A chair at the visitation counter (the inmates' side, north of it).
  const chair = w.props.findIndex((q) => q.kind === 'chair' && q.x === 26 && q.z === 40);
  const sit = () => {
    putTile(s.player, 39 * MAP_W + 26);
    s.player.facing = 5;
    s.seat = chair;
  };
  check(chair >= 0 && seatSpot(w, chair, { ...s.player, x: 26 * UNIT + 512, z: 39 * UNIT + 512 }).facing === 5, 'the chair faces the counter');
  to(3, 9, 50);
  sit();
  for (let k = 0; k < VISIT_STEPS + 5; k++) step();
  check(!news(seen, 'visit').length, 'nobody comes before visiting hours');
  s.seat = -1;
  to(3, 10, 0);
  sit();
  check(guestSpot(sim) === 42 * MAP_W + 26, 'the visitor sits across the counter');
  const cash = s.cash;
  seen.length = 0;
  for (let k = 0; k < VISIT_STEPS - 1; k++) step();
  check(!news(seen, 'visit').length, `not before ${VISIT_STEPS} steps sat waiting`);
  step();
  const v = news(seen, 'visit')[0];
  check(!!v && v.cash! >= GIFT_MIN && v.cash! <= GIFT_MAX && s.cash === cash + v.cash! && v.item === catalogueItem(0) && s.items.inv.some((x) => itemOf(x) === catalogueItem(0)) && !s.order.length, `the visitor: $${v?.cash} and the order slipped across`);
  check(!!(s.eventFlags & TODAY.VISITED) && s.feats[FEAT.visits] === 1 && s.feats[FEAT.smuggled] === 1, 'counted: one visit, one thing smuggled');
  seen.length = 0;
  for (let k = 0; k < VISIT_STEPS * 2; k++) step();
  check(!news(seen, 'visit').length, 'once a visiting day');
  // Leaving with the crowbar (contraband): the arch at the room's way out trips.
  check(visitExits(w).has(38 * MAP_W + 30), 'the room\'s north opening is an arch');
  s.seat = -1;
  putTile(s.player, 40 * MAP_W + 30);
  seen.length = 0;
  for (let k = 0; k < 30 && Math.floor(s.player.z / UNIT) > 36; k++) step(command(13), false);
  const scan = seen.find((e) => e.type === 'scanned') as Extract<SimEvent, { type: 'scanned' }> | undefined;
  check(!!scan && scan.tripped && Math.floor(scan.tile / MAP_W) === 38, 'out through the arch with the crowbar: tripped');
  s.heat = 0;
  s.lockdown = false;
  // With a pouch: through, a use spent.
  s.items.inv[2] = slot(n('pouch'));
  putTile(s.player, 40 * MAP_W + 31);
  seen.length = 0;
  for (let k = 0; k < 30 && Math.floor(s.player.z / UNIT) > 36; k++) step(command(13), false);
  const pouched = seen.find((e) => e.type === 'scanned') as Extract<SimEvent, { type: 'scanned' }> | undefined;
  check(!!pouched && !pouched.tripped && pouched.pouch >= 0, 'a pouch gets it through');
  s.items.inv[2] = 0;
  // 12:00: whoever is still in the room is scanned.
  to(3, 11, 59);
  putTile(s.player, 40 * MAP_W + 33);
  seen.length = 0;
  for (let k = 0; k < STEPS_PER_MINUTE + 1; k++) step(0, false);
  check(seen.some((e) => e.type === 'scanned' && e.tripped), '12:00: scanned on the way out of the room');
  s.heat = 0;
  s.lockdown = false;
  // After hours, the opening is an opening again.
  seen.length = 0;
  for (let k = 0; k < 30 && Math.floor(s.player.z / UNIT) > 36; k++) step(command(13), false);
  check(!seen.some((e) => e.type === 'scanned'), 'after 12:00 the arches are gone');
  console.log(`visit: $${v?.cash} and a crowbar; arches at ${visitExits(w).size} tiles`);
}
{
  // No room in the hotbar: kept for next time.
  const { sim, seen, step, to, phone, order } = game(CENTER_PERKS, 5, [[0, 0, 0], [3, VISITING, 0], [10, VISITING, 0]]);
  const s = sim.state;
  to(2, 10, 30);
  phone();
  order(3, WAY.VISITOR);
  to(3, 10, 5);
  for (let k = 0; k < HOTBAR; k++) s.items.inv[k] = slot(n('sock'));
  const chair = sim.world.props.findIndex((q) => q.kind === 'chair' && q.x === 33 && q.z === 40);
  putTile(s.player, 39 * MAP_W + 33);
  s.seat = chair;
  seen.length = 0;
  for (let k = 0; k < VISIT_STEPS; k++) step();
  check(news(seen, 'visit')[0]?.item === 0 && news(seen, 'noRoom')[0]?.item === catalogueItem(3) && s.order[0] === 3, 'a full hotbar: the gift, and the order kept for next time');
  check(arrival(sim)?.day === 10, 'next visiting day: day 10');
}

// ------------------------------------------------------------------ the Red Cross parcel (Stalag Flucht)
{
  const parcelRun = (item: number, close: boolean, full = false) => {
    const { sim, seen, step, to, phone, order } = game(STALAG_FLUCHT, 5, [[0, 0, 0], [3, DELIVERY, 0]]);
    const s = sim.state;
    to(2, 10, 0);
    phone();
    order(item, WAY.VISITOR);
    const when = arrival(sim);
    to(3, 14, 44);
    if (close) s.eventFlags |= TODAY.SEARCHED_CLOSE;
    const desk = containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'desk');
    if (full) s.items.containers[desk].fill(slot(n('sock')));
    to(3, 14, 47);
    return { sim, seen, when, desk, step, to };
  };
  const crowbar = 0;
  const battery = CATALOGUE.findIndex((c) => c.item === 'battery');
  {
    const { sim, seen, when, desk } = parcelRun(crowbar, false);
    check(when?.day === 3 && when.minute === PARCEL_MINUTE, 'the parcel: next delivery day, 14:45');
    const hidden = containersOf(sim.world)[desk].hidden;
    check(news(seen, 'parcel').length === 1 && sim.state.items.containers[desk].findIndex((v) => itemOf(v) === catalogueItem(crowbar)) >= hidden && !sim.state.order.length, 'a quick search: the crowbar in the desk (in plain sight, never its hidden compartment)');
  }
  {
    const { sim, seen } = parcelRun(crowbar, true);
    check(news(seen, 'parcelSeized').length === 1 && !sim.state.order.length && sim.state.feats[FEAT.parcelsSeized] === 1, 'a thorough search: the crowbar seized');
  }
  {
    const { sim, seen, desk } = parcelRun(battery, true);
    check(!itemDef(catalogueItem(battery)).contraband && news(seen, 'parcel').length === 1 && sim.state.items.containers[desk].some((v) => itemOf(v) === catalogueItem(battery)), 'a thorough search lets a battery through');
  }
  {
    const { sim, seen, desk, step } = parcelRun(battery, false, true);
    check(news(seen, 'deskFull').length === 1 && sim.state.order.length === 3, 'a full desk: the parcel waits');
    sim.state.items.containers[desk][containersOf(sim.world)[desk].hidden] = 0;
    for (let k = 0; k < STEPS_PER_MINUTE + 1; k++) step();
    check(news(seen, 'parcel').length === 1 && !sim.state.order.length, 'and comes as soon as there\'s room');
  }
  console.log('parcel: into the desk, seized by a thorough search (contraband only), waits for room');
}

// ------------------------------------------------------------------ saves and old games
{
  // An order on its way, saved and loaded: the same game.
  const { sim, step, to, phone, order } = game(CENTER_PERKS, 7);
  to(2, 9, 0);
  phone();
  order(4, WAY.DRONE);
  const snap: Snapshot = sim.snapshot();
  const twin = new Sim(CENTER_PERKS, 1);
  twin.restore(JSON.parse(JSON.stringify(snap)));
  for (let k = 0; k < 600; k++) {
    step();
    twin.step(0);
    twin.state.heat = 0;
  }
  check(twin.state.order.join() === sim.state.order.join() && twin.hash() === sim.hash(), 'saved and loaded with an order on its way: the same game');
}
{
  // A save from before P21: today and tomorrow keep the card visiting day took the place of.
  const sim = new Sim(CENTER_PERKS, 4);
  let day = 2;
  while (planOf(sim, day).event !== 'visiting') day++;
  const snap = sim.snapshot();
  snap.state.step = (day - 1) * DAY_STEPS + 100;
  const old = snap.state as unknown as Record<string, unknown>;
  delete old.order;
  delete old.drops;
  delete old.visit;
  const loaded = new Sim(CENTER_PERKS, 1);
  loaded.restore(snap);
  check(planOf(loaded, day).event === DAY_BOOKS['center-perks'].beforeVisits && loaded.state.order.length === 0, `an old save on visiting day ${day}: it keeps its ${DAY_BOOKS['center-perks'].beforeVisits}`);
  // A damaged one: an order for nothing in the catalogue, a drop of no item: dropped, never a crash.
  const bad = sim.snapshot();
  Object.assign(bad.state, { order: [99, 0, 1], drops: [[5, 0, 1]] });
  const fixed = new Sim(CENTER_PERKS, 1);
  fixed.restore(bad);
  for (let k = 0; k < DAY_STEPS + 10; k++) fixed.step(0);
  check(fixed.state.order.length === 0 && fixed.state.drops.length === 0, 'a damaged save: the broken order and drop are gone');
  // A run logged before P21 replays with the old card.
  const rec = new RunRecorder(new Sim(CENTER_PERKS, 4), { seed: 4, game: '1.14.2' });
  const replay = replayLog({ ...rec.toLog(), from: 0, steps: day * DAY_STEPS, sums: [] }, CENTER_PERKS);
  check(!!replay && planOf(replay.sim, day).event === DAY_BOOKS['center-perks'].beforeVisits, 'a run logged before P21 replays with the old card');
  const now = replayLog({ ...new RunRecorder(new Sim(CENTER_PERKS, 4), { seed: 4, game: '1.15.0' }).toLog(), from: 0, steps: day * DAY_STEPS, sums: [] }, CENTER_PERKS);
  check(!!now && planOf(now.sim, day).event === 'visiting', 'one logged since deals visiting day');
  console.log(`saves: an order carries on; an old save on visiting day ${day} keeps its ${DAY_BOOKS['center-perks'].beforeVisits}`);
}
