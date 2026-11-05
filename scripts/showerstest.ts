/**
 * The showers (2.26, systems/showers.ts): the water turned on with the action button at every head in
 * every prison, what it gives and what ends it; the crowd taking turns, so nobody scrubs on dry floor
 * and a latecomer finds a head; an ambush's moment of warning; older runs as they were.
 */
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { SAN_PANCHO } from '../src/content/prisons/san-pancho';
import { TRAINING } from '../src/content/prisons/training';
import { ROUTINE } from '../src/content/routine';
import { floorOf, placesOf } from '../src/sim/ai/places';
import { DIR_X, DIR_Z, OP } from '../src/sim/command';
import { RunRecorder, replayLog } from '../src/sim/runlog';
import { Sim, type Snapshot } from '../src/sim/Sim';
import { DOING, type Inmate } from '../src/sim/systems/inmates';
import { interactTarget } from '../src/sim/systems/items';
import { showerOffer, underShower } from '../src/sim/systems/showers';
import { AMBUSH_WINDUP_STEPS, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { tileAt } from '../src/sim/world/grid';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot } from './bots';

const BLOCK = 16 * 60;
const put = (bot: Bot, tile: number, facing = 5) => {
  const p = bot.st.player;
  p.x = (tile % MAP_W) * UNIT + UNIT / 2;
  p.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
  p.moving = false;
  p.facing = facing;
};
/** In the showers room near the start of the block, the crowd on its way. */
function atShowers(seed = 3, prison = CENTER_PERKS, minute = BLOCK + 2) {
  const bot = new Bot(prison, seed);
  check(bot.routineUntil(1, minute), 'shower time');
  check(ROUTINE[bot.st.routine].id === 'showers', 'it is shower time');
  return bot;
}
const offer = (bot: Bot) => showerOffer(bot.sim, interactTarget(bot.sim.world, bot.st.items, bot.st.player, bot.sim.bedtime, bot.st.layer));
const heads = (bot: Bot) => placesOf(bot.sim.world).showers;
const freeHead = (bot: Bot) => heads(bot).find((h) => !bot.st.inmates.some((m) => m.goal === h.tile || tileAt(m.body.x, m.body.z) === h.tile))!;

// ------------------------------------------------------------------ every head in every prison
for (const def of PRISONS) {
  const bot = atShowers(3, def);
  let lined = 0;
  let fromFront = 0;
  let energy = 0;
  for (const h of heads(bot)) {
    // (The room to itself, for this: the crowd has its own section below.)
    bot.st.inmates.forEach((m) => {
      m.wait = 1000;
      m.body.moving = false;
      if (heads(bot).some((q) => q.tile === tileAt(m.body.x, m.body.z))) m.body.x = bot.st.player.x;
    });
    put(bot, h.tile);
    check(offer(bot) === h.tile, `${def.id}: the button offers the head at ${h.tile}`);
    bot.act();
    const p = bot.st.player;
    if (bot.st.washing && p.x === (h.tile % MAP_W) * UNIT + UNIT / 2 && p.z === Math.floor(h.tile / MAP_W) * UNIT + UNIT / 2 && p.facing === h.wall) lined++;
    bot.st.energy = 50;
    bot.until(() => false, 40);
    if (bot.st.energy >= 54) energy++;
    bot.step(5);
    check(!bot.st.washing, `${def.id}: a step ends it`);
    // From the tile before it, facing it: stepped in under it, not the next one along.
    const before = h.tile - Math.round(DIR_X[h.wall] / 1024) - Math.round(DIR_Z[h.wall] / 1024) * MAP_W;
    if (!bot.sim.world.npcBlock[before]) {
      put(bot, before, h.wall);
      if (offer(bot) === h.tile) {
        bot.act();
        if (bot.st.washing && tileAt(bot.st.player.x, bot.st.player.z) === h.tile) fromFront++;
      }
      bot.step(5);
    } else fromFront++;
  }
  const n = heads(bot).length;
  check(lined === n && energy === n && fromFront === n, `${def.id}: every head works: ${lined} lined up, ${energy} gave energy, ${fromFront} from in front, of ${n}`);
  console.log(`${def.id}: ${n} heads, each turned on from under it and from in front, lined up facing its pipe, energy back`);
}
{
  const bot = atShowers(3, SAN_PANCHO);
  const side = heads(bot).find((h) => h.tile === 38 * MAP_W + 44)!;
  check(side.wall === 1 && heads(bot).filter((h) => h.tile !== side.tile).every((h) => h.wall === 5), "San Pancho's side head faces east, the rest south");
}

