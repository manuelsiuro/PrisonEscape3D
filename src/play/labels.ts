import { twist } from '../sim/systems/twists';
import { itemDef, itemNumber, KEY_ITEM_COLORS } from '../content/items';
import { currentLang, t, type Key } from '../i18n';
import { lineOfSight } from '../sim/ai/sight';
import { SLOT } from '../sim/command';
import type { Sim } from '../sim/Sim';
import { isGuard, maxHealth, personOf, reachOf, swingSteps } from '../sim/systems/combat';
import type { Station } from '../sim/systems/economy';
import { GUARD } from '../sim/systems/guards';
import { itemOf, ownerOf, usesOf, type ItemState, type Target } from '../sim/systems/items';
import { genOf, offFor } from '../sim/systems/power';
import { helicopterIn } from '../sim/systems/sea';
import { clockRinging } from '../sim/systems/noise';
import { CHOC_EGG, DIRT, ICE_LOLLY, STRIKES, underSea, WALL_CHUNK, type ClimbTarget, type ToolTarget } from '../sim/systems/structure';
import { energyCost } from '../sim/systems/weather';
import { dogDef } from '../sim/systems/k9';
import { petOf, trapChance } from '../sim/systems/rats';
import { RAT_MEALS, STEPS_PER_SECOND, THROW_RANGE } from '../sim/tuning';
import { containersOf } from '../sim/world/containers';
import { TILE } from '../sim/world/tiles';
import { LAYER, MAP_W, placeKey } from '../sim/world/World';
import type { TargetInfo } from '../ui/combat';
import { itemName } from '../ui/items';
import { hiddenIn } from '../sim/systems/kiosk';
import { inmateName } from '../ui/social';
import type { ToolView } from '../ui/tool';
import { drinkArmed, press } from './buttons';
import { trackCheck } from '../sim/systems/races';
import { BED, bedAt, bedOf, wilted } from '../sim/systems/garden';
import { CROP, GROWN, HEATWAVE_WATER, TIPSY_STEPS } from '../content/long';
import { planOf } from '../sim/systems/calendar';
import { STEPS_PER_MINUTE } from '../sim/tuning';
import { ratName } from './rat';

/**
 * The words on the buttons and cards: who someone is, what a container is called, what the
 * action and tool buttons would do. Each is worked out only when what it describes (or the
 * language) changes, into objects refilled in place.
 */

const LETTER = itemNumber('letter');

/** Why a strike can't land, by what it needs. */
export const NEED: Record<string, string> = {
  rope: 'toast.noLanding', glide: 'toast.noLanding', chip: 'toast.needChip', cut: 'toast.needCut', unscrew: 'toast.needUnscrew', dig: 'toast.needDig', digUp: 'toast.needDig', eat: 'toast.needDig', pick: 'toast.pickGate' };

/** Tool actions as numbers (the held button's target key, compared each frame without strings). */
export const ACTION_IDS = ['chip', 'cut', 'unscrew', 'dig', 'digUp', 'eat', 'cover', 'brace', 'rope', 'sharpen', 'grapnel', 'tape', 'launch', 'wind', 'wash', 'feed', 'setTrap', 'pick', 'glide', 'drink', 'track', 'plant', 'water', 'harvest', 'unbook', 'carve'];
const TOOL_ICON: Record<string, string> = { chip: 'pick', dig: 'shovel', digUp: 'up', cut: 'cutters', unscrew: 'screw', eat: 'cookie', cover: 'lock', brace: 'hammer', rope: 'down', sharpen: 'sword', grapnel: 'hook', tape: 'eyeOff', launch: 'boat', wind: 'clock', wash: 'drop', feed: 'cookie', setTrap: 'rat', pick: 'lockpick', glide: 'glider', drink: 'brew', track: 'race', plant: 'sprout', water: 'water', harvest: 'fruit', unbook: 'book', carve: 'pumpkin' };

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
export function personName(sim: Sim, id: number): string {
  const s = sim.state;
  if (!isGuard(s, id)) return t('combat.inmateNamed', { name: inmateName(sim, id), n: s.inmates[id]?.cell ?? 0 });
  const d = sim.prison.guards[id - s.inmates.length];
  const key = t(`keyColor.${d.key}` as Key);
  return d.name ? t('combat.guardNamed', { name: d.name, key }) : t('combat.guard', { key });
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
  const key = `${index}:${currentLang()}:${Math.ceil(ko / STEPS_PER_SECOND)}`;
  if (key !== titleKey) {
    titleKey = key;
    const name = thingName(sim, index);
    titleText = name.charAt(0).toUpperCase() + name.slice(1);
    if (who >= 0) titleText = t(isGuard(sim.state, who) ? 'box.pocketsGuard' : 'box.pocketsInmate', { s: Math.ceil(ko / STEPS_PER_SECOND) });
  }
  return titleText;
}

