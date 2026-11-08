# Standalone Procedural 3D Model Library

A standalone, modular TypeScript library for code-defined 3D low-poly models styled with baked vertex colors. Designed for high performance, portability across WebGL engines (Three.js, Babylon.js, Godot, Blender via OBJ), and seamless dual compilation.

For the full visual design, geometry rules, and color specifications, see [`STYLEGUIDE.md`](file:///Users/manuel.siuro/ClaudeProjects/PrisonEscape3D/model-library/STYLEGUIDE.md).

---

## 1. Architectural Principles: Low-Polygon & Color Palette Discipline

> [!IMPORTANT]
> **Mandatory Rule 1: Low-Polygon First**
> All procedural models in this library MUST prioritize minimal polygon counts. Clean low-poly geometry renders orders of magnitude faster on mobile browsers, uses negligible memory, exports instantly, and yields the charming, crisp, stylized retro aesthetic characteristic of Prison Escape 3D.

> [!IMPORTANT]
> **Mandatory Rule 2: Palette Discipline (The 3-to-5 Color Rule)**
> Every procedural model MUST use between 2 and 5 cohesive colors selected strictly from [`palette.ts`](file:///Users/manuel.siuro/ClaudeProjects/PrisonEscape3D/model-library/palette.ts). Arbitrary or oversaturated rainbow palettes are strictly forbidden. Use 1 primary structural color, 1 framing/recess color, 1 surface/detail color, and at most 1 functional accent (e.g. brass, red, green).

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
├── palette.ts        # Centralized institutional/game color palette (PALETTE) matching props.ts
├── STYLEGUIDE.md     # Comprehensive 3D art guide: low-poly rules, budgets, and palette discipline
├── kit.ts            # Primitive geometry generators (box, rotBox, cyl, frustum, tube, cone, mirror, merge)
├── compile.ts        # Blueprint compiler & validator (compileModel, mergedGeometry, validateBlueprint)
├── export.ts         # Wavefront .OBJ exporter with vertex RGB colors
├── index.ts          # Public entrypoint & model catalog registry
└── models/           # Code-defined model blueprints
    ├── arcadeCabinet.ts         # Retro coin-op arcade cabinet (lib:arcade_cabinet · 196 tris)
    ├── guardBooth.ts            # Modular security checkpoint booth (lib:guard_booth_modular · 208 tris)
    ├── storageLocker.ts         # Institutional metal storage locker (lib:storage_locker · 216 tris)
    ├── securityTurnstile.ts     # Checkpoint turnstile with rotor (lib:security_turnstile · 264 tris)
    ├── canteenTrays.ts          # Canteen tray dispenser cart (lib:canteen_trays · 312 tris)
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

All 23 models in the library strictly adhere to the Low-Polygon First and 3-to-5 Color Palette standards:

| Model ID                  | Name                        | Category     | Tris  | Palette Colors Used | Features & Parameters |
| ------------------------- | --------------------------- | ------------ | :---: | :---: | --------------------- |
| `lib:arcade_cabinet`      | Retro Arcade Cabinet        | Props        |  196  | 4 (dark, blue, red, cream) | CRT screen, marquee glow, joystick, 6 buttons, animated game scene. |
| `lib:overgrown_kiosk`     | Reclaimed Street Newsstand  | Architecture |  192  | 5 (dark, wood, rust, concrete, green) | Boarded counter, peeling posters, corrugated roof, cascading ivy. |
| `lib:guard_booth_modular` | Modular Guard Booth         | Architecture |  208  | 4 (metal, dark, white, blue) | Tinted windows, searchlight, desk console, boom gate barrier. |
| `lib:storage_locker`      | Institutional Double Locker | Props        |  216  | 4 (grey, dark, chrome, brass) | Louvered vent slats, chrome latch, brass number plates, padlock. |
| `lib:security_turnstile`  | Security Checkpoint Gate    | Fixtures     |  228  | 4 (steel, dark, chrome, green) | Stainless housing, card scanner pad, access LED, 3-arm revolving rotor. |
| `lib:cordyceps_growth`    | Cordyceps Fungal Colony     | Props        |  288  | 5 (dark, concrete, rust, amber, wood) | Bracket shelf mushrooms, spore tendrils, bioluminescent spore pods. |
| `lib:fedra_gate`          | FEDRA Quarantine Zone Gate  | Architecture |  292  | 5 (concrete, dark, rust, olive, yellow)| Jersey barriers, sandbags, razor wire, searchlight, hinged gate. |
| `lib:canteen_trays`       | Canteen Tray Dispenser Cart | Props        |  312  | 4 (steel, dark, blue, chrome) | Tubular cart, casters, molded meal tray stack, hanging cutlery bin. |
| `lib:decayed_bus_stop`    | Weathered Municipal Shelter | Architecture |  336  | 5 (concrete, dark, rust, green, olive) | Cantilevered canopy, cracked slab weeds, bench, scavenged rucksack. |
| `lib:firefly_barricade`   | Improvised Rebel Barricade  | Fixtures     |  360  | 5 (woodDark, wood, rust, sand, white)  | Cargo pallets, sandbags, welded rebar caltrop spikes, Firefly symbol. |
| `lib:qzone_floodlight`    | QZ Floodlight Generator Cart| Fixtures     |  364  | 5 (dark, olive, black, steel, yellow)  | Towable trailer, diesel genset, telescoping mast, twin halogen lamps. |
| `lib:triage_tent`         | Quarantine Medical Tent     | Architecture |  412  | 5 (olive, steel, white, red, tarpBlue) | Canvas tent, red cross stencil, rolled flap, field cot, IV drip pole. |
| `lib:abandoned_patrol_car`| Overgrown Derelict Cruiser  | Vehicles     |  416  | 5 (white, dark, rust, green, blue)     | Deflated rims, lightbar, open door, climbing ivy on hood and bumper. |
| `lib:survivor_workbench`  | Weapon Crafting Workbench   | Props        |  420  | 5 (wood, woodDark, dark, chrome, olive)| Heavy timber bench, vise, articulated clamp lamp, gun parts, duct tape. |
| `lib:industrial_forklift` | Warehouse Forklift          | Vehicles     |  452  | 4 (yellow, dark, black, steel) | Mast, carriage, dual forks, overhead guard, steer axle, headlights. |
| `lib:water_tower`         | Timber Water Tower          | Architecture |  488  | 3 (wood, iron, rust) | 4-legged timber trestle, iron hoops, conical shingle roof, drain pipe. |
| `lib:satellite_dish`      | Rooftop Satellite Dish      | Fixtures     |  500  | 4 (steel, dark, chrome, white) | Ballast tripod mount, 8-faceted dish, LNB feedhorn, azimuth tracking. |
| `lib:rainwater_rig`       | Rooftop Catchment Rig       | Props        |  500  | 5 (woodDark, tarpBlue, steel, white, olive)| 200L blue drums, corrugated funnel, PVC pipes, filter bucket, tarp. |
| `lib:welding_rig`         | Mobile Welding Rig          | Props        |  620  | 5 (dark, green, red, chrome, brass) | Steel hand truck, oxygen & acetylene cylinders, regulators, cutting torch. |
| `lib:siren_tower`         | Perimeter Siren Mast        | Fixtures     |  684  | 4 (metal, dark, yellow, chrome) | Lattice tower, platform, twin megaphone horns, floodlight, rotating beacon. |
| `lib:surveillance_camera` | Motorized PTZ Camera        | Fixtures     |  708  | 4 (white, dark, black, red) | Wall bracket, pan yoke, tilt barrel, sun hood, optical lens, 8 IR LEDs. |
| `lib:diesel_generator`    | Heavy Diesel Generator      | Fixtures     | 1,048 | 4 (yellow, dark, metal, black) | Steel skid, acoustic canopy, radiator fan, louver intake, bouncing rain cap. |
| `lib:espresso_machine`    | Commercial Espresso Station | Props        | 1,204 | 4 (steel, chrome, dark, brass) | Brushed hood, dual brew groups, cups with crema, steam wand, pedestal. |

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
const bp = getModelBlueprint('lib:security_turnstile')!;

// 2. Articulated model for viewer / cutscenes
const compiled = compileModel(bp, { status: 'granted', hasSideRail: true });
scene.add(compiled.root);

// Render loop:
compiled.animate?.(clock.getElapsedTime(), { night: 0, power: 1 });

// Cleanup:
compiled.dispose();

// 3. Merged single-draw-call geometry for InstancedMesh
const singleGeo = mergedGeometry(bp);
const instancedMesh = new THREE.InstancedMesh(singleGeo, kitMaterial, 500);

// 4. Wavefront OBJ Export
const objSource = exportObj(compiled.root, 'security_turnstile');
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
