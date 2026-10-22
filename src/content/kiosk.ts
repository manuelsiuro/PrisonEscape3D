/**
 * The internet kiosk (P35, docs/PLAN.md §11): a wall terminal in every campaign prison's library,
 * open in the free times outside a lockdown. Logged in, the player pays $1 a block of ten game
 * minutes, up front. Its apps: Mail (a letter home: the week's money order, shared with the
 * phone, and a reply with a family drawing at a later mail call), a Shop of legal goods (cheaper
 * than the merchants, brought at mail call; a thick book among them, for a hollow book), the
 * News (the days ahead, true: they're the calendar's own) and Courses (five questions from the
 * quiz bank: four right, Intellect). Nothing here draws on the state's RNG.
 */
import { itemDef, itemNumber } from './items';
import { STEPS_PER_MINUTE } from '../sim/tuning';

/** What EXT.KIOSK asks (b). Never renumber: logs store them. */
export const KIOSK = {
  /** Logged in (the first block paid), logged out. */
  LOGIN: 0,
  LOGOUT: 1,
  /** A letter home. */
  WRITE: 2,
  /** A shop order (c: its place in SHOP). */
  ORDER: 3,
  /** A course begun; an answer to its question (c: the choice, 0–3); given up. */
  COURSE: 4,
  ANSWER: 5,
  QUIT: 6,
} as const;

/** The kiosk's apps, as its tabs show them (the card's alone: the sim doesn't keep which is open). */
export const APPS = ['mail', 'shop', 'news', 'course'] as const;

/** What a block of time at the screen costs, and how long it lasts (steps). */
export const KIOSK_FEE = 1;
export const KIOSK_BLOCK = 10 * STEPS_PER_MINUTE;

// ------------------------------------------------------------------ mail

/** The family's drawings a reply may bring (text `kiosk.photo.<id>`; drawn by render/Kiosk.ts). Append only. */
export const PHOTOS = ['house', 'dog', 'family', 'sun', 'boat', 'rocket', 'flowers', 'cat'] as const;
/** At most this many pinned over the player's bed (a new one takes the oldest one's place). */
export const PHOTO_WALL = 3;

// ------------------------------------------------------------------ the shop

/** What the shop sells, in its order (EXT.KIOSK ORDER's c). Legal goods only (kiosktest checks). Append only. */
export const SHOP = ['soap', 'chocolate', 'magazine', 'toothpaste', 'talcum', 'ink', 'battery', 'alarm_clock', 'thick_book'] as const;
/** What the shop asks for an item: well under a merchant's price to a stranger (it takes till mail call). */
export const shopPrice = (id: string) => Math.max(1, Math.round(itemDef(itemNumber(id)).value * 0.7));

// ------------------------------------------------------------------ the news

/** The days ahead the news forecasts; how far it looks for the next delivery and visiting day. */
export const NEWS_DAYS = 3;
export const NEWS_AHEAD = 14;

// ------------------------------------------------------------------ courses

/** A course: this many questions, this many right to pass, the Intellect it gives; its fee and the energy it takes. */
export const COURSE_QUESTIONS = 5;
export const COURSE_PASS = 4;
export const COURSE_INT = 3;
export const COURSE_FEE = 5;
export const COURSE_ENERGY = 10;
/** A course's question: this long to answer (steps), its answer shown this long after. */
export const COURSE_STEPS = 10 * STEPS_PER_MINUTE;
export const COURSE_REVEAL = 2 * STEPS_PER_MINUTE;
/** No course begun with less than this left of the free time (game minutes: the longest a course can take), else the kiosk could shut on it. */
export const COURSE_LATE = (COURSE_QUESTIONS * (COURSE_STEPS + COURSE_REVEAL)) / STEPS_PER_MINUTE;

// ------------------------------------------------------------------ the hollow book

/** A thick book cut hollow with a razor blade (recipes.ts) holds one small item: in its slot's upper bits, out of every search's sight but a dog's nose. */
export const BOOK_INT = 30;
