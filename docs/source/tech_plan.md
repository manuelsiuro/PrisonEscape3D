Copy the entire document below into a `PLAN.md` file at the root of your repository, then instruct **Antigravity** to read `PLAN.md` and execute **Phase 1 through Phase 8** sequentially, verifying TypeScript compilation after each phase.

---

# THE ESCAPISTS 3D (THREE.JS) — MASTER TECHNICAL & DESIGN SPECIFICATION

## 0. Agent Execution Instructions (For Antigravity)

You are an autonomous Principal Game Engineer building a complete, feature-complete 3D web adaptation of *The Escapists* using **Three.js**, **TypeScript**, and **Vite**.

### Strict Engineering Rules for the Agent:

1. **100% Self-Contained Asset Pipeline (Zero External Asset Failures):** Do **not** rely on external `.glb`, `.gltf`, `.png`, or `.mp3` files that do not exist in the repository. Build a procedural **Voxel/Low-Poly Geometry Factory** (`src/rendering/AssetFactory.ts`), a **Procedural Canvas2D Pixel-Art Texture Generator** (`src/rendering/TextureFactory.ts`), and a **Web Audio API Sound Synthesizer** (`src/audio/SoundManager.ts`).
2. **Strict Separation of State and View:** The logical simulation runs on a deterministic 3D tile grid (`Grid[layer][z][x]`) and a central state store. Three.js meshes reflect this state.
3. **Incremental Compilation Check:** At the end of every phase in Section 10, run `npx tsc --noEmit` and `npm run build` to verify there are zero TypeScript or bundler errors before moving to the next phase.
4. **Performance:** Use `THREE.InstancedMesh` for static/semi-static world geometry (floors, walls, fences, vents, roofs) and update instance matrices when tiles are damaged or broken.

---

## 1. Technology Stack & Project Setup

### 1.1 `package.json` Specification

Initialize the project with Vite (`vanilla-ts` or `react-ts`). Required packages:

```json
{
  "name": "the-escapists-threejs",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "three": "^0.170.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/three": "^0.170.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0"
  }
}

```

### 1.2 Complete File & Directory Architecture

```text
src/
├── main.ts                          # Entry point, initializes GameEngine & UIController
├── style.css                        # Pixel-art/retro HUD styling, modals, tooltips, bars
├── types/
│   └── game.types.ts                # All TypeScript interfaces, enums, and data contracts
├── config/
│   ├── constants.ts                 # Grid dimensions, tick rates, layer heights, colors
│   ├── items.data.ts                # Complete database of 75+ items
│   ├── recipes.data.ts              # Complete database of 42+ crafting recipes
│   ├── routines.data.ts             # 24-hour prison schedule & zone rules
│   └── centerPerks.map.ts           # Procedural/matrix generator for the 4-layer prison map
├── core/
│   ├── GameEngine.ts                # Main loop, delta time, system orchestration
│   ├── ClockSystem.ts               # 24h clock, routine transitions, day/night events
│   ├── InputManager.ts              # WASD, E (Interact), Space (Attack/Use), Q (Drop), 1-6 Slots, Mouse Raycast
│   ├── SaveManager.ts               # LocalStorage serialization of world grid, desks, player, NPCs
│   └── EventBus.ts                  # Pub/Sub event dispatcher for decoupled UI/Audio/Gameplay triggers
├── world/
│   ├── WorldGrid.ts                 # 4-layer 3D array [layer][z][x], tile damage, dirt, concealment
│   ├── DoorManager.ts               # Keycard/key color clearance rules, routine auto-lock/unlock
│   ├── PowerGridSystem.ts           # Generator state, electric fences, cameras, contraband detectors
│   └── ContainerManager.ts          # Cell desks (10 normal + 6 hidden slots), loot tables, daily restock
├── rendering/
│   ├── SceneManager.ts              # Three.js Scene, WebGLRenderer, shadow maps, resize handler
│   ├── OrthographicCameraRig.ts     # Isometric/Top-down angled camera, zoom, smooth follow, screen shake
│   ├── CutawaySystem.ts             # Hides layers above player & fades roofs when indoors on Layer 0
│   ├── InstancedWorldRenderer.ts    # InstancedMesh batching for floors, walls, vents, roofs, fences
│   ├── TextureFactory.ts            # Procedural Canvas2D pixel textures (brick, grass, concrete, metal, water)
│   ├── AssetFactory.ts              # Procedural 3D low-poly meshes (characters, beds, desks, toilets, gym gear)
│   ├── LightingAndFOVRenderer.ts    # Ambient day/night lerp, yard spotlights, raycasted Guard Vision Cones
│   └── ParticleSystem.ts            # Wall chipping dust, digging dirt, shower water, stun stars, sparks
├── entities/
│   ├── Entity.ts                    # Base 3D character entity, animation state (walk, swing, KO, work)
│   ├── PlayerController.ts          # Movement, collision, stamina, tool actions, disguise evaluation
│   ├── InmateEntity.ts              # AI state machine, schedule adherence, merchant shop, opinion, favors
│   ├── GuardEntity.ts               # Patrol waypoints, FOV detection, shakedowns, combat pursuit, key tracking
│   └── SniperSystem.ts              # Watchtower snipers targeting outdoor high-heat or escaping players
├── systems/
│   ├── PathfindingAStar.ts          # Multi-layer 3D A* pathfinding (supports doors, ladders, vents, stairs)
│   ├── HeatAndSecuritySystem.ts     # Heat 0-100%, solitary confinement, lockdown, contraband detector scans
│   ├── CraftingSystem.ts            # 3-slot combiner, Intellect gating, recipe discovery book
│   ├── CombatSystem.ts              # Lock-on targeting, melee hitboxes, KO timer, unconscious inventory looting
│   ├── JobSystem.ts                 # 6 jobs (Laundry, Woodshop, Metalshop, Kitchen, Mailman, Janitor) & quotas
│   ├── TrainingSystem.ts            # Gym (Strength/Speed) & Library (Intellect) rapid-input minigames
│   ├── FavorAndEconomySystem.ts     # Quest generator, inmate opinions, dynamic merchant pricing
│   └── EscapeEvaluator.ts           # Checks the 4 win conditions & triggers victory cinematic
├── audio/
│   └── SoundManager.ts              # Procedural Web Audio API SFX (sirens, footsteps, chipping, UI clicks, buzzer)
└── ui/
    ├── UIManager.ts                 # Master DOM overlay controller
    ├── HUDView.ts                   # Top bar (Clock, Routine, Heat, Cash, Stats, Stamina/HP) & 6-slot hotbar
    ├── InventoryAndDeskModal.ts     # Drag/click transfer between player, hidden desk slots, and KO'd NPCs
    ├── CraftingModal.ts             # 3-slot crafting workbench + known recipe handbook
    ├── JobAndFavorModal.ts          # Job board application UI + Inmate shop/quest dialogue modal
    └── MinigameOverlay.ts           # Gym training bar, potato peeling in Solitary, and victory/gameover screens

```

---

## 2. Core Data Contracts (`src/types/game.types.ts`)

Implement the following foundational TypeScript interfaces exactly:

