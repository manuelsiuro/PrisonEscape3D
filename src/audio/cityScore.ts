import type { Mood } from './soundMusic';

/**
 * City Escape's own score (2.51): the sealed city in E Phrygian, a key and a colour apart from the
 * prisons' D minor. Five moods on one progression (Em, F, Dm, Em: the flat second is the dread):
 *   cityDay      an empty street: a low drone, a thin pad, a lonely plucked phrase with room round it;
 *   cityNight    the dead are out: the drone and its fifth under a dark, thin chord, a cluster a semitone wide swelling far off,
 *                a slow heartbeat, something metal struck now and then;
 *   cityShelter  behind a barred door at night: the same chords warm and close, a music box;
 *   cityChase    seen and run down: drums on every beat, a biting ostinato, stabs;
 *   cityHold     the last stand at a way out: the chase's drive with an arpeggio climbing over it.
 * Pure of the Web Audio API: it asks for its notes through `Voices` (SoundMusic's own), so
 * `citymusictest` plays it into a list and checks every pitch is of the scale.
 */
export type CityMood = 'cityDay' | 'cityNight' | 'cityShelter' | 'cityChase' | 'cityHold';
export const CITY_MOODS: readonly CityMood[] = ['cityDay', 'cityNight', 'cityShelter', 'cityChase', 'cityHold'];
export const isCityMood = (m: Mood): m is CityMood => (CITY_MOODS as readonly string[]).includes(m);

/** Beats a minute. */
export const CITY_TEMPO: Record<CityMood, number> = { cityDay: 72, cityNight: 54, cityShelter: 60, cityChase: 140, cityHold: 132 };

/** E3, and the scale's steps above it (E Phrygian: E F G A B C D). */
export const CITY_ROOT = 164.81;
export const CITY_SCALE: readonly number[] = [0, 1, 3, 5, 7, 8, 10];
/** Chords in semitones above E3 (the bass first, then four tones going up): Em, F, Dm, Em with its seventh. */
const CHORDS: ReadonlyArray<readonly number[]> = [
  [0, 0, 3, 7, 12],
  [1, 1, 5, 8, 13],
  [-2, -2, 1, 5, 10],
  [0, 0, 7, 10, 15],
];
/** The shelter's: the same notes leaning on their major side (G, C, Am, Em). */
const WARM: ReadonlyArray<readonly number[]> = [
  [3, 3, 7, 10, 15],
  [-4, 8, 12, 15, 20],
  [5, 5, 8, 12, 17],
  [0, 0, 3, 7, 12],
];

/** What the score plays through (SoundMusic's voices; times in seconds, gains as the prisons' score's). */
export interface Voices {
  note(f: number, at: number, dur: number, type: OscillatorType, gain: number, attack?: number, cutoff?: number): void;
  tick(at: number, gain: number): void;
  thump(at: number, gain: number): void;
}

const hz = (semi: number) => CITY_ROOT * 2 ** (semi / 12);

/** A chord held under the rest: two saws a voice, a hair apart, low-passed. */
function pad(v: Voices, chord: readonly number[], at: number, dur: number, gain: number, cutoff: number) {
  for (const semi of chord.slice(1)) {
    v.note(hz(semi), at, dur, 'sawtooth', gain, dur * 0.3, cutoff);
    v.note(hz(semi) * 1.006, at, dur, 'sawtooth', gain * 0.7, dur * 0.35, cutoff);
  }
}

