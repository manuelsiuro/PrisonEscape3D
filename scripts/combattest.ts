/**
 * Combat (GDD §3.1, §10), driven through the real simulation with ordinary commands:
 * - the formulas: damage by Strength, weapon and outfit; swing pace by Speed; health;
 * - lock-on: nearest first, the next, then none;
 * - a fight with an inmate out of sight: it fights back, goes down, its pockets are gone
 *   through, it comes round 30 s later; no heat;
 * - the same blow in a guard's sight: a lockdown;
 * - a wanted player is beaten down by a guard's baton (several blows, not one touch);
 * - the key-thief bot: molten chocolate knocks a guard out silently, its key is kept, the
 *   guard wakes to find it gone: lockdown;
 * - the key-cloner bot: the key pressed into putty and put back in time: no lockdown; the
 *   mold and molten plastic make a plastic key that opens its doors and wears out;
 * - keys and doors: a real key opens its color for the player only (never the perimeter
 *   gate), and sight still stops at the shut door;
 * - shivs sharpened on a wall; an inmate knocking the player out (the infirmary);
 * - a save restored mid-fight plays on exactly the same.
 */
import { itemDef, itemNumber } from '../src/content/items';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { RECIPES } from '../src/content/recipes';
import { canSee } from '../src/sim/ai/sight';
import { command, OP, SLOT } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { clockAt, formatTime } from '../src/sim/systems/clock';
import { damage, GUARD_DEFENSE, INMATE_DEFENSE, lockCandidates, maxHealth, swingSteps } from '../src/sim/systems/combat';
import { GUARD, type Guard } from '../src/sim/systems/guards';
import type { Inmate } from '../src/sim/systems/inmates';
import { benchCheck, HOTBAR, itemOf, maskOf, pocketOf, slot, usesOf } from '../src/sim/systems/items';
import { KO_STEPS, UNIT } from '../src/sim/tuning';
import { KEY, TILE } from '../src/sim/world/tiles';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';

const n = (id: string) => itemNumber(id);
const at = (sim: Sim) => `day ${sim.clock.day} ${formatTime(sim.clock)}`;
const E = 1;
const S = 5;
const W = 9;
const N = 13;

// ------------------------------------------------------------------ the formulas
{
  const rows: string[] = [];
  for (const [label, attack] of [
    ['fists', 0],
    ['comb shiv', itemDef(n('comb_shiv')).attack!],
    ['sock mace', itemDef(n('sock_mace')).attack!],
    ['bat', itemDef(n('bat')).attack!],
    ['baton', itemDef(n('baton')).attack!],
    ['nunchucks', itemDef(n('nunchucks')).attack!],
  ] as const) {
    const hits = (def: number, hp: number) => Math.ceil(hp / damage(40, attack, def));
    rows.push(`${label} ${damage(40, attack, INMATE_DEFENSE)}/${damage(40, attack, GUARD_DEFENSE)} (${hits(INMATE_DEFENSE, maxHealth(45))}/${hits(GUARD_DEFENSE, maxHealth(60))} blows)`);
  }
  console.log(`STR 40 damage vs inmate/guard: ${rows.join(', ')}`);
  const plated = itemDef(n('plated_outfit')).defense!;
  console.log(`a guard's baton on the player: ${damage(60, itemDef(n('baton')).attack!, itemDef(n('inmate_outfit')).defense!)} (plated ${damage(60, itemDef(n('baton')).attack!, plated)}) of ${maxHealth(40)} health`);
  console.log(`swing every ${swingSteps(40, null)} steps at SPD 40, ${swingSteps(100, null)} at 100, ${swingSteps(40, itemDef(n('nunchucks')))} with nunchucks`);
  check(damage(40, 0, INMATE_DEFENSE) > 0 && damage(20, 0, plated) === 1, 'every blow does at least 1');
  check(swingSteps(100, null) < swingSteps(40, null), 'speed swings faster');
  check(maxHealth(40) === 90, 'max health is 50 + STR');
}

// ------------------------------------------------------------------ helpers
/** Puts a body in the middle of a tile. */
function put(b: { x: number; z: number; moving?: boolean }, x: number, z: number) {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
  b.moving = false;
}
/** A guard planted on a tile, looking one way, standing there for a long while. */
function plant(g: Guard, x: number, z: number, facing: number) {
  put(g.body, x, z);
  g.body.facing = g.face = facing;
  g.path = [];
  g.wait = 100000;
  g.mode = GUARD.DUTY;
  g.doing = 0;
}
/** An inmate frozen on a tile (it doesn't wander off unless angered). */
function freeze(m: Inmate, x: number, z: number, facing = S) {
  put(m.body, x, z);
  m.body.facing = facing;
  m.path = [];
  m.goal = -1;
  m.wait = 100000;
}

