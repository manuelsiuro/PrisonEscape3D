/**
 * Exercise and training (2.29, systems/training.ts): a set in time at every machine in every prison, what mashing and
 * a slow hand get; inmates on the machines, and giving way to anyone who asks; the bag and the mat; what interrupts a
 * turn asked for; saves, and older runs as they were.
 */
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { ON_MACHINE } from '../src/sim/ai/doing';
import { placesOf } from '../src/sim/ai/places';
import { command, DIR_X, DIR_Z, OP } from '../src/sim/command';
import { RunRecorder, replayLog } from '../src/sim/runlog';
import { Sim } from '../src/sim/Sim';
import { DOING } from '../src/sim/systems/inmates';
import { interactTarget } from '../src/sim/systems/items';
import { beatAt, beatOf, machineOffer, onMachine, setCost, trainsOn } from '../src/sim/systems/training';
import { canDigFloor } from '../src/sim/systems/structure';
import { ATTR_MAX, GIVE_WAY_STEPS, GYM_ENERGY, SET_BEATS, STEPS_PER_MINUTE, TIRED, TRAIN_GAIN, UNIT } from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { tileAt } from '../src/sim/world/grid';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot } from './bots';

const HOUR = 15 * 60;
const GEAR = ['weights', 'pullup', 'treadmill', 'mat', 'punchingBag'];
const put = (bot: Bot, tile: number, facing = 5) => {
  const p = bot.st.player;
  p.x = (tile % MAP_W) * UNIT + UNIT / 2;
  p.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
  p.moving = false;
  p.facing = facing;
};
const gearOf = (bot: Bot) => bot.sim.world.props.flatMap((p, i) => (GEAR.includes(p.kind) ? [i] : []));
const spotOf = (bot: Bot, prop: number) => placesOf(bot.sim.world).machines.find((q) => q.prop === prop)!;
const hour = (seed = 3, def = CENTER_PERKS, minute = HOUR + 2) => {
  const bot = new Bot(def, seed);
  check(bot.routineUntil(1, minute), 'the hour');
  return bot;
};
/** The room to itself: the crowd held back and out of the way, for what's about the machine rather than who's at it. */
const clear = (bot: Bot) =>
  bot.st.inmates.forEach((m) => {
    m.wait = 100000;
    m.goal = -1;
    m.path = [];
    m.doing = DOING.NOTHING;
    m.body.moving = false;
    m.body.x = 2 * UNIT;
    m.body.z = 2 * UNIT;
  });
const attrs = (bot: Bot) => ({ str: bot.st.str, spd: bot.st.spd, int: bot.st.items.int });

// ------------------------------------------------------------------ every machine in every prison
for (const def of [TRAINING, ...PRISONS.filter((d) => d !== TRAINING)]) {
  const bot = hour(3, def);
  clear(bot);
  const props = gearOf(bot);
  const zones = new Set<string>();
  let onIt = 0;
  let sets = 0;
  let longest = 0;
  for (const prop of props) {
    const p = bot.sim.world.props[prop];
    zones.add(bot.sim.world.zoneAt(p.x, p.z));
    check(bot.sim.prison.props.findIndex((q) => q.x === p.x && q.z === p.z && q.kind === p.kind) === prop, `${def.id}: its number is its place`);
    const spot = spotOf(bot, prop);
    check(!!spot, `${def.id}: the ${p.kind} at ${p.x},${p.z} has a tile to use it from`);
    check(!bot.sim.world.npcBlock[spot.tile], `${def.id}: that tile is open`);
    // (From that tile, facing it, by the button's own reckoning.)
    put(bot, spot.tile, p.kind === 'mat' ? 5 : spot.face);
    bot.st.energy = 100;
    const target = interactTarget(bot.sim.world, bot.st.items, bot.st.player, false, bot.st.layer);
    check(target?.kind === 'fixture' && target.index === prop, `${def.id}: the button at the ${p.kind} at ${p.x},${p.z} offers it (${JSON.stringify(target)})`);
    bot.act();
    if (bot.st.train === prop) onIt++;
    const was = attrs(bot);
    const from = bot.st.step;
    bot.set();
    longest = Math.max(longest, bot.st.step - from);
    const a = trainsOn(bot.sim, prop)!;
    if (attrs(bot)[a] === was[a] + TRAIN_GAIN && bot.st.energy <= 100 - GYM_ENERGY + 3) sets++;
    bot.op(OP.TRAIN, 3);
    check(bot.st.train < 0, `${def.id}: stepped off`);
  }
  const n = props.length;
  check(onIt === n && sets === n, `${def.id}: every machine works: on ${onIt}, a set on ${sets}, of ${n}`);
  for (const z of zones) check(z === 'gym' || z === 'sports', `${def.id}: the machines count for the hour (${z})`);
  check(longest <= 6 * 20, `${def.id}: a set kept in time takes about 4.5 s (${longest / 20} s)`);
  console.log(`${def.id}: ${n} machines, each with its tile, a set on each, the longest ${longest / 20} s`);
}

