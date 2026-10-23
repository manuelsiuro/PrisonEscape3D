/**
 * What the player asks for during one step, packed in one integer so command logs stay
 * small: bits 0–4 the direction (0 = stand still, 1–16 = a compass point), bits 5–8 a
 * one-step operation (OP), bits 9–16 and 17–24 its two arguments, bits 25–30 a third (OP.EXT).
 * Keyboard, touch and bots all produce the same commands; an operation is sent for exactly
 * one step.
 */
export const DIRS = 16;

/** One-step operations (an item moved, a desk opened…). Never renumber: logs store them. */
export const OP = {
  NONE: 0,
  /** Use what is in front: pick up, open a container, sleep in your bed, climb, cover damage. a = 1: down the tunnel under the open desk. */
  INTERACT: 1,
  /** Close the open container. */
  CLOSE: 2,
  /** Move an item from slot a to slot b (see SLOT), swapping if b is taken. */
  MOVE: 3,
  /** Drop the item in slot a on the floor. */
  DROP: 4,
  /** Craft from the carried slots in mask a (bit k = slot k): the workbench; b = previewed recipe + 1 (0: any). */
  CRAFT: 5,
  /** Wear or wield the item in slot a (outfit or weapon slot). */
  EQUIP: 6,
  /** Hold hotbar slot a in hand. */
  SELECT: 7,
  /** Strike with the tool in hand (chip, cut, unscrew, dig), or eat what is in hand; locked on to someone, a blow at them. Sent every step while held; strikes and blows land at their own pace. a = 1: a fresh press. */
  USE: 8,
  /** Lock on to the next nearest person in reach (past the last: none). a = 1: let go of the lock; a = 2 + id: that person (Cast id). */
  LOCK: 9,
  /** To the inmate the player is talking to (GDD §10.3–10.4): a = TALK action, b its argument. */
  TALK: 10,
  /** At the job board (GDD §11): a = job + 1 to apply for it, 0 to quit the job held. */
  JOB: 11,
  /** Training (GDD §3.2): a = 0 study at the open library shelf, 1 or 2 a press (left, right: they must alternate), 3 stop. (P22: in an arm-wrestle, the presses push and 3 gives up.) */
  TRAIN: 12,
  /** The operations added from P14 on: a = EXT action, b and c its arguments. (14 and 15 stay free.) */
  EXT: 13,
} as const;

/** What OP.EXT asks for. Never renumber: logs store them. */
export const EXT = {
  /** Throw the item in hand (P14): b and c = the ground tile aimed at (see tossArgs), wherever the player is by then. */
  THROW: 1,
  /**
   * The pet rat (P20): sent to fetch from a container or someone's pockets (b and c = its
   * container index, see tossArgs), sent to leave the item in hand there, let loose at the
   * player's feet.
   */
  RAT_FETCH: 2,
  RAT_LEAVE: 3,
  RAT_LOOSE: 4,
  /** Smuggling (P21): an order on the burner phone in hand (b = its place in the catalogue, c = the way it comes: WAY). */
  ORDER: 5,
  /** The crew (P23): someone with an order (b = the inmate's index), whistled back to the player's heels, wherever they both are. */
  RECALL: 6,
  /** Dig up (U, the Dig up button): in a tunnel, a strike up through the floor overhead, whichever way the player faces. */
  DIG_UP: 7,
  /** Hoops (P27): the ball held up for a shot on a spot (b = 0), let go (b = 1). */
  SHOOT: 8,
  /** Long games (P28): fruit, sugar or a seed packet taken from the open furniture (b = TAKE); a race night's bet (b = the lane, c = the stake's place in BETS) or the pet entered (b = RACE_ENTER). */
  TAKE: 9,
  RACE: 10,
  /** Team & ink (P29): a football kick, Space held (b = 0) and let go (b = 1); a tattoo sitting given up (b = 0). */
  KICK: 11,
  INK: 12,
  /** Stage nights (P30): the player's act on talent night (b = the song, c = the instrument), a press in a lane (b = 0–2); quiz night joined (b = 0) or given up (b = 1), an answer (b = the choice, 0–3). */
  STAGE: 13,
  NOTE: 14,
  QUIZ: 15,
  ANSWER: 16,
  /**
   * The pay phone (P34): a call begun at it (b = CALLEE × 16 + what's asked: LAWYER or JOB; c =
   * Lou's diversion's hour, 0–23, or the cell tipped off); a phrase said on Lou's line (b = its
   * place on the card, 0–2; 3 hangs up); the queue (b = LINE).
   */
  CALL: 17,
  SAY: 18,
  LINE: 19,
  /** The internet kiosk (P35): b = what's asked (content/kiosk.ts KIOSK: logging in and out, a letter, an order, a course), c its argument (the shop's item, an answer). */
  KIOSK: 20,
  /** The parole board (P39): b = what's asked (systems/parole.ts PAROLE: applying at the release desk, an answer to the board), c its argument (the answer). */
  PAROLE: 21,
  /**
   * The odd jobs board (P40): at the board (b = content/oddjobs.ts BOARD: a job taken, c its pin,
   * 0–2, or 3 the story's; the job held given up); the lookout's whistle (anywhere: the dig hides).
   */
  BOARD: 24,
  WHISTLE: 25,
  /**
   * The manhunt (P41, its own simulation: sim/hunt/): a stone thrown to draw the searchers off (b
   * and c = the ground tile it lands on, see tossArgs); a treat thrown to a dog (b = the dog,
   * c = which: 0 jerky, 1 pepper, 2 sleepy jerky).
   */
  HUNT_THROW: 27,
  HUNT_TREAT: 28,
  /** v2.21 (P42, holidays): the holiday's treat taken from the open furniture (b = content/holidays.ts TREAT). */
  HOLIDAY: 32,
} as const;

