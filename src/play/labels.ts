import { itemDef, itemNumber } from '../content/items';
import { currentLang, t, type Key } from '../i18n';
import { lineOfSight } from '../sim/ai/sight';
import { SLOT } from '../sim/command';
import type { Sim } from '../sim/Sim';
import { isGuard, maxHealth, personOf, reachOf, swingSteps } from '../sim/systems/combat';
import type { Station } from '../sim/systems/economy';
import { GUARD } from '../sim/systems/guards';
import { itemOf, ownerOf, usesOf, type ItemState, type Target } from '../sim/systems/items';
import { DIRT, STRIKES, WALL_CHUNK, type ClimbTarget, type ToolTarget } from '../sim/systems/structure';
import { energyCost } from '../sim/systems/weather';
import { STEPS_PER_SECOND, THROW_RANGE } from '../sim/tuning';
import { containersOf } from '../sim/world/containers';
import { TILE } from '../sim/world/tiles';
import { LAYER, MAP_W, placeKey } from '../sim/world/World';
import type { TargetInfo } from '../ui/combat';
import { itemName } from '../ui/items';
import { inmateName } from '../ui/social';
import type { ToolView } from '../ui/tool';
import { press } from './buttons';

/**
 * The words on the buttons and cards: who someone is, what a container is called, what the
 * action and tool buttons would do. Each is worked out only when what it describes (or the
 * language) changes, into objects refilled in place.
 */

const LETTER = itemNumber('letter');

/** Why a strike can't land, by what it needs. */
export const NEED: Record<string, string> = {
  rope: 'toast.noLanding', chip: 'toast.needChip', cut: 'toast.needCut', unscrew: 'toast.needUnscrew', dig: 'toast.needDig', digUp: 'toast.needDig', eat: 'toast.needDig' };

/** Tool actions as numbers (the held button's target key, compared each frame without strings). */
export const ACTION_IDS = ['chip', 'cut', 'unscrew', 'dig', 'digUp', 'eat', 'cover', 'brace', 'rope', 'sharpen', 'grapnel', 'tape'];
const TOOL_ICON: Record<string, string> = { chip: 'pick', dig: 'shovel', digUp: 'up', cut: 'cutters', unscrew: 'screw', eat: 'cookie', cover: 'lock', brace: 'hammer', rope: 'down', sharpen: 'sword', grapnel: 'hook', tape: 'eyeOff' };

/** The tool button's face, refilled in place. */
const toolView: ToolView = { verb: '', what: '', icon: '', fits: true, progress: null, repeat: true };

/** Who someone is (Cast id): "Inmate · cell 3", "Guard · purple key". */
export function personName(sim: Sim, id: number): string {
  const s = sim.state;
  if (!isGuard(s, id)) return t('combat.inmateNamed', { name: inmateName(sim, id), n: s.inmates[id]?.cell ?? 0 });
  return t('combat.guard', { key: t(`keyColor.${sim.prison.guards[id - s.inmates.length].key}` as Key) });
}

/** What a container is called ("your desk", "bookshelf", someone's pockets). */
function thingName(sim: Sim, index: number): string {
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
      Object.assign(actionLabel, { verb: t(mail ? 'act.deliver' : 'act.talk'), what: inmateName(sim, target.who) });
    }
    return actionLabel;
  }
  if (target.kind === 'fixture') {
    // The generator says which way it would go (GDD §5.5).
    const power = target.use === 'generator' ? sim.power : true;
    const kind = sim.world.props[target.index].kind;
    const key = `fixture:${target.use}:${kind}:${power}:${currentLang()}`;
    if (key !== actionKey) {
      actionKey = key;
      const verb = target.use === 'generator' ? (power ? 'act.powerOff' : 'act.powerOn') : `act.${target.use}`;
      // A seat, bench or chair by its own name; an infirmary bed.
      const thing = target.use === 'board' ? 'jobBoard' : target.use === 'sit' ? kind : target.use === 'rest' ? 'infirmaryBed' : target.use;
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
  const weapon = weaponOf(s.items);
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
  v.verb = t(`act.${tt.action}` as Key);
  v.icon = TOOL_ICON[tt.action];
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
        ? t('thing.chocolate')
        : tt.action === 'cover'
          ? t(tt.layer === LAYER.VENTS ? 'thing.grate' : 'thing.hole')
          : tt.action === 'brace'
            ? ''
            : tt.action === 'grapnel'
              ? t(!tt.fits ? 'thing.needRope' : tt.layer === LAYER.ROOF ? 'thing.ontoGatehouse' : w.zoneAt(tt.tile % MAP_W, Math.floor(tt.tile / MAP_W)) === 'outside' ? 'thing.overFence' : 'thing.betweenFences')
              : tt.action === 'tape'
                ? t('thing.camera')
                : t('thing.rope');
    v.progress = null;
    return v;
  }
  const k = tt.layer === LAYER.GROUND ? w.ground.kind[tt.tile] : 0;
  v.what =
    tt.action === 'chip'
      ? t(k === TILE.REINFORCED ? 'thing.reinforced' : 'thing.wall')
      : tt.action === 'cut'
        ? t(k === TILE.ELECTRIC ? (sim.power ? 'thing.electricLive' : 'thing.electricDead') : 'thing.fence')
        : tt.action === 'unscrew'
          ? t('thing.grate')
          : tt.action === 'digUp'
            ? t('thing.surface')
            : tt.layer === LAYER.UNDER
              ? t(w.layers[LAYER.UNDER].kind[tt.tile] === TILE.BOULDER ? 'thing.boulder' : 'thing.earth')
              : t('thing.floor');
  const worn = sim.state.wear[placeKey(tt.layer, tt.tile)] ?? 0;
  v.progress = tt.hp > 0 ? Math.min(1, worn / tt.hp) : 0;
  // The last blow would drop a chunk or dirt at the player's feet with no room in their pockets: grey, as the sim refuses it.
  const yields = tt.action === 'chip' || (tt.action === 'dig' && tt.layer === LAYER.GROUND);
  if (yields && sim.state.layer === LAYER.GROUND && d?.tool && worn + d.tool.damage >= tt.hp && !sim.state.items.inv.slice(0, 6).includes(0)) v.fits = false;
  return v;
}
