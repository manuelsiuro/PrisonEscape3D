# Standalone Procedural 3D Model Library

A standalone, modular TypeScript library for code-defined 3D low-poly models styled with baked vertex colors. Designed for high performance, portability across WebGL engines (Three.js, Babylon.js, Godot, Blender via OBJ), and seamless dual compilation.

---

## 1. Architectural Principles & Low-Polygon First Mandate

> [!IMPORTANT]
> **Mandatory Rule: Low-Polygon First**
> All procedural models in this library MUST prioritize minimal polygon counts. Clean low-poly geometry renders orders of magnitude faster on mobile, uses less memory, exports instantly, and yields the charming, crisp, stylized retro aesthetic characteristic of modern indie games.

### Segment Count Standards

| Primitive Element                                             | Recommended Segments | Rationale                                                                                 |
| ------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| **Micro-details** (screws, rivets, needles, LEDs, bolt heads) | **4 to 6**           | A 4-sided diamond cylinder is only 8-12 triangles and produces clean specular highlights. |
| **Pipes & Rods** (conduits, rails, handles, cables, antennas) | **6**                | Hexagonal profile is visually round under smooth/flat shading, costing only 24 triangles. |
| **Standard Cylinders** (mugs, cups, wheels, barrels, dials)   | **6 to 8**           | Octagonal profile is perfectly sufficient for props and mechanical parts.                 |
| **Large Hero Curves** (silos, water tanks, satellite dishes)  | **8 to 10**          | Hard ceiling for any curved surface.                                                      |
| **Forbidden**                                                 | **16, 24, 32+**      | Never use high-poly subdivision on procedural game models.                                |

### Polygon Budget Tiers

| Tier                            | Triangle Budget    | Typical Use Cases                                                       |
| ------------------------------- | ------------------ | ----------------------------------------------------------------------- |
| **Micro / Small Prop**          | `< 300 tris`       | Small tools, items, handheld devices, arcade machines, small furniture. |
| **Standard Fixture**            | `300 – 700 tris`   | Surveillance cameras, welding carts, siren towers, dishes, appliances.  |
| **Complex Machinery / Vehicle** | `700 – 1,100 tris` | Forklifts, diesel generators, espresso stations with counter cabinets.  |
| **Hard Ceiling**                | `1,400 tris max`   | Enforced automatically by `validateBlueprint()` in `compile.ts`.        |

---

## 2. Directory Layout

```
model-library/
├── types.ts          # Core type contracts (ModelBlueprint, PartLayerSpec, ParamControl, etc.)
├── kit.ts            # Primitive geometry generators (box, rotBox, cyl, frustum, tube, cone, mirror, merge)
├── compile.ts        # Blueprint compiler & validator (compileModel, mergedGeometry, validateBlueprint)
├── export.ts         # Wavefront .OBJ exporter with vertex RGB colors
├── index.ts          # Public entrypoint & model catalog registry
└── models/           # Code-defined model blueprints
    ├── arcadeCabinet.ts         # Retro coin-op arcade cabinet (lib:arcade_cabinet · 196 tris)
    ├── guardBooth.ts            # Modular security checkpoint booth (lib:guard_booth_modular · 208 tris)
    ├── industrialForklift.ts    # Warehouse forklift with mast & carriage (lib:industrial_forklift · 452 tris)
    ├── waterTower.ts            # Elevated municipal water storage tower (lib:water_tower · 488 tris)
    ├── satelliteDish.ts         # Rooftop parabolic uplink antenna (lib:satellite_dish · 500 tris)
    ├── weldingRig.ts            # Mobile oxy-acetylene welding cart (lib:welding_rig · 620 tris)
    ├── sirenTower.ts            # Perimeter siren & floodlight mast (lib:siren_tower · 684 tris)
    ├── surveillanceCamera.ts    # Motorized PTZ pan-tilt camera (lib:surveillance_camera · 708 tris)
    ├── dieselGenerator.ts       # Heavy-duty backup generator (lib:diesel_generator · 1,048 tris)
    └── espressoMachine.ts       # Twin-group commercial espresso station (lib:espresso_machine · 1,204 tris)
```

---

## 3. Catalog of Procedural Models

All 10 models in the library follow the Low-Polygon First standard:

