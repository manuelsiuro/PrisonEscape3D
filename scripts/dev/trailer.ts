// Dev tool, run in the browser on the dev server (not by tsx): the game's trailer, "The Model
// Prisoner" (about 42 s, 1920×1080, 30 fps). Every shot is the real game: an escape bot's run
// (scripts/escapes.ts) or a lesson's scene (as helpshot.ts stages them), played on from its moment
// with the HUD hidden, the clock driven frame by frame (no dropped frames) and the camera moved
// by the shot's own program. Needs scripts/dev/trailersink.ts running (it writes the files).
// Open the dev build at a 1920×1080 viewport (device pixel ratio 1), then in its console:
//   const t = await import('/scripts/dev/trailer.ts');
//   await t.film();             // every shot's frames: raw/NNNNN.jpg
//   await t.film('escape');     // one shot again (its frames numbered where it sits in the cut)
//   await t.titles('en');       // the on-screen text, en/NNNNN.png (transparent), and 'fr'
//   await t.score();            // the music and sound: score.wav
// Then scripts/dev/trailercut.sh <dir> puts the film together (trailer-en.mp4, trailer-fr.mp4).
// Run it in an isolated browser profile: each shot is a game started.
import * as THREE from 'three';
import { PLANS } from '../escapes';
import { DIR } from '../bots';
import { daylight, hideUi, run, SHOTS, type Shot } from './helpshot';
import { TIERS } from '../../src/app/quality';
import { play } from '../../src/play/game';
import { settings } from '../../src/play/context';
import { endGame, startGame } from '../../src/play/session';
import { command } from '../../src/sim/command';
import { Sim } from '../../src/sim/Sim';
import { UNIT } from '../../src/sim/tuning';
import { TILE } from '../../src/sim/world/tiles';
import { LAYER, MAP_W } from '../../src/sim/world/World';
import type { View } from '../../src/render/View';

export const FPS = 30;
export const W = 1920;
export const H = 1080;
const SINK = 'http://127.0.0.1:5312';

// ------------------------------------------------------------------ the cut
/** The two tempos: the model prisoner's march, then the plan's drive (the game's day and tension moods). */
export const BEAT1 = 60 / 88;
export const BEAT2 = 60 / 126;

/** Where the camera is, a share `u` (0–1) of the way through a shot. */
interface Cam {
  /** The zoom (1: play's; under it, wider). */
  zoom?: number;
  /** Tiles off the player (or off `at`). */
  dx?: number;
  dz?: number;
  /** A fixed point looked at (tiles), not the player. */
  at?: [number, number];
  /** Turned round the point looked at (radians), and tilted lower (radians, from the game's angle). */
  turn?: number;
  tilt?: number;
}

