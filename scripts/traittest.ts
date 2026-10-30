/**
 * Guard ways (P15), rule by rule:
 * - the data: in every prison one strict guard (the one who does the shakedown), a lazy one
 *   with one nap stop on its night round, a corrupt one or two; the tutorial's guard steady;
 * - roll(): the newer rules' randomness, from state.salt, never from state.rng; the shakedown
 *   still makes the two draws it always made, and names the cells shakedownCells() says (a
 *   strict guard's: three, each desk searched half as long again);
 * - a lazy guard's nap: on its night round at its nap stop between 01:00 and 05:00, once a
 *   night, for as long as roll() says (05:00 at the latest); blind meanwhile (no cone, sees
 *   nothing); woken by the player at its elbow for a second, by a noise that reaches it with 2
 *   tiles to spare (any bang in earshot), by a lockdown; the ear on the tool button says so
 *   exactly when the noise would wake it; saved and loaded mid-nap it naps on the same;
 * - looking around: a lazy guard gives up a quarter sooner, a strict one keeps at it half as
 *   long again;
 * - talking to a guard: only one awake on its ordinary duty, the player not wanted; it stands
 *   still facing the player, and the talk ends once it's called away;
 * - bribes: a corrupt guard looks the other way for 2 game hours (no fuss about the hour,
 *   staff areas, contraband or a uniform; tampering still counts) or loses the paperwork
 *   (−25 heat, once a day); a strict one reports the offer (+20 heat); the others say no; the
 *   look away runs out on time, and is off at once at 80% heat;
 * - an old save loads with its salt mixed from its rng, every guard awake and unbribed.
 */
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { PRISONS } from '../src/content/prisons';
import { TRAINING } from '../src/content/prisons/training';
import { BRIBE, command, OP, SLOT, TALK } from '../src/sim/command';
import { mix32, randomInt, roll, rollInt, SALT } from '../src/sim/rng';
import { Sim, type SimEvent, type Snapshot } from '../src/sim/Sim';
import { ALERT, alertOf, awake, GUARD, sendToLook, traitOf, type Guard } from '../src/sim/systems/guards';
import { DOING } from '../src/sim/systems/inmates';
import { slot } from '../src/sim/systems/items';
import { itemNumber } from '../src/content/items';
import { shakedown, shakedownCells } from '../src/sim/systems/justice';
import { hearers, makeNoise } from '../src/sim/systems/noise';
import { canChat, lookAwayPrice, paperPrice } from '../src/sim/systems/ways';
import { BANG_NOISE, BRIBE_REPORT_HEAT, CHASE_HEAT, CONTRABAND_HEAT, LOOK_AWAY_STEPS, NAP_FROM, NAP_MAX, NAP_MIN, NAP_TO, NOISE_LOOK, PAPER_HEAT, STEPS_PER_MINUTE, STEPS_PER_SECOND, STIR_STEPS, UNIT } from '../src/sim/tuning';
import { LAYER, MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot, n } from './bots';
import { keepRumors } from '../src/talk/gossip';

const hhmm = (step: number) => {
  const m = (8 * 60 + Math.floor(step / STEPS_PER_MINUTE)) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const put = (b: { x: number; z: number }, x: number, z: number) => {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
};
const tileOfBody = (b: { x: number; z: number }) => Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);
const reload = (sim: Sim, snap: Snapshot) => sim.restore(JSON.parse(JSON.stringify(snap)));

// ------------------------------------------------------------------ the data
for (const p of [...PRISONS, TRAINING]) {
  const ways = p.guards.map((g) => traitOf(g));
  const strict = p.guards.filter((g) => traitOf(g) === 'strict');
  const lazy = p.guards.filter((g) => traitOf(g) === 'lazy');
  const corrupt = p.guards.filter((g) => traitOf(g) === 'corrupt');
  if (p === TRAINING) check(ways.every((w) => w === 'steady'), 'the tutorial\'s guard goes by the book');
  else {
    check(strict.length === 1 && !!strict[0].duties?.includes('shakedown'), `${p.id}: one strict guard, the one who does the shakedown`);
    check(lazy.length >= 1 && corrupt.length >= 1, `${p.id}: a lazy guard and a corrupt one`);
  }
  for (const g of p.guards) {
    const naps = (g.night ?? []).filter((w) => w.nap).length;
    check(traitOf(g) === 'lazy' ? naps === 1 : naps === 0, `${p.id}: ${g.name} has ${traitOf(g) === 'lazy' ? 'one nap stop' : 'no nap stop'} (${naps})`);
    check(!g.beat.some((w) => w.nap), `${p.id}: ${g.name} naps only on a night round`);
  }
  const named = (list: typeof p.guards) => list.map((g) => g.name).join(', ') || 'none';
  console.log(`${p.id}: strict ${named(strict)}; lazy ${named(lazy)}; corrupt ${named(corrupt)}; ${ways.filter((w) => w === 'steady').length} steady`);
}

