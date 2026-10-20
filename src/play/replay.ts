import { itemNumber } from '../content/items';
import { PRISONS } from '../content/prisons';
import { readPrisoner } from '../game/prisoner';
import type { Replay } from '../game/replays';
import { t, type Key } from '../i18n';
import { runScout } from '../replay/run';
import { autoSpeed, KEY_STEPS, Tape, type Highlight, type Keyframe } from '../replay/scout';
import { Autopilot } from '../sim/ai/autopilot';
import { prepareReplay, RunRecorder } from '../sim/runlog';
import { ESCAPES, type Sim, type SimEvent } from '../sim/Sim';
import { itemOf } from '../sim/systems/items';
import { tileOfBody } from '../sim/systems/movement';
import { ladderFootOf } from '../sim/systems/structure';
import { STEPS_PER_MINUTE, STEPS_PER_SECOND, UNIT } from '../sim/tuning';
import { LAYER } from '../sim/world/World';
import { prisonName } from '../ui/screens/prisons';
import { ReplayBar, SPEEDS, whenOf } from '../ui/replayBar';
import { banner, click, combatUI, controls, crewChips, darkCell, hint, hud, itemsUI, sleepVeil, solitaryPanel, sound, tools, vignette, view, workChips } from './context';
import { press, targets } from './buttons';
import { buildFrame } from './frame';
import { play, tickPlayClock, type Game } from './game';
import { hudFrame } from './overlay';
import { escapeScene, stageWorld } from './stage';

/**
 * The replay viewer (P25): a stored escape played again on screen, from its commands. The
 * scout (a worker) runs ahead checking it and leaving keyframes and highlights; the picture is
 * a second sim on the main thread, stepped a few milliseconds a frame at the pace chosen (Auto:
 * the director slows down for the highlights), jumping by keyframes when the scrubber is moved.
 * Nothing in it counts for anything: no records, no achievements, no stats, no saves.
 */

/** The main thread's share of a frame for stepping the picture's sim. */
const BUDGET_MS = 4;
const HOUR = 60 * STEPS_PER_MINUTE;

export interface ReplayRun {
  replay: Replay;
  tape: Tape;
  /** The log's first step and last. */
  from: number;
  last: number;
  /** Where it plays to (known once the scout is done: the end, or the last hour that checked). */
  end: number | null;
  /** How far the scout has got (the scrubber goes no further). */
  reach: number;
  keys: Keyframe[];
  finale: Keyframe | null;
  highlights: Highlight[];
  quiet: Array<[number, number]>;
  checking: number | null;
  /** 0: Auto; else 1, 4, 16 or 64. */
  speed: number;
  /** The pace being played at (Auto eases it). */
  pace: number;
  playing: boolean;
  quietSkip: boolean;
  /** At the end (the escape played out, or as far as it checked). */
  ended: boolean;
  /** The escape camera's moment. */
  cinema: boolean;
  /** A jump under way (stepped a few milliseconds a frame). */
  seekTo: number | null;
  /** The next highlight to caption, and when (real time) the last was said. */
  nextMark: number;
  saidAt: number;
  bar: ReplayBar;
  close: () => void;
}

/** Each step's positions before it (the view slides between them). */
function remember(g: Game) {
  const st = g.rec.sim.state;
  g.prev.x = st.player.x;
  g.prev.z = st.player.z;
  const keep = (list: Array<{ x: number; z: number }>, from: ReadonlyArray<{ body: { x: number; z: number } }>) => {
    list.length = from.length;
    from.forEach((m, k) => {
      const q = (list[k] ??= { x: 0, z: 0 });
      q.x = m.body.x;
      q.z = m.body.z;
    });
  };
  keep(g.prevInmates, st.inmates);
  keep(g.prevGuards, st.guards);
  keep(g.prevDogs, st.dogs);
  g.prevRats.length = st.rats.length;
  st.rats.forEach((r, k) => {
    const q = (g.prevRats[k] ??= { x: 0, z: 0, mode: 0 });
    q.x = r.x;
    q.z = r.z;
    q.mode = r.mode;
  });
}

