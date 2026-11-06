/**
 * The vending machine (2.32): every prison's machine and its queue tiles, a buy walked by real commands, what's
 * refused and costs nothing, jams and thumps, walking away, what shuts it, the rows through the days, inmates at it on
 * many seeds, pushing in, and old logs as they were.
 */
import { itemDef, itemNumber } from '../src/content/items';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { COIL_STEPS, DELIVERY_EXTRA, GOODS, rowCode, SNACK_ROWS, THUMP_STEPS, VEND, VEND_TURN_STEPS } from '../src/content/vending';
import { isFloor, placesOf } from '../src/sim/ai/places';
import { EXT, OP } from '../src/sim/command';
import { replayLog, RunRecorder } from '../src/sim/runlog';
import { Sim } from '../src/sim/Sim';
import { DAY_STEPS, eventOn, planOf, prisonDay } from '../src/sim/systems/calendar';
import { hurt } from '../src/sim/systems/fights';
import { fixtureUse, HOTBAR, itemOf, slot } from '../src/sim/systems/items';
import { canDigFloor } from '../src/sim/systems/structure';
import {
  atVending,
  cutPast,
  jamsAt,
  peopleAhead,
  VEND_NOBODY,
  VEND_PLAYER,
  vendOffer,
  vendProp,
  vendRefusal,
} from '../src/sim/systems/vending';
import { UNIT } from '../src/sim/tuning';
import { LAYER, MAP_W, placeKey } from '../src/sim/world/World';
import { LESSONS } from '../src/tutorial/lessons';
import type { LessonCtx } from '../src/tutorial/kit';
import { Bot, DIR, tileOf } from './bots';

let failures = 0;
const check = (ok: boolean, what: string) => {
  if (!ok) {
    failures++;
    console.log(`FAIL ${what}`);
  }
};
const MACHINES = PRISONS;

/** Up to the machine in the morning's free time, its card open. */
function atMachine(def = CENTER_PERKS, seed = 3, cash = 100): Bot {
  const bot = new Bot(def, seed);
  bot.routineUntil(1, 10 * 60 + 1);
  bot.st.cash = cash;
  bot.st.energy = 50;
  const m = def.vending!;
  check(bot.walkTo(tileOf(m.line[0].x, m.line[0].z)), `${def.id}: walks to the machine`);
  bot.face(DIR.NORTH);
  return bot;
}
const ask = (bot: Bot, b: number, c = 0) => bot.op(OP.EXT, EXT.VEND, b, c);
const events = (bot: Bot, what: string) => bot.sim.events.filter((e) => e.type === 'vend' && e.what === what);
/** Steps until the coil's done, the events kept. */
function coil(bot: Bot) {
  const seen: string[] = [];
  for (let k = 0; k < COIL_STEPS + 2; k++) {
    bot.step(0);
    for (const e of bot.sim.events) if (e.type === 'vend') seen.push(e.what);
  }
  return seen;
}
/** Waits out any queue ahead, keeping the place. */
function theirTurn(bot: Bot) {
  bot.until(() => peopleAhead(bot.sim) === 0 && bot.st.vend.who === VEND_NOBODY, 1200);
}

// ---------------------------------------------------------------- every prison's

for (const def of MACHINES) {
  const m = def.vending;
  if (!m) {
    failures++;
    console.log(`FAIL ${def.id}: no machine`);
    continue;
  }
  const sim = new Sim(def, 3);
  const w = sim.world;
  const p = vendProp(sim);
  check(!!p && w.zoneAt(m.x, m.z) === 'canteen', `${def.id}: a machine in the canteen`);
  // (2.33's water cooler after it: added later, last again.)
  check(
    sim.world.props.indexOf(p!) === sim.world.props.length - 1 - sim.world.props.filter((q) => q.kind === 'cooler').length,
    `${def.id}: its prop comes last, so that no index moves`,
  );
  check(w.propSolid[m.z * MAP_W + m.x] === 1, `${def.id}: solid`);
  const front = m.line[0];
  check(front.x === m.x && front.z === m.z + 1, `${def.id}: used from the south, the way it fronts and the camera looks`);
  check(TILE_WALL_BEHIND(w, m.x, m.z), `${def.id}: its back to something, not standing out in the room`);
  m.line.forEach((q, k) => {
    const tile = tileOf(q.x, q.z);
    check(isFloor(w, q.x, q.z) && w.zoneAt(q.x, q.z) === 'canteen', `${def.id}: queue tile ${k} on the canteen's floor`);
    check(
      !w.props.some((o) => q.x >= o.x && q.x < o.x + o.w && q.z >= o.z && q.z < o.z + o.d),
      `${def.id}: nothing stands on queue tile ${k}`,
    );
    check(!placesOf(w).counters.some((c) => c.tile === tile), `${def.id}: queue tile ${k} clear of where a tray is fetched`);
    if (k)
      check(Math.abs(q.x - m.line[k - 1].x) + Math.abs(q.z - m.line[k - 1].z) === 1, `${def.id}: queue tile ${k} next to the one before`);
  });
  check(
    !placesOf(w)
      .floor.flat()
      .includes(m.z * MAP_W + m.x),
    `${def.id}: nobody picks its tile`,
  );
  check(!def.decor?.some((d) => (d.kind as string) === 'vending'), `${def.id}: no machine left as scenery`);
  check(canDigFloor(w, m.z * MAP_W + m.x, []) === false, `${def.id}: no digging under it`);
}
function TILE_WALL_BEHIND(w: Sim['world'], x: number, z: number) {
  return w.blocked(x, z - 1) || w.blocked(x + 1, z) || w.blocked(x - 1, z);
}
check(PRISONS.every((p) => !!p.vending) && !new Sim(CENTER_PERKS, 3).rules231, 'every campaign prison has one');

