import { itemDef, itemNumber } from '../content/items';
import type { PrisonDef } from '../content/prisons/types';
import { ROUTINE, routineAt } from '../content/routine';
import { RESTRICTED, zoneIndex } from '../content/zones';
import { argA, argB, dirOf, OP, opOf, SLOT, TALK } from './command';
import { findPath, nearestDir } from './ai/path';
import { placesOf } from './ai/places';
import { canSee } from './ai/sight';
import { craft, dropItem, equip, give, guardKit, HOTBAR, interactTarget, itemOf, moveItem, pickUp, pocketOf, restock, slot, startItems, startPockets, stillInReach, stockSlots, usesOf, type FixtureUse, type ItemEvent, type ItemState } from './systems/items';
import { WORK_ITEMS } from '../content/jobs';
import { SHOP_SLOTS } from '../content/loot';
import { CASH_GIFTS, cashOpinion, FAVOR, FAVOR_ITEMS, FAVOR_STATE, giftOpinion, HOLDER, jobRooms, nearestProp, priceOf, stationTarget, STATION_REACH, type Favor, type Station, type StationAct, type WorkState } from './systems/economy';
import { besideOnGround, cavesIn, climbTarget, facesProp, preferClimb, DIRT, ladderFootOf, reserved, SHIVS, STRIKES, toolTarget, underMyDesk, WALL_CHUNK, type ClimbAction, type ClimbTarget, type ToolAction, type ToolTarget } from './systems/structure';
import { BATON_ATTACK, damage, dist2, GUARD_DEFENSE, INMATE_DEFENSE, isGuard, lockCandidates, maxHealth, nextLock, personOf, reachOf, swingSteps, type Fighter } from './systems/combat';
import { lineOfSight } from './ai/sight';
import { fnv1a, randomInt } from './rng';
import { clockAt, hourStarts, type Clock } from './systems/clock';
import { assign, awake, backToDuty, cancelTasks, GUARD, spawnGuards, startChase, stepGuards, type Guard, type GuardReport } from './systems/guards';
import { DOING, fighter, inmateZone, LOCKDOWN_PLAN, spawnInmates, STAND_OFF, stepInmates, type Inmate, type Social } from './systems/inmates';
import { bodyAt, tileOfBody, walk, type Body } from './systems/movement';
import {
  ANGRY_STEPS,
  BODY_HALF,
  CAVE_IN_DAMAGE,
  GUARD_STR,
  GUARD_SWING_STEPS,
  HEALTH_REGEN_STEPS,
  INMATE_SWING_STEPS,
  LOCK_KEEP,
  MELEE_REACH,
  SHARPEN_STROKES,
  START_SPD,
  START_STR,
  THROW_RANGE,
  HIDING_STEPS,
  CHASE_HEAT,
  CHOCOLATE_ENERGY,
  CRAWL_SPEED,
  ENERGY_REGEN_STEPS,
  MEAL_ENERGY,
  SHOWER_ENERGY,
  STRIKE_SEEN_STEPS,
  STRIKE_STEPS,
  TOILET_CLOG_STEPS,
  TOILET_LOADS,
  TUNNEL_SPEED,
  STEPS_PER_SECOND,
  CONTRABAND_HEAT,
  HEAT_DECAY_STEPS,
  KO_STEPS,
  LIGHTS_OUT_GRACE,
  MISSED_ROUTINE_HEAT,
  PEEL_STEPS,
  POTATO_PRESSES,
  POTATO_STEPS,
  RECOGNIZE_RANGE,
  RECOGNIZE_STEPS,
  SOLITARY_HEAT,
  SOLITARY_STEPS,
  STEPS_PER_MINUTE,
  UNIT,
  AMBUSH_ODDS,
  AMBUSH_RANGE,
  ATTR_MAX,
  ATTR_START,
  BUY_OPINION,
  FAVOR_OFFERS,
  FAVOR_OPINION,
  FAVORS_TAKEN,
  FOLLOW_GAP,
  GUARD_RANGE,
  GYM_ENERGY,
  HIT_OPINION,
  KO_OPINION,
  MAX_FOLLOWERS,
  OPINION_HIGH,
  OPINION_LOW,
  OPINION_START,
  REP_DRAIN_STEPS,
  REP_GAIN,
  STUDY_ENERGY,
  TALK_REACH,
  TIRED,
  TRAIN_GAIN,
  VACANCY_DAYS,
  walkSpeed,
} from './tuning';
import { LAYER, layerOfKey, MAP_H, MAP_W, placeKey, tileOfKey, World } from './world/World';
import { DAMAGE_SHOWS, TILE, TILE_INFO } from './world/tiles';
import { nearestDir as faceTo } from './ai/path';
import { containersOf } from './world/containers';

/** Why guards took notice of the player (GDD §5.2). Stored as numbers: never renumber. */
export const SPOT = ['none', 'night', 'restricted', 'contraband', 'recognized', 'wanted', 'bedCheck', 'damage', 'tampering', 'fight', 'keyMissing'] as const;
export type SpotReason = (typeof SPOT)[number];
/** Where a knocked-out player wakes up. */
export const WAKE = { NONE: 0, SOLITARY: 1, INFIRMARY: 2, FLOORED: 3 } as const;

/** Something that happened during a step; sound, effects and the HUD read these. */
export type SimEvent =
  | { type: 'hour'; hour: number }
  /** A new routine block began (index into ROUTINE). */
  | { type: 'routine'; routine: number }
  /** The player checked in to the block. */
  | { type: 'attended'; routine: number }
  /** The block ended without the player: what it cost. */
  | { type: 'missed'; routine: number; heat: number }
  | { type: 'lockdown'; on: boolean }
  /** The player's cell door locked or unlocked (Lights Out, a lockdown, 08:00). */
  | { type: 'cells'; locked: boolean }
  | { type: 'sleep'; on: boolean }
  /** A guard noticed something (the first step of it): a heat jump or a chase. */
  | { type: 'spotted'; reason: SpotReason }
  /** A chasing guard caught the player: knocked out, then solitary or the infirmary. */
  | { type: 'caught'; solitary: boolean }
  /** Into solitary (with how many contraband items were taken) and out again. */
  | { type: 'solitary'; on: boolean; taken: number }
  | { type: 'infirmary'; taken: number }
  /** A press on the potato; `done` when a whole potato is peeled (10 minutes off). */
  | { type: 'peel'; done: boolean }
  /** 08:00: the cells to be searched this morning; a guard has searched one. */
  | { type: 'shakedown'; cells: number[] }
  | { type: 'searched'; cell: number; taken: number }
  /** The night bed check begins, and how it went at the player's cell. */
  | { type: 'bedCheck'; result: 'start' | 'pass' | 'fail' }
  /** A tool strike landed (`broke`: the tile gave way), or why it couldn't. */
  | { type: 'strike'; action: ToolAction; layer: number; tile: number; broke: boolean }
  | { type: 'cantStrike'; why: 'tool' | 'reinforced' | 'tired' | 'poster' | 'full' | 'noLanding'; action: ToolAction }
  /** A tool wore out. */
  | { type: 'broke'; item: number }
  /** A live electric fence: knocked out (GDD §9.1). */
  | { type: 'shocked' }
  /** A tunnel roof came down on the player (GDD §9.2). */
  | { type: 'caveIn'; tile: number }
  /** Onto another layer (through a grate, up the ladder, into a tunnel…). */
  | { type: 'layer'; layer: number; from: number; how: ClimbAction | 'digUp' | 'rope' }
  /** A cover put over damage or taken off it; a brace set up; chocolate eaten. */
  | { type: 'covered'; item: number; on: boolean }
  | { type: 'braced' }
  | { type: 'ate'; item: number }
  /** Dirt down a toilet; a toilet that takes no more for now. */
  | { type: 'flushed'; item: number }
  | { type: 'clogged' }
  /** Guards found damage or evidence (and repaired what they found, after a capture). */
  | { type: 'found'; kind: number }
  | { type: 'repaired'; n: number }
  /** Out on the road: free (GDD §4.0). */
  | { type: 'escaped' }
  /** Combat (GDD §10): the lock moved (-1: none); a blow landed on someone (Cast id) or the player; a cup of molten chocolate thrown. */
  | { type: 'lock'; who: number }
  | { type: 'hit'; who: number; dmg: number; ko: boolean; weapon: number }
  | { type: 'thrown'; who: number }
  | { type: 'cantHit'; why: 'far' }
  | { type: 'hurt'; by: number; dmg: number }
  /** Someone the player knocked out, and someone coming round (a guard missing its key raises the alarm). */
  | { type: 'koed'; who: number }
  | { type: 'cameTo'; who: number; keyMissing: boolean }
  /** The player knocked out by an inmate or a cave-in: the infirmary. */
  | { type: 'floored' }
  /** A comb or toothbrush rubbed into a shiv on a wall. */
  | { type: 'sharpened'; item: number }
  /** A lockdown called off while the player stayed out of reach (tunnels, vents, roof). */
  | { type: 'gaveUp' }
  /** Economy (GDD §11): cash in or out (signed), and why. */
  | { type: 'cash'; n: number; why: 'loot' | 'wage' | 'favor' | 'buy' | 'gift' }
  /** Something done at a job station; the quota moved on; the day's wage. */
  | { type: 'work'; act: StationAct; item: number; prop: number }
  | { type: 'quota'; n: number; of: number }
  /** A job changed hands (who: -1 the player, else an inmate's Cast id). */
  | { type: 'job'; job: number; who: number; change: 'hired' | 'fired' | 'quit' }
  /** The job board was looked at (the panel opens). */
  | { type: 'board' }
  /** Training (GDD §3.2): on and off equipment; a press that counted; a set done; why not. */
  | { type: 'train'; on: boolean; use: FixtureUse | 'study' }
  | { type: 'rep' }
  | { type: 'trained'; attr: Attr; value: number }
  | { type: 'cantTrain'; why: 'tired' | 'max' }
  /** 08:00: attributes left untrained yesterday slipped a point. */
  | { type: 'decay'; attrs: Attr[] }
  /** Talking to an inmate (-1: the talk is over). */
  | { type: 'talk'; who: number }
  | { type: 'opinion'; who: number; by: number }
  | { type: 'bought'; who: number; item: number; price: number }
  | { type: 'gift'; who: number; item: number; cash: number }
  | { type: 'favor'; who: number; kind: number; state: 'offered' | 'taken' | 'done' | 'paid' }
  | { type: 'recruit'; who: number; on: boolean }
  | { type: 'delivered'; who: number }
  /** An inmate with a grudge jumps the player (GDD §10.3); a follower lands a blow on someone. */
  | { type: 'ambush'; who: number }
  | { type: 'allyHit'; by: number; who: number; dmg: number; ko: boolean }
  /** Why a trade, a gift, a favor, a recruit or a job application didn't go through. */
  | { type: 'refused'; why: Refusal }
  | ItemEvent;

/** The three attributes (GDD §3.2). */
export type Attr = 'str' | 'spd' | 'int';
export const ATTRS: readonly Attr[] = ['str', 'spd', 'int'];
/** Why something social or economic didn't happen (i18n `refused.<why>`). */
export type Refusal = 'closed' | 'cash' | 'room' | 'grudge' | 'opinion' | 'followers' | 'int' | 'taken' | 'favors' | 'missing' | 'worthless' | 'notDone';

/**
 * Everything that changes, as plain data (the world's tiles are kept in World and saved
 * with it). New fields go at the end and must be optional when loading old snapshots.
 */
export interface SimState {
  step: number;
  /** mulberry32 state (rng.ts). */
  rng: number;
  player: Body;
  /** Guard heat, 0–100 (GDD §3.1). */
  heat: number;
  /** The routine block running (index into ROUTINE). */
  routine: number;
  /** The player has checked in to the block. */
  attended: boolean;
  lockdown: boolean;
  inmates: Inmate[];
  /** A lockdown ran during this block: missing it costs nothing. */
  excused: boolean;
  /** What the player carries, every container's contents, the floor, the handbook. */
  items: ItemState;
  /** Asleep in bed (Lights Out): time can run fast, any move wakes the player. */
  sleeping: boolean;
  guards: Guard[];
  /** A guard saw the player at the end of this step. */
  seen: boolean;
  /** Steps left knocked out, and where the player wakes (WAKE). */
  ko: number;
  wake: number;
  /** Steps left in solitary (0: not there), and presses on the potato being peeled. */
  solitary: number;
  peeled: number;
  /** What guards are noticing right now (SPOT index): an event fires when it changes. */
  spotted: number;
  /** Steps a disguised player has spent close to a guard. */
  near: number;
  /** The step of the last stroke of the peeler (presses come at most every PEEL_STEPS). */
  peelAt: number;
  /** The layer the player is on (World LAYER): tunnels, ground, vents, roof. */
  layer: number;
  /** 0–100: tools spend it, sleep, meals, showers and chocolate give it back (GDD §3.1). */
  energy: number;
  /** Tiles changed from the map (World placeKey → tile kind): dug, chipped, cut, covered, braced. */
  tiles: Record<number, number>;
  /** Hit points struck off tiles that haven't given way yet (placeKey → damage). */
  wear: Record<number, number>;
  /** Toilets that took dirt (container index → [loads, the step the count began]). */
  toilets: Record<number, [number, number]>;
  /** Damage guards have found (placeKeys): put right when they catch the player. */
  found: number[];
  /** The step of the last strike that landed (a guard who sees it sees tampering). */
  struckAt: number;
  /** The step the player reached the road (0 while still inside). */
  escaped: number;
  /** Steps of a lockdown spent off the ground floor (out of the guards' reach). */
  hiding: number;
  /** The player went down the tunnel under their desk: it stands pushed aside until they come up. */
  deskAside: boolean;
  /** Health (0 → knocked out), Strength and Speed (GDD §3.1–3.2; Intellect lives with the items). */
  health: number;
  str: number;
  spd: number;
  /** Who the player is locked on to (Cast id: inmates, then guards; -1 none). */
  lock: number;
  /** The step of the player's last blow at someone (a guard who sees it sees a fight). */
  swingAt: number;
  /** The keyed door the player is passing through (a plastic key wears once a door, on the way out), -1 elsewhere. */
  doorAt: number;
  /** A guard came round without their key while the alarm couldn't be raised (a lockdown on, the player out cold): it goes up as soon as it can. */
  keyAlarm: boolean;
  /** Dollars (GDD §3.1): wages, favors, change found; spent at the merchants. */
  cash: number;
  /** Change lying in desks and pockets (container index → dollars): taken on opening them. */
  coins: Record<number, number>;
  /** Who holds each of the prison's jobs (def.jobs order): HOLDER.PLAYER, HOLDER.NOBODY, or an inmate's Cast id. */
  jobs: number[];
  /** The day each open job opened (an inmate takes it VACANCY_DAYS mornings later). */
  jobOpen: number[];
  /** The first day the player's job counts (taken after the Work Period began: the next day). */
  jobDay: number;
  /** Today's quota so far, and whether today's wage is paid. */
  quota: number;
  paid: boolean;
  /** Machines with a load in (prop index → the step it's done). */
  machines: Record<number, number>;
  /** Puddles left to mop (tiles), and who today's letters are for (Cast ids). */
  puddles: number[];
  mail: number[];
  /** Training (GDD §3.2): the prop trained on (-1 none), the set's bar (0–100), the side last pressed, attributes trained today (bit per ATTRS). */
  train: number;
  reps: number;
  repSide: number;
  trained: number;
  /** The inmate the player is talking to (Cast id, -1 none). */
  talk: number;
  /** Inmates following the player (GDD §10.3), at most MAX_FOLLOWERS. */
  followers: number[];
  /** Favors on offer and under way (GDD §10.4). */
  favors: Favor[];
  /** Each merchant's stock (def.merchants order). */
  shops: number[][];
}

