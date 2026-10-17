/**
 * The pet rat (P20), rule by rule:
 * - the data: the trap (a cup and potato, chocolate or jerky) is legal, a caught rat is
 *   contraband; keys, molds and plastic keys are small enough for a rat; every prison has floor
 *   where rats come to a trap;
 * - traps: set down where the player stands; at 04:00 a trap on the floor catches a rat as
 *   roll() says (kitchens, canteens and storerooms TRAP_KITCHEN, tunnels TRAP_TUNNEL, anywhere
 *   else never), the odds near what they say over many nights;
 * - taming: no bait, nothing; potato first; RAT_MEALS meals and it's on the shoulder; one pet at most;
 * - errands: only to containers that aren't the player's and to the pockets of sleepers or the
 *   knocked out, RAT_REACH tiles of its way at most; it brings back the most valuable small thing
 *   (never from a hidden compartment) and the change; it leaves a small item (never a big one);
 *   someone who woke meanwhile keeps their pockets;
 * - keys: a guard asleep without his key wakes to the alarm (a spare drawn); the key fetched,
 *   pressed into a mold and put back before he wakes is never missed;
 * - let loose: among fewer than PANIC_PEOPLE nothing; among more, a panic: squeaks send at most
 *   SQUEAK_GUARDS guards, the inmates near it flee, over after PANIC_STEPS with the rat back on
 *   the shoulder; once a prison day; a caught rat thrown into a crowd panics it and is gone;
 * - dogs go after a rat they see running, and the rat gives up its errand;
 * - the player off the ground floor: the rat waits, then finds them;
 * - saves: mid-errand the game plays on the same; a save from before the rats has none.
 */
import { itemDef, itemNumber, ITEMS, KEY_ITEM_COLORS } from '../src/content/items';
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { SAN_PANCHO } from '../src/content/prisons/san-pancho';
import type { PrisonDef } from '../src/content/prisons/types';
import { RECIPES } from '../src/content/recipes';
import { floorOf } from '../src/sim/ai/places';
import { command, EXT, OP, tossArgs } from '../src/sim/command';
import { Sim, type SimEvent, type Snapshot } from '../src/sim/Sim';
import { rollInt, SALT } from '../src/sim/rng';
import { clockAt, prisonDay } from '../src/sim/systems/clock';
import { DOING } from '../src/sim/systems/inmates';
import { guardKit, itemOf, maskOf, pocketOf, slot } from '../src/sim/systems/items';
import { DOG, handlersOf } from '../src/sim/systems/k9';
import { FEAT } from '../src/sim/systems/ledger';
import { crowdAt, petOf, RAT, RAT_ROOMS, ratPath, ratTargets, trapChance } from '../src/sim/systems/rats';
import { FLEE_RANGE, PANIC_PEOPLE, PANIC_STEPS, RAT_MEALS, RAT_REACH, SQUEAK_GUARDS, STEPS_PER_MINUTE, STEPS_PER_SECOND, TRAP_KITCHEN, TRAP_MINUTE, TRAP_TUNNEL, UNIT } from '../src/sim/tuning';
import { containersOf } from '../src/sim/world/containers';
import { LAYER, layerOfKey, MAP_W, placeKey, tileOfKey } from '../src/sim/world/World';
import { check } from './assert';