// ---------------------------------------------------------------- a buy, walked, in each prison

const times: string[] = [];
for (const def of MACHINES) {
  const bot = atMachine(def, 5);
  const label = def.id;
  check(vendOffer(bot.sim), `${label}: the machine is the action button's`);
  bot.act();
  check(bot.st.vendOpen, `${label}: its card opens`);
  theirTurn(bot);
  const cash = bot.st.cash;
  const left = bot.st.vend.left[1];
  ask(bot, VEND.BUY, 1);
  check(bot.st.cash === cash - GOODS[1].price && bot.st.vend.left[1] === left - 1, `${label}: paid up front, one less`);
  const seen = coil(bot);
  check(seen.includes('got') && bot.slotOf('soda') >= 0, `${label}: the soda dropped into the pockets (${seen})`);
  check(bot.st.items.inv[bot.st.items.hand] % 256 === itemNumber('soda'), `${label}: and into the hand`);
  ask(bot, VEND.CLOSE);
  const was = bot.st.energy;
  bot.use();
  check(bot.st.energy === was + 12 && bot.slotOf('soda') < 0, `${label}: drunk with the tool button: +12 energy`);
  times.push(`${label} at the machine by ${bot.time}`);
}
console.log(`walked: ${times.join('; ')}`);

// ---------------------------------------------------------------- what it sells

for (const g of GOODS) {
  const d = itemDef(itemNumber(g.id));
  check(!d.contraband, `${g.id}: legal`);
  check(g.price > d.value, `${g.id}: costs more than it's worth, so nothing's made passing it on`);
}
check(rowCode(0) === 'A1' && rowCode(6) === 'C1', 'rows named on the glass');
{
  const bot = atMachine();
  bot.act();
  theirTurn(bot);
  const eats = [
    ['chocolate', 25, 0],
    ['coffee', 18, 0],
    ['crisps', 0, 10],
  ] as const;
  for (const [id, en, hp] of eats) {
    ask(bot, VEND.OPEN);
    theirTurn(bot);
    bot.st.vendBought = 0; // (No jams here: those come below.)
    bot.st.vend.jam = 0;
    ask(
      bot,
      VEND.BUY,
      GOODS.findIndex((g) => g.id === id),
    );
    coil(bot);
    check(bot.slotOf(id) >= 0, `${id}: bought`);
    ask(bot, VEND.CLOSE);
    bot.hold(id);
    bot.st.energy = 50;
    bot.st.health = 20;
    bot.use();
    const usedEn = bot.st.energy - 50;
    const usedHp = bot.st.health - 20;
    check(usedEn === en && (hp ? usedHp === hp : usedHp >= 0), `${id}: gives ${en} energy, ${hp} health (${usedEn}, ${usedHp})`);
    check(bot.slotOf(id) < 0, `${id}: gone`);
  }
  // Full up: it keeps for later.
  ask(bot, VEND.OPEN);
  theirTurn(bot);
  bot.st.vendBought = 0;
  ask(bot, VEND.BUY, 3);
  coil(bot);
  ask(bot, VEND.CLOSE);
  bot.hold('crisps');
  bot.st.health = 50 + bot.st.str;
  bot.use();
  check(bot.slotOf('crisps') >= 0, 'crisps at full health keep for later');
}

// ---------------------------------------------------------------- refused: nothing's taken

{
  const bot = atMachine(CENTER_PERKS, 3, 3);
  bot.act();
  theirTurn(bot);
  const tried = (what: string, why: string, row: number) => {
    const cash = bot.st.cash;
    const left = [...bot.st.vend.left];
    const n = bot.st.vendBought;
    ask(bot, VEND.BUY, row);
    const said = bot.sim.events.find((e) => e.type === 'refused');
    check(said?.type === 'refused' && said.why === why, `${what}: says ${why} (${JSON.stringify(said)})`);
    check(
      bot.st.cash === cash && left.every((x, k) => x === bot.st.vend.left[k]) && bot.st.vendBought === n && bot.st.vend.who === VEND_NOBODY,
      `${what}: nothing taken`,
    );
  };
  tried('no money', 'cash', 0);
  bot.st.cash = 100;
  bot.st.vend.left[0] = 0;
  tried('sold out', 'vendSoldOut', 0);
  bot.st.vend.left[0] = 3;
  const inv = [...bot.st.items.inv];
  for (let k = 0; k < 6; k++) bot.st.items.inv[k] = itemNumber('sock');
  tried('pockets full', 'vendPockets', 0);
  bot.st.items.inv.splice(0, inv.length, ...inv);
  bot.st.vend.jam = 2;
  bot.st.vend.hits = 1;
  tried('something stuck', 'vendStuck', 0);
  bot.st.vend.jam = 0;
  bot.st.vend.hits = 0;
  // A press with nothing stuck is nothing.
  ask(bot, VEND.THUMP);
  check(bot.st.vend.hit === 0 && !bot.sim.events.some((e) => e.type === 'noise'), 'a thump at nothing stuck makes no noise');
}

