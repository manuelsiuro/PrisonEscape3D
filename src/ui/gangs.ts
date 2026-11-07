/**
 * Gangs on the talk card (2.36, sim/systems/gangs.ts): the inmate's gang as a chip in its colour (a boss's,
 * the player's own, a rival's), and at a boss, the gang's section: what joining brings and costs and the
 * button to ask in, or, for the player's own boss, what membership gives and the way out. Drawn from the
 * simulation's own rules (`joinRefusal`, the tuning), so the card never promises what the till won't do.
 */
import type { GangId } from '../content/gangs';
import { t, type Key } from '../i18n';
import { TALK } from '../sim/command';
import type { Sim } from '../sim/Sim';
import { discountOf, FAVOR } from '../sim/systems/economy';
import { bossOf, gangOf, gangsHere, joinRefusal, playerGang } from '../sim/systems/gangs';
import { GANG_BACKUP_RANGE, GANG_LEAVE_OPINION, GANG_RIVAL_OPINION } from '../sim/tuning';
import { esc } from './dom';
import { icon } from './icons';
import { refusedText } from '../play/refusals';
import { gangName, inmateName } from './names';

export interface GangTalkView {
  id: GangId;
  /** A boss of it (asks the player in; their goods cost less to a member). */
  boss: boolean;
  /** The player's own gang, a rival of it, or the player in none. */
  rel: 'mine' | 'rival' | 'free';
  /** At a boss: the button's state ('' it can be pressed; else why not, in words) and the boss's name. */
  ask?: string;
  name?: string;
  /** The extra discount a member gets (whole percent), and what a member pays at opinion now. */
  off?: number;
  /** The initiation already under way with this boss. */
  pending?: boolean;
}

/** The talk card's view of an inmate's gang (null: none, or no gangs here). */
export function gangView(sim: Sim, who: number): GangTalkView | null {
  if (!gangsHere(sim)) return null;
  const k = gangOf(sim, who);
  if (k < 0) return null;
  const def = sim.prison.gangs![k];
  const mine = playerGang(sim);
  const boss = bossOf(sim, who) === k;
  const v: GangTalkView = { id: def.id, boss, rel: mine < 0 ? 'free' : mine === k ? 'mine' : 'rival' };
  if (!boss) return v;
  v.name = inmateName(sim, who);
  const m = sim.state.inmates[who];
  v.off = Math.round((discountOf(m.opinion, true) - discountOf(m.opinion)) * 100);
  if (v.rel === 'mine') return v;
  v.pending = sim.state.favors.some((f) => f.by === who && f.kind === FAVOR.INITIATION);
  const why = joinRefusal(sim, who);
  v.ask =
    why === ''
      ? ''
      : why === 'gangHere'
        ? '-'
        : why === 'inGang'
          ? t('talk.gang.inGang', { gang: gangName(sim, mine) })
          : refusedText(sim, why);
  return v;
}

/** The chip in the gang's colour: its name, and Boss / Your gang / Rival. */
export function gangChip(v: GangTalkView): string {
  const tag = v.boss ? t('talk.gang.boss') : v.rel === 'mine' ? t('talk.gang.mine') : v.rel === 'rival' ? t('talk.gang.rival') : '';
  return `<span class="chip gang" data-gang="${v.id}" data-rel="${v.rel}"><i class="gang-dot"></i>${esc(t(`gangT.${v.id}` as Key))}${tag ? `<em>${esc(tag)}</em>` : ''}</span>`;
}

/** At a boss: joining (what it brings and costs, the button) or, the player's own, membership and the way out. */
export function gangSection(v: GangTalkView): string {
  if (!v.boss || v.pending || v.ask === '-') return '';
  const title = `<div class="box-label">${icon('users', 14)}<span>${esc(t(`gangT.${v.id}` as Key))}</span></div>`;
  if (v.rel === 'mine')
    return `<section class="talk-gang" data-gang="${v.id}">${title}<p class="talk-note">${esc(t('talk.gang.yours', { n: v.off ?? 0 }))} ${esc(t('talk.gang.own'))}</p>
      <div class="talk-row"><span class="talk-note">${esc(t('talk.gang.turf'))}</span><button class="big-btn ghost small" data-act="${TALK.LEAVE}" data-confirm="${esc(t('talk.gang.leaveSure', { n: GANG_LEAVE_OPINION }))}">${icon('close', 16)}<span>${t('talk.gang.leave')}</span></button></div></section>`;
  const ok = v.ask === '';
  return `<section class="talk-gang" data-gang="${v.id}">${title}<p class="talk-note">${esc(t('talk.gang.pitch', { boss: v.name ?? '', n: v.off ?? 0, r: GANG_BACKUP_RANGE, x: GANG_RIVAL_OPINION }))}</p>
    <div class="talk-row"><span class="talk-note">${esc(ok ? t('talk.gang.turf') : (v.ask ?? ''))}</span><button class="big-btn ${ok ? 'primary' : 'ghost'} small" data-act="${TALK.JOIN}" ${ok ? '' : 'disabled'}>${icon('users', 16)}<span>${t('talk.gang.ask')}</span></button></div></section>`;
}
