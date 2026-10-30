/**
 * Yard football (P29, docs/PLAN.md §9): three a side on the yard's pitch (PrisonDef.leisure.pitch).
 * Talked into it by an inmate at the pitch in the games' hours (TALK.FOOTBALL: he captains the
 * other side), the player plays with the two inmates who think most of them, against him and the
 * two others nearest. The players walk on; the whistle blows once they're on the field (or after
 * GATHER_STEPS), and the match runs MATCH_STEPS (`matchSteps`).
 *
 * The ball: an integer position and speed, slowed a little each step, bouncing off the pitch's
 * boards (its sides and ends but for the goals' mouths). The player dribbles by running into it,
 * and kicks it (EXT.KICK: Space held, let go) the way they face, harder the longer it was held.
 * Since 2.16 (not under Sim.rules215): Kick held goes the moment the ball's in reach, a kick let go
 * a moment early waits for it, one roughly at the far net goes at its mouth and one at their own
 * net is cleared wide.
 * The inmates chase it and keep goal; a kick of theirs goes at the other goal, give or take, by
 * roll() (a team-mate passes to the player ahead of him now and then).
 *
 * The cover: guards outdoors near a match watch the ball; anything off the pitch they see at half
 * their range (watch.ts, smuggling.ts: sightFor). A goal turns them all to look at it a moment.
 *
 * A hard foul (the player's blow at a rival) ends it in a brawl: the rivals go for the player and
 * the nearest guards come to look (as a crew brawl, P23). Won: the team-mates' respect, the
 * crowd's, a point of Speed, a win towards sports day.
 */
import { BRAWL_GUARDS } from '../../content/crew';
import { CROWD_RANGE } from '../../content/games';
import { AIM_HELP, AIM_IN, AIM_WIDE, KICK_GRACE, KICK_LIFT, KICK_TAP, KICKOFF_STEPS, MATCH_STEPS_215, TACKLE_COOL, BALL_KEEP, KEEPER_COOL, KEEPER_REACH, SHOOT_RANGE, BALL_R, BALL_STOP, BEHIND, BOUNCE_KEEP, CALL_RANGE, DRIBBLE_PUSH, GATHER_STEPS, GOAL_HALF, GOAL_LOOK, GOAL_PAUSE, KEEPER_RUSH, KICK_COOL, KICK_HOLD, KICK_INMATE, KICK_MAX, KICK_MIN, KICK_NOISE, KICK_REACH, KICK_SPREAD, MATCH_STEPS, PASS_ODDS, PITCH_LEAVE, PITCH_RANGE, TEAM_CROWD_OPINION, TEAM_PLAY_OPINION, TEAM_WIN_OPINION, TOUCH, YARD_EYES } from '../../content/team';
import type { Pitch } from '../../content/prisons/types';
import { nearestDir } from '../ai/path';
import { tileAt } from '../world/grid';
import { DIR_X, DIR_Z } from '../command';
import type { SimContext } from '../context';
import { rollInt, SALT } from '../rng';
import { ATTRS } from '../state';
import { ANGRY_STEPS, ATTR_MAX, UNIT, walkSpeed } from '../tuning';
import { TILE_INFO } from '../world/tiles';
import { LAYER, MAP_W } from '../world/World';
import { sightOf } from './calendar';
import { prisonDay } from './clock';
import { countGame, gameOn, gameRefusal, gamesOpen, sportsPrizeIfDue, sportsWin } from './games';
import { awake, GUARD, sendToLook, type Guard } from './guards';
import { DOING } from './inmates';
import { bodyAt, type Body } from './movement';
import { makeNoise } from './noise';
import { changeOpinion, endTalk, refuse } from './social';
import { stopTraining } from './training';
import { SPORTS_WINS } from '../../content/games';
import { lineOfSight } from '../ai/sight';

/** A match under way (P29): plain data in the state. */
export interface Match {
  /** The captain (inmate index): the other side's, who was asked. */
  who: number;
  /** The players (inmate indexes): the player's keeper and team-mate, then the captain, his team-mate and keeper (TEAM). */
  team: number[];
  /** The step gathering began, and the whistle (0: not blown yet). */
  from: number;
  at: number;
  /** Goals: the player's side's, the other side's. */
  goals: number[];
  /** The ball: [x, z, speed x, speed z] (units, units a step). */
  ball: number[];
  /** Who touched it last: -1 the player, a place in `team`, -2 nobody yet. */
  last: number;
  /** After a goal, the step play goes on again (0: in play). */
  pause: number;
  /** The step each of `team` may kick again (the last: the player). */
  cool: number[];
  /** The step Space went down for a kick (0: not held). */
  hold: number;
  /** The player's own goals in it. */
  scored: number;
  /** The step play went on again after the last goal (0 none yet). */
  restart: number;
  /** The side kicking off (0 the player's, 1 the other; -1 the ball's in open play): the other side can't touch it until they have. */
  kick: number;
  /** 2.16: the step Kick was let go with the ball out of reach (the kick waits KICK_GRACE for it); 0 or absent none. */
  late?: number;
  /** 2.16: Kick went down with the ball already at the player's feet (1): it charges until let go (or full power), not on contact; once the ball's away, it goes on the next touch. */
  feet?: number;
}

