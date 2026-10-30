import { itemDef, itemNumber, KEY_ITEM_COLORS } from '../content/items';
import { t, type Key } from '../i18n';
import { EXT, OP, tossArgs } from '../sim/command';
import type { Sim, SimEvent } from '../sim/Sim';
import { personOf } from '../sim/systems/combat';
import { HOTBAR, itemOf, ownerOf } from '../sim/systems/items';
import { looseCheck, petOf, RAT, ratTargets, type RatTarget } from '../sim/systems/rats';
import { PANIC_PEOPLE, PANIC_STEPS, RAT_REACH, STEPS_PER_SECOND, UNIT } from '../sim/tuning';
import { containersOf } from '../sim/world/containers';
import { LAYER, MAP_W } from '../sim/world/World';
import type { HudState } from '../ui/hud';
import { itemName } from '../ui/items';
import type { RatRow, RatView } from '../ui/rat';
import { inmateName } from '../ui/social';
import { banner, closeSocial, hud, itemsUI, ratPanel, sound } from './context';
import { play, sendOp } from './game';
import { thingName } from './labels';
import { coachOnce } from './tips';
import { TOUCH } from '../ui/dom';
import { inmateInCell } from '../sim/systems/inmates';

/**
 * The pet rat on screen (P20): its name, the panel's places and buttons, the HUD's pill, and
 * what its events say. Worked out from the sim's own rules (rats.ts), so the panel offers only
 * what the rat would do.
 */

/** The rat's name: one of the language's names, by the run (the same in a language; a French game calls it by a French one). */
export function ratName(sim: Sim): string {
  const names = t('rat.names').split('|');
  // (Never a guard dog's name: the Training Block's Biscuit and a rat called Biscuit are two different animals.)
  const dogs = new Set(sim.prison.guards.map((g) => g.dog?.name).filter(Boolean));
  for (let k = 0; k < names.length; k++) {
    const name = names[((sim.state.salt >>> 0) + k) % names.length];
    if (!dogs.has(name)) return name;
  }
  return names[0];
}

const ICONS: Record<string, string> = { desk: 'box', bed: 'home', toilet: 'drop', shelf: 'book', counter: 'utensils', bin: 'trash', freezer: 'snow', shower: 'drop' };
const KEY_CSS: Record<string, string> = Object.fromEntries(KEY_ITEM_COLORS.map(([c, , color]) => [c, `#${color.toString(16).padStart(6, '0')}`]));

/** A place's name for the panel, capitalised: a guard by his title, an inmate by name, furniture by what it is and whose cell. */
function placeName(sim: Sim, x: RatTarget): string {
  const n = sim.state.inmates.length;
  if (x.who >= n) return t('guard.title', { name: sim.prison.guards[x.who - n]?.name ?? '' });
  if (x.who >= 0) return inmateName(sim, x.who);
  return furnitureName(sim, x.container);
}

/** A piece of furniture by what it is, and whose cell it's in ("Desk · Ray's cell"). */
function furnitureName(sim: Sim, container: number): string {
  const name = thingName(sim, container);
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  const c = containersOf(sim.world)[container];
  const cell = sim.world.cellOf[c.prop.z * MAP_W + c.prop.x];
  const owner = cell > 1 ? inmateInCell(sim.state, cell) : -1;
  const base = owner >= 0 ? t('rat.whose', { thing: cap, name: inmateName(sim, owner) }) : t('rat.where', { thing: cap, place: t(`zone.${sim.world.zoneAt(c.prop.x, c.prop.z)}` as Key) });
  // (Several of a kind in one room, a row of showers: numbered once and for all, by their order in the prison.)
  const twins = twinsOf(sim, container);
  return twins.length > 1 ? `${base} ${twins.indexOf(container) + 1}` : base;
}

