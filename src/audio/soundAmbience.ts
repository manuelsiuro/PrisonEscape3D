import { SoundMusic } from './soundMusic';

// What plays on under the game (out of Sound.ts, v2.34.2): the room tone and the scene's sounds
// (far clanks, birds, crickets, drips, the surf and gulls; the forest's pines, owls, hounds and horn), the weather, the showers, the siren.

export type Scene = 'indoor' | 'outdoorDay' | 'outdoorNight' | 'under';

export class SoundAmbience extends SoundMusic {
  protected ambienceGain: GainNode | null = null;
  protected ambienceSources: AudioScheduledSourceNode[] = [];
  protected ambienceOn = false;
  protected clankTimer = 0;
  protected sirenOn = false;
  protected sirenNodes: { gain: GainNode; sources: AudioScheduledSourceNode[] } | null = null;
  /** Where the player is, for the ambience's sounds (birds, crickets, drips, far-off clanks). */
  protected scene: Scene = 'indoor';

  /** The weather's sound (P17): rain (0–1) and wind (0–1), looping, muffled indoors and below. */
  protected wx: {
    rain: GainNode;
    rainF: BiquadFilterNode;
    wind: GainNode;
    windF: BiquadFilterNode;
    sources: AudioScheduledSourceNode[];
  } | null = null;
  protected wxWant = { rain: 0, wind: 0 };
  setWeather(rain: number, wind: number) {
    if (rain === this.wxWant.rain && wind === this.wxWant.wind) return;
    this.wxWant = { rain, wind };
    this.applyWeather();
  }

  /** The showers running (2.26): 0–1 by how near they are, through the ambience's gain like the weather. */
  protected water: { gain: GainNode; source: AudioScheduledSourceNode } | null = null;
  protected waterWant = 0;
  setWater(level: number) {
    if (level === this.waterWant) return;
    this.waterWant = level;
    this.applyWater();
  }

  protected applyWater() {
    const c = this.ctx;
    if (!c || !this.out || !this.noise || !this.ambienceGain) return;
    if (!this.water) {
      if (this.waterWant <= 0) return;
      const source = c.createBufferSource();
      source.buffer = this.noise;
      source.loop = true;
      const band = c.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2100;
      band.Q.value = 0.55;
      const gain = c.createGain();
      gain.gain.value = 0;
      source.connect(band).connect(gain).connect(this.ambienceGain);
      source.start();
      this.water = { gain, source };
    }
    this.water.gain.gain.setTargetAtTime(0.13 * this.waterWant, c.currentTime, 0.25);
  }

  protected applyWeather() {
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

  /** The lockdown siren: a wailing two-oscillator sweep while on. */
  siren(on: boolean) {
    if (on === this.sirenOn) return;
    this.sirenOn = on;
    if (on) this.startSiren();
    else this.stopSiren();
  }

  protected startSiren() {
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

  protected stopSiren() {
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
  protected coast = false;
  setCoast(on: boolean) {
    this.coast = on;
  }

  /** The surf: a long wash of low noise breaking on the rocks. */
  protected surf(g: GainNode) {
    this.hiss(1.8, 'lowpass', 520, 0.6, 0.05, g, 0, 0.9);
    this.hiss(1.0, 'bandpass', 1400, 0.8, 0.014, g, 0.7, 0.3);
  }

  /** In the pine forest (2.36, the Six Hunter): outdoors, wind in the pines, woodland birds, owls and far hounds at night. */
  protected forest = false;
  setForest(on: boolean) {
    this.forest = on;
  }

  /**
   * A held note with a soft attack and release (a horn's, an owl's, a hound's howl): `type` through a low-pass that
   * opens as it sounds, sliding f0 → f1, a slow vibrato if `wobble` (Hz of it).
   */
  protected held(
    f0: number,
    f1: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    delay: number,
    cutoff: number,
    wobble = 0,
    dest?: AudioNode,
  ) {
    const c = this.ctx;
    if (!c || !this.out || this.volume === 0) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f1, t + dur);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff * 0.4, t);
    lp.frequency.linearRampToValueAtTime(cutoff, t + Math.min(0.12, dur / 3));
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.05, dur / 4));
    g.gain.setValueAtTime(gain, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(lp)
      .connect(g)
      .connect(dest ?? this.out);
    const stops: AudioScheduledSourceNode[] = [o];
    if (wobble) {
      const lfo = c.createOscillator();
      lfo.frequency.value = wobble;
      const depth = c.createGain();
      depth.gain.value = f0 * 0.012;
      lfo.connect(depth).connect(o.frequency);
      lfo.start(t);
      stops.push(lfo);
    }
    o.start(t);
    for (const n of stops) n.stop(t + dur + 0.05);
  }