/** Match.cool's place for the player's own kick. */
const PLAYER_COOL = 5;

/** Places in Match.team. */
export const TEAM = { KEEPER: 0, MATE: 1, CAPTAIN: 2, RIVAL: 3, RIVAL_KEEPER: 4 } as const;
/** Whose side each place in `team` is on: 0 the player's. */
export const sideOf = (k: number) => (k < TEAM.CAPTAIN ? 0 : 1);

/** How a match news goes (the 'football' event). */
export type FootballNews = 'start' | 'kickoff' | 'goal' | 'restart' | 'kick' | 'whiff' | 'won' | 'lost' | 'draw' | 'off' | 'foul';

/** The prison's pitch (null: none). */
export const pitchOf = (sim: Pick<SimContext, 'world'> & { rules250?: boolean }): Pitch | null => (sim.rules250 ? sim.world.def.leisure?.pitchWas : null) ?? sim.world.def.leisure?.pitch ?? null;

/**
 * The pitch in play terms: the long way (`along` x, else z) from the player's goal line a0 to the
 * other's a1; across it from l0 to l1; the goals' mouths centred on `mid` (all in units).
 */
export interface Field {
  along: boolean;
  a0: number;
  a1: number;
  l0: number;
  l1: number;
  mid: number;
}
export function fieldOf(p: Pitch): Field {
  return p.w >= p.d
    ? { along: true, a0: (p.x + 1) * UNIT, a1: (p.x + p.w - 1) * UNIT, l0: p.z * UNIT, l1: (p.z + p.d) * UNIT, mid: (p.z + Math.floor(p.d / 2)) * UNIT }
    : { along: false, a0: (p.z + 1) * UNIT, a1: (p.z + p.d - 1) * UNIT, l0: p.x * UNIT, l1: (p.x + p.w) * UNIT, mid: (p.x + Math.floor(p.w / 2)) * UNIT };
}
/** A point's place along the field and across it, and back. */
const along = (f: Field, x: number, z: number) => (f.along ? x : z);
const across = (f: Field, x: number, z: number) => (f.along ? z : x);
const put = <B extends { x: number; z: number }>(f: Field, b: B, a: number, l: number): B => {
  b.x = f.along ? a : l;
  b.z = f.along ? l : a;
  return b;
};

/** Whether a tile is on the pitch (its rectangle, the nets' end tiles too). */
export function onPitch(p: Pitch, x: number, z: number): boolean {
  const tx = Math.floor(x / UNIT);
  const tz = Math.floor(z / UNIT);
  return tx >= p.x && tx < p.x + p.w && tz >= p.z && tz < p.z + p.d;
}

/** How far (tiles, the larger way) a point is from the pitch's rectangle (0 on it). */
function offBy(p: Pitch, x: number, z: number): number {
  const tx = Math.floor(x / UNIT);
  const tz = Math.floor(z / UNIT);
  return Math.max(p.x - tx, tx - (p.x + p.w - 1), p.z - tz, tz - (p.z + p.d - 1), 0);
}

/** The middle of the pitch (units). */
export function centreOf(p: Pitch): { x: number; z: number } {
  const f = fieldOf(p);
  return put(f, { x: 0, z: 0 }, Math.floor((f.a0 + f.a1) / 2), f.mid);
}

// ------------------------------------------------------------------ the cover

/**
 * A match is being played (the whistle has blown) and a guard is watching it: awake and on duty
 * (never one chasing or sent to look), outdoors near the pitch, with the ball in plain view (a
 * guard round a corner or behind a wall doesn't watch what he can't see).
 */
export function watchingMatch(sim: Pick<SimContext, 'world' | 'state'>, g: Guard): boolean {
  const s = sim.state;
  const p = pitchOf(sim);
  if (!p || !s.match || !s.match.at || !awake(g) || g.mode !== GUARD.DUTY) return false;
  const tx = Math.floor(g.body.x / UNIT);
  const tz = Math.floor(g.body.z / UNIT);
  if (!TILE_INFO[sim.world.ground.kind[tz * MAP_W + tx]].outdoor || offBy(p, g.body.x, g.body.z) > YARD_EYES) return false;
  return lineOfSight(sim.world, g.body.x, g.body.z, s.match.ball[0], s.match.ball[1]);
}

/** How far a guard sees a point now (units): its sight today, halved for a point off the pitch while it watches a match. */
export function sightFor(sim: SimContext, g: Guard, x: number, z: number): number {
  const r = sightOf(sim, g);
  const p = pitchOf(sim);
  return p && watchingMatch(sim, g) && !onPitch(p, x, z) ? Math.floor(r / 2) : r;
}

// ------------------------------------------------------------------ the teams