/** What a replay shows of an event: the effects in the picture, and a few sounds while it plays slowly. */
function replayFx(e: SimEvent, sim: Sim, slow: boolean) {
  const p = sim.state.player;
  switch (e.type) {
    case 'strike':
      // (Fast, only what gives way: every blow of a dig at 64× would shake the picture without end.)
      if (slow || e.broke) view.impact(e.action, e.tile, e.layer, e.broke);
      if (slow) sound.strike(e.action, e.broke);
      break;
    case 'shocked':
      view.shock();
      if (slow) sound.zap();
      break;
    case 'blast':
      view.blast(e.tile);
      if (slow) sound.blast();
      break;
    case 'flood':
    case 'caveIn':
      view.impact('dig', e.tile, LAYER.UNDER, true);
      break;
    case 'scanned':
      if (e.tripped) view.tripArch();
      break;
    case 'shot':
      view.shot(e.tower, p.x / UNIT, p.z / UNIT, e.hit);
      break;
    case 'hit':
      if (slow || e.ko) view.blow(-1, e.who, e.ko);
      break;
    case 'hurt':
      if (slow && e.by >= 0) view.blow(e.by, -1, false);
      break;
    case 'allyHit':
      if (slow || e.ko) view.blow(e.by, e.who, e.ko);
      break;
    case 'thrown':
      view.throwAt(e.who);
      break;
    case 'tossed':
      view.toss(e.item, e.to);
      break;
    case 'bang':
      if (slow) view.bang(e.tile);
      break;
    case 'glide':
      void view.glide(e.from, e.to, e.dist, sim.state.escaped > 0);
      break;
    case 'routine':
      if (slow) sound.bell();
      break;
    case 'spotted':
      if (slow) sound.whistle();
      break;
    case 'caught':
      if (slow) sound.thud();
      break;
    case 'layer':
      if (slow && e.how !== 'glide') sound.climb();
      break;
  }
}

/** Where the next highlight to caption is, from a step (after a jump: one at the very step landed on is said too). */
function markFrom(r: ReplayRun, step: number): number {
  const k = r.highlights.findIndex((m) => m.step >= step);
  return k < 0 ? r.highlights.length : k;
}

/** The picture settled after a jump: no slide from where it was, the camera on the player. */
function settle(g: Game) {
  const r = g.replay!;
  const st = g.rec.sim.state;
  remember(g);
  view.snapTo(st.player.x / UNIT, st.player.z / UNIT);
  view.jumped();
  r.nextMark = markFrom(r, st.step);
  play.acc = 0;
  // (Auto at the pace for where it landed: no rush on from the pace before the jump.)
  if (!r.speed) r.pace = autoSpeed(st.step, r.highlights, r.quiet);
}

/** A jump, a few milliseconds a frame: from the nearest keyframe before it (or on from here, when that's nearer). */
function seekStep(g: Game) {
  const r = g.replay!;
  const sim = g.rec.sim;
  const target = Math.max(r.from, Math.min(r.seekTo!, r.end ?? r.reach));
  const cur = sim.state.step;
  let key: Keyframe | null = null;
  for (const k of r.keys) if (k.step <= target && (!key || k.step > key.step)) key = k;
  if (r.finale && r.finale.step <= target && (!key || r.finale.step > key.step)) key = r.finale;
  // (Back, or past the end's scene: from a keyframe; forward a long way: from a later one if there is.)
  if (key && (cur > target || r.ended || (target - cur > KEY_STEPS && key.step > cur))) {
    sim.restore(key.snap);
    r.tape.seek(key.step - r.from);
    // (A glide still in the air on screen: its flight goes with the old moment.)
    if (r.ended || view.gliding) {
      // The escape camera and the getaway played out: the prison set out again.
      stageWorld(sim, r.replay.guest ? r.replay.by : readPrisoner());
      r.ended = false;
      g.over = false;
    }
  }
  const t0 = performance.now();
  let out = false;
  while (sim.state.step < target && performance.now() - t0 < BUDGET_MS) {
    const cmd = r.tape.next();
    if (cmd < 0) {
      out = true;
      break;
    }
    sim.step(cmd);
  }
  if (sim.state.step >= target || out) {
    r.seekTo = null;
    settle(g);
  }
}

/** The end reached: the escape played out (the escape camera), or the replay stopped where it checked. */
async function finish(g: Game) {
  const r = g.replay!;
  r.ended = true;
  r.playing = false;
  if (g.rec.sim.state.escaped <= 0) return;
  r.cinema = true;
  g.over = true;
  r.bar.hide(true);
  const stayed = await escapeScene(g);
  if (!stayed) return;
  r.cinema = false;
  r.bar.hide(false);
}

