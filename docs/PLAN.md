# PrisonEscape3D: Project Plan

A 3D web take on *The Escapists*. It is built with the **web-game-playbook** and
**web-sim-game-playbook** skills, starting from `~/ClaudeProjects/web-game-starter`.

Sources:
- `docs/the_escapists_3d_complete_game_design_document.md` (**GDD, the source of truth**);
- `docs/game_idea.md` (feature list);
- `docs/tech_plan.md` (engineering details, used where the GDD says nothing).

---

## 1. Decisions

| Topic | Decision |
|---|---|
| Platforms | **Phone and desktop together** from P0. Keyboard, mouse and touch all produce the same `Command` record |
| Delivery | **Vertical slices**. Every phase is playable, tested and released on GitHub Pages |
| Source of truth | **GDD wins** over tech_plan.md (see §2) |
| Stack | Vite, strict TypeScript, Three.js, plain DOM UI. **No Zustand**: the sim state is plain data that the UI reads |
| Assets | Everything procedural: low-poly models, Canvas2D textures, synthesized Web Audio. No external files |
| Sim | Fixed 20 steps/s, a seeded PRNG in the state, an input log, and keyframe snapshots |
| Languages | English and French through `t()` from day one |
| Saves | IndexedDB for world snapshots, localStorage for settings and the index |
| Repo | `https://github.com/manuelsiuro/PrisonEscape3D`, Pages at `manuelsiuro.github.io/PrisonEscape3D` |
| Dev port | `5310 --strictPort` |

## 2. Conflicts resolved (GDD over tech_plan)

| Topic | tech_plan.md | Decision (GDD) |
|---|---|---|
| Campaign | One map (Center Perks) | **5 prisons**: Center Perks, Stalag Flucht, Shankton, San Pancho, HMP Irongate |
| Item count | 76 | GDD's "77" counts keys, molds and plastic keys once each. As data they are one item per door color, so there are **94 item entries** (`tool_handle`, `grapnel` and `raft` included) |
| Whip reach | 2.5 in the items table, 3.0 in the type comment | **2.5 tiles** |
| L1 detectors | Cell block, Canteen, Gym, Laundry, Woodshop, Metalshop | **Canteen and Woodshop only** (the L1 cell block is unscanned) |
| L1 jobs | 6 jobs | **Laundry (default), Janitor, Kitchen, Woodshop, Mailman**. No Metalshop in L1 |
| L1 rooms | No Infirmary | **Infirmary** present (the player wakes there after a KO by an inmate) |
| L1 towers / perimeter | 4 towers, fully electric | **2 towers** (south). Chain-link on N/E/W, electric only at the south gate |
| Takeover | KO 7 of 8 guards | **KO ≥85% of the guard force** (L1: 5 guards → all 5) |
| Guard cone colors | Yellow, red | **Yellow, orange (investigating), red** |
| Cameras | Not covered | **Tape or toothpaste blinds a camera for 60 s** |
| Snipers | Heat ≥90% outdoors | **Daytime only, 08:00–23:00**. Searchlights replace them at night |
| Attribute decay | Not covered | **−1 per day** for each attribute that isn't trained |
| Energy | Not covered | **Below 10% energy, no tools and no training**. Restores: bed +100, meal +35, shower +2/s, chair +1.5/s, chocolate +15 |
| Solitary | Potato minigame | **2 game hours, or less by peeling potatoes**. Outfit reset, discovered damage repaired |
| Time units | Mixed real and game time | 1 real s = 1 game min. The KO lasts 30 s and the generator comes back after 45 s. Both are counted **in sim steps** (600 and 900) |
| Inmate count (L1) | — | GDD says 8 inmates; the map has 8 cells, so **7 AI inmates + the player** |
| Lockdown without guards | — | Guards arrive in P3. Until then a lockdown lifts after the player spends **60 game minutes in their cell**, leaving **75% heat**. P3 replaces this with capture and solitary |
| Cell doors at Lights Out | — | They lock once their occupant is inside; a door **waits open for an occupant still out** and never shuts on anyone standing in it. Guards (P3) punish being out |
| Blocks spent in a lockdown | — | **Excused**: missing them adds no heat |
| When a missed roll call counts | — | GDD §2.2 says "immediate" lockdown but also gives every block a grace window: it fires **when the block ends** (09:00, 23:00) if the player never stepped into the yard |
| Cells and visitors | — | A cell never locks while anyone but its occupant is inside it |
| Energy and HP bars | P2 in §5 map | Nothing spends Energy or HP before tools (P4) and combat (P5), so both bars arrive **with what uses them**; meals, showers and chocolate restore Energy from then on |
| Shivs | "Sharpen on a wall" | Sharpening is a wall action, so comb and toothbrush shivs come with P5 combat |
| Daily restock | "Restock with randomized items" | At 08:00 containers are **topped up**, never past a cap (desk 6 items), never touching hidden compartments or anything already there; the player's own desk and bed never restock |
| Sleeping | "Sleep in bed" | Sleeping at Lights Out runs the night ×40 (about 13 s); a move or the action button wakes the player, and 07:55 does in any case |
| A lockdown while the player stays out | — | Until guards (P3) it simply lasts: heat stays at 100%, inmates stay in their cells, later blocks are excused. Guards make staying out the losing choice |

