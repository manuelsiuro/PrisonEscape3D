/**
 * The simulation's state as plain data (what a save, a keyframe or a hash holds), the events
 * a step reports, and where a state comes from: a new game, or a snapshot loaded.
 */
import type { PrisonDef } from '../content/prisons/types';
import { SHOP_SLOTS } from '../content/loot';
import { routineAt } from '../content/routine';
import { HOLDER, type Favor, type StationAct } from './systems/economy';
import { maxHealth } from './systems/combat';
import { clockAt, prisonDay } from './systems/clock';
import { spawnGuards, type Guard } from './systems/guards';
import { fighter, spawnInmates, type Inmate } from './systems/inmates';
import { fixtureUse, START_INT, startItems, startPockets, type FixtureUse, type ItemEvent, type ItemState } from './systems/items';
import { bodyAt, type Body } from './systems/movement';
import type { ClimbAction, ToolAction } from './systems/structure';
import { mix32 } from './rng';
import { FEATS, freshFeats, partialLedger } from './systems/ledger';
import type { ForcedDay } from './systems/calendar';
import type { DayEvent } from '../content/days';
import { GUARD_STR, OPINION_START, START_SPD, START_STR, STUDY_TIP_EVERY } from './tuning';
import { containersOf } from './world/containers';
import { LAYER, type World } from './world/World';

