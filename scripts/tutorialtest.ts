/**
 * The tutorial's lessons (P8+), each played by a bot through the real simulation on the
 * Training Block with ordinary commands: every step must come up and be ticked off, in order,
 * and the lesson end done. The lessons are data (src/tutorial/lessons.ts); this proves none
 * can get stuck.
 */
import { TRAINING } from '../src/content/prisons/training';
import { BRIBE, command, dirFromVector, EXT, OP, ORDER, SLOT, TALK, tossArgs } from '../src/sim/command';
import { drillOn, prisonDay } from '../src/sim/systems/calendar';
import { dropTile } from '../src/sim/systems/smuggling';
import { WAY } from '../src/content/smuggling';
import { containersOf } from '../src/sim/world/containers';
import { GUARD } from '../src/sim/systems/guards';
import { aimToss } from '../src/sim/systems/noise';
import { ROUTINE } from '../src/content/routine';
import { placesOf } from '../src/sim/ai/places';
import { UNIT } from '../src/sim/tuning';

import { TILE, TILE_INFO } from '../src/sim/world/tiles';
import { MAP_W, tileOfKey } from '../src/sim/world/World';
import { CHAPTERS, LESSONS, myDesk, type LessonCtx } from '../src/tutorial/lessons';
import { LessonProgress } from '../src/tutorial/progress';
import { Bot, DIR } from './bots';
import { check } from './assert';

const tile = (x: number, z: number) => z * MAP_W + x;

/** Plays a lesson: its scene set up (on its prison, from its seed, as the game sets it), the bot's moves, the steps followed every step. */
function play(id: string, moves: (bot: Bot, ctx: LessonCtx) => void) {
  const index = LESSONS.findIndex((l) => l.id === id);
  const lesson = LESSONS[index];
  const bot = new Bot(lesson.prison ?? TRAINING, lesson.seed ?? 7 + index);
  lesson.setup(bot.sim);
  const progress = new LessonProgress(lesson);
  const ctx: LessonCtx = { sim: bot.sim, craftOpen: false };
  const step = bot.step.bind(bot);
  const order: number[] = [];
  bot.step = (cmd = 0) => {
    step(cmd);
    for (const e of bot.sim.events) progress.event(e, bot.sim);
    const before = progress.k;
    if (progress.update(ctx)) for (let k = before; k < progress.k; k++) order.push(k);
    const why = progress.step?.fail?.(ctx);
    check(!why, `${id}: the lesson failed on the way (${why})`);
  };
  progress.update(ctx);
  moves(bot, ctx);
  bot.until(() => progress.done, 200);
  check(progress.done, `${id}: every step done (stuck at ${progress.k}: ${progress.step?.text})`);
  console.log(`${lesson.id}: ${lesson.steps.length} steps done by ${bot.time}`);
}

play('walk', (bot) => {
  bot.walkTo(tile(20, 23));
  bot.walkTo(tile(33, 19));
});

play('search', (bot) => {
  check(bot.open(myDesk(bot.sim)), 'search: the desk opens');
  bot.takeAll(16);
  bot.close();
  bot.hold('magazine');
});

play('craft', (bot, ctx) => {
  ctx.craftOpen = true;
  const mask = (1 << bot.slotOf('magazine')) | (1 << bot.slotOf('duct_tape'));
  bot.op(OP.CRAFT, mask);
});

play('routine', (bot) => {
  // The model prisoner: roll call, then home for Lights Out, then to bed.
  bot.keepRoutine(() => ROUTINE[bot.st.routine].id === 'lightsOut' && bot.sim.playerZone === 'playerCell', 20 * 60 * 90);
  bot.walkTo(placesOf(bot.sim.world).bedside[1]);
  bot.face(DIR.WEST);
  bot.act();
});

play('heat', (bot) => {
  bot.hold('light_cutters');
  bot.until(() => bot.st.heat >= 20, 20 * 60);
  bot.op(OP.SELECT, 1);
});

play('stash', (bot) => {
  check(bot.open(myDesk(bot.sim)), 'stash: the desk opens');
  bot.op(OP.MOVE, 0, SLOT.CONTAINER + 0);
});

