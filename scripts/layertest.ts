/**
 * Layers and destruction (GDD §9), driven through the real simulation with ordinary commands:
 * - the vents map: the cell grate's duct reaches the ladder; the ladder's foot is free floor;
 * - chipping: plastic forks through the cell's back wall (tools wear out, energy runs down),
 *   the chunk lands in hand, the player walks through and inmates never path through holes;
 * - covers: a poster only in the player's cell, a fake wall block anywhere, both taken off again;
 * - cutting: plastic knives through the north fence, then out on the road: escaped;
 * - the electric fence knocks the player out (the generator is always on before P7);
 * - vents: a nail file unscrews the cell grate, the player climbs in, crawls to the ladder,
 *   climbs to the roof and back down; a fake vent cover goes on from above;
 * - tunnels: a shovel digs under the desk, the desk panel leads down, the third unbraced
 *   tile caves in, braces hold, dirt goes down the toilet (clogged after 3, again an hour
 *   later), and the tunnel bot digs out under the fence and up onto the road: escaped;
 * - discovery: a guard who sees an open hole, a cut fence, dirt on the floor or the player
 *   at work raises the alarm; a covered hole passes; after the capture the damage is
 *   repaired; a guard in the yard sees the player on the roof, one indoors doesn't;
 * - a save restored mid-tunnel replays to the same state.
 */
import { ITEMS, itemNumber } from '../src/content/items';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { Autopilot } from '../src/sim/ai/autopilot';
import { placesOf } from '../src/sim/ai/places';
import { command, OP } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { formatTime } from '../src/sim/systems/clock';
import { GUARD, type Guard } from '../src/sim/systems/guards';
import { itemOf, slot } from '../src/sim/systems/items';
import { ladderFootOf } from '../src/sim/systems/structure';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { TILE } from '../src/sim/world/tiles';
import { LAYER, MAP_H, MAP_W } from '../src/sim/world/World';
import { check } from './assert';

const n = (id: string) => itemNumber(id);
const at = (sim: Sim) => `day ${sim.clock.day} ${formatTime(sim.clock)}`;
const NO_GUARDS = { ...CENTER_PERKS, guards: [] };
const NORTH = 13;
const SOUTH = 5;
const EAST = 1;

function put(b: { x: number; z: number }, x: number, z: number) {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
}
/** Stands the player on a tile, facing a way, on a layer. */
function stand(sim: Sim, x: number, z: number, facing: number, layer: number = LAYER.GROUND) {
  put(sim.state.player, x, z);
  sim.state.player.facing = facing;
  sim.state.layer = layer;
}
/** Fills the hotbar from slot 0 and holds slot 0. */
function carry(sim: Sim, ...ids: string[]) {
  const it = sim.state.items;
  for (let k = 0; k < 6; k++) it.inv[k] = ids[k] ? slot(n(ids[k])) : 0;
  it.hand = 0;
}
const kindAt = (sim: Sim, layer: number, x: number, z: number) => sim.world.layers[layer].kind[z * MAP_W + x];
const name = (k: number) => Object.entries(TILE).find(([, v]) => v === k)?.[0] ?? String(k);

/**
 * Strikes until `done` (or a limit): when the hand empties (a tool broke) the next slot
 * holding `tool` goes in hand; when the player is too tired, they rest (energy refilled,
 * counted). Returns what it took.
 */
function strikeUntil(sim: Sim, tool: string, done: () => boolean, limit = 4000) {
  const st = sim.state;
  let strikes = 0;
  let broke = 0;
  let rests = 0;
  let steps = 0;
  const events: SimEvent[] = [];
  while (!done() && steps++ < limit) {
    if (itemOf(st.items.inv[st.items.hand]) !== n(tool)) {
      const k = st.items.inv.slice(0, 6).findIndex((v) => itemOf(v) === n(tool));
      if (k < 0) break;
      sim.step(command(0, OP.SELECT, k));
      continue;
    }
    // Each strike a fresh press (the UI's first press; holding sends 0).
    sim.step(command(0, OP.USE, 1));
    for (const e of sim.events) {
      events.push(e);
      if (e.type === 'strike') strikes++;
      if (e.type === 'broke') broke++;
      if (e.type === 'cantStrike' && e.why === 'tired') {
        rests++;
        st.energy = 100;
      }
    }
  }
  return { strikes, broke, rests, events, ok: done() };
}

