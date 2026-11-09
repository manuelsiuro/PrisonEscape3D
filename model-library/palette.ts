/**
 * Prison Escape 3D - Standard Game Color Palette & Style Guidelines
 *
 * All procedural models MUST strictly follow the game's low-poly aesthetic and color discipline:
 *
 * 1. MANDATORY LOW-POLYGON BUDGET:
 *    - Rely on clean angular silhouettes, not round subdivision.
 *    - Use boxes for 90% of structural elements (12 triangles per box).
 *    - Use 6-sided rods/tubes for pipes, bars, conduits, and legs.
 *    - Use 6 to 8 segments for round features (cups, wheels, dials, barrels).
 *    - Typical prop budget: 50 to 250 triangles.
 *    - Typical fixture/machinery budget: 200 to 700 triangles.
 *    - Hard ceiling: 1,400 triangles (enforced by `validateBlueprint`).
 *
 * 2. PALETTE DISCIPLINE (THE 3-TO-5 COLOR RULE):
 *    - Every model should use BETWEEN 2 AND 5 COLORS MAXIMUM.
 *    - Never use random, saturated, or rainbow palettes.
 *    - Reuse the curated institutional/industrial color tokens defined below.
 *    - A typical game prop consists of:
 *      • 1 primary structural color (e.g. `METAL`, `WOOD`, or `STEEL`)
 *      • 1 secondary framing/recess color (e.g. `DARK`, `WOOD_DARK`, or `BLACK`)
 *      • 1 surface/detail color (e.g. `WHITE`, `CREAM`, or `CHROME`)
 *      • Optional 1 single accent/indicator color (e.g. `RED`, `CAUTION_YELLOW`, or `BRASS`)
 */

/** Standard color palette matching the game's render engine (src/render/props.ts & decor.ts). */
export const PALETTE = {
  // --- Structural & Ferrous Metals ---
  /** Standard galvanised prison steel, pipes, and metal frames (matches props.ts `METAL`). */
  metal: 0x8d949e,
  /** Light sheet steel, oven bodies, sinks, and canteen counters (matches decor.ts `STEEL`). */
  steel: 0xb8bec6,
  /** Polished chrome trim, handles, bright dials, and hardware. */
  chrome: 0xcfd6df,
  /** Dark chassis steel, heavy equipment bases, and angle iron (matches props.ts `DARK`). */
  dark: 0x3b4048,
  /** Deep shadow, rubber treads, recesses, and black bezels (matches items.ts `DARK`). */
  black: 0x1d2026,
  /** Weathered iron, lantern frames, and forge metal (matches props.ts `IRON`). */
  iron: 0x2a2724,
  /** Aged exhaust rust and oxidised metal. */
  rust: 0x4f4541,

  // --- Woods & Organic Surfaces ---
  /** Standard warm tabletop and bench wood (matches props.ts `WOOD`). */
  wood: 0x9b6a3f,
  /** Dark structural wood, table legs, and shelving uprights (matches props.ts `WOOD_DARK`). */
  woodDark: 0x6e4a2b,
  /** Light pine, cork boards, and packing crates (matches decor.ts `CORK`). */
  woodLight: 0xc49a62,

  // --- Institutional Enamel, Plastic & Porcelain ---
  /** Clean institutional white, porcelain toilets, washing machines, and paper (matches `WHITE`). */
  white: 0xeef1f4,
  /** Cream, ivory enamel, cup ceramic, and vintage dials. */
  cream: 0xf4f2eb,
  /** Security grey, trash bins, and conduit casings (matches props.ts `bin`). */
  grey: 0x5b6470,

  // --- Functional Game Accents (Use sparingly: 1 per model max) ---
  /** Solid brass hardware, keys, padlock bodies, and group heads (matches props.ts desk handle). */
  brass: 0xd4a238,
  /** Warning/emergency red, fire axes, alarms, and hazard levers (matches decor.ts `RED`). */
  red: 0xd23b2e,
  /** Heavy machinery / generator yellow and caution tape (matches props.ts `generator`). */
  yellow: 0xd6a72c,
  /** Industrial oxygen green, plant foliage, and tool grips (matches decor.ts `GREEN`). */
  green: 0x27ae60,
  /** Prison bedding blue, console faceplates, and gym mats (matches props.ts `mat`). */
  blue: 0x2f6fd0,
  /** Light pastel sheet blue (matches props.ts `bed`). */
  blueLight: 0x9fb7d0,

  // --- Weathered city tones (urban decay) ---
  /** Military olive drab canvas, field gear and tactical vehicle panels. */
  oliveDrab: 0x4a533b,
  /** Deep foliage green for encroaching moss, climbing ivy, and cracked asphalt weeds. */
  overgrownGreen: 0x3e5f2d,
  /** Weathered raw concrete for highway jersey barriers, curbs, and decaying slabs. */
  concreteGrey: 0x82888f,
  /** Faded scavenger blue for waterproof tarps, water collection drums, and plastic barricades. */
  tarpBlue: 0x2a5982,
  /** Warm amber for warning lamps and glowing accents. */
  amberGlow: 0xd97724,
} as const;

/** Type of standard palette color keys. */
export type PaletteColorName = keyof typeof PALETTE;