/** What an inmate won't get up from for a match: sleep, a meal, a game with someone (before 2.16, a seat too: the benches by the pitch kept players off it). */
const BUSY: ReadonlySet<number> = new Set([DOING.SLEEP, DOING.EAT, DOING.BOARD, DOING.CARDS, DOING.DICE, DOING.WRESTLE, DOING.LOOKOUT, DOING.BRAWL]);
const BUSY_215: ReadonlySet<number> = new Set([...BUSY, DOING.SIT, DOING.SIT_READ]);

/** How long a match is played (steps from the whistle). */
export const matchSteps = (sim: Pick<SimContext, 'rules215'>) => (sim.rules215 ? MATCH_STEPS_215 : MATCH_STEPS);

/** Whether an inmate could play now: up and about, not busy with the player or the crew's orders, near the pitch. */
function free(sim: SimContext, k: number, p: Pitch): boolean {
  const s = sim.state;
  const m = s.inmates[k];
  if (!m || m.ko > 0 || m.angry > 0 || (sim.rules215 ? BUSY_215 : BUSY).has(m.doing)) return false;
  if (s.dice[0] === k || s.bout[0] === k || s.cheat?.who === k || s.shootout?.who === k || s.ink?.who === k) return false;
  if (s.crew.some((e) => e[0] === k && e[1] !== 0)) return false;
  return offBy(p, m.body.x, m.body.z) <= CALL_RANGE;
}

/**
 * The teams for a match the captain was asked to: the player's two team-mates are those who think
 * most of them, the captain's the two nearest the pitch's middle (ties: the lower index). Null
 * when there aren't four more to play.
 */
export function teamsFor(sim: SimContext, who: number): number[] | null {
  const s = sim.state;
  const p = pitchOf(sim);
  if (!p) return null;
  const pool: number[] = [];
  s.inmates.forEach((_, k) => {
    if (k !== who && free(sim, k, p)) pool.push(k);
  });
  if (pool.length < 4) return null;
  const mates = [...pool].sort((a, b) => s.inmates[b].opinion - s.inmates[a].opinion || a - b).slice(0, 2);
  const c = centreOf(p);
  const d2 = (k: number) => (s.inmates[k].body.x - c.x) ** 2 + (s.inmates[k].body.z - c.z) ** 2;
  const rivals = pool.filter((k) => !mates.includes(k)).sort((a, b) => d2(a) - d2(b) || a - b).slice(0, 2);
  // (The one who thinks most of the player keeps goal; the captain's nearer one plays up, the other keeps.)
  return [mates[0], mates[1], who, rivals[0], rivals[1]];
}

/** Why a match can't start with an inmate now (null: it can). */
export function matchRefusal(sim: SimContext, who: number): ReturnType<typeof gameRefusal> {
  const s = sim.state;
  const p = pitchOf(sim);
  const m = s.inmates[who];
  if (!p || !m) return 'noPitch';
  const why = gameRefusal(sim, who);
  if (why) return why;
  if (s.layer !== LAYER.GROUND || offBy(p, s.player.x, s.player.z) > PITCH_RANGE || offBy(p, m.body.x, m.body.z) > PITCH_RANGE) return 'noPitch';
  if (s.crew.some((e) => e[0] === who && e[1] !== 0)) return 'crewBusy';
  if (!teamsFor(sim, who)) return 'fewPlayers';
  return null;
}

/** A match with the inmate the player is talking to (TALK.FOOTBALL): the teams walk on. */
export function startMatch(sim: SimContext, who: number) {
  const s = sim.state;
  const p = pitchOf(sim);
  if (gameOn(s) || !p) return;
  const why = matchRefusal(sim, who);
  if (why) return refuse(sim, why);
  const team = teamsFor(sim, who)!;
  countGame(sim, who);
  stopTraining(sim);
  endTalk(sim);
  // (Whatever they were lingering over, they come at once.)
  for (const id of team) {
    const m = s.inmates[id];
    m.wait = 0;
    m.path = [];
  }
  const c = centreOf(p);
  s.match = { who, team, from: s.step, at: 0, goals: [0, 0], ball: [c.x, c.z, 0, 0], last: -2, pause: 0, cool: [0, 0, 0, 0, 0, 0], hold: 0, scored: 0, restart: 0, kick: 1 };
  sim.events.push({ type: 'football', what: 'start', who, team: team.slice() });
}

// ------------------------------------------------------------------ the player's kick

/** Space down for a kick (EXT.KICK 0): in a match, on the ground floor (a kick let go early and still waiting: begun again). */
export function holdKick(sim: SimContext) {
  const s = sim.state;
  const o = s.match;
  if (!o || (o.hold && !o.late) || s.layer !== LAYER.GROUND || s.sleeping || s.ko > 0) return;
  o.hold = s.step;
  o.late = 0;
  o.feet = !sim.rules215 && inReach(sim, o) ? 1 : 0;
}

/** How hard a kick held this many steps goes (units a step). */
export const kickPower = (held: number) => KICK_MIN + Math.floor(((KICK_MAX - KICK_MIN) * Math.min(KICK_HOLD, Math.max(0, held))) / KICK_HOLD);

