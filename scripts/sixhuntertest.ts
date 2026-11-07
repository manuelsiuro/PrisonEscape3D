/**
 * The Six Hunter's own rules (2.36, docs/phases/9-six-hunter.md), on its map and through the real simulation:
 * - the valley: the Hollowrun north and east beyond the electric deer fence, the fieldstone wall west and south with
 *   the road beyond; a tunnel dug north from the player's cell floods under the river; the granite ledge sends the
 *   tunnel south round it; seven ways out, no takeover;
 * - the pack of six: every Hunter has a hound (each its own coat and kennel in the kennels), three work nights, none
 *   before prison day 2;
 * - the recall horn on the Huntmaster's belt: blown, every hound goes home to its kennel for RECALL_STEPS (a lockdown's
 *   too), the noise wakes and sends the Hunters; the field kept through a save;
 * - the drag line (sock and aniseed): thrown, the trail washed out, the hounds pulled to where it lands; spent;
 * - tar soap washes twice; the ghillie cloak leaves no trail out in the open (indoors it does); a trout is a hound's
 *   treat as jerky is, and food;
 * - the kennel hand: the day's quota done, every hound fed from the player's hands (a little trust, never past
 *   KENNEL_TRUST_CAP from the troughs: a week at the job leaves the pack sniffing and tracking; a day's quota missed, it fades);
 * - the three new jobs' rooms (take, machines, put) and a cycle of each; the antler pick digs, quieter than steel;
 * - what's new is the Six Hunter's alone: its items only in its own tables, its recipes usable nowhere else (no other
 *   prison's tips move).
 * Its escapes are proven by escapetest (six bots) and paroletest; its outside by manhunttest and hunttest.
 */
import { ITEMS } from '../src/content/items';
import { JOBS } from '../src/content/jobs';
import { LOOT } from '../src/content/loot';
import { PRISONS } from '../src/content/prisons';
import { SIX_HUNTER } from '../src/content/prisons/six-hunter';
import { RECIPES } from '../src/content/recipes';
import { ZONES } from '../src/content/zones';
import { tossArgs, command, EXT, OP, SLOT } from '../src/sim/command';
import { loadState } from '../src/sim/load';
import { Sim } from '../src/sim/Sim';
import { jobRooms } from '../src/sim/systems/economy';
import { guardKit, itemOf, slot, usesOf } from '../src/sim/systems/items';
import { DOG, handlersOf, onShift, dogDef, kennelsFed, kennelsSettle, catchTreat } from '../src/sim/systems/k9';
import { obtainable, usableHere } from '../src/sim/systems/recipes';
import { strikeNoise } from '../src/sim/systems/noise';
import { toolTarget } from '../src/sim/systems/structure';
import {
  KENNEL_FADE,
  KENNEL_TRUST,
  KENNEL_TRUST_CAP,
  RECALL_STEPS,
  STEPS_PER_MINUTE,
  TREAT_TRUST,
  TRUST_FRIEND,
  TRUST_IGNORE,
  UNIT,
} from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { isTunnel, TILE } from '../src/sim/world/tiles';
import { LAYER, MAP_W, World } from '../src/sim/world/World';
import { Bot, DIR, n, tileOf } from './bots';
import { check } from './assert';

const place = (bot: Bot, x: number, z: number, layer: number = LAYER.GROUND) => {
  bot.st.player.x = x * UNIT + UNIT / 2;
  bot.st.player.z = z * UNIT + UNIT / 2;
  bot.st.layer = layer;
  // (Up and about: not in bed, on a seat or at a machine.)
  bot.st.sleeping = false;
  bot.st.seat = -1;
  bot.st.train = -1;
};
const give = (bot: Bot, ...ids: string[]) => {
  ids.forEach((id, k) => (bot.st.items.inv[k] = slot(n(id))));
  bot.st.items.rev++;
};
const zoneAt = (w: World, x: number, z: number) => ZONES[w.ground.zone[z * MAP_W + x]];
/** Runs the clock to a minute of a prison day, the routine kept meanwhile (nothing on the player's record). */
const runTo = (bot: Bot, day: number, minute: number) => check(bot.routineUntil(day, minute), `the routine kept to day ${day} ${minute}`);
const NEW = [
  'pine_tar',
  'fishing_net',
  'aniseed',
  'shed_antler',
  'trout',
  'drag_line',
  'tar_soap',
  'ghillie_cloak',
  'antler_pick',
  'recall_horn',
];