// ------------------------------------------------------------------ roll() and the shakedown
{
  check(roll(7, SALT.SHAKEDOWN, 2, 0) === roll(7, SALT.SHAKEDOWN, 2, 0), 'roll() is pure');
  check(roll(7, SALT.SHAKEDOWN, 2, 0) !== roll(7, SALT.NAP, 2, 0) && roll(7, SALT.NAP, 2, 0) !== roll(7, SALT.NAP, 2, 1), 'each kind and argument has its own draw');
  const ints = Array.from({ length: 2000 }, (_, k) => rollInt(99, SALT.NAP, k, 3, 10));
  const counts = Array.from({ length: 10 }, (_, v) => ints.filter((x) => x === v).length);
  check(counts.every((c) => c > 150 && c < 250), `rollInt spreads evenly (${counts.join(' ')})`);
  console.log(`roll: ${roll(1, SALT.SHAKEDOWN, 2).toString(16)} ${roll(1, SALT.NAP, 3, 1).toString(16)}; salt of seed 1 ${mix32(1).toString(16)}`);
  const sim = new Sim(CENTER_PERKS, 5);
  check(sim.state.salt === mix32(5), 'a new game\'s salt is its seed mixed');
  // Day 2 at 08:00: the cells as told, strict Dunn's three; the two old draws still made.
  const before = { rng: sim.state.rng };
  randomInt(before, CENTER_PERKS.cells.length);
  randomInt(before, CENTER_PERKS.cells.length - 1);
  sim.events = [];
  shakedown(sim);
  const e = sim.events.find((x) => x.type === 'shakedown');
  const cells = e?.type === 'shakedown' ? e.cells : [];
  check(sim.state.rng === before.rng, 'the shakedown still makes exactly its two old draws');
  check(cells.join() === shakedownCells(sim.world, sim.state.salt, 1).join() && cells.length === 3 && new Set(cells).size === 3, `strict Dunn names three cells, as foretold (${cells.join(', ')})`);
  const days = Array.from({ length: 6 }, (_, d) => shakedownCells(sim.world, sim.state.salt, d + 2).join('+'));
  check(new Set(days).size > 3, 'the cells change from day to day');
  console.log(`shakedowns, days 2–7: ${days.join(', ')}`);
  // A strict guard searches each desk half as long again: 6 s instead of 4.
  const bot = new Bot(CENTER_PERKS, 12);
  let searching = 0;
  let first = '';
  bot.keepRoutine(() => {
    if (bot.st.guards[2].doing === DOING.SEARCH) searching++;
    const done = bot.sim.events.find((x) => x.type === 'searched');
    if (done) first = bot.time;
    return !!done;
  }, 3 * 1440 * STEPS_PER_MINUTE);
  // (Counted at the end of each step: the last of its 6 s it is already done.)
  check(searching === 6 * STEPS_PER_SECOND - 1, `strict Dunn searches a desk for 6 s (${searching} steps)`);
  console.log(`first desk searched ${first}, ${searching + 1} steps`);
}

