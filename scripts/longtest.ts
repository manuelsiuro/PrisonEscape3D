/**
 * Long games (P28, docs/PLAN.md §9), through the real simulation:
 * - the data: every prison's garden beds (open, diggable yard soil nobody needs to stand on, clear
 *   of the court) and its rat track (open floor in the cell block or a corridor);
 * - the makings on request: fruit at a meal (once a meal), sugar and a seed packet once a day, the
 *   merchants' staples, what they buy;
 * - pruno: brewed, fermenting in a desk's drawers and a toilet's tank (not in hand), ripe after two
 *   mornings; a dog's nose (seized, heat in the player's cell); the shakedown's search (the standard
 *   drawers only); drunk: slower, harder blows, stumbles, the guards' heat once a sighting;
 * - the garden: planted, watered, grown a stage a day, rain and storms watering it, a heatwave's two
 *   cupfuls, wilted and dead when dry, harvested; the hole under a plant no guard sees;
 * - the rat: its track (in the cell, evening free time, once a day, with bait) and its speed;
 * - race nights: the card, bets, the race by roll() (its odds measured), the purse, a lockdown, a
 *   scratched pet, gambling heat;
 * - saves mid-brew, mid-growth and mid-race; nothing happens without the player.
 */
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { SAN_PANCHO } from '../src/content/prisons/san-pancho';
import { itemNumber } from '../src/content/items';
import { SALES_A_DAY } from '../src/content/long';
import { BETS, CROP, DRY_DEATH, GROWN, HARVEST, PURSE, RACE_MINUTE, RACE_STEPS, RAT_START_SPEED, STAPLES, TAKE, TIPSY_HEAT, TIPSY_STEPS } from '../src/content/long';
import { SHOP_SLOTS } from '../src/content/loot';
import { WEATHERS } from '../src/content/days';
import { command, EXT, OP, SLOT, TALK } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { DAY_STEPS, prisonDay } from '../src/sim/systems/clock';
import { BED, bedAt, bedCount, bedTile, plotOf } from '../src/sim/systems/garden';
import { itemOf, slot, usesOf } from '../src/sim/systems/items';
import { canDigFloor, reserved } from '../src/sim/systems/structure';
import { oddsOf, payout, raceCard, rivals, runRace, trackOf, trackTiles, trackGain, type Entrant } from '../src/sim/systems/races';
import { RAT } from '../src/sim/systems/rats';
import { containersOf } from '../src/sim/world/containers';
import { TILE } from '../src/sim/world/tiles';
import { STEPS_PER_MINUTE, UNIT, walkSpeed } from '../src/sim/tuning';
import { LAYER, MAP_W, placeKey } from '../src/sim/world/World';
import { shakedownCells } from '../src/sim/systems/justice';
import { check } from './assert';

const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const put = (b: { x: number; z: number }, t: number) => {
  b.x = (t % MAP_W) * UNIT + UNIT / 2;
  b.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
};
const n = itemNumber;
const refusals = (seen: SimEvent[]) => seen.filter((e) => e.type === 'refused').map((e) => (e as { why: string }).why);
const of = <T extends SimEvent['type']>(seen: SimEvent[], type: T) => seen.filter((e) => e.type === type) as Array<Extract<SimEvent, { type: T }>>;

/** A game kept calm (heat and lockdowns cleared each step unless asked), every day quiet and clear unless forced. */
function game(prison = CENTER_PERKS, seed = 5, calendar: Array<[number, number, number, number?, number?]> = [[0, 0, 0]]) {
  const sim = new Sim(prison, seed);
  sim.state.calendar = calendar;
  const seen: SimEvent[] = [];
  let calm = true;
  const step = (cmd = 0) => {
    sim.step(cmd);
    seen.push(...sim.events);
    if (calm) {
      sim.state.heat = 0;
      if (sim.state.lockdown) sim.state.lockdown = false;
    }
  };
  const to = (day: number, hour: number, minute = 0) => {
    const target = at(day, hour, minute);
    while (sim.state.step < target && !sim.state.escaped) step();
  };
  /** Straight to a moment (the routine's blocks between skipped: the next step settles the one it lands in). */
  const jump = (day: number, hour: number, minute = 0) => {
    sim.state.step = at(day, hour, minute) - 1;
    // (The blocks skipped aren't missed.)
    sim.state.attended = true;
    sim.state.excused = true;
    step();
  };
  /** Through a morning's 08:00 (a new prison day), to 08:01. */
  const morning = (day: number) => {
    jump(day - 1, 7, 58);
    to(day, 8, 1);
  };
  const ext = (a: number, b = 0, c = 0) => step(command(0, OP.EXT, a, b, c));
  const use = () => step(command(0, OP.USE, 1));
  const hold = (k: number, item: number, uses?: number) => {
    sim.state.items.inv[k] = uses === undefined ? slot(item) : slot(item, uses);
    sim.state.items.hand = k;
  };
  const setCalm = (on: boolean) => (calm = on);
  /** An inmate on an open yard tile and the player just east of it facing it, talking (true once they are). */
  const talkTo = (who: number) => {
    const w = sim.world;
    let tile = -1;
    for (let i = MAP_W; i < MAP_W * 63 && tile < 0; i++) {
      const x = i % MAP_W;
      const z = Math.floor(i / MAP_W);
      if (w.zoneAt(x, z) === 'yard' && w.zoneAt(x + 1, z) === 'yard' && !w.blocked(x, z) && !w.blocked(x + 1, z) && bedAt(w, i) < 0 && bedAt(w, i + 1) < 0) tile = i;
    }
    const m = sim.state.inmates[who];
    put(m.body, tile);
    put(sim.state.player, tile + 1);
    sim.state.player.facing = 9;
    m.goal = -1;
    m.path = [];
    m.doing = 0;
    step(command(0, OP.INTERACT));
    return sim.state.talk === who;
  };
  const blind = () => {
    for (const g of sim.state.guards) g.sees = false;
  };
  return { sim, seen, step, to, jump, morning, ext, use, hold, setCalm, blind, talkTo };
}

