/**
 * Tools, items and searches (2.36, the improvement queue's session 12), in all five prisons, by real commands:
 * - **tools:** every tool at its job (a brick wall of the player's cell, a fence, a vent grate, a floor), struck
 *   until it gives way: the strikes and the tools it takes are what its card says; a tool is said to be nearly worn
 *   out (WORN_WARN uses left) before it ever breaks; before each strike the button greys exactly when the sim
 *   refuses (`planStrike`, the one answer), with its uses left and whether they're too few to get through;
 * - **the last blow:** full pockets grey it and the sim refuses it; a crew digger at the player's side takes the
 *   rubble, so the button lights and the blow lands (2.36's fix: the button greyed it);
 * - **out of sight:** a strike in a tunnel under the player's desk, then straight up into a guard's sight, isn't
 *   work seen (no "?"); under the old rules (`Sim.rules235`) it was; a strike on the floor in sight still is;
 * - **items:** every item's card says something unless it's junk, every tool's card has its numbers in both
 *   languages; every recipe made in one go from the handbook's slots (and not without the Intellect);
 * - **searches:** the shakedown guard walks to the player's cell and takes the contraband from the drawers and the
 *   bed, never the hidden compartment or what's legal, and says what (by name); after a capture, what was taken
 *   is said by name too; every guard's pockets hold its key, baton and uniform.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { ITEMS, itemDef, itemNumber } from '../src/content/items';
import { PRISONS } from '../src/content/prisons';
import type { PrisonDef } from '../src/content/prisons/types';
import { choices, RECIPES } from '../src/content/recipes';
import { command, OP, ORDER } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { planStrike } from '../src/sim/systems/actions';
import { lockAt, markerAt, sweetSpot } from '../src/sim/systems/games';
import { GUARD, assign } from '../src/sim/systems/guards';
import { canCraft, ingredientSlots, itemOf, maskOf, pocketOf, slot, usesOf } from '../src/sim/systems/items';
import { caught } from '../src/sim/systems/justice';
import { canDigFloor, toolTarget, underMyDesk, type ToolTarget } from '../src/sim/systems/structure';
import { setTile } from '../src/sim/systems/watch';
import { FENCE_HP, FLOOR_HP, GRATE_HP, UNIT, WALL_HP, WORN_WARN } from '../src/sim/tuning';
import { containersOf, playerDesk } from '../src/sim/world/containers';
import { TILE } from '../src/sim/world/tiles';
import { LAYER, MAP_H, MAP_W, placeKey } from '../src/sim/world/World';
import { check } from './assert';

// The button's words come from the play layer, which reads the screen as it loads: a page without one.
GlobalRegistrator.register({ url: 'http://localhost:5310/', width: 1440, height: 844 });
const { loadLang, setLang } = await import('../src/i18n');
await loadLang('fr');
const { describeTool } = await import('../src/play/labels');
const { itemFacts, itemsText } = await import('../src/ui/itemFacts');

const n = (id: string) => itemNumber(id);
const EAST = 1;
const SIDES: ReadonlyArray<[number, number, number]> = [
  [1, 0, 1],
  [0, 1, 5],
  [-1, 0, 9],
  [0, -1, 13],
];
const tileOf = (x: number, z: number) => z * MAP_W + x;
const OUT: readonly string[] = ['outside', 'perimeter'];
const xOf = (i: number) => i % MAP_W;
const zOf = (i: number) => Math.floor(i / MAP_W);
function stand(sim: Sim, tile: number, facing: number, layer: number = LAYER.GROUND) {
  const p = sim.state.player;
  p.x = xOf(tile) * UNIT + UNIT / 2;
  p.z = zOf(tile) * UNIT + UNIT / 2;
  p.facing = facing;
  p.moving = false;
  sim.state.layer = layer;
}
/** The hotbar holds these (slot 0 in hand), the rest empty. */
function carry(sim: Sim, ...ids: string[]) {
  const it = sim.state.items;
  for (let k = 0; k < 6; k++) it.inv[k] = ids[k] ? slot(n(ids[k])) : 0;
  it.hand = 0;
  it.rev++;
}
/** A prison as built, without its guards (nobody to see the work, nobody standing in the way). */
const quiet = (def: PrisonDef): PrisonDef => ({ ...def, guards: [] });
const held = (sim: Sim) => itemOf(sim.state.items.inv[sim.state.items.hand]);
const targetOf = (sim: Sim): ToolTarget | null => {
  const s = sim.state;
  return toolTarget(sim.world, s.layer, s.player, held(sim), [], s.items.inv);
};

