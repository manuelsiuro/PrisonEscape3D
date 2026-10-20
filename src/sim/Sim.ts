import { steerNeedle } from './systems/tattoo';
import type { PowerUse, PrisonDef } from '../content/prisons/types';
import { ROUTINE } from '../content/routine';
import { dirOf, OP, opOf } from './command';
import { newScratch } from './context';
import { fnv1a } from './rng';
import { ESCAPES, freshState, loadState, type Attr, type LayerMove, type SimEvent, type SimState, type Snapshot } from './state';
import { closeBox, keepSeat, regenerate, shower, standUp, underShower, useItems } from './systems/actions';
import { chill } from './systems/weather';
import { crowdPlan, dayMinute, dayWatch, drillOn, theDay, today } from './systems/calendar';
import { clockAt, DAY_STEPS, hourStarts, type Clock } from './systems/clock';
import { HOLDER, jobRooms, type Station } from './systems/economy';
import { fight, keysCarried, raiseKeyAlarm, recover, sleepingGuards, wearKeys, wokeKeyless } from './systems/fights';
import { dutyDue, stepGuards, type GuardReport } from './systems/guards';
import { LOCKDOWN_PLAN, stepInmates } from './systems/inmates';
import { mines } from './systems/mines';
import { noisemakers } from './systems/noise';
import { noteCarried } from './systems/recipes';
import { stockSlots } from './systems/items';
import { clockIn, spreadCoins, station } from './systems/jobs';
import { bedCheck, dummyInBed, outOfReach, release, report, wakeUp } from './systems/justice';
import { tileOfBody, walk, type Body } from './systems/movement';
import { devices, powered, scan, takeoverCheck } from './systems/power';
import { attendance, nextBlock } from './systems/routine';
import { endTalk, grudges, guardTalking, keepTalk, offerFavors, socialNow } from './systems/social';
import { bribesWearOff } from './systems/ways';
import { dogs } from './systems/k9';
import { rats } from './systems/rats';
import { smuggle } from './systems/smuggling';
import { clearBay, deliveryDuty, vehicleIn } from './systems/delivery';
import { ledger } from './systems/ledger';
import { ladderFootOf, reserved } from './systems/structure';
import { attr, keepTraining, stopTraining, trainsOn } from './systems/training';
import { endBout, games, stopPick } from './systems/games';
import { crew, crewEscape } from './systems/crew';
import { checkpointGates } from './systems/getaway';
import { watch } from './systems/watch';
import { tipsy, tipsyNow } from './systems/pruno';
import { races } from './systems/races';
import { TIPSY_PACE } from '../content/long';
import { coolEvery, dayOneTwists, LAST_DAY, OWL_CHECKS, twist } from './systems/twists';
import { BED_CHECK_MINUTES, BODY_HALF, CRAWL_SPEED, STEPS_PER_MINUTE, TUNNEL_SPEED, UNIT, walkSpeed } from './tuning';
import { TILE } from './world/tiles';
import { LAYER, layerOfKey, MAP_W, tileOfKey, World } from './world/World';

// The state, its events and snapshots live in state.ts; importers have always found them here.
export * from './state';

/**
 * The game's rules: `step(cmd)` advances one fixed step (1/20 s). The state depends only
 * on the prison, the seed and the commands, never on frame time, the DOM or Three.js, so
 * the tests replay it headless. Systems (src/sim/systems/) run in a fixed order:
 * noise (fuses, alarm clocks) → clock (the generator, camera tapes) → routine (a block settled, restock, shakedown, a new
 * day, the Work Period) → the day (P17: its event, the drill, a storm's power cuts) → bed checks → the knocked out come round → inmates → job clock-in →
 * guards → the player (waking, walking, keys, detectors, the action, the escape) → fights →
 * the takeover → talk, grudges, training, the side games (P22), the crew (P23), seats → energy and health → the cold → tipsy (P28) → showers → solitary →
 * what guards see (heat, chases, damage, cameras, searchlights, snipers) → the dogs (P19) → the rats (P20) → smuggling (P21) → race nights (P28) → bribes wearing off → the checkpoint's gates (P24) → the key alarm →
 * a lockdown called off → attendance → the day's watch (the drill's muster, the inspection's blots) → heat decay →
 * guards woken without their key (P20) → doors.
 */
