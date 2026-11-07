/**
 * Talking, favors and opinion (2.36's polish pass), in every prison, by real commands:
 * - **a favor walked through:** taken on in free time, what's asked for found in someone's desk (walked
 *   to, opened, taken), walked back and handed in: the pay and the opinion, and the time it took
 *   against the free time there is;
 * - **"from someone's desk" holds:** every everyday thing a favor asks for is, once the favor is taken
 *   on, in the drawers of an inmate's desk not the asker's (desks fill up and then stay as they are, so
 *   before 2.36 a talcum or a battery could be in none for days); one already there, nothing added;
 *   runs logged before 2.36 (`Sim.rules235`) as they were;
 * - **let go:** a favor taken on and not done can be let go (−5 opinion with the asker, its place
 *   free again); an offer, or one done, can't;
 * - **the other three kinds:** the stolen thing in the thief's pockets, a knockout doing a beatdown;
 * - **the ladder:** what opinion opens is what the rules do, step by step (side games, a tip, joining
 *   the crew, a night up), and How to play's numbers are the ladder's;
 * - **gifts:** what a gift and cash add, never past 100.
 */
import { PRISONS } from '../src/content/prisons';
import { NIGHT_OPINION } from '../src/content/crew';
import { GAME_OPINION } from '../src/content/games';
import { ROUTINE } from '../src/content/routine';
import { en } from '../src/i18n/en';
import { fr } from '../src/i18n/fr';
import { command, OP, ORDER, TALK } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { cashOpinion, FAVOR, FAVOR_ITEMS, FAVOR_STATE, giftOpinion, OPINION_LADDER } from '../src/sim/systems/economy';
import { HOTBAR, itemOf, pocketOf, slot } from '../src/sim/systems/items';
import { containersOf } from '../src/sim/world/containers';
import { FAVOR_DROP_OPINION, FAVOR_OPINION, OPINION_HIGH, OPINION_LOW, STEPS_PER_MINUTE, TIP_OPINION, UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { itemDef } from '../src/content/items';
import { check } from './assert';
import { Bot, DIR, n } from './bots';

const MIN = STEPS_PER_MINUTE;
const tileOfBody = (b: { x: number; z: number }) => Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);
const refused = (seen: readonly SimEvent[], why: string) => seen.some((e) => e.type === 'refused' && e.why === why);

/** The way to face from one tile to the next one beside it. */
function dirTo(from: number, to: number): number {
  const dx = (to % MAP_W) - (from % MAP_W);
  const dz = Math.floor(to / MAP_W) - Math.floor(from / MAP_W);
  return dx > 0 ? DIR.EAST : dx < 0 ? DIR.WEST : dz > 0 ? DIR.SOUTH : DIR.NORTH;
}

/** The tiles beside a tile (east, west, south, north) the player can stand on. */
function besides(sim: Sim, t: number): number[] {
  const x = t % MAP_W;
  const z = Math.floor(t / MAP_W);
  return [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
    .map(([dx, dz]) => (z + dz) * MAP_W + x + dx)
    .filter((k) => !sim.world.blocked(k % MAP_W, Math.floor(k / MAP_W)));
}

/**
 * Walked up to an inmate and talking (true once talking): they stay where they are (a test's hold,
 * so the walk has somewhere to end), the player walks to a tile beside them, faces them and presses.
 */
function meet(bot: Bot, who: number): boolean {
  const s = bot.st;
  const m = s.inmates[who];
  // (They may be walking somewhere, or called off by the vending machine's queue: followed until met.)
  for (let k = 0; k < 40 && s.talk !== who; k++) {
    const t = tileOfBody(m.body);
    const here = tileOfBody(s.player);
    const sides = besides(bot.sim, t).sort((a, b) => dist(a, here) - dist(b, here));
    if (!sides.length) {
      bot.step();
      continue;
    }
    if (here !== sides[0]) bot.walkTo(sides[0], 300);
    if (tileOfBody(s.player) !== sides[0]) continue;
    bot.face(dirTo(sides[0], tileOfBody(m.body)));
    bot.act();
  }
  return s.talk === who;
}
/** An order across the talk to `who` (met again if they've walked off), them held still for it. */
function say(bot: Bot, who: number, a: number, b = 0) {
  const m = bot.st.inmates[who];
  // (Walked off as it was said, the talk over before it landed: met again and said again.)
  for (let k = 0; k < 3; k++) {
    if (bot.st.talk !== who) meet(bot, who);
    m.path = [];
    m.goal = -1;
    m.wait = 1_000_000;
    bot.op(OP.TALK, a, b);
    if (!bot.sim.events.some((e) => e.type === 'talk' && e.who < 0)) return;
  }
}
const dist = (a: number, b: number) => Math.abs((a % MAP_W) - (b % MAP_W)) + Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W));