export interface Snapshot {
  v: 1;
  prison: string;
  state: SimState;
}

/**
 * The game's rules: `step(cmd)` advances one fixed step (1/20 s). The state depends only
 * on the prison, the seed and the commands, never on frame time, the DOM or Three.js, so
 * the tests replay it headless. Systems run in a fixed order (docs/PLAN.md §3):
 * clock → routine (restock, shakedown, bed checks) → inmates → guards → player →
 * solitary → what guards see (heat, chases, capture) → attendance → heat decay → doors.
 */
export class Sim {
  readonly world: World;
  state: SimState;
  /** What happened during the last step. */
  events: SimEvent[] = [];
  private readonly forInmates: Body[] = [];
  private readonly inmateBodies: Body[] = [];
  private readonly onReport = (r: GuardReport) => this.report(r);
  /** Reused every step by noticeDamage. */
  private readonly watchers: Guard[] = [];
  private readonly point = { x: 0, z: 0 };

  constructor(
    readonly prison: PrisonDef,
    seed = 1,
  ) {
    this.world = new World(prison);
    const s = { rng: seed | 0 };
    const inmates = spawnInmates(this.world, s);
    const items = startItems(this.world, s);
    this.state = {
      step: 0,
      rng: s.rng,
      player: bodyAt(prison.spawn.x, prison.spawn.z),
      heat: 0,
      routine: routineAt(clockAt(0).minuteOfDay),
      attended: false,
      lockdown: false,
      inmates,
      excused: false,
      items,
      sleeping: false,
      guards: spawnGuards(this.world),
      seen: false,
      ko: 0,
      wake: WAKE.NONE,
      solitary: 0,
      peeled: 0,
      spotted: 0,
      near: 0,
      peelAt: 0,
      layer: LAYER.GROUND,
      energy: 100,
      tiles: {},
      wear: {},
      toilets: {},
      found: [],
      struckAt: -1000,
      escaped: 0,
      hiding: 0,
      deskAside: false,
      health: maxHealth(START_STR),
      str: START_STR,
      spd: START_SPD,
      lock: -1,
      swingAt: -1000,
      doorAt: -1,
      keyAlarm: false,
      cash: 0,
      coins: {},
      jobs: prison.jobs.map((j) => (j.cell === 1 ? HOLDER.PLAYER : j.cell === 0 ? HOLDER.NOBODY : j.cell - 2)),
      jobOpen: prison.jobs.map((j) => (j.cell === 0 ? 1 : 0)),
      jobDay: 1,
      quota: 0,
      paid: false,
      machines: {},
      puddles: [],
      mail: [],
      train: -1,
      reps: 0,
      repSide: 0,
      trained: 0,
      talk: -1,
      followers: [],
      favors: [],
      shops: prison.merchants.map(() => new Array(SHOP_SLOTS).fill(0)),
    };
    // Day 1: change in desks and pockets, the merchants' stock, the first favors.
    this.spreadCoins();
    for (const shop of this.state.shops) stockSlots('merchant', 0, shop, this.state);
    this.offerFavors();
    this.ladderFoot = ladderFootOf(this.world);
    // Where nobody may dig, worked out now from the map as built (never from a later state).
    reserved(this.world);
    this.updateDoors(false);
  }

  /** Where the ladder's floor end is (-1 without one). */
  private ladderFoot = -1;
  /** Bump whenever a tile changes, and whenever a tile's wear does (the view redraws them). Not state. */
  tilesRev = 0;
  wearRev = 0;

  get clock(): Clock {
    return clockAt(this.state.step);
  }

  step(cmd: number) {
    const s = this.state;
    const w = this.world;
    this.events = [];
    // Out: the game is won, nothing more happens.
    if (s.escaped) return;
    s.step++;
    // Clock.
    const clock = this.clock;
    if (hourStarts(s.step)) this.events.push({ type: 'hour', hour: clock.hour });
    // Routine: a new block settles the last one.
    const now = routineAt(clock.minuteOfDay);
    if (now !== s.routine) {
      const past = ROUTINE[s.routine];
      if (past.miss && !s.attended && !s.excused) {
        const heat = past.miss === 'lockdown' ? 100 : MISSED_ROUTINE_HEAT;
        this.events.push({ type: 'missed', routine: s.routine, heat });
        this.addHeat(heat);
      }
      s.routine = now;
      s.attended = false;
      // Night jobs end with the night, the morning's with Lights Out (a long chase may have held them up).
      const night = ROUTINE[now].id === 'lightsOut';
      s.guards.forEach((g, i) => {
        const duties = w.def.guards[i].duties ?? [];
        if (!night && duties.includes('bedCheck')) cancelTasks(g, GUARD.BED_CHECK);
        if (night && duties.includes('shakedown')) cancelTasks(g, GUARD.SHAKEDOWN);
      });
      s.excused = s.lockdown || this.away;
      // The Work Period settled (GDD §11): wages were paid as quotas were met; an unmet one costs the job.
      if (past.id === 'work') this.settleWork();
      this.events.push({ type: 'routine', routine: now });
      // A new day: desks, shelves and counters are stocked again (GDD §6.2), and two cells
      // are named for the shakedown during roll call.
      if (now === 0) {
        restock(w, s.items, s);
        this.reissueKit();
        this.events.push({ type: 'restock' });
        this.shakedown();
        this.newDay();
      }
      if (ROUTINE[now].id === 'work') this.startWork();
      // Lights Out: followers go to their beds.
      if (night) this.dismissAll();
    }
    // 00:30 and 04:00: the night bed check (GDD §5.3).
    if (s.step % STEPS_PER_MINUTE === 0 && (clock.minuteOfDay === 30 || clock.minuteOfDay === 240)) this.bedCheck();
    // The knocked out come round (GDD §10.2): a guard missing its key raises the alarm.
    this.recover();
    // Everyone moves.
    // In a lockdown inmates head for their cells (at night they are going there anyway, to sleep).
    // Who each group shares the floor with (arrays reused: asleep, hundreds of steps run a second).
    const forInmates = this.forInmates;
    const inmateBodies = this.inmateBodies;
    const about = s.layer === LAYER.GROUND;
    forInmates.length = 0;
    if (about) forInmates.push(s.player);
    for (const g of s.guards) forInmates.push(g.body);
    inmateBodies.length = 0;
    for (const m of s.inmates) inmateBodies.push(m.body);
    stepInmates(w, s.inmates, s.lockdown && ROUTINE[s.routine].id !== 'lightsOut' ? LOCKDOWN_PLAN : s.routine, s, forInmates, s.step, about && !this.away ? s.player : null, this.socialNow());
    this.clockIn();
    stepGuards(w, s.guards, s.routine, s.lockdown, s.player, inmateBodies, s.step, this.onReport, about);
    // Knocked out: nothing to do but lie there, then wake up somewhere else.
    if (s.ko > 0) {
      s.player.moving = false;
      if (--s.ko === 0) this.wakeUp();
    } else {
      // Asleep: a move (or the action button) wakes the player, and so does 07:55 (in time for roll call).
      const wokenByPlayer = s.sleeping && (dirOf(cmd) !== 0 || opOf(cmd) === OP.INTERACT);
      if (s.sleeping && (wokenByPlayer || clock.minuteOfDay === 7 * 60 + 55 || ROUTINE[s.routine].id !== 'lightsOut' || s.lockdown)) {
        s.sleeping = false;
        this.events.push({ type: 'sleep', on: false });
      }
      // Keys in the pockets open their doors for the player (GDD §7.3).
      w.setPlayerKeys(this.keysCarried());
      // A step off the equipment ends the training.
      if (s.train >= 0 && dirOf(cmd) !== 0) this.stopTraining();
      walk(w, s.player, s.sleeping ? 0 : dirOf(cmd), s.layer === LAYER.VENTS ? CRAWL_SPEED : s.layer === LAYER.UNDER ? TUNNEL_SPEED : walkSpeed(s.spd), s.layer);
      this.wearKeys();
      // Nothing gets done in your sleep, and the press that woke you doesn't put you back to bed.
      this.useItems(s.sleeping || wokenByPlayer ? dirOf(cmd) : cmd);
      // On the road outside: free.
      if (s.layer === LAYER.GROUND && this.playerZone === 'outside') {
        s.escaped = s.step;
        this.closeBox();
        this.events.push({ type: 'escaped' });
        return;
      }
    }
    // Combat: inmates and guards land their blows on the player (GDD §10.1); the lock follows its target.
    this.fight();
    // Social life and training: the talk holds while the inmate is in reach, grudges flare up, a set's bar drains.
    this.keepTalk();
    this.grudges();
    this.keepTraining();
    // Energy: a point back every couple of minutes, one a minute asleep. Health: a point a minute, two asleep.
    if (s.energy < 100 && (s.step % ENERGY_REGEN_STEPS === 0 || (s.sleeping && s.step % STEPS_PER_MINUTE === 0))) s.energy++;
    if (s.ko === 0 && s.health < maxHealth(s.str) && (s.step % HEALTH_REGEN_STEPS === 0 || (s.sleeping && s.step % (HEALTH_REGEN_STEPS / 2) === 0))) s.health++;
    // Solitary: time served (and potatoes peeled) sets the player free.
    if (s.solitary > 0 && --s.solitary === 0) this.release();
    // Who sees the player now, and what they make of it; a key alarm held back goes up now if it can.
    this.watch();
    this.raiseKeyAlarm();
    // Out of reach through a whole lockdown: the guards call off the hunt, fix what they found,
    // and stay on the lookout (the heat stays: whoever sees the player next gives chase).
    if (s.lockdown && s.layer !== LAYER.GROUND && !this.away) {
      if (++s.hiding >= HIDING_STEPS) {
        s.lockdown = false;
        s.hiding = 0;
        for (const g of s.guards) if (g.mode === GUARD.CHASE || g.mode === GUARD.INVESTIGATE) backToDuty(g);
        this.repair();
        this.events.push({ type: 'lockdown', on: false }, { type: 'gaveUp' });
      }
    } else s.hiding = 0;
    // Attendance.
    const zone = this.playerZone;
    if (!s.attended && this.dutyZones.includes(zone)) {
      s.attended = true;
      this.events.push({ type: 'attended', routine: s.routine });
      // A meal or a shower picks the player up.
      const id = ROUTINE[s.routine].id;
      const gain = id === 'breakfast' || id === 'dinner' ? MEAL_ENERGY : id === 'showers' ? SHOWER_ENERGY : 0;
      s.energy = Math.min(100, s.energy + gain);
    }
    // Heat cools while no guard is looking.
    if (!s.seen && !s.lockdown && s.heat > 0 && s.step % HEAT_DECAY_STEPS === 0) s.heat--;
    // Doors last: they follow where everyone ended up, so the state at the end of a step
    // (a save, a keyframe) says everything about them.
    this.updateDoors(true);
  }

  /** Where the block wants the player: the routine's zones, or during the Work Period, the job's room (GDD §2.1: mandatory if employed). */
  get dutyZones(): readonly string[] {
    const r = ROUTINE[this.state.routine];
    if (r.id !== 'work') return r.zones;
    const job = this.jobActive();
    return job >= 0 ? [jobRooms(this.world)[job].def.zone] : r.zones;
  }

  /** Bed means sleep: Lights Out, and no lockdown (the sirens would wake you at once). */
  get bedtime(): boolean {
    return ROUTINE[this.state.routine].id === 'lightsOut' && !this.state.lockdown;
  }

