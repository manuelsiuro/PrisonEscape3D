import { DESIGNS, INK_HEAT, INK_ME_STEPS, INK_TIME, LEAD_IN, RING_AHEAD } from '../content/team';
import { GAME_OPINION, GAMES_A_DAY } from '../content/games';
import { t, type Key } from '../i18n';
import { EXT, needleArgs, OP } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import { eyesOn } from '../sim/systems/games';
import {
  inkRefusal,
  lineQuality,
  payOf,
  penAt,
  pointAt,
  qualityOf,
  ringAt,
  TATTOO_GUN,
  tracedShare,
  traceSteps,
} from '../sim/systems/tattoo';
import { HOTBAR, itemOf } from '../sim/systems/items';
import { STEPS_PER_SECOND } from '../sim/tuning';
import type { InkView } from '../ui/team';
import { banner, itemsUI, sound } from './context';
import { gameCards } from './lazy';
import { coachOnce } from './tips';
import { TOUCH } from '../ui/dom';
import { floatUp } from './floats';
import { refusedText } from './refusals';
import { inmateName } from '../ui/names';

/**
 * Ink (P29) on screen: the tattoo's card, filled from the sim; the talk panel's rows for it; the
 * sounds and toasts of its events. (P29's football match went in 2.44: play/penalties.ts.) The
 * sim's own functions decide everything shown.
 */

/** The line the needle has inked (its points, each inked on from the last or the needle set down there; the sitting's step and inked steps it was taken at): the card draws it. Not state. */
const trail: Array<[number, number, boolean]> = [];
let trailStep = -1;
let trailInked = 0;

/** A new game (or a load): nothing to show. */
export function resetTeam() {
  trail.length = 0;
  trailStep = -1;
  trailInked = 0;
}

// ------------------------------------------------------------------ the talk panel's rows

/** The tattoo rows with the inmate talked to (null without a gun in the hotbar): the designs for him (their prices), one from him on the player's arm. */
export function inkOffer(
  sim: Sim,
  who: number,
): { why: string; designs: Array<{ k: number; price: number }>; mineWhy: string; inked: number[] } | null {
  const s = sim.state;
  if (!s.items.inv.slice(0, HOTBAR).some((v) => itemOf(v) === TATTOO_GUN)) return null;
  const why = inkRefusal(sim, who, false);
  // (The player's own: the first design they haven't got decides the note; each button checks its own.)
  const mineWhy = inkRefusal(
    sim,
    who,
    true,
    DESIGNS.findIndex((_, k) => !s.inked.includes(k)),
  );
  return {
    why: why ? refusalText(sim, why) : '',
    designs: DESIGNS.map((d, k) => ({ k, price: d.price })),
    mineWhy: mineWhy ? refusalText(sim, mineWhy) : '',
    inked: s.inked,
  };
}

/** Why not, in words (the talk panel's notes). */
export function refusalText(sim: Sim, why: string): string {
  switch (why) {
    case 'gamesClosed':
      return t('games.closed');
    case 'gamesLockdown':
      return t('refused.gamesLockdown');
    case 'gameOpinion':
      return t('games.needOpinion', { n: GAME_OPINION });
    case 'played':
      return t('games.playedOut', { n: GAMES_A_DAY });
    case 'seated':
      return t('refused.seated');
    default:
      return refusedText(sim, why);
  }
}

// ------------------------------------------------------------------ the tattoo's card

const inkView: InkView = {
  name: '',
  design: 0,
  mine: false,
  pen: [0, 0],
  needle: [0, 0],
  next: [],
  trail,
  progress: 0,
  lead: true,
  left: 0,
  quality: 100,
  pays: 0,
  seen: false,
};
/** The design's stretch ahead of what's traced, as far as NEXT_SPAN (box units): the card draws it bold. */
const NEXT_SPAN = 260;
const nextPoints: Array<[number, number]> = [];
/** The needle as the last two steps left it (the card draws it between them). Not state. */
const needleSteps = { k: -1, x0: 0, y0: 0, x1: 0, y1: 0 };