/** Where each job is done in a prison: [where to stand, facing, the tile struck]; -1 when the prison has none. */
interface Spot {
  stand: number;
  facing: number;
  tile: number;
}
function spotFor(sim: Sim, job: 'chip' | 'cut' | 'unscrew' | 'dig'): Spot | null {
  const w = sim.world;
  // (What's struck depends on what's in hand: a tool for the job, held while looking.)
  const it = sim.state.items;
  const was = it.inv[it.hand];
  it.inv[it.hand] = slot(n({ chip: 'sturdy_pickaxe', cut: 'sturdy_cutters', unscrew: 'screwdriver', dig: 'sturdy_shovel' }[job]));
  const free = (i: number) => !w.blocked(xOf(i), zOf(i)) && !w.propSolid[i];
  const tries: Spot[] = [];
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    // (Inside the prison: a step outside the fence is an escape, and the game is over.)
    // (Between two fences is still inside, and where a fence is cut from in some prisons.)
    const zone = w.zoneAt(xOf(i), zOf(i));
    if (!free(i) || w.ground.kind[i] === TILE.DOOR || zone === 'outside' || (zone === 'perimeter' && job !== 'cut')) continue;
    if (job === 'unscrew') {
      if (w.layers[LAYER.VENTS].kind[i] === TILE.GRATE) tries.push({ stand: i, facing: EAST, tile: i });
      continue;
    }
    for (const [dx, dz, facing] of SIDES) {
      const x = xOf(i) + dx;
      const z = zOf(i) + dz;
      if (x <= 0 || z <= 0 || x >= MAP_W - 1 || z >= MAP_H - 1) continue;
      const j = tileOf(x, z);
      const k = w.ground.kind[j];
      if (job === 'chip' && k === TILE.BRICK && w.cellOf[i] === 1) tries.push({ stand: i, facing, tile: j });
      if (job === 'cut' && k === TILE.FENCE) tries.push({ stand: i, facing, tile: j });
      if (
        job === 'dig' &&
        canDigFloor(w, j, []) &&
        !underMyDesk(w, j) &&
        w.layers[LAYER.UNDER].kind[j] === TILE.SOIL &&
        !OUT.includes(w.zoneAt(x, z))
      )
        tries.push({ stand: i, facing, tile: j });
    }
  }
  // The first spot where the sim agrees on what's struck.
  let found: Spot | null = null;
  for (const sp of tries) {
    stand(sim, sp.stand, sp.facing);
    const tt = targetOf(sim);
    if (tt && tt.tile === sp.tile && tt.action === job && tt.fits) {
      found = sp;
      break;
    }
  }
  it.inv[it.hand] = was;
  return found;
}

const JOB_OF: Record<string, 'chip' | 'cut' | 'unscrew' | 'dig'> = {
  dig: 'dig',
  chip: 'chip',
  cut: 'cut',
  unscrew: 'unscrew',
  multi: 'chip',
};
const HP_OF: Record<string, number> = { dig: FLOOR_HP, chip: WALL_HP, cut: FENCE_HP, unscrew: GRATE_HP };
/** What each job leaves where it struck. */
const GIVES: Record<string, number> = { dig: TILE.SHAFT, chip: TILE.HOLE, cut: TILE.FENCE_CUT, unscrew: TILE.GRATE_OPEN };

