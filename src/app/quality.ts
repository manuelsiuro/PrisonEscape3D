import type { Settings } from '../game/settings';
import type { Quality, View } from '../render/View';
import { MOBILE } from '../ui/dom';

// ------------------------------------------------------------------ graphics quality
/** Tiers from best to lightest; "auto" starts by device and steps down while frames run slow. */
export const TIERS: Quality[] = [
  { shadows: 2048, pixelRatio: Math.min(devicePixelRatio, 2) },
  { shadows: 1024, pixelRatio: Math.min(devicePixelRatio, 1.5) },
  { shadows: 0, pixelRatio: 1 },
];
let tier = MOBILE ? 1 : 0;
/** The tier the setting asks for ("auto": wherever the governor has stepped it to). */
export const tierFor = (quality: Settings['quality']) => (quality === 'high' ? 0 : quality === 'low' ? 2 : tier);

/** Auto quality: if a few seconds of play average under 40 fps, step down one tier. */
const fps = { frames: 0, time: 0 };
export function governQuality(dt: number, quality: Settings['quality'], view: View) {
  if (quality !== 'auto' || tier >= TIERS.length - 1) return;
  fps.frames++;
  fps.time += dt;
  if (fps.time < 4) return;
  const rate = fps.frames / fps.time;
  fps.frames = fps.time = 0;
  if (rate < 40) {
    tier++;
    view.setQuality(TIERS[tier]);
  }
}
