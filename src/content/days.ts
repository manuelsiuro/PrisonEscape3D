/**
 * The day (P17): what each prison's days may hold. A week's deck of event cards (shuffled
 * afresh every week; a quiet card is a day with nothing on), the weather its climate brings
 * (and how often a day's weather lasts into the next), the wind that usually blows, and the
 * warden who reads it all out over the speakers. The plan for a day is worked out in
 * src/sim/systems/calendar.ts; a prison without a row (the Training Block) is always quiet.
 */

/** The day's event. Stored as numbers: append only, never renumber (P21's visiting day and P22's sports day come next). */
export const DAY_EVENTS = ['none', 'inspection', 'drill', 'feast', 'maintenance', 'movie', 'foodFight', 'delivery'] as const;
export type DayEvent = (typeof DAY_EVENTS)[number];

/** The weather. Stored as numbers: append only. In the snow (Stalag Flucht) the storm is a blizzard. */
export const WEATHERS = ['clear', 'fog', 'rain', 'storm', 'heatwave'] as const;
export type Weather = (typeof WEATHERS)[number];

export interface Climate {
  /** Each weather's weight (WEATHERS order) on a day that doesn't keep yesterday's. */
  weights: readonly number[];
  /** Out of 100: the chance a day keeps yesterday's weather (a storm or a heatwave keeps it half as often). */
  keep: number;
  /** Where the wind usually blows from (0 north, clockwise in eighths). */
  wind: number;
}

export interface DayBook {
  /** A week of event cards, every one dealt once a week in a shuffled order. */
  deck: readonly DayEvent[];
  climate: Climate;
  /**
   * The card the delivery (P18) took the place of in the week's deck (the deck keeps its
   * length, so every other day deals as it did): a game saved before P18 keeps it on the day
   * it's loaded.
   */
  before?: DayEvent;
}

/** prison → its days. */
export const DAY_BOOKS: Record<string, DayBook> = {
  // Suburban and mild: a bit of everything, rarely too hot.
  'center-perks': {
    deck: ['none', 'delivery', 'inspection', 'feast', 'movie', 'drill', 'maintenance'],
    climate: { weights: [45, 15, 25, 10, 5], keep: 35, wind: 6 },
    before: 'none',
  },
  // The Alps: clear (snowing), fog in the valleys, blizzards; never rain, never a heatwave.
  // (The Red Cross truck comes once a week.)
  'stalag-flucht': {
    deck: ['none', 'inspection', 'drill', 'delivery', 'feast', 'maintenance', 'movie'],
    climate: { weights: [50, 30, 0, 20, 0], keep: 40, wind: 0 },
    before: 'drill',
  },
  // Industrial and grey: rain and smog, scuffles at meals.
  shankton: {
    deck: ['none', 'inspection', 'foodFight', 'drill', 'maintenance', 'movie', 'none'],
    climate: { weights: [35, 20, 30, 15, 0], keep: 35, wind: 5 },
  },
  // The desert: heatwaves and the odd tropical storm; the yard throws its dinner about; the produce truck once a week.
  'san-pancho': {
    deck: ['none', 'foodFight', 'delivery', 'feast', 'movie', 'inspection', 'drill'],
    climate: { weights: [45, 5, 0, 15, 35], keep: 40, wind: 2 },
    before: 'foodFight',
  },
  // The island: sea fog and squalls, and inspectors on the ferry.
  // (The supply helicopter by day once a week.)
  irongate: {
    deck: ['none', 'inspection', 'delivery', 'drill', 'maintenance', 'movie', 'foodFight'],
    climate: { weights: [35, 30, 20, 15, 0], keep: 35, wind: 7 },
    before: 'inspection',
  },
};

/**
 * When each event happens, as minutes into the prison day (0 is 08:00). Some have a fixed
 * time; the drill and the food fight start at a minute drawn for the day within a window
 * (`[from, to]`, the drill in either of two).
 */
export const EVENT_TIMES: Record<Exclude<DayEvent, 'none'>, { at: number | ReadonlyArray<readonly [number, number]>; length: number }> = {
  // 10:00–16:00.
  inspection: { at: 120, length: 360 },
  // Morning free time (10:15–11:15) or the evening's (19:00–21:00): 20 minutes out in the yard.
  drill: { at: [[135, 195], [660, 780]], length: 20 },
  // Dinner, 17:00–18:00.
  feast: { at: 540, length: 60 },
  // 13:00–13:45: the generator off for its service.
  maintenance: { at: 300, length: 45 },
  // 19:00–21:30, in the canteen.
  movie: { at: 660, length: 150 },
  // 15 minutes of a meal: breakfast (09:05–09:40) or dinner (17:05–17:40).
  foodFight: { at: [[65, 100], [545, 580]], length: 15 },
  // 12:30–14:31: the vehicle in (its search at 14:30, away at 14:31).
  delivery: { at: 270, length: 121 },
};

/** The fire drill: minutes after the bell by which the player must be at roll call, and what missing it costs. */
export const MUSTER_MINUTES = 15;
export const DRILL_HEAT = 40;
/** A clean inspection day (nothing seen, nothing missed): a commendation, in dollars. */
export const COMMENDATION = 25;
/** A feast's tray: this much energy (a meal's is 35), and health back to full. */
export const FEAST_ENERGY = 70;
/** A storm's power cuts: 2 or 3 of them, starting between 23:15 and 04:30 (minutes into the prison day). */
export const OUTAGE_FROM = 915;
export const OUTAGE_TO = 1230;
/** Fog lies thick in the morning (08:00–11:00) and from 19:00 through the night (minutes into the prison day). */
export const FOG_UNTIL = 180;
export const FOG_FROM = 660;
/** A heatwave bites out in the sun from 11:00 to 18:00. */
export const HEAT_FROM = 180;
export const HEAT_UNTIL = 600;

/** How far a guard out in the open sees in this weather (tiles; fog only while it lies thick). */
export const WEATHER_SIGHT: Partial<Record<Weather, number>> = { fog: 4, rain: 6, storm: 5 };
/** How far a noise made out in the open carries in this weather (a share, in tenths). */
export const WEATHER_NOISE: Partial<Record<Weather, number>> = { rain: 6, storm: 4 };
/** The inspectors keep the guards sharp: a tile more sight indoors and out (the weather still has the last word outdoors). */
export const INSPECTION_SIGHT = 1;
/** Contraband in sight during an inspection: twice the heat. */
export const INSPECTION_CONTRABAND = 2;
/** The shakedown on an inspection morning names this many cells. */
export const INSPECTION_CELLS = 4;
/** The film's soundtrack: a noise made in the canteen during movie night carries this share (tenths). */
export const MOVIE_NOISE = 4;

/** The delivery (P18): the supervisor goes to the tail to sign it off this many minutes before the search (14:25: time to walk there from anywhere on its round), and searches from up to this far (tiles). */
export const SIGN_OFF_MINUTES = 5;
export const SEARCH_REACH = 3;
/** After a stowaway is caught, every search is thorough for this many days after (two weeks: the next two deliveries). */
export const WARY_DAYS = 14;
