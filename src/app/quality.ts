import type { Settings } from '../game/settings';
import type { Quality, View } from '../render/View';
import { MOBILE } from '../ui/dom';

// ------------------------------------------------------------------ graphics quality
/** Tiers from best to lightest; "auto" starts by device and steps down while frames run slow. */
export const TIERS: Quality[] = [
  { shadows: 2048, softness: 3, pixelRatio: Math.min(devicePixelRatio, 2) },
  { shadows: 1024, softness: 1.6, pixelRatio: Math.min(devicePixelRatio, 1.5) },
  { shadows: 0, softness: 0, pixelRatio: 1 },
];
let tier = MOBILE ? 1 : 0;
/** The tier the setting asks for ("auto": wherever the governor has stepped it to). */
export const tierFor = (quality: Settings['quality']) => (quality === 'high' ? 0 : quality === 'low' ? 2 : tier);

/** The tier auto quality starts on; it never steps above it. */
const START = tier;
/**
 * Auto quality: if a few seconds of play average under 40 fps, step down one tier. After a
 * long smooth stretch (a busy scene has passed) it tries one tier up again; if that tier runs
 * slow too, it steps back down and stays there.
 */
const fps = { frames: 0, time: 0, smooth: 0 };
let settled = false;
let raised = false;
export function governQuality(dt: number, quality: Settings['quality'], view: View) {
  if (quality !== 'auto') return;
  fps.frames++;
  fps.time += dt;
  if (fps.time < 4) return;
  const rate = fps.frames / fps.time;
  fps.frames = fps.time = 0;
  if (rate < 40) {
    fps.smooth = 0;
    if (raised) settled = true;
    raised = false;
    if (tier < TIERS.length - 1) view.setQuality(TIERS[++tier]);
  } else if (rate >= 56 && !settled && tier > START) {
    fps.smooth += 4;
    if (fps.smooth >= 40) {
      fps.smooth = 0;
      raised = true;
      view.setQuality(TIERS[--tier]);
    }
  } else fps.smooth = 0;
}
