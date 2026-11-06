/**
 * Street lamps leaning over what they light (2.34.1): every lamp in every prison has its own aim,
 * and walking out from its pole that way meets no building wall before open ground. Each lamp's
 * line says what it leans over: a fence (a perimeter strip's), a path or drive of other ground,
 * or the open ground of a yard or sports ground from its corner. The rules never read the aim:
 * the solid tiles are the same as before.
 */
import { PRISONS } from '../src/content/prisons';
import { TRAINING } from '../src/content/prisons/training';
import { AIM } from '../src/content/props';
import { lampHeads } from '../src/render/props';
import { TILE } from '../src/sim/world/tiles';
import { LAYER, MAP_W, World } from '../src/sim/world/World';
import { check } from './assert';

const WAY = Object.fromEntries(Object.entries(AIM).map(([k, v]) => [v, k]));
const STEP = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
];
const WALLS = new Set<number>([TILE.BRICK, TILE.REINFORCED, TILE.TOWER]);
const FENCES = new Set<number>([TILE.FENCE, TILE.ELECTRIC]);

let lamps = 0;
let twins = 0;
const seen: Record<string, number> = {};
for (const def of [TRAINING, ...PRISONS]) {
  const w = new World(def);
  const g = w.layers[LAYER.GROUND];
  const at = (x: number, z: number) => (w.inside(x, z) ? g.kind[z * MAP_W + x] : TILE.EMPTY);
  console.log(`\n${def.id}`);
  for (const p of def.props) {
    if (p.kind !== 'lamp') continue;
    lamps++;
    check(p.aim !== undefined && Number.isInteger(p.aim) && p.aim >= 0 && p.aim < 8, `${def.id}: the lamp at ${p.x},${p.z} has its own aim (0–7)`);
    const aim = p.aim ?? 0;
    const heads = p.heads ?? 1;
    if (heads === 2) twins++;
    const under = at(p.x, p.z);
    const says: string[] = [];
    for (const a of heads === 2 ? [aim, (aim + 4) % 8] : [aim]) {
      // Out from the pole, its head's way: what it meets first, and how far.
      const [dx, dz] = STEP[a];
      let met = 'open ground';
      for (let k = 1; k <= 6; k++) {
        const x = p.x + dx * k;
        const z = p.z + dz * k;
        const t = at(x, z);
        const prop = def.props.find((q) => q !== p && x >= q.x && x < q.x + (q.w ?? 1) && z >= q.z && z < q.z + (q.d ?? 1));
        if (WALLS.has(t)) {
          met = `a wall at ${k}`;
          check(k > 2, `${def.id}: the lamp at ${p.x},${p.z} leans ${WAY[a]} into a wall ${k} tile${k > 1 ? 's' : ''} off`);
          break;
        }
        if (FENCES.has(t) || t === TILE.DOOR) {
          met = `${t === TILE.DOOR ? 'a gate' : 'the fence'} at ${k}`;
          break;
        }
        if (t !== under && t !== TILE.EMPTY && !prop) {
          met = `${Object.entries(TILE).find(([, v]) => v === t)?.[0].toLowerCase()} at ${k}`;
          break;
        }
        if (prop && k <= 2) {
          met = `a ${prop.kind} at ${k}`;
          break;
        }
      }
      says.push(`${WAY[a]}: ${met}`);
    }
    seen[WAY[aim]] = (seen[WAY[aim]] ?? 0) + 1;
    console.log(`  ${p.x},${p.z} ${w.zoneAt(p.x, p.z)}${heads === 2 ? ', two heads' : ''} — ${says.join('; ')}`);
  }
}

// The heads hang where the model puts them (the bulbs and pools follow lampHeads).
const [e] = lampHeads(AIM.E, 1);
check(e.dx > 0.4 && Math.abs(e.dz) < 1e-9, 'a lamp aimed east hangs its head east of its pole');
const [ne] = lampHeads(AIM.NE, 1);
check(ne.dx > 0 && ne.dz < 0 && Math.abs(ne.dx + ne.dz) < 1e-9, 'a lamp aimed north-east hangs its head north-east');
const two = lampHeads(AIM.E, 2);
check(two.length === 2 && Math.abs(two[0].dx + two[1].dx) < 1e-9, 'a lamp with two heads hangs them either side of its pole');

console.log(`\n${lamps} lamps, ${twins} with two heads; aimed ${Object.entries(seen).sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
check(Object.keys(seen).length >= 6, 'the lamps lean many ways, not all one');
