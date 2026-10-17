/**
 * Guard dogs (P19), rule by rule:
 * - the data: Shankton's Brutus (Duffy), San Pancho's Canela (Ríos) and Bandido (Ochoa),
 *   Irongate's Admiral (Hask); each kennel on open floor a guard can walk to, a night dog's
 *   handler on a night round, names unique in the prison; no dogs anywhere else;
 * - shifts: in the kennel all of day 1 (the escape bots' day), at the handler's heel from day 2
 *   10:00 to 22:00, 01:00–05:00 too for the night dogs, and in every lockdown; back to the
 *   kennel off shift; a run logged before the dogs keeps them there;
 * - the nose: contraband in the hotbar within SNIFF_RANGE and a clear line: pointing, a bark
 *   (noise), +SNIFF_HEAT, the handler sent to look; not again for SNIFF_AGAIN; a pouch in the
 *   hotbar keeps the smell in, a guard's uniform doesn't; nothing legal smells; a dog with
 *   TRUST_IGNORE trust lets it go; the paw on the HUD (noseFor) is on before every sniff;
 * - the trail: laid out of bounds only (after hours out of the cell, staff areas, wanted, a
 *   lockdown), one entry a tile, SCENT_TILES at most, gone after SCENT_STEPS; soap washes it
 *   off (and is used up; with nothing to wash, it keeps), so does a shower;
 * - tracking: a dog beside the trail follows it to its end; there it finds the way the player
 *   went (a shaft, a grate, a hole in a wall: covered or not), damage found, the alarm, every
 *   guard told where; or the player, pointed at; a trail washed off is lost; a friend never
 *   follows the player; in a lockdown any dog on shift sets off along it;
 * - treats: jerky thrown by a dog is eaten (+TREAT_TRUST, once a day: a second one stays on
 *   the floor), pepper sets it sneezing DAZE_STEPS (the trail gone), sleepy jerky puts it to
 *   sleep for DOG_SLEEP_STEPS (it smells nothing meanwhile); dogs prisons stock jerky and pepper
 *   on the canteen counters at 08:00 from day 2 and pills in the desk pillsDesk() names;
 * - saves: saved and loaded mid-trail the game plays on the same; a save from before the dogs
 *   loads them in their kennels.
 */
import { itemNumber } from '../src/content/items';
import { PRISONS } from '../src/content/prisons';
import { IRONGATE } from '../src/content/prisons/irongate';
import { SAN_PANCHO } from '../src/content/prisons/san-pancho';
import { SHANKTON } from '../src/content/prisons/shankton';
import { TRAINING } from '../src/content/prisons/training';
import type { PrisonDef } from '../src/content/prisons/types';
import { pathTo } from '../src/sim/ai/path';
import { lineOfSight } from '../src/sim/ai/sight';
import { command, EXT, OP, SLOT } from '../src/sim/command';
import { Sim, type SimEvent, type Snapshot } from '../src/sim/Sim';
import { clockAt } from '../src/sim/systems/clock';
import { GUARD } from '../src/sim/systems/guards';
import { itemOf, slot } from '../src/sim/systems/items';
import { DOG, dogDef, dogWarning, handlersOf, noseFor, onShift, outOfBounds, pillsDesk, smellsOfContraband } from '../src/sim/systems/k9';
import { FEAT } from '../src/sim/systems/ledger';
import { tossArgs } from '../src/sim/command';
import { DAZE_STEPS, DOG_SLEEP_STEPS, SCENT_STEPS, SCENT_TILES, SNIFF_AGAIN, SNIFF_HEAT, SNIFF_RANGE, STEPS_PER_MINUTE, TREAT_TRUST, TRUST_FRIEND, TRUST_IGNORE, UNIT } from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { TILE } from '../src/sim/world/tiles';
import { LAYER, MAP_W, placeKey } from '../src/sim/world/World';
import { setTile } from '../src/sim/systems/watch';
import { ROUTINE } from '../src/content/routine';
import { check } from './assert';

