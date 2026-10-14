import * as THREE from 'three';
import './styles/index.css';
import { PRISONS } from './content/prisons';
import type { PrisonDef } from './content/prisons/types';
import { ROUTINE } from './content/routine';
import { ZONES } from './content/zones';
import { Autopilot } from './sim/ai/autopilot';
import { findPath, smooth, tileAt } from './sim/ai/path';
import { isFloor, placesOf } from './sim/ai/places';
import { command, DIR_X, DIR_Z } from './sim/command';
import { Recorder } from './sim/Recorder';
import { Sim, type SimEvent } from './sim/Sim';
import { tileOfBody } from './sim/systems/movement';
import { STEPS_PER_MINUTE, STEPS_PER_SECOND, UNIT, WALK_SPEED } from './sim/tuning';
import { MAP_W } from './sim/world/World';
import { View, type Quality } from './render/View';
import { Controls } from './input/Controls';
import { Sound } from './audio/Sound';
import { hasSeen, loadSettings, markSeen, saveSettings } from './game/settings';
import { migrateStorage } from './game/storage';
import { MOBILE, TOUCH, h } from './ui/dom';
import { Hud, routineName, routinePlace } from './ui/hud';
import { Hint } from './ui/hint';
import { Banner } from './ui/banner';
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
  };
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
  hint.hide();
  banner.clear();
  vignette.classList.remove('on');
  sound.siren(false);
  sound.ambience(false);
  document.body.classList.remove('is-playing');
  quit?.();
}
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game && !game.paused) pause();
  // Dev builds: fast-forward the prison clock (×30) to test the routine.
  if (import.meta.env.DEV && e.code === 'BracketRight' && game) game.speed = game.speed === 1 ? 30 : 1;
});
// A hidden page pauses the game (phones switching apps, a closed laptop).
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game && !game.paused) pause();
});

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
    acc += dt * g.speed;
    let steps = 0;
    while (acc >= 1 / STEPS_PER_SECOND && steps++ < 40 * g.speed) {
      acc -= 1 / STEPS_PER_SECOND;
      g.prev = { x: p.x, z: p.z };
      g.prevInmates = sim.state.inmates.map((m) => ({ x: m.body.x, z: m.body.z }));
      // The stick and keys win over tap-to-walk; both are plain direction commands.
      if (controls.steering) g.pilot.stop();
      g.rec.step(command(controls.steering ? controls.dir() : g.pilot.dir(p)));
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
  const target = g.pilot.destination;
  view.draw(
    {
      x: lerp(g.prev.x, p.x),
      z: lerp(g.prev.z, p.z),
      facing: Math.atan2(DIR_X[p.facing], DIR_Z[p.facing]),
      moving: p.moving && !g.paused,
      minuteOfDay: clock.minuteOfDay + ((sim.state.step % STEPS_PER_MINUTE) + a) / STEPS_PER_MINUTE,
      surface: sim.world.ground.kind[tile.z * MAP_W + tile.x],
      inmates: sim.state.inmates.map((m, k) => ({
        x: lerp(g.prevInmates[k]?.x ?? m.body.x, m.body.x),
        z: lerp(g.prevInmates[k]?.z ?? m.body.z, m.body.z),
        facing: Math.atan2(DIR_X[m.body.facing], DIR_Z[m.body.facing]),
        moving: m.body.moving && !g.paused,
        doing: m.doing,
        cell: m.cell,
      })),
      guide: g.guide,
      tap: target >= 0 ? { x: (target % MAP_W) + 0.5, z: Math.floor(target / MAP_W) + 0.5 } : null,
      alarm: sim.state.lockdown,
    },
    dt,
    now / 1000,
  );
  const st = sim.state;
  vignette.classList.toggle('on', st.lockdown);
  sound.siren(st.lockdown && !g.paused);
  hud.update(clock, sim.playerZone, {
    routine: st.routine,
    // At Lights Out the badge says whether the player is in the cell right now.
    attended: ROUTINE[st.routine].id === 'lightsOut' ? sim.playerZone === 'playerCell' : st.attended,
    heat: st.heat,
    lockdown: st.lockdown,
    lockedMinutes: st.lockdown && sim.playerZone === 'playerCell' ? Math.ceil(st.lockdownLeft / STEPS_PER_MINUTE) : null,
  });
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
// The game started: the boot guard in index.html stands down.
(window as { __pe3dBooted?: boolean }).__pe3dBooted = true;
registerServiceWorker(() => {});
// Dev only: the running game, for probing from the browser console.
if (import.meta.env.DEV) Object.assign(window, { __game: () => game, __view: view, __renderer: renderer });