/**
 * A quiet arena: every guard in the guard quarters looking at the wall, every inmate frozen
 * in its cell, routines attended (the bot is busy fighting).
 */
function arena(seed = 3) {
  const sim = new Sim(CENTER_PERKS, seed);
  const st = sim.state;
  st.guards.forEach((g, k) => plant(g, 40 + k * 2, 40, N));
  st.inmates.forEach((m) => freeze(m, sim.world.def.cells[m.cell - 1][0] + 1, sim.world.def.cells[m.cell - 1][1] + 1));
  const events: SimEvent[] = [];
  const step = (cmd = 0) => {
    st.attended = true;
    sim.step(cmd);
    events.push(...sim.events);
  };
  const op = (o: number, a = 0, b = 0) => step(command(0, o, a, b));
  /** A fresh press of the use button (waits out the swing pace first). */
  const press = () => {
    op(OP.USE, 1);
    for (let k = 0; k < 24; k++) step();
  };
  const give = (id: string, k: number) => {
    st.items.inv[k] = slot(n(id));
    st.items.rev++;
  };
  return { sim, st, events, step, op, press, give };
}

// ------------------------------------------------------------------ lock-on
{
  const { sim, st, op } = arena();
  put(st.player, 30, 30);
  freeze(st.inmates[0], 32, 30);
  freeze(st.inmates[1], 30, 31);
  freeze(st.inmates[2], 34, 30);
  const order = lockCandidates(sim.world, st, st.player);
  op(OP.LOCK);
  const first = st.lock;
  op(OP.LOCK);
  const second = st.lock;
  op(OP.LOCK);
  const third = st.lock;
  op(OP.LOCK);
  console.log(`lock-on: in range ${order.join(', ')}; R → ${first}, ${second}, ${third}, ${st.lock}`);
  check(first === 1 && second === 0 && third === 2 && st.lock === -1, 'lock-on goes nearest first, then the next, then none');
  op(OP.LOCK);
  op(OP.LOCK, 1);
  check(st.lock === -1, 'the lock can be let go');
  // Someone behind a wall can't be locked on to.
  put(st.player, 9, 9);
  freeze(st.inmates[0], 14, 9);
  for (const [k, m] of st.inmates.entries()) if (k) freeze(m, 50, 50 + k);
  op(OP.LOCK);
  check(st.lock === -1, 'nobody through a wall');
}

// ------------------------------------------------------------------ a fight out of sight
{
  const { sim, st, events, step, press, op, give } = arena();
  const m = st.inmates[0];
  put(st.player, 28, 30);
  st.player.facing = E;
  freeze(m, 29, 30, W);
  give('sock_mace', SLOT.WEAPON);
  op(OP.LOCK);
  check(st.lock === 0, 'locked on to the inmate');
  const hp0 = m.hp;
  let blows = 0;
  for (let k = 0; k < 30 && m.ko === 0; k++) {
    press();
    blows = events.filter((e) => e.type === 'hit').length;
  }
  const hurt = events.filter((e) => e.type === 'hurt');
  console.log(`fight: the inmate (STR ${m.str}, ${hp0} health) down in ${blows} blows of the sock mace; it landed ${hurt.length} punches (player ${st.health}/${maxHealth(st.str)}); heat ${st.heat}`);
  check(m.ko > 0 && blows >= 2, 'the inmate goes down after a few blows');
  check(hurt.length > 0 && st.health < 90, 'it fought back');
  check(st.heat === 0 && !st.lockdown, 'no guard saw it: no heat');
  check(st.lock === -1, 'the lock lets go of someone out cold');
  // Its pockets.
  op(OP.INTERACT);
  const pockets = pocketOf(sim.world, 0);
  check(st.items.open === pockets, 'the action button goes through its pockets');
  const had = st.items.containers[pockets].filter(Boolean).map((v) => itemDef(itemOf(v)).id);
  const k = st.items.containers[pockets].findIndex(Boolean);
  if (k >= 0) op(OP.MOVE, SLOT.CONTAINER + k, 0);
  check(k < 0 || !!st.items.inv[0], 'something taken from its pockets');
  console.log(`its pockets: ${had.join(', ') || 'empty'}`);
  // It comes round 30 s after going down.
  const down = st.step;
  while (m.ko > 0 && st.step - down < KO_STEPS + 5) step();
  check(st.step - down <= KO_STEPS && m.ko === 0 && m.hp === maxHealth(m.str), 'it comes round within 30 s, healed');
  check(st.items.open === -1, 'its pockets close when it gets up');
  check(events.some((e) => e.type === 'cameTo' && e.who === 0 && !e.keyMissing), 'and nothing is raised');
}