/** The inmates' desks (container indexes) and the cell each stands in. */
function desks(sim: Sim): Array<{ i: number; cell: number }> {
  const w = sim.world;
  return containersOf(w)
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.table === 'inmateDesk')
    .map(({ c, i }) => ({ i, cell: w.cellOf[c.prop.z * MAP_W + c.prop.x] }));
}
const drawers = (sim: Sim, i: number) => sim.state.items.containers[i].slice(containersOf(sim.world)[i].hidden);
const inDrawers = (sim: Sim, item: number, not = -1) =>
  desks(sim).filter((d) => d.cell !== not && drawers(sim, d.i).some((v) => itemOf(v) === item));

/** Walks to a desk, opens it and takes `item` from its drawers into the hotbar (whether it did). */
function fetchFromDesk(bot: Bot, i: number, item: number): boolean {
  const sim = bot.sim;
  const p = containersOf(sim.world)[i].prop;
  const t = p.z * MAP_W + p.x;
  for (const side of besides(sim, t)) {
    if (!bot.walkTo(side, 4000)) continue;
    bot.face(dirTo(side, t));
    if (!bot.open(i)) continue;
    const k = bot.st.items.containers[i].findIndex((v, j) => j >= containersOf(sim.world)[i].hidden && itemOf(v) === item);
    const free = bot.st.items.inv.slice(0, HOTBAR).indexOf(0);
    if (k < 0 || free < 0) return false;
    bot.op(OP.MOVE, 8 + k, free);
    bot.close();
    return bot.slotOf(itemDef(item).id) >= 0;
  }
  return false;
}

/** A favor of a kind, offered by `by` (the day's offers set aside). */
function offer(sim: Sim, by: number, kind: number, item = 0, target = -1, reward = 30) {
  sim.state.favors = [{ by, kind, item, target, reward, state: FAVOR_STATE.OFFERED }];
}