/** One interact press; returns its events. */
function interact(sim: Sim, a = 0): SimEvent[] {
  sim.step(command(0, OP.INTERACT, a));
  return sim.events;
}
/** One press of the use button (a cover, a brace, a rope); returns its events. */
function use(sim: Sim): SimEvent[] {
  sim.step(command(0, OP.USE, 1));
  return sim.events;
}

/** Walks a direction for some steps (on the player's layer). */
function walkFor(sim: Sim, dir: number, steps: number) {
  for (let k = 0; k < steps && !sim.state.escaped; k++) sim.step(command(dir));
}

/** Walks to a tile on the player's layer with the autopilot. */
function goTo(sim: Sim, tile: number, limit = 3000): boolean {
  const pilot = new Autopilot(sim.world, () => sim.world.layers[sim.state.layer].block);
  pilot.goTo(tile);
  for (let k = 0; k < limit && pilot.active; k++) sim.step(command(pilot.dir(sim.state.player)));
  return Math.floor(sim.state.player.z / UNIT) * MAP_W + Math.floor(sim.state.player.x / UNIT) === tile;
}

// ------------------------------------------------------------------ the vents map
{
  const sim = new Sim(NO_GUARDS, 1);
  const w = sim.world;
  const vents = w.layers[LAYER.VENTS].kind;
  const grates: string[] = [];
  let ladder = -1;
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (vents[i] === TILE.GRATE) {
      grates.push(`${i % MAP_W},${Math.floor(i / MAP_W)}`);
      check(!w.blocked(i % MAP_W, Math.floor(i / MAP_W)), `grate ${i % MAP_W},${Math.floor(i / MAP_W)} is over free floor`);
    }
    if (vents[i] === TILE.LADDER) ladder = i;
  }
  const foot = ladderFootOf(w);
  console.log(`vents: grates at ${grates.join(' ')}; ladder ${ladder % MAP_W},${Math.floor(ladder / MAP_W)}, foot ${foot % MAP_W},${Math.floor(foot / MAP_W)}`);
  check(ladder >= 0 && foot >= 0, 'the ladder has a free foot');
  check(w.layers[LAYER.ROOF].kind[ladder] === TILE.LADDER, 'the ladder reaches a roof hatch');
  // Every duct tile joins up.
  const seen = new Set<number>([9 * MAP_W + 9]);
  const queue = [9 * MAP_W + 9];
  while (queue.length) {
    const i = queue.pop()!;
    for (const j of [i - 1, i + 1, i - MAP_W, i + MAP_W]) if (!w.layers[LAYER.VENTS].block[j] && !seen.has(j)) (seen.add(j), queue.push(j));
  }
  const ducts = Array.from(vents).filter((k) => k !== TILE.EMPTY).length;
  check(seen.size === ducts && seen.has(ladder), 'one duct network, from the cell grate to the ladder');
  console.log(`vents: ${ducts} duct tiles, all joined; roofs: ${Array.from(w.layers[LAYER.ROOF].kind).filter((k) => k !== TILE.EMPTY).length} tiles`);
}

