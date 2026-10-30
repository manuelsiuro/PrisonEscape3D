/** What the view is handed each frame (play/frame.ts and play/hunt.ts fill it), and its quality settings. */
import type { BadgeKind, BedPose } from './Character';
import type { SecurityFrame } from './Security';
import type { Focus, GroundItem } from './Pickups';
import type { WeatherFrame } from './Weather';
import type { DeliveryFrame } from './Delivery';
import type { EventsFrame } from './DayEvents';
import type { HolidayFrame } from './Holidays';
import type { DogFrame } from './Dog';
import type { RatFrame } from './Rat';
import type { GetawayFrame } from './Getaway';
import type { SmuggleFrame } from './Smuggling';
import type { GamesFrame } from './Games';
import type { PastimesFrame } from './Pastimes';
import type { LongFrame } from './Long';
import type { TeamFrame } from './Team';
import type { NightsFrame } from './Nights';
import type { PhoneFrame } from './Phone';
import type { KioskFrame } from './Kiosk';
import type { OddJobsFrame } from './OddJobs';
import type { ReleaseFrame } from './Release';

/** What the view needs from the simulation each frame (positions in tiles, already interpolated). */
export interface Frame {
  x: number;
  z: number;
  /** Radians, 0 = facing +z (south). */
  facing: number;
  moving: boolean;
  /** Game time of day in minutes, fractional (lighting). */
  minuteOfDay: number;
  /** Roll call is on or minutes off, or a fire drill musters there (P29: its paint over a football pitch shows only then). */
  rollCall: boolean;
  /** The tile kind under the player (footstep dust and sound). */
  surface: number;
  /** The other inmates, interpolated like the player. */
  inmates: InmateFrame[];
  /** Where the floor arrows lead (tile centers), or null for none. */
  guide: Array<{ x: number; z: number }> | null;
  /** The tap-to-walk target, or null. */
  tap: { x: number; z: number } | null;
  /** A lockdown: red lights pulse. */
  alarm: boolean;
  /** Items on the floor, and a number that changes whenever they do. */
  ground: readonly GroundItem[];
  groundRev: number;
  /** What the action button would use, framed on the floor. */
  focus: Focus | null;
  /** The item in the player's hand and the outfit they wear (item numbers, 0 for none). */
  held: number;
  outfit: number;
  /** Asleep in bed. */
  sleeping: boolean;
  /** Knocked out on the floor. */
  knockedOut: boolean;
  /** The guards, interpolated like everyone else. */
  guards: GuardFrame[];
  /** The layer the player is on (World LAYER). */
  layer: number;
  /** Changes whenever tiles or their wear do (damage is redrawn then), and the wear itself. */
  tilesRev: number;
  wearRev: number;
  /** The desk over the player's tunnel is pushed aside (they went down through it). */
  deskAside: boolean;
  wear: Readonly<Record<number, number>>;
  /** Who the player is locked on to (Cast id: inmates, then guards; -1 none), and whether that's a guard after them. */
  lock: number;
  /** The target is after the player (the ring turns red), or out of reach (it dims). */
  lockHostile: boolean;
  lockFar: boolean;
  /** Training (GDD §3.2): the player's pose (DOING.LIFT, RUN, READ; NOTHING otherwise), where they stand for it (on the treadmill's belt), and a count of reps so far (each one pumps the arms). */
  doing: number;
  trainAt: { x: number; z: number; facing: number; y: number } | null;
  /** Resting on an infirmary bed: where it lies (the player lies on it as in their own bed). */
  restBed: BedPose | null;
  reps: number;
  /** Puddles to mop (tiles), and a number that changes whenever they do. */
  puddles: readonly number[];
  /** P31: the gardener's planters at work (prop index → how far the seedlings have grown, 0–1); the rest grown. */
  planters: ReadonlyMap<number, number>;
  puddlesRev: number;
  /** Mines set off today (P11): their ground tiles. */
  craters: readonly number[];
  /** Security (GDD §5.4–5.6): the power, cameras, searchlights, a sniper's aim. */
  security: SecurityFrame;
  /** A takeover (GDD §12): every door stands open. */
  takeover: boolean;
  /** Firecrackers burning on the floor (P14): their ground tiles. */
  fuses: readonly number[];
  /** The day (P17): the weather over the prison, and the event on (the movie, the food fight, the inspectors). */
  weather: WeatherFrame;
  events: EventsFrame;
  /** Delivery day (P18): where its vehicle is in its day, and the player hidden in it. */
  delivery: DeliveryFrame;
  /** Guard dogs (P19), interpolated; the player's trail ([ground tile, freshness 1 → 0], oldest first). */
  dogs: DogFrame[];
  scent: ReadonlyArray<readonly [number, number]>;
  /** The rats (P20): the pet and any thrown loose, interpolated. */
  rats: RatFrame[];
  /** Smuggling (P21): the drone, what it dropped, visiting day's arches and visitors (null where there's none). */
  smuggle: SmuggleFrame | null;
  /** Side games (P22): an arm-wrestle, dice on the ground, the lockpick's taps, sports day's bunting. */
  games: GamesFrame;
  /** Card sharks (P27): the court's lit spot, the ball, cards on the ground, the old-timer's board. */
  pastimes: PastimesFrame;
  /** Long games (P28): the garden, the rat track and its racers, the pet's laps, tipsy (null: none yet). */
  long: LongFrame | null;
  /** Team & ink (P29): the pitch and the ball. */
  team: TeamFrame;
  /** Stage nights (P30): the stage set up, the quiz's buzzers. */
  nights: NightsFrame;
  /** The pay phone (P34): its handset off the hook, Lou's car waiting on the road. */
  phone: PhoneFrame;
  /** The internet kiosk (P35): logged in or not, the family's drawings over the player's bed. */
  kiosk: KioskFrame;
  /** The odd jobs board (P40): the cards still pinned up today, the player's job tag. */
  oddjobs: OddJobsFrame;
  /** The release desk (P36): the name called, the way out open. */
  release: ReleaseFrame;
  /** P29: the designs inked on the player's arms. */
  inked: readonly number[];
  /** Bluff & glider (P24): the checkpoint's shift change and the player waved through, a glide's preview. */
  getaway: GetawayFrame;
  /** v2.21 (P42): the holiday dressed for, the water fight, New Year's fireworks. */
  holiday: HolidayFrame;
}