```typescript
export type LayerIndex = -1 | 0 | 1 | 2; // -1: Underground, 0: Ground, 1: Vents, 2: Roof

export enum TileType {
  EMPTY = 0,
  DIRT_GROUND = 1,
  GRASS = 2,
  CONCRETE_FLOOR = 3,
  WOOD_FLOOR = 4,
  TILED_FLOOR = 5,
  ROAD_ESCAPE = 6,
  BRICK_WALL = 10,
  REINFORCED_WALL = 11,     // Cannot be chipped
  PERIMETER_FENCE = 12,
  ELECTRIC_FENCE = 13,
  VENT_DUCT = 14,
  VENT_GRATE = 15,          // Connects Layer 0 and Layer 1
  ROOF_TILE = 16,
  TUNNEL_DUG = 17,          // Dug tile on Layer -1
  TUNNEL_ENTRANCE = 18,     // Hole connecting Layer 0 and Layer -1
  LADDER_UP = 19,           // Connects Layer 0/1 to Layer 2
}

export enum KeyColor {
  NONE = 'NONE',
  CELL_YELLOW = 'YELLOW',       // Cell doors & inmate areas
  WORK_CYAN = 'CYAN',           // Job rooms & maintenance closets
  UTILITY_PURPLE = 'PURPLE',    // Vent access rooms, ladders, generator room
  SECURITY_RED = 'RED',         // Guard quarters, control room, inner security doors
  MASTER_GREEN = 'GREEN'        // Outer perimeter gates
}

export enum ZoneType {
  NONE = 'NONE',
  PLAYER_CELL = 'PLAYER_CELL',
  INMATE_CELL = 'INMATE_CELL',
  ROLL_CALL = 'ROLL_CALL',
  CANTEEN = 'CANTEEN',
  SHOWERS = 'SHOWERS',
  GYM = 'GYM',
  LIBRARY = 'LIBRARY',
  YARD = 'YARD',
  JOB_LAUNDRY = 'JOB_LAUNDRY',
  JOB_WOODSHOP = 'JOB_WOODSHOP',
  JOB_METALSHOP = 'JOB_METALSHOP',
  JOB_KITCHEN = 'JOB_KITCHEN',
  JOB_MAILROOM = 'JOB_MAILROOM',
  JOB_JANITOR = 'JOB_JANITOR',
  GENERATOR_ROOM = 'GENERATOR_ROOM',
  GUARD_QUARTERS = 'GUARD_QUARTERS',
  SOLITARY = 'SOLITARY',
  ESCAPE_BOUNDARY = 'ESCAPE_BOUNDARY'
}

export interface TileData {
  layer: LayerIndex;
  x: number;
  z: number;
  type: TileType;
  zone: ZoneType;
  maxHp: number;
  hp: number;
  destructible: boolean;
  requiredToolCategory?: 'DIGGING' | 'CHIPPING' | 'CUTTING' | 'UNSCREWING';
  minToolTier?: number;
  concealmentItemId: string | null;   // e.g., 'poster', 'fake_wall_block', 'fake_vent_cover', 'fake_fence'
  hasTimberBrace: boolean;            // Prevents tunnel collapse on Layer -1
  doorKeyColor?: KeyColor;
  isDoorOpen?: boolean;
  isPowered?: boolean;                // For electric fences and detectors
  interactableProp?: PropData | null;
}

export interface PropData {
  id: string;
  type:
    | 'BED'
    | 'PLAYER_BED'
    | 'DESK'
    | 'TOILET'
    | 'CHAIR'
    | 'FOOD_TRAY'
    | 'SHOWER_HEAD'
    | 'GYM_MAT'
    | 'GYM_BENCH'
    | 'GYM_TREADMILL'
    | 'BOOKSHELF'
    | 'CONTRABAND_DETECTOR'
    | 'GENERATOR'
    | 'SECURITY_CAMERA'
    | 'JOB_BOARD'
    | 'LAUNDRY_DIRTY_BIN'
    | 'LAUNDRY_WASHER'
    | 'LAUNDRY_CLEAN_BIN'
    | 'WOOD_SUPPLY_BIN'
    | 'WOOD_WORKBENCH'
    | 'WOOD_OUTPUT_BIN'
    | 'METAL_SUPPLY_BIN'
    | 'METAL_PRESS'
    | 'METAL_OUTPUT_BIN'
    | 'KITCHEN_FREEZER'
    | 'KITCHEN_OVEN'
    | 'KITCHEN_SERVING_TABLE'
    | 'MAIL_SORTING_DESK';
  ownerId?: string;
  hasBedDummy?: boolean;
  toiletFlushedCount?: number;        // Max 3 dirt piles before clogging for 60 in-game mins
  isClogged?: boolean;
  containerId?: string;
}

export type ItemCategory =
  | 'MATERIAL'
  | 'CONTRABAND_MATERIAL'
  | 'TOOL_DIGGING'
  | 'TOOL_CHIPPING'
  | 'TOOL_CUTTING'
  | 'TOOL_UNSCREWING'
  | 'WEAPON'
  | 'OUTFIT'
  | 'KEY'
  | 'CONCEALMENT'
  | 'CONSUMABLE'
  | 'QUEST';

export interface ItemDefinition {
  id: string;
  name: string;
  category: ItemCategory;
  isContraband: boolean;
  maxDurability?: number;
  toolTier?: 1 | 2 | 3 | 4;           // 1: Plastic/Flimsy, 2: Lightweight, 3: Sturdy, 4: Multitool
  damageBonus?: number;               // Weapon attack bonus (1 to 25)
  attackRange?: number;               // Default 1.5 tiles; Whip/Cup = 3.0 tiles
  defenseBonus?: number;              // Outfit damage reduction
  isGuardDisguise?: boolean;
  keyColor?: KeyColor;
  energyRestore?: number;
  baseValue: number;                  // Base price in Inmate shops ($)
  spawnLocations?: ZoneType[];        // Where this item naturally spawns in desks
  spawnWeight?: number;
  iconColor: string;                  // Hex color for procedural icon rendering
  description: string;
}

export interface ItemInstance {
  instanceId: string;
  itemId: string;
  durability: number;
}

export interface CraftingRecipe {
  id: string;
  resultItemId: string;
  ingredients: string[];              // Array of 2 or 3 itemIds (order-independent)
  intellectRequired: number;          // 20 to 90
  description: string;
}

export enum RoutinePhase {
  MORNING_ROLL_CALL = 'MORNING_ROLL_CALL',
  BREAKFAST = 'BREAKFAST',
  MORNING_FREE_TIME = 'MORNING_FREE_TIME',
  WORK_PERIOD = 'WORK_PERIOD',
  EXERCISE_PERIOD = 'EXERCISE_PERIOD',
  SHOWER_BLOCK = 'SHOWER_BLOCK',
  EVENING_MEAL = 'EVENING_MEAL',
  EVENING_FREE_TIME = 'EVENING_FREE_TIME',
  EVENING_ROLL_CALL = 'EVENING_ROLL_CALL',
  LIGHTS_OUT = 'LIGHTS_OUT',
  LOCKDOWN = 'LOCKDOWN'
}

export interface CharacterStats {
  hp: number;
  maxHp: number;
  energy: number;                     // 0 - 100
  strength: number;                   // 20 - 100 (scales maxHp = 50 + strength, melee damage)
  speed: number;                      // 20 - 100 (scales move speed & swing cooldown)
  intellect: number;                  // 20 - 100 (unlocks crafting & jobs)
  cash: number;
  heat: number;                       // 0 - 100
}

```

---

## 3. Complete Item Database (`src/config/items.data.ts`)

Populate `src/config/items.data.ts` with all **76 items** below. Every item must be craftable, buyable, or lootable in prison desks or job rooms.

### 3.1 Everyday & Contraband Raw Materials

