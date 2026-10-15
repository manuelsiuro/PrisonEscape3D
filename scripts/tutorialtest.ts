/**
 * The tutorial's lessons (P8+), each played by a bot through the real simulation on the
 * Training Block with ordinary commands: every step must come up and be ticked off, in order,
 * and the lesson end done. The lessons are data (src/tutorial/lessons.ts); this proves none
 * can get stuck.
 */
import { TRAINING } from '../src/content/prisons/training';
import { command, dirFromVector, OP, SLOT } from '../src/sim/command';
import { ROUTINE } from '../src/content/routine';
import { placesOf } from '../src/sim/ai/places';
import { UNIT } from '../src/sim/tuning';

import { TILE } from '../src/sim/world/tiles';
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

