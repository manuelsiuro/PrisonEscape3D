import { itemNumber } from '../content/items';
import { ROUTINE } from '../content/routine';
import { ZONES } from '../content/zones';
import { findPath, smooth, tileAt } from '../sim/ai/path';
import { isFloor, placesOf } from '../sim/ai/places';
import { OP } from '../sim/command';
import type { Sim } from '../sim/Sim';
import { lockCandidates } from '../sim/systems/combat';
import { jobRooms } from '../sim/systems/economy';
import { itemOf, usesOf } from '../sim/systems/items';
import { TILE } from '../sim/world/tiles';
import { LAYER, MAP_W } from '../sim/world/World';
import { lockList } from './buttons';
import { hint, sound, view } from './context';
import { play, sendOp, type Game } from './game';
import { firstDay, markTip } from './tips';

const LETTER = itemNumber('letter');
const MOP = itemNumber('mop');

/** How close (CSS px) a tap must land to someone's middle to lock on to them. */
const TAP_PERSON_PX = 40;
/** Where someone's middle is on screen, refilled. */
const tapPoint = { x: 0, y: 0 };

/** Tap or click a spot: walk there (the nearest free floor if the spot itself is taken). */
export function onTap(cx: number, cy: number) {
  const game = play.game;
  if (!game || game.paused) return;
  const p = view.groundAt(cx, cy);
  const w = game.rec.sim.world;
  if (!p) return;
  // A tap on someone: lock on to them (GDD §10.1), unless they're already the target (then walk to them).
  const sim = game.rec.sim;
  if (sim.state.layer === LAYER.GROUND) {
    // On screen, against each one's middle (a tap on the head or the torso counts, not just the feet).
    const list = lockCandidates(w, sim.state, sim.state.player, lockList);
    let who = -1;
    let bestPx = TAP_PERSON_PX * TAP_PERSON_PX;
    for (const id of list) {
      const at = view.screenOf(id, tapPoint, 0.75);
      if (!at) continue;
      const d = (at.x - cx) ** 2 + (at.y - cy) ** 2;
      if (d < bestPx) {
        bestPx = d;
        who = id;
      }
    }
    if (who >= 0 && who !== sim.state.lock) {
      sendOp(OP.LOCK, 2 + who);
      return;
    }
  }
  const tx = Math.floor(p.x);
  const tz = Math.floor(p.z);
  let best = -1;
  let bestD = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const z = tz + dz;
      if (!w.inside(x, z) || w.blocked(x, z, game.rec.sim.state.layer)) continue;
      const d = (x + 0.5 - p.x) ** 2 + (z + 0.5 - p.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = z * MAP_W + x;
      }
    }
  }
  if (best < 0) return;
  game.pilot.goTo(best);
  sound.click();
  if (hint.visible) {
    hint.hide();
    markTip('walk');
  }
}

/** Where the floor arrows lead now: the routine's place while the player hasn't checked in, the cell in a lockdown. */
function guideTarget(sim: Sim): ((i: number) => boolean) | null {
  const s = sim.state;
  const w = sim.world;
  const places = placesOf(w);
  const home = places.bedside[1];
  // A lockdown ends when the guards catch you, wherever you are; solitary and a knockout go
  // nowhere; off the ground floor the player knows their own way.
  if (s.lockdown || s.solitary > 0 || s.ko > 0 || s.layer !== LAYER.GROUND) return null;
  const r = ROUTINE[s.routine];
  // Lights Out is about being in the cell, not having been there.
  if (r.id === 'lightsOut') return sim.playerZone === 'playerCell' ? null : (i) => i === home;
  // The Work Period with a job: the janitor's next puddle (mop in the hotbar), the addressee of
  // a letter in the bag, else the job's room until the player is in it (the stations are framed there).
  if (r.id === 'work' && sim.onDuty) {
    const flow = jobRooms(w)[sim.jobActive()].def.flow;
    const inv = s.items.inv;
    if (flow === 'mop' && s.puddles.length && inv.slice(0, 6).some((v) => itemOf(v) === MOP)) return (i) => s.puddles.includes(i);
    if (flow === 'mail') {
      const to = s.mail.filter((id) => inv.slice(0, 6).some((v) => itemOf(v) === LETTER && usesOf(v) - 1 === id) && s.inmates[id].ko === 0);
      if (to.length) {
        const tiles = to.map((id) => tileAt(s.inmates[id].body.x, s.inmates[id].body.z));
        return (i) => tiles.includes(i);
      }
    }
  }
  const zones = sim.dutyZones;
  if (r.id === 'work' && (s.paid || zones.includes(sim.playerZone))) return null;
  // Nowhere the routine wants the player: the first day's guide may point to the job board.
  if ((!zones.length || s.attended) && firstDay.step === 'board') {
    const b = w.props.find((q) => q.kind === 'jobBoard');
    if (b) {
      const at = b.z * MAP_W + b.x;
      return (i) => !w.block[i] && (i === at - 1 || i === at + 1 || i === at - MAP_W || i === at + MAP_W);
    }
  }
  if (!zones.length || (s.attended && r.id !== 'work')) return null;
  if (r.id === 'rollCall' || r.id === 'eveningRollCall') {
    const spot = places.rollCall[0].tile;
    return (i) => i === spot;
  }
  return (i) => zones.includes(ZONES[w.ground.zone[i]]) && isFloor(w, i % MAP_W, Math.floor(i / MAP_W));
}

export function updateGuide(g: Game, dt: number) {
  const sim = g.rec.sim;
  const p = sim.state.player;
  const from = tileAt(p.x, p.z);
  g.guideAge += dt;
  if (g.guideAge < 0.35 && from === g.guideFrom) return;
  g.guideAge = 0;
  g.guideFrom = from;
  // A takeover (GDD §12): the arrows lead out through the open gates to the road.
  const riot = sim.state.takeover && sim.state.layer === LAYER.GROUND && sim.state.ko === 0;
  const goal = riot ? (i: number) => sim.world.ground.kind[i] === TILE.ROAD : guideTarget(sim);
  // On the prison as built: the arrows never lead through the player's own holes (in a takeover, every door is open to them).
  const grid = riot ? sim.world.block : sim.world.npcBlock;
  const path = goal && findPath(sim.world, from, goal, -1, 4000, undefined, grid);
  g.guide = path && path.length ? smooth(sim.world, path, p.x, p.z, undefined, grid).map((i) => ({ x: (i % MAP_W) + 0.5, z: Math.floor(i / MAP_W) + 0.5 })) : null;
}
