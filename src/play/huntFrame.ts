/** What the hunt shows each frame: the outside's view record and frame, and the HUD's state. */
import { HUNT } from '../content/manhunt';
import { itemNumber } from '../content/items';
import { t, type Key } from '../i18n';
import { type HuntFrame } from '../render/Hunt';
import { centerX, centerZ } from '../sim/world/grid';
import { headingAngle } from '../sim/command';
import { HOUND, Hunt, OVER, SEEK } from '../sim/hunt/Hunt';
import { floorAt, spotTile } from '../sim/hunt/world';
import { ALERT, GUARD_SPEED } from '../sim/systems/guards';
import { DOING } from '../sim/systems/inmates';
import { STEPS_PER_SECOND, UNIT, WALK_SPEED } from '../sim/tuning';
import { MAP_W } from '../sim/world/World';
import { type HuntHudState } from '../ui/hunt';
import { emptyFrame, type Frame } from '../render/viewFrame';
import type { HuntRun } from './hunt';

const OWN_CLOTHES = itemNumber('own_clothes');
const GUARD_OUTFIT = itemNumber('guard_outfit');
export const INMATE_OUTFIT = itemNumber('inmate_outfit');
const BATON = itemNumber('baton');
/** Off the map: a searcher not out yet stands here, out of the picture. */
const AWAY = -30;

export type Action = { kind: 'line' } | { kind: 'cut' } | { kind: 'treat'; dog: number; what: number };

/** What the action button would do now (null: nothing). */
export function actionOf(h: Hunt): Action | null {
  const s = h.state;
  if (h.lineNear() >= 0) return { kind: 'line' };
  if (h.wireAhead() >= 0 && s.cutters) return { kind: 'cut' };
  const dog = h.dogInReach();
  if (dog >= 0 && s.dogs[dog].mode !== HOUND.CALM && s.dogs[dog].mode !== HOUND.DAZED) {
    // The best treat they have: sleepy jerky, pepper, jerky.
    for (const what of [2, 1, 0]) if (s.treats[what] > 0) return { kind: 'treat', dog, what };
  }
  return null;
}

const searchersPool: Array<{ x: number; z: number }> = [];
const searchersAt: Array<{ x: number; z: number }> = [];
const hf: HuntFrame = { heli: { on: false, x: 0, z: 0, lit: false }, blocks: 0, lines: 0, lou: false, over: 0, me: { x: 0, z: 0 } };
export function huntFrameOf(run: HuntRun, a: number): HuntFrame {
  const s = run.hunt.state;
  hf.me.x = (run.prev.x + (s.player.x - run.prev.x) * a) / UNIT;
  hf.me.z = (run.prev.z + (s.player.z - run.prev.z) * a) / UNIT;
  hf.heli.on = s.heli.on;
  hf.heli.x = s.heli.x / UNIT;
  hf.heli.z = s.heli.z / UNIT;
  hf.heli.lit = s.heli.lit;
  hf.blocks = s.blocks;
  hf.lines = s.lines;
  hf.lou = run.carry.lou;
  hf.over = s.over === OVER.SAFE ? 1 : s.over === OVER.LOU ? 2 : 0;
  // (The searchers out, for their glow after dark: one not out yet has none.)
  let n = 0;
  s.searchers.forEach((m, k) => {
    if (m.mode === SEEK.OFF) return;
    const q = run.prevS[k] ?? m.body;
    const o = (searchersPool[n++] ??= { x: 0, z: 0 });
    o.x = (q.x + (m.body.x - q.x) * a) / UNIT;
    o.z = (q.z + (m.body.z - q.z) * a) / UNIT;
  });
  searchersAt.length = 0;
  for (let k = 0; k < n; k++) searchersAt.push(searchersPool[k]);
  hf.searchers = searchersAt;
  return hf;
}

/** The view's frame for the outside: everything the inside has, none of it there but the player, the searchers (as guards), their dogs, the trail, the lookout. */
// (Never dressed for a holiday: the outside's world has none.)
const frame: Frame = { ...emptyFrame(), wearRev: 0 };
const tapAt = { x: 0, z: 0 };
const scent: Array<[number, number]> = [];

