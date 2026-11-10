/**
 * The pay phone, the kiosk and the paperwork polished (2.42), through the real simulation, in every prison:
 * - inmates at the kiosk: none before the player has logged in, none on day 1, none in a run from before 2.42
 *   (Sim.rules241); after it, over three days of the routine, each session reached on the kiosk's own tile and typed
 *   there, at most KIOSK_PER_BLOCK a free time, none set off in its last KIOSK_LATE minutes, never while the player is
 *   at it or logged in; the one at it kept from the vending machine, the phone's queue and the gatherings;
 * - the player and the one at it: logging in refused while he types, his turn bought (KIOSK_TURN_PRICE, refused
 *   with nobody on it or short of cash), one on his way turning back as the player gets there first;
 * - saves: `kioskBy` absent stays absent, a damaged one set afresh, a good one kept;
 * - where the caller stands at each phone (render/Phone.ts phoneSide): the side away from its queue.
 * The phone's, the kiosk's and the paperwork's rules otherwise: phonetest, kiosktest, paperworktest.
 */
import { KIOSK, KIOSK_LATE, KIOSK_PER_BLOCK, KIOSK_TURN_PRICE } from '../src/content/kiosk';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { ROUTINE, routineEnd } from '../src/content/routine';
import { DOING } from '../src/sim/ai/doing';
import { command, EXT, headingAngle, OP } from '../src/sim/command';
import { loadState } from '../src/sim/load';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { clockAt } from '../src/sim/systems/clock';
import { KB, kioskInmate, kioskOf, kioskTyping, newKioskBy } from '../src/sim/systems/kiosk';
import { phoneSide } from '../src/render/Phone';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot } from './bots';

const kioskNews = (seen: SimEvent[], what: string) =>
  seen.filter((e): e is Extract<SimEvent, { type: 'kiosk' }> => e.type === 'kiosk' && e.what === what);
const minutesLeft = (sim: Sim) => (((routineEnd(sim.state.routine) - clockAt(sim.state.step).minuteOfDay) % 1440) + 1440) % 1440;

/** A model prisoner's day up to `minute` of `day`, then logged in at the kiosk and out again; `old`: a run from before 2.42. */
function loggedOnce(def: (typeof PRISONS)[number], seed: number, old = false) {
  const bot = new Bot(def, seed);
  if (old) bot.sim.rules241 = true;
  bot.routineUntil(2, 10 * 60 + 5);
  const k = kioskOf(bot.sim)!;
  bot.walkTo(k.z * MAP_W + k.x);
  bot.sim.state.cash += 20;
  bot.op(OP.EXT, EXT.KIOSK, KIOSK.LOGIN);
  bot.op(OP.EXT, EXT.KIOSK, KIOSK.LOGOUT);
  return bot;
}

// ------------------------------------------------------------------ inmates at the kiosk, in every prison
for (const def of PRISONS) {
  let sessions = 0;
  let typedThere = 0;
  let late = 0;
  let crowded = 0;
  let overlap = 0;
  let elsewhere = 0;
  const perBlock = new Map<string, number>();
  for (const seed of [3, 5, 9]) {
    // (Day 1, the player never logged in: no `kioskBy`, nobody at it.)
    const fresh = new Bot(def, seed);
    fresh.routineUntil(3, 12 * 60);
    check(fresh.sim.state.kioskBy === undefined, `${def.id}: inmates at the kiosk though the player never logged in`);
    const bot = loggedOnce(def, seed);
    const sim = bot.sim;
    const s = sim.state;
    check(Array.isArray(s.kioskBy), `${def.id}: logging in didn't start the kiosk's inmates`);
    const k = kioskOf(sim)!;
    const step = bot.step.bind(bot);
    (bot as unknown as { step: (c?: number) => void }).step = (c = 0) => {
      step(c);
      for (const e of sim.events) {
        if (e.type !== 'kiosk') continue;
        if (e.what === 'inmateGoes') {
          sessions++;
          const key = `${seed}:${Math.floor(s.step / (1440 * STEPS_PER_MINUTE))}:${ROUTINE[s.routine].id}`;
          perBlock.set(key, (perBlock.get(key) ?? 0) + 1);
          if (minutesLeft(sim) < KIOSK_LATE) late++;
        }
        if (e.what === 'inmateOn') {
          const m = s.inmates[e.who!];
          if (Math.floor(m.body.x / UNIT) === k.x && Math.floor(m.body.z / UNIT) === k.z) typedThere++;
        }
      }
      const who = kioskTyping(s);
      if (who >= 0) {
        if (s.inmates[who].doing !== DOING.KIOSK) crowded++;
        if (s.kiosk > 0) overlap++;
        if (s.vend.line.includes(who) || s.line.includes(who) || s.booth[0] === who || s.huddle?.who.includes(who)) elsewhere++;
      }
    };
    bot.keepRoutine(() => sim.clock.day >= 5, 4 * 24 * 60 * STEPS_PER_MINUTE);
  }
  const most = Math.max(0, ...perBlock.values());
  check(sessions > 0, `${def.id}: nobody used the kiosk in three days`);
  check(most <= KIOSK_PER_BLOCK, `${def.id}: ${most} sessions in one free time`);
  check(late === 0, `${def.id}: ${late} set off with under ${KIOSK_LATE} minutes left`);
  check(crowded <= 2 * STEPS_PER_MINUTE, `${def.id}: an inmate on the kiosk not typing for ${crowded} steps`);
  check(overlap === 0, `${def.id}: an inmate typing with the player logged in`);
  check(elsewhere === 0, `${def.id}: the one at the kiosk also queued or gathered elsewhere`);
  console.log(`${def.id}: 3 seeds, days 2–4: ${sessions} set off, ${typedThere} typed on its tile, at most ${most} a free time`);
}

