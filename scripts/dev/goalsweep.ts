// Scratch: where P29's goals come from (who scored, from how far, how long after the restart), over matches played by the teamtest bot.
import { CENTER_PERKS } from '../../src/content/prisons/center-perks';
import { GATHER_STEPS, MATCH_STEPS } from '../../src/content/team';
import { command, OP, TALK, EXT } from '../../src/sim/command';
import { Sim } from '../../src/sim/Sim';
import { DAY_STEPS } from '../../src/sim/systems/clock';
import { centreOf, fieldOf, pitchOf } from '../../src/sim/systems/football';
import { nearestDir } from '../../src/sim/ai/path';
import { STEPS_PER_MINUTE, UNIT } from '../../src/sim/tuning';
const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const by: Record<string, number> = {};
const dist: number[] = [];
const since: number[] = [];
let matches = 0;
for (let seed = 1; seed <= 20; seed++) {
  const sim = new Sim(CENTER_PERKS, seed * 7);
  sim.state.calendar = [[0, 0, 0]];
  sim.state.step = at(1, 10, 30) - 1;
  sim.state.attended = sim.state.excused = true;
  sim.step(0);
  const p = pitchOf(sim)!;
  const f = fieldOf(p);
  const c = centreOf(p);
  sim.state.inmates.forEach((m, k) => {
    m.opinion = 60 + k;
    m.goal = -1; m.path = []; m.doing = 0;
    m.body.x = (27 + k) * UNIT + 512; m.body.z = 33 * UNIT + 512;
  });
  sim.state.player.x = c.x; sim.state.player.z = c.z;
  const who = (seed * 3) % 7;
  sim.state.inmates[who].body.x = c.x - UNIT; sim.state.inmates[who].body.z = c.z;
  sim.state.player.facing = 9;
  sim.step(command(0, OP.INTERACT));
  sim.step(command(0, OP.TALK, TALK.FOOTBALL));
  if (!sim.state.match) continue;
  matches++;
  let lastKick: [number, number] = [0, 0];
  let restart = 0;
  let held = 0;
  for (let k = 0; k < GATHER_STEPS + MATCH_STEPS + 50 && sim.state.match; k++) {
    const o = sim.state.match;
    const [bx, bz] = o.ball;
    const gx = f.a1 + UNIT, gz = f.mid;
    const pl = sim.state.player;
    const d = Math.hypot(gx - bx, gz - bz) || 1;
    const sx = bx - ((gx - bx) * 450) / d, sz = bz - ((gz - bz) * 450) / d;
    let cmd: number;
    if (held) { held++; cmd = held > 12 ? command(nearestDir(gx - pl.x, gz - pl.z), OP.EXT, EXT.KICK, 1) : command(nearestDir(gx - pl.x, gz - pl.z)); if (held > 12) held = 0; }
    else if (Math.hypot(bx - pl.x, bz - pl.z) < 650 && d < 5 * UNIT && o.at && !o.pause) { held = 1; cmd = command(nearestDir(gx - pl.x, gz - pl.z), OP.EXT, EXT.KICK, 0); }
    else if (Math.hypot(sx - pl.x, sz - pl.z) < 300 || (Math.hypot(bx - pl.x, bz - pl.z) < 600 && (bx - pl.x) * (gx - bx) > 0)) cmd = command(nearestDir(gx - pl.x, gz - pl.z));
    else cmd = command(nearestDir(sx - pl.x, sz - pl.z));
    const last = o.last;
    sim.step(cmd);
    for (const e of sim.events) {
      if (e.type === 'football' && e.what === 'restart') restart = sim.state.step;
      if (e.type === 'football' && e.what === 'kickoff') restart = sim.state.step;
      if (e.type === 'football' && e.what === 'goal') {
        const key = `${e.mine ? 'for' : 'against'} by ${last === -1 ? 'player' : ['keeper', 'mate', 'captain', 'rival', 'rkeeper'][last] ?? last}`;
        by[key] = (by[key] ?? 0) + 1;
        dist.push(Math.round(Math.abs((e.mine ? f.a1 : f.a0) - lastKick[0]) / UNIT));
        since.push(sim.state.step - restart);
        if (seed === 1) {
          const t = o.team;
          const pos = (id: number) => `${(sim.state.inmates[id].body.x / UNIT).toFixed(1)},${(sim.state.inmates[id].body.z / UNIT).toFixed(1)}`;
          console.log(`goal ${e.mine ? 'for' : 'against'} at +${sim.state.step - restart}: ball was ${(bx / UNIT).toFixed(1)},${(bz / UNIT).toFixed(1)} v ${o.ball[2]},${o.ball[3]}; keeper ${pos(t[0])} rkeeper ${pos(t[4])}; player ${(pl.x / UNIT).toFixed(1)},${(pl.z / UNIT).toFixed(1)}; cool ${o.cool.map((c) => c - sim.state.step)}`);
        }
      }
    }
    const o2 = sim.state.match;
    if (o2 && (o2.last !== last || (o2.ball[2] !== o.ball[2]))) if (o2.last !== -2 && o2.last !== last) lastKick = [o.ball[0], o.ball[1]];
  }
}
const hist = (a: number[]) => { const h: Record<number, number> = {}; for (const x of a) h[x] = (h[x] ?? 0) + 1; return JSON.stringify(h); };
console.log(`${matches} matches, ${dist.length} goals (${(dist.length / matches).toFixed(1)} a match)`, by);
console.log('tiles out the last touch was', hist(dist));
console.log('steps after the restart', hist(since.map((x) => Math.floor(x / 40) * 40)));