export function frameOf(run: HuntRun, a: number, paused: boolean, guide: Array<{ x: number; z: number }> | null, away: boolean): Frame {
  const h = run.hunt;
  const s = h.state;
  const f = frame;
  const lerp = (from: number, to: number) => (from + (to - from) * a) / UNIT;
  const p = s.player;
  f.x = lerp(run.prev.x, p.x);
  f.z = lerp(run.prev.z, p.z);
  f.facing = headingAngle(p.facing);
  f.moving = p.moving && !paused;
  f.minuteOfDay = (run.carry.minute + s.step / STEPS_PER_SECOND) % 1440;
  f.surface = floorAt(h.out, h.tile);
  f.tilesRev = h.tilesRev;
  f.guide = run.lesson ? guide : null;
  f.outfit = s.clothes === 2 ? OWN_CLOTHES : s.clothes === 1 ? GUARD_OUTFIT : run.carry.outfit || INMATE_OUTFIT;
  // Hidden: crouched in the cover; at the wire: at work on it.
  f.doing = s.cutting.length ? DOING.PICK : s.hidden ? DOING.DICE : DOING.NOTHING;
  f.games.lock = s.cutting.length ? { x: centerX(s.cutting[0]) / UNIT, z: centerZ(s.cutting[0]) / UNIT } : null;
  // Away in the vehicle or Lou's car: out of the picture.
  f.delivery.stowed = away;
  // The lookout, on their rise, looking out over the map.
  if (run.lookout) {
    const lt = spotTile(h.def.lookout, h.out.ox, h.out.oz);
    const o = (f.inmates[0] ??= { x: 0, z: 0, facing: 0, moving: false, doing: 0, cell: 0, angry: false, badge: '' });
    o.x = (lt % MAP_W) + 0.5;
    o.z = Math.floor(lt / MAP_W) + 0.5;
    o.facing = headingAngle(h.def.lookout.face ?? 13);
    o.doing = DOING.LOOKOUT;
    o.cell = run.lookout.cell;
    f.inmates.length = 1;
  } else f.inmates.length = 0;
  // The searchers as guards (one not out yet stands off the map), their cones as far as they see now.
  f.guards.length = s.searchers.length;
  s.searchers.forEach((m, k) => {
    const o = (f.guards[k] ??= { x: 0, z: 0, facing: 0, moving: false, doing: 0, alert: 0, pace: 1, held: 0, hasKey: false, away: false, awayLeft: 0, stir: 0, range: 7 });
    const off = m.mode === SEEK.OFF;
    const q = run.prevS[k];
    o.x = off ? AWAY : lerp(q?.x ?? m.body.x, m.body.x);
    o.z = off ? AWAY : lerp(q?.z ?? m.body.z, m.body.z);
    o.facing = headingAngle(m.body.facing);
    o.moving = m.body.moving && !paused && !!q && (q.x !== m.body.x || q.z !== m.body.z);
    o.doing = DOING.NOTHING;
    o.alert = off ? ALERT.NONE : m.mode === SEEK.CHASE ? ALERT.HOSTILE : m.mode === SEEK.LOOK || m.mode === SEEK.FOLLOW || m.mode === SEEK.SWEEP || m.notice > 0 ? ALERT.SUSPICIOUS : ALERT.CALM;
    o.pace = ((m.mode === SEEK.CHASE ? HUNT.chase : m.mode === SEEK.LOOK || m.mode === SEEK.FOLLOW || m.mode === SEEK.SWEEP ? HUNT.hurry : HUNT.walk) * HUNT.pace) / 100 / WALK_SPEED;
    o.held = m.mode === SEEK.CHASE ? BATON : 0;
    o.hasKey = false;
    o.range = h.sight;
  });
  // Their dogs: at the heel, nose down on the trail, pointing, sitting calm, dazed, asleep.
  f.dogs.length = s.dogs.length;
  s.dogs.forEach((d, k) => {
    const o = (f.dogs[k] ??= { x: 0, z: 0, facing: 0, moving: false, pace: 1, pose: 'heel', friend: false });
    const off = s.searchers[d.handler].mode === SEEK.OFF;
    const q = run.prevD[k];
    o.x = off ? AWAY : lerp(q?.x ?? d.body.x, d.body.x);
    o.z = off ? AWAY : lerp(q?.z ?? d.body.z, d.body.z);
    o.facing = headingAngle(d.body.facing);
    o.moving = d.body.moving && !paused;
    o.pose = d.mode === HOUND.TRACK ? 'track' : d.mode === HOUND.POINT ? 'point' : d.mode === HOUND.ASLEEP ? 'asleep' : d.mode === HOUND.DAZED || d.mode === HOUND.CALM ? 'dazed' : 'heel';
    o.pace = q ? Math.hypot(d.body.x - q.x, d.body.z - q.z) / GUARD_SPEED : 1;
    o.friend = d.mode === HOUND.CALM;
  });
  // The trail, fresher the brighter (the dogs follow it).
  scent.length = s.trail.length;
  for (let k = 0; k < s.trail.length; k++) {
    const e = (scent[k] ??= [0, 0]);
    e[0] = s.trail[k][0];
    e[1] = Math.max(0, 1 - (s.step - s.trail[k][1]) / HUNT.trailSteps);
  }
  f.scent = scent;
  const dest = run.pilot.destination;
  if (dest >= 0) {
    tapAt.x = (dest % MAP_W) + 0.5;
    tapAt.z = Math.floor(dest / MAP_W) + 0.5;
  }
  f.tap = dest >= 0 ? tapAt : null;
  // In the helicopter's light: the scene pulses as a lockdown's does.
  f.alarm = s.heli.lit;
  return f;
}