// ------------------------------------------------------------------ a lazy guard's nap
const MOSS = 3;
{
  const bot = new Bot(CENTER_PERKS, 1);
  const s = () => bot.st;
  const moss = () => s().guards[MOSS];
  bot.routineUntil(2, 0);
  bot.keepRoutine(() => moss().doing === DOING.DOZE, 6 * 60 * STEPS_PER_MINUTE);
  const g = moss();
  const minute = (8 * 60 + Math.floor(s().step / STEPS_PER_MINUTE)) % 1440;
  const tile = tileOfBody(g.body);
  const day = bot.sim.clock.day;
  const length = NAP_MIN + rollInt(s().salt, SALT.NAP, MOSS, day, NAP_MAX - NAP_MIN + 1);
  check(minute >= NAP_FROM && minute < NAP_TO, `Moss dozes off between 01:00 and 05:00 (${hhmm(s().step)})`);
  check(tile === 29 * MAP_W + 30 && g.plan === -2, 'at the nap stop of the night round (30, 29)');
  check(g.doze === length, `for as long as roll() says (${g.doze} steps)`);
  check(!awake(g) && alertOf(g) === ALERT.NONE, 'dozing: not awake, no cone');
  console.log(`Moss dozes off at ${hhmm(s().step)} in the ${bot.sim.world.zoneAt(30, 29)}, for ${(length / STEPS_PER_MINUTE / 60).toFixed(2)} game hours`);
  const nap = bot.sim.snapshot();
  const napStep = s().step;

  // Blind: the player out at night two tiles in front of it, in plain sight of where it looks.
  const ahead = (sim: Sim, d: number) => {
    const b = sim.state.guards[MOSS].body;
    const fx = Math.round(Math.cos(((b.facing - 1) * Math.PI) / 8));
    const fz = Math.round(Math.sin(((b.facing - 1) * Math.PI) / 8));
    put(sim.state.player, Math.floor(b.x / UNIT) + fx * d, Math.floor(b.z / UNIT) + fz * d);
    sim.state.layer = LAYER.GROUND;
    sim.state.sleeping = false;
  };
  // (Over two glances either side: awake, it looks the player's way at some point.)
  const watched = () => {
    let saw = false;
    for (let k = 0; k < 4 * 30; k++) {
      bot.sim.step(0);
      saw ||= moss().sees;
    }
    return saw;
  };
  // (The others out cold meanwhile: nobody else sounds the alarm.)
  const alone = () => s().guards.forEach((o, k) => k !== MOSS && (o.ko = 1e6));
  alone();
  ahead(bot.sim, 2);
  check(!watched() && moss().doing === DOING.DOZE, 'dozing, it doesn\'t see the player out at night right in front of it');
  reload(bot.sim, nap);
  moss().doze = 0;
  moss().doing = DOING.NOTHING;
  alone();
  ahead(bot.sim, 2);
  check(watched(), '(awake, it would have)');

  // The player at its elbow: a second of it wakes it, facing them.
  reload(bot.sim, nap);
  const b = moss().body;
  s().player.x = b.x + UNIT / 2;
  s().player.z = b.z;
  s().layer = LAYER.GROUND;
  s().sleeping = false;
  let woke = -1;
  for (let k = 1; k <= 40 && woke < 0; k++) {
    bot.sim.step(0);
    if (bot.sim.events.some((e) => e.type === 'nap' && !e.on && e.guard === MOSS)) woke = k;
  }
  check(woke === STIR_STEPS, `the player at its elbow wakes it after ${STIR_STEPS} steps (${woke})`);
  check(awake(moss()) && moss().body.facing === 1, 'awake, facing the player');

  // Noise: the ear says it'd be heard exactly when the noise wakes it (the other guards far away).
  let wakes = 0;
  let sleeps = 0;
  let agree = 0;
  let tried = 0;
  for (const kind of ['strike', 'bang'] as const) {
    for (let dx = -9; dx <= 9; dx += 3) {
      for (let dz = -6; dz <= 6; dz += 3) {
        reload(bot.sim, nap);
        bot.st.guards.forEach((o, k) => k !== MOSS && put(o.body, 60, 62));
        const t = (29 + dz) * MAP_W + 30 + dx;
        const reach = kind === 'bang' ? BANG_NOISE : 6;
        const ear = hearers(bot.sim, { layer: LAYER.GROUND, tile: t, reach }, [], kind === 'bang').length > 0;
        bot.sim.events = [];
        makeNoise(bot.sim, kind, LAYER.GROUND, t, reach);
        const up = moss().doze === 0;
        tried++;
        if (ear === up) agree++;
        if (up) wakes++;
        else sleeps++;
      }
    }
  }
  check(agree === tried && wakes > 0 && sleeps > 0, `the ear agrees with the noise ${agree}/${tried} (${wakes} woke it, ${sleeps} didn't)`);
  // In the open yard: a strike 4 walking tiles away wakes it (6 − 2), 5 away it sleeps on; a
  // bang 9 tiles away wakes it, where anything else as loud wouldn't.
  const wakesAt = (kind: 'strike' | 'bang' | 'ring', dx: number, dz: number, reach: number) => {
    reload(bot.sim, nap);
    makeNoise(bot.sim, kind, LAYER.GROUND, (29 + dz) * MAP_W + 30 + dx, reach);
    return moss().doze === 0;
  };
  check(wakesAt('strike', 4, 0, 6) && !wakesAt('strike', 5, 0, 6), 'a strike wakes it with 2 tiles to spare');
  check(wakesAt('bang', 7, -2, BANG_NOISE) && !wakesAt('ring', 7, -2, BANG_NOISE), 'a bang anywhere in earshot');
  // A blow wakes it (as it would a guard asleep in bed), from where no doze would be stirred.
  reload(bot.sim, nap);
  bot.st.guards.forEach((o, k) => k !== MOSS && (o.ko = 1e6));
  s().player.x = moss().body.x + Math.round(1.2 * UNIT);
  s().player.z = moss().body.z;
  s().player.facing = 9;
  s().layer = LAYER.GROUND;
  s().sleeping = false;
  s().lock = s().inmates.length + MOSS;
  bot.sim.step(command(0, OP.USE, 1));
  check(moss().doze === 0 && awake(moss()) && bot.sim.events.some((e) => e.type === 'hit'), 'a blow wakes it');
  // A lockdown wakes it (it hunts the player with the rest).
  reload(bot.sim, nap);
  s().lockdown = true;
  bot.sim.step(0);
  check(moss().doze === 0 && moss().mode === GUARD.CHASE && bot.sim.events.some((e) => e.type === 'nap' && e.guard === MOSS && !e.on), 'a lockdown wakes it (and says so)');

  // Left alone: it naps until the nap is over (05:00 at the latest), once a night; saved and
  // loaded mid-nap, the same.
  reload(bot.sim, nap);
  const cut = bot.sim.snapshot();
  let up = -1;
  for (let k = 0; k < NAP_MAX + 10 && up < 0; k++) {
    bot.keepRoutine(() => true, 1);
    bot.step(command(0));
    if (moss().doze === 0) up = s().step;
  }
  const latest = (Math.floor(napStep / (1440 * STEPS_PER_MINUTE)) * 1440 + (NAP_TO - 8 * 60 + 1440) % 1440) * STEPS_PER_MINUTE;
  check(up === Math.min(napStep + length, latest), `it wakes when the nap is over: ${hhmm(up)}`);
  let more = 0;
  bot.keepRoutine(() => {
    if (bot.sim.events.some((e) => e.type === 'nap' && e.on && e.guard === MOSS)) more++;
    return bot.sim.clock.minuteOfDay === 7 * 60;
  }, 8 * 60 * STEPS_PER_MINUTE);
  check(more === 0 && s().guards[MOSS].napDay === day, 'one nap a night');
  const replay = new Sim(CENTER_PERKS, 1);
  replay.restore(JSON.parse(JSON.stringify(cut)));
  const left = new Sim(CENTER_PERKS, 1);
  left.restore(JSON.parse(JSON.stringify(cut)));
  for (let k = 0; k < 600; k++) {
    replay.step(0);
    left.step(0);
  }
  check(replay.hash() === left.hash() && replay.state.guards[MOSS].doze === left.state.guards[MOSS].doze, 'saved and loaded mid-nap, it naps on the same');
  console.log(`Moss up again at ${hhmm(up)}`);
}