// ------------------------------------------------------------------ chipping, covers, cutting, escape
{
  const sim = new Sim(NO_GUARDS, 3);
  const st = sim.state;
  // The back wall of the player's cell (north, z 6), from beside the bed.
  stand(sim, 8, 7, NORTH);
  carry(sim, 'plastic_fork', 'plastic_fork', 'plastic_fork');
  const chip = strikeUntil(sim, 'plastic_fork', () => kindAt(sim, LAYER.GROUND, 8, 6) === TILE.HOLE);
  check(chip.ok, 'three forks get through a brick wall');
  console.log(`chip: ${chip.strikes} strikes, ${chip.broke} forks worn out, ${chip.rests} rests → ${name(kindAt(sim, LAYER.GROUND, 8, 6))}, carrying ${st.items.inv.slice(0, 6).filter(Boolean).map((v) => ITEMS[itemOf(v) - 1].id).join(', ')}; energy ${st.energy}`);
  check(st.items.inv.some((v) => itemOf(v) === n('wall_chunk')), 'the chunk of wall is in hand');
  check(sim.world.npcBlock[6 * MAP_W + 8] === 1 && sim.world.guardBlock[6 * MAP_W + 8] === 1 && sim.world.block[6 * MAP_W + 8] === 0, 'the hole is the player’s way, not the inmates’ or guards’');
  // Covers: a poster here (the player's cell), then a fake block; each comes off again.
  carry(sim, 'poster');
  stand(sim, 8, 7, NORTH);
  use(sim);
  check(kindAt(sim, LAYER.GROUND, 8, 6) === TILE.HOLE_POSTER && !st.items.inv[0], 'a poster covers a hole in the player’s cell');
  check(sim.world.block[6 * MAP_W + 8] === 1, 'a covered hole is shut');
  interact(sim);
  check(kindAt(sim, LAYER.GROUND, 8, 6) === TILE.HOLE && itemOf(st.items.inv[0]) === n('poster'), 'the poster comes off into the hand');
  carry(sim, 'fake_wall');
  use(sim);
  check(kindAt(sim, LAYER.GROUND, 8, 6) === TILE.HOLE_FAKE, 'a fake wall block plugs the hole');
  interact(sim);
  check(kindAt(sim, LAYER.GROUND, 8, 6) === TILE.HOLE, 'and comes out again');
  // Through the hole, to the fence in the north (z 2).
  walkFor(sim, NORTH, 60);
  console.log(`through the hole: ${sim.playerZone} at ${Math.floor(st.player.x / UNIT)},${Math.floor(st.player.z / UNIT)}`);
  check(sim.playerZone === 'perimeter', 'through the wall: the perimeter');
  carry(sim, 'plastic_knife', 'plastic_knife', 'plastic_knife');
  st.energy = 100;
  const cut = strikeUntil(sim, 'plastic_knife', () => kindAt(sim, LAYER.GROUND, 8, 2) === TILE.FENCE_CUT);
  check(cut.ok, 'three plastic knives cut the fence');
  console.log(`cut: ${cut.strikes} strikes, ${cut.broke} knives worn out, ${cut.rests} rests → ${name(kindAt(sim, LAYER.GROUND, 8, 2))}`);
  carry(sim, 'fake_fence');
  use(sim);
  check(kindAt(sim, LAYER.GROUND, 8, 2) === TILE.FENCE_FAKE, 'a fake fence cover patches the cut');
  interact(sim);
  check(kindAt(sim, LAYER.GROUND, 8, 2) === TILE.FENCE_CUT && itemOf(st.items.inv[0]) === n('fake_fence'), 'the fake fence cover comes off into the hand');
  walkFor(sim, NORTH, 40);
  check(st.escaped > 0, 'out on the road: escaped');
  console.log(`escape through the fence: ${st.escaped ? `escaped ${at(sim)}` : 'still inside'}`);
  const frozen = sim.hash();
  sim.step(command(NORTH));
  check(sim.hash() === frozen, 'after the escape nothing changes');
}

