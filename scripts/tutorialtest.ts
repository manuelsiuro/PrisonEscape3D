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
import { markerAt, sweetSpot } from '../src/sim/systems/games';
import { isTrue } from '../src/sim/systems/cards';
import { courtOf, powerAt, shotWindow } from '../src/sim/systems/hoops';
import { squareAt } from '../src/sim/systems/checkers';
import { cardUp, RACE_ENTER, raceCard } from '../src/sim/systems/races';
import { thorough } from '../src/sim/systems/delivery';
import { jobRooms, priceOf } from '../src/sim/systems/economy';
import { itemDef } from '../src/content/items';
import { itemOf } from '../src/sim/systems/items';
import { checkpointOf, shiftChange } from '../src/sim/systems/getaway';
import { WAY } from '../src/content/smuggling';
import { containersOf } from '../src/sim/world/containers';
import { GUARD } from '../src/sim/systems/guards';
import { aimToss } from '../src/sim/systems/noise';
import { ROUTINE } from '../src/content/routine';
import { placesOf } from '../src/sim/ai/places';
import { UNIT } from '../src/sim/tuning';

import { TILE, TILE_INFO } from '../src/sim/world/tiles';
import { LAYER, MAP_W, tileOfKey } from '../src/sim/world/World';
import { CHAPTERS, LESSONS, myDesk, type LessonCtx } from '../src/tutorial/lessons';
import { LessonProgress } from '../src/tutorial/progress';
import { Bot, DIR, n } from './bots';
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
    const why = progress.verdict(ctx);
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


// ---------------------------------------------------------------- Getting by

/** Faces a tile from where the player stands (a step's turn toward it). */
function faceTile(bot: Bot, t: number) {
  const dx = ((t % MAP_W) + 0.5) * UNIT - bot.st.player.x;
  const dz = (Math.floor(t / MAP_W) + 0.5) * UNIT - bot.st.player.z;
  bot.face(dirFromVector(dx, dz));
}
/** To a free tile beside a prop, facing it, and Interact. */
function useProp(bot: Bot, prop: number) {
  const w = bot.sim.world;
  const p = w.props[prop];
  bot.pilot.goToAny((i) => {
    const x = i % MAP_W;
    const z = Math.floor(i / MAP_W);
    const side = (x === p.x - 1 || x === p.x + p.w) !== (z === p.z - 1 || z === p.z + p.d);
    return side && x >= p.x - 1 && x <= p.x + p.w && z >= p.z - 1 && z <= p.z + p.d && !w.blocked(x, z);
  });
  bot.until(() => !bot.pilot.active, 3000, () => command(bot.pilot.dir(bot.st.player)));
  bot.face(dirFromVector((p.x + p.w / 2) * UNIT - bot.st.player.x, (p.z + p.d / 2) * UNIT - bot.st.player.z));
  bot.act();
}

play('talk', (bot) => {
  check(talkTo(bot, bot.st.inmates[0].body), 'talk: talking to Sparky');
  bot.op(OP.TALK, TALK.GIFT, bot.slotOf('chocolate'));
  bot.op(OP.TALK, TALK.ACCEPT);
  bot.op(OP.CLOSE);
  check(bot.walkTo(deskTileOf(bot) + MAP_W), 'talk: at the desk');
  bot.face(DIR.NORTH);
  check(bot.open(myDesk(bot.sim)), 'talk: the desk opens');
  bot.takeAll(16);
  bot.close();
  check(bot.slotOf('magazine') >= 0, 'talk: the magazine in the pockets');
  check(talkTo(bot, bot.st.inmates[0].body), 'talk: talking to him again');
  bot.op(OP.TALK, TALK.HAND_IN);
});

play('trade', (bot) => {
  const who = bot.st.inmates.findIndex((m) => m.cell === bot.sim.prison.merchants[0]);
  check(talkTo(bot, bot.st.inmates[who].body), 'trade: talking to the merchant');
  const shop = bot.st.shops[bot.sim.merchantOf(who)];
  const k = shop.findIndex((v) => v && priceOf(itemDef(itemOf(v)).value, bot.st.inmates[who].opinion) <= bot.st.cash);
  check(k >= 0, 'trade: something affordable on the stall');
  bot.op(OP.TALK, TALK.BUY, k);
});

play('job', (bot) => {
  // (A step first: the Work Period's doors open as the step ends.)
  bot.step();
  const room = jobRooms(bot.sim.world)[0];
  useProp(bot, room.take);
  check(bot.slotOf('dirty_laundry') >= 0, 'job: a load of dirty laundry');
  const machine = room.machines[0];
  useProp(bot, machine);
  check(bot.st.machines[machine] !== undefined, 'job: in the machine');
  bot.until(() => bot.st.machines[machine] <= bot.st.step, 3000);
  useProp(bot, machine);
  check(bot.slotOf('clean_laundry') >= 0, 'job: the clean load out');
  useProp(bot, room.put);
});

