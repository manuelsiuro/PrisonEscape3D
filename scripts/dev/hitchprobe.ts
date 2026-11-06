// Dev tool, run in the browser on the dev server: the hitches and the memory of a long game (session 6).
// Every frame is timed; a slow one is kept with what it did: shaders compiled (the renderer's program
// count grew), the heap shrinking under it (a garbage collection), the game's minute, and the long
// animation frame's scripts where the browser reports them. Memory is sampled as it goes: the JS heap,
// the graphics objects (geometries, textures, programs), the page's elements.
//   const hp = await import('/scripts/dev/hitchprobe.ts');
//   await hp.day('center-perks', 1, 30);     // a day from 07:00 at ×30, the player standing by
//   await hp.watch(20);                      // 20 s of whatever's on screen, at its own speed
//   await hp.prisons(3);                     // every prison staged 3 times: what's left behind
import { play } from '../../src/play/game';
import * as THREE from 'three';
import { renderer, view } from '../../src/play/context';
import { at } from './playat';

type Slow = { at: number; ms: number; programs: number; heapDrop: number; minute: number | null; scripts: string };
type Sample = { t: number; heapMB: number; geometries: number; textures: number; programs: number; nodes: number };

const SLOW_MS = 34;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const heap = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
const programs = () => renderer.info.programs?.length ?? 0;

let rec: { gaps: number[]; slow: Slow[]; compiled: number; gcs: number } | null = null;
let hooked = false;
const loaf: Array<{ start: number; dur: number; scripts: string }> = [];

function hook() {
  if (hooked) return;
  hooked = true;
  const raf = window.requestAnimationFrame.bind(window);
  let last = 0;
  window.requestAnimationFrame = (cb) =>
    raf((now) => {
      const p0 = programs();
      const h0 = heap();
      cb(now);
      const r = rec;
      if (r && last) {
        const gap = now - last;
        r.gaps.push(gap);
        const added = programs() - p0;
        const drop = h0 - heap();
        if (added > 0) r.compiled += added;
        if (drop > 1 << 20) r.gcs++;
        if (gap >= SLOW_MS)
          r.slow.push({
            at: Math.round(now),
            ms: Math.round(gap),
            programs: added,
            heapDrop: Math.round(drop / 1024),
            minute: play.game?.rec.sim.clock.minuteOfDay ?? null,
            scripts: '',
          });
      }
      last = now;
    });
  // Long animation frames (Chrome 123+): which scripts ran in them.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as Array<{
        startTime: number;
        duration: number;
        scripts?: Array<{ sourceFunctionName?: string; invoker?: string; duration: number }>;
      }>)
        loaf.push({
          start: e.startTime,
          dur: e.duration,
          scripts: (e.scripts ?? [])
            .filter((s) => s.duration > 5)
            .map((s) => `${s.sourceFunctionName || s.invoker || '?'} ${Math.round(s.duration)}`)
            .join(', '),
        });
    }).observe({ type: 'long-animation-frame', buffered: false });
  } catch {
    /* not in this browser */
  }
}

function sample(t0: number): Sample {
  const m = renderer.info.memory;
  return {
    t: Math.round((performance.now() - t0) / 1000),
    heapMB: +(heap() / 1048576).toFixed(1),
    geometries: m.geometries,
    textures: m.textures,
    programs: programs(),
    nodes: document.getElementsByTagName('*').length,
  };
}

const pct = (a: number[], p: number) =>
  a.length ? Math.round([...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]) : 0;

function report(samples: Sample[]) {
  const r = rec!;
  rec = null;
  for (const s of r.slow) {
    const l = loaf.find((e) => Math.abs(e.start + e.dur - s.at) < 40 || (s.at >= e.start && s.at <= e.start + e.dur + 20));
    if (l) s.scripts = l.scripts;
  }
  loaf.length = 0;
  const first = samples[0];
  const lastS = samples[samples.length - 1];
  return {
    frames: r.gaps.length,
    gap50: pct(r.gaps, 0.5),
    gap99: pct(r.gaps, 0.99),
    slow: r.slow.length,
    slowWithCompile: r.slow.filter((s) => s.programs > 0).length,
    compiled: r.compiled,
    gcFrames: r.gcs,
    worst: [...r.slow].sort((a, b) => b.ms - a.ms).slice(0, 12),
    memory: samples.length ? { first, last: lastS, peakHeapMB: Math.max(...samples.map((s) => s.heapMB)) } : null,
    samples,
  };
}

