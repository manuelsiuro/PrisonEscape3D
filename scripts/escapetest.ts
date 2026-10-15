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
import { STALAG_FLUCHT } from '../src/content/prisons/stalag-flucht';
import type { PrisonDef } from '../src/content/prisons/types';
import { placesOf } from '../src/sim/ai/places';
import { command, dirFromVector, OP, SLOT, TALK } from '../src/sim/command';
import { ESCAPES } from '../src/sim/Sim';
import { awake, GUARD } from '../src/sim/systems/guards';
import { itemOf, slot } from '../src/sim/systems/items';
import { maxHealth } from '../src/sim/systems/combat';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { TILE } from '../src/sim/world/tiles';
import { LAYER, MAP_W } from '../src/sim/world/World';
import { Bot, DIR, n, resumes, tileOf } from './bots';
import { check } from './assert';

const DAY = 1440 * STEPS_PER_MINUTE;

function report(name: string, bot: Bot) {
  const st = bot.st;
  console.log(`== ${name}`);
  for (const l of bot.log) console.log(`  ${l}`);
  const [walls, dug, guards, cash] = st.tally;
  // Saved and loaded at four points of the run (the last two in the escape itself), the game ends the same.
  const at = resumes(bot, [0.5, 0.9, 0.98, 0.995]);
  console.log(`  saved and loaded at ${at.join(', ')}`);
  check(at.every((a) => a.endsWith('resumes')), `${name}: a game saved and loaded plays on exactly as before`);
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
    bot.until(() => bot.sim.cellsLocked && (bot.sim.world.lockedCells & 2n) !== 0n, 60 * STEPS_PER_MINUTE),
    'Lights Out, locked in',
  );
  bot.until(() => false, 10 * STEPS_PER_MINUTE);
}

/** Where each route goes in a prison: tiles as [x, z], with a facing where it matters. */
interface Plan {
  def: PrisonDef;
  /** The first bot's seed (the others take the next three). */
  seed: number;
  name: (route: string) => string;
  /** Cutout: the keys from the cell to the generator, where to stand at it, the fence tile to cut from and which way. */
  keys: string[];
  generator: [number, number];
  generatorFace: number;
  fence: [number, number, number];
  /** Tunnel: the desk, the tile above the toilet, the tunnel's tiles in order with the way each is dug. */
  desk: [number, number];
  toilet: [number, number];
  dig: Array<[number, number, number]>;
  /** Rooftop: the cell's grate (none: the ladder is reached on foot, the power off first), the ladder, the roof's edge and which way the fence is. */
  grate?: [number, number];
  ladder: [number, number];
  edge: [number, number, number];
  /** Takeover: where to wait for the first guard (out of the snipers' range), a tile outside the open gates. */
  rally?: [number, number];
  gates: [number, number];
  /** Strength and Speed trained to (default 90, GDD §12: 90+), and whether to recruit the two strongest inmates. */
  trained?: number;
  strongest?: boolean;
}

const PLANS: Plan[] = [
  {
    def: CENTER_PERKS,
    seed: 11,
    name: (r) => r,
    keys: ['plastic_key_yellow', 'plastic_key_purple', 'plastic_key_green'],
    generator: [8, 41],
    generatorFace: DIR.SOUTH,
    fence: [27, 60, DIR.SOUTH],
    desk: [10, 7],
    toilet: [10, 9],
    dig: [6, 5, 4, 3, 2, 1].map((z) => [10, z, DIR.NORTH]),
    grate: [9, 9],
    ladder: [13, 39],
    edge: [6, 39, DIR.WEST],
    gates: [30, 62],
  },
  // Stalag Flucht (GDD §4.2): the generator is in the guards' compound past the inner gate,
  // the whole wire is live; the tunnel bends round the boulders north of cabin A; the cabin's
  // roof is a grapnel's throw from the north wire.
  {
    def: STALAG_FLUCHT,
    seed: 21,
    name: (r) => `${STALAG_FLUCHT.id}: ${r}`,
    keys: ['plastic_key_yellow', 'plastic_key_purple'],
    generator: [54, 26],
    generatorFace: DIR.NORTH,
    fence: [60, 30, DIR.EAST],
    desk: [8, 7],
    toilet: [8, 9],
    dig: [
      [8, 6, DIR.NORTH],
      [9, 6, DIR.EAST],
      [10, 6, DIR.EAST],
      [10, 5, DIR.NORTH],
      [10, 4, DIR.NORTH],
      [10, 3, DIR.NORTH],
      [10, 2, DIR.NORTH],
      [10, 1, DIR.NORTH],
    ],
    ladder: [57, 23],
    edge: [58, 24, DIR.EAST],
    rally: [21, 32],
    trained: 100,
    strongest: true,
    gates: [20, 62],
  },
];

