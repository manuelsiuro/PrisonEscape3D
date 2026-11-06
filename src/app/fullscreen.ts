/**
 * Full screen on a phone turned (session 8, the user's pick). In the browser a phone on its side has little
 * height left: the Galaxy S24's Chrome leaves 697×274, its address bar and Android's buttons taking the
 * rest, and the activities' cards don't fit there. Full screen gives it back (about 360, as installed).
 *
 * Asked at the first tap in a game with the phone turned (a browser grants it only on a tap), and once:
 * armed again by a new game, by turning the phone again or by coming back to the tab, so a player who
 * leaves it (Back) isn't asked at every tap. Not where the game is installed (full screen already), nor
 * where the browser can't (an iPhone's Safari, which hides its own bars when turned; a desktop).
 */
import { TOUCH } from '../ui/dom';

let armed = false;
// (A phone's height: a tablet turned has room enough, and its full screen would be a surprise.)
const landscape = typeof matchMedia === 'function' ? matchMedia('(orientation: landscape) and (max-height: 520px)') : null;
const installed = typeof matchMedia === 'function' ? matchMedia('(display-mode: fullscreen), (display-mode: standalone)') : null;

/** A game begins: its first tap with the phone turned asks for full screen. */
export function armFullscreen() {
  armed = true;
}

export function startFullscreen() {
  if (!TOUCH || !landscape || !document.fullscreenEnabled) return;
  landscape.addEventListener('change', () => {
    if (landscape.matches) armed = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') armed = true;
  });
  // (On the finger's lift: a touch's pointerdown doesn't count as a tap that may ask.)
  window.addEventListener(
    'pointerup',
    () => {
      if (!armed || !landscape.matches || installed?.matches || document.fullscreenElement) return;
      if (!document.body.classList.contains('is-playing')) return;
      armed = false;
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
        /* refused (no tap the browser counts, a frame): played as it is */
      });
    },
    { capture: true },
  );
}