// ------------------------------------------------------------------ what it gives, and only if it's on
{
  const bot = atShowers(4);
  const h = freeHead(bot);
  put(bot, h.tile, h.wall);
  bot.st.energy = 30;
  bot.st.heat = 20;
  bot.until(() => false, 100);
  const idle = 20 - bot.st.heat;
  check(bot.st.energy <= 32 && !bot.sim.showering, `standing still isn't washing: energy +${bot.st.energy - 30}, heat ${bot.st.heat}`);
  bot.st.energy = 30;
  bot.st.heat = 20;
  bot.act();
  check(bot.sim.showering && underShower(bot.sim), 'the press turns it on');
  bot.until(() => false, 100);
  const gain = bot.st.energy - 30;
  const washedOff = 20 - bot.st.heat;
  check(gain >= 11 && gain <= 14 && washedOff >= 2 && washedOff > idle, `5 s under it: +${gain} energy, heat down ${washedOff} (${idle} standing dry)`);
  console.log(`washing, 5 s: +${gain} energy, heat down ${washedOff} where standing dry it falls ${idle}`);
  // Minor heat only: from there up, it falls no faster than it does anyway.
  bot.st.heat = 60;
  bot.until(() => false, 100);
  const high = 60 - bot.st.heat;
  check(high < washedOff, `at 60% heat falls ${high}, no faster than it does anyway`);
  bot.st.heat = 0;
  bot.until(() => false, 80);
  check(bot.st.heat === 0, 'none to take off, none taken');
}

// ------------------------------------------------------------------ the traps
{
  // Come for the soap: the first press washes, the next one searches.
  const bot = atShowers(5);
  const h = freeHead(bot);
  put(bot, h.tile, h.wall);
  bot.act();
  check(bot.st.washing && bot.st.items.open < 0, 'the first press washes');
  check(offer(bot) === -1, 'then nothing more to offer');
  bot.act();
  check(bot.st.washing && bot.st.items.open >= 0, 'the next one searches, the water still on');
  bot.close();
  // Outside the block: a search and no more.
  const later = new Bot(CENTER_PERKS, 6);
  check(later.routineUntil(1, BLOCK + 62), 'dinner');
  const q = heads(later)[0];
  put(later, q.tile, q.wall);
  check(offer(later) === -1, 'after the block no water on offer');
  later.act();
  check(!later.st.washing && later.st.items.open >= 0, 'after the block the press searches');
  later.close();

  // Someone under it already: refused, nothing changed.
  const full = atShowers(7, CENTER_PERKS, BLOCK + 2);
  const taken = freeHead(full);
  const m = full.st.inmates[0];
  m.body.x = (taken.tile % MAP_W) * UNIT + UNIT / 2;
  m.body.z = Math.floor(taken.tile / MAP_W) * UNIT + UNIT / 2;
  m.body.moving = false;
  m.goal = taken.tile;
  m.path = [];
  m.wait = 1000;
  // (Under it with them: from in front, the press would be a word with whoever's there.)
  put(full, taken.tile, taken.wall);
  const was = [full.st.player.x, full.st.player.z].join();
  full.st.energy = 50;
  full.act();
  check(!full.st.washing && [full.st.player.x, full.st.player.z].join() === was, 'a head in use: the player stays put');
  check(full.sim.events.some((e) => e.type === 'refused' && e.why === 'headTaken'), 'and is told so');

  // What ends it: a punch or tool, the block's end, a lockdown, a knockout.
  const end = (name: string, how: (b: Bot) => void) => {
    const b = atShowers(8);
    const f = freeHead(b);
    put(b, f.tile, f.wall);
    b.act();
    check(b.st.washing, `${name}: on first`);
    how(b);
    b.step(0);
    check(!b.st.washing && !b.sim.showering, `${name} turns it off`);
  };
  end('a press of the tool button', (b) => b.op(OP.USE, 1));
  end('a lockdown', (b) => { b.st.lockdown = true; });
  end('a knockout', (b) => { b.st.ko = 400; });
  end("the block's end", (b) => b.until(() => ROUTINE[b.st.routine].id !== 'showers', 60 * STEPS_PER_MINUTE));
  // Under a lockdown nothing's on offer.
  const shut = atShowers(9);
  const s = freeHead(shut);
  put(shut, s.tile, s.wall);
  shut.st.lockdown = true;
  check(offer(shut) === -1, 'no water in a lockdown');
  console.log('traps: come for the soap, the next press searches; a head in use refused; off by a step, a blow, a lockdown, a knockout or the bell; standing still is nothing');
}