| Item ID | Name | Contraband? | Base Value | Spawn Source | Description |
| --- | --- | --- | --- | --- | --- |
| `comb` | Plastic Comb | No | $5 | Desks | Standard grooming comb. Can be melted or sharpened. |
| `toothbrush` | Toothbrush | No | $5 | Desks | Plastic toothbrush. Can be sharpened against a wall or crafted. |
| `lighter` | Lighter | **Yes** | $15 | Desks / Shops | Used to melt plastic, chocolate, or candle wax. |
| `toilet_paper` | Roll of Toilet Paper | No | $3 | Toilets / Desks | Combine with glue to create Papier-Mâché. |
| `tube_of_glue` | Tube of Glue | **Yes** | $12 | Desks / Shops | Adhesive used for Papier-Mâché and carpentry. |
| `duct_tape` | Roll of Duct Tape | **Yes** | $20 | Desks / Shops | Essential binding material for almost all tools and weapons. |
| `file` | Metal File | **Yes** | $20 | Desks / Shops | Used to craft cutters and sharpen metal. |
| `timber` | Timber | **Yes** | $15 | Woodshop / Shops | Raw wood plank used for tool handles, braces, and weapons. |
| `sheet_metal` | Sheet Metal | **Yes** | $20 | Metalshop / Shops | Used for shovel blades and armored outfits. |
| `crowbar` | Crowbar | **Yes** | $35 | Shops | Heavy metal pry bar; high-tier chipping tool and component. |
| `pillow` | Pillow | No | $5 | Cell Beds | Combine 2 Pillows + 1 Sheet to craft a Bed Dummy. |
| `bed_sheet` | Bed Sheet | No | $5 | Cell Beds | Used for Bed Dummies, Sheet Ropes, and Rafts. |
| `sock` | Sock | No | $3 | Desks / Laundry | Harmless alone; deadly when stuffed with soap or batteries. |
| `bar_of_soap` | Bar of Soap | No | $5 | Showers / Desks | Used for Sock Mace or combined with wax for key putty. |
| `battery` | Battery | No | $10 | Desks | Heavy power cell; used for Super Sock Mace or Powered Screwdriver. |
| `wire` | Length of Wire | **Yes** | $12 | Desks / Shops | Conductive wire used in electrical tools and whips. |
| `razor_blade` | Razor Blade | **Yes** | $12 | Desks / Shops | Attached to combs or whips for extra bleed damage. |
| `jar_of_ink` | Jar of Ink | No | $8 | Library / Desks | Pigments Papier-Mâché to look like a real wall block. |
| `magazine` | Magazine | No | $8 | Library / Desks | Combine with Duct Tape to create a wall-covering Poster. |
| `foil` | Roll of Foil | **Yes** | $15 | Kitchen / Shops | Blocks scanner waves when combined with Duct Tape. |
| `talcum_powder` | Talcum Powder | No | $8 | Desks | Combined with toothpaste to make Wad of Putty. |
| `toothpaste` | Tube of Toothpaste | No | $5 | Desks | Combined with talcum powder to make Wad of Putty. |
| `wad_of_putty` | Wad of Putty | **Yes** | $25 | Crafted | Soft impression putty; combine with any Guard Key to make a mold. |
| `molten_plastic` | Molten Plastic | **Yes** | $20 | Crafted | Melted comb/toothbrush; poured into Key Molds. |
| `papier_mache` | Papier-Mâché | **Yes** | $15 | Crafted | Moldable paper pulp for fake blocks and vent covers. |
| `cup` | Plastic Cup | No | $3 | Canteen / Desks | Holds hot liquids. |
| `chocolate_bar` | Bar of Chocolate | No | $8 | Canteen / Desks | Can be eaten (+15 Energy) or melted in a cup with a lighter. |
| `broom` | Broom | No | $10 | Janitor Closet | Long wooden handle; can be dismantled or used as weak weapon. |
| `mop` | Mop | No | $10 | Janitor Closet | Cleans dirty floors for Janitor job quota. |
| `bleach` | Bottle of Bleach | No | $12 | Laundry / Janitor | Whitens inmate uniforms into Infirmary outfits. |
| `balsa_wood` | Balsa Wood | **Yes** | $15 | Woodshop | Buoyant wood used for raft construction. |
| `rope` | Length of Rope | **Yes** | $25 | Shops | Strong rope for Grappling Hooks and Rafts. |
| `dirt_pile` | Pile of Dirt | **Yes** | $0 | Digging | Generated when digging tunnels. Flush in toilets or hide in desks! |
| `concrete_block` | Concrete Wall Chunk | **Yes** | $0 | Wall Chipping | Dropped when a brick/concrete wall breaks. |
| `potato` | Raw Potato | No | $1 | Solitary / Kitchen | Peel in Solitary Confinement to end lockdown punishment early. |

### 3.2 Cutlery, Digging, Chipping, Cutting & Unscrewing Tools

| Item ID | Name | Category | Tier | Durability | Damage Per Use (Tile) | Energy Cost / Use | Contraband? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `plastic_spoon` | Plastic Spoon | `TOOL_DIGGING` | 1 | 10 | 4 | 8% | No |
| `plastic_fork` | Plastic Fork | `TOOL_CHIPPING` | 1 | 10 | 4 | 8% | No |
| `plastic_knife` | Plastic Knife | `TOOL_CUTTING` | 1 | 10 | 4 | 8% | No |
| `nail_file` | Nail File | `TOOL_UNSCREWING` | 1 | 8 | 12 (Vents) | 6% | **Yes** |
| `screwdriver` | Screwdriver | `TOOL_UNSCREWING` | 2 | 25 | 25 (Vents) | 4% | **Yes** |
| `powered_screwdriver` | Powered Screwdriver | `TOOL_UNSCREWING` | 4 | 50 | 50 (Vents) | 2% | **Yes** |
| `trowel` | Garden Trowel | `TOOL_DIGGING` | 2 | 20 | 10 | 6% | **Yes** |
| `flimsy_shovel` | Flimsy Shovel | `TOOL_DIGGING` | 1 | 18 | 10 | 6% | **Yes** |
| `lightweight_shovel` | Lightweight Shovel | `TOOL_DIGGING` | 2 | 30 | 18 | 5% | **Yes** |
| `sturdy_shovel` | Sturdy Shovel | `TOOL_DIGGING` | 3 | 50 | 25 | 4% | **Yes** |
| `flimsy_pickaxe` | Flimsy Pickaxe | `TOOL_CHIPPING` | 1 | 18 | 10 | 6% | **Yes** |
| `lightweight_pickaxe` | Lightweight Pickaxe | `TOOL_CHIPPING` | 2 | 30 | 18 | 5% | **Yes** |
| `sturdy_pickaxe` | Sturdy Pickaxe | `TOOL_CHIPPING` | 3 | 50 | 25 | 4% | **Yes** |
| `flimsy_cutters` | Flimsy Cutters | `TOOL_CUTTING` | 1 | 18 | 10 | 6% | **Yes** |
| `lightweight_cutters` | Lightweight Cutters | `TOOL_CUTTING` | 2 | 30 | 18 | 5% | **Yes** |
| `sturdy_cutters` | Sturdy Cutters | `TOOL_CUTTING` | 3 | 50 | 25 | 4% | **Yes** |
| `multitool` | Multitool | `TOOL_DIGGING` (All) | 4 | 80 | 35 (Dig & Chip) | 3% | **Yes** |

### 3.3 Weapons, Outfits, Keys & Escape Equipment

