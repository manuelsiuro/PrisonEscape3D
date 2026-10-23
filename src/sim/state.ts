/**
 * The simulation's state as plain data (what a save, a keyframe or a hash holds), the events
 * a step reports, and where a state comes from: a new game, or a snapshot loaded.
 */
import type { PrisonDef } from '../content/prisons/types';
import { SHOP_SLOTS } from '../content/loot';
import { BLOCK, ROUTINE, routineAt } from '../content/routine';
import { HOLDER, type Favor, type StationAct } from './systems/economy';
import { maxHealth } from './systems/combat';
import { clockAt, dayMinute, prisonDay } from './systems/clock';
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
import { DAY_BOOKS, DAY_EVENTS, EVENT_TIMES, type DayEvent } from '../content/days';
import { CATALOGUE } from '../content/smuggling';
import { BAR, CHIPS, CLAIM_MAX, HAND, STAKES } from '../content/games';
import type { Cheat, CheatNews } from './systems/cards';
import type { Shootout, ShotResult } from './systems/hoops';
import type { Board, CheckersNews } from './systems/checkers';
import type { TrackRefusal } from './systems/races';
import { bedCount } from './systems/garden';
import { BETS, CROP, ODDS_MAX, ODDS_MIN, RAT_START_SPEED } from '../content/long';
import type { FootballNews, Match } from './systems/football';
import type { Ink } from './systems/tattoo';
import type { Show } from './systems/talent';
import type { Quiz } from './systems/quiz';
import { ACT_GAP, CHARTS, countIn, QUIZ_QUESTIONS, REVEAL_STEPS, SONGS, songSteps } from '../content/nights';
import { DESIGNS } from '../content/team';
import { TILE } from './world/tiles';
import { ITEMS } from '../content/items';
import { COURSE_QUESTIONS, KIOSK_BLOCK, PHOTO_WALL, PHOTOS } from '../content/kiosk';
import { J, JOB_LEN, KINDS } from '../content/oddjobs';
import { FREED_STEPS } from '../content/paperwork';
import { HEARING_AFTER, RECORD } from '../content/parole';
import { freshParole, hearingOk, SCORE_MAX, SCORE_MIN, type Hearing, type VoidWhy } from './systems/parole';
import { GUARD_STR, OPINION_START, START_SPD, START_STR, STUDY_TIP_EVERY, UNIT } from './tuning';
import { containersOf } from './world/containers';
import { LAYER, MAP_H, MAP_W, type World } from './world/World';

