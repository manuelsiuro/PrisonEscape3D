// Dev tool, run in the browser on the dev server: proves a render refactor draws the same pixels.
// Every scene below is played to its moment by the model prisoner, then driven frame by frame with a
// fixed clock and a seeded Math.random (the characters' idle glances, blinks, dust), and the canvas
// fingerprinted. Run it before and after, at the same window size, and compare the lines. A moved line
// that changes the order of Math.random calls shows up too, as it should: what's drawn changed.
//   const d = await import('/scripts/dev/drawhash.ts');
//   const lines = await d.run();          // [`center-perks d1 08:00 f30 <hash>`, …]
// Built for session 3 (splitting View.ts and Character.ts, v2.34.2); keep it for any render refactor.
import { play } from '../../src/play/game';
import { frame } from '../../src/play/loop';
import { renderer, view } from '../../src/play/context';
import { endGame } from '../../src/play/session';
import { LAYER } from '../../src/sim/world/World';
import type { Frame } from '../../src/render/viewFrame';
import { DEFAULT_PRISONER } from '../../src/content/prisoner';
import { at } from './playat';

/** [prison, day, minute]: waking, roll call, a job, lunch, the yard and gym, showers, night. */
const MOMENTS = [7 * 60 + 50, 8 * 60 + 2, 9 * 60 + 30, 12 * 60 + 10, 15 * 60 + 5, 18 * 60 + 40, 23 * 60 + 30];
const PRISONS = ['training', 'center-perks', 'stalag-flucht', 'shankton', 'irongate', 'san-pancho'];
/**
 * What the frames are forced to, for what a model prisoner's first day never shows (each at Center
 * Perks' 12:10 and Stalag Flucht's 23:30): a storm, fog in a heatwave, snow, a lockdown, a takeover,
 * the lights out, a lock-on, the vents, the roofs, the tunnels, knocked out.
 */
const FORCES: Record<string, (f: Frame) => void> = {
  storm: (f) => void (f.weather = { rain: 2, fog: 0, heat: false, windAngle: 1, windForce: 2, snow: false }),
  fogHeat: (f) => void (f.weather = { rain: 0, fog: 1, heat: true, windAngle: 0, windForce: 0, snow: false }),
  snow: (f) => void (f.weather = { rain: 1, fog: 0, heat: false, windAngle: 2, windForce: 1, snow: true }),
  alarm: (f) => void (f.alarm = true),
  takeover: (f) => void (f.takeover = true),
  dark: (f) => void (f.blockDark = true),
  lockOn: (f) => void ((f.lock = 0), (f.lockHostile = true)),
  vents: (f) => void (f.layer = LAYER.VENTS),
  roof: (f) => void (f.layer = LAYER.ROOF),
  under: (f) => void (f.layer = LAYER.UNDER),
  ko: (f) => void (f.knockedOut = true),
};
/** What's done to the view before the frames: the escape camera, the picture slid for a panel, zoomed in. */
const ACTS: Record<string, () => void> = {
  cinema: () => void view.cinema(true, false),
  shift: () => view.setShift(260, 40),
  zoom: () => view.zoomBy(1.7),
};
type Scene = [string, number, number, string?];
export const SCENES: Scene[] = [
  ...PRISONS.flatMap((p) => MOMENTS.map((m) => [p, 1, m] as Scene)),
  ...['center-perks|730', 'stalag-flucht|1410'].flatMap((pm) => {
    const [p, m] = pm.split('|');
    return [...Object.keys(FORCES), ...Object.keys(ACTS)].map((force) => [p, 1, Number(m), force] as Scene);
  }),
];
/** Frames at which the canvas is fingerprinted (60 a second). */
const SHOTS = [1, 30, 90];

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function sha(s: string): Promise<string> {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)]
    .slice(0, 8)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * The whole check on a freshly loaded page (a view that has drawn before eases from where it was):
 * the first call keeps the lines as the baseline in this browser context; later ones list what
 * differs from it. `fresh` forgets the baseline first.
 */
export async function check(fresh = false): Promise<{ kept: boolean; lines: number; differ: string[] }> {
  const KEY = 'drawhash.base';
  if (fresh) localStorage.removeItem(KEY);
  const lines = await run();
  const base = localStorage.getItem(KEY);
  if (!base) {
    localStorage.setItem(KEY, JSON.stringify(lines));
    return { kept: true, lines: lines.length, differ: [] };
  }
  const was: string[] = JSON.parse(base);
  const differ = lines.filter((l, i) => l !== was[i]).map((l) => `${l} (was ${was.find((w) => w.startsWith(l.slice(0, -16))) ?? '—'})`);
  if (lines.length !== was.length) differ.push(`lines ${lines.length}, was ${was.length}`);
  return { kept: false, lines: lines.length, differ };
}

export async function run(scenes = SCENES): Promise<string[]> {
  const realRaf = window.requestAnimationFrame;
  const realRandom = Math.random;
  const out: string[] = [];
  // The loop stops: only the frames called here are drawn.
  window.requestAnimationFrame = () => 0;
  try {
    // The title screen first (no game), then each scene.
    Math.random = seeded(1);
    if (play.game) endGame();
    const shots: string[] = [];
    let now = 1000;
    play.last = now;
    for (let f = 1; f <= 30; f++) {
      now += 1000 / 60;
      frame(now);
      if (f === 30) shots.push(renderer.domElement.toDataURL());
    }
    out.push(`title f30 ${await sha(shots[0])}`);
    for (const [prison, day, minute, force] of scenes) {
      Math.random = seeded(day * 1440 + minute);
      await at(prison, day, minute);
      const forced = force ? FORCES[force] : null;
      if (forced) {
        const draw = view.draw.bind(view);
        view.draw = (f, dt, time) => {
          forced(f);
          draw(f, dt, time);
        };
      }
      ACTS[force ?? '']?.();
      const g = play.game!;
      g.paused = false;
      view.reducedMotion = false;
      const caught: Array<[number, string]> = [];
      now = 100_000;
      play.last = now;
      play.acc = 0;
      for (let f = 1; f <= SHOTS[SHOTS.length - 1]; f++) {
        now += 1000 / 60;
        frame(now);
        if (SHOTS.includes(f)) caught.push([f, renderer.domElement.toDataURL()]);
      }
      if (forced) delete (view as Partial<typeof view>).draw;
      if (force === 'shift') view.setShift(0, 0);
      for (const [f, url] of caught) out.push(`${prison} d${day} ${hhmm(minute)}${force ? ` ${force}` : ''} f${f} ${await sha(url)}`);
    }
    // Then the title again with the Intake's preview (your prisoner in the cell), and the map viewer's picture of the last prison.
    Math.random = seeded(2);
    endGame();
    view.setPreview(DEFAULT_PRISONER);
    view.previewTurn = 0.4;
    now = 200_000;
    play.last = now;
    for (let f = 1; f <= 45; f++) {
      now += 1000 / 60;
      frame(now);
      if (f === 45) shots.push(renderer.domElement.toDataURL());
    }
    view.setPreview(null);
    out.push(`preview f45 ${await sha(shots[1])}`);
    out.push(`mapShot ${await sha(view.mapShot(20, 1, true).canvas.toDataURL())}`);
  } finally {
    Math.random = realRandom;
    window.requestAnimationFrame = realRaf;
    realRaf(frame);
  }
  return out;
}