  /** Knocked out or in solitary: not about, so the routine excuses the player. */
  get away(): boolean {
    return this.state.ko > 0 || this.state.solitary > 0;
  }

  /**
   * Guards look (GDD §5.1–5.3): who sees the player, what that costs in heat, who gives
   * chase, and whether a chaser has caught them.
   */
  private watch() {
    const s = this.state;
    const p = s.player;
    const t = tileOfBody(p);
    const here = t.z * MAP_W + t.x;
    s.seen = false;
    for (const g of s.guards) {
      g.sees = !this.away && awake(g) && this.inView(g.body);
      if (g.sees) {
        g.lastSeen = here;
        s.seen = true;
      }
    }
    // Damage and evidence in a guard's cone (GDD §9.3).
    const found = this.noticeDamage();
    if (this.away) {
      s.spotted = 0;
      s.near = 0;
      if (found) this.repair();
      return;
    }
    const zone = this.playerZone;
    const it = s.items;
    const disguised = itemOf(it.inv[SLOT.OUTFIT]) === GUARD_OUTFIT;
    let reason = 0;
    let heat = 0;
    // Out of the cell after Lights Out (past the walk home), or somewhere staff only: 100%.
    const sinceLightsOut = (clockAt(s.step).minuteOfDay - ROUTINE[ROUTINE.length - 1].start + 1440) % 1440;
    const late = ROUTINE[s.routine].id === 'lightsOut' && sinceLightsOut * STEPS_PER_MINUTE >= LIGHTS_OUT_GRACE;
    // Seen attacking someone (GDD §5.2), at work on a wall, a fence, a grate or the floor, damage found: 100% (§9.3).
    if (s.seen && s.step - s.swingAt <= STRIKE_SEEN_STEPS) [reason, heat] = [SPOT.indexOf('fight'), 100];
    else if (s.seen && s.step - s.struckAt <= STRIKE_SEEN_STEPS) [reason, heat] = [SPOT.indexOf('tampering'), 100];
    else if (found) [reason, heat] = [SPOT.indexOf('damage'), 100];
    else if (s.seen && !disguised && late && zone !== 'playerCell') [reason, heat] = [SPOT.indexOf('night'), 100];
    else if (s.seen && !disguised && RESTRICTED.includes(zone)) [reason, heat] = [SPOT.indexOf('restricted'), 100];
    // A contraband tool or weapon in hand, in plain sight: +40% a second.
    const held = itemOf(it.inv[it.hand]);
    const def = held ? itemDef(held) : null;
    if (!reason && s.seen && def?.contraband && (def.cat === 'tool' || def.cat === 'weapon')) [reason, heat] = [SPOT.indexOf('contraband'), CONTRABAND_HEAT];
    // In a guard's uniform, but too close to a real one (who sees the player) for too long: +50% a second.
    const close = disguised && s.guards.some((g) => g.sees && (g.body.x - p.x) ** 2 + (g.body.z - p.z) ** 2 <= RECOGNIZE_RANGE ** 2);
    s.near = close ? s.near + 1 : 0;
    if (!reason && s.near > RECOGNIZE_STEPS) [reason, heat] = [SPOT.indexOf('recognized'), s.step % 2 === 0 ? 5 : 0];
    // Wanted (80%+): any guard who sees the player gives chase.
    if (!s.lockdown && s.heat >= CHASE_HEAT) {
      for (const g of s.guards) {
        if (!g.sees || g.mode === GUARD.CHASE) continue;
        if (!reason) reason = SPOT.indexOf('wanted');
        startChase(g);
      }
    }
    // Something new noticed (in a lockdown there is nothing more to notice).
    if (reason && reason !== s.spotted && !s.lockdown) this.events.push({ type: 'spotted', reason: SPOT[reason] });
    s.spotted = reason;
    if (heat) this.addHeat(heat);
  }

  /**
   * Whether a guard sees the player: on the ground floor, its cone and a clear line; up on a
   * roof, from the open yard (nothing on the ground is in the way); in the vents and the
   * tunnels, never.
   */
  private inView(eye: Body): boolean {
    const s = this.state;
    if (s.layer === LAYER.GROUND) return canSee(this.world, eye, s.player);
    if (s.layer !== LAYER.ROOF) return false;
    const t = tileOfBody(eye);
    return TILE_INFO[this.world.ground.kind[t.z * MAP_W + t.x]].outdoor && canSee(this.world, eye, s.player, undefined, false);
  }

  /**
   * Guards notice damage in their cones (GDD §9.3): an open hole, a cut fence, a missing
   * grate overhead, a tunnel entrance (one under the player's desk only while the desk is
   * pushed aside, with the player below), and dirt or chunks of wall left on the floor
   * (taken away there and then). Returns whether anything new was found.
   */
  private noticeDamage(): boolean {
    const s = this.state;
    const w = this.world;
    const watchers = this.watchers;
    watchers.length = 0;
    for (const g of s.guards) if (awake(g)) watchers.push(g);
    if (!watchers.length) return false;
    const point = this.point;
    // The middle of the tile, or any of its four faces (a hole in a wall is seen from an angle by its face).
    const seenAt = (tile: number) => {
      const cx = (tile % MAP_W) * UNIT + UNIT / 2;
      const cz = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
      for (const [fx, fz] of FACES) {
        point.x = cx + fx;
        point.z = cz + fz;
        if (watchers.some((g) => canSee(w, g.body, point))) return true;
      }
      return false;
    };
    let any = false;
    for (const k in s.tiles) {
      const key = Number(k);
      const kind = s.tiles[key];
      const layer = layerOfKey(key);
      const tile = tileOfKey(key);
      const shows = layer === LAYER.GROUND ? DAMAGE_SHOWS.has(kind) && !(kind === TILE.SHAFT && underMyDesk(w, tile) && !s.deskAside) : layer === LAYER.VENTS && kind === TILE.GRATE_OPEN;
      if (!shows || s.found.includes(key) || !seenAt(tile)) continue;
      s.found.push(key);
      this.events.push({ type: 'found', kind });
      any = true;
    }
    const it = s.items;
    for (let k = it.ground.length - 1; k >= 0; k--) {
      const [key, v] = it.ground[k];
      const item = itemOf(v);
      if ((item !== DIRT && item !== WALL_CHUNK) || layerOfKey(key) !== LAYER.GROUND || !seenAt(key)) continue;
      it.ground.splice(k, 1);
      it.rev++;
      this.events.push({ type: 'found', kind: TILE.DIRT });
      any = true;
    }
    return any;
  }

  /** Damage the guards found is put right (concreted over, the grate screwed back): after a capture. */
  private repair() {
    const s = this.state;
    if (!s.found.length) return;
    const n = s.found.length;
    for (const key of s.found) this.setTile(layerOfKey(key), tileOfKey(key), -1);
    s.found = [];
    this.events.push({ type: 'repaired', n });
  }

  /** Changes a tile and records it in the state (-1 puts the map's own tile back). */
  private setTile(layer: number, tile: number, kind: number) {
    const s = this.state;
    const l = this.world.layers[layer];
    const key = placeKey(layer, tile);
    const k = kind < 0 ? l.base[tile] : kind;
    delete s.wear[key];
    if (k === l.base[tile]) delete s.tiles[key];
    else s.tiles[key] = k;
    this.world.setKind(layer, tile, k);
    this.tilesRev++;
    this.wearRev++;
  }

  /** The prison's power (the generator arrives in P7: until then it is always on). */
  get power(): boolean {
    return true;
  }

  /** Knocked down by a guard: the lockdown is over, everyone back to work, the player out cold. */
  private caught() {
    const s = this.state;
    const solitary = s.heat >= SOLITARY_HEAT;
    s.lock = -1;
    this.dismissAll();
    this.endTalk();
    this.stopTraining();
    // The score is settled: a key alarm still held back is part of it.
    s.keyAlarm = false;
    for (const m of s.inmates) m.angry = 0;
    s.ko = KO_STEPS;
    s.wake = solitary ? WAKE.SOLITARY : WAKE.INFIRMARY;
    s.excused = true;
    s.player.moving = false;
    s.sleeping = false;
    s.spotted = 0;
    s.near = 0;
    this.closeBox();
    // The guard who made the catch stands over the player until they're carried off.
    const p = s.player;
    const d2 = (g: Guard) => (g.body.x - p.x) ** 2 + (g.body.z - p.z) ** 2;
    const catcher = s.guards.filter((g) => g.mode === GUARD.CHASE).sort((a, b) => d2(a) - d2(b))[0];
    for (const g of s.guards) if (g.mode === GUARD.CHASE || g.mode === GUARD.INVESTIGATE) backToDuty(g);
    if (catcher) {
      catcher.wait = KO_STEPS;
      catcher.body.moving = false;
      if (catcher.body.x !== p.x || catcher.body.z !== p.z) catcher.body.facing = nearestDir(p.x - catcher.body.x, p.z - catcher.body.z);
    }
    this.events.push({ type: 'caught', solitary });
    if (s.lockdown) {
      s.lockdown = false;
      this.events.push({ type: 'lockdown', on: false });
    }
  }

  /**
   * Waking up after being caught (GDD §5.6): carried contraband is taken and the outfit is
   * swapped for an inmate's; in solitary the desk's standard drawers are searched too. The
   * score is settled: heat back to 0.
   */
  private wakeUp() {
    const s = this.state;
    const places = placesOf(this.world);
    const it = s.items;
    let taken = 0;
    for (let k = 0; k <= SLOT.WEAPON; k++) {
      if (it.inv[k] && itemDef(itemOf(it.inv[k])).contraband) {
        it.inv[k] = 0;
        taken++;
      }
    }
    if (itemOf(it.inv[SLOT.OUTFIT]) !== INMATE_OUTFIT) {
      if (it.inv[SLOT.OUTFIT] && itemDef(itemOf(it.inv[SLOT.OUTFIT])).contraband) taken++;
      it.inv[SLOT.OUTFIT] = slot(INMATE_OUTFIT);
    }
    it.rev++;
    // Caught: the score is settled. Floored by an inmate or a cave-in: the heat stays.
    if (s.wake !== WAKE.FLOORED) s.heat = 0;
    // Patched up while out cold.
    s.health = maxHealth(s.str);
    s.lock = -1;
    // What the guards found is put right while the player is out cold (GDD §5.6).
    this.repair();
    const lightsOut = ROUTINE[s.routine].id === 'lightsOut';
    if (s.wake === WAKE.SOLITARY && places.solitary >= 0) {
      taken += this.search(1);
      s.solitary = SOLITARY_STEPS;
      s.peeled = 0;
      this.place(places.solitary);
      this.events.push({ type: 'solitary', on: true, taken });
    } else {
      // The infirmary (at night, straight back to the cell).
      this.place(lightsOut || places.infirmary < 0 ? places.bedside[1] : places.infirmary);
      this.events.push({ type: 'infirmary', taken });
    }
    s.wake = WAKE.NONE;
  }

  /** Out of solitary: into the corridor outside it (at night, back to the cell). */
  private release() {
    const s = this.state;
    const w = this.world;
    const places = placesOf(w);
    let to = places.bedside[1];
    if (ROUTINE[s.routine].id !== 'lightsOut') {
      const corridor = zoneIndex('corridor');
      const path = findPath(w, places.solitary, (i) => w.ground.zone[i] === corridor, -1, MAP_W * MAP_H, undefined, w.guardBlock);
      if (path?.length) to = path[path.length - 1];
    }
    s.peeled = 0;
    this.place(to);
    this.events.push({ type: 'solitary', on: false, taken: 0 });
  }

  /** A press on the potato in solitary: every few presses, 10 minutes off. */
  private peel() {
    const s = this.state;
    // A stroke takes a moment: presses faster than that don't count.
    if (s.step - s.peelAt < PEEL_STEPS) return;
    s.peelAt = s.step;
    if (++s.peeled < POTATO_PRESSES) {
      this.events.push({ type: 'peel', done: false });
      return;
    }
    s.peeled = 0;
    s.solitary = Math.max(1, s.solitary - POTATO_STEPS);
    this.events.push({ type: 'peel', done: true });
  }

  /** Puts the player on a ground floor tile (carried there, facing south). */
  private place(tile: number) {
    this.state.layer = LAYER.GROUND;
    this.state.deskAside = false;
    const p = this.state.player;
    p.x = (tile % MAP_W) * UNIT + UNIT / 2;
    p.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
    p.moving = false;
    p.facing = 5;
  }

  private closeBox() {
    const it = this.state.items;
    if (it.open < 0) return;
    it.open = -1;
    it.rev++;
    this.events.push({ type: 'close' });
  }

  /** 08:00: two cells, drawn at random, for the shakedown guard to search (GDD §2.1). */
  private shakedown() {
    const s = this.state;
    const n = this.world.def.cells.length;
    const k = s.guards.findIndex((_, i) => this.world.def.guards[i].duties?.includes('shakedown'));
    if (k < 0 || n < 2) return;
    const a = 1 + randomInt(s, n);
    let b = 1 + randomInt(s, n - 1);
    if (b >= a) b++;
    const cells = [a, b];
    assign(s.guards[k], GUARD.SHAKEDOWN, cells);
    this.events.push({ type: 'shakedown', cells: [...cells] });
  }

  /** The bed check: the night guard looks into every cell, east to west. */
  private bedCheck() {
    const s = this.state;
    const k = s.guards.findIndex((_, i) => this.world.def.guards[i].duties?.includes('bedCheck'));
    if (k < 0) return;
    const steps = placesOf(this.world).doorstep;
    const cells = steps.map((_, c) => c).filter((c) => c > 0 && steps[c] >= 0);
    cells.sort((a, b) => (steps[b] % MAP_W) - (steps[a] % MAP_W) || steps[a] - steps[b]);
    assign(s.guards[k], GUARD.BED_CHECK, cells);
    this.events.push({ type: 'bedCheck', result: 'start' });
  }