// ------------------------------------------------------------------ the electric fence
{
  const sim = new Sim(NO_GUARDS, 4);
  const live = Array.from(sim.world.ground.kind).indexOf(TILE.ELECTRIC);
  stand(sim, live % MAP_W, Math.floor(live / MAP_W) - 1, SOUTH);
  carry(sim, 'plastic_knife');
  sim.step(command(0, OP.USE, 1));
  check(sim.events.some((e) => e.type === 'shocked') && sim.state.ko > 0, 'a live fence knocks the player out');
  for (let k = 0; k < 700 && sim.state.ko > 0; k++) sim.step(command(0));
  console.log(`electric fence: shocked, woke up in the ${sim.playerZone}; the plastic knife (legal) ${sim.state.items.inv[0] ? 'kept' : 'confiscated'}`);
  check(sim.playerZone === 'infirmary' && !!sim.state.items.inv[0], 'woken in the infirmary, the legal knife kept');
}

// ------------------------------------------------------------------ vents and roof
{
  const sim = new Sim(NO_GUARDS, 5);
  const st = sim.state;
  stand(sim, 9, 9, NORTH);
  carry(sim, 'nail_file');
  const unscrew = strikeUntil(sim, 'nail_file', () => kindAt(sim, LAYER.VENTS, 9, 9) === TILE.GRATE_OPEN);
  check(unscrew.ok, 'a nail file unscrews the grate');
  const climbed = interact(sim).find((e) => e.type === 'layer');
  check(st.layer === LAYER.VENTS && sim.playerZone === 'vents', 'up through the grate into the vents');
  console.log(`vents: ${unscrew.strikes} turns of the file; climbed in (${climbed?.type === 'layer' ? climbed.how : '-'}), zone ${sim.playerZone}`);
  const ladder = 39 * MAP_W + 13;
  const t0 = st.step;
  check(goTo(sim, ladder), 'crawled through the ducts to the ladder');
  console.log(`crawl: cell grate → ladder in ${((st.step - t0) / 20).toFixed(1)} s`);
  interact(sim);
  check(st.layer === LAYER.ROOF && sim.playerZone === 'roof', 'up the ladder to the roof');
  // Walk the roof a little, then back to the hatch and down to the generator room floor.
  walkFor(sim, EAST, 30);
  const onRoof = sim.playerZone;
  check(goTo(sim, ladder), 'back to the hatch');
  interact(sim);
  console.log(`roof: walked east (${onRoof}), climbed down to the ${sim.playerZone} at ${Math.floor(st.player.x / UNIT)},${Math.floor(st.player.z / UNIT)}`);
  check(st.layer === LAYER.GROUND && sim.playerZone === 'generator', 'down the ladder into the generator room');
  // Back up and through the ducts to the cell, down, and the grate covered from above.
  stand(sim, 13, 40, NORTH);
  carry(sim, 'nail_file', 'fake_vent');
  const gen = strikeUntil(sim, 'nail_file', () => kindAt(sim, LAYER.VENTS, 13, 40) === TILE.GRATE_OPEN);
  check(gen.ok, 'the generator room grate unscrews');
  interact(sim);
  check(st.layer === LAYER.VENTS, 'up from the generator room');
  check(goTo(sim, 9 * MAP_W + 9), 'crawled home');
  sim.step(command(0, OP.SELECT, 1));
  use(sim);
  check(kindAt(sim, LAYER.VENTS, 9, 9) === TILE.GRATE_FAKE, 'a fake vent cover goes on from above');
  interact(sim);
  check(kindAt(sim, LAYER.VENTS, 9, 9) === TILE.GRATE_OPEN && itemOf(st.items.inv[1]) === n('fake_vent'), 'and off again, into the hand');
  interact(sim);
  check(st.layer === LAYER.GROUND && sim.playerZone === 'playerCell', 'down into the cell');
}

