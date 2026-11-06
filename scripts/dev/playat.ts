// Dev tool, run in the browser on the dev server (not by tsx): the game put at a moment worth
// looking at, driven by real input, for checking a change by playing it (the polish-gameplay skill).
// Importing it from here keeps it on the game's own modules (a module imported by hand from the
// console can be a second copy, its language switch or state not the game's). In the dev build:
//   const p = await import('/scripts/dev/playat.ts');
//   await p.at('stalag-flucht', 1, 9 * 60 + 1);   // the model prisoner's day up to then, on screen
//   await p.to(53, 10); await p.press('KeyE');     // walked there by keys, the action button
//   p.freeze(); p.zoom(3);                         // held still, the canvas enlarged on the player
//   p.lang('fr'); p.info();
// Every prison open in a test profile: seed `pe3d.escapes` with a route for each of the first four
// prisons in an isolated context, then reload (once more, so no achievement toast is left on screen).
import { PRISONS } from '../../src/content/prisons';
import { TRAINING } from '../../src/content/prisons/training';
import { setLang } from '../../src/i18n';
import { play } from '../../src/play/game';
import { endGame, startGame } from '../../src/play/session';
import type { View } from '../../src/render/View';
import { UNIT } from '../../src/sim/tuning';
import { MAP_W } from '../../src/sim/world/World';
import { Bot } from '../bots';

const game = () => {
  if (!play.game) throw new Error('no game on screen: call at() first');
  return play.game;
};
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const tileNow = () => {
  const p = game().rec.sim.state.player;
  return [Math.floor(p.x / UNIT), Math.floor(p.z / UNIT)];
};

/** A prison's game at day and minute of the day, played that far by the model prisoner, on screen and running. */
export async function at(prison: string, day: number, minute: number, seed = 3) {
  const def = [TRAINING, ...PRISONS].find((d) => d.id === prison);
  if (!def) throw new Error(`no prison ${prison}`);
  if (play.game) endGame();
  const bot = new Bot(def, seed);
  bot.routineUntil(day, minute);
  document.querySelector('.title-screen')?.remove();
  startGame(bot.sim, true);
  await wait(300);
  return info();
}

/**
 * Puts the player on a tile to save a walk. Refused off the floor they could walk on: set down in a
 * wall they can't move, and set down outside the fence the game counts an escape.
 */
export function put(x: number, z: number, facing = 5) {
  const sim = game().rec.sim;
  const i = z * MAP_W + x;
  if (sim.world.npcBlock[i] || sim.world.zoneAt(x, z) === 'outside') throw new Error(`${x},${z} (${sim.world.zoneAt(x, z)}) isn't floor to stand on`);
  const p = sim.state.player;
  p.x = x * UNIT + UNIT / 2;
  p.z = z * UNIT + UNIT / 2;
  p.facing = facing;
  p.moving = false;
}

/** A key held for so long (KeyW, KeyE, Space…), as the keyboard sends it. */
export async function press(code: string, ms = 60) {
  const o = { code, key: code.replace('Key', '').toLowerCase(), bubbles: true };
  window.dispatchEvent(new KeyboardEvent('keydown', o));
  await wait(ms);
  window.dispatchEvent(new KeyboardEvent('keyup', o));
  await wait(120);
}

/** Walked to a tile by keys, along one axis and then the other (nothing in the way: for a clear room). */
export async function to(x: number, z: number) {
  for (let k = 0; k < 12; k++) {
    const [px, pz] = tileNow();
    if (px === x && pz === z) return true;
    if (px !== x) await press(px < x ? 'KeyD' : 'KeyA', 320 * Math.abs(px - x));
    else await press(pz < z ? 'KeyS' : 'KeyW', 320 * Math.abs(pz - z));
  }
  return false;
}

/** Held still for a look: the game runs on in real time otherwise, between one tool call and the next. */
export function freeze(on = true) {
  game().paused = on;
}

/** The canvas enlarged on the player (1: back to normal): take the screenshot at a high device scale for detail. */
export function zoom(k: number) {
  const view = (window as unknown as { __view: View }).__view as unknown as { player: { root: { position: { clone(): { y: number; project(c: unknown): { x: number; y: number } } } } }; camera: unknown };
  const canvas = document.querySelector('canvas')!;
  const v = view.player.root.position.clone();
  v.y += 0.6;
  const s = v.project(view.camera);
  canvas.style.transformOrigin = `${((s.x + 1) / 2) * innerWidth}px ${((1 - s.y) / 2) * innerHeight}px`;
  canvas.style.transform = k === 1 ? '' : `scale(${k})`;
}

/** The language, for what's drawn from now on (open the panel again to see it: what's on screen stays). */
export const lang = (l: 'en' | 'fr' | 'auto') => setLang(l);

/** Where the game is. */
export function info() {
  const sim = game().rec.sim;
  const s = sim.state;
  const clock = sim.clock;
  return { tile: tileNow(), zone: sim.playerZone, day: clock.day, minute: clock.minuteOfDay, heat: s.heat, energy: s.energy, seat: s.seat };
}