/** Why guards took notice of the player (GDD §5.2). Stored as numbers: never renumber. */
export const SPOT = ['none', 'night', 'restricted', 'contraband', 'recognized', 'wanted', 'bedCheck', 'damage', 'tampering', 'fight', 'keyMissing', 'brawl', 'detector', 'camera', 'searchlight', 'sniper', 'sniffed', 'dogFound', 'gambling', 'tipsy', 'tattooing'] as const;
export type SpotReason = (typeof SPOT)[number];
/** How the player got out (GDD §12), for the victory screen. Stored as numbers: never renumber. */
export const ESCAPES = ['none', 'fence', 'tunnel', 'roof', 'takeover', 'gate', 'raft', 'helicopter', 'stowaway', 'bluff', 'glider', 'paperwork', 'parole'] as const;
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
  | { type: 'solitary'; on: boolean; taken: number; plot?: boolean }
  | { type: 'infirmary'; taken: number; plot?: boolean }
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
  | { type: 'cash'; n: number; why: 'loot' | 'wage' | 'favor' | 'buy' | 'gift' | 'bribe' | 'commend' | 'order' | 'visit' | 'dice' | 'prize' | 'sale' | 'bet' | 'purse' | 'tattoo' | 'stage' | 'quiz' | 'phone' | 'mail' | 'kiosk' | 'oddjob' }
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
  | { type: 'meal'; feast?: boolean; fresh?: boolean }
  /** P31: a lap of the running track run. */
  | { type: 'lap' }
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
  /** P28: something sold to a merchant (ripe pruno, a vegetable). */
  | { type: 'sold'; who: number; item: number; price: number }
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
  /**
   * P27 (cards.ts, hoops.ts, checkers.ts): a game of Cheat (a round dealt, cards laid (`by` 0 the
   * player, 1 the inmate; `n` how many, `tell` its tell showing), a call (`by` the caller, `lie`,
   * the `cards` turned over, the `loser` of the chip), and its end: won, lost, folded, off); a shot
   * at the hoop (`by` -1 the player, else the inmate; the `spot`, how it went, the `power` and the
   * power it `need`ed) and a shootout begun and ended (as a bout's: `crowd`, `wins`, `spd`, `gain`;
   * the baskets each); the old-timer's board: sat at, got up from, a move (`by`, its `path`; `more`
   * when the jump goes on), the game won, lost or drawn (`int` the point it taught).
   */
  | { type: 'cheat'; what: CheatNews; who: number; round?: number; by?: number; n?: number; tell?: boolean; lie?: boolean; cards?: number[]; loser?: number; stake?: number; late?: boolean }
  | { type: 'hoopShot'; by: number; spot: number; result: ShotResult; power: number; need: number }
  | { type: 'hoops'; what: 'start' | 'won' | 'lost' | 'draw' | 'off' | 'practice'; who: number; crowd?: number; wins?: number; spd?: number; gain?: number; mine?: number; theirs?: number }
  | { type: 'checkers'; what: CheckersNews; who: number; by?: number; path?: number[]; more?: boolean; int?: number; gain?: number }
  /**
   * P28 (pruno.ts, garden.ts, races.ts): pruno ripe at 08:00 (in which `container`, `mine` the
   * player's cell's), seized where a dog smelled it, drunk, a stumble, sober again; a garden bed
   * planted (`crop`), watered (`n` cupfuls today), grown a stage (`n` stages), ripe, wilted, dead,
   * harvested (`n` of its yield), or why not (`why`); the rat's laps on the track (its `speed` now,
   * the `gain`, the bait eaten) or why not; a race night: a bet (`lane`, `stake`, `odds`), the pet
   * entered or scratched, the off, the result (the finishing `order` of lanes, what the bet `won`,
   * the `purse`), or called off (`stake` back).
   */
  | { type: 'pruno'; what: PrunoNews; container?: number; mine?: boolean }
  | { type: 'garden'; what: GardenNews; bed: number; crop?: number; n?: number; why?: 'watered' }
  | { type: 'track'; what: 'trained' | 'refused'; speed?: number; gain?: number; item?: number; why?: TrackRefusal }
  | { type: 'race'; what: RaceNews; lane?: number; stake?: number; odds?: number; order?: number[]; won?: number; purse?: number }
  /**
   * P29 (football.ts, tattoo.ts): a match begun (the `team`), its whistle, a goal (`mine` the
   * player's side's, `by` the scorer: an inmate, -1 the player; the `score`), play on again, a
   * kick of the player's (its `power`) or one at the air, and its end (won with the `crowd`, `spd`
   * and sports day's `wins`; lost, drawn, off, or a foul and the `guards` it drew; `scored` the
   * player's own goals); a tattoo begun, traced (its `quality`, the `pay`, the opinion `gain`),
   * given up or off, or inked on the player's arm (`mine`).
   */
  | { type: 'football'; what: FootballNews; who?: number; team?: number[]; mine?: boolean; by?: number; score?: number[]; power?: number; crowd?: number; spd?: number; wins?: number; guards?: number[]; scored?: number }
  | { type: 'tattoo'; what: 'start' | 'done' | 'quit' | 'off' | 'inked'; who: number; design: number; mine: boolean; quality?: number; pay?: number; gain?: number }
  /**
   * P30 (talent.ts, quiz.ts): the player's act begun (the `song`, the `inst`rument), a note played
   * (its place, `lane`, `grade` 2 good or 3 perfect, its `pitch`), one missed, a stray press; the
   * act over (the `mark`, its `place` among the night's acts, the `prize`, the `crowd` won over, the
   * `heat` the warden let go) or off. A quiz joined (the contestants `who`), a question put (`q`),
   * an answer right or wrong (`by` 0 the player, 1–3 a contestant; the `choice`), time up, and its
   * end: won, a tie, lost (the `pts`, the `prize`, the `int`ellect gained), given up or off.
   */
  | { type: 'stage'; what: 'start' | 'hit' | 'miss' | 'stray' | 'done' | 'off'; song?: number; inst?: number; note?: number; lane?: number; grade?: number; pitch?: number; mark?: number; place?: number; prize?: number; crowd?: number; heat?: number }
  /**
   * The pay phone (P34, phone.ts): the queue (joined, left, the player's turn come and gone, a place
   * bought, cut in, the one pushed back swinging), an inmate's call begun (`who`), the player's call
   * (begun, hung up, done: what it did), the mail, Lou (a line said, silence, the job understood or
   * not, blown or not), his jobs coming off, a tip's search, a secret overheard (`who`).
   */
  | { type: 'phone'; what: PhoneNews; who?: number; to?: number; sub?: number; arg?: number; n?: number; tier?: number; ok?: boolean; blown?: boolean; tile?: number; cell?: number; learned?: number }
  | { type: 'quiz'; what: 'start' | 'question' | 'right' | 'wrong' | 'timeUp' | 'won' | 'tie' | 'lost' | 'quit' | 'off'; who?: number[]; q?: number; by?: number; choice?: number; pts?: number[]; prize?: number; int?: number }
  /**
   * The internet kiosk (P35, kiosk.ts): logged in, a block paid, logged out (`why`); a letter, an
   * order (`item`); at mail call, the goods (or waiting: the desk full) and a photo (`n`: the
   * drawing); a course begun, a question put (`q`), answered (`choice`, `right`), time up, its end
   * (passed with `n` right and `int` gained, or failed; given up); something hidden in a hollow book
   * or taken out of it (`item`).
   */
  | { type: 'kiosk'; what: KioskNews; why?: 'asked' | 'left' | 'closed' | 'broke'; item?: number; n?: number; q?: number; choice?: number; right?: boolean; int?: number }
  /**
   * The paperwork escape (P36, paperwork.ts): a forged form slipped into the release desk's tray
   * (`n` the prison day the name is listed for); the records checked at 22:00, the forgery passing
   * or found; the name called at 10:00, the desk's checks failed (`why`) or passed (the way out open
   * for the player alone), the name not answered, the way out shut again.
   */
  | { type: 'paper'; what: PaperNews; n?: number; why?: 'heat' | 'lockdown' | 'contraband' }
  /**
   * The parole board (P39, parole.ts): applied (`n` the hearing's prison day, `lawyer` by phone);
   * the hearing called at 10:00, the player sat down before the board, a question put (`q`, its
   * `topic`), answered (the `choice`, what it was `worth`, a `lie` caught) or not (silence); the
   * verdict (`score`, the two `lines` that weighed most, `n` the release's day or the day to apply
   * again); put off by a lockdown (`n` the new day), missed, walked out of; voided by plotting (`why`).
   */
  | { type: 'parole'; what: ParoleNews; n?: number; lawyer?: boolean; q?: number; topic?: number; choice?: number; worth?: number; lie?: boolean; score?: number; lines?: number[]; why?: VoidWhy }
  /**
   * The odd jobs board (P40, oddjobs.ts): a job taken (`kind`, from `who`, off pin `from`, for `n`
   * days); its work done; handed in (`n` the pay, `item` and `perk` what came with it); failed
   * (`why`); a frame's stash planted, the guards tipped off (`guard` sent); the birthday cake in
   * (`n` 1: in the desk, from the Red Cross parcel), or kept for the next visit (no room); the
   * lookout's dig begun, a guard coming (`guard`), the whistle, a false alarm; a debt called in
   * (`item`); someone joining the crew on a debt; a story's step told (`n`; `more` steps to come).
   */
  | { type: 'oddjob'; what: OddJobNews; kind?: number; who?: number; from?: number; n?: number; item?: number; perk?: number; why?: OddJobFail; guard?: number; more?: boolean }
  | ItemEvent;

