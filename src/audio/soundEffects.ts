import { TILE } from '../sim/world/tiles';
import { SoundAmbience } from './soundAmbience';

// The everyday sound effects (out of Sound.ts, v2.34.2): sitting, eating, the machines, steps,
// bells, the PA, the weather's bursts, picking up and crafting, work and the gym, fights, strikes
// and tools, power, alarms and noise.

/** Soft ground: muffled footsteps. */
const SOFT = new Set<number>([TILE.GRASS, TILE.DIRT, TILE.MINE]);

export class SoundEffects extends SoundAmbience {
  /** Sitting down: a soft creak of wood and a settle. */
  sit() {
    this.tone(180, 120, 0.12, 'triangle', 0.08);
    this.hiss(0.08, 'lowpass', 900, 0.8, 0.05);
  }

  /** A tray lifted from or set on the counter: a light clink of metal. */
  tray() {
    this.tone(1650, 1500, 0.05, 'triangle', 0.09);
    this.tone(2350, 2200, 0.04, 'sine', 0.04, 0.03);
  }

  /** A tray on the floor: a clatter. */
  trayDown() {
    this.hiss(0.14, 'highpass', 2200, 0.8, 0.09);
    this.tone(980, 620, 0.09, 'square', 0.05);
    this.tone(760, 520, 0.08, 'square', 0.04, 0.07);
  }

  /** A mouthful, spoon on the plate. */
  bite() {
    this.tone(2200, 2100, 0.03, 'sine', 0.025);
    this.hiss(0.05, 'lowpass', 700, 0.8, 0.03, undefined, 0.05);
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

  /** The vending machine (2.32): a coin going down its slot. */
  vendCoin() {
    this.tone(1900, 1500, 0.05, 'square', 0.05);
    this.tone(2500, 2100, 0.06, 'square', 0.05, 0.07);
    this.tone(1400, 1100, 0.06, 'square', 0.04, 0.17);
  }

  /** Its coil turning: a low motor, as long as the turn. */
  vendCoil() {
    this.tone(120, 150, 1.2, 'sawtooth', 0.045, 0.2);
    this.tone(240, 300, 1.2, 'triangle', 0.03, 0.2);
  }

  /** What's bought hitting the flap. */
  vendDrop() {
    this.tone(180, 70, 0.14, 'triangle', 0.22);
    this.tone(90, 50, 0.1, 'square', 0.06, 0.02);
  }

  /** Stuck: a sour double buzz. */
  vendBuzz() {
    this.tone(160, 150, 0.14, 'sawtooth', 0.1);
    this.tone(120, 110, 0.22, 'sawtooth', 0.1, 0.18);
  }

  /** A thump on its side. */
  vendThump() {
    this.tone(110, 40, 0.2, 'triangle', 0.32);
    this.tone(300, 160, 0.06, 'square', 0.08);
    this.tone(1400, 900, 0.1, 'sine', 0.025, 0.04);
  }

  /** The water cooler (2.33): a cup filled, and the bottle's big bubble going up. */
  glug() {
    this.hiss(0.35, 'bandpass', 1800, 2.5, 0.05);
    this.tone(260, 520, 0.12, 'sine', 0.12, 0.28);
    this.tone(320, 640, 0.1, 'sine', 0.09, 0.42);
  }

  /** Chalk on the menu board (2.33): a few short scratchy strokes, as long as a scribble. */
  chalk() {
    for (let k = 0; k < 6; k++) this.hiss(0.16, 'highpass', 3200 + (k % 3) * 600, 1.2, 0.05 + 0.04 * (k % 2), undefined, k * 0.3);
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

  /** A press on the beat (2.29): brighter, a little longer. */
  repHit() {
    this.tone(760, 980, 0.09, 'triangle', 0.1);
  }

  /** The beat of a set (2.29): barely there, to keep time by. */
  setBeat() {
    this.tone(1400, 1300, 0.018, 'sine', 0.025);
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
    ])
      this.tone(f, f, 0.18, 'sine', 0.05, d);
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
    ])
      this.tone(f, f, 0.5, 'triangle', 0.1, d);
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
      for (const [f, g] of [
        [860, 0.07],
        [1370, 0.05],
        [2210, 0.035],
        [3120, 0.02],
      ] as const)
        this.tone(f, f * 0.995, 0.55, 'sine', g * gain);
      this.hiss(0.05, 'highpass', 3000, 0.7, 0.12 * gain);
      for (const [f, g] of [
        [860, 0.03],
        [1370, 0.02],
      ] as const)
        this.tone(f, f * 0.995, 0.3, 'sine', g * gain, 0.16);
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
    for (let k = 0; k < 6; k++)
      this.hiss(0.03, 'bandpass', 3000 + k * 400, 2, 0.1 * gain, undefined, 0.25 + k * 0.09 + Math.random() * 0.05);
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
}
