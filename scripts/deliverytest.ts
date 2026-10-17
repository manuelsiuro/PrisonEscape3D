/**
 * Delivery day (P18): the four prisons with a vehicle deal its card once a week (Shankton and
 * the Training Block never, even forced); while it's in (12:30–14:31) its bay is solid for
 * everyone and stops sight, its doors stand open, anyone standing where it parks steps aside;
 * the supervisor walks its round and signs it off at the tail from 14:25. Climbing in: only at
 * the tail, unseen, not wanted, not after the tailgate shuts; hidden, the player goes nowhere,
 * is seen by nobody, hit by nobody, checks in to no block, and climbs out with Interact. The
 * search at 14:30: a quick look lets a stowaway away at 14:31 (route `stowaway`), a thorough
 * one finds them (solitary, and every search thorough for the next WARY_DAYS); a supervisor
 * not there (knocked out, drawn off by a noise, bribed to look the other way) waves it
 * through; a strict one is always thorough; in a lockdown nothing leaves unsearched. The odds
 * hold over many days. Saved and loaded hidden, the game plays on the same; a save from
 * before P18 keeps its day's old card. The achievements follow the ledger.
 */
import { ACHIEVEMENTS } from '../src/content/achievements';
import { DAY_BOOKS, DAY_EVENTS, SEARCH_REACH, SIGN_OFF_MINUTES, WARY_DAYS, WEATHERS, type DayEvent } from '../src/content/days';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { IRONGATE } from '../src/content/prisons/irongate';
import { SAN_PANCHO } from '../src/content/prisons/san-pancho';
import { SHANKTON } from '../src/content/prisons/shankton';
import { STALAG_FLUCHT } from '../src/content/prisons/stalag-flucht';
import { TRAINING } from '../src/content/prisons/training';
import type { PrisonDef } from '../src/content/prisons/types';
import { canSee } from '../src/sim/ai/sight';
import { command, OP } from '../src/sim/command';
import { ESCAPES, Sim, type SimEvent, type Snapshot } from '../src/sim/Sim';
import { dayPlan, planOf, today } from '../src/sim/systems/calendar';
import { dayMinute } from '../src/sim/systems/clock';
import { atTail, searchMinute, thorough, vehicleIn } from '../src/sim/systems/delivery';
import { GUARD, sendToLook } from '../src/sim/systems/guards';
import { FEAT } from '../src/sim/systems/ledger';
import { CHASE_HEAT, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { LAYER, MAP_W } from '../src/sim/world/World';
import { TILE } from '../src/sim/world/tiles';

const LAYER_GROUND = LAYER.GROUND;
const TILE_HOLE = TILE.HOLE;
import { check } from './assert';

const E = (id: DayEvent) => DAY_EVENTS.indexOf(id);
const CLEAR = WEATHERS.indexOf('clear');
const WITH_VEHICLE = [CENTER_PERKS, STALAG_FLUCHT, SAN_PANCHO, IRONGATE];

// ------------------------------------------------------------------ the plans
{
  const salts = [1, 2, 3, 4, 5, 6].map((k) => new Sim(CENTER_PERKS, k).state.salt);
  for (const p of PRISONS) {
    const book = DAY_BOOKS[p.id];
    let deliveries = 0;
    let weeks = 0;
    for (const salt of salts) {
      for (let wk = 0; wk < 8; wk++) {
        const n = Array.from({ length: book?.deck.length ?? 7 }, (_, k) => dayPlan(p.id, salt, 2 + wk * (book?.deck.length ?? 7) + k).event).filter((e) => e === 'delivery').length;
        deliveries += n;
        weeks++;
      }
    }
    if (p.delivery) check(deliveries === weeks, `${p.id}: the ${p.delivery.vehicle} comes once a week (${deliveries} in ${weeks} weeks)`);
    else check(deliveries === 0, `${p.id}: no vehicle, never a delivery`);
    // Forced where no vehicle comes: the day stays as drawn.
    const forced = dayPlan(p.id, salts[0], 3, [[3, E('delivery'), -1]]).event;
    if (!p.delivery) check(forced !== 'delivery', `${p.id}: a delivery forced where no vehicle comes is not one`);
    const plan = dayPlan(p.id, salts[0], 1, [[1, E('delivery'), CLEAR]]);
    if (p.delivery) check(plan.event === 'delivery' && plan.at === 270 && plan.until === 391 && searchMinute(plan) === 390, `${p.id}: a delivery 12:30–14:31, searched at 14:30`);
  }
  check(dayPlan(TRAINING.id, 1, 2, [[2, E('delivery'), -1]]).event === 'none', 'the Training Block: never a delivery');
  console.log('plans: a delivery once a week where a vehicle comes (Center Perks, Stalag Flucht, San Pancho, Irongate); none at Shankton or in training');
}

// ------------------------------------------------------------------ helpers

/** A new game with a delivery on day `day` (every day quiet otherwise), stepped to a minute of that prison day. */
function game(def: PrisonDef, seed = 3, day = 1) {
  const sim = new Sim(def, seed);
  sim.state.calendar = [[0, 0, CLEAR], [day, E('delivery'), CLEAR]];
  const seen: SimEvent[] = [];
  const to = (dayMin: number) => {
    const target = (day - 1) * 1440 * STEPS_PER_MINUTE + dayMin * STEPS_PER_MINUTE;
    while (sim.state.step < target && !sim.state.escaped) {
      sim.step(0);
      seen.push(...sim.events);
    }
  };
  const step = (cmd = 0) => {
    sim.step(cmd);
    seen.push(...sim.events);
  };
  return { sim, seen, to, step };
}
const tileOf = (x: number, z: number) => z * MAP_W + x;
const put = (sim: Sim, x: number, z: number) => {
  sim.state.player.x = x * UNIT + UNIT / 2;
  sim.state.player.z = z * UNIT + UNIT / 2;
};
/** The player at the tail, every guard but the supervisor out of the way, the supervisor at its far stop facing away: unseen. */
function unseenAtTail(sim: Sim) {
  const d = sim.prison.delivery!;
  put(sim, d.tail.x, d.tail.z);
  sim.state.seen = false;
}
/** A day thorough or not, for a prison and seed (the first seed from `from` that gives it). */
function seedFor(def: PrisonDef, want: boolean, day = 1, from = 1): number {
  for (let seed = from; seed < from + 400; seed++) {
    const sim = new Sim(def, seed);
    if (thorough(sim, day) === want) return seed;
  }
  throw new Error('no seed');
}

// ------------------------------------------------------------------ the vehicle in
for (const def of WITH_VEHICLE) {
  const d = def.delivery!;
  const { sim, to, seen } = game(def);
  const w = sim.world;
  const [bx0, bz0, bx1, bz1] = d.bay;
  const mid = tileOf(bx0, bz0);
  // (Irongate's helicopter sets down on its pad, solid all along.)
  const pad = def === IRONGATE;
  to(269);
  check(!vehicleIn(sim) && !w.parked[mid] && (pad || !w.block[mid]), `${def.id}: before 12:30 the bay is open ground`);
  // Someone standing where it parks steps aside as it comes in.
  put(sim, bx0, bz0);
  const inmate = sim.state.inmates[0];
  inmate.body.x = bx1 * UNIT + UNIT / 2;
  inmate.body.z = bz1 * UNIT + UNIT / 2;
  to(271);
  check(vehicleIn(sim) && w.delivering, `${def.id}: at 12:30 the ${d.vehicle} is in`);
  let solid = true;
  for (let z = bz0; z <= bz1; z++) for (let x = bx0; x <= bx1; x++) solid &&= !!(w.block[tileOf(x, z)] && w.guardBlock[tileOf(x, z)] && w.npcBlock[tileOf(x, z)]);
  check(solid, `${def.id}: its bay is solid for the player, the inmates and the guards`);
  const under = (b: { x: number; z: number }) => w.parked[Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT)] === 1;
  check(!under(sim.state.player) && !under(inmate.body), `${def.id}: whoever stood where it parks stepped aside`);
  // Sight across it is stopped: a guard on one side never sees the far side.
  const near = { x: (bx0 - 1) * UNIT + UNIT / 2, z: ((bz0 + bz1) / 2) * UNIT + UNIT / 2, facing: 1, moving: false };
  const far = { x: (bx1 + 1) * UNIT + UNIT / 2, z: near.z };
  if (bx1 - bx0 >= 1) check(!canSee(w, near, far, 12 * UNIT), `${def.id}: nobody sees through it`);
  for (const q of d.open ?? []) check(!w.block[tileOf(q.x, q.z)] && !w.doorShut[tileOf(q.x, q.z)], `${def.id}: the door at ${q.x},${q.z} stands open`);
  check(seen.some((e) => e.type === 'today' && e.event === 'delivery' && e.phase === 'start'), `${def.id}: the delivery's start is told`);
  // The supervisor walks its round, then stands at the tail to sign it off.
  const g = sim.state.guards[d.supervisor];
  const stops = new Set<number>();
  const visit = new Set(d.round.map((p) => tileOf(p.x, p.z)));
  while (dayMinute(sim.state.step) < searchMinute(today(sim)) - SIGN_OFF_MINUTES) {
    sim.step(0);
    const t = Math.floor(g.body.z / UNIT) * MAP_W + Math.floor(g.body.x / UNIT);
    if (visit.has(t)) stops.add(t);
  }
  check(stops.size === visit.size, `${def.id}: the supervisor walks the whole round (${stops.size} of ${visit.size} stops)`);
  to(searchMinute(today(sim)) - 1);
  const tail = tileOf(d.tail.x, d.tail.z);
  check(Math.floor(g.body.z / UNIT) * MAP_W + Math.floor(g.body.x / UNIT) === tail, `${def.id}: by 14:29 the supervisor stands at the tail`);
  to(392);
  check(!vehicleIn(sim) && !w.parked[mid] && (pad || !w.block[mid]), `${def.id}: at 14:31 it's gone`);
  // (Its doors shut again once the player isn't out past them: stepped aside out there as it came in, back in.)
  put(sim, def.spawn.x, def.spawn.z);
  to(393);
  for (const q of d.open ?? []) check(!!w.doorShut[tileOf(q.x, q.z)], `${def.id}: its door shut again`);
  check(seen.some((e) => e.type === 'today' && e.phase === 'search'), `${def.id}: searched at 14:30 (nobody aboard)`);
  console.log(`${def.id}: the ${d.vehicle} in 12:30–14:31, solid and opaque, ${def.guards[d.supervisor].name} round its ${d.round.length} stops and at the tail by 14:29`);
}