Any further conflict found during the build is added to this table in the same commit.

## 3. Architecture

Starter layout (base playbook §2), plus:

```
src/
  sim/
    Sim.ts            step(state, cmd) in a fixed system order, events, keyframes, seek
    state.ts          state layout, snapshot (de)serialization, PRNG streams
    world/            tile arrays per layer, map parser, doors, power grid, containers
    ai/               brain (schedule→goal→path→action), A*, vision, alert ladder
    systems/          clock, movement, actions (tools), crafting, security, combat, jobs,
                      training, economy, escape
    tuning.ts         every gameplay number
  content/
    items.data.ts  recipes.data.ts  routines.data.ts  jobs.data.ts  loot.data.ts
    prisons/<id>/L0.map.ts (L-1, L1, L2 later)  index.ts   (zones, cells, props, spawn, rules)
  render/             instanced tiles, layer cutaway, characters, cones, lights, particles
  input/              keyboard, mouse, touch (stick, context button, tap-to-walk) → Command
  ui/                 HUD, hotbar, sheets/panels (desk, loot, craft, shop, job board), help
scripts/
  *test*.ts           determinism, map validators, recipe graph, economy, bots
  bots/               action-script autopilot + one script per prison × escape route
```

Maps are ASCII pictures in `.map.ts` files (a `String.raw` template) rather than `.txt`, so
the headless tests import them with no loader. The legend lives in `src/sim/world/tiles.ts`.

The system order for each step is: clock → input → AI → movement → actions → combat →
security → economy → escape check.

## 4. Phases (vertical slices)

Each phase ships sim, render, phone and desktop UI, i18n, a help entry and tests, then a
release with `npm version`. Visual checks are done at desktop size, 412×915 and 915×412.