| Item ID | Name | Category | Stats / Effect | Contraband? |
| --- | --- | --- | --- | --- |
| `comb_shiv` | Comb Shiv | `WEAPON` | +6 Damage | **Yes** |
| `toothbrush_shiv` | Toothbrush Shiv | `WEAPON` | +6 Damage | **Yes** |
| `comb_blade` | Comb Blade | `WEAPON` | +10 Damage | **Yes** |
| `sock_mace` | Sock Mace | `WEAPON` | +10 Damage | **Yes** |
| `super_sock_mace` | Super Sock Mace | `WEAPON` | +16 Damage | **Yes** |
| `wooden_bat` | Wooden Bat | `WEAPON` | +14 Damage | **Yes** |
| `spiked_bat` | Spiked Baseball Bat | `WEAPON` | +20 Damage | **Yes** |
| `guard_baton` | Guard Baton | `WEAPON` | +18 Damage | **Yes** |
| `nunchucks` | Nunchucks | `WEAPON` | +22 Damage, +15% Attack Speed | **Yes** |
| `whip` | Razor Whip | `WEAPON` | +20 Damage, 2.5 Tile Range | **Yes** |
| `molten_chocolate` | Cup of Molten Chocolate | `WEAPON` | Single-use instant KO ranged throw (3 tiles) | **Yes** |
| `inmate_outfit` | Orange Inmate Outfit | `OUTFIT` | +5 Defense (Default legal uniform) | No |
| `cushioned_outfit` | Cushioned Inmate Outfit | `OUTFIT` | +15 Defense | **Yes** |
| `plated_outfit` | Plated Inmate Outfit | `OUTFIT` | +30 Defense | **Yes** |
| `guard_outfit` | Guard Uniform | `OUTFIT` | +15 Defense; disguises player at Night/Restricted zones | **Yes** |
| `key_yellow` ... `key_green` | Real Guard Keys (5 Colors) | `KEY` | Opens Yellow/Cyan/Purple/Red/Green doors | **Yes** |
| `mold_yellow` ... `mold_green` | Key Molds (5 Colors) | `CONTRABAND_MATERIAL` | Used with Molten Plastic | **Yes** |
| `plastic_key_yellow` ... `green` | Plastic Keys (5 Colors) | `KEY` | Cloned key (15 uses durability) | **Yes** |
| `contraband_pouch` | Contraband Pouch | `KEY` | Passive: Hides all carried contraband from Detectors (20 passes) | **Yes** |
| `bed_dummy` | Bed Dummy | `CONCEALMENT` | Placed in player bed to fool night-patrol guards | **Yes** |
| `poster` | Wall Poster | `CONCEALMENT` | Hides broken wall tiles on Layer 0 | **Yes** |
| `fake_wall_block` | Fake Wall Block | `CONCEALMENT` | Hides broken wall tiles on Layer 0 | **Yes** |
| `fake_vent_cover` | Fake Vent Cover | `CONCEALMENT` | Hides unscrewed Vent Grates | **Yes** |
| `fake_fence_cover` | Fake Fence Cover | `CONCEALMENT` | Hides cut fence tiles | **Yes** |
| `timber_brace` | Timber Brace | `CONCEALMENT` | Supports Layer -1 tunnel ceiling | **Yes** |
| `sheet_rope` | Sheet Rope | `KEY` | Climb down from Layer 2 (Roof) to Layer 0 | **Yes** |
| `grappling_hook` | Grappling Hook | `KEY` | Climb up to Roof walls or across outer perimeter from Roof | **Yes** |

---

## 4. Complete Crafting Recipe Matrix (`src/config/recipes.data.ts`)

Implement an order-independent recipe matcher (`ingredients.sort().join('+')`). If the player's `stats.intellect < recipe.intellectRequired`, display `"Requires [X] Intellect"` in the Crafting UI and block crafting.

| Result Item ID | Ingredient 1 | Ingredient 2 | Ingredient 3 | Intellect Req |
| --- | --- | --- | --- | --- |
| `molten_plastic` | `comb` (or `toothbrush`) | `lighter` | — | 30 |
| `wad_of_putty` | `talcum_powder` | `toothpaste` | — | 40 |
| `papier_mache` | `toilet_paper` | `tube_of_glue` | — | 30 |
| `bed_dummy` | `pillow` | `pillow` | `bed_sheet` | 30 |
| `sheet_rope` | `bed_sheet` | `bed_sheet` | — | 20 |
| `poster` | `magazine` | `duct_tape` | — | 20 |
| `fake_wall_block` | `papier_mache` | `papier_mache` | `jar_of_ink` | 50 |
| `fake_vent_cover` | `papier_mache` | `papier_mache` | — | 30 |
| `fake_fence_cover` | `wire` | `wire` | `wire` | 40 |
| `timber_brace` | `timber` | `timber` | — | 20 |
| `contraband_pouch` | `foil` | `duct_tape` | — | 50 |
| `tool_handle` | `timber` | `file` | — | 30 |
| `flimsy_shovel` | `tool_handle` | `sheet_metal` | `duct_tape` | 40 |
| `lightweight_shovel` | `flimsy_shovel` | `sheet_metal` | `duct_tape` | 60 |
| `sturdy_shovel` | `lightweight_shovel` | `sheet_metal` | `duct_tape` | 80 |
| `flimsy_pickaxe` | `tool_handle` | `crowbar` | `duct_tape` | 40 |
| `lightweight_pickaxe` | `flimsy_pickaxe` | `timber` | `duct_tape` | 60 |
| `sturdy_pickaxe` | `lightweight_pickaxe` | `timber` | `duct_tape` | 80 |
| `flimsy_cutters` | `file` | `file` | `duct_tape` | 40 |
| `lightweight_cutters` | `flimsy_cutters` | `file` | `duct_tape` | 60 |
| `sturdy_cutters` | `lightweight_cutters` | `file` | `duct_tape` | 80 |
| `multitool` | `sturdy_shovel` | `sturdy_pickaxe` | `duct_tape` | 90 |
| `powered_screwdriver` | `screwdriver` | `battery` | `wire` | 70 |
| `mold_[color]` | `wad_of_putty` | `key_[color]` | — | 50 |
| `plastic_key_[color]` | `mold_[color]` | `molten_plastic` | — | 60 |
| `sock_mace` | `sock` | `bar_of_soap` | — | 20 |
| `super_sock_mace` | `sock` | `battery` | — | 40 |
| `comb_blade` | `comb` | `razor_blade` | — | 30 |
| `wooden_bat` | `timber` | `duct_tape` | — | 40 |
| `spiked_bat` | `wooden_bat` | `nail_file` (or `wire`) | `duct_tape` | 60 |
| `nunchucks` | `timber` | `timber` | `wire` | 70 |
| `whip` | `timber` | `wire` | `razor_blade` | 80 |
| `molten_chocolate` | `cup` | `chocolate_bar` | `lighter` | 40 |
| `cushioned_outfit` | `inmate_outfit` | `pillow` | `duct_tape` | 40 |
| `plated_outfit` | `inmate_outfit` | `sheet_metal` | `duct_tape` | 70 |
| `grappling_hook` | `crowbar` | `crowbar` | `duct_tape` | 60 |
| `grapnel` | `grappling_hook` | `rope` (or `sheet_rope`) | — | 60 |

*(Note: When crafting `mold_[color]` from `wad_of_putty` + `key_[color]`, **do not consume the original `key_[color]**`! Return both the `mold_[color]` and the original `key_[color]` to the player's inventory so the player can put the real key back into the unconscious guard's pockets).*