// ------------------------------------------------------------------ the valley
{
  const w = new World(SIX_HUNTER);
  const g = w.ground;
  const row = (z: number) => Array.from({ length: MAP_W }, (_, x) => g.kind[tileOf(x, z)]);
  // The river north (z 2–4) and east (x 60–61), the electric deer fence on its bank; the fieldstone wall west and south.
  check(
    row(3)
      .slice(2, 62)
      .every((k) => k === TILE.WATER || k === TILE.PIER),
    'the Hollowrun across the north',
  );
  let fence = 0;
  for (let x = 6; x <= 56; x++) if (g.kind[tileOf(x, 5)] === TILE.ELECTRIC) fence++;
  for (let z = 8; z <= 56; z++) if (g.kind[tileOf(59, z)] === TILE.ELECTRIC) fence++;
  let wall = 0;
  for (let z = 8; z <= 56; z++) if (g.kind[tileOf(3, z)] === TILE.REINFORCED) wall++;
  for (let x = 6; x <= 56; x++) if (x !== 26 && x !== 27 && g.kind[tileOf(x, 59)] === TILE.REINFORCED) wall++;
  check(
    fence === 51 + 49 && wall === 49 + 49,
    `the deer fence on the river's bank (${fence} tiles), the fieldstone wall west and south (${wall})`,
  );
  check(g.kind[tileOf(49, 3)] === TILE.PIER && g.kind[tileOf(49, 2)] === TILE.WATER, "the boathouse's jetty out into the river");
  check(zoneAt(w, 49, 9) === 'boathouse' && g.kind[tileOf(49, 8)] === TILE.DOOR && g.key[tileOf(49, 8)] === 4, 'the river door: red');
  check(
    SIX_HUNTER.escapes!.join() === 'raft,tunnel,glider,stowaway,bluff,paperwork,parole',
    `seven ways out, no takeover: ${SIX_HUNTER.escapes!.join(', ')}`,
  );
  check(SIX_HUNTER.difficulty === 6 && SIX_HUNTER.theme === 'forest', 'level 6, the forest');
  // The granite ledge: straight west from the desk, the tunnel meets stone.
  const under = w.layers[LAYER.UNDER].kind;
  check(
    [9, 8, 7, 6, 5, 4, 3, 2].every((x) => under[tileOf(x, 9)] === TILE.BOULDER),
    'granite west of the desk: the tunnel goes round',
  );
  console.log(`valley: the river north and east, the deer fence ${fence} tiles, the wall ${wall}, the jetty off the river door`);
}

// ------------------------------------------------------------------ a tunnel north floods under the river
{
  const bot = new Bot(SIX_HUNTER, 2);
  const w = bot.sim.world;
  const st = bot.st;
  // A tunnel already dug north from under the desk (11,9) to the deer fence's line (11,5).
  const shaft = tileOf(11, 9);
  w.setKind(LAYER.GROUND, shaft, TILE.SHAFT);
  st.tiles[shaft] = TILE.SHAFT;
  for (const z of [9, 8, 7, 6, 5]) {
    w.setKind(LAYER.UNDER, tileOf(11, z), TILE.BRACED);
    st.tiles[(LAYER.UNDER + 1) * MAP_W * 64 + tileOf(11, z)] = TILE.BRACED;
  }
  place(bot, 11, 5, LAYER.UNDER);
  give(bot, 'sturdy_shovel');
  bot.hold('sturdy_shovel');
  bot.face(DIR.NORTH);
  let flooded = false;
  for (let k = 0; k < 600 && !flooded; k++) {
    if (st.energy < 20) st.energy = 100;
    bot.op(OP.USE, 1);
    flooded = bot.sim.events.some((e) => e.type === 'flood');
  }
  let left = 0;
  for (let i = 0; i < MAP_W * 64; i++) if (isTunnel(w.layers[LAYER.UNDER].kind[i])) left++;
  check(
    flooded && left === 0 && w.ground.kind[shaft] === w.ground.base[shaft],
    `under the river (11,4): flooded, the tunnel lost (${left} left)`,
  );
  check(st.ko > 0, 'washed out cold');
  console.log('flood: dug north under the river from the cell wing, the tunnel and its entrance lost');
}

