/**
 * HMP Irongate's own rules (P12, GDD §4.5), on its map and through the real simulation:
 * - an island: the sea all round, the outer wall and its towers, no road but the ferry
 *   landing, which only the drawbridge reaches; no tunnel from the island gets anywhere
 *   without passing under the sea;
 * - a tunnel dug under the sea floods at once: the whole tunnel lost (its entrance too), the
 *   player washed out cold and carried to the infirmary;
 * - two generators: GEN-1 the detector arches and the cameras, GEN-2 the dock's electric
 *   fence, the searchlights and the lamps; each off on its own, each back after 45 s;
 * - the raft: launched off the end of the pier (and nowhere else), away over the sea;
 * - the drawbridge: water until a takeover lowers it, then the way to the ferry landing;
 * - the roofs: from the north block's, a grapnel swings across the yard (the chasm) onto the
 *   roofs south of it, the sheet rope kept, and down it into the helipad court;
 * - the helicopter: on its pad at night only, and it takes nobody while a helipad guard is
 *   up and about, nor anyone out of a guard's uniform;
 * - riot guards: stronger, and their plates take the edge off every blow.
 * Its jobs and its three escapes are proven by the generic suites (economytest, escapetest).
 */
import { IRONGATE } from '../src/content/prisons/irongate';
import { ZONES } from '../src/content/zones';
import { OP, SLOT } from '../src/sim/command';
import { ESCAPES, WAKE } from '../src/sim/state';
import { damage, GUARD_DEFENSE, guardDefense, maxHealth } from '../src/sim/systems/combat';
import { cameraSeesPlayer, genFor, generatorsOf, powered } from '../src/sim/systems/power';
import { helicopterIn } from '../src/sim/systems/sea';
import { toolTarget } from '../src/sim/systems/structure';
import { slot } from '../src/sim/systems/items';
import { GUARD_STR, KO_STEPS, POWER_OFF_STEPS, RIOT_DEFENSE, RIOT_STR, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { isSea, isTunnel, TILE, TILE_INFO } from '../src/sim/world/tiles';
import { LAYER, MAP_H, MAP_W } from '../src/sim/world/World';
import { Bot, DIR, n, tileOf } from './bots';
import { check } from './assert';

const place = (bot: Bot, x: number, z: number, layer: number = LAYER.GROUND) => {
  bot.st.player.x = x * UNIT + UNIT / 2;
  bot.st.player.z = z * UNIT + UNIT / 2;
  bot.st.layer = layer;
};
const give = (bot: Bot, ...ids: string[]) => {
  ids.forEach((id, k) => (bot.st.items.inv[k] = slot(n(id))));
  bot.st.items.rev++;
};
const zoneAt = (bot: Bot, i: number) => ZONES[bot.sim.world.ground.zone[i]];
/** The hour of day 1 (or the next day's, past midnight): run the clock there, the player standing still. */
const runTo = (bot: Bot, minute: number) => bot.until(() => Math.floor(bot.st.step / STEPS_PER_MINUTE) % 1440 === minute % 1440, 1440 * STEPS_PER_MINUTE);

// ------------------------------------------------------------------ the island
{
  const bot = new Bot(IRONGATE, 1);
  const w = bot.sim.world;
  const g = w.ground;
  let edge = 0;
  for (let k = 0; k < MAP_W; k++) for (const i of [tileOf(k, 0), tileOf(k, MAP_H - 1), tileOf(0, k), tileOf(MAP_W - 1, k)]) if (g.kind[i] !== TILE.WATER) edge++;
  check(edge === 0, `the sea all round the map's edge (${edge} other)`);
  // The road: only the ferry landing, which touches nothing but the sea and the drawbridge.
  const road: number[] = [];
  for (let i = 0; i < MAP_W * MAP_H; i++) if (zoneAt(bot, i) === 'outside') road.push(i);
  const touches = new Set<string>();
  for (const i of road) for (const j of [i - 1, i + 1, i - MAP_W, i + MAP_W]) if (zoneAt(bot, j) !== 'outside') touches.add(w.bridge[j] ? 'drawbridge' : TILE_INFO[g.kind[j]].name);
  check(road.every((i) => g.kind[i] === TILE.ROAD) && [...touches].sort().join() === 'drawbridge,water', `the only road is the ferry landing, beyond the water and the drawbridge (${road.length} tiles; touches ${[...touches].join(', ')})`);
  // Underground: from anywhere on the island, the landing can't be reached without digging under the sea.
  const seen = new Uint8Array(MAP_W * MAP_H);
  const queue: number[] = [];
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (isSea(g.kind[i]) || zoneAt(bot, i) === 'outside') continue;
    seen[i] = 1;
    queue.push(i);
  }
  let reached = 0;
  while (queue.length) {
    const i = queue.pop()!;
    for (const j of [i - 1, i + 1, i - MAP_W, i + MAP_W]) {
      if (j < 0 || j >= MAP_W * MAP_H || seen[j] || Math.abs((j % MAP_W) - (i % MAP_W)) > 1) continue;
      if (isSea(g.base[j])) continue;
      seen[j] = 1;
      if (zoneAt(bot, j) === 'outside') reached++;
      queue.push(j);
    }
  }
  check(reached === 0, `no tunnel reaches the landing without passing under the sea (${reached} landing tiles reached dry)`);
  const pier = Array.from(g.kind).filter((k) => k === TILE.PIER).length;
  const bridge = Array.from(w.bridge).filter((v) => v).length;
  check(pier === 6 && bridge === 6, `the pier (${pier} tiles) and the drawbridge (${bridge} tiles)`);
  check(IRONGATE.escapes!.join() === 'raft,helicopter,takeover,stowaway,bluff,paperwork', `six ways out: ${IRONGATE.escapes!.join(', ')}`);
  console.log(`island: the sea all round, the landing (${road.length} road tiles) only past the drawbridge, the pier ${pier} tiles`);
}

