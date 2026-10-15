/**
 * Shankton State Pen's own rules (P10, GDD §4.3), on its map and through the real simulation:
 * - the reinforced concrete shell: closed all round (walls and doors only), and no tool
 *   chips it (the strike is refused, no energy spent), where a brick wall inside gives way;
 * - the detector chokepoints: from either cell wing, nothing past the gym and showers can be
 *   walked to without stepping through an arch;
 * - cameras in every corridor, and how much of each they watch over a sweep;
 * - the double perimeter: with either fence left standing, the road can't be reached;
 * - the grapnel: from the shell's roof onto the gatehouse astride both fences, and elsewhere
 *   only over the chain-link (down between the two).
 * Its jobs and its four escapes are proven by the generic suites (economytest, escapetest).
 */
import { SHANKTON } from '../src/content/prisons/shankton';
import { itemDef } from '../src/content/items';
import { ZONES } from '../src/content/zones';
import { cameraSees } from '../src/sim/systems/security';
import { grapnelSwing, toolTarget } from '../src/sim/systems/structure';
import { slot } from '../src/sim/systems/items';
import { CAMERA_TURN_STEPS, UNIT } from '../src/sim/tuning';
import { TILE, TILE_INFO } from '../src/sim/world/tiles';
import { LAYER, MAP_H, MAP_W } from '../src/sim/world/World';
import { Bot, DIR, n, tileOf } from './bots';
import { check } from './assert';

const bot = new Bot(SHANKTON, 1);
const sim = bot.sim;
const st = bot.st;
const w = sim.world;
const g = w.ground;

// ------------------------------------------------------------------ the shell
{
  let walls = 0;
  let doors = 0;
  let other = 0;
  for (let k = 8; k <= 55; k++) {
    for (const [x, z] of [[k, 8], [k, 55], [8, k], [55, k]]) {
      const kind = g.kind[tileOf(x, z)];
      if (kind === TILE.REINFORCED) walls++;
      else if (kind === TILE.DOOR) doors++;
      else other++;
    }
  }
  check(other === 0 && g.kind[tileOf(30, 30)] !== TILE.REINFORCED, 'the shell is reinforced concrete and doors all round, and only the shell');
  // From the cell, a pickaxe at the shell (north) and at the brick between cells (east, from the next tile).
  st.items.inv[0] = slot(n('sturdy_pickaxe'));
  check(bot.walkTo(tileOf(10, 9)), 'in the cell under the shell');
  bot.face(DIR.NORTH);
  bot.hold('sturdy_pickaxe');
  const shell = toolTarget(w, LAYER.GROUND, st.player, n('sturdy_pickaxe'), []);
  check(shell?.action === 'chip' && shell.hp === 0 && shell.tile === tileOf(10, 8), 'the shell is a wall no tool chips');
  const energy = st.energy;
  bot.use();
  const refused = sim.events.find((e) => e.type === 'cantStrike');
  check(refused?.type === 'cantStrike' && refused.why === 'reinforced', `the strike is refused (${refused?.type === 'cantStrike' ? refused.why : 'no refusal'})`);
  check(st.energy === energy && g.kind[tileOf(10, 8)] === TILE.REINFORCED, 'no energy spent, the wall stands');
  check(bot.walkTo(tileOf(10, 12)), 'by the cell’s south wall');
  bot.face(DIR.SOUTH);
  const brick = toolTarget(w, LAYER.GROUND, st.player, n('sturdy_pickaxe'), []);
  check(brick?.action === 'chip' && brick.hp > 0 && g.kind[brick.tile] === TILE.BRICK, 'a brick wall inside can be chipped');
  console.log(`shell: ${walls} reinforced tiles, ${doors} doors; a pickaxe refused (${itemDef(n('sturdy_pickaxe')).tool!.energy} energy kept), brick inside chippable`);
}