/** Eighth note `k` of the city's score at time `at` (`rnd`: the chances, 0 … 1). */
export function cityBeat(v: Voices, mood: CityMood, at: number, k: number, rnd: () => number = Math.random) {
  const eighth = 60 / CITY_TEMPO[mood] / 2;
  const bar = Math.floor(k / 8);
  const inBar = k % 8;
  const chord = (mood === 'cityShelter' ? WARM : CHORDS)[Math.floor(bar / 2) % CHORDS.length];
  const first = inBar === 0 && bar % 2 === 0;
  switch (mood) {
    case 'cityDay': {
      if (first) {
        v.note(hz(chord[0] - 24), at, eighth * 16, 'sine', 0.12, 0.5);
        pad(v, chord, at, eighth * 16, 0.02, 700);
      }
      // A plucked phrase, two bars long, some of its notes left out: never the same street twice.
      const phrase = bar % 2 === 0 ? [1, -1, -1, 3, -1, 2, -1, -1] : [-1, -1, 4, -1, 3, -1, -1, -1];
      if (phrase[inBar] >= 0 && rnd() < 0.8) v.note(hz(chord[phrase[inBar]] + 12), at, eighth * 5, 'triangle', 0.05, 0.004, 1800);
      // (Glass somewhere, in the wind.)
      if (rnd() < 0.03) v.note(hz(chord[4] + 24), at, eighth * 6, 'sine', 0.012, 0.005);
      return;
    }
    case 'cityNight': {
      if (first) {
        v.note(hz(chord[0] - 24), at, eighth * 16, 'sine', 0.14, 0.6);
        v.note(hz(chord[0] - 17), at, eighth * 16, 'sine', 0.05, 1.2);
        // (What a phone's speaker can carry of it: the fifth two octaves up, and the chord, dark and thin.)
        v.note(hz(chord[0] + 7), at, eighth * 16, 'triangle', 0.024, 1.5, 700);
        pad(v, chord, at, eighth * 16, 0.013, 460);
      }
      // A cluster a semitone wide (the fifth and the sixth over E), swelling in from far off every four bars.
      if (inBar === 0 && bar % 4 === 2) {
        v.note(hz(19), at, eighth * 14, 'sawtooth', 0.011, eighth * 7, 620);
        v.note(hz(20), at, eighth * 14, 'sawtooth', 0.011, eighth * 8, 620);
      }
      // A slow heart, every other bar.
      if (bar % 2 === 1 && inBar < 2) v.thump(at, inBar === 0 ? 0.13 : 0.08);
      // Metal struck, far away: a tone and its untuned partials.
      if (rnd() < 0.045) {
        const f = hz(chord[1 + Math.floor(rnd() * 3)] + 12);
        v.note(f, at, eighth * 7, 'sine', 0.024, 0.004);
        v.note(f * 2.76, at, eighth * 3, 'sine', 0.007, 0.004);
        v.note(f * 5.4, at, eighth * 1.5, 'sine', 0.003, 0.004);
      }
      return;
    }
    case 'cityShelter': {
      if (first) {
        v.note(hz(chord[0] - 24), at, eighth * 16, 'sine', 0.11, 0.5);
        pad(v, chord, at, eighth * 16, 0.026, 1000);
      }
      // A music box, a bar on, a bar off.
      const box = [2, -1, -1, 3, -1, 4, -1, 3];
      if (bar % 2 === 0 && box[inBar] >= 0) {
        const f = hz(chord[box[inBar]] + 12);
        v.note(f, at, eighth * 4, 'sine', 0.034, 0.004);
        v.note(f * 2, at, eighth * 1.5, 'sine', 0.009, 0.004);
      }
      return;
    }
    case 'cityChase':
    case 'cityHold': {
      const hold = mood === 'cityHold';
      // The ostinato: the root, bitten by the flat second and the third (of the scale: one and three semitones up).
      const bite = [0, 0, 1, 0, 0, 0, 3, 1];
      const low = chord[0] - 12 + (chord[0] === 0 ? bite[inBar] : 0);
      v.note(hz(low), at, eighth * 0.9, 'sawtooth', hold ? 0.07 : 0.066, 0.005, hold ? 520 : 440);
      // Drums: every beat in the chase, the first and the third in the hold; a hat between.
      if (hold ? inBar === 0 || inBar === 4 : inBar % 2 === 0) v.thump(at, inBar === 0 ? 0.26 : hold ? 0.18 : 0.15);
      if (!hold && inBar === 7) v.thump(at, 0.1);
      v.tick(at, inBar % 2 === 1 ? 0.034 : 0.016);
      if (hold) {
        // The climb: up the chord and on, a bar and a bar higher.
        const climb = [1, 2, 3, 4, 3, 2, 3, 4];
        v.note(hz(chord[climb[inBar]] + (bar % 2 ? 12 : 0)), at, eighth * 1.4, 'triangle', 0.034, 0.004, 2400);
        if (first) pad(v, chord, at, eighth * 16, 0.024, 800);
      } else if (first) pad(v, chord, at, eighth * 3, 0.024, 900);
      return;
    }
  }
}