---

## 5. The 4-Layer World Map Specification ("Center Perks 3D")

The map is a `64 x 64` grid (`x: 0..63`, `z: 0..63`) across 4 vertical layers (`tileSize = 2.0` world units).

### 5.1 Layer 0 (Ground Floor Layout Blueprint)

```text
Z=0..63, X=0..63
+------------------------------------------------------------------+
| ROAD_ESCAPE BOUNDARY (Outer Ring: x=0..2, x=61..63, z=0..2,61..63)|
|  +------------------------------------------------------------+  |
|  | OUTER ELECTRIC FENCE (x=4..59, z=4..59) + 4 Corner Towers   |  |
|  |  +------------------------------------------------------+  |  |
|  |  | PERIMETER YARD & WALKWAY (Grass, Searchlights)       |  |  |
|  |  |  +------------------------------------------------+  |  |  |
|  |  |  | INNER BRICK PRISON COMPOUND (x=10..53, z=10..53)|  |  |  |
|  |  |  |                                                |  |  |  |
|  |  |  | [NW: CELLS 1-8]    [N: ROLL CALL]  [NE: CANTEEN|  |  |  |
|  |  |  |  (x=12..24,         (x=25..38,      & KITCHEN] |  |  |  |
|  |  |  |   z=12..26)          z=12..24)     (x=39..51,  |  |  |  |
|  |  |  |  *Player Cell=#1                    z=12..26)  |  |  |  |
|  |  |  |                                                |  |  |  |
|  |  |  | [W: GYM, LIBRARY   [CENTER: MAIN   [E: JOBS:   |  |  |  |
|  |  |  |  & SHOWERS]         CORRIDOR &      LAUNDRY,   |  |  |  |
|  |  |  |  (x=12..22,         COURTYARD]      WOODSHOP,  |  |  |  |
|  |  |  |   z=27..42)         (x=23..38,      METALSHOP] |  |  |  |
|  |  |  |                      z=25..42)     (x=39..51,  |  |  |  |
|  |  |  |                                     z=27..42)  |  |  |  |
|  |  |  | [SW: GENERATOR,    [S: MAIN GATE   [SE: GUARD  |  |  |  |
|  |  |  |  MAINTENANCE &      & VISITATION]   QUARTERS & |  |  |  |
|  |  |  |  SOLITARY]         (x=25..38,       CONTROL RM]|  |  |  |
|  |  |  |  (x=12..24,z=43..51) z=43..51)     (x=39..51)  |  |  |  |
|  |  |  +------------------------------------------------+  |  |  |
|  |  +------------------------------------------------------+  |  |
|  +------------------------------------------------------------+  |
+------------------------------------------------------------------+

```

### 5.2 Specific Room & Door Rules