// ------------------------------------------------------------------ the crowd takes turns, in every prison
for (const def of PRISONS) {
  for (const seed of [41, 42, 43]) {
    const bot = new Bot(def, seed);
    check(bot.routineUntil(1, BLOCK), 'the block begins');
    const hs = new Set(heads(bot).map((h) => h.tile));
    const washed = new Set<number>();
    let dry = 0;
    let shared = 0;
    let firstFree = -1;
    for (let k = 0; k < 59 * STEPS_PER_MINUTE; k++) {
      bot.step(0);
      const on = new Map<number, number>();
      bot.st.inmates.forEach((m: Inmate, i) => {
        const t = tileAt(m.body.x, m.body.z);
        if (m.doing === DOING.SHOWER) {
          if (hs.has(t)) washed.add(i);
          else dry++;
        }
        if (hs.has(t) && !m.body.moving) on.set(t, (on.get(t) ?? 0) + 1);
      });
      for (const v of on.values()) if (v > 1) shared++;
      // (From half past on, a latecomer's chance: a head with nobody under it.)
      if (firstFree < 0 && k >= 25 * STEPS_PER_MINUTE && on.size < hs.size) firstFree = k;
    }
    const n = bot.st.inmates.length;
    check(washed.size === n, `${def.id} #${seed}: ${washed.size} of ${n} got a turn`);
    check(dry === 0, `${def.id} #${seed}: nobody scrubs on dry floor (${dry} steps)`);
    // (A moment in passing, in San Pancho's room: over 24 seeds, up to 29 steps before inmates used the machines, 30 since.)
    check(shared <= 35, `${def.id} #${seed}: two under one head for ${shared} steps`);
    check(firstFree >= 0, `${def.id} #${seed}: a head comes free for a latecomer`);
    const stuck = bot.st.inmates.filter((m) => m.doing === DOING.SHOWER_WAIT).length;
    console.log(`${def.id} #${seed}: ${washed.size}/${n} washed, ${dry} dry, ${shared} steps shared, a head free by minute ${Math.round(firstFree / STEPS_PER_MINUTE)}, still waiting at the end ${stuck}`);
    // On to dinner with the bell: none left behind.
    bot.until(() => ROUTINE[bot.st.routine].id === 'dinner', 2 * STEPS_PER_MINUTE);
    bot.until(() => false, 2 * STEPS_PER_MINUTE);
    check(bot.st.inmates.every((m) => m.doing !== DOING.SHOWER && m.doing !== DOING.TOWEL && m.doing !== DOING.SHOWER_WAIT), `${def.id} #${seed}: everyone off to dinner`);
  }
}

// ------------------------------------------------------------------ the player's whole block, by real commands
for (const def of PRISONS) {
  for (const late of [0, 35]) {
    const bot = new Bot(def, 11);
    check(bot.routineUntil(1, BLOCK + late), 'the block');
    const start = bot.st.step;
    const h = freeHead(bot) ?? heads(bot)[0];
    const reached = bot.walkTo(h.tile, 40 * STEPS_PER_MINUTE);
    bot.act();
    let tries = 0;
    // A head in use: on to the next.
    // (All taken just then: round again, as anyone would, for what's left of the block.)
    while (!bot.st.washing && tries++ < heads(bot).length * 6) {
      const other = heads(bot)[(tries - 1) % heads(bot).length];
      bot.walkTo(other.tile, 10 * STEPS_PER_MINUTE);
      bot.act();
      if (!bot.st.washing) for (let k = 0; k < 20; k++) bot.step(0);
    }
    check(reached || bot.st.washing, `${def.id}: walked to a head`);
    check(bot.st.washing, `${def.id}, ${late} minutes late: washing after ${(bot.st.step - start) / 20} s`);
    console.log(`${def.id}, ${late} minutes in: washing after ${((bot.st.step - start) / 20).toFixed(1)} s of a 60 s block, ${tries} heads taken`);
  }
}

