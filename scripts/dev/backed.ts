// Scratch: P30 which stages have a wall all along their back.
import { PRISONS } from '../../src/content/prisons';
import { Sim } from '../../src/sim/Sim';
import { MAP_W } from '../../src/sim/world/World';
import { TILE } from '../../src/sim/world/tiles';
for (const p of PRISONS) {
  const w = new Sim(p, 1).world;
  const st = p.leisure!.stage!;
  const fx = st.face === 1 ? 1 : st.face === 9 ? -1 : 0, fz = st.face === 5 ? 1 : st.face === 13 ? -1 : 0;
  const wall = (x: number, z: number) => w.inside(x, z) && w.blocked(x, z) && w.ground.base[z * MAP_W + x] !== TILE.DOOR;
  console.log(p.id, [-1, 0, 1].map((k) => wall(st.x - fx - fz * k, st.z - fz + fx * k)));
}
