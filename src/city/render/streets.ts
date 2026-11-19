import { mix32 } from '../../sim/rng';
import { MAP_H, MAP_W } from '../../sim/world/grid';
import { TILE } from '../../sim/world/tiles';
import type { World } from '../../sim/world/World';
import { townOf } from '../town';

/**
 * A district's streets, painted (2.57): the worn white dashes down the middle of each road, a kerb where
 * the pavement meets it, a crossing and a stop line at each junction, bays in the car parks, a step
 * before each street door, and what years did to the tarmac (manholes, patches, cracks, oil). Drawn once
 * into the ground's paint layer (render/ground.ts), `R` pixels a tile; every mark hashed from its tile,
 * so a district looks the same each time it's entered. False where the world is no district.
 */
export function paintStreets(c: CanvasRenderingContext2D, R: number, world: World): boolean {
  const district = townOf(world);
  if (!district?.lots.length) return false;
  const kind = (x: number, z: number) => (x >= 0 && z >= 0 && x < MAP_W && z < MAP_H ? world.ground.base[z * MAP_W + x] : TILE.EMPTY);
  const road = (x: number, z: number) => kind(x, z) === TILE.ROAD;
  const hash = (x: number, z: number, salt: number) =>
    mix32(Math.imul(z * MAP_W + x + 1, 0x9e3779b1) ^ Math.imul(district.index + salt, 0x85ebca6b));
  // The streets: the columns and rows that are road nearly all the way (a street runs the district's length).
  const col = new Uint8Array(MAP_W);
  const row = new Uint8Array(MAP_H);
  for (let x = 0; x < MAP_W; x++) {
    let n = 0;
    for (let z = 0; z < MAP_H; z++) if (road(x, z)) n++;
    col[x] = n > MAP_H * 0.6 ? 1 : 0;
  }
  for (let z = 0; z < MAP_H; z++) {
    let n = 0;
    for (let x = 0; x < MAP_W; x++) if (road(x, z)) n++;
    row[z] = n > MAP_W * 0.6 ? 1 : 0;
  }
  const WHITE = 'rgba(226, 226, 218, 0.62)';
  const FAINT = 'rgba(226, 226, 218, 0.34)';

  // What years did to the tarmac, under the paint.
  for (let z = 0; z < MAP_H; z++)
    for (let x = 0; x < MAP_W; x++) {
      if (!road(x, z)) continue;
      const h = hash(x, z, 11);
      const px = x * R;
      const pz = z * R;
      if (h % 23 === 0) {
        // (A patch laid over a trench: a paler square.)
        c.fillStyle = 'rgba(120, 122, 126, 0.3)';
        c.fillRect(px + 2 + ((h >> 8) & 3), pz + 3 + ((h >> 10) & 3), 7 + ((h >> 12) & 3), 5 + ((h >> 14) & 3));
      } else if (h % 17 === 0) {
        c.fillStyle = 'rgba(16, 16, 18, 0.34)';
        c.beginPath();
        c.ellipse(px + 5 + ((h >> 8) & 7), pz + 5 + ((h >> 11) & 7), 3 + ((h >> 14) & 1), 2, ((h >> 15) & 7) / 2, 0, Math.PI * 2);
        c.fill();
      } else if (h % 7 === 0) {
        // (A crack: a few dark pixels wandering across the tile.)
        c.fillStyle = 'rgba(18, 18, 20, 0.5)';
        let cx = (h >> 8) & 7;
        for (let k = 0; k < R; k += 2) {
          cx += ((h >> (k & 15)) & 3) - 1;
          c.fillRect(px + Math.max(0, Math.min(R - 1, cx + 4)), pz + k, 1, 2);
        }
      }
      if (h % 61 === 3 && !(col[x] && row[z])) {
        // (A manhole: an iron lid, its rim, its two lifting slots.)
        const mx = px + R / 2;
        const mz = pz + R / 2;
        c.fillStyle = 'rgba(28, 28, 30, 0.85)';
        c.beginPath();
        c.arc(mx, mz, 4.5, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(92, 94, 98, 0.9)';
        c.beginPath();
        c.arc(mx, mz, 3.4, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = 'rgba(28, 28, 30, 0.9)';
        c.fillRect(mx - 2, mz - 0.5, 1.5, 1);
        c.fillRect(mx + 0.5, mz - 0.5, 1.5, 1);
      }
    }

  // The kerb: a pale stone edge on the pavement's side of every road tile, a dark gutter on the road's.
  for (let z = 0; z < MAP_H; z++)
    for (let x = 0; x < MAP_W; x++) {
      if (!road(x, z)) continue;
      const px = x * R;
      const pz = z * R;
      for (const [dx, dz] of [
        [0, -1],
        [0, 1],
        [-1, 0],
        [1, 0],
      ]) {
        if (kind(x + dx, z + dz) !== TILE.ASPHALT) continue;
        c.fillStyle = 'rgba(196, 198, 200, 0.9)';
        if (dz) c.fillRect(px, dz < 0 ? pz - 2 : pz + R, R, 2);
        else c.fillRect(dx < 0 ? px - 2 : px + R, pz, 2, R);
        c.fillStyle = 'rgba(14, 14, 16, 0.4)';
        if (dz) c.fillRect(px, dz < 0 ? pz : pz + R - 1, R, 1);
        else c.fillRect(dx < 0 ? px : px + R - 1, pz, 1, R);
      }
    }

  // The middle line: where a street is two tiles wide, dashes on the seam between them, short of each junction.
  const worn = (x: number, z: number) => hash(x, z, 23) % 5 === 0;
  for (let x = 0; x < MAP_W - 1; x++) {
    if (!col[x] || !col[x + 1] || (x > 0 && col[x - 1])) continue;
    for (let z = 0; z < MAP_H; z++) {
      if (!road(x, z) || !road(x + 1, z) || row[z] || row[z - 1] || row[z + 1]) continue;
      c.fillStyle = worn(x, z) ? FAINT : WHITE;
      c.fillRect((x + 1) * R - 1, z * R + 3, 2, R - 7);
    }
  }
  for (let z = 0; z < MAP_H - 1; z++) {
    if (!row[z] || !row[z + 1] || (z > 0 && row[z - 1])) continue;
    for (let x = 0; x < MAP_W; x++) {
      if (!road(x, z) || !road(x, z + 1) || col[x] || col[x - 1] || col[x + 1]) continue;
      c.fillStyle = worn(x, z) ? FAINT : WHITE;
      c.fillRect(x * R + 3, (z + 1) * R - 1, R - 7, 2);
    }
  }

  // A crossing on each arm of a junction: bars along the way the cars went, on the tile before the corner.
  for (let z = 0; z < MAP_H; z++)
    for (let x = 0; x < MAP_W; x++) {
      if (!road(x, z)) continue;
      const px = x * R;
      const pz = z * R;
      if (col[x] && !row[z] && (row[z - 1] || row[z + 1])) {
        for (let k = 1; k < R; k += 4) {
          c.fillStyle = hash(x * 4 + k, z, 31) % 4 ? WHITE : FAINT;
          c.fillRect(px + k, pz + 3, 2, R - 6);
        }
      } else if (row[z] && !col[x] && (col[x - 1] || col[x + 1])) {
        for (let k = 1; k < R; k += 4) {
          c.fillStyle = hash(x, z * 4 + k, 31) % 4 ? WHITE : FAINT;
          c.fillRect(px + 3, pz + k, R - 6, 2);
        }
      }
    }

  // The lots: bays in a car park, a step before each street door.
  district.lots.forEach((l) => {
    if (l.use === 'parking') {
      c.fillStyle = FAINT;
      for (let z = l.z0; z <= l.z1; z++) {
        // (Two rows of bays nose to nose, then a lane to drive down.)
        if ((z - l.z0) % 3 === 2) continue;
        for (let x = l.x0; x <= l.x1 + 1; x++) c.fillRect(x * R - 1, z * R + 1, 1, R - 2);
        if ((z - l.z0) % 3 === 0) c.fillRect(l.x0 * R, (z + 1) * R - 1, (l.x1 - l.x0 + 1) * R, 1);
      }
    }
    for (const door of l.doors) {
      const x = door % MAP_W;
      const z = Math.floor(door / MAP_W);
      for (const [dx, dz] of [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ]) {
        const k = kind(x + dx, z + dz);
        if (
          district.lotAt[(z + dz) * MAP_W + x + dx] === district.lotAt[door] ||
          (k !== TILE.ASPHALT && k !== TILE.ROAD && k !== TILE.GRASS)
        )
          continue;
        c.fillStyle = 'rgba(206, 202, 192, 0.85)';
        const w = R - 4;
        if (dz) c.fillRect(x * R + 2, dz > 0 ? (z + 1) * R : z * R - 4, w, 4);
        else c.fillRect(dx > 0 ? (x + 1) * R : x * R - 4, z * R + 2, 4, w);
        c.fillStyle = 'rgba(60, 56, 50, 0.5)';
        if (dz) c.fillRect(x * R + 2, dz > 0 ? (z + 1) * R + 3 : z * R - 4, w, 1);
        else c.fillRect(dx > 0 ? (x + 1) * R + 3 : x * R - 4, z * R + 2, 1, w);
        // (2.64: a doormat in the doorway itself, in a colour no floor is: the step outside lies under the awning from this camera,
        // and a door read as one more gap in the wall.)
        const m = Math.round(R * 0.16);
        c.fillStyle = 'rgba(60, 40, 22, 0.85)';
        c.fillRect(x * R + m, z * R + m, R - 2 * m, R - 2 * m);
        c.fillStyle = 'rgba(204, 152, 64, 0.95)';
        c.fillRect(x * R + m + 1, z * R + m + 1, R - 2 * m - 2, R - 2 * m - 2);
        break;
      }
    }
  });
  return true;
}
