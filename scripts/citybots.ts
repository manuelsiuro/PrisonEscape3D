/**
 * City Escape's bots (C2): players made of ordinary commands, shared by the city's tests. Each is a
 * function returning the next command for a city it is handed.
 */
import { cityItem, cityItemNumber } from '../src/city/content/items';
import { STORY } from '../src/city/content/story';
import { gatesOpen, objectives, towards } from '../src/city/sim/story';
import { COP, FULL, SLEEP_FROM, SLEEP_TO, type City } from '../src/city/sim/City';
import { Autopilot } from '../src/sim/ai/autopilot';
import { nearestDir } from '../src/sim/ai/path';
import { command } from '../src/sim/command';
import { MAP_W } from '../src/sim/world/grid';

const MIN = 20;

/**
 * The scavenger: searches the nearest furniture not yet looked into, takes what's there, eats when
 * hungry, mends when hurt, sleeps in a bed at night, and moves on through a checkpoint when a
 * district is done.
 */
/** The bot's next command: what it remembers is its way and the furniture it couldn't get to; the rest it reads from the city. */
export function scavenger(c: City, keep: (item: number) => boolean = () => false) {
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
    // One of the dead within arm's reach: turned on and struck, before anything else.
    let near = -1;
    let nearD = (1.5 * 1024) ** 2;
    s.zeds.forEach((z, k) => {
      const d = (z.body.x - s.player.x) ** 2 + (z.body.z - s.player.z) ** 2;
      if (d < nearD) {
        nearD = d;
        near = k;
      }
    });
    // Hurt, and one of them coming (within four tiles, not yet in reach): away from it, they're slower.
    if (near < 0 && s.health < 50) {
      let from = -1;
      let fromD = (4 * 1024) ** 2;
      s.zeds.forEach((z, k) => {
        const d = (z.body.x - s.player.x) ** 2 + (z.body.z - s.player.z) ** 2;
        if (z.mode === 3 && d < fromD) {
          fromD = d;
          from = k;
        }
      });
      if (from >= 0) {
        const z = s.zeds[from].body;
        goal = -1;
        return command(nearestDir(s.player.x - z.x, s.player.z - z.z));
      }
    }
    if (near >= 0) {
      pilot.stop();
      goal = -1;
      const z = s.zeds[near].body;
      return command(nearestDir(z.x - s.player.x, z.z - s.player.z), COP.HIT);
    }
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
      const k = s.inv.findIndex((st) => !cityItem(st[0])?.use && !cityItem(st[0])?.attack && !keep(st[0]));
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
    if (t && (t.kind === 'box' || t.kind === 'bed') && (want(Number(t.key)) || (bedtime && t.prop === 'bed' && Number(t.key) === goal))) {
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

/**
 * The quester: follows the story to one way out. It goes where the act's first unfinished line
 * points (through the checkpoints, to the furniture, to the way out's own tile), chooses its way once
 * scouted, sets it going and takes it; hungry, hurt, set upon or at night it does as the scavenger
 * does (which keeps the batteries the radio wants).
 */
export function quester(c: City, way: number) {
  const BATTERY = cityItemNumber('battery');
  const forage = scavenger(c, (item) => item === BATTERY && !(c.state.flags & 4));
  let pilot = new Autopilot(c.world, () => c.grid);
  let world = c.world;
  let goal = '';
  const nextTo = (t: number) => (i: number) =>
    Math.abs((t % MAP_W) - (i % MAP_W)) + Math.abs(Math.floor(t / MAP_W) - Math.floor(i / MAP_W)) === 1;
  return (): number => {
    const s = c.state;
    if (s.over) return 0;
    if (c.world !== world) {
      world = c.world;
      pilot = new Autopilot(c.world, () => c.grid);
      goal = '';
    }
    const aside = () => {
      goal = '';
      pilot.stop();
      return forage();
    };
    // (Napping as its hour comes, the dark or the tide: up.)
    if (s.sleeping && s.act >= 4 && c.minute >= 19 * 60 && objectives(c).every((o) => o.done || !o.id.startsWith('kit.')))
      return command(1);
    if (s.sleeping || s.open || s.search) return aside();
    // Set upon, or hurt with one coming: as the scavenger fights and flees.
    let nearD = Infinity;
    for (const z of s.zeds) nearD = Math.min(nearD, (z.body.x - s.player.x) ** 2 + (z.body.z - s.player.z) ** 2);
    const list = objectives(c);
    const last = s.act >= 4 && list.every((o) => o.done || !o.id.startsWith('kit.'));
    // The beacon lit or the generator running: never stood still for them. Round the streets, the dead strung out behind,
    // struck only when one is on it; back to the way out as the wait ends.
    const hold = s.ready === 1 && s.way !== 2 && !gatesOpen(c) && (list[0]?.left ?? 0) > 6;
    if (hold) {
      if (nearD < (1.1 * 1024) ** 2) return aside();
      if (!pilot.active || s.step % 60 === 0) {
        const corners: number[] = [];
        for (const z of c.plan.lanesZ[Math.floor(s.district / 3)])
          for (const x of c.plan.lanesX[s.district % 3]) if (!c.grid[z * MAP_W + x]) corners.push(z * MAP_W + x);
        const clear = (i: number) =>
          s.zeds.reduce(
            (m, z) => Math.min(m, Math.abs(z.body.x / 1024 - (i % MAP_W)) + Math.abs(z.body.z / 1024 - Math.floor(i / MAP_W))),
            99,
          );
        const here = c.tile;
        const away = corners
          .filter((i) => Math.abs((i % MAP_W) - (here % MAP_W)) + Math.abs(Math.floor(i / MAP_W) - Math.floor(here / MAP_W)) > 6)
          .sort((a, b) => clear(b) - clear(a))[0];
        if (away !== undefined) pilot.goTo(away);
        goal = 'hold';
      }
      return command(pilot.dir(s.player));
    }
    if (nearD < (1.5 * 1024) ** 2 || (s.health < 50 && nearD < (4 * 1024) ** 2)) return aside();
    if (s.health < 60 && s.inv.some((st) => (cityItem(st[0])?.use?.health ?? 0) > 5)) return aside();
    // (Hungry: the scavenger eats, or looks for food; on the last night only what's in the pockets, or it would go to bed.)
    const food = s.inv.some((st) => (cityItem(st[0])?.use?.hunger ?? 0) > 0 && (cityItem(st[0])?.use?.health ?? 0) >= 0);
    if (s.hunger < FULL * 0.5 && (food || !last)) return aside();
    // (Its way out set going: no bed that night. Waiting on the dark or the tide: about its own business till an hour before.)
    const night = c.minute >= SLEEP_FROM || c.minute < SLEEP_TO;
    const waits = last && !s.ready && s.way === 1 ? c.minute >= 5 * 60 && c.minute < 19 * 60 : false;
    const tide = last && s.ready === 1 && s.way === 2 ? c.minute >= STORY.tideTo && c.minute < 19 * 60 : false;
    if (waits || tide) return aside();
    if (!last && (night || s.energy < FULL * 0.3)) return aside();
    // The third act: its own way scouted, then chosen.
    if (s.act === 3 && s.scouted & (1 << (way - 1))) return command(0, COP.CHOOSE, way);
    const o = s.act === 3 ? list.find((x) => x.id === `scout${way}`) : list.find((x) => !x.done && x.at);
    // (The list's waiting lines: the parts held and the way out not yet to be set going. Stood by it.)
    if (!o?.at) return last ? 0 : aside();
    if (o.at.district !== s.district) {
      const to = towards(c, s.district, o.at.district);
      const gate = c.district.gates.find((g) => g.to === to);
      if (!gate) return aside();
      if (goal !== `d${to}`) {
        goal = `d${to}`;
        pilot.goTo(gate.tiles[0]);
      }
      return command(pilot.dir(s.player));
    }
    const t = c.target();
    if (t?.kind === 'way') {
      pilot.stop();
      // (The beacon by night, the boat on the tide: pressed when it can be.)
      const dark = c.minute >= 21 * 60 || c.minute < 5 * 60;
      const tide = c.minute >= STORY.tideFrom || c.minute < STORY.tideTo;
      if (!s.ready ? way !== 1 || dark : way === 2 ? tide : gatesOpen(c)) return command(0, COP.ACT);
      return 0;
    }
    // A thing's furniture: beside it, turned to it, searched.
    const prop = c.district.props.findIndex((p) => p.z * MAP_W + p.x === o.at!.tile);
    const tiles = prop >= 0 && c.grid[o.at.tile] ? c.tilesOf(prop) : [];
    const here = c.tile;
    const by = tiles.find((i) => nextTo(i)(here));
    if (by !== undefined) {
      pilot.stop();
      goal = '';
      if (t && t.key === `${prop}`) return command(0, COP.ACT);
      return command(nearestDir((by % MAP_W) - (here % MAP_W), Math.floor(by / MAP_W) - Math.floor(here / MAP_W)));
    }
    const key = `${s.district}:${o.at.tile}`;
    if (goal !== key || !pilot.active) {
      goal = key;
      const at = o.at.tile;
      if (tiles.length) pilot.goToAny((i) => tiles.some((j) => nextTo(j)(i)));
      else pilot.goToAny((i) => i === at || nextTo(at)(i));
    }
    return command(pilot.dir(s.player));
  };
}
