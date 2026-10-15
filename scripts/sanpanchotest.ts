/**
 * San Pancho's own rules (P11, GDD §4.4), on its map and through the real simulation:
 * - two walls of reinforced concrete, the minefield between them (every tile of sand a mine)
 *   with a paved corridor through it, and no gate a key can't open;
 * - nobody else ever sets foot on a mine: inmates and guards keep off, and so do the player's
 *   own routes (tap to walk, the arrows), over a day of the prison going about its business;
 * - a step onto a mine sets it off: 100 health, the alarm, out cold and into solitary; its
 *   crater is safe ground until 08:00, when the mine is laid again; the very strong are left
 *   standing in the open, where the snipers (on duty round the clock) take aim;
 * - digging up out of a tunnel into the minefield sets the mine above off;
 * - the supply road: red keys through the control room and the inner wall, green through the
 *   outer gate, a way down the corridor that never touches a mine;
 * - the lawless interior: a few inmates bear a grudge from day 1, and they settle it in free
 *   time too (where elsewhere only meals and the showers see it).
 * Its jobs and its three escapes are proven by the generic suites (economytest, escapetest).
 */
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { SAN_PANCHO } from '../src/content/prisons/san-pancho';
import { ROUTINE } from '../src/content/routine';
import { findPath } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { WAKE } from '../src/sim/state';
import { maxHealth } from '../src/sim/systems/combat';
import { snipersOnDuty } from '../src/sim/systems/power';
import { toolTarget } from '../src/sim/systems/structure';
import { slot } from '../src/sim/systems/items';
import { KO_STEPS, MINE_DAMAGE, STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { KEY, TILE } from '../src/sim/world/tiles';
import { LAYER, MAP_H, MAP_W } from '../src/sim/world/World';
import { Bot, DIR, n, tileOf } from './bots';
import { check } from './assert';

const place = (bot: Bot, x: number, z: number, layer: number = LAYER.GROUND) => {
  bot.st.player.x = x * UNIT + UNIT / 2;
  bot.st.player.z = z * UNIT + UNIT / 2;
  bot.st.layer = layer;
};
const tileAt = (bot: Bot) => Math.floor(bot.st.player.z / UNIT) * MAP_W + Math.floor(bot.st.player.x / UNIT);

// ------------------------------------------------------------------ the walls and the minefield
{
  const bot = new Bot(SAN_PANCHO, 1);
  const w = bot.sim.world;
  const g = w.ground;
  const ring = (a: number, b: number) => {
    const out: number[] = [];
    for (let k = a; k <= b; k++) out.push(tileOf(k, a), tileOf(k, b), tileOf(a, k), tileOf(b, k));
    return [...new Set(out)];
  };
  const outer = ring(2, 61);
  const inner = ring(8, 55);
  check(outer.every((i) => [TILE.REINFORCED, TILE.TOWER, TILE.DOOR].includes(g.kind[i] as never)), 'the outer wall: reinforced concrete, the towers and its gate');
  check(inner.every((i) => [TILE.REINFORCED, TILE.DOOR].includes(g.kind[i] as never)), 'the inner wall: reinforced concrete and its door');
  const doors = (tiles: number[]) => tiles.filter((i) => g.kind[i] === TILE.DOOR).map((i) => `${i % MAP_W},${Math.floor(i / MAP_W)}:${g.key[i]}`);
  check(doors(outer).join() === `31,61:${KEY.GREEN},32,61:${KEY.GREEN}`, `the outer wall's one gate is green (${doors(outer).join(' ')})`);
  check(doors(inner).join() === `31,55:${KEY.RED},32,55:${KEY.RED}`, `the inner wall's one door is red (${doors(inner).join(' ')})`);
  let mines = 0;
  let paved = 0;
  let other = 0;
  for (let z = 3; z <= 60; z++) {
    for (let x = 3; x <= 60; x++) {
      if (x >= 8 && x <= 55 && z >= 8 && z <= 55) continue;
      const k = g.kind[tileOf(x, z)];
      if (k === TILE.MINE) mines++;
      else if (k === TILE.ASPHALT && x >= 30 && x <= 33 && z >= 56) paved++;
      else if (k !== TILE.TOWER) other++;
    }
  }
  check(other === 0 && paved === 20, `between the walls: mines, and the paved corridor (${mines} mines, ${paved} paved, ${other} other)`);
  check(w.gate.every((v) => v === 0), 'no gate a key cannot open');
  console.log(`walls: outer and inner reinforced, gates green (outer) and red (inner); ${mines} mines between them, a corridor of ${paved} paved tiles`);
}

// ------------------------------------------------------------------ nobody else walks on mines
{
  const bot = new Bot(SAN_PANCHO, 2);
  const w = bot.sim.world;
  const st = bot.st;
  let wrong = 0;
  for (let i = 0; i < MAP_W * MAP_H; i++) {
    if (w.ground.kind[i] !== TILE.MINE) continue;
    if (!w.npcBlock[i] || !w.guardBlock[i] || !w.routeBlock[i] || w.block[i]) wrong++;
  }
  check(wrong === 0, `inmates, guards and the player's routes keep off every mine; the player's own feet don't (${wrong} wrong)`);
  // A day and a night of the prison at work, the player idle in the cell (the lockdown sends every guard about).
  let onMine = 0;
  const day = 1440 * STEPS_PER_MINUTE;
  for (let k = 0; k < day; k++) {
    bot.step(0);
    for (const b of [...st.inmates.map((m) => m.body), ...st.guards.map((g) => g.body)]) {
      if (w.ground.kind[Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT)] === TILE.MINE) onMine++;
    }
  }
  check(onMine === 0 && st.craters.length === 0, `a day of it: no inmate or guard ever on a mine (${onMine}), none set off`);
  console.log(`mines kept off: ${st.inmates.length} inmates and ${st.guards.length} guards over a day, lockdown ${st.lockdown ? 'on' : 'off'}`);
}