// ------------------------------------------------------------------ the pack of six
{
  const w = new World(SIX_HUNTER);
  const defs = SIX_HUNTER.guards;
  const dogs = defs.map((d) => d.dog);
  check(defs.length === 6 && dogs.every((d) => !!d), 'six Hunters, a hound each');
  check(new Set(dogs.map((d) => d!.coat)).size === 6, `six coats (${dogs.map((d) => d!.coat).join(', ')})`);
  check(
    dogs.every((d) => zoneAt(w, d!.kennel.x, d!.kennel.z) === 'kennels' && !w.blocked(d!.kennel.x, d!.kennel.z)),
    'every kennel on free floor in the kennel run',
  );
  check(
    dogs.filter((d) => d!.night).length === 3 && defs.filter((d) => d.night).length === 3,
    'three Hunters and their hounds work nights',
  );
  check(!defs.some((d) => d.riot || d.helipad), 'no riot guards');
  const bot = new Bot(SIX_HUNTER, 3);
  runTo(bot, 1, 11 * 60);
  check(
    bot.st.dogs.every((d) => d.mode === DOG.KENNEL),
    'day 1: the hounds lie by their kennels (from day 2, as everywhere)',
  );
  runTo(bot, 2, 11 * 60);
  check(
    bot.st.dogs.every((d) => d.mode !== DOG.KENNEL),
    'day 2, 11:00: every hound at its Hunter’s heel',
  );
  console.log(`pack: ${defs.map((d) => `${d.name} and ${d.dog!.name} (${d.dog!.coat}${d.dog!.night ? ', nights' : ''})`).join('; ')}`);
}

// ------------------------------------------------------------------ the recall horn
{
  const w = new World(SIX_HUNTER);
  const master = SIX_HUNTER.guards.findIndex((d) => d.kit?.includes('recall_horn'));
  check(
    master === 0 && guardKit(w, master).includes(n('recall_horn')) && guardKit(w, master).length === 4,
    "the Huntmaster's horn on his belt (four pockets: key, baton, uniform, horn)",
  );
  check(
    PRISONS.filter((p) => p !== SIX_HUNTER).every((p) => {
      const ow = new World(p);
      return p.guards.every((_, k) => !guardKit(ow, k).includes(n('recall_horn')));
    }),
    'no other prison’s guard carries one',
  );
  const bot = new Bot(SIX_HUNTER, 4);
  const st = bot.st;
  runTo(bot, 2, 11 * 60);
  place(bot, 20, 27);
  give(bot, 'recall_horn');
  bot.hold('recall_horn');
  check(
    toolTarget(bot.sim.world, st.layer, st.player, n('recall_horn'), [], st.items.inv)?.action === 'blow',
    'the horn in hand: the tool button blows it',
  );
  const at = st.step;
  bot.use();
  check(st.recall === at + 1 + RECALL_STEPS || st.recall === at + RECALL_STEPS, `blown: the hounds recalled till ${st.recall}`);
  const ev = bot.events.slice(-40);
  check(
    ev.some((e) => e.type === 'horn') && ev.some((e) => e.type === 'noise' && e.kind === 'bang' && e.sent.length > 0),
    'heard far and wide: Hunters sent to look',
  );
  check(
    bot.st.dogs.every((d) => d.mode === DOG.KENNEL),
    'every hound off to its kennel',
  );
  check(
    SIX_HUNTER.guards.every((d) => !onShift(bot.sim, d.dog!)),
    'none on shift while the horn holds',
  );
  // Saved and loaded: the field kept.
  const snap = JSON.parse(JSON.stringify(st));
  const back = loadState(bot.sim.world, SIX_HUNTER, snap);
  check(back.recall === st.recall, 'the recall kept through a save');
  bot.until(() => st.step >= st.recall!, RECALL_STEPS + 5);
  const home = st.dogs.filter((d, k) => {
    const kn = dogDef(bot.sim.world, k).kennel;
    return Math.floor(d.body.x / UNIT) === kn.x && Math.floor(d.body.z / UNIT) === kn.z;
  }).length;
  check(home >= 5, `by the time it wears off, the hounds home (${home} of 6 at their kennels)`);
  bot.until(() => false, 30);
  check(
    bot.st.dogs.every((d) => d.mode !== DOG.KENNEL),
    'and then back to work',
  );
  console.log(`horn: blown at day 2 11:00, the pack home ${home}/6 within ${RECALL_STEPS / STEPS_PER_MINUTE} minutes, back after`);
}