/** The ball is the player's to kick now: in play, not the other side's kick-off, their kick ready, at their feet. */
function inReach(sim: SimContext, o: Match): boolean {
  const s = sim.state;
  const p = s.player;
  return o.at > 0 && !o.pause && o.kick !== 1 && s.step >= o.cool[PLAYER_COOL] && (o.ball[0] - p.x) ** 2 + (o.ball[1] - p.z) ** 2 <= KICK_REACH * KICK_REACH;
}

/**
 * Space let go (EXT.KICK 1, or held to KICK_HOLD): the ball kicked the way the player faces if
 * it's at their feet; else a kick at the air (since 2.16, one let go a moment early waits for the
 * ball KICK_GRACE steps first: keepMatch).
 */
export function releaseKick(sim: SimContext) {
  const s = sim.state;
  const o = s.match;
  if (!o || !o.hold || o.late) return;
  if (!inReach(sim, o) && !sim.rules215) {
    o.late = s.step;
    return;
  }
  kickOrWhiff(sim, o, s.step);
}

/** The kick held from `o.hold` to `to` goes now: at the ball if it's in reach, else at the air. */
function kickOrWhiff(sim: SimContext, o: Match, to: number) {
  const s = sim.state;
  const power = kickPower(to - o.hold) + (sim.rules215 ? 0 : KICK_LIFT);
  o.hold = 0;
  o.late = 0;
  o.feet = 0;
  const [bx, bz] = o.ball;
  if (!inReach(sim, o)) {
    sim.events.push({ type: 'football', what: 'whiff', power });
    return;
  }
  const [dx, dz] = kickWay(sim, o);
  o.ball[2] = Math.trunc((dx * power) / 1024);
  o.ball[3] = Math.trunc((dz * power) / 1024);
  o.last = -1;
  o.kick = -1;
  o.cool[PLAYER_COOL] = s.step + KICK_COOL;
  sim.events.push({ type: 'football', what: 'kick', power });
  makeNoise(sim, 'thud', LAYER.GROUND, tileAt(bx, bz), KICK_NOISE);
}

/**
 * The way the player's kick goes (×1024): the way they face; since 2.16, within AIM_HELP of the
 * way to the far net, at its mouth (where their way crosses its line, kept AIM_IN of its middle).
 */
function kickWay(sim: SimContext, o: Match): [number, number] {
  const face = sim.state.player.facing;
  const dx = DIR_X[face] ?? 0;
  const dz = DIR_Z[face] ?? 0;
  const p = pitchOf(sim);
  if (sim.rules215 || !p) return [dx, dz];
  const f = fieldOf(p);
  const ba = along(f, o.ball[0], o.ball[1]);
  const bl = across(f, o.ball[0], o.ball[1]);
  const fa = f.along ? dx : dz;
  const fl = f.along ? dz : dx;
  const ga = f.a1 - ba;
  const gl = f.mid - bl;
  const gd = Math.sqrt(ga * ga + gl * gl) || 1;
  // (At the player's own net: cleared out wide instead, to the nearer side and a little up the field.)
  if (fa < 0) {
    const cross = bl + Math.trunc((fl * (ba - f.a0)) / -fa);
    if (Math.abs(cross - f.mid) > GOAL_HALF + AIM_WIDE / 2) return [dx, dz];
    const side = bl >= f.mid ? 1 : -1;
    const va = 300;
    const vl = side * 980;
    return f.along ? [va, vl] : [vl, va];
  }
  if (ga <= 0 || (fa * ga + fl * gl) / gd < AIM_HELP) return [dx, dz];
  const tl = Math.max(f.mid - AIM_IN, Math.min(f.mid + AIM_IN, bl + Math.trunc((fl * ga) / fa)));
  // (At the point on the line itself: it crosses where aimed.)
  const ta = ga;
  const d = Math.sqrt(ta * ta + (tl - bl) ** 2) || 1;
  const va = Math.trunc((ta * 1024) / d);
  const vl = Math.trunc(((tl - bl) * 1024) / d);
  return f.along ? [va, vl] : [vl, va];
}

// ------------------------------------------------------------------ the match, each step

/** Where each of `team` lines up for the kick-off (units, by place in `team`). */
function kickoffSpot(f: Field, k: number, out: Body): Body {
  const len = f.a1 - f.a0;
  const c = Math.floor((f.a0 + f.a1) / 2);
  switch (k) {
    case TEAM.KEEPER:
      return put(f, out, f.a0 + 600, f.mid);
    case TEAM.MATE:
      return put(f, out, f.a0 + Math.floor((len * 3) / 10), f.mid - UNIT);
    case TEAM.CAPTAIN:
      return put(f, out, c + 1200, f.mid);
    case TEAM.RIVAL:
      return put(f, out, f.a1 - Math.floor((len * 3) / 10), f.mid + UNIT);
    default:
      return put(f, out, f.a1 - 600, f.mid);
  }
}

/** Marks the match's players walk to this step (one per place in `team`), reused. Not state. */
const marks: Body[] = [0, 1, 2, 3, 4].map(() => bodyAt(0, 0));