// ------------------------------------------------------------------ tunnels, braces, dirt, the tunnel escape
let midTunnel: ReturnType<Sim['snapshot']> | null = null;
{
  const sim = new Sim(NO_GUARDS, 6);
  const st = sim.state;
  // Under the desk (10, 7), from beside it.
  stand(sim, 9, 7, EAST);
  carry(sim, 'sturdy_shovel', 'timber_brace', 'timber_brace', 'timber_brace');
  const shaft = strikeUntil(sim, 'sturdy_shovel', () => kindAt(sim, LAYER.GROUND, 10, 7) === TILE.SHAFT);
  check(shaft.ok && kindAt(sim, LAYER.UNDER, 10, 7) === TILE.TUNNEL, 'a shovel digs a tunnel entrance under the desk');
  check(st.items.inv.some((v) => itemOf(v) === n('dirt')), 'the dirt is in hand');
  // Flush it: the toilet takes three loads an hour.
  const toilet = containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'toilet');
  const flushes: string[] = [];
  for (let k = 0; k < 5; k++) {
    if (k === 4) for (let m = 0; m < 61 * STEPS_PER_MINUTE; m++) sim.step(command(0));
    carry(sim, 'dirt');
    stand(sim, 10, 9, SOUTH);
    const ev = interact(sim);
    flushes.push(ev.some((e) => e.type === 'flushed') ? 'flushed' : ev.some((e) => e.type === 'clogged') ? 'clogged' : '-');
  }
  console.log(`toilet ${toilet}: ${flushes.join(', ')}`);
  check(flushes.join() === 'flushed,flushed,flushed,clogged,flushed', 'three loads, then clogged, then fine an hour later');
  // Down through the desk's panel.
  carry(sim, 'sturdy_shovel', 'timber_brace', 'timber_brace', 'timber_brace');
  stand(sim, 9, 7, EAST);
  interact(sim);
  const desk = containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'desk');
  check(st.items.open === desk, 'the desk opens');
  interact(sim, 1);
  check(st.layer === LAYER.UNDER && sim.playerZone === 'tunnels', 'down the tunnel under the desk');
  // North: two tiles hold, the third caves in.
  st.player.facing = NORTH;
  const dug: string[] = [];
  let caveIns = 0;
  for (const z of [6, 5, 4]) {
    const r = strikeUntil(sim, 'sturdy_shovel', () => kindAt(sim, LAYER.UNDER, 10, z) !== TILE.SOIL || sim.events.some((e) => e.type === 'caveIn'), 200);
    const cave = r.events.some((e) => e.type === 'caveIn');
    if (cave) caveIns++;
    dug.push(`${z}:${cave ? 'CAVE-IN' : name(kindAt(sim, LAYER.UNDER, 10, z))}`);
    if (!cave) goTo(sim, z * MAP_W + 10);
    st.player.facing = NORTH;
  }
  console.log(`tunnel north: ${dug.join(' ')} (health ${st.health})`);
  check(st.health === 90 - 40 || st.health === 90 - 40 + 1, 'a cave-in costs 40 health');
  check(caveIns === 1 && kindAt(sim, LAYER.UNDER, 10, 4) === TILE.SOIL, 'the third unbraced tile caves in');
  // A brace where the player stands, then on: every third tile braced.
  const braceHere = () => {
    const k = st.items.inv.slice(0, 6).findIndex((v) => itemOf(v) === n('timber_brace'));
    sim.step(command(0, OP.SELECT, k));
    use(sim);
    sim.step(command(0, OP.SELECT, 0));
    st.player.facing = NORTH;
  };
  braceHere();
  check(kindAt(sim, LAYER.UNDER, 10, 5) === TILE.BRACED, 'a timber brace goes up');
  st.energy = 100;
  for (const z of [4, 3, 2, 1]) {
    if (z === 2) braceHere();
    const r = strikeUntil(sim, 'sturdy_shovel', () => kindAt(sim, LAYER.UNDER, 10, z) !== TILE.SOIL || sim.events.some((e) => e.type === 'caveIn'), 200);
    check(!r.events.some((e) => e.type === 'caveIn'), `braced, tile ${z} holds`);
    goTo(sim, z * MAP_W + 10);
    st.player.facing = NORTH;
    if (z === 3) midTunnel = sim.snapshot();
  }
  console.log(`tunnel: dug to 10,1 under the road; dirt left in the tunnel: ${st.items.ground.length} piles; ${at(sim)}`);
  // Turn back along the tunnel and dig up: out onto the road. Holding the button (no fresh
  // press) never digs up: it would carry a hold on from the last tile straight to the surface.
  goTo(sim, 1 * MAP_W + 10);
  st.player.facing = SOUTH;
  for (let k = 0; k < 60; k++) sim.step(command(0, OP.USE, 0));
  check(st.layer === LAYER.UNDER && !st.wear[1 * MAP_W + 10], 'a held button never digs up');
  const up = strikeUntil(sim, 'sturdy_shovel', () => st.escaped > 0 || st.layer === LAYER.GROUND, 200);
  check(up.ok && st.escaped > 0, 'dug up onto the road: escaped');
  console.log(`tunnel escape: ${st.escaped ? `escaped ${at(sim)}` : `stuck in the ${sim.playerZone}`}`);
}