// ------------------------------------------------------------------ a tunnel under the sea floods
{
  const bot = new Bot(IRONGATE, 2);
  const w = bot.sim.world;
  const st = bot.st;
  // A tunnel already dug from the walkway inside the outer wall (5,30): its entrance, braced west under the wall.
  const shaft = tileOf(5, 30);
  w.setKind(LAYER.GROUND, shaft, TILE.SHAFT);
  st.tiles[shaft] = TILE.SHAFT;
  for (const x of [5, 4, 3]) {
    const k = x === 3 ? TILE.BRACED : TILE.TUNNEL;
    w.setKind(LAYER.UNDER, tileOf(x, 30), k);
    st.tiles[(LAYER.UNDER + 1) * MAP_W * MAP_H + tileOf(x, 30)] = k;
  }
  // The shore past the wall (2,30): rock; the sea beyond it (1,30 or 0,30).
  let x = 2;
  while (!isSea(w.ground.kind[tileOf(x, 30)])) x--;
  // Dig west from 3,30 to the sea.
  place(bot, 3, 30, LAYER.UNDER);
  give(bot, 'sturdy_shovel');
  bot.hold('sturdy_shovel');
  bot.face(DIR.WEST);
  const hp = st.health;
  let flooded = false;
  for (let k = 0; k < 600 && !flooded; k++) {
    if (st.energy < 20) st.energy = 100;
    bot.op(OP.USE, 1);
    flooded = bot.sim.events.some((e) => e.type === 'flood');
    // Broken through: on along it (a brace first), facing the next.
    const ahead = Math.floor(st.player.x / UNIT) - 1;
    if (!flooded && isTunnel(w.layers[LAYER.UNDER].kind[tileOf(ahead, 30)])) {
      w.setKind(LAYER.UNDER, tileOf(ahead, 30), TILE.BRACED);
      place(bot, ahead, 30, LAYER.UNDER);
      bot.face(DIR.WEST);
    }
  }
  const under = w.layers[LAYER.UNDER].kind;
  let left = 0;
  for (let i = 0; i < MAP_W * MAP_H; i++) if (isTunnel(under[i])) left++;
  check(flooded, `digging under the sea (${x},30) floods the tunnel`);
  check(left === 0 && w.ground.kind[shaft] === w.ground.base[shaft], `the whole tunnel lost, its entrance too (${left} tunnel tiles left)`);
  check(st.ko > 0 && hp > 0 && st.wake === WAKE.FLOORED, 'washed out cold');
  bot.until(() => st.ko === 0, KO_STEPS + 40);
  check(st.layer === LAYER.GROUND && bot.sim.playerZone === 'infirmary', `woken in the infirmary (${bot.sim.playerZone})`);
  check(bot.slotOf('sturdy_shovel') < 0, 'the shovel taken (contraband, as after any knockout)');
  console.log(`flood: dug under the sea at ${x},30, the tunnel and its entrance lost, the player woke in the ${bot.sim.playerZone}`);
}