// ---------------------------------------------------------------- a jam

{
  // Fix which buy sticks.
  const jammed = (seed = 3, def = CENTER_PERKS) => {
    const bot = atMachine(def, seed);
    bot.act();
    theirTurn(bot);
    let n = 1;
    while (!jamsAt(bot.st.salt, n + 1)) n++;
    bot.st.vendBought = n;
    const cash = bot.st.cash;
    ask(bot, VEND.BUY, 1);
    const seen = coil(bot);
    check(seen.includes('jam') && bot.st.vend.jam === 2 && bot.slotOf('soda') < 0, `it sticks (${seen})`);
    check(bot.st.cash === cash - GOODS[1].price, 'and the money is gone');
    return bot;
  };
  const first = atMachine();
  first.act();
  theirTurn(first);
  // Whatever the rolls, the run's first buy comes out.
  check(first.st.vendBought === 0, 'nothing bought yet');
  for (let n = 1; n <= 40 && !jamsAt(first.st.salt, 1); n++) break;
  ask(first, VEND.BUY, 1);
  check(coil(first).includes('got'), "the run's first buy always comes out");
  // Thump: noise each time, a few thumps, at its own pace, then it's in the hand.
  const bot = jammed();
  const hits = bot.st.vend.hits;
  check(hits >= 1 && hits <= 3, `one to three thumps (${hits})`);
  let thumps = 0;
  let noises = 0;
  let safety = 0;
  while (bot.st.vend.jam && safety++ < 200) {
    ask(bot, VEND.THUMP);
    if (bot.sim.events.some((e) => e.type === 'vend' && e.what === 'thump')) thumps++;
    if (bot.sim.events.some((e) => e.type === 'noise' && e.kind === 'thump')) noises++;
  }
  check(thumps === hits && noises === hits, `each thump is loud, and that many do it (${thumps} ${noises} of ${hits})`);
  check(bot.slotOf('soda') >= 0, 'it came down into the hand');
  check(safety >= (hits - 1) * THUMP_STEPS, 'at most one thump every so many steps');
  // A guard watching: told once, a little heat, never a chase.
  const seen = jammed();
  seen.st.vend.hits = 3;
  const g = seen.st.guards[0];
  g.body.x = seen.st.player.x + UNIT;
  g.body.z = seen.st.player.z + UNIT;
  g.body.facing = 13;
  seen.st.heat = 0;
  let told = 0;
  safety = 0;
  while (seen.st.vend.jam && safety++ < 200) {
    g.body.x = seen.st.player.x + UNIT;
    g.body.z = seen.st.player.z + UNIT;
    ask(seen, VEND.THUMP);
    told += events(seen, 'toldOff').length;
  }
  check(told === 1, `a guard watching says so once a jam (${told})`);
  const hot = jammed();
  hot.st.heat = 99;
  hot.st.guards[0].body.x = hot.st.player.x + UNIT;
  hot.st.guards[0].body.z = hot.st.player.z + UNIT;
  const before = hot.st.heat;
  ask(hot, VEND.THUMP);
  check(hot.st.heat <= Math.max(before, 99), `it never tips into a chase on its own (${hot.st.heat})`);
  // Left stuck: the next thumper's, free; shut until then; gone with the morning's refill.
  const left = jammed();
  ask(left, VEND.CLOSE);
  check(left.st.vend.jam === 2 && !left.st.vendOpen, 'walked away, it stays stuck');
  const cash = left.st.cash;
  ask(left, VEND.OPEN);
  theirTurn(left);
  let n2 = 0;
  while (left.st.vend.jam && n2++ < 200) ask(left, VEND.THUMP);
  check(left.st.cash === cash && left.slotOf('soda') >= 0, 'back and thumped: nothing more to pay');
  const stay = jammed();
  ask(stay, VEND.CLOSE);
  stay.until(() => prisonDay(stay.st.step) === 2, 2 * DAY_STEPS);
  stay.step(0);
  check(stay.st.vend.jam === 0, "the morning's refill clears it");
}

// ---------------------------------------------------------------- walked away, knocked out, shut

