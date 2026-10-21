/**
 * The pay phone (P34, docs/PLAN.md §11), through the real simulation:
 * - the data: every campaign prison's phone (open floor in front of a wall, outside the
 *   restricted zones), its queue's tiles and the front gate's inside, all reachable; none at the
 *   Training Block;
 * - the queue: nobody on day 1; from day 2 inmates join at their minute, never more than
 *   LINE_MAX, call for 10–20 minutes, are overheard (once a day each); the player's place, turn,
 *   lost turn, a place bought, cutting in (opinions, the swing measured);
 * - the calls: home (energy, the weekly money order paid at mail call), the lawyer (appeal,
 *   retainer halving solitary), tips (the search, found or empty, word getting round), refusals;
 * - Lou's tapped line: one phrase of each kind a line, ways of talking measured against every
 *   listener, codes learned, silence, hanging up, the fee only when understood;
 * - his jobs: the diversion (guards at the gate, back after), blown (ignored); the cake at a
 *   visit and through the frisk, eaten (the file), blown (seized), Stalag Flucht's parcel; the
 *   car on the night (an escape drives off in it);
 * - saves mid-call and mid-queue, a save from before the phone.
 */
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { STALAG_FLUCHT } from '../src/content/prisons/stalag-flucht';
import { TRAINING } from '../src/content/prisons/training';
import { DAY_EVENTS } from '../src/content/days';
import { DECOR } from '../src/content/decor';
import { itemNumber } from '../src/content/items';
import { APPEAL_HEAT, CALLEE, CATCH, CLEAR_NEED, COINS, CUT_OPINION, CUT_SWING, DIVERT_GUARDS, HOME_ENERGY, JOB, JOB_FEES, LAWYER, LINE_MAX, LINE_STEPS, MONEY_EVERY, OVERHEAR_STEPS, SWAP_PRICE, TAP_HEAT, TIER, TIP_HEAT, TURN_STEPS } from '../src/content/phone';
import { command, EXT, LINE, OP, TALK } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { loadState, WAKE } from '../src/sim/state';
import { DAY_STEPS } from '../src/sim/systems/clock';
import { GUARD } from '../src/sim/systems/guards';
import { DOING } from '../src/sim/systems/inmates';
import { slot } from '../src/sim/systems/items';
import { visitPairs } from '../src/sim/systems/smuggling';
import { carWaiting, catchAt, divertStep, phraseWorth, phrasesOf, PLAYER_IN_LINE, wantsCall } from '../src/sim/systems/phone';
import { SOLITARY_STEPS, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';

const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const of = <T extends SimEvent['type']>(seen: SimEvent[], type: T) => seen.filter((e) => e.type === type) as Array<Extract<SimEvent, { type: T }>>;
const news = (seen: SimEvent[], what: string) => of(seen, 'phone').filter((e) => e.what === what);
const refusals = (seen: SimEvent[]) => of(seen, 'refused').map((e) => e.why);

/** A game kept calm (lockdowns cleared each step), quiet days unless forced. */
function game(prison = CENTER_PERKS, seed = 5, calendar: Array<[number, number, number]> = []) {
  const sim = new Sim(prison, seed);
  sim.state.calendar = [[0, 0, 0], ...calendar];
  const seen: SimEvent[] = [];
  let calm = true;
  const step = (cmd = 0) => {
    sim.step(cmd);
    seen.push(...sim.events);
    if (calm && sim.state.lockdown) sim.state.lockdown = false;
  };
  const jump = (day: number, hour: number, minute = 0) => {
    // (A day jumped into starts afresh, as 08:00 would have left it.)
    if (Math.floor((at(day, hour, minute) - 1) / DAY_STEPS) !== Math.floor(sim.state.step / DAY_STEPS)) sim.state.eventFlags = 0;
    sim.state.step = at(day, hour, minute) - 1;
    sim.state.attended = true;
    sim.state.excused = true;
    step();
  };
  const to = (day: number, hour: number, minute = 0) => {
    const target = at(day, hour, minute);
    while (sim.state.step < target && !sim.state.escaped) step();
  };
  const ext = (a: number, b = 0, c = 0) => step(command(0, OP.EXT, a, b, c));
  /** The player at the phone, facing it. */
  const toPhone = () => {
    const c = prison.comms!;
    put(sim.state.player, c.phone.x, c.phone.z);
    sim.state.player.facing = c.phone.face;
  };
  const call = (to: number, sub = 0, arg = 0) => ext(EXT.CALL, to * 16 + sub, arg);
  const setCalm = (on: boolean) => (calm = on);
  return { sim, seen, step, jump, to, ext, toPhone, call, setCalm };
}

/** Puts a body in the middle of a tile. */
const put = (b: { x: number; z: number }, x: number, z: number) => {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
};

// ------------------------------------------------------------------ the data
{
  const lines: string[] = [];
  for (const p of PRISONS) {
    const sim = new Sim(p, 1);
    const w = sim.world;
    const c = p.comms;
    check(!!c, `${p.id}: a pay phone`);
    if (!c) continue;
    const open = (x: number, z: number) => {
      const prop = w.props.some((o) => x >= o.x && x < o.x + o.w && z >= o.z && z < o.z + o.d);
      const decor = (p.decor ?? []).some((d) => !DECOR[d.kind].wall && x >= d.x && x < d.x + (d.w ?? 1) && z >= d.z && z < d.z + (d.d ?? 1));
      return !w.blocked(x, z) && !prop && !decor;
    };
    const zone = w.zoneAt(c.phone.x, c.phone.z);
    check(open(c.phone.x, c.phone.z) && ['corridor', 'canteen', 'cellBlock'].includes(zone), `${p.id}: the phone's tile is open floor in a corridor (${zone})`);
    check(c.phone.face === 13 && w.blocked(c.phone.x, c.phone.z - 1), `${p.id}: the phone hangs on a north wall (the camera sees it)`);
    const wallDecor = (p.decor ?? []).filter((d) => DECOR[d.kind].wall && d.z === c.phone.z && d.x <= c.phone.x && d.x + (d.w ?? 1) > c.phone.x);
    check(wallDecor.length === 0, `${p.id}: nothing else hangs on the phone's bit of wall (${wallDecor.map((d) => d.kind).join(' ')})`);
    const bad = c.line.filter((t) => !open(t.x, t.z) || w.zoneAt(t.x, t.z) !== zone);
    check(c.line.length === LINE_MAX && bad.length === 0, `${p.id}: ${LINE_MAX} queue tiles, open floor beside it (${bad.map((t) => `${t.x},${t.z}`).join(' ')})`);
    const tiles = [c.phone, ...c.line].map((t) => t.z * MAP_W + t.x);
    check(new Set(tiles).size === tiles.length, `${p.id}: the phone and its queue on different tiles`);
    check(c.line.every((t, k) => Math.abs(t.x - (k ? c.line[k - 1] : c.phone).x) + Math.abs(t.z - (k ? c.line[k - 1] : c.phone).z) === 1), `${p.id}: the queue a tile after another`);
    // Everyone walks to it; guards walk to the gate (keys: every colour).
    w.setPlayerKeys(new Set([1, 2, 3, 4, 5]) as never);
    const from = sim.state.player;
    const reach = new Set<number>([Math.floor(from.z / UNIT) * MAP_W + Math.floor(from.x / UNIT)]);
    const queue = [...reach];
    while (queue.length) {
      const t = queue.pop()!;
      const x = t % MAP_W;
      const z = Math.floor(t / MAP_W);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nt = (z + dz) * MAP_W + x + dx;
        if (reach.has(nt) || !w.inside(x + dx, z + dz) || w.npcBlock[nt]) continue;
        reach.add(nt);
        queue.push(nt);
      }
    }
    check(tiles.every((t) => reach.has(t)), `${p.id}: the phone and its queue can be walked to`);
    check(!w.blocked(c.gate.x, c.gate.z), `${p.id}: the gate's inside is open floor`);
    check(w.zoneAt(c.car.x, c.car.z) === 'outside' && [1, 5, 9, 13].includes(c.car.face), `${p.id}: Lou's car waits on the road`);
    lines.push(`${p.id}: phone ${c.phone.x},${c.phone.z} (${zone}); queue ${c.line.map((t) => `${t.x},${t.z}`).join(' ')}; gate ${c.gate.x},${c.gate.z} (${w.zoneAt(c.gate.x, c.gate.z)}); car ${c.car.x},${c.car.z}`);
  }
  check(!TRAINING.comms, 'the Training Block has none');
  console.log(lines.join('\n'));
}