// ------------------------------------------------------------------ an ambush's moment of warning
{
  const bot = new Bot(SAN_PANCHO, 5);
  check(bot.routineUntil(1, BLOCK + 1), 'San Pancho at shower time');
  bot.walkTo(heads(bot)[0].tile, 20 * STEPS_PER_MINUTE);
  const hp = () => bot.st.health;
  let seen = -1;
  let who = -1;
  const h0 = hp();
  for (let k = 0; k < 60 * STEPS_PER_MINUTE && seen < 0; k++) {
    bot.step(0);
    const e = bot.sim.events.find((v) => v.type === 'ambush');
    if (e && e.type === 'ambush') {
      seen = bot.st.step;
      who = e.who;
    }
  }
  check(seen >= 0, 'someone comes for the player');
  const m = bot.st.inmates[who];
  check(m.windup > 0 && m.angry > 0, 'squaring up, angry');
  const at0 = [m.body.x, m.body.z].join();
  const hit0 = hp();
  for (let k = 0; k < AMBUSH_WINDUP_STEPS - 2; k++) bot.step(0);
  check([m.body.x, m.body.z].join() === at0, 'it stands where it is for its moment');
  check(hp() === hit0 || bot.st.inmates.some((o, i) => i !== who && o.angry > 0), `no blow from it yet (health ${h0} → ${hp()})`);
  console.log(`ambush: ${AMBUSH_WINDUP_STEPS / 20} s squaring up before it moves or lands a blow`);
}

// How that plays out in the prison where it matters most: day 1, the whole block, three ways of taking it.
{
  const ways: Array<[string, (b: Bot) => void]> = [
    ['stands there', (b) => b.step(0)],
    ['hits back', (b) => {
      if (b.st.inmates.some((m) => m.angry > 0 && m.windup === 0) && b.st.lock < 0) b.op(OP.LOCK);
      else if (b.st.lock >= 0) b.op(OP.USE, 1);
      else b.step(0);
    }],
    ['leaves the room when warned', (b) => {
      if (b.st.inmates.some((m) => m.angry > 0)) b.walkTo(floorOf(b.sim.world, ['canteen'])[0], 15 * STEPS_PER_MINUTE);
      else b.step(0);
    }],
  ];
  for (const [name, way] of ways) {
    let kos = 0;
    let ambushes = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const bot = new Bot(SAN_PANCHO, seed);
      bot.routineUntil(1, BLOCK);
      const hs = heads(bot);
      bot.walkTo(hs[seed % hs.length].tile, 20 * STEPS_PER_MINUTE);
      for (let k = 0; k < 40 * STEPS_PER_MINUTE && bot.st.ko === 0; k++) {
        way(bot);
        ambushes += bot.sim.events.filter((e) => e.type === 'ambush').length;
      }
      if (bot.st.ko > 0) kos++;
    }
    console.log(`san-pancho, day 1, a player who ${name}: knocked out in ${kos} of 12 blocks, ${ambushes} ambushes`);
  }
}