// ------------------------------------------------------------------ the detectors
/** Zones walked to from a tile over the ground floor, doors open, never through a detector arch. */
function reachedFrom(x: number, z: number): Set<string> {
  const seen = new Uint8Array(MAP_W * MAP_H);
  const queue = [tileOf(x, z)];
  seen[queue[0]] = 1;
  const zones = new Set<string>();
  while (queue.length) {
    const i = queue.pop()!;
    zones.add(ZONES[g.zone[i]]);
    for (const j of [i - 1, i + 1, i - MAP_W, i + MAP_W]) {
      if (seen[j]) continue;
      const k = g.kind[j];
      if (k === TILE.DETECTOR || (TILE_INFO[k].solid && k !== TILE.DOOR) || w.propSolid[j]) continue;
      seen[j] = 1;
      queue.push(j);
    }
  }
  return zones;
}
{
  const arches = g.kind.filter((k) => k === TILE.DETECTOR).length;
  const wings = [reachedFrom(11, 11), reachedFrom(15, 50)];
  const behind = ['canteen', 'kitchen', 'yard', 'rollCall', 'library', 'infirmary', 'woodshop', 'metalshop', 'laundry', 'janitor', 'mailroom', 'generator', 'guardQuarters', 'controlRoom'];
  for (const [k, z] of wings.entries()) {
    const past = behind.filter((b) => z.has(b));
    check(past.length === 0, `from the ${k ? 'south' : 'north'} wing, nothing past the arches without one (${past.join(', ') || 'none'})`);
  }
  console.log(`detectors: ${arches} arches; without one, the north wing reaches ${[...wings[0]].filter((z) => z !== 'none').sort().join(', ')}; the south wing ${[...wings[1]].filter((z) => z !== 'none').sort().join(', ')}`);
}

// ------------------------------------------------------------------ the cameras
{
  const cams = SHANKTON.cameras!;
  const corridors = [24, 37].map((z0) => {
    const own = cams.filter((c) => c.z >= z0 && c.z <= z0 + 2);
    // Over a full sweep, the corridor tiles some camera sees at some point.
    let seen = 0;
    let all = 0;
    for (let x = 9; x <= 54; x++) {
      for (let z = z0; z <= z0 + 2; z++) {
        if (g.kind[tileOf(x, z)] === TILE.DETECTOR) continue;
        all++;
        const at = { x: x * UNIT + UNIT / 2, z: z * UNIT + UNIT / 2 };
        let hit = false;
        for (let step = 0; step < 8 * CAMERA_TURN_STEPS && !hit; step += CAMERA_TURN_STEPS / 4) hit = cams.some((c, k) => cameraSees(w, c, k, step, at));
        if (hit) seen++;
      }
    }
    check(own.length >= 2, `the ${z0 < 30 ? 'north' : 'south'} corridor has cameras (${own.length})`);
    return `${z0 < 30 ? 'north' : 'south'} ${own.length} cameras, ${Math.round((seen / all) * 100)}% watched`;
  });
  console.log(`cameras: ${cams.length} in all; ${corridors.join('; ')}`);
}

// ------------------------------------------------------------------ the double perimeter
{
  /** Whether the road can be walked to from the gravel by the shell, with these fence kinds passable (gates shut). */
  const outFrom = (open: readonly number[]) => {
    const seen = new Uint8Array(MAP_W * MAP_H);
    const queue = [tileOf(6, 6)];
    seen[queue[0]] = 1;
    while (queue.length) {
      const i = queue.pop()!;
      if (ZONES[g.zone[i]] === 'outside') return true;
      for (const j of [i - 1, i + 1, i - MAP_W, i + MAP_W]) {
        if (j < 0 || j >= MAP_W * MAP_H || seen[j]) continue;
        const k = g.kind[j];
        if (!open.includes(k) && (TILE_INFO[k].solid || k === TILE.DOOR || w.propSolid[j])) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
    return false;
  };
  check(!outFrom([]), 'both fences up: no way out');
  check(!outFrom([TILE.FENCE]), 'the chain-link down, the electric fence still holds');
  check(!outFrom([TILE.ELECTRIC]), 'the electric fence down, the chain-link still holds');
  check(outFrom([TILE.FENCE, TILE.ELECTRIC]), 'both down: out');
  console.log('perimeter: chain-link inside the electric fence, either one alone keeps the road out of reach');
}

// ------------------------------------------------------------------ the grapnel
{
  const body = (x: number, z: number, facing: number) => ({ x: x * UNIT + UNIT / 2, z: z * UNIT + UNIT / 2, facing, moving: false });
  const gate = grapnelSwing(w, body(53, 55, DIR.SOUTH));
  check(gate?.roof === true && gate.land === tileOf(53, 58), 'from the shell’s roof, across onto the gatehouse');
  const mesh = grapnelSwing(w, body(30, 55, DIR.SOUTH));
  check(mesh?.roof === false && mesh.fence === tileOf(30, 58) && mesh.land === tileOf(30, 59), 'elsewhere, over the chain-link and down between the fences');
  const north = grapnelSwing(w, body(30, 8, DIR.NORTH));
  check(north?.roof === false && north.land === tileOf(30, 4), 'and on the north side too');
  console.log('grapnel: onto the gatehouse roof at 53,58; over the chain-link elsewhere (down between the fences)');
}
