/**
 * Smuggling (P21): what the fixer's people outside can get in, and what it costs. Bought on
 * the burner phone; it comes by drone in the night (the yard's drop area), or with a visitor on
 * visiting day (at Stalag Flucht, in a Red Cross parcel on delivery day). How it plays out is
 * src/sim/systems/smuggling.ts.
 */

/** The catalogue: an item and its price in dollars. Stored as numbers (orders): append only (P22's lockpick joined it; P24's blank ID card will). */
export const CATALOGUE: ReadonlyArray<{ item: string; price: number }> = [
  { item: 'crowbar', price: 70 },
  { item: 'screwdriver', price: 60 },
  { item: 'rope', price: 50 },
  { item: 'balsa', price: 45 },
  { item: 'sheet_metal', price: 40 },
  { item: 'duct_tape', price: 40 },
  { item: 'firecracker', price: 25 },
  { item: 'battery', price: 15 },
  // P22.
  { item: 'lockpick', price: 35 },
];

/** How an order comes: by drone, or with a visitor (a Red Cross parcel where nobody visits). Stored as numbers: never renumber. */
export const WAY = { DRONE: 0, VISITOR: 1 } as const;
/** What each way adds to the price. */
export const FEES: readonly number[] = [20, 10];

/** The burner phone: the fixer sells one to a friend (opinion at least this), for this much. */
export const PHONE_PRICE = 60;
export const PHONE_OPINION = 60;

/** A drone tonight wants this much notice (minutes before its drop); later, it's tomorrow night's. */
export const ORDER_LEAD = 60;
/** The drone's buzz carries this far (tiles), and sends this many guards to look. */
export const DRONE_NOISE = 8;
export const DRONE_GUARDS = 2;
/** Where the drone usually comes (minutes into the prison day): 23:30–02:30; a prison may set its own hours. */
export const DRONE_HOURS: readonly [number, number] = [930, 1110];

/** Seated at a visiting seat this long (steps: 3 game minutes), the visitor sits down across from the player. */
export const VISIT_STEPS = 60;
/** A visitor's gift: $10–20. */
export const GIFT_MIN = 10;
export const GIFT_MAX = 20;

/** The Red Cross parcel (Stalag Flucht): handed out at 14:45 on delivery day (minutes into the prison day), into the player's desk. */
export const PARCEL_MINUTE = 405;
/** How far ahead the schedule looks for the next drone or visiting day (days). */
export const LOOKAHEAD = 28;
