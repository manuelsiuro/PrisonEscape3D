/**
 * What the player does (GDD §2, §3.1, §7, §9): the one-step operation of each command, tools
 * on the structure, covers, braces and ropes, climbing between layers, toilets, bed, seats,
 * showers, and energy and health coming back.
 */
import { ownMate } from './gangs';
import { handsUsed, serveTray } from './canteen';
import { CAKE, eatCake, lineOp, say, startCall } from './phone';
import { bookMove, hiddenIn, kioskOp, openBook } from './kiosk';
import { boardOp, whistle } from './oddjobs';
import { fileForm, report } from './paperwork';
import { paroleOp } from './parole';
import { playNote, quitShow, STAGE_QUIT, startShow } from './talent';
import { answerQuiz, endQuiz, joinQuiz } from './quiz';
import { digHelp, recall } from './crew';
import { itemDef, itemNumber } from '../../content/items';
import { nearestDir } from '../ai/path';
import { centerX, centerZ } from '../world/grid';
import { placesOf } from '../ai/places';
import { argA, argB, argC, EXT, OP, opOf, tossTile } from '../command';
import type { SimContext } from '../context';
import type { LayerMove } from '../state';
import { SPOT, WAKE } from '../events';
import {
  CAMERA_BLIND_STEPS,
  CAVE_IN_DAMAGE,
  CHOCOLATE_ENERGY,
  KO_STEPS,
  SHARPEN_STROKES,
  STRIKE_STEPS,
  TOILET_CLOG_STEPS,
  TOILET_LOADS,
  WORN_WARN,
} from '../tuning';
import { containersOf } from '../world/containers';
import { TILE } from '../world/tiles';
import { maxHealth } from './combat';
import { LAYER, MAP_W, placeKey } from '../world/World';
import { lockCandidates, nextLock } from './combat';
import { attack, hurt } from './fights';
import {
  closeBox,
  craft,
  dropItem,
  equip,
  freeHotbar,
  give,
  HOTBAR,
  hotbarSlotOf,
  type ItemEvent,
  itemOf,
  type ItemState,
  moveItem,
  pickUp,
  slot,
  stillInReach,
  usesOf,
} from './items';
import { jobOp, takeCoins, work } from './jobs';
import { peel } from './justice';
import { blast, liveMine } from './mines';
import { makeNoise, strikeNoise, wind } from './noise';
import { board, flood, launch } from './sea';
import { powered, snipersOnDuty, switchPower } from './power';
import { carve, takeTreat } from './holiday';
import { sniperOn } from './security';
import { climbOut, stow } from './delivery';
import { airOf, showId } from './getaway';
import { approach, dismissAll, endTalk, talkOp } from './social';
import {
  besideOnGround,
  cavesIn,
  type ClimbTarget,
  DIRT,
  SHEET_ROPE,
  SHIVS,
  STRIKES,
  TAR_SOAP,
  toolTarget,
  digUpTarget,
  type ToolTarget,
  underSea,
  WALL_CHUNK,
} from './structure';
import { foodUse, vendOp } from './vending';
import { VEND } from '../../content/vending';
import { MENU } from '../../content/menu';
import { COOLER } from '../../content/cooler';
import { menuOp } from './menu';
import { coolerOp } from './cooler';
import { onReadChair, readOn, rep, stopTraining, study, useMachine } from './training';
import { addHeat, setTile, strikeLayer } from './watch';
import { blowHorn, washScent } from './k9';
import { feedRat, looseRat, sendRat } from './rats';
import { placeOrder } from './smuggling';
import { endBout, pickLock, push, stopPick } from './games';
import { aimShot, releaseShot } from './hoops';
import { energyCost } from './weather';
import { drink } from './pruno';
import { endRatRun, raceOp, ratTap, trainRat } from './races';
import { bedTarget, tend } from './garden';
import { take } from './pantry';
import { pensCommand } from './penalties';
import { drawNeedle, endInk } from './tattoo';
import { answerCount } from './rollcall';
import { startWash, stopWash } from './showers';
import { sitDown, sleep, standUp, takeOutDummy, tuckDummy } from './upkeep';
import { throwItem } from './throwing';

import { bodiesAbout, interactPlan, people, type Plan } from './interact';