play('gym', (bot) => {
  bot.act();
  check(bot.st.train >= 0, 'gym: on the weights');
  for (let k = 0; k < 3000 && !bot.sim.events.some((e) => e.type === 'trained'); k++) bot.op(OP.TRAIN, 1 + (k % 2));
});

play('disguise', (bot) => {
  bot.op(OP.EQUIP, 0);
  check(itemOf(bot.st.items.inv[SLOT.OUTFIT]) === n('guard_outfit'), 'disguise: in uniform');
  check(bot.walkTo(tile(38, 29)), 'disguise: into the gym');
  bot.until(() => bot.st.guards[0].sees, 3000);
  check(bot.st.heat === 0, 'disguise: Bell pays no mind');
});

/** The tunnel lesson's way down: the entrance under the desk, the dirt flushed, down through the desk. */
function tunnelDown(bot: Bot) {
  const desk = deskTileOf(bot);
  const below = desk + MAP_W;
  check(bot.strikeUntil('sturdy_shovel', () => bot.sim.world.ground.kind[desk] === TILE.SHAFT), 'tunnel: the entrance under the desk');
  check(bot.walkTo(tile(22, 19)), 'tunnel: by the toilet');
  bot.face(DIR.SOUTH);
  bot.hold('dirt');
  bot.act();
  check(bot.slotOf('dirt') < 0, 'tunnel: the dirt flushed');
  bot.walkTo(below);
  bot.face(DIR.NORTH);
  bot.open(myDesk(bot.sim));
  bot.act(1);
  check(bot.st.layer === LAYER.UNDER, 'tunnel: down');
}
/** North along the tunnel to each row given, a brace every third tile. */
function tunnelNorth(bot: Bot, rows: number[]) {
  const x = deskTileOf(bot) % MAP_W;
  tunnelAlong(bot, DIR.NORTH, rows.map((z) => tile(x, z)));
}
/** Along the tunnel one way, tile by tile, a brace every third tile. */
function tunnelAlong(bot: Bot, dir: number, tiles: number[]) {
  tiles.forEach((t, k) => {
    if (k % 3 === 2) {
      bot.hold('timber_brace');
      bot.use();
    }
    bot.face(dir);
    check(bot.strikeUntil('sturdy_shovel', () => bot.sim.world.layers[LAYER.UNDER].kind[t] !== TILE.SOIL), `tunnel: ${t % MAP_W},${Math.floor(t / MAP_W)} dug`);
    check(bot.walkTo(t, 400), `tunnel: along to ${t % MAP_W},${Math.floor(t / MAP_W)}`);
  });
}
/** Dig up (U, its button), facing on north: a press each until up. */
function digUp(bot: Bot) {
  bot.hold('sturdy_shovel');
  for (let k = 0; k < 400 && bot.st.layer === LAYER.UNDER; k++) bot.op(OP.EXT, EXT.DIG_UP);
}

play('tunnel', (bot) => {
  tunnelDown(bot);
  tunnelNorth(bot, [16, 15, 14, 13, 12, 11, 10, 9]);
  // (Still facing the earth ahead: Dig up goes up all the same.)
  check(bot.st.player.facing === DIR.NORTH, 'tunnel: facing on north');
  digUp(bot);
  check(bot.st.layer === LAYER.GROUND, 'tunnel: dug up');
});

play('vents', (bot) => {
  check(bot.strikeUntil('screwdriver', () => bot.sim.world.layers[LAYER.VENTS].kind[tile(9, 9)] === TILE.GRATE_OPEN), 'vents: the grate unscrewed');
  bot.act();
  check(bot.st.layer === LAYER.VENTS, 'vents: up in the ducts');
  check(bot.walkTo(tile(13, 38), 3000), 'vents: along to the ladder');
  check(bot.walkTo(tile(13, 39), 200), 'vents: at the ladder');
  bot.act();
});

// ---------------------------------------------------------------- Prison life

