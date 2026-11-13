/**
 * Ink (P29, docs/phases/3-free-time.md), through the real simulation (P29's football match went in
 * 2.44: penalties, scripts/pentest.ts, which checks the pitches too):
 * - tattoos: the gun crafted, a job's refusals, the tracing's quality from fixed command sequences
 *   (2.22: drawn by hand or steered, idle, scribbled, hopping ahead; and before 2.22, Sim.rules221,
 *   the pen on its clock as it was), the pay and opinion, the heat when seen, a friend's tattoo on
 *   the player's arm;
 * - saves mid-sitting; nothing happens without the player.
 */
import { TRAINING } from '../src/content/prisons/training';
import { itemNumber } from '../src/content/items';
import { RECIPES } from '../src/content/recipes';
import { DESIGNS, INK_HEAT, INK_ME_STEPS, INK_TIME, RING_AHEAD } from '../src/content/team';
import { command, EXT, needleArgs, needlePoint, OP, TALK } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { loadState } from '../src/sim/load';
import { DAY_STEPS } from '../src/sim/systems/clock';
import { slot } from '../src/sim/systems/items';
import { nearestDir } from '../src/sim/ai/path';
import { inksToday, pathLength, penAt, payOf, pointAt, qualityOf, ringAt, traceSteps } from '../src/sim/systems/tattoo';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { check } from './assert';

const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const n = itemNumber;
const refusals = (seen: SimEvent[]) => seen.filter((e) => e.type === 'refused').map((e) => (e as { why: string }).why);
const of = <T extends SimEvent['type']>(seen: SimEvent[], type: T) =>
  seen.filter((e) => e.type === type) as Array<Extract<SimEvent, { type: T }>>;

/** A game kept calm (heat and lockdowns cleared each step unless asked), every day quiet and clear. */
function game(prison = TRAINING, seed = 5) {
  const sim = new Sim(prison, seed);
  sim.state.calendar = [[0, 0, 0]];
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
  const jump = (day: number, hour: number, minute = 0) => {
    sim.state.step = at(day, hour, minute) - 1;
    sim.state.attended = true;
    sim.state.excused = true;
    step();
  };
  const talk = (a: number, b = 0) => step(command(0, OP.TALK, a, b));
  const ext = (a: number, b = 0, c = 0) => step(command(0, OP.EXT, a, b, c));
  const setCalm = (on: boolean) => (calm = on);
  return { sim, seen, step, jump, talk, ext, setCalm };
}

/** Puts a body in the middle of a tile. */
const put = (b: { x: number; z: number }, x: number, z: number) => {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
};

