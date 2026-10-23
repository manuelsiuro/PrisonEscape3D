// Dev tool, run in the browser on the dev server (see trailer.ts): the trailer's score, rendered
// offline (score.wav, 48 kHz stereo). It is the game's own music: its progression in D minor
// (Dm–B♭–Gm–A, Sound.ts), its voices (the walking bass, the pads, the tension mood's driving
// ostinato, ticking hat and heartbeat) and its effects (the bell, the PA, a shovel, a coin, the
// glider, the escape's fanfare), arranged on the cut: the day's march at 88 bpm, the plan's
// drive at 126. Every note is scheduled on the offline clock; the effects, which play "now",
// are called with the render suspended at their moment.
//   const s = await import('/scripts/dev/trailerscore.ts');
//   await s.score();
import { Sound } from '../../src/audio/Sound';
import { BEAT1, BEAT2, FPS, timeline } from './trailer';
import { TOUCHDOWN } from './trailertitles';

const SINK = 'http://127.0.0.1:5312';
const SR = 48000;
/** The frame the glider leaves the roof (read off the film). */
const TAKEOFF = 952;

/** The game's chords (Sound.ts): the root, then the voices, in semitones above D3. */
const DM = [0, 0, 3, 7, 10];
const BB = [-4, -4, 0, 3, 7];
const GM = [-7, 5, 8, 12, 15];
const A7 = [-5, 7, 11, 14, 17];
const hz = (semi: number) => 146.83 * 2 ** (semi / 12);

/** Sound's private voices, reached from here (the instance's own methods, its own sound). */
interface Voices {
  ctx: BaseAudioContext;
  out: AudioNode;
  musicOut: AudioNode;
  noise: AudioBuffer;
  volume: number;
  musicVolume: number;
  note(f: number, at: number, dur: number, type: OscillatorType, gain: number, attack?: number, cutoff?: number): void;
  pad(chord: readonly number[], at: number, dur: number, gain: number, cutoff: number): void;
  tick(at: number, gain: number): void;
  thump(at: number, gain: number): void;
}

