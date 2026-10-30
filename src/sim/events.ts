/**
 * What a step reports (SimEvent) and the names the events and the state share: why guards
 * took notice, the ways out, what hurt the player, why something was refused.
 */
import type { StationAct } from './systems/economy';
import type { FixtureUse, ItemEvent } from './systems/items';
import type { ToolAction } from './systems/structure';
import type { RatRefusal } from './systems/rats';
import type { DayEvent } from '../content/days';
import type { CheatNews } from './systems/cards';
import type { ShotResult } from './systems/hoops';
import type { CheckersNews } from './systems/checkers';
import type { TrackRefusal } from './systems/races';
import type { FootballNews } from './systems/football';
import type { VoidWhy } from './systems/parole';
import type { HolidayDay } from '../content/holidays';
import type { LayerMove } from './state';

/** Why guards took notice of the player (GDD §5.2). Stored as numbers: never renumber. */
export const SPOT = ['none', 'night', 'restricted', 'contraband', 'recognized', 'wanted', 'bedCheck', 'damage', 'tampering', 'fight', 'keyMissing', 'brawl', 'detector', 'camera', 'searchlight', 'sniper', 'sniffed', 'dogFound', 'gambling', 'tipsy', 'tattooing'] as const;
type SpotReason = (typeof SPOT)[number];
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
  /**
   * v2.21 (P42, holiday.ts): a holiday day begun and over (`day`); the egg hunt's eggs hidden (`n`
   * of them), one found (in the player's pockets); in the water fight; a treat taken from the open
   * furniture (`item`); a pumpkin carved; an inmate laughing at the costume (`who`).
   */
  | { type: 'holiday'; what: HolidayNews; day?: HolidayDay; n?: number; item?: number; who?: number }
  | ItemEvent;

/** What the odd jobs board did (P40, the 'oddjob' event). */
type OddJobNews = 'taken' | 'done' | 'paid' | 'failed' | 'planted' | 'tipped' | 'cake' | 'cakeKept' | 'digging' | 'coming' | 'whistled' | 'falseAlarm' | 'calledIn' | 'owedJoin' | 'chain';
/** Why an odd job failed: its time up, given up, seen dropping it, caught planting the stash, the game's result the wrong way, the dig found. */
export type OddJobFail = 'time' | 'quit' | 'seen' | 'caught' | 'fixed' | 'found';

/** What a holiday did (P42, the 'holiday' event). */
type HolidayNews = 'start' | 'end' | 'hidden' | 'egg' | 'splash' | 'took' | 'carved' | 'laugh';

/** What the pay phone did (P34, the 'phone' event). */
type PhoneNews = 'joined' | 'left' | 'turn' | 'lostTurn' | 'swapped' | 'cut' | 'swing' | 'inmateCall' | 'call' | 'hungUp' | 'home' | 'moneyOrder' | 'mail' | 'appeal' | 'retainer' | 'tip' | 'tipFound' | 'tipEmpty' | 'snitch' | 'said' | 'silence' | 'lou' | 'diversion' | 'ignored' | 'cake' | 'cakeKept' | 'cakeSeized' | 'wheels' | 'overheard';
/** What the parole board did (P39, the 'parole' event). */
type ParoleNews = 'applied' | 'called' | 'sat' | 'question' | 'answer' | 'silent' | 'granted' | 'denied' | 'postponed' | 'missed' | 'walkedOut' | 'voided';
/** What the paperwork did (P36, the 'paper' event). */
type PaperNews = 'filed' | 'passed' | 'found' | 'called' | 'turnedAway' | 'cleared' | 'missed' | 'shut';
/** What the internet kiosk did (P35, the 'kiosk' event). */
type KioskNews = 'login' | 'paid' | 'logout' | 'wrote' | 'ordered' | 'goods' | 'goodsWait' | 'photo' | 'course' | 'question' | 'answer' | 'timeUp' | 'passed' | 'failed' | 'quit' | 'hidden' | 'unhidden';
/** What pruno did (P28, the 'pruno' event). */
type PrunoNews = 'ripe' | 'seized' | 'drunk' | 'stumble' | 'sober';
/** What a garden bed did (P28, the 'garden' event). */
type GardenNews = 'planted' | 'watered' | 'grew' | 'ripe' | 'wilted' | 'died' | 'harvested' | 'refused';
/** A race night (P28, the 'race' event). */
type RaceNews = 'bet' | 'entered' | 'scratched' | 'start' | 'result' | 'off';

/** What the crew did (P23, the 'crew' event). */
type CrewNews = 'order' | 'whistle' | 'recalled' | 'brawl' | 'brawlOver' | 'fetched' | 'handed' | 'fetchFailed' | 'stopped' | 'dirt' | 'nightOver' | 'nightOff' | 'nightOut';

