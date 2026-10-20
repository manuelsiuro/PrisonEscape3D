/**
 * A clock that runs only while the game does (ms), and things to do at a time on it: a show
 * drawn between steps (a ball's flight, P27) holds still under the pause menu, and what was to
 * happen as it ends (a sound, a toast) waits with it. `tick` it once a frame and whenever it's
 * read, with the real time and whether the game is paused now.
 */
export class PausableClock {
  /** The most one tick moves it on (ms): back from a hidden tab, a show doesn't leap to its end. */
  static readonly MAX_STEP = 100;
  private now = 0;
  private last = -1;
  private readonly due: Array<{ at: number; run: () => void }> = [];

  /** Runs the clock on by the real time since the last tick (not while paused), then whatever is due; returns the time on it. */
  tick(real: number, paused: boolean): number {
    if (this.last >= 0 && !paused) this.now += Math.min(PausableClock.MAX_STEP, Math.max(0, real - this.last));
    this.last = real;
    // (In the order they were asked for; one may ask for another, run too once it's due.)
    for (let k = 0; k < this.due.length; ) {
      const d = this.due[k];
      if (d.at > this.now) {
        k++;
        continue;
      }
      this.due.splice(k, 1);
      d.run();
    }
    return this.now;
  }

  /** The time on the clock at the last tick. */
  get time(): number {
    return this.now;
  }

  /** Runs `run` once the clock has run `ms` on from now. */
  after(ms: number, run: () => void) {
    this.due.push({ at: this.now + ms, run });
  }

  /** Forgets what was still to come (a new game). */
  clear() {
    this.due.length = 0;
  }
}