// ------------------------------------------------------------------ tattoos
{
  check(
    RECIPES.some((r) => r.result === 'tattoo_gun' && [...r.ingredients].sort().join() === 'battery,razor_blade,toothbrush'),
    'the gun: a toothbrush, a battery and a razor blade',
  );
  const lines: string[] = [];
  for (let d = 0; d < DESIGNS.length; d++) lines.push(`${DESIGNS[d].id}: ${traceSteps(d)} steps, pays $${payOf(d, 0)}–$${payOf(d, 100)}`);
  console.log(lines.join('\n'));
  check(qualityOf(0, 100) === 100 && qualityOf(100 * 500, 100) === 0, 'quality: 100 on the line, 0 far off it');

  /** A sitting in the Training Block with Sparky (opinion `op`), the gun and `inks` jars in the hotbar. */
  const sitting = (op: number, inks = 1) => {
    const g = game(TRAINING, 3);
    g.jump(1, 10, 30);
    const s = g.sim.state;
    s.items.inv[0] = slot(n('tattoo_gun'));
    for (let k = 0; k < inks; k++) s.items.inv[1 + k] = slot(n('ink'));
    const m = s.inmates[0];
    m.opinion = op;
    put(m.body, Math.floor(s.player.x / UNIT) - 1, Math.floor(s.player.z / UNIT));
    m.goal = -1;
    m.path = [];
    s.player.facing = 9;
    g.step(command(0, OP.INTERACT));
    return g;
  };
  // Refusals.
  {
    const g = sitting(20);
    g.talk(TALK.TATTOO, 0);
    check(!g.sim.state.ink && refusals(g.seen).includes('inkOpinion'), 'an inmate who thinks little of the player takes no tattoo');
    const h = sitting(50, 0);
    h.talk(TALK.TATTOO, 0);
    check(!h.sim.state.ink && refusals(h.seen).includes('noInk'), 'no ink: no tattoo');
    const k = sitting(50);
    k.talk(TALK.INK_ME, 1);
    check(!k.sim.state.ink && refusals(k.seen).includes('inkFriend'), 'only a friend inks the player');
  }
  /** A tracing played by `play` (each step's command, from the sitting), under the rules before 2.22 (`old`: Sim.rules221) or now; its 'done' event and how long it took (the steps after the one it began in). */
  type Sitting = { nx: number; nz: number; k: number; at: number; design: number };
  const trace = (design: number, play: (o: Sitting) => number, old = false) => {
    const g = sitting(50);
    g.sim.rules221 = old;
    g.sim.state.guards.forEach((q) => (q.body.x = 2 * UNIT));
    g.talk(TALK.TATTOO, design);
    const s = g.sim.state;
    check(!!s.ink && !s.items.inv.slice(0, 6).some((v) => (v & 255) === n('ink')), 'a sitting: the ink goes into the gun');
    const x0 = s.player.x;
    let steps = 0;
    while (s.ink) {
      g.step(play(s.ink));
      steps++;
    }
    check(s.player.x === x0, 'the player keeps still meanwhile (the moves steer the needle)');
    return { done: of(g.seen, 'tattoo').find((e) => e.what === 'done')!, steps };
  };
  // Before 2.22 (Sim.rules221): the pen on its clock, the needle after it with the keys.
  const pen: [number, number] = [0, 0];
  const follow = (o: Sitting) => {
    penAt(o.design, o.k + 1, pen);
    return command(Math.hypot(pen[0] - o.nx, pen[1] - o.nz) < 8 ? 0 : nearestDir(pen[0] - o.nx, pen[1] - o.nz));
  };
  for (let d = 0; d < DESIGNS.length; d++) {
    const good = trace(d, follow, true);
    const idle = trace(d, () => 0, true);
    check(good.done.quality! >= 85, `${DESIGNS[d].id}: following the pen, a clean line (${good.done.quality})`);
    check(idle.done.quality! <= 20, `${DESIGNS[d].id}: the needle left still, a poor one (${idle.done.quality})`);
    check(good.done.pay! > idle.done.pay! && good.done.gain! > idle.done.gain!, 'a cleaner line pays more and wins more respect');
    lines.length = 0;
    console.log(
      `${DESIGNS[d].id}: followed ${good.done.quality} ($${good.done.pay}, +${good.done.gain}), left still ${idle.done.quality} ($${idle.done.pay}, +${idle.done.gain})`,
    );
  }
  // 2.22: the needle's point in a command, to within half a step of its grid.
  {
    let worst = 0;
    for (let x = 0; x <= 1000; x += 37)
      for (let y = 0; y <= 1000; y += 41) {
        const [px, py] = needlePoint(...needleArgs(x, y));
        worst = Math.max(worst, Math.abs(px - x), Math.abs(py - y));
      }
    check(worst <= 4, `the needle's point sent to within ${worst} of where it was`);
  }
  // 2.22: drawn by hand (the finger set down at the start, then drawn after a point a little ahead on the line); steered by the keys after the ring; left still; scribbled beside the line.
  const ring: [number, number] = [0, 0];
  const at: [number, number] = [0, 0];
  const draw = (lead: number, wobble: number) => {
    let down = true;
    return (o: Sitting) => {
      // (Set down on the needle at the start, then drawn on after a point `lead` ahead on the line, `wobble` off it.)
      pointAt(o.design, down ? 0 : o.at + lead, at);
      const w = down ? 0 : wobble * Math.sin(o.k * 0.9);
      const cmd = command(0, OP.EXT, down ? EXT.NEEDLE_DOWN : EXT.NEEDLE, ...needleArgs(at[0] + w, at[1] - w));
      down = false;
      return cmd;
    };
  };
  const keys = (o: Sitting) => {
    ringAt(o, RING_AHEAD, ring);
    return command(Math.hypot(ring[0] - o.nx, ring[1] - o.nz) < 8 ? 0 : nearestDir(ring[0] - o.nx, ring[1] - o.nz));
  };
  const beside = (o: Sitting) => {
    pointAt(o.design, o.k * 12, at);
    return command(0, OP.EXT, EXT.NEEDLE, ...needleArgs(at[0] + 140, at[1] + 140));
  };
  for (let d = 0; d < DESIGNS.length; d++) {
    const hand = trace(d, draw(40, 0));
    const shaky = trace(d, draw(40, 45));
    const steered = trace(d, keys);
    const idle = trace(d, () => 0);
    const scribbled = trace(d, beside);
    check(
      hand.done.quality! >= 95 && hand.steps < INK_TIME,
      `${DESIGNS[d].id}: drawn along the line, a clean one (${hand.done.quality}, ${hand.steps} steps)`,
    );
    check(
      shaky.done.quality! < hand.done.quality! && shaky.done.quality! >= 40,
      `${DESIGNS[d].id}: a shaky hand, a poorer line (${shaky.done.quality})`,
    );
    check(
      steered.done.quality! >= 85 && steered.steps < INK_TIME,
      `${DESIGNS[d].id}: steered after the ring with the keys, a clean line (${steered.done.quality}, ${steered.steps} steps)`,
    );
    check(
      idle.done.quality === 0 && idle.steps === INK_TIME - 1,
      `${DESIGNS[d].id}: the needle left still, nothing traced by the end of the time (${idle.done.quality}, ${idle.steps} steps)`,
    );
    check(scribbled.done.quality! <= 10, `${DESIGNS[d].id}: scribbled beside the line, nothing traced (${scribbled.done.quality})`);
    check(
      hand.done.pay! > shaky.done.pay! && shaky.done.pay! > idle.done.pay! && hand.done.gain! > idle.done.gain!,
      'a line closer to the design pays more and wins more respect',
    );
    console.log(
      `${DESIGNS[d].id} drawn: by hand ${hand.done.quality} ($${hand.done.pay}, +${hand.done.gain}, ${hand.steps} steps), shaky ${shaky.done.quality} ($${shaky.done.pay}), keys ${steered.done.quality} (${steered.steps} steps), left still ${idle.done.quality} ($${idle.done.pay}), scribbled ${scribbled.done.quality}`,
    );
  }
  // 2.22: no skipping: the needle set down on the line ahead, a dab of ink on from there, set down further on… gets no further than the ink it lays.
  {
    let dabs = 0;
    const hop = (o: Sitting) => {
      pointAt(o.design, o.at + (o.k % 2 ? 95 : 85), at);
      if (o.k % 2) dabs++;
      return command(0, OP.EXT, o.k % 2 ? EXT.NEEDLE : EXT.NEEDLE_DOWN, ...needleArgs(at[0], at[1]));
    };
    const hopped = trace(0, hop);
    const line = `hopping ahead along the heart: ${hopped.steps} steps (${dabs} dabs of 10), line ${hopped.done.quality}`;
    check(hopped.steps > 2 * Math.floor(pathLength(0) / (2 * 10 + 10)) && hopped.done.quality! < 100, line);
    console.log(line);
  }
  // A sitting saved before 2.22 (no line traced by hand in it): it loads with nothing traced yet, and goes on.
  {
    const g = sitting(50);
    g.talk(TALK.TATTOO, 0);
    for (let k = 0; k < 10; k++) g.step(command(1));
    const old = JSON.parse(JSON.stringify(g.sim.state));
    delete old.ink.at;
    delete old.ink.n;
    const back = loadState(g.sim.world, TRAINING, old);
    check(
      !!back.ink && back.ink.at === 0 && back.ink.n === 0 && back.ink.nx === g.sim.state.ink!.nx && back.ink.k === g.sim.state.ink!.k,
      'a sitting saved before 2.22 loads, nothing traced by hand yet',
    );
  }
  // Before 2.22 the hand's commands did nothing: the needle stays put, the pen runs on.
  {
    const ignored = trace(0, draw(40, 0), true);
    check(
      ignored.done.quality! <= 20 && ignored.steps === traceSteps(0) - 1,
      `under the old rules, the needle drawn by hand stays put (${ignored.done.quality})`,
    );
  }
  // Seen at it: heat once.
  {
    const g = sitting(50);
    g.setCalm(false);
    const s = g.sim.state;
    s.guards[0].sees = true;
    s.guards[0].bribed = 0;
    g.talk(TALK.TATTOO, 0);
    // (The guards look again each step: kept on the player.)
    for (let k = 0; k < 40; k++) {
      s.guards[0].sees = true;
      g.step();
    }
    const spotted = g.seen.filter((e) => e.type === 'spotted' && e.reason === 'tattooing').length;
    check(spotted === 1 && s.heat >= INK_HEAT - 2, `a guard who sees tattooing: ${INK_HEAT}% heat, once (${spotted}, heat ${s.heat})`);
  }
  // Given up: no pay, a client let down.
  {
    const g = sitting(50);
    g.talk(TALK.TATTOO, 2);
    const was = g.sim.state.inmates[0].opinion;
    for (let k = 0; k < 40; k++) g.step();
    g.ext(EXT.INK, 0);
    check(
      !g.sim.state.ink && g.sim.state.inmates[0].opinion < was && !of(g.seen, 'tattoo').some((e) => e.what === 'done'),
      'given up halfway: no pay, and he thinks less of the player',
    );
  }
  // A friend's work on the player's arm.
  {
    const g = sitting(80, 2);
    g.talk(TALK.INK_ME, 1);
    check(!!g.sim.state.ink && g.sim.state.ink.mine === 1, 'a friend at work on the player');
    for (let k = 0; k < INK_ME_STEPS + 2; k++) g.step(command(1));
    check(g.sim.state.inked.join() === '1' && of(g.seen, 'tattoo').some((e) => e.what === 'inked'), "a skull on the player's arm");
    const m = g.sim.state.inmates[0];
    m.body.x = g.sim.state.player.x - UNIT;
    m.body.z = g.sim.state.player.z;
    g.sim.state.player.facing = 9;
    g.step(command(0, OP.INTERACT));
    g.talk(TALK.INK_ME, 1);
    check(refusals(g.seen).includes('haveIt'), `the same one twice: no (${refusals(g.seen).join()}, talk ${g.sim.state.talk})`);
  }
}