// ------------------------------------------------------------------ 1. the perimeter cutout
function cutout(p: Plan) {
  const bot = new Bot(p.def, p.seed);
  bot.stash(...p.keys, 'sturdy_cutters', 'bed_dummy', 'guard_outfit');
  nightfall(bot, p.keys.length + 3);
  // Into the guard's uniform.
  bot.op(OP.EQUIP, bot.slotOf('guard_outfit'));
  check(itemOf(bot.st.items.inv[SLOT.OUTFIT]) === n('guard_outfit'), 'in uniform');
  // The generator: off.
  check(bot.walkTo(tileOf(...p.generator)), 'at the generator');
  bot.face(p.generatorFace);
  bot.act();
  check(!bot.sim.power, 'the power is off');
  const cutAt = bot.st.step;
  // To the electric stretch of the fence, and through it.
  const [fx, fz, face] = p.fence;
  check(bot.walkTo(tileOf(fx, fz)), 'at the electric fence');
  bot.face(face);
  const wire = tileOf(fx + (face === DIR.EAST ? 1 : 0), fz + (face === DIR.SOUTH ? 1 : 0));
  check(bot.sim.world.ground.kind[wire] === TILE.ELECTRIC, 'facing the electric fence');
  const cut = bot.strikeUntil('sturdy_cutters', () => bot.sim.world.ground.kind[wire] === TILE.FENCE_CUT);
  check(cut && !bot.sim.power === true, 'cut through before the power came back');
  console.log(`  cutout: the fence cut ${((bot.st.step - cutAt) / 20).toFixed(1)} s after the power went off`);
  bot.walkTo(tileOf(fx + (face === DIR.EAST ? 2 : 0), fz + (face === DIR.SOUTH ? 2 : 0)), 200);
  report(p.name('perimeter cutout'), bot);
  check(bot.done && ESCAPES[bot.st.via] === 'fence', 'escaped through the fence');
  check(bot.heatPeak < 80, 'never wanted on the way');
}

// ------------------------------------------------------------------ 2. the tunnel
function tunnel(p: Plan) {
  const bot = new Bot(p.def, p.seed + 1);
  bot.stash('sturdy_shovel', 'timber_brace', 'timber_brace', 'timber_brace', 'bed_dummy');
  nightfall(bot, 5);
  const places = placesOf(bot.sim.world);
  const st = bot.st;
  // The entrance under the desk, from beside it.
  bot.walkTo(places.deskside[1]);
  bot.face(DIR.EAST);
  const desk = tileOf(...p.desk);
  check(bot.strikeUntil('sturdy_shovel', () => bot.sim.world.ground.kind[desk] === TILE.SHAFT), 'the entrance under the desk');
  // Its dirt down the toilet.
  bot.walkTo(tileOf(...p.toilet));
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
  // Under the wall and the fence (round the boulders): a brace on every third tile.
  p.dig.forEach(([x, z, face], k) => {
    if (k % 3 === 2) {
      bot.hold('timber_brace');
      bot.use();
    }
    bot.face(face);
    const ok = bot.strikeUntil('sturdy_shovel', () => bot.sim.world.layers[LAYER.UNDER].kind[tileOf(x, z)] !== TILE.SOIL || bot.sim.events.some((e) => e.type === 'caveIn'));
    check(ok && bot.sim.world.layers[LAYER.UNDER].kind[tileOf(x, z)] !== TILE.SOIL, `tile ${p.def === CENTER_PERKS ? z : `${x},${z}`} dug`);
    check(bot.walkTo(tileOf(x, z), 400), `along to ${p.def === CENTER_PERKS ? z : `${x},${z}`}`);
  });
  // Facing back along it, up through the road.
  bot.face(DIR.SOUTH);
  check(bot.strikeUntil('sturdy_shovel', () => bot.done || st.layer === LAYER.GROUND), 'dug up');
  report(p.name('tunnel'), bot);
  check(bot.done && ESCAPES[st.via] === 'tunnel', 'escaped through the tunnel');
  check(bot.heatPeak < 80, 'never wanted on the way');
}

