import { dailyTimeUp } from './daily';
import { governQuality } from '../app/quality';
import { ROUTINE } from '../content/routine';
import { command, EXT, OP } from '../sim/command';
import { itemOf } from '../sim/systems/items';
import { tileOfBody } from '../sim/systems/movement';
import { STEPS_PER_SECOND, STRIKE_STEPS, UNIT } from '../sim/tuning';
import { announce, tickTock } from './announce';
import { chatterEvent } from './chatter';
import { press, targets, updateTargets } from './buttons';
import { controls, hint, itemsUI, settings, socialOpen, tools, view } from './context';
import { buildFrame } from './frame';
import { play, tickPlayClock, type Game } from './game';
import { updateGuide } from './guide';
import { keepPlayerClear, updateOverlay } from './overlay';
import { autosave, escaped } from './session';
import { dayEvent, dayFrame, dayStep } from './day';
import { holidayStep } from './holidays';
import { raceStep } from './long';
import { checkRun } from '../game/trophies';
import { markTip, updateFirstDay } from './tips';
import { lessonEvent, lessonHidden, updateLesson } from './lesson';
import { replayFrame } from './replay';
import { huntFrame } from './hunt';

const NO_OP: [number, number, number, number] = [0, 0, 0, 0];
const USE_OP: [number, number, number, number] = [OP.USE, 0, 0, 0];
const PRESS_OP: [number, number, number, number] = [OP.USE, 1, 0, 0];
const UP_OP: [number, number, number, number] = [OP.EXT, EXT.DIG_UP, 0, 0];
const SLEEP_SPEED = 40;
/** Hidden in the delivery's vehicle with Wait pressed (P18): the afternoon passes eight times as fast. */
const WAIT_SPEED = 8;
/** Knocked out, the 30 seconds pass in 3. */
const KO_SPEED = 10;

/** Picked something up since the last frame (for the guide). */
let pickedUp = false;
/** Real seconds to the next look at the run's achievements (P16). */
let trophyCheck = 1;

/** Runs the simulation's fixed steps for the time that passed (the simulation never sees the frame time). */
function stepSim(g: Game, dt: number) {
  const sim = g.rec.sim;
  const p = sim.state.player;
  // Asleep, the night runs fast (about 13 s from 23:00 to 07:55).
  if (g.waiting && !sim.state.stowed) g.waiting = false;
  const speed = sim.state.sleeping ? SLEEP_SPEED : sim.state.ko > 0 ? KO_SPEED : g.waiting ? Math.max(WAIT_SPEED, g.speed) : g.speed;
  play.acc += dt * speed;
  let steps = 0;
  while (play.acc >= 1 / STEPS_PER_SECOND && steps++ < 40 * speed) {
    play.acc -= 1 / STEPS_PER_SECOND;
    // Where everyone was before this step (buffers reused: no garbage per step).
    g.prev.x = p.x;
    g.prev.z = p.z;
    sim.state.inmates.forEach((m, k) => {
      const q = (g.prevInmates[k] ??= { x: 0, z: 0 });
      q.x = m.body.x;
      q.z = m.body.z;
    });
    sim.state.guards.forEach((m, k) => {
      const q = (g.prevGuards[k] ??= { x: 0, z: 0 });
      q.x = m.body.x;
      q.z = m.body.z;
    });
    sim.state.dogs.forEach((d, k) => {
      const q = (g.prevDogs[k] ??= { x: 0, z: 0 });
      q.x = d.body.x;
      q.z = d.body.z;
    });
    g.prevRats.length = sim.state.rats.length;
    sim.state.rats.forEach((r, k) => {
      const q = (g.prevRats[k] ??= { x: 0, z: 0, mode: 0 });
      q.x = r.x;
      q.z = r.z;
      q.mode = r.mode;
    });
    // The stick and keys win over tap-to-walk; both are plain direction commands.
    if (controls.steering || sim.state.ko > 0) g.pilot.stop();
    // Holding the tool button: a strike is asked for every step (the sim paces them).
    let op = g.ops.shift();
    // A press waiting for the last strike's swing to finish (things that aren't strikes go at once).
    // (A blow waits for the fighter's own pace, a strike for the tool's.)
    const toolNow = press.toolNow;
    const ready = toolNow?.attack ? sim.state.step + 1 - sim.state.swingAt >= press.attackPace : sim.state.step + 1 - sim.state.struckAt >= STRIKE_STEPS;
    // (The old dig up, at a tunnel's end facing back along it, is U's alone now: Space there does nothing, so it never surfaces a player by surprise. The rule stays in the sim for old replays.)
    const upBehind = targets.tool?.action === 'digUp';
    if (upBehind) press.pressQueued = false;
    if (!op && press.pressQueued && (!toolNow?.repeat || ready)) {
      op = PRESS_OP;
      press.pressQueued = false;
    }
    // Dig up (U or its button): a press waits for the arm to come back; held, it strikes on.
    if (!op && (press.upQueued || (tools.upHeld && targets.up)) && sim.state.step + 1 - sim.state.struckAt >= STRIKE_STEPS) {
      op = UP_OP;
      press.upQueued = false;
    }
    op ??= tools.held && toolNow?.repeat && !upBehind ? USE_OP : NO_OP;
    // (P29: at a tattoo the moves steer the needle: the stick or the keys, never a tap's walk.)
    let dir = controls.steering ? controls.dir() : sim.state.ink || sim.state.show ? 0 : g.pilot.dir(p);
    // On the equipment, left and right are reps (sent as ops): only up or down steps off.
    if ((sim.state.train >= 0 || sim.state.bout.length) && (dir === 1 || dir === 9)) dir = 0;
    // (P24: still in the air on a glider, on screen: down first, then the stick.)
    if (view.gliding) {
      dir = 0;
      op = NO_OP;
      g.pilot.stop();
    }
    g.rec.step(command(dir, op[0], op[1], op[2], op[3]));
    g.walked += Math.hypot(p.x - g.prev.x, p.z - g.prev.z) / UNIT;
    // Sound, banners and vibration read the events; the simulation never calls them.
    for (const e of sim.events) {
      announce(e, sim);
      dayEvent(e, sim);
      if (!g.lesson) chatterEvent(e, sim);
      lessonEvent(g, e);
      // Out on the road: the escape screen.
      if (e.type === 'escaped') escaped();
      // (P26: a Three Days Daily, the fourth day dawned with the player still inside.)
      if (e.type === 'timeUp') dailyTimeUp(g);
      // Carried somewhere (solitary, the infirmary, into bed): no slide from the old spot.
      if (e.type === 'solitary' || e.type === 'infirmary' || (e.type === 'sleep' && e.on)) {
        g.prev.x = p.x;
        g.prev.z = p.z;
      }
      // Saved (GDD §2) on falling asleep in bed, and every morning at 08:00.
      if ((e.type === 'sleep' && e.on) || (e.type === 'routine' && ROUTINE[e.routine].id === 'rollCall')) autosave(g, true);
      if (e.type === 'pickup') pickedUp = true;
    }
    tickTock(sim, speed);
    // The warden's clock (P17): warnings, the forecast, a quip, on the minute; race night's card going up (2.16).
    dayStep(sim);
    // (P42: New Year's fireworks crackling while they last.)
    holidayStep(sim);
    raceStep(sim);
  }
  if (play.acc > 1) play.acc = 0;
}