  /** A guard looked into a cell or searched one. */
  private report(r: GuardReport) {
    const s = this.state;
    if (r.kind === 'search') {
      const taken = this.search(r.cell);
      this.events.push({ type: 'searched', cell: r.cell, taken });
      return;
    }
    if (r.cell !== 1 || ROUTINE[s.routine].id !== 'lightsOut') return;
    // In the cell, asleep, or a bed dummy under the blanket: all present (GDD §5.3).
    const ok = this.playerZone === 'playerCell' || s.sleeping || s.solitary > 0 || s.ko > 0 || this.dummyInBed();
    this.events.push({ type: 'bedCheck', result: ok ? 'pass' : 'fail' });
    if (!ok && !s.lockdown) {
      this.events.push({ type: 'spotted', reason: 'bedCheck' });
      this.addHeat(100);
    }
  }

  /** Whether the player's bed holds a bed dummy. */
  dummyInBed(): boolean {
    const list = containersOf(this.world);
    const k = list.findIndex((c) => c.mine && c.prop.kind === 'bed');
    return k >= 0 && this.state.items.containers[k].some((v) => itemOf(v) === BED_DUMMY);
  }

  /**
   * Searches a cell: contraband in the desk's standard drawers and in the bed goes (the
   * hidden compartment is never found, GDD §6.2). Returns how many items were taken.
   */
  private search(cell: number): number {
    const it = this.state.items;
    let taken = 0;
    containersOf(this.world).forEach((c, i) => {
      if (this.world.cellOf[c.prop.z * MAP_W + c.prop.x] !== cell || (c.prop.kind !== 'desk' && c.prop.kind !== 'bed')) return;
      const box = it.containers[i];
      for (let k = c.hidden; k < box.length; k++) {
        if (box[k] && itemDef(itemOf(box[k])).contraband) {
          box[k] = 0;
          taken++;
        }
      }
    });
    if (taken) it.rev++;
    return taken;
  }