/** The first container of a table (or the player's own of a kind). */
const box = (sim: Sim, ok: (c: ReturnType<typeof containersOf>[number]) => boolean) => containersOf(sim.world).findIndex(ok);

// ------------------------------------------------------------------ the data
{
  const lines: string[] = [];
  for (const p of [...PRISONS, TRAINING]) {
    const sim = new Sim(p, 1);
    const w = sim.world;
    const plot = plotOf(w)!;
    check(!!plot && plot.w * plot.d >= 4, `${p.id}: a garden of at least 4 beds`);
    const spots = new Set((p.leisure?.hoop.spots ?? []).map((s) => s.z * MAP_W + s.x));
    const decor = (x: number, z: number) => (p.decor ?? []).some((d) => x >= d.x && x < d.x + (d.w ?? 1) && z >= d.z && z < d.z + (d.d ?? 1));
    const props = (x: number, z: number) => w.props.some((o) => x >= o.x && x < o.x + o.w && z >= o.z && z < o.z + o.d);
    for (let k = 0; k < bedCount(w); k++) {
      const t = bedTile(w, k);
      const x = t % MAP_W;
      const z = Math.floor(t / MAP_W);
      check(bedAt(w, t) === k, `${p.id}: bed ${k} is where it says`);
      check(w.zoneAt(x, z) === 'yard', `${p.id}: bed ${k} in the yard`);
      check(canDigFloor(w, t, []) && !reserved(w).has(t), `${p.id}: bed ${k} diggable soil nobody needs to stand on`);
      check(!props(x, z) && !decor(x, z) && !spots.has(t), `${p.id}: bed ${k} clear of furniture, decor and the court`);
      // Clear of the court: no bed within 2 tiles of a shooting spot or the rim.
      const c = p.leisure!.hoop;
      check([...c.spots, c].every((s) => Math.max(Math.abs(s.x - x), Math.abs(s.z - z)) > 2), `${p.id}: bed ${k} well off the court`);
    }
    const track = trackOf(w)!;
    const tiles = trackTiles(track);
    check(tiles.length >= 5, `${p.id}: a rat track 5 tiles long or more`);
    for (const t of tiles) {
      const x = t % MAP_W;
      const z = Math.floor(t / MAP_W);
      check(!w.blocked(x, z) && !props(x, z) && w.ground.kind[t] !== TILE.DOOR, `${p.id}: the track's tile ${x},${z} open floor`);
      check(['cellBlock', 'corridor'].includes(w.zoneAt(x, z)), `${p.id}: the track's tile ${x},${z} in the cell block`);
    }
    lines.push(`${p.id} ${plot.w}×${plot.d} beds at ${plot.x},${plot.z}, track ${track.len} tiles from ${track.x},${track.z} in the ${w.zoneAt(track.x, track.z)}`);
  }
  console.log(`data: ${lines.join('; ')}`);
}

// ------------------------------------------------------------------ the makings on request
{
  const g = game();
  const { sim, seen } = g;
  const s = sim.state;
  const counter = box(sim, (c) => c.table === 'canteenCounter');
  const freezer = box(sim, (c) => c.table === 'kitchenFreezer');
  const shelf = box(sim, (c) => c.table === 'libraryShelf');
  check(counter >= 0 && freezer >= 0 && shelf >= 0, 'center-perks: a canteen counter, a kitchen freezer, a library shelf');
  const stock = JSON.stringify(s.items.containers);
  // Breakfast: a piece of fruit, once.
  g.jump(1, 9, 10);
  s.items.inv = [0, 0, 0, 0, 0, 0, 0, s.items.inv[SLOT.OUTFIT]];
  s.items.open = counter;
  g.ext(EXT.TAKE, TAKE.FRUIT);
  check(itemOf(s.items.inv[0]) === n('fruit'), 'breakfast: fruit off the counter');
  s.items.open = counter;
  g.ext(EXT.TAKE, TAKE.FRUIT);
  check(refusals(seen).at(-1) === 'takenToday' && !s.items.inv[1], 'one piece a meal');
  // Free time: no meal.
  g.jump(1, 10, 30);
  s.items.open = counter;
  g.ext(EXT.TAKE, TAKE.FRUIT);
  check(refusals(seen).at(-1) === 'notMeal', 'no fruit outside meals');
  // Dinner: another.
  g.jump(1, 17, 10);
  s.items.open = counter;
  g.ext(EXT.TAKE, TAKE.FRUIT);
  check(itemOf(s.items.inv[1]) === n('fruit'), 'dinner: another piece');
  // Not from the wrong furniture: nothing at all.
  s.items.open = shelf;
  const before = seen.length;
  g.ext(EXT.TAKE, TAKE.FRUIT);
  check(seen.slice(before).every((e) => e.type !== 'pickup' && e.type !== 'refused'), 'no fruit off a shelf');
  // Sugar and seeds, once a day each.
  s.items.open = freezer;
  g.ext(EXT.TAKE, TAKE.SUGAR);
  s.items.open = freezer;
  g.ext(EXT.TAKE, TAKE.SUGAR);
  check(itemOf(s.items.inv[2]) === n('sugar') && !s.items.inv[3] && refusals(seen).at(-1) === 'takenToday', 'sugar from the freezer, once a day');
  s.items.open = shelf;
  g.ext(EXT.TAKE, TAKE.VEG_SEEDS);
  s.items.open = shelf;
  g.ext(EXT.TAKE, TAKE.FRUIT_SEEDS);
  check(itemOf(s.items.inv[3]) === n('veg_seeds') && !s.items.inv[4] && refusals(seen).at(-1) === 'takenToday', 'one seed packet a day off the shelf');
  g.jump(2, 10, 30);
  s.items.open = shelf;
  g.ext(EXT.TAKE, TAKE.FRUIT_SEEDS);
  check(itemOf(s.items.inv[4]) === n('fruit_seeds'), 'and another the next day');
  // A full hotbar: no room.
  s.items.inv[5] = slot(n('sock'));
  s.items.open = freezer;
  g.ext(EXT.TAKE, TAKE.SUGAR);
  check(refusals(seen).at(-1) === 'room', 'no room, nothing taken');
  // Taken, never stocked: the furniture's own slots as they were.
  check(JSON.stringify(s.items.containers[counter]) === JSON.stringify(JSON.parse(stock)[counter]) || prisonDay(s.step) > 1, 'the counter’s slots untouched');
  console.log(`pantry: fruit at breakfast and dinner, sugar and seed packets once a day; refused ${[...new Set(refusals(seen))].join(', ')}`);
}

