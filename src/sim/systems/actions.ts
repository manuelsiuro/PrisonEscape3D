/**
 * What the player does (GDD §2, §3.1, §7, §9): the one-step operation of each command, tools
 * on the structure, covers, braces and ropes, climbing between layers, toilets, bed, seats,
 * showers, and energy and health coming back.
 */
import { CAKE, eatCake, lineOp, say, startCall } from './phone';
import { bookMove, hiddenIn, kioskOp, openBook } from './kiosk';
import { boardOp, whistle } from './oddjobs';
import { atRelease, atTray, fileForm, report } from './paperwork';
import { paroleOp } from './parole';
import { playNote, quitShow, STAGE_QUIT, startShow } from './talent';
import { answerQuiz, endQuiz, joinQuiz } from './quiz';
import { digHelp, recall } from './crew';
import { itemDef, itemNumber } from '../../content/items';
import { ROUTINE } from '../../content/routine';
import { nearestDir, nearestDir as faceTo, tileAt } from '../ai/path';
import { placesOf } from '../ai/places';
import { argA, argB, argC, EXT, OP, opOf, tossTile } from '../command';
import type { SimContext } from '../context';
import { SPOT, WAKE, type LayerMove } from '../state';
import { freshMeals } from './grounds';
import { FRESH_ENERGY, FRESH_HEALTH } from '../tuning';
import { CAMERA_BLIND_STEPS, CAVE_IN_DAMAGE, CHOCOLATE_ENERGY, ENERGY_REGEN_STEPS, HEALTH_REGEN_STEPS, KO_STEPS, MEAL_ENERGY, MEAL_STEPS, SHARPEN_STROKES, SHOWER_ENERGY_STEPS, SIT_ENERGY_STEPS, STEPS_PER_MINUTE, STRIKE_STEPS, TOILET_CLOG_STEPS, TOILET_LOADS, UNIT } from '../tuning';
import { containersOf } from '../world/containers';
import { TILE } from '../world/tiles';
import { LAYER, MAP_W, placeKey } from '../world/World';
import { lockCandidates, maxHealth, nextLock } from './combat';
import { attack, hurt } from './fights';
import type { Guard } from './guards';
import type { Inmate } from './inmates';
import { craft, dropItem, equip, give, HOTBAR, interactTarget, type ItemEvent, itemOf, type ItemState, moveItem, pickUp, REACH, slot, stillInReach, usesOf } from './items';
import { jobOp, station, takeCoins, work } from './jobs';
import { peel } from './justice';
import type { Body } from './movement';
import { blast, liveMine } from './mines';
import { makeNoise, strikeNoise, throwItem, wind } from './noise';
import { board, flood, launch } from './sea';
import { powered, snipersOnDuty, switchPower } from './power';
import { feastNow, TODAY } from './calendar';
import { carve, takeTreat } from './holiday';
import { FEAST_ENERGY } from '../../content/days';
import { atProp, seatSpot } from './rest';
import { sniperOn } from './security';
import { canChat } from './ways';
import { atTail, climbOut, stow } from './delivery';
import { airOf, atWindow, showId, windowFirst } from './getaway';
import { approach, dismissAll, endTalk, talkOp } from './social';
import { besideOnGround, cavesIn, climbTarget, type ClimbTarget, DIRT, facesProp, preferClimb, SHEET_ROPE, SHIVS, STRIKES, toolTarget, digUpTarget, type ToolTarget, underSea, WALL_CHUNK } from './structure';
import { rep, startTraining, stopTraining, study } from './training';
import { addHeat, setTile } from './watch';
import { washScent } from './k9';
import { feedRat, looseRat, sendRat } from './rats';
import { placeOrder } from './smuggling';
import { endBout, pickLock, push, stopPick } from './games';
import { aimShot, releaseShot } from './hoops';
import { energyCost } from './weather';
import { drink } from './pruno';
import { raceOp, trainRat } from './races';
import { bedTarget, tend } from './garden';
import { take } from './pantry';
import { holdKick, releaseKick } from './football';
import { endInk } from './tattoo';