{
  const bot = atMachine();
  bot.act();
  theirTurn(bot);
  ask(bot, VEND.BUY, 0);
  // Off in the middle of the turn: it's on the floor in front of the machine, and can be picked up.
  const m = CENTER_PERKS.vending!;
  bot.walkTo(tileOf(m.x, m.z + 4), 40);
  bot.until(() => bot.st.vend.who === VEND_NOBODY, 60);
  const front = tileOf(m.line[0].x, m.line[0].z);
  check(
    bot.st.items.ground.some(([k, v]) => k === front && v % 256 === itemNumber('chocolate')),
    'walked off mid-turn: on the floor in front of it',
  );
  check(!bot.st.vendOpen, 'and the card shut behind them');
  // A lockdown: its card shuts, the line clears; nothing sells.
  const lock = atMachine();
  lock.act();
  theirTurn(lock);
  lock.st.lockdown = true;
  lock.step(0);
  check(!lock.st.vendOpen && lock.st.vend.line.every((k) => k === VEND_PLAYER), 'a lockdown shuts its card and clears the line');
  check(vendRefusal(lock.sim, 0) === 'vendShut', 'and it sells nothing');
  lock.st.lockdown = false;
  // A power cut: dark, nothing sells.
  const dark = atMachine();
  dark.act();
  theirTurn(dark);
  dark.sim.world.props.forEach(() => undefined);
  dark.st.powerOff = 100000;
  dark.step(0);
  check(vendRefusal(dark.sim, 0) === 'vendDark', `a power cut: dark (${vendRefusal(dark.sim, 0)})`);
  // Knocked out mid-turn: the card shuts, the item's on the floor.
  const ko = atMachine();
  ko.act();
  theirTurn(ko);
  ask(ko, VEND.BUY, 0);
  ko.st.ko = 100;
  ko.until(() => ko.st.vend.who === VEND_NOBODY, 60);
  check(
    !ko.st.vendOpen && ko.slotOf('chocolate') < 0 && ko.st.items.ground.some(([, v]) => v % 256 === itemNumber('chocolate')),
    'knocked out mid-turn: on the floor',
  );
}

// ---------------------------------------------------------------- the rows through the days

{
  const bot = new Bot(CENTER_PERKS, 7);
  const seen: string[] = [];
  let was = 0;
  let deliveries = 0;
  for (let d = 1; d <= 8; d++) {
    bot.until(() => prisonDay(bot.st.step) === d, 2 * DAY_STEPS);
    bot.step(0);
    const extra = planOf(bot.sim, d).event === 'delivery' ? DELIVERY_EXTRA : 0;
    if (extra) deliveries++;
    GOODS.forEach((g, k) => check(bot.st.vend.left[k] === g.stock + extra, `day ${d}: ${g.id} filled (${bot.st.vend.left[k]})`));
    was = d;
  }
  seen.push(`${was} mornings refilled, ${deliveries} delivery days with one more a row`);
  console.log(`rows: ${seen.join('; ')}`);
}

// ---------------------------------------------------------------- inmates at it

{
  const lines: string[] = [];
  for (const def of MACHINES) {
    let bought = 0;
    let joined = 0;
    let most = 0;
    let stalled = 0;
    let leftAtNight = 0;
    let jams = 0;
    let rowsOut = 0;
    const SEEDS = [11, 12, 13, 14];
    const rowsBought = new Array(GOODS.length).fill(0);
    for (const seed of SEEDS) {
      const sim = new Sim(def, seed);
      const everJoined = new Set<number>();
      for (let k = 0; k < 3 * DAY_STEPS; k++) {
        sim.step(0);
        const v = sim.state.vend;
        most = Math.max(most, v.line.length);
        for (const q of v.line) everJoined.add(q);
        for (const e of sim.events) {
          if (e.type !== 'vend') continue;
          if (e.what === 'inmatePaid') {
            bought++;
            rowsBought[e.row ?? 0]++;
          }
          if (e.what === 'inmateJam') jams++;
          if (e.what === 'gaveUp' && e.row === undefined) stalled++;
        }
        // Standing where they are in the queue, not piled on one tile. (In the queue, at the machine: two on their way
        // brushing past each other in a doorway stop for a step, as anyone does.)
        if (k % 40 === 0) {
          const near = (q: number) =>
            Math.max(
              Math.abs(sim.state.inmates[q].body.x / UNIT - def.vending!.x),
              Math.abs(sim.state.inmates[q].body.z / UNIT - def.vending!.z),
            ) <= 4;
          const stood = v.line
            .filter((q) => q >= 0 && !sim.state.inmates[q].body.moving && near(q))
            .map((q) => Math.floor(sim.state.inmates[q].body.x / UNIT) + Math.floor(sim.state.inmates[q].body.z / UNIT) * MAP_W);
          check(new Set(stood).size === stood.length, `${def.id} seed ${seed}: two in the queue on one tile at step ${k}`);
        }
        if (sim.state.step % DAY_STEPS === 14 * 60 * 20) {
          leftAtNight += v.left.slice(0, SNACK_ROWS).reduce((a, b) => a + b, 0);
          if (v.left.slice(0, SNACK_ROWS).some((x) => x === 0)) rowsOut++;
        }
      }
      joined += everJoined.size;
      check(sim.state.vend.who === VEND_NOBODY || sim.state.vend.who >= -1, 'as it can be');
    }
    const days = 3 * SEEDS.length;
    lines.push(
      `${def.id}: ${(bought / days).toFixed(1)} bought a day, ${most} at most in the line, ${(leftAtNight / days).toFixed(1)} of 14 left at 22:00, a food row empty by then on ${rowsOut} of ${days} days, ${stalled} gave up, ${jams} jams`,
    );
    check(bought / days >= 2, `${def.id}: inmates do use it (${(bought / days).toFixed(1)} a day)`);
    check(stalled <= days, `${def.id}: few can't get to it (${stalled} in ${days} days)`);
    check(
      rowsBought.slice(SNACK_ROWS).every((x) => x === 0),
      `${def.id}: inmates buy food and drink, not toiletries`,
    );
  }
  console.log(`inmates: ${lines.join('; ')}`);
}

