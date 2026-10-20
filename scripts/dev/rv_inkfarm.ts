import { PRISONS } from '../../src/content/prisons';
import { itemNumber } from '../../src/content/items';
import { command, OP, TALK } from '../../src/sim/command';
import { nearestDir } from '../../src/sim/ai/path';
import { slot, itemOf } from '../../src/sim/systems/items';
import { penAt } from '../../src/sim/systems/tattoo';
import { game, face, of, refusals } from './rv_harness';
const INK = itemNumber('ink');
for (const prison of PRISONS) {
  const g = game(prison, 7);
  const s = g.sim.state;
  const inkInWorld = s.items.containers.reduce((n, c) => n + c.filter((v) => itemOf(v) === INK).length, 0);
  const n30 = s.inmates.filter((m) => m.opinion >= 30).length;
  g.jump(1, 18, 5);
  const t0 = s.step;
  s.items.inv[0] = slot(itemNumber('tattoo_gun'));
  let pay = 0, sittings = 0;
  const cash0 = s.cash;
  for (let who = 0; who < s.inmates.length; who++) {
    for (let r = 0; r < 3; r++) {
      s.items.inv[1] = slot(INK);
      if (!face(g, who)) { console.log("  no talk", who, s.talk, s.inmates[who].doing, s.inmates[who].ko, s.inmates[who].angry); break; }
      g.talk(TALK.TATTOO, 2);
      if (!s.ink) { console.log('  refused', who, refusals(g.seen).slice(-1)); break; }
      const pen: [number, number] = [0, 0];
      while (s.ink) {
        penAt(s.ink.design, s.ink.k + 1, pen);
        const o = s.ink;
        g.step(command(Math.hypot(pen[0] - o.nx, pen[1] - o.nz) < 8 ? 0 : nearestDir(pen[0] - o.nx, pen[1] - o.nz)));
      }
      sittings++;
    }
  }
  pay = s.cash - cash0;
  const done = of(g.seen, 'tattoo').filter((e) => e.what === 'done');
  console.log(`${prison.id}: inmates ${s.inmates.length} (at 30+: ${n30}), ink jars in furniture at start ${inkInWorld}; ${sittings} eagles in ${(s.step - t0) / 20} game-min, $${pay} (${done.map((e) => e.quality).join(',')}) heat-spots ${g.seen.filter((e) => e.type === 'spotted').length}; opinions now ${s.inmates.map((m) => m.opinion).join(',')}`);
}
