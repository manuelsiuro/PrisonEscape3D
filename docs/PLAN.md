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
| Lockdown without guards | — | Until P3 a lockdown lifted after **60 game minutes in the cell**. **Since P3 (v0.4.0)** it ends only when a guard catches the player: every guard hunts them, wherever they are |
| Cell doors at Lights Out | — | They lock once their occupant is inside; a door **waits open for an occupant still out** and never shuts on anyone standing in it. Guards (P3) punish being out |
| Blocks spent in a lockdown | — | **Excused**: missing them adds no heat |
| When a missed roll call counts | — | GDD §2.2 says "immediate" lockdown but also gives every block a grace window: it fires **when the block ends** (09:00, 23:00) if the player never stepped into the yard |
| Cells and visitors | — | A cell never locks while anyone but its occupant is inside it |
| Energy and HP bars | P2 in §5 map | Nothing spends Energy or HP before tools (P4) and combat (P5), so both bars arrive **with what uses them**; meals, showers and chocolate restore Energy from then on |
| Shivs | "Sharpen on a wall" | Sharpening is a wall action, so comb and toothbrush shivs come with P5 combat |
| Daily restock | "Restock with randomized items" | At 08:00 containers are **topped up**, never past a cap (desk 6 items), never touching hidden compartments or anything already there; the player's own desk and bed never restock (their toilet does). A tile holds at most 6 dropped items |
| Sleeping | "Sleep in bed" | Sleeping at Lights Out runs the night ×40 (about 13 s); a move or the action button wakes the player, and 07:55 does in any case |
| A lockdown while the player stays out | — | Superseded by P3: the guards come for the player, in or out of the cell |
| Out of the cell at Lights Out | "Being outside your cell during Lights Out" | **15 game minutes of grace** after 23:00 for the walk home; after that, seen out of the cell in an inmate outfit is 100% heat |
| The guard-outfit rule | Table: "at night"; §5.3: "keep a respectful distance" | **At any time**: in a guard outfit, a guard who **sees** the player within 2.5 tiles for over 2 s recognizes them (+50% a second). The outfit hides the night and restricted-room rules |
| Vision | 60° cone, no range given | **7 tiles**, blocked by walls and shut doors (open doors are see-through). A guard also notices someone **touching** it (within 0.9 tile) whichever way it faces |
| Being caught | §3.1 says KO by guards → solitary; elsewhere solitary from 90%+ | A guard catches only while chasing (80%+ heat or a lockdown). Caught at **90%+ → solitary**, under 90% → **the infirmary**. Either way carried contraband (hotbar, weapon) is taken and the outfit becomes an inmate outfit; solitary also searches the desk. **Heat goes to 0**: the score is settled |
| Solitary | 2 hours, or less by potato peeling | **5 strokes peel a potato, a potato takes 10 minutes off**; a stroke counts at most every 4 steps (mashing faster gains nothing: about 12 s of peeling at best). Released into the corridor outside solitary (into the cell at night). Blocks missed while knocked out or in solitary are excused |
| Shakedown | Desk standard drawers | The guard searches the **desk's standard drawers and the bed** (GDD §5.3: the dummy must be gone by roll call). Two cells drawn at 08:00, searched during roll call |
| Bed check | A guard "walks past the windows" | The night guard stops at each cell door, east to west. The player passes if in their cell (awake or not), asleep, or with a **bed dummy in the bed** (an item placed in the bed's slots) |
| Chase speed | — | Guards run at **196** (the player walks at 184): running only buys time; breaking line of sight is how to shake a guard. A lockdown ends in capture |
| Restricted zones (L1) | Generator, roof, vents, guard room | **Generator room, guard quarters, control room** plus **vents and roofs** since P4 (v0.5.0). The kitchen is a job room, not restricted |
| Reaching a ceiling grate | "By standing on a desk or toilet underneath" | Grates are reached **from the floor tile under them** (or the one ahead); no furniture needed. The L1 vents run from the player's cell over the corridors and the library to the generator room ladder (GDD §4.1 overlay) |
| Who sees the vents and roofs | — | Nobody sees into the **vents**. A player on a **roof** is seen by a guard **standing outdoors** (cone and range, nothing on the ground in the way). Snipers and searchlights come with P7 |
| Covers | Poster or fake block over a hole; fake vent; fake fence | Covers go on with the **use button** (the item in hand) and come off with the **action button** (back into the hand); a covered tile is shut and looks intact. A **poster only passes in the player's own cell** (a hole touching it); a fake wall block works anywhere |
| Desk over a tunnel | "Picking up the desk… sliding it back" | A tunnel can be dug **under the player's own desk**; the desk always covers it, except while the player is below (the desk is pushed aside: a guard looking in then sees the hole). The way down is a **Climb down** button in the desk's panel |
| Tile hit points | Walls 100, fences 100–120, grates 60; tools 4–50 a strike | As the GDD, plus a **tunnel entrance 40** and **earth 30** a tile (a spoon's 10 uses dig one tile). A strike lands at most every 9 steps; holding the button repeats it |
| Digging up | — | In a tunnel, facing **back along it** (not into earth), the shovel digs up through the floor above (any diggable floor); the player climbs out beside the hole |
| Cave-in damage | 40 HP | Health arrives with combat (P5): until then a cave-in costs **40 energy** and the tile fills back in. More than 2 unsupported tiles in a row cave in; a brace holds its 3×3, the tile under an entrance holds itself |
| Toilets | "More than 3 piles within an hour clogs" | A toilet takes **3 loads, then is clogged for an hour**. Wall chunks flush like dirt |
| Damage found | Lockdown and solitary; damage repaired | A guard who sees damage or evidence (dirt, chunks on the floor) or the player at work: **100% heat** (lockdown). Evidence on the floor is taken at once; found damage is **repaired when the player is caught** (at once if they're already away) |
| Inmates and guards vs. holes | — | Holes and cut fences are the player's ways only: inmates and guards keep to the prison as built |
| Electric fence | Instant knockout while the generator is on | The generator is always on until P7: striking the electric fence knocks the player out (infirmary, contraband taken) |
| Energy | Bar from P4 | **0–100**: tools spend it (GDD per-tool cost); back +1 every 2 game minutes, +1 a minute asleep, +35 at a meal, +20 at the showers, +25 for a bar of chocolate (eaten with the use button) |
| The escape before P7 | Victory screen in P7 | Reaching the **road** ends the game with a short escape card (prison, day, time); the full victory screen and stats come with P7 |

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
- **P2 review and polish (v0.3.1)**: the workbench crafts from exactly the slots put on it (the craft op carries a slot mask), so a worn outfit or wielded weapon stays on when it is the one upgraded; nothing happens in your sleep and a clock wake-up never drops an action; E closes the workbench before opening a container (never two panels); the action button shows the verb on the round button and the object on a tag beside it (long French names fit); floor items larger with a breathing glow; the focus frame stays on an open container; hotbar slots pop when something arrives; no silhouette through the blanket; icons photographed in idle slices; no per-frame garbage in the item UI; slots never keep focus (Space and Enter are game keys). `itemtest` crafts all 46 recipes and checks worn and wielded results.
- **Second P2 review (v0.3.2)**: the craft op also carries the recipe the workbench previewed, and crafts nothing if the slots changed meanwhile; at most 6 items a tile; floor items laid out only when they change, at angles set by tile and item (a pile no longer shuffles when one is picked up); the player's toilet restocks; restored item state is fitted to the prison's containers; each new game rebuilds the player (no pose carried over); landscape action label above the button (clear of Craft); touch hints above the action button; the item UI's fixed labels follow a language change.
- **P3 Guards (v0.4.0)**:
  - 5 guards as data per prison (`GuardDef`: a day round of stops, posts for some blocks, a night round or a bed in the guard quarters, duties). The warden takes roll call and does the night bed checks, the canteen guard watches meals, the wing guard watches showers and runs the morning shakedown, the yard guard watches exercise and walks the yards at night, the east guard walks the workshops and staff rooms; three sleep at night;
  - guards hold keys to every door (their own walk grid; doors open for them on screen); inmates and guards share one walker (`sim/ai/walker.ts`) and make way for each other;
  - sight in the sim (`sim/ai/sight.ts`): a 60° cone, 7 tiles, walls and shut doors block it; the renderer draws the cones with the same ray test, yellow, orange (investigating) and red (chasing), with "!" and "?" over guards;
  - heat rules (GDD §5.2): out of the cell after Lights Out, restricted rooms, a contraband tool or weapon in hand, recognized in a guard outfit; heat cools only out of sight; the HUD eye shows when a guard is looking;
  - wanted (80%+): guards who see the player give chase with batons, investigate where they lost them; a lockdown sends every guard; caught → knocked out 30 s (stars, shown fast), then solitary (90%+) or the infirmary, with confiscation;
  - solitary with potato peeling (a card with the time left and strokes); the morning shakedown (hidden compartment safe); the 00:30 and 04:00 bed checks and the bed dummy; the guard outfit disguise;
  - `guardtest`: sight, each heat rule, the disguise, chase/investigate/catch, confiscation, peeling, the bed-dummy bot (passes both checks; without it the alarm), the shakedown bot, rounds over 3 days, saves mid-chase. `maptest` validates guard stops, beds and the places guards use.
- **P3 review and polish (v0.4.1)**: a disguise is only recognized by a guard who can see the player (not through walls); a chase no longer cancels the bed check or shakedown (the guard takes it up again, and a check due while chasing waits for the chase); guards run a little faster than the player walks, so a lockdown can't be outrun; a chaser with no way to the player waits between searches; the catching guard stands over the knocked-out player; the player is put down in the open middle of the solitary cell and the infirmary, the camera cuts there instead of panning, and nothing slides between spots; solitary darkens the screen's edges; cones follow glances closely and read better by day; a repeated sighting is announced once; first-time tips for contraband in hand and the guard outfit.
- **Second P3 review (v0.4.2)**: a bed check or shakedown held up by a chase expires with its time of day (bed checks at 08:00, shakedowns at Lights Out) and a bed check only counts at night (no daytime lockdown from a stale check); chasers watch the player while they can see them and keep on for a second after losing sight (corners no longer end a chase in plain view); no sleeping during a lockdown (the bed opens as a container instead of flickering asleep); peeling strokes count at most every 4 steps; restored guards get every field; per-step arrays reused; long toasts wrap and rise above a coach hint; the heat meter slims on narrow phones so the routine pill keeps its name; the knocked-out label sits mid-screen.
- **P4 Layers (v0.5.0)**: the four layers and the cutaway (GDD §1.2, §9):
  - layer state in the sim (the player's layer; changed tiles, wear, toilets and found damage in the state; the world rebuilt from them on restore); per-layer walking, crawling in the vents, stooping in tunnels;
  - the use button (touch, held) / Space: strike with the tool in hand (chip brick, cut fences, unscrew grates, dig floors, earth, back up), eat chocolate, put covers on, brace tunnels, rope down off a roof; tools wear and cost energy; a progress ring on the button;
  - the action button climbs (grates, the ladder, tunnel entrances) and takes covers off; dirt and chunks flush down toilets;
  - Center Perks vents picture (cell → corridors → library → generator room ladder), roofs over every building with copings over the walls below, a hatch, AC units;
  - render: ghosted ductwork overhead (opened up and the rooms dimmed while crawling), grate hoods, holes with lintels and rubble, cracks, posters, cut fence flaps, tunnel entrances, the roofs while on them, the tunnel view (earth tinted by the map above, trenches, braces, shafts of light, a lantern); strike swing, chips and sparks, a small jolt; the zone pill names the layer;
  - guards: damage, evidence and tampering in a cone mean lockdown; repairs after a capture; roofs seen from the open yard; vents and roofs restricted;
  - energy meter, first-time tips, sounds for every strike, the escape card;
  - `layertest`: chipping, covers, cutting and the fence escape, the electric fence, vents to the roof and back, the tunnel bot (cave-in, braces, flushing, dig-up escape), discovery and repair, roof sight, restore mid-tunnel; `maptest` validates the vents.
- **Next: P5 Combat.**
