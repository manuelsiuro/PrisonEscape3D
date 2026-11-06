import { buzz } from '../app/haptics';
import { WAVED_STEPS } from '../content/getaways';
import { t } from '../i18n';
import type { Sim, SimEvent } from '../sim/Sim';
import { STEPS_PER_SECOND } from '../sim/tuning';
import { banner, itemsUI, sound, view } from './context';
import { coachOnce } from './tips';
import { play } from './game';
import { glideSecs } from '../render/Getaway';

/**
 * Bluff & glider on screen (P24): the chip while the checkpoint's gates stand open, and the toasts and
 * sounds of being waved through and of a glide (the action button's words at its window: labels.ts).
 */

/** Seconds the checkpoint's gates stay open for the player (`a`: the frame's way into the next step), null while they're shut. */
export function wavedLeft(sim: Sim, a: number): number | null {
  const s = sim.state;
  if (!s.waved) return null;
  return Math.max(0, (s.waved - s.step - a) / STEPS_PER_SECOND);
}

/** The gates' chip runs this long when full. */
const WAVED_SECS = WAVED_STEPS / STEPS_PER_SECOND;

/** What the bluff and a glide sound and say. */
export function announceGetaway(sim: Sim, e: Extract<SimEvent, { type: 'bluff' } | { type: 'glide' }>) {
  if (e.type === 'bluff') {
    if (e.on) {
      sound.stamp();
      buzz('attended');
      banner.toast(t('toast.bluff', { n: WAVED_SECS }), 'good', 4200);
      coachOnce('waved', 'hint.waved');
    } else if (!sim.state.escaped) {
      sound.gateShut();
      itemsUI.toast(t('toast.bluffOver'));
    }
    return;
  }
  // A glide: the run-up and the rush of air, then down (inside: where, said once it lands).
  const out = sim.state.escaped > 0;
  sound.glide(view.reducedMotion ? 0.4 : glideSecs(e.dist));
  const dist = e.dist;
  const game = play.game;
  void view.glide(e.from, e.to, dist, out).then(() => {
    // (Not into another game: quit or loaded while it was in the air.)
    if (play.game !== game) return;
    sound.touchdown();
    if (!out) banner.toast(t(dist === 1 ? 'toast.glideInOne' : 'toast.glideIn', { n: dist }), 'bad', 3600);
  });
}