// ---------------------------------------------------------------- the queue

{
  // Find a moment with someone at it, the player arriving: they wait, or push in.
  const crowded = (seed: number) => {
    const bot = new Bot(CENTER_PERKS, seed);
    bot.routineUntil(1, 10 * 60 + 1);
    bot.st.cash = 100;
    const m = CENTER_PERKS.vending!;
    // Someone on their way, there first.
    bot.st.vend.line.push(1, 2);
    bot.st.inmates[1].body.x = m.line[0].x * UNIT + UNIT / 2;
    bot.st.inmates[1].body.z = m.line[0].z * UNIT + UNIT / 2;
    bot.st.inmates[2].body.x = m.line[1].x * UNIT + UNIT / 2;
    bot.st.inmates[2].body.z = m.line[1].z * UNIT + UNIT / 2;
    // The player beside them.
    bot.st.player.x = (m.x + 1) * UNIT + UNIT / 2;
    bot.st.player.z = (m.z + 1) * UNIT + UNIT / 2;
    bot.st.player.facing = DIR.WEST;
    ask(bot, VEND.OPEN);
    return bot;
  };
  const wait = crowded(3);
  check(wait.st.vendOpen && peopleAhead(wait.sim) >= 1, `someone there first: they come first (${peopleAhead(wait.sim)})`);
  check(
    vendRefusal(wait.sim, 0) === 'vendBusy' || vendRefusal(wait.sim, 0) === 'vendFirst',
    `and nothing can be bought yet (${vendRefusal(wait.sim, 0)})`,
  );
  ask(wait, VEND.WAIT);
  check(wait.st.vend.line[wait.st.vend.line.length - 1] === VEND_PLAYER, 'a place at the end of the line');
  const turned = wait.until(() => wait.st.vend.line[0] === VEND_PLAYER && wait.st.vend.who === VEND_NOBODY, 800);
  check(turned, 'their turn comes, inmates served');
  check(vendRefusal(wait.sim, 1) === null, `and it can be bought from then (${vendRefusal(wait.sim, 1)})`);
  // Pushing in: to the front, what those passed think of it.
  const cut = crowded(3);
  const op1 = cut.st.inmates[1].opinion;
  const op2 = cut.st.inmates[2].opinion;
  cut.st.vend.who = VEND_NOBODY;
  ask(cut, VEND.CUT);
  // (Unless the one pushed back swung at them: a blow ends the card, and the place with it.)
  const swung = events(cut, 'swing').length > 0;
  check(swung ? !cut.st.vendOpen : cut.st.vend.line[0] === VEND_PLAYER, `pushed in: at the front${swung ? ', or hit and off it' : ''}`);
  check(cut.st.inmates[1].opinion < op1 && cut.st.inmates[2].opinion < op2, 'and those passed think less of them');
  // A place come up a few tiles off keeps; walking off once at it ends it.
  const off = atMachine();
  off.st.vend.line = [VEND_PLAYER];
  off.st.vendOpen = true;
  off.st.vend.up = false;
  const m0 = CENTER_PERKS.vending!;
  off.st.player.x = (m0.x - 1) * UNIT + UNIT / 2;
  off.st.player.z = (m0.z + 3) * UNIT + UNIT / 2;
  off.step(0);
  check(off.st.vendOpen && off.st.vend.line[0] === VEND_PLAYER, 'a turn come up a few tiles off is kept');
  off.st.player.x = m0.x * UNIT + UNIT / 2;
  off.st.player.z = (m0.z + 1) * UNIT + UNIT / 2;
  off.step(0);
  off.st.player.z = (m0.z + 4) * UNIT + UNIT / 2;
  off.step(0);
  check(!off.st.vendOpen && !off.st.vend.line.includes(VEND_PLAYER), 'walking off once at it ends it');
  // From behind the wall it stands against: no.
  for (const def of MACHINES) {
    const m = def.vending!;
    const out = new Bot(def, 3);
    out.st.player.x = m.x * UNIT + UNIT / 2;
    out.st.player.z = (m.z - 1) * UNIT - UNIT / 8;
    if (out.sim.world.zoneAt(m.x, m.z - 2) !== 'canteen') check(!atVending(out.sim), `${def.id}: not from behind its wall`);
  }
  // A turn sat on with others waiting: to the back.
  const sat = crowded(3);
  // (Their turn by the queue's order: pushing in might bring a swing, and a blow ends the card.)
  sat.st.vend.who = VEND_NOBODY;
  sat.st.vend.line = [VEND_PLAYER, 1];
  sat.st.vend.turn = 0;
  sat.st.inmates.forEach((m) => (m.angry = 0));
  sat.st.vend.line = sat.st.vend.line.includes(1) ? sat.st.vend.line : [...sat.st.vend.line, 1];
  let lost = false;
  for (let k = 0; k < VEND_TURN_STEPS + 40 && !lost; k++) {
    sat.step(0);
    lost = sat.sim.events.some((e) => e.type === 'vend' && e.what === 'lostTurn');
    if (sat.st.vend.line.length < 2) sat.st.vend.line.push(1);
  }
  check(lost, 'a turn sat on with others waiting passes');
  // The button: faced, the machine's; turned to someone in the queue, theirs.
  const b = crowded(3);
  ask(b, VEND.CLOSE);
  b.st.player.x = CENTER_PERKS.vending!.x * UNIT + UNIT / 2 + UNIT;
  b.st.player.z = (CENTER_PERKS.vending!.z + 1) * UNIT;
  b.st.player.facing = DIR.WEST;
  const faces = vendOffer(b.sim);
  b.face(DIR.SOUTH);
  check(faces !== vendOffer(b.sim) || !faces, 'turned away, the machine gives the button back');
}

