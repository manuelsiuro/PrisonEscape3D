# Picture review of every prison (session 14, v2.36.0)

Session 14 of the improvement queue (`BACKLOG.md` §4): day and night, materials, shadows and light,
looked at as an art director would, then the clear wins fixed (as the street lamps were in 2.34.1).
The user wasn't there to pick (their goal of 2026-11-07: the sessions run on their own), so Claude
picked; the picks are below and in `POLISH.md`'s "Look and light" row.

## How the pictures were taken

The dev build, `scripts/dev/playat.ts`'s `at` and `put` (the model prisoner's day 1 played to the
moment, the player set on a tile), the game held still and its canvas kept. The weather and the hour
were forced on the frame the view draws (as `drawhash.ts` does), so the sim never moved.

- **Where:** all five prisons and the Training Block: the cell at 07:50, the canteen or corridor at
  12:10, the yard and the sports ground at noon, 06:30, 19:30 (dusk), 23:00 (the 2.35 dark), the cell
  at 23:30 (Lights Out), and the yard in rain, fog, a heatwave, snow, a storm at night and fog at night;
  the manhunt's outside of each prison at night and by day.
- **Sizes:** desktop 1280×800, phone portrait 412×915 and landscape 915×412 (an Android profile).
- **Kept** in the session's scratchpad, not the repository (about 130 pictures and contact sheets).

## Findings

Cost is per frame on the phone's tier (1024 shadow map): draw calls, triangles, frame time.

| # | Prison, moment | What's wrong | Proposed fix | Cost | Picked |
|---|---|---|---|---|---|
| 1 | All, 21:00–05:00 | The night is noon dimmed: the ambient's sky stays day's white and its bounce grass-green, so the grass is a saturated green, and the warm pools barely stand out of it | Moonlight: the ambient's sky moon-blue and its bounce dark slate as the night falls, lifted to hold the same brightness (nothing goes black) | 0 calls, 0 tris, 0 ms (two colours) | **Yes** |
| 2 | All, 21:00–05:00 | A lamp's pool is a soft glow: half strength at 1.2 tiles, a quarter at 2.5. The dark rule (2.35) lights every tile within 2.5 tiles of the head, so where a guard sees by lamplight never showed | The pool evenly lit to the rule's reach (half strength still at 2.5 tiles) and gone at 3, the same instanced mesh with its own texture | 0 calls, 0 tris, 0 ms | **Yes** |
| 3 | All, rain, storm and fog by day | The sun's shadows stay noon-crisp under the cloud: a rainy day reads as a sunny one with streaks | The sun's shadow fades under cloud: 40% off in rain, 60% in a storm, 30% in fog (`shadow.intensity`) | 0 calls, 0 tris, 0 ms | **Yes** |
| 4 | Stalag Flucht, all day | Snow-white wall tops on snow-white ground: the rooms read only by their floors and the brick strips; at night the lit canteen and gym look darker than the snow outside, where the dark rule calls them lit | Wall tops a step darker (stone with a snow speckle); the alpine room pools brighter | 0 | No: a look the user chose for the alpine prison; every Stalag photo and picture changes |
| 5 | San Pancho, by day | The adobe wall tops are the yard's dirt colour, and orange jumpsuits stand on orange dirt: the yard's walls and people blend | A darker adobe cap or a paler yard; or a faint ring under the player, as the manhunt has | 0 (a ring: 1 call, 2 tris) | No: the theme's palette and a player marker are the user's to judge |
| 6 | Center Perks, Shankton, Irongate, Training | The wall tops, the largest surface on screen, are one flat grey speckle with no edge: from this camera they read unfinished | A lighter rim along the caps' edges, or joints every few tiles | 0 calls, 0 tris | No: changes every map photo and help picture; a matter of taste for the user |
| 7 | All, fog | The veil lies over open ground only, its mask a texel a tile: the wall tops stand crisp above a fog bank cut at the walls, like a highlighted box | Blur the mask when it's built (a 3×3 box), the fog thinning over a tile | 0 at run time | No: the fog keeping off roofs is meant (P17); low gain |
| 8 | All, heatwave | The haze hardly shows (2% darker, a faint warm tint) | A stronger warm grade, a shimmer | 0 to 1 call | No: low gain |
| 9 | Center Perks, San Pancho, Irongate | A lamp's pool reaches through walls: 2, 4 and 4 cell tiles (and 18, 13 and 13 room tiles) lie within 2.5 tiles of a lamp across a wall. The rule and the 3D agree (both light them), so a cell's floor glows warm from a lamp outside and counts lit after Lights Out | The rule's pool stopping at walls (a line test), behind `Sim.rules235`, and the 3D's pool clipped alike | 0 in the view; a sim rule | No: a sim rule of 2.35, not the render's; for the user |
| 10 | All, by day, phone tier | A lamp's head casts its shadow on the grass, the 6 cm pole's shadow under a texel of the 1024 map: the head's shadow floats apart | None worth its cost (a thicker pole in the shadow pass only) | 1 call | No: minor |

**Looked for and not found:** shadow acne or peter-panning at either tier, z-fighting (the pools sit
over every floor at 0.008), popping, things floating or sunk, the map's edge (the camera never shows
it), the sky against the fog (the fog's colour follows the sky). Dawn (06:30) and dusk (19:30) share
one rose grade, which reads well; the manhunt's outsides read at night (the pale ring at the player's
feet finds them).

## What was done (the picks)

- **Moonlight** (`render/viewLight.ts`): `MOON_SKY`, `MOON_GROUND` and `MOON_LIFT`; the lockdown's red
  pulses over it as before. Mean brightness of the night pictures held: Center Perks' yard 38 → 41,
  Stalag Flucht's 69 → 69, San Pancho's 50 → 51, Shankton's 43 → 44 (of 255).
- **Pools to the rule's reach** (`render/lights.ts`): `poolTexture()`, `POOL` (6 tiles across), its
  half-strength stop placed at `LAMP_LIT`. No lamp moved; `sim/ai/light.ts` untouched.
- **Overcast shadows** (`render/viewLight.ts`): `OVERCAST_SHADOW`, `STORM_SHADOW`, `FOG_SHADOW`, eased
  with the weather.

## Proof

- `drawhash.ts` (baseline taken on the old code, then twice the same): of 258 frames, the 102 that
  changed are exactly the night and evening ones (18:40, 23:30, the manhunt's 23:40 and 06:30) and the
  forced weather; every daytime frame, the title, the Intake's preview and the map viewer's picture are
  byte-identical.
- `perfprobe.ts`'s `check()` in the phone's profile: all 36 scenes within `perfbudget.json`.
- The map viewer's photos (10:00, clear) are unchanged, the outsides' too (checked: no night, no weather
  at 10:00): none retaken.
- How to play's pictures with the new light, each retaken in its own frame and compared pixel by pixel
  with the old: `night`, `towers`, `smuggling`, `talent`, `quiz`, `bluff` and `dogs`. Kept as they were:
  `games`, `cheat`, `hoops` and `checkers` (9 to 14% into the evening, indoors: no visible change),
  `layers` and `weather` (in the tunnels: under 2%), and `library`, `vending` and `menu` (rain on an
  indoor scene, the shadows a little softer; the current camera no longer frames them as they were).
- The browser: desktop, 412×915 and 915×412, by day, at night and in a storm; console clean. No text
  changed.
- `npm test`: 71 of 71, after one snapshot accepted: `budgettest` counts one more shared texture in every
  prison (the pool's, made once and kept, as the glow's). The escape bots and `stealthtest` unchanged.