// ------------------------------------------------------------------ a step onto a mine
{
  const bot = new Bot(SAN_PANCHO, 3);
  const st = bot.st;
  place(bot, 30, 58);
  const hp = st.health;
  const blasted = bot.until(() => bot.sim.events.some((e) => e.type === 'blast'), 100, () => command(DIR.WEST));
  const at = tileAt(bot);
  check(blasted && at === tileOf(29, 58), 'off the corridor, the first step onto the sand sets a mine off');
  check(hp < MINE_DAMAGE && st.ko > 0 && st.wake === WAKE.SOLITARY, `${MINE_DAMAGE} health (of ${hp}): out cold, and solitary when they wake`);
  check(st.craters.join() === String(tileOf(29, 58)), 'a crater where the mine was');
  bot.until(() => st.ko === 0 && st.solitary > 0, KO_STEPS + 40);
  check(bot.sim.playerZone === 'solitary', `woken in solitary (${bot.sim.playerZone})`);
  // The crater is safe ground today.
  st.solitary = 0;
  place(bot, 29, 58);
  for (let k = 0; k < 20; k++) bot.step(0);
  check(!bot.sim.events.some((e) => e.type === 'blast') && st.ko === 0, 'standing in the crater: nothing');
  place(bot, 20, 30);
  // Tomorrow morning, a new mine in it.
  bot.until(() => st.step >= 1440 * STEPS_PER_MINUTE + 2, 1440 * STEPS_PER_MINUTE + 4);
  check(st.craters.length === 0, 'at 08:00 the mine is laid again');
  console.log(`a mine underfoot: ${MINE_DAMAGE} health, out cold, solitary; the crater safe till 08:00`);
}

// ------------------------------------------------------------------ strong enough to stand
{
  const bot = new Bot(SAN_PANCHO, 4);
  const st = bot.st;
  st.str = 70;
  st.health = maxHealth(st.str);
  place(bot, 7, 57);
  bot.until(() => bot.sim.events.some((e) => e.type === 'blast'), 100, () => command(DIR.WEST));
  check(st.ko === 0 && st.health === maxHealth(70) - MINE_DAMAGE && st.lockdown && st.heat === 100, `Strength 70: left standing on ${st.health} health, wanted, the lockdown on`);
  const aimed = bot.until(() => bot.sim.events.some((e) => e.type === 'aim'), 10 * 20);
  check(aimed, 'a sniper takes aim at once');
  console.log(`a mine at Strength 70: ${st.health} health left, a sniper taking aim`);
}