// ------------------------------------------------------------------ what a set asks of the hand
{
  const atWeights = () => {
    const bot = hour();
    clear(bot);
    const prop = bot.sim.world.props.findIndex((p) => p.kind === 'weights');
    put(bot, spotOf(bot, prop).tile, 13);
    bot.st.energy = 100;
    bot.act();
    check(bot.st.train === prop, 'on the weights');
    return bot;
  };
  /** Steps to a set with a press every `gap` steps, from wherever the beat stands: a hand that takes no notice of it. */
  const untimed = (gap: number) => {
    const bot = atWeights();
    const was = bot.st.str;
    let side = 1;
    for (let k = 0; k < 20 * 300; k++) {
      if (k % gap === 0) {
        bot.op(OP.TRAIN, side);
        side = 3 - side;
      } else bot.step(0);
      if (bot.st.str > was) return k + 1;
    }
    return -1;
  };
  const kept = atWeights();
  const from = kept.st.step;
  kept.set();
  const timed = kept.st.step - from;
  const mash = untimed(1);
  const quick = untimed(3);
  const slow = untimed(30);
  const slower = untimed(100);
  check(mash > 3 * timed, `mashing is the slow way (${mash} steps against ${timed})`);
  check(quick > 2 * timed, `so is tapping fast (${quick} steps)`);
  check(slow > 0 && slower > 0, `any pace finishes, however slow (a press every 1.5 s: ${slow / 20} s; every 5 s: ${slower / 20} s)`);
  // The bar stays where it is while nobody presses.
  const idle = atWeights();
  idle.op(OP.TRAIN, 1);
  const bar = idle.st.reps;
  for (let k = 0; k < 400; k++) idle.step(0);
  check(bar > 0 && idle.st.reps === bar, 'the bar doesn\'t drain');
  // A press on the beat is worth what's written; off it, what's written.
  const set = SET_BEATS.weights;
  const on = atWeights();
  on.until(() => beatAt(on.st.step + 1, set.beat).off === 0, 40);
  on.op(OP.TRAIN, 1);
  check(on.st.reps === set.hit, `on the beat: ${set.hit} of the bar`);
  const off = atWeights();
  off.until(() => beatAt(off.st.step + 1, set.beat).off === 6, 40);
  off.op(OP.TRAIN, 1);
  check(off.st.reps === set.miss, `off it: ${set.miss}`);
  // Only one press a beat; the same side twice, nothing, and it doesn't use up the beat.
  const twice = atWeights();
  twice.until(() => beatAt(twice.st.step + 1, set.beat).off === -set.window, 40);
  twice.op(OP.TRAIN, 1);
  twice.op(OP.TRAIN, 2);
  check(twice.st.reps === set.hit, 'a second press in the same beat counts for nothing');
  const same = atWeights();
  same.until(() => beatAt(same.st.step + 1, set.beat).off === 0, 40);
  same.op(OP.TRAIN, 1);
  const first = same.st.reps;
  same.step(0);
  same.until(() => beatAt(same.st.step + 1, set.beat).off === 0, 40);
  same.op(OP.TRAIN, 1);
  check(same.st.reps === first, 'nor does the same side');
  same.op(OP.TRAIN, 2);
  check(same.st.reps === first + set.hit, 'and the beat is still there for the other');
  console.log(`a set: on the beat ${timed / 20} s, tapping every step ${mash / 20} s, three times a second ${quick / 20} s, every 1.5 s ${slow / 20} s, every 5 s ${slower / 20} s`);
  for (const [kind, q] of Object.entries(SET_BEATS)) {
    const presses = Math.ceil(100 / q.hit);
    const secs = (presses * q.beat) / 20;
    check(secs >= 3.5 && secs <= 5.5 && beatOf(kind) === q, `${kind}: ${secs} s on the beat`);
    check(q.beat / 2 > q.window, `${kind}: a window narrower than the beat, so mashing can't sit in it`);
  }
  // The cost shown is the cost, chilled or not.
  const cold = hour();
  clear(cold);
  const before = setCost(cold.sim, 'str');
  cold.st.frozen = true;
  const after = setCost(cold.sim, 'str');
  check(before === GYM_ENERGY && after === GYM_ENERGY * 2 && cold.sim.setCost('str') === after, `the card's cost: ${before}, chilled ${after}`);
}