const DOGS: Record<string, string[]> = { shankton: ['Brutus'], 'san-pancho': ['Canela', 'Bandido'], irongate: ['Admiral'] };
const n = (id: string) => itemNumber(id);
const tileOf = (b: { x: number; z: number }) => Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);
const put = (b: { x: number; z: number }, x: number, z: number) => {
  b.x = x;
  b.z = z;
};
const putTile = (b: { x: number; z: number }, t: number) => put(b, (t % MAP_W) * UNIT + UNIT / 2, Math.floor(t / MAP_W) * UNIT + UNIT / 2);
const hhmm = (step: number) => {
  const c = clockAt(step);
  return `day ${c.day} ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
};
const reload = (sim: Sim, snap: Snapshot) => sim.restore(JSON.parse(JSON.stringify(snap)));

/** A game kept out of trouble: every day quiet, the heat kept at 0 so nobody gives chase; `blind()` has every guard look the other way (out late, nobody minds). */
function game(def: PrisonDef, seed = 5) {
  const sim = new Sim(def, seed);
  sim.state.calendar = [[0, 0, 0]];
  const blind = () => {
    for (const g of sim.state.guards) g.bribed = sim.state.step + 1e7;
  };
  const seen: SimEvent[] = [];
  const step = (cmd = 0, calm = true) => {
    sim.step(cmd);
    seen.push(...sim.events);
    if (calm) {
      sim.state.heat = 0;
      if (sim.state.lockdown) sim.state.lockdown = false;
    }
  };
  /** On to a time: game day, hour, minute (game days start at 08:00). */
  const to = (day: number, hour: number, minute = 0) => {
    const target = (day - 1) * 1440 * STEPS_PER_MINUTE + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
    while (sim.state.step < target) step();
  };
  return { sim, seen, step, to, blind };
}

const dogEvents = (seen: SimEvent[], what: string) => seen.filter((e) => e.type === 'dog' && e.what === what).length;

// ------------------------------------------------------------------ the data
for (const p of [...PRISONS, TRAINING]) {
  const sim = new Sim(p, 1);
  const w = sim.world;
  const names = handlersOf(w).map((h) => p.guards[h].dog!.name);
  check(JSON.stringify(names) === JSON.stringify(DOGS[p.id] ?? []), `${p.id}: dogs ${names.join(', ') || 'none'}`);
  check(sim.state.dogs.length === names.length, `${p.id}: a dog in the state for each`);
  const people = [...p.names, ...p.guards.map((g) => g.name ?? '')];
  handlersOf(w).forEach((h, k) => {
    const def = dogDef(w, k);
    const kennel = def.kennel.z * MAP_W + def.kennel.x;
    check(!w.guardBlock[kennel] && w.ground.kind[kennel] !== TILE.DOOR, `${p.id}: ${def.name}'s kennel on open floor`);
    check(!w.props.some((q) => def.kennel.x >= q.x && def.kennel.x < q.x + q.w && def.kennel.z >= q.z && def.kennel.z < q.z + q.d), `${p.id}: nothing stands on ${def.name}'s kennel`);
    const beat = p.guards[h].beat[0];
    check(pathTo(w, beat.z * MAP_W + beat.x, kennel, undefined, w.guardBlock) !== null, `${p.id}: ${def.name}'s kennel is a walk from its handler's round`);
    if (def.night) check(!!p.guards[h].night, `${p.id}: ${def.name} works nights, so its handler does`);
    check(!people.includes(def.name) && names.filter((x) => x === def.name).length === 1, `${p.id}: ${def.name} is a name of its own`);
    check(tileOf(sim.state.dogs[k].body) === kennel, `${p.id}: ${def.name} starts by its kennel`);
  });
}
console.log('data: Shankton 1 dog, San Pancho 2, Irongate 1; kennels on open floor, a walk from their rounds');

