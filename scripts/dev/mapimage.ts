// Dev tool: every prison drawn from its data, as PNGs in assets/maps/ (npm run maps), with
// data.js beside them for the viewer there (index.html: what's on each tile, under the cursor).
// The viewer's "In game" pictures are taken in the browser instead: scripts/dev/mapshot.ts.
// Three pictures each: the layout (tiles, zones, doors, cells, props, decor), the people and
// places (guards' rounds and posts, cameras, searchlights, free time, smuggling, delivery,
// checkpoint), and the vents and the ground under (where the prison has them). Drawn as SVG,
// turned into PNG by rsvg-convert (brew install librsvg).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DECOR, wallBehind } from '../../src/content/decor';
import { PRISONS } from '../../src/content/prisons';
import { TRAINING } from '../../src/content/prisons/training';
import type { PrisonDef, Waypoint } from '../../src/content/prisons/types';
import { ZONES } from '../../src/content/zones';
import { en } from '../../src/i18n/en';
import { LAYER, MAP_H, MAP_W, World } from '../../src/sim/world/World';
import { TILE, TILE_INFO } from '../../src/sim/world/tiles';
import pkg from '../../package.json';

const S = 40; // pixels a tile
const M = 34; // margin for the rulers
const W = MAP_W * S + 2 * M;
const LEGEND_H = 230;
const TITLE_H = 44;
const H = TITLE_H + MAP_H * S + 2 * M + LEGEND_H;
const OUT = 'assets/maps';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const px = (x: number) => M + x * S;
const pz = (z: number) => TITLE_H + M + z * S;
const cx = (x: number) => px(x) + S / 2;
const cz = (z: number) => pz(z) + S / 2;
const tr = (key: string, fallback: string) => ((en as Record<string, unknown>)[key] as string | undefined) ?? fallback;

const TILE_FILL: Record<number, string> = {
  [TILE.EMPTY]: '#1b1b1b',
  [TILE.GRASS]: '#8fbf5a',
  [TILE.ROAD]: '#5f6166',
  [TILE.CONCRETE]: '#d6d1c4',
  [TILE.TILED]: '#bcd6df',
  [TILE.WOOD]: '#cf9f66',
  [TILE.ASPHALT]: '#868990',
  [TILE.DIRT]: '#c29361',
  [TILE.BRICK]: '#8a3b2e',
  [TILE.REINFORCED]: '#3a3d45',
  [TILE.FENCE]: '#a7a9ad',
  [TILE.ELECTRIC]: '#f0cf2a',
  [TILE.DOOR]: '#ffffff',
  [TILE.DETECTOR]: '#b07cc6',
  [TILE.TOWER]: '#262626',
  [TILE.WATER]: '#3b7dd8',
  [TILE.MINE]: '#e2c48c',
  [TILE.PIER]: '#8b6a3e',
};
const KEY_FILL = ['#ffffff', '#f4c20d', '#14b8c8', '#8e44ad', '#e2372b', '#27a249'];
const KEY_NAME = ['', 'yellow', 'cyan', 'purple', 'red', 'green'];
const GUARD_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080', '#f032e6', '#9a6324', '#800000', '#000075', '#808000', '#e6a800'];
const ZONE_TINT = ['#ff6b6b', '#4ecdc4', '#ffd93d', '#6c5ce7', '#a3e635', '#fb923c', '#38bdf8', '#f472b6', '#94a3b8', '#facc15'];

function face(f: number | undefined): [number, number] {
  const a = (((f ?? 5) - 1) * 22.5 * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a)];
}

class Svg {
  parts: string[] = [];
  add(s: string) {
    this.parts.push(s);
  }
  rect(x: number, y: number, w: number, h: number, attrs: string) {
    this.add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" ${attrs}/>`);
  }
  text(x: number, y: number, s: string, attrs: string) {
    this.add(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" ${attrs}>${esc(s)}</text>`);
  }
  /** A label on a white pill, centred on (x, y). */
  pill(x: number, y: number, s: string, size: number, color = '#111', bg = 'rgba(255,255,255,0.88)') {
    const w = s.length * size * 0.58 + 8;
    this.rect(x - w / 2, y - size * 0.75, w, size * 1.5, `rx="${size * 0.5}" fill="${bg}" stroke="${color}" stroke-width="1"`);
    this.text(x, y + size * 0.36, s, `font-size="${size}" font-weight="700" fill="${color}" text-anchor="middle"`);
  }
  done(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">${this.parts.join('\n')}</svg>`;
  }
}

/** The floor: every ground tile in its colour, fences hatched, doors in their key's colour. */
function drawTiles(g: Svg, w: World, faded: boolean) {
  const L = w.ground;
  g.add(`<defs>
    <pattern id="fence" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#8fbf5a"/><path d="M0 0L8 8M8 0L0 8" stroke="#444" stroke-width="1.4"/></pattern>
    <pattern id="electric" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#f0cf2a"/><path d="M0 0L8 8M8 0L0 8" stroke="#7a5b00" stroke-width="1.6"/></pattern>
    <pattern id="beds" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 5H10" stroke="#2f7d32" stroke-width="2"/></pattern>
  </defs>`);
  for (let z = 0; z < MAP_H; z++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = z * MAP_W + x;
      const k = L.kind[i];
      let fill = TILE_FILL[k] ?? '#ff00ff';
      if (k === TILE.FENCE) fill = 'url(#fence)';
      if (k === TILE.ELECTRIC) fill = 'url(#electric)';
      if (k === TILE.DOOR) fill = KEY_FILL[L.key[i]];
      g.rect(px(x), pz(z), S, S, `fill="${fill}"`);
      if (faded) continue;
      if (k === TILE.DOOR) {
        const gate = w.gate[i] === 1;
        g.rect(px(x) + 2, pz(z) + 2, S - 4, S - 4, `fill="none" stroke="${gate ? '#000' : '#333'}" stroke-width="${gate ? 4 : 1.5}"`);
        const cell = w.doorCell[i];
        g.text(cx(x), cz(z) + 4, gate ? 'GATE' : cell ? `c${cell}` : KEY_NAME[L.key[i]][0].toUpperCase(), `font-size="${gate ? 9 : 12}" font-weight="700" fill="#000" text-anchor="middle"`);
      }
      if (k === TILE.DETECTOR) g.text(cx(x), cz(z) + 4, 'DET', 'font-size="10" font-weight="700" fill="#fff" text-anchor="middle"');
      if (k === TILE.TOWER) g.text(cx(x), cz(z) + 4, 'T', 'font-size="14" font-weight="700" fill="#fff" text-anchor="middle"');
      if (k === TILE.MINE) g.add(`<circle cx="${cx(x)}" cy="${cz(z)}" r="5" fill="#c0392b"/>`);
    }
  }
  if (faded) g.rect(px(0), pz(0), MAP_W * S, MAP_H * S, 'fill="rgba(255,255,255,0.55)"');
}

