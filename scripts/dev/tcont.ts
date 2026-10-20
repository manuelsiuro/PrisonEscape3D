import { TRAINING } from '../../src/content/prisons/training';
import { Sim } from '../../src/sim/Sim';
import { containersOf } from '../../src/sim/world/containers';
const sim = new Sim(TRAINING, 1);
containersOf(sim.world).forEach((c, i) => console.log(i, c.prop.kind, c.table, c.prop.x, c.prop.z, c.prop.w, c.prop.d, c.mine, sim.world.zoneAt(c.prop.x, c.prop.z)));
console.log('spawn', TRAINING.spawn);
