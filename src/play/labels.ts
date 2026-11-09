import { twist } from '../sim/systems/twists';
import { HUDDLE } from '../content/huddles';
import { STAKES } from '../content/games';
import { gameRefusal } from '../sim/systems/games';
import { huddleGameOf } from '../sim/systems/huddles';
import { itemDef, itemNumber, KEY_ITEM_COLORS } from '../content/items';
import { currentLang, t, textStamp, type Key } from '../i18n';
import { lineOfSight } from '../sim/ai/sight';
import { SLOT } from '../sim/command';
import type { Sim } from '../sim/Sim';
import { SUBJECTS } from '../content/books';
import { machineOffer, onMachine } from '../sim/systems/training';
import type { Plan } from '../sim/systems/interact';
import { atRelease, atTray, releaseRefusal, trayRefusal } from '../sim/systems/paperwork';
import { bluffRefusal } from '../sim/systems/getaway';
import { isGuard, maxHealth, personOf, reachOf, swingSteps } from '../sim/systems/combat';
import { GUARD } from '../sim/systems/guards';
import { inmateInCell } from '../sim/systems/inmates';
import { itemOf, ownerOf, usesOf, type ItemState, type Target } from '../sim/systems/items';
import { genOf, offFor } from '../sim/systems/power';
import { helicopterIn } from '../sim/systems/sea';
import { clockRinging } from '../sim/systems/noise';
import { CHOC_EGG, ICE_LOLLY, STRIKES, underSea, type ToolTarget } from '../sim/systems/structure';
import { planStrike } from '../sim/systems/actions';
import { dogDef } from '../sim/systems/k9';
import { petOf, trapChance } from '../sim/systems/rats';
import { RAT_MEALS, STEPS_PER_MINUTE, STEPS_PER_SECOND, THROW_RANGE } from '../sim/tuning';
import { containersOf } from '../sim/world/containers';
import { TILE } from '../sim/world/tiles';
import { LAYER, MAP_W, placeKey } from '../sim/world/World';
import type { TargetInfo } from '../ui/combat';
import { itemName } from '../ui/items';
import { hiddenIn } from '../sim/systems/kiosk';
import { foodUse } from '../sim/systems/vending';
import type { ToolView } from '../ui/tool';
import { drinkArmed, press } from './reach';
import { trackCheck } from '../sim/systems/races';
import { BED, bedAt, bedOf, wilted } from '../sim/systems/garden';
import { CROP, GROWN, HEATWAVE_WATER, TIPSY_STEPS } from '../content/long';
import { planOf } from '../sim/systems/calendar';
import { guardWord, inmateName } from '../ui/names';

/**
 * The words on the buttons and cards: who someone is, what a container is called, what the
 * action and tool buttons would do. Each is worked out only when what it describes (or the
 * language) changes, into objects refilled in place.
 */

const LETTER = itemNumber('letter');
const BED_DUMMY = itemNumber('bed_dummy');

/** Why a strike can't land, by what it needs. */
export const NEED: Record<string, string> = {
  rope: 'toast.noLanding',
  glide: 'toast.noLanding',
  chip: 'toast.needChip',
  cut: 'toast.needCut',
  unscrew: 'toast.needUnscrew',
  dig: 'toast.needDig',
  digUp: 'toast.needDig',
  eat: 'toast.needDig',
  pick: 'toast.pickGate',
};

/** Tool actions as numbers (the held button's target key, compared each frame without strings). */
export const ACTION_IDS = [
  'chip',
  'cut',
  'unscrew',
  'dig',
  'digUp',
  'eat',
  'cover',
  'brace',
  'rope',
  'sharpen',
  'grapnel',
  'tape',
  'launch',
  'wind',
  'wash',
  'feed',
  'setTrap',
  'pick',
  'glide',
  'drink',
  'track',
  'plant',
  'water',
  'harvest',
  'unbook',
  'carve',
  'blow',
];
const TOOL_ICON: Record<string, string> = {
  chip: 'pick',
  dig: 'shovel',
  digUp: 'up',
  cut: 'cutters',
  unscrew: 'screw',
  eat: 'cookie',
  cover: 'lock',
  brace: 'hammer',
  rope: 'down',
  sharpen: 'sword',
  grapnel: 'hook',
  tape: 'eyeOff',
  launch: 'boat',
  wind: 'clock',
  wash: 'drop',
  feed: 'cookie',
  setTrap: 'rat',
  pick: 'lockpick',
  glide: 'glider',
  drink: 'brew',
  track: 'race',
  plant: 'sprout',
  water: 'water',
  harvest: 'fruit',
  unbook: 'book',
  carve: 'pumpkin',
  blow: 'megaphone',
};

