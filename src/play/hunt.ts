import { HUNT } from '../content/manhunt';
import { itemNumber } from '../content/items';
import { outsideOf } from '../content/outside';
import { PRISONS } from '../content/prisons';
import { CENTER_PERKS } from '../content/prisons/center-perks';
import type { PrisonDef } from '../content/prisons/types';
import { readPrisoner } from '../game/prisoner';
import { currentLang, t, type Key } from '../i18n';
import { enBarks, type BankId } from '../i18n/barks/en';
import { frBarks } from '../i18n/barks/fr';
import { HuntView, type HuntFrame } from '../render/Hunt';
import type { Frame } from '../render/View';
import { Autopilot } from '../sim/ai/autopilot';
import { centerX, centerZ, tileAt } from '../sim/ai/path';
import { command, DIR_X, DIR_Z, EXT, OP, tossArgs } from '../sim/command';
import { HFEAT, HOUND, Hunt, OVER, SEEK, type Carry, type HuntEvent, type HuntOptions } from '../sim/hunt/Hunt';
import { floorAt, spotTile } from '../sim/hunt/world';
import { ALERT, GUARD_SPEED } from '../sim/systems/guards';
import { DOING } from '../sim/systems/inmates';
import { STEPS_PER_SECOND, UNIT, WALK_SPEED } from '../sim/tuning';
import { LAYER, MAP_W } from '../sim/world/World';
import type { Bubble } from '../talk/director';
import { typo } from '../talk/fill';
import { BUBBLE_HEIGHT, Bubbles } from '../ui/bubbles';
import { HuntHud, type HuntHudState } from '../ui/hunt';
import { buzz } from '../app/haptics';
import { banner, click, combatUI, controls, hint, hooks, hud, itemsUI, settings, sound, tools, view, vignette } from './context';
import { play, playLater, tickPlayClock, type Game } from './game';
import { updateLesson } from './lesson';

/**
 * The manhunt in play (P41): its own simulation (sim/hunt/) stepped at the inside's pace from
 * the same controls (the stick, the keys, a tap to walk), drawn by the same view on the
 * outside's world (the searchers cast as guards with their dogs, the lookout as an inmate,
 * render/Hunt.ts the rest), its own HUD, sounds, toasts and the searchers' barks. The inside
 * run is over and kept as it ended: nothing here touches it.
 */

/** How a hunt ended (or 'quit': left from the pause card). */
export type HuntResult =
  | {
      over: number;
      /** How close they got (0–1), seconds out there, the hunt's counts. */
      progress: number;
      secs: number;
      feats: number[];
      /** Where they got to: the safe point's kind or Lou's car. */
      goal: string;
    }
  | 'quit';

export interface HuntRun {
  hunt: Hunt;
  carry: Carry;
  /** Where everyone was before the last step (the view eases between the two). */
  prev: { x: number; z: number };
  prevS: Array<{ x: number; z: number }>;
  prevD: Array<{ x: number; z: number }>;
  pilot: Autopilot;
  ops: Array<[number, number, number, number]>;
  ended: boolean;
  resolve: (r: HuntResult) => void;
  /** The crew member keeping watch (their name, and their cell for their looks), if one got out too. */
  lookout: { name: string; cell: number } | null;
  /** A lesson's hunt: its end is the lesson's, not the escape card's. */
  lesson: boolean;
  /** The barks over heads now, and who said what last (never the same line twice running). */
  said: Bubble[];
  sirenUntil: number;
}

const huntView = new HuntView();
view.scene.add(huntView.group);
const huntHud = new HuntHud();
const huntBubbles = new Bubbles();
huntHud.onPause = () => hooks.pause();
huntHud.onAct = () => {
  click();
  huntAct();
};
huntHud.onStone = () => {
  click();
  huntStone();
};

const NO_OP: [number, number, number, number] = [0, 0, 0, 0];
const OWN_CLOTHES = itemNumber('own_clothes');
const GUARD_OUTFIT = itemNumber('guard_outfit');
const INMATE_OUTFIT = itemNumber('inmate_outfit');
const BATON = itemNumber('baton');
const STONE = itemNumber('wall_chunk');
const TREAT_ITEMS = [itemNumber('jerky'), itemNumber('pepper'), itemNumber('sleepy_jerky')];
/** Off the map: a searcher not out yet stands here, out of the picture. */
const AWAY = -30;