// ------------------------------------------------------------------ looking around, by trait
{
  const look = (k: number) => {
    const sim = new Sim(CENTER_PERKS, 1);
    const g = sim.state.guards[k];
    sendToLook(g, tileOfBody(g.body), NOISE_LOOK);
    let steps = 0;
    while (g.mode === GUARD.INVESTIGATE && steps < 1000) {
      sim.step(0);
      steps++;
    }
    return steps;
  };
  const [steady, lazy, strict] = [look(4), look(MOSS), look(2)];
  check(Math.abs(lazy - NOISE_LOOK * 0.75) <= 2 && Math.abs(strict - NOISE_LOOK * 1.5) <= 2 && Math.abs(steady - NOISE_LOOK) <= 1, `looking around: steady ${steady}, lazy ${lazy}, strict ${strict} steps`);
  console.log(`looking around ${NOISE_LOOK} steps: steady ${steady}, lazy ${lazy}, strict ${strict}`);
}

// ------------------------------------------------------------------ talking to a guard, and bribes
const PRATT = 1;
const DUNN = 2;
const KELLER = 4;
/** A game at 10:00 on day 1 (free time) with a guard met out in the open yard, the player just west of it facing it; the others far away. */
function beside(k: number, seed = 1, minute = 10 * 60) {
  const bot = new Bot(CENTER_PERKS, seed);
  bot.routineUntil(1, minute);
  const st = bot.st;
  st.guards.forEach((o, j) => j !== k && put(o.body, 60 - j, 62));
  put(st.guards[k].body, 33, 28);
  put(st.player, 32, 28);
  st.player.facing = 1;
  st.cash = 500;
  return bot;
}
const talkTo = (bot: Bot, k: number) => {
  bot.act();
  return bot.st.talk === bot.st.inmates.length + k;
};
const events = (bot: Bot, type: SimEvent['type']) => bot.sim.events.filter((e) => e.type === type);
{
  // Pratt (corrupt): a talk, standing still facing the player; looking the other way.
  const bot = beside(PRATT);
  check(talkTo(bot, PRATT), 'E beside a guard on its round starts a talk');
  const g = bot.st.guards[PRATT];
  const at = [g.body.x, g.body.z];
  for (let k = 0; k < 60; k++) bot.step(0);
  const toPlayer = Math.round((Math.atan2(bot.st.player.z - g.body.z, bot.st.player.x - g.body.x) / (Math.PI / 8) + 16) % 16) + 1;
  check(g.body.x === at[0] && g.body.z === at[1] && !g.body.moving && g.body.facing === toPlayer && bot.st.talk >= 0, 'it stands still facing the player while they talk');
  const price = lookAwayPrice(CENTER_PERKS.difficulty);
  bot.op(OP.TALK, TALK.BRIBE, BRIBE.LOOK);
  const paid = events(bot, 'bribe')[0];
  check(bot.st.cash === 500 - price && g.bribed === bot.st.step + LOOK_AWAY_STEPS && paid?.type === 'bribe' && paid.kind === 'look' && paid.price === price, `Pratt looks the other way for 2 game hours, for $${price}`);
  bot.op(OP.TALK, TALK.BRIBE, BRIBE.LOOK);
  check(events(bot, 'refused').some((e) => e.type === 'refused' && e.why === 'lookingAway') && bot.st.cash === 500 - price, 'paying again while it looks away is refused');
  const bribed = bot.sim.snapshot();

  // Contraband in hand right in front of Pratt (still talking, it faces the player): no heat. In front of Keller: heat.
  const it = bot.st.items;
  it.inv[0] = slot(n('comb_shiv'));
  it.hand = 0;
  for (let k = 0; k < 20; k++) bot.sim.step(0);
  check(bot.st.guards[PRATT].sees && bot.st.heat === 0, `contraband in plain sight of Pratt looking away: no heat (${bot.st.heat}%)`);
  check(!bot.st.seen, 'nor does it count as seen (the eye stays shut, heat cools)');
  const honest = beside(KELLER);
  talkTo(honest, KELLER);
  honest.st.items.inv[0] = slot(n('comb_shiv'));
  honest.st.items.hand = 0;
  for (let k = 0; k < 20; k++) honest.sim.step(0);
  check(honest.st.guards[KELLER].sees && honest.st.heat === 20 * CONTRABAND_HEAT, `in front of Keller: ${honest.st.heat}%`);
  reload(bot.sim, bribed);
  bot.op(OP.CLOSE);
  check(bot.st.talk === -1, 'the talk ends');
  // Tampering is never overlooked: a strike seen is 100%.
  reload(bot.sim, bribed);
  bot.st.struckAt = bot.st.step + 1;
  bot.sim.step(0);
  check(bot.st.guards[PRATT].sees && bot.st.heat === 100 && bot.sim.events.some((e) => e.type === 'spotted' && e.reason === 'tampering'), 'tools at work in front of Pratt: tampering, 100%');
  // It runs out on time: 2 game hours after it was paid for.
  reload(bot.sim, bribed);
  let over = -1;
  for (let k = 1; k <= LOOK_AWAY_STEPS + 5 && over < 0; k++) {
    bot.sim.step(0);
    if (bot.sim.events.some((e) => e.type === 'bribe' && e.kind === 'over')) over = bot.sim.state.step;
  }
  check(over === bribed.state.guards[PRATT].bribed, `the look away ends after 2 game hours (${hhmm(over)})`);
  // Off at once at 80% heat.
  reload(bot.sim, bribed);
  bot.sim.state.heat = 85;
  bot.sim.step(0);
  check(bot.sim.state.guards[PRATT].bribed === 0 && bot.sim.events.some((e) => e.type === 'bribe' && e.kind === 'over'), 'wanted (80%+): the look away is off');
  console.log(`Pratt looks away for $${price} (2 game hours), loses the paperwork for $${paperPrice(CENTER_PERKS.difficulty)}`);
}
{
  // Losing the paperwork: −25 heat, once a day; not with nothing on file.
  const bot = beside(PRATT);
  bot.st.heat = 50;
  talkTo(bot, PRATT);
  bot.op(OP.TALK, TALK.BRIBE, BRIBE.PAPER);
  const price = paperPrice(CENTER_PERKS.difficulty);
  check(bot.st.heat === 50 - PAPER_HEAT && bot.st.cash === 500 - price, `the paperwork lost: ${bot.st.heat}% heat, $${bot.st.cash}`);
  bot.op(OP.TALK, TALK.BRIBE, BRIBE.PAPER);
  check(events(bot, 'refused').some((e) => e.type === 'refused' && e.why === 'paperToday') && bot.st.heat === 50 - PAPER_HEAT, 'once a day');
  const clean = beside(PRATT);
  talkTo(clean, PRATT);
  clean.op(OP.TALK, TALK.BRIBE, BRIBE.PAPER);
  check(events(clean, 'refused').some((e) => e.type === 'refused' && e.why === 'clean') && clean.st.cash === 500, 'nothing on file: nothing to lose');
  const poor = beside(PRATT);
  poor.st.cash = 10;
  talkTo(poor, PRATT);
  poor.op(OP.TALK, TALK.BRIBE, BRIBE.LOOK);
  check(events(poor, 'refused').some((e) => e.type === 'refused' && e.why === 'cash') && poor.st.guards[PRATT].bribed === 0, 'not enough cash: no deal');
}
{
  // Dunn (strict) reports it; Keller (steady) and Moss (lazy) say no.
  const dunn = beside(DUNN);
  check(talkTo(dunn, DUNN), 'a talk with Dunn');
  dunn.op(OP.TALK, TALK.BRIBE, BRIBE.LOOK);
  check(events(dunn, 'refused').some((e) => e.type === 'refused' && e.why === 'reported') && dunn.st.heat === BRIBE_REPORT_HEAT && dunn.st.cash === 500, `strict Dunn reports the bribe: ${dunn.st.heat}% heat, the cash kept`);
  for (const k of [KELLER, MOSS]) {
    const bot = beside(k);
    check(talkTo(bot, k), `a talk with ${CENTER_PERKS.guards[k].name}`);
    bot.op(OP.TALK, TALK.BRIBE, BRIBE.PAPER);
    bot.st.heat = 30;
    bot.op(OP.TALK, TALK.BRIBE, BRIBE.LOOK);
    check(events(bot, 'refused').some((e) => e.type === 'refused' && e.why === 'honest') && bot.st.heat === 30 && bot.st.cash === 500 && bot.st.guards[k].bribed === 0, `${CENTER_PERKS.guards[k].name} won't take it`);
  }
}
{
  // Who talks: not one called away (the talk ends), not with the player wanted, not one asleep.
  const bot = beside(KELLER);
  talkTo(bot, KELLER);
  sendToLook(bot.st.guards[KELLER], 30 * MAP_W + 30);
  bot.step(0);
  check(bot.st.talk === -1 && events(bot, 'talk').some((e) => e.type === 'talk' && e.who === -1), 'called away, the guard ends the talk');
  const hot = beside(KELLER);
  hot.st.heat = 85;
  check(!canChat(hot.sim, KELLER) && !talkTo(hot, KELLER), 'nobody talks to a wanted player');
  // Not past a change of duty: at 17:00 Pratt goes to its dinner post, and the talk ends.
  const late = beside(PRATT, 1, 16 * 60 + 50);
  talkTo(late, PRATT);
  const ended = late.until(() => late.st.talk === -1, 60 * STEPS_PER_MINUTE);
  check(late.st.talk === -1 || !ended, 'talk started');
  check(ended && late.sim.clock.minuteOfDay >= 17 * 60, `a talk doesn't hold a guard past its block (ended ${hhmm(late.st.step)})`);
  // Nor one met the very step it's back from looking around (its duty not planned yet).
  const back = beside(PRATT, 1, 16 * 60 + 50);
  const bg = back.st.guards[PRATT];
  bg.mode = GUARD.INVESTIGATE;
  bg.target = bg.goal = 28 * MAP_W + 33;
  bg.path = [];
  bg.timer = 1;
  bg.wait = 0;
  check(talkTo(back, PRATT), 'a talk the step it is back from a look');
  const over = back.until(() => back.st.talk === -1, 60 * STEPS_PER_MINUTE);
  check(over, `that talk ends with its block too (ended ${hhmm(back.st.step)})`);
  // Wanted the very step a bribe is offered: refused, nothing paid, nothing reported.
  for (const k of [PRATT, DUNN]) {
    const bot = beside(k);
    talkTo(bot, k);
    bot.st.heat = 85;
    bot.op(OP.TALK, TALK.BRIBE, BRIBE.LOOK);
    check(events(bot, 'refused').some((e) => e.type === 'refused' && e.why === 'tooHot') && bot.st.cash === 500 && bot.st.heat === 85 && bot.st.guards[k].bribed === 0, `too hot to deal with ${CENTER_PERKS.guards[k].name}`);
  }
  const night = beside(KELLER);
  night.st.guards[KELLER].doing = DOING.SLEEP;
  check(!canChat(night.sim, KELLER), 'nor to a guard asleep');
  // Nor in a guard's uniform: face to face it would only end in a lockdown.
  const dressed = beside(KELLER);
  dressed.st.items.inv[SLOT.OUTFIT] = slot(itemNumber('guard_outfit'));
  check(!canChat(dressed.sim, KELLER) && !talkTo(dressed, KELLER), 'not in a guard uniform');
  // A report that makes the player wanted ends the talk, the refusal told all the same.
  const hot2 = beside(DUNN);
  talkTo(hot2, DUNN);
  hot2.st.heat = 65;
  hot2.op(OP.TALK, TALK.BRIBE, BRIBE.LOOK);
  check(events(hot2, 'refused').some((e) => e.type === 'refused' && e.why === 'reported') && hot2.st.heat >= CHASE_HEAT && hot2.st.talk === -1, 'reported into a chase: the talk ends, the report told');
}

