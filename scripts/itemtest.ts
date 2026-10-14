/**
 * Items and crafting (GDD §6–8): the data holds together and the rules work in the sim.
 * - ids are unique, numbers fit a slot, recipes name real items, INT gates are reachable;
 * - every item can be had: from a container, a later-phase source, or a recipe whose
 *   ingredients can be had (the recipe graph is closed);
 * - loot tables and item `from` lists agree;
 * - a bot walks to a desk, opens it, takes, drops, picks up, crafts, wears and sleeps,
 *   all through ordinary commands; restocks respect hidden slots and the player's own desk.
 */
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { ITEMS, itemDef, itemNumber, type Source } from '../src/content/items';
import { LOOT } from '../src/content/loot';
import { choices, RECIPES } from '../src/content/recipes';
import { Autopilot } from '../src/sim/ai/autopilot';
import { placesOf } from '../src/sim/ai/places';
import { command, OP, SLOT } from '../src/sim/command';
import { Recorder } from '../src/sim/Recorder';
import { Sim } from '../src/sim/Sim';
import { clockAt, formatTime } from '../src/sim/systems/clock';
import { canCraft, HOTBAR, interactTarget, itemOf, slot, usesOf } from '../src/sim/systems/items';

import { containersOf } from '../src/sim/world/containers';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';

// ------------------------------------------------------------------ data
const ids = new Set<string>();
for (const d of ITEMS) {
  check(!ids.has(d.id), `item id ${d.id} is unique`);
  ids.add(d.id);
  check((d.uses ?? 0) < 256, `${d.id}: uses fit a slot`);
  if (d.cat === 'tool') check(!!d.tool && !!d.uses, `${d.id}: a tool has stats and durability`);
}
check(ITEMS.length < 256, 'item numbers fit a slot');
const recipeResults = new Set<string>();
RECIPES.forEach((r, i) => {
  check(ids.has(r.result), `recipe ${i}: result ${r.result} exists`);
  check(!recipeResults.has(r.result), `recipe ${i}: one recipe per result (${r.result})`);
  recipeResults.add(r.result);
  check(r.ingredients.length >= 1 && r.ingredients.length <= 3, `recipe ${r.result}: 1 to 3 ingredients`);
  for (const ing of r.ingredients) for (const c of choices(ing)) check(ids.has(c), `recipe ${r.result}: ingredient ${c} exists`);
  for (const k of r.keep ?? []) check(r.ingredients.includes(k), `recipe ${r.result}: kept ${k} is an ingredient`);
  check(r.int >= 20 && r.int <= 100 && r.int % 10 === 0, `recipe ${r.result}: INT ${r.int} is reachable (20–100)`);
});
console.log(`${ITEMS.length} items, ${RECIPES.length} recipes`);

// Loot tables and `from` lists agree.
const TABLE_SOURCE: Record<string, Source> = {
  inmateDesk: 'desk',
  bed: 'bed',
  toilet: 'toilet',
  libraryShelf: 'shelf',
  canteenCounter: 'canteen',
  shower: 'shower',
  woodshopBin: 'woodshop',
  laundryBin: 'laundry',
  janitorBin: 'janitor',
  kitchenFreezer: 'kitchen',
};
const inTable = new Map<Source, Set<string>>();
for (const [name, t] of Object.entries(LOOT)) {
  const src = TABLE_SOURCE[name];
  for (const id of [...t.items.map(([i]) => i), ...(t.fixed ?? [])]) {
    check(ids.has(id), `loot ${name}: ${id} exists`);
    if (!src) continue;
    check(itemDef(itemNumber(id)).from.includes(src), `${id} lists '${src}' (it is in the ${name} table)`);
    if (!inTable.has(src)) inTable.set(src, new Set());
    inTable.get(src)!.add(id);
  }
}
for (const d of ITEMS) for (const src of d.from) if (Object.values(TABLE_SOURCE).includes(src)) check(inTable.get(src)?.has(d.id) ?? false, `${d.id} is in a '${src}' table`);

// The recipe graph is closed: everything can be had.
const have = new Set(ITEMS.filter((d) => d.from.length > 0).map((d) => d.id));
for (let changed = true; changed; ) {
  changed = false;
  for (const r of RECIPES) {
    if (have.has(r.result)) continue;
    if (r.ingredients.every((ing) => choices(ing).some((c) => have.has(c)))) {
      have.add(r.result);
      changed = true;
    }
  }
}
for (const d of ITEMS) check(have.has(d.id), `${d.id} can be obtained`);
// What Level 1 offers today (containers only, before merchants, guards and jobs).
const NOW: Source[] = ['desk', 'bed', 'toilet', 'shelf', 'canteen', 'shower', 'woodshop', 'start'];
const today = new Set(ITEMS.filter((d) => d.from.some((f) => NOW.includes(f))).map((d) => d.id));
for (let changed = true; changed; ) {
  changed = false;
  for (const r of RECIPES) {
    if (!today.has(r.result) && r.ingredients.every((ing) => choices(ing).some((c) => today.has(c)))) {
      today.add(r.result);
      changed = true;
    }
  }
}
console.log(`obtainable in P2 from reachable containers and crafting: ${today.size} items`);