/** The containers of the same kind in the same room or cell as one (itself included, in prison order); cached per prison. */
const twinCache = new WeakMap<object, Map<number, number[]>>();
function twinsOf(sim: Sim, container: number): number[] {
  let map = twinCache.get(sim.world);
  if (!map) {
    map = new Map();
    const groups = new Map<string, number[]>();
    const w = sim.world;
    containersOf(w).forEach((c, i) => {
      const t0 = c.prop.z * MAP_W + c.prop.x;
      const key = `${c.prop.kind}|${w.cellOf[t0] > 1 ? `c${w.cellOf[t0]}` : w.ground.zone[t0]}`;
      const list = groups.get(key) ?? [];
      list.push(i);
      groups.set(key, list);
    });
    for (const list of groups.values()) for (const i of list) map.set(i, list);
    twinCache.set(sim.world, map);
  }
  return map.get(container) ?? [container];
}

const targets: RatTarget[] = [];
const view: RatView = { name: '', status: '', say: '', ready: false, rows: [], more: 0, leave: '', leaveNo: '', loose: false, looseNote: '' };
/** The most places the panel lists (the sleepers first: a heist's guard never falls off the end). */
const ROWS = 12;
/** Compass points from the player, by eighths of a turn from east (z grows south). */
const POINTS = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'] as const;
function pointTo(sim: Sim, tile: number): string {
  const p = sim.state.player;
  const dx = (tile % MAP_W) + 0.5 - p.x / UNIT;
  const dz = Math.floor(tile / MAP_W) + 0.5 - p.z / UNIT;
  return t(`rat.dir.${POINTS[(Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) + 8) % 8]}` as Key);
}
let memo = '';

/** What the rat panel shows now (null: no rat). Worked out once a step (and on a change of hand). */
export function ratView(sim: Sim): RatView | null {
  const s = sim.state;
  const pet = petOf(s);
  if (!pet) return null;
  const held = itemOf(s.items.inv[s.items.hand]);
  const key = `${s.step}|${s.items.rev}|${held}|${t('rat.names')}`;
  if (key === memo) return view;
  memo = key;
  view.name = ratName(sim);
  view.status = ratStatus(sim);
  view.say = pet.mode === RAT.LOOSE ? t('rat.statusLooseSay') : view.status;
  view.ready = pet.mode === RAT.SHOULDER && !s.sleeping && s.layer === LAYER.GROUND && !s.stowed && !sim.away;
  view.rows = [];
  view.more = 0;
  if (view.ready) {
    ratTargets(sim, targets);
    // (Sleepers first, then the furniture, each nearest first.)
    targets.sort((a, b) => (a.who >= 0 ? 0 : 1) - (b.who >= 0 ? 0 : 1) || a.dist - b.dist || a.container - b.container);
    view.more = Math.max(0, targets.length - ROWS);
    for (const x of targets.slice(0, ROWS)) {
      const n = s.inmates.length;
      const guard = x.who >= n ? sim.prison.guards[x.who - n] : null;
      const out = x.who >= 0 && (personOf(s, x.who)?.ko ?? 0) > 0;
      const c = containersOf(sim.world)[x.container];
      const row: RatRow = {
        container: x.container,
        icon: x.who >= 0 ? (out ? 'star' : 'moon') : (ICONS[c?.prop.kind ?? ''] ?? 'box'),
        name: placeName(sim, x),
        meta: [x.who >= 0 ? t(out ? 'rat.out' : 'rat.asleep') : '', x.dist <= 1 ? t('rat.metaNear') : t('rat.meta', { n: x.dist, dir: pointTo(sim, x.tile) })].filter(Boolean).join(' · '),
        // (His key's chip only while it's on him.)
        key: guard && s.items.containers[x.container]?.some((v) => itemOf(v) === itemNumber(`key_${guard.key}`)) ? (KEY_CSS[guard.key] ?? '') : '',
      };
      view.rows.push(row);
    }
  }
  const small = held && s.items.hand < HOTBAR && itemDef(held).small;
  view.leave = small ? itemName(held) : '';
  view.leaveNo = held && !small ? t('rat.tooBig', { item: itemName(held) }) : '';
  const lc = looseCheck(sim);
  view.loose = view.ready && !lc.why;
  view.looseNote = lc.why === 'tired' ? t('rat.looseTired') : lc.why === 'few' ? t('rat.looseFew', { n: lc.n, of: PANIC_PEOPLE }) : t('rat.looseOk', { n: lc.n });
  return view;
}

