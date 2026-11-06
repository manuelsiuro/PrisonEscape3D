// The sound's synth (out of Sound.ts, v2.34.2, as the base of its layers): the context once a
// gesture has started it, the effects' output and volume, white noise, a tone and a hiss.

export class SoundCore {
  protected ctx: AudioContext | null = null;
  protected out: GainNode | null = null;
  protected noise: AudioBuffer | null = null;
  protected volume = 0.8;

  protected makeNoise(): AudioBuffer {
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
  protected tone(f0: number, f1: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, delay = 0, dest?: AudioNode) {
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
  protected hiss(dur: number, filter: BiquadFilterType, freq: number, q: number, gain: number, dest?: AudioNode, delay = 0, swell = 0) {
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
    src
      .connect(f)
      .connect(g)
      .connect(dest ?? this.out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + swell + dur);
  }
}
