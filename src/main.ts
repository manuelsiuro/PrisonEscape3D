import * as THREE from 'three';
import './styles/index.css';
import { PRISONS } from './content/prisons';
import type { PrisonDef } from './content/prisons/types';
import { ROUTINE } from './content/routine';
import { ZONES } from './content/zones';
import { Autopilot } from './sim/ai/autopilot';
import { findPath, smooth, tileAt } from './sim/ai/path';
import { isFloor, placesOf } from './sim/ai/places';
import { command, DIR_X, DIR_Z, OP, SLOT } from './sim/command';
import { Recorder } from './sim/Recorder';
import { Sim, type SimEvent } from './sim/Sim';
import { tileOfBody } from './sim/systems/movement';
import { STEPS_PER_MINUTE, STEPS_PER_SECOND, UNIT, WALK_SPEED } from './sim/tuning';
import { MAP_W } from './sim/world/World';
import { View, type Frame, type Quality } from './render/View';
import { Controls } from './input/Controls';
import { Sound } from './audio/Sound';
import { hasSeen, loadSettings, markSeen, saveSettings } from './game/settings';
import { migrateStorage } from './game/storage';
import { MOBILE, TOUCH, h } from './ui/dom';
import { Hud, routineName, routinePlace, type HudState } from './ui/hud';
import { Hint } from './ui/hint';
import { Banner } from './ui/banner';
import { ItemsUI, itemName } from './ui/items';
import { interactTarget, itemOf, type Target } from './sim/systems/items';
import { containersOf } from './sim/world/containers';
import { itemIcons } from './render/itemIcons';
import type { Key } from './i18n';
import { showTitle } from './ui/screens/title';
import { showPause } from './ui/screens/pause';
import { showSettings } from './ui/screens/settings';
import { registerServiceWorker } from './app/pwa';
import { buzz, setHaptics } from './app/haptics';
import { setLang, t } from './i18n';

/**
 * Wiring: storage first, then the long-lived objects, then the flows between screens.
 * Screens are functions that resolve with the player's choice, so each flow reads as a
 * script (title → play → pause → …). The simulation runs in fixed steps; the view
 * interpolates between the last two.
 */
migrateStorage();
const settings = loadSettings();
const sound = new Sound();
const click = () => sound.click();

// ------------------------------------------------------------------ graphics quality
/** Tiers from best to lightest; "auto" starts by device and steps down while frames run slow. */
const TIERS: Quality[] = [
  { shadows: 2048, pixelRatio: Math.min(devicePixelRatio, 2) },
  { shadows: 1024, pixelRatio: Math.min(devicePixelRatio, 1.5) },
  { shadows: 0, pixelRatio: 1 },
];
let tier = MOBILE ? 1 : 0;
const tierFor = () => (settings.quality === 'high' ? 0 : settings.quality === 'low' ? 2 : tier);

// The stencil buffer lets the player's silhouette show through walls (Character.ts).
const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
document.body.append(renderer.domElement);
const view = new View(renderer, TIERS[tierFor()]);
const controls = new Controls(renderer.domElement, (f) => view.zoomBy(f));

/** Applies every setting (on start and on each change in the settings screen). */
function applySettings() {
  setLang(settings.lang);
  setHaptics(settings.haptics);
  sound.setVolume(settings.muted ? 0 : settings.sfxVolume);
  view.reducedMotion = settings.reducedMotion;
  document.body.classList.toggle('reduced-motion', settings.reducedMotion);
  view.setQuality(TIERS[tierFor()]);
  saveSettings(settings);
}
applySettings();

/** Auto quality: if a few seconds of play average under 40 fps, step down one tier. */
const fps = { frames: 0, time: 0 };
function governQuality(dt: number) {
  if (settings.quality !== 'auto' || tier >= TIERS.length - 1) return;
  fps.frames++;
  fps.time += dt;
  if (fps.time < 4) return;
  const rate = fps.frames / fps.time;
  fps.frames = fps.time = 0;
  if (rate < 40) {
    tier++;
    view.setQuality(TIERS[tier]);
  }
}