const hudState: HuntHudState = { goal: 'bus', dist: 0, angle: 0, alarm: 0, dogs: false, roadblocks: false, heli: false, state: '', lookout: '', act: null, cut: 0, stone: -1 };

/** A hunt's safe tiles (open ground), listed once. */
const safeTiles = new WeakMap<Hunt, number[]>();
function safeTilesOf(h: Hunt): number[] {
  let list = safeTiles.get(h);
  if (!list) {
    list = [];
    for (let i = 0; i < h.out.safe.length; i++) if (h.out.safe[i] && !h.grid[i]) list.push(i);
    safeTiles.set(h, list);
  }
  return list;
}

export function hudOf(run: HuntRun): HuntHudState {
  const h = run.hunt;
  const s = h.state;
  const o = h.out;
  const st = hudState;
  // The nearest way out: Lou's car where he waits and it's nearer, else the nearest of the safe point's tiles (the arrow points at it, as the crow flies: the border's nearest stretch, not its post).
  const here = h.tile;
  const d2 = (t: number) => ((t % MAP_W) - (here % MAP_W)) ** 2 + (Math.floor(t / MAP_W) - Math.floor(here / MAP_W)) ** 2;
  let safe = -1;
  for (const t of safeTilesOf(h)) if (safe < 0 || d2(t) < d2(safe)) safe = t;
  const lou = run.carry.lou ? spotTile(o.def.lou, o.ox, o.oz) : -1;
  const toward = lou >= 0 && d2(lou) < d2(safe) ? lou : safe;
  st.goal = toward === lou ? 'lou' : o.def.safeKind;
  st.dist = Math.max(0, h.walkTo(here));
  st.angle = Math.atan2(centerX(toward) - s.player.x, -(centerZ(toward) - s.player.z));
  st.alarm = -h.alarmAge;
  const age = h.alarmAge;
  st.dogs = age >= 0 && s.dogs.some((d) => s.searchers[d.handler].mode !== SEEK.OFF);
  st.roadblocks = s.blocks !== 0;
  st.heli = s.heli.on;
  st.state = s.heli.lit ? 'lit' : s.searchers.some((m) => m.mode === SEEK.CHASE) ? 'chased' : s.dogs.some((d) => d.mode === HOUND.TRACK || d.mode === HOUND.POINT) ? 'tracked' : s.hidden ? 'hidden' : o.cover[here] ? 'cover' : '';
  st.lookout = run.lookout?.name ?? '';
  const a = run.ended ? null : actionOf(h);
  st.act = !a ? null : a.kind === 'line' ? { icon: 'shirt', verb: 'manhunt.act.clothes', what: '' } : a.kind === 'cut' ? { icon: 'cutters', verb: 'manhunt.act.cut', what: '' } : { icon: 'bone', verb: 'manhunt.act.treat', what: t(`manhunt.treat.${a.what}` as Key, { name: h.def.searchers[s.dogs[a.dog].handler]?.dog?.name ?? '' }) };
  st.cut = s.cutting.length ? s.cutting[1] / HUNT.cutSteps : 0;
  st.stone = run.ended ? -1 : Math.min(1, (s.step - s.stoneAt) / HUNT.stoneEvery);
  return st;
}