/**
 * One animation frame: the simulation steps for the time that passed, the frame record is
 * filled and drawn (the view interpolates between the last two steps), then the UI follows.
 */
export function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - play.last) / 1000);
  play.last = now;
  const g = play.game;
  if (!g) {
    view.drawTitle(dt, now / 1000);
    return;
  }
  // (A replay, P25: played from its log, not from the controls.)
  if (g.replay) return replayFrame(g, dt, now);
  // (The manhunt, P41: the outside, its own simulation.)
  if (g.hunt) return huntFrame(g, dt, now);
  const sim = g.rec.sim;
  const p = sim.state.player;
  if (!g.paused) {
    governQuality(dt, settings.quality, view);
    // (Before the steps: what they announce is stamped with this frame's play time.)
    tickPlayClock(dt * 1000);
    stepSim(g, dt);
    if (hint.visible && g.walked > 4) {
      hint.hide();
      markTip('walk');
    }
    updateGuide(g, dt);
    // The run's achievements, about once a second (not a lesson's, not once it's over).
    if ((trophyCheck -= dt) <= 0) {
      trophyCheck = 1;
      if (!g.lesson && !g.over) checkRun();
    }
  }
  const a = g.paused ? 1 : play.acc * STEPS_PER_SECOND;
  const tile = tileOfBody(p);
  const st = sim.state;
  const it = st.items;
  const busy = st.sleeping || st.ko > 0 || st.solitary > 0 || st.stowed || g.paused || g.over;
  const held = itemOf(it.inv[it.hand]);
  const panel = itemsUI.panelOpen || socialOpen();
  document.body.classList.toggle('panel-open', panel);
  document.body.classList.toggle('items-open', itemsUI.panelOpen);
  // (P27: and a hand of Cheat's card, the old-timer's board, on a phone.)
  keepPlayerClear((panel || document.body.classList.contains('seated-game')) && !g.paused);
  updateTargets(sim, g.ladderFoot, busy, panel, held);
  view.draw(buildFrame(g, a, tile, busy, held), dt, now / 1000);
  dayFrame(g, dt, g.over || st.ko > 0 || st.solitary > 0);
  updateOverlay(g, a, tile, busy, held, panel);
  // The first day's guide: what the player has done, read from the game.
  updateFirstDay(g, pickedUp, dt);
  updateLesson(g, dt, lessonHidden() || st.sleeping || st.ko > 0);
  pickedUp = false;
}
