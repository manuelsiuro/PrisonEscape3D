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
import { ORDER } from './command';
import { FEATS, freshFeats, partialLedger } from './systems/ledger';
import { spawnDogs, type Dog } from './systems/k9';
import type { Rat, RatRefusal } from './systems/rats';
import { dayPlan, type ForcedDay } from './systems/calendar';
import { DAY_BOOKS, DAY_EVENTS, type DayEvent } from '../content/days';
import { CATALOGUE } from '../content/smuggling';
import { BAR, STAKES } from '../content/games';
import { TILE } from './world/tiles';
import { ITEMS } from '../content/items';
import { GUARD_STR, OPINION_START, START_SPD, START_STR, STUDY_TIP_EVERY } from './tuning';
import { containersOf } from './world/containers';
import { LAYER, type World } from './world/World';

/** Why guards took notice of the player (GDD §5.2). Stored as numbers: never renumber. */
export const SPOT = ['none', 'night', 'restricted', 'contraband', 'recognized', 'wanted', 'bedCheck', 'damage', 'tampering', 'fight', 'keyMissing', 'brawl', 'detector', 'camera', 'searchlight', 'sniper', 'sniffed', 'dogFound', 'gambling'] as const;
export type SpotReason = (typeof SPOT)[number];
/** How the player got out (GDD §12), for the victory screen. Stored as numbers: never renumber. */
export const ESCAPES = ['none', 'fence', 'tunnel', 'roof', 'takeover', 'gate', 'raft', 'helicopter', 'stowaway', 'bluff', 'glider'] as const;
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
  | { type: 'cantStrike'; why: 'tool' | 'reinforced' | 'boulder' | 'tired' | 'poster' | 'full' | 'noLanding' | 'noRope' | 'noScent' | 'gate' | 'storm' | 'runUp'; action: ToolAction }
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
  | { type: 'layer'; layer: number; from: number; how: LayerMove }
  /** A cover put over damage or taken off it; a brace set up; chocolate eaten. */
  | { type: 'covered'; item: number; on: boolean }
  | { type: 'braced' }
  | { type: 'ate'; item: number }
  /** Dirt down a toilet; a toilet that takes no more for now. */
  | { type: 'flushed'; item: number }
  | { type: 'clogged' }
  /** Guards found damage or evidence (and repaired what they found, after a capture). */
  | { type: 'found'; kind: number }
  /** (P26: `quick`, Quick Fix's morning mending, not what guards found.) */
  | { type: 'repaired'; n: number; quick?: boolean }
  /** Out on the road: free (GDD §4.0), and how. */
  | { type: 'escaped'; via: EscapeRoute; crew?: number[] }
  /** A Three Days run's time is up (P26): the fourth day dawns, the run is over. */
  | { type: 'timeUp' }
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
  | { type: 'cash'; n: number; why: 'loot' | 'wage' | 'favor' | 'buy' | 'gift' | 'bribe' | 'commend' | 'order' | 'visit' | 'dice' | 'prize' }
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
  | { type: 'today'; event: DayEvent; phase: 'start' | 'end' | 'muster' | 'missed' | 'commend' | 'signOff' | 'search' | 'waved' | 'prize'; thorough?: boolean }
  /**
   * Delivery day (P18): into the vehicle and out of it (`found`: pulled out by a thorough
   * search). (The day's delivery itself: 'today' events, its sign-off at 14:29, the search at
   * 14:30, thorough or not, or waved through with nobody there to search.)
   */
  | { type: 'stow'; on: boolean; found?: boolean }
  /** P24: waved through the checkpoint (its gates open for the player), and its gates shut again (`on` false). */
  | { type: 'bluff'; on: boolean }
  /** P24: off a roof's edge on a glider: the roof tile left, the ground tile landed on, how far (tiles), and whether it came down short of where the wind would have carried it. */
  | { type: 'glide'; from: number; to: number; dist: number; short: boolean }
  /**
   * Guard dogs (P19): what a dog (its index in `dogs`) did: smelled contraband on the player and
   * pointed, picked up the trail, lost it, ran the player down at its end, dug up where it led
   * (a way down or up: found), sneezing at pepper, a treat eaten (its trust now), one refused
   * (it's had today's), won over for good (trust at its most), asleep after sleepy jerky, awake again. The player's scent washed off.
   */
  | { type: 'dog'; dog: number; what: DogNews; trust?: number; trail?: boolean }
  | { type: 'washed' }
  /**
   * The pet rat (P20, rats.ts): what a rat did or why it couldn't (`why`): a trap caught one
   * (`at`: its placeKey), a caught rat fed (`item` the bait, `n` its meals so far), tamed, or
   * not (no bait, a rat already); sent on its errand (`item` it carries, `who` whose pockets,
   * Cast id, -1 furniture, `container`), what it found there (took `item` and `cash`, left
   * `item`, nothing to take, no room, the sleeper awake), back on the shoulder; let loose (`n`
   * people scared; `wild` a caught one thrown), its panic over, a thrown one gone. A guard who
   * woke without his key (`keyless`).
   */
  | { type: 'rat'; what: RatNews; item?: number; cash?: number; who?: number; container?: number; n?: number; at?: number; why?: RatRefusal; wild?: boolean; heist?: boolean; floor?: boolean }
  | { type: 'keyless'; guard: number }
  /**
   * Smuggling (P21, smuggling.ts): an order placed on the phone (`item`, `way`); the drone turned
   * back by the sirens (it comes the next night); dropped on a ground `tile`, seized there by a
   * guard (`guard`), picked up by the player; a visit (`cash` the visitor's gift, `item` slipped
   * across, 0 none), a visitor who couldn't hand it over (no room: `item` kept for next time); a
   * Red Cross parcel put in the player's desk, or seized in the vehicle's search, or waiting for
   * room in the desk.
   */
  | { type: 'smuggle'; what: SmuggleNews; item?: number; way?: number; tile?: number; guard?: number; cash?: number }
  /**
   * Side games (P22, games.ts): the dice thrown (the player's, `mine`), thrown again (`mask`: which), and how the
   * game went (`theirs`, the inmate's throw; the stake changes hands as a 'cash' event); an
   * arm-wrestle begun and how it ended (`crowd`: inmates watching a win who cheered (once a day each),
   * `wins`: bouts won on sports day so far, `str`: Strength gained (0 at the top), `gain`: the loser's opinion as it moved); a lock being picked: begun, a pin set, the pick slipping, the door open,
   * given up (`pin` pins set, `of` in all).
   */
  | { type: 'dice'; what: DiceNews; who: number; stake: number; mine: number[]; theirs?: number[]; mask?: number }
  | { type: 'bout'; what: BoutNews; who: number; crowd?: number; wins?: number; str?: number; gain?: number }
  | { type: 'pick'; what: PickNews; tile: number; pin?: number; of?: number }
  /**
   * The crew (P23, crew.ts): an order taken (`order`: ORDER), a lookout's whistle (`guard`
   * coming), someone with an order whistled back; a brawl started (`other`: the inmate he
   * scraps with, `guards` sent) and over; the drop picked up (`item`), handed over, or given up
   * (`why`); an ambush stopped by the muscle (`other`: who meant to jump the player); the dirt or
   * rubble taken off the player's hands (`item`); the night's company over at 06:00, called off
   * before it, and staying on as Lights Out begins.
   */
  | { type: 'crew'; what: CrewNews; who: number; order?: number; guard?: number; other?: number; guards?: number[]; item?: number; why?: 'gone' | 'far' }
  | ItemEvent;