// ------------------------------------------------------------------ inmates on the machines
for (const def of PRISONS) {
  let on = 0;
  let most = 0;
  let shared = 0;
  let late = 0;
  const used = new Set<number>();
  for (const seed of [41, 42, 43, 44, 45, 46]) {
    const bot = hour(seed, def, HOUR);
    const spots = placesOf(bot.sim.world).machines;
    for (let k = 0; k < 58 * STEPS_PER_MINUTE; k++) {
      bot.step(0);
      if (k % 20) continue;
      const here = bot.st.inmates.filter((m) => ON_MACHINE.includes(m.doing));
      on += here.length;
      most = Math.max(most, here.length);
      const goals = here.map((m) => m.goal);
      if (new Set(goals).size !== goals.length) shared++;
      for (const m of here) {
        const q = spots.find((s) => s.tile === m.goal);
        check(!!q && tileAt(m.body.x, m.body.z) === q.tile, `${def.id} #${seed}: on a machine, at its tile`);
        used.add(q!.prop);
      }
      // (Half an hour in, anyone bound for a machine has got there: trace any who haven't.)
      if (k >= 30 * STEPS_PER_MINUTE) late += bot.st.inmates.filter((m) => m.then !== DOING.NOTHING && ON_MACHINE.includes(m.then) && !ON_MACHINE.includes(m.doing) && m.path.length === 0 && tileAt(m.body.x, m.body.z) !== m.goal && m.ko === 0 && m.angry <= 0).length;
    }
    const left = bot.st.inmates.filter((m) => ON_MACHINE.includes(m.then) && tileAt(m.body.x, m.body.z) !== m.goal && m.ko === 0 && m.angry <= 0);
    check(left.length === 0, `${def.id} #${seed}: ${left.length} never reached their machine: ${left.map((m) => `${m.body.x / UNIT | 0},${m.body.z / UNIT | 0}->${m.goal % MAP_W},${(m.goal / MAP_W) | 0}`).join(' ')}`);
  }
  check(on > 0 && shared === 0 && late === 0, `${def.id}: inmates on the machines, ${shared} shared, ${late} left without a way`);
  console.log(`${def.id}: on the machines in the hour: up to ${most} at once, ${used.size} machines used over 6 seeds, none shared`);
}
{
  // Free time too: on a machine only at its tile, never still at it on the way somewhere else; a merchant never.
  let seen = 0;
  for (const def of PRISONS) {
    const free = new Bot(def, 7);
    check(free.routineUntil(1, 18 * 60 + 5), 'evening free time');
    const spots = placesOf(free.sim.world).machines;
    let off = 0;
    let merchants = 0;
    for (let k = 0; k < 90 * STEPS_PER_MINUTE; k++) {
      free.step(0);
      for (const m of free.st.inmates) {
        if (!ON_MACHINE.includes(m.doing)) continue;
        seen++;
        const at = spots.find((q) => q.tile === m.goal);
        if (!at || m.path.length || tileAt(m.body.x, m.body.z) !== at.tile) off++;
        if (def.merchants.includes(m.cell) || def.smuggling?.fixer === m.cell) merchants++;
      }
    }
    check(off === 0, `${def.id}: free time: ${off} steps at a machine while walking`);
    check(merchants === 0, `${def.id}: free time: a merchant or the fixer on a machine for ${merchants} steps`);
  }
  check(seen > 0, 'in free time some use them too');
  const tb = new Bot(TRAINING, 7);
  tb.st.energy = 100;
  let any = 0;
  for (let k = 0; k < 8 * 60 * STEPS_PER_MINUTE; k++) {
    tb.step(0);
    if (tb.st.inmates.some((m) => ON_MACHINE.includes(m.doing))) any++;
  }
  check(any === 0, 'nobody on the Training Block\'s machines');
  // Nothing about the hour's check-in moved: it's still the zone, whoever is on what.
  const count = hour(3, CENTER_PERKS, HOUR);
  check(count.counted(), 'the hour still counts the player');
}