/** The player's one-step operation (OP), and the open container closing out of reach. */
export function useItems(sim: SimContext, cmd: number) {
  const s = sim.state;
  const it = s.items;
  const ev = sim.events as ItemEvent[];
  const a = argA(cmd);
  // Every op may change items (the UI redraws on rev); a held use button asks every step, so strikes bump it themselves.
  // (2.35: nor does the block, held and sent every step: it changes no item.)
  if (opOf(cmd) !== OP.NONE && opOf(cmd) !== OP.USE && !(opOf(cmd) === OP.EXT && a === EXT.BLOCK)) it.rev++;
  switch (opOf(cmd)) {
    case OP.INTERACT: {
      // From the open desk panel: down the tunnel under the player's desk (in solitary: a potato, as the plan has it).
      if (a === 1 && s.solitary <= 0) {
        underDesk(sim);
        break;
      }
      // The action button: what interact.ts says it does now (the label, the highlight and a tap read the same plan).
      const plan = interactPlan(sim);
      if (plan) doPlan(sim, plan);
      break;
    }
    case OP.CLOSE:
      if (it.open >= 0) {
        it.open = -1;
        ev.push({ type: 'close' });
      }
      // (P22: in a bout, Close gives up; at a lock, steps back from it.)
      if (s.bout.length) endBout(sim, 'gaveUp');
      stopPick(sim);
      endTalk(sim);
      if (s.train >= 0) stopTraining(sim);
      if (s.seat >= 0) standUp(sim);
      break;
    case OP.TALK:
      talkOp(sim, a, argB(cmd), argC(cmd));
      break;
    case OP.JOB:
      jobOp(sim, a);
      break;
    case OP.TRAIN:
      // (2.43: the rat's training: a press for the bait, 3 stops.)
      if (s.ratRun?.length) {
        if (a === 3) endRatRun(sim);
        else if (a === 1 || a === 2) ratTap(sim);
      } else if (s.bout.length) {
        // An arm-wrestle (P22): the presses push, 3 gives up.
        if (a === 3) endBout(sim, 'gaveUp');
        else if (a === 1 || a === 2) push(sim, a);
      } else if (a === 0) study(sim, argB(cmd));
      else if (a === 3) {
        if (s.train >= 0) stopTraining(sim);
      } else rep(sim, a);
      break;
    case OP.MOVE:
      // (P35: a small item onto an empty hollow book goes inside it.)
      if (!bookMove(sim, a, argB(cmd))) moveItem(it, a, argB(cmd));
      break;
    case OP.DROP:
      dropItem(it, a, s.player, ev, s.layer);
      break;
    case OP.USE:
      // Locked on to someone: a blow (or a throw) at them; else the tool in hand (up off a seat first).
      // (P22: not mid arm-wrestle: both hands are busy.)
      if (s.solitary > 0 || s.bout.length) break;
      standUp(sim);
      stopWash(sim);
      {
        // (Both hands on a tray, 2.25: whatever the press does with them lets it fall.)
        const from = ev.length;
        if (!attack(sim, a === 1)) strike(sim, a === 1);
        handsUsed(sim, from);
      }
      break;
    case OP.LOCK: {
      if (s.solitary > 0) break;
      const was = s.lock;
      // a = 2 + id: that person (a tap on them), if they can be locked on to.
      const pick = a >= 2 ? a - 2 : -1;
      s.lock =
        a === 1 || s.layer !== LAYER.GROUND
          ? -1
          : pick >= 0
            ? lockCandidates(sim.world, s, s.player).includes(pick)
              ? pick
              : s.lock
            : nextLock(sim.world, s, s.player, s.lock, ownMate(sim));
      if (s.lock !== was) sim.events.push({ type: 'lock', who: s.lock });
      break;
    }
    case OP.CRAFT:
      craft(it, a, ev, argB(cmd) - 1);
      break;
    case OP.EQUIP:
      equip(it, a);
      break;
    case OP.SELECT:
      if (a < HOTBAR) it.hand = a;
      break;
    case OP.EXT:
      if (a === EXT.THROW) {
        const from = ev.length;
        throwItem(sim, tossTile(argB(cmd), argC(cmd)));
        handsUsed(sim, from);
      }
      // The pet rat (P20): sent on an errand (the container in b and c), let loose.
      else if (a === EXT.RAT_FETCH || a === EXT.RAT_LEAVE) sendRat(sim, tossTile(argB(cmd), argC(cmd)), a === EXT.RAT_LEAVE);
      else if (a === EXT.RAT_LOOSE) looseRat(sim);
      // Smuggling (P21): an order on the burner phone in hand.
      else if (a === EXT.ORDER) placeOrder(sim, argB(cmd), argC(cmd));
      // The crew (P23): someone with an order whistled back.
      else if (a === EXT.RECALL) recall(sim, argB(cmd));
      // Dig up: a strike at the floor overhead (a press each, as Space at the tunnel's end).
      // Hoops (P27): the ball up for a shot, let go.
      else if (a === EXT.SHOOT && s.solitary <= 0) {
        if (argB(cmd) === 0) aimShot(sim);
        else releaseShot(sim);
      }
      // Long games (P28): fruit, sugar or seeds from the open furniture; a race night's bet, the pet entered.
      else if (a === EXT.TAKE && s.solitary <= 0) take(sim, argB(cmd));
      else if (a === EXT.RACE && s.solitary <= 0) raceOp(sim, argB(cmd), argC(cmd));
      // Team & ink (P29): a kick held and let go; a tattoo given up.
      else if (a === EXT.KICK && s.solitary <= 0) {
        pensCommand(sim, argB(cmd), argC(cmd));
      } else if (a === EXT.INK) endInk(sim, 'quit');
      // (2.22: the tattoo drawn by hand, the needle drawn or set down.)
      else if (a === EXT.NEEDLE || a === EXT.NEEDLE_DOWN) drawNeedle(sim, argB(cmd), argC(cmd), a === EXT.NEEDLE_DOWN);
      // Stage nights (P30): the player's act and its notes; the quiz joined or given up, an answer.
      else if (a === EXT.STAGE && argB(cmd) === STAGE_QUIT) quitShow(sim);
      else if (a === EXT.STAGE && s.solitary <= 0) startShow(sim, argB(cmd), argC(cmd));
      else if (a === EXT.NOTE) playNote(sim, argB(cmd));
      else if (a === EXT.QUIZ && s.solitary <= 0) {
        if (argB(cmd) === 0) joinQuiz(sim);
        else endQuiz(sim, 'quit');
      } else if (a === EXT.ANSWER) answerQuiz(sim, argB(cmd));
      // The pay phone (P34): a call, a phrase on Lou's line (or hung up), the queue.
      else if (a === EXT.CALL && s.solitary <= 0) startCall(sim, argB(cmd), argC(cmd));
      else if (a === EXT.SAY) say(sim, argB(cmd));
      else if (a === EXT.LINE && s.solitary <= 0) lineOp(sim, argB(cmd));
      else if (a === EXT.KIOSK && s.solitary <= 0) kioskOp(sim, argB(cmd), argC(cmd));
      else if (a === EXT.VEND && s.solitary <= 0) vendOp(sim, argB(cmd), argC(cmd));
      else if (a === EXT.MENU && s.solitary <= 0) menuOp(sim, argB(cmd));
      else if (a === EXT.COOLER && s.solitary <= 0) coolerOp(sim, argB(cmd));
      // The parole board (P39): applying at the release desk, an answer at the hearing.
      else if (a === EXT.PAROLE && s.solitary <= 0) paroleOp(sim, argB(cmd), argC(cmd));
      else if (a === EXT.BOARD && s.solitary <= 0) boardOp(sim, argB(cmd), argC(cmd));
      else if (a === EXT.WHISTLE && s.solitary <= 0) whistle(sim);
      // Holidays (P42): the holiday's treat from the open furniture.
      else if (a === EXT.HOLIDAY && s.solitary <= 0) takeTreat(sim, argB(cmd));
      // 2.35: the block, held.
      else if (a === EXT.BLOCK && !sim.rules234) s.blockAt = s.step;
      else if (a === EXT.DIG_UP && s.solitary <= 0 && !s.bout.length) {
        standUp(sim);
        stopWash(sim);
        strike(sim, true, digUpTarget(sim.world, s.layer, s.player, itemOf(it.inv[it.hand]), bodiesAbout(sim)));
      }
      break;
  }
  if (it.open >= 0 && !stillInReach(sim.world, it, s.player, people(sim))) {
    it.open = -1;
    it.rev++;
    ev.push({ type: 'close' });
  }
}