// ------------------------------------------------------------------ a save restored mid-tunnel
{
  const a = new Sim(NO_GUARDS, 6);
  a.restore(midTunnel!);
  const b = new Sim(NO_GUARDS, 99);
  b.restore(midTunnel!);
  check(a.hash() === b.hash(), 'a restored tunnel save is the same state');
  for (let k = 0; k < 200; k++) {
    const c = command(k % 40 < 20 ? NORTH : 0, k % 13 === 0 ? OP.USE : 0);
    a.step(c);
    b.step(c);
  }
  check(a.hash() === b.hash(), 'and replays the same');
  console.log(`restore mid-tunnel: ${a.hash() === b.hash() ? 'same' : 'DIFFERENT'} after 200 steps`);
}

// ------------------------------------------------------------------ discovery
/** A guard planted on a tile, facing a way, standing there. */
function plant(g: Guard, x: number, z: number, facing: number) {
  put(g.body, x, z);
  g.body.facing = g.face = facing;
  g.path = [];
  g.wait = 100000;
  g.mode = GUARD.DUTY;
  g.doing = 0;
}
/** Everyone but one guard sent far out of the way (asleep in a corner). */
function quiet(sim: Sim) {
  for (const g of sim.state.guards) {
    put(g.body, 60, 62);
    g.wait = 100000;
    g.doing = 1;
  }
  return sim.state.guards[0];
}
{
  // An open hole in the corridor wall south of the cell block, seen by a guard.
  const sim = new Sim(CENTER_PERKS, 7);
  const st = sim.state;
  const g = quiet(sim);
  stand(sim, 12, 19, SOUTH);
  carry(sim, 'sturdy_pickaxe', 'fake_wall');
  // The wall at 12,20 between the lower cells and the corridor; the guard looks the other way.
  const chip = strikeUntil(sim, 'sturdy_pickaxe', () => kindAt(sim, LAYER.GROUND, 12, 20) === TILE.HOLE);
  check(chip.ok && !st.lockdown, 'chipped out of sight: no alarm');
  stand(sim, 9, 8, SOUTH);
  plant(g, 16, 22, 9);
  g.doing = 0;
  for (let k = 0; k < 3; k++) sim.step(command(0));
  check(st.lockdown && st.found.length === 1, 'a guard who sees the hole raises the alarm');
  console.log(`discovery: open hole seen → ${st.lockdown ? 'LOCKDOWN' : 'nothing'} (${st.found.length} found)`);
  // Caught: the hole is concreted over while the player is out cold.
  let repaired = false;
  for (let k = 0; k < 6000 && !repaired; k++) {
    sim.step(command(0));
    repaired = sim.events.some((e) => e.type === 'repaired');
  }
  console.log(`after the capture: ${repaired ? 'repaired' : 'not repaired'}, 12,20 is ${name(kindAt(sim, LAYER.GROUND, 12, 20))}`);
  check(repaired && kindAt(sim, LAYER.GROUND, 12, 20) === TILE.BRICK, 'the hole is repaired after the capture');
}
{
  // The same hole behind a fake wall block: the guard walks by.
  const sim = new Sim(CENTER_PERKS, 7);
  const st = sim.state;
  const g = quiet(sim);
  stand(sim, 12, 19, SOUTH);
  carry(sim, 'sturdy_pickaxe', 'fake_wall', 'poster');
  strikeUntil(sim, 'sturdy_pickaxe', () => kindAt(sim, LAYER.GROUND, 12, 20) === TILE.HOLE);
  // Another inmate's cell: a poster wouldn't pass there.
  sim.step(command(0, OP.SELECT, 2));
  const refused = use(sim).some((e) => e.type === 'cantStrike' && e.why === 'poster');
  check(refused && kindAt(sim, LAYER.GROUND, 12, 20) === TILE.HOLE, 'a poster outside the player’s cell is refused');
  sim.step(command(0, OP.SELECT, 1));
  use(sim);
  check(kindAt(sim, LAYER.GROUND, 12, 20) === TILE.HOLE_FAKE, 'plugged');
  stand(sim, 9, 8, SOUTH);
  plant(g, 16, 22, 9);
  g.doing = 0;
  for (let k = 0; k < 40; k++) sim.step(command(0));
  check(!st.lockdown && !st.found.length, 'a covered hole goes unnoticed');
  // Dirt left on the corridor floor is evidence.
  st.items.ground.push([22 * MAP_W + 13, slot(n('dirt'))]);
  for (let k = 0; k < 3; k++) sim.step(command(0));
  check(st.lockdown && !st.items.ground.some(([, v]) => itemOf(v) === n('dirt')), 'dirt on the floor is found (and taken away)');
  console.log(`discovery: covered hole → ${st.found.length ? 'found' : 'unnoticed'}; dirt on the floor → ${st.lockdown ? 'LOCKDOWN' : 'nothing'}`);
}
{
  // Seen at work.
  const sim = new Sim(CENTER_PERKS, 8);
  const st = sim.state;
  const g = quiet(sim);
  stand(sim, 12, 21, NORTH);
  plant(g, 16, 22, 9);
  g.doing = 0;
  carry(sim, 'plastic_fork');
  const ev = use(sim);
  check(st.lockdown && ev.some((e) => e.type === 'spotted' && e.reason === 'tampering'), 'a guard who sees a strike raises the alarm');
  console.log(`seen at work: heat ${st.heat}${st.lockdown ? ', LOCKDOWN' : ''}`);
}
{
  // On the roof: seen from the roll call yard, not from inside.
  const sim = new Sim(CENTER_PERKS, 9);
  const st = sim.state;
  const g = quiet(sim);
  stand(sim, 25, 12, EAST, LAYER.ROOF);
  plant(g, 22, 13, 1);
  g.doing = 0;
  sim.step(command(0));
  const inside = st.heat;
  plant(g, 30, 12, 9);
  g.doing = 0;
  sim.step(command(0));
  console.log(`roof: a guard indoors → heat ${inside}; a guard in the yard → heat ${st.heat}`);
  check(inside === 0 && st.heat === 100, 'only a guard in the open sees the roof');
}