export class Sim {
  readonly world: World;
  state: SimState;
  /** What happened during the last step. */
  events: SimEvent[] = [];
  private readonly forInmates: Body[] = [];
  private readonly inmateBodies: Body[] = [];
  private readonly onReport = (r: GuardReport) => report(this, r);
  /** Arrays the systems refill every step (src/sim/context.ts); not state. */
  readonly scratch = newScratch();

  constructor(
    readonly prison: PrisonDef,
    seed = 1,
    /** The Daily's twists (P26; none in the campaign): day 1 is set up under them. */
    mods: readonly string[] = [],
  ) {
    this.world = new World(prison);
    for (const p of this.world.props) if (p.kind === 'shower') this.showerTiles.add(p.z * MAP_W + p.x);
    this.state = freshState(this.world, prison, seed, mods);
    // (P26: the Daily's twists that set day 1 up: grudges, a care package; no draw from the RNG.)
    if (mods.length) dayOneTwists(this);
    // Day 1: change in desks and pockets, the merchants' stock, the first favors.
    spreadCoins(this);
    for (const shop of this.state.shops) stockSlots('merchant', 0, shop, this.state);
    offerFavors(this);
    this.ladderFoot = ladderFootOf(this.world);
    // Where nobody may dig, worked out now from the map as built (never from a later state).
    reserved(this.world);
    this.updateDoors(false);
  }

  /** Where the ladder's floor end is (-1 without one). */
  ladderFoot = -1;
  /** Bump whenever a tile changes, and whenever a tile's wear does (the view redraws them). Not state. */
  tilesRev = 0;
  /** The shower heads' tiles (GDD §3.1). */
  readonly showerTiles = new Set<number>();
  wearRev = 0;
  /** How the player moved onto another layer this step (the escape check reads it); not state. */
  movedBy: LayerMove | null = null;
  /** Replaying a run logged before 1.11 (runlog.ts): the few rules fixed since (a scuffle's verdict) as they were then. Not state. */
  legacy = false;
  /** Replaying a run logged before the dogs came (1.13, runlog.ts): they stay in their kennels. Not state. */
  noDogs = false;
  /** Replaying a run logged before the rats (1.14, runlog.ts): a guard waking without his key raised nothing. Not state. */
  noRats = false;
  /** As the step began (P19), from the state then: the player up and about on the ground floor, and their tile there (-1 off it). Not state. */
  aboutBefore = false;
  groundFrom = -1;
  /** Away on a raft from the pier, or the helicopter off the pad, this step (P12: the escape check reads it), or off with the delivery's vehicle (P18); not state. */
  boarded: 'raft' | 'helicopter' | 'stowaway' | null = null;

  /** A Three Days run (P26) still inside as the fourth day begins: over, lost. */
  get timeUp(): boolean {
    return this.state.mods.length > 0 && twist(this.state, 'threeDays') && !this.state.escaped && this.state.step >= LAST_DAY * DAY_STEPS;
  }

  get clock(): Clock {
    return clockAt(this.state.step);
  }

  /** One step: the rules (`advance`), then the ledger counts what happened (it never changes what does). */
  step(cmd: number) {
    const p = this.state.player;
    const x = p.x;
    const z = p.z;
    if (this.advance(cmd)) ledger(this, x, z);
  }