// ------------------------------------------------------------------ a run from before 2.42
{
  const bot = loggedOnce(CENTER_PERKS, 5, true);
  bot.keepRoutine(() => bot.sim.clock.day >= 4, 3 * 24 * 60 * STEPS_PER_MINUTE);
  check(bot.sim.state.kioskBy === undefined, 'a run from before 2.42 had inmates at the kiosk');
  console.log('before 2.42: nobody but the player at the kiosk');
}

// ------------------------------------------------------------------ the player and the one at it
{
  const sim = new Sim(CENTER_PERKS, 4);
  const s = sim.state;
  const k = kioskOf(sim)!;
  // (Day 2's free time, the player beside the kiosk, an inmate typing on it.)
  s.step = (1440 + 2 * 60 + 10) * STEPS_PER_MINUTE;
  s.routine = ROUTINE.findIndex((r) => r.id === 'freeTime');
  sim.step(0);
  s.player.x = (k.x + 1) * UNIT + UNIT / 2;
  s.player.z = k.z * UNIT + UNIT / 2;
  s.kioskBy = newKioskBy();
  const who = s.inmates.findIndex((_, i) => i > 0);
  s.kioskBy[KB.WHO] = who;
  s.kioskBy[KB.UNTIL] = s.step + 10 * STEPS_PER_MINUTE;
  s.kioskBy[KB.FROM] = s.step - STEPS_PER_MINUTE;
  s.inmates[who].body.x = k.x * UNIT + UNIT / 2;
  s.inmates[who].body.z = k.z * UNIT + UNIT / 2;
  const said: SimEvent[] = [];
  const run = (b: number) => {
    sim.step(b < 0 ? 0 : command(0, OP.EXT, EXT.KIOSK, b));
    said.push(...sim.events);
  };
  s.cash = 3;
  run(KIOSK.LOGIN);
  check(
    said.some((e) => e.type === 'refused' && e.why === 'kioskBusy'),
    'logged in over an inmate typing at the kiosk',
  );
  run(KIOSK.ASK);
  check(
    said.some((e) => e.type === 'refused' && e.why === 'cash'),
    `his turn bought with $3 (it costs $${KIOSK_TURN_PRICE})`,
  );
  s.cash = 20;
  run(KIOSK.ASK);
  check(kioskNews(said, 'turnBought').length === 1 && s.cash === 20 - KIOSK_TURN_PRICE, 'his turn not bought, or not for its price');
  check(kioskInmate(s) < 0, 'the one paid off still on the kiosk');
  run(KIOSK.ASK);
  check(
    said.some((e) => e.type === 'refused' && e.why === 'kioskFree'),
    'a turn bought with nobody on it',
  );
  run(KIOSK.LOGIN);
  check(s.kiosk > 0, 'logging in refused once his turn was bought');
  // One on his way turns back as the player gets there first.
  run(KIOSK.LOGOUT);
  s.kioskBy[KB.WHO] = who;
  s.kioskBy[KB.UNTIL] = 0;
  s.kioskBy[KB.FROM] = s.step;
  s.inmates[who].body.x = (k.x - 3) * UNIT + UNIT / 2;
  run(-1);
  check(
    kioskNews(said, 'inmateOff').some((e) => e.why === 'beaten'),
    "one on his way didn't turn back with the player at the kiosk",
  );
  console.log(
    `at the kiosk: logging in refused while he types; his turn $${KIOSK_TURN_PRICE} (refused short of it, and with nobody on); one on his way turns back`,
  );
}

// ------------------------------------------------------------------ saves
{
  const sim = new Sim(CENTER_PERKS, 2);
  const base = structuredClone(sim.state);
  const load = (by: unknown) => loadState(sim.world, sim.prison, { ...structuredClone(base), kioskBy: by as number[] }).kioskBy;
  const absent = loadState(sim.world, sim.prison, structuredClone(base)).kioskBy;
  check(absent === undefined, 'a save without kioskBy loaded with one');
  check(JSON.stringify(load([2, 0, 1e6, 0, 0, 0, 0, 0])) === JSON.stringify(newKioskBy()), 'a kioskBy set off in the future kept');
  check(JSON.stringify(load([1, 2])) === JSON.stringify(newKioskBy()), 'a kioskBy of the wrong length kept');
  check(JSON.stringify(load([99, 0, 0, 0, 0, 0, 0, 0])) === JSON.stringify(newKioskBy()), 'a kioskBy naming nobody kept');
  const good = [1, 0, 0, 3, 0, 1, 1, 0];
  check(JSON.stringify(load(good)) === JSON.stringify(good), 'a good kioskBy not kept');
  console.log('saves: kioskBy absent stays absent, a damaged one set afresh, a good one kept');
}

// ------------------------------------------------------------------ where the caller stands at each phone
{
  const rows: string[] = [];
  for (const def of PRISONS) {
    const c = def.comms!;
    const side = phoneSide(c);
    const f = headingAngle(c.phone.face);
    // (The caller's place along the wall, against where the queue's first stands: opposite.)
    const along = (x: number, z: number) => (x - c.phone.x) * Math.cos(f) - (z - c.phone.z) * Math.sin(f);
    const q = c.line[0];
    check(Math.sign(along(q.x, q.z)) !== side || along(q.x, q.z) === 0, `${def.id}: the caller drawn on the queue's side`);
    rows.push(`${def.id} ${side < 0 ? 'left hand' : 'right hand'}`);
  }
  console.log(`the caller beside the phone, away from the queue: ${rows.join('; ')}`);
}