// ------------------------------------------------------------------ climbing in
{
  const { sim, to, step } = game(CENTER_PERKS, seedFor(CENTER_PERKS, false));
  const d = CENTER_PERKS.delivery!;
  to(300);
  // Not at the tail: Interact does something else.
  put(sim, 30, 44);
  check(!atTail(sim), 'away from the tail: not at it');
  // Seen: refused.
  unseenAtTail(sim);
  check(atTail(sim), 'at the tail');
  sim.state.seen = true;
  step(command(0, OP.INTERACT));
  check(!sim.state.stowed && sim.events.some((e) => e.type === 'refused' && e.why === 'watched'), 'under a guard’s eyes: refused');
  // Wanted: refused.
  sim.state.heat = CHASE_HEAT;
  sim.state.seen = false;
  step(command(0, OP.INTERACT));
  check(!sim.state.stowed && sim.events.some((e) => e.type === 'refused' && e.why === 'hunted'), 'wanted: refused');
  sim.state.heat = 0;
  // Unseen: in.
  unseenAtTail(sim);
  step(command(0, OP.INTERACT));
  check(sim.state.stowed && sim.events.some((e) => e.type === 'stow' && e.on), 'unseen at the tail: hidden in the truck');
  // Hidden: walking goes nowhere, nobody sees, the heat cools.
  const { x, z } = sim.state.player;
  for (let k = 0; k < 40; k++) step(command(5));
  check(sim.state.player.x === x && sim.state.player.z === z, 'hidden: going nowhere on foot');
  // A guard right at the tail, facing it: sees nothing.
  const g = sim.state.guards[0];
  g.body.x = (d.tail.x + 1) * UNIT + UNIT / 2;
  g.body.z = d.tail.z * UNIT + UNIT / 2;
  g.body.facing = 9;
  step();
  check(!g.sees && !sim.state.seen, 'hidden: a guard at the tail sees nothing');
  // (The heat cools under nobody's eyes.)
  sim.state.heat = 30;
  for (let k = 0; k < 400; k++) step();
  check(sim.state.heat < 30, 'hidden: the heat cools');
  // Out again, in again.
  step(command(0, OP.INTERACT));
  check(!sim.state.stowed && sim.events.some((e) => e.type === 'stow' && !e.on), 'Interact again: out of the truck');
  unseenAtTail(sim);
  step(command(0, OP.INTERACT));
  check(sim.state.stowed, 'and back in');
  // The tailgate shuts for the search.
  const late = game(CENTER_PERKS, seedFor(CENTER_PERKS, false));
  late.to(390);
  unseenAtTail(late.sim);
  late.step(command(0, OP.INTERACT));
  check(!late.sim.state.stowed && !atTail(late.sim), 'after 14:30: the tailgate is shut (nothing to climb into)');
  console.log('climbing in: at the tail, unseen, not wanted, before 14:30; hidden, nowhere on foot and seen by nobody; Interact climbs out');
}