/**
 * Where the match sends its players this step (socialNow, after the crew: the match comes first):
 * to their kick-off spots until the whistle and after a goal; then keepers on their line (out to a
 * ball close to goal), each side's nearer outfield player after the ball (on the player's side,
 * the team-mate only when nearer it than the player), the other back between it and his goal.
 */
export function matchTargets(sim: SimContext, so: { follow: Array<Body | null>; gap: number[]; doing: number[]; pace: number[] }) {
  const s = sim.state;
  const o = s.match;
  const p = pitchOf(sim);
  if (!o || !p) return;
  const f = fieldOf(p);
  const [bx, bz] = o.ball;
  const ba = along(f, bx, bz);
  const bl = across(f, bx, bz);
  const set = !o.at || o.pause > 0;
  const d2 = (b: Body) => (b.x - bx) ** 2 + (b.z - bz) ** 2;
  // The outfield chaser on each side.
  const mate = s.inmates[o.team[TEAM.MATE]];
  const cap = s.inmates[o.team[TEAM.CAPTAIN]];
  const riv = s.inmates[o.team[TEAM.RIVAL]];
  const mateChases = !!mate && d2(mate.body) < d2(s.player);
  const capChases = !!cap && (!riv || d2(cap.body) <= d2(riv.body));
  o.team.forEach((id, k) => {
    const m = s.inmates[id];
    if (!m || m.ko > 0 || m.angry > 0) return;
    // (2.5.1: on the pitch now, whatever he was lingering over.)
    if (!sim.rules250) m.wait = 0;
    const mark = marks[k];
    let pace = m.speed;
    if (set) kickoffSpot(f, k, mark);
    else {
      const side = sideOf(k);
      const own = side === 0 ? f.a0 : f.a1;
      const inward = side === 0 ? 1 : -1;
      const chaser = k === TEAM.MATE ? mateChases : k === TEAM.CAPTAIN ? capChases : k === TEAM.RIVAL ? !capChases : false;
      if (k === TEAM.KEEPER || k === TEAM.RIVAL_KEEPER) {
        const close = (ba - own) ** 2 + (bl - f.mid) ** 2 < KEEPER_RUSH * KEEPER_RUSH;
        if (close) put(f, mark, ba, bl);
        else put(f, mark, own + inward * 600, Math.max(f.mid - GOAL_HALF + 360, Math.min(f.mid + GOAL_HALF - 360, bl)));
        pace -= 20;
      } else if (chaser) {
        // Behind the ball on the way to the other goal, then onto it.
        const at = side === 0 ? f.a1 : f.a0;
        const da = at - ba;
        const dl = f.mid - bl;
        const d = Math.sqrt(da * da + dl * dl) || 1;
        const ma = along(f, m.body.x, m.body.z);
        const ml = across(f, m.body.x, m.body.z);
        const ready = (ma - (ba - (da * BEHIND) / d)) ** 2 + (ml - (bl - (dl * BEHIND) / d)) ** 2 < 250 * 250;
        if (ready || d2(m.body) < (BEHIND + 120) ** 2) put(f, mark, ba, bl);
        else put(f, mark, Math.trunc(ba - (da * BEHIND) / d), Math.trunc(bl - (dl * BEHIND) / d));
      } else {
        // Back, between the ball and his own goal, on the far side of it.
        put(f, mark, Math.floor((ba + own) / 2), bl > f.mid ? f.mid - UNIT : f.mid + UNIT);
        pace -= 20;
      }
    }
    so.follow[id] = mark;
    so.gap[id] = 0;
    // (Nothing special drawn: they run, and stand; the kick's wind-up is the player's own.)
    so.doing[id] = DOING.NOTHING;
    so.pace[id] = pace;
  });
}

/**
 * Each step of a match (with the side games): the kick held too long goes; off when it can't go on
 * (a foul ends it in a brawl); the whistle; the players' touches, the ball's roll and bounces; a
 * goal; full time.
 */