// ------------------------------------------------------------------ rules in the sim
const at = (sim: Sim) => `day ${sim.clock.day} ${formatTime(sim.clock)}`;
const sim = new Sim(CENTER_PERKS, 11);
const rec = new Recorder(sim);
const w = sim.world;
const list = containersOf(w);
const it = () => sim.state.items;
const kinds = new Map<string, number>();
for (const c of list) kinds.set(`${c.prop.kind}:${c.table}`, (kinds.get(`${c.prop.kind}:${c.table}`) ?? 0) + 1);
console.log('containers:', [...kinds].sort().map(([k, n]) => `${k} ${n}`).join(', '));
check(list.filter((c) => c.table === 'inmateDesk').length === 7, 'seven inmate desks');
check(list.filter((c) => c.mine).length === 3, "the player's cell has a desk, a bed and a toilet");

const myDesk = list.findIndex((c) => c.mine && c.prop.kind === 'desk');
const myBed = list.findIndex((c) => c.mine && c.prop.kind === 'bed');
const deskOf = (cell: number) => list.findIndex((c) => c.prop.kind === 'desk' && w.cellOf[c.prop.z * MAP_W + c.prop.x] === cell);
check(it().containers[myDesk].every((v) => !v), "the player's desk starts empty");
check(it().containers[myBed].map(itemOf).join() === [itemNumber('pillow'), itemNumber('bed_sheet')].join(), "the player's bed has a pillow and a sheet");
check(itemOf(it().inv[SLOT.OUTFIT]) === itemNumber('inmate_outfit'), 'the player wears the orange outfit');

/** Runs commands (one op per step) and dirs; returns after the op. */
const step = (cmd = 0) => rec.step(cmd);
const op = (o: number, a = 0, b = 0) => step(command(0, o, a, b));

/** Walks the player to where a container is in reach, with the autopilot. */
function walkTo(index: number) {
  const pilot = new Autopilot(w);
  const c = list[index];
  pilot.goToAny((i) => {
    const x = i % MAP_W;
    const z = Math.floor(i / MAP_W);
    return !w.blocked(x, z) && x >= c.prop.x - 1 && x <= c.prop.x + c.prop.w && z >= c.prop.z - 1 && z <= c.prop.z + c.prop.d;
  });
  for (let k = 0; k < 2000 && pilot.active; k++) step(command(pilot.dir(sim.state.player)));
  // Face it.
  for (let k = 0; k < 40; k++) {
    const t = interactTarget(w, it(), sim.state.player, false);
    if (t?.kind === 'container' && t.index === index) return true;
    step(command(1 + ((k * 4) % 16)));
  }
  return false;
}

// Open my bed, take the pillow and the sheet.
check(walkTo(myBed), 'the bot reaches its bed');
op(OP.INTERACT);
check(it().open === myBed, 'interacting opens the bed');
op(OP.MOVE, SLOT.CONTAINER + 0, 0);
op(OP.MOVE, SLOT.CONTAINER + 1, 1);
check(itemOf(it().inv[0]) === itemNumber('pillow') && itemOf(it().inv[1]) === itemNumber('bed_sheet'), 'pillow and sheet move to the hotbar');
// The outfit slot only takes outfits.
op(OP.MOVE, 0, SLOT.OUTFIT);
check(itemOf(it().inv[SLOT.OUTFIT]) === itemNumber('inmate_outfit'), 'a pillow is not an outfit');
op(OP.CLOSE);
check(it().open === -1, 'closing the bed');

// Drop the pillow and pick it up again.
op(OP.DROP, 0);
check(it().ground.length === 1 && !it().inv[0], 'the pillow lies on the floor');
op(OP.INTERACT);
check(it().ground.length === 0 && itemOf(it().inv[0]) === itemNumber('pillow'), 'interacting picks it up');

// Raid the inmate in cell 2: take everything from their desk.
const theirs = deskOf(2);
const loot = it().containers[theirs].filter((v) => v).map((v) => ITEMS[itemOf(v) - 1].id);
console.log(`cell 2's desk on day 1: ${loot.join(', ')}`);
check(walkTo(theirs), "the bot reaches cell 2's desk");
op(OP.INTERACT);
check(it().open === theirs, "cell 2's desk opens");
it().containers[theirs].forEach((v, k) => {
  if (!v) return;
  const free = it().inv.slice(0, HOTBAR).indexOf(0);
  if (free >= 0) op(OP.MOVE, SLOT.CONTAINER + k, free);
});
// Walking off closes it.
const pilot = new Autopilot(w);
pilot.goTo(placesOf(w).bedside[1]);
for (let k = 0; k < 2000 && pilot.active; k++) step(command(pilot.dir(sim.state.player)));
check(it().open === -1, 'walking away closes the desk');