// ------------------------------------------------------------------ shifts
{
  const { sim, to } = game(SAN_PANCHO);
  const at = (k: number) => tileOf(sim.state.dogs[k].body);
  const kennel = (k: number) => dogDef(sim.world, k).kennel.z * MAP_W + dogDef(sim.world, k).kennel.x;
  const near = (k: number) => {
    const d = sim.state.dogs[k].body;
    const g = sim.state.guards[handlersOf(sim.world)[k]].body;
    return Math.hypot(d.x - g.x, d.z - g.z) / UNIT;
  };
  let still = true;
  for (const [h, m] of [
    [11, 0],
    [15, 0],
    [21, 0],
    [23, 30],
    [3, 0],
    [7, 59],
  ] as const) {
    to(1, h, m);
    still &&= sim.state.dogs.every((d, k) => tileOf(d.body) === kennel(k) && d.mode === DOG.KENNEL);
  }
  check(still, 'day 1: every dog in its kennel, all day and night');
  to(2, 10, 30);
  check(sim.state.dogs.every((d) => d.mode === DOG.HEEL), 'day 2 10:30: both dogs on shift');
  let heel = 0;
  let samples = 0;
  for (let m = 0; m < 300; m++) {
    to(2, 10, 31 + Math.floor(m / 60) * 60 + (m % 60));
    if (m < 30) continue;
    samples += 2;
    if (near(0) < 3) heel++;
    if (near(1) < 3) heel++;
  }
  check(heel >= samples * 0.9, `on shift a dog keeps by its handler (within 3 tiles ${heel}/${samples} of the time)`);
  to(2, 22, 30);
  check(at(0) === kennel(0) && at(1) === kennel(1) && sim.state.dogs.every((d) => d.mode === DOG.KENNEL), '22:30: back in the kennels');
  to(2, 2, 0);
  check(at(0) === kennel(0) && sim.state.dogs[1].mode === DOG.HEEL, '02:00: Bandido on the night shift, Canela asleep in her kennel');
  to(2, 5, 30);
  check(sim.state.dogs[1].mode === DOG.KENNEL, '05:30: the night shift over');
  // A lockdown calls them all out, at any hour.
  sim.state.lockdown = true;
  sim.state.heat = 100;
  sim.step(0);
  check(sim.state.dogs.every((d) => d.mode !== DOG.KENNEL), 'a lockdown at 05:30: every dog out');
  // A run logged before the dogs came: they stay in.
  const old = new Sim(SAN_PANCHO, 5);
  old.noDogs = true;
  old.state.calendar = [[0, 0, 0]];
  while (old.state.step < 1440 * STEPS_PER_MINUTE + 4 * 60 * STEPS_PER_MINUTE) {
    old.step(0);
    old.state.heat = 0;
  }
  check(old.state.dogs.every((d, k) => tileOf(d.body) === kennel(k)) && !onShift(old, dogDef(old.world, 0)), 'a run logged before the dogs: they never leave the kennel');
  console.log('shifts: kennel on day 1; at the heel 10:00–22:00 from day 2, nights 01:00–05:00 for night dogs, every lockdown');
}

// ------------------------------------------------------------------ the nose
/** A game at day 2 11:00 with the player standing by the first dog (it at its handler's heel). */
function byDog(def: PrisonDef, items: Array<[number, number]>, seed = 5) {
  const g = game(def, seed);
  g.to(2, 11, 0);
  g.blind();
  const sim = g.sim;
  const it = sim.state.items;
  it.inv.fill(0);
  for (const [k, v] of items) it.inv[k] = v;
  it.hand = 0;
  it.rev++;
  g.seen.length = 0;
  /** The player stood half a tile from the dog (a clear line), for one step. */
  const stand = () => {
    const d = sim.state.dogs[0].body;
    for (const [ox, oz] of [
      [UNIT / 2, 0],
      [-UNIT / 2, 0],
      [0, UNIT / 2],
      [0, -UNIT / 2],
    ]) {
      const x = d.x + ox;
      const z = d.z + oz;
      if (!sim.world.block[Math.floor(z / UNIT) * MAP_W + Math.floor(x / UNIT)] && lineOfSight(sim.world, d.x, d.z, x, z)) {
        put(sim.state.player, x, z);
        sim.state.layer = LAYER.GROUND;
        return;
      }
    }
  };
  return { ...g, stand };
}