/** Does what the action button's plan says (`interactPlan`). */
function doPlan(sim: SimContext, plan: Plan) {
  const it = sim.state.items;
  const ev = sim.events as ItemEvent[];
  switch (plan.do) {
    case 'peel':
      peel(sim);
      break;
    case 'answer':
      answerCount(sim);
      break;
    case 'underline':
      rep(sim, 1);
      break;
    case 'readOn':
      readOn(sim);
      break;
    case 'getUp':
      standUp(sim);
      break;
    case 'climbOut':
      climbOut(sim);
      break;
    case 'stow':
      stow(sim);
      break;
    case 'report':
      report(sim);
      break;
    case 'fileForm':
      fileForm(sim);
      break;
    case 'showId':
      showId(sim);
      break;
    case 'climb':
      climb(sim, plan.climb);
      break;
    case 'work':
      work(sim, plan.station);
      break;
    case 'tray':
      serveTray(sim, plan.offer);
      break;
    case 'shower':
      startWash(sim, plan.head);
      break;
    case 'vend':
      vendOp(sim, VEND.OPEN, 0);
      break;
    case 'cooler':
      coolerOp(sim, COOLER.DRINK);
      break;
    case 'menu':
      menuOp(sim, MENU.OPEN);
      break;
    case 'pickUp':
      pickUp(it, plan.target.index, ev);
      break;
    case 'bed':
      if (plan.bed === 'tuck') tuckDummy(sim, plan.target.index);
      else takeOutDummy(sim, plan.target.index);
      break;
    case 'sleep':
      sleep(sim);
      break;
    case 'talk':
      approach(sim, plan.target.who);
      break;
    case 'fixture': {
      const target = plan.target;
      if (target.use === 'board') sim.events.push({ type: 'board' });
      else if (target.use === 'generator') switchPower(sim, target.index);
      else if (target.use === 'helicopter') board(sim);
      else if (target.use === 'vending') vendOp(sim, VEND.OPEN, 0);
      else if (target.use === 'cooler') coolerOp(sim, COOLER.DRINK);
      else if (target.use === 'sit' || target.use === 'rest') {
        sitDown(sim, target.index, target.use);
        // (2.31: a book in hand, on a library chair: straight into it, or told why not.)
        if (onReadChair(sim)) readOn(sim);
      } else useMachine(sim, target.index, target.use);
      break;
    }
    case 'flush':
      flush(sim, plan.target.index);
      break;
    case 'pockets':
    case 'search':
      if (it.open !== plan.target.index) {
        it.open = plan.target.index;
        ev.push({ type: 'open', container: plan.target.index });
        takeCoins(sim, plan.target.index);
      }
      break;
  }
}