// ------------------------------------------------------------------ two generators
{
  const bot = new Bot(IRONGATE, 3);
  const w = bot.sim.world;
  const st = bot.st;
  const gens = generatorsOf(w);
  check(gens.length === 2, `two generators (${gens.length})`);
  const where = (k: number) => zoneAt(bot, w.props[gens[k]].z * MAP_W + w.props[gens[k]].x);
  check(where(0) === 'generator' && where(1) === 'generator', 'both in generator rooms');
  check(['detectors', 'cameras'].every((u) => genFor(w, u as never) === 0) && ['fence', 'searchlights', 'lights'].every((u) => genFor(w, u as never) === 1), 'GEN-1 runs the arches and cameras, GEN-2 the fence, searchlights and lamps');
  const at = (k: number) => {
    const p = w.props[gens[k]];
    place(bot, p.x, p.z - 1);
    bot.face(DIR.SOUTH);
  };
  // GEN-1 off: arches and cameras dead, the fence still live.
  at(0);
  bot.act();
  check(st.powerOff === POWER_OFF_STEPS && st.powerOff2 === 0, 'GEN-1 off, GEN-2 running');
  check(!powered(w, st, 'detectors') && !powered(w, st, 'cameras') && powered(w, st, 'fence') && powered(w, st, 'searchlights'), 'arches and cameras dead; the fence and the searchlights live');
  check(bot.sim.events.some((e) => e.type === 'power' && !e.on && e.gen === 0), "the event names GEN-1");
  // A camera that sees the player in the control room… sees nothing now.
  place(bot, 24, 44);
  st.items.inv[SLOT.OUTFIT] = slot(n('inmate_outfit'));
  check(!cameraSeesPlayer(bot.sim), 'a camera with GEN-1 off sees nothing');
  // GEN-2 off too: the fence dead.
  at(1);
  bot.act();
  check(st.powerOff2 === POWER_OFF_STEPS && !powered(w, st, 'fence') && !powered(w, st, 'searchlights') && !powered(w, st, 'lights'), 'GEN-2 off: the fence, the searchlights and the lamps dead');
  // Back on by itself: GEN-1 first (it went off first).
  bot.until(() => st.powerOff === 0, POWER_OFF_STEPS + 5);
  check(st.powerOff2 > 0 && powered(w, st, 'cameras') && !powered(w, st, 'fence'), 'GEN-1 back after 45 s, GEN-2 still off');
  bot.until(() => st.powerOff2 === 0, POWER_OFF_STEPS);
  check(powered(w, st, 'fence'), 'and GEN-2 back after its own 45 s');
  // With GEN-1 off, cutting the live dock fence still shocks.
  const shocked = new Bot(IRONGATE, 3);
  place(shocked, 59, 28);
  give(shocked, 'sturdy_cutters');
  shocked.hold('sturdy_cutters');
  shocked.face(DIR.EAST);
  shocked.st.powerOff = POWER_OFF_STEPS;
  shocked.use();
  check(shocked.sim.events.some((e) => e.type === 'shocked'), 'GEN-1 off, the dock fence (on GEN-2) still shocks');
  console.log(`generators: GEN-1 at ${w.props[gens[0]].x},${w.props[gens[0]].z} (arches, cameras), GEN-2 at ${w.props[gens[1]].x},${w.props[gens[1]].z} (fence, searchlights, lamps)`);
}