// ------------------------------------------------------------------ the queue
{
  const g = game();
  const { sim, seen } = g;
  // Day 1: nobody queues (the escape bots' day).
  g.jump(1, 10);
  g.to(1, 12);
  check(news(seen, 'joined').length === 0 && sim.state.booth[0] < 0, 'day 1: nobody queues');
  g.jump(1, 18);
  g.to(1, 22);
  check(news(seen, 'joined').length === 0, 'day 1 evening: nobody queues');
  // Day 2, the phone never used: nobody queues either (a run that never touches it plays as before).
  g.jump(2, 10);
  g.to(2, 12);
  check(news(seen, 'joined').length === 0, 'the phone never used: nobody queues');
  sim.state.phoned[6] = 1;
  // From day 2: the inmates who want a call join at their minute, never more than LINE_MAX.
  let most = 0;
  let calls = 0;
  const lengths: number[] = [];
  for (let day = 2; day <= 5; day++) {
    for (const [from, until] of [[10, 12], [18, 22]] as const) {
      if (day === 2 && from === 10) continue;
      g.jump(day, from);
      const begun = seen.length;
      while (sim.state.step < at(day, until)) {
        g.step();
        most = Math.max(most, sim.state.line.length);
        for (const e of sim.events) if (e.type === 'phone' && e.what === 'inmateCall') {
          calls++;
          lengths.push((sim.state.booth[1] - sim.state.step) / STEPS_PER_MINUTE);
        }
      }
      const joined = news(seen.slice(begun), 'joined').map((e) => e.who!);
      const b = from === 10 ? 0 : 1;
      const wanted = sim.state.inmates.map((_, k) => k).filter((k) => wantsCall(sim.state.salt, day, b, k) >= 0);
      check(joined.every((k) => wanted.includes(k)), `day ${day} ${from}:00: only those who want a call join`);
      check(new Set(joined).size === joined.length, `day ${day} ${from}:00: each joins once`);
    }
    check(sim.state.line.length === 0 && sim.state.booth[0] < 0, `day ${day}: the queue gone at 22:00`);
  }
  check(most <= LINE_MAX, `never more than ${LINE_MAX} waiting (${most})`);
  check(calls >= 4, `inmates call (${calls} calls over four days)`);
  check(lengths.every((m) => m >= 10 && m <= 20), `calls last 10–20 minutes (${Math.min(...lengths)}–${Math.max(...lengths)})`);
  check(sim.state.inmates.every((m) => m.doing !== DOING.QUEUE || sim.state.line.length > 0), 'nobody left standing in a queue');
  console.log(`queue: ${calls} inmate calls over days 2–5, at most ${most} waiting`);
}

