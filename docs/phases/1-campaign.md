# Phases: The five-prison campaign (P0–P12, v0.1–v1.6)

A finished roadmap, kept as it was planned and built: its rows from `PLAN.md` §4's phase table and, where it had one, its own section of `PLAN.md`, moved word for word on 2026-11-06. What was released is in `docs/history/`; the decisions taken on the way, in `docs/decisions/`.

## The phases

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
| **P8+ Polish and foundations** | 1.1 | Living furniture (sit, eat a tray, showers, the infirmary, inmates sitting and reading), 3D decor in every room, the architecture ready for more prisons (Sim.ts and main.ts split, per-prison rules, power and escape routes as data, generic tests), a **tutorial** of short lessons on a small training map from the title | Living test, every suite, browser check on 3 sizes |
| **P9 Stalag Flucht** | 1.2 | Dual compound, electrified inner fence, underground boulders, alpine cold (needs a cushioned or plated outfit), metalshop job; the campaign menu and unlocks, themes | Validators and escape bots for its 4 routes, every job paid, `stalagtest` (cold, boulders) |
| **P10 Shankton** | 1.3 | Reinforced concrete shell, double perimeter, detector chokepoints, cameras in every corridor, all 6 jobs, the gatehouse grapnel, the industrial theme | Validators and escape bots for its 4 routes (none chips a wall), every job paid, `shanktontest` (shell, arches, cameras, both fences, grapnel) |
| **P11 San Pancho** | 1.4 | Minefield between two reinforced walls, guards on the walkway, lawless interior, aggressive inmates, supply-road gate, snipers day and night, the desert theme | Escape bots for its 3 routes (deep tunnel, gate, takeover), every job paid, `sanpanchotest` (walls and mines, nobody on a mine, blast, crater, dig-up, supply road keys, snipers, grudges) |
| **P12 HMP Irongate** | 1.5 | Ocean (tunnels flood), 2 generators, raft from the dock, helipad, drawbridge takeover, armored riot guards (the campaign menu came with P9) | Raft bot, helipad bot, takeover bot |

## Mapping the GDD to phases (PLAN.md §5 before 2026-11-06)

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
| §11 jobs | P6 (L1), P9 (metalshop), P10 (all 6), P11 (janitor first) |
| §12 escape routes | P7 (L1), P9–P12 |
| §13 controls, HUD, feedback | Every phase, finished in P8 |