// ------------------------------------------------------------------ giving way
function someoneOn(def = CENTER_PERKS, seed = 41) {
  const bot = hour(seed, def, HOUR);
  check(bot.until(() => bot.sim.world.props.some((_, i) => GEAR.includes(bot.sim.world.props[i].kind) && onMachine(bot.sim, i) >= 0), 45 * STEPS_PER_MINUTE), `${def.id}: someone on a machine`);
  // (Beside it, not on its tile: someone's on that. Some stand in a corner with no room but that: another then.)
  const roomBeside = (prop: number) => {
    const spot = spotOf(bot, prop);
    const p = bot.sim.world.props[prop];
    return [13, 5, 1, 9]
      .map((f) => {
        const x = Math.round(p.x + (p.w - 1) / 2) - Math.round(DIR_X[f] / 1024);
        const z = Math.round(p.z + (p.d - 1) / 2) - Math.round(DIR_Z[f] / 1024);
        return { t: z * MAP_W + x, f };
      })
      .find((q) => q.t !== spot.tile && !bot.sim.world.npcBlock[q.t]);
  };
  check(bot.until(() => gearOf(bot).some((i) => onMachine(bot.sim, i) >= 0 && !!roomBeside(i)), 45 * STEPS_PER_MINUTE), `${def.id}: room beside it`);
  const prop = gearOf(bot).find((i) => onMachine(bot.sim, i) >= 0 && !!roomBeside(i))!;
  const who = onMachine(bot.sim, prop);
  const open = roomBeside(prop);
  put(bot, open!.t, open!.f);
  return { bot, prop, who };
}
for (const def of PRISONS) {
  const { bot, prop, who } = someoneOn(def);
  bot.st.energy = 100;
  const target = interactTarget(bot.sim.world, bot.st.items, bot.st.player, false, bot.st.layer, [...bot.st.inmates, ...bot.st.guards], bot.st.inmates.length);
  check(target?.kind === 'fixture' && target.index === prop, `${def.id}: the button at a taken machine is for the machine, not the one on it (${JSON.stringify(target)})`);
  bot.events.length = 0;
  bot.act();
  check(bot.st.askTurn[0] === prop && bot.st.train < 0, `${def.id}: asked`);
  check(bot.events.some((e) => e.type === 'askTurn' && e.who === who), `${def.id}: they say something`);
  const asked = bot.st.step;
  check(bot.until(() => bot.st.train === prop, GIVE_WAY_STEPS + 5), `${def.id}: on it in time`);
  const waited = bot.st.step - asked;
  check(waited >= GIVE_WAY_STEPS - 2, `${def.id}: after they've finished up (${waited} steps)`);
  // They leave, for good, and don't come back to it while the player's there.
  let back = 0;
  for (let k = 0; k < 400; k++) {
    bot.step(0);
    if (onMachine(bot.sim, prop) >= 0) back++;
  }
  check(back === 0 && bot.st.train === prop, `${def.id}: they stay off it (${back})`);
  bot.set(undefined, 200);
  check(!ON_MACHINE.includes(bot.st.inmates[who].doing) || bot.st.inmates[who].goal !== spotOf(bot, prop).tile, `${def.id}: gone`);
}
for (const def of PRISONS) {
  // In free time, not after what's left of its linger.
  let bot: Bot | null = null;
  let prop = -1;
  for (const seed of [9, 7, 11, 13, 17, 19]) {
    const b = new Bot(def, seed);
    check(b.routineUntil(1, 18 * 60 + 5), 'free time');
    b.until(() => gearOf(b).some((i) => onMachine(b.sim, i) >= 0), 90 * STEPS_PER_MINUTE);
    prop = gearOf(b).find((i) => onMachine(b.sim, i) >= 0) ?? -1;
    if (prop >= 0) {
      bot = b;
      break;
    }
  }
  check(!!bot, `${def.id}: someone on a machine in free time`);
  const who = onMachine(bot!.sim, prop);
  const m = bot!.st.inmates[who];
  const tile = spotOf(bot!, prop).tile;
  bot!.st.player.x = m.body.x + UNIT;
  bot!.st.player.z = m.body.z;
  bot!.st.energy = 100;
  bot!.op(OP.INTERACT, 0);
  bot!.until(() => bot!.st.train === prop, GIVE_WAY_STEPS + 5);
  if (bot!.st.train !== prop) {
    // (Not the machine the button took: from right beside it instead.)
    put(bot!, tile, spotOf(bot!, prop).face);
    bot!.op(OP.INTERACT, 0);
    bot!.until(() => bot!.st.train === prop, GIVE_WAY_STEPS + 5);
  }
  check(bot!.st.train === prop, `${def.id}: free time: on the machine`);
  const from = bot!.st.step;
  bot!.until(() => m.goal !== tile && tileAt(m.body.x, m.body.z) !== tile, 200);
  check(tileAt(m.body.x, m.body.z) !== tile, `${def.id}: free time: off it soon after (${(bot!.st.step - from) / 20} s)`);
}
console.log('giving way: asked in all five, on the machine in 2 s, they keep off it; in free time, off it in moments');
{
  // Called off by a step away; not asked twice by a second press; nothing asked of them when too tired or as good as it gets.
  const walk = someoneOn();
  walk.bot.st.energy = 100;
  walk.bot.act();
  check(walk.bot.st.askTurn.length === 2, 'asked');
  walk.bot.step(command(5));
  check(walk.bot.st.askTurn.length === 0, 'a step away calls it off');
  walk.bot.until(() => false, 60);
  check(walk.bot.st.train < 0 && onMachine(walk.bot.sim, walk.prop) === walk.who, 'and they stay on it');
  const again = someoneOn();
  again.bot.st.energy = 100;
  again.bot.act();
  const left = again.bot.st.askTurn[1];
  again.bot.step(0);
  again.bot.act();
  check(again.bot.st.askTurn[1] < left, 'pressing again doesn\'t start the wait over');
  /** Beside the one on it, with the machine the button's target. */
  const besideThem = (t: ReturnType<typeof someoneOn>) => {
    const b = t.bot;
    const home = spotOf(b, t.prop).tile;
    for (const dz of [-1, 0, 1]) {
      for (const dx of [-1, 0, 1]) {
        const tile = home + dz * MAP_W + dx;
        if (tile === home || b.sim.world.npcBlock[tile]) continue;
        for (const f of [1, 5, 9, 13]) {
          put(b, tile, f);
          const target = interactTarget(b.sim.world, b.st.items, b.st.player, false, b.st.layer, [...b.st.inmates, ...b.st.guards], b.st.inmates.length);
          if (target?.kind === 'fixture' && target.index === t.prop) return;
        }
      }
    }
    check(false, 'somewhere beside them to press');
  };
  const tired = someoneOn();
  besideThem(tired);
  tired.bot.st.energy = TIRED - 1;
  tired.bot.events.length = 0;
  tired.bot.act();
  check(!tired.bot.st.askTurn.length && tired.bot.st.talk === tired.who, 'too tired: nobody\'s moved for nothing, and the button talks to them instead');
  check(machineOffer(tired.bot.sim, tired.prop) === 'talk', 'as labels.ts says');
  // (Across the machine, out of a talk's reach: told why not.)
  const far = someoneOn();
  far.bot.st.energy = TIRED - 1;
  const fp = far.bot.sim.world.props[far.prop];
  const away = [[fp.x, fp.z - 1], [fp.x - 1, fp.z], [fp.x + fp.w, fp.z]].map(([x, z]) => z * MAP_W + x).find((t) => t !== spotOf(far.bot, far.prop).tile && !far.bot.sim.world.npcBlock[t] && Math.abs(t % MAP_W - spotOf(far.bot, far.prop).tile % MAP_W) + Math.abs(Math.floor(t / MAP_W) - Math.floor(spotOf(far.bot, far.prop).tile / MAP_W)) >= 2);
  if (away !== undefined) {
    put(far.bot, away, 5);
    const offered = machineOffer(far.bot.sim, far.prop);
    check(offered !== 'ask', `no asking when it can't be used (${offered})`);
  }
  const maxed = someoneOn();
  besideThem(maxed);
  maxed.bot.st.energy = 100;
  maxed.bot.st.str = maxed.bot.st.spd = ATTR_MAX;
  maxed.bot.events.length = 0;
  maxed.bot.act();
  check(!maxed.bot.st.askTurn.length && maxed.bot.st.talk === maxed.who, 'as good as it gets: the same');
  // A lockdown in the wait; the one on it floored meanwhile: on at once.
  const shut = someoneOn();
  shut.bot.st.energy = 100;
  shut.bot.act();
  shut.bot.st.lockdown = true;
  shut.bot.step(0);
  check(shut.bot.st.askTurn.length === 0 && shut.bot.st.train < 0, 'a lockdown calls it off');
  const out = someoneOn();
  out.bot.st.energy = 100;
  out.bot.act();
  out.bot.st.inmates[out.who].ko = 100;
  out.bot.step(0);
  out.bot.step(0);
  check(out.bot.st.train === out.prop, 'the one on it out cold: on it at once');
  // Talking: not while they're on it; once off, as ever.
  const talk = someoneOn();
  const m = talk.bot.st.inmates[talk.who];
  put(talk.bot, tileAt(m.body.x, m.body.z), 5);
  // (From the tile before it, looking straight at them: the south of it, or wherever's open.)
  const from = [13, 5, 1, 9].map((f) => ({ f, x: m.body.x - (DIR_X[f] * UNIT) / 1024, z: m.body.z - (DIR_Z[f] * UNIT) / 1024 })).find((q) => !talk.bot.sim.world.npcBlock[tileAt(q.x, q.z)] && !GEAR.some((g) => talk.bot.sim.world.props.some((p) => p.kind === g && tileAt(q.x, q.z) === p.z * MAP_W + p.x)))!;
  const look = () => interactTarget(talk.bot.sim.world, talk.bot.st.items, { ...talk.bot.st.player, x: from.x, z: from.z, facing: from.f }, false, talk.bot.st.layer, [...talk.bot.st.inmates], talk.bot.st.inmates.length);
  const near = look();
  check(near?.kind !== 'person', `not to be talked to on it (${JSON.stringify(near)})`);
  const was = m.doing;
  m.doing = DOING.NOTHING;
  const after = look();
  m.doing = was;
  check(after?.kind === 'person' && after.who === talk.who, `off it, as ever (${JSON.stringify(after)})`);
  // Nor is someone only standing on a mat kept from a talk by the mat.
  const mats = new Bot(PRISONS.find((d) => d.id === 'irongate')!, 3);
  check(mats.routineUntil(1, 10 * 60), 'irongate');
  const mat = mats.sim.world.props.find((p) => p.kind === 'mat')!;
  const stands = mats.st.inmates[0];
  stands.body.x = (mat.x + 1) * UNIT + UNIT / 2;
  stands.body.z = mat.z * UNIT + UNIT / 2;
  stands.doing = DOING.NOTHING;
  const faced = interactTarget(mats.sim.world, mats.st.items, { ...mats.st.player, x: mat.x * UNIT + UNIT / 2, z: mat.z * UNIT + UNIT / 2, facing: 1 }, false, mats.st.layer, [...mats.st.inmates], mats.st.inmates.length);
  check(faced?.kind === 'person' && faced.who === 0, `someone on a mat, faced, is talked to (${JSON.stringify(faced)})`);
  // The player on a machine: anyone bound for it goes elsewhere.
  const bound = hour(41, CENTER_PERKS, HOUR);
  clear(bound);
  const prop = bound.sim.world.props.findIndex((p) => p.kind === 'treadmill');
  const spot = spotOf(bound, prop);
  put(bound, spot.tile, spot.face);
  bound.st.energy = 100;
  const heading = bound.st.inmates[0];
  heading.wait = 0;
  heading.goal = spot.tile;
  heading.then = DOING.RUN;
  heading.path = [];
  bound.op(OP.INTERACT);
  check(bound.st.train === prop, 'on a treadmill');
  bound.step(0);
  bound.step(0);
  check(heading.goal !== spot.tile, 'anyone bound for it goes elsewhere');
}