// ------------------------------------------------------------------ pockets, reserved floor, the grate over the toilet
{
  const sim = new Sim(NO_GUARDS, 10);
  const st = sim.state;
  // The last blow with full pockets would drop the chunk at the player's feet: refused.
  stand(sim, 8, 7, NORTH);
  carry(sim, 'sturdy_pickaxe', 'sock', 'sock', 'sock', 'sock', 'sock');
  st.wear[6 * MAP_W + 8] = 90;
  const ev = use(sim);
  check(ev.some((e) => e.type === 'cantStrike' && e.why === 'full') && st.wear[6 * MAP_W + 8] === 90, 'full pockets: the last blow waits for room');
  // Nobody digs where people must stand: beside beds and desks, at cell doors, at the ladder's foot.
  const places = placesOf(sim.world);
  carry(sim, 'sturdy_shovel');
  const side = places.deskside[1];
  stand(sim, side % MAP_W, Math.floor(side / MAP_W) - 1, SOUTH);
  const before = sim.world.ground.kind[side];
  for (let k = 0; k < 40; k++) use(sim);
  check(sim.world.ground.kind[side] === before, 'no tunnel entrance beside a desk');
  // Under the open grate the action button climbs; facing the toilet from beside it, it flushes.
  stand(sim, 9, 9, NORTH);
  carry(sim, 'nail_file', 'dirt');
  strikeUntil(sim, 'nail_file', () => kindAt(sim, LAYER.VENTS, 9, 9) === TILE.GRATE_OPEN);
  sim.step(command(0, OP.SELECT, 1));
  stand(sim, 10, 9, SOUTH);
  const flush = interact(sim);
  stand(sim, 9, 9, EAST);
  const climb = interact(sim);
  console.log(`beside the toilet: ${flush.some((e) => e.type === 'flushed') ? 'flushed' : '-'}; on the grate: ${climb.some((e) => e.type === 'layer') ? 'climbed' : '-'}`);
  check(flush.some((e) => e.type === 'flushed') && climb.some((e) => e.type === 'layer'), 'the toilet faced flushes, the grate overhead climbs');
}