// ------------------------------------------------------------------ the raft
{
  // On the quay, facing the fence: nothing to launch from. On the pier's end, the sea ahead: away.
  const bot = new Bot(IRONGATE, 4);
  const w = bot.sim.world;
  const st = bot.st;
  give(bot, 'raft');
  bot.hold('raft');
  place(bot, 59, 28);
  bot.face(DIR.EAST);
  check(toolTarget(w, LAYER.GROUND, st.player, n('raft'), [])?.action !== 'launch', 'no launching from the quay (the fence ahead)');
  place(bot, 58, 33);
  bot.face(DIR.SOUTH);
  check(toolTarget(w, LAYER.GROUND, st.player, n('raft'), [])?.action !== 'launch', 'nor over the fence from the quay’s end');
  place(bot, 62, 28);
  bot.face(DIR.EAST);
  const t = toolTarget(w, LAYER.GROUND, st.player, n('raft'), []);
  check(t?.action === 'launch', `at the pier's end, the sea ahead: launch (${t?.action})`);
  bot.use();
  check(bot.done && ESCAPES[st.via] === 'raft' && bot.slotOf('raft') < 0, `away on the raft (${ESCAPES[st.via]})`);
  console.log(`raft: launched off the pier's end at 62,28, escaped by ${ESCAPES[st.via]}`);
}

// ------------------------------------------------------------------ the drawbridge
{
  const bot = new Bot(IRONGATE, 5);
  const w = bot.sim.world;
  const st = bot.st;
  check(w.blocked(30, 57) && w.blocked(31, 57), 'the drawbridge is up: water');
  // Every guard out cold: the takeover, the gates open, the drawbridge down.
  for (const g of st.guards) g.ko = KO_STEPS;
  place(bot, 30, 54);
  bot.step(0);
  check(st.takeover && !w.blocked(30, 57) && !w.blocked(30, 55), 'in a takeover the gates open and the drawbridge comes down');
  bot.walkTo(tileOf(30, 60), 400);
  check(bot.done && ESCAPES[st.via] === 'takeover', `across it onto the ferry landing: out (${ESCAPES[st.via]})`);
  console.log('drawbridge: up until the takeover, then down to the ferry landing');
}

// ------------------------------------------------------------------ the roofs and the helipad court
{
  const bot = new Bot(IRONGATE, 6);
  const w = bot.sim.world;
  const st = bot.st;
  // On the north block's roof at the yard's edge (the wall top at 36,21), facing south: across the chasm.
  place(bot, 36, 21, LAYER.ROOF);
  give(bot, 'grapnel', 'sheet_rope');
  bot.hold('grapnel');
  bot.face(DIR.SOUTH);
  const t = toolTarget(w, LAYER.ROOF, st.player, n('grapnel'), [], st.items.inv);
  check(t?.action === 'grapnel' && t.layer === LAYER.ROOF && t.fits, `the grapnel hooks the roof across the yard (${t?.action}, layer ${t?.layer})`);
  bot.use();
  check(st.layer === LAYER.ROOF && Math.floor(st.player.z / UNIT) === 27 && bot.slotOf('sheet_rope') >= 0, 'swung across onto the middle block, the sheet rope kept');
  // Along the roofs to the helipad court's west edge (the wall top beside it), and down the rope into it.
  check(bot.walkTo(tileOf(32, 44), 600), 'over the roofs to the court');
  bot.hold('sheet_rope');
  bot.face(DIR.EAST);
  bot.use();
  check(st.layer === LAYER.GROUND && bot.sim.playerZone === 'helipad', `down the rope into the helipad court (${bot.sim.playerZone})`);
  // Thrown anywhere else across the yard (from a roof that isn't a landing's edge): nothing.
  const other = new Bot(IRONGATE, 6);
  place(other, 36, 27, LAYER.ROOF);
  other.face(DIR.NORTH);
  check(toolTarget(other.sim.world, LAYER.ROOF, other.st.player, n('grapnel'), [], [slot(n('sheet_rope'))]) === null, 'no hooking back north (the north block is no landing)');
  console.log('roofs: north roof → across the yard on the grapnel → the south roofs → down the sheet rope into the court');
}

