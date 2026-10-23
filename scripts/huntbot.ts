/**
 * A getaway bot for the manhunt (P41): it plays through the hunt's real simulation with
 * ordinary commands. Every few steps it marks what the eyes it knows of cover now (their cones,
 * a margin round each, the helicopter's light, a dog's nose; cover counts as safe ground only
 * out of every eye's close reach) and walks the shortest way to safety that keeps out of it;
 * with no such way it keeps still where nobody sees it (hidden, in cover), or gets out of sight
 * first; a dog on its trail, it keeps going. With `view` it knows only what is within that many
 * tiles of it (what a screen shows: the careful player the balance is measured with); without,
 * everything (the proof that a careful line exists). Deterministic: the same hunt and bot give
 * the same run.
 */
import { HUNT } from '../src/content/manhunt';
import { centerX, centerZ, findPath, nearestDir, tileAt } from '../src/sim/ai/path';
import { canSee, lineOfSight } from '../src/sim/ai/sight';
import { command, EXT, OP, tossArgs } from '../src/sim/command';
import { HOUND, Hunt, OVER, SEEK, type HuntEvent } from '../src/sim/hunt/Hunt';
import { spotTile } from '../src/sim/hunt/world';
import { UNIT } from '../src/sim/tuning';
import { MAP_H, MAP_W } from '../src/sim/world/World';

const N = MAP_W * MAP_H;
/** A dog on the trail: a line or a ford this many tiles off is worth the detour. */
const WASH_NEAR = 20;
const cheb = (a: number, b: number) => Math.max(Math.abs((a % MAP_W) - (b % MAP_W)), Math.abs(Math.floor(a / MAP_W) - Math.floor(b / MAP_W)));

export interface BotRun {
  over: number;
  secs: number;
  log: string[];
  hash: string;
}

export class HuntBot {
  readonly danger = new Uint8Array(N);
  /** Eyes only (no dogs' noses), and close by a searcher or a dog. */
  private readonly eyes = new Uint8Array(N);
  private readonly near = new Uint8Array(N);
  private path: number[] = [];
  private age = 99;
  readonly log: string[] = [];
  /** Throw a stone to draw a searcher off when one blocks the way (and stones are ready). */
  stones = true;
  /**
   * `view`: what it knows of (tiles round it; everything by default). `plain`: the plain careful
   * player the balance is measured with (the rules review's gauge): out of the cones it can see
   * (and two tiles round each searcher, the helicopter's light), cover counted safe, no thought
   * for dogs' noses or a searcher turning, no washing lines; with no clear way it waits, or when
   * seen makes for cover, or runs for it.
   */
  constructor(
    readonly hunt: Hunt,
    readonly view = Infinity,
    readonly plain = false,
  ) {}

  private get goalTest() {
    const h = this.hunt;
    const lou = h.carry.lou ? spotTile(h.def.lou, h.out.ox, h.out.oz) : -1;
    return (i: number) => h.out.safe[i] === 1 || (lou >= 0 && cheb(i, lou) <= 0);
  }

  /** Within the bot's view (units). */
  private sees(x: number, z: number): boolean {
    const p = this.hunt.state.player;
    return Math.max(Math.abs(x - p.x), Math.abs(z - p.z)) <= this.view * UNIT;
  }

