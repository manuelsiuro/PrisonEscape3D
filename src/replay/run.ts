import { PRISONS } from '../content/prisons';
import type { RunLog } from '../sim/runlog';
import { scout, type ScoutProgress, type Scouted } from './scout';

/**
 * Starts the scout for a log (P25): in a worker, or (none to be had) on the main thread a few
 * milliseconds a frame. `onProgress` hears as it goes; the promise resolves with what it found
 * (null: the log can't be played here). `stop()` lets it go (the viewer closed).
 */
export function runScout(log: RunLog, onProgress: (p: ScoutProgress) => void): { done: Promise<Scouted | null>; stop: () => void } {
  let stopped = false;
  let worker: Worker | null = null;
  try {
    worker = new Worker(new URL('./scout.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (worker) {
    const w = worker;
    const done = new Promise<Scouted | null>((resolve) => {
      w.onmessage = (e: MessageEvent) => {
        if (stopped) return;
        const m = e.data as { type: 'progress'; progress: ScoutProgress } | { type: 'done'; result: Scouted } | { type: 'error' };
        if (m.type === 'progress') return onProgress(m.progress);
        w.terminate();
        resolve(m.type === 'done' ? m.result : null);
      };
      // (A worker that won't load: the main thread does it after all.)
      w.onerror = (ev) => {
        ev.preventDefault();
        w.terminate();
        if (!stopped) mainThread(log, onProgress, () => stopped).then(resolve);
      };
    });
    w.postMessage(log);
    return {
      done,
      stop: () => {
        stopped = true;
        w.terminate();
      },
    };
  }
  return { done: mainThread(log, onProgress, () => stopped), stop: () => void (stopped = true) };
}

/** The scout on the main thread: slices of about 6 ms, the frame given back between them. */
function mainThread(log: RunLog, onProgress: (p: ScoutProgress) => void, stopped: () => boolean): Promise<Scouted | null> {
  const prison = PRISONS.find((p) => p.id === log.prison);
  if (!prison) return Promise.resolve(null);
  let it: ReturnType<typeof scout>;
  try {
    it = scout(log, prison, 200);
  } catch {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const slice = () => {
      if (stopped()) return resolve(null);
      const t0 = performance.now();
      try {
        while (performance.now() - t0 < 6) {
          const r = it.next();
          if (r.done) return resolve(r.value);
          onProgress(r.value);
        }
      } catch {
        return resolve(null);
      }
      setTimeout(slice, 0);
    };
    slice();
  });
}
