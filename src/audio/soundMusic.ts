import { SoundCore } from './soundCore';

// The score (out of Sound.ts, v2.34.2): one progression in D minor in the mood of the moment, on its
// own output under the effects.

export type Mood = 'off' | 'title' | 'day' | 'night' | 'tension';

/** Eighth notes a beat's half: beats a minute for each mood. */
const TEMPO: Record<Mood, number> = { off: 60, title: 70, day: 88, night: 60, tension: 126 };
/** The music's loudest, under the effects at full volume. */
export const MUSIC_LEVEL = 0.55;
/** Chords in semitones above D3 (root first): Dm, Bb, Gm, A. */
const CHORDS: ReadonlyArray<readonly number[]> = [
  [0, 0, 3, 7, 10],
  [-4, -4, 0, 3, 7],
  [-7, 5, 8, 12, 15],
  [-5, 7, 11, 14, 17],
];

export class SoundMusic extends SoundCore {
  /** The music (its own output and volume, under the effects): a mood and a step scheduler. */
  protected musicOut: GainNode | null = null;
  protected musicVolume = 0.5;
  protected ducked = false;
  protected mood: Mood = 'off';
  protected musicTimer = 0;
  protected musicNext = 0;
  protected musicStep = 0;

  setMusicVolume(v: number) {
    this.musicVolume = v;
    this.musicLevel();
  }

  /** The music steps back (to 40%) while the game is paused or a card is read. */
  duck(on: boolean) {
    if (on === this.ducked) return;
    this.ducked = on;
    this.musicLevel();
  }

  protected musicLevel() {
    const c = this.ctx;
    if (c && this.musicOut)
      this.musicOut.gain.setTargetAtTime(this.musicVolume * MUSIC_LEVEL * (this.ducked ? 0.4 : 1), c.currentTime, 0.15);
  }

  // ---------------------------------------------------------------- music
  /**
   * The score: one progression in D minor (i–VI–iv–v), played in the mood of the moment.
   * The title is a slow, warm theme; the day walks (bass, a soft pad, a sparse pluck); Lights
   * Out is slow pads and a far bell; tension (wanted, a chase, a lockdown) drives a low
   * ostinato over a ticking hat and a heartbeat. A mood change takes effect on the next
   * step, so the music never stops to switch.
   */
  music(mood: Mood) {
    if (mood === this.mood) return;
    const was = this.mood;
    this.mood = mood;
    if (mood === 'off') this.stopMusic();
    else if (was === 'off') this.startMusic();
  }

  protected startMusic() {
    const c = this.ctx;
    if (!c || !this.musicOut || this.musicTimer) return;
    this.musicNext = c.currentTime + 0.1;
    this.musicStep = 0;
    this.musicOut.gain.cancelScheduledValues(c.currentTime);
    this.musicOut.gain.setValueAtTime(0, c.currentTime);
    this.musicOut.gain.linearRampToValueAtTime(this.musicVolume * MUSIC_LEVEL, c.currentTime + 2);
    // Schedules a little ahead of the clock (timers in a background tab run late).
    this.musicTimer = window.setInterval(() => {
      const ctx = this.ctx!;
      while (this.musicNext < ctx.currentTime + 0.25) {
        this.musicBeat(this.musicNext, this.musicStep++);
        this.musicNext += 60 / TEMPO[this.mood] / 2;
      }
    }, 60);
  }