/** A firecracker in hand (P14): the tool button throws it. */
const tossView: ToolView = { verb: '', what: '', icon: 'toss', fits: true, progress: null, repeat: false, toss: true };
export function describeToss(): ToolView {
  tossView.verb = t('act.throw');
  tossView.what = t('thing.firecracker');
  tossView.icon = 'toss';
  tossView.tossTo = -1;
  tossView.fits = true;
  return tossView;
}

/** A treat or pepper in hand, a dog within a throw (P19): the button throws it to the dog. */
export function describeTreat(dog: string, tile: number, pepper: boolean, fed: boolean): ToolView {
  tossView.verb = t(pepper ? 'act.throwAt' : 'act.throwTo');
  tossView.what = dog;
  tossView.icon = pepper ? 'wind' : 'bone';
  tossView.tossTo = tile;
  // (Jerky for a dog that's had today's: it would only land on the floor.)
  tossView.fits = !fed;
  return tossView;
}

/** The burner phone in hand (P21): the button opens its panel ("Call · the fixer's people"). */
const callView: ToolView = { verb: '', what: '', icon: 'phone', fits: true, progress: null, repeat: false, call: true };
export function describeCall(): ToolView {
  callView.verb = t('act.call');
  callView.what = t('thing.outside');
  return callView;
}

/** A dog's name (P19), by its place in the state's dogs. */
export const dogName = (sim: Sim, k: number) => dogDef(sim.world, k).name;

/** The tool button's face, refilled in place. */
const toolView: ToolView = { verb: '', what: '', icon: '', fits: true, progress: null, repeat: true };

/** Who someone is (Cast id): "Rusty · cell 3", "Officer Keller · purple key". */
function personName(sim: Sim, id: number): string {
  const s = sim.state;
  if (!isGuard(s, id)) return t('combat.inmateNamed', { name: inmateName(sim, id), n: s.inmates[id]?.cell ?? 0 });
  const d = sim.prison.guards[id - s.inmates.length];
  const key = t(`keyColor.${d.key}` as Key);
  return d.name ? guardWord(sim, 'combat.guardNamed', { name: d.name, key }) : t('combat.guard', { key });
}

/** What a container is called ("your desk", "bookshelf", someone's pockets). */
export function thingName(sim: Sim, index: number): string {
  const who = ownerOf(sim.world, index);
  if (who >= 0) return personName(sim, who);
  const c = containersOf(sim.world)[index];
  if (!c) return '';
  const k = c.prop.kind;
  if (c.mine && (k === 'desk' || k === 'bed')) return t(k === 'desk' ? 'thing.myDesk' : 'thing.myBed');
  return t(`thing.${k}` as Key);
}
/** The open container's title, worked out once per container and language. */
let titleKey = '';
let titleText = '';
export function boxTitle(sim: Sim, index: number) {
  // Someone's pockets: and how long before they come round.
  const who = ownerOf(sim.world, index);
  const ko = who >= 0 ? (personOf(sim.state, who)?.ko ?? 0) : 0;
  const key = `${sim.prison.id}:${index}:${textStamp()}:${Math.ceil(ko / STEPS_PER_SECOND)}`;
  if (key !== titleKey) {
    titleKey = key;
    const name = thingName(sim, index);
    titleText = name.charAt(0).toUpperCase() + name.slice(1);
    const c = who < 0 ? containersOf(sim.world)[index] : undefined;
    const cell = c && !c.mine && (c.prop.kind === 'desk' || c.prop.kind === 'bed') ? sim.world.cellOf[c.prop.z * MAP_W + c.prop.x] : 0;
    const inmate = cell > 1 ? inmateInCell(sim.state, cell) : -1;
    if (inmate >= 0) titleText = `${titleText} · ${personName(sim, inmate)}`;
    if (who >= 0)
      titleText = t(isGuard(sim.state, who) ? 'box.pocketsGuard' : 'box.pocketsInmate', { s: Math.ceil(ko / STEPS_PER_SECOND) });
  }
  return titleText;
}