/** The sitting under way (null: none), between steps (`a`). */
export function inkNow(sim: Sim, a: number): InkView | null {
  const s = sim.state;
  const o = s.ink;
  if (!o) return null;
  const v = inkView;
  v.name = inmateName(sim, o.who);
  v.design = o.design;
  v.mine = !!o.mine;
  v.seen = !!o.seen;
  if (o.mine) {
    v.progress = Math.min(1, o.k / INK_ME_STEPS);
    return v;
  }
  // (Each step's needle point onto the line: inked on, or set down; before 2.22, every step once the pen's off.)
  if (o.k !== trailStep) {
    if (o.k < trailStep || o.k <= 1) {
      trail.length = 0;
      trailInked = 0;
    }
    trailStep = o.k;
    const last = trail[trail.length - 1];
    if (sim.rules221) {
      if (o.k > LEAD_IN) trail.push([o.nx, o.nz, true]);
    } else if (!last || last[0] !== o.nx || last[1] !== o.nz) trail.push([o.nx, o.nz, o.n > trailInked]);
    trailInked = o.n;
  }
  const st = needleSteps;
  if (o.k !== st.k) {
    const after = o.k === st.k + 1;
    Object.assign(st, { k: o.k, x0: after ? st.x1 : o.nx, y0: after ? st.y1 : o.nz, x1: o.nx, y1: o.nz });
  }
  v.needle[0] = Math.round(st.x0 + (st.x1 - st.x0) * a);
  v.needle[1] = Math.round(st.y0 + (st.y1 - st.y0) * a);
  nextPoints.length = 0;
  v.next = nextPoints;
  if (sim.rules221) {
    penAt(o.design, o.k + 1, v.pen);
    v.lead = o.k < LEAD_IN;
    v.progress = Math.max(0, Math.min(1, (o.k - LEAD_IN) / (traceSteps(o.design) - LEAD_IN)));
    v.quality = qualityOf(o.err, Math.max(1, o.k - LEAD_IN));
    v.left = 0;
  } else {
    ringAt(o, RING_AHEAD, v.pen);
    for (let d = 0; d <= NEXT_SPAN; d += 20) nextPoints.push(pointAt(o.design, o.at + d));
    v.lead = false;
    v.progress = tracedShare(o);
    // (The line so far: a needle not yet at work, a clean one.)
    v.quality = o.n ? lineQuality(o.err, o.n) : 100;
    const left = Math.ceil((INK_TIME - o.k) / STEPS_PER_SECOND);
    v.left = left <= 10 ? Math.max(0, left) : 0;
  }
  v.pays = payOf(o.design, v.quality);
  return v;
}

/** The needle's op this step (2.22): with the finger or the mouse down on the design, the needle set down where it first touched, then drawn after it. Null otherwise. */
export function needleOp(sim: Sim): [number, number, number, number] | null {
  const o = sim.state.ink;
  const p = gameCards()?.inkCard.touch;
  if (!o || o.mine || !p?.down || sim.rules221) return null;
  const [b, c] = needleArgs(p.x, p.y);
  const fresh = p.fresh;
  p.fresh = false;
  return [OP.EXT, fresh ? EXT.NEEDLE_DOWN : EXT.NEEDLE, b, c];
}

// ------------------------------------------------------------------ the events

export function announceTeam(sim: Sim, e: SimEvent) {
  switch (e.type) {
    case 'tattoo': {
      const name = inmateName(sim, e.who);
      const design = t(`design.${DESIGNS[e.design]?.id ?? 'heart'}` as Key);
      const designA = t(`designA.${DESIGNS[e.design]?.id ?? 'heart'}` as Key);
      if (e.what === 'start') {
        trail.length = 0;
        trailStep = -1;
        trailInked = 0;
        coachOnce(e.mine ? 'inkMe' : 'tattoo', e.mine ? 'hint.inkMe' : TOUCH ? 'hint.tattooTouch' : 'hint.tattoo');
        sound.needle();
      } else if (e.what === 'done') {
        sound.coin((e.pay ?? 0) >= 30);
        if ((e.quality ?? 0) >= 90) sound.levelUp();
        floatUp(`+$${e.pay ?? 0}`, 'cash');
        banner.toast(
          t('toast.tattooDone', { name, design, q: e.quality ?? 0, n: e.pay ?? 0, g: e.gain ?? 0 }),
          (e.quality ?? 0) >= 50 ? 'good' : undefined,
          4200,
        );
      } else if (e.what === 'inked') {
        sound.levelUp();
        banner.toast(t('toast.inked', { name, design: designA }), 'good', 4200);
      } else if (e.what === 'quit') itemsUI.toast(t(e.mine ? 'toast.inkMeQuit' : 'toast.tattooQuit', { name }));
      else if (e.what === 'off' && !sim.state.escaped) itemsUI.toast(t('toast.tattooOff', { name }));
      break;
    }
  }
}

/** The tattoo gun's buzz while it works (every frame: a buzz every quarter second). */
let lastBuzz = 0;
export function teamSounds(sim: Sim, paused: boolean) {
  if (!sim.state.ink || paused) return;
  const now = performance.now();
  if (now - lastBuzz < 240) return;
  lastBuzz = now;
  sound.needle(sim.state.ink.mine ? 0.7 : 1);
}

/** The heat a sitting under a guard's eye would cost (for the talk panel's warning): INK_HEAT if seen now, else 0. */
export const inkHeatNow = (sim: Sim) => (eyesOn(sim.state, sim.state.step) ? INK_HEAT : 0);