/** What the crew did (P23, the 'crew' event). */
export type CrewNews = 'order' | 'whistle' | 'recalled' | 'brawl' | 'brawlOver' | 'fetched' | 'handed' | 'fetchFailed' | 'stopped' | 'dirt' | 'nightOver' | 'nightOff' | 'nightOut';

/** A dice game (P22, the 'dice' event). */
export type DiceNews = 'rolled' | 'rerolled' | 'won' | 'lost' | 'push';
/** An arm-wrestle (P22, the 'bout' event). */
export type BoutNews = 'start' | 'won' | 'lost' | 'draw' | 'gaveUp' | 'off';
/** The lockpick at work (P22, the 'pick' event). */
export type PickNews = 'start' | 'set' | 'slip' | 'open' | 'stop';

/** What smuggling did (P21, the 'smuggle' event). */
export type SmuggleNews = 'ordered' | 'turnedBack' | 'dropped' | 'seized' | 'collected' | 'visit' | 'noRoom' | 'parcel' | 'parcelSeized' | 'deskFull';

/** What a rat did (P20, the 'rat' event). */
export type RatNews = 'caught' | 'fed' | 'tamed' | 'hungry' | 'haveOne' | 'sent' | 'took' | 'left' | 'empty' | 'full' | 'woke' | 'home' | 'chased' | 'loose' | 'calm' | 'gone' | 'refused';