{
  // Tattoos: one a day for each inmate, three a day in all.
  const g = game(TRAINING, 3);
  g.jump(1, 10, 30);
  const s = g.sim.state;
  const ready = () => {
    s.items.inv[0] = slot(n('tattoo_gun'));
    s.items.inv[1] = slot(n('ink'));
    const m = s.inmates[0];
    m.opinion = 60;
    put(m.body, Math.floor(s.player.x / UNIT) - 1, Math.floor(s.player.z / UNIT));
    m.goal = -1;
    m.path = [];
    s.player.facing = 9;
    g.step(command(0, OP.INTERACT));
  };
  ready();
  g.talk(TALK.TATTOO, 0);
  while (s.ink) g.step();
  ready();
  g.talk(TALK.TATTOO, 0);
  check(!s.ink && refusals(g.seen).includes('inkedToday'), 'the same inmate twice a day: no');
  s.inkDays = [1, 1, 1];
  check(inksToday(s) === 3, 'three given today');
  // (In a Training Block with one inmate the total is proved by the count alone; the rule reads it.)
}

// ------------------------------------------------------------------ saves
{
  const g = game();
  const { sim } = g;
  g.jump(1, 10, 30);
  const bad = JSON.parse(JSON.stringify(sim.state));
  bad.ink = { who: 99 };
  bad.inked = [7, 1];
  // (A football match saved before 2.44: over.)
  bad.match = { who: 0, team: [1, 2, 0, 3, 4] };
  const fixed = loadState(sim.world, TRAINING, bad);
  check(
    fixed.match === null && fixed.ink === null && fixed.inked.length === 0,
    'a damaged sitting or arm, or a match from before 2.44, loads as none',
  );
  const old = JSON.parse(JSON.stringify(sim.state));
  delete old.match;
  delete old.ink;
  delete old.inked;
  const before = loadState(sim.world, TRAINING, old);
  check(before.match === null && before.ink === null && before.inked.length === 0, 'a save from before P29 loads with none');
  console.log('saves: ok');
}