  /** The player's one-step operation (OP), and the open container closing out of reach. */
  private useItems(cmd: number) {
    const s = this.state;
    const it = s.items;
    const ev = this.events as ItemEvent[];
    const a = argA(cmd);
    // Every op may change items (the UI redraws on rev); a held use button asks every step, so strikes bump it themselves.
    if (opOf(cmd) !== OP.NONE && opOf(cmd) !== OP.USE) it.rev++;
    switch (opOf(cmd)) {
      case OP.INTERACT: {
        if (s.solitary > 0) {
          this.peel();
          break;
        }
        // From the open desk panel: down the tunnel under the player's desk.
        if (a === 1) {
          this.underDesk();
          break;
        }
        const held = itemOf(it.inv[it.hand]);
        const target = interactTarget(this.world, it, s.player, this.bedtime, s.layer, this.people(), s.inmates.length);
        const faced = target?.kind === 'container' || target?.kind === 'sleep' ? facesProp(s.player, containersOf(this.world)[target.index].prop) : false;
        const climb = preferClimb(climbTarget(this.world, s.layer, s.player, this.ladderFoot, this.bodiesAbout()), faced);
        if (climb) {
          this.climb(climb);
          break;
        }
        // On the job (GDD §11): the station's step comes first.
        const station = s.layer === LAYER.GROUND ? this.station() : null;
        if (station) {
          this.work(station);
          break;
        }
        if (!target) break;
        if (target.kind === 'ground') pickUp(it, target.index, ev);
        else if (target.kind === 'sleep') this.sleep();
        else if (target.kind === 'person') this.approach(target.who);
        else if (target.kind === 'fixture') {
          if (target.use === 'board') this.events.push({ type: 'board' });
          else this.startTraining(target.index, target.use);
        } else if (target.kind === 'pockets') {
          // Going through someone's pockets while they're out cold (GDD §10.2).
          if (it.open !== target.index) {
            it.open = target.index;
            ev.push({ type: 'open', container: target.index });
            this.takeCoins(target.index);
          }
        }
        else if ((held === DIRT || held === WALL_CHUNK) && containersOf(this.world)[target.index].prop.kind === 'toilet') this.flush(target.index);
        else if (it.open !== target.index) {
          it.open = target.index;
          ev.push({ type: 'open', container: target.index });
          this.takeCoins(target.index);
        }
        break;
      }
      case OP.CLOSE:
        if (it.open >= 0) {
          it.open = -1;
          ev.push({ type: 'close' });
        }
        this.endTalk();
        if (s.train >= 0) this.stopTraining();
        break;
      case OP.TALK:
        this.talkOp(a, argB(cmd));
        break;
      case OP.JOB:
        this.jobOp(a);
        break;
      case OP.TRAIN:
        if (a === 0) this.study();
        else if (a === 3) {
          if (s.train >= 0) this.stopTraining();
        } else this.rep(a);
        break;
      case OP.MOVE:
        moveItem(it, a, argB(cmd));
        break;
      case OP.DROP:
        dropItem(it, a, s.player, ev, s.layer);
        break;
      case OP.USE:
        // Locked on to someone: a blow (or a throw) at them; else the tool in hand.
        if (s.solitary === 0 && !this.attack(a === 1)) this.strike(a === 1);
        break;
      case OP.LOCK: {
        if (s.solitary > 0) break;
        const was = s.lock;
        // a = 2 + id: that person (a tap on them), if they can be locked on to.
        const pick = a >= 2 ? a - 2 : -1;
        s.lock = a === 1 || s.layer !== LAYER.GROUND ? -1 : pick >= 0 ? (lockCandidates(this.world, s, s.player).includes(pick) ? pick : s.lock) : nextLock(this.world, s, s.player, s.lock);
        if (s.lock !== was) this.events.push({ type: 'lock', who: s.lock });
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
    }
    if (it.open >= 0 && !stillInReach(this.world, it, s.player, this.people())) {
      it.open = -1;
      it.rev++;
      ev.push({ type: 'close' });
    }
  }

  /** Everyone about on the ground floor (nobody digs under people); one array, refilled. */
  private readonly about: Body[] = [];
  private bodiesAbout(): Body[] {
    const list = this.about;
    list.length = 0;
    for (const m of this.state.inmates) list.push(m.body);
    for (const g of this.state.guards) list.push(g.body);
    return list;
  }

  /** Everyone who can be fought or looted, by Cast id (inmates, then guards); one array, refilled. */
  private readonly cast: Array<Inmate | Guard> = [];
  private people(): ReadonlyArray<Inmate | Guard> {
    const list = this.cast;
    list.length = 0;
    for (const m of this.state.inmates) list.push(m);
    for (const g of this.state.guards) list.push(g);
    return list;
  }

  /** Bit k: the player carries a key (real or plastic) for door color k (keys work from the hotbar). */
  private keysCarried(): number {
    const it = this.state.items;
    let mask = 0;
    for (let k = 0; k < HOTBAR; k++) {
      const v = it.inv[k];
      const d = v ? itemDef(itemOf(v)) : null;
      if (d?.cat === 'key' && d.key) mask |= 1 << d.key;
    }
    return mask;
  }

  /**
   * A plastic key wears a little at each door it opens (GDD §7.3: 15 uses); a real key never
   * does. Counted once a door, as the player steps out of it (the door stays open to them
   * while they're in it, so the last use still gets them through). A two-wide door is one door.
   */
  private wearKeys() {
    const s = this.state;
    const w = this.world;
    const t = tileOfBody(s.player);
    const i = t.z * MAP_W + t.x;
    const inDoor = s.layer === LAYER.GROUND && w.ground.kind[i] === TILE.DOOR && w.doorShut[i] === 1;
    const was = s.doorAt;
    if (inDoor) {
      s.doorAt = i;
      return;
    }
    if (was < 0) return;
    s.doorAt = -1;
    this.wearKey(w.ground.key[was]);
  }

  /** One use off a plastic key of a color (none if the player holds the real one). */
  private wearKey(color: number) {
    const it = this.state.items;
    let plastic = -1;
    for (let k = 0; k < HOTBAR; k++) {
      const v = it.inv[k];
      const d = v ? itemDef(itemOf(v)) : null;
      if (d?.cat !== 'key' || d.key !== color) continue;
      if (!d.uses) return;
      if (plastic < 0) plastic = k;
    }
    if (plastic < 0) return;
    const item = itemOf(it.inv[plastic]);
    const left = usesOf(it.inv[plastic]) - 1;
    it.inv[plastic] = left > 0 ? slot(item, left) : 0;
    it.rev++;
    if (left <= 0) this.events.push({ type: 'broke', item });
  }

  /** The weapon the player fights with: one in hand, else the one in the weapon slot (0: fists). */
  private weapon(): { item: number; slot: number } {
    const it = this.state.items;
    const inHand = itemOf(it.inv[it.hand]);
    if (inHand && itemDef(inHand).cat === 'weapon') return { item: inHand, slot: it.hand };
    return { item: itemOf(it.inv[SLOT.WEAPON]), slot: SLOT.WEAPON };
  }

  /**
   * A blow at the locked-on target (GDD §10.1): at the weapon's pace, within its reach, with a
   * clear line; Strength and the weapon against the target's outfit. Molten chocolate is
   * thrown instead (3 tiles, out cold at once). Whoever is hit knows it: an inmate fights
   * back, a guard turns round (and sees who it was). Returns false with nobody locked on (the
   * press goes to the tool in hand).
   */
  private attack(fresh: boolean): boolean {
    const s = this.state;
    const it = s.items;
    const p = s.player;
    if (s.lock < 0 || s.layer !== LAYER.GROUND) return false;
    const f = personOf(s, s.lock);
    if (!f || f.ko > 0) {
      s.lock = -1;
      return false;
    }
    const { item, slot: from } = this.weapon();
    const wdef = item ? itemDef(item) : null;
    const d2 = dist2(f.body, p);
    const clear = lineOfSight(this.world, p.x, p.z, f.body.x, f.body.z);
    if (wdef?.thrown) {
      if (!fresh) return true;
      if (d2 > THROW_RANGE * THROW_RANGE || !clear) {
        this.events.push({ type: 'cantHit', why: 'far' });
        return true;
      }
      if (d2 > 0) p.facing = faceTo(f.body.x - p.x, f.body.z - p.z);
      it.inv[from] = 0;
      it.rev++;
      s.swingAt = s.step;
      const who = s.lock;
      this.events.push({ type: 'thrown', who });
      this.knockOut(who);
      return true;
    }
    if (s.step - s.swingAt < swingSteps(s.spd, wdef)) return true;
    const reach = reachOf(wdef);
    if (d2 > reach * reach || !clear) {
      if (fresh) this.events.push({ type: 'cantHit', why: 'far' });
      return true;
    }
    if (d2 > 0) p.facing = faceTo(f.body.x - p.x, f.body.z - p.z);
    s.swingAt = s.step;
    const who = s.lock;
    const guard = isGuard(s, who);
    const dmg = damage(s.str, wdef?.attack ?? 0, guard ? GUARD_DEFENSE : INMATE_DEFENSE);
    f.hp = Math.max(0, f.hp - dmg);
    const ko = f.hp === 0;
    // They know who hit them.
    if (d2 > 0) f.body.facing = faceTo(p.x - f.body.x, p.z - f.body.z);
    if (guard) {
      const g = f as Guard;
      if (g.doing === DOING.SLEEP) g.doing = DOING.NOTHING;
      g.face = g.body.facing;
    } else {
      const m = f as Inmate;
      m.angry = ANGRY_STEPS;
      m.doing = DOING.NOTHING;
      m.wait = 0;
      // Its first punch comes back quickly.
      m.swing = Math.min(m.swing, s.step - INMATE_SWING_STEPS / 2);
      // Nobody likes being hit; a follower hit stops following.
      this.changeOpinion(who, -HIT_OPINION);
      this.dismiss(who);
      if (s.talk === who) this.endTalk();
    }
    this.events.push({ type: 'hit', who, dmg, ko, weapon: item });
    // A scene at roll call (GDD §10.4: the distraction favor).
    const block = ROUTINE[s.routine].id;
    if (block === 'rollCall' || block === 'eveningRollCall') for (const fv of s.favors) if (fv.kind === FAVOR.DISTRACTION && fv.state === FAVOR_STATE.TAKEN) this.favorDone(fv);
    if (ko) this.knockOut(who);
    return true;
  }

  /** Someone the player (or a follower, `by`) put down: out cold for 30 s where they stand (GDD §10.2). */
  private knockOut(who: number, by: Body = this.state.player) {
    const s = this.state;
    const f = personOf(s, who) as (Inmate | Guard) | undefined;
    if (!f) return;
    f.hp = 0;
    f.ko = KO_STEPS;
    f.body.moving = false;
    if (!isGuard(s, who)) {
      const m = f as Inmate;
      // Knocked out on the job: it misses work (GDD §11: sabotage).
      if (ROUTINE[s.routine].id === 'work') m.shift = 2;
      if (by === s.player) this.changeOpinion(who, -KO_OPINION);
      if (s.talk === who) this.endTalk();
      for (const fv of s.favors) if (fv.kind === FAVOR.BEATDOWN && fv.target === who && fv.state === FAVOR_STATE.TAKEN) this.favorDone(fv);
    }
    // Down facing whoever did it: they fall back, away from them.
    const p = by;
    if (f.body.x !== p.x || f.body.z !== p.z) f.body.facing = faceTo(p.x - f.body.x, p.z - f.body.z);
    f.path = [];
    f.goal = -1;
    f.wait = 0;
    f.doing = DOING.KNOCKED_OUT;
    if (isGuard(s, who)) this.resumeAfterKo(f as Guard);
    else (f as Inmate).angry = 0;
    f.doing = DOING.KNOCKED_OUT;
    if (s.lock === who) {
      s.lock = -1;
      this.events.push({ type: 'lock', who: -1 });
    }
    this.events.push({ type: 'koed', who });
  }

  /**
   * The knocked out come round, healed. A guard is handed a new baton or uniform if they were
   * taken; a guard whose key is gone radios it in: a lockdown (GDD §10.2), and a spare key.
   */
  private recover() {
    const s = this.state;
    const w = this.world;
    s.inmates.forEach((m, id) => {
      if (m.ko <= 0 || --m.ko > 0) return;
      m.hp = maxHealth(m.str);
      m.doing = DOING.NOTHING;
      m.plan = -1;
      this.events.push({ type: 'cameTo', who: id, keyMissing: false });
    });
    s.guards.forEach((g, k) => {
      if (g.ko <= 0 || --g.ko > 0) return;
      g.hp = maxHealth(g.str);
      g.doing = DOING.NOTHING;
      this.resumeAfterKo(g);
      const id = s.inmates.length + k;
      const pockets = s.items.containers[pocketOf(w, id)];
      const key = guardKit(w, k)[0];
      const missing = !pockets.some((v) => itemOf(v) === key);
      // The key is radioed in (and a spare drawn); a missing baton or uniform waits for 08:00.
      if (missing) {
        const free = pockets.indexOf(0);
        if (free >= 0) pockets[free] = slot(key);
        s.items.rev++;
        s.keyAlarm = true;
      }
      this.events.push({ type: 'cameTo', who: id, keyMissing: missing });
    });
    this.raiseKeyAlarm();
  }

  /**
   * A missing key raises the alarm (GDD §10.2) as soon as it can: not during a lockdown
   * (already on), nor while the player is out cold or in solitary (it waits for them).
   */
  private raiseKeyAlarm() {
    const s = this.state;
    if (!s.keyAlarm || s.lockdown || this.away) return;
    s.keyAlarm = false;
    this.events.push({ type: 'spotted', reason: 'keyMissing' });
    s.spotted = SPOT.indexOf('keyMissing');
    this.addHeat(100);
  }

  /**
   * A guard back on its feet (or just put down): a chase or a search is over, a round starts
   * afresh, but a bed check or shakedown under way is taken up again.
   */
  private resumeAfterKo(g: Guard) {
    g.path = [];
    g.goal = -1;
    g.wait = 0;
    if (g.mode !== GUARD.BED_CHECK && g.mode !== GUARD.SHAKEDOWN) backToDuty(g);
  }

  /** 08:00: guards draw a new baton or uniform from the quarters if theirs were taken (never more than one each). */
  private reissueKit() {
    const s = this.state;
    const w = this.world;
    s.guards.forEach((_, k) => {
      const pockets = s.items.containers[pocketOf(w, s.inmates.length + k)];
      for (const n of guardKit(w, k).slice(1)) {
        if (pockets.some((v) => itemOf(v) === n)) continue;
        const free = pockets.indexOf(0);
        if (free >= 0) pockets[free] = slot(n);
      }
    });
  }

  /**
   * Blows on the player (GDD §10.1): a chasing guard's baton, an angry inmate's fists, at
   * arm's length with a clear line, each at its own pace. The lock lets go of someone out
   * cold, gone too far, or off the player's floor.
   */
  private fight() {
    const s = this.state;
    const p = s.player;
    if (s.lock >= 0) {
      const f = personOf(s, s.lock);
      if (!f || f.ko > 0 || s.layer !== LAYER.GROUND || this.away || dist2(f.body, p) > LOCK_KEEP * LOCK_KEEP) {
        s.lock = -1;
        this.events.push({ type: 'lock', who: -1 });
      }
    }
    if (this.away || s.layer !== LAYER.GROUND) return;
    const defense = itemDef(itemOf(s.items.inv[SLOT.OUTFIT]))?.defense ?? 0;
    for (let id = 0; id < s.inmates.length && !this.away; id++) if (s.inmates[id].angry > 0) this.blow(s.inmates[id], id, INMATE_SWING_STEPS, 0, defense);
    for (let k = 0; k < s.guards.length && !this.away; k++) {
      const g = s.guards[k];
      if (g.mode === GUARD.CHASE && awake(g)) this.blow(g, s.inmates.length + k, GUARD_SWING_STEPS, BATON_ATTACK, defense);
    }
    // Followers fight for the player (GDD §10.3).
    for (const id of s.followers) {
      const m = s.inmates[id];
      const foe = this.allyFoe[id] ?? -1;
      const f = foe >= 0 ? personOf(s, foe) : undefined;
      if (!m || !f || m.ko > 0 || f.ko > 0 || s.step - m.swing < INMATE_SWING_STEPS || dist2(m.body, f.body) > MELEE_REACH * MELEE_REACH) continue;
      if (!lineOfSight(this.world, m.body.x, m.body.z, f.body.x, f.body.z)) continue;
      m.swing = s.step;
      if (m.body.x !== f.body.x || m.body.z !== f.body.z) m.body.facing = faceTo(f.body.x - m.body.x, f.body.z - m.body.z);
      const guard = isGuard(s, foe);
      const dmg = damage(m.str, 0, guard ? GUARD_DEFENSE : INMATE_DEFENSE);
      f.hp = Math.max(0, f.hp - dmg);
      if (guard && (f as Guard).doing === DOING.SLEEP) (f as Guard).doing = DOING.NOTHING;
      this.events.push({ type: 'allyHit', by: id, who: foe, dmg, ko: f.hp === 0 });
      if (f.hp === 0) this.knockOut(foe, m.body);
    }
  }

  /** Someone's blow at the player, if it's their moment and the player is at arm's length with nothing between. */
  private blow(f: Fighter, id: number, pace: number, attack: number, defense: number) {
    const s = this.state;
    const p = s.player;
    if (f.ko > 0 || s.step - f.swing < pace || dist2(f.body, p) > MELEE_REACH * MELEE_REACH) return;
    if (!lineOfSight(this.world, f.body.x, f.body.z, p.x, p.z)) return;
    f.swing = s.step;
    if (f.body.x !== p.x || f.body.z !== p.z) f.body.facing = faceTo(p.x - f.body.x, p.z - f.body.z);
    this.hurt(damage(f.str, attack, defense), id);
  }

  /** The player takes a blow (by Cast id, -1 for the tunnel roof): at 0 health, out cold. */
  private hurt(dmg: number, by: number) {
    const s = this.state;
    s.health = Math.max(0, s.health - dmg);
    if (s.sleeping) {
      s.sleeping = false;
      this.events.push({ type: 'sleep', on: false });
    }
    this.events.push({ type: 'hurt', by, dmg });
    if (s.health > 0) return;
    // Put down by a guard: caught (solitary or the infirmary). By anyone else: the infirmary.
    if (by >= 0 && isGuard(s, by)) this.caught();
    else this.floored();
  }

  /** Knocked out by an inmate or a cave-in: carried to the infirmary (contraband taken, as after a capture). */
  private floored() {
    const s = this.state;
    // In a lockdown (or wanted), the guards pick the player up: as good as caught.
    if (s.lockdown || s.heat >= CHASE_HEAT) {
      this.caught();
      return;
    }
    s.lock = -1;
    this.dismissAll();
    this.endTalk();
    this.stopTraining();
    s.ko = KO_STEPS;
    s.excused = true;
    s.wake = WAKE.FLOORED;
    s.sleeping = false;
    s.player.moving = false;
    for (const m of s.inmates) m.angry = 0;
    this.closeBox();
    this.events.push({ type: 'floored' });
  }

  /**
   * Where the player lands climbing onto the ground floor: the tile meant, or (if a hole or
   * someone is in the way) the nearest free one beside it; -1 if there's none.
   */
  private landing(tile: number): number {
    const w = this.world;
    const bodies = this.bodiesAbout();
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
  private strike(fresh: boolean) {
    const s = this.state;
    const w = this.world;
    const it = s.items;
    const p = s.player;
    const held = itemOf(it.inv[it.hand]);
    const target = toolTarget(w, s.layer, p, held, this.bodiesAbout());
    if (!target) return;
    // Strikes come at their own pace (holding the button asks every step); the rest at a press.
    if (STRIKES.has(target.action) && s.step - s.struckAt < STRIKE_STEPS) return;
    if ((target.action === 'digUp' || !STRIKES.has(target.action)) && !fresh) return;
    if (target.action === 'eat') {
      // Full of energy: the bar keeps for later.
      if (s.energy >= 100) {
        this.events.push({ type: 'cantStrike', why: 'full', action: 'eat' });
        return;
      }
      it.inv[it.hand] = 0;
      it.rev++;
      s.energy = Math.min(100, s.energy + CHOCOLATE_ENERGY);
      this.events.push({ type: 'ate', item: held });
      return;
    }
    if (!STRIKES.has(target.action)) {
      this.putInPlace(target, held);
      return;
    }
    if (target.action === 'sharpen') {
      this.sharpen(target);
      return;
    }
    const key = placeKey(target.layer, target.tile);
    const tool0 = itemDef(held).tool;
    // The last blow on the ground floor with full pockets would leave the chunk or the dirt at
    // the player's feet, in plain view: not until there's room.
    const yields = target.action === 'chip' || (target.action === 'dig' && target.layer === LAYER.GROUND);
    const full = yields && s.layer === LAYER.GROUND && !!tool0 && (s.wear[key] ?? 0) + tool0.damage >= target.hp && !hasRoom(it);
    const why = target.hp === 0 ? 'reinforced' : !target.fits ? 'tool' : s.energy < tool0!.energy ? 'tired' : full ? 'full' : null;
    if (why) {
      this.events.push({ type: 'cantStrike', why, action: target.action });
      return;
    }
    const tool = tool0!;
    s.struckAt = s.step;
    s.energy -= tool.energy;
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
      this.events.push({ type: 'broke', item: held });
    } else it.inv[it.hand] = slot(held, left);
    // A live fence: knocked flat (GDD §9.1).
    if (target.action === 'cut' && w.ground.kind[target.tile] === TILE.ELECTRIC && this.power) {
      s.lock = -1;
      this.dismissAll();
      this.endTalk();
      s.ko = KO_STEPS;
      s.wake = WAKE.INFIRMARY;
      s.sleeping = false;
      this.closeBox();
      this.events.push({ type: 'shocked' });
      return;
    }
    const taken = (s.wear[key] ?? 0) + tool.damage;
    if (taken < target.hp) {
      s.wear[key] = taken;
      this.wearRev++;
      this.events.push({ type: 'strike', action: target.action, layer: target.layer, tile: target.tile, broke: false });
      return;
    }
    const t = target.tile;
    switch (target.action) {
      case 'chip':
        this.setTile(LAYER.GROUND, t, TILE.HOLE);
        give(it, WALL_CHUNK, p, s.layer);
        break;
      case 'cut':
        this.setTile(LAYER.GROUND, t, TILE.FENCE_CUT);
        break;
      case 'unscrew':
        this.setTile(LAYER.VENTS, t, TILE.GRATE_OPEN);
        break;
      case 'dig':
        if (target.layer === LAYER.GROUND) {
          this.setTile(LAYER.GROUND, t, TILE.SHAFT);
          if (w.layers[LAYER.UNDER].kind[t] === TILE.SOIL) this.setTile(LAYER.UNDER, t, TILE.TUNNEL);
        } else {
          this.setTile(LAYER.UNDER, t, TILE.TUNNEL);
          // Too long a stretch without a brace: the roof comes down (GDD §9.2).
          if (cavesIn(w, t)) {
            this.setTile(LAYER.UNDER, t, TILE.SOIL);
            this.events.push({ type: 'caveIn', tile: t });
            this.hurt(CAVE_IN_DAMAGE, -1);
            return;
          }
        }
        give(it, DIRT, p, s.layer);
        break;
      case 'digUp': {
        this.setTile(LAYER.GROUND, t, TILE.SHAFT);
        give(it, DIRT, p, s.layer);
        this.events.push({ type: 'strike', action: target.action, layer: target.layer, tile: t, broke: true });
        // Out through the new hole.
        const out = this.landing(besideOnGround(w, t, this.bodiesAbout()));
        if (out >= 0) this.moveTo(LAYER.GROUND, out, 'digUp');
        return;
      }
    }
    this.events.push({ type: 'strike', action: target.action, layer: target.layer, tile: t, broke: true });
  }

  /**
   * A comb or toothbrush rubbed on a wall (GDD §7.3 shivs): a stroke at a strike's pace, and
   * after a few the shiv. The strokes so far ride in the item's slot (as uses do).
   */
  private sharpen(target: ToolTarget) {
    const s = this.state;
    const it = s.items;
    const p = s.player;
    const v = it.inv[it.hand];
    const item = itemOf(v);
    s.struckAt = s.step;
    p.moving = false;
    const dx = (target.tile % MAP_W) * UNIT + UNIT / 2 - p.x;
    const dz = Math.floor(target.tile / MAP_W) * UNIT + UNIT / 2 - p.z;
    if (dx || dz) p.facing = faceTo(dx, dz);
    const strokes = usesOf(v) + 1;
    it.rev++;
    if (strokes < SHARPEN_STROKES) {
      it.inv[it.hand] = slot(item, strokes);
      this.events.push({ type: 'strike', action: 'sharpen', layer: LAYER.GROUND, tile: target.tile, broke: false });
      return;
    }
    const shiv = SHIVS.get(item)!;
    it.inv[it.hand] = slot(shiv);
    this.events.push({ type: 'strike', action: 'sharpen', layer: LAYER.GROUND, tile: target.tile, broke: true }, { type: 'sharpened', item: shiv });
  }

  /**
   * The item in hand put to use on the structure (GDD §9.2–9.3): a cover over damage, a
   * brace in the tunnel, a sheet rope down off a roof. One press each.
   */
  private putInPlace(target: ToolTarget, held: number) {
    const s = this.state;
    const it = s.items;
    const t = target.tile;
    if (!target.fits) {
      this.events.push({ type: 'cantStrike', why: 'poster', action: target.action });
      return;
    }
    it.inv[it.hand] = 0;
    it.rev++;
    switch (target.action) {
      case 'cover':
        if (target.layer === LAYER.VENTS) this.setTile(LAYER.VENTS, t, TILE.GRATE_FAKE);
        else this.setTile(LAYER.GROUND, t, this.world.ground.kind[t] === TILE.FENCE_CUT ? TILE.FENCE_FAKE : held === POSTER_ITEM ? TILE.HOLE_POSTER : TILE.HOLE_FAKE);
        this.events.push({ type: 'covered', item: held, on: true });
        break;
      case 'brace':
        this.setTile(LAYER.UNDER, t, TILE.BRACED);
        this.events.push({ type: 'braced' });
        break;
      case 'rope': {
        const to = this.landing(t);
        if (to < 0) {
          it.inv[it.hand] = slot(held);
          this.events.push({ type: 'cantStrike', why: 'noLanding', action: 'rope' });
          return;
        }
        this.moveTo(LAYER.GROUND, to, 'rope');
        break;
      }
    }
  }

  /** Climbing, and covers taken off (the action button on the structure). */
  private climb(c: ClimbTarget) {
    const s = this.state;
    const it = s.items;
    const p = s.player;
    switch (c.action) {
      case 'uncover': {
        const grate = this.world.layers[LAYER.VENTS].kind[c.tile] === TILE.GRATE_FAKE;
        // The cover comes back into the hand: never dropped at the player's feet.
        if (!hasRoom(it)) {
          this.events.push({ type: 'full' });
          return;
        }
        give(it, c.item!, p, s.layer);
        if (grate) this.setTile(LAYER.VENTS, c.tile, TILE.GRATE_OPEN);
        else this.setTile(LAYER.GROUND, c.tile, this.world.ground.kind[c.tile] === TILE.FENCE_FAKE ? TILE.FENCE_CUT : TILE.HOLE);
        this.events.push({ type: 'covered', item: c.item!, on: false });
        return;
      }
    }
    // Climbing out of the tunnel under the desk: beside the desk. Onto the ground floor, never
    // onto a hole or into someone.
    const want = c.toTile === -2 ? placesOf(this.world).deskside[1] : c.toTile;
    const to = c.toLayer === LAYER.GROUND ? this.landing(want) : want;
    if (to < 0) return;
    this.moveTo(c.toLayer, to, c.action);
  }

  /** Down the tunnel under the player's desk (from its open panel). */
  private underDesk() {
    const it = this.state.items;
    const box = containersOf(this.world)[it.open];
    if (!box?.mine || box.prop.kind !== 'desk') return;
    const tile = box.prop.z * MAP_W + box.prop.x;
    if (this.world.ground.kind[tile] !== TILE.SHAFT) return;
    this.moveTo(LAYER.UNDER, tile, 'climbDown');
    this.state.deskAside = true;
  }

  /** Onto a layer, in the middle of a tile. */
  private moveTo(layer: number, tile: number, how: ClimbAction | 'digUp' | 'rope') {
    const s = this.state;
    const from = s.layer;
    this.closeBox();
    s.layer = layer;
    // Back on the ground floor, the desk is slid back over its hole.
    if (layer === LAYER.GROUND) s.deskAside = false;
    s.player.x = (tile % MAP_W) * UNIT + UNIT / 2;
    s.player.z = Math.floor(tile / MAP_W) * UNIT + UNIT / 2;
    s.player.moving = false;
    this.events.push({ type: 'layer', layer, from, how });
  }

  /** Dirt (or a chunk of wall) down a toilet: three loads an hour, then it's clogged for an hour (GDD §9.2). */
  private flush(index: number) {
    const s = this.state;
    const it = s.items;
    const t = (s.toilets[index] ??= [0, s.step]);
    if (s.step - t[1] >= TOILET_CLOG_STEPS) {
      t[0] = 0;
      t[1] = s.step;
    }
    if (t[0] >= TOILET_LOADS) {
      this.events.push({ type: 'clogged' });
      return;
    }
    const item = itemOf(it.inv[it.hand]);
    it.inv[it.hand] = 0;
    if (t[0] === 0) t[1] = s.step;
    // The third load clogs it: an hour from now it takes dirt again.
    if (++t[0] >= TOILET_LOADS) t[1] = s.step;
    this.events.push({ type: 'flushed', item });
  }

  /** Into bed: the player lies down beside it (the view puts them in it). */
  private sleep() {
    const s = this.state;
    const t = placesOf(this.world).bedside[1];
    if (t < 0) return;
    s.player.x = (t % MAP_W) * UNIT + UNIT / 2;
    s.player.z = Math.floor(t / MAP_W) * UNIT + UNIT / 2;
    s.player.moving = false;
    s.sleeping = true;
    this.closeBox();
    this.endTalk();
    this.stopTraining();
    this.events.push({ type: 'sleep', on: true });
  }

  // ---------------------------------------------------------------- jobs (GDD §11)

  /** The day of the game (1 on the first). */
  get today(): number {
    return clockAt(this.state.step).day;
  }

  /** The player's job (index into def.jobs), -1 for none. */
  get playerJob(): number {
    return this.state.jobs.indexOf(HOLDER.PLAYER);
  }

  /** The player's job if it counts today (one taken after the Work Period began starts tomorrow), else -1. */
  jobActive(): number {
    const job = this.playerJob;
    return job >= 0 && this.state.jobDay <= this.today ? job : -1;
  }

  /** On the clock: the Work Period, the job counting today, the quota still to do, the player about. */
  get onDuty(): boolean {
    const s = this.state;
    return ROUTINE[s.routine].id === 'work' && this.jobActive() >= 0 && !s.paid && !s.lockdown && !this.away;
  }

  private readonly workState: WorkState = { job: -1, onDuty: false, machines: {}, puddles: [], step: 0, inv: [], hand: 0 };
  /** What the player's job lets the action button do here (null: the usual). */
  station(): Station | null {
    const s = this.state;
    const ws = this.workState;
    ws.job = this.jobActive();
    ws.onDuty = this.onDuty;
    ws.machines = s.machines;
    ws.puddles = s.puddles;
    ws.step = s.step;
    ws.inv = s.items.inv;
    ws.hand = s.items.hand;
    return stationTarget(this.world, ws, s.player);
  }

  /** A step of the job at a station: take, load, unload, put, sort, mop. */
  private work(st: Station) {
    const s = this.state;
    const it = s.items;
    const room = jobRooms(this.world)[this.jobActive()];
    const def = room.def;
    const free = () => it.inv.slice(0, HOTBAR).indexOf(0);
    /** One of an item off the hotbar (the one in hand first). */
    const takeOne = (item: number) => {
      const k = itemOf(it.inv[it.hand]) === item ? it.hand : it.inv.slice(0, HOTBAR).findIndex((v) => itemOf(v) === item);
      if (k >= 0) it.inv[k] = 0;
      return k >= 0;
    };
    this.stopTraining();
    const prop = this.world.props[st.prop];
    if (prop) s.player.facing = faceTo((prop.x + prop.w / 2) * UNIT - s.player.x, (prop.z + prop.d / 2) * UNIT - s.player.z) || s.player.facing;
    switch (st.act) {
      case 'full':
        this.events.push({ type: 'full' });
        return;
      case 'running':
        break;
      case 'take':
        it.inv[free()] = slot(st.item);
        break;
      case 'load':
        if (!takeOne(st.item)) return;
        s.machines[st.prop] = s.step + (def.cycle ?? 3) * STEPS_PER_SECOND;
        break;
      case 'sort':
        s.machines[st.prop] = s.step + (def.cycle ?? 3) * STEPS_PER_SECOND;
        break;
      case 'unload': {
        delete s.machines[st.prop];
        // A letter is addressed to the next inmate on today's round who has none in the bag yet.
        let v = slot(st.item);
        if (def.flow === 'mail') {
          const carried = it.inv.filter((x) => itemOf(x) === st.item).map((x) => usesOf(x) - 1);
          const to = s.mail.find((id) => !carried.includes(id));
          if (to === undefined) return;
          v = slot(st.item, to + 1);
        }
        it.inv[free()] = v;
        break;
      }
      case 'put':
        if (!takeOne(st.item)) return;
        this.quotaUp();
        break;
      case 'mop':
        s.puddles.splice(s.puddles.indexOf(st.tile), 1);
        this.quotaUp();
        break;
    }
    it.rev++;
    this.events.push({ type: 'work', act: st.act, item: st.item, prop: st.prop });
  }

  /** One more toward the day's quota; done, the wage is paid there and then. */
  private quotaUp() {
    const s = this.state;
    const def = jobRooms(this.world)[this.jobActive()].def;
    s.quota++;
    this.events.push({ type: 'quota', n: s.quota, of: def.quota });
    if (s.quota < def.quota || s.paid) return;
    s.paid = true;
    s.cash += def.wage;
    this.events.push({ type: 'cash', n: def.wage, why: 'wage' });
  }

  /** 12:00: the janitor's puddles appear in the corridors, the mailman's round is drawn; inmates head to work. */
  private startWork() {
    const s = this.state;
    const w = this.world;
    for (const m of s.inmates) m.shift = 0;
    s.puddles = [];
    s.mail = [];
    const job = this.jobActive();
    if (job < 0) return;
    const def = jobRooms(w)[job].def;
    if (def.flow === 'mop') {
      const floor = placesOf(w).floor[zoneIndex('corridor')] ?? [];
      for (let k = 0; k < def.quota && s.puddles.length < floor.length; k++) {
        let t = floor[randomInt(s, floor.length)];
        while (s.puddles.includes(t)) t = floor[randomInt(s, floor.length)];
        s.puddles.push(t);
      }
    }
    if (def.flow === 'mail') {
      const ids = s.inmates.map((_, i) => i);
      for (let k = 0; k < def.quota && ids.length; k++) s.mail.push(ids.splice(randomInt(s, ids.length), 1)[0]);
    }
  }

  /** 15:00: a quota not met costs the job (GDD §2.2), and so does missing work (inmates); the job's things go back. */
  private settleWork() {
    const s = this.state;
    const it = s.items;
    const job = this.jobActive();
    if (job >= 0 && !s.paid) this.vacate(job, HOLDER.PLAYER, 'fired');
    for (let k = 0; k < HOTBAR; k++) if (it.inv[k] && WORK_ITEMS.includes(itemDef(itemOf(it.inv[k])).id)) it.inv[k] = 0;
    it.rev++;
    s.machines = {};
    s.puddles = [];
    s.mail = [];
    // Inmates who never turned up, or were knocked out on the job, lose theirs (GDD §11: sabotage).
    s.jobs.forEach((who, j) => {
      if (who >= 0 && s.inmates[who]?.shift !== 1) this.vacate(j, who, 'fired');
    });
  }

  /** A job left open (by whoever held it). */
  private vacate(job: number, who: number, change: 'fired' | 'quit') {
    const s = this.state;
    s.jobs[job] = HOLDER.NOBODY;
    s.jobOpen[job] = this.today;
    this.events.push({ type: 'job', job, who, change });
  }

  /** During the Work Period, inmates with a job check in on reaching its room. */
  private clockIn() {
    const s = this.state;
    if (ROUTINE[s.routine].id !== 'work') return;
    const rooms = jobRooms(this.world);
    s.jobs.forEach((who, j) => {
      const m = who >= 0 ? s.inmates[who] : undefined;
      if (!m || m.shift !== 0 || m.ko > 0) return;
      const t = tileOfBody(m.body);
      if (this.world.ground.zone[t.z * MAP_W + t.x] === rooms[j].zone) m.shift = 1;
    });
  }

  /**
   * 08:00, a new day: the quota starts again; attributes left untrained yesterday slip a point
   * (GDD §3.2); change turns up in desks and pockets; merchants restock; new favors; jobs left
   * open long enough are taken by inmates.
   */
  private newDay() {
    const s = this.state;
    s.quota = 0;
    s.paid = false;
    const slipped: Attr[] = [];
    ATTRS.forEach((a, k) => {
      if ((s.trained >> k) & 1 || this.attr(a) <= ATTR_START) return;
      this.setAttr(a, this.attr(a) - 1);
      slipped.push(a);
    });
    s.trained = 0;
    if (slipped.length) this.events.push({ type: 'decay', attrs: slipped });
    this.spreadCoins();
    for (const shop of s.shops) stockSlots('merchant', 0, shop, s);
    this.offerFavors();
    const today = this.today;
    s.jobs.forEach((who, j) => {
      if (who !== HOLDER.NOBODY || today - s.jobOpen[j] < VACANCY_DAYS) return;
      const free = s.inmates.map((_, i) => i).filter((i) => !s.jobs.includes(i) && !s.followers.includes(i));
      if (!free.length) return;
      const id = free[randomInt(s, free.length)];
      s.jobs[j] = id;
      this.events.push({ type: 'job', job: j, who: id, change: 'hired' });
    });
  }

  /** The job board (GDD §11): apply for an open job (a = job + 1), or quit (a = 0). Only at the board. */
  private jobOp(a: number) {
    const s = this.state;
    const w = this.world;
    if (nearestProp(w, s.player, (p) => p.kind === 'jobBoard', STATION_REACH + UNIT / 4) < 0) return;
    const held = this.playerJob;
    if (a === 0) {
      if (held >= 0) this.vacate(held, HOLDER.PLAYER, 'quit');
      return;
    }
    const job = a - 1;
    const room = jobRooms(w)[job];
    if (!room || job === held) return;
    if (s.jobs[job] !== HOLDER.NOBODY) return this.refuse('taken');
    if (s.items.int < room.def.int) return this.refuse('int');
    if (held >= 0) this.vacate(held, HOLDER.PLAYER, 'quit');
    s.jobs[job] = HOLDER.PLAYER;
    // Taken once the Work Period has begun: it counts from tomorrow.
    s.jobDay = clockAt(s.step).minuteOfDay >= ROUTINE.find((r) => r.id === 'work')!.start ? this.today + 1 : this.today;
    s.quota = 0;
    s.paid = false;
    this.events.push({ type: 'job', job, who: HOLDER.PLAYER, change: 'hired' });
  }

  private refuse(why: Refusal) {
    this.events.push({ type: 'refused', why });
  }

  // ---------------------------------------------------------------- cash (GDD §3.1)

  /** 08:00: small change in some inmates' desks and pockets (never the player's things). */
  private spreadCoins() {
    const s = this.state;
    const w = this.world;
    containersOf(w).forEach((c, i) => {
      if (c.table === 'inmateDesk' && randomInt(s, 5) < 2) s.coins[i] = (s.coins[i] ?? 0) + 1 + randomInt(s, 8);
    });
    for (let k = 0; k < s.inmates.length; k++) if (randomInt(s, 2) === 0) s.coins[pocketOf(w, k)] = (s.coins[pocketOf(w, k)] ?? 0) + 1 + randomInt(s, 6);
  }

  /** Opening a desk or someone's pockets: the change in it is the player's. */
  private takeCoins(index: number) {
    const s = this.state;
    const n = s.coins[index];
    if (!n) return;
    delete s.coins[index];
    s.cash += n;
    this.events.push({ type: 'cash', n, why: 'loot' });
  }

  // ---------------------------------------------------------------- training (GDD §3.2)

  attr(a: Attr): number {
    const s = this.state;
    return a === 'str' ? s.str : a === 'spd' ? s.spd : s.items.int;
  }

  private setAttr(a: Attr, v: number) {
    const s = this.state;
    if (a === 'str') s.str = v;
    else if (a === 'spd') s.spd = v;
    else {
      s.items.int = v;
      s.items.rev++;
    }
  }

  /** What a prop trains: the weights Strength, the treadmill Speed, a library shelf Intellect. */
  trainsOn(prop: number): Attr | null {
    const kind = this.world.props[prop]?.kind;
    return kind === 'weights' ? 'str' : kind === 'treadmill' ? 'spd' : kind === 'shelf' ? 'int' : null;
  }

  /** On the equipment: the set's bar starts empty. Too tired (under 10% energy), nothing doing. */
  private startTraining(prop: number, use: FixtureUse | 'study') {
    const s = this.state;
    const a = this.trainsOn(prop);
    if (!a) return;
    if (s.energy < TIRED) {
      this.events.push({ type: 'cantTrain', why: 'tired' });
      return;
    }
    if (this.attr(a) >= ATTR_MAX) {
      this.events.push({ type: 'cantTrain', why: 'max' });
      return;
    }
    this.endTalk();
    this.closeBox();
    const p = this.world.props[prop];
    s.player.moving = false;
    s.player.facing = faceTo((p.x + p.w / 2) * UNIT - s.player.x, (p.z + p.d / 2) * UNIT - s.player.z) || s.player.facing;
    s.train = prop;
    s.reps = 0;
    s.repSide = 0;
    this.events.push({ type: 'train', on: true, use });
  }

  /** Studying at the library shelf whose panel is open. */
  private study() {
    const s = this.state;
    const box = containersOf(this.world)[s.items.open];
    if (!box || box.prop.kind !== 'shelf' || this.world.zoneAt(box.prop.x, box.prop.z) !== 'library') return;
    this.startTraining(this.world.props.indexOf(box.prop), 'study');
  }

  /** A press: only one on the other side from the last counts. A full bar is a set: +2, and the energy it costs. */
  private rep(side: number) {
    const s = this.state;
    if (s.train < 0 || side === s.repSide) return;
    s.repSide = side;
    s.reps = Math.min(100, s.reps + REP_GAIN);
    this.events.push({ type: 'rep' });
    if (s.reps < 100) return;
    const a = this.trainsOn(s.train)!;
    s.reps = 0;
    this.setAttr(a, Math.min(ATTR_MAX, this.attr(a) + TRAIN_GAIN));
    s.trained |= 1 << ATTRS.indexOf(a);
    s.energy = Math.max(0, s.energy - (a === 'int' ? STUDY_ENERGY : GYM_ENERGY));
    this.events.push({ type: 'trained', attr: a, value: this.attr(a) });
    // Spent, or as good as it gets: off the equipment.
    if (s.energy < TIRED || this.attr(a) >= ATTR_MAX) {
      this.events.push({ type: 'cantTrain', why: s.energy < TIRED ? 'tired' : 'max' });
      this.stopTraining();
    }
  }

  /** Each step on the equipment: the bar drains; a lockdown, a knockout or a blow ends it. */
  private keepTraining() {
    const s = this.state;
    if (s.train < 0) return;
    if (this.away || s.lockdown || s.sleeping || s.layer !== LAYER.GROUND) {
      this.stopTraining();
      return;
    }
    if (s.reps > 0 && s.step % REP_DRAIN_STEPS === 0) s.reps--;
  }

  private stopTraining() {
    const s = this.state;
    if (s.train < 0) return;
    const use = this.world.props[s.train].kind;
    s.train = -1;
    s.reps = 0;
    s.repSide = 0;
    this.events.push({ type: 'train', on: false, use: use === 'shelf' ? 'study' : (use as FixtureUse) });
  }

  // ---------------------------------------------------------------- inmates (GDD §10.3–10.4)

  /** A merchant's place in def.merchants (and s.shops), -1 if the inmate isn't one. */
  merchantOf(who: number): number {
    const m = this.state.inmates[who];
    return m ? this.world.def.merchants.indexOf(m.cell) : -1;
  }

  /** Merchants deal during free time (GDD §10.3). */
  get shopsOpen(): boolean {
    const id = ROUTINE[this.state.routine].id;
    return (id === 'freeTime' || id === 'eveningFreeTime') && !this.state.lockdown;
  }

  /** Walking up to an inmate: their letter if the player carries it (the mail round), else a talk. */
  private approach(who: number) {
    const s = this.state;
    const it = s.items;
    const letter = itemNumber('letter');
    const k = it.inv.slice(0, HOTBAR).findIndex((v) => itemOf(v) === letter && usesOf(v) - 1 === who);
    if (k >= 0 && this.onDuty && s.mail.includes(who)) {
      it.inv[k] = 0;
      it.rev++;
      s.mail.splice(s.mail.indexOf(who), 1);
      this.events.push({ type: 'delivered', who });
      this.quotaUp();
      return;
    }
    this.stopTraining();
    this.closeBox();
    if (s.talk !== who) {
      s.talk = who;
      this.events.push({ type: 'talk', who });
    }
  }

  /** Whether the player can go on talking to an inmate: up, calm, close, nothing between. */
  private talkable(who: number): boolean {
    const s = this.state;
    const m = s.inmates[who];
    if (!m || m.ko > 0 || m.angry > 0 || this.away || s.layer !== LAYER.GROUND) return false;
    const p = s.player;
    return Math.max(Math.abs(m.body.x - p.x), Math.abs(m.body.z - p.z)) <= TALK_REACH + UNIT / 4 && lineOfSight(this.world, p.x, p.z, m.body.x, m.body.z);
  }

  private keepTalk() {
    if (this.state.talk >= 0 && !this.talkable(this.state.talk)) this.endTalk();
  }

  private endTalk() {
    const s = this.state;
    if (s.talk < 0) return;
    s.talk = -1;
    this.events.push({ type: 'talk', who: -1 });
  }

  /** Opinion of the player goes up or down (0–100). */
  private changeOpinion(who: number, by: number) {
    const m = this.state.inmates[who];
    if (!m || !by) return;
    const was = m.opinion;
    m.opinion = Math.max(0, Math.min(100, m.opinion + by));
    if (m.opinion !== was) this.events.push({ type: 'opinion', who, by: m.opinion - was });
  }

  /** What the player asks of the inmate they're talking to (OP.TALK). */
  private talkOp(a: number, b: number) {
    const s = this.state;
    const it = s.items;
    const who = s.talk;
    if (who < 0 || !this.talkable(who)) return;
    const m = s.inmates[who];
    const free = it.inv.slice(0, HOTBAR).indexOf(0);
    it.rev++;
    switch (a) {
      case TALK.BUY: {
        const shop = s.shops[this.merchantOf(who)];
        const v = shop?.[b];
        if (!v) return;
        if (!this.shopsOpen) return this.refuse('closed');
        if (m.opinion <= OPINION_LOW) return this.refuse('grudge');
        const item = itemOf(v);
        const price = priceOf(itemDef(item).value, m.opinion);
        if (s.cash < price) return this.refuse('cash');
        if (free < 0) return this.refuse('room');
        shop[b] = 0;
        it.inv[free] = v;
        s.cash -= price;
        this.events.push({ type: 'bought', who, item, price }, { type: 'cash', n: -price, why: 'buy' });
        this.changeOpinion(who, BUY_OPINION);
        return;
      }
      case TALK.GIFT: {
        const v = b < HOTBAR ? it.inv[b] : 0;
        if (!v) return;
        const item = itemOf(v);
        if (itemDef(item).value <= 0) return this.refuse('worthless');
        it.inv[b] = 0;
        this.events.push({ type: 'gift', who, item, cash: 0 });
        this.changeOpinion(who, giftOpinion(itemDef(item).value));
        return;
      }
      case TALK.GIFT_CASH:
        if (!CASH_GIFTS.includes(b)) return;
        if (s.cash < b) return this.refuse('cash');
        s.cash -= b;
        this.events.push({ type: 'gift', who, item: 0, cash: b }, { type: 'cash', n: -b, why: 'gift' });
        this.changeOpinion(who, cashOpinion(b));
        return;
      case TALK.ACCEPT: {
        const f = s.favors.find((x) => x.by === who && x.state === FAVOR_STATE.OFFERED);
        if (!f) return;
        if (s.favors.filter((x) => x.state !== FAVOR_STATE.OFFERED).length >= FAVORS_TAKEN) return this.refuse('favors');
        f.state = FAVOR_STATE.TAKEN;
        // The stolen thing is in the thief's pockets from now on.
        if (f.kind === FAVOR.RETRIEVE) {
          const pockets = it.containers[pocketOf(this.world, f.target)];
          const k = pockets.indexOf(0);
          pockets[k >= 0 ? k : pockets.length - 1] = slot(f.item);
        }
        this.events.push({ type: 'favor', who, kind: f.kind, state: 'taken' });
        return;
      }
      case TALK.HAND_IN: {
        const f = s.favors.find((x) => x.by === who && x.state !== FAVOR_STATE.OFFERED);
        if (!f) return;
        if (f.kind === FAVOR.SCAVENGE || f.kind === FAVOR.RETRIEVE) {
          const k = it.inv.slice(0, HOTBAR).findIndex((v) => itemOf(v) === f.item);
          if (k < 0) return this.refuse('missing');
          it.inv[k] = 0;
        } else if (f.state !== FAVOR_STATE.DONE) return this.refuse('notDone');
        s.favors.splice(s.favors.indexOf(f), 1);
        s.cash += f.reward;
        this.events.push({ type: 'favor', who, kind: f.kind, state: 'paid' }, { type: 'cash', n: f.reward, why: 'favor' });
        this.changeOpinion(who, FAVOR_OPINION);
        return;
      }
      case TALK.RECRUIT:
        if (s.followers.includes(who)) return;
        if (m.opinion < OPINION_HIGH) return this.refuse('opinion');
        if (s.followers.length >= MAX_FOLLOWERS) return this.refuse('followers');
        s.followers.push(who);
        this.events.push({ type: 'recruit', who, on: true });
        return;
      case TALK.DISMISS:
        this.dismiss(who);
        return;
    }
  }

  private dismiss(who: number) {
    const s = this.state;
    const k = s.followers.indexOf(who);
    if (k < 0) return;
    s.followers.splice(k, 1);
    this.events.push({ type: 'recruit', who, on: false });
  }

  /** Every follower leaves (Lights Out, the player caught or floored). */
  private dismissAll() {
    for (const id of [...this.state.followers]) this.dismiss(id);
  }

  /**
   * 08:00 (and day 1): offers not taken up lapse, and inmates with nothing asked yet offer new
   * favors (GDD §10.4), up to FAVOR_OFFERS at a time: $20–50 each.
   */
  private offerFavors() {
    const s = this.state;
    s.favors = s.favors.filter((f) => f.state !== FAVOR_STATE.OFFERED);
    const n = s.inmates.length;
    for (let tries = 0; tries < n * 2 && s.favors.filter((f) => f.state === FAVOR_STATE.OFFERED).length < FAVOR_OFFERS; tries++) {
      const by = randomInt(s, n);
      if (s.favors.some((f) => f.by === by) || s.followers.includes(by)) continue;
      const kind = randomInt(s, 4);
      let target = -1;
      if (kind === FAVOR.RETRIEVE || kind === FAVOR.BEATDOWN) {
        target = randomInt(s, n - 1);
        if (target >= by) target++;
      }
      const item = kind === FAVOR.SCAVENGE || kind === FAVOR.RETRIEVE ? itemNumber(FAVOR_ITEMS[randomInt(s, FAVOR_ITEMS.length)]) : 0;
      s.favors.push({ by, kind, item, target, reward: 20 + randomInt(s, 31), state: FAVOR_STATE.OFFERED });
      this.events.push({ type: 'favor', who: by, kind, state: 'offered' });
    }
  }

  /** A favor done (it's handed in next time they talk). */
  private favorDone(f: Favor) {
    f.state = FAVOR_STATE.DONE;
    this.events.push({ type: 'favor', who: f.by, kind: f.kind, state: 'done' });
  }

  /**
   * An inmate with a grudge (opinion 25 or less) may jump the player at a meal or in the
   * showers (GDD §10.3): close by, in the same room, now and then.
   */
  private grudges() {
    const s = this.state;
    const id = ROUTINE[s.routine].id;
    if ((id !== 'breakfast' && id !== 'dinner' && id !== 'showers') || this.away || s.layer !== LAYER.GROUND || s.lockdown) return;
    const p = s.player;
    const zone = this.playerZone;
    if (!ROUTINE[s.routine].zones.includes(zone)) return;
    s.inmates.forEach((m, who) => {
      if (m.opinion > OPINION_LOW || m.angry > 0 || m.ko > 0 || s.followers.includes(who)) return;
      if (dist2(m.body, p) > AMBUSH_RANGE * AMBUSH_RANGE || inmateZone(this.world, m) !== zone) return;
      if (!lineOfSight(this.world, m.body.x, m.body.z, p.x, p.z) || randomInt(s, AMBUSH_ODDS) !== 0) return;
      m.angry = ANGRY_STEPS;
      m.doing = DOING.NOTHING;
      m.wait = 0;
      if (s.talk === who) this.endTalk();
      this.events.push({ type: 'ambush', who });
    });
  }

  /** Who each follower goes after this step (a foe of the player's, else the player), and every inmate's job room. */
  private readonly social: Social & { follow: Array<Body | null>; gap: number[]; work: number[] } = { follow: [], gap: [], talk: -1, work: [] };
  /** The foe each follower is after (Cast id, -1 none). */
  private readonly allyFoe: number[] = [];
  private socialNow(): Social {
    const s = this.state;
    const so = this.social;
    const n = s.inmates.length;
    so.follow.length = so.gap.length = so.work.length = this.allyFoe.length = n;
    so.follow.fill(null);
    so.gap.fill(0);
    so.work.fill(-1);
    this.allyFoe.fill(-1);
    so.talk = s.talk;
    const rooms = jobRooms(this.world);
    s.jobs.forEach((who, j) => {
      if (who >= 0 && who < n) so.work[who] = rooms[j].zone;
    });
    const about = s.layer === LAYER.GROUND && !this.away;
    if (!about) return so;
    for (const id of s.followers) {
      const m = s.inmates[id];
      if (!m || m.ko > 0) continue;
      const foe = this.foeOf(m);
      this.allyFoe[id] = foe;
      so.follow[id] = foe >= 0 ? personOf(s, foe)!.body : s.player;
      so.gap[id] = foe >= 0 ? STAND_OFF : FOLLOW_GAP;
    }
    return so;
  }

  /** The nearest one coming for the player that a follower can see: a chasing guard, an angry inmate (-1 none). */
  private foeOf(m: Inmate): number {
    const s = this.state;
    let best = -1;
    let bestD = GUARD_RANGE * GUARD_RANGE;
    const consider = (id: number, f: Fighter) => {
      const d = dist2(f.body, m.body);
      if (f.ko > 0 || d > bestD || !lineOfSight(this.world, m.body.x, m.body.z, f.body.x, f.body.z)) return;
      bestD = d;
      best = id;
    };
    s.inmates.forEach((o, id) => {
      if (o !== m && o.angry > 0 && !s.followers.includes(id)) consider(id, o);
    });
    s.guards.forEach((g, k) => {
      if (g.mode === GUARD.CHASE && awake(g)) consider(s.inmates.length + k, g);
    });
    return best;
  }

  /** Heat; at 100% the sirens go: a lockdown, every guard hunting the player (GDD §3.1). */
  private addHeat(n: number) {
    const s = this.state;
    if (this.away) return;
    s.heat = Math.min(100, s.heat + n);
    if (s.heat >= 100 && !s.lockdown) {
      s.lockdown = true;
      s.excused = true;
      this.events.push({ type: 'lockdown', on: true });
    }
  }

  /** Whether cells lock now: Lights Out or a lockdown. */
  get cellsLocked(): boolean {
    return this.state.lockdown || ROUTINE[this.state.routine].id === 'lightsOut';
  }

  /**
   * Cell doors are locked while cells are, except for a cell whose occupant is still out
   * (the door waits for them), a cell with a visitor in it (nobody is locked in someone
   * else's cell) and a door someone stands in (it never shuts on anyone).
   */
  private updateDoors(announce: boolean) {
    const s = this.state;
    const w = this.world;
    // Job rooms (GDD §11): open for the Work Period, and to let out whoever is still inside.
    let rooms = 0;
    if (ROUTINE[s.routine].id === 'work' && !s.lockdown) for (const r of jobRooms(w)) rooms |= 1 << r.zone;
    // Someone in a job room, or in its doorway, keeps its door open.
    const zoneBit = (b: Body) => {
      const i = Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);
      return 1 << (w.doorRoom[i] || w.ground.zone[i]);
    };
    if (s.layer === LAYER.GROUND) rooms |= zoneBit(s.player);
    for (const m of s.inmates) rooms |= zoneBit(m.body);
    w.setOpenRooms(rooms);
    let mask = 0;
    if (this.cellsLocked) {
      const bodies = s.layer === LAYER.GROUND ? [s.player, ...s.inmates.map((m) => m.body)] : s.inmates.map((m) => m.body);
      const occupant = (c: number) => (c === 1 ? s.player : s.inmates.find((m) => m.cell === c)?.body);
      const cellOfBody = (b: Body) => {
        const t = tileOfBody(b);
        return w.cellOf[t.z * MAP_W + t.x];
      };
      for (let c = 1; c < w.cellDoor.length; c++) {
        const b = occupant(c);
        const door = w.cellDoor[c];
        if (!b || cellOfBody(b) !== c || door < 0) continue;
        if (bodies.some((o) => o !== b && cellOfBody(o) === c) || bodies.some((o) => overlaps(o, door))) continue;
        mask |= 1 << c;
      }
    }
    const was = w.lockedCells;
    w.setLockedCells(mask);
    // The player hears their own door lock and unlock.
    if (announce && ((was ^ mask) & 2) !== 0) this.events.push({ type: 'cells', locked: (mask & 2) !== 0 });
  }