/**
 * Where the player lands climbing onto the ground floor: the tile meant, or (if a hole or
 * someone is in the way) the nearest free one beside it; -1 if there's none.
 */
function landing(sim: SimContext, tile: number): number {
  const w = sim.world;
  const bodies = bodiesAbout(sim);
  if (tile >= 0 && !w.blocked(tile % MAP_W, Math.floor(tile / MAP_W)) && besideOnGround(w, tile, bodies, true) === tile) return tile;
  return tile >= 0 ? besideOnGround(w, tile, bodies) : -1;
}

/**
 * A strike with the tool in hand (GDD §9, §7.2): at most every STRIKE_STEPS, it costs the
 * tool's energy and a use; the tile's hit points go down by the tool's damage, and when
 * they run out it gives way. Chocolate in hand is eaten instead. `fresh`: a new press
 * (not the button held down): digging up, eating and putting things in place need one, so
 * a held button never carries on into them.
 */
function strike(sim: SimContext, fresh: boolean, up?: ToolTarget | null) {
  const s = sim.state;
  const w = sim.world;
  const it = s.items;
  const p = s.player;
  const held = itemOf(it.inv[it.hand]);
  // (`up`: the Dig up button's own target, whichever way the player faces.)
  const target =
    up !== undefined
      ? up
      : toolTarget(w, s.layer, p, held, bodiesAbout(sim), it.inv, airOf(sim), s.plots, hiddenIn(it.inv[it.hand]), s.gardenBy);
  if (!target) return;
  // Strikes come at their own pace (holding the button asks every step); the rest at a press.
  if (STRIKES.has(target.action) && s.step - s.struckAt < STRIKE_STEPS) return;
  if ((target.action === 'digUp' || !STRIKES.has(target.action)) && !fresh) return;
  if (target.action === 'eat' && held === CAKE) return eatCake(sim);
  // P42: a pumpkin carved (in the kitchen).
  if (target.action === 'carve') {
    if (target.fits) carve(sim);
    return;
  }
  if (target.action === 'eat') {
    const food = itemDef(held).food;
    // Full of energy: the bar keeps for later. (2.32: crisps, at full health, too.)
    if (food ? !foodUse(held, s.energy, s.health, maxHealth(s.str)) : s.energy >= 100) {
      sim.events.push({ type: 'cantStrike', why: 'full', action: 'eat' });
      return;
    }
    it.inv[it.hand] = 0;
    it.rev++;
    if (food) {
      s.energy = Math.min(100, s.energy + (food.energy ?? 0));
      s.health = Math.min(maxHealth(s.str), s.health + (food.health ?? 0));
    } else s.energy = Math.min(100, s.energy + CHOCOLATE_ENERGY);
    sim.events.push({ type: 'ate', item: held });
    return;
  }
  if (target.action === 'wind') {
    wind(sim);
    return;
  }
  // P35: the hollow book opened.
  if (target.action === 'unbook') return openBook(sim);
  // P28: pruno drunk, the rat's laps on its track, a garden bed tended.
  if (target.action === 'drink') {
    drink(sim);
    return;
  }
  if (target.action === 'track') {
    trainRat(sim);
    return;
  }
  if (target.action === 'plant' || target.action === 'water' || target.action === 'harvest') {
    const bed = bedTarget(w, s.layer, p, held, s.plots, s.gardenBy);
    if (bed) tend(sim, bed);
    return;
  }
  // A bar of soap (P19): the scent rubbed off, the soap used up (with no trail to wash off, it keeps).
  if (target.action === 'wash') {
    if (!washScent(sim)) {
      sim.events.push({ type: 'cantStrike', why: 'noScent', action: 'wash' });
      return;
    }
    // (2.36: tar soap lasts two washes.)
    const left = held === TAR_SOAP ? usesOf(it.inv[it.hand]) - 1 : 0;
    it.inv[it.hand] = left > 0 ? slot(held, left) : 0;
    it.rev++;
    return;
  }
  // 2.36 (The Six Hunter): the recall horn blown (none to call: nothing happens).
  if (target.action === 'blow') {
    if (target.fits) blowHorn(sim);
    return;
  }
  // A caught rat fed (P20); a rat trap set down where the player stands.
  if (target.action === 'feed') {
    feedRat(sim);
    return;
  }
  if (target.action === 'setTrap') {
    dropItem(it, it.hand, p, sim.events as ItemEvent[], s.layer);
    return;
  }
  // The lockpick on a keyed door (P22): picking starts, then a pin at each press (never a perimeter gate).
  if (target.action === 'pick') {
    if (!target.fits) sim.events.push({ type: 'cantStrike', why: 'gate', action: 'pick' });
    else pickLock(sim, target.tile);
    return;
  }
  if (!STRIKES.has(target.action)) {
    putInPlace(sim, target, held);
    return;
  }
  if (target.action === 'sharpen') {
    sharpen(sim, target, held);
    return;
  }
  const key = placeKey(target.layer, target.tile);
  const plan = planStrike(sim, target, held);
  const { why, dmg, cost, digger } = plan;
  if (why) {
    sim.events.push({ type: 'cantStrike', why, action: target.action });
    return;
  }
  s.struckAt = s.step;
  strikeLayer(s);
  s.energy -= cost;
  it.rev++;
  // Face what is struck (the grate overhead keeps the heading).
  if (target.tile >= 0 && target.action !== 'digUp' && target.action !== 'unscrew') {
    const dx = centerX(target.tile) - p.x;
    const dz = centerZ(target.tile) - p.z;
    if (dx || dz) p.facing = nearestDir(dx, dz);
  }
  p.moving = false;
  // The tool wears (2.36: told as it nears its end, so it never breaks unannounced).
  const left = usesOf(it.inv[it.hand]) - 1;
  if (left <= 0) {
    it.inv[it.hand] = 0;
    sim.events.push({ type: 'broke', item: held });
  } else {
    it.inv[it.hand] = slot(held, left);
    if (left === WORN_WARN) sim.events.push({ type: 'worn', item: held, left });
  }
  // A live fence: knocked flat (GDD §9.1).
  if (target.action === 'cut' && w.ground.kind[target.tile] === TILE.ELECTRIC && powered(w, s, 'fence')) {
    shock(sim);
    return;
  }
  // Cutting the perimeter fence by day within a tower's reach: the sniper sees it (GDD §5.6).
  if (target.action === 'cut' && snipersOnDuty(sim) && sniperOn(w, p, s.layer) >= 0 && !s.lockdown) {
    sim.events.push({ type: 'spotted', reason: 'sniper' });
    s.spotted = SPOT.indexOf('sniper');
    addHeat(sim, 100);
  }
  // The work is heard (P14): guards within earshot come and look.
  const noise = strikeNoise(s.layer, target, held);
  if (noise) makeNoise(sim, 'strike', noise.layer, noise.tile, noise.reach);
  const taken = (s.wear[key] ?? 0) + dmg;
  if (taken < target.hp) {
    s.wear[key] = taken;
    sim.wearRev++;
    sim.events.push({ type: 'strike', action: target.action, layer: target.layer, tile: target.tile, broke: false });
    return;
  }
  const t = target.tile;
  switch (target.action) {
    case 'chip':
      setTile(sim, LAYER.GROUND, t, TILE.HOLE);
      yieldTo(sim, digger, WALL_CHUNK);
      s.tally[0]++;
      break;
    case 'cut':
      setTile(sim, LAYER.GROUND, t, TILE.FENCE_CUT);
      break;
    case 'unscrew':
      setTile(sim, LAYER.VENTS, t, TILE.GRATE_OPEN);
      break;
    case 'dig':
      if (target.layer === LAYER.GROUND) {
        setTile(sim, LAYER.GROUND, t, TILE.SHAFT);
        if (w.layers[LAYER.UNDER].kind[t] === TILE.SOIL) setTile(sim, LAYER.UNDER, t, TILE.TUNNEL);
      } else {
        setTile(sim, LAYER.UNDER, t, TILE.TUNNEL);
        // Under the sea (P12, GDD §4.5): the water pours in.
        if (underSea(w, t)) {
          flood(sim, t);
          return;
        }
        // Too long a stretch without a brace: the roof comes down (GDD §9.2).
        if (cavesIn(w, t)) {
          setTile(sim, LAYER.UNDER, t, TILE.SOIL);
          sim.events.push({ type: 'caveIn', tile: t });
          hurt(sim, CAVE_IN_DAMAGE, -1);
          return;
        }
      }
      yieldTo(sim, digger, DIRT);
      s.tally[1]++;
      break;
    case 'digUp': {
      // Up into the minefield: the mine above goes off (P11).
      if (liveMine(sim, t)) {
        blast(sim, t);
        return;
      }
      setTile(sim, LAYER.GROUND, t, TILE.SHAFT);
      yieldTo(sim, digger, DIRT);
      s.tally[1]++;
      sim.events.push({ type: 'strike', action: target.action, layer: target.layer, tile: t, broke: true });
      // Out through the new hole.
      const out = landing(sim, besideOnGround(w, t, bodiesAbout(sim)));
      if (out >= 0) moveTo(sim, LAYER.GROUND, out, 'digUp');
      return;
    }
  }
  sim.events.push({ type: 'strike', action: target.action, layer: target.layer, tile: t, broke: true });
}

