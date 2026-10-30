/**
 * A match's camera (P29), the arithmetic alone (View.framePitch applies it): both goals in the
 * picture, and the player too when he strays off the pitch (a match goes on PITCH_LEAVE tiles
 * away). Pure, so scripts/pitchframetest.ts checks it on every prison's pitch and screen shape.
 */
import type { Pitch } from '../content/prisons/types';

/** How much ground a screen's height holds over its own height (the camera looks down at about 58°). */
const PITCH_DEPTH = 1.18;
/** The look-ahead's longest pull in a match (tiles, both ways summed): short of the 10 that cut the camera back to the player. */
export const PITCH_PULL = 9;

/** The player's zoom range (the wheel, pinch, a match's fit). */
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 1.9;
/** At zoom 1 the screen is about SCREEN_ROWS tiles tall, never under SCREEN_COLS wide (phones in portrait see more rows instead). */
export const SCREEN_ROWS = 15;
export const SCREEN_COLS = 11;

/** What the screen holds at zoom 1 (tiles): across, and down the ground (stretched by the camera's tilt), as View.applyZoom sets the camera. */
export function screenTiles(aspect: number): { wide: number; deep: number } {
  return { wide: Math.max(SCREEN_ROWS * aspect, SCREEN_COLS), deep: Math.max(SCREEN_ROWS, SCREEN_COLS / aspect) * PITCH_DEPTH };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The zoom that fits the box (the pitch with a tile round it, and the player with a tile round
 * him) across the screen, within [ZOOM_MIN, ZOOM_MAX]; and the look-ahead wanted (tiles from the player)
 * at the current `zoom`: the screen's middle within slack of the box's middle, or, the box wider
 * than the screen (the zoom still easing out, or at its least), as near it as keeps the player in.
 */
export function pitchFraming(
  p: Pitch,
  px: number,
  pz: number,
  ahead: { x: number; z: number },
  zoom: number,
  aspect: number,
): { fit: number; x: number; z: number } {
  const { wide, deep } = screenTiles(aspect);
  // (A tile's margin round the pitch, but less past the goal lines: the goals stand just behind them, P31's bigger pitches.)
  const mx = p.w >= p.d ? 0.4 : 1;
  const mz = p.w >= p.d ? 1 : 0.4;
  const x0 = Math.min(p.x - mx, px - 1);
  const x1 = Math.max(p.x + p.w + mx, px + 1);
  const z0 = Math.min(p.z - mz, pz - 1);
  const z1 = Math.max(p.z + p.d + mz, pz + 1);
  const fit = clamp(Math.min(wide / (x1 - x0), deep / (z1 - z0)), ZOOM_MIN, ZOOM_MAX);
  const k = Math.max(zoom, 1e-3);
  const along = (at: number, lead: number, lo: number, hi: number, span: number) => {
    const half = span / k / 2;
    const slack = half - (hi - lo) / 2;
    const mid = (lo + hi) / 2;
    return (slack >= 0 ? clamp(at + lead, mid - slack, mid + slack) : clamp(mid, at - half + 1, at + half - 1)) - at;
  };
  let x = along(px, ahead.x, x0, x1, wide);
  let z = along(pz, ahead.z, z0, z1, deep);
  const pull = Math.abs(x) + Math.abs(z);
  if (pull > PITCH_PULL) {
    x *= PITCH_PULL / pull;
    z *= PITCH_PULL / pull;
  }
  return { fit, x, z };
}