// ------------------------------------------------------------------ saves and older runs
{
  const bot = atShowers(21);
  const h = freeHead(bot);
  put(bot, h.tile, h.wall);
  bot.act();
  const snap: Snapshot = bot.sim.snapshot();
  const back = new Sim(CENTER_PERKS, 1);
  back.restore(snap);
  check(back.state.washing && back.showering, 'a save keeps the water on');
  const old = JSON.parse(JSON.stringify(snap)) as Snapshot;
  delete (old.state as unknown as Record<string, unknown>).washing;
  for (const m of old.state.inmates as unknown as Array<Record<string, unknown>>) delete m.windup;
  const was = new Sim(CENTER_PERKS, 1);
  was.restore(old);
  check(was.state.washing === false && was.state.inmates.every((m) => m.windup === 0), 'a save from before loads with none');
  for (let k = 0; k < 40; k++) was.step(0);

  // Older runs: standing still is enough, inmates stay under a head for the block, no moment's warning.
  const then = new Bot(CENTER_PERKS, 22);
  then.sim.rules225 = true;
  check(then.routineUntil(1, BLOCK + 40), 'an older run at shower time');
  check(then.st.inmates.every((m) => m.doing === DOING.SHOWER || m.body.moving), 'older runs: at a head or on the floor for the block');
  const q = heads(then)[0];
  put(then, q.tile, q.face);
  then.step(0);
  check(then.sim.showering && offer(then) === -1, 'older runs: standing still is washing, no button');
  const hot = new Bot(CENTER_PERKS, 23);
  hot.sim.rules225 = true;
  check(hot.routineUntil(1, BLOCK + 40), 'again');
  const q2 = heads(hot)[1];
  put(hot, q2.tile, q2.face);
  hot.st.heat = 20;
  hot.until(() => false, 80);
  check(hot.st.heat === 20, 'older runs: no heat off');

  // A log from before plays on as a new one; today's carries on and replays whole.
  // (Right through a shower block: the crowd by the old rules.)
  const was225 = new Sim(CENTER_PERKS, 24);
  was225.rules225 = true;
  was225.rules226 = true;
  was225.rules227 = true;
  was225.rules228 = true;
  was225.rules229 = true;
  const prev = new RunRecorder(was225, { seed: 24, game: '2.25.0' });
  for (let k = 0; k < (BLOCK + 40 - 8 * 60) * STEPS_PER_MINUTE; k++) prev.step(0);
  check(new RunRecorder(prev.sim, { log: prev.toLog(), game: '2.30.0' }).toLog().seed === -1, 'a log from 2.25 is not carried on');
  const replayed = replayLog(prev.toLog(), CENTER_PERKS);
  check(!!replayed?.ok && replayed.sim.rules225 === true, 'and replays whole under the old rules');
  const now = new RunRecorder(new Sim(CENTER_PERKS, 25), { seed: 25, game: '2.30.0' });
  for (let k = 0; k < 40; k++) now.step(0);
  check(new RunRecorder(now.sim, { log: now.toLog(), game: '2.30.1' }).toLog().seed === 25, 'a log from today is');
  check(replayLog(now.toLog(), CENTER_PERKS)?.sim.rules225 === false, 'and replays under today\'s');

  // Training has no showers: its crowd's day isn't troubled, through the block.
  const t = new Bot(TRAINING, 1);
  check(t.routineUntil(1, BLOCK + 30), 'Training at shower time');
  check(placesOf(t.sim.world).showers.length === 0 && showerOffer(t.sim, null) === -1, 'Training has no showers');
  t.until(() => false, 200);
  // What only a guard could block: out cold on a head, it doesn't; standing there, it does.
  const g = atShowers(26);
  const gh = freeHead(g);
  const guard = g.st.guards[0];
  guard.body.x = (gh.tile % MAP_W) * UNIT + UNIT / 2;
  guard.body.z = Math.floor(gh.tile / MAP_W) * UNIT + UNIT / 2;
  guard.body.moving = false;
  guard.ko = 2000;
  put(g, gh.tile, gh.wall);
  g.act();
  check(g.st.washing, 'a guard out cold on a head is no bar to it');
  console.log('saves and older runs: the water kept; a save from before loads with none; a 2.25 log replays as it was and is not carried on; Training has none');
}

// ------------------------------------------------------------------ text
for (const [name, k] of [['en', en], ['fr', fr]] as const) {
  for (const key of ['act.shower', 'refused.headTaken', 'hint.shower', 'hint.showerHostile'] as const) check(!!k[key], `${name}: ${key}`);
  check(!/stand still|immobile/i.test(k['hint.shower']), `${name}: the hint no longer says to stand still`);
}