/** The digger helping (P23) takes the dirt or the rubble off the player's hands; with nobody helping it's theirs (at their feet without room). */
const helper = [-1];

/** Why a strike can't land now (`cantStrike`'s reasons for a strike). */
export type StrikeWhy = 'boulder' | 'reinforced' | 'tool' | 'tired' | 'full';

/** What a strike at a target would do now: why it's refused (null: it lands), the damage, the energy, the crew's digger helping (-1). */
export interface StrikePlan {
  why: StrikeWhy | null;
  dmg: number;
  cost: number;
  digger: number;
}
const planned: StrikePlan = { why: null, dmg: 0, cost: 0, digger: -1 };

/**
 * A strike weighed up (GDD §9, §7.2), the one answer the sim and the tool button share (2.36: the
 * button worked it out apart, and greyed the last blow a crew digger would have taken off full
 * pockets): reinforced concrete or a boulder, the wrong tool or none, too tired, or the last blow on
 * the ground floor with full pockets (the chunk or the dirt would land at the player's feet, in
 * plain view: not until there's room). Refilled in place: read it before the next call.
 */
export function planStrike(sim: SimContext, target: ToolTarget, held: number): StrikePlan {
  const s = sim.state;
  // (An empty hand has no tool: nothing to strike with.)
  const tool0 = held ? itemDef(held).tool : undefined;
  const yields = target.action === 'chip' || (target.action === 'dig' && target.layer === LAYER.GROUND);
  // (P23: a digger in the crew at the player's side, or at the top of the shaft, speeds it up and takes what it yields.)
  const help = digHelp(sim, target.action, target.layer, helper);
  const dmg = tool0 ? Math.floor((tool0.damage * help) / 4) : 0;
  const digger = helper[0];
  const worn = s.wear[placeKey(target.layer, target.tile)] ?? 0;
  const full = yields && digger < 0 && s.layer === LAYER.GROUND && !!tool0 && worn + dmg >= target.hp && !hasRoom(s.items);
  const cost = tool0 ? energyCost(sim, tool0.energy) : 0;
  planned.why =
    target.hp === 0
      ? target.layer === LAYER.UNDER
        ? 'boulder'
        : 'reinforced'
      : !target.fits || !tool0
        ? 'tool'
        : s.energy < cost
          ? 'tired'
          : full
            ? 'full'
            : null;
  planned.dmg = dmg;
  planned.cost = cost;
  planned.digger = digger;
  return planned;
}
function yieldTo(sim: SimContext, digger: number, item: number) {
  const s = sim.state;
  if (digger >= 0) sim.events.push({ type: 'crew', what: 'dirt', who: digger, item });
  else give(s.items, item, s.player, s.layer);
}