const summary: string[] = [];
const lateNone: string[] = [];
for (const prison of PRISONS) {
  const bot = new Bot(prison, 3);
  const { sim, st } = bot;
  bot.routineUntil(1, 10 * 60 + 2);
  check(ROUTINE[st.routine].id === 'freeTime', `${prison.id}: free time`);
  check(
    st.favors.length > 0 && st.favors.every((f) => f.state === FAVOR_STATE.OFFERED && f.reward >= 20 && f.reward <= 50),
    `${prison.id}: favors on offer on day 1, $20–50 each (${st.favors.length})`,
  );
  const asker = st.inmates.findIndex((_, k) => sim.merchantOf(k) < 0 && k > 0);
  const askerCell = st.inmates[asker].cell;

  // "From someone's desk": every everyday thing asked for is in some desk's drawers once taken on.
  const planted: string[] = [];
  check(meet(bot, asker), `${prison.id}: walked up to ${asker} and talking`);
  for (const id of FAVOR_ITEMS) {
    const item = n(id);
    const before = inDrawers(sim, item, askerCell).length;
    const count = () => desks(sim).reduce((a, d) => a + drawers(sim, d.i).filter((v) => itemOf(v) === item).length, 0);
    const had = count();
    offer(sim, asker, FAVOR.SCAVENGE, item);
    say(bot, asker, TALK.ACCEPT);
    check(st.favors[0]?.state === FAVOR_STATE.TAKEN, `${prison.id}: the ${id} favor taken on`);
    const after = inDrawers(sim, item, askerCell);
    check(after.length > 0, `${prison.id}: a ${id} in some desk's drawers, not the asker's`);
    check(count() === had + (before ? 0 : 1), `${prison.id}: ${before ? 'one there already, nothing added' : 'one put there'} (${id})`);
    if (!before) planted.push(id);
  }
  // Day 4, the desks full and as they'll stay: what no desk holds is still found, once taken on.
  {
    const late = new Bot(prison, 5);
    late.routineUntil(4, 10 * 60 + 2);
    const none = FAVOR_ITEMS.filter((id) => !inDrawers(late.sim, n(id), askerCell).length);
    for (const id of none) {
      offer(late.sim, asker, FAVOR.SCAVENGE, n(id));
      say(late, asker, TALK.ACCEPT);
    }
    check(
      none.every((id) => inDrawers(late.sim, n(id), askerCell).length > 0),
      `${prison.id}: day 4, in no desk until taken on: ${none.join(', ') || 'none'}; then in one`,
    );
    lateNone.push(`${prison.id} ${none.join(', ') || 'none'}`);
  }
  // The same under the rules before 2.36: nothing put anywhere.
  {
    const old = new Bot(prison, 3);
    old.sim.rules235 = true;
    old.routineUntil(1, 10 * 60 + 2);
    meet(old, asker);
    const counts = () =>
      desks(old.sim)
        .map((d) => drawers(old.sim, d.i).join(','))
        .join('|');
    const was = counts();
    for (const id of FAVOR_ITEMS) {
      offer(old.sim, asker, FAVOR.SCAVENGE, n(id));
      say(old, asker, TALK.ACCEPT);
    }
    check(counts() === was, `${prison.id}: a run logged before 2.36 puts nothing in the desks`);
  }

  // Walked through: a favor for something that wasn't in any desk, found, brought back, handed in.
  const want = n(planted[0] ?? FAVOR_ITEMS[0]);
  offer(sim, asker, FAVOR.SCAVENGE, want, -1, 37);
  say(bot, asker, TALK.ACCEPT);
  bot.op(OP.CLOSE);
  const from = st.step;
  const desk = inDrawers(sim, want, askerCell)[0];
  st.items.inv.fill(0, 0, HOTBAR);
  const found = !!desk && fetchFromDesk(bot, desk.i, want);
  check(found, `${prison.id}: the ${itemDef(want).id} found in a desk and taken`);
  const cash = st.cash;
  const op0 = st.inmates[asker].opinion;
  check(meet(bot, asker), `${prison.id}: back with ${asker}`);
  say(bot, asker, TALK.HAND_IN);
  const took = Math.round((st.step - from) / MIN);
  check(
    st.favors.length === 0 && st.cash === cash + 37 && st.inmates[asker].opinion === Math.min(100, op0 + FAVOR_OPINION),
    `${prison.id}: handed in: $37 and +${FAVOR_OPINION} opinion`,
  );
  check(took < 120, `${prison.id}: the whole favor in the morning's free time (${took} min of 120)`);

  // Let go: only one taken on and not done; it frees its place and costs a little opinion.
  const seen: SimEvent[] = [];
  let partner = asker;
  const tries: string[] = [];
  const talk = (a: number, b = 0) => {
    say(bot, partner, a, b);
    seen.push(...sim.events);
  };
  offer(sim, asker, FAVOR.DISTRACTION);
  const op1 = st.inmates[asker].opinion;
  talk(TALK.DROP);
  check(st.favors.length === 1 && st.inmates[asker].opinion === op1, `${prison.id}: an offer can't be let go`);
  talk(TALK.ACCEPT);
  st.favors.push(
    { by: 98, kind: FAVOR.DISTRACTION, item: 0, target: -1, reward: 20, state: FAVOR_STATE.TAKEN },
    { by: 99, kind: FAVOR.DISTRACTION, item: 0, target: -1, reward: 20, state: FAVOR_STATE.TAKEN },
  );
  talk(TALK.DROP);
  check(
    !st.favors.some((f) => f.by === asker) &&
      st.inmates[asker].opinion === op1 - FAVOR_DROP_OPINION &&
      seen.some((e) => e.type === 'favor' && e.state === 'dropped' && e.who === asker),
    `${prison.id}: taken on, let go: gone, −${FAVOR_DROP_OPINION} opinion`,
  );
  st.favors.push({ by: asker, kind: FAVOR.DISTRACTION, item: 0, target: -1, reward: 20, state: FAVOR_STATE.OFFERED });
  talk(TALK.ACCEPT);
  check(st.favors.find((f) => f.by === asker)?.state === FAVOR_STATE.TAKEN, `${prison.id}: its place free again: a third taken on`);
  st.favors.find((f) => f.by === asker)!.state = FAVOR_STATE.DONE;
  talk(TALK.DROP);
  check(
    st.favors.some((f) => f.by === asker),
    `${prison.id}: one done isn't let go (it's handed in)`,
  );
  st.favors = [];

  // The other kinds: the stolen thing in the thief's pockets; a knockout doing a beatdown.
  const thief = st.inmates.findIndex((_, k) => k !== asker && k > 0);
  offer(sim, asker, FAVOR.RETRIEVE, n('soap'), thief);
  talk(TALK.ACCEPT);
  check(
    st.items.containers[pocketOf(sim.world, thief)].some((v) => itemOf(v) === n('soap')),
    `${prison.id}: a retrieval: the thief has it`,
  );
  offer(sim, asker, FAVOR.BEATDOWN, 0, thief);
  talk(TALK.ACCEPT);
  bot.op(OP.CLOSE);
  const tm = st.inmates[thief];
  tm.hp = 1;
  tm.wait = 1_000_000;
  tm.path = [];
  const tt = tileOfBody(tm.body);
  const side = besides(sim, tt)[0];
  st.player.x = (side % MAP_W) * UNIT + UNIT / 2;
  st.player.z = Math.floor(side / MAP_W) * UNIT + UNIT / 2;
  bot.op(OP.LOCK, 2 + thief);
  for (let k = 0; k < 40 && tm.ko <= 0; k++) bot.op(OP.USE, 1);
  check(tm.ko > 0 && st.favors[0]?.state === FAVOR_STATE.DONE, `${prison.id}: the target knocked out: the beatdown done`);
  st.favors = [];
  st.heat = 0;

  // The ladder: each step up is what the rules do (a fresh morning's free time, where games are on).
  const b2 = new Bot(prison, 4);
  b2.routineUntil(1, 10 * 60 + 2);
  const friend = b2.st.inmates.findIndex((_, k) => k !== asker && k !== thief && k > 0 && b2.sim.merchantOf(k) < 0);
  const fm = b2.st.inmates[friend];
  partner = friend;
  ladder(prison.id, b2, friend, fm, seen, tries);
  summary.push(
    `${prison.id}: favor walked through in ${took} min (${itemDef(want).id}); put in a desk on taking on: ${planted.join(', ') || 'none'}; ladder ${tries.join(', ')}`,
  );
}