play('dig', (bot) => {
  check(bot.strikeUntil('light_pickaxe', () => bot.sim.world.ground.kind[tile(20, 16)] === TILE.HOLE), 'dig: through the wall');
  bot.hold('poster');
  bot.use();
});

play('fight', (bot) => {
  bot.op(OP.LOCK, 2);
  // Up to him, then blows until he's down (he hits back).
  const m = bot.st.inmates[0];
  for (let k = 0; k < 600 && m.ko === 0; k++) {
    const dx = m.body.x - bot.st.player.x;
    const dz = m.body.z - bot.st.player.z;
    if (Math.hypot(dx, dz) > 1.1 * UNIT) bot.step(command(dirFromVector(dx, dz)));
    else bot.op(OP.USE, 1);
  }
});

play('noise', (bot) => {
  // The potato two tiles ahead; then a firecracker into the gym (the first tile there it can land on).
  const toss = (dx: number, dz: number) => bot.op(OP.EXT, EXT.THROW, ...tossArgs(bot.tile + dz * MAP_W + dx));
  toss(0, 2);
  bot.hold('firecracker');
  const into = [[0, 5], [0, 4], [1, 5], [-1, 5], [1, 4], [0, 6]].find(([dx, dz]) => aimToss(bot.sim, dx, dz).why === null);
  check(!!into, 'noise: somewhere in the gym to throw the firecracker');
  if (into) toss(into[0], into[1]);
  check(bot.until(() => bot.st.guards[0].mode === GUARD.INVESTIGATE, 200), 'noise: Bell goes to look');
  bot.until(() => bot.st.guards[0].mode !== GUARD.INVESTIGATE, 3000);
});

{
  // Both firecrackers thrown along the corridor, out of Bell's earshot: the lesson says so and ends (no dead end).
  const lesson = LESSONS.find((l) => l.id === 'noise')!;
  const bot = new Bot(TRAINING, 11);
  lesson.setup(bot.sim);
  const progress = new LessonProgress(lesson);
  const ctx: LessonCtx = { sim: bot.sim, craftOpen: false };
  const toss = (dx: number, dz: number) => bot.op(OP.EXT, EXT.THROW, ...tossArgs(bot.tile + dz * MAP_W + dx));
  toss(0, 2);
  progress.update(ctx);
  for (let k = 0; k < 2; k++) {
    bot.hold('firecracker');
    toss(-6, 0);
    bot.until(() => !bot.st.fuses.length, 60);
    progress.update(ctx);
  }
  check(progress.k === 1 && progress.step?.fail?.(ctx) === 'lesson.noise.missed', 'noise: both firecrackers out of earshot end the lesson, to try again');
  console.log(`noise, missed: ended at step ${progress.k + 1} (${progress.step?.fail?.(ctx)})`);
}

play('escape', (bot) => {
  // A step first: the plastic key in the pockets opens its door from then on.
  bot.step();
  check(bot.walkTo(tile(43, 19)), 'escape: in the generator room');
  bot.face(DIR.WEST);
  bot.act();
  check(!bot.sim.power, 'escape: the power is off');
  check(bot.walkTo(tile(29, 51)), 'escape: at the fence');
  bot.face(DIR.SOUTH);
  check(bot.strikeUntil('light_cutters', () => bot.sim.world.ground.kind[tile(29, 52)] === TILE.FENCE_CUT), 'escape: the fence cut');
  bot.walkTo(tile(29, 54));
});


// ---------------------------------------------------------------- Prison life

/** Up to someone (a body), then facing them and Interact: a talk. Whether one started. */
function talkTo(bot: Bot, body: { x: number; z: number }, limit = 1500): boolean {
  for (let k = 0; k < limit; k++) {
    const dx = body.x - bot.st.player.x;
    const dz = body.z - bot.st.player.z;
    if (Math.hypot(dx, dz) > 1.15 * UNIT) {
      bot.step(command(dirFromVector(dx, dz)));
      continue;
    }
    bot.step(command(dirFromVector(dx, dz)));
    bot.act();
    if (bot.st.talk >= 0) return true;
  }
  return false;
}
/** Walks up to a moving body until within `reach` tiles. */
function walkUp(bot: Bot, body: { x: number; z: number }, reach: number, limit = 1500): boolean {
  for (let k = 0; k < limit && Math.hypot(body.x - bot.st.player.x, body.z - bot.st.player.z) > reach * UNIT; k++) {
    const t = Math.floor(body.z / UNIT) * MAP_W + Math.floor(body.x / UNIT);
    bot.pilot.goTo(t);
    bot.step(command(bot.pilot.dir(bot.st.player)));
  }
  return Math.hypot(body.x - bot.st.player.x, body.z - bot.st.player.z) <= reach * UNIT;
}