export function keepMatch(sim: SimContext) {
  const s = sim.state;
  const o = s.match;
  if (!o) return;
  const p = pitchOf(sim);
  if (!p) return endMatch(sim, 'off');
  // The kick let go a moment early (since 2.16): it waits KICK_GRACE for the ball. Held to full power before 2.16: it goes, at the ball or the air.
  if (o.late) {
    if (inReach(sim, o) || s.step - o.late >= KICK_GRACE) kickOrWhiff(sim, o, o.late);
  } else if (o.hold && s.step - o.hold >= KICK_HOLD && sim.rules215) releaseKick(sim);
  // The player's blow at one of the other side: a hard foul (one of them going for the player on his own, a grudge, an ambush: off).
  const rivals = [o.team[TEAM.CAPTAIN], o.team[TEAM.RIVAL], o.team[TEAM.RIVAL_KEEPER]];
  if (sim.events.some((e) => e.type === 'hit' && rivals.includes(e.who))) return endMatch(sim, 'foul');
  const pl = s.player;
  const far = s.layer !== LAYER.GROUND || offBy(p, pl.x, pl.z) > PITCH_LEAVE;
  if (s.lockdown || sim.away || s.sleeping || s.stowed || far || o.team.some((id) => !s.inmates[id] || s.inmates[id].ko > 0 || s.inmates[id].angry > 0)) return endMatch(sim, 'off');
  // The bell for the next block: full time there and then (a match begun never keeps anyone from where they should be).
  if (!gamesOpen(sim)) return o.at ? fullTime(sim, o) : endMatch(sim, 'off');
  const f = fieldOf(p);
  if (!o.at) {
    // Walking on: the whistle once everyone's on the field (the player too), or after GATHER_STEPS.
    const on = (b: Body) => along(f, b.x, b.z) > f.a0 && along(f, b.x, b.z) < f.a1 && onPitch(p, b.x, b.z);
    if (s.step - o.from >= GATHER_STEPS || (on(pl) && o.team.every((id) => on(s.inmates[id].body)))) {
      o.at = s.step;
      sim.events.push({ type: 'football', what: 'kickoff' });
    }
    return;
  }
  if (s.step - o.at >= matchSteps(sim)) return fullTime(sim, o);
  if (o.pause) {
    if (s.step < o.pause) return;
    const c = centreOf(p);
    o.ball = [c.x, c.z, 0, 0];
    o.pause = 0;
    o.last = -2;
    o.restart = s.step;
    sim.events.push({ type: 'football', what: 'restart' });
  }
  const b = o.ball;
  // (The kick-off: the other side keeps off it until the side kicking off has touched it, or for KICKOFF_STEPS at most.)
  if (o.kick >= 0 && s.step - Math.max(o.at, o.restart) >= KICKOFF_STEPS) o.kick = -1;
  // Kick held (since 2.16): it goes the moment the ball's in reach, as hard as it's been held; held down with the ball already at the feet, it charges until let go or full (the ball once away, it goes on the next touch).
  if (!sim.rules215 && o.hold > 0 && !o.late) {
    const near = inReach(sim, o);
    if (o.feet && !near) o.feet = 0;
    if (near && s.step - o.hold >= (o.feet ? KICK_HOLD : KICK_TAP)) kickOrWhiff(sim, o, s.step);
  }
  const kicked = !sim.rules215 && o.cool[PLAYER_COOL] === s.step + KICK_COOL;
  // The player runs into it: dribbled on, a little faster than the walk (a ball already going faster that way rolls on; one just kicked goes where it was kicked).
  if (!kicked && pl.moving && o.kick !== 1 && (b[0] - pl.x) ** 2 + (b[1] - pl.z) ** 2 < TOUCH * TOUCH) {
    const push = walkSpeed(s.spd) + DRIBBLE_PUSH;
    const dx = DIR_X[pl.facing] ?? 0;
    const dz = DIR_Z[pl.facing] ?? 0;
    if ((b[2] * dx + b[3] * dz) / 1024 < push) {
      b[2] = Math.trunc((dx * push) / 1024);
      b[3] = Math.trunc((dz * push) / 1024);
      o.last = -1;
      o.kick = -1;
    }
  }
  // An inmate at the ball, or in its way this step, kicks it (one kick a step; who's asked first turns with the step, so neither side always wins a ball both reach; a keeper reaches further).
  for (let j = 0; j < o.team.length; j++) {
    const k = (j + s.step) % o.team.length;
    const m = s.inmates[o.team[k]];
    const reach = k === TEAM.KEEPER || k === TEAM.RIVAL_KEEPER ? KEEPER_REACH : TOUCH;
    if (s.step < o.cool[k] || (o.kick >= 0 && sideOf(k) !== o.kick) || nearPath(b, m.body) >= reach * reach) continue;
    inmateKick(sim, o, f, k);
    o.kick = -1;
    // (A rival's tackle, never the keeper's save: the ball off the player's feet, theirs again only in a moment.)
    if (!sim.rules215 && sideOf(k) === 1 && k !== TEAM.RIVAL_KEEPER && (b[0] - pl.x) ** 2 + (b[1] - pl.z) ** 2 <= KICK_REACH * KICK_REACH) o.cool[PLAYER_COOL] = Math.max(o.cool[PLAYER_COOL], s.step + TACKLE_COOL);
    break;
  }
  roll(sim, o, f);
}


/** How near (squared, units) a body comes to the ball's way this step: from where it is to where its speed takes it. */
function nearPath(b: readonly number[], at: { x: number; z: number }): number {
  const [x, z, vx, vz] = b;
  const v2 = vx * vx + vz * vz;
  const t = v2 ? Math.max(0, Math.min(1, ((at.x - x) * vx + (at.z - z) * vz) / v2)) : 0;
  return (x + vx * t - at.x) ** 2 + (z + vz * t - at.z) ** 2;
}

/**
 * An inmate's kick: a keeper's clear upfield; else at the other goal, wide of its middle by up to
 * AIM_WIDE (roll()); a team-mate with the player ahead of him passes to them PASS_ODDS times in 100.
 */
