/**
 * The tutorial's lessons (P8+), each played by a bot through the real simulation on the
 * Training Block with ordinary commands: every step must come up and be ticked off, in order,
 * and the lesson end done. The lessons are data (src/tutorial/lessons.ts); this proves none
 * can get stuck.
 */
import { TRAINING } from '../src/content/prisons/training';
import { command, dirFromVector, EXT, OP, SLOT, tossArgs } from '../src/sim/command';
import { GUARD } from '../src/sim/systems/guards';
import { aimToss } from '../src/sim/systems/noise';
import { ROUTINE } from '../src/content/routine';
import { placesOf } from '../src/sim/ai/places';
import { UNIT } from '../src/sim/tuning';

import { TILE, TILE_INFO } from '../src/sim/world/tiles';
import { MAP_W } from '../src/sim/world/World';
import { LESSONS, myDesk, type LessonCtx } from '../src/tutorial/lessons';
import { LessonProgress } from '../src/tutorial/progress';
import { Bot, DIR } from './bots';
import { check } from './assert';

const tile = (x: number, z: number) => z * MAP_W + x;

/** Plays a lesson: its scene set up, the bot's moves, the steps followed every step. */
function play(id: string, moves: (bot: Bot, ctx: LessonCtx) => void) {
  const lesson = LESSONS.find((l) => l.id === id)!;
  const bot = new Bot(TRAINING, 11);
  lesson.setup(bot.sim);
  const progress = new LessonProgress(lesson);
  const ctx: LessonCtx = { sim: bot.sim, craftOpen: false };
  const step = bot.step.bind(bot);
  const order: number[] = [];
  bot.step = (cmd = 0) => {
    step(cmd);
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
  const bot = new Bot(TRAINING, 13);
  lesson.setup(bot.sim);
  bot.step();
  for (const s of lesson.steps) {
    const goal = s.goal?.(bot.sim);
    if (goal === undefined || goal === null) continue;
    check(!bot.sim.world.propSolid[goal] && !TILE_INFO[bot.sim.world.ground.kind[goal]].solid, `${lesson.id}: the goal ${goal % MAP_W},${Math.floor(goal / MAP_W)} is open floor`);
  }
}
console.log('every lesson goal is open floor');