// ------------------------------------------------------------------ second review: tapping at the dig face, hiding out a lockdown, chokepoints
{
  const sim = new Sim(NO_GUARDS, 11);
  const st = sim.state;
  // Down the desk tunnel; tap (fresh presses) on at the face: never up through the floor.
  stand(sim, 9, 7, EAST);
  carry(sim, 'sturdy_shovel');
  strikeUntil(sim, 'sturdy_shovel', () => kindAt(sim, LAYER.GROUND, 10, 7) === TILE.SHAFT);
  interact(sim);
  interact(sim, 1);
  st.player.facing = NORTH;
  for (let k = 0; k < 80; k++) sim.step(command(0, OP.USE, 1));
  check(st.layer === LAYER.UNDER && kindAt(sim, LAYER.UNDER, 10, 6) === TILE.TUNNEL && !Object.keys(st.wear).length, 'tapping on after breaking through never digs up');
  console.log(`tapping at the face: ${st.layer === LAYER.UNDER ? 'still below' : 'SURFACED'}`);
}
{
  // A lockdown while the player stays below: called off after an hour, found damage repaired, heat kept.
  const sim = new Sim(CENTER_PERKS, 12);
  const st = sim.state;
  for (const g of st.guards) g.wait = 100000;
  stand(sim, 10, 5, NORTH, LAYER.UNDER);
  st.heat = 100;
  st.lockdown = true;
  st.found = [];
  let gaveUp = -1;
  for (let k = 0; k < 70 * STEPS_PER_MINUTE && gaveUp < 0; k++) {
    sim.step(command(0));
    if (sim.events.some((e) => e.type === 'gaveUp')) gaveUp = k;
  }
  console.log(`hiding out a lockdown: called off after ${Math.round(gaveUp / STEPS_PER_MINUTE)} min, heat ${st.heat}`);
  check(gaveUp > 0 && !st.lockdown && st.heat >= 80, 'a lockdown spent below is called off after an hour; the heat stays');
}
{
  const sim = new Sim(NO_GUARDS, 13);
  const w = sim.world;
  // Inside the cell block's only door and in front of the gym door: no holes there.
  const blockedSpots = [13 * MAP_W + 25, 23 * MAP_W + 10, 23 * MAP_W + 19].filter((i) => {
    const before = w.ground.kind[i];
    stand(sim, i % MAP_W, Math.floor(i / MAP_W) - 1, SOUTH);
    carry(sim, 'sturdy_shovel');
    for (let k = 0; k < 30; k++) use(sim);
    return w.ground.kind[i] === before;
  });
  check(blockedSpots.length === 3, 'no tunnel entrances on chokepoints or at doors');
  console.log(`chokepoints kept clear: ${blockedSpots.length}/3`);
}
