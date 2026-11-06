import { t } from '../i18n';
import { h } from './dom';

/**
 * The veil over a game's start (session 6): building a prison and compiling its look holds the page
 * for 150–420 ms on a phone's CPU (Irongate the longest), the screen standing still meanwhile. The veil
 * goes up and is painted first, its bar sliding on the compositor through the wait, so the pause reads
 * as loading; the game's first frame takes it down (`hideLoading`, at the end of startGame and of a
 * world staged behind the title).
 *
 * It never stays up: every wait on frames also has a timer (a dev tool may stop the frames: drawhash
 * did, and the veil stayed for good), and a veil still up after `STUCK_MS` comes down whatever happened
 * (a start that threw would otherwise leave the screen blocked).
 */
let veil: HTMLElement | null = null;
/** Each time it's put up (a fade waiting for the next frames leaves a veil put up again since alone). */
let shown = 0;
let stuck = 0;
const STUCK_MS = 10_000;

/** Two frames, or `ms` if frames don't come (a dev tool stopping them; a tab in the background). */
const twoFrames = (ms: number) =>
  new Promise<void>((done) => {
    const timer = window.setTimeout(done, ms);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer);
        done();
      }),
    );
  });

function take(v: HTMLElement) {
  v.classList.remove('on');
  // (Off, out of the screen readers' way: a status line left in the page read as stale.)
  v.setAttribute('aria-hidden', 'true');
  clearTimeout(stuck);
}

/** Made at start, empty, so a screen reader hears its line when it's filled (a region made and filled at once often isn't read). */
function made(): HTMLElement {
  if (!veil) {
    veil = h('div', 'loading-veil', `<i></i><p></p>`);
    veil.setAttribute('role', 'status');
    veil.setAttribute('aria-hidden', 'true');
    document.body.append(veil);
  }
  return veil;
}
if (typeof document !== 'undefined' && document.body) made();

/** The veil up, and painted: resolves once the browser has shown it (two frames), so the work after it isn't seen as a freeze. */
export function showLoading(): Promise<void> {
  const v = made();
  v.removeAttribute('aria-hidden');
  v.querySelector('p')!.textContent = t('loading.prison');
  v.classList.add('on');
  shown++;
  clearTimeout(stuck);
  stuck = window.setTimeout(() => take(v), STUCK_MS);
  return twoFrames(150);
}

/**
 * The veil fades (nothing if it isn't up) once the game's first frame is drawn: two frames on, as that
 * first frame is long too (the prison sent to the graphics card: 170 ms on a phone's CPU), and seen
 * through a fading veil it read as a freeze.
 */
export function hideLoading() {
  if (!veil?.classList.contains('on')) return;
  const v = veil;
  const now = shown;
  void twoFrames(600).then(() => now === shown && take(v));
}

/** Runs heavy work (a prison built) with the veil up over it. */
export async function withLoading<T>(work: () => T): Promise<T> {
  await showLoading();
  try {
    return work();
  } finally {
    hideLoading();
  }
}
