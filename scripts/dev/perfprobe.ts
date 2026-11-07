// Dev tool, run in the browser on the dev server: what a frame costs, in every prison at the day's
// busy moments (session 5, the phone performance pass). For each scene: the frame's main-thread time
// split into the rest (the sim, the HUD, the overlay), the view's update and the render's submission,
// the frames' real interval, the draw calls and triangles (the shadow pass apart), the GPU's time when
// the browser exposes its timer, and which part of the scene the calls come from.
//   const pp = await import('/scripts/dev/perfprobe.ts');
//   await pp.measure(3);                  // the game on screen as it is, for 3 s
//   const rows = await pp.scenes();       // every prison × moment (or pp.scenes([['irongate', 1, 490]]))
//   await pp.check();                     // every scene against perfbudget.json: what's drawn grew?
//   await pp.record();                    // the new perfbudget.json's text, after a change meant to draw more
// Run it with the phone's profile in DevTools (412×915 at 2.625, mobile, touch, an Android user agent: the
// phone's quality tier; the CPU slowed 4× for the times), in an isolated context.
import * as THREE from 'three';
import { renderer, view } from '../../src/play/context';
import { perfHook } from '../../src/app/perf';
import { at } from './playat';
import budget from './perfbudget.json';

const MOMENTS = [7 * 60 + 50, 8 * 60 + 2, 12 * 60 + 10, 15 * 60 + 5, 18 * 60 + 40, 23 * 60 + 30];
const PRISONS = ['training', 'center-perks', 'stalag-flucht', 'shankton', 'irongate', 'san-pancho', 'six-hunter'];

type Acc = { frames: number; total: number[]; view: number[]; render: number[]; gaps: number[]; gpu: number[] };
let acc: Acc | null = null;
let inShadow = false;
const calls = {
  main: 0,
  shadow: 0,
  tri: 0,
  by: new Map<string, number>(),
  triBy: new Map<string, number>(),
  shadowBy: new Map<string, number>(),
};

/** Triangles one draw sends (instances counted; a group's range when drawn by group). */
function trisOf(geo: THREE.BufferGeometry, obj: THREE.Object3D, group: { count: number } | null): number {
  const n = group ? group.count : geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0);
  const draw = Math.min(n, geo.drawRange.count);
  const inst = (obj as THREE.InstancedMesh).isInstancedMesh ? (obj as THREE.InstancedMesh).count : 1;
  return (obj as THREE.Mesh).isMesh ? (draw / 3) * inst : 0;
}
let hooked = false;

/** The part of the scene an object belongs to: the view's field holding its top group. */
function partOf(o: THREE.Object3D): string {
  let top = o;
  while (top.parent && top.parent.type !== 'Scene') top = top.parent;
  return labels.get(top) ?? (top.name || top.type);
}
const labels = new Map<THREE.Object3D, string>();
function label() {
  labels.clear();
  const v = view as unknown as Record<string, unknown>;
  const put = (o: unknown, name: string) => {
    if (o instanceof THREE.Object3D) labels.set(o, name);
  };
  for (const [k, val] of Object.entries(v)) {
    if (!val || typeof val !== 'object') continue;
    put(val, k);
    const r = val as Record<string, unknown>;
    put(r.group, k);
    put(r.root, k);
    put(r.roofs, `${k}.roofs`);
    put(r.lantern, `${k}.lantern`);
    if (Array.isArray(val)) for (const c of val) put((c as Record<string, unknown>)?.root, k);
    for (const [k2, v2] of Object.entries(r)) {
      if (Array.isArray(v2)) for (const c of v2) put((c as Record<string, unknown>)?.root, `${k}.${k2}`);
    }
  }
  put((view as unknown as { player: { root: unknown } }).player?.root, 'player');
}

let gl: WebGL2RenderingContext;
let timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
const queries: WebGLQuery[] = [];

function hook() {
  if (hooked) return;
  hooked = true;
  gl = renderer.getContext() as WebGL2RenderingContext;
  timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const rbd = renderer.renderBufferDirect.bind(renderer);
  renderer.renderBufferDirect = (cam, scene, geo, mat, obj, group) => {
    if (acc) {
      const p = partOf(obj);
      const t = trisOf(geo, obj, group as { count: number } | null);
      if (inShadow) {
        calls.shadow++;
        calls.shadowBy.set(p, (calls.shadowBy.get(p) ?? 0) + t);
      } else {
        calls.main++;
        calls.by.set(p, (calls.by.get(p) ?? 0) + 1);
        calls.triBy.set(p, (calls.triBy.get(p) ?? 0) + t);
      }
    }
    rbd(cam, scene, geo, mat, obj, group);
  };
  const sm = renderer.shadowMap as unknown as { render: (...a: unknown[]) => void };
  const smr = sm.render.bind(sm);
  sm.render = (...a) => {
    inShadow = true;
    smr(...a);
    inShadow = false;
  };
  const rr = renderer.render.bind(renderer);
  renderer.render = (scene, cam) => {
    if (!acc) return rr(scene, cam);
    let q: WebGLQuery | null = null;
    // (One time query at a time: none while another is running.)
    if (timer && !gl.getQuery(timer.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) {
      q = gl.createQuery();
      gl.beginQuery(timer.TIME_ELAPSED_EXT, q!);
    }
    const t = performance.now();
    rr(scene, cam);
    acc.render.push(performance.now() - t);
    calls.tri += renderer.info.render.triangles;
    if (q && timer) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      queries.push(q);
    }
  };
  const draw = view.draw.bind(view);
  view.draw = (...a) => {
    const t = performance.now();
    draw(...a);
    acc?.view.push(performance.now() - t);
  };
  const raf = window.requestAnimationFrame.bind(window);
  let last = 0;
  window.requestAnimationFrame = (cb) =>
    raf((now) => {
      const t = performance.now();
      cb(now);
      if (acc) {
        acc.frames++;
        acc.total.push(performance.now() - t);
        if (last) acc.gaps.push(now - last);
      }
      last = now;
    });
}