| Phase | Version | Content | Proof |
|---|---|---|---|
| **P0 Kickoff** | 0.1 | Copy the starter, rename, git, CI and Pages. Parse the L1 ASCII ground floor and render it with instancing. Orthographic camera with zoom. Player walks with WASD or the virtual stick, with tile collision. Clock and day counter on the HUD. Title screen with the version | Determinism hash, map parse snapshot, reachability validator |
| **P1 Routine** | 0.2 | 24 h schedule (GDD §2), routine banner, attendance and penalties, cell doors auto-lock, basic heat and decay, 8 inmates walking the routine (A*), routine floor arrows | Model-prisoner bot: 3 days, heat 0. Truant bot: lockdown |
| **P2 Items** | 0.3 | Inventory (6 slots, weapon slot, outfit slot), desks (6 hidden and 10 standard slots), daily restock, beds, toilets, drop and pick up, crafting panel with INT gates and a recipe handbook, contraband borders, durability bars. Tap-item → tap-slot on touch | Recipe graph (every item obtainable), ids unique, i18n names |
| **P3 Guards** | 0.4 | 5 guards on patrols, vision cones in 3 colors, heat rules (GDD §5.2), chase, lockdown, solitary with potato peeling, morning shakedown, night bed checks, bed dummy, guard disguise | Bed-dummy bot passes a night. Shakedown bot loses standard-drawer contraband and keeps hidden items |
| **P4 Layers** | 0.5 | Layers −1/0/+1/+2 with cutaway. Chip, cut, unscrew, dig. Tunnels with dirt piles, toilet flushing (clogs after 3) and timber braces/cave-ins. Vents, ladder, roof. Concealment (poster, fake block, fake vent, fake fence, desk over hole). Guard discovery of damage | Tunnel-mechanics test, discovery bot (an uncovered hole is seen and triggers lockdown) |
| **P5 Combat** | 0.6 | Lock-on, damage and cooldown formulas, weapons, outfits as defense, KO lasting 600 steps, looting, putty → mold (key kept) → plastic key, missing-key lockdown, molten chocolate | Key-thief bot (keeps the key → lockdown). Key-cloner bot (returns the key → no lockdown) |
| **P6 Economy** | 0.7 | L1 jobs (laundry, janitor, kitchen, woodshop, mailman) with quotas and pay, getting fired, gym and library minigames, attribute decay, merchants with opinion pricing, 4 favor types, gifts, recruiting followers | Economy validator, worker bot earns pay 3 days in a row |
| **P7 Security & escapes** | 0.8 | Generator and power grid (the maintenance guard turns it back on after 45 s), contraband detectors and pouch, cameras and taping, searchlights, snipers, infirmary. **The 4 L1 escapes**: perimeter cutout, tunnel, rooftop grapnel, takeover. Victory summary screen | **4 escape bots** win from day 1 |
| **P8 Level 1 complete** | **1.0** | Save/load (autosave at 08:00 plus slots), particles and juice, audio pass, help screen, tutorial coach, quality tiers, settings (motion, shake, haptics, sound, language), icon, PWA | Full suite, browser check on 3 sizes, a playtest |
| **P9 Stalag Flucht** | 1.1 | Dual compound, electrified inner fence, underground boulders, alpine cold (needs a cushioned or plated outfit), metalshop job | Validators and escape bots for its routes |
| **P10 Shankton** | 1.2 | Reinforced concrete shell, double perimeter, detector chokepoints, cameras in every corridor, all 6 jobs | Validators and escape bots (no route chips through `@` walls) |
| **P11 San Pancho** | 1.3 | Minefield, guards patrolling the outer walkway, lawless interior, aggressive inmates, supply-road gate | Mine test, deep tunnel bot, gate bot |
| **P12 HMP Irongate** | 1.4 | Ocean (tunnels flood), 2 generators, raft from the dock, helipad, drawbridge takeover, armored riot guards. Campaign menu and unlocks (`M`) | Raft bot, helipad bot, takeover bot |

## 5. Mapping the GDD to phases

| GDD / idea section | Phase |
|---|---|
| §1.2 camera and 4-layer cutaway | P0 (camera), P4 (layers) |
| §2 schedule and attendance | P1 |
| §3.1 status bars | P1 (heat), P2 (energy, HP), P5 (combat HP) |
| §3.2 attributes and training | P6 |
| §4 five prisons | P0–P8 (L1), P9–P12 |
| §5.1–5.3 cones, heat, bed dummy, disguise | P3 |
| §5.4–5.6 detectors, generator, cameras, snipers, solitary | P3 (solitary), P7 |
| §6 inventory and desks | P2 |
| §7 77 items | P2 (data), used by every later phase |
| §8 crafting and key cloning | P2 (crafting), P5 (molds) |
| §9 destruction, tunnels, concealment | P4 |
| §10 combat, KO, opinion, merchants, favors | P5, P6 |
| §11 jobs | P6 (L1), P9–P10 (metalshop) |
| §12 escape routes | P7 (L1), P9–P12 |
| §13 controls, HUD, feedback | Every phase, finished in P8 |

## 6. Tests

All tests are `scripts/*test*.ts` with golden snapshots (see the base playbook §5 and the sim
playbook §4):
- **Determinism**: same seed and same log run twice give the same state hash. A snapshot
  round trip gives the same hash.
- **Maps**: parse checksums and per-kind counts. Reachability per layer with capability sets.
  Zones, doors and props are present.
- **Data**: ids are unique, references resolve, the recipe graph is closed, INT gates can be
  reached, economy bounds hold, and French covers every key.
- **Mechanics**: tunnels, flushing, cave-ins, detectors, key cloning, combat formulas.
- **Bots**: regression bots (model prisoner, truant, smuggler, key thief, key cloner), plus
  one escape bot per prison and route that plays from day 1.
- **Performance**: the worst sim step with all NPCs stays under budget (yes/no in the
  snapshot, no timings).

## 7. Release routine

