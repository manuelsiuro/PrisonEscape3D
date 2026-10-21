/**
 * Team & ink (P29, docs/PLAN.md §9), through the real simulation:
 * - the data: every prison's pitch (its field and nets open yard floor, clear of the garden, the
 *   hoop and props);
 * - the ball: friction, the boards, the goals' mouths;
 * - a match: the teams picked, the walk on and the whistle, the inmates' play (measured against a
 *   simple bot), goals, full time and its rewards; off and fouls (a brawl, guards drawn);
 * - the cover: guards watching a match see off the pitch at half range; a goal turns them to it;
 * - tattoos: the gun crafted, a job's refusals, the tracing's quality from fixed command sequences,
 *   the pay and opinion, the heat when seen, a friend's tattoo on the player's arm;
 * - saves mid-match and mid-sitting; nothing happens without the player.
 */
import { PRISONS } from '../src/content/prisons';
import { CENTER_PERKS } from '../src/content/prisons/center-perks';
import { TRAINING } from '../src/content/prisons/training';
import { itemNumber } from '../src/content/items';
import { RECIPES } from '../src/content/recipes';
import { DESIGNS, GATHER_STEPS, GOAL_LOOK, INK_HEAT, INK_ME_STEPS, KICK_MAX, KICK_MIN, MATCH_STEPS, TEAM_WIN_OPINION } from '../src/content/team';
import { command, EXT, OP, TALK } from '../src/sim/command';
import { Sim, type SimEvent } from '../src/sim/Sim';
import { loadState } from '../src/sim/state';
import { DAY_STEPS } from '../src/sim/systems/clock';
import { centreOf, fieldOf, kickPower, onPitch, pitchOf, sightFor, TEAM, watchingMatch } from '../src/sim/systems/football';
import { GUARD } from '../src/sim/systems/guards';
import { slot } from '../src/sim/systems/items';
import { nearestDir } from '../src/sim/ai/path';
import { inksToday, penAt, payOf, qualityOf, traceSteps } from '../src/sim/systems/tattoo';
import { sightOf } from '../src/sim/systems/calendar';
import { STEPS_PER_MINUTE, UNIT } from '../src/sim/tuning';
import { MAP_W } from '../src/sim/world/World';
import { check } from './assert';

const at = (day: number, hour: number, minute = 0) => (day - 1) * DAY_STEPS + ((hour * 60 + minute - 480 + 1440) % 1440) * STEPS_PER_MINUTE;
const n = itemNumber;
const refusals = (seen: SimEvent[]) => seen.filter((e) => e.type === 'refused').map((e) => (e as { why: string }).why);
const of = <T extends SimEvent['type']>(seen: SimEvent[], type: T) => seen.filter((e) => e.type === type) as Array<Extract<SimEvent, { type: T }>>;