// ------------------------------------------------------------------ 3. the rooftop grapnel
function rooftop(p: Plan) {
  const bot = new Bot(p.def, p.seed + 2);
  if (!p.grate) return generatorRoof(p, bot);
  bot.stash('screwdriver', 'fake_vent', 'grapnel', 'sheet_rope', 'bed_dummy');
  nightfall(bot, 5);
  const st = bot.st;
  // The cell's grate, from the floor under it.
  const grate = tileOf(...p.grate);
  check(bot.walkTo(grate), 'under the grate');
  check(bot.strikeUntil('screwdriver', () => bot.sim.world.layers[LAYER.VENTS].kind[grate] === TILE.GRATE_OPEN), 'the grate unscrewed');
  bot.act();
  check(st.layer === LAYER.VENTS, 'up into the vents');
  // The fake cover over the hole behind.
  bot.hold('fake_vent');
  bot.use();
  check(bot.sim.world.layers[LAYER.VENTS].kind[grate] === TILE.GRATE_FAKE, 'a fake cover over the grate');
  // Crawl to the ladder and up.
  const [lx, lz] = p.ladder;
  check(bot.walkTo(tileOf(lx, lz - 1), 3000), 'along the ducts to the ladder');
  check(bot.walkTo(tileOf(lx, lz), 200), 'at the ladder');
  bot.act();
  check(st.layer === LAYER.ROOF, 'up on the roof');
  overTheWire(p, bot);
}

/** From the roof: to its edge, the fence a few tiles beyond, and over on the grapnel. */
function overTheWire(p: Plan, bot: Bot) {
  check(bot.walkTo(tileOf(p.edge[0], p.edge[1]), 600), 'at the roof’s edge');
  bot.face(p.edge[2]);
  bot.hold('grapnel');
  bot.use();
  report(p.name('rooftop grapnel'), bot);
  check(bot.done && ESCAPES[bot.st.via] === 'roof', 'escaped over the fence on the grapnel');
  check(bot.heatPeak < 80, 'never wanted on the way');
}

/**
 * The roof where the whole wire is live (Stalag Flucht): Lights Out, the dummy in bed, a
 * guard's uniform and keys to the generator hut; the power off, up its ladder, and over the
 * dead wire on the grapnel before it comes back.
 */
function generatorRoof(p: Plan, bot: Bot) {
  bot.stash(...p.keys, 'grapnel', 'sheet_rope', 'bed_dummy', 'guard_outfit');
  nightfall(bot, p.keys.length + 4);
  bot.op(OP.EQUIP, bot.slotOf('guard_outfit'));
  check(bot.walkTo(tileOf(...p.generator)), 'at the generator');
  bot.face(p.generatorFace);
  bot.act();
  check(!bot.sim.power, 'the power is off');
  const [lx, lz] = p.ladder;
  check(bot.walkTo(tileOf(lx, lz + 1), 400), 'at the ladder');
  bot.face(DIR.NORTH);
  bot.act();
  check(bot.st.layer === LAYER.ROOF, 'up on the roof');
  overTheWire(p, bot);
  check(!bot.sim.power, 'over before the power came back');
}

// ------------------------------------------------------------------ 4. the takeover
function takeover(p: Plan) {
  const bot = new Bot(p.def, p.seed + 3);
  const st = bot.st;
  const places = placesOf(bot.sim.world);
  // Trained up (GDD §12: Strength and Speed 90+), armed and armored, two friends at 80+ opinion.
  st.str = p.trained ?? 90;
  st.spd = p.trained ?? 90;
  st.health = maxHealth(st.str);
  bot.stash('nunchucks', 'plated_outfit');
  // Two friends: the first two inmates, or the two strongest (GDD §12: allies that can fight).
  const friends = p.strongest ? st.inmates.map((m, i) => ({ i, str: m.str })).sort((a, b) => b.str - a.str || a.i - b.i).slice(0, 2).map((f) => f.i) : [0, 1];
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
  // Somewhere out of the towers' reach, near the gates, for the first guard to come by.
  if (p.rally) {
    check(bot.walkTo(tileOf(...p.rally), 2000), 'at the rally point');
    check(bot.until(() => st.guards.some((g) => awake(g) && Math.max(Math.abs(g.body.x - st.player.x), Math.abs(g.body.z - st.player.z)) < 3 * UNIT), 40 * STEPS_PER_MINUTE), 'a guard comes by');
  }
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
  check(bot.walkTo(tileOf(...p.gates), 800), 'out through the gates');
  report(p.name('takeover'), bot);
  check(bot.done && ESCAPES[st.via] === 'takeover', 'escaped in the takeover');
}


for (const p of PLANS) {
  if (p.def !== CENTER_PERKS) console.log(`== ${p.def.id}`);
  cutout(p);
  tunnel(p);
  rooftop(p);
  takeover(p);
}

void DAY;
void slot;