function inmateKick(sim: SimContext, o: Match, f: Field, k: number) {
  const s = sim.state;
  const m = s.inmates[o.team[k]];
  const side = sideOf(k);
  const r = (n: number, j: number) => rollInt(s.salt, SALT.FOOTBALL, s.step, k * 4 + j, n);
  const [bx, bz] = o.ball;
  let ta: number;
  let tl: number;
  let speed = KICK_INMATE + r(KICK_SPREAD + 1, 0);
  const pa = along(f, s.player.x, s.player.z);
  const ma = along(f, m.body.x, m.body.z);
  if (k === TEAM.KEEPER || k === TEAM.RIVAL_KEEPER) {
    ta = Math.floor((f.a0 + f.a1) / 2) + (side === 0 ? 1 : -1) * 2 * UNIT;
    tl = f.l0 + UNIT + r(Math.max(1, f.l1 - f.l0 - 2 * UNIT), 1);
  } else if (k === TEAM.MATE && pa - ma > 2 * UNIT && r(100, 2) < PASS_ODDS) {
    // A pass: into the player's path, just hard enough to get there.
    ta = pa + UNIT;
    tl = across(f, s.player.x, s.player.z);
    const d = Math.sqrt((ta - along(f, bx, bz)) ** 2 + (tl - across(f, bx, bz)) ** 2);
    speed = Math.max(KICK_INMATE - 60, Math.min(KICK_MAX, Math.floor((d * (100 - BALL_KEEP)) / 100) + 40));
  } else if (Math.abs((side === 0 ? f.a1 : f.a0) - along(f, bx, bz)) <= SHOOT_RANGE) {
    // In range: a shot, give or take.
    ta = side === 0 ? f.a1 + UNIT : f.a0 - UNIT;
    tl = f.mid - AIM_WIDE + r(2 * AIM_WIDE + 1, 3);
  } else {
    // Further out: knocked on up the field, anywhere across it.
    ta = along(f, bx, bz) + (side === 0 ? 1 : -1) * SHOOT_RANGE;
    tl = f.l0 + UNIT / 2 + r(Math.max(1, f.l1 - f.l0 - UNIT), 3);
    speed = KICK_INMATE - KICK_SPREAD / 2 + r(KICK_SPREAD / 2 + 1, 0);
  }
  const da = ta - along(f, bx, bz);
  const dl = tl - across(f, bx, bz);
  const d = Math.sqrt(da * da + dl * dl) || 1;
  const va = Math.trunc((da * speed) / d);
  const vl = Math.trunc((dl * speed) / d);
  o.ball[2] = f.along ? va : vl;
  o.ball[3] = f.along ? vl : va;
  o.last = k;
  o.cool[k] = s.step + (k === TEAM.KEEPER || k === TEAM.RIVAL_KEEPER ? KEEPER_COOL : KICK_COOL);
  if (va || vl) m.body.facing = nearestDir(o.ball[2], o.ball[3]);
}

/** The ball rolls a step: off the boards, into a goal's mouth (a goal), slowing. */
function roll(sim: SimContext, o: Match, f: Field) {
  const b = o.ball;
  let a = along(f, b[0], b[1]) + (f.along ? b[2] : b[3]);
  let l = across(f, b[0], b[1]) + (f.along ? b[3] : b[2]);
  let va = f.along ? b[2] : b[3];
  let vl = f.along ? b[3] : b[2];
  if (l < f.l0 + BALL_R) {
    l = 2 * (f.l0 + BALL_R) - l;
    vl = Math.trunc((-vl * BOUNCE_KEEP) / 100);
  } else if (l > f.l1 - BALL_R) {
    l = 2 * (f.l1 - BALL_R) - l;
    vl = Math.trunc((-vl * BOUNCE_KEEP) / 100);
  }
  // A goal: across the line inside the mouth, judged where it crossed (not where the step left it).
  const a1 = along(f, b[0], b[1]);
  const l1 = across(f, b[0], b[1]);
  const end = a < f.a0 ? f.a0 : a > f.a1 ? f.a1 : 0;
  const crossL = end && a !== a1 ? l1 + Math.trunc(((l - l1) * (end - a1)) / (a - a1)) : l;
  const mouth = Math.abs((end ? crossL : l) - f.mid) < GOAL_HALF - BALL_R;
  if (mouth && end) return goal(sim, o, f, a < f.a0 ? 0 : 1, crossL);
  if (!mouth && a < f.a0 + BALL_R) {
    a = 2 * (f.a0 + BALL_R) - a;
    va = Math.trunc((-va * BOUNCE_KEEP) / 100);
  } else if (!mouth && a > f.a1 - BALL_R) {
    a = 2 * (f.a1 - BALL_R) - a;
    va = Math.trunc((-va * BOUNCE_KEEP) / 100);
  }
  va = Math.trunc((va * BALL_KEEP) / 100);
  vl = Math.trunc((vl * BALL_KEEP) / 100);
  if (va * va + vl * vl < BALL_STOP * BALL_STOP) va = vl = 0;
  put(f, sim.scratch.point, a, l);
  b[0] = sim.scratch.point.x;
  b[1] = sim.scratch.point.z;
  b[2] = f.along ? va : vl;
  b[3] = f.along ? vl : va;
}

