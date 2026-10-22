import type { Speciality } from '../crew';
import type { DecorPlacement } from '../decor';
import type { JobId } from '../jobs';
import type { PropPlacement } from '../props';
import type { RoutineId } from '../routine';
import type { ZoneId } from '../zones';

/** A rectangle of tiles, corners included: [x0, z0, x1, z1]. */
export type Rect = readonly [number, number, number, number];

/** A stop on a guard's round: a tile, how long it stands there (seconds), which way it looks (1–16, 5 = south). */
export interface Waypoint {
  x: number;
  z: number;
  wait?: number;
  face?: number;
  /** A lazy guard's nap stop (P15): on its night round, between 01:00 and 05:00, it dozes off here. */
  nap?: boolean;
}

/**
 * How a guard goes about the job (P15): steady by the book; lazy (naps on its night round,
 * looks around less); strict (looks around longer, a shakedown of three cells searched
 * slowly, reports a bribe); corrupt (takes bribes).
 */
export type GuardTrait = 'steady' | 'lazy' | 'strict' | 'corrupt';

/** A guard's duties (GDD §5): the rounds it walks, where it stands during some blocks. */
export interface GuardDef {
  /** Its surname (P13: speech bubbles, the target card), the same in every language; unique in the prison. */
  name?: string;
  /** Its round by day, walked in a loop. */
  beat: readonly Waypoint[];
  /** Where it stands instead during some blocks (roll call, meals…). */
  posts?: Partial<Record<RoutineId, Waypoint>>;
  /** Its round at Lights Out; without one it sleeps in the guard quarters. */
  night?: readonly Waypoint[];
  /** Jobs besides: the night bed checks (00:30, 04:00), the morning shakedown (08:00). */
  duties?: ReadonlyArray<'bedCheck' | 'shakedown'>;
  /** The door key it carries on its belt (GDD §10.2: one color each). */
  key: 'yellow' | 'cyan' | 'purple' | 'red' | 'green';
  /** An armored riot guard (HMP Irongate, GDD §4.5): helmet and plates, stronger, blows glance off. */
  riot?: boolean;
  /** One of the helipad's guards (GDD §4.5): the helicopter takes nobody while one is up and about. */
  helipad?: boolean;
  /** Its ways (P15; default steady). A lazy guard has a nap stop on its night round. */
  trait?: GuardTrait;
  /** Its dog (P19): at its side on shift, in the kennel otherwise. */
  dog?: DogDef;
  /**
   * Its life outside the job (P36): its nickname among the staff, its home town, the team it
   * follows, in capitals (A–Z, 5 to 7 letters; the same in every language). Inmates gossip them,
   * and it lets one slip on a chat now and then.
   */
  about?: { nick: string; home: string; team: string };
}

/**
 * A guard dog (P19), bound to its handler: no Cast id, never bites, nobody's to fight. On
 * shift (from prison day 2) 10:00–22:00, 01:00–05:00 too if it works nights, and in every
 * lockdown; at its kennel otherwise. It smells contraband in the hotbar and tracks the
 * player's trail.
 */
export interface DogDef {
  /** Its name, the same in every language; unique in the prison. */
  name: string;
  /** Its kennel: a floor tile, and the way the kennel's door faces (1–16). */
  kennel: Waypoint;
  /** It works the night shift too (its handler walks a night round). */
  night?: boolean;
  /** Its coat (how it's drawn). */
  coat: DogCoat;
}

/** How a dog looks: a black-and-tan shepherd, a brindle mastiff, a cinnamon retriever, a black-and-white collie. */
export type DogCoat = 'shepherd' | 'mastiff' | 'retriever' | 'collie';

/** What a generator powers (GDD §5.5; HMP Irongate splits them between two, §4.5). */
export type PowerUse = 'fence' | 'detectors' | 'cameras' | 'searchlights' | 'lights';

/** The ways out a prison has (GDD §12), as the victory screen names them (`ESCAPES` in sim/state.ts). */
export type EscapeRoute = 'fence' | 'tunnel' | 'roof' | 'takeover' | 'gate' | 'raft' | 'helicopter' | 'stowaway' | 'bluff' | 'glider' | 'paperwork';