  protected stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = 0;
  }

  /** A note of the score: one oscillator through an envelope (attack, hold, release) into the music. */
  protected note(f: number, at: number, dur: number, type: OscillatorType, gain: number, attack = 0.01, cutoff = 0) {
    const c = this.ctx;
    if (!c || !this.musicOut || this.musicVolume === 0 || this.volume === 0) return;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    let node: AudioNode = o;
    if (cutoff) {
      const f2 = c.createBiquadFilter();
      f2.type = 'lowpass';
      f2.frequency.value = cutoff;
      node = o.connect(f2);
    }
    node.connect(g).connect(this.musicOut);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  /** Eighth note `k` of the score at time `at`. */
  protected musicBeat(at: number, k: number) {
    const mood = this.mood;
    if (mood === 'off') return;
    const eighth = 60 / TEMPO[mood] / 2;
    const bar = Math.floor(k / 8);
    const inBar = k % 8;
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    const hz = (semi: number) => 146.83 * 2 ** (semi / 12);
    const r = Math.random();
    if (mood === 'tension') {
      // Driving eighths on the root, a fifth on the off-beats of the second bar.
      this.note(hz(chord[0] - 12), at, eighth * 0.9, 'sawtooth', 0.09, 0.005, 420);
      if (bar % 2 === 1 && inBar % 2 === 1) this.note(hz(chord[0] - 5), at, eighth * 0.8, 'sawtooth', 0.05, 0.005, 600);
      // A ticking hat on every eighth, a heartbeat on beats 1 and 2.
      this.tick(at, inBar % 2 === 0 ? 0.035 : 0.02);
      if (inBar === 0 || inBar === 1) this.thump(at, inBar === 0 ? 0.3 : 0.18);
      if (inBar === 0 && bar % 2 === 0) this.pad(chord, at, eighth * 16, 0.025, 500);
      return;
    }
    if (mood === 'day') {
      // A walking bass (root, fifth, octave), a pad every two bars, a sparse pluck.
      const walk = [0, -1, 7, -1, 12, -1, 7, 5];
      if (walk[inBar] >= 0) this.note(hz(chord[0] - 24 + walk[inBar]), at, eighth * 1.6, 'triangle', 0.12, 0.01, 900);
      if (k % 16 === 0) this.pad(chord, at, eighth * 16, 0.03, 1100);
      if (inBar % 2 === 0 ? r < 0.3 : r < 0.12)
        this.note(hz(chord[1 + Math.floor(Math.random() * 3)] + 12), at, eighth * 3, 'triangle', 0.045, 0.004, 2600);
      return;
    }
    // Night and title: long roots and pads, a far bell now and then (the title: a motif).
    if (inBar === 0 && bar % 2 === 0) {
      this.note(hz(chord[0] - 24), at, eighth * 16, 'sine', 0.13, 0.4);
      this.pad(chord, at, eighth * 16, mood === 'title' ? 0.04 : 0.032, mood === 'title' ? 1300 : 800);
    }
    if (mood === 'title' && bar % 2 === 0) {
      // An arpeggio up the chord and back (chord tones only: never a clash).
      const motif = [2, -1, 3, -1, 4, -1, 3, 2];
      if (motif[inBar] >= 0) this.note(hz(chord[motif[inBar]] + 12), at, eighth * 3.5, 'triangle', 0.05, 0.01, 3000);
    } else if (r < (mood === 'title' ? 0.1 : 0.06)) {
      const f = hz(chord[1 + Math.floor(Math.random() * 3)] + 24);
      this.note(f, at, eighth * 8, 'sine', 0.03, 0.005);
      this.note(f * 2.76, at, eighth * 3, 'sine', 0.008, 0.005);
    }
  }

  /** A chord held under the rest: two detuned saws a voice, low-passed. */
  protected pad(chord: readonly number[], at: number, dur: number, gain: number, cutoff: number) {
    for (const semi of chord.slice(1)) {
      const f = 146.83 * 2 ** (semi / 12);
      this.note(f, at, dur, 'sawtooth', gain, dur * 0.3, cutoff);
      this.note(f * 1.006, at, dur, 'sawtooth', gain * 0.7, dur * 0.35, cutoff);
    }
  }

  protected tick(at: number, gain: number) {
    const c = this.ctx;
    if (!c || !this.musicOut || !this.noise) return;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    src.connect(f).connect(g).connect(this.musicOut);
    src.start(at, Math.random());
    src.stop(at + 0.05);
  }

  protected thump(at: number, gain: number) {
    const c = this.ctx;
    if (!c || !this.musicOut) return;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(70, at);
    o.frequency.exponentialRampToValueAtTime(38, at + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
    o.connect(g).connect(this.musicOut);
    o.start(at);
    o.stop(at + 0.25);
  }
}