function ladder(id: string, bot: Bot, friend: number, fm: { opinion: number }, seen: SimEvent[], tries: string[]) {
  const st = bot.st;
  const talk = (a: number, b = 0) => {
    say(bot, friend, a, b);
    seen.push(...bot.sim.events);
  };
  const prison = { id };
  check(meet(bot, friend), `${prison.id}: talking to ${friend}`);
  const rung = (name: string, at: number, act: () => void, why: string, ok: () => boolean) => {
    seen.length = 0;
    fm.opinion = at - 1;
    act();
    const below = refused(seen, why);
    seen.length = 0;
    fm.opinion = at;
    act();
    const there = !refused(seen, why) && ok();
    check(below && there, `${prison.id}: ${name}: refused at ${at - 1}, there at ${at}`);
    tries.push(`${name} ${at}`);
  };
  st.cash = 100;
  rung(
    'side games',
    GAME_OPINION,
    () => talk(TALK.DICE, 0),
    'gameOpinion',
    () => st.dice[0] === friend,
  );
  bot.until(
    () => st.dice.length === 0,
    200,
    () => command(0, OP.TALK, TALK.REROLL, 0),
  );
  st.tipDay = [];
  rung(
    'a recipe tip',
    TIP_OPINION,
    () => {
      st.tipDay[friend] = 0;
      talk(TALK.TIP);
    },
    'tipOpinion',
    () => true,
  );
  rung(
    'joining the crew',
    OPINION_HIGH,
    () => talk(TALK.RECRUIT),
    'opinion',
    () => st.followers.includes(friend),
  );
  rung(
    'a night up',
    NIGHT_OPINION,
    () => talk(TALK.CREW, ORDER.NIGHT),
    'nightOpinion',
    () => st.crew.some((e) => e[0] === friend && e[4] === 1),
  );
  talk(TALK.DISMISS);

  // Gifts never past 100: what the panel shows is what's added.
  fm.opinion = 97;
  st.items.inv[0] = slot(n('crowbar'));
  talk(TALK.GIFT, 0);
  check(fm.opinion === 100, `${prison.id}: a crowbar at 97: +3, to 100 (not +${giftOpinion(itemDef(n('crowbar')).value)})`);
  fm.opinion = 50;
  st.cash = 20;
  talk(TALK.GIFT_CASH, 20);
  check(fm.opinion === 50 + cashOpinion(20) && st.cash === 0, `${prison.id}: $20 given: +${cashOpinion(20)}`);
  bot.op(OP.CLOSE);
}

// How to play's chips are the ladder's numbers, in both languages' first column.
{
  for (const [lang, text] of [
    ['en', en['help.inmates.nums']],
    ['fr', fr['help.inmates.nums'] ?? ''],
  ] as const) {
    const nums = text.split('\n').map((l) => Number(l.split('|')[0]));
    check(
      nums.join(',') === OPINION_LADDER.map(([k]) => k).join(','),
      `How to play's opinion numbers are the rules' (${lang}: ${nums.join(', ')})`,
    );
  }
  check(OPINION_LADDER[0][0] === OPINION_LOW + 1, 'the first step is just past a grudge');
}

for (const line of summary) console.log(line);
console.log(`day 4, asked for and in no desk's drawers (put in one on taking on): ${lateNone.join('; ')}`);