/** Plays on for the time that passed, at the pace chosen, stepping no more than the frame's budget. */
function advance(g: Game, dt: number) {
  const r = g.replay!;
  const sim = g.rec.sim;
  const step = sim.state.step;
  // Skipping the quiet times: over a night's sleep (or the time out cold, or in solitary) at once.
  if (r.quietSkip) {
    const q = r.quiet.find(([a, b]) => step >= a && step < b);
    // (A highlight just said, "Caught" before solitary: read before the skip says its own.)
    if (q && performance.now() - r.saidAt > 1800) {
      r.seekTo = q[1];
      r.bar.caption(t('replay.skipped'), 1600);
      return;
    }
  }
  const want = r.speed || autoSpeed(step, r.highlights, r.quiet);
  r.pace = r.speed ? r.speed : r.pace + (want - r.pace) * Math.min(1, dt * 3);
  // (A glide in the air on screen: real time until it's down, as in play, where the controls waited for it.)
  play.acc += dt * (view.gliding ? 1 : r.pace);
  const t0 = performance.now();
  const slow = r.pace <= 4.5;
  const end = r.end ?? r.reach;
  while (play.acc >= 1 / STEPS_PER_SECOND) {
    if (sim.state.step >= end) {
      play.acc = 0;
      // (Not checked that far yet: it waits for the scout.)
      if (r.end !== null) void finish(g);
      return;
    }
    if (performance.now() - t0 > BUDGET_MS) {
      // Behind (a slow device at a high speed): the time not stepped is let go.
      play.acc = Math.min(play.acc, 0.99 / STEPS_PER_SECOND);
      return;
    }
    play.acc -= 1 / STEPS_PER_SECOND;
    remember(g);
    const cmd = r.tape.next();
    if (cmd < 0) {
      void finish(g);
      return;
    }
    sim.step(cmd);
    for (const e of sim.events) replayFx(e, sim, slow);
    // A highlight as it plays: said over the bar (the escape has its own moment).
    while (r.nextMark < r.highlights.length && r.highlights[r.nextMark].step <= sim.state.step) {
      const m = r.highlights[r.nextMark++];
      if (m.kind !== 'escape') {
        r.bar.caption(`${t(`replay.h.${m.kind}` as Key)} · ${whenOf(m.step)}`);
        r.saidAt = performance.now();
      }
    }
  }
}

/** One frame of a replay (play/loop.ts hands it over while one is on). */
export function replayFrame(g: Game, dt: number, now: number) {
  const r = g.replay!;
  const sim = g.rec.sim;
  try {
    if (r.seekTo !== null) seekStep(g);
    else if (r.playing && !r.ended) advance(g, dt);
  } catch {
    // (A run this game can't play on, a file's: it stops where it got, and says so.)
    r.seekTo = null;
    r.playing = false;
    r.end = r.reach = sim.state.step;
    r.bar.note(t('replay.cantPlay'));
  }
  g.paused = !r.playing || r.seekTo !== null;
  if (!g.paused) tickPlayClock(dt * 1000);
  const st = sim.state;
  const a = g.paused ? 1 : Math.min(1, play.acc * STEPS_PER_SECOND);
  const tile = tileOfBody(st.player);
  const busy = st.sleeping || st.ko > 0 || st.solitary > 0 || st.stowed;
  view.draw(buildFrame(g, a, tile, busy, itemOf(st.items.inv[st.items.hand])), dt, now / 1000);
  hudFrame(g, a, tile, busy);
  // Asleep or out cold, in solitary: as the player saw it.
  sleepVeil.querySelector('span')!.textContent = t(st.ko > 0 ? 'sleep.knockedOut' : 'replay.asleep');
  sleepVeil.classList.toggle('ko', st.ko > 0);
  sleepVeil.classList.toggle('on', st.sleeping || st.ko > 0);
  darkCell.classList.toggle('on', st.solitary > 0);
  r.bar.update({ at: st.step, reach: r.end ?? r.reach, playing: r.playing && !r.ended, ended: r.ended && !r.cinema, speed: r.speed, pace: r.pace, quiet: r.quietSkip, checking: r.checking });
}

/** Paused (the tab hidden, a phone's call): the replay waits. */
export function pauseReplay() {
  const r = play.game?.replay;
  if (r) r.playing = false;
}

/**
 * Watches a replay; resolves when it's closed. `back`: the game it was opened from (its escape
 * card), put back on screen after.
 */