/** Why guards took notice of the player (GDD §5.2). Stored as numbers: never renumber. */
export const SPOT = ['none', 'night', 'restricted', 'contraband', 'recognized', 'wanted', 'bedCheck', 'damage', 'tampering', 'fight', 'keyMissing', 'brawl', 'detector', 'camera', 'searchlight', 'sniper'] as const;
export type SpotReason = (typeof SPOT)[number];
/** How the player got out (GDD §12), for the victory screen. Stored as numbers: never renumber. */
export const ESCAPES = ['none', 'fence', 'tunnel', 'roof', 'takeover', 'gate', 'raft', 'helicopter'] as const;
export type EscapeRoute = (typeof ESCAPES)[number];
/** Who hurt the player besides people (Cast ids): a tunnel's roof, a sniper, a mine, the sea flooding a tunnel. */
export const HURT_BY = { CAVE_IN: -1, SNIPER: -2, MINE: -3, FLOOD: -4 } as const;
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
  | { type: 'bedCheck'; result: 'start' | 'pass' | 'fail'; dummy?: boolean }
  /** A tool strike landed (`broke`: the tile gave way), or why it couldn't. */
  | { type: 'strike'; action: ToolAction; layer: number; tile: number; broke: boolean }
  | { type: 'cantStrike'; why: 'tool' | 'reinforced' | 'boulder' | 'tired' | 'poster' | 'full' | 'noLanding' | 'noRope'; action: ToolAction }
  /** A tool wore out. */
  | { type: 'broke'; item: number }
  /** A live electric fence: knocked out (GDD §9.1). */
  | { type: 'shocked' }
  /** A tunnel roof came down on the player (GDD §9.2). */
  | { type: 'caveIn'; tile: number }
  /** A landmine went off under the player (P11): its ground tile. */
  | { type: 'blast'; tile: number }
  /** A tunnel dug under the sea (P12, GDD §4.5): it floods, the player is washed out; the tile dug into, the tunnel tiles lost. */
  | { type: 'flood'; tile: number; lost: number }
  /** Onto another layer (through a grate, up the ladder, into a tunnel…). */
  | { type: 'layer'; layer: number; from: number; how: ClimbAction | 'digUp' | 'rope' | 'grapnel' }
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
  /** Out on the road: free (GDD §4.0), and how. */
  | { type: 'escaped'; via: EscapeRoute }
  /** Security (GDD §5.4–5.6): the power off and back on; a pass through a detector arch (tripped, or shielded by the pouch: its passes left); a camera blinded or seeing again; a sniper taking aim and shooting; the takeover. */
  | { type: 'power'; on: boolean; by: 'player' | 'guard' | 'storm' | 'maintenance'; gen?: number }
  | { type: 'scanned'; tripped: boolean; pouch: number; tile: number }
  | { type: 'camera'; index: number; blind: boolean }
  | { type: 'aim'; tower: number }
  | { type: 'shot'; tower: number; hit: boolean; dmg: number }
  | { type: 'takeover'; on: boolean }
  /** Combat (GDD §10): the lock moved (-1: none); a blow landed on someone (Cast id) or the player; a cup of molten chocolate thrown. */
  | { type: 'lock'; who: number }
  /** (`free`, P17: a food fight's blow at an inmate in the canteen: no heat, counted for Food Fighter.) */
  | { type: 'hit'; who: number; dmg: number; ko: boolean; weapon: number; free?: boolean }
  | { type: 'thrown'; who: number; free?: boolean }
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
  | { type: 'cash'; n: number; why: 'loot' | 'wage' | 'favor' | 'buy' | 'gift' | 'bribe' | 'commend' }
  /** Something done at a job station; the quota moved on; the day's wage. */
  | { type: 'work'; act: StationAct; item: number; prop: number }
  | { type: 'quota'; n: number; of: number }
  /** A job changed hands (who: -1 the player, else an inmate's Cast id). */
  | { type: 'job'; job: number; who: number; change: 'hired' | 'fired' | 'quit' }
  /** The job board was looked at (the panel opens). */
  | { type: 'board' }
  /** Training (GDD §3.2): on and off equipment; a press that counted; a set done; why not. */
  | { type: 'train'; on: boolean; use: FixtureUse | 'study' }
  /** Sat down or got up (a seat, bench or chair), lay down on or got off an infirmary bed. */
  | { type: 'sit'; on: boolean; use: 'sit' | 'rest' }
  /** A meal eaten at the canteen table (GDD §2: +35 energy). */
  | { type: 'meal'; feast?: boolean }
  /** A recipe told to the player: by studying (who -1) or by an inmate. */
  | { type: 'tip'; recipe: number; who: number }
  /** Chilled to the bone in the snow, or (`hot`, P17) baked by a heatwave's sun: energy costs double while it lasts. */
  | { type: 'cold'; on: boolean; hot?: boolean }
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
  /**
   * Noise (P14): made somewhere (its layer and tile; the ground tiles it reached), the guards
   * awake who heard it and those sent to look (guard indexes). A thrown item landing (from the
   * player's tile to where it lies; an inmate it hit, Cast id, or -1), an alarm clock wound
   * (seconds to go; 0: stopped), a firecracker going off, an alarm clock ringing (seconds of it
   * left); why a throw didn't go.
   */
  | { type: 'noise'; kind: NoiseKind; layer: number; tile: number; reach: number; tiles: number[]; heard: number[]; sent: number[] }
  | { type: 'tossed'; item: number; from: number; to: number; hit: number }
  | { type: 'wound'; secs: number }
  | { type: 'bang'; tile: number }
  | { type: 'ringing'; layer: number; tile: number; left: number }
  | { type: 'cantThrow'; why: TossRefusal }
  /**
   * Guard ways (P15): a lazy guard dozing off at its nap stop or waking (guard index); a bribe
   * taken (look the other way, lose the paperwork: its price) and a look the other way over.
   */
  | { type: 'nap'; guard: number; on: boolean }
  | { type: 'bribe'; guard: number; kind: BribeKind; price: number }
  /**
   * The day (P17): 08:00, a new prison day; the day's event starting and ending, the drill's
   * muster taken or missed, the inspection's commendation.
   */
  | { type: 'day'; day: number }
  | { type: 'today'; event: DayEvent; phase: 'start' | 'end' | 'muster' | 'missed' | 'commend' }
  | ItemEvent;

/** What a bribe buys (P15): looking the other way, the paperwork lost; 'over' when the look away ends. */
export type BribeKind = 'look' | 'paper' | 'over';

/** What made a noise (P14). */
export type NoiseKind = 'strike' | 'thud' | 'bang' | 'ring';
/** Why a throw didn't go (i18n `toss.<why>`): nothing in hand, not now, too far, something in the way, nowhere to land. */
export type TossRefusal = 'nothing' | 'busy' | 'far' | 'line' | 'there';

