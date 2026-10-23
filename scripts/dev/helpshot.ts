// Dev tool, run in the browser on the dev server (not by tsx): How to play's pictures (P37),
// public/help/<topic>.webp. Each is a moment of a real escape: an escape bot (scripts/escapes.ts)
// plays its route, the run is played again up to the moment wanted, and the game shows it,
// paused, with the HUD hidden, the camera on the player. Needs scripts/dev/shotsink.ts running
// (it writes the files). In the dev build's console:
//   const h = await import('/scripts/dev/helpshot.ts');
//   await h.all();              // every picture in SHOTS
//   await h.take('glider');     // one (it stays on screen: h.done() back to the title)
// Retake them when what they show changes; helptest checks every topic's picture is there.
// Run it in an isolated browser profile: each shot is a game started, so its escapes, stats and
// trophies land in that profile's storage.
import { PLANS, quiet, runRoute, type Route } from '../escapes';
import { Bot } from '../bots';
import { TRAINING } from '../../src/content/prisons/training';
import { WAY } from '../../src/content/smuggling';
import { EXT, OP, tossArgs } from '../../src/sim/command';
import { prisonDay } from '../../src/sim/systems/calendar';
import { dropTile } from '../../src/sim/systems/smuggling';
import { containersOf } from '../../src/sim/world/containers';
import { LESSONS } from '../../src/tutorial/lessons';
import { play } from '../../src/play/game';
import { endGame, startGame } from '../../src/play/session';
import * as THREE from 'three';
import type { View } from '../../src/render/View';
import { Sim } from '../../src/sim/Sim';
import { LAYER } from '../../src/sim/world/World';
import { UNIT } from '../../src/sim/tuning';

quiet.on = true;

/** The picture's size (the page shows it at up to 560 px wide, 2× for sharp screens). */
const W = 1040;
const H = 480;

interface Shot {
  /** An escape bot's run (scripts/escapes.ts): its prison and route. */
  prison?: string;
  route?: Route;
  /** Or a lesson's scene, played on by these moves (as tutorialtest's bot plays it). */
  lesson?: string;
  moves?: (bot: Bot) => void;
  /** The moment: the first step where this holds (the run's steps, k of n). */
  when: (sim: Sim, k: number, n: number) => boolean;
  /** Steps on from there. */
  after?: number;
  /** The camera's zoom (1: play's; past the player's own limit, 1.9, for a close-up), and how far off the player it looks (tiles). */
  zoom?: number;
  dx?: number;
  dz?: number;
  /** The hour drawn (minutes from midnight), when the moment's own would be too dark to read. */
  light?: number;
  /** Seconds played on from the moment (the run's own commands), for what the view animates (a glide). */
  live?: number;
}

/** The moment the player has been on a layer this many steps running. */
function onLayerFor(layer: number, steps: number) {
  let since = -1;
  return (sim: Sim, k: number) => {
    if (k === 0 || sim.state.layer !== layer) since = -1;
    else if (since < 0) since = k;
    return since >= 0 && k - since >= steps;
  };
}

/** The moment a dog is this close to the player (tiles), in the open. */
const dogNear = (tiles: number, from = 0) => (sim: Sim) =>
  sim.state.layer === LAYER.GROUND &&
  sim.state.dogs.some((d) => {
    const r = Math.hypot(d.body.x - sim.state.player.x, d.body.z - sim.state.player.z) / UNIT;
    return r > from && r < tiles;
  });

/** The moment the player is within this many tiles of a tile, on the ground. */
const nearTile = (x: number, z: number, tiles: number, also: (sim: Sim) => boolean = () => true) => (sim: Sim) =>
  sim.state.layer === LAYER.GROUND && Math.hypot(sim.state.player.x / UNIT - x - 0.5, sim.state.player.z / UNIT - z - 0.5) < tiles && also(sim);

/** The moment an event of this type happens. */
const on = (type: string) => (sim: Sim) => sim.events.some((e) => e.type === type);

const tileX = (sim: Sim) => Math.floor(sim.state.player.x / UNIT);
const tileZ = (sim: Sim) => Math.floor(sim.state.player.z / UNIT);