1. **Cell Block (NW):**
* 8 individual cells (each `4x4` tiles). Cell #1 belongs to the Player (`ZoneType.PLAYER_CELL`); Cells #2–#8 belong to the 7 named AI Inmates (`ZoneType.INMATE_CELL`).
* Each cell contains: 1 `BED` (`PLAYER_BED` in Cell #1), 1 `DESK` (with 16 inventory slots: 6 hidden, 10 standard), 1 `TOILET`, and 1 `VENT_GRATE` ceiling tile (in Player Cell, Cell #4, and Utility Closet).
* Cell doors use `KeyColor.CELL_YELLOW`. They automatically stay **OPEN** from `08:00` to `22:00` and **LOCK** during `LIGHTS_OUT` (`23:00–08:00`) and `LOCKDOWN`.


2. **Contraband Detector Archways:**
* Place `CONTRABAND_DETECTOR` props at the entrance to the **Cell Block**, **Canteen**, **Gym**, **Laundry**, **Woodshop**, and **Metalshop**.


3. **Generator & Maintenance Room (SW):**
* Locked behind a `KeyColor.UTILITY_PURPLE` door (also reachable via Layer +1 Vents or chipping through the adjacent Janitor Closet wall).
* Contains the `GENERATOR` prop (`isPowered = true` by default) and a `LADDER_UP` to Layer +2 (Roof).


4. **Layer -1 (Underground):**
* Initially filled with `TileType.DIRT_GROUND` (`hp: 100`, `destructible: true`), except directly beneath the outer `ROAD_ESCAPE` boundary where digging upward surfaces outside the prison.
* Note: Concrete building foundations on Layer 0 do NOT block digging on Layer -1, **except** you can only start/exit a tunnel (`TUNNEL_ENTRANCE`) on non-Detector, non-Wall floor tiles using a digging tool.


5. **Layer +1 (Ventilation System):**
* Overhead metal ductwork running from the Player's Cell -> Inmate Cells -> Library -> Generator Room -> Canteen.
* Separated into segments by internal `VENT_GRATE` dividers that must be unscrewed or cut.


6. **Layer +2 (Rooftops):**
* Flat roof surfaces covering the main compound buildings.
* Accessed via the Ladder in the Maintenance/Generator Room or from Layer +1 Vent rooftop exhaust hatches.
* Features gap points where a `grapnel` (Grappling Hook + Rope) can hook across to the outer perimeter wall, and edges where a `sheet_rope` can be tied to climb down to the outer yard.



---

## 6. Three.js Rendering, Camera & Procedural Assets

### 6.1 Orthographic Camera & Layer Cutaway (`src/rendering/OrthographicCameraRig.ts` & `CutawaySystem.ts`)

* **Camera Configuration:**
* Use `THREE.OrthographicCamera` with `frustumSize = 26`.
* Offset relative to target: `new THREE.Vector3(0, 38, 24)` looking at `targetPosition`. This produces the classic 60° angled top-down perspective where vertical wall faces and character silhouettes are clearly readable without perspective distortion.
* Mouse wheel zooms `camera.zoom` between `0.6` and `2.2`.


* **4-Layer Elevation & Roof Cutaway:**
* Maintain 4 `THREE.Group` containers: `layerGroups[-1]` (`y = -3.0`), `layerGroups[0]` (`y = 0.0`), `layerGroups[1]` (`y = 2.8`), `layerGroups[2]` (`y = 5.2`).
* **Rule 1 (Vertical Layer Visibility):** Any layer strictly greater than `player.layer` has `group.visible = false`.
* **Rule 2 (Indoor Roof/Vent Occlusion):** When `player.layer === 0`, both Layer +1 and Layer +2 are hidden so the player can clearly see inside all rooms. When the player climbs onto a desk and enters a vent (`player.layer = 1`), Layer +1 becomes visible and Layer 0 dims by 50%. When the player reaches the roof (`player.layer = 2`), all layers `-1, 0, 1, 2` are visible.



### 6.2 Procedural Voxel Character & Prop Generator (`src/rendering/AssetFactory.ts`)

Construct crisp, stylized 3D blocky characters (resembling 3D voxel versions of *The Escapists* sprites):

* **Character Rig (`createCharacterMesh(role, outfitColor, skinColor, hairStyle)`):**
* `rootGroup`:
* `headMesh`: `BoxGeometry(0.65, 0.65, 0.65)` with a Canvas2D face texture (eyes, brow, expression).
* `torsoMesh`: `BoxGeometry(0.7, 0.75, 0.45)` colored by outfit (`#ff7714` for Inmate Orange, `#1e3a5f` for Guard Blue, `#ffffff` for Kitchen/Infirmary).
* `leftArm`, `rightArm`: `BoxGeometry(0.22, 0.65, 0.22)` pivoted at shoulders for walking swing and tool/weapon swing animations.
* `heldItemGroup`: Attached to `rightArm` tip; renders miniature 3D mesh of currently equipped tool or weapon.
* `leftLeg`, `rightLeg`: `BoxGeometry(0.26, 0.55, 0.26)` pivoted at hips.
* Floating HTML/Sprite Nameplate above head showing Name, Health Bar (when in combat), and Role/Heat icon.





### 6.3 Guard Vision Cones & Searchlights (`src/rendering/LightingAndFOVRenderer.ts`)

* **Guard Vision Cone:**
* Every awake guard has a 60° field of view extending `7.0` tiles (`14.0` world units) in their facing direction.
* Each frame, cast 25 rays across the `-30°` to `+30°` arc on the guard's layer against opaque wall/door tiles (`BrickWall`, `ReinforcedWall`, closed doors).
* Construct/update a flat `THREE.BufferGeometry` triangle fan `0.08` units above the floor using those ray hit points.
* Material: Semi-transparent yellow (`#eab308`, `opacity: 0.22`) normally; turns crimson red (`#ef4444`, `opacity: 0.38`) when the guard is chasing or alerted.


* **Night Searchlights:**
* During `LIGHTS_OUT` (`23:00–08:00`), 4 watchtower spotlights sweep back and forth along Lissajous patrol paths across the outdoor yard (`ZoneType.YARD` and perimeter).
* If the player enters a searchlight radius (`3.0` tiles) at night without a Guard Outfit, Heat increases by `+35%` per second and alarms sound.



---

## 7. Detailed Gameplay Mechanics & Mathematical Formulas

### 7.1 Prison Clock & Routine Engine (`src/core/ClockSystem.ts`)

* **Time Scale:** `1.0` real-time second = `1.0` in-game minute (a full 24-hour cycle takes 24 real minutes; provide a debug `[Tab]` key to toggle `1x / 5x` clock speed).
* **Attendance Verification (`isAttended`):**
* During `MORNING_ROLL_CALL`, `BREAKFAST`, `WORK_PERIOD` (if employed), `EXERCISE_PERIOD`, `SHOWER_BLOCK`, `EVENING_MEAL`, and `EVENING_ROLL_CALL`, a routine attendance timer counts down for **20 in-game minutes** after the block begins.
* As soon as the player steps onto any tile belonging to the required `ZoneType`, `routineAttended = true` (show a green checkmark on the HUD Routine Banner).
* If the player never enters the required zone during the entire phase:
* If it was a **Roll Call** phase: Trigger immediate **Lockdown** (`Heat = 100%`, guards hunt the player).
* If it was Meal/Shower/Exercise: Add `+25% Heat`.




* **Morning Roll Call Shakedown Event:**
* At `08:15` every morning, the Warden announces 2 cells for inspection (e.g., `"Cell Shakedown: Cell 1 and Cell 5!"`).
* A designated Shakedown Guard paths to those cells and inspects the `DESK` (confiscating any contraband in the 10 standard slots; ignoring the 6 hidden slots) and checks adjacent cell walls/floors for uncovered damage.



### 7.2 Heat, Disguises & Contraband Detectors (`src/systems/HeatAndSecuritySystem.ts`)

* **Heat Decay:** Drops by `1%` every 4 in-game minutes when below `80%` and out of guard line-of-sight.
* **Infractions Inside Guard Vision Cone:**
* Attacking an inmate or guard -> **Instant `100%` Heat**.
* Digging, chipping a wall, cutting a fence, or unscrewing a vent -> **Instant `100%` Heat**.
* Carrying a visible weapon/tool in active hand -> `+40% Heat / sec`.
* Standing in a restricted zone (`GENERATOR_ROOM`, `GUARD_QUARTERS`, `ROOF`, `VENTS`, or outside cell during `LIGHTS_OUT`) without a `guard_outfit` -> **Instant `100%` Heat**.
* Standing outside cell during `LIGHTS_OUT` **with** a `guard_outfit` equipped:
* Legal from a distance! However, if the player stays within `2.5` tiles of a guard's vision cone for more than `2.0` seconds, suspicion builds (`+50% Heat / sec`).
* **Bed Dummy Check:** During `LIGHTS_OUT`, a night-patrol guard walks past the cell block windows at `00:30` and `04:00`. If the player is not in `PLAYER_BED` AND `playerBed.hasBedDummy === false`, **Lockdown triggers immediately**.




* **Contraband Detector Archways:**
* When any entity crosses a `CONTRABAND_DETECTOR` tile while `powerGrid.isPowered === true`:
* Check all items in the entity's inventory. If any item has `isContraband === true`:
* If the entity holds a `contraband_pouch` with `durability > 0`, decrement pouch durability by `1` and pass silently.
* Otherwise, flash red strobe lights on the detector, play buzzer alarm, add `+50% Heat`, and dispatch the nearest 2 guards to inspect/chase the player.





### 7.3 World Destruction, Dirt Management & Concealment (`src/world/WorldGrid.ts`)

* **Tile Health & Tool Matrix:**
* `BRICK_WALL`: `maxHp = 100`, requires `TOOL_CHIPPING` (or `TOOL_DIGGING` at 50% efficiency). Drops `concrete_block` at `0 HP`.
* `PERIMETER_FENCE`: `maxHp = 100`, requires `TOOL_CUTTING`.
* `ELECTRIC_FENCE`: `maxHp = 120`, requires `TOOL_CUTTING`. **Fatal Shock Rule:** If `powerGrid.isPowered === true`, attempting to cut an `ELECTRIC_FENCE` deals `999` damage (instant knockout) and sparks violently.
* `VENT_GRATE`: `maxHp = 60`, requires `TOOL_UNSCREWING` or `TOOL_CUTTING`.
* `DIRT_GROUND` (Tunnel entrance or underground): `maxHp = 100`, requires `TOOL_DIGGING`.


* **Digging & Tunnel Physics:**
* Pressing `[Space]` or `[Left-Click]` with a digging tool equipped while standing on a valid floor tile digs a `TUNNEL_ENTRANCE` connecting Layer `0` and Layer `-1`.
* Completing a tunnel entrance or digging a horizontal wall on Layer `-1` inserts `1x Pile of Dirt` (`dirt_pile`) directly into the player's inventory (or drops it at the player's feet if inventory is full).
* **Guard Discovery Rule:** If a guard's vision cone ever touches:
1. An uncovered broken wall/fence/vent/tunnel (`concealmentItemId === null`), OR
2. A `dirt_pile` or `concrete_block` lying on the ground on Layer 0:


* The guard blows their whistle -> **Immediate Lockdown & Solitary Confinement**.


* **Tunnel Bracing Rule:** On Layer `-1`, after digging 2 consecutive tiles without placing a `timber_brace`, attempting to dig a 3rd adjacent tile causes a **Cave-In** (deals 40 HP damage and refills the tile with dirt). Placing a `timber_brace` stabilizes a `3x3` underground area.



### 7.4 Combat, Knockouts & The Missing Guard Key Rule (`src/systems/CombatSystem.ts`)

* **Melee Combat Formula:**

$$\text{Damage} = \max\left(2, \left\lfloor \frac{\text{Attacker.Strength}}{10} \right\rfloor + \text{Weapon.damageBonus} - \left\lfloor \frac{\text{Defender.DefenseBonus}}{3} \right\rfloor\right)$$