{
  const screwdriver = slot(n('screwdriver'), 25);
  // Contraband in the hotbar (not in hand): the dog smells it.
  {
    const { sim, seen, step, stand } = byDog(SHANKTON, [[2, screwdriver]]);
    const handler = sim.state.guards[handlersOf(sim.world)[0]];
    stand();
    check(noseFor(sim, 0) && smellsOfContraband(sim), 'the paw: Brutus could smell the screwdriver');
    step(0, false);
    check(dogEvents(seen, 'sniff') === 1 && seen.some((e) => e.type === 'spotted' && e.reason === 'sniffed'), 'a screwdriver in the hotbar: Brutus smells it (and the player is spotted)');
    check(sim.state.heat === SNIFF_HEAT, `+${SNIFF_HEAT} heat (${sim.state.heat})`);
    check(seen.some((e) => e.type === 'noise' && e.kind === 'bark'), 'he barks: a noise');
    check(sim.state.dogs[0].mode === DOG.POINT && handler.mode === GUARD.INVESTIGATE && handler.target === tileOf(sim.state.player), 'he points; Duffy comes to look where the player stands');
    seen.length = 0;
    for (let k = 0; k < SNIFF_AGAIN - 5; k++) {
      stand();
      step();
    }
    check(dogEvents(seen, 'sniff') === 0, 'not again for a while');
    for (let k = 0; k < 10 && !dogEvents(seen, 'sniff'); k++) {
      stand();
      step();
    }
    check(dogEvents(seen, 'sniff') === 1, `again after ${SNIFF_AGAIN / 20} s`);
  }
  // A pouch in the hotbar keeps the smell in; a guard's uniform fools no dog; legal things smell of nothing.
  {
    const { seen, step, stand } = byDog(SHANKTON, [
      [2, screwdriver],
      [3, slot(n('pouch'), 20)],
    ]);
    for (let k = 0; k < 40; k++) {
      stand();
      step();
    }
    check(dogEvents(seen, 'sniff') === 0, 'a pouch in the hotbar: nothing smelled');
  }
  {
    const { sim, seen, step, stand } = byDog(SHANKTON, [[2, screwdriver]]);
    sim.state.items.inv[SLOT.OUTFIT] = slot(n('guard_outfit'));
    stand();
    step();
    check(dogEvents(seen, 'sniff') === 1, 'in a guard\'s uniform: smelled all the same');
  }
  {
    const { seen, step, stand } = byDog(SHANKTON, [
      [2, slot(n('soap'))],
      [3, slot(n('jerky'))],
    ]);
    for (let k = 0; k < 40; k++) {
      stand();
      step();
    }
    check(dogEvents(seen, 'sniff') === 0, 'soap and jerky: nothing to smell');
  }
  {
    const { sim, seen, step, stand } = byDog(SHANKTON, [[2, screwdriver]]);
    sim.state.dogs[0].trust = TRUST_IGNORE;
    for (let k = 0; k < 40; k++) {
      stand();
      step();
    }
    check(dogEvents(seen, 'sniff') === 0 && !noseFor(sim, 0), `trust ${TRUST_IGNORE}: Brutus lets it go (and the paw says so)`);
  }
  // The paw is on before every sniff: the player wandering about the dog with a screwdriver.
  {
    const { sim, seen, step } = byDog(SAN_PANCHO, [[2, screwdriver]]);
    let sniffs = 0;
    let warned = true;
    const home = { x: sim.prison.spawn.x * UNIT + UNIT / 2, z: sim.prison.spawn.z * UNIT + UNIT / 2 };
    for (let k = 0; k < 6000; k++) {
      const d = sim.state.dogs[k % 2].body;
      if (k % 7 === 0) put(sim.state.player, d.x + ((k * 37) % 5) * 400 - 800, d.z + ((k * 53) % 5) * 400 - 800);
      // (Only where the player may be: somewhere staff only they'd leave a trail, and the dogs would follow that instead.)
      if (sim.world.block[tileOf(sim.state.player)] || outOfBounds(sim)) put(sim.state.player, home.x, home.z);
      // (The HUD's own warning: the paw lit before the step.)
      const paw = dogWarning(sim) !== null;
      seen.length = 0;
      step();
      for (const e of seen)
        if (e.type === 'dog' && e.what === 'sniff') {
          sniffs++;
          warned &&= paw;
        }
    }
    check(sniffs > 3 && warned, `the paw was on before each of ${sniffs} sniffs`);
  }
  // The paw at a shift's start: a dog smelling the player from its kennel as it comes on shift is warned of a step ahead.
  {
    const g = game(SAN_PANCHO);
    g.to(2, 9, 59);
    g.blind();
    const sim = g.sim;
    sim.state.items.inv[2] = slot(n('lighter'));
    let warned = true;
    let sniffs = 0;
    for (let k = 0; k < 200; k++) {
      const d = sim.state.dogs[0].body;
      put(sim.state.player, d.x + 300, d.z);
      const paw = dogWarning(sim) !== null;
      g.seen.length = 0;
      g.step();
      for (const e of g.seen)
        if (e.type === 'dog' && e.what === 'sniff') {
          sniffs++;
          warned &&= paw;
        }
    }
    check(sniffs >= 1 && warned, `at 10:00 by the kennel: the paw lit before the sniff (${sniffs})`);
  }
  console.log(`nose: contraband in the hotbar within ${SNIFF_RANGE / UNIT} tiles → a bark, +${SNIFF_HEAT}%, the handler looks; a pouch stops it, a uniform doesn't; trust ${TRUST_IGNORE}+ lets it go`);
}