/** Where a prison is, by id (the Training Block has no outside: its lessons are Center Perks'). */
const prisonOf = (id: string): PrisonDef => PRISONS.find((p) => p.id === id) ?? CENTER_PERKS;

/** Whether a prison has an outside to run in. */
export const hasOutside = (prison: string) => !!outsideOf(prison);

/**
 * Into the manhunt: the outside on screen, the player where their way out left them, the HUD
 * and the controls the hunt's. Resolves once it's over (safe, caught) and its last moment has
 * played, or 'quit' if left from the pause card.
 */
export function runHunt(g: Game, carry: Carry, opts: HuntOptions & { lookout?: { name: string; cell: number } | null; lesson?: boolean } = {}): Promise<HuntResult> {
  const def = outsideOf(carry.prison)!;
  const hunt = new Hunt(def, prisonOf(carry.prison), carry, opts);
  const s = hunt.state;
  return new Promise((resolve) => {
    const run: HuntRun = {
      hunt,
      carry,
      prev: { x: s.player.x, z: s.player.z },
      prevS: s.searchers.map((m) => ({ x: m.body.x, z: m.body.z })),
      prevD: s.dogs.map((d) => ({ x: d.body.x, z: d.body.z })),
      pilot: new Autopilot(hunt.world, () => hunt.grid),
      ops: [],
      ended: false,
      resolve,
      lookout: carry.crew > 0 ? (opts.lookout ?? null) : null,
      lesson: !!opts.lesson,
      said: [],
      sirenUntil: 0,
    };
    g.hunt = run;
    // The outside on screen: its world, the player as they look, the searchers cast as guards, the lookout.
    view.setWorld(hunt.world, null);
    view.setPrisoner(readPrisoner());
    view.snapTo(s.player.x / UNIT, s.player.z / UNIT, settings.reducedMotion ? 1 : 0.8);
    view.zoomTo(1.1);
    view.setCast(run.lookout ? [{ cell: run.lookout.cell, gait: 1 }] : 0);
    view.setGuards(s.searchers.map(() => undefined), []);
    huntView.set(hunt.out, carry.lou);
    // The inside's HUD and buttons down, the hunt's up (a lesson's card stays: it lives in the HUD, whose rows the stylesheet hides).
    if (!run.lesson) hud.show(false);
    itemsUI.show(false);
    tools.show(false);
    combatUI.show(false);
    huntHud.show(true);
    // (Nothing of the inside's left on screen: a hint, the alarm's red edges.)
    hint.hide();
    vignette.classList.remove('on');
    document.body.classList.add('hunting');
    controls.reset();
    controls.enabled = true;
    g.paused = false;
    g.speed = 1;
    play.acc = 0;
    play.last = performance.now();
    sound.siren(false);
    sound.music('tension');
    sound.ambience(true);
    sound.setCoast(hunt.prison.theme === 'island');
    sound.setScene(hunt.night ? 'outdoorNight' : 'outdoorDay');
    if (!run.lesson) {
      const goal = t(`manhunt.goal.${def.safeKind}` as Key);
      banner.show(t('manhunt.title'), s.alarmAt > 0 ? t('manhunt.intro', { goal }) : t('manhunt.introSeen', { goal }), s.alarmAt > 0 ? 'routine' : 'alarm', 4800);
      if (carry.lou) playLater(5200, () => g.hunt === run && banner.toast(t('manhunt.louWaits'), 'good', 4000));
    }
  });
}

/** A lesson played in the manhunt (P41): straight outside, as the lesson sets it (a run in the jumpsuit, nothing in the pockets). */
export function lessonHunt(g: Game, spec: { kind: Carry['kind']; searchers: readonly number[]; headStart: number; minute: number; lou: boolean }) {
  const carry: Carry = { prison: CENTER_PERKS.id, via: 'fence', kind: spec.kind, spd: 40, outfit: INMATE_OUTFIT, kit: [], crew: 0, lou: spec.lou, headStart: spec.headStart, minute: spec.minute, salt: 41 };
  void runHunt(g, carry, { searchers: spec.searchers, heli: false, roadblocks: false, lesson: true });
}