// Everything so far was ordinary commands: it replays exactly from the log.
{
  const end = sim.hash();
  const endStep = sim.state.step;
  rec.seek(1);
  rec.seek(endStep);
  check(sim.hash() === end, 'item play replays exactly');
  console.log(`replay: ${endStep} steps, ${rec.log.length} commands, state ${end}`);
}

// Crafting: a sheet rope needs two sheets; get the second from cell 3's bed.
const bed3 = list.findIndex((c) => c.prop.kind === 'bed' && w.cellOf[c.prop.z * MAP_W + c.prop.x] === 3);
const sheetRope = RECIPES.findIndex((r) => r.result === 'sheet_rope');
check(canCraft(it(), sheetRope) === 'missing', 'one sheet is not enough for a sheet rope');
check(walkTo(bed3), "the bot reaches cell 3's bed");
op(OP.INTERACT);
// Make room, then take the sheet.
for (let k = 2; k < HOTBAR; k++) if (it().inv[k]) op(OP.DROP, k);
op(OP.MOVE, SLOT.CONTAINER + 1, 2);
check(canCraft(it(), sheetRope) === 'ok', 'two sheets make a sheet rope');
op(OP.CRAFT, sheetRope);
check(it().inv.some((v) => itemOf(v) === itemNumber('sheet_rope')) && it().known.includes(sheetRope), 'the sheet rope is crafted and in the handbook');
check(!it().inv.some((v) => itemOf(v) === itemNumber('bed_sheet')), 'both sheets were used');

// INT gates and kept ingredients (set up directly: guards arrive in P3).
it().inv[3] = slot(itemNumber('putty'));
it().inv[4] = slot(itemNumber('key_red'));
const moldRed = RECIPES.findIndex((r) => r.result === 'mold_red');
check(canCraft(it(), moldRed) === 'int', 'a key mold needs 50 INT');
it().int = 60;
op(OP.CRAFT, moldRed);
check(it().inv.some((v) => itemOf(v) === itemNumber('mold_red')) && it().inv.some((v) => itemOf(v) === itemNumber('key_red')), 'the mold is made and the real key comes back');
it().int = 40;
it().inv[5] = slot(itemNumber('nail_file'));
check(usesOf(it().inv[5]) === 8, 'a nail file has 8 uses');
// Wearing: the guard outfit goes on, the orange one comes off into the hotbar.
for (let k = 0; k < HOTBAR; k++) if (it().inv[k] && itemOf(it().inv[k]) !== itemNumber('key_red')) op(OP.DROP, k);
const free = it().inv.indexOf(0);
it().inv[free] = slot(itemNumber('guard_outfit'));
op(OP.EQUIP, free);
check(itemOf(it().inv[SLOT.OUTFIT]) === itemNumber('guard_outfit') && itemOf(it().inv[free]) === itemNumber('inmate_outfit'), 'equipping swaps the outfits');

// The hidden compartment: stash in my desk; the morning restock leaves my desk alone.
check(walkTo(myDesk), 'the bot reaches its desk');
op(OP.INTERACT);
op(OP.MOVE, free, SLOT.CONTAINER + 0);
check(itemOf(it().containers[myDesk][0]) === itemNumber('inmate_outfit'), 'stashed in a hidden slot');
const before = JSON.stringify(it().containers[myDesk]);
const otherBefore = it().containers[theirs].filter((v) => v).length;
// Sleep: wait for Lights Out, go to bed.
op(OP.CLOSE);
while (clockAt(sim.state.step).minuteOfDay !== 23 * 60 + 30) step(0);
check(walkTo(myBed), 'back at the bed at night');
op(OP.INTERACT);
check(sim.state.sleeping, 'interacting with your bed at Lights Out is sleep');
let woke = '';
while (sim.state.sleeping) {
  step(0);
  if (!sim.state.sleeping) woke = at(sim);
}
check(woke.endsWith('07:55'), `asleep until 07:55 (woke ${woke})`);
while (sim.state.routine !== 0) step(0);
step(0);
check(JSON.stringify(it().containers[myDesk]) === before, "the restock leaves the player's desk alone");
const after = it().containers[theirs].filter((v) => v).length;
check(after > otherBefore && after <= LOOT.inmateDesk.max, `cell 2's desk is restocked (${otherBefore} → ${after} items)`);
console.log(`restock: cell 2's desk ${otherBefore} → ${after} items; woke at ${woke}`);