// ------------------------------------------------------------------ the trail
{
  let { sim, seen, step, to, blind } = game(SHANKTON);
  to(1, 23, 30);
  blind();
  // In the cell after Lights Out: nothing laid. Out of it, a tile at a time.
  check(sim.playerZone === 'playerCell' || !outOfBounds(sim), 'in the cell at night: in bounds');
  step();
  check(sim.state.scent.length === 0, 'in the cell: no trail');
  putTile(sim.state.player, 15 + 25 * MAP_W);
  step();
  check(outOfBounds(sim) && sim.state.scent.length === 0, 'day 1: no dogs at work, no trail laid yet');
  // (A game of its own: the player left out in the corridor all day 1 would be in trouble by now.)
  ({ sim, seen, step, to, blind } = game(SHANKTON));
  to(2, 23, 30);
  blind();
  putTile(sim.state.player, 20 + 25 * MAP_W);
  sim.state.scent = [];
  for (let x = 15; x < 55; x++) {
    putTile(sim.state.player, x + 25 * MAP_W);
    step();
    step();
  }
  const laid = sim.state.scent.length;
  check(laid === SCENT_TILES && sim.state.scent.every((e, k, a) => k === 0 || (e[1] > a[k - 1][1] && e[0] !== a[k - 1][0])), `out late in the corridor: one entry a tile, ${laid} at most`);
  const where = tileOf(sim.state.player);
  for (let k = 0; k < SCENT_STEPS + 5; k++) step();
  // (Standing still out there, only the tile underfoot stays fresh: laid again as the old scent fades.)
  check(sim.state.scent.length === 1 && sim.state.scent[0][0] === where && sim.state.step - sim.state.scent[0][1] < 10, `the trail fades after ${SCENT_STEPS / 20} s (but for the tile underfoot)`);
  // Soap washes it off and is used up; with nothing to wash it keeps.
  putTile(sim.state.player, 30 + 25 * MAP_W);
  step();
  putTile(sim.state.player, 31 + 25 * MAP_W);
  step();
  const it = sim.state.items;
  it.inv.fill(0);
  it.inv[0] = slot(n('soap'));
  it.hand = 0;
  seen.length = 0;
  const before = sim.state.scent.length;
  step(command(0, OP.USE, 1));
  // (Still out late, the tile underfoot is laid again at once.)
  check(before >= 2 && sim.state.scent.length === 1 && sim.state.scent[0][1] === sim.state.step && it.inv[0] === 0 && seen.some((e) => e.type === 'washed'), 'soap: the trail washed off, the soap used up');
  it.inv[0] = slot(n('soap'));
  seen.length = 0;
  sim.state.layer = LAYER.GROUND;
  putTile(sim.state.player, 31 + 25 * MAP_W);
  sim.state.scent = [];
  step(command(0, OP.USE, 1));
  check(itemOf(it.inv[0]) === n('soap') && seen.some((e) => e.type === 'cantStrike' && e.why === 'noScent'), 'nothing to wash off: the soap keeps');
  check(sim.state.feats[FEAT.washed] === 1, 'washing counted');
  // A shower in the showers block washes it off too.
  {
    const g = game(SHANKTON);
    const block = ROUTINE.find((r) => r.id === 'showers')!;
    g.to(2, Math.floor(block.start / 60), (block.start % 60) + 1);
    g.blind();
    const head = [...g.sim.showerTiles][0];
    putTile(g.sim.state.player, head);
    g.sim.state.scent = [[head - 1, g.sim.state.step - 5]];
    g.seen.length = 0;
    g.step();
    check(g.sim.state.scent.length === 0 && g.seen.some((e) => e.type === 'washed'), 'a shower: the trail washed off');
  }
  console.log(`trail: out of bounds only, a tile at a time, ${SCENT_TILES} tiles at most, ${SCENT_STEPS / 20} s fresh; soap and showers wash it off`);
}

/** Shankton at 02:00 in prison day 2's night (Brutus on his night shift at Duffy's heel), the trail laid by hand along `tiles` (fresh). */
function tracking(tiles: number[], seed = 5) {
  const g = game(SHANKTON, seed);
  g.to(2, 2, 0);
  g.blind();
  const sim = g.sim;
  const d = sim.state.dogs[0];
  // The player somewhere out of the way (the cell), the trail starting by the dog.
  sim.state.layer = LAYER.UNDER;
  sim.state.scent = tiles.map((t, k) => [t, sim.state.step - tiles.length + k]);
  putTile(d.body, tiles[0]);
  d.goal = -1;
  d.path = [];
  g.seen.length = 0;
  return { ...g, d };
}

