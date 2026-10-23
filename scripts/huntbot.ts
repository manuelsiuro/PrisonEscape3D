/**
 * A getaway bot for the manhunt (P41): it plays through the hunt's real simulation with
 * ordinary commands. Every few steps it marks what the searchers' eyes cover now (their cones,
 * a margin round each, the helicopter's light) and walks the shortest way to safety that keeps
 * out of it; with no such way it makes for cover and keeps still there until the way clears,
 * and it runs from a dog on its trail. Deterministic: the same hunt and bot give the same run.
 */
import { HUNT } from '../src/content/manhunt';
import { centerX, centerZ, findPath, nearestDir, tileAt } from '../src/sim/ai/path';
import { canSee } from '../src/sim/ai/sight';
import { command, EXT, OP, tossArgs } from '../src/sim/command';
import { HOUND, Hunt, OVER, SEEK, type HuntEvent } from '../src/sim/hunt/Hunt';
import { spotTile } from '../src/sim/hunt/world';
import { UNIT } from '../src/sim/tuning';
import { MAP_H, MAP_W } from '../src/sim/world/World';

const N = MAP_W * MAP_H;
const cheb = (a: number, b: number) => Math.max(Math.abs((a % MAP_W) - (b % MAP_W)), Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W)));

export interface BotRun {
  over: number;
  secs: number;
  log: string[];
  hash: string;
}

export class HuntBot {
  readonly danger = new Uint8Array(N);
  private path: number[] = [];
  private age = 99;
  readonly log: string[] = [];
  /** Throw a stone to draw a searcher off when one blocks the way (and stones are ready). */
  stones = true;
  constructor(readonly hunt: Hunt) {}

  private get goalTest() {
    const h = this.hunt;
    const lou = h.carry.lou ? spotTile(h.def.lou, h.out.ox, h.out.oz) : -1;
    return (i: number) => h.out.safe[i] === 1 || (lou >= 0 && cheb(i, lou) <= 0);
  }

  /** What the eyes out there cover now (and a margin round each searcher, the helicopter's light). */
  private markDanger() {
    const h = this.hunt;
    const s = h.state;
    const d = this.danger;
    d.fill(0);
    const range = h.sight + 1;
    for (const m of s.searchers) {
      if (m.mode === SEEK.OFF) continue;
      const mt = tileAt(m.body.x, m.body.z);
      const mx = mt % MAP_W;
      const mz = Math.floor(mt / MAP_W);
      for (let z = mz - range; z <= mz + range; z++)
        for (let x = mx - range; x <= mx + range; x++) {
          if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
          const t = z * MAP_W + x;
          const near = Math.max(Math.abs(x - mx), Math.abs(z - mz)) <= 2;
          if (near || canSee(h.world, m.body, { x: centerX(t), z: centerZ(t) }, range * UNIT)) d[t] = 1;
        }
    }
    if (s.heli.on) {
      const r = Math.ceil(HUNT.heliLight) + 2;
      const hx = Math.floor(s.heli.x / UNIT);
      const hz = Math.floor(s.heli.z / UNIT);
      for (let z = hz - r; z <= hz + r; z++) for (let x = hx - r; x <= hx + r; x++) if (x >= 0 && z >= 0 && x < MAP_W && z < MAP_H) d[z * MAP_W + x] = 1;
    }
  }

  /** The command for this step. */
  next(): number {
    const h = this.hunt;
    const s = h.state;
    const here = h.tile;
    if (++this.age >= 4 || !this.path.length) {
      this.age = 0;
      this.markDanger();
      // Cover tiles count as safe ground to cross (no eye finds a player still in them, and moving through them is slow to notice).
      for (let i = 0; i < N; i++) if (h.out.cover[i]) this.danger[i] = 0;
      const tracked = s.dogs.some((d) => d.mode === HOUND.TRACK || d.mode === HOUND.POINT);
      const clear = findPath(h.world, here, this.goalTest, -1, N, this.danger, h.grid);
      const exposed = this.danger[here] === 1 && !h.out.cover[here];
      if (clear) this.path = clear;
      else if (!exposed && !tracked) this.path = [];
      else {
        // Out of sight: into the nearest cover (or any ground no eye covers); a dog on the trail: on to safety, eyes or not.
        const hide = tracked ? null : findPath(h.world, here, (i) => i !== here && (h.out.cover[i] === 1 || !this.danger[i]), -1, N, this.danger, h.grid);
        this.path = hide ?? findPath(h.world, here, this.goalTest, -1, N, undefined, h.grid) ?? [];
      }
    }
    // A stone over the head of whoever stands in the way, now and then.
    if (this.stones && !this.path.length && s.step - s.stoneAt >= HUNT.stoneEvery) {
      const t = h.stoneTarget();
      if (t >= 0) {
        this.log.push(`${secs(h)} stone`);
        const [b, c] = tossArgs(t);
        return command(0, OP.EXT, EXT.HUNT_THROW, b, c);
      }
    }
    while (this.path.length) {
      const nextTile = this.path[0];
      const dx = centerX(nextTile) - s.player.x;
      const dz = centerZ(nextTile) - s.player.z;
      if (Math.abs(dx) + Math.abs(dz) < 200) {
        this.path.shift();
        continue;
      }
      return command(nearestDir(dx, dz));
    }
    return 0;
  }

  /** Plays the hunt to its end (or a limit of steps). */
  run(limit = 20 * 60 * 5): BotRun {
    const h = this.hunt;
    for (let k = 0; k < limit && !h.state.over; k++) {
      h.step(this.next());
      for (const e of h.events) {
        const line = describe(e, h);
        if (line) this.log.push(`${secs(h)} ${line}`);
      }
    }
    return { over: h.state.over, secs: Math.round(h.state.step / 20), log: this.log, hash: h.hash() };
  }
}

const secs = (h: Hunt) => {
  const t = Math.floor(h.state.step / 20);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** A line for the notable events (searchers out and noises left out: too many). */
export function describe(e: HuntEvent, h: Hunt): string {
  const name = (k: number) => h.def.searchers[k]?.name ?? `post ${k - h.def.searchers.length}`;
  switch (e.type) {
    case 'alarm':
      return 'the alarm';
    case 'roadblock':
      return `roadblock ${e.k} up`;
    case 'heli':
      return 'the helicopter up';
    case 'spotted':
      return `spotted by ${name(e.who)}`;
    case 'lost':
      return `${name(e.who)} lost them`;
    case 'track':
      return `dog ${e.dog} on the trail`;
    case 'point':
      return `dog ${e.dog} points`;
    case 'lit':
      return e.on ? 'lit by the helicopter' : '';
    case 'swap':
      return 'clothes off the line';
    case 'cut':
      return e.done ? 'cut through the wire' : '';
    case 'treat':
      return `a treat (${e.what}) to dog ${e.dog}`;
    case 'whistle':
      return `the lookout whistles (${name(e.who)})`;
    case 'safe':
      return e.lou ? "away in Lou's car" : 'SAFE';
    case 'caught':
      return `CAUGHT by ${name(e.by)}`;
    default:
      return '';
  }
}

export { OVER };