/** The graphics card's answers, as they come in; a disjoint (its clock changed) spoils every one waiting, read once a poll (reading it clears it). */
function pollQueries() {
  if (!timer || !acc) return;
  if (gl.getParameter(timer.GPU_DISJOINT_EXT)) {
    for (const q of queries.splice(0)) gl.deleteQuery(q);
    return;
  }
  while (queries.length) {
    const q = queries[0];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
    acc.gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(q);
    queries.shift();
  }
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(1);
};
const mean = (a: number[]) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : 0);

/** The game on screen as it is, measured for `seconds`. */
export async function measure(seconds = 3) {
  hook();
  label();
  // (The frame counter's own time query, when it's on, set aside meanwhile: one runs at a time.)
  const counter = { begin: perfHook.begin, end: perfHook.end };
  perfHook.begin = perfHook.end = null;
  acc = { frames: 0, total: [], view: [], render: [], gaps: [], gpu: [] };
  calls.main = calls.shadow = calls.tri = 0;
  calls.by.clear();
  calls.triBy.clear();
  calls.shadowBy.clear();
  const end = performance.now() + seconds * 1000;
  while (performance.now() < end) {
    await wait(100);
    pollQueries();
  }
  await wait(200);
  pollQueries();
  const a = acc;
  acc = null;
  perfHook.begin = counter.begin;
  perfHook.end = counter.end;
  const n = Math.max(1, a.render.length);
  const top = (m: Map<string, number>, k = 1) =>
    [...m]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 12)
      .map(([name, c]) => `${name} ${Math.round(c / n / k)}`)
      .join(', ');
  const by = top(calls.by);
  const rest = a.total.map((t, i) => t - (a.view[i] ?? 0));
  return {
    fps: +(1000 / mean(a.gaps)).toFixed(0),
    gap95: pct(a.gaps, 0.95),
    frame: mean(a.total),
    frame95: pct(a.total, 0.95),
    rest: mean(rest),
    view: mean(a.view.map((t, i) => t - (a.render[i] ?? 0))),
    render: mean(a.render),
    gpu: a.gpu.length ? mean(a.gpu) : null,
    calls: Math.round(calls.main / n),
    shadowCalls: Math.round(calls.shadow / n),
    tris: Math.round(calls.tri / n),
    px: `${renderer.domElement.width}×${renderer.domElement.height}`,
    by,
    /** Thousands of triangles by part, in the picture and in the shadow pass. */
    trisBy: top(calls.triBy, 1000),
    shadowTrisBy: top(calls.shadowBy, 1000),
  };
}

/** Every prison at the day's moments (waking, roll call, lunch, the yard, the evening, night), or the ones given. */
export async function scenes(list?: Array<[string, number, number]>, seconds = 3) {
  const todo = list ?? PRISONS.flatMap((p) => MOMENTS.map((m) => [p, 1, m] as [string, number, number]));
  const rows = [];
  for (const [prison, day, minute] of todo) {
    await at(prison, day, minute);
    await wait(1200);
    const r = await measure(seconds);
    const hh = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    rows.push({ scene: `${prison} d${day} ${hh}`, ...r });
    console.log('[perf]', JSON.stringify(rows.at(-1)));
  }
  return rows;
}

/** The phone's profile, as the budget was measured in: 412×915 upright, the phone's tier (1.5 pixels a point, shadows). */
function phoneProfile() {
  const c = renderer.domElement;
  if (c.width !== 618 || c.height !== 1372)
    throw new Error(
      `perfprobe: the canvas is ${c.width}×${c.height}, not a phone's 618×1372 (412×915 at 2.625, mobile, Android user agent)`,
    );
}

/**
 * Every scene against perfbudget.json (session 5): fails a scene whose draw calls, shadow-pass calls
 * or triangles grew by more than a sixth (a few calls come and go with who's in view). The
 * frame times are printed, not judged: they're this computer's.
 */
export async function check(): Promise<{ ok: boolean; over: string[]; lines: string[] }> {
  phoneProfile();
  const want = budget.scenes as Record<string, { calls: number; shadowCalls: number; tris: number }>;
  const rows = await scenes();
  const over: string[] = [];
  const lines = rows.map((r) => {
    const b = want[r.scene];
    const grew = !b
      ? ['not in the budget']
      : (['calls', 'shadowCalls', 'tris'] as const).filter((k) => r[k] > b[k] * 1.17 + 3).map((k) => `${k} ${r[k]} (budget ${b[k]})`);
    if (grew.length) over.push(`${r.scene}: ${grew.join(', ')}`);
    return `${r.scene} | ${r.fps} fps, ${r.frame} ms | ${r.calls}+${r.shadowCalls} calls, ${Math.round(r.tris / 1000)}k tris${grew.length ? ' | OVER' : ''}`;
  });
  return { ok: over.length === 0, over, lines };
}

/** The budget's new text (the browser can't write files: save it as scripts/dev/perfbudget.json). */
export async function record(): Promise<string> {
  phoneProfile();
  const rows = await scenes();
  const scenesNow = Object.fromEntries(rows.map((r) => [r.scene, { calls: r.calls, shadowCalls: r.shadowCalls, tris: r.tris }]));
  return JSON.stringify({ note: budget.note, scenes: scenesNow }, null, 2) + '\n';
}