/** The grid and the rulers: a number every tile, a stronger line every 8. */
function drawGrid(g: Svg) {
  for (let n = 0; n <= MAP_W; n++) {
    const strong = n % 8 === 0;
    const a = `stroke="${strong ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.12)'}" stroke-width="${strong ? 1.2 : 0.6}"`;
    g.add(`<line x1="${px(n)}" y1="${pz(0)}" x2="${px(n)}" y2="${pz(MAP_H)}" ${a}/>`);
    g.add(`<line x1="${px(0)}" y1="${pz(n)}" x2="${px(MAP_W)}" y2="${pz(n)}" ${a}/>`);
  }
  for (let n = 0; n < MAP_W; n++) {
    const att = `font-size="11" fill="#333" text-anchor="middle"${n % 8 === 0 ? ' font-weight="700"' : ''}`;
    g.text(cx(n), pz(0) - 10, String(n), att);
    g.text(cx(n), pz(MAP_H) + 20, String(n), att);
    g.text(px(0) - 15, cz(n) + 4, String(n), att);
    g.text(px(MAP_W) + 16, cz(n) + 4, String(n), att);
  }
  g.text(px(0) - 15, pz(0) - 10, 'z\\x', 'font-size="10" fill="#666" text-anchor="middle"');
}

/** Zone borders (between two named zones), or each zone's name once per patch of it (drawn last, on top). */
function drawZones(g: Svg, w: World, labels: boolean) {
  const Z = w.ground.zone;
  const named = (i: number) => ZONES[Z[i]] !== 'none';
  for (let z = 0; !labels && z < MAP_H; z++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = z * MAP_W + x;
      if (!named(i)) continue;
      if (x + 1 < MAP_W && named(i + 1) && Z[i + 1] !== Z[i]) g.add(`<line x1="${px(x + 1)}" y1="${pz(z)}" x2="${px(x + 1)}" y2="${pz(z + 1)}" stroke="#d40000" stroke-width="3" stroke-dasharray="6 3"/>`);
      if (z + 1 < MAP_H && named(i + MAP_W) && Z[i + MAP_W] !== Z[i]) g.add(`<line x1="${px(x)}" y1="${pz(z + 1)}" x2="${px(x + 1)}" y2="${pz(z + 1)}" stroke="#d40000" stroke-width="3" stroke-dasharray="6 3"/>`);
    }
  }
  if (!labels) return;
  // One label per connected patch of a zone (cells get their own labels).
  const seen = new Uint8Array(MAP_W * MAP_H);
  for (let i = 0; i < Z.length; i++) {
    const id = ZONES[Z[i]];
    if (seen[i] || id === 'none' || id === 'playerCell' || id === 'inmateCell') continue;
    const patch: number[] = [];
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      patch.push(j);
      const x = j % MAP_W;
      for (const n of [x > 0 ? j - 1 : -1, x < MAP_W - 1 ? j + 1 : -1, j - MAP_W, j + MAP_W]) {
        if (n >= 0 && n < Z.length && !seen[n] && Z[n] === Z[i]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (patch.length < 3) continue;
    const mx = patch.reduce((s, j) => s + (j % MAP_W), 0) / patch.length;
    const mz = patch.reduce((s, j) => s + Math.floor(j / MAP_W), 0) / patch.length;
    const best = patch.reduce((a, b) => {
      const d = (j: number) => (j % MAP_W - mx) ** 2 + (Math.floor(j / MAP_W) - mz) ** 2;
      return d(b) < d(a) ? b : a;
    });
    const label = tr(`zone.${id}`, id).toUpperCase();
    g.pill(cx(best % MAP_W), cz(Math.floor(best / MAP_W)), label, 14, '#a00000');
  }
}

/** Cells: each one framed, numbered, with its inmate's name (cell 1 is the player's). */
function drawCells(g: Svg, def: PrisonDef) {
  def.cells.forEach(([x0, z0, x1, z1], k) => {
    const mine = k === 0;
    g.rect(px(x0) + 1, pz(z0) + 1, (x1 - x0 + 1) * S - 2, (z1 - z0 + 1) * S - 2, `fill="none" stroke="${mine ? '#e0a100' : '#1f4e9c'}" stroke-width="${mine ? 4 : 2}"`);
    const name = mine ? 'YOU' : (def.names[k - 1] ?? '?');
    g.pill((px(x0) + px(x1 + 1)) / 2, pz(z0) + (z1 - z0 + 1) * S - 12, `Cell ${k + 1} · ${name}`, 10, mine ? '#8a5a00' : '#1f4e9c');
  });
}

/** Props: their footprint, named. Solid ones dark, the ones walked over light. */
function drawProps(g: Svg, def: PrisonDef) {
  const walked = new Set(['bench', 'seat', 'chair', 'shower', 'bleachers']);
  for (const p of def.props) {
    const w = p.w ?? 1;
    const d = p.d ?? 1;
    const walk = walked.has(p.kind);
    g.rect(px(p.x) + 3, pz(p.z) + 3, w * S - 6, d * S - 6, `rx="3" fill="${walk ? 'rgba(255,255,255,0.7)' : 'rgba(40,30,20,0.78)'}" stroke="#000" stroke-width="1"${walk ? ' stroke-dasharray="3 2"' : ''}`);
    // The way it faces (rot: 0 south, 1 east, 2 north, 3 west): a notch on that side.
    const r = p.rot ?? 0;
    const [fx, fz] = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ][r];
    const mx = px(p.x) + (w * S) / 2;
    const mz = pz(p.z) + (d * S) / 2;
    g.add(`<circle cx="${mx + (fx * (w * S - 10)) / 2}" cy="${mz + (fz * (d * S - 10)) / 2}" r="2.5" fill="${walk ? '#000' : '#ffd54a'}"/>`);
    const size = Math.max(6, Math.min(11, ((w * S - 6) * 1.7) / p.kind.length));
    g.text(mx, mz + size * 0.35, p.kind, `font-size="${size.toFixed(1)}" fill="${walk ? '#000' : '#fff'}" text-anchor="middle"`);
  }
}

