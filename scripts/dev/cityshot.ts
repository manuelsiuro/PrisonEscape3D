// How to play's pictures for City Escape (C4): each of the City tab's topics staged in a city under way,
// its HUD hidden, ready to be photographed. Used from the browser's console (or chrome-devtools) in a dev
// build, in an isolated profile, with a city open and the page at 1040 × 480 (ratio 2):
//
//   const s = await import('/scripts/dev/cityshot.ts');
//   await s.stage('cityDead');     // the scene put up and held still; s.SHOTS lists them all
//   // … take the page's screenshot as a PNG, then:  cwebp -q 80 -resize 1040 480 shot.png -o public/help/cityDead.webp
//   s.done();                      // the HUD back, the city going again
//
// The scene is built from whatever city is open, so a retake differs in its streets, not in what it
// shows; look at each picture. helptest checks every topic's picture is there.
import type { City } from '../../src/city/sim/City';
import type { Zed } from '../../src/city/sim/dead';
import { relight } from '../../src/city/sim/light';
import { cityItemNumber } from '../../src/city/content/items';
import { PIECE } from '../../src/city/content/build';
import { DECO } from '../../src/city/gen/district';
import { nearestDir } from '../../src/sim/ai/path';
import { MAP_W as W } from '../../src/sim/world/grid';

