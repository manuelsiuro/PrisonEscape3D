import { PRISONS } from '../../src/content/prisons';
import { Sim } from '../../src/sim/Sim';
import { MAP_W } from '../../src/sim/world/World';
const [id, x0, z0, x1, z1] = process.argv.slice(2);
const p = PRISONS.find((q) => q.id === id)!;
const sim = new Sim(p, 1);
const w = sim.world;
for (let z = +z0; z <= +z1; z++) {
  let row = String(z).padStart(3) + ' ';
  for (let x = +x0; x <= +x1; x++) {
    const prop = w.props.find((q) => x >= q.x && x < q.x + q.w && z >= q.z && z < q.z + q.d);
    row += prop ? prop.kind[0].toUpperCase() : w.guardBlock[z * MAP_W + x] ? '#' : '.';
  }
  console.log(row);
}