// ---------------------------------------------------------------- traps the review found

{
  // A jam: what's paid for isn't lost while they stand there, however late in the turn it came.
  const stuck = (seed = 3) => {
    const bot = atMachine(CENTER_PERKS, seed);
    bot.act();
    theirTurn(bot);
    let n = 1;
    while (!jamsAt(bot.st.salt, n + 1)) n++;
    bot.st.vendBought = n;
    return bot;
  };
  const late = stuck();
  const m = CENTER_PERKS.vending!;
  const behind = (bot: Bot, k: number) => {
    bot.st.vend.line = [VEND_PLAYER, k];
    bot.st.inmates[k].body.x = m.line[1].x * UNIT + UNIT / 2;
    bot.st.inmates[k].body.z = m.line[1].z * UNIT + UNIT / 2;
  };
  behind(late, 1);
  for (let k = 0; k < VEND_TURN_STEPS - COIL_STEPS - 5; k++) late.step(0);
  ask(late, VEND.BUY, 1);
  const seen: string[] = [];
  const watch = (bot: Bot, n: number) => {
    for (let k = 0; k < n; k++) {
      bot.step(0);
      for (const e of bot.sim.events) if (e.type === 'vend') seen.push(e.what);
    }
  };
  watch(late, COIL_STEPS + 2 + VEND_TURN_STEPS - 40);
  check(
    seen.includes('jam') && !seen.includes('lostTurn') && !seen.includes('inmateThump'),
    `a jam late in a turn: time left to thump it (${seen.join(' ')})`,
  );
  check(late.st.vend.jam > 0 && late.st.vend.line[0] === VEND_PLAYER, 'and it is still theirs');
  for (let k = 0; k < 4 && late.st.vend.jam; k++) {
    ask(late, VEND.THUMP);
    for (const e of late.sim.events) if (e.type === 'vend') seen.push(e.what);
    watch(late, THUMP_STEPS + 1);
  }
  check(
    seen.includes('freed') && seen.includes('got') && late.st.items.inv.some((v) => v && itemOf(v) === itemNumber('soda')),
    `thumped free, it is in the pockets (${seen.join(' ')}; jam ${late.st.vend.jam}, hits ${late.st.vend.hits})`,
  );
  // Alone at it a long while, someone setting out from far away: they aren't told they took too long.
  const alone = atMachine();
  alone.act();
  theirTurn(alone);
  let there = -1;
  let passed = -1;
  for (let k = 0; k < 2400 && passed < 0; k++) {
    if (k === VEND_TURN_STEPS + 60) {
      alone.st.vend.line.push(5);
      alone.st.inmates[5].body.x = 8 * UNIT;
      alone.st.inmates[5].body.z = 40 * UNIT;
    }
    alone.step(0);
    // (Whoever's next behind them: others come in the rush too.)
    const next = alone.st.inmates[alone.st.vend.line[1]]?.body;
    const near = !!next && Math.max(Math.abs(next.x - m.x * UNIT), Math.abs(next.z - m.z * UNIT)) <= 4 * UNIT;
    if (!near) there = -1;
    else if (there < 0) there = k;
    if (alone.sim.events.some((e) => e.type === 'vend' && e.what === 'lostTurn')) passed = k;
  }
  check(
    passed < 0 || (there >= 0 && passed - there >= VEND_TURN_STEPS),
    `the clock starts when someone's there (arrived ${there}, passed ${passed})`,
  );
  console.log(
    `turn clock: alone ${VEND_TURN_STEPS + 60} steps, then someone next in line within reach from step ${there}, the turn passed at ${passed}`,
  );

  // A blow ends the card: the fight's buttons come back.
  const hit = atMachine();
  hit.act();
  check(hit.st.vendOpen, 'the card up');
  hurt(hit.sim, 5, -1);
  check(!hit.st.vendOpen && !hit.st.vend.line.includes(VEND_PLAYER), 'a blow ends the card');

  for (const def of MACHINES) {
    const q = def.vending!;
    // What walking off left on the floor: the button there picks it up, in every prison.
    const floor = atMachine(def);
    const before = floor.st.items.inv.filter(Boolean).length;
    floor.st.items.ground.push([placeKey(LAYER.GROUND, q.line[0].z * MAP_W + q.line[0].x), slot(itemNumber('soda'))]);
    check(!vendOffer(floor.sim), `${def.id}: something on the floor comes before the machine`);
    floor.act();
    check(
      !floor.st.vendOpen && floor.st.items.ground.length === 0 && floor.st.items.inv.filter(Boolean).length === before + 1,
      `${def.id}: and is picked up`,
    );
    check(vendOffer(floor.sim), `${def.id}: then the machine`);
    // Round the back of it, where there's floor there: not from there.
    const back = new Bot(def, 3);
    back.st.player.x = q.x * UNIT + UNIT / 2;
    back.st.player.z = (q.z - 1) * UNIT + UNIT / 2;
    check(!atVending(back.sim), `${def.id}: not from the tile behind it`);
    // A tray in both hands: told why, nothing opened.
    const tray = atMachine(def);
    tray.st.tray = 1;
    ask(tray, VEND.OPEN);
    check(
      !tray.st.vendOpen && tray.sim.events.some((e) => e.type === 'refused' && e.why === 'vendTray'),
      `${def.id}: a tray in the hands is said to be the reason`,
    );
  }
  // Pockets full and something on the floor: the machine still opens (nothing could be picked up).
  const packed = atMachine();
  packed.st.items.ground.push([placeKey(LAYER.GROUND, m.line[0].z * MAP_W + m.line[0].x), slot(itemNumber('soda'))]);
  for (let k = 0; k < HOTBAR; k++) packed.st.items.inv[k] = slot(itemNumber('soap'));
  check(vendOffer(packed.sim), "pockets full: the machine, not a pick-up that can't be done");

  // Push in with only the one using it ahead: no such thing, and said so.
  const using = atMachine();
  using.st.vend.line = [1];
  using.st.vend.who = 1;
  using.st.vend.until = using.st.step + 200;
  ask(using, VEND.OPEN);
  check(cutPast(using.sim).length === 0, 'nobody to push past');
  ask(using, VEND.CUT);
  check(
    using.sim.events.some((e) => e.type === 'refused' && e.why === 'vendBusy') && using.st.vend.line[0] === 1,
    'and pushing in is refused',
  );
  // The card up, no place taken: a step off it ends it.
  const step = atMachine();
  step.st.vend.line = [1];
  step.st.vend.who = 1;
  step.st.vend.until = step.st.step + 200;
  ask(step, VEND.OPEN);
  check(step.st.vendOpen && !step.st.vend.line.includes(VEND_PLAYER), 'the card up with no place');
  step.st.player.z += UNIT * 2;
  step.step(0);
  check(!step.st.vendOpen, 'a step off it ends it');

  // The lesson: nobody comes while they read, and a second buy before the drink doesn't strand it.
  const lesson = LESSONS.find((l) => l.id === 'vending')!;
  const sim = new Sim(CENTER_PERKS, lesson.seed ?? 7);
  lesson.setup?.(sim);
  const left = [...sim.state.vend.left];
  let queued = 0;
  for (let k = 0; k < 2400; k++) {
    sim.step(0);
    queued = Math.max(queued, sim.state.vend.line.length);
  }
  check(
    queued === 0 && sim.state.vend.left.join() === left.join(),
    `the lesson's machine is theirs alone (${queued} queued, ${sim.state.vend.left})`,
  );
  const again = lesson.steps.find((q) => q.text === 'lesson.vending.again')!;
  const thump = lesson.steps.find((q) => q.text === 'lesson.vending.thump')!;
  const ctx = { sim } as unknown as LessonCtx;
  check(!again.done?.(ctx), 'the step waits for the buy that sticks');
  sim.state.vendBought += 2;
  check(!!again.done?.(ctx) && !!thump.done?.(ctx), 'and is already met once it has stuck and been freed');
}

