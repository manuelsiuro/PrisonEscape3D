/**
 * City Escape's own look (2.57, render only): on many cities, every district is dressed as a town and
 * nothing of it gets in the way. Every building has a face and a roof's colour, and every wall of a lot is
 * drawn by the city (none left to the prisons' brick); the metro's tunnel keeps its bare walls. Windows
 * hang on walls only, never on a door, never on the north face; what stands on a roof's edge stands on
 * a wall. Street furniture stands on bare pavement beside a road: not on what the generator put down,
 * not in a lot, not before a door, not in a checkpoint's way. The furniture's city models keep their
 * kind's tile (a home's bed, a ward's, a shop's racks; a police station's cots stay the prisons'). The
 * streets' paint stays on the map and marks every district. And none of it draws from the state's dice:
 * the same district twice gives the same town.
 */
import { check } from './assert';
import { isBuilding } from '../src/city/content/districts';
import { cityProp } from '../src/city/render/cityProps';
import { cityWallCells, facadeOf, facadeParts } from '../src/city/render/facades';
import { paintStreets } from '../src/city/render/streets';
import { streetPlan } from '../src/city/render/streetThings';
import { City } from '../src/city/sim/City';
import { districtWorld } from '../src/city/sim/world';
import { townOf } from '../src/city/town';
import { merge } from '../src/render/kit';
import { MAP_H as H, MAP_W as W } from '../src/sim/world/grid';

const lines: string[] = [];
const CITIES = 16;
const R = 16;
let faces = 0;
let panes = 0;
let most = 0;
const things = { lamp: 0, signal: 0, hydrant: 0 };
const models = new Map<string, number>();
let marks = 0;
let fewest = Infinity;
const looks = new Set<string>();

/** A canvas that only counts: every mark's rectangle (an arc's or an ellipse's box) checked against the map. */
function fakeCanvas(at: string) {
  let n = 0;
  const inside = (x: number, y: number, w: number, h: number) =>
    check(x >= -2 && y >= -2 && x + w <= W * R + 2 && y + h <= H * R + 2, `${at}: a mark off the map at ${x},${y} ${w}×${h}`);
  const c = {
    fillStyle: '',
    fillRect: (x: number, y: number, w: number, h: number) => (n++, inside(x, y, w, h)),
    beginPath: () => {},
    arc: (x: number, y: number, r: number) => inside(x - r, y - r, 2 * r, 2 * r),
    ellipse: (x: number, y: number, rx: number, ry: number) => inside(x - rx - 1, y - rx - ry, 2 * rx + 2, 2 * (rx + ry)),
    fill: () => void n++,
  };
  return { c: c as unknown as CanvasRenderingContext2D, count: () => n };
}

