import { itemDef, itemNumber } from '../content/items';
import { ROUTINE } from '../content/routine';
import { hasSeen, markSeen } from '../game/settings';
import { t, type Key } from '../i18n';
import { containersOf } from '../sim/world/containers';
import { FirstDay } from '../ui/coach';
import { TOUCH } from '../ui/dom';
import { applySettings, banner, board, click, hint, hud, itemsUI, settings, socialOpen } from './context';
import type { Game } from './game';

const GUARD_OUTFIT = itemNumber('guard_outfit');

/**
 * Whether a one-time tip was shown on this device (or tips are off: then every tip counts as
 * shown). Some are asked every frame, so storage is read once per tip and game, not every frame.
 */
export const tipsSeen = new Map<string, boolean>();
export function seenTip(name: string): boolean {
  if (!settings.tips) return true;
  let v = tipsSeen.get(name);
  if (v === undefined) tipsSeen.set(name, (v = hasSeen(name)));
  return v;
}
export function markTip(name: string) {
  tipsSeen.set(name, true);
  markSeen(name);
}

/** A tip shown the first time something happens (and never again). */
export function coachOnce(name: string, key: Key, params?: Record<string, string | number>) {
  if (seenTip(name)) return;
  markTip(name);
  banner.toast(t(key, params), 'info', 7000);
}

export function seenInteract() {
  if (seenTip('interact')) return;
  markTip('interact');
  hint.hide();
}

/**
 * First-time tips for guard rules that hinge on items: a contraband tool or weapon in hand
 * (guards who see it get suspicious fast) and the guard outfit (the disguise and its limit).
 */
const coached = { held: 0, outfit: 0 };
export function coachItems(held: number, outfit: number) {
  if (held !== coached.held) {
    coached.held = held;
    const d = held ? itemDef(held) : null;
    // The first tool: how to use it first; the warning about contraband in hand the next time.
    if (d?.tool && !seenTip('tools')) {
      markTip('tools');
      banner.toast(TOUCH ? t('hint.toolsTouch') : t('hint.toolsKeys'), 'info', 7000);
    } else if (d?.contraband && (d.cat === 'tool' || d.cat === 'weapon') && !seenTip('contrabandHand')) {
      markTip('contrabandHand');
      banner.toast(t('hint.contrabandHand'), 'info', 6500);
    }
  }
  if (outfit !== coached.outfit) {
    coached.outfit = outfit;
    if (outfit === GUARD_OUTFIT && !seenTip('disguise')) {
      markTip('disguise');
      banner.toast(t('hint.disguise'), 'info', 7000);
    }
  }
}

/** The first day's guide; done or skipped, it's seen, and the help tip follows. */
export const firstDay = new FirstDay(
  hud.el,
  () => {
    markTip('guide');
    coachOnce('help', TOUCH ? 'hint.help' : 'hint.helpKeys');
  },
  click,
);

/** A change made in the settings screen: applied, and the tips follow at once. */
export function settingsChanged() {
  applySettings();
  // Tips switched off: the guide goes now (not marked done: it comes back with the tips).
  if (!settings.tips) firstDay.stop();
  tipsSeen.clear();
}

const coachState = { routine: '', attended: false, openMine: false, openOther: false, pickedUp: false, craftOpen: false, boardOpen: false };

/** The first day's guide: what the player has done, read from the game (every frame). */
export function updateFirstDay(g: Game, pickedUp: boolean, dt: number) {
  if (!firstDay.active) return;
  const sim = g.rec.sim;
  const st = sim.state;
  const open = st.items.open >= 0 ? containersOf(sim.world)[st.items.open] : undefined;
  coachState.routine = ROUTINE[st.routine].id;
  coachState.attended = st.attended;
  coachState.openMine = !!open?.mine && open.prop.kind === 'desk';
  coachState.openOther = !!open && !open.mine && open.prop.kind === 'desk';
  coachState.pickedUp = pickedUp;
  coachState.craftOpen = itemsUI.craftIsOpen;
  coachState.boardOpen = board.isOpen;
  firstDay.update(coachState, dt, g.paused || st.sleeping || st.ko > 0 || st.solitary > 0 || itemsUI.panelOpen || socialOpen());
}
