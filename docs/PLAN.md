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
| Item count | 76 | **77**: adds `tool_handle`, `grapnel` and `makeshift_raft` as real items |
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
    prisons/<id>/L-1.txt L0.txt L1.txt L2.txt  <id>.ts   (legend, zones, props, roster, rules)
  render/             instanced tiles, layer cutaway, characters, cones, lights, particles
  input/              keyboard, mouse, touch (stick, context button, tap-to-walk) → Command
  ui/                 HUD, hotbar, sheets/panels (desk, loot, craft, shop, job board), help
scripts/
  *test*.ts           determinism, map validators, recipe graph, economy, bots
  bots/               action-script autopilot + one script per prison × escape route
```

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

## 8. Next step

Start **P0** once this plan is approved.