/** Up to someone (a body), then facing them and Interact: a talk. Whether one started. */
function talkTo(bot: Bot, body: { x: number; z: number }, limit = 1500): boolean {
  for (let k = 0; k < limit; k++) {
    const dx = body.x - bot.st.player.x;
    const dz = body.z - bot.st.player.z;
    // (Far: along the way round walls; close: straight up to them.)
    if (Math.hypot(dx, dz) > 2 * UNIT) {
      bot.pilot.goTo(Math.floor(body.z / UNIT) * MAP_W + Math.floor(body.x / UNIT));
      bot.step(command(bot.pilot.dir(bot.st.player)));
      continue;
    }
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

play('cards', (bot) => {
  check(talkTo(bot, bot.st.inmates[0].body), 'cards: talking to Sparky');
  bot.op(OP.TALK, TALK.CHEAT, 0);
  // True cards when there are (one if not), a call on his tell or his empty hand; to the end.
  for (let k = 0; k < 4000 && bot.st.cheat; k++) {
    const c = bot.st.cheat;
    if (c.turn !== 0) {
      bot.step();
      continue;
    }
    if (c.by === 1 && (c.tell || !c.theirs.length || !c.mine.length)) bot.op(OP.TALK, TALK.LIAR);
    else {
      const ks = c.mine.map((card, j) => (isTrue(card, c.table) ? j : -1)).filter((j) => j >= 0).slice(0, 3);
      bot.op(OP.TALK, TALK.PLAY, (ks.length ? ks : [0]).reduce((m, j) => m | (1 << j), 0));
    }
  }
});

/** A shot from the spot the bot stands on, let go at the best moment (the sim's own window). */
function shoot(bot: Bot, spot: number) {
  bot.op(OP.EXT, EXT.SHOOT, 0);
  const from = bot.st.shot[0];
  const win = shotWindow(bot.sim, spot);
  let best = 1;
  for (let j = 1; j < 48; j++) if (Math.abs(powerAt(j) - win[0]) < Math.abs(powerAt(best) - win[0])) best = j;
  while (bot.st.shot.length && bot.st.step + 1 - from < best) bot.step();
  bot.op(OP.EXT, EXT.SHOOT, 1);
}

play('hoops', (bot) => {
  const c = courtOf(bot.sim)!;
  const spot = (k: number) => tile(c.spots[k].x, c.spots[k].z);
  check(bot.walkTo(spot(0)), 'hoops: on the first spot');
  shoot(bot, 0);
  bot.until(() => false, 30);
  check(talkTo(bot, bot.st.inmates[0].body), 'hoops: talking to Sparky');
  bot.op(OP.TALK, TALK.HOOPS);
  check(!!bot.st.shootout, 'hoops: a shootout on');
  for (let k = 0; k < 40 && bot.st.shootout; k++) {
    const o = bot.st.shootout;
    if (o.turn !== 0) {
      bot.until(() => !bot.st.shootout || bot.st.shootout.turn === 0, 200);
      continue;
    }
    const at = o.k % c.spots.length;
    check(bot.walkTo(spot(at)), `hoops: on spot ${at + 1}`);
    shoot(bot, at);
  }
});

play('checkers', (bot) => {
  check(talkTo(bot, bot.st.inmates[0].body), 'checkers: talking to Sparky');
  bot.op(OP.TALK, TALK.CHECKERS, 1);
  check(!!bot.st.board?.seated, 'checkers: at the board');
  bot.op(OP.TALK, TALK.MOVE, squareAt(5, 2), squareAt(3, 4));
  bot.op(OP.TALK, TALK.MOVE, squareAt(3, 4), squareAt(1, 6));
  check(bot.st.board?.over === 1, 'checkers: won with the double jump');
});

play('pruno', (bot, ctx) => {
  // The bag brewed on the bench, hidden in the toilet's tank; to bed; last night's bag drunk in the morning.
  ctx.craftOpen = true;
  bot.op(OP.CRAFT, (1 << 0) | (1 << 1) | (1 << 2));
  ctx.craftOpen = false;
  check(bot.slotOf('pruno_bag') >= 0, 'pruno: a bag brewed');
  const toilet = containersOf(bot.sim.world).findIndex((c) => c.mine && c.prop.kind === 'toilet');
  const t = containersOf(bot.sim.world)[toilet].prop;
  check(bot.walkTo(tile(t.x - 1, t.z)), 'pruno: by the toilet');
  bot.face(DIR.EAST);
  check(bot.open(toilet), 'pruno: the tank opens');
  bot.putIn('pruno_bag', 0);
  bot.close();
  bot.walkTo(placesOf(bot.sim.world).bedside[1]);
  bot.face(DIR.WEST);
  bot.act();
  check(bot.st.sleeping, 'pruno: asleep');
  check(
    bot.until(() => bot.events.some((e) => e.type === 'pruno' && e.what === 'ripe'), 12 * 60 * 20 * 60),
    'pruno: last night\'s bag ripe by morning',
  );
  check(bot.walkTo(deskTileOf(bot) + MAP_W), 'pruno: at the desk');
  bot.face(DIR.NORTH);
  check(bot.open(myDesk(bot.sim)), 'pruno: the desk opens');
  bot.takeAll(1);
  bot.close();
  bot.hold('pruno');
  bot.use();
});

play('garden', (bot) => {
  const g = TRAINING.leisure!.garden;
  // The bed ahead planted and watered; the wilted one at the end watered; the ripe one picked from beside it.
  bot.hold('veg_seeds');
  bot.use();
  bot.hold('plastic_cup');
  bot.use();
  check(bot.walkTo(tile(g.x + g.w - 1, g.z + g.d)), 'garden: below the wilted bed');
  bot.face(DIR.NORTH);
  bot.use();
  check(bot.walkTo(tile(g.x + g.w, g.z)), 'garden: beside the ripe bed');
  bot.face(DIR.WEST);
  bot.use();
  check(bot.slotOf('fruit') >= 0, 'garden: fruit picked');
});

play('ratRace', (bot) => {
  // Laps on the track at home (the potato eaten), to the track, entered, $5 on the pet, the race.
  bot.hold('rat_track');
  bot.use();
  const r = TRAINING.leisure!.race;
  check(bot.walkTo(tile(r.x, r.z - 1)), 'ratRace: at the track');
  check(bot.until(() => cardUp(bot.sim), 2 * 60 * 20 * 60), 'ratRace: the card up');
  bot.op(OP.EXT, EXT.RACE, RACE_ENTER);
  bot.op(OP.EXT, EXT.RACE, raceCard(bot.st, prisonDay(bot.st.step)).length - 1, 0);
  check(bot.until(() => bot.events.some((e) => e.type === 'race' && e.what === 'result'), 90 * 20 * 60), 'ratRace: the race run');
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

// ---------------------------------------------------------------- Ways out

play('lockpick', (bot) => {
  bot.use();
  check(bot.st.pick.length === 3, 'lockpick: picking the purple door');
  const door = bot.st.pick[0];
  const spot: [number, number] = [0, 0];
  const inZone = (k: number) => {
    sweetSpot(bot.st.salt, door, bot.st.pick[1], bot.st.items.int, spot);
    const m = markerAt(k);
    return m >= spot[0] && m <= spot[1];
  };
  for (let pin = 0; pin < 4 && bot.st.pick.length; pin++) {
    for (let g = 0; g < 200 && bot.st.pick.length && !inZone(bot.st.step + 1 - bot.st.pick[2]); g++) bot.step();
    bot.use();
  }
  check(bot.st.picked.length > 0, 'lockpick: open');
  check(bot.walkTo(tile(43, 19)), 'lockpick: through into the generator room');
});

play('stowaway', (bot) => {
  check(!thorough(bot.sim, 1), 'stowaway: the lesson\'s day is a quick look, as it says');
  const d = bot.sim.prison.delivery!;
  check(bot.walkTo(d.tail.z * MAP_W + d.tail.x), 'stowaway: at the truck\'s tail');
  check(bot.until(() => !bot.st.seen && !bot.st.guards.some((g) => g.mode === GUARD.CHASE), 60 * 20), 'stowaway: nobody looking');
  bot.act();
  check(bot.st.stowed, 'stowaway: hidden in the truck');
  bot.until(() => bot.st.escaped > 0, 2 * 60 * 20);
});

play('bluff', (bot) => {
  const c = checkpointOf(bot.sim)!;
  check(bot.walkTo(c.window[0].z * MAP_W + c.window[0].x, 2000), 'bluff: at the window');
  bot.face(DIR.SOUTH);
  check(bot.until(() => shiftChange(bot.st.step), 30 * 20), 'bluff: the shift change');
  bot.act();
  check(bot.st.waved > 0, 'bluff: waved through');
  bot.walkTo(c.gates[0].z * MAP_W + c.gates[0].x + MAP_W, 400);
});

play('glider', (bot) => {
  check(bot.walkTo(tile(57, 39), 600), 'glider: at the roof\'s east edge');
  bot.face(DIR.EAST);
  bot.use();
});

const carriesLockpick = (bot: Bot) => bot.slotOf('lockpick') >= 0;
/** The player's desk's tile. */
function deskTileOf(bot: Bot): number {
  const p = containersOf(bot.sim.world)[myDesk(bot.sim)].prop;
  return p.z * MAP_W + p.x;
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
  return { bot, progress, ctx, why: () => progress.verdict(ctx) };
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

{
  // The lockpick worn out on misses: the lesson says so.
  const { bot, progress, why } = follow('lockpick');
  bot.use();
  for (let k = 0; k < 40 && carriesLockpick(bot); k++) {
    const door = bot.st.pick[0];
    const spot: [number, number] = [0, 0];
    if (door === undefined) break;
    sweetSpot(bot.st.salt, door, bot.st.pick[1], bot.st.items.int, spot);
    for (let g = 0; g < 200; g++) {
      const m = markerAt(bot.st.step + 1 - bot.st.pick[2]);
      const was = markerAt(bot.st.step - bot.st.pick[2]);
      if ((m < spot[0] || m > spot[1]) && (was < spot[0] || was > spot[1])) break;
      bot.step();
    }
    bot.use();
  }
  check(why() === 'lesson.lockpick.broke', `lockpick: worn out on slips ends the lesson (${why()})`);
  console.log(`lockpick, worn out: ended at step ${progress.k + 1} (${why()})`);
}
{
  // Never climbing in: the truck leaves without the player.
  const { bot, progress, why } = follow('stowaway');
  bot.until(() => !!why(), 2 * 60 * 20);
  check(why() === 'lesson.stowaway.missed', `stowaway: the truck gone without the player ends the lesson (${why()})`);
  console.log(`stowaway, missed: ended at step ${progress.k + 1} (${why()}) by ${bot.time}`);
}
{
  // At the window too late: the shift change over.
  const { bot, progress, why } = follow('bluff');
  bot.until(() => !!why(), 40 * 20 * 60);
  check(why() === 'lesson.bluff.late', `bluff: the shift change missed ends the lesson (${why()})`);
  console.log(`bluff, late: ended at step ${progress.k + 1} (${why()}) by ${bot.time}`);
}
{
  // Off the east edge into a strong east wind: down short of the fence, the glider wrecked.
  const { bot, progress, why } = follow('glider');
  bot.st.calendar = [[1, -1, -1, 2, 4]];
  bot.walkTo(tile(57, 39), 600);
  bot.face(DIR.EAST);
  bot.use();
  bot.step();
  check(bot.st.escaped === 0 && why() === 'lesson.glider.inside', `glider: down inside ends the lesson (${why()})`);
  console.log(`glider, inside: ended at step ${progress.k + 1} (${why()})`);
}

{
  // Waved through, then standing about: the gates shut again (the shift change long over), the lesson says so.
  const { bot, progress, why } = follow('bluff');
  const c = checkpointOf(bot.sim)!;
  bot.walkTo(c.window[0].z * MAP_W + c.window[0].x, 2000);
  bot.face(DIR.SOUTH);
  bot.until(() => shiftChange(bot.st.step), 30 * 20);
  bot.act();
  check(bot.st.waved > 0, 'bluff: waved through');
  bot.until(() => !!why(), 3 * 60 * 20);
  check(why() === 'lesson.bluff.shut', `bluff: the gates shut again ends the lesson (${why()})`);
  console.log(`bluff, gates shut: ended at step ${progress.k + 1} (${why()}) by ${bot.time}`);
}
{
  // On the roof past the night's bed checks: the dummy in bed keeps it quiet (no lockdown, nothing failed).
  const { bot, why } = follow('glider');
  bot.until(() => !!why() || bot.st.lockdown, 3 * 60 * 20);
  check(!why() && !bot.st.lockdown, `glider: the bed checks pass with the dummy (${why()}, lockdown ${bot.st.lockdown})`);
  console.log(`glider, waiting on the roof: ${bot.time}, no lockdown`);
}
{
  // Standing about: noon comes, the stall shuts.
  const { bot, progress, why } = follow('trade');
  bot.until(() => !!why(), 3 * 60 * 20);
  check(why() === 'lesson.trade.closed', `trade: free time over ends the lesson (${why()})`);
  console.log(`trade, never bought: ended at step ${progress.k + 1} (${why()}) by ${bot.time}`);
}
{
  // Standing about: 15:00 comes with nothing washed.
  const { bot, progress, why } = follow('job');
  bot.until(() => !!why(), 4 * 60 * 20);
  check(why() === 'lesson.job.late', `job: the Work Period over ends the lesson (${why()})`);
  console.log(`job, idle: ended at step ${progress.k + 1} (${why()}) by ${bot.time}`);
}
{
  // The favor taken, then the magazine given away as a gift: the lesson says so.
  const { bot, progress, why } = follow('talk');
  talkTo(bot, bot.st.inmates[0].body);
  bot.op(OP.TALK, TALK.GIFT, bot.slotOf('chocolate'));
  bot.op(OP.TALK, TALK.ACCEPT);
  bot.op(OP.CLOSE);
  bot.walkTo(deskTileOf(bot) + MAP_W);
  bot.face(DIR.NORTH);
  bot.open(myDesk(bot.sim));
  bot.takeAll(16);
  bot.close();
  talkTo(bot, bot.st.inmates[0].body);
  bot.op(OP.TALK, TALK.GIFT, bot.slotOf('magazine'));
  bot.step();
  check(why() === 'lesson.talk.lost', `talk: the magazine given away ends the lesson (${why()})`);
  console.log(`talk, magazine given away: ended at step ${progress.k + 1} (${why()})`);
}
{
  // Dug up in the yard, inside the fence: the lesson says so.
  const { bot, progress, why } = follow('tunnel');
  tunnelDown(bot);
  tunnelNorth(bot, [16, 15]);
  digUp(bot);
  check(bot.st.layer === LAYER.GROUND && why() === 'lesson.tunnel.early', `tunnel: dug up inside the fence ends the lesson (${why()})`);
  console.log(`tunnel, up in the yard: ended at step ${progress.k + 1} (${why()})`);
}
// Done another way than the bot's (the review's repros): still through, never stuck.
{
  // A stray hole dug down in the cell first (Space held facing the wrong way), then the lesson as the bot plays it: never "dug up inside".
  const { bot, progress, why } = follow('tunnel');
  bot.face(DIR.WEST);
  bot.hold('sturdy_shovel');
  check(bot.strikeUntil('sturdy_shovel', () => bot.sim.world.ground.kind[tile(21, 18)] === TILE.SHAFT), 'tunnel: a stray hole dug down');
  for (let k = 0; k < 6; k++) if (itemOf(bot.st.items.inv[k]) === n('dirt')) bot.st.items.inv[k] = 0;
  bot.walkTo(tile(22, 18));
  bot.face(DIR.NORTH);
  tunnelDown(bot);
  tunnelNorth(bot, [16, 15, 14, 13, 12, 11, 10, 9]);
  digUp(bot);
  bot.until(() => progress.done, 200);
  check(progress.done && !why(), `tunnel: a stray hole dug down first, still done (${why()}, step ${progress.k + 1})`);
}
{
  // West under the side fence (x 14) and up outside it: done too (the lesson says north, but any side is out).
  const { bot, progress, why } = follow('tunnel');
  tunnelDown(bot);
  tunnelAlong(bot, DIR.WEST, [21, 20, 19, 18, 17, 16, 15, 14, 13].map((x) => tile(x, 17)));
  digUp(bot);
  bot.until(() => progress.done, 200);
  check(progress.done && !why(), `tunnel: up outside the west fence, done (${why()}, zone ${bot.sim.playerZone}, step ${progress.k + 1})`);
}
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
  // Cheat walked away from (folded): the lesson says so; a shootout left behind on the court, the same.
  const cards = follow('cards');
  check(talkTo(cards.bot, cards.bot.st.inmates[0].body), 'cards: talking to Sparky');
  cards.bot.op(OP.TALK, TALK.CHEAT, 0);
  for (let k = 0; k < 40; k++) cards.bot.step(command(DIR.EAST));
  check(cards.why() === 'lesson.cards.folded', `cards: walking away from the table ends the lesson (${cards.why()})`);
  const hoops = follow('hoops');
  const c = courtOf(hoops.bot.sim)!;
  hoops.bot.walkTo(tile(c.spots[0].x, c.spots[0].z));
  shoot(hoops.bot, 0);
  check(talkTo(hoops.bot, hoops.bot.st.inmates[0].body), 'hoops: talking to Sparky');
  hoops.bot.op(OP.TALK, TALK.HOOPS);
  hoops.bot.walkTo(tile(30, 31));
  check(hoops.why() === 'lesson.hoops.off', `hoops: leaving the court ends the lesson (${hoops.why()})`);
  // The board left (up from it) until free time is over: said; resigning the set-up game: said.
  const up = follow('checkers');
  check(talkTo(up.bot, up.bot.st.inmates[0].body), 'checkers: talking to Sparky');
  up.bot.op(OP.TALK, TALK.CHECKERS, 1);
  up.bot.op(OP.TALK, TALK.CHECKERS, 0);
  up.bot.until(() => !!up.why(), 5 * 60 * 20 * 60);
  check(up.why() === 'lesson.games.closed', `checkers: up from the board until free time ends ends the lesson (${up.why()})`);
  const quit = follow('checkers');
  check(talkTo(quit.bot, quit.bot.st.inmates[0].body), 'checkers: talking to Sparky');
  quit.bot.op(OP.TALK, TALK.CHECKERS, 1);
  quit.bot.op(OP.TALK, TALK.CHECKERS, 2);
  check(quit.why() === 'lesson.checkers.resigned', `checkers: resigning ends the lesson (${quit.why()})`);
  console.log(`cards, folded: ended at step ${cards.progress.k + 1}; hoops, court left: ended at step ${hoops.progress.k + 1}; checkers, up past free time and resigned: said`);
}
{
  // P28: the race night missed (never at the track by the off), and the pet scratched (walked away with it before the off).
  const late = follow('ratRace');
  late.bot.hold('rat_track');
  late.bot.use();
  late.bot.until(() => !!late.why(), 3 * 60 * 20 * 60);
  check(late.why() === 'lesson.ratRace.late', `ratRace: not at the track by the off ends the lesson (${late.why()})`);
  const away = follow('ratRace');
  away.bot.hold('rat_track');
  away.bot.use();
  const r = TRAINING.leisure!.race;
  away.bot.walkTo(tile(r.x, r.z - 1));
  away.bot.until(() => cardUp(away.bot.sim), 2 * 60 * 20 * 60);
  away.bot.op(OP.EXT, EXT.RACE, RACE_ENTER);
  away.bot.op(OP.EXT, EXT.RACE, 0, 0);
  check(away.progress.step?.text === 'lesson.ratRace.watch', `ratRace: entered and backed, watching (${away.progress.step?.text})`);
  away.bot.walkTo(tile(20, 19));
  away.bot.until(() => !!away.why(), 60 * 20 * 60);
  check(away.why() === 'lesson.ratRace.off', `ratRace: the pet away at the off ends the lesson (${away.why()})`);
  console.log(`ratRace, late: ended at step ${late.progress.k + 1}; ratRace, scratched: ended at step ${away.progress.k + 1}`);
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

// The review's dead ends (v1.23): each now ends the lesson with a reason, or can't happen.
{
  // The fence cut while it's live (before the generator): shocked, the kit taken on waking. The lesson ends.
  const { bot, progress, why } = follow('escape');
  bot.step();
  bot.walkTo(tile(29, 51));
  bot.face(DIR.SOUTH);
  bot.until(() => !!why(), 400, () => command(0, OP.USE));
  check(why() === 'lesson.shocked', `escape: shocked by the live fence ends the lesson (${why()})`);
  console.log(`escape, shocked: ended at step ${progress.k + 1} (${why()})`);
}
{
  // Roll call missed (standing about in the cell block): the lesson ends, never waiting a day for the next one.
  const { bot, progress, why } = follow('routine');
  bot.until(() => !!why(), 3 * 60 * 20);
  check(progress.k === 1 && why() === 'lesson.routine.missed', `routine: roll call missed ends the lesson (${why()})`);
  console.log(`routine, missed: ended at step ${progress.k + 1} (${why()}) by ${bot.time}`);
}
{
  // Posted, then told to follow: no lookout left to whistle. The lesson ends.
  const { bot, progress, why } = follow('crew');
  talkTo(bot, bot.st.inmates[0].body);
  bot.op(OP.TALK, TALK.RECRUIT);
  bot.op(OP.TALK, TALK.CREW, ORDER.WATCH);
  bot.op(OP.TALK, TALK.CREW, ORDER.FOLLOW);
  bot.step();
  check(progress.k === 2 && why() === 'lesson.crew.off', `crew: called off his post ends the lesson (${why()})`);
  console.log(`crew, called off: ended at step ${progress.k + 1} (${why()})`);
}
{
  // The battery by a visitor instead of the drone: said so, not "too late".
  const { bot, progress, why } = follow('smuggle');
  bot.op(OP.EXT, EXT.ORDER, 7, WAY.VISITOR);
  bot.step();
  check(why() === 'lesson.smuggle.wrong', `smuggle: the wrong way ends the lesson, saying so (${why()})`);
  console.log(`smuggle, by visitor: ended at step ${progress.k + 1} (${why()})`);
}
{
  // Out on the road some other way (the plain east fence cut in the heat lesson): the lesson ends instead of the game standing still.
  const { bot, progress, why } = follow('heat');
  bot.step();
  check(bot.walkTo(tile(48, 40), 4000), 'heat: at the east fence');
  bot.face(DIR.EAST);
  bot.strikeUntil('light_cutters', () => bot.sim.world.ground.kind[tile(49, 40)] === TILE.FENCE_CUT);
  // (The cutters put away: the last step, nothing contraband in hand, holds; the first never happened.)
  bot.op(OP.SELECT, 1);
  bot.until(() => bot.st.escaped > 0, 600, () => command(DIR.EAST));
  check(bot.st.escaped > 0 && why() === 'lesson.outEarly', `heat: out another way ends the lesson (${why()})`);
  console.log(`heat, out the east fence: ended at step ${progress.k + 1} (${why()})`);
}
{
  // Roll call skipped at home in the cell (Lights Out's place, where the check-in comes back true): ended all the same.
  const { bot, progress, why } = follow('routine');
  bot.walkTo(tile(20, 19));
  bot.until(() => !!why(), 3 * 60 * 20);
  check(progress.k === 1 && why() === 'lesson.routine.missed', `routine: roll call skipped in the cell ends the lesson (${why()}, by ${bot.time})`);
}
{
  // The favor gone with nothing new asked (it lapsed overnight): ended, never won with nothing handed in.
  const { bot, progress, why } = follow('talk');
  talkTo(bot, bot.st.inmates[0].body);
  bot.op(OP.TALK, TALK.GIFT, bot.slotOf('chocolate'));
  bot.st.favors = [];
  bot.step();
  check(!progress.done && why() === 'lesson.talk.lapsed', `talk: the favor gone ends the lesson (${why()}, step ${progress.k + 1})`);
}
{
  // Braced on every tile from the start (every brace gone soonest): still past the fence, and up outside it.
  const { bot, progress, why } = follow('tunnel');
  tunnelDown(bot);
  const x = deskTileOf(bot) % MAP_W;
  for (const z of [16, 15, 14, 13, 12, 11]) {
    if (bot.slotOf('timber_brace') >= 0) {
      bot.hold('timber_brace');
      bot.use();
    }
    bot.face(DIR.NORTH);
    check(bot.strikeUntil('sturdy_shovel', () => bot.sim.world.layers[LAYER.UNDER].kind[tile(x, z)] !== TILE.SOIL), `tunnel, braced early: ${x},${z} dug`);
    check(bot.walkTo(tile(x, z), 400), `tunnel, braced early: along to ${x},${z}`);
  }
  check(bot.st.health > 0 && progress.k === 4, `tunnel, braced early: past the fence with no cave-in (step ${progress.k + 1}, health ${bot.st.health})`);
  digUp(bot);
  bot.until(() => progress.done, 200);
  check(progress.done && !why(), `tunnel, braced early: up outside, done (${why()}, zone ${bot.sim.playerZone})`);
}
{
  // Down a stray hole beside the desk, not under it: the first steps pass, and up outside it ends done.
  const { bot, progress, why } = follow('tunnel');
  bot.face(DIR.WEST);
  bot.hold('sturdy_shovel');
  check(bot.strikeUntil('sturdy_shovel', () => bot.sim.world.ground.kind[tile(21, 18)] === TILE.SHAFT), 'tunnel: a stray hole');
  // (Facing it from beside it: Climb down.)
  bot.act();
  check(bot.st.layer === LAYER.UNDER && progress.k === 3, `tunnel: down the stray hole, on to the dig (step ${progress.k + 1})`);
  console.log(`tunnel, down a stray hole: on at step ${progress.k + 1} (${why()})`);
}
{
  // Everything dropped at the player's feet by mistake (Q): the firecrackers lie there to pick up, the lesson goes on.
  const { bot, progress, why } = follow('noise');
  for (const k of [0, 1, 2]) bot.op(OP.DROP, k);
  bot.until(() => false, 40);
  check(progress.k === 1 && !why(), `noise: firecrackers dropped, not lost (${why()}, step ${progress.k + 1})`);
}
{
  // The warning on the last step of the disguise shows: never ticked in the same breath as the step before.
  const lesson = LESSONS.find((l) => l.id === 'disguise')!;
  const progress = new LessonProgress(lesson);
  const bot = new Bot(TRAINING, 7 + LESSONS.indexOf(lesson));
  lesson.setup(bot.sim);
  bot.op(OP.EQUIP, 0);
  const ctx: LessonCtx = { sim: bot.sim, craftOpen: false };
  progress.update(ctx);
  bot.walkTo(tile(38, 29));
  bot.until(() => bot.st.guards[0].sees, 3000);
  progress.update(ctx);
  check(progress.k === 2 && !progress.done, `disguise: the warning step comes up and waits to be read (at ${progress.k})`);
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
    // (On the roof, open roof the player can walk.)
    const layer = s.layer ?? LAYER.GROUND;
    const open = layer === LAYER.GROUND ? !bot.sim.world.propSolid[goal] && !TILE_INFO[bot.sim.world.ground.kind[goal]].solid : !bot.sim.world.routeGrid(layer)[goal];
    check(open, `${lesson.id}: the goal ${goal % MAP_W},${Math.floor(goal / MAP_W)} is open floor`);
  }
}
console.log('every lesson goal is open floor');