  /** The zone the player stands in (off the ground floor: the tunnels, the vents, the roof). */
  get playerZone() {
    const l = this.state.layer;
    if (l === LAYER.UNDER) return 'tunnels';
    if (l === LAYER.VENTS) return 'vents';
    if (l === LAYER.ROOF) return 'roof';
    const t = tileOfBody(this.state.player);
    return this.world.zoneAt(t.x, t.z);
  }

  snapshot(): Snapshot {
    return { v: 1, prison: this.prison.id, state: structuredClone(this.state) };
  }

  restore(snap: Snapshot) {
    if (snap.prison !== this.prison.id) throw new Error(`snapshot of ${snap.prison}, not ${this.prison.id}`);
    const st = structuredClone(snap.state) as Partial<SimState> & Pick<SimState, 'step' | 'rng' | 'player'>;
    // Fields added after a snapshot was taken load with their starting values (in field
    // order, so the state hashes the same however it was made).
    this.state = {
      step: st.step,
      rng: st.rng,
      player: st.player,
      heat: st.heat ?? 0,
      routine: st.routine ?? routineAt(clockAt(st.step).minuteOfDay),
      attended: st.attended ?? false,
      lockdown: st.lockdown ?? false,
      inmates: st.inmates?.map((m0) => {
        const m = m0.hp === undefined ? { ...m0, ...fighter(45), angry: 0 } : m0;
        return m.opinion === undefined ? { ...m, opinion: OPINION_START, shift: 0 } : m;
      }) ?? spawnInmates(this.world, { rng: st.rng }),
      excused: st.excused ?? false,
      items: fitItems(this.world, st.items, st.rng) ?? startItems(this.world, { rng: st.rng }),
      sleeping: st.sleeping ?? false,
      guards: st.guards?.length === this.world.def.guards.length ? st.guards.map((g) => ({ ...g, resume: g.resume ?? 0, ...(g.hp === undefined ? fighter(GUARD_STR) : {}) })) : spawnGuards(this.world),
      seen: st.seen ?? false,
      ko: st.ko ?? 0,
      wake: st.wake ?? WAKE.NONE,
      solitary: st.solitary ?? 0,
      peeled: st.peeled ?? 0,
      spotted: st.spotted ?? 0,
      near: st.near ?? 0,
      peelAt: st.peelAt ?? 0,
      layer: st.layer ?? LAYER.GROUND,
      energy: st.energy ?? 100,
      tiles: st.tiles ?? {},
      wear: st.wear ?? {},
      toilets: st.toilets ?? {},
      found: st.found ?? [],
      struckAt: st.struckAt ?? -1000,
      escaped: st.escaped ?? 0,
      hiding: st.hiding ?? 0,
      deskAside: st.deskAside ?? false,
      health: st.health ?? maxHealth(st.str ?? START_STR),
      str: st.str ?? START_STR,
      spd: st.spd ?? START_SPD,
      lock: st.lock ?? -1,
      swingAt: st.swingAt ?? -1000,
      doorAt: st.doorAt ?? -1,
      keyAlarm: st.keyAlarm ?? false,
      cash: st.cash ?? 0,
      coins: st.coins ?? {},
      jobs: st.jobs?.length === this.prison.jobs.length ? st.jobs : this.prison.jobs.map((j) => (j.cell === 1 ? HOLDER.PLAYER : j.cell === 0 ? HOLDER.NOBODY : j.cell - 2)),
      jobOpen: st.jobOpen?.length === this.prison.jobs.length ? st.jobOpen : this.prison.jobs.map((j) => (j.cell === 0 ? clockAt(st.step).day : 0)),
      jobDay: st.jobDay ?? clockAt(st.step).day + 1,
      quota: st.quota ?? 0,
      paid: st.paid ?? false,
      machines: st.machines ?? {},
      puddles: st.puddles ?? [],
      mail: st.mail ?? [],
      train: st.train ?? -1,
      reps: st.reps ?? 0,
      repSide: st.repSide ?? 0,
      trained: st.trained ?? 0,
      talk: st.talk ?? -1,
      followers: st.followers ?? [],
      favors: st.favors ?? [],
      shops: st.shops?.length === this.prison.merchants.length ? st.shops : this.prison.merchants.map(() => new Array(SHOP_SLOTS).fill(0)),
    };
    // The world as the state has it: the map, then every tile changed since.
    const w = this.world;
    for (const l of w.layers) l.kind.set(l.base);
    for (const k in this.state.tiles) w.layers[layerOfKey(Number(k))].kind[tileOfKey(Number(k))] = this.state.tiles[k];
    w.playerKeys = this.keysCarried();
    w.refreshBlock();
    this.tilesRev++;
    this.updateDoors(false);
    this.events = [];
  }