  /** The rules for one step; false once the game is over (nothing happened). */
  private advance(cmd: number): boolean {
    const s = this.state;
    this.events = [];
    // Out: the game is won, nothing more happens (P26: nor once a Three Days run's time is up).
    if (s.escaped || this.timeUp) return false;
    s.step++;
    // (Three Days: the fourth day dawns and the run is over; the step only says so.)
    if (this.timeUp) {
      this.events.push({ type: 'timeUp' });
      return true;
    }
    // Who dozes as the step starts (P15): each nap ended in it is told once, whatever ended it.
    let dozing = 0;
    for (let k = 0; k < s.guards.length; k++) if (s.guards[k].doze > 0) dozing |= 1 << k;
    // (P20: and who sleeps, in bed or dozing: one who wakes without his key raises the alarm.)
    const sleepers = sleepingGuards(s);
    this.movedBy = null;
    // Where the player is as the step starts (P19: a dog's nose works on a player already about; a trail marks where they left the floor).
    this.aboutBefore = s.layer === LAYER.GROUND && !s.stowed && !this.away;
    this.groundFrom = this.aboutBefore ? Math.floor(s.player.z / UNIT) * MAP_W + Math.floor(s.player.x / UNIT) : -1;
    this.boarded = null;
    // Noise first (P14): a firecracker going off, alarm clocks ticking and ringing; guards sent to look move this step.
    noisemakers(this);
    // Clock.
    const clock = this.clock;
    devices(this);
    if (hourStarts(s.step)) this.events.push({ type: 'hour', hour: clock.hour });
    // Routine: a new block settles the last one.
    nextBlock(this, clock);
    // The day (P17): its event starts and ends, the drill's muster is called, a storm cuts the power.
    theDay(this);
    // 00:30 and 04:00: the night bed check (GDD §5.3).
    // (P26: a Night Owl warden's two more.)
    if (s.step % STEPS_PER_MINUTE === 0 && (BED_CHECK_MINUTES.includes(clock.minuteOfDay) || (OWL_CHECKS.includes(clock.minuteOfDay) && twist(s, 'nightOwl'))) && !this.world.def.rules?.relaxed) bedCheck(this);
    // The knocked out come round (GDD §10.2): a guard missing its key raises the alarm.
    recover(this);
    this.everyoneMoves();
    if (this.playerMoves(cmd, clock)) return true;
    // Combat: inmates and guards land their blows on the player (GDD §10.1); the lock follows its target.
    fight(this);
    // Enough guards out cold at once: the prison is the inmates' (GDD §12).
    takeoverCheck(this);
    // Social life and training: the talk holds while the inmate is in reach, grudges flare up, a set's bar drains.
    keepTalk(this);
    grudges(this);
    keepTraining(this);
    // Side games (P22): a bout's push and shove, a lock being picked, a door picked open.
    games(this);
    // The crew (P23): lookouts' whistles, a brawl's course, the drop fetched, the night's company.
    crew(this);
    keepSeat(this);
    noteCarried(this);
    regenerate(this);
    chill(this);
    // Tipsy (P28): a stumble now and then, sober again.
    tipsy(this);
    shower(this);
    // Solitary: time served (and potatoes peeled) sets the player free.
    if (s.solitary > 0 && --s.solitary === 0) release(this);
    // Who sees the player now, and what they make of it; a key alarm held back goes up now if it can.
    watch(this);
    // The dogs (P19): the player's trail, noses, the trail followed.
    dogs(this);
    // The rats (P20): the traps at 04:00, errands, panics.
    rats(this);
    // Smuggling (P21): the drone's drop and what guards see of it, the visitor, the Red Cross parcel.
    smuggle(this);
    // Race nights (P28): the off, a guard seeing the player at it, the finish.
    races(this);
    bribesWearOff(this);
    // The checkpoint (P24): waved through, its gates shut again after their minute (or at once, wanted).
    checkpointGates(this);
    raiseKeyAlarm(this);
    outOfReach(this);
    attendance(this);
    dayWatch(this);
    // Heat cools while no guard is looking.
    // (P26: Short Fuse, at half the pace.)
    if (!s.seen && !s.lockdown && s.heat > 0 && s.step % coolEvery(s) === 0) s.heat--;
    // Doors last: they follow where everyone ended up, so the state at the end of a step
    // (a save, a keyframe) says everything about them.
    // A guard awake again without his key (P20: a rat had it): after everything that wakes guards, before the doors (an alarm locks them).
    wokeKeyless(this, sleepers);
    this.updateDoors(true);
    if (dozing) this.napsOver(dozing);
    return true;
  }

  /**
   * A nap ended this step without a word (a chase, a lockdown, a job, a look, a knockout): the
   * 'nap' event the noise, a blow or the round would have given.
   */
  private napsOver(dozing: number) {
    const s = this.state;
    for (let k = 0; k < s.guards.length; k++) {
      if (!(dozing & (1 << k)) || s.guards[k].doze > 0) continue;
      if (!this.events.some((e) => e.type === 'nap' && e.guard === k && !e.on)) this.events.push({ type: 'nap', guard: k, on: false });
    }
  }

