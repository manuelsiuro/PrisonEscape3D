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
| Attribute decay | Not covered | **−1 per day** for each attribute that isn’t trained, never below the starting 40 (see P6 below) |
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
| Cave-in damage | 40 HP | **40 health** (since P5; P4 took 40 energy) and the tile fills back in; at 0 the player is out cold (the infirmary). More than 2 unsupported tiles in a row cave in; a brace holds its 3×3, the tile under an entrance holds itself |
| Toilets | "More than 3 piles within an hour clogs" | A toilet takes **3 loads, then is clogged for an hour**. Wall chunks flush like dirt |
| Damage found | Lockdown and solitary; damage repaired | A guard who sees damage or evidence (dirt, chunks on the floor) or the player at work: **100% heat** (lockdown). Evidence on the floor is taken at once; found damage is **repaired when the player is caught** (at once if they're already away) |
| Inmates and guards vs. holes | — | Holes and cut fences are the player's ways only: inmates and guards keep to the prison as built |
| Electric fence | Instant knockout while the generator is on | The generator is always on until P7: striking the electric fence knocks the player out (infirmary, contraband taken) |
| Energy | Bar from P4 | **0–100**: tools spend it (GDD per-tool cost); back +1 every 2 game minutes, +1 a minute asleep, +35 at a meal, +20 at the showers, +25 for a bar of chocolate (eaten with the use button) |
| Hiding through a lockdown | — | A lockdown can only end in a capture on the ground floor; a player who stays in the tunnels, vents or on the roof for **60 game minutes** sees it **called off**: found damage is repaired, the heat stays (the next guard who sees them gives chase) |
| The escape before P7 | Victory screen in P7 | Reaching the **road** ends the game with a short escape card (prison, day, time); the full victory screen and stats come with P7 |

| Damage and pace | "Scales with Strength plus weapon, minus outfit defense"; "Speed shortens the cooldown" | A blow does **2 + STR/4 + weapon − defense/3** (at least 1). The player swings every **22 − SPD/5 steps** (at least 8; nunchucks 15% faster). Health is **50 + STR**, back 1 a game minute (2 asleep), full on waking from a knockout |
| Lock-on | "Press R to highlight the nearest" | **R** / the touch lock button / **a tap on someone**: the nearest up and about within 5 tiles in plain view, then the next, then none. The lock lets go past 7 tiles, of someone out cold, or off the ground floor. Space / the tool button then hits the target instead of using the tool |
| Which weapon | "Equipped weapon" | A weapon **in hand**, else the weapon slot (fists without one). Only one in hand counts as contraband in sight (GDD §5.2) |
| Being caught (since P5) | "Guards draw batons" | A chaser no longer catches on touch: it stands at arm's length and swings its **baton** (34 a blow on an inmate outfit, every 16 steps). At 0 health the player is caught (solitary or the infirmary, as before). The player can fight back |
| Being hit | — | An inmate the player hits **fights back for 20 s**. A guard hit turns round (and so sees the attacker: 100% heat). Knocked out by an inmate or a cave-in: **the infirmary**, contraband taken as after a capture, but the heat stays; in a lockdown or when wanted (80%+) the guards pick the player up: as caught |
| Knocked-out people | Loot, swap uniform, take weapon; 30 s | Inmates and guards lie out cold for 30 s with **pockets** to go through (inmates: odds and ends, topped up at 08:00; guards: key, baton, uniform). A guard who comes round draws a spare key at once and raises a **lockdown** for the missing one (held back while a lockdown is already on or the player is out cold, and raised as soon as it can be; a capture settles it); a missing baton or uniform is replaced only at 08:00 (no farming). A bed check or shakedown under way is taken up again on coming round. Molten chocolate: thrown within 3 tiles, out cold at once (a guard's back turned: nobody knows) |
| Keys and doors | "Opens doors of its color"; plastic 15 uses | A key **in the hotbar** opens its color's doors for the player (not inmates; a guard's eye still stops at the shut door). **Perimeter gates** (beside the road) never open by key: the takeover opens them (P7). A plastic key wears **once a door**, as the player steps out of it (so the last use still gets them through; a two-wide door is one door); a real one never does. L1: warden red, canteen cyan, wing yellow, yard green, east purple |
| Shivs | "Sharpen on a wall" | A comb or toothbrush in hand against a brick wall: **4 strokes** (the use button, held) make the shiv. A guard who sees it sees tampering |
| Jobs (P6) | 6 jobs, quotas, "fired at 15:00" | L1: **laundry $30 (4 loads), janitor $35 (6 puddles), kitchen $40 (4 trays), woodshop $50 (3 stools), mailman $55 (3 letters)**, INT 20/25/30/40/50. The wage is paid **the moment the quota is met**; an unmet quota at 15:00 costs the job (no heat). The player **starts in the laundry**; the woodshop starts open. Work items (dirty and clean laundry, raw food, trays, stools, letters) go back at 15:00. Timber taken at the woodshop is real timber. A station's step takes the action button over the furniture's container while the quota is unmet (the dirty bin's loot opens once the quota is done) |
| Job rooms | Cyan-key doors (kitchen, laundry, mailroom, janitor) | Job-room doors **stand open during the Work Period** (12:00–15:00), and stay open while anyone is inside or in the doorway, so nobody is ever shut in |
| Losing a job (inmates) | "Beat them up or block them" | An inmate holding a job that is **knocked out during the Work Period**, or never reaches its room, loses it at 15:00. A Work Period excused by a lockdown (or the player out cold) costs nobody their job. A job left open is filled by an inmate **two mornings later** (the player has until then to apply). Applying: at the job board, Intellect checked; taken after 12:00, it counts **from tomorrow** |
| Training (P6) | Rhythm minigame; +2; 12% / 10% energy | Weights (STR) and treadmill (SPD) by the action button; library study from the **shelf's panel** ("Study a book"). A set: **alternate left and right presses** (A/D or ←/→; two pads on touch) fill a bar that drains when idle; a full bar is **+2** and costs 12 energy (study 10). Under 10 energy: no training |
| Attribute decay | −1 a day if neglected | An attribute **not trained the day before slips 1 at 08:00, never below its starting 40**: trained gains fade, the baseline that recipes and jobs are tuned for stays. Speed moves the player too: **184 + 3/5 per point over 40** (220 at 100; a chasing guard runs 196) |
| Cash | "Looting small change" | Cash is a number, not an item. Change turns up at 08:00 in some inmate desks ($1–8) and pockets ($1–6), taken on opening them. Spent at merchants and as gifts |
| Merchants | 3 inmates, free time, up to 50% off | Cells 2, 6, 7; up to **4 items** from the merchant table (exactly the items whose source is "merchant"), topped up at 08:00; open in **free time** only; price = value × (1 − discount), discount **0 at opinion 50, 50% at 100**; at opinion 25 or less they refuse to deal |
| Opinion | 0–100 from 50; gifts and favors raise it | Gifts: an item **+half its value (2–15)**, cash **+0.6 per $** ($5/$10/$20); a favor **+15**; a purchase +2; a punch **−8**, a knockout **−15**. At 25 or less, in a canteen or shower block, an inmate close by may **jump the player** (about once in 20 s of standing near them) |
| Favors | 4 kinds, $20–50, +15 | Up to **3 on offer** ("!" over the asker), refreshed at 08:00; up to 3 taken on at once. Scavenge (bring an everyday item), retrieve (the item is put in the thief's pockets when it's taken on), beatdown (done when the target is knocked out), roll call distraction (done by landing a blow during a roll call; a guard who sees it still sounds the alarm). Handed in by talking to the asker |
| Fighting back (since v0.7.1) | "Guards punish fights" | Seen hitting an inmate **who is already after the player** (an ambush, a fight it started): a **scuffle, +10% heat a blow**. Seen hitting someone calm: 100%, as since P5 |
| Followers | Recruit up to 2 at 80+ | Recruited at **opinion 80+**, at most 2; they keep a step and a half behind, and go for a **chasing guard or an angry inmate** within 6 tiles, landing their own blows (they can knock guards out; guards don't target them). Hitting one, Lights Out, or the player being caught or knocked out ends it. Inmates have **nicknames** (the same in every language) |

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
- **P4 review and polish (v0.5.1)**:
  - a held tool button never carries on into the next thing: each new target (the earth giving way, a cave-in) takes a fresh press, and digging up, eating and putting things in place only happen on a press;
  - the last blow with full pockets waits for room (the chunk or dirt would land at the player's feet in view);
  - no tunnel entrances where people must stand (beside beds and desks, at cell doors and roll call spots, the ladder's foot); nobody is dug out from under;
  - every climb lands on free floor (never a hole or a person, never through a wall's corner);
  - a grate overhead gives way to furniture the player faces;
  - Space lets go when the window loses focus;
  - perf: a held button no longer redraws the hotbar every step; a strike redraws only its cracks (tiles and tunnels redraw only when they change); no per-step garbage in damage spotting;
  - UI:
    - the zone pill shows the layer (colour and icon);
    - the tool button greys when too tired;
    - toasts and hints rise above the tool controls;
    - item toasts wrap and stay up longer when long;
    - the item card hides the prompts under it;
    - the desk's tunnel row sits at the top of its panel, and in landscape the compartment and drawers sit side by side (all 16 slots fit);
    - the title's sound pill no longer wraps;
  - look: a warm trodden trench floor and a faint light shaft in the tunnels, the rooms dim more under the vents;
  - text: clearer wording (FR digging up, cave-in advice every third tile, how to come up).
- **Second P4 review (v0.5.2)**:
  - digging up is offered only at a tunnel's end, facing back along it (the earth behind the player): tapping on at the dig face never surfaces by accident, and digging up takes a press per strike;
  - a lockdown spent out of reach (tunnels, vents, roof) is called off after an hour: the guards repair what they found and the heat stays (§2);
  - while the player is below, chasers head for where they last saw them, not the live position;
  - no tunnel entrances on chokepoints (tiles whose loss would split the prison), either side of any door, guard stops and posts, guard beds, the infirmary and solitary spots;
  - the desk stays pushed aside only while the player went down through it;
  - quick taps are kept (a press waits for the last swing); Space does nothing while a panel is open; the tool button greys when the last blow would need room in full pockets; a rope with nowhere to land and a cover coming off into full pockets say why;
  - chocolate keeps at full energy; the floor arrows never lead through the player's own holes;
  - tips: the tool how-to before the contraband warning; the "evidence" tip on the first chunk or dirt; the tunnel tip in touch and keyboard versions;
  - render: the tap ring on every layer; the tunnel lantern always in the scene (no shader recompile on the first trip down); roof materials disposed; a poster shows on the cell's side only; the ghosted ducts cast no shadow;
  - perf: the buttons' targets worked out once per simulation step; no per-step allocation in damage spotting or strikes.
- **P5 Combat (v0.6.0)** (GDD §3.1, §10, §8.2):
  - health, Strength and Speed in the state (training arrives in P6); the damage, pace and health formulas (`sim/systems/combat.ts`); fighters' fields on inmates and guards;
  - lock-on (R, the lock button, a tap on someone), blows with fists or a weapon (in hand or the weapon slot), the razor whip's reach, nunchucks' pace, molten chocolate thrown for an instant knockout;
  - inmates fight back; chasing guards beat the player down with batons; seen fighting: lockdown; knocked out by an inmate or a cave-in: the infirmary;
  - knocked-out people (30 s) and their pockets, looted with the action button (a countdown in the panel); guards re-issued their kit, the missing-key lockdown; key molds and plastic keys (worn a door at a time); keys open doors for the player only, never the perimeter gate; shivs sharpened on walls;
  - render: the lock ring, punches and flinches, a cup's arc and splash, people falling away from the blow, guards' keys on their belts, "!" over angry inmates; UI: the target card (health, STR, attitude, keys), the red Hit / Throw button, the vitals pill (health beside energy), floating numbers, a red flash when hit, sounds for every blow;
  - `combattest`: formulas, lock order, an unseen fight and the loot, a seen one, the baton, the key-thief bot (lockdown) and the key-cloner bot (no lockdown, a plastic key that opens the purple door and wears out), the gate, a shiv, floored by an inmate, a save mid-fight.
- **P5 review and polish (v0.6.1)**:
  - sim: no farming batons and uniforms (replaced at 08:00 only); a stolen key's alarm is held back through a lockdown or a knockout and raised after (a capture settles it); floored by an inmate or a cave-in keeps the heat (in a lockdown or wanted: as caught), and the routine excuses the time out cold; a knocked-out bed-check or shakedown guard takes the job up again; a plastic key's last use still opens the door; pockets need a clear line (no looting through a wall's corner); a hit inmate stops waiting and comes; a blow wakes a sleeper properly;
  - UI: a held Hit button keeps swinging through counter-punches; tap-to-lock on the person on screen (head or torso, not just the feet); the cup's knockout stars and bells when it lands; "Out cold!" above the last number; no lock-off blip on a knockout; the punch is out at the blow; the ring depth-tested (behind walls and legs), red while they're after the player, dim out of reach; the target's bar green/amber/red with a trail of the health just lost and a jolt on each blow; numbers scattered a little; the target card slides under a banner; toasts clear the vitals pill; labels follow a language change; the lock button is a toggle for assistive tech; floating numbers fade (not vanish) with reduced motion; pockets titled "Guard's pockets · wakes in 12 s"; the routine pill keeps its name on narrow phones once checked in;
  - perf: no per-frame strings or closures in the combat UI.
- **Second P5 review (v0.6.2)**: edge cases probed headless and found sound (an inmate knocked out at Lights Out is home and locked in by night; a guard down during a lockdown chases again on coming round; a key alarm held through solitary goes up on release; a cave-in in a lockdown ends in solitary on the ground floor; an angry inmate calms when the player climbs out of reach; about 120 µs a step); blows on the player without per-step closures; R with nobody in reach says so; the loot frame centred on the lying body; the target card sits under the banner by the banner's own height; narrow phones: the block's deadline moves under its name ("Cantine · jusqu'à 10:00") and the empty heat bar gives way at 0%, so the name never truncates in either language.
- **P6 Economy (v0.7.0)** (GDD §3.2, §10.3–10.4, §11):
  - sim: cash, change in desks and pockets; five L1 jobs with stations (`sim/systems/economy.ts`), quotas, wages, firing, inmates at work and losing jobs to sabotage, vacancies refilled; job-room doors open for work; training (weights, treadmill, library study) with alternate presses, +2 a set, energy; decay to the starting 40; Speed moves the player; opinion, gifts, merchants and their stock, favors (4 kinds), grudges and ambushes, recruited followers who fight; new ops TALK, JOB, TRAIN; all new state at the end, old saves load with the starting economy;
  - render: badges over inmates (favor !, done ✓, shop $, the letter's addressee, a follower ★), puddles to mop, the player training (pressing, running on the belt, reading), job items in hand (laundry, raw food, trays, stools, letters), inmates working;
  - UI: the cash pill in the HUD (gold flash on income) opening **your file** (I): attributes and where to train them, the job and today's quota, favors under way, followers; the routine pill counts the quota at work and says PAID; the job board; the talk panel (opinion meter with its 25/80 marks, the favor, the shop with friend prices, gifts, recruit); the training card (bar, alternating pads on touch, A/D on keys); machine progress chips; the floor arrows lead to the job room; sounds for coins, machines, reps, sets, purchases; coach tips for work, training, talking, favors;
  - `economytest`: the economy validator (furniture, rooms open for work, prices against wages, the merchant table), the worker bot (laundry, paid three days running, no heat), the idle worker (fired, the job refilled on day 3), sabotage and the board, job-room doors, training and decay and Speed, merchants and gifts, favors, a grudge, followers (keeping up, fighting a guard, bed at Lights Out), change in pockets, a save mid-work, an old save.
- **P6 review and polish (v0.7.1)**:
  - sim: the 15:00 settlement reads the block's own excuse (a lockdown through work no longer fires every inmate, nor the player); the mail desk sorts only as many letters as inmates still wait for, and a load is never lost; work items dropped on the floor go back at 15:00 too; hitting back at an inmate who jumped the player is a scuffle (+10% a blow, "A guard saw you scuffle"), not the alarm;
  - render: puddles were culled by the instanced mesh's bounds (never drawn): fixed, and they read as water now;
  - UI: the 12:00 banner sends employed players to work ("Go to work: Laundry (4 to do by 15:00)") instead of "free time"; being fired is a long toast (the 15:00 bell's banner no longer hides it); the floor arrows lead the janitor to the next puddle and the mailman to the addressee; gifts, quitting and swapping jobs ask twice; the file is introduced on the first cash; the opinion change fades with reduced motion; the shop marks contraband with the corner only and says "8% off"; narrow phones give the zone's pin up to its name; the keyboard shortcut only in the desktop tooltip; badges worked out once a step;
  - `economytest`: every L1 job done and paid in one work period by the worker bot (laundry, janitor, kitchen, woodshop, mailman), a lockdown through work, a scuffle vs an attack, the mail desk's limit and dropped letters, the cost of a step.
- **Next: P7 Security and escapes.**