// ------------------------------------------------------------------ the game
interface Game {
  rec: Recorder;
  /** The player's and inmates' positions before the last step (interpolation). */
  prev: { x: number; z: number };
  prevInmates: Array<{ x: number; z: number }>;
  paused: boolean;
  /** How far the player has walked (tiles), for the first-play hint. */
  walked: number;
  /** Tap-to-walk: steers the player with ordinary commands. */
  pilot: Autopilot;
  /** The floor arrows: the way to the routine's place, recomputed now and then. */
  guide: Array<{ x: number; z: number }> | null;
  guideAge: number;
  guideFrom: number;
  /** Dev builds: simulation speed (`]` toggles fast-forward). */
  speed: number;
  /** One-step operations waiting for the next steps (one per step), from the item UI and keys. */
  ops: Array<[number, number, number]>;
}
let game: Game | null = null;
let acc = 0;
let last = performance.now();

const hud = new Hud(() => pause());
const hint = new Hint();
const banner = new Banner();
const vignette = h('div', 'alarm-vignette');
document.body.append(vignette);
view.onStep = (surface) => sound.step(surface);

/** Tap or click a spot: walk there (the nearest free floor if the spot itself is taken). */
controls.onTap = (cx, cy) => {
  if (!game || game.paused) return;
  const p = view.groundAt(cx, cy);
  const w = game.rec.sim.world;
  if (!p) return;
  const tx = Math.floor(p.x);
  const tz = Math.floor(p.z);
  let best = -1;
  let bestD = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const z = tz + dz;
      if (!w.inside(x, z) || w.blocked(x, z)) continue;
      const d = (x + 0.5 - p.x) ** 2 + (z + 0.5 - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = z * MAP_W + x;
      }
    }
  }
  if (best < 0) return;
  game.pilot.goTo(best);
  sound.click();
  if (hint.visible) {
    hint.hide();
    markSeen('walk');
  }
};

/** Where the floor arrows lead now: the routine's place while the player hasn't checked in, the cell in a lockdown. */
function guideTarget(sim: Sim): ((i: number) => boolean) | null {
  const s = sim.state;
  const w = sim.world;
  const places = placesOf(w);
  const home = places.bedside[1];
  if (s.lockdown) return sim.playerZone === 'playerCell' ? null : (i) => i === home;
  const r = ROUTINE[s.routine];
  // Lights Out is about being in the cell, not having been there.
  if (r.id === 'lightsOut') return sim.playerZone === 'playerCell' ? null : (i) => i === home;
  if (!r.zones.length || s.attended) return null;
  if (r.id === 'rollCall' || r.id === 'eveningRollCall') {
    const spot = places.rollCall[0].tile;
    return (i) => i === spot;
  }
  return (i) => r.zones.includes(ZONES[w.ground.zone[i]]) && isFloor(w, i % MAP_W, Math.floor(i / MAP_W));
}

function updateGuide(g: Game, dt: number) {
  const sim = g.rec.sim;
  const p = sim.state.player;
  const from = tileAt(p.x, p.z);
  g.guideAge += dt;
  if (g.guideAge < 0.35 && from === g.guideFrom) return;
  g.guideAge = 0;
  g.guideFrom = from;
  const goal = guideTarget(sim);
  const path = goal && findPath(sim.world, from, goal, -1, 2600);
  g.guide = path && path.length ? smooth(sim.world, path, p.x, p.z).map((i) => ({ x: (i % MAP_W) + 0.5, z: Math.floor(i / MAP_W) + 0.5 })) : null;
}

function seenInteract() {
  if (hasSeen('interact')) return;
  markSeen('interact');
  hint.hide();
}

