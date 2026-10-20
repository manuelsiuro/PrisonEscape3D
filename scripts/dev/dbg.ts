import { CENTER_PERKS } from '../../src/content/prisons/center-perks';
import { itemNumber } from '../../src/content/items';
import { Sim } from '../../src/sim/Sim';
import { DAY_STEPS } from '../../src/sim/systems/clock';
import { slot, usesOf, itemOf } from '../../src/sim/systems/items';
import { containersOf } from '../../src/sim/world/containers';
import { STEPS_PER_MINUTE } from '../../src/sim/tuning';
const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const sim = new Sim(CENTER_PERKS, 5);
const s = sim.state;
const desk = containersOf(sim.world).findIndex((c) => c.mine && c.prop.kind === 'desk');
s.items.containers[desk][0] = slot(itemNumber('pruno_bag'));
console.log('desk', desk, s.items.containers[desk][0], usesOf(s.items.containers[desk][0]));
s.step = at(2, 7, 58) - 1;
sim.step(0);
console.log('routine', s.routine, sim.clock);
while (s.step < at(2, 8, 1)) { sim.step(0); for (const e of sim.events) if (e.type === 'routine' || e.type === 'pruno' || e.type==='restock') console.log(s.step, JSON.stringify(e)); }
console.log(usesOf(s.items.containers[desk][0]), itemOf(s.items.containers[desk][0]));