{
  // A trail along the corridor, up to the wall and through a hole hidden behind a poster: Brutus finds it.
  const row = Array.from({ length: 12 }, (_, k) => 22 + k + 25 * MAP_W);
  const hole = 33 + 23 * MAP_W;
  {
    const { sim, seen, step, d } = tracking([...row, 33 + 24 * MAP_W, hole, 33 + 22 * MAP_W]);
    setTile(sim, LAYER.GROUND, hole, TILE.HOLE_POSTER);
    let k = 0;
    for (; k < 2000 && !dogEvents(seen, 'dug'); k++) step(0, false);
    check(dogEvents(seen, 'track') === 1, 'Brutus picks up the trail beside him');
    check(dogEvents(seen, 'dug') === 1 && sim.state.found.includes(placeKey(LAYER.GROUND, hole)), `he follows it to the hole behind the poster: found (${(k / 20).toFixed(1)} s)`);
    check(sim.state.lockdown && sim.state.guards.every((g) => g.lastSeen === 33 + 24 * MAP_W), 'the alarm goes, and every guard knows where');
    check(d.mode === DOG.POINT, 'he stands barking at it');
  }
  // Up through a grate behind a fake vent at the trail's end (the trail marks where the player left the floor): found too, covers fool no dog.
  {
    const end = row[row.length - 1];
    const { sim, seen, step } = tracking(row);
    sim.state.scent[sim.state.scent.length - 1][2] = 1;
    sim.world.setKind(LAYER.VENTS, end, TILE.GRATE_FAKE);
    sim.state.tiles[placeKey(LAYER.VENTS, end)] = TILE.GRATE_FAKE;
    for (let k = 0; k < 2000 && !dogEvents(seen, 'dug'); k++) step(0, false);
    check(sim.state.found.includes(placeKey(LAYER.VENTS, end)), 'a fake vent over the trail\'s end, where the player left the floor: found');
  }
  // The same grate beside a trail that ends with the player simply back in bounds: nothing found.
  {
    const end = row[row.length - 1];
    const { sim, seen, step } = tracking(row);
    sim.world.setKind(LAYER.VENTS, end + 1 + MAP_W, TILE.GRATE_FAKE);
    sim.state.tiles[placeKey(LAYER.VENTS, end + 1 + MAP_W)] = TILE.GRATE_FAKE;
    for (let k = 0; k < 2000 && !dogEvents(seen, 'lost'); k++) step();
    check(sim.state.found.length === 0 && dogEvents(seen, 'lost') === 1, 'a grate by a trail that just ends: not the dog\'s business');
  }
  // The handler knocked out while his dog is on the trail: it gives up and stays by him.
  {
    const { sim, seen, step, d } = tracking([...row, 33 + 24 * MAP_W, hole, 33 + 22 * MAP_W]);
    setTile(sim, LAYER.GROUND, hole, TILE.HOLE_POSTER);
    for (let k = 0; k < 10; k++) step(0, false);
    sim.state.guards[handlersOf(sim.world)[0]].ko = 1e6;
    for (let k = 0; k < 2000; k++) step(0, false);
    check(dogEvents(seen, 'dug') === 0 && d.mode === DOG.HEEL, 'its handler out cold: Brutus leaves the trail');
  }
  // Nothing there at its end: lost.
  {
    const { seen, step, d } = tracking(row);
    for (let k = 0; k < 2000 && !dogEvents(seen, 'lost'); k++) step();
    check(dogEvents(seen, 'lost') === 1 && d.mode === DOG.HEEL, 'a trail that ends nowhere: lost, back to the heel');
  }
  // The player at its end: pointed at.
  {
    const { sim, seen, step } = tracking(row);
    sim.state.layer = LAYER.GROUND;
    putTile(sim.state.player, row[row.length - 1]);
    for (let k = 0; k < 2000 && !dogEvents(seen, 'point'); k++) {
      putTile(sim.state.player, row[row.length - 1]);
      step();
    }
    check(dogEvents(seen, 'point') === 1, 'the player at the trail\'s end: Brutus points at them');
  }
  // Washed off on the way: lost. A friend never follows it.
  {
    const { sim, seen, step } = tracking(row);
    for (let k = 0; k < 30; k++) step();
    sim.state.scent = [];
    for (let k = 0; k < 5; k++) step();
    check(dogEvents(seen, 'lost') === 1 && !dogEvents(seen, 'dug'), 'the trail washed off under his nose: lost');
  }
  {
    const { sim, seen, step, d } = tracking(row);
    d.trust = TRUST_FRIEND;
    for (let k = 0; k < 400; k++) step();
    check(dogEvents(seen, 'track') === 0 && sim.state.found.length === 0, 'a friend never follows the player\'s trail');
  }
  // Saved and loaded on the trail: the game plays on the same.
  {
    const a = tracking(row);
    for (let k = 0; k < 40; k++) a.step(0, false);
    const snap = a.sim.snapshot();
    const b = new Sim(SHANKTON, 5);
    reload(b, snap);
    for (let k = 0; k < 600; k++) {
      a.sim.step(0);
      b.step(0);
    }
    check(a.sim.hash() === b.hash(), 'saved and loaded on the trail: the same game after');
  }
  // In a lockdown a dog on shift sets off along the trail from wherever it is.
  {
    const { sim, seen, step, d } = tracking(row);
    putTile(d.body, 20 + 38 * MAP_W);
    sim.state.lockdown = true;
    sim.state.heat = 100;
    for (let k = 0; k < 5; k++) step(0, false);
    check(dogEvents(seen, 'track') === 1, 'a lockdown: Brutus sets off along the trail from across the prison');
  }
  console.log('tracking: beside the trail a dog follows it to its end: the way the player went (cover or no cover: found, the alarm), the player, or lost');
}

