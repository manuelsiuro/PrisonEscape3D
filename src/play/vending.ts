import { buzz } from '../app/haptics';
import { GOODS, rowCode, VEND } from '../content/vending';
import { itemDef, itemNumber } from '../content/items';
import { t, type Key } from '../i18n';
import { OP, EXT } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import { atVending, cutPast, peopleAhead, vendRefusal, vendShut, VEND_NOBODY, VEND_PLAYER } from '../sim/systems/vending';
import { touchWords } from '../ui/dom';
import { itemName } from '../ui/items';
import type { VendRow, VendView } from '../ui/vending';
import { itemsUI, sound, vendCard } from './context';
import { play, sendOp } from './game';
import { coachOnce } from './tips';

/**
 * The vending machine on screen (2.32): its card, filled from the sim's own functions; the sounds, toasts and hints of
 * what happens at it; its keys (1–7 a row, E a thump, else off the card).
 */

/** What a food says it gives. */
export function foodWords(item: number): string {
  const f = itemDef(item).food;
  if (item === itemNumber('chocolate')) return t('toast.ate', { n: 25 });
  if (!f) return t('vend.forCrafting');
  return f.health ? t('toast.ateHealth', { n: f.health }) : t('toast.ate', { n: f.energy ?? 0 });
}

const view: VendView = {
  cash: 0,
  rows: [],
  screen: '',
  tone: 'idle',
  coil: -1,
  jam: -1,
  ahead: 0,
  inLine: false,
  canCut: false,
  thumpKeys: '',
  note: '',
};
const rows: VendRow[] = GOODS.map((g, k) => ({
  k,
  code: rowCode(k),
  item: itemNumber(g.id),
  name: '',
  price: `$${g.price}`,
  left: 0,
  gives: '',
  why: '',
}));

/** The card now, or null with it shut. */
export function vendingNow(sim: Sim): VendView | null {
  const s = sim.state;
  if (!s.vendOpen || sim.rules231) return null;
  const v = s.vend;
  const shut = vendShut(sim);
  const ahead = peopleAhead(sim);
  view.cash = s.cash;
  rows.forEach((r, k) => {
    r.name = t(`vend.row.${GOODS[k].id}` as Key);
    r.left = v.left[k];
    r.gives = foodWords(r.item);
    const why = vendRefusal(sim, k);
    r.why = why ? t(`refused.${why}` as Key) : '';
  });
  view.rows = rows;
  view.coil = v.who !== VEND_NOBODY && !v.thumping ? v.row : -1;
  view.jam = v.jam ? v.jam - 1 : -1;
  view.ahead = ahead;
  view.inLine = v.line.includes(VEND_PLAYER);
  view.canCut = cutPast(sim).length > 0;
  view.thumpKeys = '';
  if (shut) {
    view.screen = t(`vend.screen.${shut}` as Key);
    view.tone = 'off';
  } else if (v.who === VEND_PLAYER) {
    view.screen = t('vend.screen.turning');
    view.tone = 'busy';
  } else if (v.jam && ahead === 0) {
    view.screen = t('vend.screen.jam', { item: itemName(itemNumber(GOODS[v.jam - 1].id)) });
    view.tone = 'jam';
  } else if (ahead > 0) {
    view.screen = t(ahead === 1 ? 'vend.screen.aheadOne' : 'vend.screen.ahead', { n: ahead });
    view.tone = 'wait';
  } else {
    view.screen = atVending(sim) ? t('vend.screen.choose') : t('vend.screen.stepUp');
    view.tone = 'idle';
  }
  view.note = touchWords() ? t('vend.noteTouch') : t('vend.noteKeys');
  return view;
}

/** Its keys, while its card is up: 1–7 a row. */
export function vendKey(code: string): boolean {
  const g = play.game;
  if (!g || g.paused || g.replay || !vendCard.open) return false;
  const d = /^(?:Digit|Numpad)([1-7])$/.exec(code);
  if (d) {
    vendCard.choose(Number(d[1]) - 1);
    return true;
  }
  return /^(?:Digit|Numpad)[89]$/.test(code);
}

/** What the action button says with the card up. */
export function vendAction(sim: Sim) {
  const jam = sim.state.vend.jam && peopleAhead(sim) === 0;
  ACTION.verb = t(jam ? 'vend.thump' : 'vend.stepAway');
  ACTION.what = jam ? '' : t('thing.vending');
  return ACTION;
}
const ACTION = { verb: '', what: '' };

/** The action button and E with the card up: a thump at what's stuck, else away from it. */
export function vendAct(sim: Sim) {
  sendOp(OP.EXT, EXT.VEND, sim.state.vend.jam && peopleAhead(sim) === 0 ? VEND.THUMP : VEND.CLOSE);
}

/** What the machine does on screen. */
export function announceVending(sim: Sim, e: Extract<SimEvent, { type: 'vend' }>) {
  const near = !!sim.state.vendOpen || atVending(sim);
  switch (e.what) {
    case 'paid':
      sound.vendCoin();
      sound.vendCoil();
      break;
    case 'got':
      sound.vendDrop();
      buzz('attended');
      if (e.item) {
        vendCard.dropped(e.item);
        itemsUI.toast(t('vend.toast.got', { item: itemName(e.item) }));
        if (itemDef(e.item).food) coachOnce('vendEat', 'hint.vendEat');
      }
      break;
    case 'floor':
      sound.vendDrop();
      if (e.item) itemsUI.toast(t('vend.toast.floor', { item: itemName(e.item) }));
      break;
    case 'jam':
      sound.vendBuzz();
      buzz('missed');
      coachOnce('vendJam', 'hint.vendJam');
      break;
    case 'thump':
      sound.vendThump();
      buzz('strike');
      vendCard.shake();
      break;
    case 'toldOff':
      itemsUI.toast(t('vend.toast.toldOff'));
      break;
    case 'turn':
      sound.click();
      itemsUI.toast(t('vend.toast.turn'));
      break;
    case 'lostTurn':
      itemsUI.toast(t('vend.toast.lostTurn'));
      break;
    case 'shut':
      itemsUI.toast(t('refused.vendShut'));
      break;
    case 'cut':
      itemsUI.toast(t('vend.toast.cut'));
      break;
    case 'swing':
      itemsUI.toast(t('vend.toast.swing'));
      break;
    case 'inmatePaid':
      if (near) sound.vendCoil();
      break;
    case 'inmateGot':
      if (near) sound.vendDrop();
      break;
    case 'inmateThump':
      if (near) sound.vendThump();
      break;
    default:
  }
}
