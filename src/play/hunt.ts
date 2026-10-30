import { HUNT } from '../content/manhunt';
import { itemNumber } from '../content/items';
import { outsideOf } from '../content/outside';
import { prisonById } from '../content/prisons';
import { CENTER_PERKS } from '../content/prisons/center-perks';
import type { PrisonDef } from '../content/prisons/types';
import { readPrisoner } from '../game/prisoner';
import { t, type Key } from '../i18n';
import { HuntView } from '../render/Hunt';
import { Autopilot } from '../sim/ai/autopilot';
import { findPath, smooth } from '../sim/ai/path';
import { tileAt } from '../sim/world/grid';
import { command, EXT, OP, tossArgs } from '../sim/command';
import { Hunt, OVER, SEEK, type Carry, type HuntEvent, type HuntOptions } from '../sim/hunt/Hunt';
import { floorAt } from '../sim/hunt/world';
import { STEPS_PER_SECOND, UNIT } from '../sim/tuning';
import { MAP_W } from '../sim/world/World';
import type { Bubble } from '../talk/director';
import { HuntHud } from '../ui/hunt';
import { buzz } from '../app/haptics';
import { banner, click, combatUI, controls, hint, hooks, hud, itemsUI, settings, sound, tools, view, vignette } from './context';
import { play, playLater, tickPlayClock, type Game } from './game';
import { lessonHuntGoal, updateLesson } from './lesson';
import { barks, barksIn, hideBarks, say } from './huntBarks';
import { Bubbles } from '../ui/bubbles';
import { actionOf, frameOf, hudOf, huntFrameOf, INMATE_OUTFIT } from './huntFrame';

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
  /** Its result, from the moment it ended (the last moment plays out on screen before it's handed back; left in that moment, it's handed back as it was). */
  result?: HuntResult;
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
barksIn(new Bubbles());
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
const STONE = itemNumber('wall_chunk');
const TREAT_ITEMS = [itemNumber('jerky'), itemNumber('pepper'), itemNumber('sleepy_jerky')];

/** Where a prison is, by id (the Training Block has no outside: its lessons are Center Perks'). */
const prisonOf = (id: string): PrisonDef => prisonById(id) ?? CENTER_PERKS;

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
    huntPath = null;
    guideFrom = -1;
    // The outside on screen: its world, the player as they look, the searchers cast as guards, the lookout.
    view.setWorld(hunt.world, null);
    view.setPrisoner(readPrisoner());
    view.snapTo(s.player.x / UNIT, s.player.z / UNIT, settings.reducedMotion ? 1 : 0.8);
    view.zoomTo(1.1);
    view.setCast(run.lookout ? [{ cell: run.lookout.cell, gait: 1 }] : 0);
    view.setGuards(s.searchers.map(() => undefined), []);
    huntView.set(hunt.out, carry.lou, carry.kind);
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
  void runHunt(g, carry, { searchers: spec.searchers, heli: false, roadblocks: false, ramp: false, lesson: true });
}

/** The hunt comes down (its end, the title, a lesson left): its HUD, its pieces, its barks. A hunt still under way resolves as left. */
export function stopHunt(g: Game | null) {
  const run = g?.hunt;
  if (!g || !run) return;
  g.hunt = null;
  huntHud.show(false);
  huntView.clear();
  hideBarks();
  sound.siren(false);
  document.body.classList.remove('hunting');
  if (!run.ended) {
    run.ended = true;
    run.resolve('quit');
  } else if (run.result) {
    // (Left while its last moment played: safe or caught all the same.)
    const r = run.result;
    run.result = undefined;
    run.resolve(r);
  }
}

// ------------------------------------------------------------------ the player's input
/** The action button / E: clothes off a washing line, a cut at the wire, a treat for a dog in reach. */
function huntAct() {
  const run = play.game?.hunt;
  if (!run || run.ended || play.game!.paused) return;
  const a = actionOf(run.hunt);
  if (!a) {
    // (At the wire with nothing to cut it: say so, rather than nothing.)
    if (run.hunt.wireAhead() >= 0) banner.toast(t('manhunt.no.noCutters'), 'info', 2400);
    return;
  }
  run.pilot.stop();
  if (a.kind === 'treat') run.ops.push([OP.EXT, EXT.HUNT_TREAT, a.dog, a.what]);
  else run.ops.push([OP.INTERACT, 0, 0, 0]);
}

/** The stone button / Space: thrown ahead to draw them off. */
function huntStone() {
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
  // (Paused, the outside's moments hold still too: a vehicle pulling away, the arrival's.)
  huntView.update(huntFrameOf(run, a), g.paused ? 0 : dt, now / 1000, night, !settings.reducedMotion);
  view.draw(frameOf(run, a, g.paused, huntPath, huntView.away), dt, now / 1000);
  huntHud.update(hudOf(run));
  // (Nothing of the inside's tips out here.)
  if (hint.visible) hint.hide();
  barks(run, g.paused || g.speed > 1);
  // (A lesson in the manhunt: its steps follow the hunt, and the floor arrows lead where a step wants the player.)
  if (g.lesson) {
    updateLesson(g, dt, false);
    huntGuide(g, run, dt);
  }
  if (s.over && !run.ended) endHunt(g, run);
}

/** A lesson's floor arrows outside (P41): the way to what its step wants (the thicket, the line, Lou's car), worked out again every so often. */
let guideAge = 0;
let guideFrom = -1;
let huntPath: Array<{ x: number; z: number }> | null = null;
function huntGuide(g: Game, run: HuntRun, dt: number) {
  const h = run.hunt;
  const from = h.tile;
  guideAge += dt;
  if (guideAge < 0.35 && from === guideFrom) return;
  guideAge = 0;
  guideFrom = from;
  const goal = run.ended ? null : lessonHuntGoal(g);
  const path = goal && findPath(h.world, from, goal, -1, 4000, undefined, h.grid);
  huntPath = path && path.length ? smooth(h.world, path, h.state.player.x, h.state.player.z, undefined, h.grid).map((i) => ({ x: (i % MAP_W) + 0.5, z: Math.floor(i / MAP_W) + 0.5 })) : null;
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
    case 'widen':
      // (Once: the search widening, dogs through the hedges.)
      if (e.heat === 1) banner.toast(t('manhunt.widen'), 'bad', 3500);
      // (And when the uniform stops fooling them.)
      if (e.heat === HUNT.uniformHeat && h.state.clothes === 1) banner.toast(t('manhunt.uniformKnown'), 'bad', 3500);
      else if (e.heat === HUNT.uniformHeat + 1 && h.state.clothes === 2) banner.toast(t('manhunt.clothesKnown'), 'bad', 3500);
      break;
    case 'spotted':
      sound.whistle();
      buzz('missed');
      say(run, e.who, 'gu.hunt.spotted', 'shout');
      break;
    case 'lost':
      say(run, e.who, 'gu.hunt.lost', 'say');
      // (Only when nobody's after them any more, and never in the helicopter's light.)
      if (!h.state.heli.lit && !h.state.searchers.some((m) => m.mode === SEEK.CHASE)) banner.toast(t('manhunt.lost'), 'good', 2600);
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
      banner.toast(t(e.uniform ? 'manhunt.swappedUniform' : 'manhunt.swapped'), 'good', 3600);
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
  run.result = result;
  playLater(safe ? 2600 : 2000, () => {
    if (g.hunt !== run || !run.result) return;
    run.result = undefined;
    huntHud.show(false);
    hideBarks();
    // (The outside stays on screen, still, under the card.)
    g.paused = true;
    run.resolve(result);
  });
}