/** A game kept calm (heat and lockdowns cleared each step unless asked), every day quiet and clear. */
function game(prison = CENTER_PERKS, seed = 5) {
  const sim = new Sim(prison, seed);
  sim.state.calendar = [[0, 0, 0]];
  const seen: SimEvent[] = [];
  let calm = true;
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

/** Puts a body in the middle of a tile. */
const put = (b: { x: number; z: number }, x: number, z: number) => {
  b.x = x * UNIT + UNIT / 2;
  b.z = z * UNIT + UNIT / 2;
};

/** The player at the pitch's middle talking to an inmate beside them; everyone else near the pitch, all thinking well of the player. */
function atPitch(g: ReturnType<typeof game>, who = 0) {
  const { sim } = g;
  const p = pitchOf(sim)!;
  const f = fieldOf(p);
  const c = centreOf(p);
  sim.state.inmates.forEach((m, k) => {
    m.opinion = 60 + k;
    m.goal = -1;
    m.path = [];
    m.doing = 0;
    m.angry = 0;
    // (Lined up a tile off the pitch's far side.)
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

/**
 * A simple player: around behind the ball (on the way to the other goal), then through it, and a
 * kick at the goal when it's close enough (held for `hold` steps). Returns the step's command.
 */
function bot(sim: Sim, hold: number, state: { held: number }): number {
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
  // Behind it: through it towards the goal (a dribble); in front of it, round it (wide of it, never through it); else to behind it.
  if (toSpot < 300 || (toBall < 600 && (bx - pl.x) * dx + (bz - pl.z) * dz > 0)) return command(nearestDir(gx - pl.x, gz - pl.z));
  const ahead = (pl.x - bx) * dx + (pl.z - bz) * dz > 0;
  if (ahead && toBall < 1400) {
    // Sideways off the ball's line first (the side the player is on), and back past it.
    const side = (pl.x - bx) * -dz + (pl.z - bz) * dx >= 0 ? 1 : -1;
    return command(nearestDir(-dz * side - dx * 0.6, dx * side - dz * 0.6));
  }
  return command(nearestDir(bxx - pl.x, bzz - pl.z));
}

// ------------------------------------------------------------------ the data
{
  const lines: string[] = [];
  for (const p of [...PRISONS, TRAINING]) {
    const sim = new Sim(p, 1);
    const w = sim.world;
    const pitch = p.leisure!.pitch;
    const f = fieldOf(pitch);
    const bad: string[] = [];
    for (let x = pitch.x; x < pitch.x + pitch.w; x++)
      for (let z = pitch.z; z < pitch.z + pitch.d; z++) {
        const g = p.leisure!.garden;
        if (x >= g.x && x < g.x + g.w && z >= g.z && z < g.z + g.d) bad.push(`garden ${x},${z}`);
        if (p.leisure!.hoop.x === x && p.leisure!.hoop.z === z) bad.push(`hoop ${x},${z}`);
        const a = f.along ? x : z;
        const l = f.along ? z : x;
        const end = a * UNIT < f.a0 || a * UNIT >= f.a1;
        const net = Math.abs(l * UNIT + UNIT / 2 - f.mid) < UNIT;
        if (end && !net) continue;
        const zone = w.zoneAt(x, z);
        const prop = w.props.some((o) => x >= o.x && x < o.x + o.w && z >= o.z && z < o.z + o.d);
        const decor = (p.decor ?? []).some((d) => x >= d.x && x < d.x + (d.w ?? 1) && z >= d.z && z < d.z + (d.d ?? 1));
        if ((zone !== 'yard' && zone !== 'rollCall' && zone !== 'sports') || w.blocked(x, z) || prop || decor) bad.push(`${x},${z} ${zone}${prop ? ' prop' : ''}${decor ? ' decor' : ''}`);
      }
    check(bad.length === 0, `${p.id}: the pitch is open yard floor clear of the garden, the hoop, props and decor (${bad.join('; ')})`);
    // No roll-call spot or hoop spot in a net (nobody lines up, or shoots, inside a goal).
    const inNet = [...p.rollCall, ...p.leisure!.hoop.spots].filter(({ x, z }) => {
      if (x < pitch.x || x >= pitch.x + pitch.w || z < pitch.z || z >= pitch.z + pitch.d) return false;
      const a = f.along ? x : z;
      const l = f.along ? z : x;
      return (a * UNIT < f.a0 || a * UNIT >= f.a1) && Math.abs(l * UNIT + UNIT / 2 - f.mid) < UNIT;
    });
    check(inNet.length === 0, `${p.id}: no roll-call or hoop spot in a net (${inNet.map((q) => `${q.x},${q.z}`).join(' ')})`);
    // No roll-call box or hoop spot painted on the pitch at all (2.5.1), but where the yard has no room
    // for both: Shankton's roll call fills its yard's middle rows (moving the boxes would move the
    // inmates at every roll call). (Center Perks' court shared its small yard until its sports ground, P31.)
    const onIt = [...p.rollCall, ...p.leisure!.hoop.spots].filter(({ x, z }) => x >= pitch.x && x < pitch.x + pitch.w && z >= pitch.z && z < pitch.z + pitch.d);
    const known = ({ shankton: 8 } as Record<string, number>)[p.id] ?? 0;
    check(onIt.length === known, `${p.id}: ${known ? `only the ${known} known` : 'no'} roll-call or hoop spots on the pitch (${onIt.map((q) => `${q.x},${q.z}`).join(' ')})`);
    check((f.a1 - f.a0) / UNIT >= 8 && (f.l1 - f.l0) / UNIT >= 4, `${p.id}: the field is at least 8 tiles long and 4 wide`);
    lines.push(`${p.id}: pitch ${pitch.w}×${pitch.d} at ${pitch.x},${pitch.z}, field ${(f.a1 - f.a0) / UNIT}×${(f.l1 - f.l0) / UNIT} along ${f.along ? 'x' : 'z'}`);
  }
  console.log(lines.join('\n'));
}

// ------------------------------------------------------------------ the ball
{
  const g = game();
  const { sim } = g;
  check(kickPower(0) === KICK_MIN && kickPower(999) === KICK_MAX, 'a kick goes from KICK_MIN to KICK_MAX as it is held');
  g.jump(1, 10, 30);
  check(atPitch(g, 0), 'talking to the captain at the pitch');
  g.talk(TALK.FOOTBALL);
  const o = sim.state.match!;
  check(!!o && o.team.length === 5 && o.team[TEAM.CAPTAIN] === 0, 'a match: the captain and four more');
  // The ball by hand: rolling, slowing, stopping.
  o.at = sim.state.step;
  const p = pitchOf(sim)!;
  const f = fieldOf(p);
  // (Everyone well away from the ball for this.)
  for (const id of o.team) o.cool[o.team.indexOf(id)] = sim.state.step + 10_000;
  const c = centreOf(p);
  // (Hard enough to reach the boards across the widest field: 7 tiles at Center Perks since P31.)
  o.ball = [c.x, c.z, f.along ? 0 : 400, f.along ? 400 : 0];
  sim.state.player.x = c.x + 3 * UNIT * (f.along ? 1 : 0);
  let steps = 0;
  let bounced = false;
  let last = o.ball.slice();
  while ((sim.state.match!.ball[2] || sim.state.match!.ball[3]) && steps < 400) {
    g.step();
    steps++;
    const b = sim.state.match!.ball;
    if (Math.sign(f.along ? b[3] : b[2]) !== Math.sign(f.along ? last[3] : last[2]) && (f.along ? b[3] : b[2]) !== 0) bounced = true;
    last = b.slice();
  }
  check(steps < 400, `a ball rolling across slows and stops (${steps} steps)`);
  check(bounced, 'it comes back off the side boards');
  const b = sim.state.match!.ball;
  check((f.along ? b[1] : b[0]) >= f.l0 && (f.along ? b[1] : b[0]) <= f.l1, 'and stays on the pitch');
  // Rolled straight at the other goal's mouth: a goal for the player's side.
  sim.state.match!.ball = [f.along ? f.a1 - UNIT : f.mid, f.along ? f.mid : f.a1 - UNIT, f.along ? 300 : 0, f.along ? 0 : 300];
  sim.state.match!.last = -1;
  for (let k = 0; k < 10; k++) g.step();
  const goals = of(g.seen, 'football').filter((e) => e.what === 'goal');
  check(goals.length === 1 && goals[0].mine === true && goals[0].by === -1 && sim.state.match!.goals[0] === 1 && sim.state.match!.scored === 1, 'into the other net: a goal, the player its scorer');
  // Wide of the mouth: off the end boards.
  for (let k = 0; k < 60; k++) g.step();
  check(!sim.state.match!.pause, 'after the goal, back to the middle');
  sim.state.match!.ball = [f.along ? f.a1 - UNIT : f.l0 + 400, f.along ? f.l0 + 400 : f.a1 - UNIT, f.along ? 300 : 0, f.along ? 0 : 300];
  for (let k = 0; k < 10; k++) g.step();
  check(sim.state.match!.goals[0] === 1 && (f.along ? sim.state.match!.ball[2] : sim.state.match!.ball[3]) < 0, 'wide of the mouth it bounces back off the end');
  console.log(`the ball: rolled ${steps} steps across and stopped`);
}

// ------------------------------------------------------------------ refusals, the teams, the walk on
{
  const g = game();
  const { sim } = g;
  g.jump(1, 9, 30);
  atPitch(g, 0);
  g.talk(TALK.FOOTBALL);
  check(!sim.state.match && refusals(g.seen).includes('gamesClosed'), 'not in the morning\'s work (only the games\' hours)');
  g.jump(1, 10, 30);
  // Too few to play: everyone else out cold.
  atPitch(g, 0);
  sim.state.inmates.forEach((m, k) => {
    if (k > 2) m.ko = 400;
  });
  g.talk(TALK.FOOTBALL);
  check(!sim.state.match && refusals(g.seen).includes('fewPlayers'), 'too few to play: no match');
  sim.state.inmates.forEach((m) => (m.ko = 0));
  atPitch(g, 0);
  // Not at the pitch.
  put(sim.state.player, 2, 2);
  sim.state.inmates[0].body.x = sim.state.player.x - UNIT;
  sim.state.inmates[0].body.z = sim.state.player.z;
  g.talk(TALK.FOOTBALL);
  check(!sim.state.match, 'away from the pitch: no match');
  atPitch(g, 0);
  sim.state.inmates[0].opinion = 20;
  g.talk(TALK.FOOTBALL);
  check(!sim.state.match && refusals(g.seen).includes('gameOpinion'), 'a captain who thinks little of the player: no');
  atPitch(g, 0);
  g.seen.length = 0;
  g.talk(TALK.FOOTBALL);
  const o = sim.state.match!;
  const ops = sim.state.inmates.map((m) => m.opinion);
  const mates = [o.team[0], o.team[1]];
  const best = sim.state.inmates.map((_, k) => k).filter((k) => k !== 0).sort((a, b) => ops[b] - ops[a])[0];
  check(mates.includes(best), 'the team-mates: those who think most of the player');
  for (let k = 0; k < GATHER_STEPS + 2 && !sim.state.match!.at; k++) g.step();
  check(sim.state.match!.at > 0 && of(g.seen, 'football').some((e) => e.what === 'kickoff'), `the whistle once they've walked on (${sim.state.match!.at - o.from} steps)`);
  const on = o.team.filter((id) => onPitch(pitchOf(sim)!, sim.state.inmates[id].body.x, sim.state.inmates[id].body.z)).length;
  check(on === 5, `all five on the pitch for the kick-off (${on})`);
  console.log(`walk on: the whistle after ${sim.state.match!.at - o.from} steps`);
}

// ------------------------------------------------------------------ matches: the inmates' play against a bot
{
  const tally = { won: 0, lost: 0, draw: 0, off: 0, goalsFor: 0, goalsAgainst: 0, kicks: 0 };
  const N = Number(process.env.MATCHES ?? 30);
  for (let seed = 1; seed <= N; seed++) {
    const g = game(CENTER_PERKS, seed * 7);
    const { sim } = g;
    g.jump(1, 10, 30);
    atPitch(g, (seed * 3) % sim.state.inmates.length);
    g.talk(TALK.FOOTBALL);
    if (!sim.state.match) continue;
    const st = { held: 0 };
    const spd0 = sim.state.spd;
    for (let k = 0; k < GATHER_STEPS + MATCH_STEPS + 50 && sim.state.match; k++) g.step(bot(sim, 12, st));
    void spd0;
    const end = of(g.seen, 'football').find((e) => e.what === 'won' || e.what === 'lost' || e.what === 'draw' || e.what === 'off' || e.what === 'foul');
    if (!end) continue;
    tally[end.what as 'won'] = (tally[end.what as 'won'] ?? 0) + 1;
    tally.goalsFor += end.score?.[0] ?? 0;
    tally.goalsAgainst += end.score?.[1] ?? 0;
    tally.kicks += of(g.seen, 'football').filter((e) => e.what === 'kick').length;
    if (end.what === 'won') {
      check(end.spd === 1 && sim.state.spd === spd0 + 1, 'a win: a point of Speed');
      const mates = of(g.seen, 'football').find((e) => e.what === 'start')!.team!.slice(0, 2);
      check(mates.every((k) => sim.state.inmates[k].opinion >= 60 + k + TEAM_WIN_OPINION - 1), 'and the team-mates think more of the player');
    }
  }
  console.log(`a simple bot over ${N} matches: won ${tally.won}, lost ${tally.lost}, drawn ${tally.draw}, off ${tally.off}; goals ${tally.goalsFor}–${tally.goalsAgainst}; kicks ${tally.kicks}`);
  check(tally.off === 0, 'no match was called off');
  check(tally.won >= N / 5 && tally.won <= (N * 4) / 5, 'a simple bot wins some and not all');
  check(tally.goalsFor + tally.goalsAgainst >= N, 'about a goal a match or more');
  check(tally.goalsAgainst > 0, 'the inmates score too');
}

// ------------------------------------------------------------------ the cover
{
  const g = game();
  const { sim } = g;
  g.jump(1, 10, 30);
  atPitch(g, 0);
  g.talk(TALK.FOOTBALL);
  const o = sim.state.match!;
  const p = pitchOf(sim)!;
  const c = centreOf(p);
  // A guard on duty by the pitch (on the yard floor).
  const guard = sim.state.guards[0];
  guard.mode = GUARD.DUTY;
  guard.body.x = c.x;
  guard.body.z = c.z;
  check(!watchingMatch(sim, guard), 'before the whistle nobody watches it');
  o.at = sim.state.step;
  check(watchingMatch(sim, guard), 'a guard by the pitch watches the match');
  const full = sightOf(sim, guard);
  check(sightFor(sim, guard, c.x, c.z) === full, 'on the pitch he sees as far as ever');
  check(sightFor(sim, guard, c.x, (p.z - 3) * UNIT) === Math.floor(full / 2), 'off it, half as far');
  // A goal: every guard watching stops and looks at the net.
  const f = fieldOf(p);
  o.ball = [f.along ? f.a1 - UNIT / 2 : f.mid, f.along ? f.mid : f.a1 - UNIT / 2, f.along ? 300 : 0, f.along ? 0 : 300];
  for (let k = 0; k < sim.state.guards.length; k++) if (k) sim.state.guards[k].body.x = 2 * UNIT;
  o.cool = o.cool.map(() => sim.state.step + 1000);
  for (let k = 0; k < 5 && !sim.state.match!.pause; k++) g.step();
  check(sim.state.match!.goals[0] === 1, 'the ball into the net');
  check(guard.wait >= GOAL_LOOK - 2 && !guard.body.moving, 'a goal: the guard stops to look');
  const netX = f.along ? f.a1 + UNIT / 2 : f.mid;
  const netZ = f.along ? f.mid : f.a1 + UNIT / 2;
  check(guard.body.facing === nearestDir(netX - guard.body.x, netZ - guard.body.z), 'turned to the net');
  for (let k = 0; k < 20; k++) g.step();
  check(guard.body.facing === nearestDir(netX - guard.body.x, netZ - guard.body.z), 'and keeps looking a moment');
  console.log(`the cover: sight ${full / UNIT} tiles on the pitch, ${Math.floor(full / 2) / UNIT} off it; a goal holds a guard's eyes ${GOAL_LOOK} steps`);
}

// ------------------------------------------------------------------ the rules review's cases
{
  // A guard who can't see the ball (round a corner, behind a wall) doesn't watch it; one chasing never does.
  const g = game();
  const { sim } = g;
  g.jump(1, 10, 30);
  atPitch(g, 0);
  g.talk(TALK.FOOTBALL);
  const o = sim.state.match!;
  o.at = sim.state.step;
  const guard = sim.state.guards[0];
  guard.mode = GUARD.DUTY;
  // (Center Perks: north of the yard's wall, outdoors on the path, the pitch out of sight.)
  put(guard.body, 27, 12);
  check(!watchingMatch(sim, guard), 'a guard who cannot see the ball is not watching it');
  const c = centreOf(pitchOf(sim)!);
  guard.body.x = c.x;
  guard.body.z = c.z - 2 * UNIT;
  check(watchingMatch(sim, guard), 'one by the pitch is');
  guard.mode = GUARD.CHASE;
  check(!watchingMatch(sim, guard) && sightFor(sim, guard, c.x, c.z - 8 * UNIT) === sightOf(sim, guard), 'a guard giving chase sees as far as ever');
  guard.mode = GUARD.DUTY;
  // A goal: the ball judged where it crossed the line. Wide of the mouth as it crosses, back inside by the step's end: no goal.
  const f = fieldOf(pitchOf(sim)!);
  o.cool = o.cool.map(() => sim.state.step + 1000);
  o.kick = -1;
  const wide = f.mid + 1000;
  // (Along x at Center Perks: from just short of the line, heading out and back in across.)
  o.ball = [f.a1 - 100, wide, 400, -500];
  g.step();
  check(o.goals[0] === 0 && !o.pause, 'across the line wide of the mouth: no goal, whatever the step ends on');
}
{
  // The kick-off: the side that let a goal in kicks off; the other keeps off the ball (the player too) until they've touched it.
  const g = game();
  const { sim } = g;
  g.jump(1, 10, 30);
  atPitch(g, 0);
  g.talk(TALK.FOOTBALL);
  for (let k = 0; k < GATHER_STEPS + 2 && !sim.state.match!.at; k++) g.step();
  const o = sim.state.match!;
  check(o.kick === 1, 'the first kick-off is the other side\'s');
  // The player on the spot: neither dribble nor kick moves the ball before they've touched it.
  o.cool = o.cool.map((x, k) => (k < 5 ? sim.state.step + 1000 : x));
  sim.state.player.x = o.ball[0] - 300;
  sim.state.player.z = o.ball[1];
  sim.state.player.facing = 1;
  g.step(command(1));
  g.step(command(1, OP.EXT, EXT.KICK, 0));
  g.step(command(1, OP.EXT, EXT.KICK, 1));
  check(o.ball[2] === 0 && o.ball[3] === 0 && o.kick === 1, 'the player can\'t take the other side\'s kick-off');
  for (let k = 0; k < 70; k++) g.step();
  check(o.kick === -1, 'after a few seconds it is anyone\'s ball');
}
{
  // A rival going for the player on his own (a grudge, an ambush) isn't the player's foul: the match is off, no brawl.
  const g = game();
  g.jump(1, 10, 30);
  atPitch(g, 0);
  g.talk(TALK.FOOTBALL);
  const o = g.sim.state.match!;
  g.sim.state.inmates[o.team[TEAM.RIVAL]].angry = 300;
  g.step();
  check(!g.sim.state.match && of(g.seen, 'football').some((e) => e.what === 'off') && !of(g.seen, 'football').some((e) => e.what === 'foul'), 'a rival\'s own ambush ends the match as off, not a foul');
  // The bell for the next block: full time there and then.
  const h = game();
  h.jump(1, 11, 58);
  atPitch(h, 0);
  h.talk(TALK.FOOTBALL);
  h.sim.state.match!.at = h.sim.state.step;
  for (let k = 0; k < 3 * 60 * 20 && h.sim.state.match; k++) h.step();
  const end = of(h.seen, 'football').find((e) => e.what === 'won' || e.what === 'lost' || e.what === 'draw' || e.what === 'off');
  check(!!end && end.what !== 'off' && h.sim.state.step < at(1, 12, 1), `the bell for lunch: full time at once (${end?.what})`);
}
{
  // Tattoos: one a day for each inmate, three a day in all.
  const g = game(TRAINING, 3);
  g.jump(1, 10, 30);
  const s = g.sim.state;
  const ready = () => {
    s.items.inv[0] = slot(n('tattoo_gun'));
    s.items.inv[1] = slot(n('ink'));
    const m = s.inmates[0];
    m.opinion = 60;
    put(m.body, Math.floor(s.player.x / UNIT) - 1, Math.floor(s.player.z / UNIT));
    m.goal = -1;
    m.path = [];
    s.player.facing = 9;
    g.step(command(0, OP.INTERACT));
  };
  ready();
  g.talk(TALK.TATTOO, 0);
  while (s.ink) g.step();
  ready();
  g.talk(TALK.TATTOO, 0);
  check(!s.ink && refusals(g.seen).includes('inkedToday'), 'the same inmate twice a day: no');
  s.inkDays = [1, 1, 1];
  check(inksToday(s) === 3, 'three given today');
  // (In a Training Block with one inmate the total is proved by the count alone; the rule reads it.)
}
// ------------------------------------------------------------------ off, and fouls
{
  const g = game();
  const { sim } = g;
  g.jump(1, 10, 30);
  atPitch(g, 0);
  g.talk(TALK.FOOTBALL);
  put(sim.state.player, 2, 2);
  g.step();
  check(!sim.state.match && of(g.seen, 'football').some((e) => e.what === 'off'), 'the player gone from the pitch: the match is off');

  const h = game();
  h.jump(1, 10, 30);
  atPitch(h, 0);
  h.talk(TALK.FOOTBALL);
  const o = h.sim.state.match!;
  // (A real blow: the rival beside the player, locked on, a punch.)
  const id = o.team[TEAM.RIVAL];
  const rival = h.sim.state.inmates[id];
  rival.body.x = h.sim.state.player.x + 600;
  rival.body.z = h.sim.state.player.z;
  rival.path = [];
  h.step(command(0, OP.LOCK, 2 + id));
  for (let k = 0; k < 40 && h.sim.state.match; k++) {
    rival.body.x = h.sim.state.player.x + 600;
    rival.body.z = h.sim.state.player.z;
    h.step(command(0, OP.USE, k === 0 ? 1 : 0));
  }
  const foul = of(h.seen, 'football').find((e) => e.what === 'foul');
  check(!h.sim.state.match && !!foul, 'a blow at a rival: a foul, the match over');
  check([TEAM.CAPTAIN, TEAM.RIVAL, TEAM.RIVAL_KEEPER].every((k) => h.sim.state.inmates[o.team[k]].angry > 0), 'the other side goes for the player (a brawl)');
  check((foul?.guards?.length ?? 0) > 0 && foul!.guards!.every((k) => h.sim.state.guards[k].mode === GUARD.INVESTIGATE), 'and the nearest guards come to look');
  // Nothing without the player: a game left alone never has a match.
  const q = game();
  for (let k = 0; k < 2000; k++) q.step();
  check(!q.sim.state.match && !q.sim.state.ink, 'nothing happens without the player asking');
}

// ------------------------------------------------------------------ tattoos
{
  check(RECIPES.some((r) => r.result === 'tattoo_gun' && [...r.ingredients].sort().join() === 'battery,razor_blade,toothbrush'), 'the gun: a toothbrush, a battery and a razor blade');
  const lines: string[] = [];
  for (let d = 0; d < DESIGNS.length; d++) lines.push(`${DESIGNS[d].id}: ${traceSteps(d)} steps, pays $${payOf(d, 0)}–$${payOf(d, 100)}`);
  console.log(lines.join('\n'));
  check(qualityOf(0, 100) === 100 && qualityOf(100 * 500, 100) === 0, 'quality: 100 on the line, 0 far off it');

  /** A sitting in the Training Block with Sparky (opinion `op`), the gun and `inks` jars in the hotbar. */
  const sitting = (op: number, inks = 1) => {
    const g = game(TRAINING, 3);
    g.jump(1, 10, 30);
    const s = g.sim.state;
    s.items.inv[0] = slot(n('tattoo_gun'));
    for (let k = 0; k < inks; k++) s.items.inv[1 + k] = slot(n('ink'));
    const m = s.inmates[0];
    m.opinion = op;
    put(m.body, Math.floor(s.player.x / UNIT) - 1, Math.floor(s.player.z / UNIT));
    m.goal = -1;
    m.path = [];
    s.player.facing = 9;
    g.step(command(0, OP.INTERACT));
    return g;
  };
  // Refusals.
  {
    const g = sitting(20);
    g.talk(TALK.TATTOO, 0);
    check(!g.sim.state.ink && refusals(g.seen).includes('inkOpinion'), 'an inmate who thinks little of the player takes no tattoo');
    const h = sitting(50, 0);
    h.talk(TALK.TATTOO, 0);
    check(!h.sim.state.ink && refusals(h.seen).includes('noInk'), 'no ink: no tattoo');
    const k = sitting(50);
    k.talk(TALK.INK_ME, 1);
    check(!k.sim.state.ink && refusals(k.seen).includes('inkFriend'), 'only a friend inks the player');
  }
  /** A tracing steered by `steer` (the step's direction from the needle and the pen); its 'done' event. */
  const trace = (design: number, steer: (o: { nx: number; nz: number }, pen: [number, number]) => number, seeGuard = false) => {
    const g = sitting(50);
    if (!seeGuard) g.sim.state.guards.forEach((q) => (q.body.x = 2 * UNIT));
    else g.setCalm(false);
    const heat0 = g.sim.state.heat;
    g.talk(TALK.TATTOO, design);
    const s = g.sim.state;
    check(!!s.ink && !s.items.inv.slice(0, 6).some((v) => (v & 255) === n('ink')), 'a sitting: the ink goes into the gun');
    const x0 = s.player.x;
    const pen: [number, number] = [0, 0];
    while (s.ink) {
      penAt(design, s.ink.k + 1, pen);
      g.step(command(steer(s.ink, pen)));
    }
    check(s.player.x === x0, 'the player keeps still meanwhile (the moves steer the needle)');
    return { done: of(g.seen, 'tattoo').find((e) => e.what === 'done')!, g, heat: s.heat - heat0 };
  };
  const follow = (o: { nx: number; nz: number }, pen: [number, number]) => (Math.hypot(pen[0] - o.nx, pen[1] - o.nz) < 8 ? 0 : nearestDir(pen[0] - o.nx, pen[1] - o.nz));
  for (let d = 0; d < DESIGNS.length; d++) {
    const good = trace(d, follow);
    const idle = trace(d, () => 0);
    check(good.done.quality! >= 85, `${DESIGNS[d].id}: following the pen, a clean line (${good.done.quality})`);
    check(idle.done.quality! <= 20, `${DESIGNS[d].id}: the needle left still, a poor one (${idle.done.quality})`);
    check(good.done.pay! > idle.done.pay! && good.done.gain! > idle.done.gain!, 'a cleaner line pays more and wins more respect');
    lines.length = 0;
    console.log(`${DESIGNS[d].id}: followed ${good.done.quality} ($${good.done.pay}, +${good.done.gain}), left still ${idle.done.quality} ($${idle.done.pay}, +${idle.done.gain})`);
  }
  // Seen at it: heat once.
  {
    const g = sitting(50);
    g.setCalm(false);
    const s = g.sim.state;
    s.guards[0].sees = true;
    s.guards[0].bribed = 0;
    g.talk(TALK.TATTOO, 0);
    // (The guards look again each step: kept on the player.)
    for (let k = 0; k < 40; k++) {
      s.guards[0].sees = true;
      g.step();
    }
    const spotted = g.seen.filter((e) => e.type === 'spotted' && e.reason === 'tattooing').length;
    check(spotted === 1 && s.heat >= INK_HEAT - 2, `a guard who sees tattooing: ${INK_HEAT}% heat, once (${spotted}, heat ${s.heat})`);
  }
  // Given up: no pay, a client let down.
  {
    const g = sitting(50);
    g.talk(TALK.TATTOO, 2);
    const was = g.sim.state.inmates[0].opinion;
    for (let k = 0; k < 40; k++) g.step();
    g.ext(EXT.INK, 0);
    check(!g.sim.state.ink && g.sim.state.inmates[0].opinion < was && !of(g.seen, 'tattoo').some((e) => e.what === 'done'), 'given up halfway: no pay, and he thinks less of the player');
  }
  // A friend's work on the player's arm.
  {
    const g = sitting(80, 2);
    g.talk(TALK.INK_ME, 1);
    check(!!g.sim.state.ink && g.sim.state.ink.mine === 1, 'a friend at work on the player');
    for (let k = 0; k < INK_ME_STEPS + 2; k++) g.step(command(1));
    check(g.sim.state.inked.join() === '1' && of(g.seen, 'tattoo').some((e) => e.what === 'inked'), 'a skull on the player\'s arm');
    const m = g.sim.state.inmates[0];
    m.body.x = g.sim.state.player.x - UNIT;
    m.body.z = g.sim.state.player.z;
    g.sim.state.player.facing = 9;
    g.step(command(0, OP.INTERACT));
    g.talk(TALK.INK_ME, 1);
    check(refusals(g.seen).includes('haveIt'), `the same one twice: no (${refusals(g.seen).join()}, talk ${g.sim.state.talk})`);
  }
}

// ------------------------------------------------------------------ saves
{
  const g = game();
  const { sim } = g;
  g.jump(1, 10, 30);
  atPitch(g, 0);
  g.talk(TALK.FOOTBALL);
  for (let k = 0; k < GATHER_STEPS + 60; k++) g.step(bot(sim, 10, { held: 0 }));
  const saved = JSON.parse(JSON.stringify(sim.state));
  const back = new Sim(CENTER_PERKS, 5);
  back.state = loadState(back.world, CENTER_PERKS, saved);
  check(JSON.stringify(back.state) === JSON.stringify(sim.state), 'a save mid-match loads as it was');
  for (let k = 0; k < 100; k++) {
    const st = { held: 0 };
    const cmd = bot(sim, 10, st);
    sim.step(cmd);
    back.step(cmd);
  }
  check(JSON.stringify(back.state) === JSON.stringify(sim.state), 'and plays on the same');
  const bad = JSON.parse(JSON.stringify(sim.state));
  bad.match.team = [0, 0, 0, 0, 0];
  bad.ink = { who: 99 };
  bad.inked = [7, 1];
  const fixed = loadState(back.world, CENTER_PERKS, bad);
  check(fixed.match === null && fixed.ink === null && fixed.inked.length === 0, 'a damaged match, sitting or arm loads as none');
  const old = JSON.parse(JSON.stringify(sim.state));
  delete old.match;
  delete old.ink;
  delete old.inked;
  const before = loadState(back.world, CENTER_PERKS, old);
  check(before.match === null && before.ink === null && before.inked.length === 0, 'a save from before P29 loads with none');
  console.log(`saves: mid-match round trip ok (score ${sim.state.match?.goals.join('–') ?? 'over'})`);
}
void MAP_W;