/**
 * Delivery day (P18): the vehicle that comes once a week, 12:30–14:31, and the guard who
 * supervises it. All of it data: nothing on the map changes (the vehicle is drawn). While it's
 * in, its bay is solid and stops sight; the doors listed stand open; the supervisor walks its
 * round instead of his own, signs the vehicle off at its tail from 14:25 and searches it at 14:30.
 */
export interface DeliveryDef {
  /** What comes (how it's drawn and named): the supply truck, the Red Cross truck, the produce truck, the supply helicopter. */
  vehicle: 'truck' | 'redCross' | 'produce' | 'helicopter';
  /** Where it stands: its footprint, solid and opaque while it's in. */
  bay: Rect;
  /** The tile at its tail (beside the bay) where a stowaway climbs in, and where the supervisor signs it off. */
  tail: { x: number; z: number };
  /** Which way its nose points (1–16; 5 south). */
  face: number;
  /** Doors that stand open while it's in (the porters carry the load through). */
  open?: ReadonlyArray<{ x: number; z: number }>;
  /** The guard who supervises it (index into guards), and the round he walks meanwhile. */
  supervisor: number;
  round: readonly Waypoint[];
  /** Out of 100: the chance a day's search is thorough (a strict supervisor's always is). */
  thorough: number;
  /** The way it drives in and out (tiles, from off the map to the bay's middle; drawn only). */
  road: ReadonlyArray<{ x: number; z: number }>;
}

/**
 * The checkpoint (P24): the gatekeeper's booth at the gate out, where a player in a guard's
 * uniform shows a fake ID at the shift change and is waved through. All of it data: the booth
 * and its gatekeeper are drawn, nothing on the map changes.
 */
export interface CheckpointDef {
  /** Where the player stands to show the ID (tiles, just inside the first gate). */
  window: ReadonlyArray<{ x: number; z: number }>;
  /** The gates that open for the player once waved through, in the order they're walked (perimeter doors no key opens). */
  gates: ReadonlyArray<{ x: number; z: number }>;
  /** Irongate: the drawbridge (`drawbridge`) comes down for the player too. */
  bridge?: boolean;
  /** The gatekeeper's booth (drawn only, just outside the gate where nobody walks): a tile, and the way its hatch faces (1–16). */
  booth: { x: number; z: number; face: number };
}

/**
 * The pay phone (P34): where the caller stands (the phone hangs on the wall they face: a north
 * wall, facing 13, the camera sees), the queue's tiles nearest the phone first, and the inside of
 * the front gate (where Lou's diversion draws guards), the road where his car waits. All of it data: the phone is drawn,
 * nothing on the map changes.
 */
export interface CommsDef {
  phone: { x: number; z: number; face: number };
  line: ReadonlyArray<{ x: number; z: number }>;
  gate: { x: number; z: number };
  /** Where Lou's getaway car waits on the road (drawn only), and the way it faces to drive off. */
  car: { x: number; z: number; face: number };
  /** P35: the internet kiosk in the library: the tile the player stands on to use it, facing the wall it hangs on. */
  kiosk: { x: number; z: number; face: number };
  /**
   * P36: the release desk. Where a forged release form is slipped into the tray, and where the
   * player reports on the morning their name is on the list (tiles they can walk to at 10:00 with
   * no key); the doors from there to the road, in the order they're walked, that open for them
   * alone once they're cleared (Irongate: the drawbridge comes down too, `bridge`). Route `paperwork`.
   */
  release: { at: ReadonlyArray<{ x: number; z: number }>; gates: ReadonlyArray<{ x: number; z: number }>; bridge?: boolean };
}

/**
 * Smuggling (P21): who sells burner phones, where the fixer's drone drops what's ordered (and
 * when), and where visitors sit on visiting day. All of it data: the drone, the visitors and
 * the arches at the visiting room's doors are drawn.
 */
export interface SmugglingDef {
  /** The fixer: the inmate (by cell) who sells burner phones, during the merchants' hours. */
  fixer: number;
  /** Where the drone drops an order: open ground (it drifts downwind of the middle, and lands inside). */
  drop: Rect;
  /** When it comes (minutes into the prison day, from 08:00): DRONE_HOURS unless set. */
  droneHours?: readonly [number, number];
  /** The room where visitors sit, across a counter or a table, on visiting day; its ways out are scanned as detector arches while visiting hours last. */
  visits?: Rect;
  /** No visits (Stalag Flucht): what a visitor would bring comes in a Red Cross parcel on delivery day. */
  parcel?: boolean;
}

