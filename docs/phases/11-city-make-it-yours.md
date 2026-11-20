# City Escape, stage C5: Make it yours (v2.66 on)

The user's request (2026-11-20): "Players who have tested the game tell me that there isn't enough
interaction within the city; it's too linear, and they get bored very quickly. They would like more
interaction with the city's environment—such as the ability to destroy objects—as well as more crafting
options and a greater variety of items. They want a stronger sense of survival and the freedom to build
things like furniture and walls, allowing them to establish a base to defend against zombie attacks."
Then, on Claude's first proposal: "elaborate more before to start coding, extend to add more craft
object and make survival more fun". The design below was approved as proposed ("ok", 2026-11-20).

This file is the stage's design and its roadmap, as [`10-city-escape.md`](10-city-escape.md) was for
C1 to C4 (the mode's own design, [`../source/city_escape_design.md`](../source/city_escape_design.md),
is never edited: a rule that departs from it gets its row in [`../decisions/city.md`](../decisions/city.md)
when it is built). Each batch is a vertical slice (rules, picture, phone and desktop, both languages,
How to play, tests) released at the user's word.

## The user's choices (2026-11-20: every recommended pick)

1. The story stays the main mode; **Holdout**, an endless mode with no story, comes as a second one.
2. **The Rush every third night**, announced: no sleeping through it.
3. **Thirst** a meter of its own.
4. **Everything breaks but outer walls** (a building's outside stays whole: its facade, and no walking
   through every building).
5. **Skills learnt by doing.**
6. **The dog**, in the last batch.
7. **Weather.**
8. **No guns**: the crossbow, the slingshot and what's thrown fill the role.
9. **Batches 1 to 3 first**: breaking, building, the Rush.

## Why: what the testers met (the analysis, 2.65.1)