/** What a dog did (P19, the 'dog' event). */
export type DogNews = 'sniff' | 'track' | 'lost' | 'point' | 'dug' | 'dazed' | 'fed' | 'friend' | 'full' | 'asleep' | 'woke' | 'rat';

/** What a bribe buys (P15): looking the other way, the paperwork lost; 'over' when the look away ends. */
export type BribeKind = 'look' | 'paper' | 'over';

/** What made a noise (P14). */
export type NoiseKind = 'strike' | 'thud' | 'bang' | 'ring' | 'bark' | 'squeak' | 'buzz';
/** Why a throw didn't go (i18n `toss.<why>`): nothing in hand, not now, too far, something in the way, nowhere to land. */
export type TossRefusal = 'nothing' | 'busy' | 'far' | 'line' | 'there';

/** The three attributes (GDD §3.2). */
export type Attr = 'str' | 'spd' | 'int';
export const ATTRS: readonly Attr[] = ['str', 'spd', 'int'];
/** Why something social or economic didn't happen (i18n `refused.<why>`). */
export type Refusal = 'closed' | 'cash' | 'room' | 'grudge' | 'opinion' | 'followers' | 'int' | 'taken' | 'favors' | 'missing' | 'worthless' | 'notDone' | 'seatTaken' | 'tipOpinion' | 'tipToday' | 'noTips' | 'noHelicopter' | 'helipadGuards' | 'notUniform' | 'honest' | 'reported' | 'tooHot' | 'lookingAway' | 'clean' | 'paperToday' | 'watched' | 'hunted' | 'ordered' | 'havePhone' | 'noWay' | 'gamesClosed' | 'gameOpinion' | 'played' | 'tired' | 'gamesLockdown' | 'seated' | 'notHisLine' | 'brawlToday' | 'noBrawl' | 'noDrop' | 'nightOpinion' | 'crewLockdown' | 'crewBusy' | 'badPost' | 'crewNight' | 'notShift' | 'notGuard' | 'papersHot' | 'loneWolf';

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
export function freshState(world: World, prison: PrisonDef, seed: number, mods: readonly string[] = []): SimState {
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
  const days = (v: unknown) => Array.isArray(v) && v.every((d) => Array.isArray(d) && (d.length === 3 || d.length === 5) && d.every((x) => Number.isInteger(x)));
  if (!days(st.calendar)) s.calendar = [[prisonDay(st.step), 0, 0]];
  if (!Number.isInteger(s.eventFlags)) s.eventFlags = 0;
  // A save from before delivery day (P18): the day it was made on, and tomorrow (the forecast, the gossip may have named it), keep the card the delivery took the place of.
  if (st.stowed === undefined) {
    const before = DAY_EVENTS.indexOf(DAY_BOOKS[prison.id]?.before ?? 'none');
    for (const day of [prisonDay(st.step), prisonDay(st.step) + 1]) if (dayPlan(prison.id, s.salt, day, s.calendar, s.mods).event === 'delivery') s.calendar = [...s.calendar, [day, before, -1]];
  }
  if (typeof s.stowed !== 'boolean') s.stowed = false;
  if (!Number.isInteger(s.stowCaught)) s.stowCaught = 0;
  // The dogs (P19): a save from before them (or for a prison whose dogs changed) has them in their kennels; a trail that isn't one is gone.
  s.dogs = Array.isArray(st.dogs) && st.dogs.length === fresh.dogs.length ? st.dogs.map((d, k) => ({ ...fresh.dogs[k], ...d })) : fresh.dogs;
  if (!Array.isArray(s.scent) || !s.scent.every((e) => Array.isArray(e) && (e.length === 2 || e.length === 3) && e.every((x) => Number.isInteger(x)))) s.scent = [];
  // The rats (P20): a save from before them has none (nor one that isn't a list of them).
  if (!Array.isArray(s.rats) || !s.rats.every((r) => !!r && typeof r === 'object' && Number.isInteger(r.mode) && Array.isArray(r.path))) s.rats = [];
  // (An errand to a container this prison no longer has, after a map edit: it gives it up and comes back.)
  // (RAT.OUT is 1, RAT.WAIT 4: an errand to nowhere waits instead.)
  for (const r of s.rats) if (r.target >= s.items.containers.length || (r.mode === 1 && r.target < 0)) Object.assign(r, { target: -1, mode: 4, path: [], at: 0 });
  // Smuggling (P21): a save from before it keeps the card visiting day took the place of, on the day it's loaded and the next (as delivery day did, P18).
  if (st.order === undefined) {
    const before = DAY_EVENTS.indexOf(DAY_BOOKS[prison.id]?.beforeVisits ?? 'none');
    for (const day of [prisonDay(st.step), prisonDay(st.step) + 1]) if (dayPlan(prison.id, s.salt, day, s.calendar, s.mods).event === 'visiting') s.calendar = [...s.calendar, [day, before, -1]];
  }
  const ints = (v: unknown, n: number) => Array.isArray(v) && v.length === n && v.every((x) => Number.isInteger(x));
  // (A damaged one: an order for nothing in the catalogue, a way that doesn't exist, a drop of no item.)
  if (!(Array.isArray(s.order) && (s.order.length === 0 || (ints(s.order, 3) && s.order[0] >= 0 && s.order[0] < CATALOGUE.length && (s.order[1] === 0 || s.order[1] === 1))))) s.order = [];
  if (!Array.isArray(s.drops) || !s.drops.every((d) => ints(d, 3) && d[1] >= 1 && d[1] <= ITEMS.length)) s.drops = [];
  // (A drop with nothing lying where it says: forgotten, never counted as picked up.)
  s.drops = s.drops.filter(([key, item]) => s.items.ground.some(([k, v]) => k === key && (v & 255) === item));
  if (!Number.isInteger(s.visit)) s.visit = 0;
  // Side games (P22): a save from before them keeps the card sports day took the place of, on the day it's loaded and the next.
  if (st.played === undefined) {
    const before = DAY_EVENTS.indexOf(DAY_BOOKS[prison.id]?.beforeSports ?? 'none');
    for (const day of [prisonDay(st.step), prisonDay(st.step) + 1]) if (dayPlan(prison.id, s.salt, day, s.calendar, s.mods).event === 'sports') s.calendar = [...s.calendar, [day, before, -1]];
  }
  // (A damaged one: games with nobody, dice that aren't dice, a lock where there's no door.)
  const n = s.inmates.length;
  if (!Array.isArray(s.played) || !s.played.every((x) => Number.isInteger(x) && x >= 0)) s.played = [];
  if (!(Array.isArray(s.dice) && (s.dice.length === 0 || (ints(s.dice, 4) && s.dice[0] >= 0 && s.dice[0] < n && s.dice[1] >= 0 && s.dice[1] < STAKES.length && [s.dice[2], s.dice[3]].every((d) => d >= 1 && d <= 6))))) s.dice = [];
  if (!(Array.isArray(s.bout) && (s.bout.length === 0 || (ints(s.bout, 4) && s.bout[0] >= 0 && s.bout[0] < n && s.bout[1] > 0 && s.bout[1] < BAR)))) s.bout = [];
  const door = (t: number) => t >= 0 && t < world.ground.kind.length && world.ground.base[t] === TILE.DOOR;
  if (!(Array.isArray(s.pick) && (s.pick.length === 0 || (ints(s.pick, 3) && door(s.pick[0]) && s.pick[1] >= 0)))) s.pick = [];
  if (!Array.isArray(s.cheered) || !s.cheered.every((x) => Number.isInteger(x) && x >= 0)) s.cheered = [];
  if (!(Array.isArray(s.picked) && (s.picked.length === 0 || (ints(s.picked, 3) && door(s.picked[0]))))) s.picked = [];
  // The crew (P23): orders to someone who isn't following any more, or that aren't orders, are forgotten.
  const tiles = world.ground.kind.length;
  const crewOk = (c: unknown, k: number, all: unknown[]) => {
    if (!ints(c, 5)) return false;
    const [who, order, arg, aux, night] = c as number[];
    if (!s.followers.includes(who) || order < 0 || order > ORDER.FETCH || (night !== 0 && night !== 1) || all.findIndex((o) => (o as number[])[0] === who) !== k) return false;
    if (order === ORDER.WATCH) return arg >= 0 && arg < tiles;
    if (order === ORDER.DIG) return arg < tiles && aux < tiles;
    if (order === ORDER.BRAWL) return aux >= 0 && aux < n && aux !== who;
    if (order === ORDER.FETCH) return arg >= 0 || (aux >= 1 && aux <= ITEMS.length);
    return true;
  };
  s.crew = Array.isArray(s.crew) ? s.crew.filter(crewOk) : [];
  if (!Number.isInteger(s.brawled)) s.brawled = 0;
  if (!Array.isArray(s.crewOut) || !s.crewOut.every((x, k, all) => Number.isInteger(x) && x >= 0 && x < n && all.indexOf(x) === k)) s.crewOut = [];
  if (!Number.isInteger(s.waved) || s.waved < 0) s.waved = 0;
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