/** The three attributes (GDD §3.2). */
export type Attr = 'str' | 'spd' | 'int';
export const ATTRS: readonly Attr[] = ['str', 'spd', 'int'];
/** Why something social or economic didn't happen (i18n `refused.<why>`). */
export type Refusal = 'closed' | 'cash' | 'room' | 'grudge' | 'opinion' | 'followers' | 'int' | 'taken' | 'favors' | 'missing' | 'worthless' | 'notDone' | 'seatTaken' | 'tipOpinion' | 'tipToday' | 'noTips' | 'noHelicopter' | 'helipadGuards' | 'notUniform' | 'honest' | 'reported' | 'tooHot' | 'lookingAway' | 'clean' | 'paperToday';

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
  /** A guard saw the player at the end of this step (P15: not one bribed to look the other way). */
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
  /** The player's last blow was at an inmate already after them (seen, it's a scuffle, not an attack). */
  selfDefense: boolean;
  /** The generator (GDD §5.5): steps until the power comes back on (0: on). */
  powerOff: number;
  /** Standing in a detector arch already scanned (a pass counts once). */
  scanned: boolean;
  /** Each camera's tape (GDD §5.6): the step it comes off (0: watching). */
  cams: number[];
  /** A sniper's aim (GDD §5.6): the step of its next shot (0: nobody in its sights), and the shots fired so far. */
  sniperAt: number;
  shots: number;
  /** In a searchlight's beam last step (its alarm goes once a pass). */
  lit: boolean;
  /** The takeover (GDD §12): enough guards out cold at once, every door and gate open. */
  takeover: boolean;
  /** For the victory screen (GDD §13.2): walls chipped, tunnel tiles dug, guards knocked out, cash earned. */
  tally: number[];
  /** How the player got out (ESCAPES index, 0 still inside). */
  via: number;
  /** Sitting on a seat, bench or chair, or resting on an infirmary bed (the prop's index; -1 standing). */
  seat: number;
  /** Steps spent eating this meal (GDD §2): MEAL_STEPS is a meal eaten. */
  eaten: number;
  /** Items the player has carried (item numbers): the handbook shows them in recipes not yet known. */
  carried: number[];
  /** Recipes the player was told (RECIPES indexes), by studying or by an inmate. */
  tips: number[];
  /** The day each inmate last told the player a recipe (by inmate index; 0 never). */
  tipDay: number[];
  /** The highest Intellect mark (in STUDY_TIP_EVERY points) studying has paid a tip for: a mark lost overnight and won back again pays nothing. */
  studied: number;
  /** The cold (P9, GDD §4.2): steps of it built up out in the snow, up to COLD_STEPS (chilled: energy costs double). */
  cold: number;
  /** Chilled to the bone (P9): set when the cold reaches COLD_STEPS, cleared only once it's all gone (energy costs double meanwhile, indoors too). */
  frozen: boolean;
  /** Mines set off today (P11, GDD §4.4): their ground tiles, craters until the guards lay new ones at 08:00. */
  craters: number[];
  /** The second generator (P12, HMP Irongate's GEN-2): steps until its power comes back on (0: on). */
  powerOff2: number;
  /** Firecrackers burning (P14): [where (World placeKey), the step it goes off]. */
  fuses: Array<[number, number]>;
  /** The seed mixed (P15, rng.ts roll()): the newer rules' randomness, never drawn from `rng`. Old saves mix their loaded rng. */
  salt: number;
  /** The run's ledger (P16, ledger.ts): counters (FEATS order), and DAY bits per prison day (index day − 1). */
  feats: number[];
  days: number[];
  /** The Daily's twists (P26; none in the campaign). */
  mods: string[];
  /** Days forced (P17, calendar.ts ForcedDay: bots, tests, the Daily): [day (0 every day), event, weather], -1 as drawn. */
  calendar: ForcedDay[];
  /** What happened today (P17, calendar.ts TODAY bits): the drill's muster, the inspection's blots, the feast. Cleared at 08:00. */
  eventFlags: number;
}

export interface Snapshot {
  v: 1;
  prison: string;
  state: SimState;
}

/** How the player moved onto another layer (the 'layer' event, the escape check). */
export type LayerMove = ClimbAction | 'digUp' | 'rope' | 'grapnel';

/**
 * A new game's state: every field with its starting value, in field order (the hash
 * stringifies the state, so the order is part of it). Day 1's coins, stock and favors are
 * the Sim's to add (they draw on the RNG after this).
 */
