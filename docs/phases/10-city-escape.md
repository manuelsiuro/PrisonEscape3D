# City Escape (v2.46 on)

A second game mode beside the prisons: a generated post-apocalyptic city to survive and escape. The
user's request (2026-11-13), their choices and the design are in
[`../source/city_escape_design.md`](../source/city_escape_design.md); where the build departs from it,
[`../decisions/city.md`](../decisions/city.md). This file is the roadmap: four stages, each a vertical
slice (rules, picture, phone and desktop screens, both languages, tests) released as usual, the menu
entry shown only with `?city` in the address until the last one (the user's choice).

## How it fits the code

The manhunt (P41) is the precedent: a deterministic simulation of its own on a map made in code,
sharing the engine and none of the prisons' rules. City Escape goes one step further: no prison game
is in progress while it runs.

```
src/city/
  id.ts               isCity(def): the view's one question about a city's world (no city code comes with it)
  save.ts             the city's save slot and whether the mode shows on the title (read by the title: no city code)
  content/            data: the districts' kinds, names and blocks (later: items, recipes, the dead, quests)
  gen/                the generator, pure: plan.ts (the 3 × 3 plan from a seed), district.ts (one 64 × 64 district)
  sim/                the rules, deterministic as src/sim: City.ts (step(cmd), events, snapshot), world.ts (a district's World)
  render/             CityView: what the World doesn't draw (wrecks, the bus, trees, the roofs past the fences)
  ui/                 its HUD, the map's painter, its screens (new city, the story card, the city's map)
  play/               city.ts (the run: steps, frame, keys, taps, pause, save), flow.ts (from the title)
src/styles/46-city.css
scripts/citygentest.ts, citytest.ts
```

**The seams in the shared code** (each a few lines, none changing a prison's behaviour):
- `play/game.ts`: `play.side`, a `SideRun` (frame, key, tap, paused): a mode of its own in place of a
  game. `play/loop.ts`, `play/keys.ts`, `play/guide.ts` and `play/pad.ts` hand it the frame, the
  keys, the taps and the pad when it is set.
- `play/lazy.ts`: `cityFlow()`, the city's part fetched when first opened; `main.ts` holds its place
  on the page.
- `flows/title.ts`, `ui/screens/title.ts`: the `city` choice and its button (only where `cityOn()`).
- `game/storage.ts`: `KEYS.citySave` (wiped by Reset progress with the rest).
- `render/ground.ts`, `render/WorldView.ts`: for a city's world, no ring road line, no ring of trees,
  duller ground past the edge.
- `World` is used as it is, through a definition with no cells, guards, jobs or zones
  (`city/sim/world.ts`), what stands on the streets set in `parked` and `veil` as the manhunt does.

**Rules that hold for every stage**
- `src/city/sim/` and `src/city/gen/` follow the simulation's rules (`CLAUDE.md`): fixed 20 Hz steps,
  whole-number positions, no `Math.random`, `Date` or DOM; every input a packed command; new state
  fields at the end, optional on load.
- Nothing is added to `PRISONS`, `ITEMS`, `RECIPES`, `ZONES` or the prisons' state: the escape bots
  stay byte-identical (`escapetest`'s snapshot is the proof at each stage).
- The city's own items and recipes (stage 2) live in `src/city/content/`, with the prisons' item
  model (`ItemState`, `craft`) reused where it takes a table.

## The stages

### C1. Foundations (v2.46.0): built

The city generated, walked and mapped.

- **The plan** (`gen/plan.ts`): from a seed, nine districts one of each kind (downtown in the middle,
  the suburbs in a corner as the start, hospital, docks and metro never beside it), three lanes each
  way per grid column and row, a tree of open borders plus half the others, one or two checkpoints per
  open border, the docks' sea on the city's edge, a name per district.
- **A district** (`gen/district.ts`): the border (wall, fence or sea), streets on the lanes, the
  blocks between them filled by the kind's weights (buildings cut into lots by alleys, with rooms,
  street doors and furniture; car parks, greens with ponds, squares, yards), the landmark in the
  largest block, piers at the docks, wrecks and rubble on the streets, sandbags at each checkpoint,
  the bus and the start in the suburbs. Whatever stands on a tile is placed only where it cuts
  nothing off (a 3 × 3 test), and a room found shut in gets a door.
- **The simulation** (`sim/City.ts`): the player walks the district's `World`; on a checkpoint's
  tiles, across to the neighbour (a tile in from its border, on the same street); the clock (06:30 on
  day 1, a game minute a second); the tiles seen so far per district (a disc of 7 round the player);
  snapshot and load, a damaged save refused.
- **In play** (`play/city.ts`): the stick, keys, a tap to walk, a pad; `M` the map; the pause card
  (Settings, How to play, back to the title); saved on entering a district, on pausing, when the page
  is hidden or closed; one city in progress (Continue or a new one, asked first).
- **On screen:** the HUD (district and place, the day and time, the corner map), the city's map
  (districts as seen, checkpoints, the legend), the new city's card (Survivor or Hardcore), the
  story's first card; the district's own pieces in 3D (`render/CityView.ts`).
- **Proved:** `citygentest` (60 cities, 540 districts: legal maps, every open tile, checkpoint and
  street door walked to, the plan's rules, twice the same) and `citytest` (a bot round all nine
  districts of 12 cities, the same commands the same city, saved and loaded the same, damaged saves
  refused, the clock).
- **Not in it yet** (the new city's card says so): hunger, loot, the dead, shelters, quests, the
  ways out; death's two modes are chosen and stored but nothing kills.

### C2. Survival

Health, hunger and energy; the city's items and loot by place; searching furniture; the pockets and
crafting panels on the city's lists; weapons and the fight; the dead (shamblers first: by day in the
dark, at night everywhere), noise and light; shelters (claim, bar, light, stash, sleep); dusk and
night's warnings; death in both modes; the night's picture (unlit interiors dark, a torch's cone).
Proved by a survival bot: seven days alive on many seeds without leaving two districts.

### C3. The story and the ways out

The radio and Dispatch, the five acts and their objectives (the objectives screen, markers on the
map), notes and logs, survivors with errands and trade, runners and brutes, the three ways out with
their parts and last nights, the end card, the city's own achievements. Proved by a bot winning each
way out on many seeds, and a validator that every part can be reached before it is needed.

### C4. The finish

The palette and dressing (overgrowth, dust, signage, the landmarks' own models), sounds and music of
its own, How to play's topics and pictures, a short tutorial, the gamepad and phone passes, the
French read through, performance on a phone, an independent review; then the menu entry shown to
everyone.

## Proof, stage by stage

| Stage | Version | Tests added | Moved snapshots | Played in the browser |
|---|---|---|---|---|
| C1 | 2.46.0 | `citygentest`, `citytest` | `docstest` counts, `tokentest` (a stylesheet), `i18ntest` (keys) | desktop, 412×915, 915×412: new city, the Intake, the story card, walking, three checkpoints, the map, Continue |