/** A dice game (P22, the 'dice' event). */
type DiceNews = 'rolled' | 'rerolled' | 'won' | 'lost' | 'push';
/** An arm-wrestle (P22, the 'bout' event). */
type BoutNews = 'start' | 'won' | 'lost' | 'draw' | 'gaveUp' | 'off';
/** The lockpick at work (P22, the 'pick' event). */
type PickNews = 'start' | 'set' | 'slip' | 'open' | 'stop';

/** What smuggling did (P21, the 'smuggle' event). */
type SmuggleNews = 'ordered' | 'turnedBack' | 'dropped' | 'seized' | 'collected' | 'visit' | 'noRoom' | 'parcel' | 'parcelSeized' | 'deskFull';

/** What a rat did (P20, the 'rat' event). */
type RatNews = 'caught' | 'fed' | 'tamed' | 'hungry' | 'haveOne' | 'sent' | 'took' | 'left' | 'empty' | 'full' | 'woke' | 'home' | 'chased' | 'loose' | 'calm' | 'gone' | 'refused';

/** What a dog did (P19, the 'dog' event). */
type DogNews = 'sniff' | 'track' | 'lost' | 'point' | 'dug' | 'dazed' | 'fed' | 'friend' | 'full' | 'asleep' | 'woke' | 'rat' | 'brew';

/** What a bribe buys (P15): looking the other way, the paperwork lost; 'over' when the look away ends. */
type BribeKind = 'look' | 'paper' | 'over';

/** What made a noise (P14). */
export type NoiseKind = 'strike' | 'thud' | 'bang' | 'ring' | 'bark' | 'squeak' | 'buzz' | 'stumble' | 'cheer';
/** Why a throw didn't go (i18n `toss.<why>`): nothing in hand, not now, too far, something in the way, nowhere to land. */
export type TossRefusal = 'nothing' | 'busy' | 'far' | 'line' | 'there';

/** The three attributes (GDD §3.2). */
export type Attr = 'str' | 'spd' | 'int';
export const ATTRS: readonly Attr[] = ['str', 'spd', 'int'];
/** Why something social or economic didn't happen (i18n `refused.<why>`). */
export type Refusal = 'closed' | 'cash' | 'room' | 'grudge' | 'opinion' | 'followers' | 'int' | 'taken' | 'favors' | 'missing' | 'worthless' | 'notDone' | 'seatTaken' | 'tipOpinion' | 'tipToday' | 'noTips' | 'noHelicopter' | 'helipadGuards' | 'notUniform' | 'honest' | 'reported' | 'tooHot' | 'lookingAway' | 'clean' | 'paperToday' | 'watched' | 'hunted' | 'ordered' | 'havePhone' | 'noWay' | 'gamesClosed' | 'gameOpinion' | 'played' | 'tired' | 'gamesLockdown' | 'seated' | 'notHisLine' | 'brawlToday' | 'noBrawl' | 'noDrop' | 'nightOpinion' | 'crewLockdown' | 'crewBusy' | 'badPost' | 'crewNight' | 'notShift' | 'notGuard' | 'papersHot' | 'loneWolf' | 'noCourt' | 'elderOpinion' | 'notMeal' | 'takenToday' | 'notWanted' | 'raceClosed' | 'raceFar' | 'betPlaced' | 'noRat' | 'enterFirst' | 'soldEnough' | 'noPitch' | 'fewPlayers' | 'inkOpinion' | 'inkFriend' | 'noGun' | 'noInk' | 'armsFull' | 'haveIt' | 'inkedToday' | 'inkedEnough' | 'stageClosed' | 'performed' | 'actsOn' | 'offStage' | 'noGuitar' | 'quizClosed' | 'quizzed' | 'notAtQuiz' | 'fewQuiz' | 'quizLate' | 'noPhone' | 'phoneClosed' | 'notAtPhone' | 'phoneBusy' | 'phoneLine' | 'onPhone' | 'calledHome' | 'appealed' | 'retained' | 'tipped' | 'badCell' | 'divertBooked' | 'badHour' | 'cakeComing' | 'carBooked' | 'inLine' | 'notInLine' | 'notAhead' | 'lineFirst' | 'phoneDay' | 'noKiosk' | 'kioskClosed' | 'notAtKiosk' | 'loggedOut' | 'loggedIn' | 'wrote' | 'shopToday' | 'orderComing' | 'coursed' | 'inCourse' | 'kioskDark' | 'courseLate' | 'bookFull' | 'onList' | 'trayLate' | 'noParole' | 'paroleOn' | 'atHearing' | 'paroleEarly' | 'paroleWait' | 'notAtDesk' | 'noBoard' | 'notAtBoard' | 'haveJob' | 'noJob' | 'pinTaken' | 'noDeal' | 'fixerToday' | 'notOwed' | 'notHisJob' | 'notLookout' | 'liftFull';