/** Decor: an outline and its name in small italics; wall pieces marked on the wall they hang on. */
function drawDecor(g: Svg, def: PrisonDef) {
  for (const p of def.decor ?? []) {
    const w = p.w ?? 1;
    const d = p.d ?? 1;
    const wall = (DECOR as Record<string, { wall?: boolean }>)[p.kind]?.wall;
    if (wall) {
      const [wx, wz] = wallBehind(p);
      // A thick bar along the edge between the floor tile and the wall it hangs on.
      const r = p.rot ?? 0;
      const vertical = r === 1 || r === 3;
      const ex = r === 1 ? px(p.x) : r === 3 ? px(p.x + w) : px(p.x);
      const ez = r === 0 ? pz(p.z) : r === 2 ? pz(p.z + d) : pz(p.z);
      if (vertical) g.add(`<line x1="${ex}" y1="${ez + 4}" x2="${ex}" y2="${ez + d * S - 4}" stroke="#c026d3" stroke-width="5"/>`);
      else g.add(`<line x1="${ex + 4}" y1="${ez}" x2="${ex + w * S - 4}" y2="${ez}" stroke="#c026d3" stroke-width="5"/>`);
      void wx;
      void wz;
    } else {
      g.rect(px(p.x) + 6, pz(p.z) + 6, w * S - 12, d * S - 12, 'rx="6" fill="none" stroke="#c026d3" stroke-width="1.5"');
    }
    const size = Math.max(5.5, Math.min(8.5, ((w * S - 2) * 1.8) / p.kind.length));
    g.text(px(p.x) + (w * S) / 2, pz(p.z) + d * S - 4, p.kind, `font-size="${size.toFixed(1)}" font-style="italic" fill="#86198f" text-anchor="middle"`);
  }
}

/** The pay phone (P34): a bar on the wall it hangs on (the caller faces it), the queue's tiles 1… nearest first; with `lou`, the car alarm by the front gate and Lou's getaway car on the road. */
function drawComms(g: Svg, def: PrisonDef, lou: boolean) {
  const c = def.comms;
  if (!c) return;
  const teal = '#0f766e';
  const [fx, fz] = face(c.phone.face);
  const ex = cx(c.phone.x) + (fx * S) / 2;
  const ez = cz(c.phone.z) + (fz * S) / 2;
  const across = Math.round(fx) !== 0;
  if (across) g.add(`<line x1="${ex}" y1="${ez - S / 2 + 4}" x2="${ex}" y2="${ez + S / 2 - 4}" stroke="${teal}" stroke-width="7"/>`);
  else g.add(`<line x1="${ex - S / 2 + 4}" y1="${ez}" x2="${ex + S / 2 - 4}" y2="${ez}" stroke="${teal}" stroke-width="7"/>`);
  g.rect(px(c.phone.x) + 7, pz(c.phone.z) + 7, S - 14, S - 14, `rx="5" fill="${teal}"`);
  g.text(cx(c.phone.x), cz(c.phone.z) + 3.5, 'tel', 'font-size="9" font-weight="700" fill="#fff" text-anchor="middle"');
  const line = [c.phone, ...c.line];
  g.add(`<polyline points="${line.map((q) => `${cx(q.x)},${cz(q.z)}`).join(' ')}" fill="none" stroke="${teal}" stroke-width="2" stroke-dasharray="3 3"/>`);
  c.line.forEach((q, k) => {
    g.add(`<circle cx="${cx(q.x)}" cy="${cz(q.z)}" r="8" fill="#fff" stroke="${teal}" stroke-width="2"/>`);
    g.text(cx(q.x), cz(q.z) + 3.5, `${k + 1}`, `font-size="9" font-weight="700" fill="${teal}" text-anchor="middle"`);
  });
  g.pill(cx(c.phone.x), cz(c.phone.z) + S * 0.62, 'PAY PHONE', 9, teal);
  if (!lou) return;
  const red = '#be123c';
  g.add(`<circle cx="${cx(c.gate.x)}" cy="${cz(c.gate.z)}" r="11" fill="rgba(190,18,60,0.2)" stroke="${red}" stroke-width="2.5" stroke-dasharray="4 3"/>`);
  g.pill(cx(c.gate.x), cz(c.gate.z) - 18, 'CAR ALARM', 9, red);
  const [ax, az] = face(c.car.face);
  const long = Math.round(ax) !== 0;
  const cw = long ? S * 1.6 : S * 0.8;
  const cd = long ? S * 0.8 : S * 1.6;
  g.rect(cx(c.car.x) - cw / 2, cz(c.car.z) - cd / 2, cw, cd, `rx="6" fill="${red}" stroke="#000" stroke-width="1.5"`);
  arrow(g, c.car.x, c.car.z, c.car.face, '#fff', 14);
  g.pill(cx(c.car.x), cz(c.car.z) - cd / 2 - 10, "LOU'S CAR", 9, red);
}