/** The open container's panel closes (caught, knocked out, climbing, asleep…). */
export function closeBox(sim: SimContext) {
  const it = sim.state.items;
  if (it.open < 0) return;
  it.open = -1;
  it.rev++;
  sim.events.push({ type: 'close' });
}

/** The player's one-step operation (OP), and the open container closing out of reach. */
export function useItems(sim: SimContext, cmd: number) {
  const s = sim.state;
  const it = s.items;
  const ev = sim.events as ItemEvent[];
  const a = argA(cmd);
  // Every op may change items (the UI redraws on rev); a held use button asks every step, so strikes bump it themselves.
  if (opOf(cmd) !== OP.NONE && opOf(cmd) !== OP.USE) it.rev++;
  switch (opOf(cmd)) {
    case OP.INTERACT: {
      if (s.solitary > 0) {
        peel(sim);
        break;
      }
      // From the open desk panel: down the tunnel under the player's desk.
      if (a === 1) {
        underDesk(sim);
        break;
      }
      // Seated (or resting): the action button gets the player up.
      if (s.seat >= 0) {
        standUp(sim);
        break;
      }
      // Delivery day (P18): out of the vehicle again; into it at its tail.
      if (s.stowed) {
        climbOut(sim);
        break;
      }
      if (atTail(sim)) {
        stow(sim);
        break;
      }
      const held = itemOf(it.inv[it.hand]);
      const target = interactTarget(sim.world, it, s.player, sim.bedtime, s.layer, people(sim), s.inmates.length, (k) => canChat(sim, k));
      const faced = target?.kind === 'container' || target?.kind === 'sleep' ? facesProp(s.player, containersOf(sim.world)[target.index].prop) : false;
      const up = preferClimb(climbTarget(sim.world, s.layer, s.player, sim.ladderFoot, bodiesAbout(sim)), faced);
      // The release desk (P36): reporting there while the name is called, or a forged form slipped into its tray, comes first.
      if (atRelease(sim)) {
        report(sim);
        break;
      }
      if (atTray(sim)) {
        fileForm(sim);
        break;
      }
      // The checkpoint (P24): a fake ID shown at its window, first at the shift change (else when there's nothing else to do here).
      if (atWindow(sim) && windowFirst(sim, !!target || !!up)) {
        showId(sim);
        break;
      }
      if (up) {
        climb(sim, up);
        break;
      }
      // On the job (GDD §11): the station's step comes first.
      const job = s.layer === LAYER.GROUND ? station(sim) : null;
      if (job) {
        work(sim, job);
        break;
      }
      if (!target) break;
      if (target.kind === 'ground') pickUp(it, target.index, ev);
      else if (target.kind === 'sleep') sleep(sim);
      else if (target.kind === 'person') approach(sim, target.who);
      else if (target.kind === 'fixture') {
        if (target.use === 'board') sim.events.push({ type: 'board' });
        else if (target.use === 'generator') switchPower(sim, target.index);
        else if (target.use === 'helicopter') board(sim);
        else if (target.use === 'sit' || target.use === 'rest') sitDown(sim, target.index, target.use);
        else startTraining(sim, target.index, target.use);
      } else if (target.kind === 'pockets') {
        // Going through someone's pockets while they're out cold (GDD §10.2).
        if (it.open !== target.index) {
          it.open = target.index;
          ev.push({ type: 'open', container: target.index });
          takeCoins(sim, target.index);
        }
      }
      else if ((held === DIRT || held === WALL_CHUNK) && containersOf(sim.world)[target.index].prop.kind === 'toilet') flush(sim, target.index);
      else if (it.open !== target.index) {
        it.open = target.index;
        ev.push({ type: 'open', container: target.index });
        takeCoins(sim, target.index);
      }
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
      // An arm-wrestle (P22): the presses push, 3 gives up.
      if (s.bout.length) {
        if (a === 3) endBout(sim, 'gaveUp');
        else if (a === 1 || a === 2) push(sim, a);
      } else if (a === 0) study(sim);
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
      if (!attack(sim, a === 1)) strike(sim, a === 1);
      break;
    case OP.LOCK: {
      if (s.solitary > 0) break;
      const was = s.lock;
      // a = 2 + id: that person (a tap on them), if they can be locked on to.
      const pick = a >= 2 ? a - 2 : -1;
      s.lock = a === 1 || s.layer !== LAYER.GROUND ? -1 : pick >= 0 ? (lockCandidates(sim.world, s, s.player).includes(pick) ? pick : s.lock) : nextLock(sim.world, s, s.player, s.lock);
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
      if (a === EXT.THROW) throwItem(sim, tossTile(argB(cmd), argC(cmd)));
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
        if (argB(cmd) === 0) holdKick(sim);
        else releaseKick(sim);
      } else if (a === EXT.INK) endInk(sim, 'quit');
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
      // The parole board (P39): applying at the release desk, an answer at the hearing.
      else if (a === EXT.PAROLE && s.solitary <= 0) paroleOp(sim, argB(cmd), argC(cmd));
      else if (a === EXT.BOARD && s.solitary <= 0) boardOp(sim, argB(cmd), argC(cmd));
      else if (a === EXT.WHISTLE && s.solitary <= 0) whistle(sim);
      // Holidays (P42): the holiday's treat from the open furniture.
      else if (a === EXT.HOLIDAY && s.solitary <= 0) takeTreat(sim, argB(cmd));
      else if (a === EXT.DIG_UP && s.solitary <= 0 && !s.bout.length) {
        standUp(sim);
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

/** Everyone about on the ground floor (nobody digs under people); one array, refilled. */
function bodiesAbout(sim: SimContext): Body[] {
  const list = sim.scratch.about;
  list.length = 0;
  for (const m of sim.state.inmates) list.push(m.body);
  for (const g of sim.state.guards) list.push(g.body);
  return list;
}

/** Everyone who can be fought or looted, by Cast id (inmates, then guards); one array, refilled. */
function people(sim: SimContext): ReadonlyArray<Inmate | Guard> {
  const list = sim.scratch.cast;
  list.length = 0;
  for (const m of sim.state.inmates) list.push(m);
  for (const g of sim.state.guards) list.push(g);
  return list;
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
  const target = up !== undefined ? up : toolTarget(w, s.layer, p, held, bodiesAbout(sim), it.inv, airOf(sim), s.plots, hiddenIn(it.inv[it.hand]));
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
    // Full of energy: the bar keeps for later.
    if (s.energy >= 100) {
      sim.events.push({ type: 'cantStrike', why: 'full', action: 'eat' });
      return;
    }
    it.inv[it.hand] = 0;
    it.rev++;
    s.energy = Math.min(100, s.energy + CHOCOLATE_ENERGY);
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
    const bed = bedTarget(w, s.layer, p, held, s.plots);
    if (bed) tend(sim, bed);
    return;
  }
  // A bar of soap (P19): the scent rubbed off, the soap used up (with no trail to wash off, it keeps).
  if (target.action === 'wash') {
    if (!washScent(sim)) {
      sim.events.push({ type: 'cantStrike', why: 'noScent', action: 'wash' });
      return;
    }
    it.inv[it.hand] = 0;
    it.rev++;
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
  // (An empty hand has no tool: nothing to strike with.)
  const tool0 = held ? itemDef(held).tool : undefined;
  // The last blow on the ground floor with full pockets would leave the chunk or the dirt at
  // the player's feet, in plain view: not until there's room.
  const yields = target.action === 'chip' || (target.action === 'dig' && target.layer === LAYER.GROUND);
  // (P23: a digger in the crew at the player's side, or at the top of the shaft, speeds it up and takes what it yields.)
  const help = digHelp(sim, target.action, target.layer, helper);
  const dmg = tool0 ? Math.floor((tool0.damage * help) / 4) : 0;
  const digger = helper[0];
  const full = yields && digger < 0 && s.layer === LAYER.GROUND && !!tool0 && (s.wear[key] ?? 0) + dmg >= target.hp && !hasRoom(it);
  const cost = tool0 ? energyCost(sim, tool0.energy) : 0;
  const why = target.hp === 0 ? (target.layer === LAYER.UNDER ? 'boulder' : 'reinforced') : !target.fits || !tool0 ? 'tool' : s.energy < cost ? 'tired' : full ? 'full' : null;
  if (why) {
    sim.events.push({ type: 'cantStrike', why, action: target.action });
    return;
  }
  s.struckAt = s.step;
  s.energy -= cost;
  it.rev++;
  // Face what is struck (the grate overhead keeps the heading).
  if (target.tile >= 0 && target.action !== 'digUp' && target.action !== 'unscrew') {
    const dx = (target.tile % MAP_W) * UNIT + UNIT / 2 - p.x;
    const dz = Math.floor(target.tile / MAP_W) * UNIT + UNIT / 2 - p.z;
    if (dx || dz) p.facing = nearestDir(dx, dz);
  }
  p.moving = false;
  // The tool wears.
  const left = usesOf(it.inv[it.hand]) - 1;
  if (left <= 0) {
    it.inv[it.hand] = 0;
    sim.events.push({ type: 'broke', item: held });
  } else it.inv[it.hand] = slot(held, left);
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
  const noise = strikeNoise(s.layer, target, held);
  if (noise) makeNoise(sim, 'strike', noise.layer, noise.tile, noise.reach);
  p.moving = false;
  const dx = (target.tile % MAP_W) * UNIT + UNIT / 2 - p.x;
  const dz = Math.floor(target.tile / MAP_W) * UNIT + UNIT / 2 - p.z;
  if (dx || dz) p.facing = faceTo(dx, dz);
  const strokes = usesOf(v) + 1;
  it.rev++;
  if (strokes < SHARPEN_STROKES) {
    it.inv[it.hand] = slot(item, strokes);
    sim.events.push({ type: 'strike', action: 'sharpen', layer: LAYER.GROUND, tile: target.tile, broke: false });
    return;
  }
  const shiv = SHIVS.get(item)!;
  it.inv[it.hand] = slot(shiv);
  sim.events.push({ type: 'strike', action: 'sharpen', layer: LAYER.GROUND, tile: target.tile, broke: true }, { type: 'sharpened', item: shiv });
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
    sim.events.push({ type: 'cantStrike', why: target.action === 'grapnel' ? 'noRope' : target.glide?.why ?? 'poster', action: target.action });
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
      const rope = it.inv.findIndex((v, k) => k < HOTBAR && itemOf(v) === SHEET_ROPE);
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
        sim.events.push({ type: 'camera', index: k, blind: true });
      }
      break;
    }
    case 'cover':
      if (target.layer === LAYER.VENTS) setTile(sim, LAYER.VENTS, t, TILE.GRATE_FAKE);
      else setTile(sim, LAYER.GROUND, t, sim.world.ground.kind[t] === TILE.FENCE_CUT ? TILE.FENCE_FAKE : held === POSTER_ITEM ? TILE.HOLE_POSTER : TILE.HOLE_FAKE);
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
  s.player.x = (tile % MAP_W) * UNIT + UNIT / 2;
  s.player.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
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

/** Into bed: the player lies down beside it (the view puts them in it). */
function sleep(sim: SimContext) {
  const s = sim.state;
  const t = placesOf(sim.world).bedside[1];
  if (t < 0) return;
  s.player.x = (t % MAP_W) * UNIT + UNIT / 2;
  s.player.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
  s.player.moving = false;
  s.sleeping = true;
  closeBox(sim);
  endTalk(sim);
  stopTraining(sim);
  sim.events.push({ type: 'sleep', on: true });
}

/** Sits down on a seat, bench or chair, or lies down on an infirmary bed: facing the table, the body still. */
function sitDown(sim: SimContext, prop: number, use: 'sit' | 'rest') {
  const s = sim.state;
  // No sitting down in a lockdown (it would only get up again).
  if (s.lockdown || sim.away) return;
  // Someone sitting there already, or on the way to (on their routine, not following or fighting): the player stays up.
  const spot = seatSpot(sim.world, prop, s.player);
  const at = spot.z * MAP_W + spot.x;
  if (s.inmates.some((m) => m.ko === 0 && m.angry <= 0 && m.plan >= 0 && (m.goal === at || tileAt(m.body.x, m.body.z) === at))) {
    sim.events.push({ type: 'refused', why: 'seatTaken' });
    return;
  }
  endTalk(sim);
  closeBox(sim);
  s.player.moving = false;
  if (use === 'sit') s.player.facing = spot.facing;
  s.seat = prop;
  sim.events.push({ type: 'sit', on: true, use });
}

export function standUp(sim: SimContext) {
  const s = sim.state;
  if (s.seat < 0) return;
  const use = sim.world.props[s.seat].kind === 'bed' ? 'rest' : 'sit';
  s.seat = -1;
  sim.events.push({ type: 'sit', on: false, use });
}

/**
 * Each step seated: up when carried off, knocked out, asleep or out of reach of the seat;
 * else energy back a point every SIT_ENERGY_STEPS, and at a canteen table during a meal the
 * tray is eaten (GDD §2: +35, once a meal).
 */
export function keepSeat(sim: SimContext) {
  const s = sim.state;
  if (s.seat < 0) return;
  if (sim.away || s.sleeping || s.lockdown || s.layer !== LAYER.GROUND || !atProp(sim.world, s.seat, s.player, REACH)) {
    standUp(sim);
    return;
  }
  if (s.energy < 100 && s.step % SIT_ENERGY_STEPS === 0) s.energy++;
  const p = sim.world.props[s.seat];
  const id = ROUTINE[s.routine].id;
  if (p.kind === 'seat' && (id === 'breakfast' || id === 'dinner') && !s.lockdown && s.eaten < MEAL_STEPS && sim.world.zoneAt(p.x, p.z) === 'canteen') {
    if (++s.eaten === MEAL_STEPS) {
      // A feast (P17): a tray piled high, and health back to full.
      const feast = feastNow(sim);
      // (P31: fresh from the garden, a little more.)
      const fresh = freshMeals(sim);
      s.energy = Math.min(100, s.energy + (feast ? FEAST_ENERGY : MEAL_ENERGY) + (fresh ? FRESH_ENERGY : 0));
      if (fresh) s.health = Math.min(maxHealth(s.str), s.health + FRESH_HEALTH);
      if (feast) {
        s.health = Math.max(s.health, maxHealth(s.str));
        s.eventFlags |= TODAY.FEASTED;
      }
      sim.events.push(feast ? { type: 'meal', feast, ...(fresh ? { fresh } : {}) } : fresh ? { type: 'meal', fresh } : { type: 'meal' });
    }
  }
}

/** Energy: a point back every couple of minutes, one a minute asleep. Health: a point a minute, two asleep (or resting). */
export function regenerate(sim: SimContext) {
  const s = sim.state;
  const resting = s.sleeping || (s.seat >= 0 && sim.world.props[s.seat].kind === 'bed');
  if (s.energy < 100 && (s.step % ENERGY_REGEN_STEPS === 0 || (s.sleeping && s.step % STEPS_PER_MINUTE === 0))) s.energy++;
  if (s.ko === 0 && s.health < maxHealth(s.str) && (s.step % HEALTH_REGEN_STEPS === 0 || (resting && s.step % (HEALTH_REGEN_STEPS / 2) === 0))) s.health++;
}

/** Under a running shower in the showers block, standing still (GDD §3.1): energy back, 2 a second. */
export function shower(sim: SimContext) {
  const s = sim.state;
  if (s.energy < 100 && s.step % SHOWER_ENERGY_STEPS === 0 && underShower(sim)) s.energy++;
  // (P19: and the scent washes off.)
  if (s.scent.length && underShower(sim)) washScent(sim);
}

/** Standing still under a running shower in the showers block (not out cold, carried off or in a lockdown). */
export function underShower(sim: SimContext): boolean {
  const s = sim.state;
  if (s.player.moving || sim.away || s.lockdown || s.layer !== LAYER.GROUND || ROUTINE[s.routine].id !== 'showers') return false;
  return sim.showerTiles.has(Math.floor(s.player.z / UNIT) * MAP_W + Math.floor(s.player.x / UNIT));
}

const POSTER_ITEM = itemNumber('poster');

/** A free hotbar slot. */
function hasRoom(it: ItemState): boolean {
  for (let k = 0; k < HOTBAR; k++) if (!it.inv[k]) return true;
  return false;
}