/** A live electric fence (cut or hooked with the power on): knocked out, then the infirmary (GDD §9.1). */
function shock(sim: SimContext) {
  const s = sim.state;
  s.lock = -1;
  dismissAll(sim);
  endTalk(sim);
  s.ko = KO_STEPS;
  s.wake = WAKE.INFIRMARY;
  s.sleeping = false;
  closeBox(sim);
  sim.events.push({ type: 'shocked' });
}

/**
 * A comb or toothbrush rubbed on a wall (GDD §7.3 shivs): a stroke at a strike's pace, and
 * after a few the shiv. The strokes so far ride in the item's slot (as uses do).
 */
function sharpen(sim: SimContext, target: ToolTarget, held: number) {
  const s = sim.state;
  const it = s.items;
  const p = s.player;
  const v = it.inv[it.hand];
  const item = itemOf(v);
  s.struckAt = s.step;
  strikeLayer(s);
  const noise = strikeNoise(s.layer, target, held);
  if (noise) makeNoise(sim, 'strike', noise.layer, noise.tile, noise.reach);
  p.moving = false;
  const dx = centerX(target.tile) - p.x;
  const dz = centerZ(target.tile) - p.z;
  if (dx || dz) p.facing = nearestDir(dx, dz);
  const strokes = usesOf(v) + 1;
  it.rev++;
  if (strokes < SHARPEN_STROKES) {
    it.inv[it.hand] = slot(item, strokes);
    sim.events.push({ type: 'strike', action: 'sharpen', layer: LAYER.GROUND, tile: target.tile, broke: false });
    return;
  }
  const shiv = SHIVS.get(item)!;
  it.inv[it.hand] = slot(shiv);
  sim.events.push(
    { type: 'strike', action: 'sharpen', layer: LAYER.GROUND, tile: target.tile, broke: true },
    { type: 'sharpened', item: shiv },
  );
}