function drawMarks(g: Svg, def: PrisonDef) {
  for (const q of def.rollCall) g.add(`<circle cx="${cx(q.x)}" cy="${cz(q.z)}" r="6" fill="#fff" stroke="#c2410c" stroke-width="2.5"/>`);
  const s = def.spawn;
  const star = Array.from({ length: 10 }, (_, k) => {
    const a = (k * Math.PI) / 5 - Math.PI / 2;
    const r = k % 2 ? 6 : 14;
    return `${(cx(s.x) + r * Math.cos(a)).toFixed(1)},${(cz(s.z) + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  g.add(`<polygon points="${star}" fill="#ffd400" stroke="#000" stroke-width="1.5"/>`);
}

function arrow(g: Svg, x: number, z: number, f: number | undefined, color: string, len = 16) {
  const [dx, dz] = face(f);
  const x1 = cx(x) + dx * len;
  const y1 = cz(z) + dz * len;
  g.add(`<line x1="${cx(x)}" y1="${cz(z)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${color}" stroke-width="2.5" marker-end="url(#tip)"/>`);
}

function route(g: Svg, pts: readonly Waypoint[], color: string, dashed: boolean, tag: string) {
  if (!pts.length) return;
  const poly = [...pts, pts[0]].map((q) => `${cx(q.x)},${cz(q.z)}`).join(' ');
  g.add(`<polyline points="${poly}" fill="none" stroke="${color}" stroke-width="${dashed ? 2.5 : 3.5}" stroke-opacity="0.85"${dashed ? ' stroke-dasharray="8 5"' : ''}/>`);
  pts.forEach((q, k) => {
    g.add(`<circle cx="${cx(q.x)}" cy="${cz(q.z)}" r="9" fill="${dashed ? '#fff' : color}" stroke="${color}" stroke-width="2"/>`);
    if (q.face) arrow(g, q.x, q.z, q.face, color, 18);
    g.text(cx(q.x), cz(q.z) + 3.5, `${tag}${k + 1}`, `font-size="9" font-weight="700" fill="${dashed ? color : '#fff'}" text-anchor="middle"`);
    if (q.wait || q.nap) g.text(cx(q.x) + 11, cz(q.z) - 9, `${q.wait ? `${q.wait}s` : ''}${q.nap ? ' nap' : ''}`, `font-size="9" fill="${color}" font-weight="700"`);
  });
}

/** Guards' rounds, posts, night rounds and dogs; cameras, searchlights; free time; smuggling; delivery; checkpoint. */
function drawPeople(g: Svg, def: PrisonDef) {
  g.add('<defs><marker id="tip" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="context-stroke"/></marker></defs>');
  const ls = def.leisure;
  if (ls) {
    const pi = ls.pitch;
    g.rect(px(pi.x), pz(pi.z), pi.w * S, pi.d * S, 'fill="rgba(255,255,255,0.25)" stroke="#fff" stroke-width="4"');
    g.pill(px(pi.x) + (pi.w * S) / 2, pz(pi.z) + 14, 'PITCH', 11, '#14532d');
    if (ls.track) {
      const t = ls.track;
      g.rect(px(t.x) + S / 2, pz(t.z) + S / 2, (t.w - 1) * S, (t.d - 1) * S, 'fill="none" stroke="#b45309" stroke-width="7" stroke-opacity="0.6"');
      g.pill(px(t.x) + S * 1.5, pz(t.z) + S / 2, 'TRACK', 10, '#b45309');
    }
    const gd = ls.garden;
    g.rect(px(gd.x), pz(gd.z), gd.w * S, gd.d * S, 'fill="url(#beds)" stroke="#2f7d32" stroke-width="3"');
    g.pill(px(gd.x) + (gd.w * S) / 2, pz(gd.z) + (gd.d * S) / 2, `BEDS ${gd.w * gd.d}`, 10, '#14532d');
    const h = ls.hoop;
    g.add(`<circle cx="${cx(h.x)}" cy="${cz(h.z)}" r="12" fill="none" stroke="#ea580c" stroke-width="4"/>`);
    arrow(g, h.x, h.z, h.face, '#ea580c', 22);
    h.spots.forEach((q, k) => {
      g.rect(px(q.x) + 10, pz(q.z) + 10, S - 20, S - 20, 'fill="#ea580c"');
      g.text(cx(q.x), cz(q.z) + 3.5, `S${k + 1}`, 'font-size="9" font-weight="700" fill="#fff" text-anchor="middle"');
    });
    const ra = ls.race;
    const [rx, rz] = face(ra.dir);
    g.add(`<line x1="${cx(ra.x)}" y1="${cz(ra.z)}" x2="${cx(ra.x) + rx * ra.len * S}" y2="${cz(ra.z) + rz * ra.len * S}" stroke="#7c3aed" stroke-width="6" stroke-opacity="0.7" marker-end="url(#tip)"/>`);
    g.pill(cx(ra.x), cz(ra.z) - 14, 'RAT RACE', 9, '#7c3aed');
    if (ls.stage) {
      const st = ls.stage;
      const [fx, fz] = face(st.face);
      const ax = -Math.round(fz);
      const az = Math.round(fx);
      for (const front of [0, 1]) for (const side of [-1, 0, 1]) {
        const bx = st.x + Math.round(fx) * front + ax * side;
        const bz = st.z + Math.round(fz) * front + az * side;
        g.rect(px(bx) + 2, pz(bz) + 2, S - 4, S - 4, 'fill="rgba(219,39,119,0.35)" stroke="#db2777" stroke-width="1.5"');
      }
      arrow(g, st.x, st.z, st.face, '#db2777', 20);
      g.pill(cx(st.x), cz(st.z), 'STAGE', 9, '#db2777');
    }
    if (ls.quiz) ls.quiz.spots.forEach((q, k) => {
      g.add(`<circle cx="${cx(q.x)}" cy="${cz(q.z)}" r="10" fill="#0891b2"/>`);
      arrow(g, q.x, q.z, ls.quiz!.face, '#0891b2', 16);
      g.text(cx(q.x), cz(q.z) + 3.5, `Q${k + 1}`, 'font-size="9" font-weight="700" fill="#fff" text-anchor="middle"');
    });
  }
  const sm = def.smuggling;
  if (sm) {
    const [a, b, c, d] = sm.drop;
    g.rect(px(a), pz(b), (c - a + 1) * S, (d - b + 1) * S, 'fill="rgba(217,70,239,0.12)" stroke="#d946ef" stroke-width="3" stroke-dasharray="10 6"');
    g.pill(px(a) + 50, pz(b) + 12, 'DRONE DROP', 10, '#a21caf');
    if (sm.visits) {
      const [e, f, h2, i2] = sm.visits;
      g.rect(px(e) + 4, pz(f) + 4, (h2 - e + 1) * S - 8, (i2 - f + 1) * S - 8, 'fill="none" stroke="#0e7490" stroke-width="3" stroke-dasharray="4 4"');
      g.pill(px(e) + 40, pz(f) + 16, 'VISITS', 10, '#0e7490');
    }
  }
  const dl = def.delivery;
  if (dl) {
    const [a, b, c, d] = dl.bay;
    g.rect(px(a), pz(b), (c - a + 1) * S, (d - b + 1) * S, 'fill="rgba(234,179,8,0.35)" stroke="#a16207" stroke-width="3"');
    g.pill((px(a) + px(c + 1)) / 2, (pz(b) + pz(d + 1)) / 2, `DELIVERY (${dl.vehicle})`, 10, '#713f12');
    g.rect(px(dl.tail.x) + 6, pz(dl.tail.z) + 6, S - 12, S - 12, 'fill="#a16207"');
    g.text(cx(dl.tail.x), cz(dl.tail.z) + 3.5, 'tail', 'font-size="9" fill="#fff" text-anchor="middle"');
    g.add(`<polyline points="${dl.road.map((q) => `${cx(q.x)},${cz(q.z)}`).join(' ')}" fill="none" stroke="#a16207" stroke-width="2" stroke-dasharray="3 4"/>`);
    for (const q of dl.open ?? []) g.rect(px(q.x) + 3, pz(q.z) + 3, S - 6, S - 6, 'fill="none" stroke="#a16207" stroke-width="3"');
    route(g, dl.round, '#a16207', true, 'd');
  }
  const ck = def.checkpoint;
  if (ck) {
    for (const q of ck.window) g.rect(px(q.x) + 4, pz(q.z) + 4, S - 8, S - 8, 'fill="rgba(5,150,105,0.4)" stroke="#047857" stroke-width="2"');
    ck.gates.forEach((q, k) => g.text(cx(q.x), cz(q.z) - 8, `g${k + 1}`, 'font-size="10" font-weight="700" fill="#047857" text-anchor="middle"'));
    g.rect(px(ck.booth.x) + 4, pz(ck.booth.z) + 4, S - 8, S - 8, 'fill="#047857"');
    g.pill(cx(ck.booth.x), cz(ck.booth.z) - 18, 'CHECKPOINT BOOTH', 9, '#047857');
    g.pill(cx(ck.window[0].x), cz(ck.window[0].z) + 18, 'ID WINDOW', 9, '#047857');
  }
  for (const r of def.landings ?? []) g.rect(px(r[0]), pz(r[1]), (r[2] - r[0] + 1) * S, (r[3] - r[1] + 1) * S, 'fill="none" stroke="#0f172a" stroke-width="3" stroke-dasharray="2 3"');
  if (def.drawbridge) {
    const r = def.drawbridge;
    g.rect(px(r[0]), pz(r[1]), (r[2] - r[0] + 1) * S, (r[3] - r[1] + 1) * S, 'fill="rgba(139,106,62,0.6)" stroke="#000" stroke-width="2"');
    g.pill(cx(r[0]), cz(r[1]) - 16, 'DRAWBRIDGE', 9, '#000');
  }
  for (const line of def.searchlights ?? []) {
    g.add(`<polyline points="${line.map((q) => `${cx(q.x)},${cz(q.z)}`).join(' ')}" fill="none" stroke="#facc15" stroke-width="8" stroke-opacity="0.7" stroke-linecap="round"/>`);
  }
  for (const cam of def.cameras ?? []) {
    const r = 3 * S;
    const [a0x, a0z] = face(cam.face - 2);
    const [a1x, a1z] = face(cam.face + 2);
    g.add(`<path d="M${cx(cam.x)} ${cz(cam.z)} L${cx(cam.x) + a0x * r} ${cz(cam.z) + a0z * r} A${r} ${r} 0 0 1 ${cx(cam.x) + a1x * r} ${cz(cam.z) + a1z * r} Z" fill="rgba(220,38,38,0.15)" stroke="#dc2626" stroke-width="1.5"/>`);
    g.rect(px(cam.x) + 12, pz(cam.z) + 12, S - 24, S - 24, 'fill="#dc2626"');
  }
  def.guards.forEach((gu, k) => {
    const color = GUARD_COLORS[k % GUARD_COLORS.length];
    route(g, gu.beat, color, false, '');
    if (gu.night) route(g, gu.night, color, true, 'n');
    for (const [id, q] of Object.entries(gu.posts ?? {})) {
      if (!q) continue;
      g.rect(px(q.x) + 4, pz(q.z) + 4, S - 8, S - 8, `fill="#fff" stroke="${color}" stroke-width="3"`);
      if (q.face) arrow(g, q.x, q.z, q.face, color, 18);
      g.text(cx(q.x), cz(q.z) + 3, id.slice(0, 6), `font-size="7.5" font-weight="700" fill="${color}" text-anchor="middle"`);
    }
    if (gu.dog) {
      const kq = gu.dog.kennel;
      g.add(`<polygon points="${cx(kq.x)},${pz(kq.z) + 4} ${px(kq.x) + S - 4},${pz(kq.z) + S - 4} ${px(kq.x) + 4},${pz(kq.z) + S - 4}" fill="${color}" stroke="#000"/>`);
      g.pill(cx(kq.x), pz(kq.z) - 6, `kennel ${gu.dog.name}`, 9, color);
    }
  });
}

/** Vents (ducts, grates, the ladder) over the faded ground, and the boulders under it. */
function drawVents(g: Svg, w: World) {
  const V = w.layers[LAYER.VENTS].kind;
  const U = w.layers[LAYER.UNDER].kind;
  for (let i = 0; i < V.length; i++) {
    const x = i % MAP_W;
    const z = Math.floor(i / MAP_W);
    if (U[i] === TILE.BOULDER) g.add(`<circle cx="${cx(x)}" cy="${cz(z)}" r="${S * 0.42}" fill="#4b5563" stroke="#111" stroke-width="1.5"/>`);
    const k = V[i];
    if (k === TILE.DUCT) g.rect(px(x) + 6, pz(z) + 6, S - 12, S - 12, 'fill="#64748b" stroke="#1e293b" stroke-width="1.5"');
    if (k === TILE.GRATE) {
      g.rect(px(x) + 4, pz(z) + 4, S - 8, S - 8, 'fill="#0ea5e9" stroke="#0c4a6e" stroke-width="2"');
      g.text(cx(x), cz(z) + 4, 'V', 'font-size="12" font-weight="700" fill="#fff" text-anchor="middle"');
    }
    if (k === TILE.LADDER) {
      g.rect(px(x) + 4, pz(z) + 4, S - 8, S - 8, 'fill="#16a34a" stroke="#14532d" stroke-width="2"');
      g.text(cx(x), cz(z) + 4, 'L', 'font-size="12" font-weight="700" fill="#fff" text-anchor="middle"');
    }
  }
}

function swatch(g: Svg, x: number, y: number, fill: string, label: string, extra = '') {
  g.rect(x, y, 22, 22, `fill="${fill}" stroke="#000" stroke-width="1" ${extra}`);
  g.text(x + 28, y + 16, label, 'font-size="13" fill="#111"');
}

function legend(g: Svg, kind: 'layout' | 'people' | 'vents', def: PrisonDef) {
  const y0 = TITLE_H + MAP_H * S + 2 * M + 10;
  g.rect(0, y0 - 10, W, LEGEND_H + 10, 'fill="#f5f3ee"');
  let x = M;
  let y = y0;
  const col = 200;
  const items: Array<[string, string]> = [];
  if (kind === 'layout') {
    items.push(
      ['#8fbf5a', 'grass (.)'], ['#c29361', 'dirt (d)'], ['#868990', 'asphalt (a)'], ['#5f6166', 'road (,)'],
      ['#d6d1c4', 'concrete (_)'], ['#bcd6df', 'tiled (:)'], ['#cf9f66', 'wood (w)'], ['#8a3b2e', 'brick wall (#)'],
      ['#3a3d45', 'reinforced (@)'], ['url(#fence)', 'fence (=)'], ['url(#electric)', 'electric fence (%)'], ['#b07cc6', 'detector (D)'],
      ['#262626', 'tower (T)'], ['#3b7dd8', 'water (~)'], ['#e2c48c', 'mine (*)'], ['#8b6a3e', 'pier (P)'],
      [KEY_FILL[1], 'yellow door (y)'], [KEY_FILL[2], 'cyan door (c)'], [KEY_FILL[3], 'purple door (p)'], [KEY_FILL[4], 'red door (r)'], [KEY_FILL[5], 'green door (g)'],
    );
  }
  items.forEach(([f, l], k) => {
    swatch(g, x + (k % 7) * col, y + Math.floor(k / 7) * 30, f, l);
  });
  y += kind === 'layout' ? 100 : 0;
  const notes: string[] =
    kind === 'layout'
      ? [
          'Red dashed lines: zone borders (between two named zones; walls are "none"). Red pills: zone names, once per patch.',
          'Dark boxes: solid props (named; yellow dot = the side it faces). Light dashed boxes: props walked over (benches, seats, chairs, showers, bleachers).',
          'Pink: decor (pink bar = a wall piece, on the wall it hangs on; pink outline = a floor piece). Doors: c<n> = cell n\'s door, GATE = perimeter gate (no key opens it).',
          'Orange rings: roll-call spots. Yellow star: where the player starts. Blue frames: cells (gold = the player\'s cell 1). Teal: the pay phone (bar = its wall, tel = the caller\'s tile) and its queue 1…',
        ]
      : kind === 'people'
        ? [
            'Guards: solid line + filled dots = day beat (stop numbers in order, the loop closes); dashed + white dots (n1, n2…) = night round. Arrows: the way they look; "12s" = wait at a stop.',
            'White squares = posts (where a guard stands during a block: rollCa(ll), breakf(ast), exerci(se), showers, dinner…). Lines are straight between stops, not the walked path.',
            'Red wedges: cameras (±45°, 3 tiles drawn). Yellow lines: searchlight sweeps. Free time: pitch (white), track (brown ring), garden beds (green), hoop + shooting spots S1–S5 (orange), rat race (purple arrow), stage (pink), quiz Q1–Q4 (teal).',
            'Smuggling: drone drop (purple dashed) and visits room (teal dashed). Delivery: bay, tail, road and supervisor round d1… (brown). Checkpoint: ID window, gates g1…, booth (green).',
            'Pay phone: the phone and its queue 1… (teal). Cousin Lou: the car alarm inside the front gate (red ring) and his getaway car on the road, arrow = the way it drives off (red).',
          ]
        : [
            'Layer +1 over the faded ground floor: grey = ducts, blue V = ceiling grates (down into the room below), green L = the ladder up to the roof.',
            'Grey discs: granite boulders under the ground (layer -1) that no tunnel can dig through. Without them, the earth is soft all through.',
          ];
  notes.forEach((n, k) => g.text(M, y + 10 + k * 22, n, 'font-size="14" fill="#222"'));
  if (kind === 'people') {
    let gx = M;
    let gy = y + 10 + notes.length * 22 + 10;
    def.guards.forEach((gu, k) => {
      const color = GUARD_COLORS[k % GUARD_COLORS.length];
      const label = `${gu.name ?? `guard ${k + 1}`} · ${gu.key} key · ${gu.trait ?? 'steady'}${gu.riot ? ' · riot' : ''}${gu.helipad ? ' · helipad' : ''}${gu.dog ? ` · dog ${gu.dog.name}` : ''}${gu.night ? '' : ' · sleeps at night'}`;
      const wpx = label.length * 7.4 + 34;
      if (gx + wpx > W - M) {
        gx = M;
        gy += 26;
      }
      g.rect(gx, gy, 18, 18, `fill="${color}"`);
      g.text(gx + 24, gy + 14, label, 'font-size="13" fill="#111"');
      gx += wpx;
    });
  }
}

function picture(def: PrisonDef, kind: 'layout' | 'people' | 'vents'): string {
  const w = new World(def);
  const g = new Svg();
  g.rect(0, 0, W, H, 'fill="#ffffff"');
  const name = def.id === 'training' ? 'Training Block' : tr(`prison.${def.id}`, def.id);
  const what = kind === 'layout' ? 'layout: tiles, zones, doors, cells, props, decor, pay phone' : kind === 'people' ? 'people & places: guards, cameras, free time, smuggling, delivery, checkpoint, pay phone' : 'vents (layer +1) and boulders under the ground (layer -1)';
  g.text(M, 30, `${name} — ${what}`, 'font-size="24" font-weight="700" fill="#111"');
  g.text(W - M, 30, `v${pkg.version} · map rev ${def.map ?? 0} · ${def.theme ?? 'suburban'} · x → east, z ↓ south`, 'font-size="15" fill="#555" text-anchor="end"');
  drawTiles(g, w, kind !== 'layout');
  drawGrid(g);
  if (kind === 'layout') {
    drawZones(g, w, false);
    drawProps(g, def);
    drawDecor(g, def);
    drawComms(g, def, false);
    drawCells(g, def);
    drawMarks(g, def);
    drawZones(g, w, true);
  } else if (kind === 'people') {
    drawZones(g, w, false);
    drawPeople(g, def);
    drawComms(g, def, true);
    drawZones(g, w, true);
  } else {
    drawVents(g, w);
  }
  legend(g, kind, def);
  return g.done();
}

const tmp = mkdtempSync(join(tmpdir(), 'pe3d-maps-'));
mkdirSync(OUT, { recursive: true });
const all = [TRAINING, ...PRISONS];
all.forEach((def, n) => {
  const kinds: Array<'layout' | 'people' | 'vents'> = ['layout', 'people'];
  if (def.vents || def.under) kinds.push('vents');
  for (const kind of kinds) {
    const svg = join(tmp, `${def.id}-${kind}.svg`);
    writeFileSync(svg, picture(def, kind));
    const png = join(OUT, `${n}-${def.id}-${kind}.png`);
    execFileSync('rsvg-convert', ['-o', png, svg]);
    console.log(png);
  }
});
rmSync(tmp, { recursive: true, force: true });

/** What the viewer shows under the cursor: each tile's kind and zone, and what stands or stops on it. */
function tileData(def: PrisonDef, n: number) {
  const w = new World(def);
  const L = w.ground;
  const views: Array<'layout' | 'people' | 'vents'> = ['layout', 'people'];
  if (def.vents || def.under) views.push('vents');
  // The in-game picture (scripts/dev/mapshot.ts, taken in the browser), where one was taken: its frame's numbers beside it.
  const shot = join(OUT, `${n}-${def.id}-game.json`);
  const game = existsSync(shot) ? JSON.parse(readFileSync(shot, 'utf8')) : null;
  const marks: Array<[number, number, string]> = [];
  const mark = (x: number, z: number, s: string) => marks.push([x, z, s]);
  def.guards.forEach((gu, k) => {
    const who = gu.name ?? `guard ${k + 1}`;
    gu.beat.forEach((q, j) => mark(q.x, q.z, `${who}: day stop ${j + 1}${q.wait ? `, waits ${q.wait}s` : ''}`));
    (gu.night ?? []).forEach((q, j) => mark(q.x, q.z, `${who}: night stop n${j + 1}${q.wait ? `, waits ${q.wait}s` : ''}${q.nap ? ', naps' : ''}`));
    for (const [id, q] of Object.entries(gu.posts ?? {})) if (q) mark(q.x, q.z, `${who}: post at ${id}`);
    if (gu.dog) mark(gu.dog.kennel.x, gu.dog.kennel.z, `kennel of ${gu.dog.name} (${who}'s dog)`);
  });
  for (const c of def.cameras ?? []) mark(c.x, c.z, `camera, facing ${c.face}`);
  def.rollCall.forEach((q, k) => mark(q.x, q.z, `roll-call spot ${k + 1}`));
  mark(def.spawn.x, def.spawn.z, 'player start');
  const ls = def.leisure;
  if (ls) {
    mark(ls.hoop.x, ls.hoop.z, 'hoop (under the rim)');
    ls.hoop.spots.forEach((q, k) => mark(q.x, q.z, `hoop shooting spot S${k + 1}`));
    ls.quiz?.spots.forEach((q, k) => mark(q.x, q.z, `quiz seat Q${k + 1}`));
    if (ls.stage) mark(ls.stage.x, ls.stage.z, 'talent stage (performer)');
    mark(ls.race.x, ls.race.z, 'rat race start');
  }
  if (def.delivery) mark(def.delivery.tail.x, def.delivery.tail.z, 'delivery tail (stowaway climbs in)');
  for (const q of def.checkpoint?.window ?? []) mark(q.x, q.z, 'checkpoint ID window');
  if (def.checkpoint) mark(def.checkpoint.booth.x, def.checkpoint.booth.z, 'checkpoint booth');
  if (def.comms) {
    const c = def.comms;
    mark(c.phone.x, c.phone.z, `pay phone (the caller stands here, facing ${c.phone.face})`);
    c.line.forEach((q, k) => mark(q.x, q.z, `pay phone queue, place ${k + 1}`));
    mark(c.gate.x, c.gate.z, "Lou's car alarm (inside the front gate)");
    mark(c.car.x, c.car.z, "Lou's getaway car (on the road)");
  }
  const V = w.layers[LAYER.VENTS].kind;
  const U = w.layers[LAYER.UNDER].kind;
  const above: Array<[number, number, string]> = [];
  for (let i = 0; i < V.length; i++) {
    const what = V[i] === TILE.DUCT ? 'duct' : V[i] === TILE.GRATE ? 'vent grate' : V[i] === TILE.LADDER ? 'roof ladder' : U[i] === TILE.BOULDER ? 'boulder underground' : '';
    if (what) above.push([i % MAP_W, Math.floor(i / MAP_W), what]);
  }
  const doors: Array<[number, number, string, number, number]> = [];
  for (let i = 0; i < L.kind.length; i++) if (L.kind[i] === TILE.DOOR) doors.push([i % MAP_W, Math.floor(i / MAP_W), KEY_NAME[L.key[i]], w.doorCell[i], w.gate[i]]);
  return {
    id: def.id,
    n,
    name: def.id === 'training' ? 'Training Block' : tr(`prison.${def.id}`, def.id),
    info: def.id === 'training' ? 'The tutorial\'s prison: lessons, a forgiving routine.' : tr(`prisonInfo.${def.id}`, ''),
    difficulty: def.difficulty,
    theme: def.theme ?? 'suburban',
    map: def.map ?? 0,
    views: [...(game ? [{ kind: 'game', ...game }] : []), ...views.map((v) => ({ kind: v, file: `${n}-${def.id}-${v}.png` }))],
    tiles: Array.from(L.kind),
    zones: Array.from(L.zone),
    cells: def.cells.map((c, k) => [...c, k === 0 ? 'the player' : (def.names[k - 1] ?? '?')]),
    props: def.props.map((p) => [p.kind, p.x, p.z, p.w ?? 1, p.d ?? 1]),
    decor: (def.decor ?? []).map((p) => [p.kind, p.x, p.z, p.w ?? 1, p.d ?? 1]),
    doors,
    marks,
    above,
    guards: def.guards.map((gu, k) => ({
      name: gu.name ?? `guard ${k + 1}`,
      color: GUARD_COLORS[k % GUARD_COLORS.length],
      key: gu.key,
      trait: gu.trait ?? 'steady',
      tags: [gu.riot && 'riot', gu.helipad && 'helipad', gu.dog && `dog ${gu.dog.name}`, !gu.night && 'sleeps at night'].filter(Boolean),
    })),
  };
}

const data = {
  version: pkg.version,
  geometry: { tile: S, margin: M, title: TITLE_H, mapW: MAP_W, mapH: MAP_H, width: W, height: H },
  tileNames: Object.fromEntries(Object.entries(TILE_INFO).map(([k, v]) => [k, v.name])),
  zoneNames: ZONES.map((id) => tr(`zone.${id}`, id)),
  prisons: all.map(tileData),
};
writeFileSync(join(OUT, 'data.js'), `// Written by scripts/dev/mapimage.ts (npm run maps): what the viewer shows under the cursor.\nwindow.MAP_DATA = ${JSON.stringify(data)};\n`);
console.log(join(OUT, 'data.js'));
