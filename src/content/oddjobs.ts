/**
 * The odd jobs board (P40, docs/PLAN.md §13): a cork board on a canteen wall in every campaign
 * prison (`PrisonDef.board`), three jobs pinned on it each morning (dealt by roll(): nothing here
 * or in the deal draws on the state's RNG), the fixer's own job, and a story chain per prison.
 * One job at a time, on a timer of 1–3 prison days; each ends with the one who asked (paid, a rare
 * item, or a debt: he owes the player one). Every kind is made of things the game already does.
 */
import { STEPS_PER_MINUTE } from '../sim/tuning';

/** The kinds of job (text `oddjob.kind.<id>`). Never renumber: saves store them. */
export const KIND = {
  /** Lift it: a guard's whistle from his pockets (variant 0), the head cook's mug from the kitchen freezer (1), a keepsake from a guard's pockets (2: a chain's). Then to the one who asked. */
  LIFT: 0,
  /** Drop it: the parcel into someone's desk, unseen. */
  DROP: 1,
  /** Frame: the stash into a rival's desk before the guards search it (the one who asked tips them off). */
  FRAME: 2,
  /** Fix the game: lose (variant 0) or win (1) an arm-wrestle with someone. */
  WRESTLE: 3,
  /** Fix the game at Cheat: lose (0) or win (1) a hand against someone. */
  CHEAT: 4,
  /** Fix the game at checkers: lose (0) or win (1) a game with the old-timer. */
  CHECKERS: 5,
  /** The rat: the note into someone's desk, carried by the pet rat. */
  RAT: 6,
  /** The cake: a birthday cake smuggled in at the next visit (or Red Cross parcel), to the one who asked. */
  CAKE: 7,
  /** Lookout: watch while the one who asked digs in his cell, and whistle when a guard comes. */
  LOOKOUT: 8,
  /** Deliver: the parcel into someone's hands, in person. */
  DELIVER: 9,
  /** The tip: an anonymous call on the pay phone about someone's cell. */
  TIP: 10,
  /** The errand: a bag of sugar from a merchant (for a brew), to the one who asked. */
  ERRAND: 11,
} as const;
export const KINDS = ['lift', 'drop', 'frame', 'wrestle', 'cheat', 'checkers', 'rat', 'cake', 'lookout', 'deliver', 'tip', 'errand'] as const;
export type KindId = (typeof KINDS)[number];

/** What a job ends with besides the cash: nothing more, a rare item, a debt (the one who asked owes the player one). */
export const PERK = { NONE: 0, ITEM: 1, DEBT: 2 } as const;

/** Where a job came from (the job's `from`): the board's three pins (0–2), the fixer, the story chain. */
export const FROM = { FIXER: 3, CHAIN: 4 } as const;

/** What EXT.BOARD asks (b): a job taken off the board (c: its pin, 0–2, or 3 the story's), the job held given up. Never renumber. */
export const BOARD = { TAKE: 0, QUIT: 1 } as const;
/** The pins on the board (the story's card is pinned beside them). */
export const PINS = 3;
export const CHAIN_PIN = 3;

/**
 * Each kind: how many prison days it runs (1–3; it ends at 08:00 after the last), the pay
 * (MIN + up to SPAN − 1 dollars, by roll()), the items it hands over or asks for, and whether
 * the fixer deals it.
 */
export interface KindDef {
  days: number;
  pay: number;
  span: number;
  /** Handed to the player as it's taken (into the hotbar). */
  gives?: string;
  /** Brought to the one who asked to finish it. */
  brings?: string;
  /** The fixer's kind of work. */
  fixer?: boolean;
}
export const KIND_DEFS: Record<KindId, KindDef> = {
  lift: { days: 2, pay: 30, span: 21, fixer: true },
  drop: { days: 2, pay: 25, span: 16, gives: 'parcel', fixer: true },
  frame: { days: 2, pay: 35, span: 21, gives: 'stash', fixer: true },
  wrestle: { days: 1, pay: 15, span: 11 },
  cheat: { days: 1, pay: 20, span: 11 },
  checkers: { days: 1, pay: 15, span: 11 },
  rat: { days: 3, pay: 25, span: 16, gives: 'note' },
  cake: { days: 3, pay: 30, span: 16, brings: 'birthday_cake' },
  lookout: { days: 2, pay: 25, span: 16 },
  deliver: { days: 1, pay: 15, span: 11, gives: 'parcel' },
  tip: { days: 2, pay: 25, span: 11, fixer: true },
  errand: { days: 2, pay: 15, span: 11, brings: 'sugar' },
};
/** What the Lift it variants lift (text `oddjob.lift.<id>`): a guard's whistle, the head cook's mug, a chain's keepsake. */
export const LIFTS = ['whistle', 'mug', 'pocket_watch'] as const;
export const LIFT = { WHISTLE: 0, MUG: 1, KEEPSAKE: 2 } as const;

/** The fixer pays this much more for his own job (percent), and asks a friend's opinion of him for it. */
export const FIXER_PAY = 150;
export const FIXER_JOB_OPINION = 50;

/** A pin's chance (in 100) of a perk, and which: a rare item, else a debt. */
export const PERK_ODDS = 35;
export const DEBT_ODDS = 50;
/** The rare items a job may end with (a tool, a pick, something for later). */
export const RARE_ITEMS: readonly string[] = ['screwdriver', 'trowel', 'flimsy_cutters', 'lockpick', 'duct_tape', 'pouch'];
/** What an inmate who owes the player hands over when the debt is called in (TALK.CALL_IN), by roll(). */
export const DEBT_TOOLS: readonly string[] = ['screwdriver', 'trowel', 'flimsy_pickaxe', 'flimsy_cutters', 'metal_file'];