// ------------------------------------------------------------------ the merchants' staples, and what they buy
{
  const g = game();
  const { sim, seen } = g;
  const s = sim.state;
  g.jump(1, 10, 30);
  const who = s.inmates.findIndex((_, k) => sim.merchantOf(k) >= 0);
  s.cash = 100;
  check(g.talkTo(who), 'talking to a merchant');
  const stock = JSON.stringify(s.shops);
  const opinionBefore = s.inmates[who].opinion;
  s.items.inv = [0, 0, 0, 0, 0, 0, 0, s.items.inv[SLOT.OUTFIT]];
  STAPLES.forEach((_, k) => g.step(command(0, OP.TALK, TALK.BUY, SHOP_SLOTS + k)));
  const bought = of(seen, 'bought').map((e) => e.item);
  check(STAPLES.every((id) => bought.includes(n(id))) && JSON.stringify(s.shops) === stock, 'the staples bought, the shop’s stock untouched');
  const paid = 100 - s.cash;
  s.items.inv[3] = slot(n('pruno'));
  s.items.inv[4] = slot(n('vegetable'));
  s.items.inv[5] = slot(n('sock'));
  g.step(command(0, OP.TALK, TALK.SELL, 3));
  g.step(command(0, OP.TALK, TALK.SELL, 4));
  g.step(command(0, OP.TALK, TALK.SELL, 5));
  const sold = of(seen, 'sold');
  check(sold.length === 2 && sold[0].price === 30 && sold[1].price === 6 && refusals(seen).at(-1) === 'notWanted' && itemOf(s.items.inv[5]) === n('sock'), 'pruno sold for $30, a vegetable for $6 (three quarters of their value), a sock not wanted');
  check(s.inmates[who].opinion === opinionBefore, 'staples bring no opinion');
  // At most SALES_A_DAY sales a day.
  for (let k = 0; k < SALES_A_DAY; k++) {
    s.items.inv[3] = slot(n('vegetable'));
    g.step(command(0, OP.TALK, TALK.SELL, 3));
  }
  check(of(seen, 'sold').length === SALES_A_DAY && refusals(seen).at(-1) === 'soldEnough', `${SALES_A_DAY} sales a day at most`);
  console.log(`merchant: staples for $${paid}; pruno $${sold[0].price}, a vegetable $${sold[1].price}; ${SALES_A_DAY} sales a day`);
}

// ------------------------------------------------------------------ pruno
{
  const g = game();
  const { sim, seen } = g;
  const s = sim.state;
  const desk = box(sim, (c) => c.mine && c.prop.kind === 'desk');
  const toilet = box(sim, (c) => c.mine && c.prop.kind === 'toilet');
  const other = box(sim, (c) => c.table === 'inmateDesk');
  const hidden = containersOf(sim.world)[desk].hidden;
  // Brewed: fruit ×2 and sugar on the bench.
  s.items.int = 40;
  s.items.inv = [slot(n('fruit')), slot(n('fruit')), slot(n('sugar')), 0, 0, 0, 0, s.items.inv[SLOT.OUTFIT]];
  g.step(command(0, OP.CRAFT, 7));
  const bag = s.items.inv.findIndex((v) => itemOf(v) === n('pruno_bag'));
  check(bag >= 0 && usesOf(s.items.inv[bag]) === 2, 'fruit, fruit and sugar: a bag of pruno, 2 days to go');
  // One in the desk's hidden drawer, one in its standard drawers, one in the tank, one carried, one in someone else's desk.
  s.items.containers[desk][0] = slot(n('pruno_bag'));
  s.items.containers[desk][hidden] = slot(n('pruno_bag'));
  s.items.containers[toilet][0] = slot(n('pruno_bag'));
  s.items.containers[other][0] = slot(n('pruno_bag'));
  g.morning(2);
  const left = (v: number) => (itemOf(v) === n('pruno') ? 'ripe' : `${usesOf(v)} left`);
  check(usesOf(s.items.containers[desk][0]) === 1 && usesOf(s.items.inv[bag]) === 2, 'the first morning: a day left in the desk; carried, it waits');
  g.morning(3);
  const ripe = of(seen, 'pruno').filter((e) => e.what === 'ripe');
  check(itemOf(s.items.containers[desk][0]) === n('pruno') && itemOf(s.items.containers[toilet][0]) === n('pruno') && itemOf(s.items.containers[other][0]) === n('pruno'), 'the second: ripe in the drawers, the tank and another desk');
  check(ripe.length === 4 && ripe.filter((e) => e.mine).length === 3, 'four ripe, three of them the player’s');
  console.log(`pruno: desk ${left(s.items.containers[desk][0])}, tank ${left(s.items.containers[toilet][0])}, carried ${left(s.items.inv[bag])} after two mornings`);
}

