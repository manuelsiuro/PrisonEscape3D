/**
 * Stalag Flucht's own rules (P9, GDD §4.2), through the real simulation:
 * - the cold: a minute out in the snow chills the player (an event), and a chilled player's
 *   tools cost twice the energy; indoors it wears off four times as fast; a cushioned or
 *   plated outfit keeps it out; Center Perks has no cold at all;
 * - the boulders: granite under the ground that no tool digs (the strike is refused, the rock
 *   stays), and no tunnel entrance over one.
 * Its map, jobs and escapes are proven by the generic suites (maptest, economytest, escapetest).
 */
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { STALAG_FLUCHT } from '../src/content/prisons/stalag-flucht';
import { placesOf } from '../src/sim/ai/places';
import { SLOT } from '../src/sim/command';
import { itemDef } from '../src/content/items';
import { slot } from '../src/sim/systems/items';
import { canDigFloor } from '../src/sim/systems/structure';
import { chilled, energyCost, exposed } from '../src/sim/systems/weather';
import { COLD_STEPS, WARM_RATE } from '../src/sim/tuning';
import { TILE } from '../src/sim/world/tiles';
import { LAYER, placeKey } from '../src/sim/world/World';
import { Bot, DIR, n, tileOf } from './bots';
import { check } from './assert';

// ------------------------------------------------------------------ the cold
{
  const bot = new Bot(STALAG_FLUCHT, 1);
  const st = bot.st;
  const sim = bot.sim;
  const places = placesOf(sim.world);
  check(!exposed(sim), 'warm in the cabin');
  // Out to roll call on the snow, then stand there.
  check(bot.walkTo(places.rollCall[0].tile), 'out to roll call');
  check(exposed(sim) && st.cold > 0, 'the cold builds outdoors');
  let outSteps = 0;
  let bit = -1;
  for (let k = 0; k < 2 * COLD_STEPS && bit < 0; k++) {
    bot.step(0);
    outSteps++;
    if (sim.events.some((e) => e.type === 'cold' && e.on)) bit = st.cold;
  }
  check(bit === COLD_STEPS && chilled(sim), `chilled after a minute outdoors (cold ${bit})`);
  check(energyCost(sim, 10) === 20, 'chilled: energy costs double');
  // Back indoors: it wears off four times as fast as it came.
  check(bot.walkTo(tileOf(6, 13)), 'back in the cabin');
  const left = st.cold;
  const inAt = st.step;
  check(!exposed(sim) && bot.until(() => st.cold === 0, COLD_STEPS), 'the cold wears off indoors');
  const warmIn = st.step - inAt;
  check(left > 0 && warmIn === Math.ceil(left / WARM_RATE), `four times as fast (${left} → 0 in ${warmIn} steps)`);

  // A cushioned outfit keeps it out.
  st.items.inv[SLOT.OUTFIT] = slot(n('cushioned_outfit'));
  check(bot.walkTo(places.rollCall[0].tile), 'out again, cushioned');
  bot.until(() => false, 2 * COLD_STEPS);
  check(st.cold === 0 && !chilled(sim), 'never cold in a cushioned outfit');
  st.items.inv[SLOT.OUTFIT] = slot(n('plated_outfit'));
  bot.until(() => false, 2 * COLD_STEPS);
  check(st.cold === 0, 'nor in a plated one');
  // Last (a guard may well see it): out of the warm outfit, chilled again, a real strike on a
  // cabin wall from the snow costs twice the pickaxe's energy.
  st.items.inv[SLOT.OUTFIT] = slot(n('inmate_outfit'));
  bot.until(() => chilled(sim), 2 * COLD_STEPS);
  st.items.inv[0] = slot(n('sturdy_pickaxe'));
  check(bot.walkTo(tileOf(3, 9)), 'beside cabin A’s west wall');
  bot.face(DIR.EAST);
  bot.hold('sturdy_pickaxe');
  const before = st.energy;
  bot.use();
  const spent = before - st.energy;
  check(chilled(sim) && spent === 2 * itemDef(n('sturdy_pickaxe')).tool!.energy, `a chilled strike costs double (${spent})`);
  console.log(`cold: chilled after ${outSteps} more steps outdoors (${COLD_STEPS} in all), indoors ${left} wore off in ${warmIn} steps, a chilled strike cost ${spent}`);
}
{
  // Center Perks: no weather.
  const bot = new Bot(CENTER_PERKS, 1);
  check(bot.walkTo(placesOf(bot.sim.world).rollCall[0].tile), 'Center Perks: out to roll call');
  bot.until(() => false, 2 * COLD_STEPS);
  check(bot.st.cold === 0 && !exposed(bot.sim), 'Center Perks: never cold');
}

// ------------------------------------------------------------------ the boulders
{
  const bot = new Bot(STALAG_FLUCHT, 2);
  const st = bot.st;
  const w = bot.sim.world;
  const under = w.layers[LAYER.UNDER].kind;
  const boulders = Array.from(under).filter((k) => k === TILE.BOULDER).length;
  check(under[tileOf(8, 5)] === TILE.BOULDER && under[tileOf(10, 5)] === TILE.SOIL, 'boulders where the picture has them');
  // No tunnel entrance over a boulder (the roll call square has one under it).
  check(under[tileOf(14, 23)] === TILE.BOULDER && !canDigFloor(w, tileOf(14, 23), []) && canDigFloor(w, tileOf(13, 23), []), 'no entrance dug over a boulder');
  // Down under the desk, one tile north, and the boulder ahead.
  bot.stash('sturdy_shovel');
  const places = placesOf(w);
  check(bot.walkTo(places.deskside[1]), 'beside the desk');
  bot.face(DIR.EAST);
  bot.open(bot.desk);
  bot.takeAll(1);
  bot.close();
  check(bot.strikeUntil('sturdy_shovel', () => w.ground.kind[tileOf(8, 7)] === TILE.SHAFT), 'the entrance under the desk');
  // Its dirt kept in the pockets (no need to hide it here).
  bot.open(bot.desk);
  bot.act(1);
  check(st.layer === LAYER.UNDER, 'down the tunnel');
  bot.face(DIR.NORTH);
  check(bot.strikeUntil('sturdy_shovel', () => under[tileOf(8, 6)] !== TILE.SOIL), 'a tile north dug');
  check(bot.walkTo(tileOf(8, 6), 400), 'along it');
  bot.face(DIR.NORTH);
  const energy = st.energy;
  bot.hold('sturdy_shovel');
  bot.use();
  const refused = bot.sim.events.find((e) => e.type === 'cantStrike');
  check(refused?.type === 'cantStrike' && refused.why === 'boulder', `the boulder refuses the shovel (${refused?.type === 'cantStrike' ? refused.why : 'no refusal'})`);
  check(under[tileOf(8, 5)] === TILE.BOULDER && st.energy === energy && !st.wear[placeKey(LAYER.UNDER, tileOf(8, 5))], 'the rock stays, no energy spent');
  console.log(`boulders: ${boulders} under Stalag Flucht; the shovel stopped at 8,5`);
}