// ------------------------------------------------------------------ the same blow seen by a guard
{
  const { st, events, press, op } = arena();
  put(st.player, 28, 30);
  freeze(st.inmates[0], 29, 30, W);
  plant(st.guards[3], 28, 26, S);
  op(OP.LOCK);
  press();
  const spotted = events.find((e) => e.type === 'spotted');
  console.log(`seen hitting an inmate: ${spotted?.type === 'spotted' ? spotted.reason : 'nothing'}, heat ${st.heat}, lockdown ${st.lockdown}`);
  check(st.lockdown && spotted?.type === 'spotted' && spotted.reason === 'fight', 'a guard who sees a blow calls a lockdown');
}

// ------------------------------------------------------------------ the baton
{
  const { sim, st, events, step } = arena();
  put(st.player, 28, 30);
  st.heat = 85;
  plant(st.guards[3], 28, 25, S);
  const t0 = st.step;
  for (let k = 0; k < 400 && st.ko === 0; k++) step();
  const blows = events.filter((e) => e.type === 'hurt').length;
  const caught = events.find((e) => e.type === 'caught');
  console.log(`wanted (85%): ${blows} baton blows, down after ${((st.step - t0) / 20).toFixed(1)} s → ${caught?.type === 'caught' ? (caught.solitary ? 'solitary' : 'the infirmary') : 'still up'} (${at(sim)})`);
  check(blows >= 2 && !!caught, 'a guard beats a wanted player down (not one touch)');
  check(caught?.type === 'caught' && !caught.solitary, 'under 90%: the infirmary');
  // Waking up: patched up.
  while (st.ko > 0) step();
  check(st.health === maxHealth(st.str), 'healed on waking');
}

// ------------------------------------------------------------------ the key-thief bot
{
  const { sim, st, events, step, op, give } = arena(5);
  const k = 4;
  const g = st.guards[k];
  const id = st.inmates.length + k;
  const key = n(`key_${sim.world.def.guards[k].key}`);
  put(st.player, 30, 30);
  plant(g, 32, 30, E);
  give('molten_chocolate', SLOT.WEAPON);
  for (const m of st.inmates) freeze(m, 50, 50);
  op(OP.LOCK);
  check(st.lock === id, 'locked on to the guard');
  op(OP.USE, 1);
  check(g.ko > 0 && !st.items.inv[SLOT.WEAPON], 'the molten chocolate knocks the guard out at once');
  check(st.heat === 0, 'its back was turned: nobody saw');
  // Over to it, through its pockets: the key.
  for (let s = 0; s < 6; s++) step(command(E));
  op(OP.INTERACT);
  const pockets = st.items.containers[pocketOf(sim.world, id)];
  const kit = pockets.map((v) => itemDef(itemOf(v))?.id ?? '-').join(', ');
  check(st.items.open === pocketOf(sim.world, id), "the guard's pockets open");
  op(OP.MOVE, SLOT.CONTAINER + pockets.findIndex((v) => itemOf(v) === key), 0);
  check(itemOf(st.items.inv[0]) === key, 'the key is taken');
  // Walk off and wait.
  for (let s = 0; s < 30; s++) step(command(W));
  while (g.ko > 0) step();
  step();
  const raised = events.find((e) => e.type === 'cameTo' && e.who === id);
  console.log(`key thief: guard pockets ${kit}; it wakes at ${at(sim)} missing its key: ${raised?.type === 'cameTo' && raised.keyMissing}, lockdown ${st.lockdown}`);
  check(raised?.type === 'cameTo' && raised.keyMissing && st.lockdown, 'the guard wakes to a missing key: lockdown');
  check(events.some((e) => e.type === 'spotted' && e.reason === 'keyMissing'), 'the alarm says why');
  check(itemOf(st.items.inv[0]) === key, 'the player keeps the key');
}