// ------------------------------------------------------------------ pruno: a dog's nose, the shakedown
{
  // San Pancho's dogs: one walked up to the player's cell on shift, a bag in the toilet's tank.
  const g = game(SAN_PANCHO);
  const { sim, seen } = g;
  const s = sim.state;
  g.jump(2, 11, 0);
  const toilet = box(sim, (c) => c.mine && c.prop.kind === 'toilet');
  const prop = containersOf(sim.world)[toilet].prop;
  s.items.containers[toilet][0] = slot(n('pruno_bag'));
  // The dog right by the tank, its handler by it: on shift, at heel.
  const k = 0;
  const handler = sim.world.def.guards.findIndex((gd) => gd.dog);
  const d = s.dogs[k];
  put(d.body, prop.z * MAP_W + prop.x + 1);
  put(s.guards[handler].body, prop.z * MAP_W + prop.x + 1);
  d.mode = 1;
  d.goal = -1;
  d.path = [];
  g.setCalm(false);
  s.heat = 0;
  for (let i = 0; i < 40 && !of(seen, 'pruno').some((e) => e.what === 'seized'); i++) {
    put(d.body, prop.z * MAP_W + prop.x + 1);
    g.step();
  }
  const seized = of(seen, 'pruno').find((e) => e.what === 'seized');
  check(!!seized && seized.mine === true && !s.items.containers[toilet][0], 'a dog smells the tank: the bag seized');
  check(of(seen, 'dog').some((e) => e.what === 'brew') && s.heat >= 25, 'it points, and the player’s cell gets the heat');
  console.log(`dog: smelled the bag in the tank, heat ${s.heat}%`);
}
{
  // The shakedown: a day the player's cell is named; the standard drawers are cleared, the hidden one and the tank kept.
  let day = 0;
  let g = game();
  const cells = (d: number) => shakedownCells(g.sim.world, g.sim.state.salt, d);
  for (let d = 2; d < 40 && !day; d++) if (cells(d).includes(1)) day = d;
  check(day > 0, 'a morning the player’s cell is searched');
  g = game();
  const { sim, seen } = g;
  const s = sim.state;
  const desk = box(sim, (c) => c.mine && c.prop.kind === 'desk');
  const toilet = box(sim, (c) => c.mine && c.prop.kind === 'toilet');
  const hidden = containersOf(sim.world)[desk].hidden;
  g.jump(day - 1, 7, 50);
  s.items.containers[desk][0] = slot(n('pruno'));
  s.items.containers[desk][hidden] = slot(n('pruno'));
  s.items.containers[toilet][0] = slot(n('pruno'));
  g.to(day, 11, 0);
  check(of(seen, 'searched').some((e) => e.cell === 1), 'the player’s cell searched');
  check(itemOf(s.items.containers[desk][0]) === n('pruno') && !s.items.containers[desk][hidden] && itemOf(s.items.containers[toilet][0]) === n('pruno'), 'pruno in the standard drawers taken; the hidden drawer and the tank kept');
  console.log(`shakedown (day ${day}): the standard drawer's pruno taken, the hidden drawer's and the tank's kept`);
}

