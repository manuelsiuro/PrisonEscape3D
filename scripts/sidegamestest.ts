/**
 * The side games' polish (2.40): a crowd at the player's game in every prison (who comes, from how near, to where,
 * that they watch from open floor and go once it's over; never the one playing, a merchant, the fixer, the librarian or
 * the gathered; none at the Training Block, in a run from before 2.40 or out of the games' hours); and what the
 * arm-wrestle's beat makes of a bout played as a person would (on the beat a little early or late, or mashing).
 * The bout's rule itself, the dice and the cards: gamestest; the gang's table warning: gangtest.
 */
import { COUNT_IN, WRESTLE_BEAT } from '../src/content/games';
import { PRISONS } from '../src/content/prisons';
import { TRAINING } from '../src/content/prisons/training';
import { isFloor } from '../src/sim/ai/places';
import { DOING } from '../src/sim/ai/doing';
import { command, dirFromVector, OP, TALK } from '../src/sim/command';
import { gameRefusal, gamesOpen } from '../src/sim/systems/games';
import { huddleOf } from '../src/sim/systems/huddles';
import { LINGER, placesFor, spectatorsHere, WATCH_MAX, WATCH_REACH, watchedGame } from '../src/sim/systems/spectate';
import { staysPut } from '../src/sim/systems/vending';
import { STEPS_PER_SECOND, UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot, boutPress } from './bots';

/** Up to someone and the press, until a talk opens (as freetimetest's). */
function talkTo(bot: Bot, k: number, limit = 1500): boolean {
  for (let n = 0; n < limit; n++) {
    const body = bot.st.inmates[k].body;
    const dx = body.x - bot.st.player.x;
    const dz = body.z - bot.st.player.z;
    if (Math.hypot(dx, dz) > 2 * UNIT) {
      bot.pilot.goTo(Math.floor(body.z / UNIT) * MAP_W + Math.floor(body.x / UNIT));
      bot.step(command(bot.pilot.dir(bot.st.player)));
      continue;
    }
    bot.step(command(dirFromVector(dx, dz)));
    if (Math.hypot(dx, dz) > 1.15 * UNIT) continue;
    bot.act();
    if (bot.st.talk === k) return true;
  }
  return false;
}

/** The nearest inmate who'll play, everyone thinking well enough of the player (-1 none). */
function partner(bot: Bot): number {
  for (const m of bot.st.inmates) m.opinion = Math.max(m.opinion, 60);
  const p = bot.st.player;
  let best = -1;
  let bd = Infinity;
  bot.st.inmates.forEach((m, k) => {
    const d = (m.body.x - p.x) ** 2 + (m.body.z - p.z) ** 2;
    if (gameRefusal(bot.sim, k) === null && !staysPut(bot.sim, k) && d < bd) {
      bd = d;
      best = k;
    }
  });
  return best;
}

