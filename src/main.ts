import * as THREE from 'three';
import './styles/index.css';
import { PRISONS } from './content/prisons';
import type { PrisonDef } from './content/prisons/types';
import { command, DIR_X, DIR_Z } from './sim/command';
import { Recorder } from './sim/Recorder';
import { Sim } from './sim/Sim';
import { STEPS_PER_MINUTE, STEPS_PER_SECOND, UNIT } from './sim/tuning';
import { View } from './render/View';
import { Controls } from './input/Controls';
import { Sound } from './audio/Sound';
import { loadSettings, saveSettings } from './game/settings';
import { migrateStorage } from './game/storage';
import { MOBILE } from './ui/dom';
import { Hud } from './ui/hud';
import { showTitle } from './ui/screens/title';
import { showPause } from './ui/screens/pause';
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
setLang(settings.lang);
setHaptics(settings.haptics);
const sound = new Sound();
const applySound = () => sound.setVolume(settings.muted ? 0 : settings.sfxVolume);
applySound();
const click = () => sound.click();

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.75 : 2));
document.body.append(renderer.domElement);
const view = new View(renderer, MOBILE ? 1024 : 2048);
const controls = new Controls(renderer.domElement, (f) => view.zoomBy(f));

// ------------------------------------------------------------------ the game
interface Game {
  rec: Recorder;
  /** The player's position before the last step (interpolation). */
  prev: { x: number; z: number };
  paused: boolean;
}
let game: Game | null = null;
let acc = 0;
let last = performance.now();

const hud = new Hud(() => pause());

function startGame(prison: PrisonDef) {
  const sim = new Sim(prison, Date.now() & 0x7fffffff);
  view.setWorld(sim.world);
  view.snapTo(sim.state.player.x / UNIT, sim.state.player.z / UNIT);
  game = { rec: new Recorder(sim), prev: { x: sim.state.player.x, z: sim.state.player.z }, paused: false };
  acc = 0;
  controls.reset();
  controls.enabled = true;
  hud.show(true);
  document.body.classList.add('is-playing');
}

/** Resolves when the player quits to the title. */
let quit: (() => void) | null = null;

async function pause() {
  if (!game || game.paused) return;
  click();
  game.paused = true;
  controls.enabled = false;
  controls.reset();
  const choice = await showPause(click);
  if (!game) return;
  if (choice === 'resume') {
    game.paused = false;
    controls.enabled = true;
    last = performance.now();
    return;
  }
  game = null;
  controls.enabled = false;
  hud.show(false);
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
  if (!game.paused) {
    // Fixed steps: the simulation never sees the frame time.
    acc += dt;
    while (acc >= 1 / STEPS_PER_SECOND) {
      acc -= 1 / STEPS_PER_SECOND;
      game.prev = { x: sim.state.player.x, z: sim.state.player.z };
      game.rec.step(command(controls.dir()));
      // Sound and vibration read the events; the simulation never calls them.
      for (const e of sim.events) {
        if (e.type === 'hour') {
          sound.bell();
          buzz('bell');
        }
      }
    }
  }
  const p = sim.state.player;
  const a = game.paused ? 1 : acc * STEPS_PER_SECOND;
  const clock = sim.clock;
  view.draw(
    {
      x: (game.prev.x + (p.x - game.prev.x) * a) / UNIT,
      z: (game.prev.z + (p.z - game.prev.z) * a) / UNIT,
      facing: Math.atan2(DIR_X[p.facing], DIR_Z[p.facing]),
      moving: p.moving && !game.paused,
      minuteOfDay: clock.minuteOfDay + ((sim.state.step % STEPS_PER_MINUTE) + a) / STEPS_PER_MINUTE,
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
    await showTitle(
      {
        prisonName: t(`prison.${PRISONS[0].id}` as 'prison.center-perks'),
        muted: settings.muted,
        toggleSound: () => {
          settings.muted = !settings.muted;
          saveSettings(settings);
          applySound();
          return settings.muted;
        },
      },
      click,
    );
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
if (import.meta.env.DEV) Object.assign(window, { __game: () => game, __view: view });