$$\text{SwingCooldown} = \max\left(0.35\text{s}, 0.95\text{s} - (\text{Attacker.Speed} \times 0.005\text{s})\right)$$


* **Unconscious State & Looting:**
* When an NPC's `hp` reaches `0`, they enter `AIState.UNCONSCIOUS` for **30 real seconds**, lying flat on the ground with spinning 3D yellow stars above their head.
* Pressing `[E]` near an unconscious NPC opens their 6-slot inventory + equipped outfit + equipped weapon.


* **The Guard Key Rule (Critical Escapists Mechanic):**
* Each of the 5 on-duty patrol guards carries one specific key (`YELLOW`, `CYAN`, `PURPLE`, `RED`, or `GREEN`).
* When a guard is knocked out, the player can take their `key_[color]`, craft a `mold_[color]` using `wad_of_putty`, and **place the real `key_[color]` back into the unconscious guard's inventory before the 30-second KO timer expires**.
* If the guard wakes up (`KO timer === 0`) and their assigned `key_[color]` is missing from their inventory, they immediately radio Control -> **Instant Prison Lockdown + Solitary Confinement if caught**.



### 7.5 Prison Jobs, Quotas & Economy (`src/systems/JobSystem.ts` & `FavorAndEconomySystem.ts`)

* **Job System:** The player can hold 1 job at a time via the `JOB_BOARD` prop in the main corridor (gated by `Intellect`). During `WORK_PERIOD` (`12:00–15:00`), completing the daily quota pays out cash (`$`) and avoids getting fired:
1. **Laundry (Req: 20 INT, Pay: $30):** Take dirty uniforms from `LAUNDRY_DIRTY_BIN` -> place in `LAUNDRY_WASHER` (wait 5s) -> transfer clean uniforms to `LAUNDRY_CLEAN_BIN` (Quota: 4 loads). *Bonus:* Spawns 1 stealable `guard_outfit` per day!
2. **Janitor (Req: 25 INT, Pay: $35):** Equip `mop` from Janitor Closet -> clean 6 randomly spawned dirty floor puddles around the hallways.
3. **Kitchen (Req: 30 INT, Pay: $40):** Take raw food from `KITCHEN_FREEZER` -> cook in `KITCHEN_OVEN` (wait 5s) -> place cooked trays on `KITCHEN_SERVING_TABLE` (Quota: 4 trays).
4. **Woodshop (Req: 40 INT, Pay: $50):** Take `timber` from `WOOD_SUPPLY_BIN` -> craft furniture at `WOOD_WORKBENCH` -> place in `WOOD_OUTPUT_BIN` (Quota: 3 pieces). *Bonus:* Free access to steal `timber` (must smuggle past Contraband Detector at door!).
5. **Metalshop (Req: 60 INT, Pay: $65):** Take `sheet_metal` from `METAL_SUPPLY_BIN` -> stamp license plates at `METAL_PRESS` -> place in `METAL_OUTPUT_BIN` (Quota: 4 plates). *Bonus:* Free access to steal `sheet_metal`.
6. **Mailman (Req: 50 INT, Pay: $55):** Pick up mailbags at `MAIL_SORTING_DESK` and deliver letters to 3 designated inmates.


* **Inmate Merchants & Favors:**
* 3 of the 7 AI inmates have a shop icon above their heads during Free Time and sell 4 rotating contraband items daily.
* Price Discount Formula based on Inmate Opinion (`0–100`, default `50`):

$$\text{FinalPrice} = \text{round}\left(\text{Item.baseValue} \times \left(1.5 - \frac{\text{Opinion}}{100}\right)\right)$$


* Inmates with an exclamation mark (`!`) offer **Favors** paying `$20–$50` and `+15 Opinion`:
* *Delivery Favor:* Find a specific item in desks and bring it to the inmate (`[E]` to hand over).
* *Retrieval Favor:* Knock out a specific target inmate, take their stolen item, and return it.
* *Beatdown Favor:* Knock out a rival inmate (`"Teach [Name] a lesson"`).
* *Roll Call Distraction:* Start a fight during the next Roll Call.





### 7.6 The 4 Escape Win Conditions (`src/systems/EscapeEvaluator.ts`)

When the player steps onto any `TileType.ROAD_ESCAPE` tile on the outer edge of the map (`x <= 1 || x >= 62 || z <= 1 || z >= 62`), trigger the **Escape Victory Cinematic & Score Summary**! The map must support all 4 classic escape strategies:

1. **The Classic Perimeter Cutout:** Craft a `bed_dummy`, `contraband_pouch`, `guard_outfit`, and `sturdy_cutters`. During `LIGHTS_OUT`, place the `bed_dummy` in bed, sneak out using a cloned `plastic_key_yellow`, enter the `GENERATOR_ROOM` (`plastic_key_purple` or vents), shut off the `GENERATOR` to disable the outer `ELECTRIC_FENCE` and searchlights, and cut through the outer fence before the maintenance guard turns the generator back on.
2. **The Great Underground Tunnel:** Acquire `timber` (for braces) and shovels/multitool. Dig a `TUNNEL_ENTRANCE` under your cell desk (or cover it), flush all `dirt_pile` items in the toilet, and dig south/west on Layer `-1` all the way past `x = 3` beneath the electric fence, then dig upward to surface on the escape road.
3. **The Rooftop Grapnel Breakout:** Unscrew the `VENT_GRATE` in your cell (`screwdriver`), cover it with a `fake_vent_cover`, crawl through Layer `+1` ducts to the roof hatch (`Layer +2`), use a `grapnel` to zip across the inner fence to the outer gatehouse roof, and use a `sheet_rope` to descend outside the perimeter.
4. **The Prison Takeover (Riot Escape):** Train `Strength` and `Speed` to `90+` in the Gym, craft a `plated_outfit` and `nunchucks` or `spiked_bat`, recruit 2 high-opinion inmate allies (`Opinion >= 80`), and knock out at least **7 of the 8 guards** simultaneously. The prison enters `PRISON_TAKEOVER` state and the main south perimeter gates automatically swing open!

---

## 8. User Interface & Controls Specification (`src/ui/`)

### 8.1 Controls Binding

* **`W, A, S, D` / Arrow Keys:** Move player on current layer.
* **`E`:** Context-sensitive Interact (Open Desk/Loot NPC, Sit in Chair, Sleep in Bed, Use Toilet, Toggle Generator, Climb Ladder/Enter Vent, Talk/Trade/Accept Favor from Inmate, Apply Concealment Item to damaged wall).
* **`Space` or `Left-Click` on adjacent tile/NPC:** Use currently selected hotbar tool (Dig, Chip, Cut, Unscrew) OR swing melee weapon at locked-on target.
* **`R`:** Lock/Unlock combat target on nearest NPC within `4` tiles.
* **`C`:** Open/Close **Crafting & Recipe Handbook Modal**.
* **`1 – 6`:** Select active hotbar inventory slot.
* **`Q`:** Drop currently selected hotbar item onto the ground tile.
* **`Mouse Wheel`:** Zoom orthographic camera in/out.

### 8.2 HUD & Modal Layout (HTML/CSS Overlay)

1. **Top Status Bar:**
* **Digital Clock & Day Counter:** `DAY 1 — 08:15`
* **Routine Banner:** Current Phase name (`MORNING ROLL CALL`), required zone (`Roll Call Yard`), and Attendance badge (`PENDING` yellow / `ATTENDED` green).
* **Player Bars:** Health (`HP`), Stamina (`ENERGY`), and Guard Heat (`HEAT 0%–100%` with animated siren icon when >= 80%).
* **Stats & Cash Pill:** `STR: 40 | SPD: 40 | INT: 40 | $125`
* **Elevation Indicator:** Current layer badge (`LAYER 0: GROUND` / `LAYER -1: TUNNELS` / `LAYER +1: VENTS` / `LAYER +2: ROOF`).