/** Where the rat is and what it's doing, in a sentence. */
function ratStatus(sim: Sim): string {
  const s = sim.state;
  const pet = petOf(s)!;
  switch (pet.mode) {
    case RAT.OUT:
      return t(pet.leave ? 'rat.statusLeave' : 'rat.statusOut', { item: pet.carry ? itemName(itemOf(pet.carry)) : '', where: targetName(sim, pet.target) });
    case RAT.BACK:
      return pet.carry ? t('rat.statusBackWith', { item: itemName(itemOf(pet.carry)) }) : t('rat.statusBack');
    case RAT.LOOSE:
      return t('rat.statusLoose', { n: Math.max(0, Math.ceil((pet.until - s.step) / STEPS_PER_SECOND)) });
    case RAT.WAIT:
      return t(s.layer === LAYER.GROUND && !s.stowed && !sim.away ? 'rat.statusLost' : 'rat.statusWait');
  }
  return s.layer === LAYER.GROUND && !s.stowed && !sim.away ? t('rat.statusReady', { n: RAT_REACH }) : t('rat.statusFloor');
}

/** A container's name after a colon ("Officer Pratt's pockets", "Desk · Ray's cell"). */
function targetName(sim: Sim, container: number): string {
  if (container < 0) return '';
  const who = ownerOf(sim.world, container);
  const n = sim.state.inmates.length;
  if (who >= n) return t('rat.pocketsGuard', { name: sim.prison.guards[who - n]?.name ?? '' });
  if (who >= 0) return t('rat.pocketsInmate', { name: inmateName(sim, who) });
  return furnitureName(sim, container);
}

/** The HUD's rat pill (null: no rat): its name and what it's doing; a bar while it runs loose. */
const hudRat: NonNullable<HudState['rat']> = { name: '', status: '', busy: false, left: null, of: PANIC_STEPS / STEPS_PER_SECOND, usable: true };
export function ratHud(sim: Sim): HudState['rat'] {
  const s = sim.state;
  const pet = petOf(s);
  if (!pet) return null;
  hudRat.name = ratName(sim);
  hudRat.busy = pet.mode !== RAT.SHOULDER;
  hudRat.status = pet.mode === RAT.OUT ? t('rat.pillOut') : pet.mode === RAT.BACK ? t('rat.pillBack') : pet.mode === RAT.LOOSE ? t('rat.pillLoose') : pet.mode === RAT.WAIT ? t('rat.pillWait') : '';
  hudRat.left = pet.mode === RAT.LOOSE ? Math.max(0, (pet.until - s.step) / STEPS_PER_SECOND) : null;
  // (Its panel can't open asleep, out cold, in solitary or a vehicle: the pill says so by going quiet.)
  hudRat.usable = !s.sleeping && !s.stowed && !sim.away;
  return hudRat;
}

/** The panel's buttons: the rat sent (the panel closes to watch it go), let loose. */
export function wireRatPanel() {
  hud.onRat = () => {
    sound.click();
    if (!ratPanel.isOpen) {
      closeSocial();
      itemsUI.closePanels();
    }
    toggleRat();
  };
  ratPanel.onSend = (container, leave) => {
    const [b, c] = tossArgs(container);
    sendOp(OP.EXT, leave ? EXT.RAT_LEAVE : EXT.RAT_FETCH, b, c);
    ratPanel.close();
  };
  ratPanel.onLoose = () => {
    sendOp(OP.EXT, EXT.RAT_LOOSE);
    ratPanel.close();
  };
}

/** T (`focus`: into the panel), or the rat pill: the panel open or shut (only with a rat). */
export function toggleRat(focus = false) {
  const g = play.game;
  if (!g || g.paused || !petOf(g.rec.sim.state)) return;
  ratPanel.toggle(focus);
}

/** How loud something is to the player (full close by, a whisper far off). */
function gainAt(sim: Sim, x: number, z: number) {
  const p = sim.state.player;
  return Math.max(0.15, Math.min(1, 1.15 - Math.hypot(x - p.x, z - p.z) / UNIT / 16));
}