// ---------------------------------------------------------------- called away mid-buy

{
  // Movie night at Stalag Flucht (day 3, seed 3): someone at the machine as the film starts goes with what they paid for.
  const stalag = PRISONS.find((q) => q.id === 'stalag-flucht')!;
  const film = new Bot(stalag, 3);
  check(planOf(film.sim, 3).event === 'movie', 'stalag-flucht: day 3 is movie night');
  film.routineUntil(3, 18 * 60 + 59);
  const v = film.st.vend;
  const k = film.st.inmates.findIndex((m, i) => i > 0 && m.ko === 0 && m.angry === 0);
  v.line = [k];
  v.who = k;
  v.row = 1;
  v.until = film.st.step + 10_000;
  v.thumping = false;
  const left = v.left[1];
  check(
    film.until(() => eventOn(film.sim, 'movie'), 3 * 60 * 20),
    'the film starts',
  );
  film.step(0);
  check(v.who === VEND_NOBODY && !v.line.includes(k), 'the machine let go at the film');
  check(
    film.st.inmates[k].snack === itemNumber('soda') && v.left[1] === left,
    `and the soda went with them, not lost from the row (${film.st.inmates[k].snack}, ${v.left[1]} left)`,
  );
  // Something stuck stays stuck for whoever's next.
  const jam = new Bot(stalag, 3);
  jam.routineUntil(3, 18 * 60 + 59);
  const w = jam.st.vend;
  w.line = [k];
  w.who = k;
  w.jam = 2;
  w.row = 1;
  w.until = jam.st.step + 10_000;
  w.thumping = true;
  jam.until(() => eventOn(jam.sim, 'movie'), 3 * 60 * 20);
  jam.step(0);
  check(w.jam === 2 && jam.st.inmates[k].snack === 0, 'a jam being thumped at stays in the machine');
}