// ------------------------------------------------------------------ the bag and the mat, and the lap at the top
for (const def of PRISONS) {
  const bot = hour(3, def);
  const kinds = bot.sim.world.props.filter((p) => bot.sim.world.zoneAt(p.x, p.z) === 'gym').map((p) => p.kind);
  check(kinds.includes('punchingBag') && kinds.includes('mat'), `${def.id}: a bag and a mat in the gym`);
  const b = bot.sim.world.props.findIndex((p) => p.kind === 'punchingBag');
  const m = bot.sim.world.props.findIndex((p) => p.kind === 'mat');
  check(trainsOn(bot.sim, b) === 'spd' && trainsOn(bot.sim, m) === 'str', `${def.id}: the bag trains Speed, the mat Strength`);
  const bt = bot.sim.world.props[b].z * MAP_W + bot.sim.world.props[b].x;
  const mt = bot.sim.world.props[m].z * MAP_W + bot.sim.world.props[m].x;
  check(!bot.sim.world.npcBlock[bt] && !bot.sim.world.npcBlock[mt], `${def.id}: neither is in the way`);
  // (Older runs dug through those tiles, and went on doing so.)
  const before = new Sim({ ...def, props: def.props.filter((p) => p.kind !== 'mat' && p.kind !== 'punchingBag') }, 3).world;
  check(canDigFloor(bot.sim.world, bt, []) === canDigFloor(before, bt, []) && canDigFloor(bot.sim.world, mt, []) === canDigFloor(before, mt, []), `${def.id}: the floor under them digs as it did`);
}
{
  const bot = hour();
  bot.st.spd = ATTR_MAX;
  bot.st.lap = [];
  const r = bot.sim.prison.leisure!.track!;
  const corners = [
    [r.x, r.z],
    [r.x + r.w - 1, r.z],
    [r.x + r.w - 1, r.z + r.d - 1],
    [r.x, r.z + r.d - 1],
    [r.x, r.z],
  ];
  bot.events.length = 0;
  for (const [x, z] of corners) {
    put(bot, z * MAP_W + x);
    bot.step(0);
  }
  check(bot.events.some((e) => e.type === 'lap') && !bot.events.some((e) => e.type === 'cantTrain'), 'as fast as it gets, a lap says nothing');
  console.log('the bag and the mat in every gym, in nobody\'s way; a lap at 100 Speed says nothing');
}

