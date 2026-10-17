import { TILE } from '../sim/world/tiles';

export type Mood = 'off' | 'title' | 'day' | 'night' | 'tension';
export type Scene = 'indoor' | 'outdoorDay' | 'outdoorNight' | 'under';

/** Eighth notes a beat's half: beats a minute for each mood. */
const TEMPO: Record<Mood, number> = { off: 60, title: 70, day: 88, night: 60, tension: 126 };
/** The music's loudest, under the effects at full volume. */
const MUSIC_LEVEL = 0.55;
/** Chords in semitones above D3 (root first): Dm, Bb, Gm, A. */
const CHORDS: ReadonlyArray<readonly number[]> = [
  [0, 0, 3, 7, 10],
  [-4, -4, 0, 3, 7],
  [-7, 5, 8, 12, 15],
  [-5, 7, 11, 14, 17],
];

/** Soft ground: muffled footsteps. */
const SOFT = new Set<number>([TILE.GRASS, TILE.DIRT, TILE.MINE]);

/**
 * Synthesized sound (Web Audio, no files). The context starts on the first user gesture
 * (browsers block audio before one); a volume of 0 is silence (the mute switch).
 * Effects go through one output; the ambience (a low room tone and the odd distant clank)
 * has its own gain under it.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private ambienceSources: AudioScheduledSourceNode[] = [];
  private noise: AudioBuffer | null = null;
  private volume = 0.8;
  private ambienceOn = false;
  private clankTimer = 0;
  private sirenOn = false;
  private sirenNodes: { gain: GainNode; sources: AudioScheduledSourceNode[] } | null = null;
  /** The music (its own output and volume, under the effects): a mood and a step scheduler. */
  private musicOut: GainNode | null = null;
  private musicVolume = 0.5;
  private ducked = false;
  private mood: Mood = 'off';
  private musicTimer = 0;
  private musicNext = 0;
  private musicStep = 0;
  /** Where the player is, for the ambience's sounds (birds, crickets, drips, far-off clanks). */
  private scene: Scene = 'indoor';

  constructor() {
    const start = () => {
      if (this.ctx) return;
      try {
        this.ctx = new AudioContext();
        this.out = this.ctx.createGain();
        this.out.gain.value = this.volume;
        this.out.connect(this.ctx.destination);
        this.noise = this.makeNoise();
        this.musicOut = this.ctx.createGain();
        this.musicOut.gain.value = this.musicVolume * MUSIC_LEVEL;
        this.musicOut.connect(this.ctx.destination);
        if (this.mood !== 'off') this.startMusic();
        if (this.ambienceOn) this.startAmbience();
        if (this.sirenOn) this.startSiren();
      } catch {
        /* no audio on this device */
      }
    };
    addEventListener('pointerdown', start, { once: true });
    addEventListener('keydown', start, { once: true });
    // Hidden (another app, a locked phone): silence, not a score playing in the pocket. The
    // context's clock stops with it, so the music picks up where it was without a burst.
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else this.ctx.resume().catch(() => {});
    });
  }

  private makeNoise(): AudioBuffer {
    const c = this.ctx!;
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.out) this.out.gain.value = v;
  }

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

  private musicLevel() {
    const c = this.ctx;
    if (c && this.musicOut) this.musicOut.gain.setTargetAtTime(this.musicVolume * MUSIC_LEVEL * (this.ducked ? 0.4 : 1), c.currentTime, 0.15);
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

  private startMusic() {
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

  private stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = 0;
  }

  /** A note of the score: one oscillator through an envelope (attack, hold, release) into the music. */
  private note(f: number, at: number, dur: number, type: OscillatorType, gain: number, attack = 0.01, cutoff = 0) {
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
  private musicBeat(at: number, k: number) {
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
      if (inBar % 2 === 0 ? r < 0.3 : r < 0.12) this.note(hz(chord[1 + Math.floor(Math.random() * 3)] + 12), at, eighth * 3, 'triangle', 0.045, 0.004, 2600);
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
  private pad(chord: readonly number[], at: number, dur: number, gain: number, cutoff: number) {
    for (const semi of chord.slice(1)) {
      const f = 146.83 * 2 ** (semi / 12);
      this.note(f, at, dur, 'sawtooth', gain, dur * 0.3, cutoff);
      this.note(f * 1.006, at, dur, 'sawtooth', gain * 0.7, dur * 0.35, cutoff);
    }
  }

  private tick(at: number, gain: number) {
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

  private thump(at: number, gain: number) {
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

  /** A short tone sliding from f0 to f1 Hz, starting `delay` seconds from now. */
  private tone(f0: number, f1: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, delay = 0, dest?: AudioNode) {
    const c = this.ctx;
    if (!c || !this.out || this.volume === 0) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest ?? this.out);
    o.start(t);
    o.stop(t + dur);
  }

  /** A burst of filtered noise. */
  private hiss(dur: number, filter: BiquadFilterType, freq: number, q: number, gain: number, dest?: AudioNode, delay = 0, swell = 0) {
    const c = this.ctx;
    if (!c || !this.out || !this.noise || this.volume === 0) return;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    // A swell (the surf): rising before it dies away, rather than struck.
    if (swell > 0) {
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + swell);
    } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + swell + dur);
    src.connect(f).connect(g).connect(dest ?? this.out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + swell + dur);
  }

  /** Sitting down: a soft creak of wood and a settle. */
  sit() {
    this.tone(180, 120, 0.12, 'triangle', 0.08);
    this.hiss(0.08, 'lowpass', 900, 0.8, 0.05);
  }

  /** A meal eaten: two quick spoon clinks and a pleased hum. */
  eat() {
    this.tone(2400, 2300, 0.05, 'sine', 0.06);
    this.tone(2700, 2600, 0.05, 'sine', 0.05, 0.12);
    this.tone(330, 392, 0.25, 'triangle', 0.08, 0.22);
  }

  click() {
    this.tone(900, 600, 0.05, 'triangle', 0.15);
  }

  /** A footstep: a muffled brush on grass and dirt, a crisp tap on hard floors. */
  step(surface: number) {
    if (SOFT.has(surface)) this.hiss(0.09, 'lowpass', 700 + Math.random() * 300, 0.7, 0.07);
    else {
      this.hiss(0.05, 'bandpass', 1800 + Math.random() * 600, 1.2, 0.05);
      this.tone(140, 90, 0.05, 'sine', 0.05);
    }
  }

  /** The prison bell for a new routine block: two struck notes with a long ring. */
  bell() {
    for (const [f, d] of [
      [784, 0],
      [622, 0.35],
    ]) {
      this.tone(f, f * 0.995, 1.4, 'sine', 0.18, d);
      this.tone(f * 2.76, f * 2.7, 0.5, 'sine', 0.04, d);
    }
  }

  /** Checked in to a routine block: a bright two-note chime. */
  chime() {
    this.tone(880, 880, 0.25, 'triangle', 0.12);
    this.tone(1320, 1320, 0.45, 'triangle', 0.12, 0.09);
    this.tone(2640, 2600, 0.3, 'sine', 0.03, 0.09);
  }

  /** An achievement earned (P16): a short brassy fanfare, up a major arpeggio to a held top note with a sparkle. */
  fanfare() {
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, k) => {
      this.tone(f, f, 0.14, 'square', 0.045, k * 0.09);
      this.tone(f, f, 0.16, 'triangle', 0.1, k * 0.09);
    });
    this.tone(1046.5, 1046.5, 0.6, 'square', 0.04, 0.3);
    this.tone(1046.5, 1046.5, 0.7, 'triangle', 0.12, 0.3);
    this.tone(2093, 2080, 0.4, 'sine', 0.035, 0.36);
  }

  /**
   * A voice under a speech bubble (P13): a few soft syllables at the speaker's pitch, rising
   * and falling like talk, quieter the further away (`gain` 0–1).
   */
  murmur(pitch: number, syllables: number, gain: number) {
    if (gain <= 0.02) return;
    for (let k = 0; k < syllables; k++) {
      const f = pitch * (0.88 + Math.random() * 0.36);
      this.tone(f, f * (0.82 + Math.random() * 0.3), 0.075, 'triangle', 0.045 * gain, k * 0.09 + Math.random() * 0.02);
    }
  }

  // ---------------------------------------------------------------- the day (P17)
  /** The warden's speakers clicking on: a three-note airport chime, high to low. */
  paChime() {
    [784, 659.25, 523.25].forEach((f, k) => {
      this.tone(f, f, 0.9, 'triangle', 0.11, k * 0.32);
      this.tone(f * 2, f * 2, 0.4, 'sine', 0.025, k * 0.32);
    });
    this.hiss(0.12, 'bandpass', 2400, 1.5, 0.02);
  }

  /** The warden talking over the speakers: low syllables through a tinny radio band. */
  paVoice(syllables: number) {
    const c = this.ctx;
    if (!c || !this.out || this.volume === 0) return;
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1300;
    band.Q.value = 1.1;
    const g = c.createGain();
    g.gain.value = 1;
    band.connect(g).connect(this.out);
    for (let k = 0; k < syllables; k++) {
      const f = 150 * (0.85 + Math.random() * 0.4);
      this.tone(f, f * (0.85 + Math.random() * 0.3), 0.1, 'sawtooth', 0.05, k * 0.12 + Math.random() * 0.03, band);
    }
    setTimeout(() => g.disconnect(), (syllables * 0.12 + 0.4) * 1000);
  }

  /** The fire drill's bell: a striker hammering a gong for a few seconds. */
  drillBell() {
    for (let k = 0; k < 26; k++) {
      this.tone(2250, 2200, 0.09, 'square', 0.035, k * 0.075);
      this.tone(3420, 3380, 0.07, 'sine', 0.025, k * 0.075);
    }
  }

  /** Thunder: a crack when it's close, then a long low rumble (`near` 0–1). */
  thunder(near: number) {
    if (near > 0.5) this.hiss(0.25, 'highpass', 1800, 0.7, 0.18 * near);
    this.hiss(2.6, 'lowpass', 160 + 120 * near, 0.6, 0.45 * (0.5 + near / 2), undefined, near > 0.5 ? 0.05 : 0.4, 0.3);
    this.hiss(1.4, 'lowpass', 420, 0.7, 0.12, undefined, 0.6 + Math.random() * 0.5);
  }

  /** A canteen erupting (the food fight): a roar of voices and a few whoops. */
  crowd() {
    this.hiss(2.4, 'bandpass', 700, 0.8, 0.16, undefined, 0, 0.4);
    this.hiss(1.8, 'bandpass', 1500, 1.4, 0.05, undefined, 0.3, 0.3);
    for (let k = 0; k < 4; k++) {
      const f = 380 + Math.random() * 260;
      this.tone(f, f * 1.6, 0.22, 'triangle', 0.035, 0.2 + k * 0.4 + Math.random() * 0.2);
    }
  }

  /** Something soft flying and landing (a food fight's splat). */
  splat(gain = 1) {
    this.hiss(0.12, 'lowpass', 900, 1, 0.08 * gain);
    this.tone(260, 120, 0.1, 'sine', 0.06 * gain);
  }

  /** The weather's sound (P17): rain (0–1) and wind (0–1), looping, muffled indoors and below. */
  private wx: { rain: GainNode; rainF: BiquadFilterNode; wind: GainNode; windF: BiquadFilterNode; sources: AudioScheduledSourceNode[] } | null = null;
  private wxWant = { rain: 0, wind: 0 };
  setWeather(rain: number, wind: number) {
    if (rain === this.wxWant.rain && wind === this.wxWant.wind) return;
    this.wxWant = { rain, wind };
    this.applyWeather();
  }

  private applyWeather() {
    const c = this.ctx;
    if (!c || !this.out || !this.noise || !this.ambienceGain) return;
    const { rain, wind } = this.wxWant;
    if (!this.wx) {
      if (rain <= 0 && wind <= 0) return;
      const make = (type: BiquadFilterType, freq: number, q: number) => {
        const src = c.createBufferSource();
        src.buffer = this.noise;
        src.loop = true;
        src.playbackRate.value = 0.9 + Math.random() * 0.2;
        const f = c.createBiquadFilter();
        f.type = type;
        f.frequency.value = freq;
        f.Q.value = q;
        const g = c.createGain();
        g.gain.value = 0;
        src.connect(f).connect(g).connect(this.ambienceGain!);
        src.start();
        return { src, f, g };
      };
      const r = make('lowpass', 3200, 0.4);
      const w = make('bandpass', 380, 1.8);
      // The wind gusts: its band wanders.
      const lfo = c.createOscillator();
      lfo.frequency.value = 0.13;
      const depth = c.createGain();
      depth.gain.value = 160;
      lfo.connect(depth).connect(w.f.frequency);
      lfo.start();
      this.wx = { rain: r.g, rainF: r.f, wind: w.g, windF: w.f, sources: [r.src, w.src, lfo] };
    }
    const inside = this.scene === 'indoor' || this.scene === 'under';
    const muffle = this.scene === 'under' ? 0.15 : inside ? 0.4 : 1;
    const now = c.currentTime;
    this.wx.rain.gain.setTargetAtTime(0.09 * rain * muffle, now, 0.6);
    this.wx.rainF.frequency.setTargetAtTime(inside ? 800 : 3200, now, 0.3);
    this.wx.wind.gain.setTargetAtTime(0.07 * wind * (inside ? 0.3 : 1), now, 0.8);
  }

  /** Picked something up: a quick rising pop. */
  pickup() {
    this.tone(520, 980, 0.09, 'triangle', 0.14);
    this.tone(1300, 1500, 0.06, 'sine', 0.05, 0.05);
  }

  /** Dropped something: a soft thud. */
  drop() {
    this.tone(180, 90, 0.12, 'sine', 0.16);
    this.hiss(0.06, 'lowpass', 900, 0.8, 0.06);
  }

  /** A drawer slides open: wood friction and a little knock. */
  drawer() {
    this.hiss(0.22, 'bandpass', 1400, 2.5, 0.07);
    this.tone(240, 200, 0.07, 'triangle', 0.08, 0.18);
  }

  /** Crafted: three quick hammer taps and a bright ding. */
  craft() {
    for (const d of [0, 0.11, 0.22]) {
      this.hiss(0.05, 'bandpass', 2600, 3, 0.09);
      this.tone(420, 300, 0.06, 'square', 0.03, d);
    }
    this.tone(1568, 1568, 0.5, 'triangle', 0.08, 0.34);
  }

  /** Cash in (GDD §11): a coin's bright clink, a little run of them for a wage. */
  coin(big = false) {
    const n = big ? 3 : 1;
    for (let k = 0; k < n; k++) {
      const d = k * 0.07;
      this.tone(1975, 1960, 0.18, 'triangle', 0.1, d);
      this.tone(2637, 2620, 0.28, 'sine', 0.05, d + 0.03);
    }
  }

  /** Bought something: the coins go, the goods come (a soft two-note close). */
  buy() {
    this.coin();
    this.tone(660, 990, 0.12, 'triangle', 0.1, 0.12);
  }

  /** At a job station: a machine starting, a load taken out, a mop's swish, a tray set down. */
  work(act: string) {
    switch (act) {
      case 'load':
      case 'sort':
        // A machine starting: a hum that rises.
        this.tone(110, 180, 0.45, 'sawtooth', 0.04);
        this.hiss(0.4, 'bandpass', 600, 1.5, 0.05);
        break;
      case 'unload':
      case 'take':
        this.pickup();
        break;
      case 'put':
        this.tone(330, 260, 0.1, 'triangle', 0.12);
        this.hiss(0.08, 'bandpass', 1500, 1.4, 0.06);
        break;
      case 'mop':
        this.hiss(0.35, 'bandpass', 1100, 0.9, 0.12);
        break;
      default:
        this.tone(300, 250, 0.08, 'triangle', 0.06);
    }
  }

  /** A training rep that counted: a short tick, higher as the set goes on. */
  rep() {
    this.tone(520 + Math.random() * 40, 480, 0.05, 'triangle', 0.07);
  }

  /** A set done (+2), or someone joins the player: a rising arpeggio. */
  levelUp() {
    [523, 659, 784, 1047].forEach((f, k) => this.tone(f, f, 0.22, 'triangle', 0.1, k * 0.07));
  }

  /** An inmate likes the player a little more: a soft upward blip. */
  opinionUp() {
    this.tone(700, 1050, 0.12, 'sine', 0.06, 0.05);
  }

  /** Missed a block: a low falling sting. */
  sting() {
    this.tone(330, 220, 0.35, 'sawtooth', 0.07);
    this.tone(247, 165, 0.5, 'sawtooth', 0.06, 0.12);
  }

  /** A guard spots the player: two sharp blasts on a whistle. */
  whistle() {
    for (const d of [0, 0.2]) {
      this.tone(2900, 3100, 0.14, 'sine', 0.13, d);
      this.tone(3350, 3500, 0.14, 'sine', 0.05, d);
      this.hiss(0.14, 'bandpass', 3100, 4, 0.05);
    }
  }

  /** Knocked down: a heavy thump and a ringing in the ears. */
  thud() {
    this.hiss(0.25, 'lowpass', 400, 0.8, 0.35);
    this.tone(120, 40, 0.35, 'sine', 0.3);
    this.tone(2400, 2380, 1.6, 'sine', 0.025, 0.15);
  }

  /**
   * A blow landing (GDD §10.1): a body thump with a slap on top, heavier with a weapon; a
   * knockout adds a deep thud.
   */
  punch(ko: boolean, weapon: boolean) {
    const r = Math.random() * 0.15;
    this.hiss(0.06, 'bandpass', weapon ? 1400 + r * 600 : 2200 + r * 800, 1.2, weapon ? 0.24 : 0.18);
    this.tone(weapon ? 140 : 190, 60, 0.12, 'sine', weapon ? 0.34 : 0.26);
    if (ko) {
      this.tone(90, 35, 0.4, 'sine', 0.32, 0.06);
      this.hiss(0.3, 'lowpass', 380, 0.7, 0.22);
    }
  }

  /** The player hit: a dull smack and a short grunt-like drop. */
  hurt() {
    this.hiss(0.07, 'lowpass', 1400, 0.9, 0.24);
    this.tone(240, 110, 0.14, 'triangle', 0.16);
  }

  /** A swing at nothing in reach: a whoosh. */
  whoosh() {
    this.hiss(0.16, 'bandpass', 900, 0.8, 0.12);
  }

  /** A cup of molten chocolate thrown: a swish, then a hot splash. */
  splash() {
    this.hiss(0.14, 'bandpass', 1100, 0.8, 0.1);
    this.hiss(0.35, 'lowpass', 1600, 0.6, 0.26);
    this.tone(320, 140, 0.25, 'sine', 0.12, 0.3);
  }

  /** Locking on (a rising blip) and letting go (falling). */
  lockOn(on: boolean) {
    this.tone(on ? 620 : 760, on ? 900 : 480, 0.08, 'triangle', 0.1);
  }

  /** Someone knocked out by the player: little bells for the stars. */
  ko() {
    for (const [d, f] of [
      [0.05, 1760],
      [0.13, 2093],
      [0.21, 2637],
    ]) this.tone(f, f, 0.18, 'sine', 0.05, d);
  }

  /** A stroke of the peeler: a short wet scrape (a done potato plops in the pot). */
  peel(done: boolean) {
    this.hiss(0.07, 'highpass', 2600 + Math.random() * 800, 1, 0.07);
    if (done) this.tone(300, 520, 0.12, 'triangle', 0.12, 0.08);
  }

  /**
   * A tool strike: a gritty chip on brick, a crunch of earth, a metal snip on wire, a
   * squeak of a screw. When the tile gives way: bricks tumble, earth slides, wire twangs.
   */
  strike(action: string, broke: boolean) {
    const r = Math.random() * 0.2;
    switch (action) {
      case 'chip':
        this.hiss(0.08, 'bandpass', 2200 + r * 1000, 2, 0.16);
        this.tone(260 + r * 80, 140, 0.07, 'square', 0.05);
        if (broke) {
          this.hiss(0.6, 'lowpass', 700, 0.7, 0.3);
          for (const d of [0.05, 0.16, 0.3]) this.tone(180 - d * 100, 70, 0.12, 'triangle', 0.1, d);
        }
        break;
      case 'dig':
      case 'digUp':
        this.hiss(0.14, 'lowpass', 900 + r * 400, 0.8, 0.22);
        this.tone(120, 70, 0.1, 'sine', 0.08);
        if (broke) this.hiss(0.45, 'lowpass', 500, 0.6, 0.28);
        break;
      case 'cut':
        this.hiss(0.04, 'highpass', 5200, 1, 0.12);
        this.tone(1900 + r * 400, 1700, 0.05, 'square', 0.04);
        if (broke) {
          this.tone(820, 410, 0.4, 'sawtooth', 0.05);
          this.hiss(0.25, 'bandpass', 3600, 3, 0.08);
        }
        break;
      case 'sharpen':
        // A rasp of plastic on brick; a last bright scrape when the point is there.
        this.hiss(0.12, 'bandpass', 3000 + r * 1400, 2.5, 0.12);
        if (broke) this.tone(2400, 3200, 0.12, 'triangle', 0.05, 0.05);
        break;
      case 'unscrew':
        this.tone(1300 + r * 300, 1700, 0.09, 'sawtooth', 0.035);
        this.hiss(0.06, 'bandpass', 4200, 4, 0.05);
        if (broke) {
          this.tone(700, 520, 0.12, 'triangle', 0.1, 0.02);
          this.tone(520, 380, 0.2, 'triangle', 0.08, 0.16);
        }
        break;
    }
  }

  /** A live fence: a crackling buzz. */
  zap() {
    this.tone(60, 58, 0.7, 'sawtooth', 0.22);
    this.tone(120, 118, 0.7, 'square', 0.08);
    this.hiss(0.7, 'highpass', 3000, 1, 0.18);
  }

  /** The generator switched off (GDD §5.5): a dying hum, the lights clunking out. */
  powerDown() {
    this.tone(120, 30, 1.4, 'sawtooth', 0.16);
    this.tone(240, 60, 1.2, 'square', 0.05);
    this.hiss(0.18, 'lowpass', 500, 0.8, 0.25);
  }

  /** The power back on: a rising hum and a click. */
  powerUp() {
    this.tone(40, 120, 0.9, 'sawtooth', 0.12);
    this.tone(80, 240, 0.9, 'square', 0.03);
    this.tone(1800, 1600, 0.04, 'square', 0.06, 0.85);
  }

  /** A detector arch tripped (GDD §5.4): a harsh buzzer, three times. */
  buzzer() {
    for (const d of [0, 0.28, 0.56]) {
      this.tone(330, 320, 0.22, 'square', 0.13, d);
      this.tone(415, 405, 0.22, 'sawtooth', 0.07, d);
    }
  }

  /** A pass through a detector shielded by the pouch: a soft, satisfied blip. */
  blip() {
    this.tone(1250, 1300, 0.07, 'sine', 0.08);
  }

  /** A sniper takes aim: two thin high beeps. */
  aim() {
    this.tone(2400, 2400, 0.06, 'sine', 0.09);
    this.tone(2400, 2400, 0.06, 'sine', 0.09, 0.16);
  }

  /** A rifle shot from the tower: a crack, and a thud when it hits (a whine when it misses). */
  gunshot(hit: boolean) {
    this.hiss(0.08, 'highpass', 1800, 0.7, 0.5);
    this.tone(160, 40, 0.35, 'sawtooth', 0.22);
    this.hiss(0.6, 'lowpass', 900, 0.5, 0.12);
    if (hit) this.tone(90, 50, 0.18, 'sine', 0.3, 0.05);
    else this.tone(2600, 900, 0.3, 'sine', 0.05, 0.05);
  }

  /** Tape torn off the roll and pressed over a lens. */
  tape() {
    this.hiss(0.22, 'bandpass', 2600, 1.4, 0.16);
  }

  /** The takeover (GDD §12): the gates grind open, a roar. */
  takeover() {
    this.tone(55, 70, 1.6, 'sawtooth', 0.14);
    this.hiss(1.6, 'bandpass', 600, 0.4, 0.22);
    for (const [f, d] of [
      [523, 0.2],
      [659, 0.45],
      [784, 0.7],
    ]) this.tone(f, f, 0.5, 'triangle', 0.1, d);
  }

  /** A tunnel roof coming down: a rumble and a slide of earth. */
  caveIn() {
    this.tone(70, 35, 1.1, 'sawtooth', 0.18);
    this.hiss(1.1, 'lowpass', 380, 0.6, 0.4);
  }

  /** A landmine going off (P11): a sharp crack, a deep boom, sand raining down. */
  blast() {
    this.hiss(0.12, 'highpass', 1400, 0.6, 0.6);
    this.tone(110, 28, 1.4, 'sawtooth', 0.32);
    this.tone(60, 24, 1.2, 'sine', 0.4, 0.02);
    this.hiss(1.8, 'lowpass', 520, 0.5, 0.5);
    this.hiss(1.4, 'bandpass', 2600, 0.8, 0.06);
  }

  // ---------------------------------------------------------------- noise and distractions (P14)

  /** Something thrown landing (`gain` falls off with distance): a soft flump, a hard knock, a metal clang. */
  clatter(thud: number, gain = 1) {
    if (gain <= 0.02) return;
    if (thud >= 2) {
      // Metal: an inharmonic ring over a click, bouncing once.
      for (const [f, g] of [[860, 0.07], [1370, 0.05], [2210, 0.035], [3120, 0.02]] as const) this.tone(f, f * 0.995, 0.55, 'sine', g * gain);
      this.hiss(0.05, 'highpass', 3000, 0.7, 0.12 * gain);
      for (const [f, g] of [[860, 0.03], [1370, 0.02]] as const) this.tone(f, f * 0.995, 0.3, 'sine', g * gain, 0.16);
    } else if (thud === 1) {
      // Hard: a knock and a little rattle.
      this.tone(320, 170, 0.09, 'triangle', 0.18 * gain);
      this.hiss(0.06, 'bandpass', 1400, 1.2, 0.12 * gain);
      this.tone(260, 150, 0.06, 'triangle', 0.08 * gain, 0.11);
    } else {
      // Soft: a muffled flump.
      this.hiss(0.12, 'lowpass', 700, 0.7, 0.16 * gain);
      this.tone(150, 80, 0.12, 'sine', 0.12 * gain);
    }
  }

  /** A firecracker's fuse catching: a crackling fizz while it burns (1.5 s). */
  fuse(gain = 1) {
    if (gain <= 0.02) return;
    this.hiss(1.4, 'highpass', 4200, 0.8, 0.06 * gain, undefined, 0, 0.05);
    for (let k = 0; k < 9; k++) this.hiss(0.025, 'bandpass', 2600 + k * 230, 2, 0.08 * gain, undefined, 0.08 + k * 0.15);
  }

  /** A firecracker going off: a sharp crack, a pop of a boom, crackles after. */
  bang(gain = 1) {
    if (gain <= 0.02) return;
    this.hiss(0.08, 'highpass', 1800, 0.6, 0.55 * gain);
    this.tone(180, 40, 0.45, 'sawtooth', 0.22 * gain);
    this.tone(90, 30, 0.6, 'sine', 0.35 * gain, 0.01);
    this.hiss(0.6, 'lowpass', 900, 0.6, 0.25 * gain);
    for (let k = 0; k < 6; k++) this.hiss(0.03, 'bandpass', 3000 + k * 400, 2, 0.1 * gain, undefined, 0.25 + k * 0.09 + Math.random() * 0.05);
  }

  /** An alarm clock ringing (a second of it): the hammer between two bells. */
  ring(gain = 1) {
    if (gain <= 0.02) return;
    for (let k = 0; k < 14; k++) {
      const f = k % 2 ? 2350 : 2100;
      this.tone(f, f * 0.99, 0.09, 'square', 0.035 * gain, k * 0.065);
      this.tone(f * 1.51, f * 1.5, 0.07, 'sine', 0.02 * gain, k * 0.065);
    }
  }

  /** A wound alarm clock in the pockets: tick. */
  clockTick() {
    this.tone(3200, 3000, 0.018, 'square', 0.018);
    this.hiss(0.015, 'highpass', 5000, 0.8, 0.02);
  }

  /** Winding an alarm clock: a ratchet. */
  wind() {
    for (let k = 0; k < 5; k++) {
      this.tone(2400, 2100, 0.025, 'square', 0.03, k * 0.06);
      this.hiss(0.02, 'highpass', 4000, 0.8, 0.04, undefined, k * 0.06);
    }
  }

  /** A toilet flushing (a gurgle when clogged). */
  flush(clogged = false) {
    if (clogged) {
      for (const d of [0, 0.14, 0.3]) this.tone(180, 120, 0.1, 'sine', 0.12, d);
      return;
    }
    this.hiss(0.9, 'bandpass', 900, 0.7, 0.2);
    this.tone(400, 160, 0.8, 'sine', 0.05);
  }

  /** Climbing through a grate, up a ladder, into a hole: a scuffle and a metal knock. */
  climb() {
    this.hiss(0.25, 'bandpass', 1200, 1.5, 0.1);
    this.tone(320, 240, 0.08, 'triangle', 0.08, 0.12);
  }

  /** A cover put on or taken off: paper and tape, or a block scraping. */
  cover() {
    this.hiss(0.18, 'highpass', 2500, 1, 0.08);
    this.tone(500, 640, 0.06, 'triangle', 0.06, 0.1);
  }

  /** Cell doors slam and lock: a heavy metallic clunk with a short ring. */
  lockClank() {
    this.hiss(0.18, 'lowpass', 600, 1, 0.25);
    this.tone(110, 70, 0.25, 'square', 0.08);
    this.tone(523, 510, 0.9, 'triangle', 0.04, 0.03);
    this.tone(1420, 1390, 0.6, 'sine', 0.02, 0.03);
  }

  /** The lockdown siren: a wailing two-oscillator sweep while on. */
  siren(on: boolean) {
    if (on === this.sirenOn) return;
    this.sirenOn = on;
    if (on) this.startSiren();
    else this.stopSiren();
  }

  private startSiren() {
    const c = this.ctx;
    if (!c || !this.out || this.sirenNodes) return;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(0.045, c.currentTime + 0.4);
    const band = c.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900;
    band.Q.value = 0.8;
    band.connect(gain).connect(this.out);
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.45;
    const depth = c.createGain();
    depth.gain.value = 260;
    lfo.connect(depth);
    const sources: AudioScheduledSourceNode[] = [lfo];
    for (const [f, type] of [
      [720, 'sawtooth'],
      [724, 'square'],
    ] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = f;
      depth.connect(o.frequency);
      o.connect(band);
      o.start();
      sources.push(o);
    }
    lfo.start();
    this.sirenNodes = { gain, sources };
  }

  private stopSiren() {
    const c = this.ctx;
    const n = this.sirenNodes;
    if (!c || !n) return;
    this.sirenNodes = null;
    n.gain.gain.cancelScheduledValues(c.currentTime);
    n.gain.gain.setValueAtTime(n.gain.gain.value, c.currentTime);
    n.gain.gain.linearRampToValueAtTime(0, c.currentTime + 0.8);
    setTimeout(() => {
      for (const s of n.sources) s.stop();
      n.gain.disconnect();
    }, 1000);
  }

  /** Where the player is: the ambience's sounds follow from the next one. */
  setScene(scene: Scene) {
    if (scene === this.scene) return;
    this.scene = scene;
    this.applyWeather();
  }

  /** On the coast (HMP Irongate, P12): outdoors, the surf and gulls instead of songbirds and crickets. */
  private coast = false;
  setCoast(on: boolean) {
    this.coast = on;
  }

  /** The surf: a long wash of low noise breaking on the rocks. */
  private surf(g: GainNode) {
    this.hiss(1.8, 'lowpass', 520, 0.6, 0.05, g, 0, 0.9);
    this.hiss(1.0, 'bandpass', 1400, 0.8, 0.014, g, 0.7, 0.3);
  }

  /** The sea pouring into a tunnel (P12): a roar of water, a deep rumble, bubbles. */
  flood() {
    this.hiss(2.2, 'lowpass', 600, 0.5, 0.55);
    this.hiss(1.6, 'bandpass', 1800, 1.2, 0.12);
    this.tone(80, 40, 1.6, 'sine', 0.3);
    for (let k = 0; k < 6; k++) this.tone(300 + k * 70, 700 + k * 90, 0.06, 'sine', 0.05, 0.3 + k * 0.17);
  }

  /** Off the pier on the raft: a splash, then the slap of water under it. */
  launch() {
    this.hiss(0.5, 'highpass', 900, 0.7, 0.25);
    this.hiss(1.2, 'lowpass', 700, 0.6, 0.15, undefined, 0.2);
    for (let k = 0; k < 3; k++) this.hiss(0.18, 'bandpass', 600, 1.5, 0.08, undefined, 0.7 + k * 0.45);
  }

  /** The helicopter lifting off (P12): the rotor's beat quickening, the turbine's whine. */
  rotor() {
    for (let k = 0; k < 18; k++) {
      const at = 0.42 * k * (1 - k / 40);
      this.hiss(0.08, 'lowpass', 300, 0.8, 0.18, undefined, at);
    }
    this.tone(400, 1100, 2.6, 'sawtooth', 0.03);
  }

  /** Delivery day (P18): a vehicle backing up, its beep (quieter further off). */
  reverseBeep(gain = 1) {
    this.tone(1180, 1180, 0.16, 'square', 0.035 * gain);
  }

  /** A truck pulling away: the diesel's low rumble rising, a hiss of air brakes let off. */
  engine(gain = 1) {
    this.hiss(0.35, 'highpass', 2400, 0.8, 0.06 * gain);
    this.tone(48, 92, 2.4, 'sawtooth', 0.07 * gain, 0.1);
    this.tone(96, 150, 2.2, 'square', 0.025 * gain, 0.15);
  }

  /** A tailgate or roller door: a rattle and a clank (the search: shut tight). */
  tailgate(gain = 1) {
    this.hiss(0.32, 'bandpass', 900, 1.4, 0.12 * gain);
    this.tone(140, 70, 0.18, 'square', 0.08 * gain, 0.28);
    this.hiss(0.08, 'lowpass', 500, 0.8, 0.14 * gain, undefined, 0.3);
  }

  /** A guard dog's bark (P19): two gruff woofs, a growl's grain under them (`pitch`: a big dog lower). */
  bark(gain = 1, pitch = 1) {
    for (const at of [0, 0.22]) {
      this.tone(330 * pitch, 180 * pitch, 0.13, 'sawtooth', 0.09 * gain, at);
      this.tone(660 * pitch, 380 * pitch, 0.1, 'square', 0.025 * gain, at);
      this.hiss(0.12, 'bandpass', 900 * pitch, 2.2, 0.1 * gain, undefined, at);
    }
  }

  /** A dog sneezing at pepper: a sharp "ptchoo", a snort after. */
  sneeze(gain = 1) {
    this.hiss(0.14, 'highpass', 3200, 0.9, 0.16 * gain);
    this.tone(520, 240, 0.12, 'triangle', 0.05 * gain, 0.02);
    this.hiss(0.18, 'lowpass', 700, 0.7, 0.1 * gain, undefined, 0.35);
  }

  /** Jerky wolfed down: quick chomps, a happy yip. */
  munch(happy = false) {
    for (let k = 0; k < 4; k++) this.hiss(0.05, 'bandpass', 1400 + k * 120, 2.5, 0.12, undefined, k * 0.09);
    if (happy) this.tone(880, 1320, 0.12, 'triangle', 0.06, 0.42);
  }

  /** A dog nodding off: a long yawn, sliding down. */
  yawn(gain = 1) {
    this.tone(620, 260, 0.7, 'triangle', 0.05 * gain);
    this.hiss(0.5, 'lowpass', 600, 0.6, 0.04 * gain, undefined, 0.1);
  }

  /** Soap and water (P19): a lather's squelch and a rinse. */
  scrub() {
    for (let k = 0; k < 3; k++) this.hiss(0.09, 'bandpass', 2200 - k * 300, 3, 0.08, undefined, k * 0.12);
    this.hiss(0.4, 'highpass', 1800, 0.7, 0.05, undefined, 0.38);
  }

  /** A rat (P20): a few high squeaks (`panic`: a frantic run of them, and a scatter of feet). */
  squeak(gain = 1, panic = false) {
    const n = panic ? 5 : 2;
    for (let k = 0; k < n; k++) this.tone(2400 + (k % 2) * 500, 3100 + (k % 3) * 300, 0.06, 'triangle', 0.045 * gain, k * (panic ? 0.11 : 0.15));
    if (panic) for (let k = 0; k < 6; k++) this.hiss(0.04, 'bandpass', 3200, 3, 0.05 * gain, undefined, 0.05 + k * 0.07);
  }

  /** A rat scurrying off and back (P20): tiny claws on the floor. */
  scurry(gain = 1) {
    for (let k = 0; k < 4; k++) this.hiss(0.03, 'bandpass', 4200 - k * 200, 4, 0.04 * gain, undefined, k * 0.05);
  }

  /** Into the vehicle among the crates (a shuffle, a creak), and out again. */
  stow(on: boolean) {
    this.hiss(0.22, 'lowpass', 700, 0.7, 0.12);
    this.tone(on ? 330 : 260, on ? 240 : 360, 0.16, 'triangle', 0.05, 0.08);
    this.hiss(0.1, 'bandpass', 1500, 1.5, 0.05, undefined, 0.22);
  }

  /** The room tone and distant clanks while playing; silence on the title. */
  ambience(on: boolean) {
    if (on === this.ambienceOn) return;
    this.ambienceOn = on;
    if (on) this.startAmbience();
    else this.stopAmbience();
  }

  private startAmbience() {
    const c = this.ctx;
    if (!c || !this.out || !this.noise || this.ambienceGain) return;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(1, c.currentTime + 2);
    g.connect(this.out);
    this.ambienceGain = g;
    // Room tone: noise, low-passed hard, very quiet, with a slow swell.
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const tone = c.createGain();
    tone.gain.value = 0.05;
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = 0.07;
    depth.gain.value = 0.02;
    lfo.connect(depth).connect(tone.gain);
    src.connect(lp).connect(tone).connect(g);
    src.start();
    lfo.start();
    this.ambienceSources = [src, lfo];
    const clank = () => {
      const g = this.ambienceGain;
      if (!g) return;
      let wait = 9000 + Math.random() * 16000;
      if (this.coast && (this.scene === 'outdoorDay' || this.scene === 'outdoorNight')) {
        // The surf on the rocks; by day a gull's falling cry now and then.
        this.surf(g);
        if (this.scene === 'outdoorDay' && Math.random() < 0.45) {
          const f = 1500 + Math.random() * 500;
          for (let k = 0; k < 2 + Math.floor(Math.random() * 2); k++) this.tone(f, f * 0.62, 0.22, 'triangle', 0.014, 0.6 + k * 0.3, g);
        }
        wait = 2600 + Math.random() * 3200;
      } else if (this.scene === 'outdoorDay') {
        // Birds: a pair of quick rising chirps.
        const f = 2400 + Math.random() * 1400;
        for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) this.tone(f, f * 1.35, 0.07, 'sine', 0.018, k * 0.11, g);
        wait = 2500 + Math.random() * 5000;
      } else if (this.scene === 'outdoorNight') {
        // Crickets: a trill of short high pulses.
        const f = 4300 + Math.random() * 400;
        for (let k = 0; k < 6; k++) this.tone(f, f, 0.025, 'sine', 0.012, k * 0.045, g);
        wait = 900 + Math.random() * 2200;
      } else if (this.scene === 'under') {
        // A drip in the tunnel, and its echo.
        const f = 900 + Math.random() * 700;
        this.tone(f, f * 0.4, 0.09, 'sine', 0.05, 0, g);
        this.tone(f, f * 0.4, 0.09, 'sine', 0.012, 0.28, g);
        wait = 1800 + Math.random() * 4000;
      } else {
        // A far-off door or gate: two detuned metallic partials through a narrow band.
        const base = 180 + Math.random() * 160;
        this.tone(base, base * 0.97, 0.9, 'square', 0.012, 0, g);
        this.tone(base * 2.71, base * 2.6, 0.6, 'triangle', 0.008, 0.02, g);
        this.hiss(0.25, 'bandpass', 900, 3, 0.02, g);
      }
      this.clankTimer = window.setTimeout(clank, wait);
    };
    this.clankTimer = window.setTimeout(clank, 3000);
    this.applyWeather();
  }

  private stopAmbience() {
    clearTimeout(this.clankTimer);
    const c = this.ctx;
    const g = this.ambienceGain;
    if (!c || !g) return;
    g.gain.cancelScheduledValues(c.currentTime);
    g.gain.setValueAtTime(g.gain.value, c.currentTime);
    g.gain.linearRampToValueAtTime(0, c.currentTime + 0.6);
    this.ambienceGain = null;
    // The weather goes with it (it plays through the ambience's gain, fading out with it).
    const wx = this.wx;
    this.wx = null;
    if (wx) setTimeout(() => wx.sources.forEach((x) => x.stop()), 800);
    const sources = this.ambienceSources;
    this.ambienceSources = [];
    setTimeout(() => {
      for (const s of sources) s.stop();
      g.disconnect();
    }, 800);
  }
}