// ------------------------------------------------------------------ the search
/** Hidden at 13:00 on day 1 (or `day`), played to the end of the delivery; what happened. */
function hideAndWait(def: PrisonDef, seed: number, setup?: (sim: Sim) => void, day = 1) {
  const g = game(def, seed, day);
  g.to(300);
  unseenAtTail(g.sim);
  g.step(command(0, OP.INTERACT));
  check(g.sim.state.stowed, `${def.id}: hidden`);
  setup?.(g.sim);
  g.to(400);
  return g;
}
for (const def of WITH_VEHICLE) {
  // A quick look: away at 14:31.
  const quick = hideAndWait(def, seedFor(def, false));
  const st = quick.sim.state;
  check(st.escaped > 0 && ESCAPES[st.via] === 'stowaway' && dayMinute(st.escaped) === 391, `${def.id}: a quick look, away with the ${def.delivery!.vehicle} at 14:31`);
  check(quick.seen.some((e) => e.type === 'today' && e.phase === 'search' && !e.thorough), `${def.id}: the search was a quick look`);
  // Thorough: found, solitary.
  const seed = seedFor(def, true);
  const close = hideAndWait(def, seed);
  const cs = close.sim.state;
  check(!cs.escaped && !cs.stowed && close.seen.some((e) => e.type === 'stow' && e.found) && close.seen.some((e) => e.type === 'caught' && e.solitary), `${def.id}: a thorough search finds the stowaway (solitary)`);
  check(cs.stowCaught === 1 && cs.feats[FEAT.stowFound] === 1, `${def.id}: the catch remembered`);
  for (let day = 2; day <= 1 + WARY_DAYS; day++) check(thorough(close.sim, day), `${def.id}: day ${day}, every search thorough after the catch`);
  check(thorough(close.sim, 2 + WARY_DAYS) === thorough(new Sim(def, seed), 2 + WARY_DAYS), `${def.id}: then back to the day's odds`);
}
{
  // A thorough day, the supervisor knocked out: nobody searches; away (and Off the Books).
  const def = CENTER_PERKS;
  const k = def.delivery!.supervisor;
  const ko = hideAndWait(def, seedFor(def, true), (sim) => (sim.state.guards[k].ko = 200 * STEPS_PER_MINUTE));
  check(ko.sim.state.escaped > 0 && ko.seen.some((e) => e.type === 'today' && e.phase === 'waved' && e.thorough), 'a thorough day, the supervisor out cold: waved through, away');
  check(ko.sim.state.feats[FEAT.slipped] === 1, 'counted: slipped through on a thorough day');
  // Drawn off by a noise at 14:29: still looking at 14:30.
  const lured = game(def, seedFor(def, true));
  lured.to(300);
  unseenAtTail(lured.sim);
  lured.step(command(0, OP.INTERACT));
  lured.to(389);
  sendToLook(lured.sim.state.guards[k], tileOf(40, 58), 12 * 20);
  lured.to(400);
  check(lured.sim.state.escaped > 0, 'a thorough day, the supervisor drawn off by a noise at 14:29: away');
  // Bribed to look the other way (a corrupt supervisor): no search.
  const crook = { ...def, guards: def.guards.map((g, j) => (j === k ? { ...g, trait: 'corrupt' as const } : g)) };
  const bribed = hideAndWait(crook, seedFor(crook, true), (sim) => (sim.state.guards[k].bribed = sim.state.step + 200 * STEPS_PER_MINUTE));
  check(bribed.sim.state.escaped > 0, 'a thorough day, the supervisor bribed to look the other way: away');
  // A strict supervisor: always thorough.
  const strict = { ...def, guards: def.guards.map((g, j) => (j === k ? { ...g, trait: 'strict' as const } : g)) };
  let always = true;
  for (let day = 1; day <= 30; day++) always &&= thorough(new Sim(strict, 4), day);
  check(always, 'a strict supervisor is always thorough');
  // A lockdown at 14:30: searched to the last crate, whoever's there.
  const lock = game(def, seedFor(def, false));
  lock.to(300);
  unseenAtTail(lock.sim);
  lock.step(command(0, OP.INTERACT));
  lock.to(385);
  lock.sim.state.lockdown = true;
  lock.to(400);
  check(!lock.sim.state.escaped && lock.seen.some((e) => e.type === 'stow' && e.found), 'in a lockdown nothing leaves unsearched');
  // The supervisor far from the tail (more than SEARCH_REACH tiles) at 14:30: waved through.
  const far = game(def, seedFor(def, true));
  far.to(300);
  unseenAtTail(far.sim);
  far.step(command(0, OP.INTERACT));
  far.to(389);
  const g = far.sim.state.guards[k];
  g.body.x = (def.delivery!.tail.x + SEARCH_REACH + 1) * UNIT + UNIT / 2;
  g.path = [];
  g.wait = 30;
  far.to(400);
  check(far.sim.state.escaped > 0, `the supervisor more than ${SEARCH_REACH} tiles from the tail at 14:30: no search`);
  console.log('the search: a quick look lets the stowaway away at 14:31, a thorough one finds them; nobody there to search (out cold, drawn off, bribed, too far): waved through; strict always thorough; a lockdown searches');
}

