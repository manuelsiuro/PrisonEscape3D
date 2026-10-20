import { CENTER_PERKS } from '../../src/content/prisons/center-perks';
import { command, OP } from '../../src/sim/command';
import { Sim, type SimEvent } from '../../src/sim/Sim';
import { DAY_STEPS } from '../../src/sim/systems/clock';
import { centreOf, fieldOf, pitchOf } from '../../src/sim/systems/football';
import { nearestDir } from '../../src/sim/ai/path';
import { STEPS_PER_MINUTE, UNIT } from '../../src/sim/tuning';
import { EXT } from '../../src/sim/command';

export const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
export const refusals = (seen: SimEvent[]) => seen.filter((e) => e.type === 'refused').map((e) => (e as { why: string }).why);
export const of = <T extends SimEvent['type']>(seen: SimEvent[], type: T) => seen.filter((e) => e.type === type) as Array<Extract<SimEvent, { type: T }>>;
export function game(prison = CENTER_PERKS, seed = 5, calmStart = true) {
  const sim = new Sim(prison, seed);
  sim.state.calendar = [[0, 0, 0]];
  const seen: SimEvent[] = [];
  let calm = calmStart;
  const step = (cmd = 0) => {
    sim.step(cmd);
    seen.push(...sim.events);
    if (calm) {
      sim.state.heat = 0;
      if (sim.state.lockdown) sim.state.lockdown = false;
    }
  };
  const jump = (day: number, hour: number, minute = 0) => {
    sim.state.step = at(day, hour, minute) - 1;
    sim.state.attended = true;
    sim.state.excused = true;
    step();
  };
  const talk = (a: number, b = 0) => step(command(0, OP.TALK, a, b));
  const ext = (a: number, b = 0, c = 0) => step(command(0, OP.EXT, a, b, c));
  const setCalm = (on: boolean) => (calm = on);
  return { sim, seen, step, jump, talk, ext, setCalm };
}
export const put = (b: { x: number; z: number }, x: number, z: number) => {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
};
export function atPitch(g: ReturnType<typeof game>, who = 0, opinions = true) {
  const { sim } = g;
  const p = pitchOf(sim)!;
  const f = fieldOf(p);
  const c = centreOf(p);
  sim.state.inmates.forEach((m, k) => {
    if (opinions) m.opinion = 60 + k;
    m.goal = -1;
    m.path = [];
    m.doing = 0;
    m.angry = 0;
    const a = f.a0 + 600 + ((k * 1100) % Math.max(1, f.a1 - f.a0 - 1200));
    if (f.along) put(m.body, Math.floor(a / UNIT), p.z + p.d + 1);
    else put(m.body, p.x + p.w + 1, Math.floor(a / UNIT));
  });
  put(sim.state.player, Math.floor(c.x / UNIT), Math.floor(c.z / UNIT));
  const m = sim.state.inmates[who];
  m.body.x = sim.state.player.x - UNIT;
  m.body.z = sim.state.player.z;
  sim.state.player.facing = 9;
  g.step(command(0, OP.INTERACT));
  return sim.state.talk === who;
}
/** Talk to inmate `who` by teleporting him next to the player. */
export function face(g: ReturnType<typeof game>, who: number) {
  const s = g.sim.state;
  if (s.talk !== who) s.talk = -1;
  const m = s.inmates[who];
  const ox = m.body.x, oz = m.body.z;
  s.inmates.forEach((o, k) => { if (k !== who && Math.abs(o.body.x - s.player.x) < 3 * UNIT && Math.abs(o.body.z - s.player.z) < 3 * UNIT) { o.body.x = ox; o.body.z = oz; } });
  m.body.x = s.player.x - UNIT;
  m.body.z = s.player.z;
  m.goal = -1; m.path = [];
  s.player.facing = 9;
  g.step(command(0, OP.INTERACT));
  return s.talk === who;
}
export function bot(sim: Sim, hold: number, state: { held: number }): number {
  const s = sim.state;
  const o = s.match;
  if (!o) return 0;
  const p = pitchOf(sim)!;
  const f = fieldOf(p);
  const [bx, bz] = o.ball;
  const gx = f.along ? f.a1 + UNIT : f.mid;
  const gz = f.along ? f.mid : f.a1 + UNIT;
  const dx = gx - bx;
  const dz = gz - bz;
  const d = Math.sqrt(dx * dx + dz * dz) || 1;
  const bxx = bx - (dx * 450) / d;
  const bzz = bz - (dz * 450) / d;
  const pl = s.player;
  const toSpot = Math.hypot(bxx - pl.x, bzz - pl.z);
  const toBall = Math.hypot(bx - pl.x, bz - pl.z);
  if (state.held) {
    state.held++;
    if (state.held > hold) {
      state.held = 0;
      return command(nearestDir(gx - pl.x, gz - pl.z), OP.EXT, EXT.KICK, 1);
    }
    return command(nearestDir(gx - pl.x, gz - pl.z));
  }
  if (toBall < 650 && d < 5 * UNIT && o.at && !o.pause) {
    state.held = 1;
    return command(nearestDir(gx - pl.x, gz - pl.z), OP.EXT, EXT.KICK, 0);
  }
  if (toSpot < 300 || (toBall < 600 && (bx - pl.x) * dx + (bz - pl.z) * dz > 0)) return command(nearestDir(gx - pl.x, gz - pl.z));
  const ahead = (pl.x - bx) * dx + (pl.z - bz) * dz > 0;
  if (ahead && toBall < 1400) {
    const side = (pl.x - bx) * -dz + (pl.z - bz) * dx >= 0 ? 1 : -1;
    return command(nearestDir(-dz * side - dx * 0.6, dx * side - dz * 0.6));
  }
  return command(nearestDir(bxx - pl.x, bzz - pl.z));
}