// ------------------------------------------------------------------ an old save
{
  const sim = new Sim(CENTER_PERKS, 3);
  for (let k = 0; k < 200; k++) sim.step(0);
  const snap = JSON.parse(JSON.stringify(sim.snapshot())) as Snapshot;
  const old = snap.state as unknown as Record<string, unknown>;
  delete old.salt;
  for (const g of snap.state.guards as unknown as Array<Record<string, unknown>>) for (const f of ['doze', 'napDay', 'stir', 'bribed', 'paperDay']) delete g[f];
  const back = new Sim(CENTER_PERKS, 99);
  back.restore(snap);
  const st = back.state;
  check(st.salt === mix32(snap.state.rng) && st.guards.every((g: Guard) => g.doze === 0 && g.bribed === 0 && g.napDay === 0 && g.stir === 0 && g.paperDay === 0), 'an old save: salt from its rng, every guard awake and unbribed');
  check(JSON.stringify(Object.keys(st)) === JSON.stringify(Object.keys(sim.state)) && JSON.stringify(Object.keys(st.guards[0])) === JSON.stringify(Object.keys(sim.state.guards[0])), 'the new fields load at the end, in field order');
  for (let k = 0; k < 100; k++) back.step(0);
  check(back.state.step === 300, 'and it plays on');
}

// ------------------------------------------------------------------ what the player learned stays learned
{
  const news = Array.from({ length: 20 }, (_, k) => ({ fact: { kind: 'shakedown' as const, key: `shakedown:${k}:2`, inmate: 0, n: k }, step: 100 - k }));
  const ways = [{ fact: { kind: 'strict' as const, key: 'trait:2', guard: 2 }, step: 1 }];
  const kept = keepRumors([...news, ...ways]);
  check(kept.length === 13 && kept.some((r) => r.fact.key === 'trait:2'), `a guard's ways stay in the notebook however much news comes after (${kept.length} kept)`);
}