export interface Cut {
  id: string;
  /** Beats long, at the first or the second tempo. */
  beats: number;
  tempo: 1 | 2;
  /** The moment, as helpshot stages it. */
  shot: Shot;
  /** The camera through the shot (the game's own, eased onto the player, where it gives nothing). */
  cam?: (u: number) => Cam;
  /** Play speed through the shot (1: real time; under it, slow motion). */
  speed?: (u: number) => number;
  /** Seconds played before the first frame kept (the camera settled, the shaders warm). */
  pre?: number;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const ease = (u: number) => u * u * (3 - 2 * u);
/** The moment the game's clock reaches this minute of the day. */
const minute = (m: number) => (s: Sim) => s.clock.minuteOfDay >= m && s.clock.minuteOfDay < m + 60;
/** The moment the player has been on a layer this many steps running. */
function onLayerFor(layer: number, steps: number) {
  let since = -1;
  return (sim: Sim, k: number) => {
    if (k === 0 || sim.state.layer !== layer) since = -1;
    else if (since < 0) since = k;
    return since >= 0 && k - since >= steps;
  };
}
/** A slow push in: the zoom from `a` to `b` over the shot. */
const push = (a: number, b: number, more: Cam = {}) => (u: number): Cam => ({ zoom: lerp(a, b, ease(u)), ...more });

/** The fence tile a prison's cutout route cuts through. */
function wireOf(prison: string) {
  const p = PLANS.find((q) => q.def.id === prison)!;
  const [fx, fz, face] = p.fence!;
  return (fz + (face === DIR.SOUTH ? 1 : 0)) * MAP_W + fx + (face === DIR.EAST ? 1 : 0);
}

export const CUTS: Cut[] = [
  // 1. Cold open: dawn over Center Perks, the camera pulling back off the yard.
  {
    id: 'open',
    beats: 4,
    tempo: 1,
    shot: { prison: 'center-perks', route: 'glider', when: minute(8 * 60 + 1), light: 420 },
    cam: (u) => ({ zoom: lerp(1.1, 0.55, ease(u)), turn: lerp(-0.35, -0.1, u), tilt: 0.08 }),
    pre: 1,
  },
  // 2. The model prisoner: the day as it should be kept.
  { id: 'rollcall', beats: 2, tempo: 1, shot: { prison: 'center-perks', route: 'glider', when: minute(8 * 60 + 20) }, cam: push(1.2, 1.4) },
  { id: 'work', beats: 2, tempo: 1, shot: { ...SHOTS.work }, cam: push(2.0, 2.3, { dx: 1 }) },
  { id: 'football', beats: 2, tempo: 1, shot: { ...SHOTS.football, after: 240 }, cam: push(1.5, 1.6) },
  { id: 'gym', beats: 2, tempo: 1, shot: { ...SHOTS.train }, cam: push(2.2, 2.6, { dz: -1.5 }) },
  { id: 'talent', beats: 2, tempo: 1, shot: { ...SHOTS.talent }, cam: push(2.2, 2.5, { dx: -1 }) },
  { id: 'race', beats: 2, tempo: 1, shot: { ...SHOTS.race, when: (_s, k, n) => k >= n - 90 }, cam: push(3.0, 3.4, { dx: 3, dz: 1 }) },
  // 3. The turn: night in the cell, and down through the desk into the tunnel.
  { id: 'turn', beats: 4, tempo: 1, shot: { prison: 'center-perks', route: 'tunnel', when: (s) => s.state.layer === LAYER.UNDER, after: -50 }, cam: push(2.2, 2.6) },
  // 4. The plan.
  { id: 'vents', beats: 4, tempo: 2, shot: { prison: 'center-perks', route: 'rooftop', when: onLayerFor(LAYER.VENTS, 10), light: 700 }, cam: push(1.8, 2.1) },
  { id: 'dig', beats: 2, tempo: 2, shot: { prison: 'center-perks', route: 'tunnel', when: onLayerFor(LAYER.UNDER, 100) }, cam: push(2.4, 2.7, { dz: -1.5 }) },
  {
    id: 'cut',
    beats: 2,
    tempo: 2,
    shot: { prison: 'center-perks', route: 'cutout', when: (s) => s.world.ground.kind[wireOf('center-perks')] === TILE.FENCE_CUT, after: -22, light: 600 },
    cam: push(2.2, 2.5),
  },
  { id: 'bribe', beats: 2, tempo: 2, shot: { ...SHOTS.guards }, cam: push(1.9, 2.2, { dx: 2 }) },
  { id: 'smuggle', beats: 2, tempo: 2, shot: { ...SHOTS.smuggling, when: (_s, k, n) => k >= n - 45 }, cam: push(1.7, 1.9, { dz: -1.5 }) },
  { id: 'disguise', beats: 2, tempo: 2, shot: { ...SHOTS.bluff, after: -14 }, cam: push(2.1, 2.4) },
  { id: 'rat', beats: 2, tempo: 2, shot: { ...SHOTS.rat, when: (_s, k) => k >= 60 }, cam: push(3.2, 3.5, { dx: 1.5, dz: -2 }) },
  // 5. Five prisons.
  {
    id: 'center-perks',
    beats: 4,
    tempo: 2,
    shot: { prison: 'center-perks', route: 'cutout', when: minute(15 * 60 + 20), light: 1110 },
    cam: (u) => ({ zoom: 0.62, turn: lerp(0.25, -0.05, u), tilt: 0.1 }),
  },
  { id: 'stalag-flucht', beats: 4, tempo: 2, shot: { ...SHOTS.weather, when: minute(15 * 60 + 20) }, cam: (u) => ({ zoom: 0.7, turn: lerp(-0.25, 0.05, u), tilt: 0.1 }) },
  {
    id: 'shankton',
    beats: 4,
    tempo: 2,
    shot: { prison: 'shankton', route: 'rooftop', when: minute(15 * 60 + 20), light: 1110 },
    cam: (u) => ({ zoom: 0.7, turn: lerp(0.25, -0.05, u), tilt: 0.1 }),
  },
  { id: 'san-pancho', beats: 4, tempo: 2, shot: { ...SHOTS.mines, when: (_s, k, n) => k >= n - 80 }, cam: (u) => ({ zoom: lerp(1.0, 0.75, u), turn: lerp(-0.2, 0.05, u), tilt: 0.06 }) },
  { id: 'irongate', beats: 4, tempo: 2, shot: { ...SHOTS.island, when: (_s, k, n) => k >= n - 60 }, cam: (u) => ({ zoom: lerp(1.5, 1.1, u), dx: -2, turn: lerp(0.15, -0.1, u) }) },
  // 6. The escape: off the roof with the glider, over the wall in slow motion, the escape camera after.
  {
    id: 'escape',
    beats: 12,
    tempo: 2,
    shot: { ...SHOTS.glider, after: -20 },
    cam: (u) => ({ zoom: lerp(2.1, 1.5, ease(u)), turn: lerp(0, -0.5, ease(u)), tilt: 0.15 }),
    speed: (u) => (u < 0.175 ? 1 : u < 0.756 ? 0.45 : 1),
  },
  // 7. The end card's picture: the prison left behind, at dusk.
  { id: 'end', beats: 12, tempo: 2, shot: { ...SHOTS.goal, after: 40, light: 1150 }, pre: 1.5, cam: (u) => ({ zoom: lerp(0.9, 0.75, u), turn: lerp(0.1, -0.1, u) }) },
];

/** Shots tried for a place in the cut (peek and sheet find them too). */
export const SPARE: Cut[] = [
  { id: 'garden', beats: 2, tempo: 1, shot: { ...SHOTS.garden }, cam: push(2.2, 2.5) },
  { id: 'hoops', beats: 2, tempo: 1, shot: { ...SHOTS.hoops, after: -10 }, cam: push(1.8, 2.1, { dz: -1.5 }) },
  { id: 'grounds', beats: 2, tempo: 1, shot: { ...SHOTS.grounds, when: (_s, k, n) => k >= n - 60 }, cam: push(1.3, 1.5) },
  { id: 'dinner', beats: 2, tempo: 1, shot: { prison: 'center-perks', route: 'glider', when: minute(17 * 60 + 25) }, cam: push(1.5, 1.7) },
];

/** Each cut's first frame and length in frames (where the beats fall, rounded to frames). */
export function timeline() {
  let t = 0;
  return CUTS.map((c) => {
    const secs = c.beats * (c.tempo === 1 ? BEAT1 : BEAT2);
    const from = Math.round(t * FPS);
    t += secs;
    return { id: c.id, from, frames: Math.round(t * FPS) - from, at: +(from / FPS).toFixed(3) };
  });
}

// ------------------------------------------------------------------ the camera and the clock
const view = () => (window as unknown as { __view: View }).__view;
const UP = new THREE.Vector3(0, 1, 0);
const EAST = new THREE.Vector3(1, 0, 0);
const cam = { dx: 0, dz: 0, turn: 0, tilt: 0, at: null as null | [number, number], on: false };
let ownDraw: View['draw'] | null = null;

/** The view's camera put through `cam` (the point it eases to, the angle it looks from). */
function rig(on: boolean) {
  const v = view() as unknown as { target: THREE.Vector3; cineOffset: THREE.Vector3 };
  const target = v.target;
  const off = v.cineOffset;
  for (const o of [target, off] as Array<Partial<THREE.Vector3>>) {
    delete o.lerp;
    delete o.set;
    delete o.copy;
  }
  if (ownDraw) view().draw = ownDraw;
  ownDraw = null;
  // No noise rings either (what a strike or a step is heard by: play's feedback, clutter on film).
  const fx = (view() as unknown as { noiseFx: { noise?: () => void } }).noiseFx;
  delete fx.noise;
  if (on) fx.noise = () => {};
  cam.on = on;
  if (!on) return;
  // No floor arrows, tap ring or highlight in the picture.
  const draw = (ownDraw = view().draw);
  view().draw = (f, dt, time) => draw.call(view(), { ...f, guide: null, tap: null, focus: null }, dt, time);
  const to = new THREE.Vector3();
  const aim = (x: number, y: number, z: number) => (cam.at ? to.set(cam.at[0] + 0.5 + cam.dx, 0, cam.at[1] + 0.5 + cam.dz) : to.set(x + cam.dx, y, z + cam.dz));
  target.lerp = (p, a) => THREE.Vector3.prototype.lerp.call(target, aim(p.x, p.y, p.z), cam.at ? 1 : a);
  target.set = (x, y, z = 0) => THREE.Vector3.prototype.copy.call(target, aim(x, y, z));
  off.copy = (p) => {
    THREE.Vector3.prototype.copy.call(off, p);
    if (cam.tilt) off.applyAxisAngle(EAST, cam.tilt);
    if (cam.turn) off.applyAxisAngle(UP, cam.turn);
    return off;
  };
}

/** The animation frames, run by hand: the page's own clock stopped while the film is made. */
const queue: FrameRequestCallback[] = [];
let clock = 0;
let ownRaf: typeof requestAnimationFrame | null = null;
function takeClock() {
  if (ownRaf) return;
  ownRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => queue.push(cb);
  clock = performance.now();
}
function giveClock() {
  if (!ownRaf) return;
  window.requestAnimationFrame = ownRaf;
  ownRaf = null;
  play.last = performance.now();
  for (const cb of queue.splice(0)) requestAnimationFrame(cb);
}
/** One frame `ms` on. */
function tick(ms: number) {
  clock += ms;
  play.last = Math.min(play.last, clock);
  for (const cb of queue.splice(0)) cb(clock);
}

function setCam(c: Cam) {
  const v = view() as unknown as { zoom: number; zoomGoal: number; applyZoom(): void };
  if (c.zoom !== undefined && Math.abs(v.zoom - c.zoom) > 1e-6) {
    v.zoom = v.zoomGoal = c.zoom;
    v.applyZoom();
  }
  cam.dx = c.dx ?? 0;
  cam.dz = c.dz ?? 0;
  cam.turn = c.turn ?? 0;
  cam.tilt = c.tilt ?? 0;
  cam.at = c.at ?? null;
}

/** The game at a cut's moment, on screen, the HUD hidden, played on by the run's own commands. */
function stageCut(c: Cut) {
  const s = c.shot;
  rig(false);
  const bot = run(s);
  const n = bot.cmds.length;
  const sim = new Sim(bot.sim.prison, 1);
  sim.restore(bot.start!);
  let k = 0;
  while (k < n && !s.when(sim, k, n)) sim.step(bot.cmds[k++]);
  const pre = Math.round((c.pre ?? 0.5) * 20);
  const end = Math.max(0, Math.min(n - 1, k + (s.after ?? 0) - pre));
  if (end < k) {
    sim.restore(bot.start!);
    k = 0;
  }
  while (k < end) sim.step(bot.cmds[k++]);
  if (play.game) endGame();
  daylight(s.light);
  startGame(sim, true);
  hideUi(true);
  const idle = command(0);
  const step = sim.step.bind(sim);
  sim.step = () => step(k < n ? bot.cmds[k++] : idle);
  const g = play.game!;
  g.guide = null;
  g.guideAge = -1e9;
  g.guideFrom = Math.floor(sim.state.player.z / UNIT) * MAP_W + Math.floor(sim.state.player.x / UNIT);
  return { step: k, of: n };
}

const out = document.createElement('canvas');
out.width = W;
out.height = H;
const g2 = out.getContext('2d')!;

async function send(name: string, blob: Blob) {
  const res = await fetch(`${SINK}/?name=${name}`, { method: 'POST', body: blob });
  if (!res.ok) throw new Error(`${name}: the sink said ${res.status}`);
}
const pad = (k: number) => String(k).padStart(5, '0');

/** One cut filmed: its frames sent as raw/NNNNN.jpg (numbered where it sits in the film). */
async function shoot(c: Cut, from: number, frames: number, keep = true) {
  settings.quality = 'high';
  view().setQuality(TIERS[0]);
  const at = stageCut(c);
  rig(true);
  takeClock();
  // (A frame for the real clock's last callback to land in the queue, then the warm-up.)
  await new Promise((r) => setTimeout(r, 50));
  const pre = Math.round((c.pre ?? 0.5) * FPS);
  for (let j = -pre; j < frames; j++) {
    const u = Math.max(0, j) / Math.max(1, frames - 1);
    if (c.cam) setCam(c.cam(u));
    else setCam({});
    tick((1000 / FPS) * (c.speed ? c.speed(u) : 1));
    if (j < 0 || !keep) continue;
    const src = view().renderer.domElement;
    g2.drawImage(src, 0, 0, W, H);
    const blob = await new Promise<Blob>((done) => out.toBlob((b) => done(b!), 'image/jpeg', 0.93));
    await send(`raw/${pad(from + j)}.jpg`, blob);
  }
  return { id: c.id, from, frames, ...at, size: [view().renderer.domElement.width, view().renderer.domElement.height] };
}

/** Every cut filmed (or the one named), then back to the title. */
export async function film(only?: string) {
  const tl = timeline();
  const done = [];
  try {
    for (const [k, c] of CUTS.entries()) {
      if (only && c.id !== only) continue;
      done.push(await shoot(c, tl[k].from, tl[k].frames));
    }
  } finally {
    stop();
  }
  return done;
}

/** A cut staged and held a share `u` of the way in, for a look (not sent): stop() after. */
export async function peek(id: string, u = 0) {
  const all = [...CUTS, ...SPARE];
  const c = all.find((x) => x.id === id)!;
  const n = Math.round(c.beats * (c.tempo === 1 ? BEAT1 : BEAT2) * FPS);
  const at = await shoot(c, 0, Math.round(u * (n - 1)) + 1, false);
  return at;
}

/** The page's own clock back, the camera the game's, the title. */
export function stop() {
  rig(false);
  giveClock();
  if (play.game) endGame();
  daylight(undefined);
  hideUi(false);
}

/** A contact sheet (sheet-<name>.jpg): each cut named, held a share `u` of the way in, 640×360 a picture. */
export async function sheet(name: string, ids: string[], u = 0.5) {
  const cols = 3;
  const c = document.createElement('canvas');
  c.width = 640 * cols;
  c.height = 360 * Math.ceil(ids.length / cols);
  const g = c.getContext('2d')!;
  g.font = '600 22px Inter, sans-serif';
  try {
    for (const [k, at] of ids.entries()) {
      const [id, v = u] = at.split('@').map((x, j) => (j ? +x : x)) as [string, number?];
      await peek(id, v);
      const x = (k % cols) * 640;
      const y = Math.floor(k / cols) * 360;
      g.drawImage(view().renderer.domElement, x, y, 640, 360);
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(x, y, 200, 32);
      g.fillStyle = '#fff';
      g.fillText(at, x + 8, y + 24);
    }
  } finally {
    stop();
  }
  const blob = await new Promise<Blob>((done) => c.toBlob((b) => done(b!), 'image/jpeg', 0.85));
  await send(`sheet-${name}.jpg`, blob);
  return ids.length;
}