// Eavesdropping: close to the caller for OVERHEAR_STEPS, once a day each.
{
  const g = game();
  const { sim, seen } = g;
  let heard = 0;
  let tries = 0;
  sim.state.phoned[6] = 1;
  for (let day = 2; day <= 8 && !heard; day++)
    for (const from of [10, 18]) {
      g.jump(day, from);
      while (sim.state.step < at(day, from === 10 ? 12 : 22)) {
        g.step();
        const k = sim.state.booth[0];
        if (k >= 0 && sim.state.booth[1] > 0) {
          tries++;
          const m = sim.state.inmates[k];
          sim.state.player.x = m.body.x + UNIT;
          sim.state.player.z = m.body.z;
        }
      }
      heard = news(seen, 'overheard').length;
      if (heard) break;
    }
  const ov = news(seen, 'overheard');
  check(ov.length >= 1, `a secret overheard (${ov.length}, ${tries} steps beside a caller)`);
  const byDay = new Map<string, number>();
  for (const e of ov) byDay.set(`${e.who}`, (byDay.get(`${e.who}`) ?? 0) + 1);
  check([...byDay.values()].every((n) => n === 1), 'each caller overheard once a day');
  check(OVERHEAR_STEPS === 8 * STEPS_PER_MINUTE, 'eight minutes of listening');
}

// The player's place: in line, their turn, lost; a place bought; cutting in.
{
  const g = game();
  const { sim, seen } = g;
  const c = CENTER_PERKS.comms!;
  // Find a free time on day 2+ with someone on the phone and a queue (the phone used before).
  sim.state.phoned[6] = 1;
  let found = false;
  for (let day = 2; day <= 10 && !found; day++) {
    g.jump(day, 10);
    while (sim.state.step < at(day, 11, 30)) {
      g.step();
      if (sim.state.booth[0] >= 0 && sim.state.line.length >= 1) {
        found = true;
        break;
      }
    }
  }
  check(found, 'an inmate on the phone with someone waiting');
  put(sim.state.player, c.line[3].x, c.line[3].z);
  g.ext(EXT.LINE, LINE.JOIN);
  const mine = sim.state.line.indexOf(PLAYER_IN_LINE);
  check(mine >= 1, `the player in line behind the others (${mine})`);
  g.ext(EXT.LINE, LINE.JOIN);
  check(refusals(seen).includes('inLine'), 'in line already: refused');
  // A call while others are ahead: refused.
  g.toPhone();
  g.call(CALLEE.HOME);
  check(refusals(seen).includes('phoneBusy') || refusals(seen).includes('phoneLine'), 'not their turn: refused');
  put(sim.state.player, c.line[3].x, c.line[3].z);
  // A place bought from the inmate ahead.
  // Only the place just ahead is for sale: never the whole line at once.
  sim.state.line = [sim.state.line.find((k) => k >= 0)!, ...[0, 1, 2, 3, 4, 5].filter((k) => !sim.state.line.includes(k) && k !== sim.state.booth[0]).slice(0, 1), PLAYER_IN_LINE];
  const [first, ahead] = sim.state.line;
  sim.state.cash = 50;
  put(sim.state.inmates[first].body, c.line[0].x, c.line[0].z);
  put(sim.state.player, c.line[1].x, c.line[1].z);
  sim.state.talk = first;
  g.step(command(0, OP.TALK, TALK.SWAP));
  check(refusals(seen).at(-1) === 'notAhead' && sim.state.line[2] === PLAYER_IN_LINE, 'the first of two ahead: not for sale');
  // (Side by side in the queue, talking.)
  put(sim.state.inmates[ahead].body, c.line[1].x, c.line[1].z);
  put(sim.state.player, c.line[2].x, c.line[2].z);
  sim.state.talk = ahead;
  g.step(command(0, OP.TALK, TALK.SWAP));
  check(sim.state.line[1] === PLAYER_IN_LINE && sim.state.line[2] === ahead && sim.state.cash === 50 - SWAP_PRICE, `the place just ahead bought for $${SWAP_PRICE}`);
  sim.state.talk = -1;
  // Walked off: out of the line.
  put(sim.state.player, c.phone.x + 9, c.phone.z + 1);
  g.step();
  check(!sim.state.line.includes(PLAYER_IN_LINE) && news(seen, 'left').length >= 1, 'walking off loses the place');
  // Cutting in: everyone passed thinks less of the player.
  put(sim.state.player, c.line[2].x, c.line[2].z);
  const passed = sim.state.line.slice();
  const before = passed.map((k) => sim.state.inmates[k].opinion);
  g.ext(EXT.LINE, LINE.CUT);
  check(sim.state.line[0] === PLAYER_IN_LINE, 'cut in at the front');
  check(passed.every((k, j) => sim.state.inmates[k].opinion === Math.max(0, before[j] + CUT_OPINION)), `everyone passed: ${CUT_OPINION} opinion`);
  // The turn: once the phone is free, a call within TURN_STEPS or the place is gone.
  while (sim.state.booth[0] >= 0) g.step();
  g.step();
  check(sim.state.turn > 0 && news(seen, 'turn').length >= 1, "the player's turn comes");
  for (let k = 0; k <= TURN_STEPS + 2; k++) g.step();
  check(!sim.state.line.includes(PLAYER_IN_LINE) && news(seen, 'lostTurn').length === 1, 'a turn not taken is lost');
}