// ------------------------------------------------------------------ the cards
{
  const tools = ITEMS.filter((d) => d.tool);
  for (const lang of ['en', 'fr'] as const) {
    setLang(lang);
    for (const d of tools) {
      const job = d.id === 'plastic_knife' ? 'cut' : JOB_OF[d.tool!.kind];
      const strikes = Math.ceil(HP_OF[job] / d.tool!.damage);
      const lines = itemFacts(n(d.id));
      check(lines.length === 2, `${lang} ${d.id}: what it does and its numbers`);
      check(
        lines[1].startsWith(`${strikes} `) && lines[1].includes(` ${d.tool!.energy} `),
        `${lang} ${d.id}: ${strikes} strikes and ${d.tool!.energy} energy on its card ("${lines[1]}")`,
      );
      const short = (d.uses ?? 0) < strikes;
      check(lines[1].includes(String(Math.ceil(strikes / d.uses!))) || !short, `${lang} ${d.id}: how many it takes when one won't do`);
    }
  }
  setLang('en');
  // Junk says nothing (it does nothing): the broom and the bleach; everything else says what it does or what it's for.
  const silent = ITEMS.filter((d) => itemFacts(n(d.id)).length === 0).map((d) => d.id);
  check(silent.join(',') === 'broom,bleach', `only the broom and the bleach say nothing (${silent.join(', ')})`);
  console.log(`cards: ${ITEMS.length - silent.length} of ${ITEMS.length} items say what they do (silent: ${silent.join(', ')})`);
}

// ------------------------------------------------------------------ tools at their jobs, in every prison
for (const def of PRISONS) {
  const rows: string[] = [];
  for (const d of ITEMS.filter((x) => x.tool)) {
    const sim = new Sim(quiet(def), 3);
    const s = sim.state;
    const job = d.id === 'plastic_knife' ? 'cut' : JOB_OF[d.tool!.kind];
    const sp = spotFor(sim, job);
    if (!sp) {
      rows.push(`${d.id} -`);
      check(job !== 'chip' && job !== 'dig', `${def.id}: somewhere to ${job}`);
      continue;
    }
    const strikesClaimed = Math.ceil(HP_OF[job] / d.tool!.damage);
    const toolsClaimed = Math.ceil(strikesClaimed / d.uses!);
    // As many as it takes, and room for what the work yields.
    carry(sim, ...new Array(Math.min(5, toolsClaimed)).fill(d.id));
    stand(sim, sp.stand, sp.facing);
    let strikes = 0;
    let broke = 0;
    let wornBefore = true;
    let warned = false;
    let agree = true;
    let usesOk = true;
    for (let k = 0; k < 400 && s.items.inv.some((v) => itemOf(v) === n(d.id)); k++) {
      if (held(sim) !== n(d.id)) {
        sim.step(
          command(
            0,
            OP.SELECT,
            s.items.inv.slice(0, 6).findIndex((v) => itemOf(v) === n(d.id)),
          ),
        );
        continue;
      }
      stand(sim, sp.stand, sp.facing);
      s.energy = 100;
      s.struckAt = -1000;
      const tt = targetOf(sim);
      if (!tt || tt.tile !== sp.tile) break;
      const view = describeTool(sim, tt, held(sim));
      const plan = planStrike(sim, tt, held(sim));
      const left = usesOf(s.items.inv[s.items.hand]);
      const worn = s.wear[placeKey(tt.layer, tt.tile)] ?? 0;
      if (!view || view.fits !== !plan.why) agree = false;
      if (view?.uses !== left || view.short !== left * plan.dmg < tt.hp - worn) usesOk = false;
      sim.step(command(0, OP.USE, 1));
      const ev = sim.events as SimEvent[];
      const landed = ev.some((e) => e.type === 'strike');
      if (landed !== !!view?.fits) {
        agree = false;
        if (process.env.DEBUG) console.log(def.id, d.id, JSON.stringify(ev), view, plan);
      }
      if (landed) strikes++;
      for (const e of ev) {
        if (e.type === 'worn' && e.item === n(d.id)) warned = true;
        if (e.type === 'broke' && e.item === n(d.id)) {
          broke++;
          if (!warned && d.uses! > WORN_WARN) wornBefore = false;
          warned = false;
        }
      }
      if (ev.some((e) => e.type === 'strike' && e.broke)) break;
    }
    const through = sim.world.layers[job === 'unscrew' ? LAYER.VENTS : LAYER.GROUND].kind[sp.tile] === GIVES[job];
    const toolsUsed = broke + (s.items.inv.some((v) => itemOf(v) === n(d.id)) ? 1 : 0);
    check(through, `${def.id}: ${d.id} gets through the ${job} target`);
    check(strikes === strikesClaimed, `${def.id}: ${d.id} takes ${strikesClaimed} strikes as its card says (took ${strikes})`);
    check(toolsUsed === Math.min(toolsClaimed, 5), `${def.id}: ${d.id}: ${toolsClaimed} of them, as its card says (used ${toolsUsed})`);
    check(wornBefore, `${def.id}: ${d.id} is said to be nearly worn out before it breaks`);
    check(agree, `${def.id}: ${d.id}: the button greys exactly when the strike is refused`);
    check(usesOk, `${def.id}: ${d.id}: the button's uses left and "not enough" match the tool`);
    rows.push(`${d.id} ${strikes}${toolsUsed > 1 ? `×${toolsUsed}` : ''}`);
  }
  console.log(`${def.id} tools: ${rows.join(', ')}`);
}

