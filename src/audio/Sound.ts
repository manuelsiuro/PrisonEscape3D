import { MUSIC_LEVEL } from './soundMusic';
import { SoundEffects } from './soundEffects';

export type { Mood } from './soundMusic';
export type { Scene } from './soundAmbience';

/**
 * Synthesized sound (Web Audio, no files). The context starts on the first user gesture
 * (browsers block audio before one); a volume of 0 is silence (the mute switch).
 * Effects go through one output; the ambience (a low room tone and the odd distant clank)
 * has its own gain under it.
 * Built in layers (v2.34.2), each its own file: the synth (`soundCore.ts`), the score
 * (`soundMusic.ts`), the ambience, weather and siren (`soundAmbience.ts`), the everyday effects
 * (`soundEffects.ts`); here, the effects of the escapes and the later features.
 */
export class Sound extends SoundEffects {
  constructor() {
    super();
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
    for (let k = 0; k < n; k++)
      this.tone(2400 + (k % 2) * 500, 3100 + (k % 3) * 300, 0.06, 'triangle', 0.045 * gain, k * (panic ? 0.11 : 0.15));
    if (panic) for (let k = 0; k < 6; k++) this.hiss(0.04, 'bandpass', 3200, 3, 0.05 * gain, undefined, 0.05 + k * 0.07);
  }

  /** A rat scurrying off and back (P20): tiny claws on the floor. */
  scurry(gain = 1) {
    for (let k = 0; k < 4; k++) this.hiss(0.03, 'bandpass', 4200 - k * 200, 4, 0.04 * gain, undefined, k * 0.05);
  }

  /** The burner phone (P21): two quick keypad beeps and the double trill of a call going through. */
  phone() {
    this.tone(1336, 1336, 0.07, 'sine', 0.05);
    this.tone(1477, 1477, 0.07, 'sine', 0.05, 0.1);
    for (const at of [0.28, 0.4]) this.tone(440, 480, 0.08, 'triangle', 0.05, at);
  }

  /** The pay phone (P34): coins dropping into the box, then the dial tone's hum (`ring`: the far end ringing twice instead). */
  payphone(ring = false) {
    this.tone(2600, 2400, 0.04, 'triangle', 0.04);
    this.tone(2200, 2000, 0.04, 'triangle', 0.035, 0.09);
    this.tone(160, 150, 0.08, 'triangle', 0.05, 0.2);
    if (ring)
      for (const at of [0.45, 0.95]) {
        this.tone(440, 440, 0.32, 'sine', 0.025, at);
        this.tone(480, 480, 0.32, 'sine', 0.025, at);
      }
    else {
      this.tone(350, 350, 0.5, 'sine', 0.02, 0.32);
      this.tone(440, 440, 0.5, 'sine', 0.02, 0.32);
    }
  }

  /** The handset put back on its hook (P34): a plastic clunk. */
  hangUp() {
    this.tone(320, 140, 0.07, 'square', 0.03);
    this.hiss(0.05, 'lowpass', 900, 0.7, 0.05);
  }

  /** Keys typed at the kiosk (P35): a few quick plastic clicks, uneven. */
  keys() {
    const at = [0, 0.07, 0.15, 0.2, 0.29, 0.36];
    at.forEach((d, k) => {
      this.hiss(0.025, 'highpass', 2600 + (k % 3) * 400, 1.2, 0.035, undefined, d);
      this.tone(1800 + (k % 2) * 300, 1500, 0.02, 'square', 0.006, d);
    });
  }

  /** A car alarm far off at the gate (P34): a few whooping rises, then honks. */
  carAlarm() {
    for (let k = 0; k < 4; k++) this.tone(620, 1180, 0.32, 'sawtooth', 0.016, k * 0.34);
    for (let k = 0; k < 3; k++) this.tone(420, 410, 0.16, 'square', 0.018, 1.45 + k * 0.28);
  }

  /** A drone overhead (P21): the whine of four little rotors, beating against each other, swelling and fading (`gain`: how near). */
  droneBuzz(gain = 1) {
    if (gain <= 0.02) return;
    this.tone(210, 228, 1.6, 'sawtooth', 0.022 * gain);
    this.tone(232, 214, 1.6, 'sawtooth', 0.02 * gain, 0.04);
    this.hiss(1.4, 'bandpass', 1800, 3, 0.03 * gain, undefined, 0.1);
  }

