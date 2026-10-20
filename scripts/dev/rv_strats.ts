import { CENTER_PERKS } from '../../src/content/prisons/center-perks';
import { TALK, command, OP, EXT } from '../../src/sim/command';
import { fieldOf, pitchOf, centreOf } from '../../src/sim/systems/football';
import { GATHER_STEPS, MATCH_STEPS } from '../../src/content/team';
import { nearestDir } from '../../src/sim/ai/path';
import { UNIT } from '../../src/sim/tuning';
import type { Sim } from '../../src/sim/Sim';
import { game, atPitch, of, bot } from './rv_harness';
type Strat = (sim: Sim, st: { held: number }) => number;
const idle: Strat = () => 0;
// Hold Space all the time near the centre; at each restart the ball comes back to the centre spot at the player's feet: fire at once.
const sniper: Strat = (sim, st) => {
  const s = sim.state, o = s.match!;
  if (!o) return 0;
  const f = fieldOf(pitchOf(sim)!);
  const c = centreOf(pitchOf(sim)!);
  const spot = { x: c.x - 350, z: c.z };
  const pl = s.player;
  const goalDir = nearestDir(f.a1 + UNIT - pl.x, f.mid - pl.z);
  if (!o.at || o.pause) {
    const d = Math.hypot(spot.x - pl.x, spot.z - pl.z);
    if (d > 60) return command(nearestDir(spot.x - pl.x, spot.z - pl.z));
    pl.facing = pl.facing; // stand
    if (!o.hold && !process.env.NOHOLD) return command(0, OP.EXT, EXT.KICK, 0);
    return 0;
  }
  return bot(sim, 12, st);
};
for (const [name, strat] of [['idle (stands still where he is)', idle], ['restart sniper', sniper], ['teamtest bot', (sim: Sim, st: { held: number }) => bot(sim, 12, st)]] as Array<[string, Strat]>) {
  const tally: Record<string, number> = {};
  let gf = 0, ga = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const g = game(CENTER_PERKS, seed * 7);
    g.jump(1, 10, 30);
    atPitch(g, (seed * 3) % g.sim.state.inmates.length);
    g.talk(TALK.FOOTBALL);
    if (!g.sim.state.match) continue;
    const st = { held: 0 };
    for (let k = 0; k < GATHER_STEPS + MATCH_STEPS + 50 && g.sim.state.match; k++) g.step(strat(g.sim, st));
    const end = of(g.seen, 'football').find((e) => ['won', 'lost', 'draw', 'off', 'foul'].includes(e.what))!;
    tally[end.what] = (tally[end.what] ?? 0) + 1;
    gf += end.score?.[0] ?? 0; ga += end.score?.[1] ?? 0;
  }
  console.log(`${name}: ${JSON.stringify(tally)} goals ${gf}-${ga}`);
}
