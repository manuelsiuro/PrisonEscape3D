# City Escape: the design

A second game mode beside the prisons, asked for by the user on 2026-11-13 ("a new game mode based on
the foundations of the existing game … a post-apocalyptic city, where zombies emerge at night and in the
city's darker areas. Players must survive by scavenging for food and crafting weapons for defense … a
solid gameplay loop … procedurally generated … several 64x64 maps with transition points … an overall
minimap … quests or objectives, ultimately leading to a way to escape the city … a narrative
framework"). This is the mode's design source of truth, as the GDD is the prisons'. Where the build
departs from it, the decision goes in [`../decisions/city.md`](../decisions/city.md); how it is built,
stage by stage, in [`../phases/10-city-escape.md`](../phases/10-city-escape.md).

The user's choices (2026-11-13): the player is **their prisoner** from the prison game; the city is
**3 × 3 districts**; death is **chosen at the start** (Survivor or Hardcore); the mode is **hidden
until complete** (each stage released, the menu entry shown only with `?city` in the address). Claude's
picks, told to the user: the same blocky look with a darker, overgrown palette; no gore; three ways out
at first.

## 1. The premise

A prison transport crosses the ring road at dusk, six inmates chained in the back. Sirens, a roadblock,
something in the headlights that will not move. The player comes round at dawn: the bus on its side,
the guards gone, the others gone. The army cut the city into nine sectors with fences and checkpoints
before it fell, then walled the whole of it in and left. The dead keep to the dark: indoors where the
power is out, the metro, the sewers; and at night they come out everywhere.

Nobody is coming to count the player. The goal is said on the first card and never changes: **find
food, find out what happened, find a way out.**

**Tone.** The prison game's dry humour survives (the radio voice, the notes people left), but the
city is quiet and uneasy. No gore: the dead are grey, slow and wrong, and fall like anyone knocked out.

## 2. The city

- **Nine districts**, one of each kind, in a 3 × 3 grid: the **suburbs** (the start, always a corner),
  **downtown** (always the middle), the **industrial quarter**, the **hospital quarter**, the **docks**
  (on the sea, on the city's edge), **parkland**, the **market quarter**, the **police precinct** and
  the **metro hub**. The three districts a way out starts from (hospital, docks, metro) are never
  beside the start.
- **Each district is its own 64 × 64 map**, as every prison is, so the same world, paths, sight and
  view take it. Streets run on three lanes each way, shared by every district in a column or row of the
  grid: a street that crosses a border meets the neighbour's at the same tiles.
- **Borders.** Between districts, the army's sector fence, open only at **checkpoints** where a street
  crosses (one or two per joined border). About one border in six is sealed, never so that a district
  is cut off. Round the city, the **quarantine wall**; on the docks' outer side, the sea and its piers.
- **Blocks** between the streets are filled by the district's kind: houses with gardens, shops,
  offices, warehouses, clinics, garages, car parks, greens, squares and yards, and one **landmark** in
  the largest block (the filling station, the office tower, the factory, the hospital, the boathouse,
  the rangers' lodge, the mall, the police station, the metro station). Buildings have rooms, doors
  and furniture to search.
- **Generated afresh for each new city** from a seed; the same seed gives the same city on every
  device. A validator proves on many seeds that every tile, door and checkpoint can be walked to, and
  from stage 3 a bot proves every way out can be won.
- **The map.** A corner map shows the tiles round the player as seen so far; `M` (or the corner map)
  opens the whole city: nine districts filling in as they are walked, the checkpoints between them,
  the landmarks by colour, markers for shelters and quests from stage 2.

## 3. The loop

One game day is 24 real minutes (a game minute a second, as in the prisons).

1. **Dawn to dusk: scavenge.** Search homes, shops, cars and bins for food, water, parts and notes.
   Outdoors by day the dead are few and slow. The best loot is where they wait: unlit interiors, the
   mall's back rooms, the hospital's wards, the metro.
2. **Dusk: get home.** A warning at 19:00 and at 20:30. Reach a **shelter** (a building the player has
   claimed: its doors barred, a bed, a fire barrel, a workbench, a stash), cook, craft, repair, sleep.
3. **Night (21:00 to 05:00): hold out, or dare.** The dead come out everywhere and in growing numbers
   each night. Light keeps them back (a lit fire barrel, a lamp, a generator burning fuel); noise
   draws them. Sleep passes the night fast if the shelter holds; a breach wakes the player. Some
   things can only be done at night (the radio's best reception, a quest or two).
4. **Each day, further.** Every district holds one thing the story needs; harder districts lie
   further from the start, and the nights there are worse.

**What pulls the player on:** hunger (stay and starve), the growing nights (stay and be overrun), and
the radio's next instruction.

## 4. The rules

### 4.1 The meters
- **Health** (0–100, more with Strength as in the prisons): lost to bites, blows, starving and falls;
  back from bandages, a meal's slow tick and sleep.
- **Hunger** (0–100, full at 100): falls all day, faster when running or fighting. Under 25 the
  player slows; at 0 health drains. Food restores it by what it is (a tin 30, a cooked meal 50).
- **Energy** (0–100): spent by blows, sprinting, barricading; back from rest, sleep and food. An
  empty bar hits weakly, as in the prisons.
- **Light** is not a meter but a state the HUD shows: lit, dim or dark where the player stands.

### 4.2 The dead
- **Shamblers** (most of them): slow (two thirds of a walk), see 4 tiles in the dark and 7 in light,
  hear noise from far, lose interest out of sight. Dangerous in numbers.
- **Runners** (from night 3): as fast as the player, rarer, weaker.
- **Brutes** (from night 5, one per hard district): slow, strong, break barricades.
- **Where they are.** By day: only in the dark (unlit interiors, the metro, sewers) and a few
  stragglers in the open. At dusk they wake; at night they spawn at the dark places and roam toward
  noise and light they can reach. At dawn those outdoors go to ground again.
- **How they hurt.** A grab, then bites while held: breaking free costs energy. No infection meter
  in the first version (a bite bleeds: health ticks down until bandaged).
- **How they fall.** Blows as in the prisons' fights (`combat.ts`'s formulas): a knocked-down one
  stays down a while unless finished (a second blow to the downed, a blade, fire).

### 4.3 Noise and light
- Running, breaking a window, a fight, a crash: each makes noise with a reach in tiles (the prisons'
  noise events). A thrown bottle or a set alarm draws the dead to where it lands.
- A lit tile is one within a light's reach (a fire barrel 4 tiles, a lamp 3, a generator's lamps a
  whole room). The dead will not stand in strong light unless chasing.

### 4.4 Shelters
Any building with a bed can be claimed once cleared: bar its doors (planks: a recipe), light it, stash
loot in it. One shelter is **home** at a time (where a Survivor wakes). Survivors' shelters (stage 3)
are safe by nature and trade.

### 4.5 Items and crafting
The prisons' pockets, hand, containers and crafting screen carry over (six pockets, a weapon and an
outfit slot), with the city's own items and recipes kept apart from the prisons' lists.
- **Food and water:** tins, dried food, bottled water, garden vegetables, fish at the docks; cooked on
  a fire for more.
- **Weapons, crafted and wearing out:** the pipe, the nailed bat, the pipe spear (reach), the
  cleaver, the crossbow and bolts (quiet, ranged), the molotov (fire, noise), the noise lure.
- **Tools:** the crowbar (locked doors, crates), bolt cutters (fences: shortcuts between blocks), a
  torch and batteries, planks and nails (barricades), bandages, a fuel can.
- **Parts for the ways out** (§5), one or two per district.
- **Loot by place:** a house's kitchen has food, a garage tools, a clinic bandages, the police
  station the armoury (a locked door: its key is a quest).

### 4.6 Death
- **Survivor:** the player wakes at home the next morning, health and hunger low. What they carried
  lies where they fell, to fetch back; the night's horde has grown by a night.
- **Hardcore:** the city is lost; a new one is generated.

Chosen when the city is made; shown on the pause card.

## 5. The story and the ways out

A hand-cranked **radio** in the first shelter carries a voice: **Dispatch**, the last operator of the
city's emergency line, somewhere she will not say. She gives the acts their goals and comments on what
the player does. Notes, logs and signs found in the districts tell the rest: what the quarantine was,
why the checkpoints, what happened to the other five from the bus.

| Act | Goal | Where |
|---|---|---|
| 1. Climb out | Find food and a place to sleep; find the radio | The suburbs |
| 2. A voice | Crank the radio; fetch what Dispatch asks (batteries, an aerial) | Two neighbouring districts |
| 3. Three chances | Dispatch names three ways out; scout each | Hospital, docks, metro |
| 4. The parts | Gather what the chosen way needs, across the city | Every district |
| 5. The last night | Hold the place until the way out is ready, then go | The chosen district |

**The ways out** (each a different last night):
1. **The helicopter** from the hospital's pad: a radio beacon (the office tower), aviation fuel (the
   industrial quarter), a flare gun (the police armoury). The last night: hold the pad till dawn.