/**
 * How a prison bends the common rules (P8+; each default is Center Perks'). New prisons add
 * what they need here rather than in code: San Pancho's snipers by night too, the tutorial's
 * forgiving routine.
 */
export interface PrisonRules {
  /** The towers' snipers on duty: by day (default; searchlights at night), or always. */
  snipers?: 'day' | 'always';
  /** The tutorial: missed blocks cost nothing; no shakedowns, no bed checks, nobody sent to the generator. */
  relaxed?: boolean;
  /** Contraband in sight adds its heat one step in this many (default 1: +40% a second). */
  contrabandEvery?: number;
  /** Freezing weather (Stalag Flucht, GDD §4.2): a minute outdoors without a warm outfit doubles what energy costs. */
  cold?: boolean;
  /** A lawless interior (San Pancho, GDD §4.4): a few inmates bear the new arrival a grudge from day 1, and grudges are settled in free time and the yard too, not just at meals and in the showers. */
  hostile?: boolean;
  /** How far guards see (tiles; default 7): the Daily's twists (P26) may change it, the weather and the inspectors bend it (P17). */
  sightRange?: number;
}

/**
 * Free time (P27): where a prison's pastimes are, all of it data (drawn by the render: nothing on
 * the map changes). The hoop: its rim over a floor tile, facing into the court (the decor's hoop,
 * on its pole, stands there), and the spots it's shot from (open yard floor, in sight of the rim;
 * see court()).
 * The old-timer: the inmate (by cell) who plays checkers.
 */
export interface LeisureDef {
  hoop: Court;
  oldTimer: number;
  /** P28: the garden plot (a rectangle of beds, a tile each, on open yard soil) and the rat track (its start tile, the way it runs: 1 east, 5 south, 9 west, 13 north, its length in tiles). */
  garden: Plot;
  race: Track;
  /** P29: the football pitch (open yard floor; its goals' nets in the end tiles' middle two). */
  pitch: Pitch;
  /** Where the pitch was before 2.5.1, if it has moved since (replays of runs from then: Sim.rules250). */
  pitchWas?: Pitch;
  /** P30: talent night's stage in the canteen, and quiz night's four places in the library (a prison without day cards has neither). */
  stage?: Stage;
  quiz?: QuizPlace;
  /** P31: the sports ground's running track, round its pitch (its lanes: the edge tiles of this rectangle, open sports floor). */
  track?: Ring;
}