2. **Bottom Hotbar:**
* 6 Inventory Slots + 1 Weapon Slot + 1 Outfit Slot.
* Contraband items display a distinct red warning border (`#ef4444`) and `"CONTRABAND"` tag on hover.
* Tools show a mini durability bar underneath the icon.


3. **Desk & Looting Modal:**
* Left side: Player's 6 slots.
* Right side (when opening a Desk): Top section labeled **"HIDDEN COMPARTMENTS (Safe from Shakedowns)"** (6 slots, dark green border) + Bottom section labeled **"STANDARD DRAWERS"** (10 slots).



---

## 9. Step-by-Step Autonomous Implementation Plan (Phases 1 to 8)

Execute the implementation in these **8 sequential phases**. Do not skip ahead or leave placeholder `TODO` stubs—complete each phase fully and verify compilation before proceeding.

### Phase 1: Project Scaffolding, Types & Databases

1. Initialize Vite + TypeScript + Three.js + Zustand configuration.
2. Create `src/types/game.types.ts` with all enums and interfaces from Section 2.
3. Create `src/config/constants.ts`, `src/config/items.data.ts` (all 76 items), `src/config/recipes.data.ts` (all recipes), and `src/config/routines.data.ts`.
4. **Verification:** Run `npx tsc --noEmit`.

### Phase 2: 4-Layer World Grid, Map Generator & Three.js Cutaway Renderer

1. Implement `src/world/WorldGrid.ts` and `src/config/centerPerks.map.ts` generating the complete `64x64` 4-layer prison layout (Cells, Roll Call, Canteen, Gym, Library, Showers, 6 Job Rooms, Generator Room, Guard Quarters, Solitary, Vent network on Layer +1, Roofs on Layer +2, and Dirt on Layer -1).
2. Implement `src/rendering/TextureFactory.ts` and `src/rendering/AssetFactory.ts` to procedurally generate all tile textures, furniture props (beds, desks, toilets, gym gear, generators, contraband detectors), and 3D blocky character meshes.
3. Implement `src/rendering/SceneManager.ts`, `src/rendering/OrthographicCameraRig.ts`, `src/rendering/InstancedWorldRenderer.ts`, and `src/rendering/CutawaySystem.ts`.
4. **Verification:** Run `npx tsc --noEmit`.

### Phase 3: Player Controller, Elevation Transitions & Clock/Routine System

1. Implement `src/core/InputManager.ts`, `src/entities/Entity.ts`, and `src/entities/PlayerController.ts` with grid AABB collision, stamina consumption/regeneration, and vertical layer transitions (climbing onto desks -> entering vents, climbing ladders to roof, descending into tunnels).
2. Implement `src/core/ClockSystem.ts` and `src/world/DoorManager.ts` (24h clock, routine transitions, attendance checks, color-coded doors auto-locking at night).
3. Implement `src/rendering/LightingAndFOVRenderer.ts` for smooth day-to-night lighting transitions and rotating outdoor night searchlights.
4. **Verification:** Run `npx tsc --noEmit`.

### Phase 4: Inventory, Desks, Crafting Engine & World Destruction

1. Implement `src/world/ContainerManager.ts` (populating cell desks daily with weighted random items, supporting 6 hidden slots + 10 standard slots).
2. Implement `src/systems/CraftingSystem.ts` (order-independent 2/3-slot recipe matching, Intellect requirement check, non-destructive key molding).
3. Implement tool usage in `PlayerController.ts` and `WorldGrid.ts`: chipping walls, cutting fences, unscrewing vents, digging underground tunnels, generating `dirt_pile` items, flushing dirt in toilets (with 3-flush clog cooldown), placing `timber_brace` supports, and covering holes with `poster`, `fake_wall_block`, `fake_vent_cover`, and `fake_fence_cover`.
4. **Verification:** Run `npx tsc --noEmit`.

### Phase 5: 3D A* Pathfinding, Guard AI, Vision Cones & Heat/Solitary System

1. Implement `src/systems/PathfindingAStar.ts` supporting multi-layer navigation and door clearance weights.
2. Implement `src/entities/GuardEntity.ts` and `src/systems/HeatAndSecuritySystem.ts`:
* Real-time 60° raycasted Vision Cone meshes clipped against walls.
* Detection of illegal actions, restricted zones, uncovered structural damage, and dropped dirt.
* Nighttime `bed_dummy` inspection and `guard_outfit` disguise mechanics.
* `CONTRABAND_DETECTOR` archway scanning and `contraband_pouch` bypass.
* `PowerGridSystem.ts` linking the `GENERATOR` to electric fences, detectors, and searchlights (plus Guard AI paths to turn the generator back on after 45 seconds).
* Solitary Confinement sequence (confiscating contraband, repairing discovered holes, potato-peeling minigame).


3. Implement `src/entities/SniperSystem.ts` for outdoor lethal shots when `Heat >= 90%`.
4. **Verification:** Run `npx tsc --noEmit`.

### Phase 6: Inmate AI, Combat, Key Cloning, Jobs, Training & Favors

1. Implement `src/entities/InmateEntity.ts` following daily routines, wandering during Free Time, and fighting.
2. Implement `src/systems/CombatSystem.ts`: melee lock-on, damage/defense calculation, 30-second unconscious timer, inventory looting, and the **Missing Guard Key Lockdown Check** when a guard wakes up.
3. Implement `src/systems/TrainingSystem.ts` (Gym Strength/Speed minigames & Library Intellect reading).
4. Implement `src/systems/JobSystem.ts` (all 6 prison jobs, daily quota workflows, wage payouts) and `src/systems/FavorAndEconomySystem.ts` (Inmate merchants, Opinion-scaled prices, and procedural Favor quests).
5. **Verification:** Run `npx tsc --noEmit`.

### Phase 7: Complete UI/HUD Overlays, Audio Synthesizer & Escape Evaluators

1. Implement `src/audio/SoundManager.ts` using Web Audio API oscillators and noise buffers for footsteps, wall chipping, fence cutting, detector buzzers, lockdown sirens, combat hits, and UI clicks.
2. Implement all UI views in `src/ui/` (`HUDView.ts`, `InventoryAndDeskModal.ts`, `CraftingModal.ts`, `JobAndFavorModal.ts`, `MinigameOverlay.ts`) styled in `src/style.css`.
3. Implement `src/systems/EscapeEvaluator.ts` verifying all 4 escape paths (Perimeter Cut, Underground Tunnel, Rooftop Grapnel/Sheet Rope, and Prison Takeover Riot) and rendering the Victory Summary Screen.
4. **Verification:** Run `npx tsc --noEmit` and `npm run build`.

### Phase 8: Save/Load Persistence, Particle Polish & Final QA Check

1. Implement `src/core/SaveManager.ts` (auto-saving every morning at `08:00` plus manual Save/Load buttons in the HUD).
2. Add `src/rendering/ParticleSystem.ts` for visual feedback on every action (dust when chipping, dirt when digging, sparks on electric fences, water in showers, Zzz particles when sleeping).
3. Run a full end-to-end build verification (`npm run build`) and ensure the game launches immediately into a playable state with an interactive tutorial/controls helper panel.