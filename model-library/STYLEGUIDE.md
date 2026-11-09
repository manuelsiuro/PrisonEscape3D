# Prison Escape 3D - Procedural 3D Art & Style Guide

A practical guide for generating 3D models via code that seamlessly blend with Prison Escape 3D's original in-game aesthetic (`src/render/props.ts`, `src/render/decor.ts`, `src/render/items.ts`).

---

## 1. Visual Philosophy: The Low-Poly Escapists Aesthetic

Prison Escape 3D uses a stylized, clean, retro 3D aesthetic reminiscent of classic sandbox escape games. The visual appeal comes from:

- **Crisp, angular silhouettes** that are immediately readable at isometric and perspective camera distances.
- **Box-based architecture**: 80% to 90% of model geometry is composed of simple boxes.
- **Restrained color harmony**: Models rely on institutional, industrial, and muted palettes rather than garish or oversaturated primary colors.
- **Baked vertex-color lighting**: Ambient floor occlusion is calculated directly onto vertex colors (`FOOT_SHADE`), eliminating the need for expensive shadow passes or multi-texture pipelines.

---

## 2. Mandatory Low-Polygon Budgets

Every procedural model MUST prioritize minimal polygon counts. High-poly bevels or subdivision curves destroy performance on mobile browsers and clash with the game's iconic blocky charm.

### Polygon Budget Tiers

| Category                           | Target Triangle Budget  | Examples from Game / Library                                                                                      |
| :--------------------------------- | :---------------------- | :---------------------------------------------------------------------------------------------------------------- |
| **Handheld Items & Small Props**   | **12 – 100 triangles**  | Cutlery, keys, combs, cups, wall clocks (60 tris), bedside table (48 tris)                                        |
| **Furniture & Room Props**         | **50 – 250 triangles**  | Dining table (60 tris), desk (84 tris), chair (96 tris), bed (96 tris), storage locker (216 tris)                 |
| **Fixtures & Workstations**        | **150 – 400 triangles** | Canteen tray trolley (312 tris), security turnstile (264 tris), guard booth (208 tris), arcade cabinet (196 tris) |
| **Vehicles & Heavy Machinery**     | **350 – 700 triangles** | Forklift (452 tris), water tower (488 tris), satellite dish (500 tris), siren mast (684 tris)                     |
| **Hard Ceiling (Validation Gate)** | **1,400 triangles max** | Enforced by `validateBlueprint()`. Models above this limit fail automated tests.                                  |

### Geometry Construction Guidelines

1. **Boxes are King**: A box is 12 triangles and produces clean, hard-edge lighting. Use boxes for posts, shelves, doors, frames, casings, and slats.
2. **Hexagonal Rods & Pipes (`seg = 6`)**: Conduits, cables, handles, and stanchions must use 6 radial segments (12 triangles for a cylinder). Under flat/matte lighting, 6 sides read as round while keeping vertex counts microscopic.
3. **Octagonal Cylinders & Discs (`seg = 8`)**: For dials, barrels, wheels, and cups, use 8 segments (16 triangles). Never use 16, 24, or 32 segments.
4. **Wedges for Chamfers**: Use `wedge()` for ramps, angled roof pitches, or sloped consoles rather than subdivided rounded curves.
5. **Silhouette over Micro-Detail**: Do not model individual screws, tiny rivets, or seam bevels as separate meshes. Represent surface breaks through contrasting color patches or subtle thin box insets.

---

## 3. The 3-to-5 Color Palette Rule

