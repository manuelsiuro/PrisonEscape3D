/** A number or a word floating up from someone's head ("+5", "Taken"), as the combat layer draws them. */
import type { CombatUI } from '../ui/combat';
import { combatUI, view } from './context';

type FloatKind = Parameters<CombatUI['float']>[3];
const at = { x: 0, y: 0 };

/** Over someone (Cast id; -1 the player), when they're on screen. */
export function floatAt(id: number, text: string, kind: FloatKind) {
  const p = view.screenOf(id, at);
  if (p) combatUI.float(text, p.x, p.y, kind);
}

/** Over the player. */
export const floatUp = (text: string, kind: FloatKind) => floatAt(-1, text, kind);