/** What the odd jobs board did (P40, the 'oddjob' event). */
export type OddJobNews = 'taken' | 'done' | 'paid' | 'failed' | 'planted' | 'tipped' | 'cake' | 'cakeKept' | 'digging' | 'coming' | 'whistled' | 'falseAlarm' | 'calledIn' | 'owedJoin' | 'chain';
/** Why an odd job failed: its time up, given up, seen dropping it, caught planting the stash, the game's result the wrong way, the dig found. */
export type OddJobFail = 'time' | 'quit' | 'seen' | 'caught' | 'fixed' | 'found';

/** What the pay phone did (P34, the 'phone' event). */
export type PhoneNews = 'joined' | 'left' | 'turn' | 'lostTurn' | 'swapped' | 'cut' | 'swing' | 'inmateCall' | 'call' | 'hungUp' | 'home' | 'moneyOrder' | 'mail' | 'appeal' | 'retainer' | 'tip' | 'tipFound' | 'tipEmpty' | 'snitch' | 'said' | 'silence' | 'lou' | 'diversion' | 'ignored' | 'cake' | 'cakeKept' | 'cakeSeized' | 'wheels' | 'overheard';
/** What the parole board did (P39, the 'parole' event). */
export type ParoleNews = 'applied' | 'called' | 'sat' | 'question' | 'answer' | 'silent' | 'granted' | 'denied' | 'postponed' | 'missed' | 'walkedOut' | 'voided';
/** What the paperwork did (P36, the 'paper' event). */
export type PaperNews = 'filed' | 'passed' | 'found' | 'called' | 'turnedAway' | 'cleared' | 'missed' | 'shut';
/** What the internet kiosk did (P35, the 'kiosk' event). */
export type KioskNews = 'login' | 'paid' | 'logout' | 'wrote' | 'ordered' | 'goods' | 'goodsWait' | 'photo' | 'course' | 'question' | 'answer' | 'timeUp' | 'passed' | 'failed' | 'quit' | 'hidden' | 'unhidden';
/** What pruno did (P28, the 'pruno' event). */
export type PrunoNews = 'ripe' | 'seized' | 'drunk' | 'stumble' | 'sober';
/** What a garden bed did (P28, the 'garden' event). */
export type GardenNews = 'planted' | 'watered' | 'grew' | 'ripe' | 'wilted' | 'died' | 'harvested' | 'refused';
/** A race night (P28, the 'race' event). */
export type RaceNews = 'bet' | 'entered' | 'scratched' | 'start' | 'result' | 'off';

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
export type DogNews = 'sniff' | 'track' | 'lost' | 'point' | 'dug' | 'dazed' | 'fed' | 'friend' | 'full' | 'asleep' | 'woke' | 'rat' | 'brew';

