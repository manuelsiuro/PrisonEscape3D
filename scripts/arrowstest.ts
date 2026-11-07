/**
 * The arrows keep their promise (2.36): where the floor arrows end, the action button does what they led
 * there for, whoever stands by. In every prison, on every tile the arrows can end on for
 *   - a meal with the tray in hand (a free seat at a table: sit and eat),
 *   - the first day's desk (the player's own desk: search it),
 *   - the first day's job board (read it),
 *   - the job's next station in the Work Period (its step),
 * facing each of the four ways, with an inmate who'd talk on each tile round the player in reach,
 * the press must do what it does with nobody about. Before 2.36 (Sim.rules235) a bystander the player
 * happened to face took the press (the meal's seat, the desk), as old runs replay.
 */
import { PRISONS } from '../src/content/prisons';
import type { Sim } from '../src/sim/Sim';
import { jobRooms } from '../src/sim/systems/economy';
import { TRAY } from '../src/sim/systems/inmates';
import { interactPlan, type Plan } from '../src/sim/systems/interact';
import { seatSpot } from '../src/sim/systems/rest';
import { UNIT } from '../src/sim/tuning';
import { placesOf } from '../src/sim/ai/places';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';
import { Bot, DIR } from './bots';

const FACES = [DIR.NORTH, DIR.EAST, DIR.SOUTH, DIR.WEST];
const ROUND = [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz) => [dx, dz] as const)).filter(([dx, dz]) => dx || dz);

const put = (b: { x: number; z: number; moving?: boolean }, tile: number) => {
  b.x = (tile % MAP_W) * UNIT + UNIT / 2;
  b.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
};
const what = (p: Plan | null) => (p ? p.do + ('target' in p && p.target ? `:${p.target.kind}` : '') : 'nothing');

/** Everyone out of the way (a corner of the map): the press with nobody about. */
function clear(sim: Sim) {
  for (const m of sim.state.inmates) put(m.body, MAP_W + 1);
  for (const g of sim.state.guards) put(g.body, MAP_W + 1);
}

/**
 * On each tile, each way faced: the plan with nobody about, then with a talker on each tile round. Returns
 * [tiles, presses tried, presses taken by the bystander, an example].
 */
function probe(sim: Sim, tiles: number[], expect: (p: Plan | null) => boolean): [number, number, number, string] {
  const s = sim.state;
  const p = s.player;
  const by = s.inmates[0];
  let tried = 0;
  let lost = 0;
  let example = '';
  let used = 0;
  for (const t of tiles) {
    clear(sim);
    put(p, t);
    p.moving = false;
    for (const f of FACES) {
      clear(sim);
      p.facing = f;
      const alone = interactPlan(sim);
      if (!expect(alone)) continue;
      used++;
      for (const [dx, dz] of ROUND) {
        const n = t + dz * MAP_W + dx;
        if (sim.world.npcBlock[n]) continue;
        // (Not on the seat the player would take: sitting there is refused, someone in the way.)
        if (alone?.do === 'fixture' && alone.target.use === 'sit') {
          const spot = seatSpot(sim.world, alone.target.index, p);
          if (spot.z * MAP_W + spot.x === n) continue;
        }
        clear(sim);
        put(by.body, n);
        by.ko = 0;
        by.angry = 0;
        tried++;
        const got = interactPlan(sim);
        if (what(got) !== what(alone)) {
          lost++;
          example ||= `${t % MAP_W},${Math.floor(t / MAP_W)} facing ${f}, someone at ${dx},${dz}: ${what(got)} for ${what(alone)}`;
        }
      }
    }
  }
  return [used, tried, lost, example];
}