// ------------------------------------------------------------------ the last blow: full pockets, and a crew digger to take the rubble
for (const def of PRISONS) {
  const sim = new Sim(quiet(def), 3);
  const s = sim.state;
  const sp = spotFor(sim, 'chip')!;
  carry(sim, 'sturdy_pickaxe', 'sock', 'sock', 'sock', 'sock', 'sock');
  stand(sim, sp.stand, sp.facing);
  s.wear[placeKey(LAYER.GROUND, sp.tile)] = WALL_HP - 1;
  s.energy = 100;
  const grey = describeTool(sim, targetOf(sim), held(sim))?.fits === false;
  sim.step(command(0, OP.USE, 1));
  const refused = (sim.events as SimEvent[]).some((e) => e.type === 'cantStrike' && e.why === 'full');
  // A digger in the crew at the player's side (behind them, in their cell).
  const back = sp.stand - (sp.tile - sp.stand);
  const who = 0;
  s.crew.push([who, ORDER.DIG, -1, -1, 0]);
  const m = s.inmates[who];
  const placeHelper = () => {
    m.body.x = xOf(back) * UNIT + UNIT / 2;
    m.body.z = zOf(back) * UNIT + UNIT / 2;
    m.path = [];
  };
  placeHelper();
  stand(sim, sp.stand, sp.facing);
  s.struckAt = -1000;
  const lit = describeTool(sim, targetOf(sim), held(sim))?.fits === true;
  placeHelper();
  sim.step(command(0, OP.USE, 1));
  const through = sim.world.ground.kind[sp.tile] === TILE.HOLE;
  const theirs = (sim.events as SimEvent[]).some((e) => e.type === 'crew' && e.what === 'dirt');
  check(grey && refused, `${def.id}: the last blow with full pockets is grey and refused`);
  check(lit && through && theirs, `${def.id}: with a digger at the player's side it lights, lands, and the rubble is his`);
  console.log(
    `${def.id} last blow: full pockets grey ${grey}, refused ${refused}; a digger beside: lit ${lit}, through ${through}, his ${theirs}`,
  );
}