// ------------------------------------------------------------------ the odds
{
  const out: string[] = [];
  for (const def of WITH_VEHICLE) {
    let n = 0;
    const days = 400;
    for (let day = 1; day <= days; day++) if (thorough(new Sim(def, 7), day)) n++;
    const share = Math.round((n / days) * 100);
    check(Math.abs(share - def.delivery!.thorough) <= 8, `${def.id}: thorough ${share}% of days (${def.delivery!.thorough}%)`);
    out.push(`${def.id} ${share}%`);
  }
  console.log(`thorough searches: ${out.join(', ')}`);
}

// ------------------------------------------------------------------ saves
{
  // Saved and loaded hidden: the same game, to the same escape.
  const g = game(STALAG_FLUCHT, seedFor(STALAG_FLUCHT, false));
  g.to(300);
  unseenAtTail(g.sim);
  g.step(command(0, OP.INTERACT));
  g.to(340);
  const twin = new Sim(STALAG_FLUCHT, 99);
  twin.restore(JSON.parse(JSON.stringify(g.sim.snapshot())) as Snapshot);
  check(twin.state.stowed && twin.world.delivering, 'loaded hidden: still hidden, the truck still in');
  while (!g.sim.state.escaped) {
    g.sim.step(0);
    twin.step(0);
  }
  check(twin.state.escaped === g.sim.state.escaped && twin.hash() === g.sim.hash(), 'and it plays on the same, to the same escape');
  // A save from before P18 on a delivery day: that day keeps its old card.
  const salt0 = new Sim(CENTER_PERKS, 1).state.salt;
  let day = 2;
  while (dayPlan(CENTER_PERKS.id, salt0, day).event !== 'delivery') day++;
  const sim = new Sim(CENTER_PERKS, 1);
  for (let k = 0; k < (day - 1) * 1440 * STEPS_PER_MINUTE + 100; k++) sim.step(0);
  const snap = JSON.parse(JSON.stringify(sim.snapshot())) as Snapshot;
  delete (snap.state as Partial<typeof snap.state>).stowed;
  delete (snap.state as Partial<typeof snap.state>).stowCaught;
  const old = new Sim(CENTER_PERKS, 5);
  old.restore(snap);
  check(today(old).event === (DAY_BOOKS[CENTER_PERKS.id].before ?? 'none') && today(sim).event === 'delivery', `an old save on day ${day} keeps its old card (${today(old).event})`);
  check(planOf(old, day + 7).event === planOf(sim, day + 7).event, 'and the days after are as drawn');
  console.log('saves: loaded hidden plays on the same; a save from before delivery day keeps that day’s card');
}