// The swing, measured: the one pushed back swings about CUT_SWING in 100.
{
  let swings = 0;
  let cuts = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const g = game(CENTER_PERKS, seed);
    const { sim, seen } = g;
    g.jump(2, 10, 1);
    sim.state.line = [0, 1];
    for (const k of [0, 1]) sim.state.inmates[k].opinion = 50;
    const c = CENTER_PERKS.comms!;
    put(sim.state.player, c.line[2].x, c.line[2].z);
    g.ext(EXT.LINE, LINE.CUT);
    if (sim.state.line[0] === PLAYER_IN_LINE) cuts++;
    swings += news(seen, 'swing').length;
  }
  check(cuts === 60, 'every cut goes through');
  check(swings >= 6 && swings <= 26, `about ${CUT_SWING}% swing (${swings} of 60)`);
  console.log(`cutting in: ${swings} swings in 60`);
}

// ------------------------------------------------------------------ calls
{
  const g = game();
  const { sim, seen } = g;
  // (Nobody else queuing: the calls themselves.)
  sim.noQueue = true;
  // Out of hours, away from it.
  g.jump(1, 13, 30);
  g.toPhone();
  g.call(CALLEE.HOME);
  check(refusals(seen).at(-1) === 'phoneClosed', 'out of the free times: closed');
  g.jump(1, 10, 5);
  put(sim.state.player, CENTER_PERKS.comms!.phone.x + 5, CENTER_PERKS.comms!.phone.z);
  g.call(CALLEE.HOME);
  check(refusals(seen).at(-1) === 'notAtPhone', 'not at the phone: refused');
  g.toPhone();
  sim.state.cash = 0;
  g.call(CALLEE.HOME);
  check(refusals(seen).at(-1) === 'cash', 'no coins: refused');
  // Home: energy, and the money order, paid at the next mail call.
  sim.state.cash = 100;
  sim.state.energy = 40;
  g.call(CALLEE.HOME);
  check(!!sim.state.call && sim.state.cash === 100 - COINS, `a call home: $${COINS} of coins`);
  g.to(1, 10, 11);
  check(!sim.state.call && sim.state.energy >= 40 + HOME_ENERGY - 1, `home: +${HOME_ENERGY} energy`);
  const order = news(seen, 'moneyOrder')[0];
  check(!!order && order.n! >= 15 && order.n! <= 30 && sim.state.phoned[1] === order.n, `a money order of $${order?.n} on its way`);
  g.call(CALLEE.HOME);
  check(refusals(seen).at(-1) === 'calledHome', 'once a day');
  const cash = sim.state.cash;
  g.to(1, 12, 1);
  check(sim.state.cash === cash + order.n! && news(seen, 'mail').length === 1 && sim.state.phoned[1] === 0, 'paid at mail call (12:00)');
  // Next week only.
  g.jump(2, 10, 5);
  g.toPhone();
  g.call(CALLEE.HOME);
  g.to(2, 10, 11);
  check(news(seen, 'moneyOrder').length === 1, 'no second money order inside a week');
  g.jump(1 + MONEY_EVERY, 10, 5);
  g.toPhone();
  g.call(CALLEE.HOME);
  g.to(1 + MONEY_EVERY, 10, 11);
  check(news(seen, 'moneyOrder').length === 2, 'a week on: another');
  // Walking away hangs up: nothing comes of it.
  g.jump(9, 10, 5);
  g.toPhone();
  g.call(CALLEE.HOME);
  put(sim.state.player, CENTER_PERKS.comms!.phone.x + 4, CENTER_PERKS.comms!.phone.z + 1);
  g.step();
  check(!sim.state.call && news(seen, 'hungUp').length === 1, 'walking away hangs up');
}

