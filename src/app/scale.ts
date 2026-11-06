/**
 * The interface's size (session 9, the user's pick: the whole interface grows, not the text alone). On a
 * phone or a tablet the page's viewport tag says how many of the screen's points make one CSS pixel, so
 * `initial-scale=1.3` lays the page out on a screen 1.3 times smaller and shows it 1.3 times bigger: the
 * cards, the HUD and the buttons grow together, and the stylesheets' rules for small screens apply as they
 * would on one (CSS `zoom` would grow the boxes but not the window the rules and the `vh` read, measured).
 * A desktop browser ignores the tag: its own zoom (Ctrl +) does the same there, and the setting says so; on an
 * iPhone or iPad, Safari's Page Zoom (`IOS` below).
 *
 * Capped so the page is never laid out on less than 300 points across the short side (the screen sweep
 * checked it there): a 412-wide phone gets 130%, the S24 (360) 120%, a phone turned in the browser
 * (274 tall) nothing until full screen. The 3D is drawn with as many pixels as before (`onScale`).
 */
import { fitScale } from '../game/settings';
import { MOBILE } from '../ui/dom';
/** An iPhone or iPad: its Safari zooms the page by a pinch whatever the tag says (that would read as the
 *  screen's size), and nobody here could try the tag there; its own Page Zoom (aA) does the same, and the row says so. */
export const IOS =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1));
/** Whether the viewport tag sizes the page here (Android phones and tablets). */
export const SCALES = MOBILE && !IOS;

const meta = typeof document === 'undefined' ? null : document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
const BASE = meta?.content ?? '';
let pick = 1;
let shown = 1;
let listener: (s: number) => void = () => {};

/** The scale applied now (the pick, or less on a small screen). */
export const uiScale = () => shown;

/** Told when the scale applied changes (the 3D's pixel ratio follows). */
export function onScale(f: (s: number) => void) {
  listener = f;
}

function fit() {
  if (!SCALES || !meta) return;
  // (The screen's own size: the window as laid out, times the scale it's shown at.)
  const z = globalThis.visualViewport?.scale ?? shown;
  const s = fitScale(pick, innerWidth * z, innerHeight * z);
  if (Math.abs(s - shown) < 0.01) return;
  shown = s;
  meta.content = s === 1 ? BASE : `initial-scale=${s}, minimum-scale=${s}, maximum-scale=${s}, user-scalable=no, viewport-fit=cover`;
  listener(s);
}

/** The player's pick (1, 1.15, 1.3), applied now and again as the screen turns or goes full screen. */
export function setUiScale(s: number) {
  pick = s;
  fit();
}

if (SCALES) addEventListener('resize', fit);