Every model must use **between 2 and 5 cohesive colors** chosen from the standardized [`model-library/palette.ts`](file:///Users/manuel.siuro/ClaudeProjects/PrisonEscape3D/model-library/palette.ts).

Never invent arbitrary hex values or use oversaturated rainbow colors. A well-designed game prop consists of:

1. **Primary Structural Color (1)**: The main body (e.g. `PALETTE.steel`, `PALETTE.wood`, `PALETTE.grey`, or `PALETTE.dark`).
2. **Secondary Framing / Recess Color (1)**: Outlines, base plinths, vents, or chassis (e.g. `PALETTE.dark`, `PALETTE.black`, or `PALETTE.woodDark`).
3. **Surface / Detail Color (1–2)**: Table tops, handles, screens, or sheet metal (e.g. `PALETTE.white`, `PALETTE.chrome`, or `PALETTE.cream`).
4. **Functional Accent (0–1 max)**: A single pop of purpose-driven color (e.g. `PALETTE.brass` for locks, `PALETTE.red` for alarm lamps, `PALETTE.green` for access granted).

### Standard Game Palette Reference (`PALETTE`)

| Token              | Hex Value  | Color Swatch & In-Game Reference                                                       |
| :----------------- | :--------- | :------------------------------------------------------------------------------------- |
| `PALETTE.metal`    | `0x8d949e` | Galvanised prison steel, pipes, and bed frames (matches `props.ts METAL`)              |
| `PALETTE.steel`    | `0xb8bec6` | Light sheet steel, sinks, oven bodies, and canteen counters (matches `decor.ts STEEL`) |
| `PALETTE.chrome`   | `0xcfd6df` | Bright polished hardware, levers, faucets, and cutlery                                 |
| `PALETTE.dark`     | `0x3b4048` | Dark structural iron, angle iron, equipment skids (matches `props.ts DARK`)            |
| `PALETTE.black`    | `0x1d2026` | Deep recesses, rubber caster treads, gaskets, and scanner pads                         |
| `PALETTE.iron`     | `0x2a2724` | Weathered iron and forge tools (matches `props.ts IRON`)                               |
| `PALETTE.wood`     | `0x9b6a3f` | Warm institutional pine tables and benches (matches `props.ts WOOD`)                   |
| `PALETTE.woodDark` | `0x6e4a2b` | Dark timber, table legs, shelving posts (matches `props.ts WOOD_DARK`)                 |
| `PALETTE.white`    | `0xeef1f4` | Institutional enamel, porcelain toilets, paper (matches `props.ts WHITE`)              |
| `PALETTE.cream`    | `0xf4f2eb` | Ceramic mugs, ivory control faceplates, vintage gauges                                 |
| `PALETTE.grey`     | `0x5b6470` | Utility lockers, trash receptacles, conduit boxes (matches `props.ts bin`)             |
| `PALETTE.brass`    | `0xd4a238` | Stamped brass number plates, padlocks, desk key handles                                |
| `PALETTE.red`      | `0xd23b2e` | Fire extinguishers, emergency alarms, access denied LEDs (matches `decor.ts RED`)      |
| `PALETTE.yellow`   | `0xd6a72c` | Industrial generators, caution tape, crane forks (matches `props.ts generator`)        |
| `PALETTE.green`    | `0x27ae60` | Oxygen tanks, foliage, access granted LEDs (matches `decor.ts GREEN`)                  |
| `PALETTE.blue`     | `0x2f6fd0` | Molded canteen meal trays, gym mats, console chassis (matches `props.ts mat`)          |

---

## 4. Ground Occlusion & Shading

In `model-library/kit.ts`, calling `merge()` applies ambient occlusion to vertices near the ground:

```typescript
const FOOT_SHADE = 0.74; // Floor-level vertices receive 74% base brightness
const FOOT_FADE = 0.85; // Occlusion gradient fades out 0.85m above the ground
```

This means a single box or leg geometry automatically acquires realistic bottom-shadow grounding without extra geometry, textures, or ambient occlusion maps. Let the shading system do the work.

---

## 5. Blueprint Anatomy Checklist

When creating a new model blueprint:

1. **Source File**: Save under `model-library/models/<camelCaseName>.ts`.
2. **ID**: Must be prefixed with `lib:` followed by snake_case (e.g. `lib:security_turnstile`).
3. **Bilingual Names**: Provide concise, natural names in English (`name`) and French (`nameFr`).
4. **Footprint**: Define the grid footprint in 1×1m prison tiles (e.g. `[1, 1]` or `[2, 1]`).
5. **Layers & Hierarchy**:
   - Split parts into semantic layers (e.g. `'cabinet'`, `'rotor'`, `'mast'`, `'screen'`).
   - Use `pivot` and `parent` for articulated moving parts so animations rotate naturally around axes.
6. **Low-Poly Primitives**: Only use helpers from `kit.ts` (`box`, `cyl`, `rod`, `tubeZ`, `disc`, `wedge`, `mirrorX`, `repeatLinear`).
7. **Register in Index**: Export blueprint in `model-library/index.ts` and append to `MODEL_LIBRARY`.
8. **Automated Verification**: Run `npm test -- mapviewertest` and `npm run check`.