export interface GuardFrame {
  x: number;
  z: number;
  facing: number;
  moving: boolean;
  doing: number;
  /** ALERT: the cone's color, none while asleep. */
  alert: number;
  /** Leg pace against the player's walk (they run when chasing). */
  pace: number;
  /** What it holds (a baton while chasing), 0 for nothing. */
  held: number;
  /** Its key still on its belt. */
  hasKey: boolean;
  /** Bribed to look the other way (P15): its cone in the looking-away tint, and steps left. */
  away: boolean;
  awayLeft: number;
  /** Dozing and stirring (0–1): the player at its elbow is about to wake it. */
  stir: number;
  /** How far it sees now (tiles; P17: the weather, the inspectors): its cone is drawn that long. */
  range: number;
}

export interface InmateFrame {
  x: number;
  z: number;
  facing: number;
  moving: boolean;
  /** DOING (sim/systems/inmates.ts). */
  doing: number;
  /** Their cell number (their bed is in it). */
  cell: number;
  /** Fighting the player back. */
  angry: boolean;
  /** The badge over their head: a favor, a shop, the player's letter for them, a follower. */
  badge: BadgeKind;
}

export interface Quality {
  /** Shadow map size; 0 = no shadows. */
  shadows: number;
  /** Shadow edge softness in shadow-map texels (PCF filter radius). */
  softness: number;
  pixelRatio: number;
}