// ------------------------------------------------------------------ the drag line, tar soap, the ghillie cloak, a trout
{
  const bot = new Bot(SIX_HUNTER, 5);
  const st = bot.st;
  // (The trail is laid from prison day 2, when the hounds work.)
  runTo(bot, 2, 23 * 60 + 30);
  // Out after hours in the yard (open ground): a trail laid.
  place(bot, 20, 27);
  bot.until(() => false, 3);
  bot.step(command(DIR.EAST));
  bot.step(command(DIR.EAST));
  bot.until(
    () => false,
    20,
    () => command(DIR.EAST),
  );
  check(st.scent.length > 0, `out after hours: a trail (${st.scent.length} tiles)`);
  // The drag line thrown: the trail gone, a noise drawing Hunters, the line spent.
  give(bot, 'drag_line');
  bot.hold('drag_line');
  const [tb, tc] = tossArgs(tileOf(26, 29));
  bot.step(command(0, OP.EXT, EXT.THROW, tb, tc));
  const ev = bot.sim.events;
  // (Washed out: only the tile the player stands on is laid again, out of bounds still.)
  check(st.scent.length <= 1 && ev.some((e) => e.type === 'dragLine' && e.trail), 'the drag line lands: the trail washed out');
  // (23:30: no hound at work, day or night shift: nobody is pulled to it.)
  const quiet = ev.find((e) => e.type === 'noise' && e.kind === 'bark');
  check(!!quiet && quiet.type === 'noise' && quiet.sent.length === 0, 'no hound on shift (23:30): nobody pulled');
  check(bot.slotOf('drag_line') < 0 && !st.items.ground.some(([, v]) => itemOf(v) === n('drag_line')), 'spent');
  // 20:00, the hounds at work: only Hunters whose hound is on shift come, and the line is spent with no trail to take.
  const eve = new Bot(SIX_HUNTER, 15);
  runTo(eve, 2, 20 * 60);
  place(eve, 20, 25);
  // (The Huntmaster and his hound beside where it lands, in earshot even in the rain; Harrow too, his hound sneezing.)
  for (const [g, x, z] of [
    [0, 25, 28],
    [3, 23, 28],
  ] as const) {
    eve.st.guards[g].body.x = x * UNIT + UNIT / 2;
    eve.st.guards[g].body.z = z * UNIT + UNIT / 2;
  }
  eve.st.dogs[0].body.x = 26 * UNIT + UNIT / 2;
  eve.st.dogs[0].body.z = 28 * UNIT + UNIT / 2;
  eve.st.dogs[3].daze = eve.st.step + 600;
  give(eve, 'drag_line');
  eve.hold('drag_line');
  const [ub, uc] = tossArgs(tileOf(24, 27));
  eve.step(command(0, OP.EXT, EXT.THROW, ub, uc));
  const pull = eve.sim.events.find((e) => e.type === 'noise' && e.kind === 'bark');
  const handlers = handlersOf(eve.sim.world);
  check(
    eve.sim.events.some((e) => e.type === 'dragLine' && !e.trail) &&
      !!pull &&
      pull.type === 'noise' &&
      pull.sent.length > 0 &&
      pull.sent.every((g) => handlers.includes(g) && onShift(eve.sim, SIX_HUNTER.guards[g].dog!)) &&
      pull.sent.includes(0) &&
      !pull.sent.includes(3) &&
      eve.slotOf('drag_line') < 0,
    `20:00: the hounds on shift pull their Hunters there (${pull && pull.type === 'noise' ? pull.sent.map((g) => SIX_HUNTER.guards[g].name).join(', ') : 'none'}; Harrow's hound sneezing, he stays), the line spent with no trail to take`,
  );
  console.log('scent: a drag line washes the trail and pulls the hounds on shift');
}
{
  // Tar soap: two washes (a fresh night, nobody after the player).
  const bot = new Bot(SIX_HUNTER, 16);
  const st = bot.st;
  runTo(bot, 2, 23 * 60 + 30);
  const walk = (dir: number) => {
    place(bot, 20, 25);
    bot.until(
      () => false,
      10,
      () => command(dir),
    );
  };
  walk(DIR.EAST);
  give(bot, 'tar_soap');
  bot.hold('tar_soap');
  const laid = st.scent.length;
  bot.use();
  check(
    laid > 1 && st.scent.length <= 1 && usesOf(st.items.inv[bot.slotOf('tar_soap')]) === 1,
    `tar soap: washed (${laid} tiles), one wash left`,
  );
  walk(DIR.EAST);
  bot.use();
  check(st.scent.length <= 1 && bot.slotOf('tar_soap') < 0 && st.ko === 0, 'and the second: used up');
  console.log('scent: tar soap twice');
}
{
  // The ghillie cloak: no trail laid on open ground; in the corridor, as ever (a fresh night, nobody after the player).
  const bot = new Bot(SIX_HUNTER, 8);
  const st = bot.st;
  runTo(bot, 2, 23 * 60 + 30);
  st.items.inv[SLOT.OUTFIT] = slot(n('ghillie_cloak'));
  st.items.rev++;
  place(bot, 20, 25);
  bot.until(
    () => false,
    12,
    () => command(DIR.EAST),
  );
  check(st.scent.length === 0, 'in the ghillie cloak out in the open: no trail');
  place(bot, 20, 33);
  bot.until(
    () => false,
    12,
    () => command(DIR.EAST),
  );
  check(st.scent.length > 0 && st.ko === 0, `indoors it hides nothing (${st.scent.length} tiles)`);
  console.log('scent: the ghillie cloak hides the trail outdoors only');
}
{
  // A trout thrown to a hound wins it over as jerky does; eaten, energy.
  const bot = new Bot(SIX_HUNTER, 6);
  const st = bot.st;
  runTo(bot, 2, 10 * 60 + 30);
  const d = st.dogs[0];
  const dx = Math.floor(d.body.x / UNIT);
  const dz = Math.floor(d.body.z / UNIT);
  place(bot, dx, dz + 2);
  if (bot.sim.world.blocked(dx, dz + 2)) place(bot, dx + 2, dz);
  give(bot, 'trout');
  bot.hold('trout');
  const before = st.dogs.map((q) => q.trust);
  const [tb, tc] = tossArgs(Math.floor(d.body.z / UNIT) * MAP_W + Math.floor(d.body.x / UNIT));
  bot.step(command(0, OP.EXT, EXT.THROW, tb, tc));
  const fed = st.dogs.findIndex((q, k) => q.trust === before[k] + TREAT_TRUST);
  check(fed >= 0, `a trout thrown to a hound: it's fed (trust +${TREAT_TRUST})`);
  give(bot, 'trout');
  bot.hold('trout');
  st.energy = 50;
  bot.use();
  check(st.energy === 70 && bot.slotOf('trout') < 0, 'a trout eaten: +20 energy');
  console.log(`trout: thrown, hound ${fed} fed; eaten, +20 energy`);
}

