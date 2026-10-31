/**
 * Living in the prison (GDD §2, §3.1): sitting on seats, benches and chairs (energy back),
 * a meal eaten seated at a canteen table (+35, once a meal), showers that pick the player up
 * while they run, resting on an infirmary bed, getting up, a desk still searched from beside
 * its chair, inmates sitting and reading in free time, a save made seated.
 */
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { ROUTINE } from '../src/content/routine';
import { placesOf } from '../src/sim/ai/places';
import { Sim, type Snapshot } from '../src/sim/Sim';
import { DOING } from '../src/sim/systems/inmates';
import { MEAL_ENERGY, MEAL_STEPS, UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { Bot, DIR } from './bots';
import { check } from './assert';

const at = (bot: Bot, tile: number, facing: number) => {
  bot.st.player.x = (tile % MAP_W) * UNIT + UNIT / 2;
  bot.st.player.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
  bot.st.player.facing = facing;
};
const propAt = (sim: Sim, kind: string, test: (p: { x: number; z: number }) => boolean = () => true) => sim.world.props.findIndex((p) => p.kind === kind && test(p));

// ------------------------------------------------------------------ a meal
{
  const bot = new Bot(CENTER_PERKS, 3);
  check(bot.routineUntil(1, 9 * 60 + 25), 'breakfast');
  check(ROUTINE[bot.st.routine].id === 'breakfast' && bot.sim.playerZone === 'canteen', 'in the canteen for breakfast');
  // A seat nobody is heading for, the player on it facing the table.
  const places = placesOf(bot.sim.world);
  const spot = places.seats.find((s) => !bot.st.inmates.some((m) => m.goal === s.tile))!;
  at(bot, spot.tile, spot.face);
  bot.st.energy = 40;
  bot.act();
  const seat = bot.st.seat;
  check(seat >= 0 && bot.sim.world.props[seat].kind === 'seat', 'sat down on the canteen bench');
  check(bot.st.player.facing === spot.face, 'facing the table');
  const before = bot.st.energy;
  bot.until(() => bot.st.eaten >= MEAL_STEPS, MEAL_STEPS + 2);
  const meal = bot.st.energy - before;
  // The tray, plus what sitting (and the usual slow regain) gives meanwhile.
  check(meal >= MEAL_ENERGY + 4 && meal <= MEAL_ENERGY + 7, `the tray eaten: +${meal} energy`);
  const fed = bot.st.energy;
  bot.until(() => false, 130);
  const rest = bot.st.energy - fed;
  check(rest >= 12 && rest <= 14, `sitting on: +${rest} in 130 steps (1.5 a second on top of the usual), no second meal`);
  // Saved and loaded seated: still seated, the meal still eaten.
  const back = new Sim(CENTER_PERKS, 9);
  back.restore(JSON.parse(JSON.stringify(bot.sim.snapshot())) as Snapshot);
  check(back.state.seat === seat && back.state.eaten === MEAL_STEPS, 'a save made seated loads seated');
  // A step gets the player up.
  bot.step(DIR.NORTH === spot.face ? 5 : 13);
  check(bot.st.seat === -1, 'a step gets the player up');
  console.log(`meal: +${meal} at the table, +${rest} seated for 130 steps`);
}

// ------------------------------------------------------------------ a meal needs a meal, the action button gets up
{
  const bot = new Bot(CENTER_PERKS, 4);
  check(bot.routineUntil(1, 10 * 60 + 30), 'free time');
  const spot = placesOf(bot.sim.world).seats[0];
  at(bot, spot.tile, spot.face);
  bot.st.energy = 40;
  bot.act();
  check(bot.st.seat >= 0, 'sat down in free time');
  bot.until(() => false, MEAL_STEPS + 5);
  check(bot.st.eaten === 0 && bot.st.energy < 40 + 10, 'no tray outside a meal');
  bot.act();
  check(bot.st.seat === -1, 'the action button gets the player up');
}

// ------------------------------------------------------------------ showers, a bench, the infirmary
{
  const bot = new Bot(CENTER_PERKS, 5);
  check(bot.routineUntil(1, 16 * 60 + 5), 'the showers block');
  // Every head may be someone's: the player squeezes in under the first.
  const head = placesOf(bot.sim.world).showers[0];
  at(bot, head.tile, head.face);
  bot.st.energy = 30;
  bot.until(() => false, 100);
  const gain = bot.st.energy - 30;
  check(gain >= 11 && gain <= 14, `showering: +${gain} in 100 steps (2 a second on top of the usual)`);
  check(bot.sim.showering, 'the view shows them showering');
  console.log(`shower: +${gain} in 5 s`);
}
{
  const bot = new Bot(CENTER_PERKS, 6);
  check(bot.routineUntil(1, 10 * 60 + 30), 'free time again');
  // A yard bench: face it from the tile in front.
  const bench = propAt(bot.sim, 'bench');
  const b = bot.sim.world.props[bench];
  at(bot, (b.z + 1) * MAP_W + b.x, DIR.NORTH);
  bot.st.energy = 50;
  bot.act();
  check(bot.st.seat === bench, 'sat on a yard bench');
  bot.until(() => false, 130);
  check(bot.st.energy >= 59, 'resting on the bench');
  bot.step(DIR.SOUTH);
  // An infirmary bed: lie down, energy and health back faster.
  const bed = propAt(bot.sim, 'bed', (p) => bot.sim.world.zoneAt(p.x, p.z) === 'infirmary');
  const p = bot.sim.world.props[bed];
  at(bot, (p.z + p.d) * MAP_W + p.x, DIR.NORTH);
  bot.st.energy = 50;
  bot.st.health = 60;
  bot.act();
  check(bot.st.seat === bed, 'lying on an infirmary bed');
  bot.until(() => false, 1200);
  // A minute: about 1.5 energy a second (up to full) and health at the sleeping pace (two a minute).
  check(bot.st.energy === 100 && bot.st.health >= 60 + 2, `resting: energy ${bot.st.energy}, health ${bot.st.health}`);
  // Carried away (a teleport, as when caught): up at once.
  at(bot, placesOf(bot.sim.world).bedside[1], DIR.NORTH);
  bot.step();
  check(bot.st.seat === -1, 'out of reach of the bed: up');
}

// ------------------------------------------------------------------ the desk beside its chair
{
  const bot = new Bot(CENTER_PERKS, 7);
  const places = placesOf(bot.sim.world);
  check(bot.walkTo(places.deskside[1]), 'beside the desk');
  bot.face(DIR.EAST);
  check(bot.open(bot.desk), 'the desk opens from beside its chair (the chair gives way)');
  bot.close();
  // Facing the chair from the south: it's the chair.
  const chair = propAt(bot.sim, 'chair', (p) => bot.sim.world.cellOf[p.z * MAP_W + p.x] === 1);
  const c = bot.sim.world.props[chair];
  at(bot, (c.z + 1) * MAP_W + c.x, DIR.NORTH);
  bot.act();
  check(bot.st.seat === chair, 'the cell chair: sat on, facing it');
  check(bot.st.player.facing === DIR.EAST, 'facing the desk');
}

// ------------------------------------------------------------------ inmates in free time
{
  const bot = new Bot(CENTER_PERKS, 8);
  let sitting = 0;
  let reading = 0;
  bot.keepRoutine(() => {
    for (const m of bot.st.inmates) {
      if (m.doing === DOING.SIT) sitting++;
      if (m.doing === DOING.SIT_READ) reading++;
    }
    return bot.st.step > 20 * 60 * 8;
  }, 20 * 60 * 9);
  check(sitting > 0 && reading > 0, 'inmates sit and read in free time');
  console.log(`free time, day 1: inmate-steps sitting ${sitting}, reading ${reading}`);
}

// ------------------------------------------------------------------ a taken seat, a lockdown, a tool, a knockout
{
  const bot = new Bot(CENTER_PERKS, 7);
  check(bot.routineUntil(1, 10 * 60 + 30), 'free time for the edge cases');
  const spot = placesOf(bot.sim.world).seats[0];
  // Someone on the way to sit there: the player stays up, and is told so.
  const m = bot.st.inmates[0];
  m.goal = spot.tile;
  m.path = [];
  m.wait = 1000;
  at(bot, spot.tile, spot.face);
  bot.act();
  check(bot.st.seat === -1 && bot.sim.events.some((e) => e.type === 'refused' && e.why === 'seatTaken'), 'a seat someone holds is refused');
  // A follower's old goal doesn't hold the seat (they're off after the player, not sitting).
  m.plan = -1;
  bot.act();
  check(bot.st.seat >= 0, 'a follower heading nowhere near does not hold the seat');
  bot.act();
  m.goal = -1;
  m.wait = 0;
  // Free again: sit; a lockdown gets the player up.
  at(bot, spot.tile, spot.face);
  bot.act();
  check(bot.st.seat >= 0, 'sat down once the seat is free');
  bot.st.lockdown = true;
  bot.step();
  check(bot.st.seat === -1, 'a lockdown gets the player up');
  bot.st.lockdown = false;
  // The tool button gets the player up too (no strikes from a seat).
  at(bot, spot.tile, spot.face);
  bot.act();
  bot.use();
  check(bot.st.seat === -1, 'the tool button gets the player up');
}
{
  const bot = new Bot(CENTER_PERKS, 8);
  check(bot.routineUntil(1, 16 * 60 + 5), 'the showers block again');
  const head = placesOf(bot.sim.world).showers[0];
  at(bot, head.tile, head.face);
  bot.st.energy = 30;
  bot.st.ko = 400;
  bot.until(() => false, 100);
  // (A shower gives 10 more in that time.)
  check(bot.st.energy - 30 <= 4 && !bot.sim.showering, `out cold under a shower: no shower (+${bot.st.energy - 30})`);
}
{
  // Someone sitting on a yard bench: facing them is a talk, not a seat.
  const bot = new Bot(CENTER_PERKS, 10);
  check(bot.routineUntil(1, 10 * 60 + 30), 'free time for a talk');
  const bench = bot.sim.world.props[propAt(bot.sim, 'bench')];
  const m = bot.st.inmates[0];
  m.body.x = bench.x * UNIT + UNIT / 2;
  m.body.z = bench.z * UNIT + UNIT / 2;
  m.goal = bench.z * MAP_W + bench.x;
  m.path = [];
  m.wait = 1000;
  at(bot, (bench.z + 1) * MAP_W + bench.x, DIR.NORTH);
  bot.act();
  check(bot.st.talk === 0 && bot.st.seat === -1, 'facing someone on a bench: a talk');
}
{
  // Someone eating at the canteen, the player behind the free seat beside them: facing them
  // (at 45°) is a talk; facing the free seat is still a seat.
  const bot = new Bot(CENTER_PERKS, 3);
  check(bot.routineUntil(1, 9 * 60 + 25), 'breakfast for a talk at the table');
  const w = bot.sim.world;
  const seats = placesOf(w).seats;
  // A seat facing south (the table below it), its east neighbour a seat too, the tile behind that free floor.
  const s = seats.find((q) => q.face === DIR.SOUTH && seats.some((r) => r.tile === q.tile + 1) && !w.blocked((q.tile + 1) % MAP_W, Math.floor(q.tile / MAP_W) - 1))!;
  const m = bot.st.inmates[0];
  m.body.x = (s.tile % MAP_W) * UNIT + UNIT / 2;
  m.body.z = Math.floor(s.tile / MAP_W) * UNIT + UNIT / 2;
  m.goal = s.tile;
  m.path = [];
  m.wait = 1000;
  const behind = s.tile + 1 - MAP_W;
  // South-west (between south, 5, and west, 9), standing off the tile's middle to the east as
  // a stick leaves the player: the tile three quarters ahead is the free seat, not theirs.
  at(bot, behind, 7);
  bot.st.player.x += Math.round(UNIT * 0.3);
  bot.act();
  check(bot.st.talk === 0 && bot.st.seat === -1, 'facing someone seated at 45°: a talk, not the free seat beside them');
  bot.close();
  at(bot, behind, DIR.SOUTH);
  bot.act();
  check(bot.st.seat >= 0 && bot.st.talk === -1, 'facing the free seat beside them: a seat');
}
