/** The badges over inmates' heads: what the player can do with them now. */
import { itemNumber } from '../content/items';
import type { Sim } from '../sim/Sim';
import { FAVOR_STATE } from '../sim/systems/economy';
import { HOTBAR, hotbarSlotOf, itemOf, usesOf } from '../sim/systems/items';
import type { BadgeKind } from '../render/characterSprites';

const LETTER = itemNumber('letter');

/**
 * The badge over an inmate (GDD §13.2): the letter the player carries for them, a favor done
 * (hand it in) or on offer, a merchant open for business.
 */
const badgeMemo = { step: -1, rev: -1, kinds: [] as BadgeKind[] };
export function badgeOf(sim: Sim, who: number): BadgeKind {
  const s = sim.state;
  // Worked out once a step (or when the items change), not every frame.
  if (badgeMemo.step !== s.step || badgeMemo.rev !== s.items.rev) {
    badgeMemo.step = s.step;
    badgeMemo.rev = s.items.rev;
    for (let k = 0; k < s.inmates.length; k++) badgeMemo.kinds[k] = badgeNow(sim, k);
  }
  return badgeMemo.kinds[who] ?? '';
}
function badgeNow(sim: Sim, who: number): BadgeKind {
  const s = sim.state;
  const m = s.inmates[who];
  if (m.ko > 0 || m.angry > 0) return '';
  if (sim.onDuty && s.mail.includes(who) && s.items.inv.slice(0, HOTBAR).some((v) => itemOf(v) === LETTER && usesOf(v) - 1 === who)) return 'mail';
  const f = s.favors.find((x) => x.by === who);
  if (f && (f.state === FAVOR_STATE.DONE || ((f.kind === 0 || f.kind === 1) && f.state === FAVOR_STATE.TAKEN && hotbarSlotOf(s.items.inv, f.item) >= 0))) return 'done';
  if (f?.state === FAVOR_STATE.OFFERED) return 'favor';
  if (sim.shopsOpen && sim.merchantOf(who) >= 0 && s.shops[sim.merchantOf(who)].some((v) => v)) return 'shop';
  // (A follower's badge is the crew's chip now, P23: their line of work, ui/crew.ts.)
  return '';
}