// The lawyer: an appeal (heat off, once a day; never wanted), a retainer (solitary halved).
{
  const g = game();
  const { sim, seen } = g;
  sim.noQueue = true;
  g.jump(1, 10, 5);
  g.toPhone();
  sim.state.cash = 200;
  g.call(CALLEE.LAWYER, LAWYER.APPEAL);
  check(refusals(seen).at(-1) === 'clean', 'nothing to appeal: refused');
  sim.state.heat = 85;
  g.call(CALLEE.LAWYER, LAWYER.APPEAL);
  check(refusals(seen).at(-1) === 'hunted', 'wanted: refused');
  sim.state.heat = 50;
  g.call(CALLEE.LAWYER, LAWYER.APPEAL);
  for (let k = 0; k < 120; k++) {
    sim.state.seen = true;
    g.step();
  }
  check(sim.state.heat <= 50 - APPEAL_HEAT + 1 && news(seen, 'appeal')[0]?.n === APPEAL_HEAT, `an appeal: ${APPEAL_HEAT} heat off`);
  sim.state.heat = 40;
  g.call(CALLEE.LAWYER, LAWYER.APPEAL);
  check(refusals(seen).at(-1) === 'appealed', 'one appeal a day');
  g.call(CALLEE.LAWYER, LAWYER.RETAINER);
  g.to(1, 10, 20);
  check(news(seen, 'retainer').length === 1 && sim.state.phoned[2] === 4, 'a retainer for three days');
  // Caught at solitary's heat with the retainer: half the stretch.
  g.setCalm(false);
  sim.state.heat = 95;
  sim.state.wake = WAKE.SOLITARY;
  sim.state.ko = 1;
  g.step();
  check(sim.state.solitary === SOLITARY_STEPS / 2 || sim.state.solitary === SOLITARY_STEPS / 2 - 1, `solitary halved on a retainer (${sim.state.solitary})`);
}

// Tips: the cell searched; found or empty; word getting round.
{
  let found = 0;
  let empty = 0;
  let snitched = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = game(CENTER_PERKS, seed);
    const { sim, seen } = g;
    sim.noQueue = true;
    g.jump(2, 18, 5);
    g.toPhone();
    sim.state.cash = 20;
    const cell = 2 + (seed % 6);
    g.call(CALLEE.TIP, 0, 1);
    if (seed === 1) check(refusals(seen).at(-1) === 'badCell', "the player's own cell: refused");
    g.call(CALLEE.TIP, 0, cell);
    check(!!sim.state.call, `seed ${seed}: a tip called in`);
    const k = CENTER_PERKS.guards.findIndex((d) => d.duties?.includes('shakedown'));
    g.to(2, 18, 9);
    check(sim.state.guards[k].mode === GUARD.SHAKEDOWN || news(seen, 'tip')[0]?.who !== k, `seed ${seed}: the shakedown guard on his way`);
    const heat = sim.state.heat;
    g.to(2, 21, 30);
    const f = news(seen, 'tipFound').length;
    const e = news(seen, 'tipEmpty').length;
    check(f + e === 1, `seed ${seed}: the cell searched (${f} found, ${e} empty)`);
    if (e) check(sim.state.heat >= Math.min(100, heat + TIP_HEAT) - 20, `seed ${seed}: an empty tip heats`);
    found += f;
    empty += e;
    snitched += news(seen, 'snitch').length;
    g.call(CALLEE.TIP, 0, cell);
    check(refusals(seen).at(-1) === 'tipped' || refusals(seen).at(-1) === 'phoneLine' || refusals(seen).at(-1) === 'phoneBusy', `seed ${seed}: one tip a day`);
  }
  console.log(`tips: ${found} found something, ${empty} found nothing, word got round ${snitched} times in 12`);
}

// ------------------------------------------------------------------ Lou's tapped line
{
  // The phrases offered: one of each kind a line.
  const g = game();
  const { sim, seen } = g;
  g.jump(1, 10, 5);
  g.toPhone();
  sim.state.cash = 500;
  g.call(CALLEE.COUSIN, JOB.CAKE);
  const call = sim.state.call!;
  check(!!call && call.to === CALLEE.COUSIN && sim.state.cash === 500 - COINS, "Lou's call: coins only so far");
  for (let line = 0; line < 3; line++) {
    const ph = phrasesOf(sim.state, call, line);
    check(ph.map(([t]) => t).sort().join() === '0,1,2', `line ${line}: one plain, one coded, one deep code`);
  }
  // Silence: Lou hangs up.
  for (let k = 0; k <= LINE_STEPS + 1; k++) g.step();
  check(!sim.state.call && news(seen, 'silence').length === 1 && sim.state.cash === 500 - COINS, 'silence: Lou hangs up, no fee');
  // Hanging up.
  g.call(CALLEE.COUSIN, JOB.CAKE);
  g.ext(EXT.SAY, 3);
  check(!sim.state.call && news(seen, 'hungUp').length === 1, 'hung up');
}

