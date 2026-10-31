/**
 * The simulation's state as plain data (what a save, a keyframe or a hash holds), the events
 * a step reports, and where a state comes from: a new game, or a snapshot loaded.
 */
import type { PrisonDef } from '../content/prisons/types';
import { SHOP_SLOTS } from '../content/loot';
import { ROUTINE, routineAt } from '../content/routine';
import { HOLDER, type Favor } from './systems/economy';
import { maxHealth } from './systems/combat';
import { clockAt } from './systems/clock';
import { spawnGuards, type Guard } from './systems/guards';
import { spawnInmates, type Inmate } from './systems/inmates';
import { START_INT, startItems, type ItemState } from './systems/items';
import { bodyAt, type Body } from './systems/movement';
import type { ClimbAction } from './systems/structure';
import { mix32 } from './rng';
import { freshFeats } from './systems/ledger';
import { spawnDogs, type Dog } from './systems/k9';
import type { Rat } from './systems/rats';
import type { ForcedDay } from './systems/calendar';
import type { Cheat } from './systems/cards';
import type { Shootout } from './systems/hoops';
import type { Board } from './systems/checkers';
import type { Match } from './systems/football';
import type { Ink } from './systems/tattoo';
import type { Show } from './systems/talent';
import type { Quiz } from './systems/quiz';
import { freshParole, type Hearing } from './systems/parole';
import { HOLIDAYS } from '../content/holidays';
import { START_SPD, START_STR, STUDY_TIP_EVERY } from './tuning';
import { LAYER, type World } from './world/World';
import { WAKE } from './events';


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
  /** Days forced (P17, calendar.ts ForcedDay: bots, tests, the Daily): [day (0 every day), event, weather] (P24: and the wind, its strength), -1 as drawn. */
  calendar: ForcedDay[];
  /** What happened today (P17, calendar.ts TODAY bits): the drill's muster, the inspection's blots, the feast. Cleared at 08:00. */
  eventFlags: number;
  /** Hidden in the delivery's vehicle (P18): out of sight, going nowhere on foot, away with it at 14:31. */
  stowed: boolean;
  /** The prison day a stowaway was last pulled out of a vehicle (0 never): every search thorough for WARY_DAYS. */
  stowCaught: number;
  /** The guard dogs (P19, k9.ts), in the order of their handlers. */
  dogs: Dog[];
  /** The player's trail out of bounds (P19): [ground tile, the step it was laid, 1 where they left the floor from it], oldest first, at most SCENT_TILES. */
  scent: Array<[number, number, number?]>;
  /** The rats (P20, rats.ts): the player's pet once tamed, and any caught one thrown loose. */
  rats: Rat[];
  /** An order on its way (P21, smuggling.ts): [its place in the CATALOGUE, the WAY it comes, the first prison day it may come]; [] none. */
  order: number[];
  /** What the drone dropped that still lies where it fell (P21): [its ground tile's placeKey, the item, the step it fell]. */
  drops: Array<[number, number, number]>;
  /** Steps seated at a visiting seat in visiting hours (P21): the visitor comes at VISIT_STEPS. */
  visit: number;
  /** Side games (P22, games.ts): the games played with each inmate today (by inmate index: prison day × 4 + games). */
  played: number[];
  /** Dice on the table: [the inmate (index), the stake's place in STAKES, the player's two dice]; [] none. */
  dice: number[];
  /** An arm-wrestle: [the inmate, the bar (0 their win – BAR the player's), the side last pressed, the step it began]; [] none. */
  bout: number[];
  /** Picking a lock: [the door's ground tile, pins set, the step the marker set off]; [] none. */
  pick: number[];
  /** A door picked open, for the player alone: [its tile, the step it locks again, 1 once they've stood in it]; [] none. */
  picked: number[];
  /** The prison day each inmate last cheered the player's win at arm-wrestling (by inmate index; 0 never): once a day each. */
  cheered: number[];
  /**
   * The crew's orders (P23, crew.ts): [the follower (inmate index), ORDER, its place (a post's
   * tile, the shaft's, a brawl's end step, the drop's placeKey: -1 none), more of it (a guard
   * mask, the spot beside the shaft, the inmate brawled with, the fetch's deadline or the item
   * carried), 1 staying on through tonight]. A follower with none just follows.
   */
  crew: number[][];
  /** The prison day the crew last started a brawl (0 never): once a day. */
  brawled: number;
  /** Who got out with the player (inmate indexes), once they're out. */
  crewOut: number[];
  /** Waved through the checkpoint (P24, ways.ts showId): the step its gates shut on the player again (0: shut). */
  waved: number;
  /** A game of Cheat under way (P27, cards.ts), null none. */
  cheat: Cheat | null;
  /** A shootout at the hoop (P27, hoops.ts), null none; the ball held up for a shot: [the step it went up, the spot], [] none. */
  shootout: Shootout | null;
  shot: number[];
  /** Baskets on one's own today (P27): prison day × 16 + baskets (a point of Speed at PRACTICE_MAKES). */
  practice: number;
  /** The old-timer's board (P27, checkers.ts), null before the first game; the games with him: [won, lost, drawn, the prison day one last taught a point]. */
  board: Board | null;
  elder: number[];
  /**
   * P28's long games: what was last taken on request ([the meal fruit was taken at, the day sugar
   * was, the day a seed packet was]); tipsy ([the step it wears off, the step a guard last saw it];
   * [] never); the garden's beds ([crop, stages grown, dry days, cupfuls today] each, garden.ts);
   * tonight's race (races.ts RACE; [] none).
   */
  pantry: number[];
  tipsy: number[];
  plots: number[][];
  race: number[];
  /**
   * P29: a football match under way (football.ts), null none; a tattoo sitting (tattoo.ts), null
   * none; the designs on the player's arms (DESIGNS places, in the order inked).
   */
  match: Match | null;
  ink: Ink | null;
  inked: number[];
  /** The prison day each inmate last had a tattoo from the player (by inmate index; 0 never). */
  inkDays: number[];
  /**
   * P30: the player's act on talent night (talent.ts), null none; the prison day of their last act
   * (0 never: one a night); a quiz under way (quiz.ts), null none; the prison day of the last one
   * joined (0 never).
   */
  show: Show | null;
  stageDay: number;
  quiz: Quiz | null;
  quizDay: number;
  /**
   * Talent night's acts that stood (2.5.1, talent.ts keepActs): [the prison day, a bit per act
   * whose performer took the boards in his slot, or was kept from them by the player]; [] none.
   * An act past its grace without its bit is a no-show.
   */
  acted: number[];
  /**
   * P31: a lap of the running track under way (grounds.ts laps: [first corner, last, the way
   * round, corners passed]; [] none); the step after the gardener's crates were filled (fresh
   * meals for a day after; 0 none).
   */
  lap: number[];
  fresh: number;
  /**
   * P34, the pay phone (phone.ts): who is on it ([the inmate (index; -1 nobody), the step his call
   * ends (0: still walking to it), steps the player has listened in, the step he set off for it]); the queue in order (inmate
   * indexes, -1 the player); the step the player's turn came (0 none); the player's call (null
   * none); Lou ([deep codes learned (codeBit), calls made, the step a diversion goes off (0 none),
   * 1 if it's blown, the cake (0 none, 1 coming, 2 blown), the prison day a car waits (0 none; −day:
   * driven off in), 1 if it's blown, the prison day the cake was asked for]); the rest ([the prison
   * day the last money order was asked for (0 never), the dollars waiting at mail call, the prison
   * day a retainer runs out (0 none), the cell tipped off (0 none), inmates overheard today (a bit
   * each), that prison day, 1 once the player has used the phone (inmates queue from then on)]); who has
   * queued today ([the prison day, a bit per inmate per free time: 2k morning, 2k+1 evening]).
   */
  booth: number[];
  line: number[];
  turn: number;
  call: Call | null;
  lou: number[];
  phoned: number[];
  rang: number[];
  /**
   * P35, the internet kiosk (kiosk.ts): the step the time paid for runs out (0: logged out); the
   * post ([the prison day the last letter home was written (0 never), the drawing a reply brings
   * (its place in PHOTOS + 1; 0 none coming), the prison day its letter was written, the item
   * ordered off the shop (0 none coming), the prison day of the last order, the prison day of the
   * last course]); the drawings pinned over
   * the player's bed (PHOTOS places, oldest first); a course under way ([] none: [the step it
   * began, the question (0–4), answers right, the step it was put, the choice said (-1 none yet,
   * -2 time up), the step its answer stops being shown (0 still asked)]).
   */
  kiosk: number;
  post: number[];
  photos: number[];
  course: number[];
  /**
   * P36, the paperwork escape (paperwork.ts): [the prison day the player's name is on the release
   * list for (0 none), the step the way out shuts on them again once cleared (0: shut), the prison
   * day of the last lockdown (0 none: the records look twice at a name after one)].
   */
  release: number[];
  /**
   * Today's blocks as they went (a ROUTINE index each, cleared at 08:00): 0 nothing to say (not
   * yet, or nothing asked), BLOCK.ATTENDED, BLOCK.MISSED (it cost heat or a lockdown), BLOCK.EXCUSED, BLOCK.LEFT (2.23: there, but not long enough).
   */
  blocks: number[];
  /**
   * v2.18 (P39, the parole board, parole.ts P): [the prison day of the hearing (0 none), the prison
   * day the record runs from (the day of applying), 1 if the lawyer filed it, the prison day the
   * player may apply again (0 any), how the last application ended (OUTCOME), its score, the two
   * lines that weighed most (codes; -1 none; a void's reason in the first), 1 once the player has
   * applied this run (the record's own counters run from then), the prison day of the release
   * granted (0 none)]; the ledger's counters as they stood on applying (RECORD order); a hearing
   * under way (null none).
   */
  parole: number[];
  paroleBase: number[];
  hearing: Hearing | null;
  /**
   * v2.19 (P40, the odd jobs board: oddjobs.ts): the job held ([] none; else oddjobs.ts J's fields:
   * its kind, variant, the one who asked, who it's about, the step it runs out, where it came from,
   * its stage, its progress, a number of its own, the pay, the perk and its item, the guards coming
   * at a dig); the record (oddjobs.ts R: the prison day of the pins taken and which, the story's
   * next step and the prison day its last was handed in, who owes the player one).
   */
  oddjob: number[];
  oddjobs: number[];

  /**
   * v2.21 (P42 holidays, holiday.ts): the run's holiday (content/holidays.ts HOLIDAYS index, 0
   * none), set when the run began; the treats taken ([the prison day, a bit per TREAT taken
   * that day]); costume night's laughs ([the prison day, the inmates (indexes) who laughed]; [] none).
   */
  holiday: number;
  hol: number[];
  laughed: number[];

  /**
   * v2.23 (the guards keep watch, PLAN §2): the steps the player has spent in the block's zones
   * so far (checking in takes ROUTINE's `stay`; cleared as a block begins); a search of another
   * inmate's cell (snoop.ts: [] none; else [the container open, the step a guard last saw it at
   * it (0 none yet), 1 once its owner has seen]).
   */
  present: number;
  snoop: number[];
}