/** A running track (P31): the rectangle whose edge tiles are its lanes, from (x, z), w across and d deep. */
export interface Ring {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** Talent night's stage (P30): the performer's tile and the way they face the room (1, 5, 9 or 13); the boards run a tile either side of it across, and a tile out in front (open canteen floor). */
export interface Stage {
  x: number;
  z: number;
  face: number;
}

/** Quiz night's places (P30): four tiles in a row (open library floor): the player at the nearest, three contestants at the others, all facing the same way (1, 5, 9 or 13). */
export interface QuizPlace {
  spots: ReadonlyArray<{ x: number; z: number }>;
  face: number;
}

/** A football pitch (P29): from (x, z), w across and d deep; the goals at the ends of the longer side, the field between them (content/team.ts). */
export interface Pitch {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** A garden plot (P28): its beds' tiles, from (x, z), w across and d deep. */
export interface Plot {
  x: number;
  z: number;
  w: number;
  d: number;
}

/** The rat track (P28): from the start tile, `len` tiles one way (`dir`); the rats run side by side in lanes across it. */
export interface Track {
  x: number;
  z: number;
  dir: number;
  len: number;
}

/** A basketball hoop (P27): the floor tile under its rim, the way it faces into the court (1, 5, 9 or 13), its SHOOT_SPOTS spots in shooting order. */
export interface Court {
  x: number;
  z: number;
  face: number;
  spots: ReadonlyArray<{ x: number; z: number }>;
}

/** Everything that defines one prison. Maps are ASCII pictures, the rest is plain data. */
export interface PrisonDef {
  id: string;
  /** 1 (minimum security) to 5 (supermax). */
  difficulty: number;
  /** How it looks (render only): Center Perks' suburban green (default), Stalag Flucht's alpine snow, Shankton's industrial grey, San Pancho's desert, HMP Irongate's island in the sea. */
  theme?: 'suburban' | 'alpine' | 'industrial' | 'desert' | 'island';
  /** The ground floor picture (layer 0). */
  ground: string;
  /** The vents picture (layer +1): ducts, ceiling grates, the ladder to the roof. Roofs cover every building; tunnels are dug. */
  vents?: string;
  /** The underground picture (layer -1): `O` boulders in the earth (UNDER_LEGEND). Without one, earth all through. */
  under?: string;
  /** Zones by rectangle; later rectangles win. Unlisted tiles: road → outside, open ground → perimeter, indoor → none. */
  zones: ReadonlyArray<readonly [ZoneId, ...Rect]>;
  /** Cells in order: cell 1 is the player's. */
  cells: readonly Rect[];
  props: readonly PropPlacement[];
  /** Standing spots at roll call, one per inmate (painted on the ground; used by the routine). */
  rollCall: ReadonlyArray<{ x: number; z: number }>;
  /** Where the player starts, as a tile. */
  spawn: { x: number; z: number };
  /** Zones the player must be able to walk to from the cell with no keys or tools (validated). */
  reachable: readonly ZoneId[];
  guards: readonly GuardDef[];
  /** The inmates' nicknames, by cell (cell 2 first); the same in every language. */
  names: readonly string[];
  /** Cells whose inmates run a contraband shop during free time (GDD §10.3). */
  merchants: readonly number[];
  /** What each inmate is good at in a crew (P23), by cell (cell 2 first, as `names`). */
  crew: readonly Speciality[];
  /** The jobs on offer (GDD §11) and who holds each on day 1: a cell number (1: the player), 0 for open. */
  jobs: ReadonlyArray<{ id: JobId; cell: number }>;
  /** Security cameras (GDD §5.6): the floor tile each hangs over (against a wall) and the way it looks (1–16), sweeping ±45°. */
  cameras?: ReadonlyArray<{ x: number; z: number; face: number }>;
  /** Searchlights at night (GDD §5.2), one per tower: the tiles the beam sweeps along, back and forth. */
  searchlights?: ReadonlyArray<ReadonlyArray<{ x: number; z: number }>>;
  /** Decor (P8+): pieces that dress the rooms and nothing else (the simulation never sees them). */
  decor?: readonly DecorPlacement[];
  /** Rules that differ from Center Perks' (P8+). */
  rules?: PrisonRules;
  /** The perimeter gates (doors no key opens; a takeover does). Default: every door beside the road. */
  gates?: ReadonlyArray<{ x: number; z: number }>;
  /** The ways out of this prison (default: fence, tunnel, roof, takeover), for the victory screen and the records. */
  escapes?: readonly EscapeRoute[];
  /**
   * Several generators (HMP Irongate, GDD §4.5): what each powers, in the order the props
   * list them. Without it the prison's one generator powers everything.
   */
  grid?: ReadonlyArray<readonly PowerUse[]>;
  /** Roofs a grapnel swings across onto from another roof, over open ground (Irongate's chasm): their rectangles. */
  landings?: readonly Rect[];
  /** Water a takeover bridges (Irongate's ferry drawbridge, GDD §4.5): walkable while the prison is the inmates'. */
  drawbridge?: Rect;
  /** Its delivery day's vehicle (P18); without one, no delivery (the deck has no such card). */
  delivery?: DeliveryDef;
  /** Smuggling (P21): the fixer, the drone's drop, the visiting room; without it, none. */
  smuggling?: SmugglingDef;
  /** The checkpoint (P24): its window, its gates, its booth; without it, no bluffing out. */
  checkpoint?: CheckpointDef;
  /** Free time (P27): the hoop and its court, the old-timer; without it, neither. */
  leisure?: LeisureDef;
  /** The pay phone (P34): where it hangs, its queue, the front gate; without it, none. */
  comms?: CommsDef;
  /**
   * The map's revision (P31: raised when the prison is rebuilt; none: 0). A save from an older
   * one starts the run again there (saves.ts rebuiltSince).
   */
  map?: number;
}