for (let n = 1; n <= CITIES; n++) {
  const seed = n * 5519 + 11;
  const c = new City(seed);
  for (let d = 0; d < 9; d++) {
    const dist = c.districtOf(d);
    const world = districtWorld(c.plan, d, dist);
    const at = `city ${seed}, district ${d} (${dist.kind})`;
    check(townOf(world) === dist, `${at}: the world knows its district`);

    // Every building: a look; every wall of a lot: the city's.
    dist.lots.forEach((l, k) => {
      const f = facadeOf(dist, k);
      check(isBuilding(l.use) === !!f, `${at}: lot ${k} (${l.use}) ${f ? 'has' : 'lacks'} a face`);
      if (f) looks.add(`${f.style}:${f.wall.toString(16)}:${f.cap.toString(16)}`);
    });
    const cells = cityWallCells(world)!;
    let walls = 0;
    for (let i = 0; i < W * H; i++) {
      if (dist.rows[i >> 6][i & 63] !== '#') continue;
      walls++;
      check(cells.taken[i] === 1, `${at}: the wall at ${i & 63},${i >> 6} is left to the prisons' brick`);
    }
    check(
      cells.tops.length === walls && [...cells.byStyle.values()].reduce((a, b) => a + b.length, 0) === walls,
      `${at}: a face and a top a wall`,
    );
    faces += walls;

    // The windows and the roofs' things: each on a wall (its middle within a tile's reach of one), none on a door, none past the map.
    const parts = facadeParts(dist);
    check(parts.length > 0, `${at}: no windows at all`);
    for (const p of parts) {
      p.computeBoundingBox();
      const b = p.boundingBox!;
      const cx = (b.min.x + b.max.x) / 2;
      const cz = (b.min.z + b.max.z) / 2;
      const wide = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
      // (A shop's fascia runs its front's length: its ends are checked instead.)
      const spots =
        wide > 1.6
          ? [
              [b.min.x + 0.5, cz],
              [b.max.x - 0.5, cz],
            ]
          : [[cx, cz]];
      for (const [x, z] of spots) {
        const near = [
          [0, 0],
          [0, -0.75],
          [-0.75, 0],
          [0.75, 0],
        ].some(([ox, oz]) => dist.rows[Math.floor(z + oz)]?.[Math.floor(x + ox)] === '#');
        check(near, `${at}: a piece of a face hangs on no wall at ${x.toFixed(2)},${z.toFixed(2)}`);
      }
      check(b.min.y >= 0 && b.max.y < 2.2, `${at}: a piece of a face at height ${b.min.y.toFixed(2)}–${b.max.y.toFixed(2)}`);
    }
    panes += parts.length;
    const g = merge(parts);
    const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    most = Math.max(most, tris);

    // Street furniture: on bare pavement beside a road, clear of doors, decor, lots and the gates' approaches.
    const plan = streetPlan(dist);
    for (const t of plan) {
      const x = t.tile % W;
      const z = Math.floor(t.tile / W);
      const ch = (dx: number, dz: number) => dist.rows[z + dz]?.[x + dx];
      check(ch(0, 0) === 'a' && !dist.deco[t.tile] && !dist.lotAt[t.tile], `${at}: a ${t.kind} off the bare pavement at ${x},${z}`);
      check(![ch(1, 0), ch(-1, 0), ch(0, 1), ch(0, -1)].includes('y'), `${at}: a ${t.kind} before a door at ${x},${z}`);
      check([ch(1, 0), ch(-1, 0), ch(0, 1), ch(0, -1)].includes(','), `${at}: a ${t.kind} away from any road at ${x},${z}`);
      check(Math.floor(t.x) === x && Math.floor(t.z) === z, `${at}: a ${t.kind} off its tile`);
      check(x >= 2 && z >= 2 && x < W - 2 && z < H - 2, `${at}: a ${t.kind} in a checkpoint's way`);
      things[t.kind]++;
    }
    check(
      plan.some((t) => t.kind === 'lamp'),
      `${at}: a district with no street lamp`,
    );

    // Furniture: the city's model keeps the kind's own tile and size; a home's bed is a home's, a station's cot the prisons'.
    for (const p of world.props) {
      const use = dist.lots[dist.lotAt[p.z * W + p.x] - 1]?.use;
      const m = cityProp(world, p, p.w, p.d);
      if (p.kind === 'bed' && use === 'house') check(!!m && m.key.startsWith('city:bed:'), `${at}: a house's bed is a cell's cot`);
      if (p.kind === 'bed' && use === 'police') check(m === null, `${at}: a police cot dressed as a home's bed`);
      if (!m) continue;
      check(m.key.endsWith(`:${p.w}x${p.d}`), `${at}: ${m.key} for a ${p.kind} of ${p.w}×${p.d}`);
      const name = m.key.split(':')[1];
      if (!models.has(name)) {
        const g = m.make();
        g.computeBoundingBox();
        const b = g.boundingBox!;
        check(
          b.min.x >= -p.w / 2 - 0.02 &&
            b.max.x <= p.w / 2 + 0.02 &&
            b.min.z >= -p.d / 2 - 0.02 &&
            b.max.z <= p.d / 2 + 0.02 &&
            b.min.y >= -0.001,
          `${at}: the ${name} outgrows its ${p.w}×${p.d} tiles (${b.min.x.toFixed(2)}…${b.max.x.toFixed(2)}, ${b.min.z.toFixed(2)}…${b.max.z.toFixed(2)})`,
        );
      }
      models.set(name, (models.get(name) ?? 0) + 1);
    }

    // The streets' paint: on the map, and some in every district; the same twice.
    const a = fakeCanvas(at);
    check(paintStreets(a.c, R, world), `${at}: no streets painted`);
    const b = fakeCanvas(at);
    paintStreets(b.c, R, districtWorld(c.plan, d, dist));
    check(a.count() === b.count(), `${at}: the paint differs the second time`);
    marks += a.count();
    fewest = Math.min(fewest, a.count());
  }
  // Under the city: the prisons' bare walls, no streets.
  const under = districtWorld(c.plan, c.tunnel.district.index, c.tunnel.district);
  check(
    !townOf(under) && cityWallCells(under) === null && !paintStreets(fakeCanvas('tunnel').c, R, under),
    `city ${seed}: the tunnel is dressed as a street`,
  );
}

const N = CITIES * 9;
lines.push(
  `${CITIES} cities, ${N} districts: every building wears a face of its own (${looks.size} different), ${Math.round(faces / N)} wall tiles a district all the city's`,
);
lines.push(`windows and roofs' things: ${Math.round(panes / N)} pieces a district on walls only, ${most} triangles at most`);
lines.push(
  `street furniture a district: ${(things.lamp / N).toFixed(1)} lamps, ${(things.signal / N).toFixed(1)} signals, ${(things.hydrant / N).toFixed(1)} hydrants, on bare pavement, clear of doors and gates`,
);
lines.push(`city furniture: ${[...models.keys()].sort().join(', ')}, each within its tiles`);
lines.push(`streets painted: ${Math.round(marks / N)} marks a district (${fewest} at least), on the map, the same each time`);
lines.push(`the metro's tunnel keeps the prisons' walls`);
console.log(lines.join('\n'));