// ---------------------------------------------------------------- old rules

{
  for (const p of PRISONS) {
    const was = new Sim(p, 3);
    was.rules231 = true;
    was.rules232 = true;
    was.rules2331 = true;
    was.rules233 = true;
    was.rules234 = true;
    const m = p.vending!;
    const t = m.z * MAP_W + m.x;
    check(was.world.propSolid[t] === 0 && !was.world.blocked(m.x, m.z), `${p.id}: old rules, walked through as decoration`);
    check(fixtureUse(was.world, was.world.props[was.world.props.length - 1]) === undefined, `${p.id}: old rules, nothing to use`);
    const bare = new Sim({ ...p, props: p.props.filter((q) => q.kind !== 'vending' && q.kind !== 'cooler') }, 3);
    // (The old map: the checkpoint's booth only drawn too, as before 2.33.2.)
    bare.rules2331 = true;
    bare.rules233 = true;
    bare.rules234 = true;
    check(canDigFloor(was.world, t, []) === canDigFloor(bare.world, t, []), `${p.id}: digging there as it was`);
    const a = placesOf(was.world).floor.flat().join();
    const c = placesOf(bare.world).floor.flat().join();
    check(a === c, `${p.id}: everyone's spots as they were in old runs`);
  }
  // A log from 2.31 replays under its own rules, and isn't carried on; today's is.
  const was = new Sim(CENTER_PERKS, 24);
  was.rules231 = true;
  was.rules232 = true;
  was.rules2331 = true;
  was.rules233 = true;
  was.rules234 = true;
  const prev = new RunRecorder(was, { seed: 24, game: '2.31.0' });
  for (let k = 0; k < 4800; k++) prev.step(0);
  check(!!replayLog(prev.toLog(), CENTER_PERKS)?.ok, 'a 2.31 log replays whole under the old rules');
  check(new RunRecorder(prev.sim, { log: prev.toLog(), game: '2.35.0' }).toLog().seed === -1, 'and is not carried on');
  const today = new RunRecorder(new Sim(CENTER_PERKS, 24), { seed: 24, game: '2.35.0' });
  for (let k = 0; k < 4800; k++) today.step(0);
  check(!!replayLog(today.toLog(), CENTER_PERKS)?.ok, "a log of today's replays");
  // A save mid-turn; one from before the machine.
  const s = atMachine();
  s.act();
  theirTurn(s);
  ask(s, VEND.BUY, 1);
  const snap = s.sim.snapshot();
  const back = new Sim(CENTER_PERKS, 3);
  back.restore(snap);
  check(back.state.vend.who === VEND_PLAYER && back.state.vendOpen && back.state.vend.left[1] === s.st.vend.left[1], 'a save mid-turn');
  const old = structuredClone(snap);
  delete (old.state as Partial<typeof old.state>).vend;
  delete (old.state as Partial<typeof old.state>).vendOpen;
  delete (old.state as Partial<typeof old.state>).vendBought;
  for (const m of old.state.inmates) delete (m as Partial<typeof m>).snack;
  const b2 = new Sim(CENTER_PERKS, 3);
  b2.restore(old);
  check(
    !b2.state.vendOpen &&
      b2.state.vend.who === VEND_NOBODY &&
      b2.state.vend.left.length === GOODS.length &&
      b2.state.inmates[0].snack === 0,
    'a save from before the machine',
  );
}

console.log(failures ? `${failures} failures` : 'vending ok');
if (failures) process.exit(1);
