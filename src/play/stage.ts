import { KEY_ITEM_COLORS } from '../content/items';
import type { Prisoner } from '../content/prisoner';
import type { BedPose } from '../render/Character';
import { placesOf } from '../sim/ai/places';
import { ESCAPES, type Sim } from '../sim/Sim';
import { UNIT, WALK_SPEED } from '../sim/tuning';
import { showCinema } from '../ui/cinema';
import { settings, sound, view } from './context';
import { play, type Game } from './game';
import { firstDay } from './tips';

/**
 * A prison put on screen for a game or a replay (P25): its world, the player dressed as
 * `prisoner`, the camera on them, the inmates and guards cast; and the escape played out
 * (the escape camera) at the end of either.
 */
export function stageWorld(sim: Sim, prisoner: Prisoner | null) {
  view.setWorld(sim.world);
  view.setPrisoner(prisoner);
  // Start a little wide and settle in on the player.
  view.snapTo(sim.state.player.x / UNIT, sim.state.player.z / UNIT, settings.reducedMotion ? 1 : 0.8);
  // (Set, not multiplied: one game's zoom never compounds into the next's.)
  view.zoomTo(1.25);
  // (P27: the old-timer grey-haired.)
  view.setCast(sim.state.inmates.map((m) => ({ cell: m.cell, gait: m.speed / WALK_SPEED, elder: m.cell === sim.prison.leisure?.oldTimer })));
  view.setGuards(
    guardBeds(sim),
    sim.prison.guards.map((d) => KEY_ITEM_COLORS.find(([c]) => c === d.key)![2]),
  );
}

/** Where each guard sleeps at night: the guard-quarters beds, in order, for those without a night round. */
function guardBeds(sim: Sim): Array<BedPose | undefined> {
  const beds = placesOf(sim.world).guardBeds;
  let n = 0;
  return sim.prison.guards.map((d) => {
    if (d.night) return undefined;
    const b = sim.world.props[beds[n++]?.bed ?? -1];
    return b && { x: b.x + b.w / 2, z: b.z + b.d / 2, angle: (b.rot * Math.PI) / 2 };
  });
}

/**
 * The way out played to its end, then the escape camera (P16): away over the sea (P12) or off
 * with the delivery (P18), a longer moment to watch it; off a roof on a glider (P24), down on
 * the road first. False when the game (or the replay, P25) was left meanwhile.
 */
export async function escapeScene(g: Game): Promise<boolean> {
  const sim = g.rec.sim;
  const via = ESCAPES[sim.state.via];
  firstDay.stop();
  sound.music('title');
  const away = via === 'raft' || via === 'helicopter' || via === 'stowaway';
  if (away) {
    view.depart(via);
    if (via === 'raft') sound.launch();
    else if (via === 'helicopter' || sim.prison.delivery?.vehicle === 'helicopter') sound.rotor();
    else sound.engine();
  }
  if (via === 'glider') await view.glideDown();
  if (play.game !== g) return false;
  // A slow turn and pull-back, letterboxed, ESCAPED stamped; a tap skips it.
  await showCinema(view.cinema(away), () => view.skipCinema(), settings.reducedMotion);
  return play.game === g;
}