// ------------------------------------------------------------------ up into a mine from below
{
  const bot = new Bot(SAN_PANCHO, 5);
  const st = bot.st;
  const w = bot.sim.world;
  w.setKind(LAYER.UNDER, tileOf(40, 6), TILE.TUNNEL);
  w.setKind(LAYER.UNDER, tileOf(40, 5), TILE.TUNNEL);
  place(bot, 40, 5, LAYER.UNDER);
  st.player.facing = DIR.SOUTH;
  st.items.inv[0] = slot(n('sturdy_shovel'));
  st.items.hand = 0;
  const target = toolTarget(w, LAYER.UNDER, st.player, n('sturdy_shovel'), []);
  check(target?.action === 'digUp' && target.tile === tileOf(40, 5), 'under the minefield, the shovel can dig up');
  const blasted = bot.strikeUntil('sturdy_shovel', () => bot.sim.events.some((e) => e.type === 'blast'));
  check(blasted && w.ground.kind[tileOf(40, 5)] === TILE.MINE && st.ko > 0, 'dug up into the mine: it goes off, no way out there');
  console.log('digging up under the minefield sets the mine off');
}

// ------------------------------------------------------------------ the supply road
{
  const bot = new Bot(SAN_PANCHO, 6);
  const w = bot.sim.world;
  const shut = (x: number, z: number) => w.block[tileOf(x, z)] === 1;
  check(shut(31, 44) && shut(31, 52) && shut(31, 55) && shut(31, 61), 'no keys: the control room, the inner wall and the outer gate are shut');
  w.setPlayerKeys(1 << KEY.RED);
  check(!shut(31, 44) && !shut(31, 52) && !shut(31, 55) && shut(31, 61), 'red keys: through the control room and the inner wall, the outer gate still shut');
  w.setPlayerKeys((1 << KEY.RED) | (1 << KEY.GREEN));
  check(!shut(31, 61), 'red and green: the outer gate too');
  const path = findPath(w, tileOf(31, 41), (i) => i === tileOf(31, 62), tileOf(31, 62), MAP_W * MAP_H, undefined, w.routeBlock);
  check(!!path && path.every((i) => w.ground.kind[i] !== TILE.MINE), `a way from the plaza to the road that never touches a mine (${path?.length ?? 0} tiles)`);
  check(findPath(w, tileOf(31, 58), (i) => i === tileOf(26, 58), tileOf(26, 58), MAP_W * MAP_H, undefined, w.routeBlock) === null, 'no route leads into the minefield');
  console.log(`supply road: red through the control room and the inner wall, green through the gate; ${path?.length} tiles to the road, none of them mined`);
}

// ------------------------------------------------------------------ snipers round the clock
{
  const bot = new Bot(SAN_PANCHO, 7);
  bot.st.routine = ROUTINE.findIndex((r) => r.id === 'lightsOut');
  const cp = new Bot(CENTER_PERKS, 7);
  cp.st.routine = bot.st.routine;
  check(snipersOnDuty(bot.sim) && !snipersOnDuty(cp.sim), 'at night the snipers stay on (Center Perks: the searchlights take over)');
  console.log('snipers: on duty day and night');
}

// ------------------------------------------------------------------ the lawless interior
{
  const bot = new Bot(SAN_PANCHO, 8);
  const st = bot.st;
  const grudge = st.inmates.filter((m) => m.opinion <= 25).map((m) => m.cell);
  check(grudge.join() === '4,8,12' && st.inmates.every((m) => m.opinion === 20 || m.opinion === 40), `day 1: three inmates bear a grudge (cells ${grudge.join(', ')}), the rest cool (40)`);
  check(new Bot(CENTER_PERKS, 8).st.inmates.every((m) => m.opinion === 50), 'Center Perks: everyone starts at 50');
  /** Free time on day 1, the player by a grudge-bearer in the yard: steps until the ambush (-1 never). */
  const ambush = (b: Bot) => {
    const s = b.st;
    b.routineUntil(1, 10 * 60 + 5);
    const m = s.inmates.find((x) => x.opinion <= 25)!;
    m.opinion = 20;
    for (let k = 0; k < 4000; k++) {
      // Keep beside them wherever they go (in the yard), in their sight.
      s.player.x = m.body.x + UNIT;
      s.player.z = m.body.z;
      s.heat = 0;
      b.step(0);
      if (b.sim.events.some((e) => e.type === 'ambush')) return k;
    }
    return -1;
  };
  const here = ambush(bot);
  check(here >= 0, `in free time, a grudge is settled (after ${here} steps)`);
  const cpBot = new Bot(CENTER_PERKS, 8);
  cpBot.st.inmates[2].opinion = 20;
  const there = ambush(cpBot);
  check(there < 0, 'at Center Perks, never in free time');
  console.log(`lawless: three grudges from day 1; a free-time ambush after ${(here / 20).toFixed(0)} s (never at Center Perks)`);
}

