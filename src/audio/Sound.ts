import { TILE } from '../sim/world/tiles';

/** Soft ground: muffled footsteps. */
const SOFT = new Set<number>([TILE.GRASS, TILE.DIRT]);

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

  constructor() {
    const start = () => {
      if (this.ctx) return;
      try {
        this.ctx = new AudioContext();
        this.out = this.ctx.createGain();
        this.out.gain.value = this.volume;
        this.out.connect(this.ctx.destination);
        this.noise = this.makeNoise();
        if (this.ambienceOn) this.startAmbience();
        if (this.sirenOn) this.startSiren();
      } catch {
        /* no audio on this device */
      }
    };
    addEventListener('pointerdown', start, { once: true });
    addEventListener('keydown', start, { once: true });
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
  private hiss(dur: number, filter: BiquadFilterType, freq: number, q: number, gain: number, dest?: AudioNode) {
    const c = this.ctx;
    if (!c || !this.out || !this.noise || this.volume === 0) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest ?? this.out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur);
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

  /** A stroke of the peeler: a short wet scrape (a done potato plops in the pot). */
  peel(done: boolean) {
    this.hiss(0.07, 'highpass', 2600 + Math.random() * 800, 1, 0.07);
    if (done) this.tone(300, 520, 0.12, 'triangle', 0.12, 0.08);
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
      if (!this.ambienceGain) return;
      // A far-off door or gate: two detuned metallic partials through a narrow band.
      const base = 180 + Math.random() * 160;
      this.tone(base, base * 0.97, 0.9, 'square', 0.012, 0, this.ambienceGain);
      this.tone(base * 2.71, base * 2.6, 0.6, 'triangle', 0.008, 0.02, this.ambienceGain);
      this.hiss(0.25, 'bandpass', 900, 3, 0.02, this.ambienceGain);
      this.clankTimer = window.setTimeout(clank, 9000 + Math.random() * 16000);
    };
    this.clankTimer = window.setTimeout(clank, 5000);
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
    const sources = this.ambienceSources;
    this.ambienceSources = [];
    setTimeout(() => {
      for (const s of sources) s.stop();
      g.disconnect();
    }, 800);
  }
}