2. **The boat** at the docks: an engine part (the factory), fuel, a tide chart (the rangers' lodge).
   The last night: get to the pier through the fog; quiet beats strong.
3. **The metro tunnel** under the wall: a generator part (the mall), a key card (the precinct), a
   torch that lasts. The last night: the darkest place in the city, on foot.

**Survivors** hold a shelter in three or four districts (the mechanic in the garage, the nurse, the
ranger, the fence in the market). Each gives two or three errands for recipes, trade and a line of the
story. One of them is another prisoner from the bus.

**The end card** says which way out, how many days, what was left behind, and what Dispatch says last.

## 6. Controls and screens

As the prison game: the stick or the keys, a tap to walk, a gamepad; the action button for what is in
reach (search, open, bar a door, pick up, attack when a weapon is in hand and something is close).
`M` the map, the pockets and crafting as the prisons' panels, the pause card (saved as it opens).
Phone portrait and landscape and desktop, English and French, from the first stage.

## 7. What it shares with the prison game, and what it keeps apart

| Shared, as it is | The city's own | Never touched by it |
|---|---|---|
| The 64 × 64 tile world (`World`), walking, paths, sight | The simulation (`src/city/sim/`), the generator (`src/city/gen/`) | The prisons' `Sim`, its routine, guards, heat, jobs |
| Commands (`sim/command.ts`), the autopilot, the RNG | Its content (`src/city/content/`): districts, items, recipes, quests | The prisons' saves, logs, replays, records, medals |
| The 3D view, the characters, the model kit, textures, the camera | Its pieces in the picture (`src/city/render/`) | The escape bots' snapshots |
| Input (keys, touch, pad), sound, settings, the player's prisoner | Its HUD, map and screens (`src/city/ui/`), its stylesheet | The prisons' achievements and stats (the city gets its own) |
| Storage (`game/storage.ts`), the text tables (`city.*` keys) | Its save slot (`pe3d.city.save`), its tests (`scripts/city*test.ts`) | |

The city's code is one lazily fetched part (`play/lazy.ts`): the prison game loads none of it.