// ------------------------------------------------------------------ the key-cloner bot
{
  const { sim, st, events, step, op, give } = arena(6);
  const k = 4;
  const g = st.guards[k];
  const id = st.inmates.length + k;
  const color = sim.world.def.guards[k].key;
  const key = n(`key_${color}`);
  st.items.int = 60;
  put(st.player, 30, 30);
  plant(g, 32, 30, E);
  for (const m of st.inmates) freeze(m, 50, 50);
  give('molten_chocolate', 0);
  give('putty', 1);
  give('molten_plastic', 2);
  st.items.hand = 0;
  op(OP.LOCK);
  op(OP.USE, 1);
  check(g.ko > 0, 'a cup of molten chocolate thrown from the hand works too');
  for (let s = 0; s < 6; s++) step(command(E));
  op(OP.INTERACT);
  const pocket = pocketOf(sim.world, id);
  op(OP.MOVE, SLOT.CONTAINER + st.items.containers[pocket].findIndex((v) => itemOf(v) === key), 0);
  // Putty and the key on the workbench: the mold, and the key back.
  const mask = maskOf([0, 1]);
  const { recipe } = benchCheck(st.items, mask);
  op(OP.CRAFT, mask, recipe + 1);
  const moldAt = st.items.inv.findIndex((v) => itemOf(v) === n(`mold_${color}`));
  const keyAt = st.items.inv.findIndex((v) => itemOf(v) === key);
  check(moldAt >= 0 && keyAt >= 0, 'putty + key: a mold, and the key handed back (GDD §8.2)');
  // The key back where it was, before the guard wakes.
  op(OP.MOVE, keyAt, SLOT.CONTAINER + st.items.containers[pocket].indexOf(0));
  const back = st.items.containers[pocket].some((v) => itemOf(v) === key);
  const left = g.ko;
  while (g.ko > 0) step();
  step();
  const woke = events.find((e) => e.type === 'cameTo' && e.who === id);
  console.log(`key cloner: key back with ${(left / 20).toFixed(1)} s to spare: ${back}; guard wakes, key missing ${woke?.type === 'cameTo' && woke.keyMissing}, lockdown ${st.lockdown}`);
  check(back && woke?.type === 'cameTo' && !woke.keyMissing && !st.lockdown, 'the key put back in time: no lockdown');
  // Mold + molten plastic: a plastic key.
  const m2 = maskOf([moldAt, st.items.inv.findIndex((v) => itemOf(v) === n('molten_plastic'))]);
  op(OP.CRAFT, m2, benchCheck(st.items, m2).recipe + 1);
  const plasticAt = st.items.inv.findIndex((v) => itemOf(v) === n(`plastic_key_${color}`));
  check(plasticAt >= 0 && usesOf(st.items.inv[plasticAt]) === 15, 'a plastic key with 15 uses (GDD §7.3)');
  // The real key is back with its guard: only the plastic one opens the door now.
  step();

  // ---------------------------------------------------------------- doors
  // The guard's door (purple: the generator room, from the south corridor).
  const w = sim.world;
  const door = 38 * MAP_W + 10;
  check(w.ground.kind[door] === TILE.DOOR && w.ground.key[door] === KEY[color.toUpperCase() as 'PURPLE'], `the generator room door is ${color}`);
  check(w.block[door] === 0 && w.npcBlock[door] === 1, 'a key opens its door for the player only');
  const eye = { x: 10 * UNIT + UNIT / 2, z: 36 * UNIT + UNIT / 2, facing: S, moving: false };
  check(!canSee(w, eye, { x: 10 * UNIT + UNIT / 2, z: 40 * UNIT + UNIT / 2 }), "sight still stops at the shut door (the player's key opens nothing to the eye)");
  put(st.player, 10, 36);
  for (let s = 0; s < 22; s++) step(command(S));
  const inside = Math.floor(st.player.z / UNIT);
  const uses1 = usesOf(st.items.inv[plasticAt]);
  console.log(`plastic key: through the ${color} door to row ${inside} (${sim.playerZone}); uses ${uses1}`);
  check(inside >= 39 && sim.playerZone === 'generator', 'the plastic key opens the generator room');
  check(uses1 === 14, 'a door wears the plastic key once');
  // Back and forth until it breaks.
  let broke = false;
  for (let trip = 0; trip < 20 && !broke; trip++) {
    for (let s = 0; s < 14; s++) step(command(trip % 2 ? S : N));
    broke = events.some((e) => e.type === 'broke' && e.item === n(`plastic_key_${color}`));
  }
  check(broke && !st.items.inv.some((v) => itemOf(v) === n(`plastic_key_${color}`)), 'the plastic key wears out');
  check(w.block[door] === 1, 'and the door is shut to the player again');
}