// ------------------------------------------------------------------ the three new jobs, the kennel hand's pack
{
  const w = new World(SIX_HUNTER);
  const rooms = jobRooms(w);
  for (const id of ['kennels', 'smokehouse', 'nets'] as const) {
    const k = SIX_HUNTER.jobs.findIndex((j) => j.id === id);
    const r = rooms[k];
    const def = JOBS[id];
    check(
      r.take >= 0 && r.put >= 0 && r.machines.length >= 2 && r.take !== r.put,
      `${id}: its take (${w.props[r.take].kind}), ${r.machines.length} ${def.machine}s, its put (${w.props[r.put].kind}), in the ${def.zone}`,
    );
    check(!PRISONS.some((p) => p !== SIX_HUNTER && p.jobs.some((j) => j.id === id)), `${id}: only at the Six Hunter`);
  }
  check(SIX_HUNTER.jobs[0].id === 'kennels' && SIX_HUNTER.jobs[0].cell === 1, 'the player starts as the kennel hand');
  // A working day at the kennels, by hand: the feed bin, a trough, the bowl bin, four times.
  const bot = new Bot(SIX_HUNTER, 7);
  const st = bot.st;
  const room = rooms[0];
  check(bot.routineUntil(1, 12 * 60 + 5), 'to the Work Period');
  const stand = (prop: number) => {
    const p = w.props[prop];
    for (const [x, z, f] of [
      [p.x, p.z + p.d, DIR.NORTH],
      [p.x - 1, p.z, DIR.EAST],
      [p.x + p.w, p.z, DIR.WEST],
      [p.x, p.z - 1, DIR.SOUTH],
    ] as const)
      if (!bot.sim.world.blocked(x, z) && bot.walkTo(tileOf(x, z), 2000)) {
        bot.face(f);
        return true;
      }
    return false;
  };
  let cycles = 0;
  for (let k = 0; k < 6 && st.quota < JOBS.kennels.quota; k++) {
    stand(room.take);
    bot.act();
    const m = room.machines[k % room.machines.length];
    stand(m);
    bot.act();
    bot.until(() => (st.machines[m] ?? Infinity) <= st.step, 200);
    bot.act();
    stand(room.put);
    bot.act();
    cycles++;
  }
  check(st.quota === JOBS.kennels.quota && st.paid, `the quota done by hand (${st.quota} bowls in ${cycles} rounds), paid`);
  const fed = bot.events.filter((e) => e.type === 'dog' && e.what === 'fed').length;
  check(
    fed === 6 && st.dogs.every((d) => d.trust === KENNEL_TRUST && d.fed === 0),
    `every hound fed from the player's hands (${fed}), trust ${KENNEL_TRUST} each, a treat still welcome today`,
  );
  console.log(`kennels: ${st.quota} bowls by ${bot.time}, $${JOBS.kennels.wage}, the pack fed (${fed})`);
}
{
  // A week at the troughs: the pack never past KENNEL_TRUST_CAP from the job alone (it still sniffs and tracks); a
  // jerky a day on top is what wins one over; a missed quota and the trust fades.
  const sim = new Sim(SIX_HUNTER, 9);
  const s = sim.state;
  const week: number[] = [];
  for (let day = 1; day <= 7; day++) {
    s.step = (day - 1) * 1440 * STEPS_PER_MINUTE + 5 * 60 * STEPS_PER_MINUTE;
    kennelsFed(sim);
    kennelsSettle(sim, true);
    week.push(s.dogs[0].trust);
  }
  check(
    s.dogs.every((d) => d.trust === KENNEL_TRUST_CAP) && KENNEL_TRUST_CAP < TRUST_IGNORE,
    `seven days at the troughs alone: trust ${week.join(', ')} (capped at ${KENNEL_TRUST_CAP}, below the ${TRUST_IGNORE} that lets contraband by)`,
  );
  // Jerky thrown to hound 0 each day on top: a friend in a few days.
  const d = s.dogs[0];
  const k = dogDef(sim.world, 0).kennel;
  let days = 0;
  for (let day = 8; day <= 14 && d.trust < TRUST_FRIEND; day++) {
    s.step = (day - 1) * 1440 * STEPS_PER_MINUTE + 5 * 60 * STEPS_PER_MINUTE;
    d.body.x = k.x * UNIT + UNIT / 2;
    d.body.z = k.z * UNIT + UNIT / 2;
    catchTreat(sim, n('jerky'), k.z * MAP_W + k.x);
    days++;
  }
  check(d.trust >= TRUST_FRIEND, `a jerky a day on top: a friend in ${days} days`);
  const was = s.dogs[1].trust;
  kennelsSettle(sim, false);
  check(
    s.dogs[1].trust === was - KENNEL_FADE && d.trust === TRUST_FRIEND - KENNEL_FADE,
    `a quota missed: every hound's trust fades by ${KENNEL_FADE}`,
  );
  console.log(`kennels over a week: trust ${week.join(', ')}; jerky on top, a friend in ${days} days; a missed day -${KENNEL_FADE}`);
}