/** What EXT.LINE asks (P34): a place at the end of the queue, out of it, cut in at the front. Never renumber. */
export const LINE = { JOIN: 0, LEAVE: 1, CUT: 2 } as const;

/**
 * What OP.TALK asks for (b: the merchant's slot, the hotbar slot given, the dollars given; a
 * bribe: BRIBE; P21's PHONE: a burner phone from the fixer; P22's games: DICE, b = the stake's
 * place in STAKES; REROLL, b = the dice thrown again (bit 0 the first, bit 1 the second; 0
 * stands); WRESTLE, a bout; P23's CREW, an order to a follower, b = ORDER; P27's CHEAT, a game of
 * Cheat, b = the stake's place in STAKES; PLAY, cards laid, b = which of the hand (bit per card);
 * LIAR, the inmate's last play called; HOOPS, a shootout; CHECKERS, b = 1 to the old-timer's
 * board, 0 up from it, 2 resigning; MOVE, a step on the board, b = from, c = to; P28's SELL, b =
 * the hotbar slot sold to a merchant; BUY's b past the shop's slots, a staple; P29's FOOTBALL, a match captained by the inmate;
 * TATTOO, b = the design inked on him; INK_ME, b = the design he inks on the player; P34's SWAP,
 * his place in the pay phone's queue bought; P40's ODD_JOB, the fixer's own odd job taken; JOB_IN, the odd job held
 * handed in to the one who asked; CALL_IN, the debt he owes the player called in: a tool). Never renumber.
 */
export const TALK = { BUY: 1, GIFT: 2, GIFT_CASH: 3, ACCEPT: 4, HAND_IN: 5, RECRUIT: 6, DISMISS: 7, TIP: 8, BRIBE: 9, PHONE: 10, DICE: 11, REROLL: 12, WRESTLE: 13, CREW: 14, CHEAT: 15, PLAY: 16, LIAR: 17, HOOPS: 18, CHECKERS: 19, MOVE: 20, SELL: 21, FOOTBALL: 22, TATTOO: 23, INK_ME: 24, SWAP: 25, ODD_JOB: 28, JOB_IN: 29, CALL_IN: 30 } as const;

/**
 * What a follower in the crew is told (P23, TALK.CREW's b): back at the player's heels, keep
 * watch here (a lookout), dig with me (a digger), watch my back and start a brawl (muscle),
 * fetch the drop (a smuggler), tonight's the night (anyone who thinks the world of the player:
 * on through Lights Out; told again, off). Never renumber.
 */
export const ORDER = { FOLLOW: 0, WATCH: 1, DIG: 2, BACK: 3, BRAWL: 4, FETCH: 5, NIGHT: 6 } as const;

/** What a bribe to a guard buys (P15, TALK.BRIBE's b): looking the other way, the paperwork lost. Never renumber. */
export const BRIBE = { LOOK: 1, PAPER: 2 } as const;

/** Slot addresses for OP.MOVE / DROP / EQUIP: 0–5 the hotbar, then the weapon, the outfit, then the open container's slots. */
export const SLOT = { HOTBAR: 0, WEAPON: 6, OUTFIT: 7, CONTAINER: 8 } as const;

export const command = (dir: number, op = 0, a = 0, b = 0, c = 0) => (dir & 31) | ((op & 15) << 5) | ((a & 255) << 9) | ((b & 255) << 17) | ((c & 63) << 25);
/** The direction asked for; 17–31 (no compass point: a corrupt or hand-made log) is standing still. */
export const dirOf = (cmd: number) => (cmd & 31) <= DIRS ? cmd & 31 : 0;
export const opOf = (cmd: number) => (cmd >>> 5) & 15;
export const argA = (cmd: number) => (cmd >>> 9) & 255;
export const argB = (cmd: number) => (cmd >>> 17) & 255;
export const argC = (cmd: number) => (cmd >>> 25) & 63;

/**
 * A throw's target, the ground tile aimed at, in the two arguments: its low 8 bits in b, the
 * rest in c. A tile, not an offset: a throw sent while walking still lands where it was aimed
 * (the player's step comes before the throw).
 */
export const tossArgs = (tile: number): [number, number] => [tile & 255, tile >>> 8];
export const tossTile = (b: number, c: number) => b | (c << 8);

/**
 * Unit vectors for the 16 directions, scaled to 1024 and rounded, so every platform gets
 * the same integers. Direction 1 is east (+x), 5 south (+z), 9 west, 13 north.
 */
export const DIR_X = new Int16Array(DIRS + 1);
export const DIR_Z = new Int16Array(DIRS + 1);
for (let d = 1; d <= DIRS; d++) {
  const a = ((d - 1) * Math.PI * 2) / DIRS;
  DIR_X[d] = Math.round(Math.cos(a) * 1024);
  DIR_Z[d] = Math.round(Math.sin(a) * 1024);
}

/** The direction closest to a vector (screen or world, x right and z down); 0 when it's (0, 0). */
export function dirFromVector(x: number, z: number): number {
  if (x === 0 && z === 0) return 0;
  const a = Math.atan2(z, x);
  return (((Math.round((a / (Math.PI * 2)) * DIRS) % DIRS) + DIRS) % DIRS) + 1;
}