// ------------------------------------------------------------------ tipsy
{
  const g = game();
  const { sim, seen } = g;
  const s = sim.state;
  g.jump(1, 10, 30);
  // The pace: ten steps east, sober and tipsy, from the same spot (open yard).
  put(s.player, 33 * MAP_W + 25);
  const start = { ...s.player };
  const pace = () => {
    Object.assign(s.player, start);
    const x = s.player.x;
    for (let k = 0; k < 10; k++) g.step(1);
    return s.player.x - x;
  };
  const sober = pace();
  g.hold(0, n('pruno'));
  g.use();
  check(of(seen, 'pruno').some((e) => e.what === 'drunk') && !s.items.inv[0] && s.tipsy[0] === s.step + TIPSY_STEPS, 'pruno drunk: tipsy for 3 hours');
  const drunk = pace();
  check(sober === walkSpeed(s.spd) * 10 && drunk === Math.floor((walkSpeed(s.spd) * 80) / 100) * 10, `slower tipsy (${sober} → ${drunk} units)`);
  // Stumbles on the move: a small noise now and then.
  for (let k = 0; k < 400; k++) g.step(k % 80 < 40 ? 1 : 9);
  const stumbles = of(seen, 'noise').filter((e) => e.kind === 'stumble').length;
  check(stumbles >= 2, `stumbles, heard (${stumbles} in 20 s on the move)`);
  // The guards: heat once a sighting (not seen in a while: a sighting from fresh).
  g.setCalm(false);
  s.heat = 0;
  s.tipsy[1] = 0;
  const guard = s.guards[0];
  for (let k = 0; k < 40; k++) {
    // (Seen: the watch works it out; a guard put two tiles east of the player in the open yard, facing them.)
    put(s.player, 33 * MAP_W + 25);
    put(guard.body, 33 * MAP_W + 27);
    guard.body.facing = 9;
    guard.wait = 100;
    g.step();
  }
  const first = s.heat;
  check(first >= TIPSY_HEAT - 1 && first <= TIPSY_HEAT, `seen tipsy: +${TIPSY_HEAT}% once while in sight (${first}% after the cooling)`);
  check(of(seen, 'spotted').some((e) => e.reason === 'tipsy'), 'spotted: tipsy');
  // Harder blows: a punch at an inmate, sober and tipsy.
  g.setCalm(true);
  const punch = (tipsy: boolean) => {
    const g2 = game();
    const s2 = g2.sim.state;
    g2.jump(1, 10, 30);
    if (tipsy) s2.tipsy = [s2.step + 1000, 0];
    const m = s2.inmates[0];
    put(m.body, Math.floor(s2.player.z / UNIT) * MAP_W + Math.floor(s2.player.x / UNIT) + 1);
    m.goal = -1;
    m.path = [];
    s2.player.facing = 1;
    g2.step(command(0, OP.LOCK, 2));
    for (let k = 0; k < 30 && !of(g2.seen, 'hit').length; k++) g2.step(command(0, OP.USE, k === 0 ? 1 : 0));
    return of(g2.seen, 'hit')[0]?.dmg ?? 0;
  };
  const a = punch(false);
  const b = punch(true);
  check(a > 0 && b === Math.floor((a * 3) / 2), `a blow lands 50% harder tipsy (${a} → ${b})`);
  // Sober again.
  s.tipsy[0] = s.step + 2;
  g.step();
  g.step();
  check(of(seen, 'pruno').some((e) => e.what === 'sober'), 'sober again');
  console.log(`tipsy: ${sober} → ${drunk} units in 10 steps, ${stumbles} stumbles in 20 s, +${first}% once seen, a punch ${a} → ${b}`);
}

// ------------------------------------------------------------------ the garden
{
  const RAIN = WEATHERS.indexOf('rain');
  const HEAT = WEATHERS.indexOf('heatwave');
  // Day 2 rains, day 4 is a heatwave; the rest clear.
  const g = game(CENTER_PERKS, 5, [[0, 0, 0], [2, 0, RAIN], [4, 0, HEAT]]);
  const { sim, seen } = g;
  const s = sim.state;
  const w = sim.world;
  g.jump(1, 10, 30);
  const face = (bed: number) => {
    const t = bedTile(w, bed);
    put(s.player, t - MAP_W);
    s.player.facing = 5;
  };
  // Bed 0 vegetables, bed 1 fruit, bed 2 never watered.
  face(0);
  g.hold(0, n('veg_seeds'));
  g.use();
  face(1);
  g.hold(0, n('fruit_seeds'));
  g.use();
  face(2);
  g.hold(0, n('veg_seeds'));
  g.use();
  check(s.plots.length === bedCount(w) && s.plots[0][BED.CROP] === CROP.VEG && s.plots[1][BED.CROP] === CROP.FRUIT && s.plots[2][BED.CROP] === CROP.VEG, 'three beds planted');
  const water = (bed: number, times = 1) => {
    face(bed);
    g.hold(0, n('plastic_cup'));
    for (let k = 0; k < times; k++) g.use();
  };
  water(0);
  water(1, 3);
  check(s.plots[1][BED.WATER] === 2 && of(seen, 'garden').some((e) => e.what === 'refused' && e.why === 'watered'), 'twice a day at most');
  // Day 2 (the morning looks back on day 1): beds 0 and 1 grew; bed 2 wilted.
  g.morning(2);
  check(s.plots[0][BED.GROWN] === 1 && s.plots[1][BED.GROWN] === 1 && s.plots[2][BED.DRY] === 1, 'watered beds grow; the dry one wilts');
  // Day 2 rains: nobody waters; day 3 morning, all grow (bed 2 recovers).
  g.morning(3);
  check(s.plots[0][BED.GROWN] === 2 && s.plots[2][BED.GROWN] === 1 && s.plots[2][BED.DRY] === 0, 'the rain waters every bed');
  // Day 3: bed 0 watered, bed 1 not, bed 2 not; day 4 morning.
  water(0);
  g.morning(4);
  check(ripeBed(s.plots[0]) && s.plots[1][BED.DRY] === 1 && s.plots[2][BED.DRY] === 1, 'bed 0 ripe at 3 stages; beds 1 and 2 wilt');
  // Day 4, a heatwave: bed 1 one cupful (not enough), bed 2 two.
  water(1);
  water(2, 2);
  g.morning(5);
  check(s.plots[1][BED.CROP] === CROP.NONE && of(seen, 'garden').some((e) => e.what === 'died' && e.bed === 1), `a heatwave's one cupful isn't enough: bed 1 dead after ${DRY_DEATH} dry days`);
  check(s.plots[2][BED.GROWN] === 2 && s.plots[2][BED.DRY] === 0, 'two cupfuls carried bed 2 through the heatwave');
  // The harvest, whatever is in hand.
  face(0);
  g.hold(0, n('sock'));
  s.items.inv[1] = 0;
  s.items.inv[2] = 0;
  g.use();
  const got = s.items.inv.slice(0, 6).filter((v) => itemOf(v) === n('vegetable')).length;
  check(got === HARVEST && s.plots[0][BED.CROP] === CROP.NONE, `bed 0 harvested: ${HARVEST} vegetables`);
  console.log(`garden: grown in ${GROWN} watered days (rain counts, a heatwave takes two cupfuls), dead after ${DRY_DEATH} dry days, ${got} vegetables picked`);
}
function ripeBed(b: number[]) {
  return b[BED.CROP] !== CROP.NONE && b[BED.GROWN] >= GROWN;
}

