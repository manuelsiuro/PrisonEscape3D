/**
 * Synthesized sound effects (Web Audio, no files). The context starts on the first user
 * gesture (browsers block audio before one); a volume of 0 is silence (the mute switch).
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private volume = 0.8;

  constructor() {
    const start = () => {
      if (this.ctx) return;
      try {
        this.ctx = new AudioContext();
        this.out = this.ctx.createGain();
        this.out.gain.value = this.volume;
        this.out.connect(this.ctx.destination);
      } catch {
        /* no audio on this device */
      }
    };
    addEventListener('pointerdown', start, { once: true });
    addEventListener('keydown', start, { once: true });
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.out) this.out.gain.value = v;
  }

  /** A short tone sliding from f0 to f1 Hz, starting `delay` seconds from now. */
  private tone(f0: number, f1: number, dur: number, type: OscillatorType = 'sine', gain = 0.3, delay = 0) {
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
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur);
  }

  click() {
    this.tone(900, 600, 0.05, 'triangle', 0.15);
  }

  /** The prison bell on the hour: two struck notes with a long ring. */
  bell() {
    for (const [f, d] of [
      [784, 0],
      [622, 0.35],
    ]) {
      this.tone(f, f * 0.995, 1.4, 'sine', 0.18, d);
      this.tone(f * 2.76, f * 2.7, 0.5, 'sine', 0.04, d);
    }
  }
}
