import { mix32 } from '../../sim/rng';
import type { District, Lot } from '../gen/district';
import type { LotUse } from './districts';
import { WINDOWED } from './light';

/** What a building's walls are made of, by what it is (the picture's materials; the rules read where its panes fall). */
export type Style = 'siding' | 'stucco' | 'metal' | 'panel';
export const FACE_STYLE: Partial<Record<LotUse, Style>> = {
  house: 'siding',
  shop: 'stucco',
  office: 'panel',
  warehouse: 'metal',
  garage: 'metal',
  clinic: 'stucco',
  station: 'metal',
  tower: 'panel',
  factory: 'metal',
  hospital: 'stucco',
  boathouse: 'siding',
  rangers: 'siding',
  mall: 'stucco',
  police: 'panel',
  metro: 'panel',
};

/**
 * Where a building's windows are (2.61): the panes of its south, east and west faces (the north one is
 * never seen from this camera), corners kept clear. Pure, so the picture (`render/facades.ts`) and the
 * rules (a chained building's pane broken, `sim/tools.ts`) read the same list.
 */
export interface Pane {
  /** The wall tile it is in; its place along its face (from the lot's corner); its turn (0: south, ±π/2: east, west). */
  x: number;
  z: number;
  n: number;
  angle: number;
  /** On the front (south) face. */
  front: boolean;
  /** What fills it (glass, a band of an office's glass, boards nailed over, a shutter), and its own number (for its details). */
  look: 'glass' | 'band' | 'boards' | 'shutter';
  h: number;
}

/** A building's own number, from its place: its colours and its windows' choices. */
export const lotHash = (district: District, l: Lot) =>
  mix32(Math.imul(l.x0 + 1, 73856093) ^ Math.imul(l.z0 + 1, 19349663) ^ Math.imul(district.index + 1, 83492791));

/** A pane every so many tiles of a face: an office's glass runs all along (where it isn't one the daylight comes into); a shed's is one in three. */
export function paneEvery(style: Style, light: boolean): number {
  return style === 'panel' && !light ? 1 : style === 'metal' ? 3 : 2;
}

/** The panes of a building of this district (none for what has no walls of its own). */
export function lotPanes(district: District, lot: number): Pane[] {
  const use = district.lots[lot]?.use;
  const style = use && FACE_STYLE[use];
  return style ? panesOf(district, lot, style, WINDOWED.includes(use)) : [];
}

/**
 * The panes of a lot's faces, in the order they are drawn: a house's are glass (the daylight comes in), an office's a band of glass
 * with one in six boarded, a shed's glass, a shop's and a clinic's boarded or shuttered.
 */
function panesOf(district: District, lot: number, style: Style, light: boolean): Pane[] {
  const l = district.lots[lot];
  const every = paneEvery(style, light);
  const lh = lotHash(district, l);
  const out: Pane[] = [];
  const wallAt = (x: number, z: number) => district.rows[z]?.[x] === '#';
  const face = (x: number, z: number, n: number, angle: number, front: boolean) => {
    if (!wallAt(x, z) || (every !== 1 && n % every !== 1)) return;
    const h = mix32(lh ^ Math.imul(x * 64 + z + 1, 0x9e3779b1));
    const look: Pane['look'] =
      style === 'panel' && !light ? (h % 6 ? 'band' : 'boards') : light || style === 'metal' ? 'glass' : h & 8 ? 'boards' : 'shutter';
    out.push({ x, z, n, angle, front, look, h });
  };
  for (let x = l.x0 + 1; x < l.x1; x++) face(x, l.z1, x - l.x0, 0, true);
  for (let z = l.z0 + 1; z < l.z1; z++) {
    face(l.x1, z, z - l.z0, Math.PI / 2, false);
    face(l.x0, z, z - l.z0, -Math.PI / 2, false);
  }
  return out;
}