/** The action label for what is in reach, worked out only when the target (or language) changes. */
const actionLabel = { verb: '', what: '' };
let actionKey = '';
export function describeTarget(sim: Sim, target: Target, climb: ClimbTarget | null, held: number, station: Station | null = null): { verb: string; what: string } | null {
  if (station && !climb) {
    // On the job: the station's step ("Load the washer", "Take out: clean laundry").
    const key = `station:${station.act}:${station.prop}:${station.item}:${currentLang()}`;
    if (key !== actionKey) {
      actionKey = key;
      const prop = sim.world.props[station.prop];
      const what = station.act === 'take' || station.act === 'unload' || station.act === 'put' || station.act === 'load' ? itemName(station.item) : prop ? t(`thing.${prop.kind}` as Key) : t('thing.puddle');
      Object.assign(actionLabel, { verb: t(`work.${station.act}` as Key), what: station.act === 'mop' ? t('thing.puddle') : station.act === 'running' || station.act === 'full' ? (prop ? t(`thing.${prop.kind}` as Key) : '') : what });
    }
    return actionLabel;
  }
  if (climb) {
    const key = `climb:${climb.action}:${climb.item ?? 0}:${currentLang()}`;
    if (key !== actionKey) {
      actionKey = key;
      const what: Record<string, string> = {
        climbVent: t('thing.vent'),
        dropDown: '',
        climbRoof: t('thing.ladderRoof'),
        climbDownLadder: '',
        climbDown: t('thing.tunnel'),
        climbUp: '',
        uncover: climb.item ? itemName(climb.item) : '',
      };
      Object.assign(actionLabel, { verb: t(`act.${climb.action}` as Key), what: what[climb.action] });
    }
    return actionLabel;
  }
  if (!target) return null;
  // Dirt in hand at a toilet: down it goes.
  const flush = target.kind === 'container' && (held === DIRT || held === WALL_CHUNK) && containersOf(sim.world)[target.index].prop.kind === 'toilet';
  if (target.kind === 'person') {
    // The player's letter for them (the mail round), else a talk.
    const letter = LETTER;
    const it = sim.state.items;
    const mail = sim.onDuty && sim.state.mail.includes(target.who) && it.inv.slice(0, 6).some((v) => itemOf(v) === letter && usesOf(v) - 1 === target.who);
    const key = `person:${target.who}:${mail}:${currentLang()}`;
    if (key !== actionKey) {
      actionKey = key;
      const n = sim.state.inmates.length;
      // A guard by its title, as the sentence needs it ("Parler au gardien Pratt").
      const guard = target.who >= n ? sim.prison.guards[target.who - n] : undefined;
      const what = !guard ? inmateName(sim, target.who) : guard.name ? t('guard.addressed', { name: guard.name }) : t('guard.addressedNameless');
      Object.assign(actionLabel, { verb: t(mail ? 'act.deliver' : guard ? 'act.talkGuard' : 'act.talk'), what });
    }
    return actionLabel;
  }
  if (target.kind === 'fixture') {
    // The generator says which way it would go (GDD §5.5), and at Irongate which one it is (P12); the helipad, whether the helicopter is in.
    const gen = target.use === 'generator' ? genOf(sim.world, target.index) : 0;
    const power = target.use === 'generator' ? offFor(sim.state, gen) === 0 : target.use === 'helicopter' ? helicopterIn(sim) : true;
    const kind = sim.world.props[target.index].kind;
    const key = `fixture:${target.use}:${kind}:${power}:${gen}:${currentLang()}`;
    if (key !== actionKey) {
      actionKey = key;
      const verb = target.use === 'generator' ? (power ? 'act.powerOff' : 'act.powerOn') : target.use === 'helicopter' && !power ? 'act.helipad' : `act.${target.use}`;
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
      Object.assign(actionLabel, { verb: t(verb as Key), what: t(`thing.${thing}` as Key) });
    }
    return actionLabel;
  }
  const key = `${target.kind}:${target.index}:${target.kind === 'ground' ? target.item : 0}:${flush}:${currentLang()}`;
  if (key !== actionKey) {
    actionKey = key;
    if (target.kind === 'ground') Object.assign(actionLabel, { verb: t('act.pickUpVerb'), what: itemName(target.item) });
    else if (target.kind === 'sleep') Object.assign(actionLabel, { verb: t('act.sleep'), what: '' });
    else if (target.kind === 'pockets') Object.assign(actionLabel, { verb: t('act.searchVerb'), what: t('thing.pockets') });
    else if (flush) Object.assign(actionLabel, { verb: t('act.flush'), what: itemName(held) });
    else Object.assign(actionLabel, { verb: t('act.searchVerb'), what: thingName(sim, target.index) });
  }
  return actionLabel;
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
  v.attitude = guard ? (s.guards[s.lock - s.inmates.length].mode === GUARD.CHASE ? 'chasing' : 'onDuty') : s.inmates[s.lock].angry > 0 ? 'angry' : 'calm';
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
  v.verb = t(`act.${tt.action}` as Key);
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
    v.what = pet ? t('thing.ratHaveOne') : tt.fits ? t('thing.ratMeals', { n: usesOf(sim.state.items.inv[sim.state.items.hand]), of: RAT_MEALS }) : t('thing.ratBait');
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
          : t(wilted(b) ? 'thing.bedWilted' : 'thing.bedGrowing', { crop, n: b[BED.GROWN], of: GROWN, w: b[BED.WATER], m: planOf(sim).weather === 'heatwave' ? HEATWAVE_WATER : 1 });
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
    v.what = tt.fits ? t('thing.lock', { key: t(`keyColor.${KEY_ITEM_COLORS[w.ground.key[tt.tile] - 1]?.[0] ?? 'yellow'}` as Key) }) : t('thing.gate');
    v.fits = tt.fits;
    v.repeat = false;
    v.progress = at ? s.pick[1] / Math.max(1, tt.hp) : null;
    return v;
  }
  // A glider at a roof's edge (P24): how far the wind carries it and where it comes down, or why it can't go.
  if (tt.action === 'glide') {
    const g = tt.glide!;
    v.caption = true;
    v.what = g.why === 'storm' ? t('thing.glideStorm') : g.why === 'runUp' ? t('thing.glideRunUp') : g.why === 'noLanding' ? t('thing.glideNowhere') : t(g.out ? (g.dist === 1 ? 'thing.glideOutOne' : 'thing.glideOut') : g.dist === 1 ? 'thing.glideInOne' : 'thing.glideIn', { n: g.dist });
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
  // Grey when it can't be done: the wrong tool, reinforced concrete, or too tired to swing.
  v.fits = tt.fits && (!strike || (tt.hp !== 0 && sim.state.energy >= energyCost(sim, d?.tool?.energy ?? 0)));
  // Digging up takes a press per strike (a hold never surfaces the player).
  v.repeat = strike && tt.action !== 'digUp';
  if (tt.action === 'eat') v.fits = sim.state.energy < 100;
  if (!strike) {
    v.what =
      tt.action === 'eat'
        ? held === CHOC_EGG || held === ICE_LOLLY
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
              ? t(w.layers[LAYER.UNDER].kind[tt.tile] === TILE.BOULDER ? 'thing.boulder' : underSea(w, tt.tile) ? 'thing.underSea' : 'thing.earth')
              : t('thing.floor');
  const worn = sim.state.wear[placeKey(tt.layer, tt.tile)] ?? 0;
  v.progress = tt.hp > 0 ? Math.min(1, worn / tt.hp) : 0;
  // The last blow would drop a chunk or dirt at the player's feet with no room in their pockets: grey, as the sim refuses it.
  const yields = tt.action === 'chip' || (tt.action === 'dig' && tt.layer === LAYER.GROUND);
  if (yields && sim.state.layer === LAYER.GROUND && d?.tool && worn + d.tool.damage >= tt.hp && !sim.state.items.inv.slice(0, 6).includes(0)) v.fits = false;
  return v;
}
