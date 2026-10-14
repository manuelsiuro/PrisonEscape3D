import * as THREE from 'three';
import './styles/index.css';
import { PRISONS } from './content/prisons';
import type { PrisonDef } from './content/prisons/types';
import { command, DIR_X, DIR_Z } from './sim/command';
import { Recorder } from './sim/Recorder';
import { Sim } from './sim/Sim';
import { tileOfBody } from './sim/systems/movement';
import { STEPS_PER_MINUTE, STEPS_PER_SECOND, UNIT } from './sim/tuning';
import { MAP_W } from './sim/world/World';
import { View, type Quality } from './render/View';
import { Controls } from './input/Controls';
import { Sound } from './audio/Sound';
import { hasSeen, loadSettings, markSeen, saveSettings } from './game/settings';
import { migrateStorage } from './game/storage';
import { MOBILE, TOUCH, h } from './ui/dom';
import { Hud } from './ui/hud';
import { Hint } from './ui/hint';
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
  /** The player's position before the last step (interpolation). */
  prev: { x: number; z: number };
  paused: boolean;
  /** How far the player has walked (tiles), for the first-play hint. */
  walked: number;
}
let game: Game | null = null;
let acc = 0;
let last = performance.now();

const hud = new Hud(() => pause());
const hint = new Hint();
view.onStep = (surface) => sound.step(surface);

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
  game = { rec: new Recorder(sim), prev: { x: sim.state.player.x, z: sim.state.player.z }, paused: false, walked: 0 };
  acc = 0;
  controls.reset();
  controls.enabled = true;
  hud.show(true);
  sound.ambience(true);
  fadeIn();
  document.body.classList.add('is-playing');
  if (!hasSeen('walk')) setTimeout(() => game && hint.show(TOUCH ? [t('hint.walkTouch'), t('hint.zoomTouch')] : [t('hint.walkKeys'), t('hint.zoom')]), 900);
}

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
  controls.enabled = false;
  hud.show(false);
  hint.hide();
  sound.ambience(false);
  document.body.classList.remove('is-playing');
  quit?.();
}
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game && !game.paused) pause();
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
  const sim = game.rec.sim;
  const p = sim.state.player;
  if (!game.paused) {
    governQuality(dt);
    // Fixed steps: the simulation never sees the frame time.
    acc += dt;
    while (acc >= 1 / STEPS_PER_SECOND) {
      acc -= 1 / STEPS_PER_SECOND;
      game.prev = { x: p.x, z: p.z };
      game.rec.step(command(controls.dir()));
      game.walked += Math.hypot(p.x - game.prev.x, p.z - game.prev.z) / UNIT;
      // Sound and vibration read the events; the simulation never calls them.
      for (const e of sim.events) {
        if (e.type === 'hour') {
          sound.bell();
          buzz('bell');
        }
      }
    }
    if (hint.visible && game.walked > 4) {
      hint.hide();
      markSeen('walk');
    }
  }
  const a = game.paused ? 1 : acc * STEPS_PER_SECOND;
  const clock = sim.clock;
  const tile = tileOfBody(p);
  view.draw(
    {
      x: (game.prev.x + (p.x - game.prev.x) * a) / UNIT,
      z: (game.prev.z + (p.z - game.prev.z) * a) / UNIT,
      facing: Math.atan2(DIR_X[p.facing], DIR_Z[p.facing]),
      moving: p.moving && !game.paused,
      minuteOfDay: clock.minuteOfDay + ((sim.state.step % STEPS_PER_MINUTE) + a) / STEPS_PER_MINUTE,
      surface: sim.world.ground.kind[tile.z * MAP_W + tile.x],
    },
    dt,
    now / 1000,
  );
  hud.update(clock, sim.playerZone);
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