const results: string[] = [];
for (const def of PRISONS) {
  // Breakfast, a tray in hand: every free seat at the canteen's tables.
  {
    const bot = new Bot(def, 3);
    check(bot.routineUntil(1, 9 * 60 + 2), `${def.id}: breakfast`);
    const sim = bot.sim;
    sim.state.tray = TRAY.FULL;
    const seats = placesOf(sim.world).seats.map((q) => q.tile);
    const [used, tried, lost, ex] = probe(sim, seats, (p) => p?.do === 'fixture' && p.target.use === 'sit');
    results.push(
      `${def.id} meal seats: ${seats.length} tiles, ${used} ways sat, ${tried} presses with someone by, ${lost} taken${ex ? ` (${ex})` : ''}`,
    );
    check(lost === 0, `${def.id}: at the table with a tray, the seat first (${lost} of ${tried})`);
    // Old runs: the bystander faced still takes it.
    sim.rules235 = true;
    const [, , oldLost] = probe(sim, seats, (p) => p?.do === 'fixture' && p.target.use === 'sit');
    sim.rules235 = false;
    results.push(`  before 2.36: ${oldLost} taken`);
    check(oldLost > 0, `${def.id}: before 2.36, a bystander faced took the press (${oldLost})`);
  }
  // Free time on day 1: the desk, the job board.
  {
    const bot = new Bot(def, 3);
    check(bot.routineUntil(1, 10 * 60 + 5), `${def.id}: free time`);
    const sim = bot.sim;
    const w = sim.world;
    const near = (p: { x: number; z: number; w: number; d: number }) => {
      const out: number[] = [];
      for (let x = p.x - 1; x <= p.x + p.w; x++)
        for (let z = p.z - 1; z <= p.z + p.d; z++) {
          const inside = x >= p.x && x < p.x + p.w && z >= p.z && z < p.z + p.d;
          const side = (x >= p.x && x < p.x + p.w) || (z >= p.z && z < p.z + p.d);
          if (!inside && side && !w.npcBlock[z * MAP_W + x]) out.push(z * MAP_W + x);
        }
      return out;
    };
    const desk = w.props.find((p) => p.kind === 'desk' && w.cellOf[p.z * MAP_W + p.x] === 1)!;
    const deskTiles = [placesOf(w).deskside[1]];
    const [dUsed, dTried, dLost, dEx] = probe(sim, deskTiles, (p) => p?.do === 'search');
    results.push(`${def.id} desk: ${deskTiles.length} tile, ${dUsed} ways, ${dTried} presses, ${dLost} taken${dEx ? ` (${dEx})` : ''}`);
    check(dLost === 0, `${def.id}: beside the desk, the desk first (${dLost} of ${dTried})`);
    check(!!desk, `${def.id}: the player's desk`);
    const board = w.props.find((p) => p.kind === 'jobBoard');
    if (board) {
      const [bUsed, bTried, bLost, bEx] = probe(sim, near(board), (p) => p?.do === 'fixture' && p.target.use === 'board');
      results.push(`${def.id} job board: ${bUsed} ways, ${bTried} presses, ${bLost} taken${bEx ? ` (${bEx})` : ''}`);
      check(bLost === 0, `${def.id}: at the job board, the board first (${bLost} of ${bTried})`);
    }
  }
  // The Work Period: the first job's take station, hands empty.
  {
    const bot = new Bot(def, 3);
    check(bot.routineUntil(1, 12 * 60 + 5), `${def.id}: work`);
    const sim = bot.sim;
    const room = jobRooms(sim.world)[sim.jobActive()];
    if (room && room.take >= 0) {
      const p = sim.world.props[room.take];
      const tiles: number[] = [];
      for (let x = p.x - 1; x <= p.x + p.w; x++)
        for (let z = p.z - 1; z <= p.z + p.d; z++) {
          const inside = x >= p.x && x < p.x + p.w && z >= p.z && z < p.z + p.d;
          if (!inside && !sim.world.npcBlock[z * MAP_W + x]) tiles.push(z * MAP_W + x);
        }
      const [used, tried, lost, ex] = probe(sim, tiles, (q) => q?.do === 'work');
      results.push(`${def.id} job (${room.def.id}): ${used} ways at its take, ${tried} presses, ${lost} taken${ex ? ` (${ex})` : ''}`);
      check(lost === 0, `${def.id}: at the job's station, its step first (${lost} of ${tried})`);
    }
  }
}
for (const r of results) console.log(r);