// ------------------------------------------------------------------ achievements
{
  const ach = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!;
  const view = (prison: string, via: string, feats: Partial<Record<keyof typeof FEAT, number>> = {}) => {
    const f = new Array(Object.keys(FEAT).length).fill(0);
    for (const [k, v] of Object.entries(feats)) f[FEAT[k as keyof typeof FEAT]] = v;
    return { prison, feats: f, days: [], str: 0, spd: 0, int: 0, via, day: 3, medal: null };
  };
  check(ach('specialDelivery').escape!(view('center-perks', 'stowaway')) && !ach('specialDelivery').escape!(view('center-perks', 'tunnel')), 'Special Delivery: away as a stowaway');
  check(ach('airMail').escape!(view('irongate', 'stowaway')) && !ach('airMail').escape!(view('center-perks', 'stowaway')) && !ach('airMail').escape!(view('irongate', 'helicopter')), 'Air Mail: away in the helicopter by day, hidden');
  check(ach('offTheBooks').run!(view('x', '', { slipped: 1 })) && !ach('offTheBooks').run!(view('x', '')), 'Off the Books: waved through on a day the search would have found you');
  check(ach('returnToSender').hidden === true && ach('returnToSender').run!(view('x', '', { stowFound: 1 })), 'Return to Sender (a mishap): found in the vehicle');
  console.log('achievements: Special Delivery, Air Mail, Off the Books, Return to Sender');
}
void SHANKTON;