// ------------------------------------------------------------------ a crowd at the player's game, in every prison
let cameAll = 0;
let cameGames = 0;
let stayedAfter = 0;
for (const def of PRISONS) {
  let came = 0;
  let free = 0;
  let wrong = 0;
  let overfull = 0;
  let lingered = 0;
  let offFloor = 0;
  let there = 0;
  let timely = 0;
  let thereIn = 0;
  let stayed = 0;
  let games = 0;
  for (const seed of [3, 4, 5]) {
    const bot = new Bot(def, seed);
    bot.routineUntil(2, 18 * 60 + 40);
    const k = partner(bot);
    if (k < 0 || !talkTo(bot, k)) continue;
    // (A hand of Cheat for $5: a minute's clock on each of the player's moves, time for a crowd.)
    bot.st.cash = Math.max(bot.st.cash, 20);
    bot.op(OP.TALK, TALK.CHEAT, 0);
    if (!bot.st.cheat) continue;
    games++;
    const mid = { x: (bot.st.player.x + bot.st.inmates[k].body.x) / 2, z: (bot.st.player.z + bot.st.inmates[k].body.z) / 2 };
    free += bot.st.inmates.filter(
      (m, i) =>
        i !== k &&
        !staysPut(bot.sim, i) &&
        huddleOf(bot.sim, i) < 0 &&
        (m.body.x - mid.x) ** 2 + (m.body.z - mid.z) ** 2 <= (WATCH_REACH * UNIT) ** 2,
    ).length;
    const seen = new Set<number>();
    const at = new Map<number, number>();
    const joined = new Map<number, number>();
    // (The player thinks and doesn't play: the inmate's moves, the deals, until the move's clock runs out and it's folded.)
    for (let n = 0; n < 75 * STEPS_PER_SECOND && bot.st.cheat; n++) {
      bot.step();
      const w = bot.st.watch ?? [];
      if (w.length > WATCH_MAX) wrong++;
      // (Never more than there are places, each on a tile of its own; never one in the vending machine's queue.)
      const g = watchedGame(bot.sim);
      const spots = g ? placesFor(bot.sim, g) : [];
      if (g && !bot.st.watchEnd && w.length > spots.length) overfull++;
      if (new Set(spots.map((q) => `${q.x},${q.z}`)).size !== spots.length) overfull++;
      for (const i of w) if (bot.st.vend.line.includes(i)) wrong++;
      for (const i of w) {
        seen.add(i);
        if (!joined.has(i)) joined.set(i, bot.st.step);
        if (i === k || staysPut(bot.sim, i) || huddleOf(bot.sim, i) >= 0) wrong++;
        const m = bot.st.inmates[i];
        if (m.doing === DOING.WATCH && !at.has(i)) {
          at.set(i, bot.st.step - joined.get(i)!);
          const tx = Math.floor(m.body.x / UNIT);
          const tz = Math.floor(m.body.z / UNIT);
          if (!isFloor(bot.sim.world, tx, tz)) offFloor++;
        }
      }
    }
    // (Those who came with time to get there: 15 s or more before it was over.)
    const end = bot.st.step;
    const due = [...joined].filter(([, j]) => end - j >= 15 * STEPS_PER_SECOND).map(([i]) => i);
    came += seen.size;
    timely += due.length;
    there += due.filter((i) => at.has(i)).length;
    thereIn = Math.max(thereIn, ...at.values(), 0);
    // (Over: those there stay a moment (to cheer or groan: what's said reads them after the step), then go.)
    if (seen.size && (bot.st.watch?.length ?? 0) > 0 && bot.st.watchEnd) lingered++;
    for (let n = 0; n < LINGER + 3 * STEPS_PER_SECOND; n++) bot.step();
    stayed += bot.st.inmates.filter((m) => m.doing === DOING.WATCH).length + (bot.st.watch?.length ?? 0);
  }
  cameAll += came;
  check(games > 0, `${def.id}: a hand of Cheat played`);
  check(
    wrong === 0,
    `${def.id}: never more than ${WATCH_MAX} watching, never the one playing, one who stays put, the gathered or a queuer`,
  );
  check(overfull === 0, `${def.id}: never more watching than there are places, each place a tile of its own`);
  check(offFloor === 0, `${def.id}: those watching stand on open floor`);
  check(there === timely, `${def.id}: everyone who came to watch in time got to their place (${there} of ${timely})`);
  check(stayed === 0, `${def.id}: the game over, nobody stays watching`);
  cameGames += came > 0 ? games : 0;
  stayedAfter += lingered;
  console.log(
    `${def.id}: ${came} came to watch over ${games} games (${free} free within ${WATCH_REACH} tiles), at their places within ${(thereIn / STEPS_PER_SECOND).toFixed(0)} s, a moment after the end (${lingered}), then gone`,
  );
}
check(cameAll > 0, 'a crowd comes to the player games');
check(stayedAfter > 0, 'those watching are still there just after the end (their cheer or groan)');