// ------------------------------------------------------------------ the wrong tool counts no uses; the lockpick warns before it breaks
for (const def of PRISONS) {
  const sim = new Sim(quiet(def), 3);
  const s = sim.state;
  const w = sim.world;
  const sp = spotFor(sim, 'chip')!;
  // Tools that can't chip, at a brick wall: grey, and no uses counted (they'd do nothing there).
  const wrong = ['flimsy_cutters', 'nail_file', 'light_shovel'].filter((id) => {
    carry(sim, id);
    stand(sim, sp.stand, sp.facing);
    const v = describeTool(sim, targetOf(sim), held(sim));
    return v && !v.fits && v.uses === null && !v.short;
  });
  check(wrong.length === 3, `${def.id}: cutters, a nail file, a shovel at a wall: grey, no uses counted (${wrong.join(', ')})`);
  // A keyed door the player can stand at, which stays locked while it's picked (some open by the routine's clock).
  let door = -1;
  let from = -1;
  let facing = 0;
  s.items.hand = 0;
  for (let i = 0; i < MAP_W * MAP_H && door < 0; i++) {
    if (lockAt(w, i) !== 'lock') continue;
    for (const [dx, dz, f] of SIDES) {
      const j = tileOf(xOf(i) - dx, zOf(i) - dz);
      if (w.blocked(xOf(j), zOf(j)) || w.ground.kind[j] === TILE.DOOR) continue;
      stand(sim, j, f);
      const tt = toolTarget(w, LAYER.GROUND, s.player, n('lockpick'), []);
      if (tt?.action !== 'pick' || tt.tile !== i || !tt.fits) continue;
      s.items.inv[0] = slot(n('lockpick'), WORN_WARN + 1);
      sim.step(command(0, OP.USE, 1));
      for (let k = 0; k < 3; k++) {
        stand(sim, j, f);
        sim.step(command(0));
      }
      if (s.pick.length && s.pick[0] === i) {
        [door, from, facing] = [i, j, f];
        break;
      }
    }
  }
  check(door >= 0, `${def.id}: a keyed door to pick`);
  const order: string[] = [];
  const spot: [number, number] = [0, 0];
  const inZone = (k: number) => {
    sweetSpot(s.salt, door, s.pick[1], s.items.int, spot);
    const m = markerAt(k);
    return m >= spot[0] && m <= spot[1];
  };
  for (let k = 0; k < 2000 && order.at(-1) !== 'broke'; k++) {
    stand(sim, from, facing);
    // A press with the marker out of the green (now and a step ago): a slip.
    const slipNow = s.pick.length > 0 && !inZone(s.step + 1 - s.pick[2]) && !inZone(s.step - s.pick[2]);
    sim.step(command(0, OP.USE, s.pick.length === 0 || slipNow ? 1 : 0));
    for (const e of sim.events as SimEvent[]) {
      if (e.type === 'worn' && e.item === n('lockpick')) order.push(`worn ${e.left}`);
      if (e.type === 'broke' && e.item === n('lockpick')) order.push('broke');
    }
  }
  check(
    order.join(',') === `worn ${WORN_WARN},broke`,
    `${def.id}: the lockpick is said to be nearly worn out before it breaks (${order.join(', ')})`,
  );
  console.log(`${def.id}: wrong tools at a wall grey, uncounted; the lockpick: ${order.join(', then ')}`);
}