  /** A fingerprint of the whole state (tests compare these). */
  hash(): string {
    const w = this.world;
    return fnv1a(JSON.stringify(this.state) + w.layers.map((l) => fnv1a(String.fromCharCode(...l.kind))).join('') + fnv1a(String.fromCharCode(...w.block)));
  }
}

const GUARD_OUTFIT = itemNumber('guard_outfit');
const INMATE_OUTFIT = itemNumber('inmate_outfit');
const BED_DUMMY = itemNumber('bed_dummy');
const POSTER_ITEM = itemNumber('poster');

/** A free hotbar slot. */
function hasRoom(it: ItemState): boolean {
  for (let k = 0; k < HOTBAR; k++) if (!it.inv[k]) return true;
  return false;
}
/** Where a guard looks at a tile from: its middle, then its faces. */
const FACES = [
  [0, 0],
  [0, Math.round(UNIT * 0.45)],
  [0, -Math.round(UNIT * 0.45)],
  [Math.round(UNIT * 0.45), 0],
  [-Math.round(UNIT * 0.45), 0],
];

/**
 * Items from a snapshot, fitted to this prison's containers (a map edit may add or remove
 * some): missing ones come in empty, extra ones are dropped, sizes follow the furniture.
 */
function fitItems(w: World, items: ItemState | undefined, rng: number): ItemState | undefined {
  if (!items) return undefined;
  const list = containersOf(w);
  const old = items.containers;
  items.containers = list.map((c, i) => {
    const was = old[i] ?? [];
    return Array.from({ length: c.slots }, (_, k) => was[k] ?? 0);
  });
  // Everyone's pockets after the furniture (a save from before pockets gets fresh ones).
  const fresh = startPockets(w, { rng });
  items.containers.push(...fresh.map((p, k) => (old.length === list.length + fresh.length ? old[list.length + k] : p)));
  items.rev ??= 0;
  return items;
}

/** Whether a body's footprint touches a tile. */
function overlaps(b: Body, tile: number): boolean {
  const tx = (tile % MAP_W) * UNIT;
  const tz = Math.floor(tile / MAP_W) * UNIT;
  return b.x + BODY_HALF > tx && b.x - BODY_HALF < tx + UNIT && b.z + BODY_HALF > tz && b.z - BODY_HALF < tz + UNIT;
}