export const SHOTS: Record<string, Shot> = {
  ways: { prison: 'center-perks', route: 'cutout', when: (_s, k, n) => k >= n - 30, zoom: 2.2, light: 600 },
  layers: { prison: 'center-perks', route: 'tunnel', when: onLayerFor(LAYER.UNDER, 100), zoom: 2.6, dz: -1.5 },
  delivery: { prison: 'center-perks', route: 'stowaway', when: (s) => s.state.stowed, after: -6, zoom: 2.1 },
  bluff: { prison: 'center-perks', route: 'bluff', when: on('bluff'), after: -4, zoom: 2.2 },
  glider: { prison: 'center-perks', route: 'glider', when: on('glide'), after: -3, zoom: 1.8, dz: -1, light: 600, live: 0.5 },
  // (Out of the tunnel onto the road, the escape camera turning on the prison behind.)
  goal: { prison: 'center-perks', route: 'tunnel', when: (_s, k, n) => k >= n - 2, zoom: 1.4, light: 600, live: 2 },
  // (Cleared, in their own clothes, out through the doors by the desk: its lamp green.)
  paperwork: { prison: 'center-perks', route: 'paperwork', when: (s) => s.state.release[1] > 0, after: 6, zoom: 2.2, dz: -1.2 },
  power: { prison: 'center-perks', route: 'cutout', when: on('power'), after: 4, zoom: 2.2, dx: -1, dz: 1.5, light: 600 },
  cams: { prison: 'center-perks', route: 'cutout', when: nearTile(7, 36, 5, (s) => s.state.powerOff === 0), zoom: 2, light: 600 },
  // (At night with the power on: Center Perks' south-east tower and its beam up the east strip.)
  towers: { prison: 'center-perks', route: 'glider', when: (_s, k, n) => k >= n - 40, zoom: 1.25, dx: 4, dz: 12 },
  dogs: { prison: 'shankton', route: 'paperwork', when: dogNear(3.5, 2), after: 7, zoom: 2.3 },
  rat: {
    lesson: 'rat',
    moves: (bot) => {
      bot.use();
      bot.use();
      const desk = containersOf(bot.sim.world).findIndex((c) => !c.mine && c.prop.kind === 'desk');
      bot.op(OP.EXT, EXT.RAT_FETCH, ...tossArgs(desk));
      bot.until(() => bot.slotOf('lighter') >= 0, 3000);
    },
    // (On its way back from the next cell, the lighter in its mouth.)
    when: (_s, k) => k >= 66,
    zoom: 3,
    dx: 1.5,
    dz: -2,
  },
  smuggling: {
    lesson: 'smuggle',
    moves: (bot) => {
      bot.op(OP.EXT, EXT.ORDER, 7, WAY.DRONE);
      bot.op(OP.SELECT, 1);
      bot.walkTo(dropTile(bot.sim, prisonDay(bot.st.step)));
      bot.until(() => bot.st.drops.length > 0, 3 * 60 * 20);
    },
    // (At night, as drones come: the drop in its claws over the yard.)
    when: (_s, k, n) => k >= n - 30,
    zoom: 1.8,
    dz: -1.5,
  },
  weather: { prison: 'stalag-flucht', route: 'tunnel', when: (_s, k, n) => k >= n - 30, zoom: 2.2, dz: -0.5 },
  shell: { prison: 'shankton', route: 'rooftop', when: (_s, k, n) => k >= n - 60, zoom: 1.5, dz: 2.5, light: 1050 },
  mines: { prison: 'san-pancho', route: 'gate', when: (_s, k, n) => k >= n - 40, zoom: 1.3, light: 1050 },
  island: { prison: 'irongate', route: 'raft', when: (_s, k, n) => k >= n - 2, live: 1.2, light: 660, zoom: 2, dx: -2 },
};

const view = () => (window as unknown as { __view: View }).__view;
const frames = (n: number) => new Promise<void>((done) => {
  const step = (k: number) => (k ? requestAnimationFrame(() => step(k - 1)) : done());
  step(n);
});

/** A route played through once (kept: the moments are picked from it again and again). */
const runs = new Map<string, Bot>();
function run(s: Shot): Bot {
  if (s.lesson) {
    const k = LESSONS.findIndex((l) => l.id === s.lesson);
    const lesson = LESSONS[k];
    const bot = new Bot(lesson.prison ?? TRAINING, lesson.seed ?? 7 + k);
    lesson.setup(bot.sim);
    s.moves!(bot);
    return bot;
  }
  const { prison = '', route = 'cutout' } = s;
  const key = `${prison}/${route}`;
  let bot = runs.get(key);
  if (!bot) {
    const plan = PLANS.find((p) => p.def.id === prison);
    if (!plan) throw new Error(`no plan for ${prison}`);
    bot = runRoute(plan, route) ?? undefined;
    if (!bot) throw new Error(`${key}: no run`);
    runs.set(key, bot);
  }
  return bot;
}