// ------------------------------------------------------------------ treats
{
  const throwTo = (sim: Sim, item: number) => {
    const it = sim.state.items;
    it.inv.fill(0);
    it.inv[0] = slot(item);
    it.hand = 0;
    const d = sim.state.dogs[0].body;
    const t = tileOf(d);
    // From a tile 3 to 5 across, with a clear line.
    for (const [ox, oz] of [
      [3, 0],
      [-3, 0],
      [0, 3],
      [0, -3],
      [4, 0],
      [-4, 0],
      [3, 3],
      [-3, -3],
    ]) {
      const from = t + ox + oz * MAP_W;
      if (sim.world.block[from]) continue;
      putTile(sim.state.player, from);
      sim.state.layer = LAYER.GROUND;
      if (!lineOfSight(sim.world, sim.state.player.x, sim.state.player.z, d.x, d.z)) continue;
      const [b, c] = tossArgs(t);
      return command(0, OP.EXT, EXT.THROW, b, c);
    }
    throw new Error('nowhere to throw from');
  };
  const { sim, seen, step, to, blind } = game(SAN_PANCHO);
  to(2, 11, 0);
  blind();
  const d = sim.state.dogs[0];
  step(throwTo(sim, n('jerky')));
  check(dogEvents(seen, 'fed') === 1 && d.trust === TREAT_TRUST && sim.state.items.inv[0] === 0, `jerky for Canela: eaten, trust ${d.trust}`);
  const grounded = sim.state.items.ground.length;
  seen.length = 0;
  step(throwTo(sim, n('jerky')));
  check(dogEvents(seen, 'full') === 1 && d.trust === TREAT_TRUST && sim.state.items.ground.length === grounded + 1, 'a second the same day: she\'s had hers, it stays on the floor');
  to(3, 11, 0);
  blind();
  step(throwTo(sim, n('jerky')));
  check(d.trust === TREAT_TRUST * 2, `the next day: trust ${d.trust}`);
  d.trust = TRUST_FRIEND - TREAT_TRUST;
  to(4, 11, 0);
  blind();
  seen.length = 0;
  step(throwTo(sim, n('jerky')));
  check(d.trust === TRUST_FRIEND && dogEvents(seen, 'friend') === 1 && sim.state.feats[FEAT.dogFriends] === 1, 'trust at its most: a friend');
  // Pepper: sneezing on the spot, the trail gone.
  const stamp = sim.state.step - 3;
  sim.state.scent = [[tileOf(d.body), stamp]];
  seen.length = 0;
  step(throwTo(sim, n('pepper')));
  const gone = !sim.state.scent.some((e) => e[1] === stamp);
  const pos = [d.body.x, d.body.z];
  for (let k = 0; k < DAZE_STEPS - 10; k++) step();
  check(dogEvents(seen, 'dazed') === 1 && gone && d.body.x === pos[0] && d.body.z === pos[1], `pepper: Canela sneezes ${DAZE_STEPS / 20} s on the spot, the trail gone`);
  // Sleepy jerky: asleep, smelling nothing.
  const other = new Sim(SAN_PANCHO, 5);
  const g2 = game(SAN_PANCHO);
  g2.to(2, 11, 0);
  g2.blind();
  g2.step(throwTo(g2.sim, n('sleepy_jerky')));
  check(dogEvents(g2.seen, 'asleep') === 1, 'sleepy jerky: asleep');
  const it = g2.sim.state.items;
  it.inv[2] = slot(n('screwdriver'), 25);
  let sniffed = 0;
  for (let k = 0; k < DOG_SLEEP_STEPS - 20; k++) {
    if (k % 20 === 0) put(g2.sim.state.player, g2.sim.state.dogs[0].body.x + 300, g2.sim.state.dogs[0].body.z);
    g2.step();
  }
  sniffed = g2.seen.filter((e) => e.type === 'dog' && e.what === 'sniff' && e.dog === 0).length;
  for (let k = 0; k < 40; k++) g2.step();
  check(sniffed === 0 && dogEvents(g2.seen, 'woke') === 1, `${DOG_SLEEP_STEPS / STEPS_PER_MINUTE / 60} game hours asleep, smelling nothing; then awake`);
  void other;
  console.log(`treats: jerky +${TREAT_TRUST} trust once a day (a friend at ${TRUST_FRIEND}), pepper ${DAZE_STEPS / 20} s of sneezing, sleepy jerky ${DOG_SLEEP_STEPS / STEPS_PER_MINUTE / 60} h asleep`);
}