// ------------------------------------------------------------------ the helicopter
{
  const bot = new Bot(IRONGATE, 7);
  const st = bot.st;
  const refusal = () => bot.sim.events.find((e) => e.type === 'refused')?.why;
  // Beside the pad (it's kept clear), facing it.
  const onPad = () => {
    place(bot, 34, 45);
    bot.face(DIR.EAST);
    bot.act();
  };
  onPad();
  check(!helicopterIn(bot.sim) && refusal() === 'noHelicopter', `by day the pad is empty (${refusal()})`);
  // Lights Out: the helicopter is in.
  runTo(bot, 23 * 60 + 1);
  place(bot, 34, 45);
  bot.step(0);
  onPad();
  check(helicopterIn(bot.sim) && refusal() === 'helipadGuards', `at night, the helipad guards up: refused (${refusal()})`);
  const helipad = IRONGATE.guards.map((d, k) => (d.helipad ? k : -1)).filter((k) => k >= 0);
  check(helipad.length === 2 && helipad.every((k) => IRONGATE.guards[k].riot), 'two helipad guards, both riot guards');
  for (const k of helipad) st.guards[k].ko = KO_STEPS;
  onPad();
  check(refusal() === 'notUniform', `the guards down, in an inmate's outfit: the pilot flies staff only (${refusal()})`);
  st.items.inv[SLOT.OUTFIT] = slot(n('guard_outfit'));
  onPad();
  check(bot.done && ESCAPES[st.via] === 'helicopter', `in a guard's uniform: away in the helicopter (${ESCAPES[st.via]})`);
  console.log('helicopter: in at night only, never with a helipad guard up, staff only');
}

// ------------------------------------------------------------------ riot guards
{
  const riot = IRONGATE.guards.filter((d) => d.riot).length;
  check(riot === 4 && IRONGATE.guards.length === 10, `ten guards, four in riot gear (${riot})`);
  const bot = new Bot(IRONGATE, 8);
  const w = bot.sim.world;
  const k = IRONGATE.guards.findIndex((d) => d.riot);
  const plain = IRONGATE.guards.findIndex((d) => !d.riot);
  check(bot.st.guards[k].hp === maxHealth(RIOT_STR) && bot.st.guards[plain].hp === maxHealth(GUARD_STR), `riot guards: ${maxHealth(RIOT_STR)} health (a guard ${maxHealth(GUARD_STR)})`);
  check(guardDefense(w, k) === RIOT_DEFENSE && guardDefense(w, plain) === GUARD_DEFENSE, 'their plates: defense ' + RIOT_DEFENSE);
  const fist = damage(90, 0, guardDefense(w, plain));
  const vsRiot = damage(90, 0, guardDefense(w, k));
  check(vsRiot < fist, `a blow at Strength 90 does ${fist} to a guard, ${vsRiot} to a riot guard`);
  console.log(`riot guards: ${riot}, health ${maxHealth(RIOT_STR)}, a Strength 90 punch ${vsRiot} (a guard: ${fist})`);
}