/** The game at a shot's moment, on screen, paused, the HUD hidden; what it shows (for checking). */
export async function stage(id: string, over: Partial<Shot> = {}) {
  const s = { ...SHOTS[id], ...over };
  const bot = run(s);
  const n = bot.cmds.length;
  const sim = new Sim(bot.sim.prison, 1);
  sim.restore(bot.start!);
  let k = 0;
  while (k < n && !s.when(sim, k, n)) sim.step(bot.cmds[k++]);
  const end = Math.max(0, Math.min(n - 1, k + (s.after ?? 0)));
  if (end < k) {
    // (Back from the moment: played again from the start, up to that step.)
    sim.restore(bot.start!);
    k = 0;
  }
  while (k < end) sim.step(bot.cmds[k++]);
  if (play.game) endGame();
  daylight(s.light);
  offset(0, 0);
  startGame(sim, true);
  hideUi(true);
  // (Played on, the run goes on as it went: its commands, not the controls'.)
  const step = sim.step.bind(sim);
  sim.step = () => step(bot.cmds[Math.min(k++, n - 1)]);
  await frames(3);
  if (s.live) await new Promise((r) => setTimeout(r, s.live! * 1000));
  // Held still: the sim steps no more, but the game isn't paused (its markers, a glide's ring, still drawn).
  sim.step = () => {};
  // No floor arrows in the picture (the guide never looks again: its clock wound far back).
  const g = play.game!;
  g.guide = null;
  g.guideAge = -1e9;
  g.guideFrom = Math.floor(sim.state.player.z / UNIT) * 64 + Math.floor(sim.state.player.x / UNIT);
  const v = view() as unknown as { zoom: number; zoomGoal: number; applyZoom(): void };
  v.zoom = v.zoomGoal = s.zoom ?? 1.4;
  v.applyZoom();
  offset(s.dx ?? 0, s.dz ?? 0);
  await frames(40);
  return { step: k, of: n, tile: [tileX(sim), tileZ(sim)], layer: sim.state.layer, minute: sim.clock.minuteOfDay };
}

/** Every frame drawn at this hour (undefined: its own). */
let drawn: View['draw'] | null = null;
function daylight(minute: number | undefined) {
  const v = view();
  if (drawn) v.draw = drawn;
  drawn = null;
  if (minute === undefined) return;
  const own = v.draw.bind(v);
  drawn = v.draw;
  // (By day the searchlights are off: none drawn.)
  v.draw = (f, dt, time) => own({ ...f, minuteOfDay: minute, security: f.security && { ...f.security, beams: null } }, dt, time);
}

/**
 * The camera aimed this far (tiles) off the player: where it eases toward each frame, or is put
 * outright in the tunnels (the view's own target, so what it works out from the camera, the
 * see-through cut, still fits).
 */
function offset(dx: number, dz: number) {
  const target = (view() as unknown as { target: THREE.Vector3 }).target;
  delete (target as Partial<THREE.Vector3>).lerp;
  delete (target as Partial<THREE.Vector3>).set;
  if (!dx && !dz) return;
  const to = new THREE.Vector3();
  target.lerp = (v, a) => THREE.Vector3.prototype.lerp.call(target, to.set(v.x + dx, v.y, v.z + dz), a);
  // (In the tunnels the camera is put on the player outright.)
  target.set = (x, y, z) => THREE.Vector3.prototype.set.call(target, x + dx, y, z + dz);
}

function hideUi(on: boolean) {
  let st = document.getElementById('helpshot-style');
  if (!st) {
    st = document.createElement('style');
    st.id = 'helpshot-style';
    st.textContent = 'body.helpshot > *:not(canvas) { visibility: hidden !important; }';
    document.head.append(st);
  }
  document.body.classList.toggle('helpshot', on);
}

/** The next frame drawn, cropped to the picture's shape (the middle of the screen, `dx`/`dz` tiles off). */
function grabFrame(): Promise<HTMLCanvasElement> {
  const v = view();
  const r = v.renderer;
  const draw = r.render.bind(r);
  return new Promise((resolve) => {
    r.render = (scene, cam) => {
      draw(scene, cam);
      r.render = draw;
      const src = r.domElement;
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const scale = Math.min(src.width / W, src.height / H);
      const sw = W * scale;
      const sh = H * scale;
      out.getContext('2d')!.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, W, H);
      resolve(out);
    };
  });
}

/** A shot taken and sent to the sink (public/help/<id>.webp); its size in kB. */
export async function take(id: string, over: Partial<Shot> = {}) {
  const at = await stage(id, over);
  const c = await grabFrame();
  const blob = await new Promise<Blob>((done) => c.toBlob((b) => done(b!), 'image/webp', 0.8));
  const res = await fetch(`http://127.0.0.1:5311/?name=${id}.webp`, { method: 'POST', body: blob });
  if (!res.ok) throw new Error(`${id}: the sink said ${res.status}`);
  return { id, kB: Math.round(blob.size / 1000), ...at };
}

/** Back to the title. */
export function done() {
  if (play.game) endGame();
  daylight(undefined);
  offset(0, 0);
  hideUi(false);
}

export async function all() {
  const out = [];
  for (const id of Object.keys(SHOTS)) out.push(await take(id));
  done();
  return out;
}