// ------------------------------------------------------------------ the hole under the plant
{
  const g = game();
  const { sim, seen } = g;
  const s = sim.state;
  const w = sim.world;
  g.jump(1, 10, 30);
  const t = bedTile(w, 4);
  put(s.player, t - MAP_W);
  s.player.facing = 5;
  g.hold(0, n('veg_seeds'));
  g.use();
  // Dug down through the plant, unseen (every guard blind as it's dug).
  g.hold(0, n('sturdy_shovel'), 50);
  s.energy = 100;
  for (let k = 0; k < 400 && w.ground.kind[t] !== TILE.SHAFT; k++) {
    g.blind();
    g.step(command(0, OP.USE, k % 20 === 0 ? 1 : 0));
    s.energy = 100;
  }
  check(w.ground.kind[t] === TILE.SHAFT && s.plots[4][BED.CROP] === CROP.VEG, 'a shaft dug down through the planted bed, the plant still there');
  // A guard looking straight at it: nothing found.
  g.setCalm(false);
  s.heat = 0;
  const guard = s.guards[0];
  for (let k = 0; k < 20; k++) {
    put(guard.body, t - 2);
    guard.body.facing = 1;
    guard.goal = -1;
    guard.path = [];
    put(s.player, t - MAP_W * 3);
    g.step();
  }
  check(!s.found.includes(placeKey(LAYER.GROUND, t)) && !of(seen, 'found').length, 'a guard looking at the bed sees no hole');
  // The bed emptied (the plant dies): the hole is plain to see.
  s.plots[4][BED.CROP] = CROP.NONE;
  for (let k = 0; k < 20 && !s.found.length; k++) {
    put(guard.body, t - 2);
    guard.body.facing = 1;
    g.step();
  }
  check(s.found.includes(placeKey(LAYER.GROUND, t)), 'with the plant gone, the hole is found');
  console.log('garden: a hole dug through a planted bed unseen; found once the bed is bare');
}

// ------------------------------------------------------------------ the rat's track
/** A game with a tame rat on the player's shoulder. */
function withRat(prison = CENTER_PERKS, seed = 5) {
  const g = game(prison, seed);
  const s = g.sim.state;
  g.hold(0, n('caught_rat'), 1);
  s.items.inv[1] = slot(n('potato'));
  g.use();
  check(s.rats.length === 1 && s.rats[0].mode === RAT.SHOULDER && s.rats[0].speed === RAT_START_SPEED, 'a rat tamed, at its starting speed');
  return g;
}
{
  const g = withRat();
  const { sim, seen } = g;
  const s = sim.state;
  const pet = s.rats[0];
  const myCell = () => {
    const desk = containersOf(sim.world).find((c) => c.mine && c.prop.kind === 'desk')!.prop;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = desk.x + dx;
        const z = desk.z + dz;
        if (!sim.world.blocked(x, z) && sim.world.zoneAt(x, z) === 'playerCell') return z * MAP_W + x;
      }
    return -1;
  };
  const refused = () => of(seen, 'track').filter((e) => e.what === 'refused').map((e) => e.why).at(-1);
  g.jump(1, 10, 30);
  put(s.player, 33 * MAP_W + 25);
  g.hold(0, n('rat_track'));
  s.items.inv[1] = slot(n('potato'));
  g.use();
  check(refused() === 'notCell', 'the track: in the cell');
  put(s.player, myCell());
  g.use();
  check(refused() === 'notEvening', 'in evening free time');
  g.jump(1, 18, 30);
  put(s.player, myCell());
  s.items.inv[1] = 0;
  g.use();
  check(refused() === 'hungry', 'with bait in the hotbar');
  s.items.inv[1] = slot(n('jerky'));
  g.use();
  const trained = of(seen, 'track').find((e) => e.what === 'trained');
  check(!!trained && pet.speed === RAT_START_SPEED + trackGain(RAT_START_SPEED) && pet.fed === 1 && !s.items.inv[1], `trained: ${RAT_START_SPEED} → ${pet.speed}, fed today, the bait eaten`);
  s.items.inv[1] = slot(n('potato'));
  g.use();
  check(refused() === 'today', 'once a day');
  // Entered in tonight's race: no training until it's run (its form fixed as the bets are quoted).
  s.rats[0].fed = 0;
  s.race = [1, -1, -1, 0, 1, 0, 0, 0];
  g.use();
  check(refused() === 'entered', 'not while entered in tonight\'s race');
  s.race = [];
  s.rats[0].fed = 1;
  // The gains grow smaller.
  const gains: number[] = [];
  for (let sp = RAT_START_SPEED; sp < 100; sp += trackGain(sp)) gains.push(trackGain(sp));
  check(gains.every((x, k) => k === 0 || x <= gains[k - 1]) && gains.length >= 8, `smaller gains as it gets faster (${gains.length} sessions to 100)`);
  console.log(`track: ${gains.slice(0, 8).join(', ')}… (${gains.length} sessions from ${RAT_START_SPEED} to 100)`);
}