  /** What the eyes it knows of cover now (a margin round each searcher; round a dog, its nose; the helicopter's light). */
  private markDanger() {
    const h = this.hunt;
    const s = h.state;
    const d = this.eyes;
    const near = this.near;
    d.fill(0);
    near.fill(0);
    const range = Math.ceil(h.sight) + 1;
    const box = (cx: number, cz: number, r: number, a: Uint8Array) => {
      for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++) if (x >= 0 && z >= 0 && x < MAP_W && z < MAP_H) a[z * MAP_W + x] = 1;
    };
    // (Where those still to come out will come on, an edge or a gate: kept clear of, they'll be looking.)
    h.def.searchers.forEach((sd, k) => {
      if (s.searchers[k].mode !== SEEK.OFF || sd.at < 0) return;
      const e = spotTile(sd.from ?? sd.beat[0], h.out.ox, h.out.oz);
      // (Not the gate they came out of themselves: those wait till the player is clear.)
      if (cheb(e, h.start) > 2 * HUNT.clear && this.sees(centerX(e), centerZ(e))) box(e % MAP_W, Math.floor(e / MAP_W), range - 1, d);
    });
    for (const m of s.searchers) {
      if (m.mode === SEEK.OFF || !this.sees(m.body.x, m.body.z)) continue;
      const mt = tileAt(m.body.x, m.body.z);
      const mx = mt % MAP_W;
      const mz = Math.floor(mt / MAP_W);
      box(mx, mz, 2, d);
      // (Close enough to see someone moving in cover.)
      box(mx, mz, HUNT.coverSeen + 1, near);
      // (One standing looking round may turn any way next: all round him.)
      const round = !m.body.moving && (m.mode === SEEK.LOOK || m.mode === SEEK.SWEEP);
      for (let z = mz - range; z <= mz + range; z++)
        for (let x = mx - range; x <= mx + range; x++) {
          if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
          const t = z * MAP_W + x;
          const c = { x: centerX(t), z: centerZ(t) };
          if (round ? (x - mx) ** 2 + (z - mz) ** 2 <= range * range && lineOfSight(h.world, m.body.x, m.body.z, c.x, c.z, t) : canSee(h.world, m.body, c, range * UNIT, true, t)) d[t] = 1;
        }
    }
    if (s.heli.on && this.sees(s.heli.x, s.heli.z)) {
      const r = Math.ceil(HUNT.heliLight) + 2;
      box(Math.floor(s.heli.x / UNIT), Math.floor(s.heli.z / UNIT), r, d);
    }
    const dogs = this.danger;
    dogs.fill(0);
    for (const g of s.dogs) {
      if (s.searchers[g.handler].mode === SEEK.OFF || g.mode === HOUND.ASLEEP || g.mode === HOUND.CALM || g.mode === HOUND.DAZED || !this.sees(g.body.x, g.body.z)) continue;
      const r = Math.ceil(HUNT.nose) + 1;
      box(Math.floor(g.body.x / UNIT), Math.floor(g.body.z / UNIT), r, dogs);
      box(Math.floor(g.body.x / UNIT), Math.floor(g.body.z / UNIT), r, near);
    }
    // Cover is safe ground to cross, out of every eye's close reach and every dog's nose.
    for (let i = 0; i < N; i++) {
      if (h.out.cover[i] && !near[i]) d[i] = 0;
      dogs[i] |= d[i];
    }
  }

  /** Where the trail can be washed off: beside a washing line not yet used (not once in other clothes), or a ford. */
  private washer(i: number): boolean {
    const h = this.hunt;
    const s = h.state;
    if (h.out.ford[i]) return true;
    if (s.clothes === 2) return false;
    return h.def.lines.some((l, k) => !(s.lines & (1 << k)) && cheb(i, spotTile(l, h.out.ox, h.out.oz)) <= 0);
  }

  /** The plain careful player's way (`plain`). */
  private plainWay() {
    const h = this.hunt;
    const s = h.state;
    const here = h.tile;
    const d = this.danger;
    d.fill(0);
    const range = Math.ceil(h.sight) + 1;
    for (const m of s.searchers) {
      if (m.mode === SEEK.OFF || !this.sees(m.body.x, m.body.z)) continue;
      const mt = tileAt(m.body.x, m.body.z);
      const mx = mt % MAP_W;
      const mz = Math.floor(mt / MAP_W);
      for (let z = mz - range; z <= mz + range; z++)
        for (let x = mx - range; x <= mx + range; x++) {
          if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
          const t = z * MAP_W + x;
          if (Math.max(Math.abs(x - mx), Math.abs(z - mz)) <= 2 || canSee(h.world, m.body, { x: centerX(t), z: centerZ(t) }, range * UNIT)) d[t] = 1;
        }
    }
    if (s.heli.on && this.sees(s.heli.x, s.heli.z)) {
      const r = Math.ceil(HUNT.heliLight) + 2;
      const hx = Math.floor(s.heli.x / UNIT);
      const hz = Math.floor(s.heli.z / UNIT);
      for (let z = hz - r; z <= hz + r; z++) for (let x = hx - r; x <= hx + r; x++) if (x >= 0 && z >= 0 && x < MAP_W && z < MAP_H) d[z * MAP_W + x] = 1;
    }
    for (let i = 0; i < N; i++) if (h.out.cover[i]) d[i] = 0;
    const tracked = s.dogs.some((g) => (g.mode === HOUND.TRACK || g.mode === HOUND.POINT) && this.sees(g.body.x, g.body.z));
    const clear = findPath(h.world, here, this.goalTest, -1, N, d, h.grid);
    const exposed = d[here] === 1 && !h.out.cover[here];
    if (clear) this.path = clear;
    else if (!exposed && !tracked) this.path = [];
    else {
      const hide = tracked ? null : findPath(h.world, here, (i) => i !== here && (h.out.cover[i] === 1 || !d[i]), -1, N, d, h.grid);
      this.path = hide ?? findPath(h.world, here, this.goalTest, -1, N, undefined, h.grid) ?? [];
    }
  }

  /** The command for this step. */
  next(): number {
    const h = this.hunt;
    const s = h.state;
    const here = h.tile;
    if (this.plain && (++this.age >= 4 || !this.path.length)) {
      this.age = 0;
      this.plainWay();
    } else if (!this.plain && (++this.age >= 4 || !this.path.length)) {
      this.age = 0;
      this.markDanger();
      const tracked = s.dogs.some((d) => (d.mode === HOUND.TRACK || d.mode === HOUND.POINT) && this.sees(d.body.x, d.body.z));
      const clear = findPath(h.world, here, this.goalTest, -1, N, this.danger, h.grid);
      const exposed = this.danger[here] === 1;
      // A dog on the trail: a line or a ford close by washes it off.
      const wash = tracked ? findPath(h.world, here, (i) => this.washer(i), -1, N, this.eyes, h.grid) : null;
      if (wash && wash.length <= WASH_NEAR) this.path = wash;
      else if (clear) this.path = clear;
      else if (tracked) {
        // Keeping still is no use: on out of every eye (past the dog if need be); else to wash the trail further off; else on round the searchers.
        this.path =
          findPath(h.world, here, this.goalTest, -1, N, this.eyes, h.grid) ??
          wash ??
          findPath(h.world, here, this.goalTest, -1, N, this.near, h.grid) ??
          findPath(h.world, here, this.goalTest, -1, N, undefined, h.grid) ??
          [];
      } else if (!exposed) {
        // Nobody sees it yet: into cover close by to wait, else wait here.
        this.path = h.out.cover[here] ? [] : (findPath(h.world, here, (i) => h.out.cover[i] === 1 && !this.danger[i], -1, 120, this.danger, h.grid) ?? []);
      } else {
        // Seen or about to be: out of sight first (cover first), then wait there.
        this.path =
          findPath(h.world, here, (i) => i !== here && h.out.cover[i] === 1 && !this.danger[i], -1, 300, undefined, h.grid) ??
          findPath(h.world, here, (i) => i !== here && !this.danger[i], -1, N, undefined, h.grid) ??
          [];
      }
    }
    // Beside a washing line: other clothes (a new scent; out of a guard's uniform only with a dog on the trail).
    if (!this.plain && h.lineNear() >= 0 && (s.clothes === 0 || (s.clothes === 1 && s.dogs.some((d) => d.mode === HOUND.TRACK || d.mode === HOUND.POINT)))) return command(0, OP.INTERACT);
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