/** A job failed or given up: what the one who asked thinks of it (opinion); a frame caught out: this much heat. */
export const FAIL_OPINION = -15;
export const FRAME_HEAT = 35;
/** A job handed in: what he thinks of the player for it. */
export const PAID_OPINION = 12;

/** Frame: the one who asked tips the guards off at this minute into the prison day (19:00) each day the stash is in place. */
export const FRAME_MINUTE = 11 * 60;
/** A job taken from this minute into the prison day (18:00, the evening free time) on counts its days from the next prison day. */
export const LATE_MINUTE = 10 * 60;

/**
 * Lookout: the dig runs in a free time while the player keeps within WATCH tiles of the digger's
 * cell door (DIG_STEPS of digging in all); a guard within WARN tiles of the digger is coming (a
 * whistle hides the dig for at least HIDE_STEPS, and while he's near); one within CAUGHT tiles who
 * can see in finds him at it. A whistle with nobody coming costs FALSE_STEPS of the dig.
 */
export const DIG_STEPS = 15 * STEPS_PER_MINUTE;
export const WATCH_TILES = 4;
export const WARN_TILES = 6;
export const CAUGHT_TILES = 2;
export const HIDE_STEPS = 2 * STEPS_PER_MINUTE;
export const FALSE_STEPS = 3 * STEPS_PER_MINUTE;

/** The story chain shows from this prison day, a step a prison day at most. */
export const CHAIN_DAY = 2;

/**
 * A step of a story chain: its kind and variant, who it's about (a cell; 0: the guard drawn for
 * it, or nobody), and what it ends with. The one who asks is the chain's own (`ChainDef.who`).
 */
export interface ChainStep {
  kind: number;
  variant: number;
  target: number;
  pay: number;
  perk: number;
  /** PERK.ITEM: what's handed over. */
  item?: string;
}

/** A prison's story chain (text `oddjob.chain.<prison>.title`, `.<k>` a step's card, `.<k>.done` its end). */
export interface ChainDef {
  /** Who it's for (a cell). */
  who: number;
  steps: readonly ChainStep[];
}

const step = (kind: number, variant: number, target: number, pay: number, perk: number = PERK.NONE, item?: string): ChainStep => ({ kind, variant, target, pay, perk, ...(item ? { item } : {}) });

/**
 * The five stories. Center Perks: Doc the old-timer's lost watch (word from Mouse, the watch off a
 * guard, a proper game). Stalag Flucht: Ferret's tunnel (sugar for the cook's spade, a lookout, the
 * camp snitch framed). Shankton: the Preacher's collection (won back at Cheat off Weasel, a parcel to Smokes,
 * Weasel's cell tipped off). San Pancho: Toro's birthday (sugar for the party, a cake through
 * visiting, the birthday arm-wrestle lost). Irongate: Gull's message ashore (a whistle for the
 * signal, a parcel in Kipper's desk, the old-timer kept busy at checkers).
 */
export const CHAINS: Record<string, ChainDef> = {
  'center-perks': { who: 5, steps: [step(KIND.DELIVER, 0, 4, 20), step(KIND.LIFT, LIFT.KEEPSAKE, 0, 40), step(KIND.CHECKERS, 1, 5, 30, PERK.DEBT)] },
  'stalag-flucht': { who: 2, steps: [step(KIND.ERRAND, 0, 3, 20), step(KIND.LOOKOUT, 0, 0, 35), step(KIND.FRAME, 0, 10, 40, PERK.ITEM, 'light_shovel')] },
  shankton: { who: 11, steps: [step(KIND.CHEAT, 1, 10, 25), step(KIND.DELIVER, 0, 4, 20), step(KIND.TIP, 0, 10, 40, PERK.DEBT)] },
  'san-pancho': { who: 7, steps: [step(KIND.ERRAND, 0, 3, 15), step(KIND.CAKE, 0, 0, 35), step(KIND.WRESTLE, 0, 7, 30, PERK.ITEM, 'screwdriver')] },
  irongate: { who: 3, steps: [step(KIND.LIFT, LIFT.WHISTLE, 0, 30), step(KIND.DROP, 0, 11, 35), step(KIND.CHECKERS, 0, 4, 30, PERK.DEBT)] },
};

/**
 * The job held (`state.oddjob`), field by field. PROG: a dig's steps, a frame-up's stash in place,
 * the cake come in, what's to be lifted out of where it was left. AUX: a whistle's hiding, the day of
 * a frame-up's tip, the day the cake found no room. WARN: the guards coming at a dig, a bit each; a
 * drop's or a frame-up's: the fewest of it the desk has held since the job was taken; the cake's: the step it was taken.
 */
export const J = { KIND: 0, VAR: 1, GIVER: 2, TARGET: 3, ENDS: 4, FROM: 5, STAGE: 6, PROG: 7, AUX: 8, PAY: 9, PERK: 10, ITEM: 11, WARN: 12 } as const;
export const JOB_LEN = 13;
/** The record (`state.oddjobs`): [the prison day of the pins taken, which (a bit each), the story's next step, the prison day its last was handed in, who owes the player (a bit per inmate)]. */
export const R = { DAY: 0, PINS: 1, CHAIN: 2, CHAIN_DAY: 3, OWED: 4 } as const;
/** A job's stage: under way, done (back to the one who asked). */
export const STAGE = { ON: 0, DONE: 1 } as const;