/**
 * The item in hand put to use on the structure (GDD §9.2–9.3): a cover over damage, a
 * brace in the tunnel, a sheet rope down off a roof. One press each.
 */
function putInPlace(sim: SimContext, target: ToolTarget, held: number) {
  const s = sim.state;
  const it = s.items;
  const t = target.tile;
  if (!target.fits) {
    sim.events.push({
      type: 'cantStrike',
      why: target.action === 'grapnel' ? 'noRope' : (target.glide?.why ?? 'poster'),
      action: target.action,
    });
    return;
  }
  // A hook over a live fence: the shock comes down the rope.
  if (target.action === 'grapnel' && sim.world.ground.kind[target.over!] === TILE.ELECTRIC && powered(sim.world, s, 'fence')) {
    it.inv[it.hand] = 0;
    it.rev++;
    shock(sim);
    return;
  }
  it.inv[it.hand] = 0;
  it.rev++;
  switch (target.action) {
    case 'launch':
      launch(sim);
      break;
    case 'glide': {
      // Off the edge (P24): down where the wind brings the glider, which is left in pieces there.
      const g = target.glide!;
      moveTo(sim, LAYER.GROUND, t, 'glide');
      sim.events.push({ type: 'glide', from: target.over!, to: t, dist: g.dist, short: g.short });
      break;
    }
    case 'grapnel': {
      // Hooked over the fence onto a roof beyond: across on the line, the sheet rope kept for the way down.
      if (target.layer === LAYER.ROOF) {
        moveTo(sim, LAYER.ROOF, t, 'grapnel');
        break;
      }
      // Hooked over the fence, the sheet rope takes the player down the far side (both stay there).
      const rope = hotbarSlotOf(it.inv, SHEET_ROPE);
      if (rope >= 0) it.inv[rope] = 0;
      moveTo(sim, LAYER.GROUND, t, 'grapnel');
      break;
    }
    case 'tape': {
      // Over the lens: blind for a minute (touching a camera is tampering, if a guard sees it).
      const k = (sim.world.def.cameras ?? []).findIndex((c) => c.z * MAP_W + c.x === t);
      if (k >= 0) {
        s.cams[k] = s.step + CAMERA_BLIND_STEPS;
        s.struckAt = s.step;
        strikeLayer(s);
        sim.events.push({ type: 'camera', index: k, blind: true });
      }
      break;
    }
    case 'cover':
      if (target.layer === LAYER.VENTS) setTile(sim, LAYER.VENTS, t, TILE.GRATE_FAKE);
      else
        setTile(
          sim,
          LAYER.GROUND,
          t,
          sim.world.ground.kind[t] === TILE.FENCE_CUT ? TILE.FENCE_FAKE : held === POSTER_ITEM ? TILE.HOLE_POSTER : TILE.HOLE_FAKE,
        );
      sim.events.push({ type: 'covered', item: held, on: true });
      break;
    case 'brace':
      setTile(sim, LAYER.UNDER, t, TILE.BRACED);
      sim.events.push({ type: 'braced' });
      break;
    case 'rope': {
      const to = landing(sim, t);
      if (to < 0) {
        it.inv[it.hand] = slot(held);
        sim.events.push({ type: 'cantStrike', why: 'noLanding', action: 'rope' });
        return;
      }
      moveTo(sim, LAYER.GROUND, to, 'rope');
      break;
    }
  }
}

