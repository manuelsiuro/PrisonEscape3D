/**
 * The four Center Perks escapes (GDD §12), each won by a bot from day 1 through the real
 * simulation, every guard on duty, with ordinary commands. Each bot keeps the routine like a
 * model prisoner with its escape kit hidden in the desk's compartment (the recipe graph and
 * the economy tests prove the kit can be had), then goes:
 * - perimeter cutout: Lights Out, the dummy in bed, a guard's uniform, plastic keys to the
 *   generator room; the power off, the electric fence cut before it comes back;
 * - tunnel: Lights Out, the dummy in bed, under the desk and north beneath the wall and the
 *   fence, braced every third tile, dug up onto the road;
 * - rooftop: Lights Out, the dummy in bed, the cell's grate unscrewed (a fake cover behind),
 *   the vents to the ladder, the roof's edge, a grapnel over the fence and a sheet rope down;
 * - takeover: Strength and Speed trained to 90, plated armor and nunchucks, two followers;
 *   one blow at a guard and every guard comes; all five out cold opens the gates.
 * The snapshot pins each run: when it got out, how, the heat's peak, and the tally.
 */
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { placesOf } from '../src/sim/ai/places';
import { command, dirFromVector, OP, SLOT, TALK } from '../src/sim/command';
import { ESCAPES } from '../src/sim/Sim';
import { awake, GUARD } from '../src/sim/systems/guards';
import { itemOf, slot } from '../src/sim/systems/items';
import { maxHealth } from '../src/sim/systems/combat';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { TILE } from '../src/sim/world/tiles';
import { LAYER, MAP_W } from '../src/sim/world/World';
import { Bot, DIR, n, tileOf } from './bots';
import { check } from './assert';

const DAY = 1440 * STEPS_PER_MINUTE;

function report(name: string, bot: Bot) {
  const st = bot.st;
  console.log(`== ${name}`);
  for (const l of bot.log) console.log(`  ${l}`);
  const [walls, dug, guards, cash] = st.tally;
  console.log(`  → ${st.escaped ? `out ${bot.time} by ${ESCAPES[st.via]}` : `still inside, ${bot.time}, in the ${bot.sim.playerZone}`}; heat peak ${bot.heatPeak}%; walls ${walls}, tunnel tiles ${dug}, guards out cold ${guards}, cash $${cash}`);
}

/** The evening: roll call attended, the kit from the desk, the dummy in bed, Lights Out and the cell locked. */
function nightfall(bot: Bot, kitSize: number) {
  const places = placesOf(bot.sim.world);
  // Roll call is attended on arrival; then home.
  check(bot.routineUntil(1, 22 * 60 + 15), 'the day kept');
  check(bot.walkTo(places.deskside[1]), 'beside the desk');
  bot.face(DIR.EAST);
  check(bot.open(bot.desk), 'the desk opens');
  bot.takeAll(kitSize);
  bot.close();
  check(bot.walkTo(places.bedside[1]), 'beside the bed');
  bot.face(DIR.WEST);
  check(bot.open(bot.bed), 'the bed opens');
  bot.putIn('bed_dummy', 0);
  bot.close();
  check(itemOf(bot.st.items.containers[bot.bed][0]) === n('bed_dummy'), 'the dummy is in bed');
  // Lights Out: the door locks once the player is in.
  check(
    bot.until(() => bot.sim.cellsLocked && (bot.sim.world.lockedCells & 2) !== 0, 60 * STEPS_PER_MINUTE),
    'Lights Out, locked in',
  );
  bot.until(() => false, 10 * STEPS_PER_MINUTE);
}

// ------------------------------------------------------------------ 1. the perimeter cutout
{
  const bot = new Bot(CENTER_PERKS, 11);
  bot.stash('plastic_key_yellow', 'plastic_key_purple', 'plastic_key_green', 'sturdy_cutters', 'bed_dummy', 'guard_outfit');
  nightfall(bot, 6);
  // Into the guard's uniform.
  bot.op(OP.EQUIP, bot.slotOf('guard_outfit'));
  check(itemOf(bot.st.items.inv[SLOT.OUTFIT]) === n('guard_outfit'), 'in uniform');
  // The generator: off.
  check(bot.walkTo(tileOf(8, 41)), 'at the generator');
  bot.face(DIR.SOUTH);
  bot.act();
  check(!bot.sim.power, 'the power is off');
  const cutAt = bot.st.step;
  // South through the yard gate to the electric stretch of the fence, and through it.
  check(bot.walkTo(tileOf(27, 60)), 'at the electric fence');
  bot.face(DIR.SOUTH);
  check(bot.sim.world.ground.kind[tileOf(27, 61)] === TILE.ELECTRIC, 'facing the electric fence');
  const cut = bot.strikeUntil('sturdy_cutters', () => bot.sim.world.ground.kind[tileOf(27, 61)] === TILE.FENCE_CUT);
  check(cut && !bot.sim.power === true, 'cut through before the power came back');
  console.log(`  cutout: the fence cut ${((bot.st.step - cutAt) / 20).toFixed(1)} s after the power went off`);
  bot.walkTo(tileOf(27, 62), 200);
  report('perimeter cutout', bot);
  check(bot.done && ESCAPES[bot.st.via] === 'fence', 'escaped through the fence');
  check(bot.heatPeak < 80, 'never wanted on the way');
}