play('guards', (bot) => {
  check(talkTo(bot, bot.st.guards[1].body), 'guards: talking to Pratt');
  bot.op(OP.TALK, TALK.BRIBE, BRIBE.PAPER);
});

play('day', (bot) => {
  check(bot.until(() => drillOn(bot.sim), 20 * 60 * 20), 'day: the drill bell');
  const spot = bot.sim.prison.rollCall[0];
  check(bot.walkTo(spot.z * MAP_W + spot.x), 'day: at roll call');
  bot.until(() => !drillOn(bot.sim), 20 * 60 * 30);
});

play('dogs', (bot) => {
  const dog = bot.st.dogs[0].body;
  bot.step();
  check(walkUp(bot, dog, 1.2) && bot.until(() => bot.sim.events.some((e) => e.type === 'dog' && e.what === 'sniff') || bot.st.dogs[0].sniffed > 0, 200), 'dogs: Biscuit sniffs the cutters');
  // Back off a few tiles, then the jerky thrown where he stands (once a throw can land there).
  for (let k = 0; k < 15; k++) bot.step(command(DIR.WEST));
  bot.hold('jerky');
  for (let k = 0; k < 400 && bot.slotOf('jerky') >= 0; k++) {
    const dx = Math.floor(dog.x / UNIT) - Math.floor(bot.st.player.x / UNIT);
    const dz = Math.floor(dog.z / UNIT) - Math.floor(bot.st.player.z / UNIT);
    if (Math.max(Math.abs(dx), Math.abs(dz)) >= 2 && aimToss(bot.sim, dx, dz).why === null) bot.op(OP.EXT, EXT.THROW, ...tossArgs(bot.tile + dz * MAP_W + dx));
    else bot.step();
  }
  check(bot.until(() => bot.st.dogs[0].trust >= 60, 40), 'dogs: the jerky eaten, trusted');
  bot.op(OP.SELECT, 2);
  walkUp(bot, dog, 1.2);
});

play('rat', (bot) => {
  bot.use();
  bot.use();
  check(bot.st.rats.length === 1, 'rat: tamed');
  const desk = containersOf(bot.sim.world).findIndex((c) => !c.mine && c.prop.kind === 'desk');
  bot.op(OP.EXT, EXT.RAT_FETCH, ...tossArgs(desk));
  bot.until(() => bot.slotOf('lighter') >= 0, 3000);
});

play('smuggle', (bot) => {
  bot.op(OP.EXT, EXT.ORDER, 7, WAY.DRONE);
  check(bot.st.order.length === 3, 'smuggle: ordered by drone');
  bot.op(OP.SELECT, 1);
  const drop = dropTile(bot.sim, prisonDay(bot.st.step));
  // Stood where it lands, waiting for it; then two seconds to react (a person's, not a bot's), and picked up.
  check(bot.walkTo(drop), 'smuggle: on the drop');
  check(bot.until(() => bot.st.drops.length > 0, 3 * 60 * 20), 'smuggle: the drone drops it');
  bot.until(() => false, 40);
  check(bot.st.drops.length === 1, 'smuggle: still lying there two seconds later');
  bot.act();
});

play('games', (bot) => {
  check(talkTo(bot, bot.st.inmates[0].body), 'games: talking to Sparky');
  bot.op(OP.TALK, TALK.DICE, 0);
  bot.op(OP.TALK, TALK.REROLL, 0);
  bot.op(OP.TALK, TALK.WRESTLE);
  for (let k = 0; k < 2000 && bot.st.bout.length; k++) bot.step(command(0, OP.TRAIN, 1 + (k % 2)));
});

