/** Pieces the prisons' layouts share. */
import type { PropPlacement } from '../props';
import type { Rect } from './types';

/**
 * A 4×4 cell whose door is in a side wall (Shankton's and San Pancho's wings): its rectangle
 * into `cells`, and its bed, desk, toilet and chair into `props`, in that order (prop order
 * numbers the containers and seats saves keep). `doorEast`: the bed against the west wall,
 * the desk and toilet by the east one; else the other way round.
 */
export function sideCell(cells: Rect[], props: PropPlacement[], x0: number, z0: number, doorEast: boolean) {
  cells.push([x0, z0, x0 + 3, z0 + 3]);
  props.push(
    ...(doorEast
      ? [
          { kind: 'bed', x: x0, z: z0, d: 2 },
          { kind: 'desk', x: x0 + 3, z: z0, rot: 3 },
          { kind: 'toilet', x: x0 + 3, z: z0 + 3, rot: 3 },
          { kind: 'chair', x: x0 + 2, z: z0, rot: 1 },
        ]
      : [
          { kind: 'bed', x: x0 + 3, z: z0, d: 2 },
          { kind: 'desk', x: x0, z: z0, rot: 1 },
          { kind: 'toilet', x: x0, z: z0 + 3, rot: 1 },
          { kind: 'chair', x: x0 + 1, z: z0, rot: 3 },
        ]) as PropPlacement[],
  );
}