  /** Something dropped by the drone landing (a soft thump on the ground). */
  parcelThump(gain = 1) {
    this.tone(120, 60, 0.12, 'triangle', 0.09 * gain);
    this.hiss(0.08, 'lowpass', 600, 0.7, 0.08 * gain);
  }

  /** Dice shaken in a cupped hand (P22): a dry rattle of quick clicks. */
  diceRattle() {
    for (let k = 0; k < 7; k++) {
      const d = k * 0.045 + Math.random() * 0.02;
      this.tone(1900 + Math.random() * 900, 1500, 0.025, 'square', 0.025, d);
    }
    this.hiss(0.32, 'bandpass', 2600, 2.2, 0.035);
  }

  /** Dice landing (P22): a clack each, then a little skitter as they settle (`gain`: how near). */
  diceLand(gain = 1) {
    if (gain <= 0.02) return;
    for (const [d, g] of [
      [0, 1],
      [0.05, 0.8],
      [0.13, 0.45],
      [0.2, 0.3],
      [0.26, 0.18],
    ])
      this.tone(1450 + Math.random() * 500, 1100, 0.03, 'square', 0.05 * g * gain, d);
  }

  /** Straining at an arm-wrestle (P22): a short throaty grunt. */
  grunt() {
    const f = 130 + Math.random() * 40;
    this.tone(f, f * 0.8, 0.2, 'sawtooth', 0.045);
    this.hiss(0.16, 'lowpass', 500, 0.8, 0.04);
  }

  /** A bout won in front of people (P22): a short cheer and some clapping. */
  cheer() {
    this.hiss(1.2, 'bandpass', 900, 0.9, 0.12, undefined, 0, 0.15);
    for (let k = 0; k < 8; k++) this.hiss(0.04, 'bandpass', 2200, 2, 0.05, undefined, 0.15 + k * 0.11 + Math.random() * 0.04);
    for (let k = 0; k < 3; k++) {
      const f = 420 + Math.random() * 200;
      this.tone(f, f * 1.5, 0.2, 'triangle', 0.03, 0.05 + k * 0.18);
    }
  }

  /** A lookout's warning (P23): a lip whistle, up then down, that a guard wouldn't take for anything. */
  lookout() {
    this.tone(1300, 2500, 0.16, 'sine', 0.09);
    this.tone(2350, 1250, 0.3, 'sine', 0.09, 0.2);
    this.hiss(0.42, 'bandpass', 2000, 3, 0.012);
  }

  /** A brawl breaking out (P23): a scuffle of thumps and a grunt or two. */
  scuffle() {
    for (const d of [0, 0.16, 0.29, 0.5]) {
      this.hiss(0.08, 'lowpass', 500 + Math.random() * 200, 0.9, 0.14, undefined, d);
      this.tone(110 + Math.random() * 30, 50, 0.1, 'sine', 0.1, d);
    }
    const f = 140 + Math.random() * 30;
    this.tone(f, f * 0.78, 0.22, 'sawtooth', 0.04, 0.2);
  }

  /** Waved through the checkpoint (P24): a rubber stamp on the papers, then the gate's buzzer-lock giving. */
  stamp() {
    this.tone(150, 70, 0.09, 'triangle', 0.16);
    this.hiss(0.06, 'lowpass', 900, 0.8, 0.12);
    this.tone(118, 116, 0.5, 'square', 0.035, 0.32);
    this.tone(236, 232, 0.5, 'sawtooth', 0.018, 0.32);
    this.tone(900, 420, 0.12, 'triangle', 0.06, 0.86);
  }

  /** The checkpoint's gates shut again (P24): a heavy clunk. */
  gateShut() {
    this.tone(90, 45, 0.22, 'triangle', 0.16);
    this.hiss(0.14, 'lowpass', 700, 0.8, 0.12);
  }

  /** Off a roof on a glider (P24): the run-up's last steps, then a long rush of air, the sheet thrumming (`secs`: the flight). */
  glide(secs: number) {
    for (const d of [0, 0.14, 0.26]) this.hiss(0.05, 'lowpass', 600, 0.9, 0.09, undefined, d);
    this.hiss(secs + 0.3, 'bandpass', 700, 0.6, 0.11, undefined, 0.3, 0.4);
    this.tone(62, 70, secs, 'sawtooth', 0.012, 0.35);
  }