/** Lou's call played with a way of talking (a tier for each line, or 'learn': plain, plain, deep), at a seed; what came of it. */
function louCall(tiers: number[], seed: number, learned = 0) {
  const g = game(CENTER_PERKS, seed);
  const { sim, seen } = g;
  g.jump(1, 10, 5);
  g.toPhone();
  sim.state.cash = 500;
  sim.state.lou[0] = learned;
  g.call(CALLEE.COUSIN, JOB.CAR);
  const call = sim.state.call;
  if (!call) return null;
  const ear = call.ear;
  for (let line = 0; line < 3; line++) {
    const ph = phrasesOf(sim.state, call, line);
    g.ext(EXT.SAY, ph.findIndex(([t]) => t === tiers[line]));
  }
  const lou = news(seen, 'lou')[0];
  return { lou, ear, sim, catchAt: catchAt(sim, ear), cash: sim.state.cash };
}

{
  // Ways of talking, measured over many calls (each a listener drawn).
  const ways: Record<string, number[]> = { plain: [0, 0, 0], coded: [1, 1, 1], deep: [2, 2, 2], plainCodedDeep: [0, 1, 2], codedCodedPlain: [1, 1, 0], plainDeepDeep: [0, 2, 2] };
  const rows: string[] = [];
  const firstCallSafe: string[] = [];
  for (const [name, tiers] of Object.entries(ways)) {
    let ok = 0;
    let blown = 0;
    let n = 0;
    const byTrait = { strict: [0, 0], steady: [0, 0], lazy: [0, 0], corrupt: [0, 0], nobody: [0, 0] } as Record<string, number[]>;
    for (let seed = 1; seed <= 80; seed++) {
      const r = louCall(tiers, seed);
      if (!r?.lou) continue;
      n++;
      const trait = r.ear < 0 ? 'nobody' : CENTER_PERKS.guards[r.ear].trait ?? 'steady';
      const good = r.lou.ok && !r.lou.blown;
      byTrait[trait][0]++;
      if (good) byTrait[trait][1]++;
      if (r.lou.ok) ok++;
      if (r.lou.blown) blown++;
      // The fee only when understood; blown: heat.
      const fee = r.lou.ok ? JOB_FEES[JOB.CAR] : 0;
      check(r.cash === 500 - COINS - fee, `${name}: the fee only when understood`);
      if (r.lou.blown) check(r.sim.state.heat >= TAP_HEAT - 2, `${name}: blown calls heat`);
    }
    if (Object.entries(byTrait).every(([t, [k, g]]) => t === 'nobody' || k === 0 || g === k)) firstCallSafe.push(name);
    rows.push(`${name}: understood ${ok}/${n}, blown ${blown}; safe and clear by listener: ${Object.entries(byTrait).map(([t, [k, g]]) => `${t} ${g}/${k}`).join(', ')}`);
  }
  console.log(rows.join('\n'));
  check(firstCallSafe.length === 0, `no way of talking is safe and clear with every listener at the first call (${firstCallSafe.join(', ')})`);
  // The numbers behind it: pure.
  check(CLEAR_NEED === 3 && CATCH.strict === 3, 'clarity 3 to understand; strict catches 3');
  // Learned codes: plain, plain, deep teaches the deep one; then deep, deep, deep is clear and silent.
  const r = louCall([0, 0, 2], 3);
  check(!!r?.lou.ok, 'plain, plain, deep: understood');
  const learned = r!.sim.state.lou[0];
  check(learned !== 0, 'the deep code said is learned');
  const call = { to: CALLEE.COUSIN, sub: JOB.CAR, arg: 0, from: 0, ends: 0, at: 0, said: [-1, -1, -1], ear: -1 };
  const ph = phrasesOf({ salt: r!.sim.state.salt, lou: [learned] }, call, 2);
  const deep = ph.find(([t]) => t === TIER.DEEP)!;
  check(phraseWorth({ lou: [learned] }, JOB.CAR, 2, TIER.DEEP, deep[1]).clarity === 2 && phraseWorth({ lou: [learned] }, JOB.CAR, 2, TIER.DEEP, deep[1]).risk === 0, 'a learned deep code: clear and silent');
  // Every code learned: deep three times is clear and safe with anyone.
  let all = 0;
  for (let j = 0; j < 3; j++) for (let l = 0; l < 3; l++) for (let v = 0; v < 3; v++) all |= 1 << (j * 9 + l * 3 + v);
  let good = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const q = louCall([2, 2, 2], seed, all);
    if (q?.lou.ok && !q.lou.blown) good++;
  }
  check(good === 20, `every code learned: always clear and safe (${good}/20)`);
}