/** Sound, vibration, banners and toasts for what the simulation reports. */
function announce(e: SimEvent, sim: Sim) {
  switch (e.type) {
    case 'routine': {
      if (sim.state.lockdown) break;
      sound.bell();
      buzz('bell');
      const r = ROUTINE[e.routine];
      const sub = r.id === 'lightsOut' ? t('banner.lightsOut') : r.zones.length ? t('banner.goTo', { place: routinePlace(e.routine) }) : t('banner.free');
      banner.show(routineName(e.routine), sub);
      break;
    }
    case 'attended':
      if (ROUTINE[e.routine].id === 'lightsOut') break;
      sound.chime();
      buzz('attended');
      break;
    case 'missed':
      sound.sting();
      buzz('missed');
      if (e.heat < 100) banner.toast(t('toast.missed', { routine: routineName(e.routine), n: e.heat }), 'bad');
      break;
    case 'lockdown':
      // The siren and the red glow follow the state every frame (see frame()).
      if (e.on) {
        buzz('lockdown');
        const missed = sim.events.find((m) => m.type === 'missed' && m.heat >= 100);
        banner.show(t('banner.lockdown'), missed?.type === 'missed' ? t('banner.lockdownSub', { routine: routineName(missed.routine) }) : t('banner.lockdownHeat'), 'alarm', 5000);
      } else banner.toast(t('toast.lifted'), 'good');
      break;
    case 'pickup':
      seenInteract();
      sound.pickup();
      buzz('bell');
      break;
    case 'drop':
      sound.drop();
      break;
    case 'full':
      sound.sting();
      itemsUI.toast(t('items.full'));
      break;
    case 'open':
      seenInteract();
      sound.drawer();
      if (!hasSeen('items')) {
        markSeen('items');
        banner.toast(t('hint.items'), 'info', 5000);
      }
      break;
    case 'crafted':
      sound.craft();
      buzz('attended');
      itemsUI.toast(t('craft.made', { item: itemName(e.item) }));
      if (e.first) banner.toast(t('craft.newRecipe'), 'good');
      break;
    case 'sleep':
      sound.click();
      if (e.on) sleepVeil.querySelector('span')!.textContent = t('sleep.asleep');
      break;
    case 'cells':
      if (e.locked) sound.lockClank();
      if (e.locked && !sim.state.lockdown) banner.toast(t('toast.cellsLocked'), 'info');
      break;
  }
}

/** A short fade from black when a game starts. */
function fadeIn() {
  if (settings.reducedMotion) return;
  const veil = h('div', 'veil');
  document.body.append(veil);
  veil.addEventListener('animationend', () => veil.remove());
}

function startGame(prison: PrisonDef) {
  const sim = new Sim(prison, Date.now() & 0x7fffffff);
  view.setWorld(sim.world);
  // Start a little wide and settle in on the player.
  view.snapTo(sim.state.player.x / UNIT, sim.state.player.z / UNIT, settings.reducedMotion ? 1 : 0.8);
  view.zoomBy(1.25);
  view.setCast(sim.state.inmates.map((m) => ({ cell: m.cell, gait: m.speed / WALK_SPEED })));
  game = {
    rec: new Recorder(sim),
    prev: { x: sim.state.player.x, z: sim.state.player.z },
    prevInmates: sim.state.inmates.map((m) => ({ x: m.body.x, z: m.body.z })),
    paused: false,
    walked: 0,
    pilot: new Autopilot(sim.world),
    guide: null,
    guideAge: 1,
    guideFrom: -1,
    speed: 1,
    ops: [],
  };
  itemsUI.show(true);
  acc = 0;
  controls.reset();
  controls.enabled = true;
  hud.show(true);
  sound.ambience(true);
  fadeIn();
  document.body.classList.add('is-playing');
  // Day 1 opens on roll call: the bell and the banner, once the fade is over.
  const g = game;
  const later = (ms: number, f: () => void) => startTimers.push(window.setTimeout(() => game === g && !g.paused && f(), ms));
  later(700, () => announce({ type: 'routine', routine: sim.state.routine }, sim));
  if (!hasSeen('walk')) {
    later(4600, () => hint.show(TOUCH ? [t('hint.walkTouch'), t('hint.tapWalk'), t('hint.arrows')] : [t('hint.walkKeys'), t('hint.clickWalk'), t('hint.arrows')]));
  }
}