/** The hunt comes down (its end, the title, a lesson left): its HUD, its pieces, its barks. A hunt still under way resolves as left. */
export function stopHunt(g: Game | null) {
  const run = g?.hunt;
  if (!g || !run) return;
  g.hunt = null;
  huntHud.show(false);
  huntView.clear();
  huntBubbles.hide();
  sound.siren(false);
  document.body.classList.remove('hunting');
  if (!run.ended) {
    run.ended = true;
    run.resolve('quit');
  }
}

// ------------------------------------------------------------------ the player's input
/** The action button / E: clothes off a washing line, a cut at the wire, a treat for a dog in reach. */
export function huntAct() {
  const run = play.game?.hunt;
  if (!run || run.ended || play.game!.paused) return;
  const a = actionOf(run.hunt);
  if (!a) return;
  run.pilot.stop();
  if (a.kind === 'treat') run.ops.push([OP.EXT, EXT.HUNT_TREAT, a.dog, a.what]);
  else run.ops.push([OP.INTERACT, 0, 0, 0]);
}

/** The stone button / Space: thrown ahead to draw them off. */
export function huntStone() {
  const run = play.game?.hunt;
  if (!run || run.ended || play.game!.paused) return;
  const h = run.hunt;
  const t0 = h.stoneTarget();
  if (t0 < 0 || h.state.step - h.state.stoneAt < HUNT.stoneEvery) {
    banner.toast(t(t0 < 0 ? 'manhunt.no.stoneFar' : 'manhunt.no.stoneSoon'), 'info', 2200);
    return;
  }
  const [b, c] = tossArgs(t0);
  run.ops.push([OP.EXT, EXT.HUNT_THROW, b, c]);
}

/** Keys in a hunt: Escape pauses, E acts, Space throws a stone, H the help (the moves are Controls'). */
export function huntKey(e: KeyboardEvent): boolean {
  const g = play.game;
  if (!g?.hunt) return false;
  if (e.code === 'KeyE' || e.code === 'Enter') huntAct();
  else if (e.code === 'Space' || e.code === 'KeyF') {
    e.preventDefault();
    huntStone();
  } else return false;
  return true;
}

/** A tap on the ground: walk there (the hunt's grid). */
export function huntTap(cx: number, cy: number) {
  const run = play.game?.hunt;
  if (!run || run.ended || play.game!.paused) return;
  const p = view.groundAt(cx, cy);
  if (!p) return;
  const h = run.hunt;
  const tx = Math.floor(p.x);
  const tz = Math.floor(p.z);
  let best = -1;
  let bestD = Infinity;
  for (let dz = -1; dz <= 1; dz++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const z = tz + dz;
      if (!h.world.inside(x, z) || h.grid[z * MAP_W + x]) continue;
      const d = (x + 0.5 - p.x) ** 2 + (z + 0.5 - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = z * MAP_W + x;
      }
    }
  if (best >= 0) run.pilot.goTo(best);
}

type Action = { kind: 'line' } | { kind: 'cut' } | { kind: 'treat'; dog: number; what: number };

