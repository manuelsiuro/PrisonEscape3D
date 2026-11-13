/**
 * City Escape's bots (C2): players made of ordinary commands, shared by the city's tests. Each is a
 * function returning the next command for a city it is handed.
 */
import { cityItem } from '../src/city/content/items';
import { COP, FULL, SLEEP_FROM, SLEEP_TO, type City } from '../src/city/sim/City';
import { Autopilot } from '../src/sim/ai/autopilot';
import { command } from '../src/sim/command';
import { MAP_W } from '../src/sim/world/grid';

const MIN = 20;

/**
 * The scavenger: searches the nearest furniture not yet looked into, takes what's there, eats when
 * hungry, mends when hurt, sleeps in a bed at night, and moves on through a checkpoint when a
 * district is done.
 */
/** The bot's next command: what it remembers is its way and the furniture it couldn't get to; the rest it reads from the city. */
export function scavenger(c: City) {
  let pilot = new Autopilot(c.world, () => c.grid);
  let world = c.world;
  let goal = -1;
  let since = 0;
  const skip = new Set<string>();
  const nextTo = (tiles: number[]) => (i: number) =>
    tiles.some((t) => Math.abs((t % MAP_W) - (i % MAP_W)) + Math.abs(Math.floor(t / MAP_W) - Math.floor(i / MAP_W)) === 1);
  return (): number => {
    const s = c.state;
    if (c.world !== world) {
      world = c.world;
      pilot = new Autopilot(c.world, () => c.grid);
      goal = -1;
    }
    if (s.sleeping) return 0;
    // (A piece it has been walking to for a game hour can't be got to: left alone.)
    if (goal >= 0 && ++since > 60 * MIN) {
      skip.add(`${s.district}:${goal}`);
      goal = -1;
    }
    // An open box: everything out of it, then shut.
    if (s.open) {
      if (c.box().some((st) => st[0]) && s.inv.some((st) => !st[0])) return command(0, COP.TAKE_ALL);
      return command(0, COP.CLOSE);
    }
    if (s.search) return 0;
    // Hungry: the best thing in the pockets (never raw fish while there's health to lose).
    if (s.hunger < FULL * 0.55) {
      let best = -1;
      s.inv.forEach((st, k) => {
        const use = cityItem(st[0])?.use;
        if (use?.hunger && (use.health ?? 0) >= 0 && (best < 0 || use.hunger > (cityItem(s.inv[best][0])!.use!.hunger ?? 0))) best = k;
      });
      if (best >= 0) return command(0, COP.USE, best);
    }
    if (s.health < 60) {
      const k = s.inv.findIndex((st) => (cityItem(st[0])?.use?.health ?? 0) > 5);
      if (k >= 0) return command(0, COP.USE, k);
    }
    // Pockets full of what isn't eaten: the first such thing left behind.
    if (!s.inv.some((st) => !st[0])) {
      const k = s.inv.findIndex((st) => !cityItem(st[0])?.use);
      if (k >= 0) return command(0, COP.DROP, k);
    }
    // (Night is for sleeping, unless the stomach is nearly empty: then food first.)
    const night = (c.minute >= SLEEP_FROM || c.minute < SLEEP_TO) && s.hunger > FULL * 0.2;
    const props = c.district.props;
    // At night, or worn out: a bed already looked into.
    const bedtime = night || (s.energy < FULL * 0.3 && s.hunger > FULL * 0.2);
    const want = (k: number) =>
      !skip.has(`${s.district}:${k}`) && (bedtime ? props[k].kind === 'bed' && c.searched(`${k}`) : !c.searched(`${k}`));
    const t = c.target();
    if (t && t.kind !== 'pile' && (want(Number(t.key)) || (bedtime && t.prop === 'bed' && Number(t.key) === goal))) {
      pilot.stop();
      goal = -1;
      return command(0, COP.ACT);
    }
    if (goal < 0 || !want(goal)) {
      // The nearest wanted piece (as the crow flies); none here by day: through a checkpoint.
      const here = c.tile;
      let best = -1;
      let bestD = Infinity;
      props.forEach((p, k) => {
        if (!want(k)) return;
        const d = Math.abs(p.x - (here % MAP_W)) + Math.abs(p.z - Math.floor(here / MAP_W));
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      });
      goal = best;
      since = 0;
      if (best >= 0) pilot.goToAny(nextTo(c.tilesOf(best)));
      else if (bedtime) {
        // (No bed looked into yet: the nearest is searched first.)
        let bed = -1;
        props.forEach((p, k) => {
          if (p.kind !== 'bed' || skip.has(`${s.district}:${k}`)) return;
          const d = Math.abs(p.x - (here % MAP_W)) + Math.abs(p.z - Math.floor(here / MAP_W));
          if (bed < 0 || d < bestD) {
            bestD = d;
            bed = k;
          }
        });
        goal = bed;
        if (bed >= 0) pilot.goToAny(nextTo(c.tilesOf(bed)));
        // (No bed in this district, an office quarter: back toward the one last slept in.)
        else if (c.district.gates.length) pilot.goTo((c.district.gates.find((g) => g.to === s.home[0]) ?? c.district.gates[0]).tiles[0]);
      } else if (c.district.gates.length) pilot.goTo(c.district.gates[(s.step >> 9) % c.district.gates.length].tiles[0]);
    }
    return command(pilot.dir(s.player));
  };
}