play('crew', (bot) => {
  check(talkTo(bot, bot.st.inmates[0].body), 'crew: talking to Sparky');
  bot.op(OP.TALK, TALK.RECRUIT);
  check(bot.st.followers.includes(0), 'crew: Sparky follows');
  bot.op(OP.TALK, TALK.CREW, ORDER.WATCH);
  bot.until(() => bot.sim.events.some((e) => e.type === 'crew' && e.what === 'whistle'), 3000);
});

{
  // Posted where Bell's round can't be seen (back along the corridor): the lesson says so and ends.
  const index = LESSONS.findIndex((l) => l.id === 'crew');
  const lesson = LESSONS[index];
  const bot = new Bot(TRAINING, 7 + index);
  lesson.setup(bot.sim);
  const progress = new LessonProgress(lesson);
  const ctx: LessonCtx = { sim: bot.sim, craftOpen: false };
  const m = bot.st.inmates[0];
  m.body.x = 22 * UNIT + UNIT / 2;
  talkTo(bot, m.body);
  bot.op(OP.TALK, TALK.RECRUIT);
  for (const e of bot.sim.events) progress.event(e, bot.sim);
  progress.update(ctx);
  bot.op(OP.TALK, TALK.CREW, ORDER.WATCH);
  for (const e of bot.sim.events) progress.event(e, bot.sim);
  progress.update(ctx);
  check(progress.k === 2 && progress.step?.fail?.(ctx) === 'lesson.crew.far', 'crew: posted out of sight of the round ends the lesson, to try again');
  console.log(`crew, posted far: ended at step ${progress.k + 1} (${progress.step?.fail?.(ctx)})`);
}

/** A lesson set up and followed through a bot's steps (no checks): for the ways it can end badly. */
function follow(id: string) {
  const index = LESSONS.findIndex((l) => l.id === id);
  const lesson = LESSONS[index];
  const bot = new Bot(lesson.prison ?? TRAINING, lesson.seed ?? 7 + index);
  lesson.setup(bot.sim);
  const progress = new LessonProgress(lesson);
  const ctx: LessonCtx = { sim: bot.sim, craftOpen: false };
  const step = bot.step.bind(bot);
  bot.step = (cmd = 0) => {
    step(cmd);
    for (const e of bot.sim.events) progress.event(e, bot.sim);
    progress.update(ctx);
  };
  return { bot, progress, why: () => progress.step?.fail?.(ctx) ?? null };
}
{
  // The drill's bell, and the player stays where they are: too late, the lesson ends.
  const { bot, progress, why } = follow('day');
  bot.until(() => !!why(), 40 * 60 * 20);
  check(progress.k === 1 && why() === 'lesson.day.missed', 'day: missing the muster ends the lesson, to try again');
  console.log(`day, missed: ended at step ${progress.k + 1} (${why()}) by ${bot.time}`);
}
{
  // The drop left lying in the yard: a guard takes it, the lesson ends.
  const { bot, progress, why } = follow('smuggle');
  bot.op(OP.EXT, EXT.ORDER, 7, WAY.DRONE);
  bot.op(OP.SELECT, 1);
  bot.walkTo(dropTile(bot.sim, prisonDay(bot.st.step)));
  bot.until(() => !!why(), 4 * 60 * 20);
  check(why() === 'lesson.smuggle.seized', 'smuggle: a drop left lying is seized and the lesson ends');
  console.log(`smuggle, left lying: ended at step ${progress.k + 1} (${why()}) by ${bot.time}`);
}