// ------------------------------------------------------------------ out of sight: work in a tunnel isn't seen from the floor
/** A guard put two tiles off the player, looking at them, standing still; the steps it saw them and the most its "?" filled. */
function watched(sim: Sim, steps = 12): { saw: number; most: number; spotted: string[] } {
  const s = sim.state;
  const p = s.player;
  const g = s.guards[0];
  const w = sim.world;
  const px = Math.floor(p.x / UNIT);
  const pz = Math.floor(p.z / UNIT);
  // The nearest open tile in sight within a few tiles (in the player's cell, or at its door).
  let best = -1;
  for (let r = 1; r <= 3 && best < 0; r++)
    for (let dz = -r; dz <= r && best < 0; dz++)
      for (let dx = -r; dx <= r && best < 0; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = px + dx;
        const z = pz + dz;
        if (!w.inside(x, z) || w.blocked(x, z)) continue;
        best = tileOf(x, z);
      }
  let saw = 0;
  let most = 0;
  const spotted: string[] = [];
  for (let k = 0; k < steps; k++) {
    g.body.x = xOf(best) * UNIT + UNIT / 2;
    g.body.z = zOf(best) * UNIT + UNIT / 2;
    const dx = p.x - g.body.x;
    const dz = p.z - g.body.z;
    const ang = Math.atan2(dz, dx);
    g.body.facing = 1 + (((Math.round((ang / (Math.PI * 2)) * 16) % 16) + 16) % 16);
    g.face = g.body.facing;
    g.path = [];
    g.wait = 100;
    sim.step(command(0));
    if (g.sees) saw++;
    most = Math.max(most, g.notice ?? 0);
    for (const e of sim.events as SimEvent[]) if (e.type === 'spotted') spotted.push(e.reason);
  }
  return { saw, most, spotted };
}
for (const def of PRISONS) {
  const run = (old: boolean, underground: boolean, restored = false) => {
    const sim = new Sim(def, 3);
    sim.rules235 = old;
    const s = sim.state;
    const w = sim.world;
    if (underground) {
      // A shaft under the player's desk, a tunnel tile below it, earth beside.
      const desk = containersOf(w)[playerDesk(w)].prop;
      const d = tileOf(desk.x, desk.z);
      setTile(sim, LAYER.GROUND, d, TILE.SHAFT);
      setTile(sim, LAYER.UNDER, d, TILE.TUNNEL);
      const side = SIDES.find(([dx, dz]) => w.layers[LAYER.UNDER].kind[tileOf(desk.x + dx, desk.z + dz)] === TILE.SOIL)!;
      carry(sim, 'sturdy_shovel');
      stand(sim, d, side[2], LAYER.UNDER);
      s.deskAside = true;
      s.energy = 100;
      sim.step(command(0, OP.USE, 1));
      const struck = (sim.events as SimEvent[]).some((e) => e.type === 'strike');
      // (Saved and loaded in between, as a save, a keyframe or the replay's seek does: the strike's layer kept.)
      if (restored) sim.restore(sim.snapshot());
      // Straight back up.
      sim.step(command(0, OP.INTERACT));
      return { struck, up: sim.state.layer === LAYER.GROUND, ...watched(sim) };
    }
    const sp = spotFor(sim, 'chip')!;
    carry(sim, 'sturdy_pickaxe');
    stand(sim, sp.stand, sp.facing);
    s.energy = 100;
    sim.step(command(0, OP.USE, 1));
    const struck = (sim.events as SimEvent[]).some((e) => e.type === 'strike');
    return { struck, up: true, ...watched(sim) };
  };
  const now = run(false, true);
  const was = run(true, true);
  const floor = run(false, false);
  const loaded = run(false, true, true);
  check(
    now.struck && now.up && now.saw > 0 && now.most === 0,
    `${def.id}: up from a tunnel strike into a guard's sight: no "?" (saw ${now.saw}, ${now.most})`,
  );
  check(
    loaded.struck && loaded.up && loaded.saw > 0 && loaded.most === 0 && !loaded.spotted.includes('tampering'),
    `${def.id}: the same with a save and a load between the strike and the climb (${loaded.most}, ${loaded.spotted.join(',')})`,
  );
  check(was.struck && was.up && was.saw > 0 && was.most > 0, `${def.id}: under the old rules, the "?" filled (${was.most})`);
  check(floor.struck && floor.saw > 0 && floor.most > 0, `${def.id}: a strike on the floor in sight still fills it (${floor.most})`);
  console.log(
    `${def.id} out of sight: up from the tunnel "?" ${now.most} (saved and loaded between ${loaded.most}; old rules ${was.most}); on the floor ${floor.most}${floor.spotted.length ? ` then ${floor.spotted.join(',')}` : ''}`,
  );
}

// ------------------------------------------------------------------ crafting from the handbook, in one go
{
  const sim = new Sim(quiet(PRISONS[0]), 3);
  const s = sim.state;
  const it = s.items;
  let made = 0;
  let lowRefused = 0;
  for (let k = 0; k < RECIPES.length; k++) {
    const r = RECIPES[k];
    const lay = () => {
      it.inv.fill(0);
      r.ingredients.forEach((ing, j) => (it.inv[j] = slot(n(choices(ing)[0]))));
      it.rev++;
    };
    // Not enough Intellect: the handbook offers no button, and a craft does nothing.
    lay();
    it.int = r.int - 1;
    const low = canCraft(it, k) !== 'ok';
    sim.step(command(0, OP.CRAFT, maskOf(ingredientSlots(it, k)!), k + 1));
    if (low && !(sim.events as SimEvent[]).some((e) => e.type === 'crafted')) lowRefused++;
    lay();
    it.int = 100;
    const used = ingredientSlots(it, k);
    check(!!used && canCraft(it, k) === 'ok', `${r.result}: ready in the handbook with its ingredients carried`);
    sim.step(command(0, OP.CRAFT, maskOf(used!), k + 1));
    const ok =
      (sim.events as SimEvent[]).some((e) => e.type === 'crafted' && e.recipe === k) &&
      it.inv.some((v) => itemOf(v) === n(r.result)) &&
      (r.keep ?? []).every((id) => it.inv.some((v) => itemOf(v) === n(id)));
    check(ok, `${r.result}: made in one go from the handbook`);
    if (ok) made++;
  }
  check(made === RECIPES.length && lowRefused === RECIPES.length, 'every recipe in one go, none without the Intellect');
  console.log(
    `crafting: ${made} of ${RECIPES.length} recipes made in one go from the handbook; ${lowRefused} refused a point short of their Intellect`,
  );
}