`npm run build && npm test`, then commit, `npm version minor|patch`, then
`git push --follow-tags origin main`, then poll the live bundle for the version. After that,
update the project memory and report what changed, what wasn't verified (sound, vibration,
real touch feel) and the known limits.

## 8. Progress

- **P0 done (v0.1.0)**:
  - Center Perks ground floor as an ASCII map, validated by `maptest`;
  - fixed-step sim with integer movement, a door-frame assist, a recorder and keyframes;
  - instanced tiles, procedural props and the character rig;
  - a wall cutaway so walls never hide the player, and day/night lighting from the clock;
  - keyboard, touch stick and pinch/wheel zoom;
  - title, HUD and pause screens in en and fr, the icon, CI.
- **P0 polish (v0.1.1)**:
  - walls stay full height, with a shader see-through window and a stencil silhouette;
  - baked contact shadows, a paint layer and night light pools;
  - barred cell doors, steel doors, razor wire, lamps, benches and trees;
  - stable shadows, smooth zoom, look-ahead and an intro zoom;
  - a blinking character with footsteps (dust and sound) and prison ambience;
  - a settings screen with quality tiers and auto step-down;
  - a first-play hint and HUD touches;
  - roll-call spots as data.
- **P1 Routine (v0.2.0)**:
  - the 24 h schedule as data (`content/routine.ts`), attendance by stepping into the block's zone, +25% heat for a missed meal, exercise or shower, lockdown for a missed roll call;
  - heat (decays 1% every 4 game minutes), the lockdown state (siren, red light, cells locked), Lights Out locking cells;
  - A* paths with string pulling (`sim/ai/path.ts`) and an autopilot that steers with ordinary commands (tap-to-walk, bots);
  - 7 inmates who line up at roll call, eat at the canteen tables, exercise, shower, wander in free time and sleep in their beds;
  - HUD routine pill with PENDING/ATTENDED, heat meter, banners and toasts, floor arrows to the routine's place, tap/click-to-walk;
  - `routinetest`: model prisoner 3 days at 0 heat, truant lockdown, night owl doors, inmates make every block. Dev builds: `]` fast-forwards ×30.
- **P1 review and polish (v0.2.2)**: a visitor can no longer be locked in someone else's cell (lockdown that never ended); inmates make way for each other and the player (followers keep their distance, head-on meetings by turn, squeeze past after 1.5 s); paths re-checked as doors change; canteen benches with a seated pose and meal trays; shower heads moved to the wall in view, with water; blankets and floating Zs for sleepers; legs paced to each inmate's speed; floor arrows skip spots walls would cut; Lights Out arrows and badge follow whether the player is in the cell; the HUD says when each block ends; start-up timers can't reach a paused or later game; tap vs drag thresholds; siren fade-in; one door per cell validated.
- **Second review (v0.2.3)**: right of way at head-on meetings (the other steps aside), detours round people standing at their spots, waiting counters reset on arrival; doors settled at the end of each step so a save restored at any step is exact (tested); the lock clank and toast are for the player's own door; no per-frame garbage in the frame loop, guide, view and HUD; fast-forward ends on pause; the HUD follows a language change mid-game.
- **P2 Items (v0.3.0)**:
  - 94 items (`content/items.ts`), 46 recipes (`recipes.ts`), loot tables and container sizes (`loot.ts`); items stored as numbers in slots, durability in the high bits;
  - inventory (6 hotbar slots, a weapon slot, an outfit slot), desks with 6 hidden and 10 standard slots, beds, toilets, shelves, counters, bins, showers; a daily restock at 08:00; dropping and picking up;
  - crafting with INT gates and a handbook of recipes crafted at least once; key molds give the real key back;
  - one-step ops in the command (interact, close, move, drop, craft, equip, select), so every item action is recorded and replayed;
  - sleeping in your bed at Lights Out (a fast night);
  - item models from a shape vocabulary, photographed into inventory icons at load; items on the floor, the item in hand, outfits that change the player's look, a focus frame on what the action button would use;
  - hotbar with contraband marks and durability bars, action button (touch) or E prompt (keys), the container panel (bottom sheet in portrait, side panel otherwise), the workbench and the handbook; tap an item, tap where it goes;
  - `itemtest`: ids, the closed recipe graph (every item obtainable), loot and sources agree, a bot that opens, takes, drops, picks up, crafts, wears, stashes and sleeps through ordinary commands, restocks that respect hidden slots and the player's desk, exact replay.
- **Next: P3 Guards.**