/** What the action button says: a verb ("Search") and what to ("your desk"); `no`: greyed, saying why it won't. */
export type ActionWords = { verb: string; what: string; no?: boolean };

/** The action label, worked out only when the plan (or language) changes, into one object refilled in place. */
const actionLabel: ActionWords = { verb: '', what: '', no: false };
let actionKey = '';
function say(key: string, verb: Key, what: () => string): ActionWords {
  if (key !== actionKey) {
    actionKey = key;
    actionLabel.verb = t(verb);
    actionLabel.what = what();
    actionLabel.no = false;
  }
  return actionLabel;
}
const none = () => '';

/** A new game: no words kept from the last one (the same key can name another place, person or vehicle). */
export function forgetWords() {
  actionKey = '';
}

/**
 * The action button's words, or none while something has the screen: a panel or a talk open, a set or
 * a game going (seated, only those that cover the chair; `panel`: one of the play layer's own, the
 * talk, the job board, a profile), or the player busy (asleep, out cold, paused, over), except in
 * solitary and stowed away, where the button stays (a potato, climbing out).
 */
export function actionWords(sim: Sim, plan: Plan | null, held: number, busy: boolean, panel: boolean): ActionWords | null {
  const st = sim.state;
  const it = st.items;
  if (st.solitary > 0 || st.stowed) return describePlan(sim, plan, held);
  const covered =
    st.seat >= 0
      ? (st.train >= 0 && !sim.rules230) || it.open >= 0 || st.talk >= 0
      : it.open >= 0 || st.talk >= 0 || st.train >= 0 || st.askTurn.length > 0 || panel;
  return busy || covered ? null : describePlan(sim, plan, held);
}