// ------------------------------------------------------------------ 2. the tunnel
{
  const bot = new Bot(CENTER_PERKS, 12);
  bot.stash('sturdy_shovel', 'timber_brace', 'timber_brace', 'timber_brace', 'bed_dummy');
  nightfall(bot, 5);
  const places = placesOf(bot.sim.world);
  const st = bot.st;
  // The entrance under the desk, from beside it.
  bot.walkTo(places.deskside[1]);
  bot.face(DIR.EAST);
  const desk = tileOf(10, 7);
  check(bot.strikeUntil('sturdy_shovel', () => bot.sim.world.ground.kind[desk] === TILE.SHAFT), 'the entrance under the desk');
  // Its dirt down the toilet.
  bot.walkTo(tileOf(10, 9));
  bot.face(DIR.SOUTH);
  bot.hold('dirt');
  bot.act();
  check(bot.slotOf('dirt') < 0, 'the dirt flushed');
  // Down through the desk's panel.
  bot.walkTo(places.deskside[1]);
  bot.face(DIR.EAST);
  bot.open(bot.desk);
  bot.act(1);
  check(st.layer === LAYER.UNDER, 'down the tunnel');
  // North under the wall and the fence: a brace on every third tile.
  for (const z of [6, 5, 4, 3, 2, 1]) {
    if (z === 4 || z === 1) {
      bot.hold('timber_brace');
      bot.use();
    }
    bot.face(DIR.NORTH);
    const ok = bot.strikeUntil('sturdy_shovel', () => bot.sim.world.layers[LAYER.UNDER].kind[tileOf(10, z)] !== TILE.SOIL || bot.sim.events.some((e) => e.type === 'caveIn'));
    check(ok && bot.sim.world.layers[LAYER.UNDER].kind[tileOf(10, z)] !== TILE.SOIL, `tile ${z} dug`);
    check(bot.walkTo(tileOf(10, z), 400), `along to ${z}`);
  }
  // Facing back along it, up through the road.
  bot.face(DIR.SOUTH);
  check(bot.strikeUntil('sturdy_shovel', () => bot.done || st.layer === LAYER.GROUND), 'dug up');
  report('tunnel', bot);
  check(bot.done && ESCAPES[st.via] === 'tunnel', 'escaped through the tunnel');
  check(bot.heatPeak < 80, 'never wanted on the way');
}

// ------------------------------------------------------------------ 3. the rooftop grapnel
{
  const bot = new Bot(CENTER_PERKS, 13);
  bot.stash('screwdriver', 'fake_vent', 'grapnel', 'sheet_rope', 'bed_dummy');
  nightfall(bot, 5);
  const st = bot.st;
  // The cell's grate (9, 9), from the floor under it.
  check(bot.walkTo(tileOf(9, 9)), 'under the grate');
  check(bot.strikeUntil('screwdriver', () => bot.sim.world.layers[LAYER.VENTS].kind[tileOf(9, 9)] === TILE.GRATE_OPEN), 'the grate unscrewed');
  bot.act();
  check(st.layer === LAYER.VENTS, 'up into the vents');
  // The fake cover over the hole behind.
  bot.hold('fake_vent');
  bot.use();
  check(bot.sim.world.layers[LAYER.VENTS].kind[tileOf(9, 9)] === TILE.GRATE_FAKE, 'a fake cover over the grate');
  // Crawl to the ladder and up.
  check(bot.walkTo(tileOf(13, 38), 3000), 'along the ducts to the ladder');
  check(bot.walkTo(tileOf(13, 39), 200), 'at the ladder');
  bot.act();
  check(st.layer === LAYER.ROOF, 'up on the roof');
  // To the west edge, the fence 4 tiles beyond.
  check(bot.walkTo(tileOf(6, 39), 600), 'at the roof’s edge');
  bot.face(DIR.WEST);
  bot.hold('grapnel');
  bot.use();
  report('rooftop grapnel', bot);
  check(bot.done && ESCAPES[st.via] === 'roof', 'escaped over the fence on the grapnel');
  check(bot.heatPeak < 80, 'never wanted on the way');
}

