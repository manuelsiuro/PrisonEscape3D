import { governQuality } from '../app/quality';
import { ROUTINE } from '../content/routine';
import { command, OP } from '../sim/command';
import { itemOf } from '../sim/systems/items';
import { tileOfBody } from '../sim/systems/movement';
import { STEPS_PER_SECOND, STRIKE_STEPS, UNIT } from '../sim/tuning';
import { announce } from './announce';
import { chatterEvent } from './chatter';
import { press, updateTargets } from './buttons';
import { controls, hint, itemsUI, settings, socialOpen, tools, view } from './context';
import { buildFrame } from './frame';
import { play, type Game } from './game';
import { updateGuide } from './guide';
import { keepPlayerClear, updateOverlay } from './overlay';
import { autosave, escaped } from './session';
import { markTip, updateFirstDay } from './tips';
import { lessonEvent, lessonHidden, updateLesson } from './lesson';

const NO_OP: [number, number, number] = [0, 0, 0];
const USE_OP: [number, number, number] = [OP.USE, 0, 0];
const PRESS_OP: [number, number, number] = [OP.USE, 1, 0];
const SLEEP_SPEED = 40;
/** Knocked out, the 30 seconds pass in 3. */
const KO_SPEED = 10;

/** Picked something up since the last frame (for the guide). */
let pickedUp = false;

/** Runs the simulation's fixed steps for the time that passed (the simulation never sees the frame time). */
function stepSim(g: Game, dt: number) {
  const sim = g.rec.sim;
  const p = sim.state.player;
  // Asleep, the night runs fast (about 13 s from 23:00 to 07:55).
  const speed = sim.state.sleeping ? SLEEP_SPEED : sim.state.ko > 0 ? KO_SPEED : g.speed;
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
    // The stick and keys win over tap-to-walk; both are plain direction commands.
    if (controls.steering || sim.state.ko > 0) g.pilot.stop();
    // Holding the tool button: a strike is asked for every step (the sim paces them).
    let op = g.ops.shift();
    // A press waiting for the last strike's swing to finish (things that aren't strikes go at once).
    // (A blow waits for the fighter's own pace, a strike for the tool's.)
    const toolNow = press.toolNow;
    const ready = toolNow?.attack ? sim.state.step + 1 - sim.state.swingAt >= press.attackPace : sim.state.step + 1 - sim.state.struckAt >= STRIKE_STEPS;
    if (!op && press.pressQueued && (!toolNow?.repeat || ready)) {
      op = PRESS_OP;
      press.pressQueued = false;
    }
    op ??= tools.held && toolNow?.repeat ? USE_OP : NO_OP;
    let dir = controls.steering ? controls.dir() : g.pilot.dir(p);
    // On the equipment, left and right are reps (sent as ops): only up or down steps off.
    if (sim.state.train >= 0 && (dir === 1 || dir === 9)) dir = 0;
    g.rec.step(command(dir, op[0], op[1], op[2]));
    g.walked += Math.hypot(p.x - g.prev.x, p.z - g.prev.z) / UNIT;
    // Sound, banners and vibration read the events; the simulation never calls them.
    for (const e of sim.events) {
      announce(e, sim);
      if (!g.lesson) chatterEvent(e, sim);
      lessonEvent(g, e);
      // Out on the road: the escape screen.
      if (e.type === 'escaped') escaped();
      // Carried somewhere (solitary, the infirmary, into bed): no slide from the old spot.
      if (e.type === 'solitary' || e.type === 'infirmary' || (e.type === 'sleep' && e.on)) {
        g.prev.x = p.x;
        g.prev.z = p.z;
      }
      // Saved (GDD §2) on falling asleep in bed, and every morning at 08:00.
      if ((e.type === 'sleep' && e.on) || (e.type === 'routine' && ROUTINE[e.routine].id === 'rollCall')) autosave(g, true);
      if (e.type === 'pickup') pickedUp = true;
    }
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
  const sim = g.rec.sim;
  const p = sim.state.player;
  if (!g.paused) {
    governQuality(dt, settings.quality, view);
    stepSim(g, dt);
    if (hint.visible && g.walked > 4) {
      hint.hide();
      markTip('walk');
    }
    updateGuide(g, dt);
  }
  const a = g.paused ? 1 : play.acc * STEPS_PER_SECOND;
  const tile = tileOfBody(p);
  const st = sim.state;
  const it = st.items;
  const busy = st.sleeping || st.ko > 0 || st.solitary > 0 || g.paused || g.over;
  const held = itemOf(it.inv[it.hand]);
  const panel = itemsUI.panelOpen || socialOpen();
  document.body.classList.toggle('panel-open', panel);
  document.body.classList.toggle('items-open', itemsUI.panelOpen);
  keepPlayerClear(panel && !g.paused);
  updateTargets(sim, g.ladderFoot, busy, panel, held);
  view.draw(buildFrame(g, a, tile, busy, held), dt, now / 1000);
  updateOverlay(g, a, tile, busy, held, panel);
  // The first day's guide: what the player has done, read from the game.
  updateFirstDay(g, pickedUp, dt);
  updateLesson(g, dt, lessonHidden() || st.sleeping || st.ko > 0);
  pickedUp = false;
}