// ------------------------------------------------------------------ searches, captures and pockets
for (const def of PRISONS) {
  const sim = new Sim(def, 3);
  const s = sim.state;
  const w = sim.world;
  const desk = playerDesk(w);
  const box = containersOf(w)[desk];
  const bed = containersOf(w).findIndex((c) => c.mine && c.prop.kind === 'bed');
  const d = s.items.containers[desk];
  d.fill(0);
  d[0] = slot(n('lighter'));
  d[box.hidden] = slot(n('duct_tape'));
  d[box.hidden + 1] = slot(n('magazine'));
  d[box.hidden + 2] = slot(n('duct_tape'));
  s.items.containers[bed][1] = slot(n('bed_dummy'));
  const k = def.guards.findIndex((g) => g.duties?.includes('shakedown'));
  let line = `${def.id} search: `;
  if (k < 0) line += 'no shakedown guard';
  else {
    assign(s.guards[k], GUARD.SHAKEDOWN, [1]);
    const from = s.step;
    let got: (SimEvent & { type: 'searched' }) | null = null;
    for (let t = 0; t < 20 * 60 * 30 && !got; t++) {
      sim.step(command(0));
      for (const e of sim.events as SimEvent[]) if (e.type === 'searched' && e.cell === 1) got = e;
    }
    check(!!got, `${def.id}: the shakedown guard searches the player's cell`);
    const taken = (got?.items ?? []).map((v) => itemDef(v).id).sort();
    check(
      taken.join(',') === 'bed_dummy,duct_tape,duct_tape',
      `${def.id}: the drawers' and the bed's contraband taken, named (${taken.join(', ')})`,
    );
    check(
      itemOf(d[0]) === n('lighter') && itemOf(d[box.hidden + 1]) === n('magazine'),
      `${def.id}: the hidden compartment and the legal kept`,
    );
    setLang('en');
    const en = itemsText(got?.items ?? []);
    setLang('fr');
    const fr = itemsText(got?.items ?? []);
    setLang('en');
    line += `${Math.round((s.step - from) / 20)} s to get there; took ${en} / ${fr}`;
  }
  // Caught: what was on the player, by name.
  carry(sim, 'light_cutters', 'magazine');
  s.items.inv[6] = slot(n('comb_shiv'));
  s.items.inv[7] = slot(n('guard_outfit'));
  s.heat = 50;
  caught(sim);
  let woke: (SimEvent & { type: 'infirmary' }) | null = null;
  for (let t = 0; t < 20 * 60 && !woke; t++) {
    sim.step(command(0));
    for (const e of sim.events as SimEvent[]) if (e.type === 'infirmary') woke = e;
  }
  const off = (woke?.items ?? []).map((v) => itemDef(v).id).sort();
  check(
    off.join(',') === 'comb_shiv,guard_outfit,light_cutters' && woke?.taken === 3 && s.items.inv.some((v) => itemOf(v) === n('magazine')),
    `${def.id}: caught, the contraband carried taken by name, the legal kept (${off.join(', ')})`,
  );
  // Every guard's pockets: its key, a baton, its uniform.
  const kits = def.guards.every((g, j) => {
    const p = s.items.containers[pocketOf(w, s.inmates.length + j)].map(itemOf);
    return p.includes(n(`key_${g.key}`)) && p.includes(n('baton')) && p.includes(n('guard_outfit'));
  });
  check(kits, `${def.id}: every guard's pockets hold its key, a baton and its uniform`);
  console.log(`${line}; caught: ${itemsText(woke?.items ?? [])}; ${def.guards.length} guards' pockets full`);
}