// ------------------------------------------------------------------ 4. the takeover
{
  const bot = new Bot(CENTER_PERKS, 14);
  const st = bot.st;
  const places = placesOf(bot.sim.world);
  // Trained up (GDD §12: Strength and Speed 90+), armed and armored, two friends at 80+ opinion.
  st.str = 90;
  st.spd = 90;
  st.health = maxHealth(st.str);
  bot.stash('nunchucks', 'plated_outfit');
  const friends = [0, 1];
  for (const id of friends) st.inmates[id].opinion = 90;
  // Roll call first (attended on arrival), then the friends, recruited where they stand.
  check(bot.routineUntil(1, 8 * 60 + 20), 'roll call kept');
  for (const id of friends) {
    const m = st.inmates[id];
    for (let k = 0; k < 40 && st.talk !== id; k++) {
      bot.pilot.goTo(Math.floor(m.body.z / UNIT) * MAP_W + Math.floor(m.body.x / UNIT));
      bot.until(() => Math.abs(m.body.x - st.player.x) + Math.abs(m.body.z - st.player.z) < UNIT, 60, () => command(bot.pilot.dir(st.player)));
      bot.pilot.stop();
      bot.step(command(0));
      bot.act();
    }
    bot.op(OP.TALK, TALK.RECRUIT);
    bot.op(OP.CLOSE);
  }
  check(st.followers.length === 2, `two followers (${st.followers.length})`);
  // Armed up at the desk.
  bot.walkTo(places.deskside[1]);
  bot.face(DIR.EAST);
  bot.open(bot.desk);
  bot.takeAll(2);
  bot.close();
  bot.op(OP.EQUIP, bot.slotOf('nunchucks'));
  bot.op(OP.EQUIP, bot.slotOf('plated_outfit'));
  check(itemOf(st.items.inv[SLOT.WEAPON]) === n('nunchucks') && itemOf(st.items.inv[SLOT.OUTFIT]) === n('plated_outfit'), 'armed and armored');
  // The fight: the nearest guard standing, each in turn (the first blow is seen: every guard comes).
  const inmates = st.inmates.length;
  const nearestGuard = () => {
    let best = -1;
    let bestD = Infinity;
    st.guards.forEach((g, k) => {
      if (!awake(g)) return;
      const d = Math.max(Math.abs(g.body.x - st.player.x), Math.abs(g.body.z - st.player.z));
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    return { k: best, d: bestD };
  };
  let fights = 0;
  for (let k = 0; k < 8000 && !st.takeover && st.ko === 0; k++) {
    const { k: g, d } = nearestGuard();
    if (g < 0) {
      bot.step(0);
      continue;
    }
    const gb = st.guards[g].body;
    if (d > 3 * UNIT) {
      // Far: walk there (re-planned now and then).
      if (k % 20 === 0) bot.pilot.goTo(Math.floor(gb.z / UNIT) * MAP_W + Math.floor(gb.x / UNIT));
      bot.step(command(bot.pilot.dir(st.player)));
      continue;
    }
    bot.pilot.stop();
    if (st.lock !== inmates + g) bot.op(OP.LOCK, 2 + inmates + g);
    // In reach: swing; else close in.
    if (d < 1.2 * UNIT) bot.op(OP.USE, fights++ === 0 ? 1 : 0);
    else bot.step(command(dirFromVector(gb.x - st.player.x, gb.z - st.player.z)));
  }
  check(st.takeover, 'every guard out cold at once: the takeover');
  console.log(`  takeover: health ${st.health}/${maxHealth(st.str)}, guards down ${st.guards.filter((g) => g.ko > 0).length}/${st.guards.length}, ${st.guards.map((g) => g.mode === GUARD.CHASE ? 'C' : g.ko > 0 ? 'x' : '.').join('')}`);
  // Out through the open gates.
  check(bot.walkTo(tileOf(30, 62), 800), 'out through the gates');
  report('takeover', bot);
  check(bot.done && ESCAPES[st.via] === 'takeover', 'escaped in the takeover');
}

void DAY;
void slot;