  /** A glider coming down (P24): a scuff and a thump. */
  touchdown() {
    this.hiss(0.25, 'lowpass', 900, 0.7, 0.16);
    this.tone(110, 50, 0.16, 'sine', 0.14);
  }

  /** A lockpick's pin set (P22): a tiny bright click. */
  pickClick() {
    this.tone(3400, 2900, 0.025, 'square', 0.04);
    this.tone(1900, 1700, 0.04, 'triangle', 0.05, 0.01);
  }

  /** The pick slipping (P22): a metal scrape and a jolt. */
  pickSlip() {
    this.hiss(0.2, 'bandpass', 2800, 3, 0.09);
    this.tone(900, 420, 0.16, 'sawtooth', 0.04);
  }

  /** The last pin, and the bolt slides back (P22): a click and a heavy clunk. */
  unlock() {
    this.pickClick();
    this.tone(240, 150, 0.16, 'triangle', 0.14, 0.08);
    this.hiss(0.1, 'lowpass', 900, 0.9, 0.08, undefined, 0.08);
  }

  /** Cards dealt (P27): a quick riffle, then a card slid out to each in turn. */
  cardDeal() {
    this.hiss(0.32, 'bandpass', 3800, 1.4, 0.05);
    for (let k = 0; k < 6; k++) this.hiss(0.035, 'highpass', 3000, 0.8, 0.05, undefined, 0.36 + k * 0.07);
  }

  /** Cards laid face down (P27, `n` of them): a soft slap each. */
  cardLay(n = 1) {
    for (let k = 0; k < Math.max(1, n); k++) this.hiss(0.05, 'bandpass', 1900, 1.1, 0.08, undefined, k * 0.09);
  }

  /** Cards turned over on a call (P27): a snap. */
  cardFlip() {
    this.hiss(0.06, 'highpass', 2500, 0.9, 0.09);
    this.tone(1200, 700, 0.05, 'triangle', 0.03);
  }

  /** "Liar!" called (P27): a palm slapped on the table. */
  slap() {
    this.hiss(0.09, 'lowpass', 1400, 0.8, 0.18);
    this.tone(160, 80, 0.1, 'sine', 0.12);
  }

  /** A basketball bounced (P27, `gain`: how near). */
  bounce(gain = 1) {
    if (gain <= 0.02) return;
    this.tone(150, 70, 0.12, 'sine', 0.16 * gain);
    this.hiss(0.05, 'lowpass', 900, 0.8, 0.06 * gain);
  }

  /** Nothing but net (P27): a soft swish. */
  swish(gain = 1) {
    this.hiss(0.28, 'bandpass', 3200, 0.9, 0.09 * gain, undefined, 0, 0.12);
  }

  /** The ball off the rim (P27): a ringing clang. */
  rimClang(gain = 1) {
    this.tone(640, 600, 0.35, 'triangle', 0.07 * gain);
    this.tone(1530, 1490, 0.25, 'sine', 0.035 * gain);
    this.hiss(0.05, 'highpass', 2500, 1, 0.05 * gain);
  }

  /** A checker set down on the board (P27): a wooden clack (`jump`: a capture, two). */
  checker(jump = false) {
    this.tone(900, 700, 0.04, 'square', 0.035);
    this.hiss(0.04, 'bandpass', 1700, 2, 0.07);
    if (jump) {
      this.tone(820, 640, 0.04, 'square', 0.03, 0.11);
      this.hiss(0.04, 'bandpass', 1500, 2, 0.06, undefined, 0.11);
    }
  }

  /** Pruno drunk (P28): three gulps, and a satisfied gasp. */
  gulp() {
    for (let k = 0; k < 3; k++) this.tone(260, 140, 0.09, 'sine', 0.09, k * 0.17);
    this.hiss(0.25, 'lowpass', 900, 0.7, 0.04, undefined, 0.55);
  }

  /** A tipsy stumble (P28, `gain`: how near): a hiccup and a scuff of feet. */
  hiccup(gain = 1) {
    if (gain <= 0.02) return;
    this.tone(520, 820, 0.07, 'triangle', 0.07 * gain);
    this.hiss(0.08, 'bandpass', 900, 1.2, 0.07 * gain, undefined, 0.09);
  }