| Model ID                  | Name                        | Category     | Tris  | Features & Parameters                                                        |
| ------------------------- | --------------------------- | ------------ | :---: | ---------------------------------------------------------------------------- |
| `lib:arcade_cabinet`      | Retro Arcade Cabinet        | Props        |  196  | CRT screen, marquee glow, joystick, 6 buttons, animated game scene.          |
| `lib:guard_booth_modular` | Modular Guard Booth         | Architecture |  208  | Tinted windows, searchlight, desk console, boom gate barrier.                |
| `lib:industrial_forklift` | Warehouse Forklift          | Vehicles     |  452  | Mast, carriage, dual forks, overhead guard, steer axle, headlights.          |
| `lib:water_tower`         | Timber Water Tower          | Architecture |  488  | 4-legged timber trestle, iron hoops, conical shingle roof, drain pipe.       |
| `lib:satellite_dish`      | Rooftop Satellite Dish      | Fixtures     |  500  | Ballast tripod mount, 8-faceted dish, LNB feedhorn, azimuth tracking.        |
| `lib:welding_rig`         | Mobile Welding Rig          | Props        |  620  | Steel hand truck, oxygen & acetylene cylinders, regulators, cutting torch.   |
| `lib:siren_tower`         | Perimeter Siren Mast        | Fixtures     |  684  | Lattice tower, platform, twin megaphone horns, floodlight, rotating beacon.  |
| `lib:surveillance_camera` | Motorized PTZ Camera        | Fixtures     |  708  | Wall bracket, pan yoke, tilt barrel, sun hood, optical lens, 8 IR LEDs.      |
| `lib:diesel_generator`    | Heavy Diesel Generator      | Fixtures     | 1,048 | Steel skid, acoustic canopy, radiator fan, louver intake, bouncing rain cap. |
| `lib:espresso_machine`    | Commercial Espresso Station | Props        | 1,204 | Brushed hood, dual brew groups, cups with crema, steam wand, pedestal.       |

---

## 4. Core API Reference

### Geometry Kit (`kit.ts`)

| Function                                       | Default Segments | Description                                                  |
| ---------------------------------------------- | :--------------: | ------------------------------------------------------------ |
| `paint(geo, hex)`                              |        -         | Fills a geometry's `color` attribute with a hex color.       |
| `box(w, h, d, hex, [x, y, z])`                 |        -         | Creates a colored axis-aligned box (12 triangles).           |
| `rotBox(w, h, d, hex, x, y, z, [rx, ry, rz])`  |        -         | Creates a rotated and translated box.                        |
| `cyl(r, h, hex, [x, y, z], [seg])`             |        8         | Vertical cylinder centered on Y.                             |
| `frustum(rT, rB, h, hex, [x, y, z], [seg])`    |        8         | Truncated cone / tapered cylinder.                           |
| `cone(r, h, hex, [x, y, z], [seg])`            |        8         | Upright conical prism.                                       |
| `rod(r, h, hex, [x, y, z], [seg])`             |        6         | Horizontal cylinder along X axis.                            |
| `tubeZ(r, len, hex, [x, y, z], [seg])`         |        6         | Cylinder along Z axis.                                       |
| `disc(r, thick, hex, [x, y, z], [seg])`        |        8         | Circular disc / flat dial plate.                             |
| `ring(r, tube, hex, [x, y, z], [axis], [seg])` |        8         | Torus ring with 4-sided rhombus tube profile.                |
| `wedge(w, h, d, hex, [x, y, z], [low])`        |        -         | Right-triangular prism wedge (ramps, chamfers).              |
| `mirrorX(fn)`                                  |        -         | Duplicates geometries across the X axis.                     |
| `mirrorXZ(fn)`                                 |        -         | Quad-mirrors geometries across X and Z axes (4 legs/wheels). |
| `merge(parts, [shade], [footY])`               |        -         | Merges geometries into one with baked foot occlusion.        |

### Compilation & Export (`compile.ts`, `export.ts`)

```typescript
import { compileModel, mergedGeometry, exportObj, getModelBlueprint } from 'model-library';

// 1. Get blueprint
const bp = getModelBlueprint('lib:satellite_dish')!;

// 2. Articulated model for viewer / cutscenes
const compiled = compileModel(bp, { tracking: true, elevationAngle: 'mid' });
scene.add(compiled.root);

// Render loop:
compiled.animate?.(clock.getElapsedTime(), { night: 0, power: 1 });

// Cleanup:
compiled.dispose();

// 3. Merged single-draw-call geometry for InstancedMesh
const singleGeo = mergedGeometry(bp);
const instancedMesh = new THREE.InstancedMesh(singleGeo, kitMaterial, 500);

// 4. Wavefront OBJ Export
const objSource = exportObj(compiled.root, 'satellite_dish');
```

---

## 5. Verification & Testing

Every blueprint in `MODEL_LIBRARY` is automatically verified by [`scripts/mapviewertest.ts`](file:///Users/manuel.siuro/ClaudeProjects/PrisonEscape3D/scripts/mapviewertest.ts):

- Blueprint schema validation (`validateBlueprint`)
- Low-poly budget enforcement (`<= 1,400` triangles ceiling)
- Full geometry compilation (`compileModel`) and vertex count checks
- Memory leak and disposal validation (`dispose()`)
- Single-draw-call merge integrity (`mergedGeometry`)
- Wavefront `.OBJ` export validity (`exportObj`)
