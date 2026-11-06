/**
 * The dark (2.35, the user's pick: the dark hides the player). At night a guard sees the player only
 * DARK_SIGHT tiles off, except along lit tiles: the rooms' ceiling lights (the cell block's out at Lights
 * Out, past the walk home) and the street lamps' pools, with the power on. What the 3D draws lit is lit
 * here: the same zones (content/zones.ts OPEN_AIR, CELL_BLOCK) and the lamps' pools. Pure, integer
 * math; the cones (render/Cones.ts) cut their rays with the same samples, so what's drawn is the rule.
 */
import { CELL_BLOCK, OPEN_AIR, ZONES } from '../../content/zones';
import { DARK_SIGHT, LAMP_LIT, NIGHT_FROM, NIGHT_TO, UNIT } from '../tuning';
import { isqrt } from '../hunt/common';
import { TILE_INFO } from '../world/tiles';
import { MAP_H, MAP_W, type World } from '../world/World';

/** What lights the prison now: false when it's day (everything lit). */
export interface Dark {
  /** The lamps and room lights have power. */
  power: boolean;
  /** The cell block's lights are out (Lights Out, past the walk home, no lockdown). */
  blockDark: boolean;
}

/** The hours drawn dark (render/viewLight.ts DAYLIGHT: the sun at its lowest). */
export const nightAt = (minuteOfDay: number) => minuteOfDay >= NIGHT_FROM || minuteOfDay < NIGHT_TO;

/** Per ground tile: 1 a room with ceiling lights, 2 in the cell block, 4 in a lamp's pool. */
const ROOM = 1;
const BLOCK = 2;
const LAMP = 4;
const masks = new WeakMap<World, Uint8Array>();

/** A lamp head's offset from its pole (hundredths of a tile; the 3D's LAMP_ARM, 0.42), by its aim in eighth turns. */
const ARM: ReadonlyArray<readonly [number, number]> = [
  [0, 42],
  [30, 30],
  [42, 0],
  [30, -30],
  [0, -42],
  [-30, -30],
  [-42, 0],
  [-30, 30],
];

function maskOf(w: World): Uint8Array {
  let m = masks.get(w);
  if (m) return m;
  m = new Uint8Array(MAP_W * MAP_H);
  // (Indoors only: a walkway, a dock or a minefield is open sky, whatever its zone. Read off the map as built
  // (`base`), never its tiles now: a hole dug there would make the mask depend on when it was first asked for.)
  for (let i = 0; i < m.length; i++) {
    const zone = ZONES[w.ground.zone[i]];
    if (!OPEN_AIR.has(zone) && !TILE_INFO[w.ground.base[i]].outdoor) m[i] |= CELL_BLOCK.has(zone) ? BLOCK : ROOM;
  }
  // The pools: under the head of a lamp with one, round the pole of a lamp with two (as render/lights.ts draws them).
  for (const p of w.props) {
    if (p.kind !== 'lamp') continue;
    const [ax, az] = p.heads === 2 ? [0, 0] : ARM[((p.aim % 8) + 8) % 8];
    const cx = p.x * 100 + 50 + ax;
    const cz = p.z * 100 + 50 + az;
    const r = Math.ceil(LAMP_LIT / 100);
    for (let z = p.z - r; z <= p.z + r; z++)
      for (let x = p.x - r; x <= p.x + r; x++) {
        if (x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) continue;
        if ((x * 100 + 50 - cx) ** 2 + (z * 100 + 50 - cz) ** 2 <= LAMP_LIT * LAMP_LIT) m[z * MAP_W + x] |= LAMP;
      }
  }
  masks.set(w, m);
  return m;
}

/** Whether a tile is lit at night: off the ground floor (a roof), only a lamp's pool. */
export function litTile(w: World, dark: Dark, x: number, z: number, ground = true): boolean {
  if (!dark.power || x < 0 || z < 0 || x >= MAP_W || z >= MAP_H) return false;
  const m = maskOf(w)[z * MAP_W + x];
  if (m & LAMP) return true;
  if (!ground) return false;
  return !!(m & ROOM) || (!!(m & BLOCK) && !dark.blockDark);
}

/** Samples a quarter of a tile apart along a line (units). */
const STEP = UNIT / 4;

/**
 * Whether a guard at (ax, az) sees as far as (bx, bz) in the dark: within DARK_SIGHT always (the cone and
 * the walls permitting); beyond it, only if every sample from DARK_SIGHT out to the target, a quarter tile
 * apart, is on a lit tile (the cone's rays take the same samples: `darkReach`).
 */
export function seesInDark(w: World, dark: Dark, ax: number, az: number, bx: number, bz: number, ground = true): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const d = isqrt(dx * dx + dz * dz);
  const near = DARK_SIGHT * UNIT;
  if (d <= near) return true;
  for (let t = near; t <= d; t += STEP)
    if (!litTile(w, dark, Math.floor((ax + Math.trunc((dx * t) / d)) / UNIT), Math.floor((az + Math.trunc((dz * t) / d)) / UNIT), ground))
      return false;
  return true;
}

/**
 * How far a ray from a guard reaches in the dark (tiles), as `seesInDark` rules: `reach` (walls) at most;
 * past DARK_SIGHT, to the first sample off a lit tile. The cones draw this (render, floats are fine there).
 */
export function darkReach(w: World, dark: Dark, x: number, z: number, angle: number, reach: number, ground = true): number {
  if (reach <= DARK_SIGHT) return reach;
  const cx = Math.cos(angle);
  const sz = Math.sin(angle);
  for (let t = DARK_SIGHT; t <= reach; t += 0.25) if (!litTile(w, dark, Math.floor(x + cx * t), Math.floor(z + sz * t), ground)) return t;
  return reach;
}