  /**
   * Inmates, then guards. In a lockdown inmates head for their cells (at night they are going
   * there anyway, to sleep).
   */
  private everyoneMoves() {
    const s = this.state;
    const w = this.world;
    // Who each group shares the floor with (arrays reused: asleep, hundreds of steps run a second).
    const forInmates = this.forInmates;
    const inmateBodies = this.inmateBodies;
    // (Hidden in the delivery's vehicle, P18: nobody bumps into the player, nobody can come for them.)
    const about = s.layer === LAYER.GROUND && !s.stowed;
    const delivery = deliveryDuty(this);
    forInmates.length = 0;
    if (about) forInmates.push(s.player);
    for (const g of s.guards) forInmates.push(g.body);
    inmateBodies.length = 0;
    for (const m of s.inmates) inmateBodies.push(m.body);
    stepInmates(w, s.inmates, s.lockdown && ROUTINE[s.routine].id !== 'lightsOut' ? LOCKDOWN_PLAN : crowdPlan(this, s.routine), s, forInmates, s.step, about && !this.away ? s.player : null, socialNow(this));
    clockIn(this);
    // A guard talking with the player has somewhere else to be at a new block (P15): the talk ends.
    const k = guardTalking(s);
    if (k >= 0 && dutyDue(w.def.guards[k], s.guards[k], s.routine, k, delivery, s.mods)) endTalk(this);
    stepGuards(w, s.guards, s.routine, s.lockdown, s.player, inmateBodies, s.step, this.onReport, about, guardTalking(s), s.salt, delivery, s.mods);
  }

  /** The player's turn: out cold, or awake to walk and act. Returns true once they're out on the road (the step ends there). */
  private playerMoves(cmd: number, clock: Clock): boolean {
    const s = this.state;
    const w = this.world;
    // Knocked out: nothing to do but lie there, then wake up somewhere else.
    if (s.ko > 0) {
      s.player.moving = false;
      if (--s.ko === 0) wakeUp(this);
      return false;
    }
    // Asleep: a move (or the action button) wakes the player, and so does 07:55 (in time for roll call).
    const wokenByPlayer = s.sleeping && (dirOf(cmd) !== 0 || opOf(cmd) === OP.INTERACT);
    if (s.sleeping && (wokenByPlayer || clock.minuteOfDay === 7 * 60 + 55 || ROUTINE[s.routine].id !== 'lightsOut' || s.lockdown)) {
      s.sleeping = false;
      this.events.push({ type: 'sleep', on: false });
    }
    // Hidden in the delivery's vehicle (P18): going nowhere, and Interact climbs back out; the vehicle leaving takes the player with it.
    if (s.stowed) {
      s.player.moving = false;
      useItems(this, STOWED_OPS.includes(opOf(cmd)) ? cmd : 0);
      return this.out(-1);
    }
    // Keys in the pockets open their doors for the player (GDD §7.3).
    w.setPlayerKeys(keysCarried(this));
    // A step off the equipment ends the training.
    if (s.train >= 0 && dirOf(cmd) !== 0) stopTraining(this);
    // (P22: a step out of a bout gives it up; a step away from a lock stops the picking.)
    if (s.bout.length && dirOf(cmd) !== 0) endBout(this, 'gaveUp');
    if (s.pick.length && dirOf(cmd) !== 0) stopPick(this);
    // (P27: a step with the ball held up puts it down again.)
    if (s.shot.length && dirOf(cmd) !== 0) s.shot = [];
    // A step gets the player up off a seat or a bed.
    if (s.seat >= 0 && dirOf(cmd) !== 0) standUp(this);
    const from = Math.floor(s.player.z / UNIT) * MAP_W + Math.floor(s.player.x / UNIT);
    // (P29: tattooing, the moves steer the needle; being inked, the player keeps still.)
    // (P30: on the stage, the player keeps still too: the keys play the lanes.)
    const inking = !!s.ink || !!s.show;
    if (s.ink) steerNeedle(s, dirOf(cmd));
    // (P28: tipsy, at TIPSY_PACE of the pace.)
    const pace = s.layer === LAYER.VENTS ? CRAWL_SPEED : s.layer === LAYER.UNDER ? TUNNEL_SPEED : walkSpeed(s.spd);
    walk(w, s.player, s.sleeping || inking ? 0 : dirOf(cmd), tipsyNow(s) ? Math.floor((pace * TIPSY_PACE) / 100) : pace, s.layer);
    // Onto a buried mine (P11).
    mines(this);
    wearKeys(this);
    // Through a detector arch (GDD §5.4).
    scan(this);
    // Nothing gets done in your sleep, and the press that woke you doesn't put you back to bed.
    // (P30: on the stage only the act's own commands: a talk, a seat or a strike would only get in its way.)
    useItems(this, s.sleeping || wokenByPlayer || (s.show && opOf(cmd) !== OP.EXT) ? dirOf(cmd) : cmd);
    return this.out(from);
  }