/** Climbing, and covers taken off (the action button on the structure). */
function climb(sim: SimContext, c: ClimbTarget) {
  const s = sim.state;
  const it = s.items;
  const p = s.player;
  switch (c.action) {
    case 'uncover': {
      const grate = sim.world.layers[LAYER.VENTS].kind[c.tile] === TILE.GRATE_FAKE;
      // The cover comes back into the hand: never dropped at the player's feet.
      if (!hasRoom(it)) {
        sim.events.push({ type: 'full' });
        return;
      }
      give(it, c.item!, p, s.layer);
      if (grate) setTile(sim, LAYER.VENTS, c.tile, TILE.GRATE_OPEN);
      else setTile(sim, LAYER.GROUND, c.tile, sim.world.ground.kind[c.tile] === TILE.FENCE_FAKE ? TILE.FENCE_CUT : TILE.HOLE);
      sim.events.push({ type: 'covered', item: c.item!, on: false });
      return;
    }
  }
  // Climbing out of the tunnel under the desk: beside the desk. Onto the ground floor, never
  // onto a hole or into someone.
  const want = c.toTile === -2 ? placesOf(sim.world).deskside[1] : c.toTile;
  const to = c.toLayer === LAYER.GROUND ? landing(sim, want) : want;
  if (to < 0) return;
  moveTo(sim, c.toLayer, to, c.action);
}

/** Down the tunnel under the player's desk (from its open panel). */
function underDesk(sim: SimContext) {
  const it = sim.state.items;
  const box = containersOf(sim.world)[it.open];
  if (!box?.mine || box.prop.kind !== 'desk') return;
  const tile = box.prop.z * MAP_W + box.prop.x;
  if (sim.world.ground.kind[tile] !== TILE.SHAFT) return;
  moveTo(sim, LAYER.UNDER, tile, 'climbDown');
  sim.state.deskAside = true;
}

/** Onto a layer, in the middle of a tile. */
function moveTo(sim: SimContext, layer: number, tile: number, how: LayerMove) {
  const s = sim.state;
  const from = s.layer;
  sim.movedBy = how;
  closeBox(sim);
  s.layer = layer;
  // Back on the ground floor, the desk is slid back over its hole.
  if (layer === LAYER.GROUND) s.deskAside = false;
  s.player.x = centerX(tile);
  s.player.z = centerZ(tile);
  s.player.moving = false;
  sim.events.push({ type: 'layer', layer, from, how });
}

/** Dirt (or a chunk of wall) down a toilet: three loads an hour, then it's clogged for an hour (GDD §9.2). */
function flush(sim: SimContext, index: number) {
  const s = sim.state;
  const it = s.items;
  const t = (s.toilets[index] ??= [0, s.step]);
  if (s.step - t[1] >= TOILET_CLOG_STEPS) {
    t[0] = 0;
    t[1] = s.step;
  }
  if (t[0] >= TOILET_LOADS) {
    sim.events.push({ type: 'clogged' });
    return;
  }
  const item = itemOf(it.inv[it.hand]);
  it.inv[it.hand] = 0;
  if (t[0] === 0) t[1] = s.step;
  // The third load clogs it: an hour from now it takes dirt again.
  if (++t[0] >= TOILET_LOADS) t[1] = s.step;
  sim.events.push({ type: 'flushed', item });
}

const POSTER_ITEM = itemNumber('poster');

/** A free hotbar slot. */
const hasRoom = (it: ItemState) => freeHotbar(it.inv) >= 0;
