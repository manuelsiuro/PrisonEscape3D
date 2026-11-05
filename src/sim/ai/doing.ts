/** What someone is doing where they stand (the view's pose; part of the state). A leaf, so that anything can read it. */
export const DOING = { NOTHING: 0, SLEEP: 1, EAT: 2, EXERCISE: 3, SHOWER: 4, LINE_UP: 5, SEARCH: 6, KNOCKED_OUT: 7, CRAWL: 8, WORK: 9, LIFT: 10, RUN: 11, READ: 12, SIT: 13, SIT_READ: 14, DOZE: 15, WRESTLE: 16, PICK: 17, DICE: 18, BRAWL: 19, LOOKOUT: 20, CARDS: 21, SHOOT: 22, BOARD: 23, FOOTBALL: 24, TATTOO: 25, DRUMS: 26, GUITAR: 27, QUIZ: 28, JOG: 29, PHONE: 30, QUEUE: 31, KIOSK: 32, DIG: 35, SERVE: 36, SHOWER_WAIT: 37, TOWEL: 38, COUNT: 39, BENCH: 40, PULLUP: 41, PUSHUP: 42, BAG: 43 } as const;

/** Using a machine (2.29): an inmate doing one of these is on it, and is asked for a turn rather than talked to. (RUN: on an inmate, only ever the treadmill; a jogger's stride is the view's.) */
export const ON_MACHINE: readonly number[] = [DOING.BENCH, DOING.PULLUP, DOING.RUN, DOING.PUSHUP, DOING.BAG];