/** What a bribe buys (P15): looking the other way, the paperwork lost; 'over' when the look away ends. */
export type BribeKind = 'look' | 'paper' | 'over';

/** What made a noise (P14). */
export type NoiseKind = 'strike' | 'thud' | 'bang' | 'ring' | 'bark' | 'squeak' | 'buzz' | 'stumble' | 'cheer';
/** Why a throw didn't go (i18n `toss.<why>`): nothing in hand, not now, too far, something in the way, nowhere to land. */
export type TossRefusal = 'nothing' | 'busy' | 'far' | 'line' | 'there';

/** The three attributes (GDD §3.2). */
export type Attr = 'str' | 'spd' | 'int';
export const ATTRS: readonly Attr[] = ['str', 'spd', 'int'];
/** Why something social or economic didn't happen (i18n `refused.<why>`). */
export type Refusal = 'closed' | 'cash' | 'room' | 'grudge' | 'opinion' | 'followers' | 'int' | 'taken' | 'favors' | 'missing' | 'worthless' | 'notDone' | 'seatTaken' | 'tipOpinion' | 'tipToday' | 'noTips' | 'noHelicopter' | 'helipadGuards' | 'notUniform' | 'honest' | 'reported' | 'tooHot' | 'lookingAway' | 'clean' | 'paperToday' | 'watched' | 'hunted' | 'ordered' | 'havePhone' | 'noWay' | 'gamesClosed' | 'gameOpinion' | 'played' | 'tired' | 'gamesLockdown' | 'seated' | 'notHisLine' | 'brawlToday' | 'noBrawl' | 'noDrop' | 'nightOpinion' | 'crewLockdown' | 'crewBusy' | 'badPost' | 'crewNight' | 'notShift' | 'notGuard' | 'papersHot' | 'loneWolf' | 'noCourt' | 'elderOpinion' | 'notMeal' | 'takenToday' | 'notWanted' | 'raceClosed' | 'raceFar' | 'betPlaced' | 'noRat' | 'enterFirst' | 'soldEnough' | 'noPitch' | 'fewPlayers' | 'inkOpinion' | 'inkFriend' | 'noGun' | 'noInk' | 'armsFull' | 'haveIt' | 'inkedToday' | 'inkedEnough' | 'stageClosed' | 'performed' | 'actsOn' | 'offStage' | 'noGuitar' | 'quizClosed' | 'quizzed' | 'notAtQuiz' | 'fewQuiz' | 'quizLate' | 'noPhone' | 'phoneClosed' | 'notAtPhone' | 'phoneBusy' | 'phoneLine' | 'onPhone' | 'calledHome' | 'appealed' | 'retained' | 'tipped' | 'badCell' | 'divertBooked' | 'badHour' | 'cakeComing' | 'carBooked' | 'inLine' | 'notInLine' | 'notAhead' | 'lineFirst' | 'phoneDay' | 'noKiosk' | 'kioskClosed' | 'notAtKiosk' | 'loggedOut' | 'loggedIn' | 'wrote' | 'shopToday' | 'orderComing' | 'coursed' | 'inCourse' | 'kioskDark' | 'courseLate' | 'bookFull' | 'onList' | 'trayLate' | 'noParole' | 'paroleOn' | 'paroleEarly' | 'paroleWait' | 'notAtDesk' | 'noBoard' | 'notAtBoard' | 'haveJob' | 'noJob' | 'pinTaken' | 'noDeal' | 'fixerToday' | 'notOwed' | 'notHisJob' | 'notLookout';

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
   * yet, or nothing asked), BLOCK.ATTENDED, BLOCK.MISSED (it cost heat or a lockdown), BLOCK.EXCUSED.
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
  // P27: a hand of Cheat, a shootout, a shot held, the old-timer's board; damaged ones are dropped.
  if (!cheatOk(s.cheat, n)) s.cheat = null;
  const so = s.shootout as Shootout | null;
  if (!(so === null || (!!so && typeof so === 'object' && [so.who, so.k, so.mine, so.theirs, so.turn, so.at].every((x) => Number.isInteger(x)) && so.who >= 0 && so.who < n && so.k >= 0 && so.k < 16 && (so.turn === 0 || so.turn === 1) && (so.due === undefined || (Number.isInteger(so.due) && so.due >= 0))))) s.shootout = null;
  const spots = prison.leisure?.hoop.spots.length ?? 0;
  if (!(Array.isArray(s.shot) && (s.shot.length === 0 || (ints(s.shot, 2) && s.shot[1] >= 0 && s.shot[1] < spots)))) s.shot = [];
  if (!Number.isInteger(s.practice) || s.practice < 0) s.practice = 0;
  if (!boardOk(s.board)) s.board = null;
  if (!ints(s.elder, 4) || s.elder.some((x) => x < 0)) s.elder = [0, 0, 0, 0];
  // P28: what was taken, tipsy, the garden (fitted to this prison's plot), tonight's race; damaged ones start again.
  if (ints(s.pantry, 3)) s.pantry = [...s.pantry, 0];
  if (!ints(s.pantry, 4)) s.pantry = [0, 0, 0, 0];
  if (!(Array.isArray(s.tipsy) && (s.tipsy.length === 0 || ints(s.tipsy, 2)))) s.tipsy = [];
  const beds = bedCount(world);
  if (!(Array.isArray(s.plots) && s.plots.length <= beds && s.plots.every((b) => ints(b, 4) && b[0] >= CROP.NONE && b[0] <= CROP.FRUIT && b[1] >= 0 && b[2] >= 0 && b[3] >= 0))) s.plots = [];
  // (A race as it can be: today or before, a lane on the card and a stake with odds when bet, flags 0/1, started no later than now.)
  const raceOk = (r: number[]) => {
    const [day, lane, stake, odds, entered, on, at, seen] = r;
    const bet = lane >= 0 && lane <= 3 && stake >= 0 && stake < BETS.length && odds >= ODDS_MIN && odds <= ODDS_MAX;
    const none = lane === -1 && stake === -1;
    return day >= 1 && day <= prisonDay(st.step) && (bet || none) && [entered, on, seen].every((x) => x === 0 || x === 1) && at >= 0 && at <= st.step;
  };
  if (!(Array.isArray(s.race) && (s.race.length === 0 || (ints(s.race, 8) && raceOk(s.race))))) s.race = [];
  // (The pet rat's racing form, P28: a rat tamed before it, at the start.)
  for (const r of s.rats) if (!r.wild) Object.assign(r, { speed: Number.isInteger(r.speed) ? Math.max(0, Math.min(100, r.speed!)) : RAT_START_SPEED, fed: Number.isInteger(r.fed) ? r.fed : 0, lap: Number.isInteger(r.lap) ? r.lap : 0 });
  // P29: a match or a sitting as they can be (else over), the designs on the player's arms.
  if (!matchOk(s.match, n, s.step)) s.match = null;
  if (!inkOk(s.ink, n)) s.ink = null;
  if (!Array.isArray(s.inkDays) || s.inkDays.length > n || !s.inkDays.every((d) => Number.isInteger(d) && d >= 0)) s.inkDays = [];
  if (!(Array.isArray(s.inked) && s.inked.length <= 3 && s.inked.every((d, k, all) => Number.isInteger(d) && d >= 0 && d < DESIGNS.length && all.indexOf(d) === k))) s.inked = [];
  // P30: an act or a quiz as they can be (else over); a save from before stage nights keeps the cards they took the places of, on the day it's loaded and the next.
  if (!showOk(s.show, s.step)) s.show = null;
  if (!quizOk(s.quiz, n, s.step)) s.quiz = null;
  for (const k of ['stageDay', 'quizDay'] as const) if (!Number.isInteger(s[k]) || s[k] < 0) s[k] = 0;
  if (!(Array.isArray(s.acted) && (s.acted.length === 0 || (ints(s.acted, 2) && s.acted[0] >= 0 && s.acted[1] >= 0 && s.acted[1] < 16)))) s.acted = [];
  // P31: a lap as it can be (else none), fresh meals' step.
  if (!(Array.isArray(s.lap) && (s.lap.length === 0 || (ints(s.lap, 4) && s.lap[0] >= 0 && s.lap[0] < 4 && s.lap[1] >= 0 && s.lap[1] < 4 && Math.abs(s.lap[2]) <= 1 && s.lap[3] >= 0 && s.lap[3] < 4)))) s.lap = [];
  if (!Number.isInteger(s.fresh) || s.fresh < 0) s.fresh = 0;
  // P34: the pay phone as it can be (else nobody on it, nobody queuing, no call), Lou's and the rest's numbers whole.
  if (!(ints(s.booth, 4) && s.booth[0] >= -1 && s.booth[0] < n && s.booth[1] >= 0 && s.booth[2] >= 0 && s.booth[3] >= 0)) s.booth = [-1, 0, 0, 0];
  if (!(Array.isArray(s.line) && s.line.length <= n + 1 && s.line.every((k, i, all) => Number.isInteger(k) && k >= -1 && k < n && all.indexOf(k) === i) && !(s.booth[0] >= 0 && s.line.includes(s.booth[0])))) s.line = [];
  if (!Number.isInteger(s.turn) || s.turn < 0 || s.turn > s.step) s.turn = 0;
  if (!callOk(s.call, s.step, s.guards.length)) s.call = null;
  if (!(ints(s.lou, 8) && s.lou.every((x, k) => k === 5 || x >= 0) && s.lou[4] <= 2)) s.lou = [0, 0, 0, 0, 0, 0, 0, 0];
  if (!(ints(s.phoned, 7) && s.phoned.every((x) => x >= 0))) s.phoned = [0, 0, 0, 0, 0, 0, 0];
  if (!(Array.isArray(s.rang) && (s.rang.length === 0 || ints(s.rang, 2)))) s.rang = [];
  // P35: the kiosk's time as it can be (else logged out), the post's numbers whole, the drawings real, a course as it can be (else none).
  if (!Number.isInteger(s.kiosk) || s.kiosk < 0 || s.kiosk > s.step + KIOSK_BLOCK) s.kiosk = 0;
  if (!(ints(s.post, 6) && s.post.every((x) => x >= 0) && s.post[1] <= PHOTOS.length && (s.post[3] === 0 || (s.post[3] <= ITEMS.length && !ITEMS[s.post[3] - 1].contraband)))) s.post = [0, 0, 0, 0, 0, 0];
  if (!(Array.isArray(s.photos) && s.photos.length <= PHOTO_WALL && s.photos.every((d) => Number.isInteger(d) && d >= 0 && d < PHOTOS.length))) s.photos = [];
  if (!(Array.isArray(s.course) && (s.course.length === 0 || (ints(s.course, 6) && s.course[0] >= 0 && s.course[0] <= s.step && s.course[1] >= 0 && s.course[1] < COURSE_QUESTIONS && s.course[2] >= 0 && s.course[2] <= s.course[1] + 1 && s.course[3] >= s.course[0] && s.course[4] >= -2 && s.course[4] <= 3 && s.course[5] >= 0)))) s.course = [];
  // (A course only while logged in.)
  if (!s.kiosk) s.course = [];
  // P36: the release as it can be (else no name listed, the way out shut).
  if (!(ints(s.release, 3) && s.release[0] >= 0 && s.release[0] <= prisonDay(s.step) + 1 && s.release[1] >= 0 && s.release[1] <= s.step + FREED_STEPS && s.release[2] >= 0 && s.release[2] <= prisonDay(s.step))) s.release = [0, 0, 0];
  // Today's blocks as they went (a save from before them: nothing said of the day so far).
  if (!(ints(s.blocks, ROUTINE.length) && s.blocks.every((b) => b >= 0 && b <= BLOCK.EXCUSED))) {
    s.blocks = ROUTINE.map(() => 0);
    // (The block under way keeps its check-in.)
    if (s.attended && ROUTINE[s.routine]?.miss) s.blocks[s.routine] = BLOCK.ATTENDED;
  }
  // v2.18 (P39): the parole board as it can be (else nothing applied for; a denial's score may be below zero), its counters whole, a hearing as it can be (else none; nor one with no hearing set for today).
  if (!(ints(s.parole, 10) && s.parole.every((x, k) => (k === 5 ? x >= SCORE_MIN && x <= SCORE_MAX : x >= (k === 6 || k === 7 ? -1 : 0))) && s.parole[0] <= prisonDay(s.step) + HEARING_AFTER + 1 && s.parole[9] <= prisonDay(s.step) + 1)) s.parole = freshParole();
  if (!(Array.isArray(s.paroleBase) && (s.paroleBase.length === 0 || ints(s.paroleBase, RECORD.length)))) s.paroleBase = [];
  if (!hearingOk(s.hearing, s.step) || (s.hearing && !(s.parole[8] > 0 && s.parole[0] === prisonDay(s.step)))) s.hearing = null;
  // P40: the job held as it can be (else none), the record whole.
  if (!(Array.isArray(s.oddjob) && (s.oddjob.length === 0 || (ints(s.oddjob, JOB_LEN) && s.oddjob[J.KIND] >= 0 && s.oddjob[J.KIND] < KINDS.length && s.oddjob[J.GIVER] >= 0 && s.oddjob[J.GIVER] < s.inmates.length && s.oddjob[J.TARGET] >= -1 && s.oddjob[J.TARGET] < Math.max(s.inmates.length, s.guards.length) && s.oddjob[J.ENDS] >= 0 && s.oddjob[J.PAY] >= 0 && s.oddjob[J.ITEM] >= 0 && s.oddjob[J.ITEM] <= ITEMS.length)))) s.oddjob = [];
  if (!(ints(s.oddjobs, 5) && s.oddjobs.every((x) => x >= 0))) s.oddjobs = [0, 0, 0, 0, 0];
  // (A save from before no-shows, 2.5.1: the acts whose slots had begun when it was made stand as they did then; those still to come are judged as ever.)
  if (st.acted === undefined) {
    const m = dayMinute(s.step);
    let bits = 0;
    for (let k = 0; k < 4; k++) if (m >= (EVENT_TIMES.talent.at as number) + k * ACT_GAP) bits |= 1 << k;
    s.acted = bits ? [prisonDay(s.step), bits] : [];
  }
  if (st.stageDay === undefined) {
    const was = DAY_BOOKS[prison.id]?.beforeStage;
    for (const day of [prisonDay(st.step), prisonDay(st.step) + 1]) {
      const e = dayPlan(prison.id, s.salt, day, s.calendar, s.mods).event;
      if (was && (e === 'talent' || e === 'quiz')) s.calendar = [...s.calendar, [day, DAY_EVENTS.indexOf(was[e]), -1]];
    }
  }
  // (A damaged save or a replay file's start: a heading that isn't one of the 16 faces south, a
  // place that isn't whole units on the map is where that body started; nobody sees all round
  // or kicks the ball into NaN.)
  const fix = (b: Body | undefined, home: Body) => {
    if (!b || typeof b !== 'object') return;
    if (!Number.isInteger(b.facing) || b.facing < 1 || b.facing > 16) b.facing = 5;
    if (!Number.isSafeInteger(b.x) || !Number.isSafeInteger(b.z) || b.x < 0 || b.z < 0 || b.x >= MAP_W * UNIT || b.z >= MAP_H * UNIT) {
      b.x = home.x;
      b.z = home.z;
    }
    if (typeof b.moving !== 'boolean') b.moving = false;
  };
  fix(s.player, fresh.player);
  s.inmates.forEach((m, k) => {
    fix(m.body, fresh.inmates[k]?.body ?? fresh.player);
    if (!Number.isInteger(m.face) || m.face < 1 || m.face > 16) m.face = 5;
  });
  s.guards.forEach((g, k) => {
    fix(g.body, fresh.guards[k].body);
    if (!Number.isInteger(g.face) || g.face < 1 || g.face > 16) g.face = fresh.guards[k].face;
  });
  s.dogs.forEach((d, k) => fix(d.body, fresh.dogs[k].body));
  // A seat that isn't one any more (the props changed): standing.
  const seat = world.props[s.seat];
  if (s.seat >= 0 && !(seat && fixtureUse(world, seat))) s.seat = -1;
  return s;
}

