import { PRISONS } from '../../src/content/prisons';
import { Sim } from '../../src/sim/Sim';
const p = PRISONS.find((q) => q.id === process.argv[2])!;
const sim = new Sim(p, 1);
console.log(sim.world.zoneAt(Number(process.argv[3]), Number(process.argv[4])));