/** What the action button would do now (null: nothing). */
function actionOf(h: Hunt): Action | null {
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

// ------------------------------------------------------------------ every frame
/** One animation frame of a hunt: the steps for the time that passed, the picture, the HUD, the barks. */
export function huntFrame(g: Game, dt: number, now: number) {
  const run = g.hunt!;
  const h = run.hunt;
  const s = h.state;
  if (!g.paused) {
    tickPlayClock(dt * 1000);
    play.acc += dt * g.speed;
    let steps = 0;
    while (play.acc >= 1 / STEPS_PER_SECOND && steps++ < 40 * g.speed) {
      play.acc -= 1 / STEPS_PER_SECOND;
      run.prev.x = s.player.x;
      run.prev.z = s.player.z;
      s.searchers.forEach((m, k) => {
        const q = (run.prevS[k] ??= { x: 0, z: 0 });
        q.x = m.body.x;
        q.z = m.body.z;
      });
      s.dogs.forEach((d, k) => {
        const q = (run.prevD[k] ??= { x: 0, z: 0 });
        q.x = d.body.x;
        q.z = d.body.z;
      });
      if (controls.steering || run.ended) run.pilot.stop();
      const op = run.ended ? NO_OP : (run.ops.shift() ?? NO_OP);
      const dir = run.ended ? 0 : controls.steering ? controls.dir() : run.pilot.dir(s.player);
      h.step(command(dir, op[0], op[1], op[2], op[3]));
      for (const e of h.events) huntEvent(e, run);
    }
    if (play.acc > 1) play.acc = 0;
  }
  const a = g.paused ? 1 : play.acc * STEPS_PER_SECOND;
  const night = h.night ? 1 : 0;
  huntView.update(huntFrameOf(run), dt, now / 1000, night, !settings.reducedMotion);
  view.draw(frameOf(run, a, g.paused), dt, now / 1000);
  huntHud.update(hudOf(run));
  // (Nothing of the inside's tips out here.)
  if (hint.visible) hint.hide();
  barks(run, g.paused || g.speed > 1);
  // (A lesson in the manhunt: its steps follow the hunt.)
  if (g.lesson) updateLesson(g, dt, false);
  if (s.over && !run.ended) endHunt(g, run);
}

const hf: HuntFrame = { heli: { on: false, x: 0, z: 0, lit: false }, blocks: 0, lines: 0, lou: false, over: 0 };
function huntFrameOf(run: HuntRun): HuntFrame {
  const s = run.hunt.state;
  hf.heli.on = s.heli.on;
  hf.heli.x = s.heli.x / UNIT;
  hf.heli.z = s.heli.z / UNIT;
  hf.heli.lit = s.heli.lit;
  hf.blocks = s.blocks;
  hf.lines = s.lines;
  hf.lou = run.carry.lou;
  hf.over = s.over === OVER.SAFE ? 1 : s.over === OVER.LOU ? 2 : 0;
  return hf;
}

/** The view's frame for the outside: everything the inside has, none of it there but the player, the searchers (as guards), their dogs, the trail, the lookout. */
const frame: Frame = {
  x: 0,
  z: 0,
  facing: 0,
  moving: false,
  minuteOfDay: 0,
  rollCall: false,
  surface: 0,
  inmates: [],
  guide: null,
  tap: null,
  alarm: false,
  ground: [],
  groundRev: -1,
  focus: null,
  held: 0,
  outfit: 0,
  sleeping: false,
  knockedOut: false,
  guards: [],
  layer: LAYER.GROUND,
  tilesRev: -1,
  wearRev: 0,
  deskAside: false,
  wear: {},
  lock: -1,
  lockHostile: false,
  lockFar: false,
  doing: 0,
  trainAt: null,
  restBed: null,
  reps: 0,
  puddles: [],
  planters: new Map(),
  puddlesRev: 0,
  craters: [],
  security: { power: true, fence: true, arches: true, gens: [true, true], cams: [], beams: null, aim: -1, px: 0, pz: 0, hook: null },
  takeover: false,
  fuses: [],
  weather: { rain: 0, fog: 0, heat: false, windAngle: 0, windForce: 0, snow: false },
  events: { movie: false, foodFight: false, inspection: false },
  delivery: { t: -1, at: 0, search: 0, until: 0, stowed: false },
  dogs: [],
  scent: [],
  rats: [],
  smuggle: null,
  games: { bout: null, dice: null, taps: 0, sports: false, lock: null },
  pastimes: { spot: -1, ball: null, holding: null, cards: null, board: null },
  long: null,
  team: { pitch: null, theme: '', ball: null, mates: [], rivals: [] },
  nights: { stage: null, quiz: null, backed: false, stageUp: false, quizUp: false, lights: [0, 0, 0, 0] },
  phone: { offHook: false, car: false },
  kiosk: { on: false, photos: [] },
  release: { called: false, freed: false },
  inked: [],
  getaway: { shift: false, waved: false, glide: null },
};
const tapAt = { x: 0, z: 0 };
const scent: Array<[number, number]> = [];

function frameOf(run: HuntRun, a: number, paused: boolean): Frame {
  const h = run.hunt;
  const s = h.state;
  const f = frame;
  const lerp = (from: number, to: number) => (from + (to - from) * a) / UNIT;
  const p = s.player;
  f.x = lerp(run.prev.x, p.x);
  f.z = lerp(run.prev.z, p.z);
  f.facing = Math.atan2(DIR_X[p.facing], DIR_Z[p.facing]);
  f.moving = p.moving && !paused;
  f.minuteOfDay = (run.carry.minute + s.step / STEPS_PER_SECOND) % 1440;
  f.surface = floorAt(h.out, h.tile);
  f.tilesRev = h.tilesRev;
  f.outfit = s.clothes === 2 ? OWN_CLOTHES : s.clothes === 1 ? GUARD_OUTFIT : run.carry.outfit || INMATE_OUTFIT;
  // Hidden: crouched in the cover; at the wire: at work on it.
  f.doing = s.cutting.length ? DOING.PICK : s.hidden ? DOING.DICE : DOING.NOTHING;
  f.games.lock = s.cutting.length ? { x: centerX(s.cutting[0]) / UNIT, z: centerZ(s.cutting[0]) / UNIT } : null;
  // Away in the vehicle or Lou's car: out of the picture.
  f.delivery.stowed = huntView.away;
  // The lookout, on their rise, looking out over the map.
  if (run.lookout) {
    const lt = spotTile(h.def.lookout, h.out.ox, h.out.oz);
    const o = (f.inmates[0] ??= { x: 0, z: 0, facing: 0, moving: false, doing: 0, cell: 0, angry: false, badge: '' });
    o.x = (lt % MAP_W) + 0.5;
    o.z = Math.floor(lt / MAP_W) + 0.5;
    o.facing = Math.atan2(DIR_X[h.def.lookout.face ?? 13], DIR_Z[h.def.lookout.face ?? 13]);
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
    o.facing = Math.atan2(DIR_X[m.body.facing], DIR_Z[m.body.facing]);
    o.moving = m.body.moving && !paused && !!q && (q.x !== m.body.x || q.z !== m.body.z);
    o.doing = DOING.NOTHING;
    o.alert = off ? ALERT.NONE : m.mode === SEEK.CHASE ? ALERT.HOSTILE : m.mode === SEEK.LOOK || m.mode === SEEK.FOLLOW || m.notice > 0 ? ALERT.SUSPICIOUS : ALERT.CALM;
    o.pace = m.mode === SEEK.CHASE ? HUNT.chase / WALK_SPEED : m.mode === SEEK.LOOK || m.mode === SEEK.FOLLOW ? HUNT.hurry / WALK_SPEED : HUNT.walk / WALK_SPEED;
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
    o.facing = Math.atan2(DIR_X[d.body.facing], DIR_Z[d.body.facing]);
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

function hudOf(run: HuntRun): HuntHudState {
  const h = run.hunt;
  const s = h.state;
  const o = h.out;
  const st = hudState;
  // The nearest way out: Lou's car where he waits and it's nearer, else the safe point (the arrow points at it, as the crow flies).
  const here = h.tile;
  const safe = o.def.safeKind === 'border' ? spotTile(o.def.safeAt, o.ox, o.oz) : spotTile({ x: Math.floor((o.def.safe[0] + o.def.safe[2]) / 2), z: Math.floor((o.def.safe[1] + o.def.safe[3]) / 2) }, o.ox, o.oz);
  const lou = run.carry.lou ? spotTile(o.def.lou, o.ox, o.oz) : -1;
  const d2 = (t: number) => ((t % MAP_W) - (here % MAP_W)) ** 2 + (Math.floor(t / MAP_W) - Math.floor(here / MAP_W)) ** 2;
  const toward = lou >= 0 && d2(lou) < d2(safe) ? lou : safe;
  st.goal = toward === lou ? 'lou' : o.def.safeKind;
  st.dist = Math.max(0, h.toGoal[here]);
  st.angle = Math.atan2(centerX(toward) - s.player.x, -(centerZ(toward) - s.player.z));
  st.alarm = -h.alarmAge;
  const age = h.alarmAge;
  st.dogs = age >= 0 && s.dogs.some((d) => s.searchers[d.handler].mode !== SEEK.OFF);
  st.roadblocks = s.blocks !== 0;
  st.heli = s.heli.on;
  st.state = s.heli.lit ? 'lit' : s.searchers.some((m) => m.mode === SEEK.CHASE) ? 'chased' : s.hidden ? 'hidden' : o.cover[here] ? 'cover' : '';
  st.lookout = run.lookout?.name ?? '';
  const a = run.ended ? null : actionOf(h);
  st.act = !a ? null : a.kind === 'line' ? { icon: 'shirt', verb: 'manhunt.act.clothes', what: '' } : a.kind === 'cut' ? { icon: 'cutters', verb: 'manhunt.act.cut', what: '' } : { icon: 'bone', verb: 'manhunt.act.treat', what: t(`manhunt.treat.${a.what}` as Key, { name: h.def.searchers[s.dogs[a.dog].handler]?.dog?.name ?? '' }) };
  st.cut = s.cutting.length ? s.cutting[1] / HUNT.cutSteps : 0;
  st.stone = run.ended ? -1 : Math.min(1, (s.step - s.stoneAt) / HUNT.stoneEvery);
  return st;
}

// ------------------------------------------------------------------ what happened
function huntEvent(e: HuntEvent, run: HuntRun) {
  const h = run.hunt;
  switch (e.type) {
    case 'alarm':
      sound.siren(true);
      run.sirenUntil = h.state.step + 5 * STEPS_PER_SECOND;
      banner.show(t('manhunt.alarm'), t('manhunt.alarmSub'), 'alarm');
      buzz('lockdown');
      break;
    case 'roadblock':
      banner.toast(t('manhunt.roadblock'), 'bad', 3000);
      break;
    case 'heli':
      sound.rotor();
      banner.toast(t('manhunt.heli'), 'bad', 3500);
      break;
    case 'spotted':
      sound.whistle();
      buzz('missed');
      say(run, e.who, 'gu.hunt.spotted', 'shout');
      break;
    case 'lost':
      say(run, e.who, 'gu.hunt.lost', 'say');
      banner.toast(t('manhunt.lost'), 'good', 2600);
      break;
    case 'heard':
      if (Math.random() < 0.5) say(run, e.who, 'gu.hunt.heard', 'say');
      break;
    case 'noise': {
      const heard = h.events.some((x) => x.type === 'heard' && x.tile === e.tile);
      view.noise(e.kind === 'bark' ? 'bark' : e.kind === 'cut' ? 'strike' : 'thud', e.tile, e.reach, [], heard);
      if (e.kind === 'crunch' && Math.random() < 0.4) sound.step(floorAt(h.out, e.tile));
      if (e.kind === 'stone') sound.clatter(1, 0.8);
      break;
    }
    case 'track':
      sound.bark(0.6, 1.1);
      break;
    case 'point': {
      sound.bark(1, 1);
      const d = h.state.dogs[e.dog];
      if (d) say(run, d.handler, 'gu.hunt.dog', 'shout');
      break;
    }
    case 'lit':
      if (e.on) {
        sound.rotor();
        banner.toast(t('manhunt.litToast'), 'bad', 2400);
      }
      break;
    case 'hidden':
      if (e.on) sound.cover();
      break;
    case 'swap':
      sound.pickup();
      banner.toast(t('manhunt.swapped'), 'good', 3600);
      break;
    case 'cut':
      sound.strike('cut', e.done);
      if (e.done) banner.toast(t('manhunt.cut'), 'good', 2200);
      break;
    case 'treat':
      sound.munch(e.what === 0);
      if (e.what === 1) sound.sneeze(1);
      view.toss(TREAT_ITEMS[e.what], tileAt(h.state.dogs[e.dog].body.x, h.state.dogs[e.dog].body.z));
      banner.toast(t(`manhunt.treated.${e.what}` as Key), 'good', 2600);
      break;
    case 'stone':
      view.toss(STONE, e.tile);
      break;
    case 'whistle':
      sound.lookout();
      if (run.lookout) banner.toast(t('manhunt.whistle', { name: run.lookout.name }), 'info', 2400);
      break;
    case 'refused':
      banner.toast(t(`manhunt.no.${e.why}` as Key), 'info', 2400);
      break;
    case 'out':
      if (h.alarmAge >= 0 && Math.random() < 0.35) say(run, e.who, 'gu.hunt.out', 'say');
      break;
    case 'safe':
      sound.chime();
      buzz('attended');
      break;
    case 'caught':
      sound.sting();
      buzz('missed');
      say(run, e.by, 'gu.hunt.caught', 'shout');
      break;
  }
  if (run.sirenUntil && h.state.step >= run.sirenUntil) {
    run.sirenUntil = 0;
    sound.siren(false);
  }
}

/** The end: a breath on screen (the vehicle pulling away, or the hand on the shoulder), then back to the card. */
function endHunt(g: Game, run: HuntRun) {
  run.ended = true;
  run.pilot.stop();
  controls.enabled = false;
  controls.reset();
  const h = run.hunt;
  const s = h.state;
  const safe = s.over !== OVER.CAUGHT;
  if (safe) {
    sound.engine();
    sound.music('title');
    banner.show(t(s.over === OVER.LOU ? 'manhunt.awayLou' : 'manhunt.away'), t(`manhunt.awaySub.${s.over === OVER.LOU ? 'lou' : h.def.safeKind}` as Key), 'routine', 3000);
  } else {
    sound.siren(false);
    sound.music('title');
    banner.show(t('manhunt.caught'), t('manhunt.caughtSub', { n: Math.round(h.progress * 100) }), 'alarm', 3000);
  }
  const result: HuntResult = { over: s.over, progress: h.progress, secs: Math.round(s.step / STEPS_PER_SECOND), feats: [...s.feats], goal: s.over === OVER.LOU ? 'lou' : h.def.safeKind };
  // (A lesson ends as its steps say: the hunt stays on screen under its card.)
  if (run.lesson) return run.resolve(result);
  playLater(safe ? 2600 : 2000, () => {
    if (g.hunt !== run) return;
    huntHud.show(false);
    huntBubbles.hide();
    run.resolve(result);
  });
}

// ------------------------------------------------------------------ barks
const last = new Map<string, number>();
/** A searcher says something (a line of the bank not said just before). */
function say(run: HuntRun, who: number, bank: BankId, style: 'say' | 'shout') {
  if (settings.chatter === 'off' || who < 0) return;
  if (settings.chatter === 'some' && style === 'say' && Math.random() < 0.5) return;
  const lang = currentLang();
  const lines = (lang === 'fr' ? frBarks : enBarks)[bank] ?? enBarks[bank];
  if (!lines?.length) return;
  let k = Math.floor(Math.random() * lines.length);
  if (k === last.get(bank) && lines.length > 1) k = (k + 1) % lines.length;
  last.set(bank, k);
  const l = lines[k];
  const text = typo(lang, typeof l === 'string' ? l : l.t);
  const now = performance.now() / 1000;
  // One bubble a speaker: a new line replaces theirs.
  const speaker = (run.lookout ? 1 : 0) + who;
  run.said = run.said.filter((b) => b.speaker !== speaker);
  run.said.push({ speaker, guard: true, text, style, start: now, until: now + (style === 'shout' ? 2.6 : 3.2), pitch: 130 + (who % 5) * 14, line: k, bank, reaction: true });
}

const head = (id: number, out: { x: number; y: number }, height: number) => view.screenOf(id, out, height);
function barks(run: HuntRun, quiet: boolean) {
  const now = performance.now() / 1000;
  run.said = run.said.filter((b) => b.until > now);
  if (quiet || settings.chatter === 'off') {
    huntBubbles.hide();
    return;
  }
  huntBubbles.update(run.said, head, false, !settings.reducedMotion);
}
let murmurAt = 0;
huntBubbles.onShow = (b) => {
  const now = performance.now() / 1000;
  if (!settings.voices || now - murmurAt < 0.4) return;
  murmurAt = now;
  sound.murmur(b.pitch, Math.min(6, 2 + Math.round(b.text.length / 18)), b.style === 'shout' ? 1.2 : 0.9);
  if (b.style === 'shout') huntBubbles.announce(b.text);
};
void BUBBLE_HEIGHT;
void HFEAT;