// ------------------------------------------------------------------ what the bag and the mat take over
for (const def of PRISONS) {
  const bot = hour(3, def);
  const w = bot.sim.world;
  const taken: string[] = [];
  let looks = 0;
  for (let z = 0; z < 80; z++) {
    for (let x = 0; x < MAP_W; x++) {
      const t = z * MAP_W + x;
      if (w.npcBlock[t] || !w.props.some((p) => (p.kind === 'mat' || p.kind === 'punchingBag') && Math.abs(p.x - x) <= 2 && Math.abs(p.z - z) <= 2)) continue;
      for (const facing of [1, 5, 9, 13]) {
        const b = { ...bot.st.player, x: x * UNIT + UNIT / 2, z: z * UNIT + UNIT / 2, facing };
        const now = interactTarget(w, bot.st.items, b, false, bot.st.layer);
        w.plainGear = true;
        const was = interactTarget(w, bot.st.items, b, false, bot.st.layer);
        w.plainGear = false;
        looks++;
        // (Lost when the player faces it: that would be a thing no longer to be had from the front.)
        const had = was?.kind === 'fixture' ? w.props[was.index] : was?.kind === 'container' ? containersOf(w)[was.index].prop : null;
        const lost = had && now?.kind === 'fixture' && w.props[now.index] !== had && !GEAR.includes(had.kind);
        if (!lost) continue;
        const fx = x + Math.round(DIR_X[facing] / 1024);
        const fz = z + Math.round(DIR_Z[facing] / 1024);
        if (fx >= had.x && fx < had.x + had.w && fz >= had.z && fz < had.z + had.d) taken.push(`${had.kind}@${x},${z}`);
      }
    }
  }
  check(!taken.length, `${def.id}: nothing faced is lost to the bag or the mat (${taken.join(' ')})`);
  console.log(`${def.id}: ${looks} looks round the bag and the mat: nothing faced lost to them`);
}

