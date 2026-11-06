import { prisonById } from '../content/prisons';
import { fitLog } from '../sim/runlog';
import { scout } from './scout';

/**
 * The scout in a worker (P25): the run played through off the main thread, its progress posted
 * as it goes (keyframes and highlights found so far), then what it found, or that it couldn't.
 */
const ctx = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage(m: unknown): void };

ctx.onmessage = (e) => {
  try {
    const log = fitLog(e.data);
    const prison = log && prisonById(log.prison);
    if (!log || !prison) return ctx.postMessage({ type: 'error' });
    const it = scout(log, prison);
    for (;;) {
      const r = it.next();
      if (r.done) return ctx.postMessage(r.value ? { type: 'done', result: r.value } : { type: 'error' });
      ctx.postMessage({ type: 'progress', progress: r.value });
    }
  } catch {
    ctx.postMessage({ type: 'error' });
  }
};
