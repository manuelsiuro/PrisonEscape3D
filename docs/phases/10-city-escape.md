# City Escape (v2.46 on)

A second game mode beside the prisons: a generated post-apocalyptic city to survive and escape. The
user's request (2026-11-13), their choices and the design are in
[`../source/city_escape_design.md`](../source/city_escape_design.md); where the build departs from it,
[`../decisions/city.md`](../decisions/city.md). This file is the roadmap: four stages, each a vertical
slice (rules, picture, phone and desktop screens, both languages, tests) released as usual, the menu
entry shown only with `?city` in the address until the last one (the user's choice): since 2.49.0 it is shown to everyone.

## How it fits the code

The manhunt (P41) is the precedent: a deterministic simulation of its own on a map made in code,
sharing the engine and none of the prisons' rules. City Escape goes one step further: no prison game
is in progress while it runs.

```
src/city/
  id.ts               isCity(def): the view's one question about a city's world (no city code comes with it)
  save.ts             the city's save slot and whether the mode shows on the title (read by the title: no city code)
  content/            data: districts.ts (kinds, names, blocks), items.ts (the city's own things), loot.ts (what's
                      found where), dead.ts (the dead's numbers), recipes.ts, story.ts (the story's things, the
                      ways out, Dispatch's lines by name, its numbers), people.ts (the survivors, their errands and swaps)
  gen/                the generator, pure: plan.ts (the 3 × 3 plan from a seed), district.ts (one 64 × 64 district)
  sim/                the rules, deterministic as src/sim: City.ts (step(cmd), events, snapshot: walking, the
                      meters, pockets, boxes, sleep, death, making, barred doors), dead.ts (the dead and the
                      player's blow), story.ts (where the story's things lie, the acts and their objectives, the
                      ways out and their last nights), world.ts (a district's World)
  render/             CityView: what the World doesn't draw (wrecks, the bus, trees, the roofs past the fences,
                      the dead, boards on barred doors, the player's light after dark, the story's marks)
  ui/                 its HUD, the map's painter, pockets.ts (pockets, a thing's card, the box, the Make panel,
                      the action and hit buttons), its screens (new city, the story card, the city's map, the
                      journal, both ends), story.ts (an objective in words)
  play/               city.ts (the run: steps, frame, keys, taps, pause, save), flow.ts (from the title)
  record.ts           the ways out taken and the feats, in a slot of their own (read by the city's menu)
src/styles/46-city.css
scripts/citygentest.ts, citytest.ts, citysurvivetest.ts, cityzedtest.ts, citymaketest.ts, citystorytest.ts, citylandmarktest.ts, citymusictest.ts, citylighttest.ts;
citybots.ts (the scavenger, the quester)
```

**The seams in the shared code** (each a few lines, none changing a prison's behaviour):
- `play/game.ts`: `play.side`, a `SideRun` (frame, key, tap, paused): a mode of its own in place of a
  game. `play/loop.ts`, `play/keys.ts`, `play/guide.ts` and `play/pad.ts` hand it the frame, the
  keys, the taps and the pad when it is set.
- `play/lazy.ts`: `cityFlow()`, the city's part fetched when first opened; `main.ts` holds its place
  on the page.
- `flows/title.ts`, `ui/screens/title.ts`: the `city` choice and its button (only where `cityOn()`).
- `play/pad.ts`: in a city, Y is the journal's key and LB the Make panel's (2.48).
- `game/storage.ts`: `KEYS.citySave` and `KEYS.cityRecord` (2.48), both wiped by Reset progress with the rest.
- `render/ground.ts`, `render/WorldView.ts`: for a city's world, no ring road line, no ring of trees,
  duller ground past the edge.
- `render/itemIcons.ts`: `photos`, the icon studio for things that aren't the prisons' items (2.47).
- `World` is used as it is, through a definition with no cells, guards, jobs or zones
  (`city/sim/world.ts`), what stands on the streets set in `parked` and `veil` as the manhunt does.

**Rules that hold for every stage**
- `src/city/sim/` and `src/city/gen/` follow the simulation's rules (`CLAUDE.md`): fixed 20 Hz steps,
  whole-number positions, no `Math.random`, `Date` or DOM; every input a packed command; new state
  fields at the end, optional on load.
- Nothing is added to `PRISONS`, `ITEMS`, `RECIPES`, `ZONES` or the prisons' state: the escape bots
  stay byte-identical (`escapetest`'s snapshot is the proof at each stage).
- The city's own items and recipes live in `src/city/content/`, and its pockets are its own (a `Stack`:
  an item and a count): the prisons' `ItemState` and `craft` are not used (`decisions/city.md`).
- `City.peace` switches the dead off for tests of everything else; it is never set in play.

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
- **Not in it at 2.46.0:** hunger, loot, the dead, shelters (all C2, below), quests and the ways out
  (C3); death's two modes were chosen and stored, and nothing killed yet.

### C2. Survival

In three slices, each a release.

**C2a. Scavenging (v2.47.0): built.**
- **The meters** (`sim/City.ts`): health (0–100), hunger and energy (kept in thousandths). Awake, a
  full stomach lasts about 30 hours and energy about 18; asleep, hunger falls at half the pace and
  energy comes back. At no hunger, a point of health every three minutes; over half fed, health
  mends. Under a quarter fed, or worn out, the walk is slower.
- **The city's things** (`content/items.ts`): 26 of its own (food and drink, a bandage and
  painkillers, materials, three tools, two weapons whose blows come with C2b), drawn with the item
  models' shapes. Nothing added to the prisons' items.
- **Loot** (`content/loot.ts`): desks, shelves, counters, bins, freezers, crates, workbenches,
  vending machines, beds and tables are searched: one to three draws from the building's list plus
  the furniture's own, 56 in 100 coming up empty, the same for a city's seed, district and piece. A
  first search takes a second and a half; what's put back stays.
- **Pockets:** eight, things of a kind stacking (food 3, materials 4); Eat or Use, Store in the open
  box, Drop (a pile on the ground, looked at like a box).
- **Sleep:** in any bed already searched, from 20:00 or when tired, to 06:00 (the night runs 40 times
  as fast), woken by a move, by hunger, or rested by day; the last bed slept in is **home**.
- **Death:** a Survivor wakes at home the next morning with 40 health, what they carried in a pile
  where they fell; in Hardcore the city is lost (the end's card, the save gone).
- **On screen:** three meters under the HUD's row, the pockets along the bottom (a tap or 1–8: the
  thing's card), the open box's panel, the action button (Search, Look, Sleep, Close; a search's
  ring), the floor's brackets round what it would use, toasts.
- **Proved:** `citysurvivetest`: a scavenger bot (`scripts/citybots.ts`) lives a week on 10 cities
  without falling or starving; the rules one by one; saves (one from C1 loads, the meters fresh).

**C2b. The dead (v2.47.0, with C2a): built.**
- **Who's about** (`sim/dead.ts`, numbers in `content/dead.ts`): shamblers, in the district the
  player is in only, put down afresh each time it's entered (never within ten tiles). By day they
  stand indoors (three, two more a step of a district's danger, one more a day up to six) and the
  danger's worth wander the streets; at 21:00 those indoors come out and more arrive one every 20
  minutes up to the night's count (six, three more a step of danger, two more a night up to
  sixteen); at 05:00 those in the streets go to ground. A district's danger is its distance from the
  start in districts, one more where a way out begins.
- **Sight and noise:** six tiles by day, four at night, two for a sleeper, with a clear line (never
  through a wall); out of sight six seconds, one goes to where it saw the player last. A blow is heard
  seven tiles off, a search's rustle four: those not already chasing go and look.
- **The chase and the bite:** two thirds of the player's walk; in reach it lunges nine steps, then
  bites (8 health) every 24; struck, it reels, is pushed back and starts its lunge again, so one alone
  can be fought off clean and two or three can't. A bite wakes a sleeper.
- **The blow** (Space, its button, a pad's X): the nearest ahead in reach; fists 6, a weapon twice its
  `attack` more (a bat puts one down in two); a little energy each, half the harm when worn out.
- **On screen:** the dead as one instanced body with its own gait (`render/CityView.ts`), their eyes
  lit and a faint pool of light round the player after dark; "n after you" in the HUD; the screen's
  edges red at a bite; dusk's two warnings (19:00, 20:30), night and dawn said.
- **Bodies:** nobody walks through the dead, and a chasing pack keeps in file.
- **Proved:** `cityzedtest` (the counts, sight, the chase, the lunge, the blow, noise, bodies,
  nightfall and dawn, the same commands the same dead, saves); `citysurvivetest`'s scavenger, which
  fights what comes in reach and never hides, falls 1.3 times a week on 10 cities; an independent
  review's nine findings fixed, each with its check.

**C2c. Shelters and making (v2.47.0, with C2a and C2b): built.**
- **Making** (`content/recipes.ts`, `COP.MAKE`): eight recipes, all known from the start, made from
  the pockets (C, or the pockets' Make button): a bandage, boards, the nailed bat; at a workbench
  beside the player, the pipe spear, a knife and the camp stove; with a stove carried, cooked fish and
  stew. Refused without the parts, the bench or the stove; what doesn't fit the pockets lies underfoot.
- **Wear:** a weapon's count in its pocket is the blows left in it (a bat 40, a knife 30, the nailed
  bat 50, the spear 35): one fewer each time it lands, broken at none; found, it has half to all.
- **Barring doors:** with boards in the pockets (or at a barred door), the action at a building's
  street door bars it or takes the boards down, two seconds' work heard as a blow is. The player
  walks through their own barred door; the dead don't (`City.zedGrid`), and none are put down inside.
- **A shelter** is a building whose every street door is barred: said when the last one goes up,
  shown as the place in the HUD. Home is still the last bed slept in, marked on the city's map.
- **On screen:** the Make panel (each recipe, what it takes, what's short ringed, what it needs
  beside), a weapon's bar in its pocket, boards across barred doors, Bar and Unbar on the button.
- **Proved:** `citymaketest`: every recipe; wear; a door barred and opened; a first night asleep in a
  house on 12 cities, bitten in none with its doors barred, woken by a bite in 3 with them open.
- **Left for later:** light and fire (a torch, a fire barrel, a generator), a stash's own screen,
  cars searched, the weapons thrown or shot.

### C3. The story and the ways out

In two slices.

**C3a. The radio, the acts, the ways out (v2.48.0): built.**
- **The kit** (`content/story.ts`, `sim/story.ts`): eleven things the story needs (the radio, its
  aerial, three for each way out), each hidden in one piece of furniture chosen from the city's seed
  (the radio in the nearest house to the start with a bed, the aerial in the landmark next door, the
  rest in the landmarks of six districts), found when that piece is first searched. Never in the
  pockets, kept through a fall. Ten **notes** lie the same way, one to a district and one more.
- **The acts:** 1, eat, sleep, find the radio; 2, the aerial and two batteries (taken from the
  pockets as soon as all three are in hand: the radio works); 3, the three ways out seen for oneself
  (walking into the hospital, the boathouse, the metro station, at any time) and one **chosen in the
  journal** (`COP.CHOOSE`; another may be chosen until one is set going); 4, its three things; 5, the
  last night.
- **Dispatch** speaks once the radio is found: a line for each thing found, each way out seen and
  chosen, the first night, a first shelter, a fall, each way out set going and taken (`BEATS`; heard
  lines are kept in order for the journal).
- **The ways out**, each set going from a tile of its landmark (the action button there, refused
  without its three things):
  - **The helicopter** (the hospital): the beacon lit **after dark only**; the helicopter comes 120
    game minutes later, to whoever is in the hospital then. Meanwhile the night's count of the dead
    and eight more, one arriving every five minutes and making for whoever lit it, and a barred door
    torn open every twenty minutes anywhere in the district (the building stood in first). Leaving the district, or falling, puts it out.
  - **The metro tunnel** (the station): the generator started at any hour; the gates open 90 minutes
    later, and the button takes the tunnel. The same count of the dead by day too, every other one
    coming up inside the station whatever its doors, boards torn off as for the beacon. Leaving the district, or falling, stops it.
  - **The boat** (the docks): the engine fitted at any hour and left fitted; the boat taken from the
    pier's end between 23:00 and 02:00. On those nights the docks are in fog: the dead see two tiles,
    hear twice as far, and are eight more.
- **On screen:** the journal (J, or the goal's line under the meters: the act's list, the ways out
  with what each takes and its Choose button, what Dispatch has said, the notes), Dispatch's bubble
  under the HUD, a diamond on the corner map (at its edge when the place is further off, or the
  checkpoint on the way), on the city's map and turning over the tile in the world, the way out on
  the action button, banners for an act and a way out set going, the end card (the way, the day, the
  dead put down, falls, notes, Dispatch's last line). A pad: Y the journal, LB the Make panel.
- **Proved:** `citystorytest`: on 60 cities every thing and note in furniture of its own that can be
  stood beside, every way out's tile open floor, a pier at the docks; the acts and each refusal; each
  last night's rules; a fall and a save; `quester`, a bot following the journal, leaves by each way
  on 4 cities with the dead away (12 of 12, by day 5 on average); the two holds alone with the dead
  about, a bat and three bandages (6 of 6 and 5 of 6); its whole runs with the dead about are told,
  not required. An independent review's ten findings fixed, each with its check.

**C3b. Survivors and the rest (v2.48.0, with C3a): built.**
- **Four survivors** (`content/people.ts`): the fence in the mall (the third name on the bus's list),
  the nurse in a clinic (the hospital where the city has none), the mechanic in a garage (or the
  factory), the ranger in the lodge. Each stands on a tile of the building they hold (it blocks
  walking; nothing is cut off by it; none of the dead are put down in that building). Dispatch names
  them once the radio works: they are in the journal and on the map from then.
- **Errands:** the action beside one meets them (their first errand is asked) and after that is a
  word; the open errand is handed over by their card's button (`COP.GIVE`) once its things are in the
  pockets, or enough of the dead were put down since it was asked, and is paid (what doesn't fit
  lies underfoot, said). Two each. The fence's first pays **the police armoury's key**: without it the flare gun
  and the gate key card are seen and not taken (the list sends the player to him first). The others'
  first teach a recipe: the medkit, the cleaver, the trail ration (eleven recipes; three shown locked
  in the Make panel with who can show them).
- **Swaps:** three each, as often as wanted, beside them (`COP.TRADE`).
- **Runners and brutes** (`content/dead.ts`, `sim/dead.ts`), at night only: from the third night one
  arrival in eight is a runner (as fast as a tired player, 16 health, a bite of 6); from the fifth, a
  district two or more steps of danger has one brute a night (90 health, a bite of 14, hardly shoved)
  that takes a barred door in its way for open and pounds it down in 80 steps. No draw is made before the
  third night: the first two play as they did.
- **Records** (`record.ts`, `pe3d.city.record`, wiped by Reset progress): the ways out taken, the
  quickest day, ten feats (each way, all three, Hardcore, by day 6, every note, every errand, never
  down, 40 put down), written when a city is left; on the end card and from the city's menu.
- **On screen:** the survivor's card (what they say, the errand and what it pays, Hand it over, the
  swaps), Talk on the action button, the survivors in the world in their own colours, the journal's
  People, dots on the city's map, the records' screen; runners slight and pale, brutes big and dark.
- **Proved:** `citystorytest`: on 60 cities each survivor in a building of theirs cutting nothing
  off; the errands, the key's gate, the taught recipe, the swaps, none of the dead in their
  buildings, a save; the kinds by night (none before the third, one brute from the fifth), a brute
  through a barred door and a shambler not; the records. `quester` fetches the key: out by each way
  on 4 cities (12 of 12, by day 5 or 6 on average). An independent review's nine findings fixed, each
  with its check.
- **Left for C4:** the survivors' own model (they are the dead's body, straight and coloured),
  sounds of their own for runners and brutes.

### C4. The finish (v2.49.0): built

- **How to play:** a tab of its own, City (`ui/screens/helpTopics.ts`): ten topics in two groups
  (the sealed city, searching and eating, the dead, hitting back, boards and beds, making; the radio
  and the journal, the three ways out, the living, the city's keys and buttons), nine with a picture
  (`public/help/city*.webp`, each staged by `scripts/dev/cityshot.ts`), every number checked against
  the rules. The city's
  own pause and H open on it.
- **First steps:** seven tips said once each, at the moment they matter (the first search, the first
  food, weapon, planks or nails, the first of the dead to see the player, the first dusk, the radio
  found). There is no lesson of its own: the first act's list and these do the teaching.
- **Sounds:** the dead's moan, a runner's screech, a brute's roar and its blows on a barred door
  (a `pound` event), the radio's crackle before each of Dispatch's lines.
- **The look:** the survivors' own models (the fence in the bus's orange, the nurse in scrubs and a
  cap with its cross, the mechanic in overalls, the ranger in a brimmed hat); an awning over every
  street door in the colour of what the building is (a landmark's wider, with a white band); weeds
  through the paving and litter on the roads. All in the district's one mesh: no draw call more.
- **The passes:** French on screen at 412 × 915 (the journal, the help; five tabs fit), a pretend pad
  (Y the journal, LB the Make panel, View the map, B closing each), the title with its new entry at
  915 × 412 and 412 × 915, an independent review (ten findings, none in the rules; fixed).
- **Shown to everyone:** `cityOn()` is true; the "in the making" note is gone from the new city's card.
- **Left, parked in `BACKLOG.md`:** cars searched, a real phone's speed, a real pad and touch by hand.
- **After the four stages (2.50): the landmarks' own models.** Each landmark told at a glance (a coping
  in its colour, a pictogram sign, its own corner pieces) and the ways out as things to look at (the
  helipad, the beacon and the helicopter coming in; the boat at the pier's end; the grille over the
  metro's stairs). Render only: `city/render/landmarkPlan.ts` says where, `landmarks.ts` builds them;
  `citylandmarktest` proves the places on 24 cities.
- **Music of its own (2.51).** `audio/cityScore.ts`: E Phrygian, five moods (day, night, shelter, chase,
  the last stand); `city/music.ts` picks one each frame from what is happening; `citymusictest` proves
  every pitch is of the scale and walks the picking rule. Nobody has listened to it yet.
- **Light and fire (2.52).** `content/light.ts`, `sim/light.ts`: a fire barrel, a lantern (a twelfth
  recipe), a generator, the torch, all lit from the pockets; `City.lit` is the tiles in strong light,
  which the dead that aren't chasing keep out of (a brute and the last stand's called ones aside). The
  dead's side of it is in `dead.ts` behind `City.anyLight`: a city with nothing burning plays as before.
  `citylighttest` proves each light and the night beside a lantern; the help's `cityLight`.
- **Interiors dark by day (2.53).** `sim/light.ts`'s `dayDark` fills `City.dim` when a district is
  entered (never saved): a building's floor more than three tiles' walk from a street door, homes and
  survivors' buildings aside. There the player is in the dark by day (`murky`, `lightLevel`), seen at
  the night's four tiles; `zedPlaces.deep` is where the day's dead indoors are put down. The view lays
  a gloom over those tiles and draws the dead in it as it does at night. `citylighttest`'s last part.

## Proof, stage by stage

| Stage | Version | Tests added | Moved snapshots | Played in the browser |
|---|---|---|---|---|
| C4 | 2.49.0 | none (`helptest` takes the nine topics) | `helptest` (79 topics, 60 pictures), `i18ntest`, `docstest` counts; the city's tests unmoved | 1143×836: a new city, the first tip, weeds, litter, an awning; 1040×480: the nine pictures; 412×915 in French: the journal, the help's City tab and a topic; a pretend pad; the title at 915×412 and 412×915 |
| C3b | 2.48.0 | (in `citystorytest`) | `citysurvivetest` (runners and brutes from the third night: the scavenger falls 2.2 times a week, from 1.8), `citymaketest` (eleven recipes), `cityzedtest`, `citytest` (fingerprints), `i18ntest`, `tokentest` (a colour), `docstest` counts | 915×412: the fence met, his card with Hand it over, the key had, a swap, the Make panel's three locked rows, the journal's People |
| C3a | 2.48.0 | `citystorytest` (`quester` in `citybots.ts`) | `citytest`, `citysurvivetest`, `cityzedtest` (the state's fingerprints only: its new fields; every count as before), `i18ntest`, `docstest` counts | 915×412: a new city, the radio found and Dispatch's line, the journal in act 3, the helicopter chosen there, the beacon lit at the hospital at night, the end card; 500×878: the goal's line, the bubble, the corner map's marks |
| C2c | 2.47.0 | `citymaketest` | `citysurvivetest` (weapons wear: 1.8 falls a week), `cityzedtest`, `citytest` (the state's fingerprints), `i18ntest`, `tokentest`, `docstest` counts | desktop: the Make panel, boards made twice, a house's door barred, the shelter said and shown, the boards on the door |
| C2b | 2.47.0 | `cityzedtest` | `citysurvivetest` (the week with the dead about), `i18ntest`, `tokentest`, `docstest` counts | desktop: one of the dead indoors unseen through its wall, seen and chasing, put down with fists, nightfall's banner, their eyes and the player's light at night |
| C2a | 2.47.0 | `citysurvivetest` (`citybots.ts`) | `citytest` (the state's fingerprints: its new fields), `i18ntest`, `docstest` counts | desktop: a new city, searches, Take all, a thing's card, eating, a bed refused by day, sleep and waking, a Survivor's fall; 412×915 and 915×412: the pockets, the box, the card |
| C1 | 2.46.0 | `citygentest`, `citytest` | `docstest` counts, `tokentest` (a stylesheet), `i18ntest` (keys) | desktop, 412×915, 915×412: new city, the Intake, the story card, walking, three checkpoints, the map, Continue |
