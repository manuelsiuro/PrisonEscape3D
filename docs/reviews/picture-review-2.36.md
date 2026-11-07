# Picture review of every prison (session 14, v2.36.0)

Session 14 of the improvement queue (`BACKLOG.md` §4): day and night, materials, shadows and light,
looked at as an art director would, then the clear wins fixed (as the street lamps were in 2.34.1).
The user wasn't there to pick (their goal of 2026-11-07: the sessions run on their own), so Claude
picked; the picks are below and in `POLISH.md`'s "Look and light" row. A first round did 1 to 3; the
lead then asked for every finding to be done unless it proved too costly or risky (the second round:
4 to 9). Only 10 is left, with its reason.

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
| 4 | Stalag Flucht, all day | Snow-white wall tops on snow-white ground: the rooms read only by their floors and the brick strips; at night the lit canteen and gym look darker than the snow outside, where the dark rule calls them lit | Wall tops a step darker (stone with a snow speckle); the alpine room pools brighter | 0 | **Yes**, second round: the caps; the rooms' light left (below) |
| 5 | San Pancho, by day | The adobe wall tops are the yard's dirt colour, and orange jumpsuits stand on orange dirt: the yard's walls and people blend | A darker adobe cap or a paler yard; or a faint ring under the player, as the manhunt has | 0 (a ring: 1 call, 2 tris) | **Yes**, second round: a clay cap and a paler yard; no ring (the camera keeps the player in the middle) |
| 6 | Center Perks, Shankton, Irongate, Training | The wall tops, the largest surface on screen, are one flat grey speckle with no edge: from this camera they read unfinished | A lighter rim along the caps' edges, or joints every few tiles | 0 calls, 0 tris | **Yes**, second round |
| 7 | All, fog | The veil lies over open ground only, its mask a texel a tile: the wall tops stand crisp above a fog bank cut at the walls, like a highlighted box | Blur the mask when it's built (a 3×3 box), the fog thinning over a tile | 0 at run time | **Yes**, second round |
| 8 | All, heatwave | The haze hardly shows (2% darker, a faint warm tint) | A stronger warm grade, a shimmer | 0 to 1 call | **Yes**, second round: the warm grade (no shimmer) |
| 9 | Center Perks, San Pancho, Irongate | A lamp's pool reaches through walls: 2, 4 and 4 cell tiles (and 18, 13 and 13 room tiles) lie within 2.5 tiles of a lamp across a wall. The rule and the 3D agree (both light them), so a cell's floor glows warm from a lamp outside and counts lit after Lights Out | The rule's pool stopping at walls (a line test), behind `Sim.rules235`, and the 3D's pool clipped alike | 0 calls; about 1,500 more triangles at night | **Yes**, second round |
| 10 | All, by day, phone tier | A lamp's head casts its shadow on the grass, the 6 cm pole's shadow under a texel of the 1024 map: the head's shadow floats apart | None worth its cost (a thicker pole in the shadow pass only) | 1 call | No: the pole's shadow is there at noon and only thins at a low sun on the phone's tier; a draw call more for it isn't worth it |

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

The second round:

- **Cap stones** (`render/textures.ts`'s `capEdges`): every wall cap a stone a tile, lit on its west and
  south edges (the sun's side), shaded north and east, so a run of them reads as coping with its joints.
  Stalag Flucht's are snow on stone, a shade greyer than the snow on the ground, their edges outlining
  the walls; San Pancho's fired clay, darker than the sand and the plaza round them; Center Perks',
  Shankton's and Training's grey, Irongate's granite, as they were but for the edges.
- **San Pancho's plaza** (`redEarth`): a sun-faded brown, no longer the jumpsuits' orange. The uniforms
  are untouched.
- **The fog's edge** (`render/Weather.ts`): its outdoor mask blurred over the tiles round when it's built,
  so the veil thins over a wall rather than stopping at it.
- **The heatwave**: the ambient warmed toward `HEAT_LIGHT` and 12% brighter as the haze comes in.
- **Lamps stop at walls**, the rule and the 3D alike: `sim/ai/light.ts`'s `lampSees` (a tile is in a
  lamp's pool only if no tile that stops sight, as built, lies between it and the head: a wall does, a
  fence doesn't; integer samples an eighth of a tile apart), on `Dark.walls`, false under `Sim.rules235`
  (older runs light through walls as they did). `render/lights.ts` draws the warm pools tile by tile on
  the tiles `lampSees` passes, one mesh (a quad a tile, about 1,500 triangles for Center Perks' 25
  lamps). The 3D draws the new rule in an older run's replay too (the cones follow the run's rule).

## Proof

The first round:

- `drawhash.ts` (baseline taken on the old code, then twice the same): of 258 frames, the 102 that
  changed are exactly the night and evening ones (18:40, 23:30, the manhunt's 23:40 and 06:30) and the
  forced weather; every daytime frame, the title, the Intake's preview and the map viewer's picture are
  byte-identical. (The second round's caps are in nearly every frame, so `drawhash` has nothing more to
  say there: it's for changes meant to draw nothing new.)

After both rounds:

- `stealthtest`: every tile a lamp lights is one a lamp in reach sees clear, by a line of the test's own
  (floats, a thirty-second of a tile), outdoors in all five prisons; the cell tiles behind a wall from
  every lamp (Center Perks 2, San Pancho 4, Irongate 4) dark after Lights Out and lit under the old
  rules; an older run's `darkNow` lights through walls. Its counts moved only by tiles behind a wall
  (Shankton's lamp tiles 114 → 112, Irongate's 63 → 62 and rooms 596 → 586, Center Perks' rooms
  902 → 901). The escape bots are byte-identical.
- `perfprobe.ts`'s `check()` in the phone's profile: all 36 scenes within `perfbudget.json`, the same
  draw calls in each, about a thousand more triangles at night (Center Perks' 23:30 107k → 108k).
- The map viewer's 3D photos retaken (all six and the five outsides: the caps are on every wall, the
  prison's wall behind the manhunt's outside too); `npm run maps` changed nothing else.
- How to play: 30 pictures retaken at 915×412, each compared with the old pixel by pixel and by eye, the
  same frame and moment: bluff, cams, cheat, crew, delivery, dogs, fight, garden, glider, grounds,
  guards, hoops, inmates, kiosk, layers, mines, night, paperwork, payphone, power, quiz, race, rat,
  shell, smuggling, talent, tattoo, towers, ways, weather. After the review, the other 16 too, at
  1440×844, each shot's zoom found by matching the old picture's scale (a search over crops, then by
  eye) and written into `helpshot.ts`'s `SHOTS`: checkers, football, games (its `after` 10: the bout now
  ends before step 40), goal, holidays, island, library, meals, menu, oddjobs, parole, rollcall,
  showers, train, vending, work. Same frame and moment for most; showers and train show a different
  moment (the crowd has moved since they were taken: who stands at which shower or machine), football,
  goal and island a live play-on's own (the ball, the escape camera's turn, the raft's drift). The
  manhunt's picture has no brick wall (its outside draws the prison's wall in concrete, unchanged).
- The browser: desktop, 412×915 and 915×412, by day, at night, in fog and a storm; console clean. No
  text changed.
- After the independent review: moonlight on the ground floor and roofs only (the tunnels and vents keep
  their own light); door tiles in a lamp's pool drawn (the rule lit them; `poolTiles`, the 3D's list,
  now skips only tiles both solid and opaque), `stealthtest` comparing every tile's lamp light with the
  pool's tiles under both rules (it caught those doors when the old skip was put back: 1 at Center Perks,
  2 at San Pancho, 1 at Irongate); an older run's replay draws the pools through walls as its rule
  does, their mesh built the first time a frame asks. `perfprobe` again in budget (the auto quality
  pinned to the phone's tier for the run: on a busy machine it had stepped down to no shadows).
- `npm test`: every test green; `budgettest` counts one more shared texture in every prison (the
  pool's, made once and kept, as the glow's).