/** The words for what a press does now (interact.ts's plan): it says what the sim will do, never decides it. */
export function describePlan(sim: Sim, plan: Plan | null, held: number): ActionWords | null {
  if (!plan) return null;
  const lang = textStamp();
  const st = sim.state;
  switch (plan.do) {
    case 'peel':
      return say(`peel:${lang}`, 'act.peel', () => t('act.potato'));
    // Called by the warden at roll call (2.27): nothing comes before answering.
    case 'answer':
      return say(`here:${lang}`, 'act.here', none);
    // (Reading at a chair: the reading game has the screen and its own buttons.)
    case 'underline':
      return null;
    case 'readOn':
      return say(`readOn:${st.book}:${lang}`, 'act.read', () => t(`book.${SUBJECTS[st.book - 1]}.title` as Key));
    case 'getUp':
      return say(`getUp:${lang}`, 'act.getUp', none);
    case 'climbOut':
      return say(`climbOut:${lang}`, 'act.climbOut', none);
    case 'stow':
      return say(`stow:${lang}`, 'act.stow', () => vehicleThe(sim));
    case 'report':
    case 'fileForm':
      return deskAction(sim);
    case 'showId':
      return windowAction(sim);
    case 'work': {
      // On the job: the station's step ("Load the washer", "Take out: clean laundry").
      const station = plan.station;
      return say(`station:${station.act}:${station.prop}:${station.item}:${lang}`, `work.${station.act}` as Key, () => {
        const prop = sim.world.props[station.prop];
        if (station.act === 'mop') return t('thing.puddle');
        if (station.act === 'running' || station.act === 'full') return prop ? t(`thing.${prop.kind}` as Key) : '';
        if (station.act === 'take' || station.act === 'unload' || station.act === 'put' || station.act === 'load')
          return itemName(station.item);
        return prop ? t(`thing.${prop.kind}` as Key) : t('thing.puddle');
      });
    }
    case 'climb': {
      const climb = plan.climb;
      return say(`climb:${climb.action}:${climb.item ?? 0}:${lang}`, `act.${climb.action}` as Key, () => {
        const what: Record<string, string> = {
          climbVent: t('thing.vent'),
          dropDown: '',
          climbRoof: t('thing.ladderRoof'),
          climbDownLadder: '',
          climbDown: t('thing.tunnel'),
          climbUp: '',
          uncover: climb.item ? itemName(climb.item) : '',
        };
        return what[climb.action];
      });
    }
    // At the serving counter during a meal (2.25): the tray first, a search at the next press.
    case 'tray':
      return say(`tray:${plan.offer}:${lang}`, plan.offer === 'take' ? 'act.takeTray' : 'act.returnTray', none);
    // Under a shower at shower time (2.26): the water first, a search at the next press.
    case 'shower':
      return say(`shower:${lang}`, 'act.shower', none);
    // The vending machine (2.32), the water cooler and the menu board (2.33), ahead of whoever's beside them.
    case 'vend':
      return say(`vending:${lang}`, 'act.vending', () => t('thing.vending'));
    case 'cooler':
      return say(`cooler:${lang}`, 'act.drinkAt', () => t('thing.cooler'));
    case 'menu':
      return say(`menu:${lang}`, 'act.readMenu', () => t('thing.menu'));
    // The bed at night (2.28): the dummy in or out first; the next press lies down.
    case 'bed':
      return say(`bed:${plan.bed}:${lang}`, plan.bed === 'tuck' ? 'act.tuckIn' : 'act.takeOut', () => itemName(BED_DUMMY));
    case 'sleep':
      return say(`sleep:${lang}`, 'act.sleep', none);
    case 'talk': {
      // The player's letter for them (the mail round), else a talk.
      const who = plan.target.who;
      const it = st.items;
      const mail = sim.onDuty && st.mail.includes(who) && it.inv.slice(0, 6).some((v) => itemOf(v) === LETTER && usesOf(v) - 1 === who);
      const n = st.inmates.length;
      // A guard by its title, as the sentence needs it ("Parler au gardien Pratt").
      const guard = who >= n ? sim.prison.guards[who - n] : undefined;
      // (2.39: someone at an inmates' game who'll play the player: the press joins it, a talk offering that game.)
      // (Dice and cards are played for a stake: with less than the smallest on them, a plain talk.)
      const at = !mail && !guard && !gameRefusal(sim, who) ? huddleGameOf(sim, who) : -1;
      const game = at === HUDDLE.HOOPS || (at >= 0 && st.cash >= STAKES[0]) ? at : -1;
      const verb = mail
        ? 'act.deliver'
        : guard
          ? 'act.talkGuard'
          : game === HUDDLE.DICE
            ? 'act.joinDice'
            : game === HUDDLE.CARDS
              ? 'act.joinCards'
              : game === HUDDLE.HOOPS
                ? 'act.joinHoops'
                : 'act.talk';
      return say(`person:${who}:${mail}:${game}:${lang}`, verb, () =>
        !guard ? inmateName(sim, who) : guard.name ? guardWord(sim, 'guard.addressed', { name: guard.name }) : t('guard.addressedNameless'),
      );
    }
    case 'fixture':
      return fixtureWords(sim, plan.target, lang);
    case 'pickUp':
      return say(`ground:${plan.target.index}:${plan.target.item}:${lang}`, 'act.pickUpVerb', () => itemName(plan.target.item));
    case 'pockets':
      return say(`pockets:${plan.target.index}:${lang}`, 'act.searchVerb', () => t('thing.pockets'));
    // Dirt in hand at a toilet: down it goes.
    case 'flush':
      return say(`flush:${plan.target.index}:${held}:${lang}`, 'act.flush', () => itemName(held));
    case 'search':
      return say(`container:${plan.target.index}:${lang}`, 'act.searchVerb', () => thingName(sim, plan.target.index));
  }
}