export async function score() {
  const marks: Record<string, { at: number; end: number }> = {};
  for (const c of timeline()) marks[c.id] = { at: c.from / FPS, end: (c.from + c.frames) / FPS };
  const total = marks.end.end;
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * (total + 0.3)), SR);

  // ---------------------------------------------------------------- the mix
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;
  master.connect(comp).connect(ctx.destination);
  // A room: a stereo tail of decaying noise, a little of everything sent to it.
  const verb = ctx.createConvolver();
  const ir = ctx.createBuffer(2, SR * 2.4, SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3.2;
  }
  verb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  verb.connect(wet).connect(master);
  const bus = (gain: number) => {
    const g = ctx.createGain();
    g.gain.value = gain;
    g.connect(master);
    g.connect(verb);
    return g;
  };
  const fx = bus(0.85);
  const noise = ctx.createBuffer(1, SR * 2, SR);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const snd = new Sound() as unknown as Voices & Sound;
  Object.assign(snd, { ctx, out: fx, noise, volume: 0.8, musicVolume: 1 });
  const v = snd as Voices;
  /** Notes from here on go to this bus (a section's own, faded or cut as a whole). */
  const into = (b: AudioNode) => (v.musicOut = b);

  // ---------------------------------------------------------------- own voices
  /** A burst of filtered noise at a moment. */
  function hiss(at: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, to: AudioNode = v.musicOut, f1 = 0) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, at);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, at + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(to);
    src.start(at, Math.random());
    src.stop(at + dur + 0.05);
  }
  const snare = (at: number, gain: number) => {
    hiss(at, 0.16, 'bandpass', 1900, 0.7, gain);
    v.note(190, at, 0.08, 'triangle', gain * 0.6, 0.002);
  };
  const crash = (at: number, gain: number) => {
    hiss(at, 1.6, 'highpass', 5000, 0.5, gain);
    hiss(at, 0.9, 'lowpass', 1200, 0.5, gain * 0.8);
  };
  /** Noise rising (a band sweeping up, swelling) into a moment. */
  function riser(t0: number, t1: number, gain: number) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t0);
    f.frequency.exponentialRampToValueAtTime(7000, t1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t1 - 0.02);
    g.gain.linearRampToValueAtTime(0, t1);
    src.connect(f).connect(g).connect(v.musicOut);
    src.start(t0);
    src.stop(t1 + 0.05);
  }
  /** The needle dragged off the record. */
  function scratch(at: number) {
    hiss(at, 0.3, 'bandpass', 3200, 2.5, 0.35, fx, 250);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, at);
    o.frequency.exponentialRampToValueAtTime(90, at + 0.32);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.12, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
    o.connect(g).connect(fx);
    o.start(at);
    o.stop(at + 0.36);
  }
  /** The lockdown siren (as Sound's), on between two moments. */
  function siren(t0: number, t1: number, gain: number) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.3);
    g.gain.setValueAtTime(gain, t1 - 0.08);
    g.gain.linearRampToValueAtTime(0, t1);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 900;
    band.Q.value = 0.8;
    band.connect(g).connect(fx);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.9;
    const depth = ctx.createGain();
    depth.gain.value = 260;
    lfo.connect(depth);
    for (const [f, type] of [
      [720, 'sawtooth'],
      [724, 'square'],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      depth.connect(o.frequency);
      o.connect(band);
      o.start(t0);
      o.stop(t1 + 0.05);
    }
    lfo.start(t0);
    lfo.stop(t1 + 0.05);
  }
  /** A chord held (the game's pad, two detuned saws a voice, low-passed) at an even level, not dying away. */
  function hold(chord: readonly number[], at: number, dur: number, gain: number, cutoff: number, attack = 0.25, release = 0.3) {
    for (const semi of chord.slice(1))
      for (const [mul, share] of [
        [1, 1],
        [1.006, 0.7],
      ]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = hz(semi) * mul;
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = cutoff;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(gain * share, at + attack);
        g.gain.setValueAtTime(gain * share, at + dur - release);
        g.gain.linearRampToValueAtTime(0, at + dur);
        o.connect(f).connect(g).connect(v.musicOut);
        o.start(at);
        o.stop(at + dur + 0.05);
      }
  }
  /** A chord struck hard (the hits): roots low, the voices as short saws. */
  function stab(chord: readonly number[], at: number, gain: number, dur = 0.7) {
    v.note(hz(chord[0] - 24), at, dur * 1.6, 'sine', gain * 2, 0.005);
    v.note(hz(chord[0] - 12), at, dur, 'sawtooth', gain, 0.005, 900);
    for (const s of chord.slice(1)) v.note(hz(s), at, dur, 'sawtooth', gain * 0.5, 0.005, 2200);
  }

  // The effects: called with the render held at their moment (they play "now").
  const cues = new Map<number, Array<() => void>>();
  const cue = (at: number, fn: () => void) => {
    const q = Math.round((at * SR) / 128) * 128;
    cues.set(q, [...(cues.get(q) ?? []), fn]);
  };

  // ---------------------------------------------------------------- 1. cold open (the title's mood)
  const openBus = bus(0.9);
  into(openBus);
  hold(DM, 0, 3.0, 0.022, 1300, 1.2, 0.35);
  v.note(hz(-24), 0, 3.3, 'sine', 0.12, 0.5);
  cue(0.1, () => snd.bell());
  cue(0.85, () => snd.paChime());
  cue(1.8, () => snd.paVoice(8));

  // ---------------------------------------------------------------- 2. the model prisoner (the day's march, 88 bpm)
  const dayBus = bus(1);
  into(dayBus);
  {
    const t0 = marks.rollcall.at;
    const e = BEAT1 / 2;
    const walk = [0, -1, 7, -1, 12, -1, 7, 5];
    const motifs = [
      [2, -1, 3, -1, 4, -1, 3, 2],
      [4, -1, 3, -1, 2, -1, 3, 4],
      [2, 3, 4, -1, 2, 3, 4, -1],
    ];
    for (let k = 0; k < 24; k++) {
      const at = t0 + k * e;
      const bar = k >> 3;
      const inBar = k & 7;
      const chord = bar === 0 ? DM : bar === 1 ? BB : inBar < 4 ? GM : A7;
      if (walk[inBar] >= 0) v.note(hz(chord[0] - 24 + walk[inBar]), at, e * 1.5, 'triangle', 0.14, 0.01, 900);
      if (inBar === 0 || inBar === 4) v.thump(at, 0.24);
      if (inBar === 2 || inBar === 6) snare(at, 0.06);
      if (inBar % 2) v.tick(at, 0.025);
      if (inBar === 0 || (bar === 2 && inBar === 4)) hold(chord, at, (bar === 2 ? 4 : 8) * e, 0.016, 1100, 0.08, 0.12);
      const m = motifs[bar][inBar];
      if (m >= 0) v.note(hz(chord[m] + 12), at, e * 1.4, 'triangle', 0.06, 0.004, 3000);
    }
    cue(marks.rollcall.at + 0.05, () => snd.chime());
    cue(marks.work.at + 0.1, () => snd.coin());
    cue(marks.football.at + 0.35, () => snd.kick(0.8));
    cue(marks.talent.at + 0.1, () => snd.cheer());
    cue(marks.race.at + 0.2, () => snd.squeak(0.9));
  }
  // Cut dead on the turn.
  const turn = marks.turn.at;
  dayBus.gain.setValueAtTime(1, turn - 0.02);
  dayBus.gain.linearRampToValueAtTime(0, turn + 0.03);

  // ---------------------------------------------------------------- 3. the turn: a scratch, silence, a heartbeat, a rise
  const turnBus = bus(1);
  into(turnBus);
  scratch(turn);
  v.note(hz(-24), turn + 0.6, 2.2, 'sine', 0.15, 0.7);
  v.note(hz(-12), turn + 0.6, 2.2, 'sawtooth', 0.025, 0.9, 300);
  for (const b of [0.8, 1.45, 2.05]) {
    v.thump(turn + b, 0.32);
    v.thump(turn + b + 0.22, 0.18);
  }
  riser(turn + 1.1, marks.vents.at, 0.16);
  cue(turn + 1.2, () => snd.drawer());

  // ---------------------------------------------------------------- 4–6. the plan, the prisons, the escape (the tension mood's drive, 126 bpm)
  const driveBus = bus(1);
  into(driveBus);
  const e2 = BEAT2 / 2;
  const plan = marks.vents.at;
  const takeoff = TAKEOFF / FPS;
  const touch = TOUCHDOWN / FPS;
  /** Bar `b` from the plan's first beat: its chord, and what plays in it. */
  const PLAN_BARS = [DM, BB, GM, A7];
  const PRISON_BARS = [DM, BB, GM, A7, A7];
  const drive = (at: number, k: number, chord: readonly number[], layers: number) => {
    const inBar = k % 8;
    v.note(hz(chord[0] - 12), at, e2 * 0.9, 'sawtooth', 0.1, 0.005, 420 + layers * 60);
    if (layers >= 1 && inBar % 2 === 1) v.note(hz(chord[0] - 5), at, e2 * 0.8, 'sawtooth', 0.05, 0.005, 600);
    v.tick(at, inBar % 2 === 0 ? 0.035 : 0.02);
    if (inBar === 0 || inBar === 1) v.thump(at, inBar === 0 ? 0.32 : 0.18);
    if (inBar === 0) hold(chord, at, e2 * 8, 0.014 + layers * 0.002, 500 + layers * 180, 0.05, 0.08);
    if (layers >= 2) {
      const arp = [1, 2, 3, 4, 3, 2, 1, 2];
      v.note(hz(chord[arp[inBar]] + 12), at, e2 * 1.2, 'triangle', 0.045, 0.004, 3200);
    }
    if (layers >= 3 && (inBar === 2 || inBar === 6)) snare(at, 0.085);
    if (layers >= 4) v.tick(at + e2 / 2, 0.016);
  };
  // The plan: a hit, then four bars; a hit and the scene's own sound on every word.
  stab(DM, plan, 0.07);
  v.thump(plan, 0.5);
  crash(plan, 0.22);
  for (let k = 0; k < 32; k++) drive(plan + k * e2, k, PLAN_BARS[k >> 3], k < 8 ? 0 : 1);
  const WORD_FX: Array<[string, () => void]> = [
    ['dig', () => snd.strike('dig', true)],
    ['cut', () => snd.strike('cut', true)],
    ['bribe', () => snd.coin(true)],
    ['smuggle', () => snd.droneBuzz(0.9)],
    ['disguise', () => snd.stamp()],
    ['rat', () => snd.squeak(1)],
  ];
  for (const [id, fn] of WORD_FX) {
    v.thump(marks[id].at, 0.36);
    hiss(marks[id].at, 0.2, 'bandpass', 2400, 0.8, 0.08);
    cue(marks[id].at + 0.03, fn);
  }
  // Five prisons: five bars, a layer more on each, a stamp on every name, a rise into the escape.
  const prisons = marks['center-perks'].at;
  for (let k = 0; k < 40; k++) drive(prisons + k * e2, k, PRISON_BARS[k >> 3], 1 + Math.min(3, k >> 3));
  for (const id of ['center-perks', 'stalag-flucht', 'shankton', 'san-pancho', 'irongate']) {
    cue(marks[id].at + 0.3, () => snd.stamp());
    crash(marks[id].at, 0.08);
  }
  for (let k = 0; k < 8; k++) snare(marks.irongate.at + e2 * 4 + (k * e2) / 2, 0.04 + k * 0.012);
  riser(marks.irongate.at, marks.escape.at, 0.14);
  // The escape: the drive at full, the siren; it all stops as the glider leaves the roof.
  const esc = marks.escape.at;
  stab(DM, esc, 0.06);
  crash(esc, 0.2);
  for (let k = 0; esc + k * e2 < takeoff; k++) drive(esc + k * e2, k, DM, 4);
  siren(esc, takeoff, 0.035);
  driveBus.gain.setValueAtTime(1, takeoff - 0.03);
  driveBus.gain.linearRampToValueAtTime(0, takeoff + 0.05);

  // ---------------------------------------------------------------- 7. the glide (slow motion), the touchdown, out
  const glideBus = bus(1);
  into(glideBus);
  cue(takeoff - 0.25, () => snd.glide(touch - takeoff + 0.2));
  hold(DM.map((s) => s + 12), takeoff, touch - takeoff, 0.014, 2600, 0.6, 0.1);
  hold(DM, takeoff, touch - takeoff, 0.016, 700, 0.8, 0.1);
  v.note(hz(-24), takeoff, touch - takeoff, 'sine', 0.12, 1.2);
  v.note(hz(19), takeoff + 0.6, 2.4, 'sine', 0.025, 0.8);
  v.note(hz(17), takeoff + 1.6, 1.8, 'sine', 0.02, 0.6);
  riser(touch - 1.3, touch, 0.15);
  // The touchdown: the biggest hit, the escape's fanfare, the drive back to the end.
  const endBus = bus(1);
  into(endBus);
  stab(DM, touch, 0.09, 1.1);
  v.thump(touch, 0.6);
  crash(touch, 0.3);
  cue(touch, () => snd.touchdown());
  cue(touch + 0.08, () => snd.fanfare());
  for (let k = 0; touch + k * e2 < marks.end.at - 0.01; k++) drive(touch + k * e2, k, k < 4 ? DM : BB, 3);

  // ---------------------------------------------------------------- 8. the end card: the cell door, the title's theme, home to D minor
  const fin = marks.end.at;
  cue(fin, () => snd.lockClank());
  v.thump(fin, 0.45);
  crash(fin, 0.14);
  const bar = BEAT2 * 4;
  const motif = [2, -1, 3, -1, 4, -1, 3, 2];
  [BB, A7].forEach((chord, b) => {
    const at = fin + b * bar;
    hold(chord, at, bar + 0.05, 0.02, 1300, 0.15, 0.2);
    v.note(hz(chord[0] - 24), at, bar + 0.2, 'sine', 0.13, 0.3);
    motif.forEach((m, k) => m >= 0 && v.note(hz(chord[m] + 12), at + k * e2, e2 * 3.5, 'triangle', 0.05, 0.01, 3000));
  });
  const home = fin + 2 * bar;
  hold(DM, home, total - home, 0.024, 1300, 0.1, 0.6);
  v.note(hz(-24), home, total - home + 0.3, 'sine', 0.15, 0.05);
  v.note(hz(12), home, 2.2, 'sine', 0.04, 0.005);
  v.note(hz(12) * 2.76, home, 0.9, 'sine', 0.012, 0.005);
  v.thump(home, 0.3);
  master.gain.setValueAtTime(1, total - 0.9);
  master.gain.linearRampToValueAtTime(0, total);

  // ---------------------------------------------------------------- render
  for (const [q, fns] of [...cues.entries()].sort((a, b) => a[0] - b[0])) {
    ctx.suspend(q / SR).then(() => {
      for (const fn of fns) fn();
      return ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  // Peaks to -1 dBFS.
  let peak = 0;
  for (let ch = 0; ch < 2; ch++) for (const x of buf.getChannelData(ch)) peak = Math.max(peak, Math.abs(x));
  const gain = peak > 0 ? 0.89 / peak : 1;
  const wav = toWav(buf, gain);
  const res = await fetch(`${SINK}/?name=score.wav`, { method: 'POST', body: wav });
  if (!res.ok) throw new Error(`score.wav: the sink said ${res.status}`);
  return { secs: +(buf.length / SR).toFixed(2), peak: +peak.toFixed(3), cues: cues.size };
}

/** 16-bit PCM WAV. */
function toWav(buf: AudioBuffer, gain: number): Blob {
  const n = buf.length;
  const chs = buf.numberOfChannels;
  const data = new DataView(new ArrayBuffer(44 + n * chs * 2));
  const str = (o: number, s: string) => [...s].forEach((c, k) => data.setUint8(o + k, c.charCodeAt(0)));
  str(0, 'RIFF');
  data.setUint32(4, 36 + n * chs * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, chs, true);
  data.setUint32(24, buf.sampleRate, true);
  data.setUint32(28, buf.sampleRate * chs * 2, true);
  data.setUint16(32, chs * 2, true);
  data.setUint16(34, 16, true);
  str(36, 'data');
  data.setUint32(40, n * chs * 2, true);
  const ch = [...Array(chs)].map((_, k) => buf.getChannelData(k));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < chs; c++) {
      const x = Math.max(-1, Math.min(1, ch[c][i] * gain));
      data.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      o += 2;
    }
  return new Blob([data.buffer], { type: 'audio/wav' });
}
