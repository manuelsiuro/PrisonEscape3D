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

  /** A tunnel roof coming down: a rumble and a slide of earth. */
  caveIn() {
    this.tone(70, 35, 1.1, 'sawtooth', 0.18);
    this.hiss(1.1, 'lowpass', 380, 0.6, 0.4);
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