/** A fixture's words: the generator says which way it would go (GDD §5.5), and at Irongate which one it is (P12); the helipad, whether the helicopter is in. */
function fixtureWords(sim: Sim, target: Extract<Target, { kind: 'fixture' }>, lang: string): ActionWords {
  if (target.use === 'vending') return say(`vending:${lang}`, 'act.vending', () => t('thing.vending'));
  if (target.use === 'cooler') return say(`cooler:${lang}`, 'act.drinkAt', () => t('thing.cooler'));
  const gen = target.use === 'generator' ? genOf(sim.world, target.index) : 0;
  const power = target.use === 'generator' ? offFor(sim.state, gen) === 0 : target.use === 'helicopter' ? helicopterIn(sim) : true;
  const kind = sim.world.props[target.index].kind;
  // (2.29: someone on the machine: they're asked for it, or with no use for it talked to. As actions.ts does.)
  const offer = machineOffer(sim, target.index);
  const on = offer === 'talk' ? onMachine(sim, target.index) : -1;
  // (2.31: a book in hand, at a library chair: it's read there.)
  const book =
    target.use === 'sit' &&
    sim.state.book > 0 &&
    sim.world.zoneAt(sim.world.props[target.index].x, sim.world.props[target.index].z) === 'library'
      ? sim.state.book
      : 0;
  const verb = book
    ? 'act.read'
    : offer === 'ask'
      ? 'act.askTurn'
      : offer === 'talk'
        ? 'act.talk'
        : target.use === 'generator'
          ? power
            ? 'act.powerOff'
            : 'act.powerOn'
          : target.use === 'helicopter' && !power
            ? 'act.helipad'
            : `act.${target.use}`;
  return say(`fixture:${target.use}:${kind}:${power}:${gen}:${offer}:${on}:${book}:${lang}`, verb as Key, () => {
    // A seat, bench or chair by its own name; an infirmary bed; GEN-1 and GEN-2 by what they run.
    const thing =
      target.use === 'board'
        ? 'jobBoard'
        : target.use === 'sit'
          ? kind
          : target.use === 'rest'
            ? 'infirmaryBed'
            : target.use === 'generator' && sim.world.def.grid
              ? `gen${gen + 1}`
              : target.use === 'helicopter' && !power
                ? 'helipad'
                : target.use;
    return book ? t(`book.${SUBJECTS[book - 1]}.title` as Key) : on >= 0 ? inmateName(sim, on) : t(`thing.${thing}` as Key);
  });
}

/** Delivery day (P18): the vehicle that comes ("Supply truck"), as said in a sentence ("the supply truck"). */
const vehicleOf = (sim: Sim) => sim.prison.delivery?.vehicle ?? 'truck';
export const vehicleName = (sim: Sim) => t(`vehicle.${vehicleOf(sim)}` as Key);
export const vehicleThe = (sim: Sim) => t(`vehicle.the.${vehicleOf(sim)}` as Key);

const DESK = { verb: '', what: '', no: false };
const TRAY_WHY: Record<string, Key> = {
  watched: 'thing.trayWatched',
  hunted: 'thing.hunted',
  onList: 'thing.onList',
  trayLate: 'thing.trayLate',
};
const DESK_WHY: Record<string, Key> = { heat: 'thing.releaseHeat', lockdown: 'thing.hunted', contraband: 'thing.releaseContraband' };

/** At the release desk (P36): Report (the name called; said what the desk will mind, it can still be tried), or File the form (greyed, saying why, when it wouldn't go in). */
export function deskAction(sim: Sim): ActionWords | null {
  if (atRelease(sim)) {
    const r = releaseRefusal(sim.state);
    DESK.verb = t('act.report');
    DESK.what = t(r ? DESK_WHY[r] : 'thing.releaseDesk');
    DESK.no = false;
    return DESK;
  }
  if (atTray(sim)) {
    const r = trayRefusal(sim);
    DESK.verb = t('act.fileForm');
    DESK.what = t(r ? TRAY_WHY[r] : 'thing.releaseTray');
    DESK.no = !!r;
    return DESK;
  }
  return null;
}

const SHOW_ID = { verb: '', what: '', no: false };
/** Why not, as the button's second line (the sim's own refusal). */
const WHY: Record<string, Key> = {
  notShift: 'thing.shiftAt',
  notGuard: 'thing.needUniform',
  papersHot: 'thing.papersHot',
  hunted: 'thing.hunted',
};

/** At the checkpoint's window with a fake ID in the hotbar (P24): the action button shows it (greyed, saying why, when it wouldn't do now). */
export function windowAction(sim: Sim): ActionWords {
  const why = bluffRefusal(sim);
  SHOW_ID.verb = t('act.showId');
  SHOW_ID.what = t(why ? (WHY[why] ?? 'thing.gatekeeper') : 'thing.gatekeeper');
  SHOW_ID.no = !!why;
  return SHOW_ID;
}

/** The weapon the player fights with: one in hand, else the weapon slot (0: fists). */
function weaponOf(it: ItemState): number {
  const inHand = itemOf(it.inv[it.hand]);
  return inHand && itemDef(inHand).cat === 'weapon' ? inHand : itemOf(it.inv[SLOT.WEAPON]);
}