/** The player's call on the pay phone (P34): plain data in the state. */
export interface Call {
  /** CALLEE, what's asked (LAWYER or JOB), its argument (Lou's diversion: the hour; a tip: the cell). */
  to: number;
  sub: number;
  arg: number;
  /** The step it began; the step it's over (home, lawyer, tip) or the line's time runs out (Lou). */
  from: number;
  ends: number;
  /** Lou: the line being said (0–2; 3 said), the kind of phrase said on each (TIER, -1 none yet), the guard listening (-1 nobody). */
  at: number;
  said: number[];
  ear: number;
}

export interface Snapshot {
  v: 1;
  prison: string;
  state: SimState;
}

/** How the player moved onto another layer (the 'layer' event, the escape check). */
export type LayerMove = ClimbAction | 'digUp' | 'rope' | 'grapnel' | 'glide';

/**
 * A new game's state: every field with its starting value, in field order (the hash
 * stringifies the state, so the order is part of it). Day 1's coins, stock and favors are
 * the Sim's to add (they draw on the RNG after this).
 */
export function freshState(world: World, prison: PrisonDef, seed: number, mods: readonly string[] = [], holiday = 0): SimState {
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
    mods: [...mods],
    calendar: [],
    eventFlags: 0,
    stowed: false,
    stowCaught: 0,
    dogs: spawnDogs(world),
    scent: [],
    rats: [],
    order: [],
    drops: [],
    visit: 0,
    played: [],
    dice: [],
    bout: [],
    pick: [],
    picked: [],
    cheered: [],
    crew: [],
    brawled: 0,
    crewOut: [],
    waved: 0,
    cheat: null,
    shootout: null,
    shot: [],
    practice: 0,
    board: null,
    elder: [0, 0, 0, 0],
    pantry: [0, 0, 0, 0],
    tipsy: [],
    plots: [],
    race: [],
    match: null,
    ink: null,
    inked: [],
    inkDays: [],
    show: null,
    stageDay: 0,
    quiz: null,
    quizDay: 0,
    acted: [],
    lap: [],
    fresh: 0,
    booth: [-1, 0, 0, 0],
    line: [],
    turn: 0,
    call: null,
    lou: [0, 0, 0, 0, 0, 0, 0, 0],
    phoned: [0, 0, 0, 0, 0, 0, 0],
    rang: [],
    kiosk: 0,
    post: [0, 0, 0, 0, 0, 0],
    photos: [],
    course: [],
    release: [0, 0, 0],
    blocks: ROUTINE.map(() => 0),
    parole: freshParole(),
    paroleBase: [],
    hearing: null,
    oddjob: [],
    oddjobs: [0, 0, 0, 0, 0],
    holiday: holiday > 0 && holiday < HOLIDAYS.length ? holiday : 0,
    hol: [0, 0],
    laughed: [],
    present: 0,
    snoop: [],
  };
}
