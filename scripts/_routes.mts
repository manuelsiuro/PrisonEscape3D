import { Bot } from './bots';
import { interactPlan } from '../src/sim/systems/interact';
import { opOf, argA, OP } from '../src/sim/command';
import { PLANS, runRoute } from './escapes';
const RARE = new Set([
  'peel',
  'answer',
  'underline',
  'readOn',
  'climbOut',
  'stow',
  'report',
  'fileForm',
  'showId',
  'menu',
  'work',
  'bed',
  'sleep',
]);
const first = new Map<string, string>();
const proto = Bot.prototype as unknown as { step(cmd?: number): void };
const orig = proto.step;
let route = '';
let n = 0;
proto.step = function (this: Bot, cmd = 0) {
  n++;
  const sim = this.sim;
  if (opOf(cmd) === OP.INTERACT && !(argA(cmd) === 1 && sim.state.solitary <= 0) && !sim.state.sleeping && sim.state.ko <= 0) {
    const k = interactPlan(sim)?.do ?? 'nothing';
    if (RARE.has(k) && !first.has(k)) first.set(k, `${route} at step ${n}`);
  }
  return orig.call(this, cmd);
};
const log = console.log;
console.log = () => {};
const t0 = Date.now();
for (const p of PLANS)
  for (const r of p.routes ?? []) {
    route = `${p.def.id}/${r}`;
    n = 0;
    const s = Date.now();
    runRoute(p, r);
    log(`${route} ${Date.now() - s} ms`);
  }
console.log = log;
console.log([...first].join('\n'), Date.now() - t0);