/** Timers set when a game starts (cleared when it ends, so they never reach the next one). */
let startTimers: number[] = [];

/** Resolves when the player quits to the title. */
let quit: (() => void) | null = null;

async function pause() {
  if (!game || game.paused) return;
  click();
  game.paused = true;
  game.speed = 1;
  controls.enabled = false;
  controls.reset();
  for (;;) {
    const choice = await showPause(click);
    if (!game) return;
    if (choice === 'settings') {
      await showSettings(settings, applySettings, click);
      continue;
    }
    if (choice === 'resume') {
      game.paused = false;
      controls.enabled = true;
      last = performance.now();
      return;
    }
    break;
  }
  game = null;
  for (const id of startTimers) clearTimeout(id);
  startTimers = [];
  controls.enabled = false;
  hud.show(false);
  itemsUI.show(false);
  sleepVeil.classList.remove('on');
  hint.hide();
  banner.clear();
  vignette.classList.remove('on');
  sound.siren(false);
  sound.ambience(false);
  document.body.classList.remove('is-playing');
  quit?.();
}
addEventListener('keydown', (e) => {
  if (!game || game.paused || e.metaKey || e.ctrlKey || e.repeat) return;
  // Escape closes a panel first, and pauses only when none is open.
  if (e.code === 'Escape') {
    if (itemsUI.panelOpen) itemsUI.closePanels();
    else pause();
    return;
  }
  const g = game;
  if (e.code === 'KeyE') {
    if (g.rec.sim.state.items.open >= 0) sendOp(OP.CLOSE);
    else act();
  }
  if (e.code === 'KeyC') itemsUI.toggleCraft();
  if (e.code === 'KeyQ' && g.rec.sim.state.items.inv[g.rec.sim.state.items.hand]) sendOp(OP.DROP, g.rec.sim.state.items.hand);
  const digit = /^Digit([1-6])$/.exec(e.code);
  if (digit) sendOp(OP.SELECT, Number(digit[1]) - 1);
  // Dev builds: fast-forward the prison clock (×30) to test the routine.
  if (import.meta.env.DEV && e.code === 'BracketRight' && game) game.speed = game.speed === 1 ? 30 : 1;
});
// A hidden page pauses the game (phones switching apps, a closed laptop).
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game && !game.paused) pause();
});

const NO_OP: [number, number, number] = [0, 0, 0];
const SLEEP_SPEED = 40;

/** Queues a one-step operation (sent with the next simulation step). */
function sendOp(op: number, a = 0, b = 0) {
  game?.ops.push([op, a, b]);
}

/** The action button / E: use what is in reach (or wake up). */
function act() {
  if (!game) return;
  game.pilot.stop();
  sendOp(OP.INTERACT);
}

const itemsUI = new ItemsUI(sendOp, click);
itemsUI.onAction = act;
const sleepVeil = h('div', 'sleep-veil', `<span>${''}</span>`);
document.body.append(sleepVeil);

/** What a container is called ("your desk", "bookshelf"). */
function thingName(sim: Sim, index: number): string {
  const c = containersOf(sim.world)[index];
  if (!c) return '';
  const k = c.prop.kind;
  if (c.mine && (k === 'desk' || k === 'bed')) return t(k === 'desk' ? 'thing.myDesk' : 'thing.myBed');
  return t(`thing.${k}` as Key);
}
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The action label and the floor frame for what is in reach. */
function describeTarget(sim: Sim, target: Target): string | null {
  if (!target) return null;
  if (target.kind === 'ground') return t('act.pickUp', { item: itemName(target.item) });
  if (target.kind === 'sleep') return t('act.sleep');
  return t('act.search', { thing: thingName(sim, target.index) });
}
const focusAt = { x0: 0, z0: 0, x1: 0, z1: 0 };
function focusOf(sim: Sim, target: Target) {
  if (!target) return null;
  if (target.kind === 'ground') {
    const tile = sim.state.items.ground[target.index][0];
    focusAt.x0 = (tile % MAP_W) + 0.2;
    focusAt.z0 = Math.floor(tile / MAP_W) + 0.2;
    focusAt.x1 = focusAt.x0 + 0.6;
    focusAt.z1 = focusAt.z0 + 0.6;
    return focusAt;
  }
  const p = containersOf(sim.world)[target.index].prop;
  focusAt.x0 = p.x;
  focusAt.z0 = p.z;
  focusAt.x1 = p.x + p.w;
  focusAt.z1 = p.z + p.d;
  return focusAt;
}
const groundFrame: Array<{ x: number; z: number; item: number }> = [];