// ------------------------------------------------------------------ the gate and the yard door
{
  const { sim, st, step, give } = arena();
  const w = sim.world;
  give('key_green', 0);
  put(st.player, 30, 44);
  step();
  const yardDoor = 45 * MAP_W + 30;
  const gate = 61 * MAP_W + 30;
  check(w.ground.key[yardDoor] === KEY.GREEN && w.ground.key[gate] === KEY.GREEN && w.gate[gate] === 1 && w.gate[yardDoor] === 0, 'the south gate is a perimeter gate, the yard door is not');
  check(w.block[yardDoor] === 0 && w.block[gate] === 1, 'the green key opens the yard door, never the perimeter gate');
  for (let s = 0; s < 120; s++) step(command(S));
  const z = Math.floor(st.player.z / UNIT);
  console.log(`green key: through the yard door, stopped at row ${z} by the gate (${sim.playerZone})`);
  check(z === 60 && st.escaped === 0, 'no walking out of the main gate with a key');
}

// ------------------------------------------------------------------ a shiv
{
  const { st, events, step, op, give } = arena();
  put(st.player, 7, 13);
  st.player.facing = W;
  give('plastic_comb', 0);
  st.items.hand = 0;
  for (let k = 0; k < 10 && itemOf(st.items.inv[0]) === n('plastic_comb'); k++) {
    op(OP.USE, k === 0 ? 1 : 0);
    for (let s = 0; s < 12; s++) step(command(0, OP.USE));
  }
  const strokes = events.filter((e) => e.type === 'strike' && e.action === 'sharpen').length;
  console.log(`shiv: ${strokes} strokes on the wall → ${itemDef(itemOf(st.items.inv[0])).id}`);
  check(itemOf(st.items.inv[0]) === n('comb_shiv'), 'a comb rubbed on a wall becomes a shiv');
}

// ------------------------------------------------------------------ floored by an inmate
{
  const { sim, st, events, step, op, press } = arena();
  const m = st.inmates[0];
  m.str = 60;
  m.hp = maxHealth(60);
  put(st.player, 28, 30);
  freeze(m, 29, 30, W);
  st.items.inv[SLOT.HOTBAR] = slot(n('lighter'));
  op(OP.LOCK);
  press();
  // Then stand there and take it.
  op(OP.LOCK, 1);
  for (let k = 0; k < 600 && st.ko === 0; k++) step();
  check(events.some((e) => e.type === 'floored'), 'an inmate can knock the player out');
  while (st.ko > 0) step();
  console.log(`floored by an inmate: woke in the ${sim.playerZone} (${at(sim)}), health ${st.health}, lighter ${st.items.inv.some((v) => itemOf(v) === n('lighter')) ? 'kept' : 'taken'}`);
  check(sim.playerZone === 'infirmary' && m.angry === 0, 'the infirmary, and the inmate calms down');
}

// ------------------------------------------------------------------ a save mid-fight
{
  const { sim, st, step, op, give } = arena(9);
  put(st.player, 28, 30);
  freeze(st.inmates[0], 29, 30, W);
  give('sock_mace', SLOT.WEAPON);
  op(OP.LOCK);
  op(OP.USE, 1);
  for (let k = 0; k < 15; k++) step();
  const snap = sim.snapshot();
  const twin = new Sim(CENTER_PERKS, 1);
  twin.restore(snap);
  check(twin.hash() === sim.hash(), 'restored mid-fight: the same state');
  for (let k = 0; k < 200; k++) {
    const cmd = command(0, OP.USE, k % 30 === 0 ? 1 : 0);
    twin.step(cmd);
    st.attended = true;
    twin.state.attended = true;
    sim.step(cmd);
  }
  check(twin.hash() === sim.hash(), 'and it plays on the same');
  console.log(`restored mid-fight at step ${snap.state.step}: plays on the same (${HOTBAR} hotbar slots, inmate ${st.inmates[0].ko > 0 ? 'down' : 'up'}), ${clockAt(st.step).minuteOfDay} min`);
}

// Every recipe is still craftable (weapons made in P2 are now used).
check(RECIPES.some((r) => r.result === 'molten_chocolate'), 'molten chocolate can be crafted');