/** What a rat event says and sounds like. */
export function announceRat(sim: Sim, e: Extract<SimEvent, { type: 'rat' }>) {
  const s = sim.state;
  const pet = petOf(s);
  const name = ratName(sim);
  const item = e.item ? itemName(e.item) : '';
  // (Off the ground floor, out cold or in solitary, it waits: never "back to you" then.)
  const waits = pet?.mode === RAT.WAIT;
  switch (e.what) {
    case 'caught': {
      // (One toast for the night's catch, however many traps.)
      const n = sim.events.filter((x) => x.type === 'rat' && x.what === 'caught').length;
      if (sim.events.find((x) => x.type === 'rat' && x.what === 'caught') !== e) break;
      sound.squeak(0.5);
      itemsUI.toast(n > 1 ? t('toast.ratCaughtN', { n }) : t('toast.ratCaught'));
      break;
    }
    case 'fed':
      sound.munch(false);
      itemsUI.toast(t('toast.ratFed', { item }));
      break;
    case 'tamed':
      sound.squeak(1);
      banner.toast(t('toast.ratTamed', { name }), 'good');
      coachOnce('rat', TOUCH ? 'hint.rat' : 'hint.ratKeys');
      break;
    case 'hungry':
      sound.sting();
      itemsUI.toast(t('toast.ratHungry'));
      break;
    case 'haveOne':
      sound.sting();
      itemsUI.toast(t('toast.ratHaveOne', { name }));
      break;
    case 'sent':
      sound.scurry(1);
      break;
    case 'took':
      if (pet) sound.squeak(gainAt(sim, pet.x, pet.z) * 0.6);
      // (A guard's key out of his own pockets: he'll miss it.)
      fromGuard = (e.who ?? -1) >= s.inmates.length && !!e.item && itemDef(e.item).cat === 'key';
      break;
    case 'left':
      itemsUI.toast(t('toast.ratLeft', { name, item, where: targetName(sim, e.container ?? -1) }));
      break;
    case 'empty':
      itemsUI.toast(t('toast.ratEmpty', { name, where: targetName(sim, e.container ?? -1) }));
      break;
    case 'full':
      itemsUI.toast(t('toast.ratFull', { name, item }));
      told = e.item ?? 0;
      break;
    case 'woke':
      itemsUI.toast(t(e.item ? 'toast.ratWokeLeave' : 'toast.ratWoke', { name, item }));
      told = e.item ?? 0;
      break;
    case 'chased':
      banner.toast(t(waits ? 'toast.ratChasedWait' : e.item ? 'toast.ratChasedWith' : 'toast.ratChased', { name, item }), 'bad');
      // (Only what the toast named: waiting, it says nothing of what it carries, so its return will.)
      told = waits ? 0 : (e.item ?? 0);
      break;
    case 'home': {
      sound.squeak(0.7);
      const cash = e.cash ? t('toast.ratCash', { n: e.cash }) : '';
      // (What it couldn't leave, already said: no second toast for it.)
      if (e.item && e.item === told) {
        told = 0;
        break;
      }
      told = 0;
      if (e.item) {
        itemsUI.toast(t(e.floor ? 'toast.ratBroughtFloor' : 'toast.ratBrought', { name, item }) + cash);
        if (fromGuard) coachOnce('ratKey', 'hint.ratKey');
      } else if (e.cash) itemsUI.toast(t('toast.ratOnlyCash', { name, n: e.cash }));
      fromGuard = false;
      break;
    }
    case 'loose':
      sound.squeak(1, true);
      banner.toast(t(e.wild ? 'toast.ratThrown' : 'toast.ratLoose', { n: e.n ?? 0 }), 'good');
      break;
    case 'calm':
      if (!e.wild) itemsUI.toast(t(waits ? 'toast.ratWaits' : 'toast.ratCalm', { name }));
      break;
    case 'gone':
      sound.scurry(0.7);
      itemsUI.toast(t('toast.ratGone', { n: e.n ?? 0, of: PANIC_PEOPLE }));
      break;
    case 'refused':
      sound.sting();
      itemsUI.toast(t(`rat.${e.why}` as Key, { n: e.n ?? 0, of: PANIC_PEOPLE, name }));
      break;
  }
}

/** What a toast already said the rat carries back (its 'home' then keeps quiet), and whether what it took came from a guard's pockets. */
let told = 0;
let fromGuard = false;

/** A game starts or loads: nothing said about a rat yet. */
export function resetRat() {
  told = 0;
  fromGuard = false;
}
