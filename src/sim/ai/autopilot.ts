import type { Body } from '../systems/movement';
import type { World } from '../world/World';
import { centerX, centerZ, findPath, nearestDir, smooth, tileAt } from './path';

/** Close enough to a waypoint to aim at the next one (units). */
const REACHED = 200;
/** Steps without getting closer before the route is planned again. */
const STUCK_STEPS = 24;

/**
 * Steers a walker the way a thumb would: each step it returns a direction command toward the
 * next waypoint of an A* path, and `walk` does the rest (walls, door frames). Tap-to-walk
 * and the test bots use it, so their walks are ordinary commands: recorded, replayed and
 * deterministic. Lives outside the simulation state.
 */
export class Autopilot {
  private path: number[] = [];
  private goal: ((i: number) => boolean) | null = null;
  private target = -1;
  private rev = -1;
  private best = Infinity;
  private stuck = 0;

  constructor(private readonly world: World) {}

  /** Heading somewhere. */
  get active() {
    return this.goal !== null;
  }

  /** The tile it is heading for, -1 when idle or heading for any tile of a set. */
  get destination() {
    return this.goal ? this.target : -1;
  }

  /** Walk to one tile. */
  goTo(tile: number) {
    this.goal = (i) => i === tile;
    this.target = tile;
    this.rev = -1;
  }

  /** Walk to the nearest tile that passes a test (a zone, a set of spots). */
  goToAny(test: (i: number) => boolean) {
    this.goal = test;
    this.target = -1;
    this.rev = -1;
  }

  stop() {
    this.goal = null;
    this.path = [];
  }

  private plan(b: Body): boolean {
    const p = findPath(this.world, tileAt(b.x, b.z), this.goal!, this.target);
    this.rev = this.world.rev;
    this.best = Infinity;
    this.stuck = 0;
    if (p === null) {
      this.stop();
      return false;
    }
    this.path = smooth(this.world, p, b.x, b.z);
    return true;
  }

  /** The direction to walk this step (0 once there, or when there is no way). */
  dir(b: Body): number {
    if (!this.goal) return 0;
    if (this.rev !== this.world.rev && !this.plan(b)) return 0;
    while (this.path.length) {
      const next = this.path[0];
      const dx = centerX(next) - b.x;
      const dz = centerZ(next) - b.z;
      const d = Math.abs(dx) + Math.abs(dz);
      if (d < REACHED) {
        this.path.shift();
        this.best = Infinity;
        continue;
      }
      // Pressed against something: find a new way.
      if (d < this.best) {
        this.best = d;
        this.stuck = 0;
      } else if (++this.stuck > STUCK_STEPS && !this.plan(b)) return 0;
      return nearestDir(dx, dz);
    }
    this.stop();
    return 0;
  }
}
