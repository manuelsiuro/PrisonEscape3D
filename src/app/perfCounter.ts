import { currentLang, t } from '../i18n';
import { renderer, settings } from '../play/context';
import { h } from '../ui/dom';
import { perfHook } from './perf';
import { tierFor, TIERS } from './quality';

/**
 * The frame counter's code (perf.ts turns it on): every half second, over the game, the frames a
 * second, the main thread's time a frame (its mean and its slowest 5%), the graphics card's time a
 * frame where the browser has a timer for it (EXT_disjoint_timer_query_webgl2; most phones' don't),
 * the quality tier, the draw calls and triangles of the last frame (its shadow pass in them), the
 * canvas's pixels and the graphics card's name. Nothing it shows can be pressed.
 */
type Timer = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

/** Takes the counter down (null: it isn't up). */
let takeDown: (() => void) | null = null;

/** The counter comes down (the settings' switch turned off). */
export function hideCounter() {
  takeDown?.();
  takeDown = null;
}

export function showCounter() {
  if (takeDown) return;
  const el = h('div', 'perf-counter');
  el.setAttribute('aria-hidden', 'true');
  document.body.append(el);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as Timer | null;
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const card = cardName(String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)));
  const queries: WebGLQuery[] = [];
  let open: WebGLQuery | null = null;
  const work: number[] = [];
  const gpu: number[] = [];
  let frames = 0;
  let since = 0;

  perfHook.begin = () => {
    // (One time query at a time: none while another is running, a dev tool's.)
    if (!timer || open || gl.getQuery(timer.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return;
    open = gl.createQuery();
    if (open) gl.beginQuery(timer.TIME_ELAPSED_EXT, open);
  };
  perfHook.end = (ms, now) => {
    if (timer && open) {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      queries.push(open);
      open = null;
    }
    // The graphics card's answers come frames later. A disjoint (its clock changed) spoils every
    // one waiting; reading it clears it, so once a frame.
    if (timer && gl.getParameter(timer.GPU_DISJOINT_EXT)) for (const q of queries.splice(0)) gl.deleteQuery(q);
    while (timer && queries.length && gl.getQueryParameter(queries[0], gl.QUERY_RESULT_AVAILABLE)) {
      const q = queries.shift()!;
      gpu.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
    }
    work.push(ms);
    frames++;
    if (!since) since = now;
    if (now - since >= 500) {
      show(now - since);
      since = now;
    }
  };

  const num = (n: number, digits = 1) =>
    new Intl.NumberFormat(currentLang(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const modes = { auto: 'settings.auto', high: 'settings.high', low: 'settings.low' } as const;

  function show(span: number) {
    const sorted = [...work].sort((x, y) => x - y);
    const worst = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
    const info = renderer.info.render;
    const canvas = renderer.domElement;
    el.textContent = [
      `${t('perf.fps', { n: Math.round((frames * 1000) / span) })} · ${t('perf.frame', { ms: num(mean(work)), worst: num(worst) })}`,
      `${timer ? t('perf.gpu', { ms: gpu.length ? num(mean(gpu)) : '…' }) : t('perf.gpuNone')} · ${t('perf.quality', {
        n: TIERS.length - tierFor(settings.quality),
        mode: t(modes[settings.quality]),
      })}`,
      `${t('perf.drawn', { calls: info.calls, tris: Math.round(info.triangles / 1000) })} · ${canvas.width}×${canvas.height}`,
      card,
    ].join('\n');
    work.length = gpu.length = 0;
    frames = 0;
  }

  // (Taken down between frames: no time query is open then, only answers still waiting.)
  takeDown = () => {
    perfHook.begin = perfHook.end = null;
    for (const q of queries.splice(0)) gl.deleteQuery(q);
    el.remove();
  };
}

/**
 * The graphics card's name from what the browser calls it: "ANGLE (Apple, ANGLE Metal Renderer: Apple M4
 * Pro, Unspecified Version)" → "Apple M4 Pro"; "ANGLE (Samsung Electronics Co. Ltd., ANGLE ((Samsung
 * Xclipse 940) on Vulkan 1.3.304), OpenGL ES 3.2)" → "Samsung Xclipse 940 · Vulkan"; "ANGLE (Qualcomm,
 * Adreno (TM) 740, OpenGL ES 3.2)" → "Adreno (TM) 740"; "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060
 * (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)" → "NVIDIA GeForce RTX 3060".
 */
export function cardName(raw: string): string {
  const inner = /^ANGLE \((.*)\)$/.exec(raw)?.[1];
  if (!inner) return raw.slice(0, 48);
  const vulkan = /ANGLE \(\((.+?)\) on (\w+)/.exec(inner);
  if (vulkan) return `${vulkan[1]} · ${vulkan[2]}`;
  const metal = /Renderer: ([^,]+)/.exec(inner);
  if (metal) return metal[1];
  const parts = inner.split(', ');
  return (parts[1] ?? parts[0]).replace(/\s*\(0x[0-9a-f]+\).*$/i, '').slice(0, 48);
}