  /**
   * On the road outside: free (GDD §12), and how: dug up out there, over the fence on a grapnel (or down a rope off a roof beyond it), off a roof on a glider (P24), out of the gates in a takeover, waved through the checkpoint (P24), through a gate with its keys (San Pancho's supply road), or through the fence.
   * Or away over the sea (Irongate): on a raft off the pier, in the helicopter off its pad; or away in the delivery's vehicle (P18).
   * (`from`: the tile the player stood on before walking this step; -1 not walking.)
   */
  private out(from: number): boolean {
    const s = this.state;
    // (Climbed out as it pulls away: left behind.)
    if (this.boarded === 'stowaway' && !s.stowed) this.boarded = null;
    if (s.layer !== LAYER.GROUND || !(this.boarded || (!s.stowed && this.playerZone === 'outside'))) return false;
    s.escaped = s.step;
    const gate = from >= 0 && this.world.ground.kind[from] === TILE.DOOR;
    // (P24: off a roof on a glider; waved out through the checkpoint, its gates or its lowered drawbridge.)
    const bluff = from >= 0 && s.waved > 0 && this.world.checkpoint[from] === 1;
    s.via = ESCAPES.indexOf(this.boarded ?? (this.movedBy === 'digUp' ? 'tunnel' : this.movedBy === 'grapnel' || this.movedBy === 'rope' ? 'roof' : this.movedBy === 'glide' ? 'glider' : s.takeover ? 'takeover' : bluff ? 'bluff' : gate ? 'gate' : 'fence'));
    closeBox(this);
    // The crew close by slip out too (P23), on a way out they can take.
    s.crewOut = crewEscape(this, ESCAPES[s.via]);
    this.events.push(s.crewOut.length ? { type: 'escaped', via: ESCAPES[s.via], crew: s.crewOut.slice() } : { type: 'escaped', via: ESCAPES[s.via] });
    return true;
  }