export function freshState(world: World, prison: PrisonDef, seed: number): SimState {
  const s = { rng: seed | 0 };
  const inmates = spawnInmates(world, s);
  const items = startItems(world, s);
  return {
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
    guards: spawnGuards(world),
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
    selfDefense: false,
    powerOff: 0,
    scanned: false,
    cams: (prison.cameras ?? []).map(() => 0),
    sniperAt: 0,
    shots: 0,
    lit: false,
    takeover: false,
    tally: [0, 0, 0, 0],
    via: 0,
    seat: -1,
    eaten: 0,
    carried: [],
    tips: [],
    tipDay: [],
    studied: Math.floor(START_INT / STUDY_TIP_EVERY),
    cold: 0,
    frozen: false,
    craters: [],
    powerOff2: 0,
    fuses: [],
    salt: mix32(seed),
    feats: freshFeats(),
    days: [],
    mods: [],
    calendar: [],
    eventFlags: 0,
  };
}

/**
 * A state loaded from a snapshot (a copy the caller owns). Fields added after the snapshot
 * was taken load with their starting values, in field order, so the state hashes the same
 * however it was made.
 */
export function loadState(world: World, prison: PrisonDef, st: Partial<SimState> & Pick<SimState, 'step' | 'rng' | 'player'>): SimState {
  const fresh = freshState(world, prison, st.rng);
  const out = {} as Record<keyof SimState, unknown>;
  for (const k of Object.keys(fresh) as Array<keyof SimState>) out[k] = st[k] ?? fresh[k];
  const s = out as SimState;
  // Starting values that depend on the loaded state (its time, its Strength, its RNG), and
  // lists fitted to this prison (a map edit may change how many guards, jobs, merchants or
  // cameras it has).
  s.routine = st.routine ?? routineAt(clockAt(st.step).minuteOfDay);
  s.inmates =
    st.inmates?.map((m0) => {
      const m = m0.hp === undefined ? { ...m0, ...fighter(45), angry: 0 } : m0;
      return m.opinion === undefined ? { ...m, opinion: OPINION_START, shift: 0 } : m;
    }) ?? spawnInmates(world, { rng: st.rng });
  s.items = fitItems(world, st.items, st.rng) ?? startItems(world, { rng: st.rng });
  // Guard fields added later (P15's ways) load at the end, in field order.
  s.guards =
    st.guards?.length === world.def.guards.length
      ? st.guards.map((g) => ({ ...g, resume: g.resume ?? 0, ...(g.hp === undefined ? fighter(GUARD_STR) : {}), doze: g.doze ?? 0, napDay: g.napDay ?? 0, stir: g.stir ?? 0, bribed: g.bribed ?? 0, paperDay: g.paperDay ?? 0 }))
      : fresh.guards;
  s.health = st.health ?? maxHealth(st.str ?? START_STR);
  s.jobs = st.jobs?.length === prison.jobs.length ? st.jobs : fresh.jobs;
  s.jobOpen = st.jobOpen?.length === prison.jobs.length ? st.jobOpen : prison.jobs.map((j) => (j.cell === 0 ? clockAt(st.step).day : 0));
  s.jobDay = st.jobDay ?? clockAt(st.step).day + 1;
  s.shops = st.shops?.length === prison.merchants.length ? st.shops : fresh.shops;
  s.cams = st.cams?.length === (prison.cameras ?? []).length ? st.cams : fresh.cams;
  // A save from before the ledger (P16): partial, its days so far unknown. Counters added since load at 0.
  // (A damaged one too: a ledger that isn't lists of numbers starts again, partial.)
  const list = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'number');
  if (!list(st.feats) || !list(st.days)) Object.assign(s, partialLedger(st.step));
  else if (st.feats!.length < FEATS.length) s.feats = [...st.feats!, ...freshFeats().slice(st.feats!.length)];
  if (!Array.isArray(s.mods) || !s.mods.every((m) => typeof m === 'string')) s.mods = [];
  // A save from before the day (P17): the day it was made on stays quiet (nothing starts half way through).
  const days = (v: unknown) => Array.isArray(v) && v.every((d) => Array.isArray(d) && d.length === 3 && d.every((x) => Number.isInteger(x)));
  if (!days(st.calendar)) s.calendar = [[prisonDay(st.step), 0, 0]];
  if (!Number.isInteger(s.eventFlags)) s.eventFlags = 0;
  // A seat that isn't one any more (the props changed): standing.
  const seat = world.props[s.seat];
  if (s.seat >= 0 && !(seat && fixtureUse(world, seat))) s.seat = -1;
  return s;
}

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
