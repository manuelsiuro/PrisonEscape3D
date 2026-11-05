import * as THREE from 'three';
import type { BedPose } from './Character';
import { BED_FEET, BED_TOP } from './Character';
import { part } from './characterParts';
import { kitMaterial, merge } from './kit';

/**
 * The bed dummy (GDD §5.3) in the player's bed: two pillows under the blanket and a head of soap and real
 * hair, laid where a sleeper lies. Seen from the door it passes for someone; so it does from the camera (2.28).
 */
export function bedDummyMesh(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    merge(
      [
        // The blanket as a sleeper's, humped over the pillows; then the head on the pillow, hair at its back.
        part(0.64, 0.08, 0.92, 0x6f8fb5, 0, 0.19, -0.42),
        part(0.66, 0.09, 0.14, 0xe6ebf2, 0, 0.2, -0.9),
        part(0.42, 0.1, 0.7, 0x6f8fb5, 0, 0.26, -0.42),
        part(0.26, 0.2, 0.22, 0xe2c9a4, 0, 0.16, -1.06),
        part(0.28, 0.22, 0.1, 0x3a2a1c, 0, 0.17, -1.21),
      ],
      false,
    ),
    kitMaterial,
  );
  mesh.castShadow = true;
  mesh.visible = false;
  return mesh;
}

/** Where a sleeper's root would be in this bed. */
export function placeInBed(mesh: THREE.Object3D, bed: BedPose) {
  mesh.position.set(bed.x + Math.sin(bed.angle) * BED_FEET, BED_TOP, bed.z + Math.cos(bed.angle) * BED_FEET);
  mesh.rotation.y = bed.angle;
}
