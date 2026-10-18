import type { PropPlacement } from '../../props';
import type { PrisonDef } from '../types';
import { TRAINING_DECOR } from './decor';
import { L0 } from './L0.map';

const props: PropPlacement[] = [
  // Cell 1 (the player's) and cell 2 (the sparring partner's): bed, desk, toilet, chair.
  ...[19, 24].flatMap((x0) => [
    { kind: 'bed', x: x0, z: 17, d: 2 } as const,
    { kind: 'desk', x: x0 + 3, z: 17, rot: 3 } as const,
    { kind: 'toilet', x: x0 + 3, z: 20, rot: 3 } as const,
  ]),
  // Store room: a workbench and a shelf.
  { kind: 'workbench', x: 30, z: 17, w: 2 },
  { kind: 'shelf', x: 35, z: 17, w: 3 },
  // Generator room.
  { kind: 'generator', x: 41, z: 18, w: 2, d: 2 },
  // Common room: a table with a bench either side, as in a canteen.
  { kind: 'table', x: 21, z: 29, w: 3 },
  { kind: 'seat', x: 21, z: 28, w: 3 },
  { kind: 'seat', x: 21, z: 30, w: 3, rot: 2 },
  // Patrol hall: the weights.
  { kind: 'weights', x: 34, z: 33 },
  // Lamps by the yard and the gate.
  ...[
    [18, 36],
    [31, 36],
    [29, 50],
    [34, 50],
  ].map(([x, z]) => ({ kind: 'lamp', x, z }) as const),
  // Chairs at each desk.
  { kind: 'chair', x: 21, z: 17, rot: 1 },
  { kind: 'chair', x: 26, z: 17, rot: 1 },
];

/**
 * The Training Block (P8+): where the tutorial's lessons are played. One inmate to spar with,
 * one guard walking the patrol hall (its walls keep the other lessons out of its sight) with
 * his dog, no jobs, no merchants, no cameras or towers. What it hasn't got (merchants, the
 * day's events, smuggling, the delivery, the checkpoint) is taught at Center Perks.
 */
export const TRAINING: PrisonDef = {
  id: 'training',
  difficulty: 0,
  ground: L0,
  zones: [
    // Inside the fence: the yard (the building's rooms win over it).
    ['yard', 15, 13, 48, 51],
    ['corridor', 19, 22, 44, 24],
    ['woodshop', 29, 17, 38, 21],
    ['generator', 40, 17, 44, 20],
    ['canteen', 19, 26, 30, 34],
    ['canteen', 24, 25, 25, 25],
    ['gym', 32, 25, 44, 33],
    ['rollCall', 19, 37, 30, 44],
  ],
  cells: [
    [19, 17, 22, 20],
    [24, 17, 27, 20],
  ],
  props,
  decor: TRAINING_DECOR,
  rollCall: [
    { x: 22, z: 40 },
    { x: 27, z: 40 },
  ],
  spawn: { x: 20, z: 19 },
  reachable: ['corridor', 'woodshop', 'canteen', 'gym', 'rollCall', 'yard'],
  guards: [
    {
      name: 'Bell',
      beat: [
        { x: 33, z: 27, wait: 2, face: 1 },
        { x: 43, z: 27, wait: 2, face: 5 },
        { x: 43, z: 32, wait: 2, face: 9 },
        { x: 33, z: 32, wait: 2, face: 13 },
      ],
      night: [
        { x: 33, z: 27, wait: 3, face: 1 },
        { x: 43, z: 32, wait: 3, face: 9 },
      ],
      key: 'red',
      // His dog (P19), for the Guard dogs lesson: in its kennel in the hall's north-east corner (a tile clear of his round, in plain view) on the first day, as every dog is.
      dog: { name: 'Biscuit', kennel: { x: 44, z: 26, face: 9 }, coat: 'collie' },
    },
  ],
  names: ['Sparky'],
  merchants: [],
  crew: ['lookout'],
  jobs: [],
  // Lessons, not a sentence: missed blocks cost nothing, no searches, and contraband in sight
  // raises the heat at a quarter of the pace (time to read what to do about it).
  rules: { relaxed: true, contrabandEvery: 4 },
  escapes: ['fence'],
};