  /** A hunting horn's call (the recall horn blown, the dawn call): ta-ta-taaa on a natural horn's notes, far or near by `gain`. */
  huntHorn(gain = 1, delay = 0, dest?: AudioNode) {
    if (gain <= 0.02) return;
    const calls: Array<[number, number, number]> = [
      [349, 0.16, 0],
      [349, 0.16, 0.22],
      [466, 0.18, 0.44],
      [523, 0.85, 0.68],
    ];
    for (const [f, dur, at] of calls) {
      this.held(f, f * 0.995, dur, 'sawtooth', 0.055 * gain, delay + at, 1900, 0, dest);
      this.held(f * 2, f * 2 * 0.995, dur, 'triangle', 0.02 * gain, delay + at, 3000, 0, dest);
    }
    // The breath in it, and the valley's echo of the last note.
    this.hiss(0.2, 'bandpass', 1200, 1.5, 0.015 * gain, dest, delay);
    this.held(523, 520, 0.9, 'sawtooth', 0.014 * gain, delay + 1.25, 1200, 0, dest);
  }

  /** A drag line thrown (2.36): the cord whipping out, the soaked sock's slap where it lands. */
  dragLine(gain = 1) {
    if (gain <= 0.02) return;
    this.hiss(0.28, 'bandpass', 2600, 2.5, 0.06 * gain, undefined, 0, 0.1);
    this.hiss(0.12, 'lowpass', 700, 0.8, 0.16 * gain, undefined, 0.4);
    this.tone(160, 90, 0.12, 'sine', 0.12 * gain, 0.4);
  }

  /** A hound baying far off: a long rising and falling howl, a second answering. */
  protected bay(g: GainNode, gain: number) {
    const f = 330 + Math.random() * 80;
    this.held(f, f * 1.35, 0.5, 'sawtooth', 0.018 * gain, 0, 900, 5, g);
    this.held(f * 1.35, f * 0.9, 1.1, 'sawtooth', 0.018 * gain, 0.5, 900, 5, g);
    if (Math.random() < 0.5) this.held(f * 1.1, f * 1.4, 0.9, 'sawtooth', 0.011 * gain, 1.3, 800, 6, g);
  }

  /** The forest's sounds outdoors, by day or night; returns how long until the next. */
  protected woods(g: GainNode, night: boolean): number {
    // Wind in the pines: a slow swell of soft high noise, always.
    this.hiss(2.6, 'bandpass', 900 + Math.random() * 400, 0.7, 0.03, g, 0, 1.4);
    if (night) {
      const r = Math.random();
      if (r < 0.4) {
        // A tawny owl: hoo … hoo-hoo-hoooo.
        const f = 400 + Math.random() * 40;
        this.held(f, f * 0.96, 0.4, 'sine', 0.03, 0.2, 1200, 0, g);
        for (let k = 0; k < 3; k++)
          this.held(f * 0.98, f * 0.93, k === 2 ? 0.75 : 0.2, 'sine', 0.026, 1.0 + k * 0.28, 1200, k === 2 ? 7 : 0, g);
      } else if (r < 0.58) this.bay(g, 1);
      else {
        const f = 4300 + Math.random() * 400;
        for (let k = 0; k < 6; k++) this.tone(f, f, 0.025, 'sine', 0.01, k * 0.045, g);
      }
      return 2600 + Math.random() * 4200;
    }
    const r = Math.random();
    if (r < 0.2) {
      // A woodpecker drumming far off.
      for (let k = 0; k < 12; k++) this.hiss(0.02, 'bandpass', 1500, 3, 0.05 * (1 - k / 14), g, 0.3 + k * 0.045);
    } else if (r < 0.4) {
      // A wood pigeon: coo-COO-coo, coo-coo.
      const f = 520 + Math.random() * 40;
      for (const [at, d, k] of [
        [0, 0.25, 0.9],
        [0.32, 0.4, 1],
        [0.8, 0.22, 0.9],
        [1.15, 0.2, 0.85],
        [1.42, 0.2, 0.85],
      ])
        this.held(f * k, f * k * 0.92, d, 'sine', 0.02, 0.2 + at, 900, 0, g);
    } else if (r < 0.75) {
      // A finch's quick song.
      const f = 3000 + Math.random() * 1200;
      for (let k = 0; k < 4 + Math.floor(Math.random() * 3); k++)
        this.tone(f * (1 + (k % 2) * 0.2), f * 1.3, 0.06, 'sine', 0.014, 0.2 + k * 0.09, g);
    } else if (r < 0.85) this.bay(g, 0.6);
    return 3000 + Math.random() * 4000;
  }

  /** The room tone and distant clanks while playing; silence on the title. */
  ambience(on: boolean) {
    if (on === this.ambienceOn) return;
    this.ambienceOn = on;
    if (on) this.startAmbience();
    else this.stopAmbience();
  }

  protected startAmbience() {
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
      } else if (this.forest && (this.scene === 'outdoorDay' || this.scene === 'outdoorNight')) {
        wait = this.woods(g, this.scene === 'outdoorNight');
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
    this.applyWater();
  }

  protected stopAmbience() {
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
    const water = this.water;
    this.water = null;
    if (water) setTimeout(() => water.source.stop(), 800);
    const sources = this.ambienceSources;
    this.ambienceSources = [];
    setTimeout(() => {
      for (const s of sources) s.stop();
      g.disconnect();
    }, 800);
  }
}