/** A goal in the net at the `end` (0 the player's): the score, the ball in the net a moment, every guard watching turned to look. */
function goal(sim: SimContext, o: Match, f: Field, end: number, l: number) {
  const s = sim.state;
  const mine = end === 1;
  o.goals[mine ? 0 : 1]++;
  if (mine && o.last === -1) o.scored++;
  const a = end === 0 ? f.a0 - UNIT / 2 : f.a1 + UNIT / 2;
  put(f, sim.scratch.point, a, l);
  o.ball = [sim.scratch.point.x, sim.scratch.point.z, 0, 0];
  o.pause = s.step + GOAL_PAUSE;
  // (The side that let it in kicks off again.)
  o.kick = end === 0 ? 0 : 1;
  const by = o.last >= 0 ? o.team[o.last] : o.last;
  sim.events.push({ type: 'football', what: 'goal', mine, by, score: o.goals.slice() });
  // Every eye that was on the match goes to the net (a guard on his round or post stops to look).
  const at = sim.scratch.point;
  for (const g of s.guards) {
    if (g.mode !== GUARD.DUTY || !watchingMatch(sim, g)) continue;
    g.wait = Math.max(g.wait, GOAL_LOOK);
    g.body.moving = false;
    if (at.x !== g.body.x || at.z !== g.body.z) g.body.facing = nearestDir(at.x - g.body.x, at.z - g.body.z);
  }
}

/** Full time: won, lost or drawn on the score. */
const fullTime = (sim: SimContext, o: Match) => endMatch(sim, o.goals[0] > o.goals[1] ? 'won' : o.goals[0] < o.goals[1] ? 'lost' : 'draw');

/** How a match ended: won, lost, drawn, off (the sirens, someone gone), or a foul (a brawl). */
function endMatch(sim: SimContext, how: 'won' | 'lost' | 'draw' | 'off' | 'foul') {
  const s = sim.state;
  const o = s.match;
  if (!o) return;
  s.match = null;
  const score = o.goals.slice();
  const mates = [o.team[TEAM.KEEPER], o.team[TEAM.MATE]];
  if (how === 'foul') {
    // A brawl: the other side goes for the player, and the nearest guards come to look.
    for (const k of [TEAM.CAPTAIN, TEAM.RIVAL, TEAM.RIVAL_KEEPER]) {
      const m = s.inmates[o.team[k]];
      if (m && m.ko <= 0) m.angry = Math.max(m.angry, ANGRY_STEPS);
    }
    const at = s.inmates[o.team[TEAM.CAPTAIN]]?.body ?? s.player;
    const near = s.guards
      .map((g, k) => [k, (g.body.x - at.x) ** 2 + (g.body.z - at.z) ** 2] as [number, number])
      .filter(([k]) => awake(s.guards[k]) && s.guards[k].mode !== GUARD.CHASE)
      .sort((a, b) => a[1] - b[1] || a[0] - b[0])
      .slice(0, BRAWL_GUARDS)
      .map(([k]) => k);
    for (const k of near) sendToLook(s.guards[k], tileAt(at.x, at.z));
    sim.events.push({ type: 'football', what: 'foul', who: o.who, score, guards: near });
    return;
  }
  if (how === 'off') {
    sim.events.push({ type: 'football', what: 'off', who: o.who, score });
    return;
  }
  if (how !== 'won') {
    for (const k of mates) changeOpinion(sim, k, TEAM_PLAY_OPINION);
    sim.events.push({ type: 'football', what: how, who: o.who, score, scored: o.scored });
    return;
  }
  for (const k of mates) changeOpinion(sim, k, TEAM_WIN_OPINION);
  // Those watching think more of the player too (each once a day, as at arm-wrestling).
  const day = prisonDay(s.step);
  const p = pitchOf(sim)!;
  const c = centreOf(p);
  const crowd: number[] = [];
  s.inmates.forEach((m, k) => {
    if (o.team.includes(k) || m.ko > 0 || m.angry > 0 || m.doing === DOING.SLEEP || (s.cheered[k] ?? 0) === day) return;
    if (offBy(p, m.body.x, m.body.z) > CROWD_RANGE || !lineOfSight(sim.world, m.body.x, m.body.z, c.x, c.z)) return;
    crowd.push(k);
  });
  for (const k of crowd) {
    while (s.cheered.length <= k) s.cheered.push(0);
    s.cheered[k] = day;
    changeOpinion(sim, k, TEAM_CROWD_OPINION);
  }
  const spd = s.spd < ATTR_MAX ? 1 : 0;
  s.spd += spd;
  s.trained |= 1 << ATTRS.indexOf('spd');
  const wins = sportsWin(sim);
  sim.events.push({ type: 'football', what: 'won', who: o.who, score, scored: o.scored, crowd: crowd.length, spd, wins });
  if (wins >= SPORTS_WINS) sportsPrizeIfDue(sim);
}