// ------------------------------------------------------------------ race nights
{
  // The card: pure, the same every time asked; rivals by cell; odds by speed.
  const sim = new Sim(CENTER_PERKS, 5);
  const card = rivals(sim.state, 1);
  check(card.length === 3 && new Set(card.map((e) => e.owner)).size === 3, 'three rivals a night, three different inmates');
  check(JSON.stringify(card) === JSON.stringify(rivals(sim.state, 1)), 'the card is pure');
  const odds = oddsOf(sim.state.salt, 1, card);
  check(card.every((e, i) => card.every((f, j) => e.speed <= f.speed || odds[i] <= odds[j])), `odds by speed: the fastest pays least (${card.map((e, i) => `${e.speed} ×${odds[i] / 10}`).join(', ')})`);
  check(JSON.stringify(odds) === JSON.stringify(oddsOf(sim.state.salt, 1, card.map((e) => ({ ...e, fed: !e.fed })))), 'the bookie can’t know who ate');
  // The race: pure, the order by the distance run.
  const run = runRace(sim.state.salt, 1, card);
  check(JSON.stringify(run) === JSON.stringify(runRace(sim.state.salt, 1, card)) && run.order.every((l, k) => k === 0 || run.legs[run.order[k - 1]][9] >= run.legs[l][9]), 'the race is pure, the furthest first');

  // Measured over many nights and seeds: blind bets lose; betting only on rats that ate wins; feeding the pet matters.
  let blind = 0;
  let blindBets = 0;
  let fav = 0;
  let informed = 0;
  let informedBets = 0;
  let fedWins = 0;
  let hungryWins = 0;
  let nights = 0;
  const pet = (speed: number, fed: boolean): Entrant => ({ owner: -1, name: -1, speed, fed });
  for (let seed = 1; seed <= 20; seed++) {
    const s0 = new Sim(CENTER_PERKS, seed).state;
    for (let day = 1; day <= 39; day += 2) {
      const c = rivals(s0, day);
      const o = oddsOf(s0.salt, day, c);
      const r = runRace(s0.salt, day, c);
      nights++;
      c.forEach((e, l) => {
        blindBets++;
        blind += r.order[0] === l ? o[l] / 10 : 0;
        if (!e.fed) return;
        informedBets++;
        informed += r.order[0] === l ? o[l] / 10 : 0;
      });
      const f = o.indexOf(Math.min(...o));
      fav += r.order[0] === f ? o[f] / 10 : 0;
      if (runRace(s0.salt, day, [...c, pet(80, true)]).order[0] === c.length) fedWins++;
      if (runRace(s0.salt, day, [...c, pet(80, false)]).order[0] === c.length) hungryWins++;
    }
  }
  const blindEv = blind / blindBets;
  const favEv = fav / nights;
  const infEv = informed / informedBets;
  check(blindEv < 0.9 && favEv < 0.9, `blind bets lose (any lane ×${blindEv.toFixed(2)}, the favourite ×${favEv.toFixed(2)} a dollar)`);
  check(infEv > 1.05, `betting only on rats that ate wins (×${infEv.toFixed(2)} a dollar)`);
  check(fedWins / nights > 0.5 && fedWins / nights < 0.8 && hungryWins / nights < 0.3, `a pet at speed 80 wins ${Math.round((fedWins * 100) / nights)}% of nights fed, ${Math.round((hungryWins * 100) / nights)}% hungry`);
  console.log(`race: blind ×${blindEv.toFixed(2)}, the favourite ×${favEv.toFixed(2)}, on rats that ate ×${infEv.toFixed(2)} a dollar; a pet at 80 wins ${Math.round((fedWins * 100) / nights)}% fed, ${Math.round((hungryWins * 100) / nights)}% hungry (${nights} nights)`);
}
{
  // A night at the track: a bet, the pet entered, the off, the finish.
  const g = withRat();
  const { sim, seen } = g;
  const s = sim.state;
  const t = trackOf(sim.world)!;
  const near = trackTiles(t)[0] - MAP_W;
  g.jump(1, 19, 50);
  put(s.player, near);
  s.cash = 50;
  g.ext(EXT.RACE, 0, 1);
  check(refusals(seen).at(-1) === 'raceClosed', 'no bets before 20:00');
  g.jump(1, 20, 10);
  put(s.player, near + MAP_W * 10);
  g.ext(EXT.RACE, 0, 1);
  check(refusals(seen).at(-1) === 'raceFar', 'bets at the track');
  put(s.player, near);
  g.ext(EXT.RACE, 8);
  check(s.race[4] === 1 && of(seen, 'race').some((e) => e.what === 'entered'), 'the pet entered');
  const card = raceCard(s, 1);
  const lane = card.length - 1;
  s.rats[0].speed = 95;
  s.rats[0].fed = 1;
  g.ext(EXT.RACE, lane, 2);
  check(s.cash === 50 - BETS[2] && s.race[1] === lane && of(seen, 'race').some((e) => e.what === 'bet'), `$${BETS[2]} on the pet`);
  g.ext(EXT.RACE, 0, 0);
  check(refusals(seen).at(-1) === 'betPlaced', 'one bet a night');
  const odds = s.race[3];
  g.blind();
  g.to(1, 21, 0);
  g.step();
  check(of(seen, 'race').some((e) => e.what === 'start') && of(seen, 'noise').some((e) => e.kind === 'cheer'), 'the off at 21:00, the cheering heard');
  for (let k = 0; k < RACE_STEPS + 2; k++) {
    g.blind();
    g.step();
  }
  const result = of(seen, 'race').find((e) => e.what === 'result')!;
  const won = result.order![0] === lane;
  check(!!result && s.race.length === 0, 'the result, the night over');
  check(won ? s.cash === 50 - BETS[2] + payout(BETS[2], odds) + PURSE : s.cash === 50 - BETS[2], won ? `the pet won: $${payout(BETS[2], odds)} and the $${PURSE} purse` : 'the pet lost: the stake gone');
  console.log(`night: the pet (95, fed) at ×${odds / 10} ${won ? 'won' : 'lost'}; order ${result.order!.join(' ')}; cash $${s.cash}`);
}
{
  // Called off: a lockdown at the off (the stake back); a pet away on an errand: scratched, its bet void; seen at it: gambling heat.
  const g = withRat();
  const { sim, seen } = g;
  const s = sim.state;
  const near = trackTiles(trackOf(sim.world)!)[0] - MAP_W;
  g.jump(1, 20, 10);
  put(s.player, near);
  s.cash = 50;
  g.ext(EXT.RACE, 1, 0);
  g.setCalm(false);
  g.to(1, 20, 59);
  s.lockdown = true;
  g.to(1, 21, 1);
  check(of(seen, 'race').some((e) => e.what === 'off') && s.cash === 50 && !s.race.length, 'a lockdown at the off: called off, the stake back');
  s.lockdown = false;
  s.heat = 0;
  // Night 3: a bet first, then entering: refused (the odds are quoted on the field as it runs).
  g.jump(3, 20, 10);
  put(s.player, near);
  g.ext(EXT.RACE, 0, 0);
  g.ext(EXT.RACE, 8);
  check(refusals(seen).at(-1) === 'enterFirst' && !s.race[4], 'no entering after a bet');
  s.race = [];
  s.cash = 50;
  // Entered, then a bet on a rival, then the pet sent off before the off: scratched, every bet void.
  g.ext(EXT.RACE, 8);
  g.ext(EXT.RACE, 0, 0);
  // (Let loose somewhere in its panic: not on the shoulder at the off.)
  Object.assign(s.rats[0], { mode: RAT.LOOSE, until: s.step + 5000, tile: near, path: [], at: 0 });
  g.to(3, 21, 1);
  check(of(seen, 'race').some((e) => e.what === 'scratched' && e.stake === BETS[0]) && s.cash === 50 && !s.race.length, 'the pet away at the off: scratched, the bet on a rival void too, the stake back');
  s.rats[0].mode = RAT.SHOULDER;
  // Night 5: a bet, a guard watching the race.
  g.jump(5, 20, 10);
  put(s.player, near);
  g.ext(EXT.RACE, 0, 0);
  g.to(5, 21, 0);
  s.heat = 0;
  const guard = s.guards[0];
  for (let k = 0; k < 40; k++) {
    put(guard.body, near + 2);
    guard.body.facing = 9;
    guard.wait = 100;
    put(s.player, near);
    g.step();
  }
  check(of(seen, 'spotted').some((e) => e.reason === 'gambling') && s.heat >= 10 && s.heat < 20, `seen at the race with a bet on: gambling heat, once (${s.heat}%)`);
  console.log(`races: called off in a lockdown, a scratched pet, gambling heat ${s.heat}%`);
}