// ------------------------------------------------------------------ Lou's jobs
{
  // The diversion: at the hour, the nearest guards look at the gate, then go back.
  const g = game();
  const { sim, seen } = g;
  g.jump(1, 10, 5);
  g.toPhone();
  sim.state.cash = 500;
  sim.state.lou[0] = 0x7ffffff;
  g.call(CALLEE.COUSIN, JOB.DIVERSION, 14);
  const call = sim.state.call!;
  for (let line = 0; line < 3; line++) g.ext(EXT.SAY, phrasesOf(sim.state, call, line).findIndex(([t]) => t === TIER.DEEP));
  check(sim.state.lou[2] === divertStep(at(1, 10, 5), 14) && sim.state.lou[2] === at(1, 14), 'the diversion booked for 14:00');
  g.call(CALLEE.COUSIN, JOB.DIVERSION, 16);
  check(refusals(seen).at(-1) === 'divertBooked', 'one diversion at a time');
  check(divertStep(at(1, 13, 30), 14) === at(2, 14), 'an hour less than an hour ahead: the next day');
  g.to(1, 14, 1);
  const d = news(seen, 'diversion');
  check(d.length === 1, 'the diversion goes off');
  const c = CENTER_PERKS.comms!;
  const looking = sim.state.guards.filter((q) => q.mode === GUARD.INVESTIGATE && q.target === c.gate.z * MAP_W + c.gate.x);
  check(looking.length >= Math.min(DIVERT_GUARDS, 2), `guards go and look at the gate (${looking.length})`);
  g.to(1, 15, 30);
  check(sim.state.guards.every((q) => q.target !== c.gate.z * MAP_W + c.gate.x || q.mode !== GUARD.INVESTIGATE), 'they go back to their beats after');
  // Blown: the alarm goes, nobody moves.
  const b = game();
  b.jump(1, 10, 5);
  b.toPhone();
  b.sim.state.cash = 500;
  b.sim.state.lou[2] = at(1, 14);
  b.sim.state.lou[3] = 1;
  b.to(1, 14, 1);
  check(news(b.seen, 'ignored').length === 1 && !b.sim.state.guards.some((q) => q.mode === GUARD.INVESTIGATE && q.target === c.gate.z * MAP_W + c.gate.x), 'blown: ignored');
}

{
  // The cake: at the next visit, past the frisk; eaten: the file.
  const VISITING = DAY_EVENTS.indexOf('visiting');
  const g = game(CENTER_PERKS, 5, [[2, VISITING, 0]]);
  const { sim, seen } = g;
  sim.state.lou[4] = 1;
  sim.state.lou[7] = 1;
  g.jump(2, 10, 10);
  const seat = visitPairs(sim.world)[0]?.seat ?? -1;
  check(seat >= 0, 'a visiting seat');
  // Sit and wait for the visitor (on the seat).
  const p = { x: seat % MAP_W, z: Math.floor(seat / MAP_W) };
  put(sim.state.player, p.x, p.z);
  g.step(command(0, OP.INTERACT));
  for (let k = 0; k < 200 && !news(seen, 'cake').length; k++) g.step();
  const cake = itemNumber('cake');
  const inHand = sim.state.items.inv.slice(0, 6).findIndex((x) => (x & 255) === cake);
  if (news(seen, 'cake').length) {
    check(inHand >= 0, 'the cake in the hotbar');
    g.to(2, 12, 2);
    check(sim.state.items.inv.slice(0, 6).some((x) => (x & 255) === cake), 'the frisk lets a cake through');
    sim.state.items.hand = sim.state.items.inv.slice(0, 6).findIndex((x) => (x & 255) === cake);
    sim.state.energy = 50;
    g.step(command(0, OP.USE, 1));
    check((sim.state.items.inv[sim.state.items.hand] & 255) === itemNumber('metal_file') && sim.state.energy >= 70, 'eaten: energy, and the file in hand');
  } else check(false, `the visitor brings the cake (${of(seen, 'smuggle').map((e) => e.what).join(' ')})`);
  // Blown: seized at the visit.
  const h = game(CENTER_PERKS, 5, [[2, VISITING, 0]]);
  h.sim.state.lou[4] = 2;
  h.sim.state.lou[7] = 1;
  h.jump(2, 10, 10);
  put(h.sim.state.player, p.x, p.z);
  h.step(command(0, OP.INTERACT));
  for (let k = 0; k < 200 && !news(h.seen, 'cakeSeized').length; k++) h.step();
  check(news(h.seen, 'cakeSeized').length === 1 && h.sim.state.lou[4] === 0, 'blown: the cake taken at the visit');
  // Stalag Flucht: in the Red Cross parcel, into the desk.
  const DELIVERY = DAY_EVENTS.indexOf('delivery');
  const s = game(STALAG_FLUCHT, 5, [[2, DELIVERY, 0]]);
  s.sim.state.lou[4] = 1;
  s.sim.state.lou[7] = 2;
  s.jump(2, 14, 40);
  s.to(2, 15, 0);
  check(news(s.seen, 'cake').length === 0, 'Stalag Flucht: a cake asked for today waits for a parcel after today');
  s.sim.state.lou[7] = 1;
  s.to(2, 15, 2);
  check(news(s.seen, 'cake').length === 1, 'Stalag Flucht: the cake in the Red Cross parcel');
  void slot;
}