/** A match as a save holds it (P29): five different inmates, its numbers whole. */
function matchOk(o: Match | null, n: number, step: number): boolean {
  if (o === null) return true;
  if (!o || typeof o !== 'object') return false;
  const int = (x: unknown) => Number.isInteger(x);
  const ints = (v: unknown, k: number) => Array.isArray(v) && v.length === k && v.every(int);
  return (
    int(o.who) &&
    ints(o.team, 5) &&
    o.team.every((k, i, all) => k >= 0 && k < n && all.indexOf(k) === i) &&
    o.team[2] === o.who &&
    [o.from, o.at, o.last, o.pause, o.hold, o.scored, o.restart, o.kick].every(int) &&
    o.kick >= -1 &&
    o.kick <= 1 &&
    ints(o.goals, 2) &&
    o.goals.every((g) => g >= 0) &&
    ints(o.ball, 4) &&
    ints(o.cool, 6) &&
    o.last >= -2 &&
    o.last < 5 &&
    (o.late === undefined || (int(o.late) && o.late >= 0 && o.late <= step)) &&
    (o.feet === undefined || o.feet === 0 || o.feet === 1)
  );
}

/** An act as a save holds it (P30): a song and an instrument there are, a judgement for each of its notes. */
function showOk(o: Show | null, step: number): boolean {
  if (o === null) return true;
  if (!o || typeof o !== 'object') return false;
  // (Begun no later than now, and not yet over: never a song that keeps the player still for ever.)
  return [o.song, o.inst, o.from, o.stray].every((x) => Number.isInteger(x)) && o.song >= 0 && o.song < SONGS.length && o.from <= step && step - o.from <= countIn(o.song) + songSteps(o.song) && o.song >= 0 && o.song < SONGS.length && (o.inst === 0 || o.inst === 1) && o.stray >= 0 && Array.isArray(o.hits) && o.hits.length === CHARTS[o.song].length && o.hits.every((h) => Number.isInteger(h) && h >= 0 && h <= 3);
}

