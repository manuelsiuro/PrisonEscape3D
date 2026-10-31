# PrisonEscape3D: Project Plan

A 3D web take on *The Escapists*. It is built with the **web-game-playbook** and
**web-sim-game-playbook** skills, starting from `~/ClaudeProjects/web-game-starter`.

Sources:
- `docs/the_escapists_3d_complete_game_design_document.md` (**GDD, the source of truth**);
- `docs/game_idea.md` (feature list);
- `docs/tech_plan.md` (engineering details, used where the GDD says nothing).

The history of every release (what changed, what the reviews found, what was accepted) is in
[`docs/HISTORY.md`](HISTORY.md); §8 below gives the status.

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
| Saves | localStorage through `game/storage.ts` (a snapshot is about 5 KB, so IndexedDB isn't needed): the game in progress and 3 slots (since P8) |
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
| When a missed roll call counts | — | GDD §2.2 says "immediate" lockdown but also gives every block a grace window: it fires **when the block ends** (09:00, 23:00) if the player never stepped into the yard (since v2.23: there, but gone before counted, the meals' +25% instead; see "Attendance and other inmates' cells") |
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
| Electric fence | Instant knockout while the generator is on | Striking (or hooking a grapnel over) the electric fence while the generator runs knocks the player out (infirmary, contraband taken); with the power off it cuts like any fence |
| Energy | Bar from P4 | **0–100**: tools spend it (GDD per-tool cost); back +1 every 2 game minutes, +1 a minute asleep, +35 at a meal, +20 at the showers, +25 for a bar of chocolate (eaten with the use button) |
| Hiding through a lockdown | — | A lockdown can only end in a capture on the ground floor; a player who stays in the tunnels, vents or on the roof for **60 game minutes** sees it **called off**: found damage is repaired, the heat stays (the next guard who sees them gives chase) |
| The escape | Victory screen (GDD §13.2) | Reaching the **road** wins. The victory screen names the way out (**fence, tunnel, roof, takeover**: dug up outside, a grapnel landing, the takeover's gates, else through the fence), the day and time, walls chipped, tunnel tiles dug, guards knocked out, cash earned, and the ways out of the prison found so far on this device (stored, with the quickest); then play again or the title |
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
| The generator (P7) | "45 real seconds", a maintenance guard | The generator's **action button** switches the power off for **900 steps**: the electric fence, detectors, cameras, searchlights and every lamp and room light go dead. The nearest guard up and about is sent to it and **waits there until the power is back** (then back to duty); the power comes back at 45 s whatever happens to that guard. The player can switch it back on sooner |
| Detectors (P7) | "+50% heat, siren, guard dispatch"; pouch 20 passes | L1: the canteen and woodshop arches. Stepping into one with the power on scans **every carried slot** (hotbar, weapon, outfit: a guard's uniform is contraband too). Contraband trips it: **+50%**, the buzzer, the 2 nearest guards up and about sent to the arch. A **pouch in the hotbar** shields it and loses a pass (gone at 0). A pass counts once (standing in the arch scans nothing more) |
| Cameras (P7) | Spot chipping/unscrewing; tape 60 s | L1: the staff corridor's west end, the woodshop's corner, the control room. A 60° cone, **6 tiles**, sweeping ±45°, walls and shut doors in the way. A camera sees what a guard would sound the **alarm** for (work on the structure, a fight, a restricted room or out after Lights Out; a guard's uniform passes) and the alarm is a **lockdown**; contraband in hand it ignores. Under a camera's eye heat doesn't cool. **Duct tape or toothpaste** (used up) from under it blinds it for **60 s**; seen by a guard, that's tampering. No power, no camera |
| Searchlights (P7) | "+35% a second + alarm" | One per south tower, sweeping its side strip and half the south yard (data: a path walked back and forth), **Lights Out only**, the power on, the **ground floor outdoors** (roofs and rooms never). In the pool (2 tiles) without a guard's uniform: **+35% a second** and the 2 nearest guards up and about sent to the spot as it finds the player |
| Snipers (P7) | Heat ≥90% outdoors by day; fence cutting seen | By day (not Lights Out), within **26 tiles** of a tower, outdoors (open ground, not the road) or on a roof. **Cutting the fence** there is seen (100%). Wanted at 90%+: the sniper takes aim (2 s, a laser), fires a **warning shot**, then hits every 3 s for **30 − defense/3** (at least 10); at 0 health the player is caught. The north fence is out of the towers' reach |
| Takeover (P7) | KO 85% of guards; gates open | With **⌈85%⌉ of the guards out cold at once** (L1: all 5) every door and the perimeter gates open for the player; it lasts until the first comes round (the doors wait for the player to step out of one). Out of the gates in a takeover is the takeover escape |
| Rooftop grapnel (P7) | "Hooks across to the perimeter wall, sheet rope down" | A grapnel in hand at a **roof's edge**, the perimeter fence within **6 tiles** straight ahead over open ground with free road past it: the use button swings the player over and down to the road, **a sheet rope in the hotbar** required (both stay behind). Over a live electric fence: the shock |
| Fighting back (since v0.7.1) | "Guards punish fights" | Seen hitting an inmate **who is already after the player** (an ambush, a fight it started): a **scuffle, +10% heat a blow**. Seen hitting someone calm: 100%, as since P5 |
| Meals (P8+, v1.1.0) | §2: "grab a food tray (+35%)"; until v1.1 +35 on stepping into the canteen | Attendance still counts on arrival (since v2.23, 20 minutes there: see "Attendance and other inmates' cells"); the **+35 comes from eating**: seated at a canteen table during breakfast or dinner, the tray takes **3 s** (the view shows it), once a meal |
| Showers and sitting (P8+, v1.1.0) | §3.1: "+2%/s standing under a running shower", "chair +1.5/s"; until v1.1 +20 on arrival | Standing still under a shower in the showers block: **+1 energy every 10 steps**. **Sitting** on a canteen seat, yard bench or chair (the action button, facing it; a move or the button gets up): **+1 every 13 steps**; an **infirmary bed** to lie on: the same, and health at the sleeping pace. Seats give way to anything else in reach unless straight ahead (a chair stands where its desk is searched from). Yard benches are stepped over like canteen seats |
| Learning recipes (P8+, v1.1.7) | §8: a recipe is recorded in the handbook once crafted; nothing says how a player finds one | Crafting by trial still records recipes. The **handbook also lists every recipe within the player's Intellect as a mystery**: result hidden, each ingredient shown once the player has carried it (pockets, weapon, outfit), the nearest to known first, and how many more need more Intellect. **Tips** tell a recipe outright (the simplest unknown within Intellect): **studying** each time Intellect reaches a new multiple of 5 (a mark lost overnight and won back pays nothing), and **an inmate at opinion 60+**, once a day each ("Any tips?" in the talk). **Only what the prison can make** is told or shown (its furniture, pockets, merchants, jobs, guards' keys, and what those craft). **Copying a guard key is never told**: molds and plastic keys are learnt with the key in hand. Someone the player could talk to on the seat ahead is a talk, not the seat |
| Stalag Flucht's map (P9, v1.2.0) | §4.2 ASCII plan: one row of buildings, the infirmary and solitary in the guards' compound, the ladder `[L]` in the generator hut, detectors `[D]` on the canteen, gym and both workshops | Kept: two compounds split by an **electrified inner fence** with a **purple inner gate**, the **whole perimeter electric**, 3 towers, 10 inmates in two log cabins, 6 guards, the generator hut, barracks and solitary in the east. Changed: the **infirmary is in the prisoners' compound** (a patched-up player wakes there and must be able to walk back to the camp); the workshops sit in **two service blocks either side of the path to the main gate** (one long block cut the yard off from the gate); **detectors on the canteen and gym only** (a job room needs a door that locks outside work); a locked **storeroom** in cabin A (zone `storeroom`) |
| Stalag Flucht's roof route (P9) | §12 route 3: "unscrew your cell's vent grate, crawl the vents to the roof"; §4.2: the whole wire is electric and the generator hut has the ladder | Log cabins have **no vents**; the **ladder stands in the generator hut**. With the wire live a grapnel over it shocks, so the route is: keys to the hut, **the power off, up the ladder, over the dead wire** before it comes back. `maptest` asks for a cell grate only where the vents have grates |
| The cold (P9) | §4.2: "outdoors in the snow for more than 60 seconds without a cushioned or plated outfit doubles stamina consumption" | Out in the open (the ground floor's outdoor tiles, or a roof) for **60 s** builds the cold (`state.cold`, up to 1200 steps): then **everything that costs energy costs double** (tools, training, digging underground too) until the player has **warmed up all the way** indoors (state `frozen`), **four times as fast** as it came. A cushioned or plated outfit keeps it out. Walking costs no energy in this game, so the cold bites where energy is spent. A HUD chip shows it building, the seconds left and "Frozen: energy ×2"; the first time in a game, a toast explains it |
| Boulders (P9) | §4.2: "granite boulders on layer −1; dig around them" | Prisons may give an **underground picture** (`under`, `O` = boulder). A boulder refuses every tool (`cantStrike` "boulder", no wear, no energy), no tunnel entrance is dug over one, and the tunnel view shows them as grey rock humps so a digger can plan the way round |
| Metalshop (P9) | §11: 60 INT, $65, sheet metal through the hydraulic press, 4 plates; "unlimited free sheet metal" | As written: metal bin → **press** → output bin, 4 **license plates** (a work item, handed back at 15:00). The **sheet metal stays the worker's** (not a work item, like the woodshop's timber); the metal bin also stocks wire and a file now and then |
| Campaign and unlocks (P9) | §4, §13.1: "Level Select / Campaign Menu (`M`)", the next prison unlocked by escaping | A **prison select** opens from Play once two prisons are open: a card each (security, a line on what makes it, ways out found, quickest day); **any way out of a prison opens the next**, worked out from the escape records (nothing more stored). The victory screen announces it and offers **"On to …"**. No `M` key in a game: switching prison abandons a run, so it's a title choice. The title shows the newest prison open behind it, and saves name their prison |
| Themes (P9) | GDD: each prison's setting (suburban, alpine, industrial, desert, island) | `PrisonDef.theme` (render only): Stalag Flucht's **alpine** look swaps the grass for snow, trodden paths, a snowy road, **log walls** with snowy tops and roofs, snowy pines beyond the wire, powder for footsteps, and **falling snow** (off with reduced motion) |
| Shankton's map (P10, v1.3.0) | §4.3 ASCII plan: rows 0–44 only, 8 cells `[C1]–[C8]` in two blocks, `[D]` at every corridor junction, the generator and guard control side by side in the south, `[G]` through the shell and both fences in a line, the gate roof south of the wire | Kept: a **reinforced concrete shell** (`@`, the only reinforced walls; inside is brick), **chain-link inside an electric fence**, 4 corner towers, 8 guards, all 6 jobs (the player starts in the **metalshop**), the north and south **security corridors**, the open-sky **courtyard** for roll call and exercise, the generator room with the **ladder**, cameras in every corridor. Changed: the whole 64×64 square is used; **12 cells** (the GDD's 12 inmates) in **two wings of six**; the detector arches stand **across both corridors where they leave the cell wings** and at the canteen door and the courtyard’s north door (every walk from a wing past the gym crosses one, proven by `shanktontest`), not at every junction; the **gatehouse stands astride both fences** right below the shell's gate (a takeover's walk out is a straight line: with 8 guards the first ones wake before a longer one ends); the generator room has its **own purple door** to the gravel (the cloned-key route out to the fences) |
| Shankton's first job (P10, v1.3.2) | §4.3: "Metalshop default"; §11: the metalshop asks Intellect 60, the player starts at 40 | The player starts in the metalshop as written, and **the job the prison gives on day 1 can always be applied for again** from the board ("Your first job"), whatever the Intellect: fired once, a new player would otherwise lose it until 10 library sets later. Any other job keeps its Intellect bar |
| The grapnel at Shankton (P10) | §4.3 roof plan: "use the grapnel here to zip over the inner fence" onto the South Gate roof, then a sheet rope to freedom | The grapnel **hooks a roof standing on the wire** (a roof over the perimeter zone, the gatehouse) within its reach and swings the player across onto it, **keeping the sheet rope**; a rope down off that roof onto the road counts as the **roof** route. Elsewhere it hooks the chain-link and drops the player between the fences (not out) |
| Shankton's takeover (P10) | §12: Strength and Speed 90+, plated armor, nunchucks, 2 allies, 85% of the guards out cold | Unchanged rule (7 of 8 guards); the bot proves it at **90, two ordinary allies**, carrying **4 cups of molten chocolate** (§10.1: thrown, out cold at once) besides the nunchucks, and fights on until no guard is left on its feet close by (the 8th, still chasing, catches a player who runs). Help now says "nearly every guard (85%)" |
| Themes (P10) | — | **industrial**: crushed stone round the shell, the state highway's dark tar, **painted cinder block** inside, scrub beyond the road. **Reinforced concrete is drawn as poured panels with tie holes in every theme**, so a player can tell the walls no tool chips |
| San Pancho's map (P11, v1.4.0) | §4.4 ASCII plan: rows 0–44, the outer wall at 2, the minefield 4–6, the inner wall at 8, the walkway inside it, 8 cells, the supply road out through `[R]` and `[G]`; text: "guards patrol the outer perimeter walkway between the Inner Wall and Outer Wall" | Kept: **two reinforced walls** with the **minefield** between them, 4 towers, 8 guards, the walkway, the adobe compound (cells, canteen and kitchen, workshops with their `[D]` arches on the west; gym, showers, library, generator and guard post on the east; the plaza for roll call between), the supply road (`[R]` in the inner wall, a **paved corridor through the mines**, `[G]` in the outer wall), the player starts as the **janitor**. Changed: the 64×64 square is used; **14 cells** (the GDD's 14 inmates) in two wings of seven; the walkway runs **inside the inner wall** as the map draws it (the text's "between" would put the guards in the minefield); the road out leads from the plaza through the **control room** (red doors both sides); the corridor and the walkway are **staff only** (seen there: 100%) |
| Mines (P11) | §4.0: "Explodes for 100 HP damage if stepped on at Layer 0"; §4.4 map: `* . * .` | **Every tile of sand between the walls is mined** (a checkerboard could be crossed on the diagonal); drawn as raked sand, a mound on each mine, a lid showing on some, skull signs. A mine underfoot does **100 health and raises the alarm (100%)**: out cold, the player wakes in **solitary**; the very strong are left standing, wanted, for the snipers. **Digging up from a tunnel into the minefield sets the mine off.** A crater is safe until **08:00**, when the mine is laid again (no clearing a lane by sacrifice). Inmates, guards, tap-to-walk and the guide arrows never enter the minefield |
| San Pancho's ways out (P11) | §4.4: "Deep Desert Tunneling", "Clone the Red and Green keys (or stage a full compound Riot Takeover)" | **Three routes: tunnel, gate, takeover** (no fence, no roof route). A new route, **gate**: walking out of a door onto the road without a takeover (no perimeter gate is locked against keys here, `gates: []`). Escapes are classified by the tile the player stepped from |
| San Pancho's lawless interior (P11) | §4.4: "Guards rarely enter the dusty central adobe compound except during Roll Call and Shakedowns"; "Inmates: 14 (Highly Aggressive)" | Inside the compound: the warden (roll call, bed checks) and **one sweeper** (the shakedown, a slow round with a long sit in the control room); four guards walk the walkway day and night, one keeps the supply road, one the staff rooms. **`rules.hostile`**: inmates start cool (40), every fourth cell's with a **grudge (20)**, and grudges are settled in **free time and the yard** as well as at meals and showers. Snipers on duty **day and night** (`rules.snipers: 'always'`). A guard knocked out unseen calls nobody in: the takeover bot lands its first blow by hand where the guard sees it |
| Grudges settled (P11, v1.4.1) | §10.3: an inmate with a grudge may ambush the player | An inmate that **puts the player down has settled its score** (its opinion back up to 35); one the player beats keeps its grudge. Every prison; at San Pancho a passive player was otherwise floored 2–5 times a day, every day, by the same three |
| Job doors (P11) | — | A job room's door **stays open while any part of a body is in its doorway** (as cell doors already did), not just its centre: a door shut on a player stepping out snapped them into the wall (found by San Pancho's woodshop worker) |
| Themes (P11) | — | **desert**: pale sand, raked sand over the mines, a sun-bleached border road, red earth in the plaza, **adobe** walls (plastered mud brick), sandy concrete, clay roofs, saguaros beyond the road and in the plaza |
| Irongate's map (P12, v1.5.0) | §4.5 ASCII plan: rows 0–50, `[P1]–[C8]` cells beside solitary and GEN-1, `[D]` on the main and south corridors, an indoor roll call and exercise hall with cameras, armory and control with the ladder and GEN-2 in the south, `[G]` ferry gates and the ferry pier, the dock east of the outer wall behind `[R]` and `[G]`; roof plan: north roof, a chasm, the south admin roof with the helipad | Kept: the island in the sea, the outer wall (`@`) with 4 towers, the walkway inside it, the fortress wall, the north block (cells, solitary, GEN-1 and its ladder, vents from cell 1), the middle block (kitchen, canteen, gym and showers, library and infirmary, laundry, janitor, mailroom), the main corridor, the south block (workshops behind their arches, control room, GEN-2, guard quarters), the east dock behind a red and a green door with its electric fence and the pier (`P`), the south ferry gate, a drawbridge and the landing. Changed: the 64×64 square is used; **14 cells** (two rows of eight and six); roll call and exercise in an **open-air yard** between the north and middle blocks: it is the roof plan's chasm (a hall with a roof would leave no chasm); a **sally port** with red doors from the main corridor out to the walkway (the cloned-key way to the dock); the helipad is a **walled court open to the sky** in the south block (below) |
| The sea (P12) | §4.5: "tunnels dug under the ocean flood instantly" | A tunnel tile dug under the sea (`~`, the pier, the drawbridge) **floods the whole tunnel**: every tunnel tile joined to it and its entrances fill back in, what lay on its floor is lost, the player is washed out cold (the infirmary, contraband taken; the heat stays). The dig label warns "under the SEA"; the tunnel view shows the sea in blue. No road is reachable underground without passing under water (`irongatetest`) |
| Two generators (P12) | §4.5: GEN-1 detectors and cameras, GEN-2 the dock fence and searchlights | As written, with **GEN-2 also the lamps and room lights**. `PrisonDef.grid` says what each generator (in props order) powers; each has its own 45 s, its own maintenance guard, its lamp. The power pill says "Cameras off" or "Fence off" (both: "Power out") |
| The raft (P12) | §4.5, §12 route 5: balsa, bed sheet, rope; GEN-2 off, cut the dock fence, launch from the east pier | As written: a raft in hand **at the pier's end, the open sea ahead**, the use button launches it (the raft escape). Nowhere else: not from the quay, not over the fence |
| The helicopter (P12) | §4.5 escape B: vents to the roof, a grapnel across the chasm to the admin helipad tower on the roof, knock out the 2 helipad guards in a guard's uniform, board at night | Guards walk the ground floor only, so the pad is a **walled court open to the sky** in the south block, its only door a gate the guards use (no key opens it). From the north roof the grapnel swings **across the yard onto the south roofs** (`PrisonDef.landings`; the sheet rope kept), the rope down into the court. The helicopter sits on the pad **from 23:00 to 08:00** (the pad is kept clear: boarded from beside it, v1.5.5); it takes nobody while a **helipad guard** is up, nor anyone **out of a guard's uniform** (the pilot flies staff). It is its own way out, **helicopter** (§12 lists it under the roof route; the victory screen names how) |
| Riot guards (P12) | §4.5: "Guards: 10 (includes armored riot guards)" | Four: the two walkway guards and the two helipad guards. **Strength 80** (130 health, harder blows) and plates worth **defense 45** (a blow does 15 less); helmet, visor and plates on screen |
| Irongate's takeover (P12) | §4.5: "defeat 9 of the 10 guards simultaneously to force the Warden to lower the South Ferry Drawbridge" | The rule as everywhere (⌈85%⌉ = 9 of 10). In a takeover the gates open and **the drawbridge comes down** (`PrisonDef.drawbridge`: water walkable while the prison is the inmates'); across it onto the ferry landing is the takeover escape |
| Irongate's ways out (P12) | §12: tunnel (levels 1–4), cutout (1–3), roof (1–5), takeover (1–5), raft (5) | **Raft, helicopter, takeover**: the sea floods every tunnel, there is no fence onto a road, and the roof route ends in the helicopter |
| Themes (P12) | — | **island**: the sea to the horizon with drifting swell, surf and shallows round a rocky shore, sea stacks, rocky turf, granite walls, slate roofs, the ferry landing's cobbles, a moored ferry and patrol boat, the drawbridge, the helicopter; surf and gulls instead of birds and crickets |
| The campaign's end (P12) | §4, §13.2 | The first escape from Irongate (the last prison) says so on the victory screen: every prison beaten |
| Saving (P8) | §2: "sleep in bed to save progress"; tech_plan: autosave at 08:00 plus manual Save/Load | **Both**: the game in progress is saved on falling asleep in bed, at 08:00, and whenever the game is paused, hidden or left (a phone may close a background tab at any time); **Continue** on the title resumes it. Three **slots** take a save by hand from the pause card; the title loads any of them. A new game asks before replacing the one in progress; an escape ends the run (its save is deleted, slots stay) |
| Followers | Recruit up to 2 at 80+ | Recruited at **opinion 80+**, at most 2; they keep a step and a half behind, and go for a **chasing guard or an angry inmate** within 6 tiles, landing their own blows (they can knock guards out; guards don't target them). Hitting one, Lights Out, or the player being caught or knocked out ends it. Inmates have **nicknames** (the same in every language) |
| Speech bubbles (P13, v1.7.0) | §13.2: "Floating speech bubbles and quest icons (`!`, `$`) over inmates" | Bubbles over **inmates and guards**, saying what they feel: presentation only (`src/talk/`, the simulation never sees them). Moods read from the game (hungry on the way to the canteen, nervous after a shakedown, a grudge, a chase, a lockdown…), **10 inmate voices and 2 guard voices**, about **1,000 lines per language** (English and French, light humour), reactions to what just happened (a guard shouts *why* it noticed the player, watchers cheer a fight), two-line exchanges, catchphrases. Never repetitive: a speaker never repeats one of its last 6 lines, nobody one of the last 40 heard, and when nothing fresh is left the speaker stays **silent**. **Gossip** from friends close by (opinion 55+, 3 tiles) is always true (worked out from the rules and the state when told; `gossiptest`) and kept in the prisoner's file (**Rumors heard**, saved with the game). Guards have **names** (data, the same in every language). Settings: chatter lots / some / off, voices (a murmur under each bubble). None in lessons, while asleep, out cold, in solitary or off the ground floor |
| Noise and distractions (P14, v1.8.0) | Not in the GDD: guards notice the player's work only by sight (§5.2, §9.3) | **Guards also hear it**, by rules shown on screen. A noise carries so many **walking tiles** through wherever sight passes (a shut door counts 4): chipping 6, cutting 5, digging 3, unscrewing and sharpening 2 (plastic −1; sturdy, powered and multi +1); a thrown item by what it is (soft 2, hard 4, metal 6); a **firecracker** 10 (it wakes guards asleep); an **alarm clock** 7, once a second for 8 s. From a tunnel only the 3×3 tiles above hear it; from the vents the floor within 2; from a roof the open ground. The guards awake who hear it (the two nearest, three for a bang, none if one is already looking close by, never one chasing) go and look where it came from for 8 s (12 for a bang); **noise costs no heat**, what they find there does. **Throwing** anything in hand (6 tiles, 7 at Strength 70, a clear line, open floor) lands it at once; contraband thrown over a detector arch is never scanned; an inmate hit thinks less of the player (−2). The **ear** on the tool button says a guard would hear the work (`wouldHear`, the sim's own rule). Two new items: the firecracker (foil + toilet paper + lighter, Int 40) and the alarm clock (battery + wire + plastic cup, Int 30). The escape bots never strike within a guard's earshot, so their runs are unchanged |
| Guard ways (P15, v1.9.0) | Not in the GDD: every guard follows the same rules (§5); the shakedown's cells are drawn at random (§2.1) | **Guards have their ways** (`GuardDef.trait`, as data): **steady**; **lazy**, who dozes off at the nap stop of the night round between 01:00 and 05:00, once a night, for 1 to 2.5 game hours (05:00 at the latest), blind meanwhile, woken by a noise that reaches it with 2 tiles to spare (a bang anywhere in earshot), by the player at its elbow for a second, a lockdown or a job to do, and who looks around a quarter less; **strict**, who looks around half as long again, searches three cells at the shakedown and each desk half as long again (the last search may run into breakfast: still the morning shakedown), and reports a bribe (+20 heat); **corrupt**, who takes one. Every prison has one strict guard (the shakedown's), a lazy one and a corrupt one or two; the tutorial's guard is steady. **Talking to a guard** awake on its ordinary duty (not with the player wanted, in a lockdown or a takeover): it stands still facing the player. **Bribes** (`TALK.BRIBE`): look the other way, $40 + $10 × the prison's level, for 2 game hours (it lets the hour, staff areas, contraband in hand and a uniform pass, and its sight doesn't count as seen; never a fight, tools at work, damage or a camera); lose the paperwork, $30 + $10 × level, −25 heat once a day per guard; refused at 80% heat, and a look away ends at 80%. The shakedown's cells come from `roll()` (state.salt, never state.rng; the two old draws are still made), so inmates can tell which cells the next one will search: gossip is never wrong. The escape bots act before 01:00 and before day 2's shakedown: their runs are unchanged |
| Achievements & you (P16, v1.10.0) | Not in the GDD (§13.2 has the victory screen's tally only) | **A run ledger in the sim** (`ledger.ts`: counters and per-day bits counted from each step's events after the step, so nothing plays differently; old saves load *partial*, and conduct needs a whole run). **42 achievements in 7 groups** (ways out, speed, conduct, know-how, prison life, mishaps hidden until they happen, career); the **Daily group waits for P26** (nothing to earn before it exists). **Medals per prison and way out** (gold, silver, bronze by day, never taken away; a table with a row for every route). **Your prisoner**: the Intake (name, 9 parts, 33 cosmetics given by achievements), drawn into the player's existing meshes (no draw call more); in the guard's uniform the hat and trim give way to the guard cap, and hair that would stand up lies flat under it. **The escape camera** turns up to 25° and pulls back, letterboxed, ESCAPED stamped (LIBRE ! in French), a tap skips it. **A silent run recorder**: commands as varint runs with an hourly checksum of a stable fingerprint (not the whole state: a later field must not break old logs), kept next to each save and for the last and quickest escapes, dropped first when storage is full; the viewer comes in P25. Lifetime stats count play as it happens (a stretch replayed from a save counts again), but **an escape counts once per run** (its salt) |
| The day (P17, v1.11.0) | Not in the GDD (§2.1 has one fixed schedule; §4.2 Stalag's cold only) | **A prison day runs 08:00 to 08:00, its plan pure** (`calendar.ts` `dayPlan`: the prison, the run's salt, the day): a **weekly deck of event cards** per prison (each dealt once a week, shuffled with `roll()`), **weather that tends to last** (by climate: Stalag Flucht never rains, its storm is a blizzard; San Pancho has heatwaves; Irongate sea fog), the wind, the warden's mood, the event's times; **day 1 always quiet and clear** (the escape bots' day: unchanged byte for byte); `state.calendar` forces days (tests, bots, the Daily), `mods` will (P26). **Events**: inspection 10:00–16:00 (guards see a tile further, contraband in sight ×2 heat, 4 cells shaken down, $25 for a clean day), fire drill at a drawn time (to roll call within 15 game minutes, else +40%; the buildings empty), feast (dinner +70 energy and full health), the generator's service 13:00–13:45, movie night 19:00–21:30 (everyone in the canteen; its film muffles noise there), food fight at a meal (blows at inmates in the canteen cost nothing; two guards drawn in). **Weather**: guards out in fog (mornings and from 19:00), rain or a storm see 4, 6 or 5 tiles (`sightOf`: the cones are drawn with it); rain and storms muffle outdoor noise; a storm cuts the power 2–3 times a night and grounds the snipers (fog too); **a heatwave's sun bakes like the cold** (the same exposure, a shower cools at once). **Wardens** (Hartley, Adler (not Vogel: a Stalag guard has that name), Kroll, El Jefe, Ashcombe) read the day: a morning card, warnings 15 minutes ahead, a 22:00 forecast; a food fight is never announced (a rowdy canteen), the drill's time neither. Since a game minute is a real second, the drill's muster is 15 seconds and a food fight 15 |
| Delivery day (P18, v1.12.0) | Not in the GDD (no stowaway route) | **A weekly delivery card** at Center Perks (supply truck), Stalag Flucht (Red Cross truck), San Pancho (produce truck) and Irongate (supply helicopter, by day); Shankton has none. The card **takes the place of one card** in each week's deck (a quiet day, a second drill, a second food fight, a second inspection), so the deck keeps its length and every other day deals as before; a game saved before P18 keeps the old card on the day it's loaded. The vehicle is in **12:30–14:31** (drawn arriving in the 5 minutes before): its bay is solid and stops sight, its doors stand open, and **its supervisor walks its round**, goes to its tail at 14:25 and **searches it at 14:30** if on duty within 3 tiles (not out cold, not looking into a noise, not bribed to look away). A search is **thorough** by the prison's odds (25/40/60/80%, drawn per day with `roll()`), always for a strict supervisor, and for two weeks after a stowaway is caught; in a lockdown nothing leaves unsearched (damage found while the player hides raises one). Center Perks' visitation gate stands open while the truck is in: the south yard is open ground that afternoon, no key needed (the user's call, 2026-10-17; seen, the fence is still tampering). **Hiding**: Interact at the tail with no guard (or camera) looking, not wanted, before 14:30; hidden, nobody sees or hits the player and the routine goes on without them; Interact climbs out; Wait runs the clock ×8 until the sign-off. Thorough: found, solitary; else away at 14:31, route `stowaway`. All of it data (`PrisonDef.delivery`) and drawn; no map edits. Medals by the calendar: gold with the first week's truck (day 8), silver 15, bronze 22. |
| Guard dogs (P19, v1.13.0) | Not in the GDD | **Four dogs, bound to their handlers** (data: `GuardDef.dog`): Shankton's Brutus (Duffy), San Pancho's Canela (Ríos) and Bandido (Ochoa), Irongate's Admiral (Hask); no Cast id, they never bite, nobody fights them, they don't count for a takeover. **From prison day 2** (day 1 stays as it was, the escape bots' day) they walk at the heel 10:00–22:00, the night dogs 01:00–05:00 too, and every dog comes out in a lockdown; otherwise they lie by their kennels (data and drawn, no map edit). **Nose**: contraband in the hotbar within 1.5 tiles and a clear line: point, bark (noise 6), +25% heat, the handler sent to look; not again for 30 s; a pouch in the hotbar keeps the smell in, a uniform fools no dog, trust 60+ lets it by. **Trail**: out of bounds (after hours out of the cell, staff areas, wanted, a lockdown) each ground tile the player stands on is laid, 32 at most, fresh 90 s; a dog beside it (any dog on shift in a lockdown) follows it to its end at 160 units a step, its handler following: to the player (pointed at), or to the way they went through, down or up (shaft, grate, hole or fence, **cover or no cover**: damage found, the alarm, every guard told where); a friend (trust 100) never follows. **Counters**, thrown to land by the dog: jerky (+20 trust once a day), pepper (10 s of sneezing, the trail gone), sleepy jerky = jerky + sleeping pills (asleep 2 game hours); soap (Use) or a shower washes the trail off. **Where they come from**, with no new draw from `state.rng`: at 08:00 from day 2 at dog prisons, jerky and pepper on every canteen counter and the pills in one inmate's desk chosen by `roll()` (the gossip names whose), each taking a full container's last ordinary slot if it must. Old saves load the dogs in their kennels; runs logged before 1.13 replay with the dogs kept in (`Sim.noDogs`). |
| The pet rat (P20, v1.14.0) | Not in the GDD | **A rat trap** = plastic cup + potato, chocolate or jerky (Int 20), set down on a floor (the tool button); at 04:00 a trap on the floor catches a rat as `roll()` says (never `state.rng`): 60% in a kitchen, canteen or storeroom, 85% down a tunnel, never elsewhere. A caught rat is contraband; **fed twice** (potato, then chocolate, then jerky from the hotbar) it is tame and rides on the player's shoulder from then on (state, not an item: never confiscated; one at most). **Errands** (`EXT.RAT_FETCH`/`RAT_LEAVE`, the container index in b and c): from the ground floor, to furniture that isn't the player's or the pockets of anyone asleep or knocked out, within **16 tiles of rat way** (under any door, over a wall where a duct runs above it, never outside the walls); it brings back the most valuable small item (`ItemDef.small`: keys, molds, odds and ends; never from a hidden compartment) and any change, or leaves the small item in hand in a free slot; someone awake by the time it arrives keeps their pockets. Back, it finds the player anywhere its way reaches, or waits out of sight (with whatever it carries: a rat waiting is out of every search) until there's a way to them. **Let loose** (`EXT.RAT_LOOSE`) among 3+ people awake in sight within 4 tiles, once a prison day: 20 s of panic, inmates within 6 tiles and in sight flee, their spot kept, and take up what they were doing once it's over (the rules draw nothing new; an inmate who fled off its free-time spot walks back and lingers afresh, as the routine always draws), its squeak (noise 10) sends up to 3 guards to look for the 20 s; a caught rat thrown into a crowd does the same and is gone. **Dogs** on shift go after a rat they see within 5 tiles (barking); on an errand the rat gives it up and bolts home. **Keys**: a guard who wakes (from bed or a nap) without his key radios it in as one coming round does: a spare (a full pocket's last odd item dropped for it, so it's missed once) and the alarm (`keyless`; runs logged before 1.14 replay without it, `Sim.noRats`, and aren't carried on); so the key heist is fetch → press a mold → put it back before he wakes. Guard beds and nap stops are 44–98 rat tiles from the player's cell: the heist needs the player to sneak near first (the plan's 16 kept). Runs with no rat never change (escape bots byte-identical). |
| Smuggling (P21, v1.15.0) | Not in the GDD | **The burner phone**: the fixer (one merchant per prison: Lefty, Scraps, Deacon, Primo, Rook; `SmugglingDef.fixer`) sells one to a friend (opinion 60) in free time for $60 (`TALK.PHONE`), one at a time; contraband, and **plain to see in hand** (`ItemDef.obvious`: a guard seeing it there reacts as to a tool or weapon). With it in hand, **an order** (`EXT.ORDER`, b = catalogue entry, c = the way), one at a time, paid on the spot: crowbar $70, screwdriver $60, rope $50, balsa $45, sheet metal $40, duct tape $40, firecracker $25, battery $15 (**the plan's lockpick and blank ID card join in P22 and P24**, when they exist). **By drone (+$20)**: on the first night it can (an hour's notice, else the next; **never on a storm day**), at a minute `roll()` draws in its hours (Center Perks 21:00–22:00, evening free time, its yard open to all then; elsewhere 23:30–02:30), it drops the item on open ground in the drop area, downwind of its middle by the wind's strength ±1 tile; its buzz is noise 8 sending 2 guards; a guard awake who sees it lying there (not one bribed to look away) seizes it; the sirens on at that minute, it turns back and comes the next night. **With a visitor (+$10)**: a **visiting day** card (10:00–12:00) in the deck where people visit, **in place of a card** (Center Perks' feast, Shankton's second quiet day, San Pancho's and Irongate's movie night; a save from before P21 keeps that card today and tomorrow, a run logged before replays with it): sat at a seat across a counter or table in the visiting room (Center Perks' visitation; the canteen elsewhere: **no map edits**) for 3 s, the visitor comes with $10–20 (once a visiting day, order or not) and the order (no room in the hotbar: kept for the next visiting day). While visiting hours last the room's ways out are **detector arches** (powered, a pouch gets through) and at 12:00 whoever is still in the room is scanned. **Stalag Flucht** has no visits: the order comes in a **Red Cross parcel** with the truck, into the player's desk at 14:45 on delivery day, seized if that day's search was thorough (or a lockdown's) and it's contraband; a full desk keeps it waiting that day. When and where is pure (`arrival`, `droneMinute`, `dropTile`): the phone's panel says it, and it's proven by `smuggletest`. Escape bots unchanged (nothing new happens without an order, and day 1 is never visiting day). |
| Side games (P22, v1.16.0) | Not in the GDD | **Who plays**: an inmate at opinion 40 or more, on its feet (not sat down), in free time and the exercise hour (never in a lockdown), **three games a day each** (`state.played`, prison day). **Dice** (`TALK.DICE`, stakes $5/$10/$20, asked twice): the stake goes on the table as the dice are thrown; two dice each (`roll()`, `SALT.DICE`), the player may throw **one** of theirs again once (`TALK.REROLL` mask 1 or 2; 0 stands; both is refused: the inmate keeps a 2% edge), then the inmate throws, and behind or level throws its lower die again; the higher total takes the stake (a tie gives it back). Dice still on the table when the talk ends (or the games' hours do) stand. A guard who saw the player at its last look (not one bribed to look away): spotted `gambling`, +10% heat; the card warns from the same look. Any game: +2 opinion. **Arm-wrestling** (`TALK.WRESTLE`, 6 energy, double when chilled): presses left and right in turn (`OP.TRAIN` 1/2) push the bar 20 + Strength/4; the inmate pushes back (its Strength + 30)/10 a step, half again in a surge (`SALT.SURGE`, 30% of seconds); at either end it's won or lost, a draw at 30 s; a win: +6 opinion, +2 from every inmate watching (6 tiles, in sight; each once a day, `state.cheered`), +1 Strength (trained today; none at 100); a loss or draw +2; `OP.TRAIN 3` or a step gives up. **Sports day**: a day card (`DAY_EVENTS` appended) in every campaign deck **in place of a card** (Center Perks' movie night, Stalag Flucht's feast, Shankton's and San Pancho's drill, Irongate's food fight; `beforeSports` for old saves and pre-1.16 logs), 10:00–22:00: three bouts won pay $30 and +3 opinion with everyone, once. **The lockpick** (wire + nail file, Intellect 40; on the phone for $35; 12 uses): on a keyed door shut to the player (never a perimeter gate), pins by colour (yellow 2 … green 6); the marker sweeps 0→1000→0 at 25 a step, each pin's sweet spot 120 + Intellect wide where `roll()` puts it (`SALT.PINS`), judged at the press's step or the one before; a pin set clicks (noise 2), a slip scrapes (noise 6) and wears the pick; all set, the door opens for the player alone (`World.pickedDoor`) until they've been through it or 15 s; work on a door is tampering. The card warns when a guard would hear a slip or anyone sees the player at it. Escape bots unchanged (nothing happens without the player asking). |
| Crew & specialists (P23, v1.17.0) | Not in the GDD (the plan had "Work the shaft" as an order of its own and a brawl drawing guards by its noise) | **Lines of work** as data (`PrisonDef.crew`, by cell): lookout, digger, muscle, smuggler; every campaign prison has each. A **follower** (opinion 80, two at most) takes **orders** in his line (`TALK.CREW`, b = `ORDER`), kept in `state.crew` [who, order, place, more, night]; a follower with none follows exactly as before (escape bots and old run logs unchanged). **Keep watch here** (lookout): he stands where he was told whatever the player does, and whistles (`crew` event) once each time an awake guard comes within 6 tiles in his sight; never posted in a doorway, beside the player's cell door or inside a work room (someone there holds a door open); `EXT.RECALL` whistles him back from anywhere. **Dig with me** (digger): ground-floor chipping and digging ×1.5 with him within 2 tiles in sight, the rubble and dirt his; down a tunnel (seen going down) he waits beside the shaft, never in it: tunnel digging ×1.25, the dirt handed up (one order, not two). **Watch my back** (muscle): his blows ×1.5; an ambush drawn (the RNG drawn as ever) is stopped while he's within 4 tiles, said once a block per inmate. **Start a brawl** (muscle): once a prison day, with the nearest non-crew inmate within 5 tiles he can see, for 60 s, squared up 1.1 tiles apart; the 2 nearest awake guards not chasing the player are sent to look for a minute (straight distance, not noise: the promise holds anywhere); no heat for the player; never in a lockdown. **Fetch the drop** (smuggler): the oldest drone drop, picked up (no longer seizable), then into the hotbar at the player's side when there's room; gone first or not reached in 90 s: given up; while he carries it, no other order. **Tonight's the night** (opinion 90): stays on through Lights Out until 06:00, at the player's cell door while they're in it; while cells are locked no one with an order stands in the player's cell (its door must lock). **Crew escape**: followers up within 4 tiles get out too by fence, gate, takeover, raft or helicopter (`state.crewOut`), never through a hole, down a rope or in a vehicle; the victory card names them, the records keep the most. |
| Bluff & glider (P24, v1.18.0) | Not in the GDD (the plan had the bluff's booth as a gatekeeper simulated, the glider at Stalag Flucht and Shankton only, Intellect 75) | **The bluff**: a **checkpoint** as data (`PrisonDef.checkpoint`: the window just inside the first gate, the gates, Irongate's drawbridge, the booth drawn just outside where nobody walks) at Center Perks, Shankton and Irongate. At the window with a **fake ID** in the hotbar (a blank ID card, only on the burner phone at $80, + ink + a magazine, Intellect 50), Interact shows it: refused outside the **shift change 19:50–20:10**, out of a guard's uniform, at 40% heat or more, wanted or in a lockdown (nothing lost); else **waved through**: the checkpoint's gates (and Irongate's drawbridge) open for the player alone for 60 s (`state.waved`), never shut on them standing in one, shut at once if they're wanted or the sirens go; out through them is route `bluff`. The gatekeeper isn't simulated (a guard nearby still knows a face up close). **The glider**: a frame (two balsa + timber, Int 60), then the glider (frame + bed sheet + duct tape, **Int 80**: recipes go by tens). Off a **roof's edge** with 2 tiles of roof behind (run-up), never in a storm: straight out over open ground and fences as far as the day's wind carries it (3 tiles, +2 a point of wind behind, +1 a quarter behind, −1 a point ahead, half a quarter ahead, −1 in rain; 1–10), stopped before a roof or a tower, down on the furthest open ground it reaches (not a fence, water, a minefield, a prop); out on the road is route `glider`. **One rule everywhere**: it gets out at Center Perks (N, E, W edges, a light wind behind), Stalag Flucht (the generator hut's east edge) and Shankton (the shell, a strong wind behind); San Pancho's roofs can't be reached, Irongate's end at the sea (getawaytest proves each `escapes` list against the rule). The button and a ring say where it lands and whether out; flown, it lands there. Both are **solo** (no crew). Forced days take a wind (`ForcedDay` [day, event, weather, wind, strength]). Escape bots unchanged (nothing happens without a fake ID or a glider) |
| Tutorial in chapters (v1.19.0) | GDD §13.1 has a tutorial of the basics only, on one map | **The tutorial grows into chapters**, one release each (user decision 2026-10-18): *First steps* (the 10 lessons as they were), *Prison life* (guards' ways, the day, guard dogs, the pet rat, smuggling, side games, the crew), *Ways out* (v1.20.0: picking locks, the stowaway, the bluff, the glider), *Getting by* (v1.21.0: talking, merchants, jobs, the gym, the disguise, tunnels, vents; second in the list). **A lesson may be played at Center Perks** (`Lesson.prison`, always open, nothing of the campaign given away) where the Training Block hasn't the systems (it is `relaxed`: no smuggling, day events, delivery or checkpoint; no merchants, traits or ladder); each lesson has a fixed seed (trying again plays the same scene; tutorialtest proves the seed: the smuggling drop lies a few seconds before a guard's round comes by). **Bell gets a dog, Biscuit**, for the dogs lesson (in its kennel on day 1 like every dog: the old lessons play as before; the lesson jumps to prison day 2). Steps can wait on an event (`on`) as well as on the state; the events of a frame count for the steps that come up in it. The lesson card stays up beside a panel that doesn't cover it. **Graduate** still means every lesson (never taken away from those who have it). With one inmate (the Training Block), favors never target someone else (it drew the guard as its target before).
| Daily Escape (P26, v2.0.0) | Not in the GDD (the plan: twists as `PrisonRules` data, each proven winnable by a static kit check and a bot) | **One Daily a day, the same for everyone**: `dailyOf(n)` (pure; Daily #1 is Monday 19 October 2026, the player's own calendar day) deals a prison, a seed and 1–3 **twists** to a **weekly rhythm** (a gentle Monday at the first two prisons, three twists at the weekend, Saturday at the toughest) within the day's **budget** (each twist's cost; a help gives some back; the toughest prisons leave less), never the same prison two days running, never a pair where one twist makes the other moot, and **never every way out closed** (`Twist.breaks`). Any prison may come up; the mode opens after a first escape anywhere. **21 twists, as `state.mods`** read where each rule lives (`systems/twists.ts`): Eagle Eyes (+2 tiles of sight), Short Fuse, Double Shift (no guard in bed), Three Days (over at day 4 08:00: `Sim.timeUp`, derived, no new field), Closed Shop (merchants only: the fixer still deals), Crackdown, Night Owl (bed checks at 02:00 and 05:30 too), Unpaid Labor, Quick Fix (at 08:00, damage a guard could see is mended and ground-floor wear heals; never the desk's shaft nor the tunnels), Big Freeze (the cold rule anywhere; no heatwave or rain), Bad Blood, Care Package (three things in the desk's ordinary slots and $40), Bare Hands, Fog Days, Storm, Dog Day, Light Sleepers, Straight-Laced, Customs, Lone Wolf, Truck Strike. Day 1 under twists is set up without a draw from `state.rng`; with no twist every rule is as it was (escapetest byte-identical). Rumours, the forecast, previews and panels follow the twists (a Night Owl's checks go untold rather than told wrong). **Proven winnable** (dailytest): every escape bot wins with *all* its prison's twists at once but those closing its way out (a dog on day 1: the stowaway's kit in a pouch, as a player would), and a static kit check proves each way out a twist leaves open still has its tools (Closed Shop: no grapnel, no raft). **A run of its own**: the `daily` save slot and log (never the campaign's Continue, never the Load list), unlimited tries (the quickest escape counts, with its own medal by the prison's medal days), yesterday's playable a day late (it counts for its day), a streak worked out from the history (`pe3d.daily`). A Daily's escape never touches the campaign's records, unlocks or best replays; it counts stats and achievements (a **Daily group** of 7). **Result card**: the medal, the day, the tries, the streak, a spoiler-free strip (a square a day: quiet, spotted, wanted, caught, out) and a check code; Share uses the phone's share sheet, copies on a desktop, else shows the text to copy |
| Card sharks (P27, v2.2.0) | Not in the GDD | **Cheat** (`TALK.CHEAT`, stakes as dice's, one of the three games a day with an inmate at opinion 40): 14 cards (4 Kings, 4 Queens, 4 Aces, 2 wild Jokers, `roll()`-shuffled, `SALT.CARDS`), five each, a table card a round; turn about, 1–3 cards laid face down as the table card (`TALK.PLAY`, a mask) or Liar! called on the last play (`TALK.LIAR`): the wrong side loses a chip, the cards stay up 4 s, the loser leads; a hand played out must be called; two chips each, the last loses the stake (held on the table). The inmate calls a claim its own cards (and the true cards it laid) prove false, else on the claim's exact odds as it sees them (`claimOdds`: 60% of its doubt past 20, +10 with nothing true); it lays 1–3 of its true cards as `roll()` says (the rest kept back), else a bluff of 1–3: the size of a play tells nothing. Its tell (by cell: an ear, a glance, fingers, a whistle) shows on 40% + Intellect/4 (at most 80%) of its lies and 20% of its truths. Measured (cardstest): never calling wins 41%, reading the tells 48–55%, counting its plays 58%, calling everything 2%, bluffing everything 28–32%. A guard who sees it: gambling heat (+10%). Walking away folds (the stake lost); the sirens, or the partner knocked out by someone else, call it off (the stake back). **Hoops**: the decor's hoop in each yard (Center Perks moved to the east wall, Stalag Flucht and San Pancho and the Training Block given one) and its five painted spots (`court()`; maptest-like checks in cardstest: open floor, no decor, nothing in the way). A shot (`EXT.SHOOT` held, let go; or up after 6 s) on a spot, with the yard open: the power marker (0→1000→0, 42 a step) judged at that step or the one before against the spot's need (250 + 150 a tile, ±20 a point of wind along the shot) in a window of 70 + Speed/2 (−15 a tile past 2, −20 in the rain, at least 25): its middle third a swish, in it a basket, 70 past it a rim-out, else an airball; the rim's clang is noise 3. Five baskets on one's own in a prison day: +1 Speed, once. A shootout (`TALK.HOOPS`, both within 7 tiles of the rim; one of the day's games): five shots each from the spots in turn, the inmate's by `roll()` and its skill (35–65, −8 a tile past 2), sudden death (3), else a draw; won: +6 opinion, +2 from each watcher once a day, +1 Speed, a sports-day win; lost or drawn +2; off when the player goes 10 tiles from the rim, the sirens or a knockout. **Checkers with the old-timer** (`leisure.oldTimer`, white-haired; Doc, Badger, Flint, Lobo, Barnacle, Sparky), from opinion 20, in the games' hours, no stakes, no heat, not one of the day's games: English draughts (captures forced, a jump goes on, crowning ends the move, a piece taken comes off at once), the player a step at a time (`TALK.MOVE` b from, c to), his move an alpha-beta search 2–6 plies deep by the games the player has won (a slip now and then at first), ties by `roll()`, after 1–3 s; drawn after 60 quiet plies; the board kept between times. Won: +4 opinion, +1 Intellect, his level up, and a lasting fact the player hasn't heard told as a secret (the play layer's, kept in the file); lost or drawn to the end: +2 opinion, +1 Intellect once a prison day; resigned: nothing. **A game begun plays out past the games' hours** (a talking inmate stays put): only the sirens, a knockout or walking away end it. Escape bots unchanged (nothing happens unless the player asks). |
| Long games (P28, v2.3.0) | Not in the GDD | **The makings on request** (`EXT.TAKE`): a piece of fruit at an open canteen counter at breakfast and dinner (one a meal), sugar from an open kitchen freezer and a seed packet off an open library shelf (one a prison day each); every merchant's staples (sugar, vegetable and fruit seeds; `TALK.BUY` past the shop's slots; no opinion); merchants buy ripe pruno and vegetables at 75% of value, 4 sales a day (`TALK.SELL`). Nothing is stocked, nothing drawn from the RNG. **Pruno**: fruit ×2 + sugar (Intellect 20) → a bag whose uses are mornings left (2), counted down at 08:00 in a desk or a toilet's tank (not carried, not on the floor), then ripe ($30 sold, +15 as a gift). Searches find it only in a desk's standard drawers; a dog on shift within 2 tiles of the furniture (through walls) points and it's seized (sniffed heat in the player's cell). Drunk: tipsy 3 prison hours: blows ×1.5, walking at 80%, a stumble (noise 3) every 6 s on the move, a guard who catches sight of it +20% (once a sighting, 5 s apart; SPOT `tipsy`). **The garden** (`leisure.garden`, 3×2 beds of open diggable yard soil, clear of the court): seeds planted, a cup waters (twice a day at most), a stage a day watered (rain and storms water, a heatwave needs two), ripe at 3, a dry day wilts, two kill; harvested (any hand) for 2 vegetables or 2 fruit. A shaft dug through a planted bed isn't damage a guard sees (a dog's trail still finds it). **Rat racing** (`leisure.race`, a 6-tile track in the cell block or a corridor): the pet's speed (20 tamed, appended to the rat with `fed` and `lap`), the rat track (2 magazines + duct tape, Intellect 30) in the player's cell in evening free time once a day with bait (eaten: fed today; gain 3 + (100 − speed)/10); odd nights at 21:00, the card from 20:00 (3 inmates' rats by `roll()`, `SALT.RACE`, their speed by cell, fed 65% of nights; the pet after them if entered, before any bet), one bet ($5/$10/$20) at the bookie's simulated odds, 10 legs of speed + 40 fed + up to 200 luck; a $10 purse for the pet's win; the cheering is noise 6, a guard seeing the player at it with a bet on +10% once; a lockdown or a scratched pet calls the bets off. Without the player betting or entering, nothing happens in the sim. Escape bots unchanged. |
| Team & ink (P29, v2.4.0) | Not in the GDD | **Yard football** (`leisure.pitch`: a rectangle of open yard or roll-call floor clear of the garden, the hoop and props; its goals in the end tiles' middle two; the field between the goal lines, at least 8 × 4): asked of an inmate at the pitch in the games' hours (`TALK.FOOTBALL`, one of the day's games with him), he captains the other side; the player's side is the two inmates who think most of them, his the two nearest the pitch (any up and about within 40 tiles: they walk over; fewer than four: no match). The whistle once all are on the field or after 15 s; 45 s of play. The ball in units: friction 95%, bouncing off the boards (60%), a goal through a mouth 2 tiles wide; the player dribbles by running into it and kicks it with Space held (`EXT.KICK`, 240–560 a step over 1.5 s, the way they face, within 0.7 tile); inmates chase it and keep goal, shoot by `roll()` (`SALT.FOOTBALL`) within 4 tiles of goal and knock it on further out, a team-mate passes to the player ahead half the time. The side that let a goal in kicks off (the other side's first): the other keeps off the ball until they've touched it, 3 s at most (built after the rules review: a player camping the centre spot won 23 of 30). Measured (teamtest, 30 matches against a simple bot): won 18, lost 5, drawn 7, 1.5 goals a match. At the bell for the next block, full time. **The cover**: a guard on duty outdoors within 16 tiles of a match in play, with the ball in plain view, sees anything off the pitch at half his range (the player, damage, the drone's drop; his cone drawn so); never one chasing or sent to look; a goal stops every one watching to look at the net for 5 s. The player's blow at the other side is a foul: they all go for the player and the nearest two guards come to look; one of them going for the player on his own (a grudge, an ambush) ends it as off, as a blow at a team-mate does. No roll-call or hoop spot lies in a net (teamtest). Won: +3 opinion with the team-mates, +1 with each inmate watching (once a day), +1 Speed, a win toward sports day. **Tattoos**: a gun (toothbrush + battery + razor blade, Intellect 30; contraband); each sitting uses a jar of ink (the existing item, not the gun's uses). `TALK.TATTOO` (b: heart $15, skull $25, eagle $40) with an inmate at 30+ in the games' hours (one of the day's games; built after the rules review: one a prison day for each, three a day in all, a sitting off if the two are more than 3 tiles apart): the pen runs along the design at 16 a step after 1.5 s, the needle follows the moves at 22 (the player doesn't walk meanwhile), quality from the mean distance (12 free, 0 at 152; since v2.22.0 drawn by hand, the ring waiting, quality from the distance to the design: 10 free, 0 at 70), pay 50–150% of the price, opinion +2 to +12; given up (`EXT.INK`), no pay and −5. `TALK.INK_ME` with a friend (70+): 6 s, the design on the player's arm (up to 3, one of each), drawn on the forearms and kept in the state. A guard who sees either: +15% heat, once a sitting (SPOT `tattooing`). Without the player asking, nothing happens in the sim. Escape bots unchanged. |
| Stage nights (P30, v2.5.0) | Not in the GDD | **Two day cards**, each in place of one in every deck (the deck keeps its length; built after the rules review so every older card is still dealt somewhere): Center Perks' quiet day and generator service, Stalag Flucht's generator service and quiet day, Shankton's film and generator service, San Pancho's food fight and inspection, Irongate's quiet day and drill (`beforeStage`: a save from before keeps them on the day it's loaded and the next; a log from before 2.5.0 is replayed with them, its days capped at 1000 on). 19:00–21:00 each; never on day 1. **Talent night** (`leisure.stage`: the performer's tile in the canteen and the way the room is; boards a tile either side and a row in front): the evening's crowd sits in the canteen (as movie night), and the music muffles noise there as the film does while an act or the player's song plays. Two or three acts (inmates by `roll()`, `SALT.STAGE`, each a song, an instrument and a mark of 50–85%) take the stage for 10 minutes each from 19:00, 12 apart, walking to the wings 10 minutes before; the player's turn is after the last (`EXT.STAGE`, b the song, c bucket drums or a crafted guitar: timber + wire + duct tape, Intellect 30, legal), once a night, standing on the boards (moved to the performer's tile, still meanwhile, no other action; `EXT.STAGE` b 255 gives it up). A four-beat count-in, then three songs of about 40 s (100, 120, 150 a minute; 53, 80 and 119 notes, never closer than 4 steps) in 3 lanes; a press (`EXT.NOTE`, b the lane) is judged at its step against the note's, centred a step late (it reaches the sim on the next step): within 1 perfect (100), within 2 good (60), else a stray (−25). The mark (the points as a share of all perfect) places the player among the acts, a tie to the player: at 50%+, $30/$15/$5 times 100/150/200% by song (built after the rules review: a two-act night paid third for nothing); +1 opinion with everyone in the canteen at 50%+, +2 when first; 80%+ the warden's goodwill, −20 heat. **Quiz night** (`leisure.quiz`: four places in the library): `EXT.QUIZ` 0 within 2 tiles of a place, once a night, by 20:00 (so it's over before evening roll call); the three nearest inmates up and about (within 40 tiles) walk to the others (10 s at most). Eight questions of 10 s, a pure function of the run and the day (`SALT.QUIZ`): four from a bank of 15 written escape-history facts (Alcatraz 1962, the Great Escape's tunnels, Colditz's glider, Papillon), four made from the game's own data (roll call, lights out, breakfast and showers' times; which guard takes bribes, dozes, reports a bribe; a guard's key colour; the cells; what a recipe makes; the delivery's search and visiting hours where the deck has them), the right one anywhere among four by `roll()`. Each contestant buzzes 2.5–10 s in, right 30% + wits × 0.7 (wits 25–75 by cell); first right takes it, a wrong one is out of that question (the player's too, `EXT.ANSWER`). Most points: $30, +2 Intellect, +2 opinion with each contestant (+1 for playing it out); a tie at the top half. Measured (stagetest, 40 nights): knowing the answers, answering in 3 s wins 40, in 5 s 25, in 7.5 s 2; guessing 0. Walked away (4 tiles), a contestant knocked out or angry (built after the rules review: knocking them down won by guessing), a lockdown: off. Under the Daily's Straight-Laced, no bribe or nap questions. Without the player asking, nothing of theirs changes; escape bots unchanged. |
| Escape replays (P25, v2.1.0) | Not in the GDD (the plan: a scout worker, a display sim within 4 ms a frame, Auto and 1–64×, skip quiet times, a scrubber with days and highlights, skip to the escape, a mismatch plays to the last verified hour, export/import, guests never grant anything; the victory card and the Medals tab) | **Every escape can be watched again** from its log (P16's recorder): Watch on the victory card and the Daily result card (back to the card after), and a **Replays** list on Trophies › Medals (the last escape, a Daily's too, and each prison's quickest; Save as a file; Open a replay file). **A scout** (`replay/scout.ts`, in a worker, the main thread a few ms a frame where there's none) plays the log through checking its hourly checksums and leaves keyframes every half game hour, a finale keyframe half an hour before the end, **highlights** (caught, lockdown, a knockout, a mishap, breaking through, into the tunnel, the vents, onto the roof, a power cut, the takeover, stowed away, waved through, the glide, the escape; one per kind an hour) and **quiet times** (asleep, out cold, solitary). **The picture** is a second sim stepped from the commands (≤4 ms a frame), jumping by keyframes; **Auto** runs ordinary time at 32× and eases to 2× round each highlight, quiet times at 96×; or 1, 4, 16, 64×; the moon (on by default) skips the quiet times. **After a rules change** a checksum stops matching: the replay plays to the last hour that did, and says so. It ends on the escape camera, then Watch again. **Watching counts for nothing** (no records, achievements, stats, saves, Daily history; a test reads the viewer's code for it). **Files** (`.pe3d.json`) carry the log and the player's prisoner (name and look: "Played by …"); a file from elsewhere is checked hard (whole numbers, at most 60 days, its commands as long as it says, a prison, twists and a way out this game has, a start that plays) and is a guest's. The HUD shows (inert), no hotbar, no tips; effects that shake the picture only at slow speeds; a glide in the air plays in real time |
| P23–P30 polish (v2.6.0) | Not in the GDD (the known limits and three reviews of P23–P30) | **Clocks on stalls**: Cheat's move 60 s (§9) and the shootout's shot 30 s (an airball); both games end at roll call or Lights Out (Cheat: behind lost, else the stake back; the shootout off). **Talent night's no-shows**: every performer still to come is called 20 minutes before the first act (dropping whatever free-time linger he was on) and kept by the wings; an act whose performer isn't on the boards 5 minutes into his slot is a no-show (no music cover, out of the ranking, "no-show" on the card); one the player holds (a talk, following, a game with them) counts as played; `state.acted` [day, bits] (a 2.5.0 save keeps the acts already begun). Knocking a rival out before his act takes him out of the ranking (the usual heat and fight costs apply); a crew brawl never picks anyone called for an act, at the quiz, in a match, under the needle or at the hoop with the player. **Crew**: no lookout post within one tile of the player's cell door (as the help said); the digger's help and the crew's escape count need a short walk on foot (a fence blocks), not a line of sight. **The glide** never comes down on ground neither inside nor out (Shankton's double fence: `World.afoot`). **The pitch kept clean**: Stalag Flucht's pitch moved to the walkway (4,41 13×4), clear of the roll call and the hoop; elsewhere the render time-gates the other paint (the roll call's marks over a pitch show for roll call, the 20 minutes before it and a fire drill; hoop spots on a pitch only near the court and never in a match), since moving roll call spots or courts would move inmates and the escape bots. Guard Huber's day and night rounds still stop at the new pitch's middle (10,42): moving the stop changed an escape bot. **Old runs**: logs from 2.5.0 and before replay by their own rules (`Sim.rules250`, `beforeFixes`; Stalag's old pitch is `leisure.pitchWas`, painted as it was). **French money**: "$5" in labels and chips, "5 $" in sentences (two conventions on purpose). **The draw-call budget** holds where the browser has WEBGL_multi_draw (one call per BatchedMesh); without it a roll call's yard measured 166–254 (v2.5.0: 280–497) |
| Courtyard, sports and garden | (not covered) | The GDD draws one courtyard per prison. From P31 (2026-10-21, user's request) every prison is redrawn with a fenced **sports ground** (pitch, court, running track, weights, bleachers) and a **vegetable garden** with a gardener job; the courtyard is a quiet yard. Saves from an older map restart that prison; the escape bots are re-tuned (their snapshots may change in P31–P33 only). See §10 |
| Shankton's rooms, Stalag's garden (P32) | §4.2, §4.3 | §10 planned Shankton's kitchen, laundry and janitor's closet into spare cells, but Shankton has 12 cells for 12 people (GDD §4.3: 12 inmates), so they line the canteen's north side instead, the rec ground taking their block (14×14, a 12×7 pitch). The GDD's central roll-call courtyard keeps roll call (three rows of four) beside a walled garden plot. Stalag's garden is behind cabin B, not cabin A: cabin A's strip is the GDD's boulder field for the zig-zag tunnel (§4.2 layer −1), left as it is; its beds lie along the wire (cabin B's wall hides the two rows in front of it from the camera), and the two boulders under them moved a tile north, under the wire, where they still bar the same line. Solitary gives up its empty south half to the sports ground |
| San Pancho's and Irongate's grounds (P33) | §4.4, §4.5 | §10 planned San Pancho's sports ground by narrowing the canteen and gym beside the plaza ("about 20 cells for 14 people"), and Irongate's yard grown to about 11 deep. San Pancho has 14 cells for 14 people (§4.4: 14 inmates) and the plaza's middle band is 9 rows, too shallow for a pitch and its track: the ground takes the plaza's south half (14×15) with the control room and solitary shortened under it, the plaza's north half stays the yard and roll-call square (§4.4 "central plaza & roll call square") behind a see-through fence; the canteen and the gym, which opened onto the plaza, are reached from the wings' lobbies; the road out runs library → generator room (red) → control room (red), with the quarters' door purple: the GDD's "[P][GEN][R]" guard post, the same red and green keys out (§4.4). Irongate's yard is the roofs' chasm the helicopter route's grapnel crosses (§4.5 Escape B; reach 6 tiles): grown to 11 the route breaks, so the ground takes the yard's west third down to the main corridor (14×16) and the yard's east two thirds stay 5 deep; the middle block's rooms move east, narrower (the canteen 4 tables, not 6), the janitor's closet into the south block beside the control room |
| Phone, kiosk and the paperwork escape (P34–P36) | Not in the GDD | From P34 (2026-10-21, user's request) every campaign prison gets a **pay phone** (calls home, a lawyer, a cousin outside on a tapped line, anonymous tips; inmates queue; eavesdropping) and an **internet kiosk** in the library (mail, a legal shop, the news, courses). An 11th way out, **paperwork**: a forged release form puts your name on tomorrow's release list, out through the front door in your own clothes. The GDD's routes are all physical escapes; this one is earned with a stolen form and a forger's hand, checked by the records at 22:00 and again at the release desk. (Built as forged paperwork, 2026-10-22, the user's choice: the planned kiosk hacking was dropped.) See §11 |
| Parole, odd jobs, the manhunt and holidays (P39–P42) | Not in the GDD | From P39 (2026-10-23, user's request) the GDD's all-escape game gains a **second, slower win**: parole, a 12th way out (`parole`) earned with a good record and a hearing, voided by plotting. **Odd jobs** grow the GDD's four favour types into small missions with story chains. The GDD ends a run at the wall; the **manhunt** adds a last act outside (a clean getaway), and the escape still counts at the wall. **Holidays** (Easter, summer, Halloween, Christmas and New Year) follow the real date, read once when a run starts and kept in the state. See §13 |
| Conduct achievements and legal releases (full review after v2.21.0) | Not in the GDD (§13.2's achievements are for escapes) | A parole run earned Pacifist, Ghost, Clean Record, Model Prisoner and Calm Waters (and often Gold Standard) without trying: the board asks for exactly that conduct. **The five conduct achievements now need an escape** (a way out not in `LEGAL_ROUTES`: paperwork and parole earn none), as their descriptions always said ("Escape without…"); this also changes them for a forged release form, which used to earn them. Gold Standard and the other speed ones stay for every way out (parole's medal days are already the longest). |
| Attendance and other inmates' cells (v2.23, user's request 2026-10-31) | §2.2: "simply needs to step foot inside the designated room at least once"; §5.2 has no rule for searching other cells | Players popped in for a step and left. **Checking in takes time**: each block with a penalty has a `stay` in `ROUTINE` (roll calls 30 minutes, meals 20, exercise 25, showers 15; the minutes add up in and out, `state.present`), the HUD badge filling as they do ("12/30 min"); blocks without one (Lights Out, the job's room, the parole board, the drill's muster) check in on arrival as before. **Left before counted**: the meals' +25%, even at a roll call (no lockdown; not there at all is still a lockdown; `BLOCK.LEFT` on the day card). **Skipping seen**: from 20 minutes into such a block (the walk across the biggest map), a guard who sees the player outside its zones before they've checked in: +2% a second (SPOT `skipping`; not excused, a lockdown, a relaxed prison, a guard's uniform). **Snooping** (`snoop.ts`): furniture open in another inmate's cell in a guard's sight (not one looking away; a guard's uniform passes for a shakedown): +20% at the sight (again after 5 s unseen), then +4% a second (SPOT `snooping`); its owner, up within 6 tiles with a clear line, thinks 15 less of the player once a search, and with a grudge left (25 or less) fights. The odd jobs keep their own "seen" rules on top. Runs logged before 2.23 replay all this as it was (`Sim.rules222`); escape times and heat peaks unchanged (the takeovers, leaving roll call at 08:20 for the fight, are now seen skipping). |
Any further conflict found during the build is added to this table in the same commit.

## 3. Architecture

Starter layout (base playbook §2), as it stands at v2.23:

```
src/
  sim/                the rules: deterministic, no DOM, clock, Math.random or Three.js
    Sim.ts            step(cmd) in a fixed system order (below), events, snapshot/load
    state.ts          freshState, the state layout (new fields appended), snapshots
    events.ts         SimEvent (what a step reports) and the names shared with the state
    load.ts           loadState: a snapshot loaded, old fields filled in, damage put right
    command.ts        the packed command (dir, op, a/b/c): keys, touch and bots alike
    rng.ts            the PRNG; roll()/state.salt for draws that mustn't shift other streams
    Recorder.ts       a keyframe every game hour, seek(step)
    runlog.ts         a run as start + commands (saves, replays, the Daily's checks)
    tuning.ts         gameplay numbers
    world/            World (tile layers, routeBlock), grid.ts (MAP_W, tile index and centre
                      maths, four-way neighbours), tiles.ts (the map legend), doors,
                      containers (the player's desk too), reach
    ai/               paths (A*), sight, walkers, places, the autopilot used by bots and taps
    systems/          one module per system (routine, guards, watch, combat, economy, jobs,
                      security, power, structure, ways, k9, rats, smuggling, phone, kiosk,
                      paperwork, parole, oddjobs, holiday, twists, snoop (another inmate's
                      cell searched), the free-time games…;
                      shared pieces: presence (where the player is), upkeep (bed, seats,
                      showers), throwing, keys (the guards' keys and kit))
    hunt/             the manhunt: its own deterministic sim on an outside map (P41)
  content/            data: items, recipes, routine, jobs, zones, decor, days, twists,
                      achievements, medals, holidays, oddjobs, …
    prisons/<id>/     L0.map.ts, L1.map.ts, decor.ts, index.ts (PrisonDef: zones, cells,
                      props, guards, rules, escapes, comms, board, …); training/ is the
                      Training Block used by lessons
    outside/          the manhunt's outside maps, one per prison
  render/             the Three.js view: View, WorldView, instanced tiles and batched props
                      (batch.ts), characters, cones, security, weather, the island, the
                      grounds, the hunt's town and prison, portraits; quality tiers
  input/Controls.ts   keyboard, mouse and touch (stick, buttons, tap-to-walk) → Command
  play/               a game in progress: loop, session, HUD's live parts, lessons, the
                      minigames' screens
  flows/              title, intake, tutorial, Daily Escape
  ui/                 HUD, panels and cards; screens/ (title, prisons, help, settings,
                      trophies, install, share…), each a function returning a Promise
  talk/               speech bubbles: the director, moods, voices, gossip (always true)
  tutorial/           the lessons as data (lessons.ts, CHAPTERS), their kit (kit.ts: step
                      types, scene setup, goal and failure checks) and progress rules
  game/               storage (the only localStorage), saves, settings, records, trophies,
                      stats, replays, the campaign
  replay/             the scout worker and the replay runner
  audio/, app/        synthesized sound; haptics, quality, PWA and install
  i18n/               en.ts, fr.ts, barks/, keyboard labels
  styles/             CSS, one file per part (tokens in 01-base.css, dialogs in 14-dialogs.css)
scripts/
  test.ts             runs every *test*.ts in parallel against scripts/snapshots/
  *test*.ts           54 tests (§6); bots.ts, escapes.ts, parolebots.ts, holidaybots.ts and
                      huntbot.ts hold the bots they share
  dev/                map viewer (mapimage, mapshot, shotsink), help pictures (helpshot),
                      the release check (released.sh), trailer tools, probes
assets/maps/          the map viewer
public/help/          How to play's pictures
```

Maps are ASCII pictures in `.map.ts` files (a `String.raw` template) rather than `.txt`, so
the headless tests import them with no loader. The legend lives in `src/sim/world/tiles.ts`.
The underground is not drawn: it is solid ground the player digs, described by
`PrisonDef.under` (boulders, the sea).

The order of one step (`Sim.advance`, where each call's comment says why it sits there):
noise makers → clock and devices → routine block → the day's event → the holiday → night
bed checks → the knocked out come round → inmates, then guards, move → the player moves and
acts (an escape ends the step there) → combat → takeover → talk, grudges, training → laps,
side games, the crew → seats, carried notes, health, the cold, tipsy, showers → solitary →
`watch` (who sees the player, and what they make of it: since v2.23 a block skipped, another inmate's cell searched and its owner seeing) → dogs → rats → smuggling → phone → kiosk → paperwork →
parole → odd jobs → races → bribes, checkpoint gates, the key alarm, out of reach →
attendance (v2.23: the minutes at the block counted) and the day's watch → heat cools → a guard woken without his key → doors.
After the rules, `ledger` counts what happened for achievements and stats (it never
changes the state the rules read).

## 4. Phases (vertical slices)

Each phase ships sim, render, phone and desktop UI, i18n, a help entry and tests, then a
release with `npm version`. Visual checks are done at desktop size, 412×915 and 915×412.
A phase that changes a map or places something new on it also brings the map viewer
(`assets/maps/`) up to date: drawn in `scripts/dev/mapimage.ts`, `npm run maps`, and the
"In game" photos retaken when it shows in 3D (CLAUDE.md, Map viewer).

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
| **P13 Voices** | 1.7 | "Prison Life" begins (the new version, P13–P26, see the plan in the history): speech bubbles with moods, voices, reactions and true gossip; named guards; the Rumors in the prisoner's file; chatter and voices settings | `chattertest` (banks in both languages, variety, crowding, silence), `gossiptest` (every fact true, in every prison) |
| **P14 Noise & distractions** | 1.8 | Guards hear tools at work and things landing (walking tiles, doors muffle, walls stop); throwing anything in hand (aim on screen: reach, arc, landing ring, earshot, the guards who would hear); the firecracker and the alarm clock; the ear on the tool button; a lesson ("Noise"); bubble lines ("What was that?") | `noisetest` (reach, doors, below/vents/roof, tool tiers, responders, bangs, throw rules, spills, thuds, the firecracker saved mid-fuse, the clock's timing, over the arch, the ear equal to the sim); `tutorialtest` plays the lesson; `escapetest` unchanged |
| **P15 Guard ways** | 1.9 | Guard traits (steady, lazy, strict, corrupt) per prison; lazy guards' naps (Z's, blind, woken by noise or the player at their elbow); strict shakedowns; talking to guards and two bribes (look the other way, lose the paperwork); `state.salt` and `roll()`; gossip about each guard's ways and the next shakedown; trait voices and bubble lines; a HUD chip while a guard looks away; a help topic | `traittest` (the data, roll(), the shakedown's draws, the nap rules, the ear on a dozing guard, looking around by trait, talking, every bribe and refusal, an old save); `gossiptest` checks the new facts against the game (bribes offered, naps and shakedowns that happened); `escapetest` unchanged |
| **P16 Achievements & you** | 1.10 | The run ledger (`feats`, `days`, `mods`); 42 achievements and the unlock toast; medals per way out; the trophy shelf (achievements, medals, stats) as the title's third button; lifetime stats; your prisoner (the Intake, 33 cosmetics, name in the file and friends' bubbles); the escape camera; the silent run recorder; records v2 | `achievementtest`, `prisonertest`, `replaytest` (codec, under 16 KB a day, save/load/branch, drift caught at the right hour), `storagetest` (keys, migration, reset keeps the prisoner); escapetest unchanged but for a ledger line per bot |
| **P17 The day** | 1.11 | The day's plan (`calendar.ts`, `content/days.ts`): events (inspection, fire drill, feast, generator service, movie night, food fight) and weather (fog, rain, storm, heatwave, wind); `sightOf` and `muffled` for every rule that sees or hears; the warden's speakers (morning card, warnings, forecast; setting full/short/off); the Today chip, the drill in the routine pill, the file's Today; rain, ripples, fog veil, lightning, the movie screen, food in the air, the inspectors; 8 achievements, day rumours, bubbles | `calendartest` (plans pure, day 1 quiet, the deck, climates, forcing, each event and weather through the real sim, the fog's sight on a real cone, saves mid-event and an old save's quiet today); gossiptest checks the day rumours; escapetest unchanged |
| **P18 Delivery day** | 1.12 | The weekly delivery (`systems/delivery.ts`, `PrisonDef.delivery`): the vehicle's bay solid and opaque, doors propped, the supervisor's round and sign-off, hiding at the tail, the 14:30 search (thorough by odds, strict, after a catch, in a lockdown), the departure as route `stowaway`; the vehicles drawn (box truck, Red Cross truck, produce pickup, Irongate's helicopter by day) driving in and out, a ring at the tail, faded when the player is behind it; the hidden card with Wait; the warden's delivery lines, 3 rumours, 4 bark banks, 4 achievements, medals, help | `deliverytest` (plans, bay, sight, doors, round, climbing in, the search's outcomes, odds, saves, old saves, achievements); 4 new stowaway bots in escapetest (Irongate's on a thorough day, a firecracker drawing the supervisor off), the 18 others unchanged; maptest checks the delivery data; gossiptest the rumours |
| **P19 Guard dogs** | 1.13 | `systems/k9.ts` (`dogs`, `onShift`, the nose, the trail and tracking, `catchTreat`, `treats`, `dogWarning`), `GuardDef.dog` data, state `dogs` and `scent` appended, items jerky, pepper, sleeping pills, sleepy jerky; `render/Dog.ts` (five instanced pieces, kennels, the trail's prints, paw prints); the HUD's paw, Throw to <dog> on the tool button, soap's Wash off; handlers' lines, true rumours (shifts, treats, whose desk has the pills), the warden's introduction; 5 achievements; help | `k9test` (data, shifts, nose, paw before every sniff, trail, tracking to covers, treats, stock, saves), `gossiptest` dog facts against the rules, escapetest unchanged |
| **P20 The pet rat** | 1.14 | `systems/rats.ts` (traps at 04:00, `feedRat`, `sendRat`, `looseRat`, `throwRat`, `ratTargets`, `crowdAt`, the rat's way), `fights.ts` `wokeKeyless`, dogs' `DOG.RAT`, inmates fleeing, `EXT.RAT_*`, state `rats` appended, items rat trap and caught rat, `ItemDef.small`; `render/Rat.ts` (on the shoulder, running, loose, its load in its teeth), trap models; the rat's pill on the HUD and its panel (T), Feed / Set down on the tool button, toasts and squeaks, shrieks and grumbles in bubbles, true rumours; 5 achievements; help | `rattest` (data, odds, traps, taming, errands, keys and the heist, a sleeper waking, panics, dogs, saves), `gossiptest` rat facts, escapetest unchanged |
| **P21 Smuggling** | 1.15 | `systems/smuggling.ts` (`placeOrder`, `arrival`, `droneMinute`, `dropTile`, `smuggle`: the drop, seizures, the visit, the parcel, the noon frisk), `content/smuggling.ts` (catalogue, fees), `PrisonDef.smuggling`, visiting day card, `TALK.PHONE`, `EXT.ORDER`, state `order`, `drops`, `visit` appended, the burner phone item; `render/Smuggling.ts` (the drone and its parcel, drop beacons, portable arches, seated visitors, all instanced); the fixer's offer in the talk panel, the phone's panel (P, the tool button, the order's pill), toasts, the drone's buzz, the warden's visiting-day lines, rumours, bubbles; 4 achievements; help | `smuggletest` (data, the phone, orders, the drone's schedule, drift, seizures, storms and sirens, visits and arches, the noon frisk, the parcel, saves and old logs), `gossiptest` smuggling facts, escapetest unchanged |
| **P22 Side games** | 1.16 | `systems/games.ts` (`startDice`, `reroll`, `settleDice`, `startBout`, `push`, `endBout`, `pickLock`, `markerAt`, `sweetSpot`, `games`: bouts, picking, doors picked open), `content/games.ts`, `TALK.DICE`/`REROLL`/`WRESTLE`, the lockpick item and recipe, `CATALOGUE` lockpick, the sports day card, state `played`, `dice`, `bout`, `pick`, `picked` appended; `render/Games.ts` (instanced dice on the thrown faces, sports-day bunting on poles), arm-wrestle, lockpick and dice poses; the talk panel's games, the arm-wrestle and lockpick cards, toasts, sounds, the warden's sports-day lines; 5 achievements; rumours; bubbles; help | `gamestest` (data, who plays, dice by roll(), the stake held, the warning, bouts step by step, sports day, the lockpick and its doors, saves and old logs), `gossiptest` games facts, escapetest unchanged |
| **P23 Crew & specialists** | 1.17 | `systems/crew.ts` (`cantOrder`, `crewOrder`, `recall`, `crewTargets`, `crew`: whistles, brawls, fetches, the shaft, the night; `digHelp`, `stopAmbush`, `allyDamage`, `crewEscape`), `content/crew.ts`, `PrisonDef.crew`, `TALK.CREW`, `ORDER`, `EXT.RECALL`, `DOING.BRAWL`/`LOOKOUT`, state `crew`, `brawled`, `crewOut` appended; lookout and brawl poses; the talk panel's crew section, the crew's pill and panel (G), chips over their heads, toasts, sounds, the victory line and best crew; 6 achievements; rumours; bubbles; help | `crewtest` (data, orders, whistles exactly when due, digging help, back and ambush, brawl, fetch, the night, the cell door, the escape, saves), `gossiptest` crew facts, escapetest unchanged |
| **P24 Bluff & glider** | 1.18 | `systems/getaway.ts` (`atWindow`, `bluffRefusal`, `showId`, `checkpointGates`, `airOf`, `launchSpots`, `glideOutToday`), `structure.ts` `glideReach`/`glideFrom` and the `glide` tool action, `content/getaways.ts`, `PrisonDef.checkpoint`, `World.checkpoint`/`setWaved`, state `waved` appended, `ESCAPES` += `bluff`, `glider`; items blank ID, fake ID, glider frame, glider (3 recipes, the card on the phone); the booth and its gatekeeper (his relief at the shift change, the lamp amber then green), the gates and Irongate's drawbridge opening, the glide's dotted path and ring, the flight under its wing and the wreck; the waved chip, Show your ID, Glide on the tool button; 4 achievements, 3 rumours, bubbles, help, medals | `getawaytest` (data, refusals, the shift change, the gates for the player alone, never shut on them, saves, the drawbridge, reach table, run-up, storm, the button's promise flown at every edge and wind, solo, forced wind, achievements); 6 new escape bots (bluff at Center Perks, Shankton, Irongate; glider off Center Perks, Stalag Flucht, Shankton), the 22 others unchanged; gossiptest flies the glider's day from a copy |
| **Tutorial: Prison life** | 1.19 | Chapters (`CHAPTERS`, `chapterOf`), lessons on their own prison and seed, steps on events (`LessonProgress.event`), a step's least reading time; 7 lessons (guards at CP, the day at CP, dogs with Biscuit, the rat, smuggling at CP, side games, the crew); the list in chapters; Next chapter | `tutorialtest` (a bot through every lesson on its prison, each dead end ending with its message, the review's other ways through, the chapters hold every lesson once), `k9test` (Biscuit) |
| **Tutorial: Ways out** | 1.20 | 4 lessons (picking locks on the Training Block; the stowaway, the bluff and the glider at Center Perks); lesson arrows on the layer a step names (the roof); the lesson's end waits for the glider to land and lets the delivery drive off with the player | `tutorialtest` (a bot through each, every dead end with its message: the pick broken, too late to hide, the shift change missed, the gates shut again, down inside, the bed checks passed with a dummy) |
| **Tutorial: Getting by** | 1.21 | 7 lessons between First steps and Prison life (friends and favors, merchants, a job, the gym, the disguise, tunnels, vents and roofs); arrows to a job's stations, in the ducts | `tutorialtest` (a bot through each; dead ends: the favor's magazine gone, the stalls shut, the Work period over) |
| **P26 Daily Escape** | 2.0 | `content/daily.ts` (`dailyOf`, `dailyNumber`, `RHYTHM`), `content/twists.ts` (21 twists: cost, where, what each closes, never with), `systems/twists.ts` (`twist`, `dayOneTwists`, `quickFix`, the twists' numbers) and the hooks in the systems, `Sim(prison, seed, mods)`, `Sim.timeUp` and the `timeUp` event, run logs carry `mods`; `game/daily.ts` (history, tries, best, streak, strip, check code), the `daily` save slot and log; the title's Daily card, the Daily's card (today, yesterday a day late), the banner, the pause card's twists and Try again, the result card with Share, the time-up card; 7 achievements, 2 stats, help | `dailytest` (the Daily of each day for three years: pure, rhythm, budget, no repeat, a way out left; each twist's rule in the sim; saves and logs under twists; the static kit check; every escape bot on its prison's hardest Daily; the history), escapetest unchanged (its bots moved to `scripts/escapes.ts`) |
| **P25 Escape replays** | 2.1 | `replay/scout.ts` (`scout`, `scoutAll`, `highlightOf`, `Tape`, `autoSpeed`), `replay/run.ts` + `scout.worker.ts`, `runlog.ts` `prepareReplay` (shared with `replayLog`), `play/replay.ts` (`watchReplay`, `replayFrame`), `play/stage.ts` (`stageWorld`, `escapeScene`), `ui/replayBar.ts`, `game/replays.ts` (kept, files), the Medals tab's Replays, Watch on both escape cards, help | `replaytest` (scout whole, keyframes, finale, highlights, progress; every keyframe steps to the next exactly; quiet nights; a missed checksum plays to the hour before; the director; a Daily under its twists; files in and out, abuse refused; the scout stops past an escape; the viewer calls nothing that grants or saves) |
| **P27 Card sharks** | 2.2 | `systems/cards.ts` (`dealRound`, `decide`, `claimOdds`, `lay`, `callOn`, `keepCheat`), `systems/hoops.ts` (`courtOf`, `rimOf`, `spotAt`, `powerAt`, `windAlong`, `eighthOf`, `shotWindow`, `judge`, `startShootout`, `keepHoops`), `systems/checkers.ts` (`stepsOf`, `elderMove`, `checkersOp`, `moveOn`, `keepCheckers`), `content/leisure.ts` `court()`, `PrisonDef.leisure`, `TALK.CHEAT/PLAY/LIAR/HOOPS/CHECKERS/MOVE`, `EXT.SHOOT`, state `cheat`, `shootout`, `shot`, `practice`, `board`, `elder` appended; `render/Pastimes.ts` (spots, ball, cards, board), poses CARDS/BOARD/SHOOT, the decor hoop's open rim and net; `ui/pastimes.ts` (Cheat, court and board cards), the talk panel's rows; sounds; help; 6 achievements; the `oldTimer` rumour and the old-timer's secret; lessons `cards`, `hoops`, `checkers` in Prison life | `cardstest` (data and courts, Cheat in the game and its ways of playing measured, the tell's odds, hoops' windows and shots, shootouts and sports day, checkers rules and AI, saves), `tutorialtest` (the three lessons and their dead ends), `gossiptest`, escapetest unchanged |
| **P28 Long games** | 2.3 | `systems/pantry.ts` (`take`, `buyStaple`, `sell`), `systems/pruno.ts` (`ferment`, `brewNear`, `drink`, `tipsy`), `systems/garden.ts` (`bedTarget`, `tend`, `growGarden`, `underPlant`), `systems/races.ts` (`rivals`, `raceCard`, `oddsOf`, `runRace`, `raceOp`, `races`, `trainRat`), `content/long.ts`, `leisure.garden`/`race`, 8 items and 2 recipes, `EXT.TAKE/RACE`, `TALK.SELL`, `SALT.RACE`, state `pantry`, `tipsy`, `plots`, `race` and the rat's `speed`/`fed`/`lap` appended; `render/Long.ts` (beds and plants, the chalk track, racers, the home track), the tipsy sway, item models; `ui/long.ts` (the race card), the container panel's take row, the talk panel's staples and sales, the tipsy pill; sounds; help; 4 achievements; rumours `pruno`, `gardenHole`, `raceNight`, `ratFed`, `ratHungry`; lessons `pruno`, `garden`, `ratRace` in Prison life | `longtest` (data, the makings, sales, fermentation, the dogs' nose and searches, tipsy, the garden and the weather, the hidden hole, the track, the race's odds measured, bets, scratches, lockdowns, gambling heat, saves), `tutorialtest` (the three lessons and the race's dead ends), `gossiptest`, escapetest unchanged |
| **P29 Team & ink** | 2.4 | `systems/football.ts` (`teamsFor`, `startMatch`, `matchTargets`, `keepMatch`, the ball's roll and goals, `sightFor`, `endMatch`), `systems/tattoo.ts` (`inkRefusal`, `startInk`, `steerNeedle`, `drawNeedle`, `keepInk`, `endInk`), `content/team.ts`, `leisure.pitch` in every prison, the tattoo gun and its recipe, `EXT.KICK/INK`, `TALK.FOOTBALL/TATTOO/INK_ME`, `SALT.FOOTBALL`, `DOING.FOOTBALL/TATTOO`, the followers' `pace`, state `match`, `ink`, `inked` appended; `render/Team.ts` (the pitch's paint, the goals and nets, the ball, the sides' rings), the forearm tattoos, kick and tattoo poses, the gun's model; `ui/team.ts` (the match card and its Kick pad, the tattoo card), the talk panel's rows; sounds; help; 4 achievements and 2 tattoo cosmetics; lessons `football` (Center Perks) and `tattoo` in Prison life | `teamtest` (the pitches, the ball, the teams, the walk on, matches measured against a bot, the cover and a goal's look, off and fouls, the gun, refusals, tracing from fixed commands, heat, giving up, the player's own tattoo, saves), `tutorialtest` (the two lessons), escapetest unchanged |
| **P30 Stage nights** | 2.5 | `systems/talent.ts` (`actsOf`, `stageRefusal`, `startShow`, `playNote`, `keepShow`, `markOf`, `placeOf`, `stageTargets`), `systems/quiz.ts` (`questionsOf`, `buzzOf`, `contestantsFor`, `joinQuiz`, `answerQuiz`, `keepQuiz`, `endQuiz`, `quizTargets`), `content/nights.ts` (the songs as note charts, the history bank), day cards `talent` and `quiz` in every deck with `beforeStage`, `leisure.stage`/`quiz` in every campaign prison, the guitar and its recipe, `EXT.STAGE/NOTE/QUIZ/ANSWER`, `SALT.STAGE/QUIZ`, `DOING.DRUMS/GUITAR/QUIZ`, the followers' `face`, state `show`, `stageDay`, `quiz`, `quizDay` appended; `render/Nights.ts` (the stage, the buzzers), the instruments and poses, the guitar's model; `ui/nights.ts` (the talent card with its lanes and pads, the quiz card); the song's music synthesized from its chart; rumours, help, 3 achievements; lessons `talent` and `quiz` (Center Perks) in Prison life | `stagetest` (the places, the decks, the charts, the acts on the stage, refusals, songs played by bots at fixed steps, the verdict, the questions true in the running game, quiz bots measured, saves, old saves and logs), `tutorialtest`, `gossiptest` (the new rumours true), escapetest unchanged |
| **P23–P30 polish** | 2.6 | Known limits and three reviews: `render/batch.ts` (BatchedMesh furniture and decor, `skipEmpty`, `disposeTree`, `Later`), one SkinnedMesh per character, instanced doors, lintels and leisure props, `View.setWorld` reusing the same World (Watch again) and freeing the last prison after the next frame, the ground canvases cached per prison; the trees' leaves faded over anyone under them (`DecorView.shelter`), side-wall hoops turned to the camera, the roll call's paint over a pitch on its own layer (`rollCallLayer`), Big Freeze snow anywhere; the play clock (`playNow`, `playLater`); `render/pitchFrame.ts` (a match framed whole); the pruno's two presses, arrow keys on radios and tabs, replay zoom; `Sim.rules250`, Cheat's and the shootout's clocks, talent no-shows (`keepActs`, `performersTonight`), `World.afoot`, `budgettest`, `rendertest`, `playclocktest`, `pitchframetest` |
| **P31 Grounds** | 2.7 | Center Perks and the Training Block rebuilt (`PrisonDef.map` 1): `sports` and `garden` zones with gates open by the hour (`OPEN_HOURS`, `zonesOf`), `systems/grounds.ts` (`laps`, `freshMeals`), `content/grounds.ts` (`cornersOf`, `onTrack`), props `pullup`, `bleachers`, `planter`, `toolShed`, `crate`; the `gardener` machine job; `render/Grounds.ts` (track, court paint, growing crops); joggers; saves from an older map start over (`rebuiltSince`); lessons `laps`, `gardener` | groundstest; maptest (gates open by the hour); escapetest: the four other prisons byte-identical, Center Perks' seven escapes still won |
| **P32 Grounds II** | 2.8 | Stalag Flucht and Shankton rebuilt (`map` 1): Stalag's sports ground in the guards' compound's south end behind its own electric fence (gate from the dirt road), solitary halved, the garden along the north wire behind cabin B; Shankton's open-sky rec ground in the kitchen's old block, the kitchen, laundry and janitor's closet behind the canteen, the stage moved with the canteen, a walled garden plot in the courtyard, roll call regrouped; the gardener job in both; exercise posts, beats and the drone drop moved | groundstest (four rebuilt prisons; no plain fence between the new places and the perimeter); escapetest: every escape still won (Shankton's cutout bot now seen once on the way, heat 20%); teamtest (no roll-call spot on any pitch); economytest (every inmate holding a job at work at 14:59, every campaign prison); match goal rates measured on both pitches. Reviews: the bunting's poles off the pitch, the track and doorways and its strings across the camera; a fence junction drawn in halves; a gate's second leaf on the ground; Shankton's track and planters clear of the walls that hide rows; Stalag's beds along the wire; French « nouveau plan » for a rebuilt prison; Briggs off a roll-call spot |
| **P33 Grounds III** | 2.9 | San Pancho and Irongate rebuilt (`map` 1), every prison now rebuilt: San Pancho's sports ground in the plaza's south half behind the yard's fence, the canteen and gym through the wings' lobbies, the gym and showers in one room, the walled dirt garden in the showers' old place, the road out through the generator room; Irongate's sports ground on turf in the yard's west third down to the main corridor, the yard's east two thirds the 5-deep chasm with the garden at their end, the middle block narrower and moved east, the janitor's closet by the control room; the gardener job in both; beats, posts, stage, quiz, drone drop and visits moved | groundstest (every prison rebuilt; saves made now load as ever); sanpanchotest (the road out through the generator room); maptest; escapetest: every escape still won, Irongate's takeover bot holding its chokepoint (the lobby) till the prison falls (chased into the yard, three guards came at once); k9test's treat thrown where the dog stands with room round her. Reviews: the sports-day bunting strung along x only over a sports ground (Irongate's ran down the pitch edge on; the Training Block's too) and its poles a tile from any prop; San Pancho's sweeper through the sports ground and the garden (no guard ever went there); Irongate's canteen guard's beat off the yard's door, the takeover bot's fifth cup on whoever is nearest (it won only from one tile of the lobby); lamps at the grounds' north corners; stations and decor out of the rows walls hide; the job board clear of the weights; help texts without "where there is one" now every prison has the places. Accepted: San Pancho's snipers reach part of the garden (a wanted player there can be shot); Irongate's bluff bot is recognized once on the way (heat 20%), and still out |
| **P34 The pay phone** | 2.10 | `systems/phone.ts` (the queue from day 2 via `socialNow`, `wantsCall`, calls, `callRefusal`, `phrasesOf`, `phraseWorth`, `catchAt`, `louHears`, mail call at 12:00, `divertStep`, `cakeAtVisit`, `eatCake`, `wheels`, `carWaiting`, eavesdropping), `content/phone.ts`, `PrisonDef.comms` in the five campaign prisons, `EXT.CALL/SAY/LINE`, `TALK.SWAP`, `DOING.PHONE/QUEUE`, `SALT.CALLS/TAP`, `TODAY` bits, state `booth`, `line`, `turn`, `call`, `lou`, `phoned`, `rang` appended, `Sim.noQueue` for logs before 2.10, the cake item; `render/Phone.ts` (wall phone, handset off the hook, Lou's car, the diversion's beacon), PHONE and QUEUE poses, the cake's model; `ui/payphone.ts` (the dial, the queue, a call, Lou's three lines) and the talk panel's Swap places; sounds; rumour `phoneCall`, bubbles `in.phone`/`in.queue`; help; 6 achievements; lessons `payphone` and `cousin` (Center Perks) in Prison life | `phonetest` (the places, the queue, eavesdropping, places bought and cut, calls and refusals, money orders at mail call, the lawyer, tips, Lou's phrases and ways of talking measured against every listener, learned codes, each job through the real sim, saves); `tutorialtest` (the two lessons and their dead ends); `gossiptest` (phoneCall true); escapetest unchanged |
| **P35 The internet kiosk** | 2.11 | `systems/kiosk.ts` (logging in and the bill, `kioskRefusal`, `kioskOp`, letters (the money order shared with the phone: `askMoney`), the shop's order, courses (`courseQuestion`: `questionsOf` under `SALT.COURSE`), mail call's goods and drawings, the hollow book: `bookMove`, `openBook`, `hiddenIn`), `content/kiosk.ts`, `comms.kiosk` in the five campaign prisons, `EXT.KIOSK`, `DOING.KIOSK`, `SALT.KIOSK/COURSE`, state `kiosk`, `post`, `photos`, `course` appended, the thick and hollow books and the hollow book's recipe; `render/Kiosk.ts` (the wall terminal, the drawings over the bed), the typing pose, the books' model; `ui/kiosk.ts` (the bill and its clock, Mail, Shop, News, Courses); sounds; help; 3 achievements; lesson `kiosk` (Center Perks) in Prison life; the map viewer | `kiosktest` (the places, the bill, letters and money orders, drawings, the shop and a full desk, the news equal to the days that come, courses, the hollow book through every search but a dog, saves); `tutorialtest` (the lesson and its dead ends); stagetest (quiz night's questions unchanged); escapetest unchanged |
| **P36 The paperwork escape** | 2.12 | `systems/paperwork.ts` (`atDesk`, `atTray`, `trayRefusal`, `fileForm`, the records at 22:00, `calledNow`, `releaseRefusal`, `report`, the way out shutting), `content/paperwork.ts`, `GuardDef.about`, `comms.release` (`at`, `gates`, `bridge`) in the five campaign prisons, `World.release`/`setFreed`/`pastRelease`, route `paperwork` (`ESCAPES` appended), the release form in the strict guard's kit, state `release` appended, the blank and forged forms, own clothes, the forgery's recipe; no trail and no restricted-zone alarm while cleared (`watch.ts`, `k9.ts`); `render/Release.ts` (the podium), the forms' model, own clothes; `play/paperwork.ts` (the action button, the chips, the PA's call), the guide's arrows; rumours `guardNick/Home/Team`, `releaseForms`, `recordsCheck`, a guard's slip; help; 3 achievements, medals; lessons `forgery` and `release` (Center Perks) in Ways out; the map viewer | `paperworktest`; 5 new escape bots (the 28 others byte-identical); `dailytest`; `gossiptest`; `chattertest`; `tutorialtest` (both lessons and their dead ends) |
| **P37 How to play, laid out again** | 2.13 | `ui/screens/help.ts` rewritten: each tab a grid of tiles in groups (`ui/screens/helpTopics.ts`: tab, group, icon, colour, picture, diagram, recipes, item icons per line, lessons, see-also, prison gating), a search over every topic (word starts, accents off), a page per topic (picture or diagram, summary, key-number chips, numbered steps, a list, recipes drawn from the handbook, tip and watch-out call-outs, the fine print folded, Play the lesson from the title or a note in a game, previous and next); diagrams drawn from the game's data (the heat meter, timelines, noise in tiles, the pockets, pins by door colour, medals, the day's schedule); Basics and Escaping (29 topics) rewritten in that shape in English and French, Prison life with tile lines (pages next phase); 17 in-game pictures in `public/help/` from `scripts/dev/helpshot.ts` (a moment of an escape bot's run or a lesson, replayed and shown paused) and `shotsink.ts`; `tutorialFlow(first)` and the title's help loop (a lesson picked, played, back on its page) | `helptest` (every part in French with as many lines; every item, recipe, icon, lesson, prison, topic and picture there; words on each page); `i18ntest` |
| **P38 How to play II** | 2.14 | Prison life's 25 topics in the page shape in English and French (old French terms evened out: Intellect, suspicion, opinion, isolement, mutinerie), a second list per topic (`.list2`, for a topic in two parts: dice and arm-wrestling, the sports field and the garden, events and weather, the calls and Lou's line), colour dots as line icons (the cone's colours), the Controls tab grouped (moving, doing things, panels, games; keys and touch); 19 pictures from lesson scenes played on by the tutorial bots' moves (`helpshot.ts`); every topic now a page | `helptest` (both lists, dots, the controls' groups); `i18ntest` |
| **The day's card, easier games, Share** | 2.15–2.17 | The HUD clock opens the day's card (routine timeline, `state.blocks`); reading time at quiz night, kick and aim help at football, race-night reminders (`Sim.rules215`); Share on the title (QR code, copy link, share sheet) | `playclocktest`, `teamtest`, `stagetest`, `longtest` |
| **P39 The parole board** | 2.18 | `systems/parole.ts`: apply at the release desk (or the lawyer by phone), the record read from the ledger, a hearing of three questions 7 days on, granted → released through P36's desk; route `parole` | `paroletest`, `parolebots.ts` (every prison), lesson `parole` |
| **P40 The odd jobs board** | 2.19 | `systems/oddjobs.ts`, `content/oddjobs.ts`, `PrisonDef.board`: three jobs a day by `roll()` plus the fixer's, twelve kinds, a three-step story per prison, cash, rare items or a debt | `oddjobstest`, lesson `oddjob` |
| **P41 The manhunt** | 2.20 | `src/sim/hunt/` (its own sim), `content/outside/` (60×56 per prison), `render/Hunt.ts`, `huntTown.ts`, `huntPrison.ts`: searchers, dogs, roadblocks, the helicopter, cover, fords, Lou's car; the clean getaway star; legal releases have no hunt | `manhunttest`, `hunttest` (the balance gauge), lesson `manhunt`, the map viewer's Outside 3D |
| **P42 Holidays** | 2.21 | `systems/holiday.ts`, `content/holidays.ts`, `render/Holidays.ts`: Easter, summer, Halloween, Christmas and New Year by the real date (kept in the state; a setting); decor, 6 items, 5 achievements | `holidaytest`, `holidaybotstest` (every escape bot under each holiday), `holidayruntest` |
| **Reviews and Install** | 2.21.1–2.21.5 | Full review of P39–P42, then each of P39–P41 played through; the title's Install button (`app/install.ts`, `ui/screens/install.ts`); `npm run released` | every suite, browser passes at the three sizes |
| **Code review** | 2.21.6 | Dead code, duplicates and structure across the code: shared helpers (tile maths, clock text, the view's random numbers and canvas textures, refusal texts, `esc`), the big files split, four import cycles in play broken; no rule changed | every suite byte-identical; computed styles diffed against 2.21.5 at the three sizes |
| **The tattoo drawn by hand** | 2.22 | `EXT.NEEDLE`/`NEEDLE_DOWN`, the ring waiting, the line scored by its distance from the design (§9 P29); `Sim.rules221` | teamtest, tutorialtest; played by hand at the three sizes |
| **The guards keep watch** | 2.23 | Checking in takes a block's `stay` (`state.present`, the HUD badge's minutes), a roll call left before counted +25%, a block skipped in a guard's sight +2%/s, another inmate's cell searched in sight +20% then +4%/s and its owner minding (`systems/snoop.ts`, `state.snoop`, SPOT `skipping`/`snooping`, `BLOCK.LEFT`); the container panel's warning, the first-day guide's order; `Sim.rules222` (§2) | routinetest (the drop-in, old saves), guardtest (skipping, snooping, the owner), escapetest (bots wait to be counted); played at the three sizes |

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
| §11 jobs | P6 (L1), P9 (metalshop), P10 (all 6), P11 (janitor first) |
| §12 escape routes | P7 (L1), P9–P12 |
| §13 controls, HUD, feedback | Every phase, finished in P8 |

## 6. Tests

All tests are `scripts/*test*.ts` (54 at v2.21.6), run in parallel by `scripts/test.ts`, each
compared line by line with its golden output in `scripts/snapshots/` (see the base playbook §5
and the sim playbook §4). `npm test -- <part of a name>` runs some; `-u` accepts new outputs.
- **Determinism and saves** (`simtest`, `storagetest`, `replaytest`): same seed and same log
  give the same state hash; a snapshot round trip gives the same hash; old saves and run logs
  load and replay under the rules of their version.
- **Maps and data** (`maptest`, `itemtest`, `i18ntest`, `achievementtest`, `prisonertest`,
  `helptest`): every floor reachable, the prison closed, props on floor, zones everywhere;
  ids unique, the recipe graph closed, French covers every key, every help page complete.
- **Mechanics**, one test per system or phase: routine (since v2.23 the stay, a drop-in who leaves at once, old saves), guards (a block skipped and another inmate's cell searched in sight, the owner), traits, combat, layers,
  security, economy, living furniture, noise, calendar, delivery, k9, rats, smuggling, games,
  crew, getaway, cards, long games, team, stage, grounds, phone, kiosk, paperwork, parole,
  odd jobs, holidays, the manhunt, and one per prison (`stalagtest` … `irongatetest`).
- **Bots**: `escapetest` plays every way out of every prison from day 1 (`escapes.ts`;
  `ONLY=<id>` runs one prison); `tutorialtest` plays every lesson and its dead ends;
  `paroletest`, `holidaybotstest`, `hunttest` (the hunt's balance: a limited bot caught
  about a quarter of the time, an expert bot away from every start).
- **Speech** (`chattertest`, `gossiptest`): the phrase banks in both languages, the director
  over days of play, every piece of gossip checked against the running game.
- **Render without a GPU** (`rendertest`, `budgettest`, `pitchframetest`, `playclocktest`):
  geometry rules, draw-call budgets per prison, camera framing, the play clock.

A bot passing is not a person passing: lessons and minigames are also played by hand in the
browser at the three sizes (§4).

## 7. Release routine

`npm run build` and `npm test` both pass (gate on their exit codes), then commit,
`npm version minor|patch`, `git push --follow-tags origin main`, and `npm run released` in the
background: it waits for CI on HEAD, then for the live bundle to carry the version, and exits 1
on a failed run or a timeout. After that, add the release to `docs/HISTORY.md`, update the
project memory and report what changed, what wasn't verified (sound, vibration, real touch
feel) and the known limits. A phase that touches a map also brings the map viewer up to date
(CLAUDE.md, Map viewer).

## 8. Progress

**Status (2026-10-31): v2.22.0 released; v2.23 (the guards keep watch: §2, §4) built on `feature/guard-watch`.** Every planned phase is built and released: the five-prison
campaign (P0–P12), Prison Life (P13–P26), Free time (P27–P30), the sports grounds (P31–P33),
the phone and kiosk (P34–P36), How to play (P37–P38) and After hours (P39–P42), each followed by
its reviews, plus the Install button (v2.21.5), a full code review (v2.21.6) and the tattoo drawn by hand (v2.22.0). In numbers: 5 prisons and the Training Block,
38 ways out, 146 items, 60 recipes, 142 achievements, 48 lessons in 4 chapters, 58 help topics,
4,439 text keys in English and French (v2.23), 54 test scripts.

Parked ideas, none planned: gangs and turf, the riot, photo mode and postcards, a custom
escape (twist sandbox), the escape planner corkboard, a story through the prisons.

The history of every release is in [`docs/HISTORY.md`](HISTORY.md).

## 9. Free time (P27–P30)

Ten free-time activities, one vertical slice per phase. Each one is fun on its own and feeds back into the escape (money, opinion, attributes, secrets, cover).

### Rules for every activity
- **When**: free time, morning and evening, and the exercise hour, never in a lockdown (`gamesOpen`), unless the activity says otherwise.
- **Who**: an inmate who thinks well enough of the player (`GAME_OPINION`), on their feet. A game against an inmate is one of the three each plays a day (`GAMES_A_DAY`, shared with dice and arm-wrestling); the old-timer's checkers is free of that (built: P27).
- **A game begun plays out** past the games' hours (a hand of Cheat, a shootout, a sitting at the board: a talking inmate stays put); the sirens, a knockout or walking away end it (built: P27).
- **The sim**:
  - Every draw comes from `roll()` with a new `SALT`, never the state's rng.
  - New state fields are appended and load as optional.
  - Inputs:
    - **Talk actions**: new `TALK` codes from 15 up (b, and c where needed).
    - **Other actions**: new `EXT` codes from 8 up.
    - The free `OP` slots 14 and 15 stay free.
  - What a card shows is a pure function of the state, so the screen and the rules never disagree. This is the lockpick's pattern.
- **No map edits** where it can be avoided. A prison's places for the activities are data (`PrisonDef.leisure`): a hoop, a pitch, a garden or a stage. They are drawn by the render and checked by `maptest` (open floor, in the right zone, reachable).
- **The escape bots stay byte-identical.** Nothing new happens unless the player asks for it.
  - A new day card replaces a card "in place of" one, as sports day did.
  - It comes with a guard for older saves and run logs, like `beforeSports`, so older replays play the same.
- **Every phase ships**:
  - the sim with its rules;
  - 3D models and poses;
  - phone and desktop UI (touch pads, keyboard keys, cards docked left in landscape);
  - English and French text;
  - help, bubbles, rumours, achievements and ledger counters;
  - a lesson per activity, appended to **Prison life** (`CHAPTERS.life`);
  - a test script per phase;
  - three independent reviews (rules, UI and text, 3D) before the release.

### P27 Card sharks (v2.2): Cheat, Hoops, Checkers

**Cheat, the card game** (bluffing; in French « Menteur »)
- **The table**:
  - With an inmate in the games' hours, from the talk panel's Games, for a stake ($5, $10 or $20, as dice; asked twice).
  - The deck is 14 cards: 4 Kings, 4 Queens, 4 Aces and 2 Jokers (wild), shuffled by `roll()` (built: 20 cards made a three-card claim impossible to prove false).
  - 5 cards each, and a table card (K, Q or A) is drawn each round.
- **A turn**:
  - Play 1–3 cards face down, claimed to be the table card, or call **"Liar!"** on the last play.
  - The caller is right: the liar loses a chip. The caller is wrong: the caller loses a chip.
  - After a call, a new round is dealt.
  - A hand played out with no call: the other player must call.
  - First to lose 2 chips loses the stake. The stake is held on the table, as with dice.
- **The inmate**:
  - Plays true when it holds the table card, and bluffs otherwise.
  - Calls with certainty when the claim can't be true given its own cards and the true cards it laid this round. Otherwise it calls on the claim's odds as it sees them (exact, from the cards it can't see), more when it has no true card and when the player is down to two cards. Measured (2000 games each, Int 10 and 80): a player who never calls wins 40%, one who reads the tells 48–55%, one who counts the cards 58%, calling everything 2%, bluffing everything 28–32%.
- **Tells**: each inmate has a tell of its own (scratching an ear, a glance away, drumming its fingers, a whistle). It shows on the card and as a bubble.
  - When it lies, the odds of a tell are 30% + Intellect/4, at most 80% (built; first 50%: reading tells won 77%).
  - When it tells the truth, a false tell shows 20% of the time.
  - So Intellect lets the player read people, but never with certainty.
- **Heat and rewards**:
  - A guard who sees the game gives gambling heat, as with dice.
  - Any game gives +2 opinion.
  - The ledger counts games, wins and correct calls.
- **The clock** (2.6): the player's move has 60 s (game minutes: `TURN_STEPS`), shown on the card. When it runs out, the call is made for them if that is all they can do, else the hand is folded ("Time's up"). A game still on at roll call or Lights Out is settled at the bell: behind, it's lost; ahead or level, the stake comes back (never won at the bell: a lead stalled to it would be a sure profit). No clock in the lessons.

**Hoops** (aim and timing; the wind and the rain matter)
- **The court**: the decor's basketball hoop on its pole in each prison's yard (Center Perks, Shankton and Irongate had one; Stalag Flucht, San Pancho and the Training Block got one; most face the camera), its rim over a tile (`leisure.hoop`: the tile and its facing), with 5 shooting spots painted on the ground (built: no wall-mounted boards).
- **The shootout**: against an inmate, 5 shots each from the 5 spots, taking turns. Most baskets wins; a tie goes to sudden death, at most 3 more.
- **Solo practice**: anytime the yard is open.
- **A shot**:
  - Stand on the lit spot and hold Space or the Shoot pad. The power marker rises and falls.
  - Release: the sim judges the step of release, or the one before, against a make window.
  - The window is centred on the power needed for that distance:
    - it is wider with Speed;
    - it is narrower with distance and rain;
    - the wind (P14) moves it.
  - Inside the middle third of the window: a swish. Elsewhere inside it: in off the rim. Just outside: a rim-out. Further out: an airball.
  - The rim's clang is a small noise.
- **The inmate**: it shoots by `roll()` with a skill drawn by cell.
- **Rewards**:
  - A win gives +6 opinion and +1 Speed (trained today), and the crowd cheers as at a bout (once a day each).
  - A shootout won counts for **sports day** like a bout won.
  - Practice gives +1 Speed at most once a day.
- **The 3D**: the ball's arc follows the same pure function the sim judges.

**Checkers with the old-timer** (strategy; the prize is a secret)
- **The old-timer**: one inmate per prison (`leisure.oldTimer`: a cell), grey-haired, who has been inside for decades. He plays from opinion 20, seated or not, with no stakes and no heat.
- **The game**:
  - English draughts on 8×8: forced captures, multi-jumps and kings.
  - The player's move is `TALK.MOVE` (b = from, c = to, 0–31). A multi-jump is one jump per command.
  - A draw: 60 plies (30 moves each) with no capture and no new king. Resigning counts as a loss and brings nothing (no opinion, no Intellect).
- **The board stays set up**: one free time is only about two real minutes. The board is kept in the state, so the game goes on next time, possibly over several days.
- **His moves**:
  - A deterministic alpha-beta search with an integer evaluation and ties broken by `roll()`.
  - The depth grows with the games he has lost, from 2 up to 6.
  - He answers after 1–3 seconds of "thinking".
- **Rewards**:
  - A win: he tells a **secret**, a lasting fact the player hasn't heard yet. Examples: a camera's blind time, the lazy guard's nap stop, a loose grate, the next shakedown. It comes from the gossip facts and is kept in the prisoner's file.
  - A win also gives +1 Intellect and +4 opinion.
  - Any finished game gives +1 Intellect, at most once a day.

**Proof**: `cardstest` covers:
- the deal, the turns, the calls and the chips;
- the tell odds, measured;
- the inmate never calling against what its own cards prove;
- checkers' rules: forced captures, multi-jumps, kings and the draw;
- the search's determinism and the time each move takes;
- shots judged at release, the wind and the rain;
- sports day, saves, and older logs;
- escapetest unchanged.

**Lessons**: `cards`, `hoops` and `checkers` in Prison life, after Side games (built: Cheat for $5 played out; a shot, a basket, a shootout; the old-timer's game left set up, won with a double jump, and his secret).

### P28 Long games (v2.3): Pruno, the garden, rat racing

Nothing here touches a container's stock or draws on the state's RNG: the escape bots' runs stay as they were. New goods are taken on request, not stocked.

**Getting the makings** (on request: `EXT.TAKE`, b = what)
- **Fruit**: from an open canteen counter during breakfast and dinner, one piece a meal.
- **Sugar**: from an open kitchen freezer, one bag a prison day (the kitchen is a job room: the kitchen job, or sneaking in).
- **Seed packets** (vegetable or fruit): from an open library shelf, one packet a prison day.
- **The merchants' staples**: every merchant also sells sugar and both seed packets, whatever its stock (`TALK.BUY` with b past the shop's slots; no opinion for them, built: bought and given back they farmed it), and buys ripe pruno and vegetables at three quarters of their value, four sales a prison day in all (`TALK.SELL`, b = the hotbar slot; built: at full value, unlimited, they were a riskless farm).

**Pruno** (a risky project over several days)
- **Making it**: fruit ×2 + sugar → a pruno bag (Intellect 20).
- **Fermenting**: left in a desk (any drawer) or a toilet's tank, it ferments for 2 prison days. The days left are the item's uses and count down at 08:00. Carried or on the floor, it doesn't ferment.
- **The risks**:
  - **The smell**: a dog on shift that passes furniture holding a bag (or ripe pruno) within 2 tiles (built: through bars and walls, no line needed) points at it; the bag is seized. In the player's cell: sniffed heat.
  - **Searches**: a shakedown or an inspection finds it in a desk's standard drawers (it's contraband). The hidden drawer and the toilet's tank are never searched: only a dog finds it there.
- **Ripe pruno** (contraband, worth $40):
  - Sold to a merchant for $30, or given as a gift (+15 opinion).
  - Or drunk (the use button): tipsy for 3 prison hours. Blows hit 50% harder; walking is 20% slower; every few seconds of walking a stumble makes a small noise.
  - A guard who sees the player tipsy: +20% heat, once each time he catches sight of them.

**The garden plot** (care over time, with a secret)
- **The plot**: a rectangle of beds in each yard (`leisure.garden`), drawn as tilled soil; each tile is a bed. maptest checks the beds are open, diggable yard floor that nobody needs to stand on.
- **Growing** (the use button on the bed ahead, or the one underfoot):
  - Seed packet in hand: planted.
  - Plastic cup in hand: watered (twice a day at most).
  - It grows a stage each prison day it was watered: 3 days to ripe. Rain or a storm waters it; a heatwave needs watering twice.
  - A day without water wilts it (it stops growing); two in a row kill it.
- **The harvest** (the use button on a ripe bed, whatever is in hand): 2 vegetables (a gift, or sold to a merchant) or 2 fruit (for pruno).
- **The secret**: a hole dug down through a planted bed doesn't show: no guard sees damage under a plant (a dog following the trail still digs it up). Harvested or dead, the hole is plain to see until something is planted over it again. (Tunnels could already start from the yard's soil, GDD §9.2: dirt, grass or any non-reinforced floor. No conflict.)

**Rat racing** (training and betting; builds on P20)
- **Training**: the tame rat gets a speed (0–100; 20 when tamed), appended to the rat's state. A rat track is crafted from two magazines and duct tape (Intellect 30; one magazine and tape already make a poster). Used in the player's cell in evening free time, once a prison day, with bait in the hotbar: the rat eats it and runs the track. It gains less the faster it is already. Trained today is fed today.
- **Race nights**: odd prison days, at 21:00, on a straight track in the cell block (`leisure.race`).
  - **The card**: from 20:00, three inmates' rats (drawn by cell with `roll()`, each with a name, a speed and whether it was fed today) and the player's, if entered.
  - **Bets**: at the track before 21:00, $5, $10 or $20 on one rat, one bet a night. The bookie's odds go by the speeds alone (built: each rat's chance worked out over 400 races run by `roll()` with whether each ate drawn as most nights, paid at 85% of fair, rounded down to a half, ×1.2–×20, stake included; first fixed by rank, ×2/×3/×5/×8, which paid the favourite ×1.5 a dollar). The pet is entered before any bet, and an entered pet trains no more until the race is run: the field and its form are what the odds were quoted on (built: a reviewer's exploit).
  - **The race**: 10 legs; each leg a rat runs its speed, plus 40 fed, plus up to 200 by `roll()`. The furthest wins. Its course is a pure function, so the 3D and the sim agree. Measured (longtest): a blind bet returns ×0.78 a dollar, the favourite ×0.75, betting only on rats that ate ×1.09; a fed pet at speed 80 wins 65% of nights, hungry 14%.
  - The pet away at the off (not on the shoulder by the track): scratched, and every bet void (built: a bet on a rival stood at odds quoted with the pet in the field).
  - A fed rat beats its odds: the edge is knowing which rats ate (yours, and what the gossip says of the others).
  - The player's rat winning: a $10 purse.
- **Risks**: the race is noise (guards come to look), and a guard who sees the player at it with a bet on gives gambling heat. Without the player taking part, nothing happens in the simulation.

**Proof**: `longtest` covers fermentation (desk, tank, hand), the dogs' nose and searches, tipsy, growing, wilting and the weather, the hidden hole, the rat's training, the race and its odds measured (blind bets lose, informed ones win), saves, and old logs; escapetest unchanged.

**Lessons**: `pruno`, `garden` and `ratRace` in Prison life, after Checkers (built: on the Training Block: a bag brewed and hidden at Lights Out, last night's ripe by morning and drunk; a bed planted and watered, a wilted one saved, a ripe one harvested; the rat's laps at home, entered and backed on race night, the race).

### P29 Team & ink (v2.4): yard football, the tattoo parlour

Nothing here happens without the player asking, and nothing draws on the state's RNG: the escape bots' runs stay as they were.

**Yard football** (a 3-a-side team match, and cover)
- **The pitch**: each yard has one (`leisure.pitch`: its rectangle and two goals, drawn as frames and painted lines). Built: the goals' nets are the end tiles' middle two; the field runs between the goal lines; Shankton's, Stalag Flucht's and Irongate's lie on their roll-call floor in the yard; teamtest checks each is open floor clear of the garden, the hoop and props.
- **Starting a match**: in free time or the exercise hour, talk to an inmate at the pitch (built: he captains the other side; one of the day's games with him). The player and the 2 inmates who think most of them play him and the 2 others nearest (built: any up and about within 40 tiles, who walk over; a whistle once all are on the field, or after 15 s).
- **The match**: 45 seconds of play (built: the side that let a goal in kicks off; full time at the bell for the next block).
- **The ball**:
  - Integer position and speed, with friction (built: 95% kept a step).
  - It bounces off the pitch's boards (built: its sides and ends, but for the goals' mouths, 2 tiles wide).
  - Run into it to dribble. Hold Space (or the Kick pad) to kick toward where the player faces, harder the longer it's held (built: 240–560 units a step over 1.5 s, within 0.7 tile).
- **The inmates**: they chase the ball and keep goal (built: a keeper each side, the nearer outfield player after the ball, the other back; shots by `roll()` within 4 tiles of goal, knocked on further out; a team-mate passes to the player ahead half the time). Measured against a simple bot: won 18, lost 5, drawn 7 of 30, 1.5 goals a match.
- **Fouls**: a hard foul on a rival can start a brawl (P23's rules). Built: a blow at a player of the other side ends the match; they all go for the player and the nearest two guards come to look.
- **Cover**:
  - While a match is on, guards in the yard watch the ball. For anything off the pitch their sight range is halved (built: guards on duty outdoors within 16 tiles with the ball in plain view; the player, damage and the drone's drop; the cones are drawn at that range).
  - A goal turns every eye in the yard to the goal for 5 seconds (built: each guard on duty there stops and faces the net).
- **Rewards**: a win gives +3 opinion with the teammates and +1 with everyone watching, and +1 Speed (built: and a win toward sports day; a match played, +1 with the team-mates).
- **Telling the sides apart** (built): a green ring under the player's team-mates, a red one under the other side.

**The tattoo parlour** (tracing, cosmetics, money)
- **The gun**: a crafted item, a toothbrush + a battery + a razor blade (built: Intellect 30). It is contraband, and each tattoo uses one `ink` (built: a jar of ink from the hotbar, used as the sitting starts).
- **A job**: an inmate at opinion 30 or more takes a design: a heart for $15, a skull for $25 or an eagle for $40 (built: in the games' hours, one of the day's games with him).
- **Tracing**:
  - The needle follows the stick or the keys over the design's path, at a set speed, deterministic from the commands (built: the pen runs at 16 box units a step after a 1.5 s lead-in, the needle at 22; the player doesn't walk meanwhile; on touch, a drag).
  - The distance from the path adds up. A cleaner line pays up to 150% and more opinion (built: +2 to +12); a poor one pays as little as 50%. Given up: no pay, and −5.
  - **Redone in v2.22.0** after players found it too hard (scored by the distance from a pen on a clock, a human's reaction time alone cost half the line): the design is drawn on (a finger, or the mouse button held; `EXT.NEEDLE`, `EXT.NEEDLE_DOWN`; the keys and stick still steer it), pulled a little onto the line; the ring waits where the line is traced to; the line scored by its distance from the design; 40 seconds; no further traced than inked. Runs logged before 2.22 replay the old tracing (`Sim.rules221`).
- **The player's own tattoos**: a friend inks the player (built: 70+ opinion, 6 seconds, up to 3 designs, one of each). They show on the prisoner's arms and in the file (built: on the forearms; two achievements give the skull and the eagle for the Intake's own tattoo too).
- **Heat**: a guard who sees tattooing gives +15% heat (built: once a sitting, either way round).

**Proof**: `teamtest` covers:
- the ball's physics and goals;
- the inmates' play;
- the guards' halved sight during a match;
- fouls and brawls;
- tracing scores from fixed command sequences;
- pay, the look, saves and old logs;
- escapetest unchanged.

**Lessons**: `football` (built: at Center Perks, where there are enough inmates: a match started, a kick, the final whistle, the cover explained) and `tattoo` (on the Training Block: the gun crafted, a heart traced for Sparky, a design of his on the player's arm).

### P30 Stage nights (v2.5): talent night, quiz night

**Talent night** (rhythm)
- **The card**: a new day card in place of a card in every deck, with a guard for old saves and logs. It runs 19:00–21:00 on a stage in the canteen (built: `leisure.stage`, the performer's tile and the way the room is; the evening's crowd sits in the canteen as on movie night, and the music muffles noise there as the film does).
- **The instruments**: bucket drums (free) or a homemade guitar (crafted; built: timber + wire + duct tape, Intellect 30, not contraband).
- **The song**: notes scroll in 2–3 lanes, and the sim judges each press by its step.
  - Within ±1 step: perfect. Within ±2 steps: good (built: centred a step late, as a press reaches the sim on the step after it's made; a press with no note near costs 25 of a perfect note's 100; measured in the browser, presses made as the notes reach the line on screen judge all perfect).
  - The music is synthesized from the same note chart (built: the beat and the bass under the player's notes, each note sounding as it's played; an act's song heard in the canteen for its ten minutes, a quarter of it).
  - 3 songs of about 40 seconds (built: 100, 120 and 150 a minute, one to three stars).
- **The competition**: 2–3 inmates perform, with scores from `roll()` (built: 10 minutes each from 19:00, walking to the wings first; marks 50–85%; the player's turn after the last act, once a night).
- **Rewards**:
  - Opinion with everyone in the canteen (built: +1 at a mark of 50%+, +2 when first).
  - Prize money by place (built: $30, $15, $5, times 1, 1.5 or 2 by the song's stars; a tie goes to the player).
  - A score of 80% or more wins the warden's goodwill: −20% heat.

**Quiz night** (knowledge)
- **The card**: a day card in the library (or the canteen where there's none), 19:00–21:00 (built: every campaign prison has a library; `leisure.quiz`, four places in a row).
- **The quiz**: 8 questions with 4 choices and 10 seconds each, against 3 inmates (built: the three nearest up and about walk over; the first right answer takes the point, a wrong one is out of that question).
  - Inmates buzz at a time drawn by `roll()`, and answer right with odds by their Intellect (built: 2.5–10 s; wits 25–75 by cell, right 30% + wits × 0.7).
  - The player answers with `EXT.ANSWER` (built: keys 1–4 or a tap).
- **The questions** come in two kinds, in English and French:
  - **Escape history**: Alcatraz 1962, the Great Escape's tunnels and the like. These are written facts, checked (built: 15, four a night).
  - **This prison**: generated from the game's own data and constants, the way gossip is, so they are always true. Examples: roll call's time, the colour of a guard's key, what the lazy guard does (built: also breakfast, showers and lights out, the corrupt and strict guards, the cells, what a recipe makes, the delivery's search and visiting hours where they come; four a night; stagetest checks every one against the data).
- **Rewards**: a win gives $30, +2 Intellect and opinion (built: +2 with each contestant, +1 for playing it out; a tie at the top halves the prize and the Intellect). Measured: answering right in 3 s wins every night, in 5 s most (25 of 40), in 7.5 s rarely; guessing never.

**Proof**: `stagetest` covers note judging at the step, the inmates' scores, the questions' answers against the running game, the day cards in the decks, old saves and logs, and escapetest unchanged.

**Lessons**: `talent` and `quiz` (built: both at Center Perks, after Tattoos).

## 10. Sports grounds & gardens (P31–P33)

The free-time games (P22–P29) all landed in each prison's one courtyard. There, the pitch, the hoop, the garden beds, the benches and the trees overlap, and the result is confusing (user, 2026-10-21). Every prison is now **rebuilt** around two new places, and the courtyard goes back to being a quiet yard.

User decisions (2026-10-21), on the branch `feature/sports-and-gardens`:
- **The maps change.** Every prison is redrawn so it has room for both new places. The cells, the escape routes and the secrets stay where they are wherever possible.
- **A full sports complex**, fenced, with:
  - a football pitch;
  - a basketball court, with hoops on posts and its lines painted;
  - a running track round the pitch;
  - an outdoor weights corner;
  - bleachers.
- **A vegetable garden and a gardening job**, with its produce going to the kitchen.
- **Saves and bots.** A run saved in a rebuilt prison restarts there, with a notice; records, trophies and stats are kept. The escape bots are re-tuned to the new maps. They must still win every escape, but for these three phases their snapshots may change. This lifts the "byte-identical" rule for P31–P33 only.

### The places (every prison)
- **The sports ground** is its own zone, `sports`. It is open air, fenced, and has one gate that inmates can use.
  - **Open:** during the exercise hour (15:00) and the morning and evening free time. The gate is shut at lights out and in a lockdown, as the job rooms' doors are (`doorRoom`, with a new list of open blocks).
  - **The pitch:** football (P29) moves here. It is bigger than now, about 14×7 where the map allows it. Its goals and lines are drawn by `TeamView`.
  - **The court:** the hoop (P27) moves here, onto a post with a painted key and arc. The five shooting spots stay where `court()` puts them.
  - **The running track:** chalk lanes round the pitch, with four corner markers.
    - **Running a lap** means passing the corners in order without leaving the track. A lap trains Speed as a treadmill set does: +2 Speed, the same energy cost, the same tiredness gate (`training.ts`).
    - **During the exercise hour**, some inmates jog the track instead of doing jumping jacks.
    - **Built:**
      - a third of the exercisers jog, corner to corner, at a walk plus 60 (`JOG_EXTRA`), in the run pose;
      - one in three goes to the gym, the rest to the sports ground, never onto the bleachers;
      - in free time, `HANGOUTS_GROUNDS` adds the sports ground (twice) and the garden;
      - the courtyard stays a hangout, but a quiet one.
  - **The weights corner:** the `weights` prop outdoors, plus a new `pullup` bar prop that trains Strength. It counts for the exercise roll call, like the gym does.
  - **Bleachers:** a new decor piece. Inmates watching from them count for the crowd at matches and shootouts (`CROWD_RANGE`).
  - **The guards:** the exercise guard's post moves to the ground. The towers and searchlights still see it as before. Football's cover (`watchingMatch`) works there unchanged.
- **The vegetable garden** is its own zone, `garden`.
  - **The allotment:** the player's beds (P28), with the same rules as now. There are more of them: up to 12, the most the renderer draws.
  - **The prison's rows:** the gardener's work. They are kept by the sim, never by the player's beds.
  - **A shed** holds a watering can and a hoe (work items, handed back at 15:00), with a water butt beside it and a produce crate.
  - **Open:** the allotment is open during free time and the exercise hour, as the sports ground is. The rows are worked during the Work Period.
- **The gardener job** (`gardener`), a new job flow:
  - **Requirement and pay:** Intellect 20; about $35 a day.
  - **The shift:** take the can from the shed, water the dry rows, pick what's ripe, and carry it to the crate. The quota is a number of crates filled.
  - **Rows:** they ripen and dry out from the sim's own draws (`roll()` with a new salt), never from the state's RNG.
  - **Built (P31):** the job is a 'machine' job like the laundry, so the job board, the station buttons, the inmates' shifts and economytest's checks all work unchanged:
    - a tray of seedlings from the tool shed (`toolShed`, the take);
    - into a raised planter (`planter`, the machine, 6 s);
    - a crate of produce out of it, into the crate by the gate (`crate`, the put);
    - quota 4, $35, Intellect 20.

    The planters are solid raised beds with crops drawn in them. The water butt is decor.
  - **In the kitchen:** when the quota is met, the next day's meals are fresh, with a small health or energy gain at meals (the size is tuned in P31). If it is missed, nothing changes.
    - **Built:** the meals for 24 game hours after it are fresh: +10 energy and +10 health at each, with a toast. This happens only when the player fills the quota (the rules review: an inmate gardener's shift made every meal fresh from day 1, unearned).
  - **Who holds it:** each campaign prison lists the job; an inmate holds it on day 1.
- **The old courtyard** becomes the quiet yard: benches, trees, the old-timer's checkers and the roll-call ground where it already is. Everything that can be played moves to the sports ground.
- **Sports day** (P22) puts its bunting over the sports ground instead of the yard.
- **The drone and parcel drop** (P21) moves to whichever open ground suits each prison (`smuggling.drop`, at least 20 landable tiles, in one zone).

### Where the room comes from
Each prison's phase begins with an ASCII sketch of the new ground floor, and the user approves it before anything is built.
- **Training Block:** there is plenty of room inside the fence.
  - The sports ground goes in the south-east, about 17×17, next to the roll-call asphalt.
  - The garden goes along the north fence.
  - The tutorial's coordinates move with it, and tutorialtest gets new tiles.
- **Center Perks:** the south grounds (56×14, unzoned today) take both places, one on each side of the delivery drive, which stays where it is.
  - The sports ground goes west of the drive, about 22×12. The garden goes east of it.
  - Two new passages from the south corridor lead to them: the visitation room and the guards' quarters each give up two tiles of width.
  - The new places get their own fence, so the drive, the bay and the perimeter stay off limits. The searchlights' sweeps, the towers and the truck's round are kept as they are.
- **Stalag Flucht:**
  - The sports ground is cut out of the south end of the guards' compound, behind its inner electric fence: about 18×13, reached from the dirt road.
  - The garden is rows along the north wire, in the camp. The prisoners of the real camps gardened too.
  - The pitch's old place, the dirt road, is freed.
  - **Built (P32):** the ground is 18×16 (solitary keeps its north half), electric wire on every side, its gate in the inner fence at the dirt road; the garden is behind cabin B (cabin A's strip is the tunnel's boulder field), 16×3: twelve beds along the wire, four planters behind them (cabin B's wall hides the two rows in front of it from the camera; the planters' crops stand above it). A shaft two tiles from the wire was already possible on that strip of yard before P32 (the rules review measured it): a bed hides it now, the tunnel is no shorter.
- **Shankton** (maximum security): a walled rec ground inside the shell. It has open sky but no grass. It takes the north hall's place, about 31×14.
  - The canteen moves to the old yard's place.
  - The kitchen, laundry and janitor rooms fit into the spare cells: there are 18 cells for 12 people.
  - The garden is a small walled plot.
  - **Built (P32), not as planned:** there are 12 cells for 12 people, so no spare cells (§2). The rec ground takes the kitchen's old block (14×14 of asphalt, the court and weights north of a 14×8 track round a 12×6 pitch, a row clear along the south wall, which would hide the lane; 1.3 goals a match against the bot, 30 matches), its gate on the north corridor; the kitchen, laundry and janitor's closet line the canteen's north side, through doors from it; the canteen and its stage stay; the courtyard keeps roll call (three rows of four) beside a 6×8 walled garden plot, and its two benches along the south wall (a quiet yard row).
- **San Pancho:**
  - The dirt plaza grows into the sports ground by narrowing the canteen and gym blocks beside it. The prison has about 20 cells for 14 people.
  - The garden is a dry-land plot with cacti round it.
  - The minefield, the walkway and the supply road stay exactly as they are.
- **HMP Irongate:** the yard is a strip 5 deep. It grows to about 11 deep by moving the middle band's rooms down; they are larger than they need to be.
  - The garden is a walled sea-wind plot.
  - The dock, the drawbridge and the helipad stay where they are.
  - **Built (P33), not as planned (§2):**
    - **San Pancho:** 14 cells for 14 people. The ground is the plaza's south half, 14×15 (the court, the weights corner and bleachers north of a 14×8 track round a 12×6 pitch, two rows clear along the south wall, which hides them from the camera), its gate in the yard's see-through fence; the control room and solitary are four rows under it, entered from the library through the generator room. The yard keeps roll call. The canteen (one column narrower, its stage at the south end) and the gym (one room with the showers) are reached from the wings' lobbies. The garden is the showers' old place, 6×9 of dirt walled in, through the gym: twelve beds, planters along the north wall and behind the beds (in the rows the wall hides, their crops above it), saguaros.
    - **Irongate:** the yard is the roofs' chasm (the grapnel reaches 6), so the ground takes its west third, 14×16 of turf down to the main corridor (the court, the weights and bleachers north of the track, two rows clear), and its east two thirds stay 5 deep, the garden at their end, 8×5 (the beds and the tall tool shed along the north block's wall, the planters behind in the rows the wall hides, their crops above it). The middle block moved east and narrower (kitchen, canteen with 4 tables, gym over showers, laundry over mailroom, infirmary over the library off the corridor); the janitor's closet is off the corridor beside the control room. The yard's fences onto the walkway stay (crewtest's sight through a fence).

### Rules and guards
- **Zones.** `sports` and `garden` are appended to `ZONES`, with names in English and French and with outdoor light (`OPEN_AIR`). They are added to:
  - `HANGOUTS`;
  - the exercise routine's zones (`gym`, `yard`, `sports`);
  - maptest's `WATCHES`;
  - each prison's `reachable` list.
- **The gate:** an inner fence is an ordinary fence. Cutting it is damage, as anywhere else, and a tower's sniper sees a cut in daylight. Cutting it is never an escape in itself: you are out only on the road.
- **Saves:**
  - Each prison gets a `PrisonDef.map` number, and each save records the number of its prison.
  - A save from an older map loads as a fresh start in that prison, after a notice (`toast.rebuilt`). This applies to the auto save, hand slots and the Daily.
  - A run log from an older map starts a fresh log. Its replay stops where it stops matching, with the notice it already has (`replay.changed`).
  - Records, trophies, stats and medals are kept. Medal par days are checked against the new maps.
- **Tests:**
  - maptest: the new zones, the gate, the places on open floor, every place reachable when it's open.
  - teamtest, cardstest and longtest read the places from data and now accept `sports` and `garden`.
  - A new `groundstest` covers:
    - laps counted only in order and on the track;
    - the pull-up bar;
    - the gate's hours;
    - the gardener's shift with its quota, pay and kitchen bonus;
    - old saves restarting;
    - every place usable in every prison.
  - escapetest and dailytest: the bots' `PLANS` are moved onto the new maps; every escape still wins. Each new snapshot is read before it is accepted.
- **The render:**
  - new decor: bleachers, garden shed, water butt, produce crate, rows of crops and a hoop post;
  - new props: `pullup` and the crate;
  - painted court lines and the track's lanes, from the rat track's chalk-line code;
  - per-prison themes: grass, dirt or asphalt grounds, and snow at Stalag;
  - everything checked at desktop size, 412×915 and 915×412.
- **Lessons:** in the Prison life chapter, `laps` (the track and the weights corner) and `gardener` (one shift). The existing hoops, football and garden lessons move onto the new places.

### Phases
Each phase is one vertical slice: sim, render, UI, EN/FR, help, tests, three reviews, then merged to main and released on the user's go (user, 2026-10-21: merge each phase).
- **P31 Grounds (v2.7):**
  - Infrastructure: zones, the gate's hours, the map number and restarted saves, new decor and props, the track, the pull-up bar, the gardener job and the kitchen bonus.
  - Rebuilt: the **Training Block** and **Center Perks**.
  - The lessons.
- **P32 (v2.8):** **Stalag Flucht** and **Shankton** rebuilt.
- **P33 (v2.9):** **San Pancho** and **HMP Irongate** rebuilt. The courtyard clean-up is finished everywhere.

## 11. Phone & kiosk (P34–P36)

Prison life has no line to the outside. Every campaign prison gets two: a **pay phone** in a corridor and an **internet kiosk** in the library. Both are cheap, legal and open to everyone, and the guards watch them. The fun is bending them into an escape plan.

User decisions (2026-10-21):
- **Both machines**, in three phases: the phone, then the kiosk, then the paperwork escape (planned as hacking at the kiosk; built as forged paperwork, the user's choice on 2026-10-22).
- **The tapped line is a minigame**: the player picks the words, not a hidden risk roll.
- **Paperwork is a new way out** (an 11th route, `paperwork`), with an escape bot in every prison that has a front gate.
- Parked for later (see memory): gangs and turf, the riot, the parole board.

### Rules for every phase
- **Where**: the five campaign prisons. The Training Block has no library, mail room or visits, so these lessons run at Center Perks (as the stage and the quiz do).
- **Places are data**: `PrisonDef.comms = { phone, kiosk, release? }`. Each is a wall piece on a north wall (it faces the camera) or a side wall turned to the camera, and the tile in front of it, where the player stands.
  - They are **decor, not props**: nothing solid is added, so no inmate's or guard's path changes.
  - Candidates from the maps (final tiles picked at build and checked in the browser, never in the two rows a wall hides):
    - **Phone**: Center Perks' north corridor (41,21); Stalag Flucht's corridor (z51); Shankton's first corridor (28,24); San Pancho's wing hall (20,12); Irongate's main corridor (40,39).
    - **Kiosk**: Center Perks' library (19,30, the globe moves); Stalag Flucht's (17,54); Shankton's (24,43, side wall); San Pancho's (44,44, side wall, x=41 kept clear); Irongate's (48,34, the globe moves).
  - `stagetest`'s pattern checks them: open floor, the right zone, reachable, clear of decor on the floor.
- **The sim**:
  - New system files: `systems/phone.ts` (P34), `systems/kiosk.ts` (P35), `systems/paperwork.ts` (P36).
  - Inputs: `EXT` codes from 17 (`CALL`, `LINE`, `SAY`, `KIOSK`…; P36 needs none: the release desk is Interact), `TALK` from 25 (`SWAP`). OP 14 and 15 stay free.
  - Every draw from `roll()` with new `SALT`s from 27. `DOING` from 30 (`PHONE`, `QUEUE`). `TODAY` bits from 8192.
  - New state fields appended, loading as optional. What a card shows is a pure function of the state.
- **The escape bots stay byte-identical.** Everything is on the player's request, except inmates queuing for the phone.
  - The queue starts on **prison day 2** (as the dogs). Inmates are led there through `socialNow` (no draw from the state's RNG).
  - If a multi-day bot (the takeover bots train for days) still changes, the queue waits for the player's first call in the run. It is never fixed by accepting a changed snapshot.
  - **Built (P34, the rules review):** the economy bot's day 3 changed with the queue from day 2 alone, so the queue (and the `phoneCall` rumour) waits for the player's first use of the phone in the run (a call or a place in line: `phoned[6]`). Every multi-day test is back to its snapshot.
- **Time**: one game minute is one real second. Every card has a clock the player can see (as Cheat's 60 s), and a lesson's step has a least reading time.
- **Every phase ships** sim, 3D, phone and desktop UI (cards docked left in landscape), EN and FR, help, bubbles, rumours, achievements and ledger counters, lessons, a test script, the map viewer brought up to date (P35: the kiosk on its wall), three reviews (rules, UI and text, 3D), then a release. Then I wait for the go.

### P34 The pay phone (v2.10)
**The booth**: a wall phone with a hood, a coin box and a handset on its cord.
- Open in the morning and evening free time (`fixerOpen`), never in a lockdown. Each call costs coins up front.
- **On the phone** the player stands at the booth, the handset to their ear (`DOING.PHONE` pose). Walking away hangs up.

**The queue** (from prison day 2)
- In each free time, a few inmates want to call: `roll(SALT.CALLS, day, inmate)`, the line at most 4 (`LINE_MAX`). They wait on the tiles along the wall, then talk 10–20 game minutes each.
  - **Built:** 40 in 100 want a call, within the first hour of the free time (at one in four, spread over it, no line ever formed). The line faces up itself, each the one ahead.
- The player gets in line with Act at a busy booth. Their place shows on the HUD; leaving the line's tiles loses it.
- **Buy a place**: talk to the inmate ahead, "Swap places" for $5 (`TALK.SWAP`). **Built:** only the one just ahead (the rules review: buying the first place jumped the whole line, cheaper than cutting in).
- **Cut in**: straight to the front (`EXT.LINE`). Everyone in line thinks 10 less of the player, and the inmate pushed back may swing at them (`roll()`, more likely at San Pancho).

**The calls** (`EXT.CALL`, b = who, c = an argument)
| Call | Cost | What it does |
|---|---|---|
| **Home** | $2 | +15 energy, once a prison day. Once every 7 prison days the family sends a **money order** ($15–30, `roll()`), paid at the next mail call |
| **Lawyer** | $30 / $40 | **Appeal**: heat −30, once a prison day, refused while wanted (heat 80+) or in a lockdown. **Retainer**: for 3 prison days, a stretch in solitary is halved |
| **Your cousin Lou** | $2 + the job | The escape helper, on a tapped line (below) |
| **Anonymous tip** | $2 | Name a cell. The shakedown guard searches it within the hour (`assign(…, GUARD.SHAKEDOWN, [cell])`): a search you choose, and a guard drawn away. Nothing found: +15 heat. Once a prison day. A 1-in-4 chance (`roll()`) that word gets round: its inmate thinks 30 less of the player ("Snitch!") |

**Mail call** (new): at 12:00 each day, outside a lockdown, a guard hands out the post. P34 pays money orders; P35 adds shop goods and photos (into the player's desk's open slots, as the Red Cross parcel does).

**The tapped line** (the cousin's minigame)
- The player picks a job, then says it in **three lines** (who, what, when). Each line offers three phrases, shuffled by `roll()`:
  - **plain** ("Bring a file in a cake"): clear to Lou, but loud to a listener;
  - **coded** ("Bake that cake Mum made"): half clear, half loud;
  - **deep code** ("The rooster crows twice"): silent, and Lou misses it, *unless he has already learned it*.
- **Lou understands** when the clarity adds up (tuned in the build). If he doesn't, the money is lost and Lou says "What are you on about?".
- **The listener**: a guard on duty, drawn per call; the card names them. **Built:** drawn for the day, not the call (the rules review: hanging up and redialling for $2 dodged a strict listener every time). Their trait sets how much risk they catch: strict the least, then steady, then lazy and corrupt. A corrupt guard bribed to look away today isn't listening. Too loud: +40 heat and the job is blown (the cake seized at the visit, the diversion ignored, the car turned away).
- **Codes are learned**: a deep code Lou has understood once (from a plain or coded line in the same call) is his for the run, kept in state: clear *and* silent from then on. Early calls are risky; later ones get smooth.
- Measured in `phonetest` with pure strategies (all plain, all coded, all deep, learning): none is safe *and* clear on every listener at the first call.

**Lou's jobs**
| Job | Cost | What happens |
|---|---|---|
| **Diversion** | $30 | At the hour the player names (its next stroke at least an hour ahead), a disturbance at the front gate: car alarm, flashing light; the 3 nearest awake guards go and look for 10 game minutes (`summon`), then return to their beats (in a lockdown, ignored). Once a prison day |
| **Cake with a file** | $25 | At the next visit (Stalag Flucht: the next Red Cross parcel) after today, a cake. It isn't contraband, so the frisk passes it. Eating it gives energy and a **metal file** |
| **Getaway car** | $50 | Tonight (23:00–05:00) a car waits on the road. An escape that ends on the road that night drives off in it: its own escape scene, a line on the victory card and an achievement. A reward, not an advantage |

**Eavesdropping**: an inmate on the phone talks about things they know. A player within 2 tiles for 8 game minutes overhears **a true secret**: a sim event, then the `Director` picks a lasting fact the player hasn't heard (as the old-timer's secret does) and it goes in the file. Once a prison day per inmate.

**Also**: the phone's wall piece, the handset and queue poses, the cake, the car on the road, the gate's alarm light; the phone card (the dial, the coin, the clock) and the line card (three rows of phrases, the listener and their trait, the learned codes marked); the line on the HUD; sounds (coins, dial tone, the ring, a car alarm); the PA's diversion and mail-call lines; bubbles in the queue; rumours (`phoneLine`: who calls when); help topic **Pay phone**; achievements (calls home, a cousin's job done, wheels, secrets overheard, a successful tip, a line cut); lessons `payphone` (calls, mail call, eavesdropping) and `cousin` (a job on the tapped line) in Prison life, both at Center Perks with their own seeds.

**Proof**: `phonetest` (the places in every prison; the queue's draws, its places, swaps and cuts; each call's rules and refusals; money orders at mail call; lawyer's appeal and retainer; tips and their search; the line's phrases, listeners, learned codes and the strategies measured; each job through the real sim: the diversion's guards and their return, the cake through a frisk, the car's night; eavesdropping true; saves and old logs); `gossiptest` (the new rumour true); `tutorialtest` (both lessons and their dead ends); escapetest byte-identical.

### P35 The internet kiosk (v2.11)
**The kiosk**: a wall terminal with a glowing screen and a keyboard shelf, in each library. Open in the free times outside a lockdown. **$1 per 10 game minutes** while logged in (`EXT.KIOSK`), paid up front for each block.
- **Built:** where it hangs: Center Perks (19,30, its globe moved to 16,31), Stalag Flucht (17,54), Shankton (24,43, the west wall), San Pancho (44,44, the east wall), Irongate (48,34, its globe moved to 51,37). Walking off, the kiosk shutting or no dollar for the next block logs the player out; what's left of a block is lost, and so is a course under way. One player at a time: inmates never use it (the escape bots play as before).
- **Built (mail):** the reply's drawing comes at a mail call after the day the letter was written (never the same day); a letter while one is on its way doesn't change it. A new drawing is one not on the wall yet. A lockdown at noon holds the mail.
- **Built (shop):** 30% under a merchant's price to a stranger (well-liked merchants go lower: they're friends). One order a day, and one coming at a time. Goods go into the desk's open drawers, never the hidden one; a full desk keeps them for the next mail call.
- **Built (courses):** `questionsOf(sim, day, SALT.COURSE, 5, 2)`: two from the history bank, three about this prison, ten game minutes each. Answers 1–4 as at the quiz.
- **Built (after the reviews):** the kiosk shuts in a power cut (its screen goes dark: logged out, `kioskDark`); no course in the last hour of free time (`COURSE_LATE`, the longest a course can take); a hollow book with something in it can't be given away (`bookFull`); a save with a course and nobody logged in, or time paid far ahead, loads logged out.
- **Built (the hollow book):** the hidden item lives in the book's slot's upper bits (where wear is kept), so every search that reads `itemOf` misses it: the detector's frisk, the frisk out of the visiting room, a cell search, and the guards after a capture. The dog's nose reads inside. A small item moved onto an empty hollow book goes in; the use button takes it out. The razor blade is kept (it cuts the pages).

**The apps**
| App | What it does |
|---|---|
| **Mail** | Write home: once every 7 prison days the money order (shared with the phone: one a week, whichever asks). Once a prison day, a reply at the next mail call with a **photo** (a family drawing chosen by `roll()`); up to 3 pinned on the cell wall over the player's bed |
| **Shop** | Legal goods only (soap, chocolate, a magazine, toothpaste, talcum, ink, a battery, an alarm clock…), cheaper than the merchants, one order a prison day, into the desk at the next mail call. Nothing is stocked (P28's rule). `kiosktest` checks no item is contraband. Plus a **thick book**: with a razor blade (Intellect 30) it becomes a **hollow book** holding one small item; a frisk, the noon frisk, a cell search and a detector don't find it; a dog still smells what dogs smell |
| **News** | The next 3 days' cards, weather and wind (`planOf`, pure), the next delivery and visiting day, and headlines from the run (a lockdown, the quiz and talent winners) |
| **Courses** | 5 questions from the quiz bank (history and true questions about this prison: `questionsOf` under its own salt, not quiz night's set); 4 right: +3 Intellect. $5 and 10 energy, once a prison day |

**Also**: the kiosk model, the photos on the cell wall, the kiosk panel (tabs for the apps, the clock and the bill), sounds (keys, a chime), help topic **Internet kiosk**, achievements (photos, courses passed, the hollow book), lesson `kiosk` in Prison life (Center Perks).

**Proof**: `kiosktest` (the places, billing, each app's rules, mail call's goods and a full desk, the forecast equal to the days that come, courses' questions true and their reward, the hollow book through every search, saves); `tutorialtest`; escapetest byte-identical.

### P36 The paperwork escape (v2.12)
**Built as forged paperwork** (2026-10-22, the user's choice). The plan had the player hack a guard's account at the kiosk with a boot stick and a word screen; that is dropped, and the kiosk stays as P35 built it. What carries over: the guards' lives as gossip, the release list, the release at 10:00, route `paperwork` with five bots.

**Guards have lives**: each guard gets `about = { nick, home, team }` as data (A–Z, 5 to 7 letters, the same in every language). Lasting rumours `guardNick`, `guardHome`, `guardTeam`: inmates gossip them, and a guard the player chats with lets one the player hasn't heard slip, once a prison day (its own lines, `gu.slip.*`). Flavour: nothing in the rules reads them.

**The form**: the strict guard (the morning shakedown's: a supervisor) carries a **blank release form** in its pockets (`guardKit`; a new one at 08:00 once taken): knocked out, or its pockets raided by the pet rat while it sleeps. A blank form and ink make a **forged release form** (Intellect 80, `FORGE_INT`). Both are contraband and small.

**The tray**: at the **release desk** (`comms.release.at`, tiles the player can walk to at 10:00 with no key), a forged form in hand, Interact slips it into the tray: the player's name is on tomorrow's release list. Refused with a guard watching (`watched`), wanted or in a lockdown (`hunted`), or with a name already listed (`onList`).

**The records** at 22:00 that night: with the heat at 40 or more, or after a lockdown that prison day, the name gets a second look and the forgery is found: a lockdown, the player's cell searched, the name struck. Otherwise it passes. (A rule the player can read and play to: keep your head down tonight. No hidden roll.)

**The release**: at 10:00 the PA calls the name. Between 10:00 and 10:30 the player reports at the release desk (Interact): heat under 40, no lockdown, nothing contraband on them (the hotbar, weapon and outfit; a hollow book's inside isn't looked into). Cleared: into their **own clothes** (`own_clothes`), and the doors from the desk to the road (`comms.release.gates`, Irongate's drawbridge too) open for them alone for 60 s, never shutting on them between the doors; no alarm, no dog trail on the way. Out on the road: route `paperwork`. Turned away: +40 heat and the name struck. Not reported by 10:30: the name struck.
- **Built (where):** none of the checkpoint windows can be walked to at 10:00 without keys, so each prison has its own release desk, with the doors out from there: Center Perks by the visiting room's south doors (out through them and the south gate); Stalag Flucht in the yard at the front gate; Shankton at the staff door off the corridor (through the quarters, the control room and the shell's gates); San Pancho at the library's back door (the generator room, the control room, the supply road); Irongate at the corridor's south doors (the ferry gate, the drawbridge lowered). `paperworktest` checks each: reachable at 10:00 with no key, shut it keeps the player in, open it leads to the road, for the player alone.
- **Built (after the reviews):** the tray takes forms only until 22:00 (the night's records done: `trayLate`); the prison day of the last lockdown is kept in the state (`release[2]`); cleared, the way out shuts after its minute unless the player stands in one of its doorways (no more staying cleared past the desk), and at once on a capture; the blank form is worth more than the guard's key (a rat sent to the pockets brings the form).
- **Built (3D):** the desk is a freestanding podium beside the release point (a tray of forms, a sign on a post with no words, a lamp: amber blinking while the name is called, green while the way out is open): every desk tile is by doors or in open floor, with no wall facing the camera to hang it on.

**Also**: the forms' model, the player's own clothes (a blue shirt over jeans), the podium; the action button (File the form, Report for release), the HUD chip (on tomorrow's list; report by 10:30; Released with its 60 s), the floor arrows (to the desk when called, then out), the PA's call; the rumours `releaseForms` (who carries them) and `recordsCheck` (when, and at what heat); help topic **Forged paperwork**; achievements Time Served (out by paperwork), Forger (a form filed), Red Tape (hidden: the records found it); medals for `paperwork` in every prison; a replay highlight; lessons `forgery` and `release` in **Ways out** (Center Perks); the map viewer (the desk and its doors out, drawn and in-game photos).

**Proof**: `paperworktest` (the guards' words; the desks and their doors in every prison; the form, its recipe, a new one at 08:00; the tray's refusals; the records passing and finding it; the release called, turned away, cleared, missed, the doors holding and shutting, out by paperwork; saves); **5 new escape bots** for `paperwork`, the 28 others byte-identical; `dailytest` (paperwork under every twist of each prison); `gossiptest` (the new rumours true); `chattertest`; `tutorialtest` (both lessons and their dead ends).

### Phases
- **P34 The pay phone (v2.10)**: `comms` data and its checks; the queue; mail call; home, lawyer, tips, the cousin's tapped line and his three jobs; eavesdropping; two lessons.
- **P35 The internet kiosk (v2.11)**: the kiosk; mail and photos, the shop and the hollow book, the news, courses; one lesson.
- **P36 The paperwork escape (v2.12)**: the guards' lives as gossip, the blank and forged release forms, the release desk's tray, the records at 22:00, the release at 10:00 and route `paperwork` with five bots; two lessons.

## 12. How to play, laid out again (P37–P38)
The user found How to play hard to read (2026-10-23): 6,164 words in 54 topics, a paragraph each, up to
290 words, the numbers buried, nothing to look at but an icon, no search, no link to the 45 lessons. The
user's choices: each tab a grid of tiles grouped under headings, with a search; a page per topic; in-game
pictures and diagrams drawn from the game's data; every fact kept, the fine print folded under More
details; two releases.

### Rules
- A topic's words are i18n parts (`help.<id>.hook`, `.sum`, `.steps`, `.list`, `.nums`, `.tip`, `.warn`,
  `.more`, and a diagram's own lines), one item a line; French has as many lines as English (`helptest`).
- What can be drawn from the game is drawn from it, never written twice: recipes from the handbook, pins
  by door colour, the routine's schedule, medals, the items' own pictures.
- A prison's own topics stay hidden until the prison is open, pictures included.
- Pictures are moments of real runs (an escape bot's or a lesson's), never staged by hand; retaken with
  `scripts/dev/helpshot.ts` when what they show changes (like the map viewer's photos).

### Phases
- **P37 (v2.13)**: the layout, the search, the diagrams, the picture tools and 17 pictures; Basics and
  Escaping (29 topics) rewritten; Play the lesson.
- **P38 (v2.14)**: Prison life (25 topics) and Controls in the same shape, with 19 pictures from the
  lessons' scenes.

## 13. Parole, odd jobs, the manhunt, holidays (P39–P42)
The user asked (2026-10-23) for more fun and a better experience. From a list of ten proposals, they picked four and
the order: **the parole board**, **an odd jobs board**, **the manhunt**, then **holidays**. The holidays include summer
and Easter as well as Halloween and Christmas. The other six stay in the memory notes: gangs and turf, the riot,
photo mode and the postcard, the custom escape, the escape planner, and a story through the prisons.

### Rules for every phase
- **Where**: the five campaign prisons. The Training Block gets none of it, so lessons run at Center Perks.
- **The escape bots stay byte-identical.**
  - Everything here starts on the player's request: applying for parole, taking an odd job, running after the
    wall. A prison's holiday is off unless a test forces one.
  - If a multi-day bot still changes, the new thing waits for the player's first use in the run (as the phone's
    queue did in P34). It is never fixed by accepting a changed snapshot.
- **The sim**:
  - New `EXT`, `TALK`, `DOING`, `SALT` and `TODAY` codes continue after the last ones.
  - New state fields are appended and load as optional.
  - Every draw comes from `roll()`. Holidays come from the real date only through the run's start (below), never
    from `Date` inside the sim.
- **Nothing already earned is taken away.** An escape still counts the moment the player is over the wall: records,
  medals and achievements stay as they are today. The manhunt only adds to them.
- **Every phase ships**:
  - sim, 3D, phone and desktop UI (cards docked left in landscape), EN and FR;
  - How to play in the P37 page shape, with pictures;
  - bubbles, rumours, achievements and ledger counters;
  - lessons (a fourth chapter grows, or a new one);
  - a test script, and the map viewer brought up to date when something new is placed on a map;
  - three reviews (rules, UI and text, 3D), then a release. Then I wait for the go.

### P39 The parole board (v2.18)
A second, slower way out that rewards playing the model prisoner. It is **route `parole`**, a 12th way out, in all
five prisons. It walks out through the front door like paperwork (P36), using the release desk and gates already in
`PrisonDef.comms.release`.
- **Applying**:
  - At the release desk's tray: Apply for parole. The player can apply from prison day 3.
  - The lawyer (P34) can also file it by phone for a fee, and gets the hearing a day sooner.
  - The hearing is set for the 7th prison day after applying, at 10:00, in the visiting room.
    The day's card announces it, and the routine sends the player there.
- **The record**: a pure function of the ledger (`feats`, `days`) from the day of applying. The card shows it as
  lines, for and against:
  - **For**: days worked with the quota met; courses passed (P35); roll calls, meals and showers attended; calls
    home (P34); favours done; the garden.
  - **Against**: fights started, KOs, solitary, contraband found on you or in your desk, the heat each evening,
    missed roll calls, a dog's alert.
- **The hearing**: three board members (a minigame of a few questions, as the quiz is). Answers are worth more with a
  good record and Intellect, and a lie can be caught by what the record shows.
  - Granted: released the next morning at 10:00, out in the player's own clothes.
  - Denied: the card says the two lines that weighed most, and the player can apply again after 3 prison days.
- **Caught plotting**: a tunnel or hole found, cutters or a shovel found on you, or caught off limits at night.
  Any of these voids the application, and the record starts again from that day.
- **Medals**: slow on purpose (gold around day 12–16, tuned with the bots) in `MEDAL_DAYS`. The Daily never deals
  parole.
- **Proof**: `paroletest`: a model-prisoner bot granted in every prison; a plotting bot voided; a record bot whose
  card lines match the ledger; the denied path and applying again.
- **Lesson**: the hearing (Center Perks, a forced record).
- **Built (where):** the room is data (`content/parole.ts` HEARINGS, not `PrisonDef.comms`, so P40's comms changes don't
  clash): Center Perks' visiting room (the board on the visitors' chairs of the east booths), Stalag Flucht's mess hut
  (nobody visits there: its west table), the canteen where the others' visitors sit (Shankton, San Pancho, Irongate).
  The hearing starts on entering the room between 10:00 and 10:30 (the arrows lead to the seat across from the board);
  leaving it during the hearing is walking out (denied). The board is drawn only: three seated figures in suits (the
  visitors' model, P21) while the hearing is called, sits and gives its word; nothing on the map changes. The map viewer
  draws b1–b3 and the player's seat.
- **Built (applying):** at the desk with EXT.PAROLE (21, b = APPLY or ANSWER), never Interact (the desk's Interact stays
  P36's). The lawyer is a third call (`LAWYER.PAROLE`, $60, `PAROLE_FEE`): the hearing 6 prison days on instead of 7.
  Refused: before day 3, a hearing already set, during the 3 days after a no, wanted or in a lockdown, with a name on
  the release list, away from the desk, in the Daily or at the Training Block (`noParole`).
- **Built (the record):** a pure function of the ledger: the counters as they stood on applying are kept in the state
  (`paroleBase`), the record is now's less those (fights: the days with DAY.FIGHT since the day of applying). New
  counters for what the ledger didn't count (roll calls, meals and showers kept, contraband found on the player or in
  their desk, the heat at 22:00) count only once the player has applied in the run (`parole[8]`): the escape bots'
  ledgers stay as they were. 15 lines (RECORD), each `w` points per `each`, capped; "missed roll calls" became "routine
  missed" (every block missed, from FEAT.missed), "a dog's alert" is FEAT.sniffed.
- **Built (the hearing):** each member asks about a topic drawn by roll() (9 topics, each resting on record lines). Three
  answers every time: a claim (true when each of its lines is clean: worth the member's `claim`; else a lie caught,
  its `lie`), owning up (`own`), fine words (Intellect × `words` / 100). The members weigh them differently (the chair,
  the doctor who values honesty, the deputy warden who values the record). 25 s to answer, silence −2. Granted from 16
  (the record and the answers together; the model-prisoner bots keep only the routine and get 22–26). Under each
  question the card shows what the file says on it, so a lie is a choice, not a trap. A lockdown at 10:00 puts it off a
  day; missing it or walking out costs the application (again after 3 days, like a no).
- **Built (verdict):** granted puts the name on tomorrow's release list (`release[0]`, the board's own day in
  `parole[9]`): P36's call at 10:00, the desk's checks (heat, contraband, a lockdown), its doors; the 22:00 records check
  skips a name the board put there. Out through them is route `parole` (else `paperwork`).
- **Built (plotting):** damage found (`found`), cutters or a shovel among what a capture takes (`solitary`/`infirmary`
  events now say `plot`), or seen out at night (`spotted` night or a failed bed check). Voided, the player may apply
  again 3 prison days on (the plan didn't say; the same wait as a no).
- **Built (medals):** applied on day 3 at the soonest, out on day 11 (10 with the lawyer): gold 12/12/13/13/14, silver
  +4, bronze +5 (Center Perks, Stalag Flucht, Shankton, San Pancho, Irongate); a no and a new application lands in
  bronze. `paroletest`'s five model prisoners are out on day 11.
- **Built (also):** help topic Parole (a timeline; its picture is the lead's to take: `helpshot.ts` has SHOTS.parole);
  lesson `parole` in Ways out (seed 145: fights, work, the heat); achievements Good Behaviour (out on parole, gives the
  gold reading glasses `paroleSpecs`), Counsel (granted on the lawyer's filing), Caught Out and Back to Square One
  (hidden); the rumour `paroleBoard`; bubbles on applying, a grant and a void; a replay highlight; the HUD chip and the
  day's card (the hearing's chip and its hour).
- **Built (rules review):** a denial's score below zero is kept by saves and snapshots (bounded by `SCORE_MIN`/`SCORE_MAX`);
  a hearing loads only with an application whose hearing is today. "Contraband found" counts only what is taken off the
  player at a capture or out of their desk in a search (a sighting is not a find). Fights are the days the player started
  one (DAY.STARTED: not self-defence, not a food fight), from the step of applying; knockouts only the player's own in
  them (`kosDealt`), never a follower's. A claim on a line against holds only at nothing at all (9% of heat is not
  "nothing on me"); favours need 1; under each question the card marks whether a claim holds (and the need for work).
  A denial names no line worth 0 points. The hearing comes before a fire drill's muster, which excuses the player. Once
  cleared at the desk nothing voids the grant (route stays `parole`); a grant lost at the desk waits 3 days as a no does;
  the lawyer's $60 comes back when the filing is refused at the call's end; knocked out at the hearing puts it off a
  day; the multitool counts as a plotting tool; Counsel needs the grant on the lawyer's filing (`lawyerGranted`).
- **Built (UI review):** at the seat across from the board the player sits on it, facing the board. On a phone held
  sideways the hotbar steps aside for every parole card, the card clears the HUD's chips, the warden's line goes top
  right and a lesson's card bottom right (the board stays in view); upright, the desk's record stays below the player
  (tight rows, it scrolls), the for-lines at nothing on one line and no "0" points. The verdict hides the action button;
  the call to the room is dropped once the player sits. San Pancho's and Irongate's boards stay split across two
  tables: their canteens have only two-seat benches. The lesson holds the verdict 6 s before it ends.
- **Built (full review, rules and text):** no visitor comes while a hearing is due or sitting (the board sits on the
  visiting chairs; visiting hours overlap the hearing): the visit comes after the verdict, still in visiting hours
  (`paroletest`). Conduct achievements need an escape (§2). The verdict's score is signed like the desk's ("−3"); the
  warden's morning card and the file's Today (and Tomorrow) have a row for a hearing that day. The pay phone's help
  names the lawyer's filing ($60, the hearing a day sooner).

### P40 The odd jobs board (v2.19)
Small missions with a bit of story: the next step beyond the four favours (`FAVOR`). They are built only from things
the game can already do.
- **The board**: a cork board on a canteen wall in every prison. It is decor plus the tile in front, like the phone,
  and checked by the comms tests. It holds three jobs at a time, dealt each morning by `roll()`. The fixer (P21) also
  offers one job of his own.
- **One job at a time**, with a timer of 1–3 prison days. The HUD chip and the file's Today show its steps, and floor
  arrows appear where the step names a place.
- **Kinds** (about a dozen, as data in `content/oddjobs.ts`), for example:
  - **Lift it**: the warden's mug from the office, a guard's whistle.
  - **Drop it**: a parcel into someone's desk without being seen.
  - **Frame**: plant contraband in a rival's desk before the shakedown.
  - **Fix the game**: lose (or win) a set at checkers or Cheat, or at the arm-wrestle, for someone.
  - **The rat**: carry a note by rat.
  - **The cake**: smuggle a birthday cake in through visiting.
  - **Lookout**: whistle when a guard comes during someone's dig.
- **Story chains**: each prison has one chain of 3–4 jobs for a named inmate, told in short cards. For example, at
  Center Perks, the old-timer's lost watch.
- **Rewards**: cash, a rare item, an Intake cosmetic, or a debt: the inmate owes you one, so they join your crew
  without the opinion, or hand over a tool.
- **Failing**: the job goes, opinion drops, and a frame caught out brings heat.
- **Proof**: `oddjobstest`: every kind done by a bot in every prison it can be dealt in; the chain finished; the
  deals never ask for something the prison doesn't have.
- **Lesson**: one job from the board (Center Perks).

**Built** (what differs from the plan above, and why):
- **The board**: `PrisonDef.board` (its own field, not inside `comms`: nothing in the phone's data changes, and the
  other phases' edits to `comms()` can't collide with it). On the canteen's north wall in all five prisons, clear of
  the stage and of the two rows a wall hides: Center Perks 49,7; Stalag Flucht 5,30; Shankton 25,14 (moved off the cyan door at 38,13 in the browser re-check); San Pancho 17,32;
  Irongate 29,28. Its checks live in `oddjobstest` (the kiosk's checks, done the same way), not in phonetest.
  Drawn by `render/OddJobs.ts` (the decor kit's parts and the notice board's colours, not a `DECOR` kind: its cards
  come down as their pins are taken, a tag hangs while a job is held).
- **Taking a job**: standing on the board's tile opens its card (the kiosk's way, no action key); the job's own card
  opens from its HUD chip or **B**. Board jobs can be taken at any hour outside a lockdown; the fixer's in his hours
  (free time) from opinion 50, once a prison day.
- **Kinds**: twelve. The plan's examples are all there (Lift it: a guard's whistle, or the head cook's mug from the
  kitchen freezer instead of the warden's mug from an office: no prison has an office container; drop, frame, fix the
  arm-wrestle / Cheat / checkers either way, rat mail, the cake, lookout), plus **delivery** (in person), **the tip-off**
  (P34's anonymous call) and **the errand** (sugar from a merchant). A garden kind was dropped: a bed takes three days
  to ripen, longer than a job's timer.
- **Lookout**: the one who asked digs under his bed in the free times (`DOING.DIG`) while the player stays within 4
  tiles of his cell door; 15 game minutes of digging in all. A guard within 6 tiles is "coming" (a toast, the chip
  flashes); the whistle (B, the chip, or the card) hides the dig while he's near; one within 2 tiles who can see in
  finds it (failed). A whistle with nobody coming costs 3 minutes of the dig.
- **Frame-up**: the one who asked tips the guards off at 19:00 each day the stash is in place (the phone tip's
  searcher); the morning shakedown finding it counts too. Planted in a guard's sight: failed and +35% heat.
- **Drop**: seen as the parcel lands in the desk (`state.seen` that step): failed. A parcel (or stash) left in that
  desk by an earlier job doesn't count: only one more than it held when the job was taken.
- **Cake**: dealt only when a visiting day (Stalag Flucht: the Red Cross parcel's delivery day) falls inside the job's
  days, so it can always be done; it comes at the next visit after it's taken (Lou's cake waits for the day after).
- **Every job ends with the one who asked** (TALK.JOB_IN), as favours do: cash, and on some a rare item or a debt.
  A debt: he joins the crew whatever he thinks of the player (the debt is paid), or hands over a tool (TALK.CALL_IN).
- **The fixer's job**: one of his kinds (lift, drop, frame, tip), 1.5× the pay and a rare item always.
- **Story chains**: three steps each (not four), from prison day 2, a step a prison day, on a fourth card beside the
  pins; a short card as each is taken and handed in. Center Perks: Doc's watch; Stalag Flucht: Ferret's tunnel;
  Shankton: the Preacher's collection (not the fixer's: Deacon is Shankton's fixer); San Pancho: Toro's birthday;
  Irongate: Gull's message ashore. The cosmetic is earned through achievements: a story finished gives the copper
  trim, five stories the saffron trim.
- **Codes**: EXT.BOARD 24, EXT.WHISTLE 25; TALK.ODD_JOB 28, JOB_IN 29, CALL_IN 30; DOING.DIG 35; SALT.ODDJOBS 35,
  FIXER_JOB 36, ODDJOB_PERK 37; TODAY.FIXER_JOB 524288, ODD_JOB 1048576. State: `oddjob`, `oddjobs` (appended,
  optional on load). Items appended: parcel, stash, note, whistle, mug, birthday_cake, pocket_watch.
- **Not changed for anyone until a job is taken**: the deals are pure (`roll()` with the prison's own key), and only
  a lookout's digger walks where he wouldn't; every escape and multi-day bot snapshot is byte-identical.
- **Achievements**: oddJobber (5 handed in), storyTime (copper trim), wholeStory (saffron trim), framedUp,
  fixersFriend (3 of his), calledIn. Ledger: oddJobs, oddJobsFailed, fixerJobs, storySteps, stories, debtsCalled,
  framed. A rumour (`boardJob`: who pinned a job today), bubbles for the digger and for a job handed in or failed.
- **How to play**: the `oddjobs` page in the P37 shape, without its picture yet (`pic` off until
  `public/help/oddjobs.webp` is taken in the browser pass).
- **Built (rules review):** a stash or parcel the pet rat leaves is never "seen" (only one put in by hand while a
  guard sees the player). A frame-up counts only the desk's standard drawers (the search never opens the hidden
  compartment). A lift's item is left where it's found (`liftSpot`: an open slot, else over an earlier job's leftover,
  else over the container's own stock, never the player's things nor a guard's kit; nowhere: not offered,
  `liftFull`); a lift given up or failed takes it back; it counts only once out of there (PROG), so a whistle, mug or
  cake kept from an earlier job finishes nothing. A drop's parcel taken back out undoes the drop. A drop's or
  frame-up's count of what the desk already held follows it down (an old stash searched out). **Time**: taken from
  18:00 (the evening free time), a job's days count from the next prison day; the card says when it ends ("Until
  08:00 tomorrow / on day N"). At 08:00 a job whose work is done, or whose item is in hand, waits to be handed in
  with no deadline; otherwise it fails. The cake: no room in the hotbar at a visit, into the player's desk; no room
  in the desk for the parcel, into the hotbar; neither, a toast once a day and it waits. A bribed guard looking away
  doesn't find the dig. A rat's job says on its card that it needs a pet rat (it's still dealt without one: the
  rat can be had within its 3 days). Left as is: the fixer's rare item every day is generous (one job a day, opinion
  50, the riskier kinds); to revisit if it makes tools too easy.
- **Built (UI review):** the whistle only in the dig's hours with the digger at it (`canWhistle`); B and the chip
  whistle only while a guard is coming (`whistleNow`), else they open the job's card; a red pulse, not the order's
  green. The board hangs from 0.5 to 1.3 (under the wall's top), a little off a corner's wall, and fades with its
  wall's see-through cut. The digger faces the most open floor beside his bed (`digFace`), leaning less. The board's
  card says "one job at a time" once, starts at its top, and steps aside while a story's card is up; Take buttons
  named by kind and asker. On a phone held sideways the HUD's chips clear a card docked left and a panel docked
  right; upright the job's pill takes the screen's width. A delivery's parcel is given from the talk panel; the hand-in
  row says the job is done; one toast per action (a delivery, a debt's recruit). Center Perks' and Irongate's
  stories hand over a parcel; Shankton's Preacher keeps his name in French. Not done: the player's head over the
  middle cards (no browser in this pass); the map viewer's in-game photos to retake in the browser pass.
- **Built (browser re-check):** Shankton's board moved to 25,14 (38,13 behind it was the cyan door; `oddjobstest`
  now asks for brick or reinforced wall behind every board). A guard is "coming" only while the player is on watch.
  A delivery's parcel handed over is not a gift (no opinion), and it leaves the gift row for its own. Touch variants
  of the job's hints and the "coming" toast; the dig's % apart from the chip's words; the race card steps aside for
  the job's card; in landscape the toasts clear a story's card, and the job's pill hides when a card and a panel are
  both open; the board card's scroll reset once it's shown; the Today row's dot kept with the step before it.
- **Built (full review, rules and text):** the help's pay reads $15–55 (the fixer's up to $83), and `helptest` checks
  it against `KIND_DEFS` and `FIXER_PAY`; a save's job with a stage, pin (`FROM`) or perk that can't be loads as none.
  The Irongate lookout's digger walking to his bed every free time costs about 2% of a step there (measured): left as is.

### P41 The manhunt (v2.20)
Over the wall is no longer the end of the run. A short last act follows: reaching safety outside.
- **When**: after the physical routes (fence, tunnel, roof, takeover, gate, raft, helicopter, stowaway, glider,
  bluff). Paperwork and parole are legal releases: a short bus-stop scene, and no manhunt.
- **The escape counts first.** The card shows "Escaped". Then Keep running, or Skip: a skip keeps today's ending.
- **The outside**: a small map per prison (`PrisonDef.outside`, ASCII, a new layer of data, `maptest`-checked).
  The player starts where the route left them, and the safe point is across it.

  | Prison | Outside |
  |---|---|
  | Center Perks | woods and a road |
  | Stalag Flucht | snow, a river, the border post |
  | Shankton | a rail yard and an industrial estate |
  | San Pancho | scrub desert and a highway |
  | Irongate | a harbour town, reached by raft or helicopter |

- **The hunt**:
  - searchers on foot with dogs (k9 rules: scent, trail);
  - the helicopter's searchlight (searchlight rules);
  - roadblocks;
  - noise heard as inside;
  - the alarm's age raises the pressure.
  The player hides in hedges and culverts, and can swap clothes off a washing line.
- **Help from inside**: what the player arranged earlier counts.
  - **Lou** (P34), if a call set it up, waits with a car at a point on the map: a shorter run.
  - A crew member who escaped with the player keeps watch.
  - The glider lands further out.
- **The outcome**:
  - Safe: **a clean getaway** (a star on the escape card and the medal shelf, achievements, a better replay).
  - Caught: recaptured, and the escape still counts. The card says how close the player got.
- **Proof**: `manhunttest`: a getaway bot per prison and per kind of start; every outside map reachable to the safe
  point; the escape bots' snapshots unchanged (they end at the wall).
- **Lesson**: the manhunt (Center Perks' woods).
- **Built** (what differs from the plan above, and why):
  - **Its own simulation.** The hunt is `sim/hunt/Hunt.ts`, a deterministic sim of its own (20 steps a second,
    packed commands, integer positions, draws from `roll()` with `SALT.HUNT`), built from the outside's data and a
    `Carry` read once at the wall (`sim/hunt/carry.ts`: the way out and its start kind, Speed, the outfit, the
    hotbar and weapon, the crew out, Lou's car, the minute, the salt, the head start). The inside run's state is
    never touched: no new inside state field, no new FEAT, no new TODAY/DOING/TALK code was needed, so every inside
    snapshot (the escape bots, simtest's hash) stays as it was. The hunt keeps its own counts (`HUNT_FEATS`); the
    lifetime stats gain `hunts`, `getaways`, `recaptured`.
  - **The outside maps** are `content/outside/<prison>.ts` (not a `PrisonDef` field: the prisons stay as they
    were): 60 × 56 pictures in their own legend (trees, cacti, rocks, crates; hedges and culverts as cover; gravel
    and railway lines loud underfoot; rivers, fords that wash the trail; wire that cutters cut), centred in the 64 ×
    64 world. The plan said about 40 × 30: a first cut at 48 × 34 was crossed in ten seconds, too short for an act.
    Past the picture: woods, or the sea where its edge is water. `sim/hunt/world.ts` builds a `World` from it (its
    trees and crates as solid `parked` tiles, cover and trees in a new `World.veil` that stops sight but not feet),
    so walking, sight, cones and paths are the inside's own code. Starts are by kind (`content/manhunt.ts
    startKindOf`): wall (fence, tunnel, roof), gate (takeover, gate, bluff), glider (further out), van (stowaway),
    sea (raft), air (helicopter; Irongate's stowaway rides the supply helicopter). Safe points: Center Perks' night
    bus, Stalag Flucht's border (across the wire: a gap far west, cutters, or past the post), Shankton's night
    freight, San Pancho's truck stop, Irongate's coach station.
  - **The hunt's rules** (numbers in `content/manhunt.ts HUNT`): searchers walk beats and look with the inside's
    60° cones (7 tiles by day, 5 after dark); a notice meter (in other clothes they know the player only within 3
    tiles, in a guard's uniform 2.5); spotted, a chase and the radio; out of sight 3 s, a look round where last seen.
    Chasers run 176 (inside: 196) and everyone but the dogs slows off the roads (75%), so a chase out there can be
    shaken. Cover hides from every eye once still for half a second; dogs (4 tiles to pick up a fresh trail, 60 s
    fresh, 60 tiles long) track it right into a hedge, point and bark, and their handler finds the player there. A
    ford lays no trail; a washing line gives other clothes and wipes the trail. Noise is walking-distance as inside:
    gravel crunches, a cut, a bark, and a thrown stone (Space, every 5 s: the plan had no decoy) draw searchers to
    look. Treats from the hotbar work on dogs as inside (jerky calms, pepper dazes and wipes the trail, sleepy jerky
    puts to sleep). The alarm comes after the head start (to the next headcount, 5–20 s; none if seen going, in a
    lockdown or a takeover); searchers come out by their own seconds after it, patrols are out before it, then
    roadblocks (5–25 s) and the helicopter (15–25 s), whose light finds the player anywhere out of cover and calls
    everyone in.
  - **Help from inside**: Lou's car (`wheels`, P34) waits on the outside map, nearer than the safe point from the
    starts by the walls; a crew member out too keeps watch from a rise and whistles at a searcher coming within 7
    tiles; the glider's start is further out.
  - **The card**: the escape counts at the wall as before (records, medals, achievements, the replay kept); the card
    then offers Keep running or Skip (Skip: the card as it always was). Safe: a clean getaway (`RouteBest.clean`, a
    green star beside the route's medal on the shelf, a line on the card); caught: "Recaptured, n% of the way". With
    the hunt's line the card goes two columns on screens under 1000 px tall. Legal releases (`LEGAL_ROUTES`: paperwork
    and, since the merge with P39, parole) and the Daily end at the wall: no offer. Leaving a hunt from the pause card
    counts as a recapture in the stats (giving up is being caught; no achievement).
  - **Not built**: a replay of the hunt (the replay kept is the inside run's, as before; "a better replay" is left
    for later), rumours about the outside (no gossip kind), and help pictures (the topic is laid out with a timeline
    and waits for `public/help/manhunt.webp`, then `pic: true`).
  - **Achievements** (8): Clean Getaway (gives the forest beanie, `mhBeanie`), Without a Trace, Change of Clothes, Out
    of the Light, Getaway Driver, Long Arm of the Law and So Close (mishaps), All Clear (career: every prison).
  - **Proof**: `manhunttest`: every map's data (a start for every way out that needs one, the safe point and Lou
    reachable with every roadblock up and no wire cut, beats walkable, posts and lines reachable), the getaway bot
    (`scripts/huntbot.ts`: shortest way out of every eye's reach, else into cover) clean away from all 17 starts and
    again seen going by day, each rule on its own, determinism, the lesson played through. `scripts/dev/huntsweep.ts`
    sweeps the bot over every start, night and day. The map viewer has an Outside view per prison.
  - **Lesson** `manhunt`, last of the Ways out chapter: over Center Perks' wall, into the woods, a thicket while a
    searcher goes by, clothes off a line, Lou's car (one searcher, no roadblocks, no helicopter). Dev builds start a
    hunt from the console: `__manhunt('stalag-flucht', 'wall', { minute: 1410, crew: 1, lou: true })`.
  - **Rules review** (before release; the numbers above are the first cut's, these replace them):
    - Bugs: a searcher sent to look (a noise, the radio, the helicopter, a lost chase) now walks there, looks round,
      and goes back (with no way there he looks round where he stands); before, he froze. A ford washes the trail
      off and a dog tracking it loses it there (it routed across the gap).
    - Cover hides only someone keeping still in it (`hidden`); moving in it, eyes see them within 3 tiles (the meter
      at a third of the pace) and the helicopter only right underneath. A chaser who saw them go in, or a handler
      whose dog points at them there, pushes into cover and catches them within 1.6 tiles. In the open a dog's find
      is a chase, not a capture. A dog's nose (2.5 tiles) finds the player hidden or not.
    - Fair arrivals: nobody comes on within 5 tiles of the player or in their sight (they wait), nobody due at the
      alarm before 4 s into the hunt, mid-map arrivals come on at a map edge or gate (`SearcherDef.from`). A
      roadblock waits for a loiterer 10 s at most. Cacti block sight (legend, comment and code agree). The
      helicopter moves with integer math. A washing line in a guard's uniform says it's a worse disguise (the
      eyes know you a little further off) but washes the trail all the same.
    - Balance: everyone moves at 45% of the given paces outside (`HUNT.pace`: the country is bigger than a yard;
      relative speeds as before), the head start is 5–10 s, searchers come out 0–9 s after the alarm (roadblocks 2–8 s,
      the helicopter 10 s, faster: 180). Each run shuffles the times among those out after the alarm and moves every
      time up to 4 s, starts patrols at a stop of their own and beats at a stop drawn. Once the alarm is up the
      searchers out after it sweep the cover (and open ground every 8 tiles) nearest where the player is reckoned
      to be (`guess`: 1.5 tiles a second along the shortest way to safety from where they were last known; radio
      and the light call only those within 20 tiles). After the last is out the search widens every 15 s, six times:
      +1 tile of sight, the dog teams work back where the player was last known every other time, the helicopter
      searches the same cover, from the second time the patrols sweep too; the dog teams keep their own round of
      places sniffed. Keeping still fails in the end (in the cover nearest safety: caught in 69–360 s; in the open
      where they came out: 40–181 s).
    - Every start has a careful line in the jumpsuit: Shankton's estate gained hedges along two rows and culverts
      under its three roads, and a washing line by the gate road (33,44); Stalag Flucht (40,50) and San Pancho
      (30,47) gained a line near the gate too.
    - The gauge, `hunttest` (the review's limited bot: `HuntBot` plain, 12-tile view) over 17 starts × night/day ×
      head start/seen going × jumpsuit/uniform × 3 salts: caught 106/408 (26%, from 0% at Center Perks' wall to 71%
      at Irongate's gate), a getaway in 53 s on average (25–123 s; a human plays slower); the expert `HuntBot` (it
      sees everything; looking-round searchers counted all round, the gates and edges still to open kept clear of, a
      line or a ford close by when a dog is on the trail) gets away in all 136 combinations, each in either outfit,
      with one run's draws or another (salts 1–6 tried; 33 need more than the first, none more than 5). `manhunttest` keeps each rule's
      test (a look walked and done, cover moving and a chase into it, a dog in the open, the ford, a loitered
      roadblock, the uniform and the line).

  - **UI review**: How to play (H) in a hunt opens on the manhunt topic and the hunt goes on after it; the pause
    card says leaving counts as recaptured; the HUD starts clean each hunt, says "1 tile", shows a "A dog's on your
    trail" pill, and keeps the distance on a phone held upright; toasts keep clear of the stone (portrait) and of the
    strip below the player (landscape). Lou's car stands on its spot (open road, checked); Stalag's border ring sits
    beyond the wire; Irongate's outside is sea all round (no woods past the town, as the map viewer now shows too),
    the prison's ferry and patrol boat are no longer drawn there, and Pike's beat keeps west of the gate start; a
    river running off the world's edge goes on out of sight; a faint glow at the player's feet after dark; head-on
    into a tree the player slides round it. The helicopter's light shows them whatever they wear and holds a chase
    (no "lost you" in the light), and calls the nearest searcher when none is within the radio's reach; a guard's
    uniform fools eyes only till the search has widened twice (a toast says so), so keeping still in the open in it
    fails as in the jumpsuit (40–181 s). Night-only barks only at night; the lesson's thicket step ticks once the
    searcher has gone by; its recapture card has a title and a line under it; the hunt's achievements come first on
    the card. Not done: the van, glider and helicopter starts still begin on foot (no vehicle moment), and the
    lighter rectangle of Irongate's sea over the picture couldn't be traced without a browser (the data past the
    picture is the same sea now).
- **Built (full review, rules and text):** a hunt counts in the stats once a run (its salt, as an escape does: the
  trophies' store keeps `hunted`), so the same save hunted twice, or left, is one hunt. The help names the touch
  Stone button beside Space, says plainly that a guard's uniform hides better than washing-line clothes, and the
  French names the jerky as the item does (viande séchée).
  - **Built (full review of v2.21.0, 3D):** the seams at the world's edge. The contact shadows' multiplied layer
    darkens even its white a little (the tone curve), and only over the 64×64 world: it now carries on past the
    edge round the sea (Irongate's prison and outside) and round the manhunt's outside, with open ground's average
    shade. The fields past the outside's edge are its own grass (untinted, the floors' shade), the picture's roads,
    dirt tracks and railway lines run on 44 tiles off its edge (over the woods band too, rails and gravel with
    them), and the woods past the world's edge are the HuntView's, clear of those and of the rivers. The next
    hunt's helicopter no longer eases in from where the last one was. A glow round each searcher after dark is
    drawn from `HuntFrame.searchers` (the play loop fills it).
  - **Built (Irongate's sea seam, re-check):** the line down the sea was the Island view's shallows, a canvas the size
    of the map: where land lies within 3 tiles of its edge (the manhunt's town 2 in, the prison's west shore 1 in) their
    paler gradient stopped square at the edge. The shallows are now drawn 6 tiles past the edge.

### P42 Holidays (v2.21)
The prisons dress up for the holidays of the real calendar, each with its own day, decor, items, words and trophies.

| Holiday | When (real date) | The day and what's new |
|---|---|---|
| **Easter / Pâques** | Good Friday to Easter Monday (computed each year) | An **egg hunt** in the yard and the desks: chocolate eggs to find before the inmates do (they trade them as cash). Bunny ears in the Intake. The feast has a lamb roast. |
| **Summer** | 1 July – 31 August | **Sports day** on the grounds: races, tug of war, a medal. A **barbecue** in the yard, and a **water fight** with hoses that soaks the guards (wet: a moment's cover). An ice-cream van comes on delivery day. Heatwaves come more often. |
| **Halloween** | 24 October – 2 November | **Costume night**: a costume is a disguise that fools no one but makes everyone laugh. Pumpkin carving in the kitchen. A ghost story at lights-out; the rat scares a guard. |
| **Christmas & New Year** | 15 December – 6 January | **Christmas dinner** and a gift swap (a gift raises opinion). A snowball fight where there is snow, and jokes about it at San Pancho. **New Year's Eve fireworks** at midnight, loud enough to cover the noise of work. |

- **How the date gets in**: the play layer reads the date when a run starts (as the Daily does) and stores
  `state.holiday`. Inside the sim it is only data, so a replay plays back the same.
- **Settings**: Holidays: by the calendar (default), any holiday now, or off.
- **The Daily** keeps its deal for every player alike. Only the decor follows the date there.
- **Render only, where possible**: decor (wreaths, eggs, bunting, pumpkins, lights) from the decor kit, and nothing
  solid that could change a path.
- **Proof**: `holidaytest`: every escape bot under each holiday still gets out; the Easter dates for 2026–2035;
  each holiday's day dealt and its items gained.
- **Lesson**: none (each holiday's day explains itself on the warden's card).

**Built** (what differs from the plan above, and why):
- **The date gets in** as planned: `content/holidays.ts` `holidayOn(y, m, d)` (Easter by the Gregorian computus,
  Good Friday to Easter Monday; 1 Jul–31 Aug; 24 Oct–2 Nov; 15 Dec–6 Jan), read by `game/holidays.ts` when a
  campaign run begins and handed to `new Sim(prison, seed, mods, holiday)`; it lives in `state.holiday` and in
  the run log's head (`RunLog.holiday`), so saves and replays keep it. Settings: Holidays *By the date* (default) /
  *Pick one* (Easter, Summer, Halloween, Christmas) / *Off*. The Training Block and lessons never have one.
- **Not a deck card: a row of its own.** The reserved `DAY_EVENTS` 13–17 are **unused**. A holiday's day is a
  second layer beside the week's deck (`holidayDaysOn`): it falls on **day 2 and every 7th day after**, New
  Year's Eve the day after Christmas Day. So no deck card is lost, no forced calendar (bots, the Daily) has to know
  about it, and the escape bots' day 1 stays untouched. It shows as its own row on the warden's morning card,
  the day card (a chip and a pin in its block), the file and tomorrow's forecast.
- **The days** (times as minutes after 08:00 in `HOLIDAY_DAY`):
  - *Egg hunt* (Easter, 08:00–22:00): at 08:00 a chocolate egg goes into 6 inmates' desks with room (never the
    player's own) and 6 about the yard, drawn with `roll(SALT.EGGS)`. An egg counts as found once it is in the
    player's pockets (a hidden egg carries a uses bit, cleared then). At 22:00 the eggs not found are gone: those
    still in the inmates' desks (else they pile up week after week and starve the desks' loot) and those still
    hidden in the yard (one carried off elsewhere, as by the rat, stays where it lies). Eggs are
    eaten like chocolate or sold to a merchant. Inmates tip off whose desk hides one (gossip kind `eggDesk`).
    Dinner is a feast (the lamb roast).
  - *Water fight* (summer, 15:00–15:30): a guard **on the sports ground** sees 2 tiles (`WET_SIGHT`). It is
    held there in every prison because the exercise hour (15:00–16:00) wants the player in the gym or on the
    ground, never the courtyard (`zonesOf`); held in the yard, it cost "Missed Exercise" (UI review). The
    warden, the banner, the help and *Splashdown* say "the sports ground". An ice lolly at the canteen
    counter that day, and the barbecue is dinner's feast. Heatwaves come more often all summer where the climate
    has them (weight ×2 + 10; never in the Alps, nor at Shankton and Irongate, whose climates have none).
  - *Costume night* (Halloween, 19:00–21:00): a witch's costume at the canteen counter and a pumpkin in the
    kitchen freezer from 08:00. The costume is an outfit that is no disguise. Worn on costume night, every inmate
    within 2 tiles laughs once (+5 opinion). Caught, the player wakes up in the jumpsuit as with any outfit. The
    pumpkin is carved into a jack-o'-lantern (it sells for more) with the use button **in the kitchen**. The
    ghost story is the inmates' talk after Lights Out.
  - *Christmas Day* (08:00–22:00): a present from under the tree (the canteen counter). Given to an inmate, it
    is the gift swap (an ordinary gift worth $30: +15 opinion). Christmas dinner is a feast.
  - *New Year's Eve* (00:00–00:10 at the end of day 3): the fireworks cut every noise to 2 tenths of its reach,
    everywhere (`muffled`).
- **Treats are on request** (`EXT.HOLIDAY` 32, `TREAT`), one of each a prison day, offered as take buttons in the
  open furniture beside P28's, from 08:00 until their holiday day is over (`treatHours`: the lolly until 15:30,
  the costume and the pumpkin until 21:00, the present until 22:00); the day card says so.
- **Cut to keep it small**: no ice-cream van on delivery day (the lolly comes on the water fight's day instead,
  since Shankton has no delivery); no new sports day with races and tug of war (sports day is already in four decks);
  the rat scaring a guard and the snowball fight are words only (barks, the snowman, a sandman at San Pancho).
- **Decor** (`render/Holidays.ts`, render only, planned from the map by `holidayDecor` and checked by
  holidaytest): garlands (lights at Christmas) along the canteen's north wall, broken round what hangs there
  (the menu board, the clock, posters, P40's odd jobs board), on the side walls where that leaves no run of two
  tiles (Irongate; never a south wall, the camera's side), the Christmas lights on a drooping wire; the tree never under a garland nor under anything
  hung on a wall (its column, a tile either side: the menu board, the odd jobs board), and nothing standing on any
  tile round it (its boughs and presents never touch a table or the counter): along a wall, else free in the room
  away from doors and the counter's queue (Center Perks' 50,11, Stalag Flucht's 10,33), else out by the yard
  (San Pancho's canteen has no room: on the sports ground, 34,34); egg baskets (Easter) or jack-o'-lanterns (Halloween) on its tables;
  parasols, deckchairs, a barbecue and two hoses' sprays on the sports ground (summer); lanterns along the yard's walls (Halloween); a lit tree with presents in a canteen corner and a snowman
  in a Santa hat (a sandman in the desert) for Christmas; fireworks just above and ahead of the player at
  midnight (within 3 tiles across and 1–4 ahead, in view on a phone). Nothing stands on furniture, the prison's
  own floor decor, a pastime's ground (pitch, track, the court's whole painted half, garden, rat track, stage;
  and, but for a hose against the wall, not within a tile of the track or the court) or by a door
  (the tree two tiles off); parasols keep 3 tiles apart, their deckchairs only where there's floor for them,
  and a canopy fades over whoever stands under it (the camera looks down); where the sports ground has no room
  left by them (Center Perks'), the parasols stand in the yard beside it. Each hose sprays a short fan of three
  jets 3 tiles out from its wall (`HOSE_REACH`), splashing where they land. The title's
  prison is dressed for the date. The Daily plays without a holiday; only its decor follows the date (the
  date's own, never a holiday picked in Settings). The inmates' holiday talk is the day's own only on the
  holiday's days (the snow and sand jokes any day of a Christmas run). The map
  viewer doesn't draw any of it: the decor depends on the date, not on the prison's data.
  P41's manhunt is never dressed: its outside world gets no decor (its frame's holiday is none) and its sim never reads
  `holiday`.
  The help page's picture is staged by `SHOTS.holidays` in scripts/dev/helpshot.ts (Christmas in Center Perks'
  canteen: the tree free in the room, the player beside it, the lights on the north wall), to be taken in the browser.
- **Cosmetics** (earned): bunny ears (*Egg Hunter*, 5 eggs in a run), summer shades (*Splashdown*, in the water
  fight), a witch's hat (*Trick or Treat*, 3 laughs), a Santa hat (*Secret Santa*, a present given); and *Out With
  a Bang* (5 tool strikes under the fireworks). They form a new shelf group, Holidays. Ledger: `eggsFound`,
  `waterFights`, `treats`, `carved`, `laughs`, `giftsGiven`, `fireworkWork`.
- **Proof**: `holidaytest` (the date's edges, Easter 2026–2035, Settings, the days dealt in every prison, each
  day's rules in the sim, saves and logs, the decor's placement rules in every prison and holiday, the
  holiday talk on its days only, a player at the water fight present for Exercise) and `holidaybotstest` (all 33 escape bots under
  each of the four holidays, and P39's model prisoner, whose 11-day run lives through two holiday days, under
  each holiday at another prison; it runs beside the other), and `holidayruntest` (a bot playing the evenings by
  commands at Center Perks: tool work through the water fight, costume night's laughs and none after 21:00,
  the present given, ten strikes on the cell wall under the fireworks, heard 1 tile off). No escape snapshot changed. Only counts and
  the state's hash changed (simtest, replaytest's save size, items, achievements, keys, banks, help).
- **Built (full review, rules and text):** the water fight's bit is `TODAY.SPLASHED` in calendar.ts with the other
  day bits (same value). The texts say "sports field" ("l'heure de sport" in French) as the older ones do, and the
  fireworks "muffle every noise to a whisper" (they cut it to 2/10, 1 tile at least), not drown it out. English
  apostrophes in the P39–P42 keys follow the file: straight in game text, curly in help pages (as since P37). French:
  "1 leçon sur 48" (the singular under 2).
- **Built (full review of v2.21.0, 3D):** the openings between rooms with no door (`openingsOf`: a gap in a wall's
  line up to 4 across, another zone through it) are doorways to the decor, and nothing stands in line with a
  doorway (`lanesOf`, 4 tiles on; parasols a tile either side too), in a one-wide passage or within a tile of a
  fence's wire; nothing by a wall stands just north of one (the wall hid it from the camera: the lanterns,
  barbecues and hoses the review listed); a tile in from a fence counts as by the edge where a sports ground or yard
  has no wall (Stalag Flucht's). Ground pieces are picked one at a time, each keeping the tiles round it (Irongate's
  lanterns stood side by side). Garlands never hang on a south wall (Irongate's now on its side walls) nor
  behind the parole board's seats (Stalag Flucht's and San Pancho's broken there). Irongate's tree, which stood in
  the canteen's south opening, has no room left in the canteen: it stands by the sports ground. Each hose has a
  tap, a reel and a nozzle on a stake, its fan of jets over nothing standing nor the other summer pieces. Baskets
  and lanterns on every canteen table (Center Perks' eight). San Pancho's sports ground has room for one parasol
  off its ways in. The parasols share one two-sided material and eight faded steps (one shader, compiled with the
  prison: the first parasol cost a ~190 ms hitch). Fireworks: bigger sparks with trails and a flash, none drawn
  with reduced motion. The witch's hat: a narrower brim, the hat tipped back, so the face shows from above.

### Phases
- **P39 The parole board (v2.18)**: the application, the record from the ledger, the hearing minigame, route
  `parole` with five bots, medals; one lesson.
- **P40 The odd jobs board (v2.19)**: the board in every canteen, a dozen kinds of job, a story chain per prison,
  rewards and debts; one lesson.
- **P41 The manhunt (v2.20)**: five outside maps, the hunt, help from inside, the clean getaway; one lesson.
- **P42 Holidays (v2.21)**: Easter, summer, Halloween, Christmas and New Year; the setting; decor, items, trophies.
