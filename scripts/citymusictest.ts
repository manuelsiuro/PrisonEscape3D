/**
 * City Escape's own score (2.51): each of its five moods played into a list for 64 bars and read back.
 * Every pitch is of the scale (E Phrygian) to within a detuned saw's width, the untuned partials struck
 * with a tuned note aside; no note over a gain of 0.14 (the night's drone; the prisons' loudest is 0.13);
 * no mood goes two bars without something a small speaker can play (drums and sines under 150 Hz not
 * counted); the chase and the hold are the fast ones. And the rule that picks the mood, walked
 * through a night: the hold before all, the chase lingering four seconds, the shelter only after dark.
 */
import { check } from './assert';
import { CITY_MOODS, CITY_ROOT, CITY_SCALE, CITY_TEMPO, cityBeat, isCityMood, type Voices } from '../src/audio/cityScore';
import { CHASE_LINGER, CityMusic, type MusicCue } from '../src/city/music';

const lines: string[] = [];
const BARS = 64;
/** A small seeded generator: the same chances on every machine. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** How far a frequency is from the nearest note of the scale, in cents. */
function off(f: number) {
  const semi = 12 * Math.log2(f / CITY_ROOT);
  let best = Infinity;
  for (const s of CITY_SCALE) {
    const d = ((((semi - s) % 12) + 18) % 12) - 6;
    best = Math.min(best, Math.abs(d) * 100);
  }
  return best;
}

for (const mood of CITY_MOODS) {
  const notes: Array<{ f: number; at: number; dur: number; gain: number; type: string }> = [];
  let ticks = 0;
  let thumps = 0;
  const perBar = new Array<number>(BARS).fill(0);
  /** When a tuned note was last struck: a partial is one only at that moment. */
  const struck = new Set<number>();
  let bar = 0;
  const v: Voices = {
    note: (f, at, dur, type, gain) => {
      notes.push({ f, at, dur, gain, type });
      // (Heard on a phone: not the sub-bass.)
      if (f >= 150 || (type !== 'sine' && f >= 80)) perBar[bar]++;
      if (off(f) <= 12) struck.add(at);
    },
    tick: (_, gain) => {
      ticks++;
      perBar[bar]++;
      check(gain > 0 && gain <= 0.05, `${mood}: a hat's gain ${gain}`);
    },
    thump: (_, gain) => {
      thumps++;
      check(gain > 0 && gain <= 0.3, `${mood}: a drum's gain ${gain}`);
    },
  };
  const rnd = seeded(CITY_MOODS.indexOf(mood) + 1);
  const eighth = 60 / CITY_TEMPO[mood] / 2;
  for (let k = 0; k < BARS * 8; k++) {
    bar = Math.floor(k / 8);
    cityBeat(v, mood, k * eighth, k, rnd);
  }
  check(isCityMood(mood), `${mood} is one of the city's`);
  let partials = 0;
  let worst = 0;
  for (const n of notes) {
    check(
      n.dur > 0 && n.gain > 0 && n.gain <= 0.14 && n.f >= 30 && n.f <= 6000,
      `${mood}: a note ${n.f.toFixed(1)} Hz, gain ${n.gain}, ${n.dur.toFixed(2)} s`,
    );
    const cents = off(n.f);
    // (Struck metal's and the music box's upper partials: quiet sines, untuned on purpose.)
    if (cents > 12 && n.type === 'sine' && n.gain < 0.01 && struck.has(n.at)) partials++;
    else {
      worst = Math.max(worst, cents);
      check(cents <= 12, `${mood}: ${n.f.toFixed(1)} Hz is ${cents.toFixed(0)} cents off the scale`);
    }
  }
  let silent = 0;
  for (let b = 0; b + 1 < BARS; b++) if (perBar[b] + perBar[b + 1] === 0) silent++;
  check(silent === 0, `${mood}: ${silent} stretches of two bars with nothing a small speaker plays`);
  lines.push(
    `${mood}: ${CITY_TEMPO[mood]} bpm, ${notes.length} notes, ${thumps} drums, ${ticks} hats in ${BARS} bars; ` +
      `${partials} untuned partials, the rest within ${Math.ceil(worst)} cents of the scale`,
  );
}
check(
  CITY_TEMPO.cityChase > 2 * CITY_TEMPO.cityNight && CITY_TEMPO.cityHold > CITY_TEMPO.cityDay,
  'the chase and the hold are the fast ones',
);
check(!isCityMood('tension') && !isCityMood('title'), "the prisons' moods aren't the city's");

// ------------------------------------------------------------------ which mood plays
const m = new CityMusic();
const cue = (c: Partial<MusicCue>): MusicCue => ({ going: false, chasing: 0, night: false, safe: false, ...c });
const walk: Array<[string, MusicCue, number, string]> = [
  ['a street by day', cue({}), 0, 'cityDay'],
  ['indoors by day, the door barred', cue({ safe: true }), 1, 'cityDay'],
  ['seen by one of the dead', cue({ chasing: 1 }), 2, 'cityChase'],
  ['it loses the player: a second on', cue({}), 3, 'cityChase'],
  [`${CHASE_LINGER} seconds on`, cue({}), 2 + CHASE_LINGER, 'cityDay'],
  ['dusk', cue({ night: true }), 20, 'cityNight'],
  ['behind a barred door', cue({ night: true, safe: true }), 21, 'cityShelter'],
  ['the door torn open, three after the player', cue({ night: true, safe: true, chasing: 3 }), 22, 'cityChase'],
  ['the beacon lit', cue({ night: true, going: true }), 23, 'cityHold'],
  ['the beacon lit, chased', cue({ night: true, going: true, chasing: 5 }), 24, 'cityHold'],
  ['the district left with them behind', cue({ night: true }), 25, 'cityChase'],
  ['dawn, long after', cue({}), 400, 'cityDay'],
  ['seen again', cue({ chasing: 2 }), 410, 'cityChase'],
];
const fell = 'fallen, and home the next morning (the chase forgotten)';
for (const [what, c, at, want] of walk) {
  const got = m.pick(c, at);
  check(got === want, `${what}: ${got}, expected ${want}`);
  lines.push(`${what}: ${got}`);
}
m.reset();
check(m.pick(cue({}), 410.5) === 'cityDay', `${fell}: ${m.pick(cue({}), 410.5)}`);
lines.push(`${fell}: ${m.pick(cue({}), 410.5)}`);
m.pick(cue({ chasing: 1 }), 500);
m.reset();
check(m.pick(cue({}), 501) === 'cityDay', "a new city starts without the last one's chase");
console.log(lines.join('\n'));