/** The player's call as a save holds it (P34): to someone the phone calls, its numbers whole, Lou's lines as they can be. */
function callOk(c: Call | null, step: number, guards: number): boolean {
  if (c === null) return true;
  if (!c || typeof c !== 'object') return false;
  return (
    [c.to, c.sub, c.arg, c.from, c.ends, c.at, c.ear].every((x) => Number.isInteger(x)) &&
    c.to >= 0 &&
    c.to <= 3 &&
    c.sub >= 0 &&
    c.sub <= 2 &&
    c.arg >= 0 &&
    c.arg < 64 &&
    c.from <= step &&
    c.at >= 0 &&
    c.at <= 3 &&
    c.ear >= -1 &&
    c.ear < guards &&
    Array.isArray(c.said) &&
    c.said.length === 3 &&
    c.said.every((x) => Number.isInteger(x) && x >= -1 && x <= 2)
  );
}

/** A quiz as a save holds it (P30): three different contestants at three of the four places, its numbers whole. */
function quizOk(o: Quiz | null, n: number, step: number): boolean {
  if (o === null) return true;
  if (!o || typeof o !== 'object') return false;
  const ints = (v: unknown, k: number) => Array.isArray(v) && v.length === k && v.every((x) => Number.isInteger(x));
  return (
    ints(o.who, 3) &&
    o.who.every((k, i, all) => k >= 0 && k < n && all.indexOf(k) === i) &&
    ints(o.seats, 4) &&
    [0, 1, 2, 3].every((k) => o.seats.includes(k)) &&
    [o.from, o.q, o.at, o.got, o.until].every((x) => Number.isInteger(x)) &&
    o.from <= step &&
    o.at <= step &&
    o.until <= step + REVEAL_STEPS &&
    o.q >= -1 &&
    o.q < QUIZ_QUESTIONS &&
    o.got >= -1 &&
    o.got <= 3 &&
    ints(o.pts, 4) &&
    o.pts.every((x) => x >= 0) &&
    ints(o.said, 4) &&
    o.said.every((x) => x >= -1 && x <= 3)
  );
}