/** The tool button while locked on (GDD §10.1): a blow (held, it keeps swinging) or a throw. */
export function describeAttack(sim: Sim): ToolView | null {
  const s = sim.state;
  if (s.lock < 0 || s.layer !== LAYER.GROUND) return null;
  const f = personOf(s, s.lock);
  if (!f) return null;
  // (P26: a Bare Hands Daily, fists only, as the sim fights.)
  const weapon = twist(s, 'bareHands') ? 0 : weaponOf(s.items);
  const d = weapon ? itemDef(weapon) : null;
  const thrown = !!d?.thrown;
  const reach = thrown ? THROW_RANGE : reachOf(d);
  const p = s.player;
  const inReach = (f.body.x - p.x) ** 2 + (f.body.z - p.z) ** 2 <= reach * reach && lineOfSight(sim.world, p.x, p.z, f.body.x, f.body.z);
  press.attackPace = swingSteps(s.spd, d);
  const v = toolView;
  v.verb = t(thrown ? 'act.throw' : weapon ? 'act.hit' : 'act.punch');
  v.what = weapon ? itemName(weapon) : '';
  v.icon = thrown ? 'splash' : 'fist';
  v.fits = inReach;
  v.progress = null;
  v.repeat = !thrown;
  v.attack = true;
  v.confirm = false;
  v.armed = false;
  v.uses = null;
  v.short = false;
  return v;
}

/** The target card's contents, refilled in place. */
let targetNameKey = -1;
const targetView: TargetInfo = { name: '', guard: false, health: 1, str: 0, attitude: 'calm', inReach: false };
export function targetInfo(sim: Sim): TargetInfo | null {
  const s = sim.state;
  const f = s.lock >= 0 ? personOf(s, s.lock) : undefined;
  if (!f) return null;
  const v = targetView;
  const guard = isGuard(s, s.lock);
  const nameKey = s.lock * 8 + (currentLang() === 'fr' ? 1 : 0);
  if (nameKey !== targetNameKey) {
    targetNameKey = nameKey;
    v.name = personName(sim, s.lock);
  }
  v.guard = guard;
  v.health = f.hp / maxHealth(f.str);
  v.str = f.str;
  v.attitude = guard
    ? s.guards[s.lock - s.inmates.length].mode === GUARD.CHASE
      ? 'chasing'
      : 'onDuty'
    : s.inmates[s.lock].angry > 0
      ? 'angry'
      : 'calm';
  v.inReach = !!press.toolNow?.attack && press.toolNow.fits;
  return v;
}