- One verb carried the game: a search, a moment's wait, and 56 draws in 100 empty. Walls, furniture,
  cars and fences could not be touched (only a chained building's door, its windows and the army's
  fence at a street's end).
- Crafting was a shopping list: 15 recipes, 12 known from the start, each making one thing, no repair
  (a worn weapon is lost), no upgrade, no station to build.
- 39 things in all; clothes only to look at.
- Hunger, energy, health and bleeding; water was food; food was plentiful and never spoiled.
- The only thing built was boards on a street door; nights were slept through at 40 times the pace,
  a boarded house safe but for 2 to 8 chances in 100 an hour from the third night.
- The story's list and arrows led every step; nothing happened in the city unless the player began it.

## What makes it fun: the rules every piece is checked against

1. **Choices, not chores**: meters drain slowly, each fix is a decision; nothing repeated without a reason.
2. **Preparation pays, and shows**: a night's outcome is the base built; a day's work leaves something standing.
3. **Care rewarded, not only neglect punished**: good states give real bonuses; bad ones slow long before they kill.
4. **Something new every day**: weather, an event, a manual, a recipe, a plant come up.
5. **Always a short goal**: the journal suggests two or three (the barrel full, the garden ready, the Rush in two nights, a wall damaged).
6. **Light humour**, as everywhere in the game: the things' descriptions, Dispatch.

## The design

### Breaking and salvage (batch 1)
Furniture, cars, wrecks and inner walls give way to blows: a moment's work standing at it, heard, costing
energy and wear; what was in it falls out with what it is made of, and it is gone for good.

| Piece | Gives | Best tool |
|---|---|---|
| Chair, table, desk, shelf, crate, counter | planks (and nails, or scrap) | axe |
| Bed | planks, cloth | axe |
| Bin, freezer, vending machine | scrap, wire (a drink from the vending machine) | sledgehammer |
| Car, wreck | scrap, wire | sledgehammer |
| Inner wall | a way through | sledgehammer only |

Tools: the **axe** (a weapon with an edge that chops wood fast) and the **sledgehammer** (a heavy
weapon that breaks metal and inner walls). Stations, the story's furniture and survivors' buildings
are not broken. New materials (rope, springs, rubber, charcoal, herbs, seeds, chemicals, a clock, dirty
water) come with the batch that first uses them, never before.

### Building a base (batch 2)
- **A build button** (B; a hammer on touch; a pad button): the pieces affordable, the others greyed with
  what's missing; a see-through piece on the tile faced, green or red with the reason; turned, placed
  (a few seconds' hammering, heard). A **hammer** in the pockets builds (by hand: a plank, scrap, tape).
- **Where**: any floor, pavement, yard, park, car park or street, in any district; not on a checkpoint or
  the two tiles round it, beside a survivor, on the story's tiles, the stairs, a pier's end.
- **Taken down** free, half the materials back; **repaired** a quarter of the materials a quarter of its health.
- **The dead** after someone go round what's built when they can; when they can't, they pound the first piece on
  their way through (2.67: the shortest way, not the weakest piece); brutes four times harder; those wandering go round.
  A limit of 120 pieces a district.
- **A base left**: coming back after nights away, the pieces facing out have taken the nights' harm,
  worked out from the nights, the danger and the lights ("Your base held: 3 pieces damaged").
- **Comfort**: the pieces within six tiles of the bed (bed, fire, table, radio…): Camp, Hideout, Home;
  a Home makes the sleeper Cosy. A lit, noisy base is cosier and found more often.

| Kind | Pieces |
|---|---|
| Walls | barricade (2 planks, nails), plank wall (4 planks, 2 nails), metal wall (4 scrap, 2 nails, wire; 2.67: no workshop needed), built door (opens for the player only); window boards wait for the dead to break windows (batch 3) |
| Traps (batch 3) | spike strip, barbed wire, snare, tin-can alarm, pit, fire line, scarecrow decoy, sentry crossbow, floodlight and electric fence (powered) |
| Living | 2.67: campfire, workbench, camp bed (one tile), chest (12 slots), table, chair, rug; later: workshop kit (batch 4), shelf, rain barrel, planter, smoker, coop (batch 5), lantern post, plant, radio |

Most reuse models the game has (bed, table, chair, shelf, crate, workbench, planter, smoker, generator,
lamp, trough, lantern; the trap, fence and seed shapes).

### Nights (batch 3)
- **Ordinary nights** as now (sleep runs fast); the chance the dead find the sleeper falls on the pieces
  built: a tin-can alarm wakes earlier, walls hold longer than boards; a running generator or a fire in
  the open raises the chance, a dark base lowers it.
- **The Rush**, every third night: Dispatch warns at dawn and dusk, a countdown on the HUD, no sleep from
  21:00 ("Not tonight. Listen."); waves at 22:00, 00:00, 02:00 and 04:00, bigger each Rush and in a worse
  district, brutes from the second, bloaters from the third, after the player wherever they are. Held to
  05:00: a supply crate at dawn near them (materials, food, a manual or armour), better each Rush held.
  Fallen: as now.
- **The three ways out** become a Rush at a place the player fortifies (the hospital's pad, the metro
  station, the pier) before lighting the beacon or the generator.

### Crafting that grows (batch 4)
- **Stations**: by hand; a workbench (found, or built); the workshop (a bench with the vise and toolbox
  kit: armour, spring traps, metal walls, the sentry crossbow); fire (cooking, boiling, charcoal);
  powered (the workshop beside a running generator: floodlight, electric fence).
- **Recipes learnt**: about 25 known from the start; **12 manuals** in fitting places (carpentry in a
  garage, field medicine at the hospital, traps at the rangers', gardening in a shed, fishing at the
  boathouse, armour at the police station…), survivors' teaching and swaps, the supply drops. An unknown
  recipe shows as "?" with a hint of where its manual may lie.
- **Repair** at a bench (tape and scrap or a plank: half a weapon's blows back; cloth and tape for armour).
  **Upgrades**: bat → nailed bat → barbed bat; spear → long spear (two tiles); crossbow → steel crossbow;
  satchel → hiking pack.
- **Weapons**: axe, machete, sledgehammer, barbed bat, long spear, slingshot (scrap shot: quiet, weak, knocks a
  runner down), steel crossbow. **Thrown or set down**: smoke bomb (the dead in its cloud blind 15 s),
  noisemaker (a clock: rings 30 s after it is set, calls from 14 tiles), flare (5 minutes' strong light).
- **Armour** in the outfit slot, worn out by the bites it takes: padded jacket (−25%), sports pads (−20%),
  scrap armour (−45%, a little slower), riot gear (−50%, the armoury), camouflage poncho (seen a tile
  less), raincoat (never soaked). **Bags** in a back slot: satchel +2 pockets, hiking pack +4.

### Survival with weight (batch 5)
- **Thirst**: a full bar lasts about 20 hours awake; under 25 slower, at 0 health lost, as hunger.
- **States**, icons with a timer by the meters. Good: well fed (a cooked meal: health back twice as fast
  6 h), refreshed (tea, coffee, soda: energy drains half 3 h), rested (a full night in a real bed: blows cost
  less all day), cosy (a Home). Bad: queasy (dirty water, raw fish, spoiled food: hunger and thirst
  twice as fast 4 h; tea or pills), soaked (rain without a raincoat, till dried by a fire), thirsty, hungry.
- **Food that runs out, food produced**: furniture's food is finite; the long game is the garden (a
  planter, seeds, watered daily: 2 or 3 in three days), the rain barrel, fishing (a rod at a pier or the
  park's pond, a tug to time), hens (from the ranger; a coop, an egg a day), dirty water (fountains, ponds,
  a toilet tank: "Don't think about it.") boiled or filtered. Fruit, vegetables, fish and eggs spoil; tins,
  jerky, preserves and rations keep.
- **Cooking**: boiled water, herbal tea, roast vegetables, fish soup, omelette, jerky (the smoker),
  preserves; a herbal poultice (stops bleeding).
- **Weather** from the seed, said by Dispatch at dawn: clear, rain (barrels fill, the garden watered, the
  dead hear half as far, soaked), morning fog (everyone sees three tiles), heat (thirst half again as
  fast), storm (thunder covers noise, lightning lights the street).

### A city that doesn't wait (batch 6)
- **Events**, one or two a day from day 2, on the map with a time, all optional: a supply drop, a cry for
  help (a room cleared: a survivor's thanks and a line of the story), a horde crossing a district, a block
  on fire, a crashed army truck (the crowbar: armour, bolts), the fence's runner at the market, a stash's
  note ("under the third bench in the park").
- **Skills by doing**, five levels each: Scavenger (searches faster, more found), Handy (pieces cheaper and
  stronger, repairs), Fighter (less wear, less energy a blow), Survivalist (good states longer, queasy less).
- **Holdout**: no story, the nights worse each time; the score is nights and Rushes held.
- **The dog**: a hungry stray in the parkland, fed twice it follows; it barks at the dead (even at a
  sleeper), digs something up once a day, never fights and can't die (the prisons' dog model).
- **The story**: survivors' errands ask for things made or built (the mechanic wants a rain barrel);
  their swaps sell manuals and seeds; Dispatch remarks on the base ("I hear hammering. Good.").

### Before → after

| | 2.65.1 | After the stage |
|---|---|---|
| Things | 39 | about 85 |
| Recipes | 15 | about 60, and about 25 pieces built |
| What the player does | search, bar a door, force, break a pane, cut, throw, fight | and break, build, repair, plant, fish, fill, cook, set traps |
| Meters and states | 3 meters and bleeding | 4 meters, bleeding, 7 states |

## What holds for every batch

- `CLAUDE.md`'s rules and the `polish-gameplay` skill's City part: the rules deterministic, new state at
  the end and made sound on load, no new draws from `state.rng` on the first day and night, the bots
  measured old against new on two sets of seeds before a moved number is believed.
- **Saves**: a city under way keeps loading. Breaking and building work in every city; what changes what a
  city holds (new loot) comes with `state.rev` 2, for cities begun from then.
- Each batch adds its own test (`city<part>test`) and a bot proof that its part can be won; How to play's
  City topics and pictures; the phone sizes; a phone's speed measured where the batch draws more.

## The batches

| # | Batch | Version | State |
|---|---|---|---|
| 1 | Breaking and salvage: furniture, cars, wrecks, inner walls; the axe and the sledgehammer | 2.66.0 | built, merged, not released |
| 2 | Building: the build mode, walls, doors, chest, bed, workbench, campfire; repair; comfort; the hammer | 2.67.0 | built, not released |
| 3 | The Rush; traps and defences; a base left takes the nights' harm | | |
| 4 | Manuals, upgrades, repair, armour, bags, the smoke bomb, the noisemaker, the flare | | |
| 5 | Thirst, states, cooking, garden, rain barrel, fishing, hens, weather | | |
| 6 | Events, skills, Holdout, the dog | | |