  /** Water poured on a garden bed (P28): a trickle, then a soft soak. */
  pour() {
    this.hiss(0.5, 'bandpass', 2600, 1.6, 0.06, undefined, 0, 0.15);
    this.hiss(0.3, 'lowpass', 800, 0.7, 0.04, undefined, 0.35);
  }

  /** A seed pressed into soil (P28): two soft pats. */
  plant() {
    for (let k = 0; k < 2; k++) this.hiss(0.07, 'lowpass', 500, 0.8, 0.12, undefined, k * 0.14);
  }

  /** A crop pulled up (P28): a tug and a pop of earth. */
  pluck() {
    this.hiss(0.14, 'lowpass', 700, 0.9, 0.1);
    this.tone(330, 520, 0.08, 'triangle', 0.06, 0.12);
  }

  /** The race (P28): tiny feet pattering down the track. */
  patter(gain = 1) {
    for (let k = 0; k < 8; k++) this.hiss(0.025, 'bandpass', 3800 + (k % 3) * 400, 4, 0.04 * gain, undefined, k * 0.045);
  }

  /** A football kicked (P29, `power` 0–1): a leather thump. */
  kick(power = 0.5) {
    this.tone(150, 70, 0.09, 'sine', 0.12 + 0.1 * power);
    this.hiss(0.05, 'lowpass', 1400, 0.8, 0.06 + 0.06 * power);
  }

  // ---------------------------------------------------------------- stage nights (P30)

  /** A bucket drum struck (lane 0 the big one, 1 the snare-ish rim, 2 the small one). */
  drum(lane: number, gain = 1) {
    if (gain <= 0.02) return;
    if (lane === 1) {
      this.hiss(0.11, 'bandpass', 2200, 0.9, 0.12 * gain);
      this.tone(240, 180, 0.08, 'triangle', 0.08 * gain);
    } else {
      const f = lane === 0 ? 120 : 200;
      this.tone(f, f * 0.55, 0.18, 'sine', 0.22 * gain);
      this.hiss(0.04, 'lowpass', 1600, 0.8, 0.06 * gain);
    }
  }

  /** A guitar note (semitones above A3): a plucked string, bright then dark. */
  strum(pitch: number, gain = 1) {
    if (gain <= 0.02) return;
    const f = 220 * 2 ** (pitch / 12);
    this.tone(f, f * 0.998, 0.5, 'sawtooth', 0.045 * gain);
    this.tone(f * 2, f * 1.996, 0.25, 'triangle', 0.03 * gain);
    this.hiss(0.02, 'highpass', 3000, 1, 0.03 * gain);
  }

  /** A note fluffed: a dull clunk. */
  dud(gain = 1) {
    if (gain <= 0.02) return;
    this.tone(95, 70, 0.12, 'square', 0.035 * gain);
  }

  /** The backing's beat: a kick, a snare, a hat. */
  beat(kind: 'kick' | 'snare' | 'hat', gain = 1) {
    if (gain <= 0.02) return;
    if (kind === 'kick') this.tone(110, 45, 0.16, 'sine', 0.2 * gain);
    else if (kind === 'snare') this.hiss(0.12, 'highpass', 1800, 0.7, 0.07 * gain);
    else this.hiss(0.03, 'highpass', 7000, 0.7, 0.03 * gain);
  }

  /** The bass on a chord's root (semitones above A3, played two octaves down). */
  bass(root: number, gain = 1) {
    if (gain <= 0.02) return;
    const f = 55 * 2 ** (root / 12);
    this.tone(f, f, 0.35, 'triangle', 0.12 * gain);
  }

  /** The tattoo gun at work (P29): a short electric buzz (played again and again while it works). */
  needle(gain = 1) {
    this.tone(118, 118, 0.2, 'sawtooth', 0.022 * gain);
    this.tone(236, 236, 0.2, 'square', 0.007 * gain);
  }

  /** Into the vehicle among the crates (a shuffle, a creak), and out again. */
  stow(on: boolean) {
    this.hiss(0.22, 'lowpass', 700, 0.7, 0.12);
    this.tone(on ? 330 : 260, on ? 240 : 360, 0.16, 'triangle', 0.05, 0.08);
    this.hiss(0.1, 'bandpass', 1500, 1.5, 0.05, undefined, 0.22);
  }
}
