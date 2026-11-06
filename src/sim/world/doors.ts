import { KEY } from './tiles';

/**
 * Whether a door is open for inmates right now. Yellow doors (cells, gym, showers…) stand
 * open, except a cell's door while its cell is locked (Lights Out and lockdowns: the
 * routine decides which, see Sim). Every other color stays shut until keys arrive (P5).
 * `cell` is the cell the door serves (0 for any other door); `lockedCells` has bit c set
 * while cell c is locked.
 */
export function doorOpen(key: number, cell: number, lockedCells: bigint): boolean {
  if (key !== KEY.YELLOW) return false;
  return cell === 0 || ((lockedCells >> BigInt(cell)) & 1n) === 0n;
}
