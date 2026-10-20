// The yard of a prison as the sim sees it: '.' open yard floor, 'o' open floor elsewhere, '#' solid, 'P' a solid prop, 'd' decor, ' ' other.
import { PRISONS } from '../../src/content/prisons';
import { TRAINING } from '../../src/content/prisons/training';
import { World, MAP_W, MAP_H } from '../../src/sim/world/World';
import { ZONES } from '../../src/content/zones';
const [id, zoneName = 'yard'] = process.argv.slice(2);
const def = [...PRISONS, TRAINING].find((p) => p.id === id)!;
const w = new World(def);
const g = w.layers[1];
const zi = ZONES.indexOf(zoneName as never);
const decor = new Set<number>();
for (const d of def.decor ?? []) decor.add(d.z * MAP_W + d.x);
let x0 = 99, z0 = 99, x1 = -1, z1 = -1;
for (let i = 0; i < MAP_W * MAP_H; i++) if (g.zone[i] === zi) { const x = i % MAP_W, z = Math.floor(i / MAP_W); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
x0 = Math.max(0, x0 - 1); z0 = Math.max(0, z0 - 1); x1 = Math.min(63, x1 + 1); z1 = Math.min(63, z1 + 1);
let head = '    ';
for (let x = x0; x <= x1; x++) head += String(x % 10);
console.log(`${id} ${zoneName}: x ${x0}-${x1}, z ${z0}-${z1}`);
console.log(head);
for (let z = z0; z <= z1; z++) {
  let row = String(z).padStart(3) + ' ';
  for (let x = x0; x <= x1; x++) {
    const i = z * MAP_W + x;
    row += w.propSolid[i] ? 'P' : w.block[i] ? '#' : decor.has(i) ? 'd' : g.zone[i] === zi ? '.' : 'o';
  }
  console.log(row);
}
