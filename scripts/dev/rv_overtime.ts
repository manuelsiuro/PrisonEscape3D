// A match asked for at the end of the exercise hour plays on through the showers (and one at 21:59 through evening roll call).
import { TALK } from '../../src/sim/command';
import { ROUTINE } from '../../src/content/routine';
import { clockAt } from '../../src/sim/systems/clock';
import { game, atPitch, of, bot } from './rv_harness';
for (const [h, m] of [[15, 59], [21, 59]]) {
  const g = game();
  const s = g.sim.state;
  g.jump(1, h, m);
  atPitch(g, 0);
  g.talk(TALK.FOOTBALL);
  if (!s.match) { console.log('no match'); continue; }
  const team = s.match.team.slice();
  g.setCalm(false);
  const st = { held: 0 };
  const t = () => { const c = clockAt(s.step); return `${c.hour}:${String(c.minuteOfDay % 60).padStart(2, '0')} (${ROUTINE[s.routine].id})`; };
  const start = t();
  let lastOn = '';
  while (s.match) { g.step(bot(g.sim, 12, st)); if (s.match) lastOn = t(); }
  const end = of(g.seen, 'football').find((e) => ['won', 'lost', 'draw', 'off', 'foul'].includes(e.what))!;
  for (let k = 0; k < 20 * 70 && ROUTINE[s.routine].id !== (h === 15 ? 'dinner' : 'lightsOut'); k++) g.step();
  const missed = g.seen.filter((e) => e.type === 'missed').map((e) => `${ROUTINE[(e as any).routine].id} +${(e as any).heat}`);
  console.log(`asked ${start}: match on until ${lastOn}, ended '${end.what}'; inmates kept on the pitch: ${team.join(',')}; missed: ${missed.join(', ') || 'none'}; heat ${s.heat}, lockdown ${s.lockdown}`);
}