// ------------------------------------------------------------------ when nobody comes
{
  // The Training Block: the rule's off (and Sparky, its one inmate, is the one playing), a bout really on.
  const training = new Bot(TRAINING, 3);
  training.routineUntil(1, 10 * 60 + 30);
  const k = partner(training);
  let started = false;
  if (k >= 0 && talkTo(training, k)) {
    training.st.energy = 100;
    training.op(OP.TALK, TALK.WRESTLE);
    started = training.st.bout.length > 0;
    for (let n = 0; n < 10 * STEPS_PER_SECOND && training.st.bout.length; n++) training.step(boutPress(training.sim));
  }
  check(
    started && !spectatorsHere(training.sim) && training.st.watch === undefined,
    'at the Training Block nobody comes to watch (a bout played)',
  );
  // A run from before 2.40 (Sim.rules239): nobody comes either (a hand of Cheat played).
  const old = new Bot(PRISONS[0], 4);
  old.sim.rules239 = true;
  old.routineUntil(2, 18 * 60 + 40);
  const j = partner(old);
  let dealt = false;
  if (j >= 0 && talkTo(old, j)) {
    old.st.cash = Math.max(old.st.cash, 20);
    old.op(OP.TALK, TALK.CHEAT, 0);
    dealt = !!old.st.cheat;
    for (let n = 0; n < 30 * STEPS_PER_SECOND; n++) old.step();
  }
  check(dealt && old.st.watch === undefined, 'nor in a run from before 2.40 (Sim.rules239)');
  // Past the games' hours (a hand of Cheat plays on past noon): those watching go, the game still on.
  let checked = '';
  for (const seed of [3, 4, 5, 6]) {
    const late = new Bot(PRISONS[2], seed);
    late.routineUntil(2, 11 * 60 + 45);
    const l = partner(late);
    if (l < 0 || !talkTo(late, l)) continue;
    late.st.cash = Math.max(late.st.cash, 20);
    late.op(OP.TALK, TALK.CHEAT, 0);
    if (!late.st.cheat) continue;
    let most = 0;
    while (late.st.cheat && gamesOpen(late.sim)) {
      late.step();
      most = Math.max(most, late.st.watch?.length ?? 0);
    }
    for (let n = 0; n < LINGER + 20 && late.st.cheat; n++) late.step();
    if (!late.st.cheat || !most) continue;
    check(!late.st.watch?.length, `past the games' hours, nobody stays to watch (${most} were, the hand still on)`);
    checked = `${most} watching till noon, then none`;
    break;
  }
  check(checked !== '', "past the games' hours: a hand of Cheat watched and played on past them");
  console.log(`nobody comes at the Training Block or in a run from before 2.40; past the games' hours: ${checked}`);
}

// ------------------------------------------------------------------ a bout played as a person would
// (Pressing near the beat, a little early or late, as a person keeps time: the window is 3 steps either side, 0.15 s.)
{
  const rows: string[] = [];
  for (const [name, lag] of [
    ['on the beat', 0],
    ['0.1 s late', 2],
    ['0.1 s early', -2],
    ['0.2 s late', 4],
  ] as const) {
    const bot = new Bot(PRISONS[0], 3);
    bot.routineUntil(2, 10 * 60 + 30);
    const k = partner(bot);
    if (k < 0 || !talkTo(bot, k)) continue;
    bot.st.energy = 100;
    const them = bot.st.inmates[k].str;
    bot.op(OP.TALK, TALK.WRESTLE);
    const from = bot.st.bout[3];
    let side = 1;
    let res = 'draw';
    for (let n = 0; n < 40 * STEPS_PER_SECOND && bot.st.bout.length; n++) {
      const t = bot.st.step + 1 - from;
      const press = t >= 0 && (((t - lag) % WRESTLE_BEAT) + WRESTLE_BEAT) % WRESTLE_BEAT === 0;
      if (press) side = 3 - side;
      bot.step(press ? command(0, OP.TRAIN, side) : 0);
      const e = bot.sim.events.find((x) => x.type === 'bout' && x.what !== 'push');
      if (e && e.type === 'bout') res = `${e.what} ${((bot.st.step - from) / STEPS_PER_SECOND).toFixed(1)}s`;
    }
    rows.push(`${name}: ${res}`);
    if (name === 'on the beat') check(res.startsWith('won'), `on the beat, Strength 40 beats ${them}`);
    if (name === '0.2 s late') check(!res.startsWith('won'), 'a fifth of a second off the beat, every time, never wins');
  }
  console.log(`a bout after its count-in (${COUNT_IN / STEPS_PER_SECOND} s), Strength 40 vs the nearest: ${rows.join('; ')}`);
}