// ------------------------------------------------------------------ the review's edge cases
{
  const def = CENTER_PERKS;
  const d = def.delivery!;
  // Damage the guards find while the player hides: the alarm goes up all the same, and a lockdown searches the truck.
  const dmg = game(def, seedFor(def, false));
  dmg.to(300);
  unseenAtTail(dmg.sim);
  dmg.step(command(0, OP.INTERACT));
  const hole = tileOf(29, 50);
  dmg.sim.world.setKind(LAYER_GROUND, hole, TILE_HOLE);
  dmg.sim.state.tiles[hole] = TILE_HOLE;
  const g = dmg.sim.state.guards[d.supervisor];
  g.body.x = 28.5 * UNIT;
  g.body.z = 50.5 * UNIT;
  g.body.facing = 1;
  dmg.step();
  check(dmg.sim.state.lockdown && dmg.seen.some((e) => e.type === 'spotted' && e.reason === 'damage'), 'damage found while hidden: the alarm, a lockdown');
  dmg.to(400);
  check(!dmg.sim.state.escaped && dmg.seen.some((e) => e.type === 'stow' && e.found), 'and the lockdown searches the truck: found');
  // Out of the truck after a quick look: the gate stays open behind it until the player is back inside.
  const out = game(def, seedFor(def, false));
  out.to(300);
  unseenAtTail(out.sim);
  out.step(command(0, OP.INTERACT));
  out.to(390);
  out.step(command(0, OP.INTERACT));
  check(!out.sim.state.stowed, 'climbed out after the search');
  out.to(395);
  const gate = tileOf(30, 45);
  check(!out.sim.state.escaped && !out.sim.world.delivering && !out.sim.world.block[gate], 'the truck gone, its gate still open for the player out there');
  // (A game loaded out there: the same.)
  const twin = new Sim(def, 99);
  twin.restore(JSON.parse(JSON.stringify(out.sim.snapshot())) as Snapshot);
  check(!twin.world.block[gate], 'loaded out there: the gate open too');
  put(out.sim, 30, 43);
  out.step();
  check(!!out.sim.world.block[gate] || !!out.sim.world.doorShut[gate], 'back inside: it shuts');
  // Climbing out on the very step it leaves: left behind.
  const late = game(def, seedFor(def, false));
  late.to(300);
  unseenAtTail(late.sim);
  late.step(command(0, OP.INTERACT));
  late.to(390);
  while (dayMinute(late.sim.state.step + 1) < 391) late.step();
  late.step(command(0, OP.INTERACT));
  check(!late.sim.state.escaped && !late.sim.state.stowed, 'climbed out as it pulls away: left behind');
  // The search's outcome is in the state (a game loaded after it says how it went).
  const quick = hideAndWait(def, seedFor(def, false));
  check(!!(quick.sim.state.eventFlags & 64), 'a quick look, kept in the day’s flags');
  // An old save made the evening before a delivery: tomorrow keeps its old card too.
  const salt = new Sim(def, 1).state.salt;
  let day = 2;
  while (dayPlan(def.id, salt, day).event !== 'delivery') day++;
  const sim = new Sim(def, 1);
  for (let k = 0; k < (day - 1) * 1440 * STEPS_PER_MINUTE - 60 * STEPS_PER_MINUTE; k++) sim.step(0);
  const snap = JSON.parse(JSON.stringify(sim.snapshot())) as Snapshot;
  delete (snap.state as Partial<typeof snap.state>).stowed;
  delete (snap.state as Partial<typeof snap.state>).stowCaught;
  const old = new Sim(def, 5);
  old.restore(snap);
  check(planOf(old, day).event === (DAY_BOOKS[def.id].before ?? 'none'), 'an old save from the evening before: tomorrow keeps its old card');
  console.log('review: damage found while hidden raises the alarm; out of the truck, its gate waits for the player; climbing out at 14:31 stays behind; the search kept in the state; an old save keeps tomorrow');
}