// ------------------------------------------------------------------ text
for (const lang of [en, fr] as Array<Record<string, string>>) {
  for (const k of ['act.askTurn', 'act.mat', 'act.punchingBag', 'thing.mat', 'thing.punchingBag', 'train.mat', 'train.punchingBag', 'train.gives.str', 'train.gives.spd', 'train.gives.int', 'hint.trainBeatKeys', 'hint.trainBeatTouch', 'help.train.steps', 'help.train.more']) check(!!lang[k], `${k} is there`);
  check(!('hint.trainKeys' in lang), 'the old hint is gone: its advice was to press fast');
  check(!/vite|quickly/i.test(lang['lesson.gym.lift'].replace('aller plus vite', '')), 'the lesson no longer says to hurry');
}

// ------------------------------------------------------------------ saves and older runs
{
  // Waiting for a turn and mid-set, saved and loaded.
  const { bot, prop } = someoneOn();
  bot.st.energy = 100;
  bot.act();
  const snap = JSON.parse(JSON.stringify(bot.sim.snapshot()));
  const loaded = new Sim(CENTER_PERKS, 41);
  loaded.restore(snap);
  check(loaded.state.askTurn[0] === prop, 'a turn asked for is kept in a save');
  for (let k = 0; k < 60; k++) {
    loaded.step(0);
    bot.step(0);
  }
  check(loaded.hash() === bot.sim.hash() && loaded.state.train === prop, 'and it plays on the same');
  // A save from before.
  const old = JSON.parse(JSON.stringify(bot.sim.snapshot()));
  delete old.state.repBeat;
  delete old.state.askTurn;
  const from = new Sim(CENTER_PERKS, 41);
  from.restore(old);
  check(from.state.repBeat === -1 && from.state.askTurn.length === 0, 'a save from before loads with neither');
  // A log from before.
  const was228 = new Sim(CENTER_PERKS, 24);
  was228.rules228 = true;
  was228.rules229 = true;
  was228.rules230 = true;
  check(was228.world.plainGear, 'the old rules: the bag and the mat for show');
  const prev = new RunRecorder(was228, { seed: 24, game: '2.28.0' });
  for (let k = 0; k < (HOUR - 8 * 60 + 40) * STEPS_PER_MINUTE; k++) prev.step(0);
  check(!prev.sim.state.inmates.some((m) => ON_MACHINE.includes(m.doing)), 'the old rules: nobody on the machines');
  const replayed = replayLog(prev.toLog(), CENTER_PERKS);
  check(!!replayed?.ok && replayed.sim.rules228 === true, 'a 2.28 log through the hour replays whole under the old rules');
  check(!replayLog({ ...prev.toLog(), game: '2.31.0' }, CENTER_PERKS)?.ok, 'and would not under the new ones: the test can fail');
  check(new RunRecorder(prev.sim, { log: prev.toLog(), game: '2.31.0' }).toLog().seed === -1, 'and is not carried on');
  const now = new RunRecorder(new Sim(CENTER_PERKS, 24), { seed: 24, game: '2.31.0' });
  for (let k = 0; k < (HOUR - 8 * 60 + 40) * STEPS_PER_MINUTE; k++) now.step(0);
  check(!!replayLog(now.toLog(), CENTER_PERKS)?.ok, "a log of today's replays");
  check(new RunRecorder(now.sim, { log: now.toLog(), game: '2.31.1' }).toLog().seed === 24, 'and is carried on');
  // The old set: fast presses, a bar that drains, the bag no use at all.
  const o = new Bot(CENTER_PERKS, 3);
  o.sim.rules228 = true;
  check(o.routineUntil(1, HOUR + 2), 'the hour, as it was');
  clear(o);
  const w = o.sim.world.props.findIndex((p) => p.kind === 'weights');
  const ps = o.sim.world.props[w];
  put(o, (ps.z + 1) * MAP_W + ps.x, 13);
  o.st.energy = 100;
  o.act();
  check(o.st.train === w, 'on the weights, as it was');
  o.op(OP.TRAIN, 1);
  o.op(OP.TRAIN, 2);
  check(o.st.reps === 12 || o.st.reps === 11, `the old bar: 6 a press (${o.st.reps})`);
  const was = o.st.reps;
  o.step(0);
  o.step(0);
  check(o.st.reps < was, 'and it drains');
  o.op(OP.TRAIN, 3);
  const bag = o.sim.world.props.findIndex((p) => p.kind === 'punchingBag');
  const bp = o.sim.world.props[bag];
  put(o, (bp.z + 1) * MAP_W + bp.x, 13);
  const t = interactTarget(o.sim.world, o.st.items, o.st.player, false, o.st.layer);
  check(!(t?.kind === 'fixture' && t.index === bag), 'the bag, only for show');
  console.log('saves: a turn asked for kept; from before, none. Logs: a 2.28 log replays by the old rules and is not carried on; today\'s is');
}
