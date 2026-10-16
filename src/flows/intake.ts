import { DEFAULT_PRISONER } from '../content/prisoner';
import { readPrisoner, writePrisoner } from '../game/prisoner';
import { unlockedCosmetics } from '../game/trophies';
import { click, view } from '../play/context';
import { PLAYER } from '../talk/fill';
import { showIntake } from '../ui/screens/intake';

/** Slides the title's picture so your prisoner stands in what the Intake's panel leaves free. */
function clearOfPanel() {
  const card = document.querySelector<HTMLElement>('.intake-card');
  if (!card) return view.setShift(0, 0);
  const r = card.getBoundingClientRect();
  const w = innerWidth;
  const h = innerHeight;
  if (r.left > w * 0.3) view.setShift(Math.round(r.left / 2 - w / 2), 0);
  else view.setShift(0, Math.round(r.top / 2 - h / 2));
}

/**
 * The Intake (P16): make (or remake) your prisoner over the title's picture, kept on this
 * device. `first`: before a first game; skipping keeps the plain jumpsuit and doesn't ask again;
 * Escape then means "not now": false, back to the title.
 */
export async function intakeFlow(first = false): Promise<boolean> {
  const start = readPrisoner() ?? DEFAULT_PRISONER;
  view.previewTurn = 0;
  view.setPreview(start);
  document.body.classList.add('intake-on');
  const shown = showIntake(start, { unlocked: unlockedCosmetics(), first, onChange: (p) => view.setPreview(p), onTurn: (r) => (view.previewTurn += r) }, click);
  // The panel's size follows the part shown: the picture follows the panel.
  const card = document.querySelector<HTMLElement>('.intake-card');
  const watch = new ResizeObserver(() => clearOfPanel());
  if (card) watch.observe(card);
  clearOfPanel();
  addEventListener('resize', clearOfPanel);
  const p = await shown;
  watch.disconnect();
  removeEventListener('resize', clearOfPanel);
  document.body.classList.remove('intake-on');
  view.setPreview(null);
  view.setShift(0, 0);
  if (p === 'back') return false;
  if (p) writePrisoner(p);
  else if (first) writePrisoner(DEFAULT_PRISONER);
  PLAYER.name = readPrisoner()?.name ?? '';
  return true;
}