// ------------------------------------------------------------------ the antler pick
{
  const pick = ITEMS.find((d) => d.id === 'antler_pick')!;
  const steel = ITEMS.find((d) => d.id === 'sturdy_shovel')!;
  check(pick.tool?.kind === 'dig', 'the antler pick digs');
  const target = { action: 'dig' as const, layer: LAYER.UNDER, tile: 0, fits: true, hp: 1 };
  const reach = (id: string) => strikeNoise(LAYER.UNDER, target, n(id))!.reach;
  check(
    reach('antler_pick') < reach('light_shovel') &&
      reach('light_shovel') < reach('sturdy_shovel') &&
      reach('antler_pick') === reach('plastic_spoon'),
    `bone digs quieter than any metal shovel, as quiet as plastic (heard ${reach('antler_pick')} tiles, a light shovel ${reach('light_shovel')}, a sturdy one ${reach('sturdy_shovel')}; ${pick.tool!.damage} a strike against ${steel.tool!.damage})`,
  );
}

// ------------------------------------------------------------------ what's new is the Six Hunter's alone
{
  const tables = ['kennelBin', 'smokehouseFreezer', 'boathouseBin'];
  for (const p of PRISONS) {
    const w = new World(p);
    const have = obtainable(w);
    const own = containersOf(w).filter((c) => tables.includes(c.table)).length;
    const newHere = NEW.filter((id) => have.has(n(id)));
    const tips = RECIPES.map((r, k) => (NEW.includes(r.result) && usableHere(w, k) ? r.result : '')).filter(Boolean);
    if (p === SIX_HUNTER) {
      check(own >= 5 && newHere.length === NEW.length, `${p.id}: its own bins (${own}), every new item to be had`);
      check(tips.length === 4, `${p.id}: its four recipes usable (${tips.join(', ')})`);
    } else {
      check(
        own === 0 && newHere.length === 0 && tips.length === 0,
        `${p.id}: none of it (${newHere.join(', ') || 'no new item'}, ${tips.length} recipes)`,
      );
    }
  }
  // The old tables untouched: no new item in them.
  for (const [name, t] of Object.entries(LOOT))
    if (!tables.includes(name)) check(!t.items.some(([id]) => NEW.includes(id)), `the ${name} table stocks none of it`);
  console.log(`new: ${NEW.length} items, 4 recipes, 3 tables, only at the Six Hunter`);
}
void Sim;
void handlersOf;
