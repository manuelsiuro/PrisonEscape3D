/** How people are named in the game's text: inmates, guards (to address or as a sentence's subject), jobs, and a favor in the asker's words. */
import { FAVOR_KINDS } from '../sim/systems/economy';
import type { Sim } from '../sim/Sim';
import { type Key, lowerFirst, t } from '../i18n';
import { itemName } from './items';

/** An inmate's nickname (the same in every language), else "Inmate · cell n". */
export function inmateName(sim: Sim, who: number): string {
  const m = sim.state.inmates[who];
  if (!m) return '';
  return sim.prison.names[m.cell - 2] ?? t('combat.inmate', { n: m.cell });
}

/** A favor told in the asker's words. */
export function favorText(sim: Sim, f: { kind: number; item: number; target: number }): string {
  const kind = FAVOR_KINDS[f.kind];
  // Mid-sentence, the item's name in lower case ("stole my magazine").
  const item = f.item ? itemName(f.item) : '';
  return t(`favor.${kind}` as Key, { item: lowerFirst(item), name: f.target >= 0 ? inmateName(sim, f.target) : '' });
}

/** A guard as the player addresses it: "Officer Pratt" (or "The guard" for one without a name). */
export function guardTitle(sim: Sim, k: number): string {
  const d = sim.prison.guards[k];
  return d?.name ? t('guard.title', { name: d.name }) : t('guard.nameless');
}

/** A guard opening a sentence: "Officer Pratt looks away", "Le gardien Pratt ferme les yeux". */
export function guardSubject(sim: Sim, k: number): string {
  const d = sim.prison.guards[k];
  return d?.name ? t('guard.subject', { name: d.name }) : t('guard.nameless');
}

/** The job names in the board's order for this prison (for toasts). */
export const jobName = (sim: Sim, job: number) => t(`job.${sim.prison.jobs[job]?.id ?? 'laundry'}` as Key);