// ------------------------------------------------------------------ where they come from
{
  for (const p of [SHANKTON, SAN_PANCHO, IRONGATE, PRISONS[0]]) {
    const { sim, to } = game(p);
    const list = containersOf(sim.world);
    const counters = list.map((c, i) => [c, i] as const).filter(([c]) => c.table === 'canteenCounter');
    const has = (i: number, id: string) => sim.state.items.containers[i].some((v) => itemOf(v) === n(id));
    to(1, 9, 0);
    const day1 = counters.some(([, i]) => has(i, 'jerky') || has(i, 'pepper'));
    to(2, 9, 0);
    const desk = pillsDesk(sim);
    if (DOGS[p.id]) {
      check(!day1 && counters.length > 0 && counters.every(([, i]) => has(i, 'jerky') && has(i, 'pepper')), `${p.id}: jerky and pepper on every canteen counter from day 2 (not before)`);
      check(desk >= 0 && has(desk, 'sleeping_pills'), `${p.id}: sleeping pills in the desk pillsDesk() names`);
    } else check(desk < 0 && !counters.some(([, i]) => has(i, 'jerky')), `${p.id}: no dogs, no treats`);
  }
  // A run logged before the dogs: no treats either (its containers as they were).
  const old = new Sim(SAN_PANCHO, 5);
  old.noDogs = true;
  old.state.calendar = [[0, 0, 0]];
  while (old.state.step < 1440 * STEPS_PER_MINUTE + 60 * STEPS_PER_MINUTE) {
    old.step(0);
    old.state.heat = 0;
  }
  check(!old.state.items.containers.some((c) => c.some((v) => [n('jerky'), n('pepper'), n('sleeping_pills')].includes(itemOf(v)))), 'a run logged before the dogs: no treats stocked');
  console.log('treats: on the canteen counters at 08:00 from day 2 where there are dogs, and the pills in one desk');
}

// ------------------------------------------------------------------ an old save
{
  const sim = new Sim(IRONGATE, 3);
  const snap = sim.snapshot();
  const st = snap.state as unknown as Record<string, unknown>;
  delete st.dogs;
  delete st.scent;
  const b = new Sim(IRONGATE, 9);
  reload(b, snap);
  check(b.state.dogs.length === 1 && b.state.dogs[0].mode === DOG.KENNEL && tileOf(b.state.dogs[0].body) === 51 + 45 * MAP_W && b.state.scent.length === 0, 'a save from before the dogs: Admiral in his kennel, no trail');
  console.log('saves: an old one loads the dogs in their kennels');
}

void hhmm;
