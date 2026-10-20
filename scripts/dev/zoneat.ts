import { PRISONS } from '../../src/content/prisons';
import { TRAINING } from '../../src/content/prisons/training';
import { Sim } from '../../src/sim/Sim';
const [id, x0, z0, x1, z1] = process.argv.slice(2);
const p = [...PRISONS, TRAINING].find((q) => q.id === id)!;
const w = new Sim(p, 1).world;
const names = new Set<string>();
for (let z = +z0; z <= +z1; z++) { let row = String(z).padStart(3) + ' '; for (let x = +x0; x <= +x1; x++) { const zn = w.zoneAt(x, z); names.add(zn); row += w.blocked(x, z) ? '#' : zn[0]; } console.log(row); }
console.log([...names].join(' '));
