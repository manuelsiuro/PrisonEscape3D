import type { DistrictKind, LotUse } from './districts';

/**
 * City Escape's story (C3): what the radio's voice asks for, the things it takes to leave, and the
 * three ways out. Data only: the rules are city/sim/story.ts. Append only: saves store a thing's and a
 * note's place in these lists as a bit, a way out as its number, a line heard as its name.
 */

/**
 * What the story needs found: never in the pockets (a kit of its own, kept through a fall). Each lies
 * in one piece of furniture of a building of the use named: `home`, a house near where the city
 * starts; `near`, the landmark of a district beside the start.
 */
export const THINGS = ['radio', 'aerial', 'beacon', 'avgas', 'flare', 'engine', 'drum', 'chart', 'genpart', 'keycard', 'lamp'] as const;
export type Thing = (typeof THINGS)[number];
export const THING_IN: Record<Thing, LotUse | 'home' | 'near'> = {
  radio: 'home',
  aerial: 'near',
  beacon: 'tower',
  avgas: 'factory',
  flare: 'police',
  engine: 'factory',
  drum: 'station',
  chart: 'rangers',
  genpart: 'mall',
  keycard: 'police',
  lamp: 'rangers',
};
export const thingBit = (id: Thing) => 1 << THINGS.indexOf(id);

/** The ways out (1–3; 0: none chosen): where each starts, and what it takes. */
export interface WayOut {
  id: 'heli' | 'boat' | 'metro';
  kind: DistrictKind;
  needs: readonly Thing[];
}
export const WAYS: readonly WayOut[] = [
  { id: 'heli', kind: 'hospital', needs: ['beacon', 'avgas', 'flare'] },
  { id: 'boat', kind: 'docks', needs: ['engine', 'drum', 'chart'] },
  { id: 'metro', kind: 'metro', needs: ['genpart', 'keycard', 'lamp'] },
];
export const wayOf = (n: number): WayOut | undefined => WAYS[n - 1];

/** What the story remembers beside the kit (bits). */
export const FLAG = { ATE: 1, SLEPT: 2, FIXED: 4 } as const;

/** Notes, logs and signs left about the city: how many (one to a district, the rest anywhere). */
export const NOTES = 10;

/** What Dispatch says, each once, by what brings it (the text: `city.say.<name>`). */
export const BEATS = [
  'radio',
  'fixed',
  'scout1',
  'scout2',
  'scout3',
  'way1',
  'way2',
  'way3',
  ...THINGS.slice(1).map((id) => `got.${id}` as const),
  'all1',
  'all2',
  'all3',
  'ready1',
  'ready2',
  'ready3',
  'gates',
  'lost',
  'fell',
  'shelter',
  'night',
  'win1',
  'win2',
  'win3',
] as const;
export type Beat = (typeof BEATS)[number];
export const isBeat = (v: unknown): v is Beat => typeof v === 'string' && (BEATS as readonly string[]).includes(v);

/** The story's numbers. */
export const STORY = {
  /** Batteries the radio takes (from the pockets, with the aerial). */
  batteries: 2,
  /** The beacon is lit after dark; the helicopter comes this many game minutes later. */
  heliHold: 120,
  /** The metro's gates wind open this many game minutes after the generator starts. */
  metroHold: 90,
  /** The boat leaves on the night's high tide: from, to (minutes of the day; over midnight). */
  tideFrom: 23 * 60,
  tideTo: 2 * 60,
  /** A way out set going: this many more of the dead in its district, one arriving every so many game minutes. */
  extra: 8,
  trickle: 5,
  /** The beacon lit: a barred door of the hospital is torn open every so many game minutes. */
  breachEvery: 20,
  /** The docks' fog, the boat ready: how far the dead see (tiles), and how much further they hear (times). */
  fogSight: 2,
  fogHearing: 2,
} as const;