// Done another way than the bot's (the review's repros): still through, never stuck.
{
  // At roll call before the bell: the bell and the muster in one step, both steps ticked.
  const { bot, progress } = follow('day');
  const spot = bot.sim.prison.rollCall[0];
  bot.walkTo(spot.z * MAP_W + spot.x);
  bot.until(() => progress.done, 60 * 60 * 20);
  check(progress.done, `day: at roll call before the bell, the lesson still ends done (stuck at ${progress.k})`);
}
{
  // Waiting two tiles off the drop, then stepping on and picking it up once it's down.
  const { bot, progress } = follow('smuggle');
  bot.op(OP.EXT, EXT.ORDER, 7, WAY.DRONE);
  bot.op(OP.SELECT, 1);
  const drop = dropTile(bot.sim, prisonDay(bot.st.step));
  bot.walkTo(drop + 2);
  bot.until(() => bot.st.drops.length > 0, 3 * 60 * 20);
  bot.walkTo(drop);
  bot.act();
  bot.until(() => progress.done, 100);
  check(progress.done, `smuggle: picked up from beside the drop, the lesson still ends done (stuck at ${progress.k})`);
}
{
  // The jerky thrown before ever being sniffed: trusted from the start, the last step is all that's left.
  const { bot, progress } = follow('dogs');
  const dog = bot.st.dogs[0].body;
  bot.step();
  walkUp(bot, dog, 3.5);
  bot.hold('jerky');
  for (let k = 0; k < 400 && bot.slotOf('jerky') >= 0; k++) {
    const dx = Math.floor(dog.x / UNIT) - Math.floor(bot.st.player.x / UNIT);
    const dz = Math.floor(dog.z / UNIT) - Math.floor(bot.st.player.z / UNIT);
    if (Math.max(Math.abs(dx), Math.abs(dz)) >= 2 && aimToss(bot.sim, dx, dz).why === null) bot.op(OP.EXT, EXT.THROW, ...tossArgs(bot.tile + dz * MAP_W + dx));
    else bot.step();
  }
  check(progress.k === 2, `dogs: a treat first leaves only the last step (at ${progress.k})`);
  bot.op(OP.SELECT, 2);
  walkUp(bot, dog, 1.2);
  bot.until(() => progress.done, 100);
  check(progress.done, 'dogs: and it ends done');
}
{
  // Pratt never paid: the heat cools off by itself and the lesson says so.
  const { bot, progress, why } = follow('guards');
  bot.until(() => !!why(), 8 * 60 * 20);
  check(why() === 'lesson.guards.cooled', `guards: heat cooled off before paying ends the lesson (${why()})`);
  console.log(`guards, never paid: ended at step ${progress.k + 1} (${why()}) by ${bot.time}`);
}
{
  // No game played before the evening's free time ends: the lesson says so.
  const { bot, progress, why } = follow('games');
  bot.until(() => !!why(), 5 * 60 * 20);
  check(why() === 'lesson.games.closed', `games: free time over ends the lesson (${why()})`);
  console.log(`games, never played: ended at step ${progress.k + 1} (${why()}) by ${bot.time}`);
}
{
  // The caught rat dropped before it's tame: the lesson says so.
  const { bot, progress, why } = follow('rat');
  bot.op(OP.DROP, 0);
  bot.step();
  check(why() === 'lesson.rat.lost', `rat: the caught rat dropped ends the lesson (${why()})`);
  console.log(`rat, dropped: ended at step ${progress.k + 1} (${why()})`);
}

// Every lesson is in exactly one chapter, the chapters in the order the list has them.
check(JSON.stringify(CHAPTERS.flatMap((c) => c.lessons)) === JSON.stringify(LESSONS.map((l) => l.id)), 'the chapters hold every lesson once, in order');
console.log(`${CHAPTERS.length} chapters: ${CHAPTERS.map((c) => `${c.id} ${c.lessons.length}`).join(', ')}`);

// The Training Block's only way out is the fence: its one guard down doesn't open the gates.
{
  const bot = new Bot(TRAINING, 12);
  for (const g of bot.sim.state.guards) g.ko = 400;
  bot.until(() => false, 5);
  check(!bot.sim.state.takeover, 'training: no takeover');
  console.log('training: its guard out cold, no takeover');
}

// Every step's floor arrows lead somewhere the player can stand (a goal inside furniture or a wall shows no arrows).
for (const lesson of LESSONS) {
  const bot = new Bot(lesson.prison ?? TRAINING, 13);
  lesson.setup(bot.sim);
  bot.step();
  for (const s of lesson.steps) {
    const goal = s.goal?.(bot.sim);
    if (goal === undefined || goal === null) continue;
    check(!bot.sim.world.propSolid[goal] && !TILE_INFO[bot.sim.world.ground.kind[goal]].solid, `${lesson.id}: the goal ${goal % MAP_W},${Math.floor(goal / MAP_W)} is open floor`);
  }
}
console.log('every lesson goal is open floor');