{
  // The car: tonight only, an escape on the road drives off in it.
  const g = game();
  const { sim, seen } = g;
  sim.state.lou[5] = 1;
  g.jump(1, 22, 30);
  check(!carWaiting(sim.state), 'not there before 23:00');
  g.jump(1, 23, 30);
  check(carWaiting(sim.state), 'waiting at 23:30');
  // Out on the road (through the fence, the cutout's way).
  const road = (() => {
    for (let z = 63; z > 0; z--) for (let x = 0; x < 64; x++) if (sim.world.zoneAt(x, z) === 'outside' && !sim.world.blocked(x, z)) return [x, z];
    return [0, 0];
  })();
  put(sim.state.player, road[0], road[1] - 1);
  for (let k = 0; k < 40 && !sim.state.escaped; k++) g.step(command(5));
  check(!!sim.state.escaped && news(seen, 'wheels').length === 1 && sim.state.lou[5] === -1, `out on the road: away in Lou's car (${sim.state.escaped ? 'out' : 'not out'})`);
  // Blown: no car.
  const b = game();
  b.sim.state.lou[5] = 1;
  b.sim.state.lou[6] = 1;
  b.jump(1, 23, 30);
  check(!carWaiting(b.sim.state), 'blown: no car');
}

// ------------------------------------------------------------------ the review's holes (2.10)
{
  // Lou's fee spent meanwhile: nothing booked, cash never below zero.
  const g = game();
  const { sim, seen } = g;
  g.jump(1, 10, 5);
  g.toPhone();
  sim.state.cash = COINS + JOB_FEES[JOB.CAR];
  sim.state.lou[0] = 0x7ffffff;
  g.call(CALLEE.COUSIN, JOB.CAR);
  sim.state.cash = 10;
  for (let line = 0; line < 3; line++) g.ext(EXT.SAY, phrasesOf(sim.state, sim.state.call!, line).findIndex(([t]) => t === TIER.DEEP));
  check(sim.state.cash === 10 && sim.state.lou[5] === 0 && news(seen, 'lou')[0]?.ok === false, 'the fee spent meanwhile: nothing booked, no debt');
  // The listener: the same all day, however often Lou is called.
  const ears = new Set<number>();
  sim.state.cash = 100;
  for (let k = 0; k < 8; k++) {
    g.call(CALLEE.COUSIN, JOB.CAKE);
    if (sim.state.call) ears.add(sim.state.call.ear);
    g.ext(EXT.SAY, 3);
  }
  check(ears.size === 1, `hanging up and calling again: the same guard listening (${[...ears].join(',')})`);
  // A diversion going off in a lockdown: ignored.
  sim.state.lou[2] = sim.state.step + 2;
  g.setCalm(false);
  sim.state.lockdown = true;
  g.step();
  g.step();
  check(news(seen, 'ignored').length === 1, 'a diversion in a lockdown: ignored');
  sim.state.lockdown = false;
  g.setCalm(true);
  // The queue's reach: not from the other side of the wall.
  const c = CENTER_PERKS.comms!;
  put(sim.state.player, c.phone.x, c.phone.z - 2);
  g.ext(EXT.LINE, LINE.JOIN);
  check(refusals(seen).at(-1) === 'notAtPhone' || refusals(seen).at(-1) === 'phoneClosed', 'no place in line from behind the wall');
}

// ------------------------------------------------------------------ saves
{
  const g = game();
  const { sim } = g;
  g.jump(1, 10, 5);
  g.toPhone();
  sim.state.cash = 500;
  g.call(CALLEE.COUSIN, JOB.CAKE);
  g.ext(EXT.SAY, 0);
  const saved = JSON.parse(JSON.stringify(sim.state));
  const back = new Sim(CENTER_PERKS, 5);
  back.state = loadState(back.world, CENTER_PERKS, saved);
  check(JSON.stringify(back.state) === JSON.stringify(sim.state) && !!back.state.call, 'a save mid-call loads as it was');
  for (let k = 0; k < 50; k++) {
    sim.step(0);
    back.step(0);
  }
  check(sim.hash() === back.hash(), 'and plays on the same');
  // A save from before the phone: nothing on it, nobody queuing.
  const old = JSON.parse(JSON.stringify(sim.state));
  for (const k of ['booth', 'line', 'turn', 'call', 'lou', 'phoned', 'rang']) delete old[k];
  const o = new Sim(CENTER_PERKS, 5);
  o.state = loadState(o.world, CENTER_PERKS, old);
  check(o.state.booth.join() === '-1,0,0,0' && o.state.line.length === 0 && o.state.call === null && o.state.lou.length === 8 && o.state.phoned.length === 7, 'a save from before the phone: nobody on it');
  const bad = JSON.parse(JSON.stringify(sim.state));
  bad.call.said = [9];
  bad.line = [99];
  const b = new Sim(CENTER_PERKS, 5);
  b.state = loadState(b.world, CENTER_PERKS, bad);
  check(b.state.call === null && b.state.line.length === 0, 'a damaged call and queue load as none');
}
console.log('phone ok');