/** A prison's day from 07:00 (the model prisoner's morning up to then), run at `speed` with the player standing by, to 07:00 the day after. */
export async function day(prison: string, dayNo = 1, speed = 30, startMinute = 7 * 60) {
  hook();
  await at(prison, dayNo, startMinute);
  await wait(1500);
  const g = play.game!;
  const t0 = performance.now();
  const samples: Sample[] = [sample(t0)];
  rec = { gaps: [], slow: [], compiled: 0, gcs: 0 };
  g.speed = speed;
  const startDay = g.rec.sim.clock.day;
  let next = performance.now() + 2000;
  while (play.game === g && !g.over && g.rec.sim.clock.day === startDay) {
    await wait(250);
    if (performance.now() >= next) {
      samples.push(sample(t0));
      next += 2000;
    }
  }
  // (To the next morning: the night passes too.)
  while (play.game === g && !g.over && g.rec.sim.clock.minuteOfDay < startMinute) {
    await wait(250);
    if (performance.now() >= next) {
      samples.push(sample(t0));
      next += 2000;
    }
  }
  g.speed = 1;
  samples.push(sample(t0));
  return { prison, ended: g.over ? 'game over' : `day ${g.rec.sim.clock.day} ${g.rec.sim.clock.minuteOfDay}`, ...report(samples) };
}

/** Whatever's on screen, at its own speed, for `seconds`. */
export async function watch(seconds = 20) {
  hook();
  const t0 = performance.now();
  const samples: Sample[] = [sample(t0)];
  rec = { gaps: [], slow: [], compiled: 0, gcs: 0 };
  const end = t0 + seconds * 1000;
  while (performance.now() < end) {
    await wait(1000);
    samples.push(sample(t0));
  }
  return report(samples);
}

/** Every prison staged `rounds` times over (as a long session moving between them does): what each round leaves. */
export async function prisons(rounds = 3) {
  hook();
  const list = ['training', 'center-perks', 'stalag-flucht', 'shankton', 'irongate', 'san-pancho'];
  const t0 = performance.now();
  const out: Array<Sample & { round: number }> = [];
  rec = { gaps: [], slow: [], compiled: 0, gcs: 0 };
  for (let k = 0; k < rounds; k++) {
    for (const p of list) {
      await at(p, 1, 9 * 60);
      await wait(800);
    }
    await wait(1500);
    out.push({ round: k + 1, ...sample(t0) });
  }
  const r = report([]);
  return { rounds: out, slow: r.slow, compiled: r.compiled, worst: r.worst };
}

/**
 * What holds the graphics memory: the geometries and textures reachable from the scene, by the part of
 * the view that holds them (its field's name), against what the renderer has on the graphics card (the
 * difference: freed by nobody, or held outside the scene).
 */
export function census() {
  const v = view as unknown as Record<string, unknown>;
  const names = new Map<THREE.Object3D, string>();
  const name = (o: unknown, n: string) => {
    if (o instanceof THREE.Object3D && !names.has(o)) names.set(o, n);
  };
  for (const [k, val] of Object.entries(v)) {
    if (!val || typeof val !== 'object') continue;
    name(val, k);
    const r = val as Record<string, unknown>;
    name(r.group, k);
    name(r.root, k);
    for (const [k2, v2] of Object.entries(r)) {
      if (!v2 || typeof v2 !== 'object') continue;
      name(v2, `${k}.${k2}`);
      name((v2 as Record<string, unknown>).group, `${k}.${k2}`);
      name((v2 as Record<string, unknown>).mesh, `${k}.${k2}`);
    }
  }
  const geos = new Set<THREE.BufferGeometry>();
  const texs = new Set<THREE.Texture>();
  const byPart = new Map<string, number>();
  const walk = (o: THREE.Object3D, part: string) => {
    const here = names.get(o) ?? part;
    const m = o as THREE.Mesh;
    if (m.geometry && !geos.has(m.geometry)) {
      geos.add(m.geometry);
      byPart.set(here, (byPart.get(here) ?? 0) + 1);
    }
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : [])
      for (const val of Object.values(mat)) if ((val as THREE.Texture)?.isTexture) texs.add(val as THREE.Texture);
    for (const c of o.children) walk(c, here);
  };
  walk(view.scene, 'scene');
  const m = renderer.info.memory;
  return {
    gpu: { geometries: m.geometries, textures: m.textures },
    inScene: { geometries: geos.size, textures: texs.size },
    byPart: [...byPart].sort((a, b) => b[1] - a[1]).slice(0, 20),
  };
}

/** One game run on for `n` days at `speed` (the player standing by): each morning's memory and census. */
export async function days(prison: string, n = 4, speed = 30) {
  hook();
  await at(prison, 1, 7 * 60);
  await wait(1500);
  const g = play.game!;
  const t0 = performance.now();
  rec = { gaps: [], slow: [], compiled: 0, gcs: 0 };
  const mornings: Array<Sample & { day: number; census: ReturnType<typeof census> }> = [{ day: 1, ...sample(t0), census: census() }];
  g.speed = speed;
  let seen = g.rec.sim.clock.day;
  while (play.game === g && !g.over && seen < 1 + n) {
    await wait(250);
    const c = g.rec.sim.clock;
    if (c.day > seen && c.minuteOfDay >= 7 * 60) {
      seen = c.day;
      mornings.push({ day: seen, ...sample(t0), census: census() });
    }
  }
  g.speed = 1;
  const r = report([]);
  return {
    prison,
    over: g.over,
    mornings,
    slow: r.slow,
    slowWithCompile: r.slowWithCompile,
    compiled: r.compiled,
    gcFrames: r.gcFrames,
    gap99: r.gap99,
    worst: r.worst,
  };
}