  /** Where the block wants the player: the routine's zones, or during the Work Period, the job's room (GDD §2.1: mandatory if employed). */
  get dutyZones(): readonly string[] {
    // The fire drill (P17): everyone out to roll call until it's over.
    if (drillOn(this) && !this.state.lockdown) return MUSTER;
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

  /** The prison's power (GDD §5.5): on unless the generator was switched off less than 45 s ago (Irongate: GEN-1's; see powered()). */
  get power(): boolean {
    return this.state.powerOff === 0;
  }

  /** Whether something has power now (Irongate's two generators each power their half, GDD §4.5). */
  powered(use: PowerUse): boolean {
    return powered(this.world, this.state, use);
  }

  /** Whether the player's bed holds a bed dummy. */
  dummyInBed(): boolean {
    return dummyInBed(this);
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

  /** What the player's job lets the action button do here (null: the usual). */
  station(): Station | null {
    return station(this);
  }

  // ---------------------------------------------------------------- training (GDD §3.2)

  attr(a: Attr): number {
    return attr(this, a);
  }

  /** What a prop trains: the weights Strength, the treadmill Speed, a library shelf Intellect. */
  trainsOn(prop: number): Attr | null {
    return trainsOn(this, prop);
  }

  /** Whether the player stands under a shower now (the view shows them showering). */
  get showering(): boolean {
    return underShower(this);
  }

  // ---------------------------------------------------------------- inmates (GDD §10.3–10.4)

  /** A merchant's place in def.merchants (and s.shops), -1 if the inmate isn't one. */
  merchantOf(who: number): number {
    const m = this.state.inmates[who];
    return m ? this.world.def.merchants.indexOf(m.cell) : -1;
  }

  /** Merchants deal during free time (GDD §10.3); never on a Closed Shop Daily (P26). */
  get shopsOpen(): boolean {
    return this.fixerOpen && !twist(this.state, 'closedShop');
  }

  /** The fixer's hours (P21): the merchants' (a Closed Shop leaves him be: he's no shop). */
  get fixerOpen(): boolean {
    const id = ROUTINE[this.state.routine].id;
    return (id === 'freeTime' || id === 'eveningFreeTime') && !this.state.lockdown;
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
    let rooms = 0n;
    if (ROUTINE[s.routine].id === 'work' && !s.lockdown) for (const r of jobRooms(w)) rooms |= 1n << BigInt(r.zone);
    // Someone in a job room, or anywhere in its doorway (a foot still in it is enough: a door never shuts on anyone), keeps its door open.
    const zoneBit = (b: Body) => {
      const i = Math.floor(b.z / UNIT) * MAP_W + Math.floor(b.x / UNIT);
      let bits = 1n << BigInt(w.doorRoom[i] || w.ground.zone[i]);
      for (const x of [b.x - BODY_HALF, b.x + BODY_HALF - 1])
        for (const z of [b.z - BODY_HALF, b.z + BODY_HALF - 1]) {
          const j = Math.floor(z / UNIT) * MAP_W + Math.floor(x / UNIT);
          if (w.doorRoom[j]) bits |= 1n << BigInt(w.doorRoom[j]);
        }
      return bits;
    };
    if (s.layer === LAYER.GROUND) rooms |= zoneBit(s.player);
    for (const m of s.inmates) rooms |= zoneBit(m.body);
    w.setOpenRooms(rooms);
    let mask = 0n;
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
        mask |= 1n << BigInt(c);
      }
    }
    const was = w.lockedCells;
    w.setLockedCells(mask);
    // A door picked open (P22): for the player, until they're through it.
    w.setPicked(s.picked.length ? s.picked[0] : -1);
    // Waved through the checkpoint (P24): its way out open for the player.
    w.setWaved(s.waved > 0);
    // Delivery day (P18): the vehicle's bay solid and its doors propped open while it's in; anyone where it parks steps aside.
    const arriving = !w.delivering;
    // (Its doors stay open behind it, that day, while the player is still out there: never shut out.)
    w.setDelivery(vehicleIn(this), this.outBeyond());
    if (announce && arriving && w.delivering) clearBay(this);
    // The player hears their own door lock and unlock.
    if (announce && ((was ^ mask) & 2n) !== 0n) this.events.push({ type: 'cells', locked: (mask & 2n) !== 0n });
  }

  /** The player is out past the delivery's propped doors after it left today (P18): they stay open until they're back. */
  private outBeyond(): boolean {
    const s = this.state;
    if (s.layer !== LAYER.GROUND || !this.world.def.delivery?.open) return false;
    const p = today(this);
    if (p.event !== 'delivery' || dayMinute(s.step) < p.at) return false;
    const t = tileOfBody(s.player);
    return this.world.beyond(t.z * MAP_W + t.x);
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
    this.state = loadState(this.world, this.prison, structuredClone(snap.state));
    // The world as the state has it: the map, then every tile changed since.
    const w = this.world;
    for (const l of w.layers) l.kind.set(l.base);
    for (const k in this.state.tiles) w.layers[layerOfKey(Number(k))].kind[tileOfKey(Number(k))] = this.state.tiles[k];
    w.playerKeys = keysCarried(this);
    w.riot = this.state.takeover;
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

/** Where the fire drill musters. */
const MUSTER: readonly string[] = ['rollCall'];
/** What a player hidden in the delivery's vehicle can do (P18): climb out, and sort the pockets. */
const STOWED_OPS: readonly number[] = [OP.INTERACT, OP.CLOSE, OP.MOVE, OP.EQUIP, OP.SELECT];

/** Whether a body's footprint touches a tile. */
function overlaps(b: Body, tile: number): boolean {
  const tx = (tile % MAP_W) * UNIT;
  const tz = Math.floor(tile / MAP_W) * UNIT;
  return b.x + BODY_HALF > tx && b.x - BODY_HALF < tx + UNIT && b.z + BODY_HALF > tz && b.z - BODY_HALF < tz + UNIT;
}