/** The tool button's face for a strike target, refilled in place (no garbage per frame). */
export function describeTool(sim: Sim, tt: ToolTarget | null, held: number): ToolView | null {
  if (!tt) return null;
  const d = held ? itemDef(held) : null;
  const strike = STRIKES.has(tt.action);
  // Only with a tool (or something to put in place) in hand: a sock against a wall offers nothing.
  if (strike && !d?.tool && tt.action !== 'sharpen') return null;
  const w = sim.world;
  const v = toolView;
  v.attack = false;
  v.caption = false;
  v.confirm = false;
  v.armed = false;
  v.uses = null;
  v.short = false;
  // (2.32: a can or a cup's drunk, not eaten.)
  v.verb = t(tt.action === 'eat' && itemDef(held).food?.drink ? 'act.drink' : (`act.${tt.action}` as Key));
  v.icon = TOOL_ICON[tt.action];
  // An alarm clock (P14): wound, or stopped while it rings.
  if (tt.action === 'wind') {
    if (clockRinging(sim.state.items.inv[sim.state.items.hand])) v.verb = t('act.stop');
    v.what = t('thing.clock');
    v.fits = true;
    v.repeat = false;
    v.progress = null;
    return v;
  }
  // 2.36 (The Six Hunter): the recall horn, every hound sent home (grey where there are none).
  if (tt.action === 'blow') {
    v.what = t('thing.hounds');
    v.fits = tt.fits;
    v.repeat = false;
    v.progress = null;
    return v;
  }
  // The hollow book (P35): what it hides taken out (grey with nothing inside: a small item moved onto it goes in).
  if (tt.action === 'unbook') {
    const inside = hiddenIn(sim.state.items.inv[sim.state.items.hand]);
    v.what = inside ? itemName(itemOf(inside)) : t('thing.bookEmpty');
    v.fits = tt.fits;
    v.repeat = false;
    v.progress = null;
    return v;
  }
  // P42: a pumpkin carved into a lantern (grey but in the kitchen).
  if (tt.action === 'carve') {
    v.what = tt.fits ? itemName(held) : t('holiday.carveWhere');
    v.fits = tt.fits;
    v.repeat = false;
    v.progress = null;
    return v;
  }
  // A bar of soap (P19): the scent washed off (grey with none to wash).
  if (tt.action === 'wash') {
    v.what = t('thing.scent');
    v.fits = sim.state.scent.length > 0;
    v.repeat = false;
    v.progress = null;
    return v;
  }
  // A caught rat (P20): fed (its meals so far out of RAT_MEALS); grey with no bait in the hotbar, or a rat already tame.
  if (tt.action === 'feed') {
    const pet = !!petOf(sim.state);
    v.what = pet
      ? t('thing.ratHaveOne')
      : tt.fits
        ? t('thing.ratMeals', { n: usesOf(sim.state.items.inv[sim.state.items.hand]), of: RAT_MEALS })
        : t('thing.ratBait');
    v.fits = tt.fits && !pet;
    v.repeat = false;
    v.progress = pet ? null : usesOf(sim.state.items.inv[sim.state.items.hand]) / RAT_MEALS;
    return v;
  }
  // Long games (P28): pruno drunk (tipsy, and the heat if seen); the rat's laps (its speed, or why not now); a garden bed (its crop, its stage, today's cupfuls).
  if (tt.action === 'drink') {
    // (One press only arms it: the second, within DRINK_CONFIRM_MS, drinks. A stray tap never downs a $40 bottle.)
    v.confirm = true;
    v.armed = drinkArmed();
    if (v.armed) v.verb = t('act.drinkSure');
    v.what = t('thing.pruno', { n: TIPSY_STEPS / STEPS_PER_MINUTE / 60 });
    v.fits = true;
    v.repeat = false;
    v.progress = null;
    return v;
  }
  if (tt.action === 'track') {
    const why = trackCheck(sim);
    const pet = petOf(sim.state);
    v.what = why ? t(`thing.track.${why}` as Key) : t('thing.trackSpeed', { name: ratName(sim), n: pet?.speed ?? 0 });
    v.fits = !why;
    v.repeat = false;
    v.progress = pet && !why ? (pet.speed ?? 0) / 100 : null;
    return v;
  }
  if (tt.action === 'plant' || tt.action === 'water' || tt.action === 'harvest') {
    const k = bedAt(w, tt.tile);
    const b = bedOf(sim.state.plots, k);
    const crop = t(b[BED.CROP] === CROP.FRUIT ? 'thing.fruitBed' : 'thing.vegBed');
    v.what =
      tt.action === 'plant'
        ? t('thing.gardenBed')
        : tt.action === 'harvest'
          ? crop
          : t(wilted(b) ? 'thing.bedWilted' : 'thing.bedGrowing', {
              crop,
              n: b[BED.GROWN],
              of: GROWN,
              w: b[BED.WATER],
              m: planOf(sim).weather === 'heatwave' ? HEATWAVE_WATER : 1,
            });
    v.fits = tt.fits;
    v.repeat = false;
    v.progress = tt.action === 'water' ? b[BED.GROWN] / GROWN : null;
    return v;
  }
  // A rat trap (P20): set down here, and the odds of a rat by morning.
  if (tt.action === 'setTrap') {
    const chance = trapChance(w, sim.state.layer, tt.tile);
    v.what = chance ? t('thing.trapOdds', { n: chance }) : t('thing.trapNone');
    v.fits = true;
    v.repeat = false;
    v.progress = null;
    return v;
  }
  // The lockpick (P22): a keyed door's pins (set so far, once at it); a perimeter gate has none to pick.
  if (tt.action === 'pick') {
    const s = sim.state;
    const at = s.pick.length > 0 && s.pick[0] === tt.tile;
    v.verb = t(at ? 'act.setPin' : 'act.pick');
    v.what = tt.fits
      ? t('thing.lock', { key: t(`keyColor.${KEY_ITEM_COLORS[w.ground.key[tt.tile] - 1]?.[0] ?? 'yellow'}` as Key) })
      : t('thing.gate');
    v.fits = tt.fits;
    v.repeat = false;
    v.progress = at ? s.pick[1] / Math.max(1, tt.hp) : null;
    return v;
  }
  // A glider at a roof's edge (P24): how far the wind carries it and where it comes down, or why it can't go.
  if (tt.action === 'glide') {
    const g = tt.glide!;
    v.caption = true;
    v.what =
      g.why === 'storm'
        ? t('thing.glideStorm')
        : g.why === 'runUp'
          ? t('thing.glideRunUp')
          : g.why === 'noLanding'
            ? t('thing.glideNowhere')
            : t(g.out ? (g.dist === 1 ? 'thing.glideOutOne' : 'thing.glideOut') : g.dist === 1 ? 'thing.glideInOne' : 'thing.glideIn', {
                n: g.dist,
              });
    v.fits = tt.fits;
    v.repeat = false;
    v.progress = null;
    return v;
  }
  // A comb or toothbrush on a wall: strokes so far against those it takes.
  if (tt.action === 'sharpen') {
    v.what = t('thing.wall');
    v.fits = true;
    v.repeat = true;
    v.progress = Math.min(1, usesOf(sim.state.items.inv[sim.state.items.hand]) / tt.hp);
    return v;
  }
  // Grey when it can't be done: the wrong tool, reinforced concrete, too tired to swing, or (a strike) the last blow with
  // nowhere for what it yields; 2.36: the sim's own answer (planStrike), so a crew digger's help counts here as it does there.
  const plan = strike ? planStrike(sim, tt, held) : null;
  v.fits = tt.fits && (!plan || !plan.why);
  // Digging up takes a press per strike (a hold never surfaces the player).
  v.repeat = strike && tt.action !== 'digUp';
  if (tt.action === 'eat')
    v.fits = itemDef(held).food ? foodUse(held, sim.state.energy, sim.state.health, maxHealth(sim.state.str)) : sim.state.energy < 100;
  if (!strike) {
    v.what =
      tt.action === 'eat'
        ? held === CHOC_EGG || held === ICE_LOLLY || itemDef(held).food
          ? itemName(held)
          : t('thing.chocolate')
        : tt.action === 'cover'
          ? t(tt.layer === LAYER.VENTS ? 'thing.grate' : 'thing.hole')
          : tt.action === 'brace'
            ? ''
            : tt.action === 'grapnel'
              ? t(
                  !tt.fits
                    ? 'thing.needRope'
                    : tt.layer === LAYER.ROOF
                      ? w.zoneAt(tt.tile % MAP_W, Math.floor(tt.tile / MAP_W)) === 'perimeter'
                        ? 'thing.ontoGatehouse'
                        : 'thing.acrossChasm'
                      : w.zoneAt(tt.tile % MAP_W, Math.floor(tt.tile / MAP_W)) === 'outside'
                        ? 'thing.overFence'
                        : 'thing.betweenFences',
                )
              : tt.action === 'tape'
                ? t('thing.camera')
                : tt.action === 'launch'
                  ? t('thing.toSea')
                  : t('thing.rope');
    v.progress = null;
    return v;
  }
  const k = tt.layer === LAYER.GROUND ? w.ground.kind[tt.tile] : 0;
  v.what =
    tt.action === 'chip'
      ? t(k === TILE.REINFORCED ? 'thing.reinforced' : 'thing.wall')
      : tt.action === 'cut'
        ? t(k === TILE.ELECTRIC ? (sim.powered('fence') ? 'thing.electricLive' : 'thing.electricDead') : 'thing.fence')
        : tt.action === 'unscrew'
          ? t('thing.grate')
          : tt.action === 'digUp'
            ? t(k === TILE.MINE && !sim.state.craters.includes(tt.tile) ? 'thing.intoMines' : 'thing.surface')
            : tt.layer === LAYER.UNDER
              ? t(
                  w.layers[LAYER.UNDER].kind[tt.tile] === TILE.BOULDER
                    ? 'thing.boulder'
                    : underSea(w, tt.tile)
                      ? 'thing.underSea'
                      : 'thing.earth',
                )
              : t('thing.floor');
  const worn = sim.state.wear[placeKey(tt.layer, tt.tile)] ?? 0;
  v.progress = tt.hp > 0 ? Math.min(1, worn / tt.hp) : 0;
  // 2.36: the tool's uses left, and whether they'd see it through (what's struck stays struck: another tool takes it on).
  // (Only a tool that does this job: a shovel at a wall has no uses to count here.)
  if (d?.tool && plan && tt.fits && plan.why !== 'tool' && plan.dmg > 0 && tt.hp > 0) {
    v.uses = usesOf(sim.state.items.inv[sim.state.items.hand]);
    v.short = v.uses * plan.dmg < tt.hp - worn;
  }
  return v;
}

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
