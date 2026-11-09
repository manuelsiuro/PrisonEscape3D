/**
 * Prison Escape 3D - Procedural Model Library
 *
 * Standalone, code-defined 3D low-poly model library.
 * Models are pure TypeScript blueprints composed of vertex-colored geometric primitives,
 * compilable to articulated multi-part Three.js rigs or single-draw-call merged BufferGeometries.
 */

export * from './types';
export * from './palette';
export * from './kit';
export * from './compile';
export * from './export';

import { guardBoothBlueprint } from './models/guardBooth';
import { industrialForkliftBlueprint } from './models/industrialForklift';
import { arcadeCabinetBlueprint } from './models/arcadeCabinet';
import { waterTowerBlueprint } from './models/waterTower';
import { espressoMachineBlueprint } from './models/espressoMachine';
import { surveillanceCameraBlueprint } from './models/surveillanceCamera';
import { dieselGeneratorBlueprint } from './models/dieselGenerator';
import { weldingRigBlueprint } from './models/weldingRig';
import { sirenTowerBlueprint } from './models/sirenTower';
import { satelliteDishBlueprint } from './models/satelliteDish';
import { canteenTraysBlueprint } from './models/canteenTrays';
import { securityTurnstileBlueprint } from './models/securityTurnstile';
import { storageLockerBlueprint } from './models/storageLocker';

// The weathered city set
import { abandonedPatrolCarBlueprint } from './models/abandonedPatrolCar';
import { survivorWorkbenchBlueprint } from './models/survivorWorkbench';
import { decayedBusStopBlueprint } from './models/decayedBusStop';
import { floodlightTrailerBlueprint } from './models/floodlightTrailer';
import { rainwaterRigBlueprint } from './models/rainwaterRig';
import { overgrownKioskBlueprint } from './models/overgrownKiosk';
import { triageTentBlueprint } from './models/triageTent';

import type { ModelBlueprint } from './types';

export {
  guardBoothBlueprint,
  industrialForkliftBlueprint,
  arcadeCabinetBlueprint,
  waterTowerBlueprint,
  espressoMachineBlueprint,
  surveillanceCameraBlueprint,
  dieselGeneratorBlueprint,
  weldingRigBlueprint,
  sirenTowerBlueprint,
  satelliteDishBlueprint,
  canteenTraysBlueprint,
  securityTurnstileBlueprint,
  storageLockerBlueprint,
  // The weathered city set
  abandonedPatrolCarBlueprint,
  survivorWorkbenchBlueprint,
  decayedBusStopBlueprint,
  floodlightTrailerBlueprint,
  rainwaterRigBlueprint,
  overgrownKioskBlueprint,
  triageTentBlueprint,
};

/** All registered models in the standalone model library. */
export const MODEL_LIBRARY: readonly ModelBlueprint[] = [
  guardBoothBlueprint,
  industrialForkliftBlueprint,
  arcadeCabinetBlueprint,
  waterTowerBlueprint,
  espressoMachineBlueprint,
  surveillanceCameraBlueprint,
  dieselGeneratorBlueprint,
  weldingRigBlueprint,
  sirenTowerBlueprint,
  satelliteDishBlueprint,
  canteenTraysBlueprint,
  securityTurnstileBlueprint,
  storageLockerBlueprint,
  // The weathered city set
  abandonedPatrolCarBlueprint,
  survivorWorkbenchBlueprint,
  decayedBusStopBlueprint,
  floodlightTrailerBlueprint,
  rainwaterRigBlueprint,
  overgrownKioskBlueprint,
  triageTentBlueprint,
] as const;

/** Map of model blueprints keyed by `id`. */
export const MODEL_LIBRARY_MAP = new Map<string, ModelBlueprint>(MODEL_LIBRARY.map((bp) => [bp.id, bp]));

/** Look up a blueprint by ID. */
export function getModelBlueprint(id: string): ModelBlueprint | undefined {
  return MODEL_LIBRARY_MAP.get(id);
}