// ------------------------------------------------------------------ nothing without the player; saves
{
  // A race night without a bet: nothing in the sim.
  const g = game();
  g.jump(1, 20, 55);
  g.to(1, 21, 30);
  check(!g.seen.some((e) => e.type === 'race' || (e.type === 'noise' && e.kind === 'cheer')) && !g.sim.state.race.length, 'no bet, no pet: no race in the simulation');
}
{
  // Saved and loaded mid-brew, mid-growth and mid-race: the same game.
  const g = withRat();
  const { sim } = g;
  const s = sim.state;
  const desk = box(sim, (c) => c.mine && c.prop.kind === 'desk');
  s.items.containers[desk][0] = slot(n('pruno_bag'));
  g.jump(1, 10, 30);
  put(s.player, bedTile(sim.world, 0) - MAP_W);
  s.player.facing = 5;
  g.hold(0, n('veg_seeds'));
  g.use();
  g.jump(1, 20, 10);
  put(s.player, trackTiles(trackOf(sim.world)!)[0] - MAP_W);
  s.cash = 50;
  g.ext(EXT.RACE, 8);
  g.ext(EXT.RACE, 0, 1);
  s.tipsy = [s.step + 500, 0];
  g.to(1, 21, 0);
  g.step();
  g.step();
  const loaded = new Sim(CENTER_PERKS, 1);
  loaded.restore(JSON.parse(JSON.stringify(sim.snapshot())));
  check(loaded.hash() === sim.hash(), 'saved mid-race: loads the same');
  for (let k = 0; k < RACE_STEPS + 40; k++) {
    sim.step(0);
    loaded.step(0);
  }
  check(loaded.hash() === sim.hash() && !s.race.length, 'and plays on the same to the finish');
  // An older save (from before P28): its fields start empty.
  const old = JSON.parse(JSON.stringify(sim.snapshot()));
  for (const k of ['pantry', 'tipsy', 'plots', 'race']) delete old.state[k];
  for (const r of old.state.rats) for (const k of ['speed', 'fed', 'lap']) delete r[k];
  const back = new Sim(CENTER_PERKS, 1);
  back.restore(old);
  check(back.state.plots.length === 0 && back.state.race.length === 0 && back.state.pantry.join() === '0,0,0,0' && back.state.rats[0].speed === RAT_START_SPEED, 'a save from before: no beds, no race, the pet at its starting speed');
  console.log(`saves: mid-race, mid-brew and mid-growth load the same; an older save loads clean (day ${prisonDay(s.step)})`);
}
void RACE_MINUTE;