const frameData: Frame = { x: 0, z: 0, facing: 0, moving: false, minuteOfDay: 0, surface: 0, inmates: [], guide: null, tap: null, alarm: false, ground: groundFrame, focus: null, held: 0, outfit: 0, sleeping: false };
const tapAt = { x: 0, z: 0 };
const hudState: HudState = { routine: 0, attended: false, heat: 0, lockdown: false, lockedMinutes: null };

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!game) {
    view.drawTitle(dt, now / 1000);
    return;
  }
  const g = game;
  const sim = g.rec.sim;
  const p = sim.state.player;
  if (!g.paused) {
    governQuality(dt);
    // Fixed steps: the simulation never sees the frame time.
    // Asleep, the night runs fast (about 13 s from 23:00 to 07:55).
    const speed = sim.state.sleeping ? SLEEP_SPEED : g.speed;
    acc += dt * speed;
    let steps = 0;
    while (acc >= 1 / STEPS_PER_SECOND && steps++ < 40 * speed) {
      acc -= 1 / STEPS_PER_SECOND;
      // Where everyone was before this step (buffers reused: no garbage per step).
      g.prev.x = p.x;
      g.prev.z = p.z;
      sim.state.inmates.forEach((m, k) => {
        const q = (g.prevInmates[k] ??= { x: 0, z: 0 });
        q.x = m.body.x;
        q.z = m.body.z;
      });
      // The stick and keys win over tap-to-walk; both are plain direction commands.
      if (controls.steering) g.pilot.stop();
      const op = g.ops.shift() ?? NO_OP;
      g.rec.step(command(controls.steering ? controls.dir() : g.pilot.dir(p), op[0], op[1], op[2]));
      g.walked += Math.hypot(p.x - g.prev.x, p.z - g.prev.z) / UNIT;
      // Sound, banners and vibration read the events; the simulation never calls them.
      for (const e of sim.events) announce(e, sim);
    }
    if (acc > 1) acc = 0;
    if (hint.visible && g.walked > 4) {
      hint.hide();
      markSeen('walk');
    }
    updateGuide(g, dt);
  }
  const a = g.paused ? 1 : acc * STEPS_PER_SECOND;
  const clock = sim.clock;
  const tile = tileOfBody(p);
  const lerp = (from: number, to: number) => (from + (to - from) * a) / UNIT;
  const st = sim.state;
  // One frame record, refilled every frame (phones notice garbage).
  const f = frameData;
  f.x = lerp(g.prev.x, p.x);
  f.z = lerp(g.prev.z, p.z);
  f.facing = Math.atan2(DIR_X[p.facing], DIR_Z[p.facing]);
  f.moving = p.moving && !g.paused;
  f.minuteOfDay = clock.minuteOfDay + ((st.step % STEPS_PER_MINUTE) + a) / STEPS_PER_MINUTE;
  f.surface = sim.world.ground.kind[tile.z * MAP_W + tile.x];
  f.inmates.length = st.inmates.length;
  st.inmates.forEach((m, k) => {
    const o = (f.inmates[k] ??= { x: 0, z: 0, facing: 0, moving: false, doing: 0, cell: 0 });
    const q = g.prevInmates[k];
    o.x = lerp(q?.x ?? m.body.x, m.body.x);
    o.z = lerp(q?.z ?? m.body.z, m.body.z);
    o.facing = Math.atan2(DIR_X[m.body.facing], DIR_Z[m.body.facing]);
    o.moving = m.body.moving && !g.paused;
    o.doing = m.doing;
    o.cell = m.cell;
  });
  f.guide = g.guide;
  const dest = g.pilot.destination;
  if (dest >= 0) {
    tapAt.x = (dest % MAP_W) + 0.5;
    tapAt.z = Math.floor(dest / MAP_W) + 0.5;
  }
  f.tap = dest >= 0 ? tapAt : null;
  f.alarm = st.lockdown;
  // Items: the floor, the hand, the outfit, and what the action button would use.
  const it = st.items;
  groundFrame.length = it.ground.length;
  it.ground.forEach(([tileIndex, v], k) => {
    const o = (groundFrame[k] ??= { x: 0, z: 0, item: 0 });
    o.x = (tileIndex % MAP_W) + 0.5;
    o.z = Math.floor(tileIndex / MAP_W) + 0.5;
    o.item = itemOf(v);
  });
  const target = st.sleeping || g.paused ? null : interactTarget(sim.world, it, p, ROUTINE[st.routine].id === 'lightsOut');
  f.focus = it.open >= 0 ? null : focusOf(sim, target);
  f.held = itemOf(it.inv[it.hand]);
  f.outfit = itemOf(it.inv[SLOT.OUTFIT]);
  f.sleeping = st.sleeping;
  view.draw(f, dt, now / 1000);
  const box = containersOf(sim.world)[it.open];
  itemsUI.update({
    items: it,
    boxTitle: box ? capital(thingName(sim, it.open)) : '',
    boxHidden: box?.hidden ?? 0,
    action: it.open >= 0 ? null : describeTarget(sim, target),
    sleeping: st.sleeping,
  });
  sleepVeil.classList.toggle('on', st.sleeping);
  // First time something is in reach: how to use it.
  if (target && !hint.visible && !hasSeen('interact') && hasSeen('walk')) hint.show([TOUCH ? t('hint.interactTouch') : t('hint.interactKeys')], 'hand');
  vignette.classList.toggle('on', st.lockdown);
  sound.siren(st.lockdown && !g.paused);
  const zone = sim.playerZone;
  hudState.routine = st.routine;
  // At Lights Out the badge says whether the player is in the cell right now.
  hudState.attended = ROUTINE[st.routine].id === 'lightsOut' ? zone === 'playerCell' : st.attended;
  hudState.heat = st.heat;
  hudState.lockdown = st.lockdown;
  hudState.lockedMinutes = st.lockdown && zone === 'playerCell' ? Math.ceil(st.lockdownLeft / STEPS_PER_MINUTE) : null;
  hud.update(clock, zone, hudState);
}

// The title shows the first prison drifting by.
view.setWorld(new Sim(PRISONS[0]).world);
requestAnimationFrame(frame);

// ------------------------------------------------------------------ flows
async function titleFlow() {
  for (;;) {
    const choice = await showTitle(
      {
        prisonName: t(`prison.${PRISONS[0].id}` as 'prison.center-perks'),
        muted: settings.muted,
        toggleSound: () => {
          settings.muted = !settings.muted;
          if (!settings.muted && settings.sfxVolume === 0) settings.sfxVolume = 0.8;
          applySettings();
          return settings.muted;
        },
      },
      click,
    );
    if (choice === 'settings') {
      await showSettings(settings, applySettings, click);
      continue;
    }
    startGame(PRISONS[0]);
    await new Promise<void>((resolve) => (quit = resolve));
    view.setWorld(new Sim(PRISONS[0]).world);
  }
}

titleFlow();
// Item icons are photographed once; do it while the title is up, not at the first slot drawn.
setTimeout(() => itemIcons(), 1200);
// The game started: the boot guard in index.html stands down.
(window as { __pe3dBooted?: boolean }).__pe3dBooted = true;
registerServiceWorker(() => {});
// Dev only: the running game, for probing from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __game: () => game, __view: view, __renderer: renderer });