export function watchReplay(rp: Replay, back: Game | null): Promise<void> {
  const prison = PRISONS.find((p) => p.id === rp.log.prison);
  let set: ReturnType<typeof prepareReplay> = null;
  try {
    set = prison ? prepareReplay(rp.log, prison) : null;
  } catch {
    set = null;
  }
  if (!prison || !set) {
    banner.toast(t('replay.cantPlay'), 'bad');
    return Promise.resolve();
  }
  const { sim, runs } = set;
  const log = rp.log;
  stageWorld(sim, rp.guest ? rp.by : readPrisoner());
  const title = log.daily !== undefined ? `${t('daily.name', { n: log.daily + 1 })} · ${prisonName(prison)}` : prisonName(prison);
  const sub = rp.guest ? (rp.by?.name ? t('replay.by', { name: rp.by.name }) : t('replay.guest')) : log.via ? t(`route.${log.via}` as Key) : '';
  const last = log.from + log.steps;
  const bar = new ReplayBar(title, sub, log.from, last);
  const tape = new Tape(runs);
  const r: ReplayRun = {
    replay: rp,
    tape,
    from: log.from,
    last,
    end: null,
    reach: log.from,
    keys: [{ step: log.from, snap: sim.snapshot() }],
    finale: null,
    highlights: [],
    quiet: [],
    checking: 0,
    speed: 0,
    pace: 8,
    playing: true,
    quietSkip: true,
    ended: false,
    cinema: false,
    seekTo: null,
    nextMark: 0,
    saidAt: 0,
    bar,
    close: () => {},
  };
  const g: Game = {
    rec: new RunRecorder(sim, { log: null, game: __APP_VERSION__ }),
    prev: { x: sim.state.player.x, z: sim.state.player.z },
    prevInmates: [],
    prevGuards: [],
    prevDogs: [],
    prevRats: [],
    paused: false,
    walked: 0,
    pilot: new Autopilot(sim.world, () => sim.world.routeGrid(sim.state.layer)),
    guide: null,
    guideAge: 1,
    guideFrom: -1,
    speed: 1,
    waiting: false,
    ops: [],
    ladderFoot: ladderFootOf(sim.world),
    over: false,
    guardKeys: sim.prison.guards.map((d) => itemNumber(`key_${d.key}`)),
    saved: true,
    lesson: null,
    daily: null,
    replay: r,
  };
  remember(g);
  // Nothing the last game worked out for its buttons carries into the picture (the focus ring, a lock on someone).
  targets.step = -1;
  targets.target = targets.climb = targets.tool = targets.up = targets.station = null;
  targets.canLock = targets.fighting = false;
  press.toolNow = null;
  // The escape card's game steps aside (its controls with it) while the replay is on.
  itemsUI.show(false);
  tools.show(false);
  combatUI.show(false);
  workChips.hide();
  crewChips.hide();
  controls.enabled = false;
  controls.reset();
  // (The wheel and a pinch still zoom the picture, as in play.)
  controls.zoomOnly = true;
  // (The first day's walking hint, a solitary card: the game's, not the picture's.)
  hint.hide();
  solitaryPanel.update(null, 0);
  play.game = g;
  play.acc = 0;
  hud.show(true);
  // The HUD only shows: nothing on it to press or reach with Tab.
  hud.el.inert = true;
  sound.ambience(true);
  sound.setCoast(sim.world.def.theme === 'island');
  document.body.classList.add('is-playing', 'is-replay');

  const scout = runScout(log, (p) => {
    if (play.game !== g) return;
    // (As far as the checksums have vouched for it: nothing after an hour that might not match.)
    r.reach = Math.max(r.reach, p.verified);
    for (const k of p.keys) if (k.step > r.keys[r.keys.length - 1].step) r.keys.push(k);
    // (Only new ones: a scout started again after its worker failed says the first ones again.)
    const fresh = p.highlights.filter((m) => m.step > (r.highlights.at(-1)?.step ?? -1));
    if (fresh.length) {
      r.highlights.push(...fresh);
      bar.setMarks(r.highlights);
    }
    r.checking = (p.at - r.from) / Math.max(1, r.last - r.from);
  });
  void scout.done.then((res) => {
    if (play.game !== g) return;
    r.checking = null;
    if (!res) {
      // (It can't be checked here: it plays as far as it got, and says so.)
      r.end = r.reach;
      bar.note(t('replay.cantPlay'));
      bar.finale(false);
      return;
    }
    r.keys = res.keys;
    r.finale = res.finale;
    r.highlights = res.highlights;
    r.quiet = res.quiet;
    r.end = res.end;
    r.reach = res.end;
    r.nextMark = markFrom(r, sim.state.step);
    bar.setMarks(r.highlights);
    if (res.end < r.last) bar.note(t('replay.changed', { when: whenOf(res.end) }));
    bar.finale(!!res.via);
  });

  // (Nothing moves the picture while the escape plays out: the glide coming down, the escape camera.)
  const seek = (step: number) => {
    if (!r.cinema) r.seekTo = step;
  };
  const toggle = () => {
    if (r.cinema) return;
    click();
    if (r.ended) {
      // Watch again, from the start.
      r.seekTo = r.from;
      r.playing = true;
      r.pace = 8;
      return;
    }
    r.playing = !r.playing;
    play.acc = 0;
  };
  bar.onToggle = toggle;
  bar.onSpeed = () => {
    click();
    r.speed = SPEEDS[(SPEEDS.indexOf(r.speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length];
    if (r.speed === 0) r.pace = Math.min(r.pace, 8);
  };
  bar.onQuiet = () => {
    click();
    r.quietSkip = !r.quietSkip;
  };
  bar.onFinale = () => {
    click();
    if (r.end === null) return bar.caption(t('replay.checking', { n: Math.floor((r.checking ?? 0) * 100) }), 1600);
    seek(r.finale?.step ?? r.end);
    r.playing = true;
  };
  bar.onSeek = (step) => seek(step);
  const hop = (k: 'back' | 'fwd' | 'prev' | 'next' | 'home' | 'end') => {
    const at = r.seekTo ?? sim.state.step;
    if (k === 'back') seek(at - HOUR);
    else if (k === 'fwd') seek(at + HOUR);
    else if (k === 'home') seek(r.from);
    else if (k === 'end') seek(r.finale?.step ?? r.end ?? r.reach);
    else {
      // A little before the highlight, to see it come.
      const lead = 2 * STEPS_PER_MINUTE;
      const list = r.highlights.map((m) => Math.max(r.from, m.step - lead));
      const to = k === 'next' ? list.find((s) => s > at + 1) : [...list].reverse().find((s) => s < at - STEPS_PER_MINUTE);
      if (to !== undefined) seek(to);
    }
  };
  bar.onKey = hop;

  return new Promise((resolve) => {
    const key = (e: KeyboardEvent) => {
      if (play.game !== g || e.metaKey || e.ctrlKey) return;
      const target = e.target as HTMLElement | null;
      if (e.code === 'Escape') {
        e.preventDefault();
        r.close();
      } else if (e.code === 'Space' && !target?.closest('button')) {
        e.preventDefault();
        toggle();
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        hop(e.code === 'ArrowLeft' ? 'back' : 'fwd');
      }
    };
    addEventListener('keydown', key);
    r.close = () => {
      if (play.game !== g) return;
      click();
      scout.stop();
      bar.remove();
      removeEventListener('keydown', key);
      controls.zoomOnly = false;
      controls.reset();
      hud.el.inert = false;
      sleepVeil.classList.remove('on', 'ko');
      darkCell.classList.remove('on');
      solitaryPanel.update(null, 0);
      vignette.classList.remove('on');
      sound.siren(false);
      banner.clear();
      document.body.classList.remove('is-replay', 'chilled', 'baked');
      play.game = back;
      play.acc = 0;
      if (back) {
        // Back to the escape card: its game on screen again, as it ended.
        stageWorld(back.rec.sim, readPrisoner());
        remember(back);
        hud.show(true);
        // (The escape as the card left it: away over the sea or with the delivery, the camera turned.)
        const via = ESCAPES[back.rec.sim.state.via];
        const away = via === 'raft' || via === 'helicopter' || via === 'stowaway';
        // (After a frame drawn there: the departure leaves from where the player stands in it.)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (play.game !== back) return;
            if (away) view.depart(via);
            void view.cinema(away, true);
          }),
        );
        sound.music('title');
      } else {
        hud.show(false);
        sound.ambience(false);
        document.body.classList.remove('is-playing');
      }
      resolve();
    };
    bar.onClose = () => r.close();
    bar.el.querySelector<HTMLElement>('.rp-play')?.focus();
  });
}