interface Run {
  city: City;
  paused: boolean;
}
const page = window as unknown as {
  __city: () => Run | null;
  __cityStage: () => void;
  __view: { zoomTo(z: number): void; snapTo(x: number, z: number): void };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const UNIT = 1024;
/** The city's clock starts at 06:30 on day 1 (City.START_MINUTE). */
const START = 390;

let hide: HTMLStyleElement | null = null;

function tools() {
  const r = page.__city();
  if (!r) throw new Error('open a city first');
  const c = r.city;
  const s = c.state;
  const enter = (d: number) => (c as unknown as { enter(d: number): void }).enter(d);
  return {
    r,
    c,
    s,
    /** The player put on a tile of a district, the district put up, nobody about. */
    go(d: number, tile: number, facing = 0) {
      if (d !== s.district) enter(d);
      s.player.x = (tile % W) * UNIT + UNIT / 2;
      s.player.z = Math.floor(tile / W) * UNIT + UNIT / 2;
      if (facing) s.player.facing = facing;
      s.zeds = [];
      page.__cityStage();
    },
    time(day: number, minute: number) {
      s.step = ((day - 1) * 1440 + minute - START) * 20;
    },
    /** One of the dead stood on a tile (mode 0: standing; 3: after the player). */
    zed(tile: number, mode = 0, facing = 9): Zed {
      const z: Zed = {
        body: { x: (tile % W) * UNIT + UNIT / 2, z: Math.floor(tile / W) * UNIT + UNIT / 2, facing, moving: false },
        hp: 30,
        mode,
        goal: -1,
        path: [],
        seen: s.step,
        last: c.tile,
        bit: -9999,
        reel: 0,
        near: 0,
        pace: 900 + s.zeds.length * 37,
      };
      s.zeds.push(z);
      return z;
    },
    beside: (d: number, t: number) => [t + W, t - W, t + 1, t - 1].find((i) => !c.districtGrid(d)[i])!,
  };
}

/** Each picture: the scene, and the camera's zoom. */
export const SHOTS: Record<string, { zoom: number; scene: (t: ReturnType<typeof tools>) => void }> = {
  // The bus on its side at dawn, the district round it.
  cityGoal: {
    zoom: 0.8,
    scene: (t) => {
      const sp = t.c.districtOf(t.c.plan.start).spawn;
      t.time(1, 7 * 60);
      t.go(t.c.plan.start, sp.z * W + sp.x);
    },
  },
  // Beside a shelf or a freezer in a shop of the first district.
  cityFood: {
    zoom: 1.5,
    scene: (t) => {
      t.time(1, 10 * 60);
      // (2.53: a freezer in a shop that stands in daylight, near its door; the start's district first.)
      const order = [t.c.plan.start, ...Array.from({ length: 9 }, (_, k) => k).filter((k) => k !== t.c.plan.start)];
      for (const kinds of [['freezer'], ['freezer', 'shelf']])
        for (const d of order) {
          const dist = t.c.districtOf(d);
          t.go(d, dist.spawn.z * W + dist.spawn.x);
          const p = dist.props.find(
            (q) =>
              kinds.includes(q.kind) &&
              ['shop', 'station'].includes(dist.lots[dist.lotAt[q.z * W + q.x] - 1]?.use) &&
              t.beside(d, q.z * W + q.x) !== undefined &&
              !t.c.dim[t.beside(d, q.z * W + q.x)],
          );
          if (p) return t.go(d, t.beside(d, p.z * W + p.x));
        }
    },
  },
  // The street by the bus on the third night, five of the dead about.
  cityDead: {
    zoom: 1.25,
    scene: (t) => {
      const d = t.c.plan.start;
      const sp = t.c.districtOf(d).spawn;
      t.time(3, 23 * 60);
      t.go(d, sp.z * W + sp.x);
      const near = t.c.zedPlaces.streets.filter((i) => {
        const dx = Math.abs((i % W) - sp.x);
        const dz = Math.abs(Math.floor(i / W) - sp.z);
        return dx + dz >= 3 && dx <= 8 && dz <= 3;
      });
      for (const n of [3, 11, 19, 27, 35]) t.zed(near[(n * 7) % near.length]);
    },
  },
  // By day in a street: one shambler reeling from a blow, another coming.
  cityFight: {
    zoom: 1.9,
    scene: (t) => {
      const d = t.c.plan.start;
      t.time(2, 11 * 60);
      t.go(d, t.c.districtOf(d).spawn.z * W + t.c.districtOf(d).spawn.x);
      // (A clear run of street well inside the district: a street's end on the border is a checkpoint.)
      const inside = (i: number) => i % W > 6 && i % W < W - 10 && Math.floor(i / W) > 6 && Math.floor(i / W) < W - 6;
      const at = t.c.zedPlaces.streets.find(
        (i) => inside(i) && [0, 1, 2, 3, 4].every((k) => !t.c.grid[i + k] && !t.c.district.deco[i + k] && t.c.zedStreet[i + k]),
      )!;
      // (2.60: a bat in hand, one reeling from its blow with its health shown, a runner and a screamer coming.)
      t.s.inv[0] = [cityItemNumber('bat'), 31];
      t.go(d, at, nearestDir(1, 0));
      const west = nearestDir(-1, 0);
      const struck = t.zed(at + 1, 3, west);
      struck.reel = 9999;
      struck.hp = 12;
      Object.assign(t.zed(at + 3, 3, west), { kind: 1, hp: 16 });
      Object.assign(t.zed(at + 4, 3, west), { kind: 4, hp: 14 });
    },
  },
  // A house at dusk, its one door barred, the player by the bed, two of the dead at the door.
  cityShelter: {
    zoom: 1.6,
    scene: (t) => {
      const d = t.c.plan.start;
      const dist = t.c.districtOf(d);
      const lot = dist.lots.findIndex(
        (l, k) =>
          l.use === 'house' && l.doors.length === 1 && dist.props.some((p) => p.kind === 'bed' && dist.lotAt[p.z * W + p.x] === k + 1),
      );
      const door = dist.lots[lot].doors[0];
      const bed = dist.props.find((p) => p.kind === 'bed' && dist.lotAt[p.z * W + p.x] === lot + 1)!;
      t.s.bars[d] = [door];
      t.time(2, 20 * 60 + 20);
      t.go(d, t.beside(d, bed.z * W + bed.x));
      t.c.rebar();
      const out = [door + W, door - W, door + 1, door - 1].find((i) => dist.lotAt[i] !== lot + 1 && !t.c.grid[i])!;
      t.zed(out);
      t.zed(out + (out - door));
      page.__view.snapTo(((door % W) + bed.x) / 2 + 0.5, (Math.floor(door / W) + bed.z) / 2 + 0.5);
    },
  },
  // Beside a workbench.
  cityMake: {
    zoom: 1.7,
    scene: (t) => {
      t.s.bars = {};
      for (let d = 0; d < 9; d++) {
        const p = t.c.districtOf(d).props.find((q) => q.kind === 'workbench' && t.beside(d, q.z * W + q.x) !== undefined);
        if (!p) continue;
        t.time(2, 13 * 60);
        return t.go(d, t.beside(d, p.z * W + p.x));
      }
    },
  },
  // The radio's house, the diamond over the furniture it lies in.
  cityStory: {
    zoom: 1.7,
    scene: (t) => {
      Object.assign(t.s, { kit: 0, flags: 3, way: 0, ready: 0, act: 1 });
      const sp = t.c.story.things[0];
      const p = t.c.districtOf(sp.district).props[sp.prop];
      const at = p.z * W + p.x;
      const grid = t.c.districtGrid(sp.district);
      t.time(2, 9 * 60);
      t.go(
        sp.district,
        [at + 2 * W, at - 2 * W, at + 2, at - 2, at + W + 1, at + W - 1].find((i) => i >= 0 && !grid[i]) ?? t.beside(sp.district, at),
      );
    },
  },
  // The pier at dusk, the boat's engine in: the diamond on its last plank.
  cityWays: {
    zoom: 1.05,
    scene: (t) => {
      Object.assign(t.s, { kit: (1 << 11) - 1, flags: 15, scouted: 7, way: 2, ready: 1, readyAt: 0, act: 5 });
      const d = t.c.story.wayDistrict[1];
      const pier = t.c.story.pier;
      const grid = t.c.districtGrid(d);
      const back = [W, -W, 1, -1].map((o) => pier + 2 * o).find((i) => !grid[i]) ?? pier;
      t.time(3, 19 * 60 + 20);
      t.go(d, back);
    },
  },
  // A lantern on the street by the bus on the third night: the player in its light, the dead at its edge.
  cityLight: {
    zoom: 1.35,
    scene: (t) => {
      const d = t.c.plan.start;
      const sp = t.c.districtOf(d).spawn;
      t.time(3, 22 * 60 + 30);
      t.go(d, sp.z * W + sp.x);
      // (Where a lantern lights the most street, within a few tiles of the bus.)
      let at = -1;
      let most = 0;
      for (const i of t.c.zedPlaces.streets) {
        if (Math.max(Math.abs((i % W) - sp.x), Math.abs(Math.floor(i / W) - sp.z)) > 9 || t.c.grid[i + 1]) continue;
        t.s.lights = { [d]: [[i, 1, t.s.step + 9000]] };
        relight(t.c);
        const n = t.c.lit.reduce((a, b) => a + b, 0);
        if (n > most) [at, most] = [i, n];
      }
      t.s.lights = { [d]: [[at, 1, t.s.step + 9000]] };
      relight(t.c);
      t.go(d, at + 1);
      const [cx, cz] = [at % W, Math.floor(at / W)];
      const edge = t.c.zedPlaces.streets.filter((i) => {
        const far = Math.max(Math.abs((i % W) - cx), Math.abs(Math.floor(i / W) - cz));
        return !t.c.lit[i] && far >= 4 && far <= 6;
      });
      for (const n of [1, 9, 17, 25, 33, 41]) t.zed(edge[(n * 5) % edge.length]);
    },
  },
  // (2.58) By a chained door of a district that has one, in daylight.
  cityTools: {
    zoom: 1.9,
    scene: (t) => {
      t.time(1, 11 * 60);
      for (const d of [t.c.plan.start, 0, 1, 2, 3, 4, 5, 6, 7, 8]) {
        const dist = t.c.districtOf(d);
        t.go(d, dist.spawn.z * W + dist.spawn.x);
        // (A door in a wall that faces the camera's side or the street: stood on its step.)
        const door = Array.from(t.c.locked.keys()).find((i) => t.c.locked[i] === 1 && !t.c.grid[i + W] && !dist.lotAt[i + W]);
        if (door !== undefined) return t.go(d, door + W, 9);
      }
    },
  },
  // (2.66) Beside a car stripped by a sledgehammer (one lying along the street, the player at its side so it shows), its scrap at
  // the player's feet: in daylight.
  cityBreak: {
    zoom: 2.2,
    scene: (t) => {
      t.time(1, 11 * 60);
      const SLEDGE = cityItemNumber('sledgehammer');
      for (const d of [t.c.plan.start, 0, 1, 2, 3, 4, 5, 6, 7, 8]) {
        const dist = t.c.districtOf(d);
        t.go(d, dist.spawn.z * W + dist.spawn.x);
        const open = (j: number) => ',a'.includes(dist.rows[Math.floor(j / W)]?.[j % W] ?? '#') && !t.c.grid[j] && !t.c.carAt[j];
        for (let i = 0; i < W * W; i++) {
          // (A car, not a wreck, along z: two tiles one above the other; the player on its east side, by its rear.)
          if (t.c.carAt[i] - 1 !== i || dist.deco[i] !== DECO.CAR || t.c.carAt[i + W] !== i + 1) continue;
          const at = i + W + 1;
          if (!open(at) || !open(at + 1) || !open(at - W + 1)) continue;
          t.s.stripped[d] = [i];
          t.s.boxes[`${d}:c${i}`] = [];
          t.s.boxes[`${d}:g${at}`] = [
            [cityItemNumber('scrap'), 2],
            [cityItemNumber('wire'), 1],
          ];
          t.s.inv[0] = [SLEDGE, 41];
          t.c.struck = SLEDGE;
          return t.go(d, at, nearestDir(-1, 0));
        }
      }
    },
  },
  // (2.67) A camp in the open: plank walls round it, a door, a campfire burning, a camp bed, a chest, a table, a rug; late afternoon.
  cityBuild: {
    zoom: 2.0,
    scene: (t) => {
      t.time(1, 17 * 60);
      const d = t.c.plan.start;
      const dist = t.c.districtOf(d);
      t.go(d, dist.spawn.z * W + dist.spawn.x);
      // (A 5 × 5 out of doors, nothing on it, clear of the checkpoints.)
      const open = (i: number) =>
        !t.c.grid[i] &&
        !t.c.carAt[i] &&
        !t.c.zedGrid[i] &&
        !dist.lotAt[i] &&
        !dist.gates.some((g) => g.tiles.some((q) => Math.abs((q % W) - (i % W)) + Math.abs(Math.floor(q / W) - Math.floor(i / W)) < 6));
      let mid = -1;
      for (let z = 6; z < W - 6 && mid < 0; z++)
        for (let x = 6; x < W - 6 && mid < 0; x++) {
          let ok = true;
          for (let dz = -2; dz <= 2 && ok; dz++) for (let dx = -2; dx <= 2 && ok; dx++) ok = open((z + dz) * W + x + dx);
          if (ok) mid = z * W + x;
        }
      if (mid < 0) return;
      const P = {
        barricade: 0,
        plankWall: 1,
        metalWall: 2,
        door: 3,
        chest: 4,
        cot: 5,
        workbench: 6,
        campfire: 7,
        table: 8,
        chair: 9,
        rug: 10,
      };
      const S = nearestDir(0, 1);
      const E = nearestDir(1, 0);
      const built: Array<[number, number, number, number, number]> = [];
      // (The north side plank walls, a metal wall at its corner, the door on the east, a barricade south-west, half worn.)
      for (const dx of [-2, -1, 0, 1]) built.push([mid - 2 * W + dx, P.plankWall, 120, S, 0]);
      built.push([mid - 2 * W + 2, P.metalWall, 250, S, 0]);
      for (const dz of [-1, 0]) built.push([mid + dz * W - 2, P.plankWall, 120, E, 0]);
      built.push([mid + W - 2, P.barricade, 30, E, 0]);
      built.push([mid - W + 2, P.door, 100, E, 0]);
      built.push([mid + 2, P.plankWall, 70, E, 0]);
      built.push(
        [mid - W - 1, P.cot, 50, S, 0],
        [mid - W + 1, P.chest, 60, S, 0],
        [mid + W + 1, P.table, 50, S, 0],
        [mid + W, P.chair, 30, S, 0],
        [mid, P.rug, 20, S, 0],
      );
      built.push([mid + W - 1, P.campfire, 40, S, 0]);
      t.s.built = { [d]: built };
      t.s.lights = { [d]: [[mid + W - 1, 3, t.s.step + 300 * 20]] };
      (t.c as unknown as { reenter(): void }).reenter();
      t.s.inv[0] = [cityItemNumber('hammer'), 1];
      t.go(d, mid - 1, nearestDir(0, 1));
    },
  },
  // 2.68: the Rush: night, a walled corner held, the dead at its walls, one through the barricade, a campfire inside.
  cityRush: {
    zoom: 2.0,
    scene: (t) => {
      t.time(3, 22 * 60 + 20);
      const d = t.c.plan.start;
      const mid = openSpot(t, d);
      if (mid < 0) return;
      const P = PIECE;
      const S = nearestDir(0, 1);
      const E = nearestDir(1, 0);
      const built: Array<[number, number, number, number, number]> = [];
      for (const dx of [-2, -1, 0, 1, 2]) built.push([mid - 2 * W + dx, P.plankWall, dx === 0 ? 40 : 110, S, 0]);
      for (const dz of [-1, 0, 1]) built.push([mid + dz * W - 2, P.metalWall, 230, E, 0]);
      for (const dz of [-1, 1]) built.push([mid + dz * W + 2, P.plankWall, 90, E, 0]);
      built.push([mid + 2, P.barricade, 14, E, 0]);
      built.push([mid + 3, P.spikes, 20, E, 0], [mid + W + 3, P.barbedWire, 30, E, 0]);
      built.push([mid - W - 1, P.cot, 50, S, 0], [mid + W - 1, P.campfire, 40, S, 0], [mid + W + 1, P.sentry, 60, E, 30 * 16 + 4]);
      t.s.built = { [d]: built };
      t.s.lights = { [d]: [[mid + W - 1, 3, t.s.step + 300 * 20]] };
      (t.c as unknown as { reenter(): void }).reenter();
      t.go(d, mid, nearestDir(1, 0));
      const west = nearestDir(-1, 0);
      const south = nearestDir(0, 1);
      // (At the barricade, pounding; against the north wall; in the wire; more coming.)
      t.zed(mid + 3, 3, west);
      t.zed(mid - 3 * W, 3, south);
      t.zed(mid - 3 * W + 1, 3, south);
      t.zed(mid + W + 3, 3, west);
      Object.assign(t.zed(mid + 5, 3, west), { kind: 4, hp: 90 });
      t.zed(mid + 2 * W + 5, 3, west);
      t.zed(mid - W + 6, 3, west);
    },
  },
  // 2.68: the traps laid before a walled door by day: spikes, wire, a snare, cans, a scarecrow off to the side, a sentry.
  cityTraps: {
    zoom: 2.1,
    scene: (t) => {
      t.time(2, 16 * 60 + 30);
      const d = t.c.plan.start;
      const mid = openSpot(t, d);
      if (mid < 0) return;
      const P = PIECE;
      const E = nearestDir(1, 0);
      const S = nearestDir(0, 1);
      const built: Array<[number, number, number, number, number]> = [];
      for (const dz of [-2, -1, 1, 2]) built.push([mid + dz * W - 1, P.plankWall, 120, E, 0]);
      built.push([mid - 1, P.door, 100, E, 0]);
      built.push(
        [mid, P.spikes, 30, E, 0],
        [mid - W, P.barbedWire, 40, E, 0],
        [mid + W, P.barbedWire, 40, E, 0],
        [mid + 1, P.snare, 3, S, 0],
        [mid - 2 * W + 1, P.cans, 20, E, 0],
        [mid + 2 * W + 1, P.cans, 20, E, 0],
        [mid - 2 * W - 2, P.sentry, 60, E, 30 * 16 + 12],
        [mid + 2 * W + 2, P.scarecrow, 40, S, 0],
      );
      t.s.built = { [d]: built };
      (t.c as unknown as { reenter(): void }).reenter();
      t.go(d, mid - 2, nearestDir(1, 0));
      Object.assign(t.zed(mid + 3, 0, nearestDir(-1, 0)), {});
    },
  },
  // 2.69: the workshop: a workshop and a workbench built, the player beside them with a machete, a manual and a toolkit's place.
  cityGear: {
    zoom: 2.3,
    scene: (t) => {
      t.time(2, 15 * 60);
      const d = t.c.plan.start;
      const mid = openSpot(t, d);
      if (mid < 0) return;
      const S = nearestDir(0, 1);
      t.s.built = {
        [d]: [
          [mid - W, PIECE.workshop, 100, S, 0],
          [mid - W + 1, PIECE.workbench, 80, S, 0],
          [mid - W - 1, PIECE.chest, 60, S, 0],
          [mid + 2, PIECE.campfire, 40, S, 0],
        ],
      };
      t.s.lights = { [d]: [[mid + 2, 3, t.s.step + 300 * 20]] };
      (t.c as unknown as { reenter(): void }).reenter();
      t.s.inv[0] = [cityItemNumber('machete'), 40];
      t.c.struck = cityItemNumber('machete');
      t.s.armour = [cityItemNumber('padded_jacket'), 30];
      t.go(d, mid + W, nearestDir(0, -1));
    },
  },
  // 2.69: armour, a bag and the tricks: by day, the player in riot gear, three of the dead blind in a smoke cloud, a noisemaker set down.
  cityWear: {
    zoom: 2.2,
    scene: (t) => {
      t.time(2, 16 * 60);
      const d = t.c.plan.start;
      const mid = openSpot(t, d);
      if (mid < 0) return;
      t.s.built = { [d]: [] };
      t.s.smoke = [[mid + 3, t.s.step + 300]];
      t.s.ticks = [[mid + W - 1, t.s.step + 9999]];
      (t.c as unknown as { reenter(): void }).reenter();
      t.c.ticksRev++;
      t.s.armour = [cityItemNumber('riot_gear'), 60];
      t.s.bag = cityItemNumber('hiking_pack');
      t.go(d, mid - 1, nearestDir(1, 0));
      const west = nearestDir(-1, 0);
      for (const o of [3, W + 3, -W + 2]) t.zed(mid + o, 0, west);
    },
  },
  // Beside the nurse.
  cityPeople: {
    zoom: 2.1,
    scene: (t) => {
      Object.assign(t.s, { way: 0, ready: 0, act: 3 });
      const p = t.c.story.people[1];
      t.time(2, 14 * 60);
      t.go(p.district, p.tile + 1, 13);
    },
  },
};

/** 2.68: 5 × 6 out of doors in a district (the pieces' tiles), nothing on it, clear of the checkpoints (-1: none); the player put there. */
function openSpot(t: ReturnType<typeof tools>, d: number): number {
  const dist = t.c.districtOf(d);
  t.go(d, dist.spawn.z * W + dist.spawn.x);
  const open = (i: number) =>
    !t.c.grid[i] &&
    !t.c.carAt[i] &&
    !t.c.zedGrid[i] &&
    !dist.lotAt[i] &&
    !dist.gates.some((g) => g.tiles.some((q) => Math.abs((q % W) - (i % W)) + Math.abs(Math.floor(q / W) - Math.floor(i / W)) < 6));
  for (let z = 8; z < W - 8; z++)
    for (let x = 8; x < W - 8; x++) {
      let ok = true;
      for (let dz = -2; dz <= 2 && ok; dz++) for (let dx = -2; dx <= 3 && ok; dx++) ok = open((z + dz) * W + x + dx);
      if (ok) return z * W + x;
    }
  return -1;
}

/** A topic's scene put up and held still, the HUD hidden: ready for the screenshot. */
export async function stage(id: string) {
  const shot = SHOTS[id];
  if (!shot) throw new Error(`no city picture '${id}'`);
  const t = tools();
  t.r.paused = false;
  t.c.peace = true;
  // (The pictures are of the first days: the bus's orange, empty hands.)
  Object.assign(t.s, { hunger: 90_000, energy: 90_000, health: 100, outfit: 0 });
  t.s.inv = t.s.inv.map(() => [0, 0]);
  t.s.lights = {};
  relight(t.c);
  if (!hide) {
    hide = document.createElement('style');
    hide.textContent = '.hud,.hotbar,.city-minimap,.city-worn,.act-btn,.tool-btn,.banner,.toast,.item-panel{display:none !important}';
    document.head.append(hide);
  }
  shot.scene(t);
  page.__view.zoomTo(shot.zoom);
  // (A moment for the camera to settle and the dead to be drawn where they stand.)
  await sleep(1800);
  t.r.paused = true;
}

/** The HUD back, the city going again. */
export function done() {
  hide?.remove();
  hide = null;
  const r = page.__city();
  if (r) r.paused = false;
}