/** A tattoo sitting as a save holds it (P29). */
function inkOk(o: Ink | null, n: number): boolean {
  if (o === null) return true;
  if (!o || typeof o !== 'object') return false;
  return [o.who, o.design, o.k, o.nx, o.nz, o.err, o.mine, o.seen].every((x) => Number.isInteger(x)) && o.who >= 0 && o.who < n && o.design >= 0 && o.design < DESIGNS.length && o.k >= 0 && o.err >= 0 && [o.mine, o.seen].every((x) => x === 0 || x === 1) && o.nx >= 0 && o.nx <= 1000 && o.nz >= 0 && o.nz <= 1000;
}

/** A hand of Cheat as a save holds it (P27): with someone, at a stake, its chips and cards as they can be. */
function cheatOk(c: Cheat | null, n: number): boolean {
  if (c === null) return true;
  if (!c || typeof c !== 'object') return false;
  const card = (x: unknown) => Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 4;
  const hand = (h: unknown) => Array.isArray(h) && h.length <= HAND && h.every(card);
  return (
    [c.who, c.stake, c.round, c.table, c.turn, c.at, c.by, c.pile, c.lead, c.laid, c.spent].every((x) => Number.isInteger(x)) &&
    c.who >= 0 && c.who < n && c.stake >= 0 && c.stake < STAKES.length && c.table >= 1 && c.table <= 3 && c.turn >= 0 && c.turn <= 2 && c.by >= -1 && c.by <= 1 && (c.lead === 0 || c.lead === 1) &&
    Array.isArray(c.chips) && c.chips.length === 2 && c.chips.every((x) => Number.isInteger(x) && x >= 1 && x <= CHIPS) &&
    hand(c.mine) && hand(c.theirs) && Array.isArray(c.last) && c.last.length <= CLAIM_MAX && c.last.every(card) && typeof c.tell === 'boolean' &&
    (c.due === undefined || (Number.isInteger(c.due) && c.due >= 0))
  );
}

/** The old-timer's board as a save holds it (P27): 32 squares of pieces, whose move, the rest in range. */
function boardOk(b: Board | null): boolean {
  if (b === null) return true;
  if (!b || typeof b !== 'object' || !Array.isArray(b.sq) || b.sq.length !== 32 || !b.sq.every((x) => Number.isInteger(x) && x >= 0 && x <= 4)) return false;
  return [b.turn, b.chain, b.quiet, b.plies, b.at, b.over].every((x) => Number.isInteger(x)) && (b.turn === 0 || b.turn === 1) && b.chain >= -1 && b.chain < 32 && b.over >= 0 && b.over <= 3 && typeof b.seated === 'boolean' && Array.isArray(b.last) && b.last.every((x) => Number.isInteger(x) && x >= 0 && x < 32);
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