const n = (id: string) => itemNumber(id);
const tileOf = (b: { x: number; z: number }) => Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);
const putTile = (b: { x: number; z: number }, t: number) => {
  b.x = (t % MAP_W) * UNIT + UNIT / 2;
  b.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
};
const hhmm = (step: number) => {
  const c = clockAt(step);
  return `day ${c.day} ${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
};

/** A game kept out of trouble: every day quiet, the heat kept at 0; `blind()` has every guard look the other way. */
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
  const to = (day: number, hour: number, minute = 0, calm = true) => {
    const target = (day - 1) * 1440 * STEPS_PER_MINUTE + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
    while (sim.state.step < target) step(0, calm);
  };
  /** Steps until a rat event (`what`) comes, at most `max`; returns whether it came. */
  const until = (what: string, max = 400) => {
    for (let k = 0; k < max; k++) {
      step();
      if (sim.events.some((e) => e.type === 'rat' && e.what === what)) return true;
    }
    return false;
  };
  /** A pet rat, tamed the usual way: two potatoes. */
  const tame = () => {
    const it = sim.state.items;
    it.inv[0] = slot(n('caught_rat'));
    it.inv[1] = slot(n('potato'));
    it.inv[2] = slot(n('potato'));
    it.hand = 0;
    step(command(0, OP.USE, 1));
    step(command(0, OP.USE, 1));
  };
  return { sim, seen, step, to, blind, until, tame };
}

const ratEvents = (seen: SimEvent[], what: string) => seen.filter((e) => e.type === 'rat' && e.what === what);
const send = (container: number, leave = false) => command(0, OP.EXT, leave ? EXT.RAT_LEAVE : EXT.RAT_FETCH, ...tossArgs(container));

// ------------------------------------------------------------------ the data
{
  check(!itemDef(n('rat_trap')).contraband && itemDef(n('caught_rat')).contraband, 'a rat trap is legal, a caught rat contraband');
  const trap = RECIPES.find((r) => r.result === 'rat_trap');
  check(!!trap && trap.ingredients.join() === 'plastic_cup,potato|chocolate|jerky', 'the trap: a cup over potato, chocolate or jerky');
  check(KEY_ITEM_COLORS.every(([c]) => itemDef(n(`key_${c}`)).small && itemDef(n(`mold_${c}`)).small && itemDef(n(`plastic_key_${c}`)).small), 'keys, molds and plastic keys are small');
  const big = ['timber', 'crowbar', 'sturdy_shovel', 'guard_outfit', 'baton', 'pillow', 'caught_rat', 'rat_trap', 'raft'];
  check(big.every((id) => !itemDef(n(id)).small), 'nothing long, heavy or bulky is');
  for (const p of PRISONS) {
    const sim = new Sim(p, 1);
    check(floorOf(sim.world, RAT_ROOMS).length > 0, `${p.id}: floor where rats come to a trap`);
  }
  // What the help, the toasts and the panel say, in numbers.
  check(TRAP_KITCHEN === 60 && TRAP_TUNNEL === 85 && TRAP_MINUTE === 240 && RAT_MEALS === 2 && RAT_REACH === 16 && PANIC_PEOPLE === 3 && PANIC_STEPS === 20 * STEPS_PER_SECOND && SQUEAK_GUARDS === 3, 'the numbers the words say: 60%, 85%, 04:00, two meals, 16 tiles, 3 people, 20 s, 3 guards');
  console.log(`data: ${ITEMS.filter((d) => d.small).length} small items; every prison has a kitchen or canteen for traps`);
}

// ------------------------------------------------------------------ the odds
{
  const sim = new Sim(CENTER_PERKS, 1);
  const w = sim.world;
  const canteen = floorOf(w, ['canteen'])[0];
  const corridor = floorOf(w, ['corridor'])[0];
  check(trapChance(w, LAYER.GROUND, canteen) === TRAP_KITCHEN && trapChance(w, LAYER.UNDER, corridor) === TRAP_TUNNEL && trapChance(w, LAYER.GROUND, corridor) === 0 && trapChance(w, LAYER.VENTS, corridor) === 0, 'kitchens 60%, tunnels 85%, elsewhere never');
  let k = 0;
  let t = 0;
  for (let day = 1; day <= 400; day++) {
    if (rollInt(sim.state.salt, SALT.TRAPS, day, canteen * 8, 100) < TRAP_KITCHEN) k++;
    if (rollInt(sim.state.salt, SALT.TRAPS, day, placeKey(LAYER.UNDER, corridor) * 8, 100) < TRAP_TUNNEL) t++;
  }
  check(Math.abs(k / 400 - 0.6) < 0.07 && Math.abs(t / 400 - 0.85) < 0.06, `over 400 nights: ${k} rats in the canteen, ${t} in a tunnel`);
  console.log(`odds: canteen ${Math.round(k / 4)}%, tunnel ${Math.round(t / 4)}% over 400 nights`);
}

// ------------------------------------------------------------------ setting traps, the night's catch
{
  const { sim, seen, step, to } = game(CENTER_PERKS);
  const w = sim.world;
  const it = sim.state.items;
  const canteen = floorOf(w, ['canteen']);
  const corridor = floorOf(w, ['corridor'])[0];
  putTile(sim.state.player, canteen[0]);
  it.inv[0] = slot(n('rat_trap'));
  it.hand = 0;
  step(command(0, OP.USE, 1));
  check(it.inv[0] === 0 && it.ground.some(([key, v]) => key === canteen[0] && itemOf(v) === n('rat_trap')), 'the use button sets the trap down where the player stands');
  // More traps: two more in the canteen (one on the same tile), one in the corridor, one down a tunnel.
  const places = [canteen[0], canteen[5], placeKey(LAYER.UNDER, corridor), corridor];
  it.ground.push([canteen[0], slot(n('rat_trap'))], [canteen[5], slot(n('rat_trap'))], [places[2], slot(n('rat_trap'))], [corridor, slot(n('rat_trap'))]);
  // What roll() says for tonight, worked out ahead.
  const day = 1;
  const expect = it.ground.map(([key, v], k) => {
    if (itemOf(v) !== n('rat_trap')) return false;
    const nth = it.ground.slice(0, k).filter(([k2, v2]) => k2 === key && itemOf(v2) === n('rat_trap')).length;
    const chance = trapChance(w, layerOfKey(key), tileOfKey(key));
    return rollInt(sim.state.salt, SALT.TRAPS, day, key * 8 + nth, 100) < chance;
  });
  to(1, 3, 59);
  check(ratEvents(seen, 'caught').length === 0, 'nothing caught before 04:00');
  to(1, 4, 1);
  const got = it.ground.map(([, v]) => itemOf(v) === n('caught_rat'));
  check(JSON.stringify(got) === JSON.stringify(expect) && ratEvents(seen, 'caught').length === expect.filter(Boolean).length, `04:00: caught as roll() says (${got.map((g) => (g ? 'rat' : '-')).join(' ')})`);
  check(!got[it.ground.findIndex(([key]) => key === corridor)], 'never in the corridor');
  to(2, 4, 1);
  check(got.every((g, k) => !g || itemOf(it.ground[k][1]) === n('caught_rat')), 'a caught rat stays caught');
  console.log(`traps: ${got.filter(Boolean).length} of ${got.length} caught at ${hhmm(sim.state.step - 1440 * STEPS_PER_MINUTE)}`);
}

// ------------------------------------------------------------------ taming
{
  const { sim, seen, step } = game(CENTER_PERKS);
  const it = sim.state.items;
  it.inv[0] = slot(n('caught_rat'));
  it.hand = 0;
  step(command(0, OP.USE, 1));
  check(ratEvents(seen, 'hungry').length === 1 && itemOf(it.inv[0]) === n('caught_rat'), 'no bait: nothing eaten');
  it.inv[1] = slot(n('chocolate'));
  it.inv[2] = slot(n('potato'));
  step(command(0, OP.USE, 1));
  check(it.inv[2] === 0 && itemOf(it.inv[1]) === n('chocolate') && it.inv[0] === slot(n('caught_rat'), 1), 'the potato first; one meal');
  step(command(0, OP.USE, 1));
  const pet = petOf(sim.state);
  check(it.inv[0] === 0 && it.inv[1] === 0 && !!pet && pet.mode === RAT.SHOULDER && ratEvents(seen, 'tamed').length === 1, 'the second meal: tame, on the shoulder');
  it.inv[0] = slot(n('caught_rat'));
  it.inv[1] = slot(n('jerky'));
  step(command(0, OP.USE, 1));
  check(ratEvents(seen, 'haveOne').length === 1 && itemOf(it.inv[1]) === n('jerky') && sim.state.rats.length === 1, 'one pet at most');
  check(sim.state.feats[FEAT.ratsTamed] === 1, 'the ledger counts it');
  console.log('taming: two meals (potato before chocolate before jerky), one pet');
}

// ------------------------------------------------------------------ errands: furniture
{
  const { sim, seen, step, tame } = game(CENTER_PERKS);
  const w = sim.world;
  const it = sim.state.items;
  tame();
  const list = containersOf(w);
  // A desk in another cell, near the player's.
  const targets = ratTargets(sim);
  check(targets.length > 0 && targets.every((x) => x.dist <= RAT_REACH), `from the cell: ${targets.length} places within ${RAT_REACH} tiles of its way`);
  check(targets.every((x) => x.who >= 0 || !list[x.container].mine), 'never the player\'s own furniture');
  check(targets.every((x) => x.who < 0 || sim.state.inmates[x.who]?.ko > 0 || sim.state.inmates[x.who]?.doing === DOING.SLEEP), 'pockets only of sleepers and the knocked out');
  const desk = targets.find((x) => x.who < 0 && list[x.container].table === 'inmateDesk');
  check(!!desk, 'an inmate desk within reach');
  if (desk) {
    const box = it.containers[desk.container];
    const hidden = list[desk.container].hidden;
    box.fill(0);
    if (hidden > 0) box[0] = slot(n('key_red'));
    box[hidden] = slot(n('sock'));
    box[hidden + 1] = slot(n('lighter'));
    box[hidden + 2] = slot(n('timber'));
    sim.state.coins[desk.container] = 7;
    const cash = sim.state.cash;
    step(send(desk.container));
    check(petOf(sim.state)!.mode === RAT.OUT, 'sent: off it goes');
    const t0 = sim.state.step;
    const ok = until(sim, step, 'home');
    const took = ratEvents(seen, 'took')[0];
    check(ok && took?.item === n('lighter') && took.cash === 7, `back with the lighter (the most valuable small thing) and $7, in ${sim.state.step - t0} steps`);
    check(it.inv.some((v) => itemOf(v) === n('lighter')) && sim.state.cash === cash + 7, 'into the hotbar, the change into the pocket');
    check(hidden === 0 || itemOf(box[0]) === n('key_red'), 'a hidden compartment is left be');
    check(itemOf(box[hidden + 2]) === n('timber') && itemOf(box[hidden]) === n('sock'), 'the rest stays');
    // Leave something: a small item in hand.
    it.inv[3] = slot(n('battery'));
    it.hand = 3;
    step(send(desk.container, true));
    check(it.inv[3] === 0 && until(sim, step, 'home') && box.some((v) => itemOf(v) === n('battery')), 'the battery left in the desk');
    it.inv[3] = slot(n('crowbar'));
    step(send(desk.container, true));
    check(ratEvents(seen, 'refused').some((e) => e.type === 'rat' && e.why === 'big') && itemOf(it.inv[3]) === n('crowbar') && petOf(sim.state)!.mode === RAT.SHOULDER, 'a crowbar is too big to carry');
    // Too far: a container well out of reach.
    const far = list.findIndex((c, i) => !c.mine && !ratTargets(sim).some((x) => x.container === i));
    step(send(far));
    check(ratEvents(seen, 'refused').some((e) => e.type === 'rat' && e.why === 'far') && petOf(sim.state)!.mode === RAT.SHOULDER, 'out of its reach: it stays');
  }
  console.log('errands: furniture within reach, the best small thing and the change back, a small thing left');
}

function until(sim: Sim, step: (cmd?: number) => void, what: string, max = 400): boolean {
  for (let k = 0; k < max; k++) {
    step();
    if (sim.events.some((e) => e.type === 'rat' && e.what === what)) return true;
  }
  return false;
}

/** A guard asleep in the guard quarters at 01:00, and a floor tile within `d` tiles of rat way from him. */
function sleeperNear(sim: Sim, d = 6): { k: number; at: number } | null {
  const w = sim.world;
  for (let k = 0; k < sim.state.guards.length; k++) {
    const g = sim.state.guards[k];
    if (g.doing !== DOING.SLEEP) continue;
    const t = tileOf(g.body);
    for (const f of floorOf(w, ['guardQuarters'])) {
      if (w.block[f] || f === t) continue;
      const p = ratPath(w, f, t, d);
      if (p && p.length > 3) return { k, at: f };
    }
  }
  return null;
}

// ------------------------------------------------------------------ keys: the alarm, and the heist
for (const heist of [false, true]) {
  const { sim, seen, step, to, blind, tame } = game(CENTER_PERKS);
  const w = sim.world;
  const it = sim.state.items;
  tame();
  to(1, 1);
  blind();
  const sl = sleeperNear(sim);
  check(!!sl, 'a guard asleep in the quarters at 01:00');
  if (!sl) continue;
  const g = sim.state.guards[sl.k];
  const who = sim.state.inmates.length + sl.k;
  const pockets = it.containers[pocketOf(w, who)];
  const key = guardKit(w, sl.k)[0];
  putTile(sim.state.player, sl.at);
  check(ratTargets(sim).some((x) => x.who === who), 'his pockets within reach while he sleeps');
  step(send(pocketOf(w, who)));
  check(until(sim, step, 'home') && it.inv.some((v) => itemOf(v) === key) && !pockets.some((v) => itemOf(v) === key) && g.doing === DOING.SLEEP, `the rat brings his ${itemDef(key).id}; he sleeps on`);
  if (heist) {
    // Pressed into putty (the key kept), then back in his pockets before he wakes.
    it.int = 60;
    const k0 = it.inv.findIndex((v) => itemOf(v) === key);
    const p0 = it.inv.findIndex((v) => v === 0);
    it.inv[p0] = slot(n('putty'));
    const recipe = RECIPES.findIndex((r) => r.result === `mold_${itemDef(key).id.slice(4)}`);
    step(command(0, OP.CRAFT, maskOf([k0, p0]), recipe + 1));
    check(it.inv.some((v) => itemOf(v) === n(`mold_${itemDef(key).id.slice(4)}`)) && itemOf(it.inv[k0]) === key, 'a mold of it, the key kept');
    step(command(0, OP.SELECT, k0));
    step(send(pocketOf(w, who), true));
    check(until(sim, step, 'home') && pockets.some((v) => itemOf(v) === key) && !it.inv.some((v) => itemOf(v) === key), 'the key back in his pockets');
  }
  to(1, 7, 59);
  check(!seen.some((e) => e.type === 'keyless'), 'nothing missed while he sleeps');
  to(2, 8, 1, false);
  const keyless = seen.filter((e) => e.type === 'keyless');
  if (heist) {
    check(keyless.length === 0 && !seen.some((e) => e.type === 'spotted' && e.reason === 'keyMissing') && sim.state.feats[FEAT.keyHeists] === 1, '08:00: he wakes with his key: never missed (a key heist)');
  } else {
    check(keyless.length === 1 && seen.some((e) => e.type === 'spotted' && e.reason === 'keyMissing') && sim.state.lockdown && pockets.some((v) => itemOf(v) === key), '08:00: he wakes without it: the alarm, a lockdown, a spare drawn');
    check(sim.state.feats[FEAT.ratKeys] === 1 && sim.state.feats[FEAT.keyless] === 1, 'the ledger counts the key and the alarm');
    // Pockets stuffed full while his key was gone: he still draws a spare, and misses his key once, not every morning.
    const it2 = sim.state.items;
    const pk = it2.containers[pocketOf(w, who)];
    for (let j = 0; j < pk.length; j++) if (itemOf(pk[j]) === key) pk[j] = slot(n('sock'));
    for (let j = 0; j < pk.length; j++) if (!pk[j]) pk[j] = slot(n('soap'));
    g.doing = DOING.SLEEP;
    to(2, 8, 2, false);
    to(3, 8, 2, false);
    to(4, 8, 2, false);
    const again = seen.filter((e) => e.type === 'keyless').length;
    check(again === 2 && pk.some((v) => itemOf(v) === key), `full pockets: a spare all the same, one more alarm (${again - 1}), not one every morning`);
  }
  console.log(heist ? `the heist: key fetched, molded, put back; 08:00 no alarm (${hhmm(sim.state.step)})` : `keys: a guard who wakes without his key raises the alarm (${hhmm(sim.state.step)})`);
}

// ------------------------------------------------------------------ someone who wakes first
{
  const { sim, seen, step, blind, tame } = game(CENTER_PERKS);
  const w = sim.world;
  tame();
  blind();
  // A guard knocked flat, coming round in a moment: the rat sent to his pockets gets there too late.
  const k = sim.state.guards.findIndex((g) => g.mode === 0);
  const g = sim.state.guards[k];
  const t = tileOf(g.body);
  const at = floorOf(w, [w.zoneAt(t % MAP_W, Math.floor(t / MAP_W))]).find((f) => !w.block[f] && (ratPath(w, f, t, 8)?.length ?? 0) > 5);
  g.ko = 6;
  g.doing = DOING.KNOCKED_OUT;
  if (at !== undefined) {
    putTile(sim.state.player, at);
    const who = sim.state.inmates.length + k;
    check(ratTargets(sim).some((x) => x.who === who), 'his pockets within reach while he\'s out cold');
    step(send(pocketOf(w, who)));
    check(until(sim, step, 'home') && ratEvents(seen, 'woke').length === 1 && ratEvents(seen, 'took').length === 0, 'up again by the time it gets there: it comes back with nothing');
  } else check(false, 'somewhere near a guard');
  console.log('woken: the rat comes back empty');
}

// ------------------------------------------------------------------ let loose: panics
{
  const { sim, seen, step, to, blind, tame } = game(CENTER_PERKS);
  const w = sim.world;
  tame();
  // In the player's own cell: nobody to scare.
  step(command(0, OP.EXT, EXT.RAT_LOOSE));
  check(ratEvents(seen, 'refused').some((e) => e.type === 'rat' && e.why === 'few') && petOf(sim.state)!.mode === RAT.SHOULDER, 'alone: nobody to scare, it stays');
  // Breakfast: the canteen full.
  to(1, 9, 20);
  blind();
  const crowded = () => {
    let spot = -1;
    let most = 0;
    for (const t of floorOf(w, ['canteen'])) {
      if (w.block[t]) continue;
      const c = crowdAt(sim, t);
      if (c > most) {
        most = c;
        spot = t;
      }
    }
    return { spot, most };
  };
  const { spot, most } = crowded();
  putTile(sim.state.player, spot);
  check(most >= PANIC_PEOPLE, `a crowd: ${most} people in sight`);
  const near = sim.state.inmates.map((m, k) => ({ k, d: Math.hypot(m.body.x - sim.state.player.x, m.body.z - sim.state.player.z) })).filter((x) => x.d < FLEE_RANGE - UNIT);
  step(command(0, OP.EXT, EXT.RAT_LOOSE));
  const noise = seen.filter((e) => e.type === 'noise' && e.kind === 'squeak');
  check(ratEvents(seen, 'loose').length === 1 && noise.length === 1 && noise[0].type === 'noise' && noise[0].sent.length <= SQUEAK_GUARDS, `let loose: a panic, its squeak sends ${noise[0]?.type === 'noise' ? noise[0].sent.length : '?'} guards (at most ${SQUEAK_GUARDS})`);
  for (let k = 0; k < 40; k++) step();
  const pet = petOf(sim.state)!;
  const fled = near.filter((x) => Math.hypot(sim.state.inmates[x.k].body.x - pet.x, sim.state.inmates[x.k].body.z - pet.z) > x.d - UNIT / 2).length;
  check(near.length > 0 && fled >= near.length - 1, `${fled} of the ${near.length} inmates near it got away from it`);
  check(until(sim, step, 'calm', PANIC_STEPS) && until(sim, step, 'home', 400), 'over after 20 s, the rat back on the shoulder');
  check(sim.state.inmates.some((m) => m.path.length > 0 || m.body.moving || m.doing === DOING.EAT), 'the inmates back to the routine');
  for (let k = 0; k < 60; k++) step();
  const seated = sim.state.inmates.filter((m) => m.ko <= 0 && m.goal >= 0 && !m.path.length && tileOf(m.body) === m.goal);
  check(seated.length > 0 && seated.every((m) => m.doing === DOING.EAT), `back in their seats, eating (${seated.length} at ${hhmm(sim.state.step)})`);
  check(sim.state.inmates.every((m) => m.goal >= -1), 'nobody left fleeing');
  step(command(0, OP.EXT, EXT.RAT_LOOSE));
  check(ratEvents(seen, 'refused').some((e) => e.type === 'rat' && e.why === 'tired') && petOf(sim.state)!.mode === RAT.SHOULDER, 'once a day');
  check(sim.state.feats[FEAT.ratPanics] === 1, 'the ledger counts the panic');
  // A caught rat thrown into the crowd at dinner: a panic, then gone.
  to(1, 17, 20);
  blind();
  const din = crowded();
  const from = floorOf(w, ['canteen']).find((t) => !w.block[t] && t !== din.spot && Math.abs((t % MAP_W) - (din.spot % MAP_W)) + Math.abs(Math.floor(t / MAP_W) - Math.floor(din.spot / MAP_W)) === 3)!;
  putTile(sim.state.player, from);
  const it = sim.state.items;
  it.inv[4] = slot(n('caught_rat'));
  it.hand = 4;
  const [b, c] = tossArgs(din.spot);
  step(command(0, OP.EXT, EXT.THROW, b, c));
  const wild = sim.state.rats.find((r) => r.wild);
  check(!!wild && wild.mode === RAT.LOOSE && it.inv[4] === 0, 'a caught rat thrown into the crowd: loose');
  for (let k = 0; k < PANIC_STEPS + 2; k++) step();
  check(!sim.state.rats.some((r) => r.wild) && ratEvents(seen, 'calm').length === 2, 'and gone once it\'s over');
  // Thrown where nobody is: off it runs.
  const empty = floorOf(w, ['playerCell']).find((t) => !w.block[t])!;
  putTile(sim.state.player, empty);
  it.inv[4] = slot(n('caught_rat'));
  const [b2, c2] = tossArgs(empty);
  step(command(0, OP.EXT, EXT.THROW, b2, c2));
  check(ratEvents(seen, 'gone').length === 1 && !sim.state.rats.some((r) => r.wild), 'thrown with nobody about: it runs off');
  console.log(`panics: ${most} people at breakfast; the squeak, the inmates fleeing, 20 s, once a day; a caught rat thrown`);
}

// ------------------------------------------------------------------ dogs go after rats
{
  const { sim, seen, step, to, blind, tame } = game(SAN_PANCHO);
  const w = sim.world;
  tame();
  to(2, 11);
  blind();
  const k = 0;
  const d = sim.state.dogs[k];
  const g = sim.state.guards[handlersOf(w)[k]];
  check(d.mode === DOG.HEEL, 'Canela at her handler\'s heel');
  // The player beside the dog, something within the rat's reach.
  putTile(sim.state.player, tileOf(d.body));
  const to0 = ratTargets(sim).find((x) => x.who < 0);
  check(!!to0, 'something to send the rat to');
  if (to0) {
    step(send(to0.container));
    let chased = false;
    for (let s = 0; s < 40 && !chased; s++) {
      step();
      chased = seen.some((e) => e.type === 'dog' && e.what === 'rat');
    }
    check(chased && seen.some((e) => e.type === 'noise' && e.kind === 'bark'), 'Canela sees the rat: after it, barking');
    check(ratEvents(seen, 'chased').length === 1 && ratEvents(seen, 'took').length === 0, 'the rat gives its errand up');
    check(ratEvents(seen, 'home').length === 1 || until(sim, step, 'home', 400), 'and bolts home');
    for (let s = 0; s < 200; s++) step();
    check(d.mode === DOG.HEEL && g.ko <= 0, 'Canela back at the heel');
  }
  console.log('dogs: after a rat they see, the rat home without its errand');
}

// ------------------------------------------------------------------ the player off the floor; saves
{
  const { sim, seen, step, tame } = game(CENTER_PERKS);
  tame();
  const to0 = ratTargets(sim).find((x) => x.who < 0)!;
  step(send(to0.container));
  for (let k = 0; k < 4; k++) step();
  const snap: Snapshot = JSON.parse(JSON.stringify(sim.snapshot()));
  for (let k = 0; k < 120; k++) step();
  const a = sim.hash();
  sim.restore(JSON.parse(JSON.stringify(snap)));
  for (let k = 0; k < 120; k++) step();
  check(sim.hash() === a, 'saved and loaded mid-errand: the same game after');
  // Up in the vents meanwhile: it waits for the player.
  sim.restore(JSON.parse(JSON.stringify(snap)));
  sim.state.layer = LAYER.VENTS;
  for (let k = 0; k < 200; k++) step();
  check(petOf(sim.state)!.mode === RAT.WAIT, 'the player up in the vents: it waits');
  sim.state.layer = LAYER.GROUND;
  check(until(sim, step, 'home', 400), 'back on the floor: it finds them');
  const old: Snapshot = JSON.parse(JSON.stringify(sim.snapshot()));
  delete (old.state as Partial<typeof old.state>).rats;
  sim.restore(old);
  check(sim.state.rats.length === 0, 'a save from before the rats: none');
  check(prisonDay(sim.state.step) === 1 && seen.length > 0, 'still day 1');
  console.log('saves: mid-errand the same; off the floor it waits; old saves have no rat');
}
