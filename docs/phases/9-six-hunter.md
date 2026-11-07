# The Six Hunter (v2.36)

A sixth prison past the campaign's five, asked for by the user on 2026-11-07 ("When all sessions are
completed you should create a new prison 'The six hunter' with new items, jobs and so on, be fun and
creatif to add an amazing new level prison"). The user was not available for questions: every choice
below is Claude's pick (the user's goal of 2026-11-07: the sessions run on their own), recorded in
`POLISH.md`'s row. Built by a team in three parts: **the core** (this file's first part: the prison,
its rules, its text and the proofs), **the look** and **the player-facing finish** (what they still owe is
the checklist at the end).

## The prison as built

**Premise.** A coaching inn on a private hunting estate in a northern pine valley, named for its painted
sign of six riders; the state bought the estate and kept the name. The warden, **Master Thursby**, the
Master of the Hunt, runs it with exactly **six Hunters**, each with a hound. The Six keep a tally of who
brought back which runner; the PA calls the inmates "hares".

**Place in the campaign.** `difficulty: 6` ("hunting grounds", `security.6`), after Irongate in `PRISONS`
(opened by escaping Irongate, `campaign.ts` as it is). Out of the Daily: its rhythm draws levels 1–5, so
no past or future Daily changes (`dailytest`: the Six Hunter never comes up). `theme: 'forest'`.

**The map** (`src/content/prisons/six-hunter/`, 64×64):
- **The Hollowrun** (`~`) bends round the north and the east beyond the **electric deer fence** (`%`); the
  **fieldstone wall** (`@`, no tool chips it) west and south, the road beyond; a hunting stand (`T`) at each
  corner; the **hunting grounds** (pines in the decor) between the wall and the lodge, Larch's night round.
- **North:** the cell wing (seven cells north of the hall, five south with the vestibule down to the yard in
  the middle, solitary at the east end); the **boathouse** on the fence line, its red river door, the jetty
  (`P`) out into the river; the passage; the generator room with the vents' ladder.
- **Middle:** the yard (roll call in two rows of six) with the **garden** fenced at its west end; the kitchen;
  the **Trophy Hall** (the canteen: four tables, the menu board, vending machine, cooler, stage, the odd jobs
  board, the tally board by the door).
- **South of the main corridor:** gym, showers, library (kiosk, quiz, librarian), the **gatehouse** (visiting
  counter, the parole board, the release desk), infirmary, laundry, **smokehouse**, **kennels** (open to their
  run, the six kennels in it); the sports ground (pitch, track, hoop), the drive down to the gate (the
  outfitter's truck, the checkpoint), the Hunters' quarters.
- **Underground** (`Lm1`): a granite ledge under the north-west corner; any tunnel under the river floods.
- **Vents** (`L1`): the player's cell grate along the hall to the generator room's ladder; a grate into the
  passage.

**The Six** (`guards`, each with a `dog`; coats: two new, `foxhound` and `bloodhound`):

| Hunter | Ways | Key | Hound | Duties |
|---|---|---|---|---|
| Garrow, the Huntmaster | steady | red | Duchess (bloodhound, nights) | roll call, bed checks, the **recall horn** (`kit`) |
| Fell | strict | yellow | Rascal (foxhound) | showers, the shakedown, release forms |
| Bracken | lazy (naps on the yard bench) | green | Pudding (retriever, nights) | exercise |
| Harrow | corrupt | cyan | Tinker (collie) | meals |
| Larch | steady | purple | Brutus (mastiff, nights) | the work rooms; at night the hunting grounds |
| Quiller | steady | cyan | Smudge (shepherd) | the delivery |

No riot guards, no helipad, **no takeover route** (six Hunters and their hounds; the takeover bots are the
most fragile: v1.5.2). Hounds work from prison day 2, as everywhere (`DOG_FIRST_DAY`).

**Jobs** (`content/jobs.ts`, zones `kennels`, `smokehouse`, `boathouse` appended):
- **Kennel hand** (Int 20, $35, the player's at the start): feed bin → `trough` → bowl bin. The day's quota
  done, **every hound is fed from the player's hands**: +10 trust (`KENNEL_TRUST`), never past 40 from the troughs
  (`KENNEL_TRUST_CAP`, below the 60 that lets contraband by): the pack stays a threat, and jerky or a trout thrown
  still wins a hound over (a friend in about three days on top). A quota missed, every hound's trust fades by 15
  (`KENNEL_FADE`). (2.36 review: it gave jerky's +20 a day before, and the pack was a friend for good by day 5.)
- **Smokehouse** (Int 40, $50): freezer → `smoker` → counter.
- **Net mender** (Int 50, $55, open): torn nets → `netFrame` → mended bin, by the river door.
- Also the kitchen, laundry and gardener.

**Items** (appended; found only here, in the new tables `kennelBin`, `smokehouseFreezer`, `boathouseBin`):

| Item | From | What it does |
|---|---|---|
| Pine tar, fishing net, aniseed, shed antler | the boathouse's, smokehouse's, kennels' bins | ingredients |
| Smoked trout | the smokehouse's freezer | food (+20 energy); thrown to a hound, jerky's trust |
| Drag line | sock + aniseed (Int 30) | thrown: the trail washed out, and only the Hunters whose hound is on shift, in earshot, are pulled to it (`DRAG_NOISE`); spent either way |
| Tar soap | soap + pine tar (Int 20) | washes the scent, twice |
| Ghillie cloak | net + bed sheet + pine tar (Int 50) | worn: no trail laid on open ground; other clothes in the manhunt |
| Antler pick | antler + tool handle + duct tape (Int 40) | digs; bone, heard as far as plastic (a tile less than a light shovel, two less than a sturdy one) |
| Recall horn | the Huntmaster's belt | blown: every hound home to its kennel for an hour of game time (`RECALL_STEPS`, `state.recall`); the Hunters within 12 walking tiles hear it, a bang's noise (`HORN_NOISE`) |

Every new recipe needs something found only here, so no other prison's handbook, tips or Intellect marks
move (`sixhuntertest`). The day: fog 40, clear 25, rain 25, storm 10, the west wind; the deck delivery,
gang war, drill, visiting, sports, talent, quiz (no `before*`: no game was saved there before them). The house
dinner: venison stew. The odd jobs story: **"The seventh Hunter"** (Hare wants his name on the tally: the
a Hunter's watch (any but the Huntmaster and the strict one, whose pockets are full), a lookout while he digs a hide,
Boar beaten at arm-wrestling; a drag line for it). Medals
for every way out; achievements **Downstream** (away on the raft) and **Off the Tally** (clean away in the
manhunt). Gangs: the kitchen crew (Wren), the lifers (Moth, old Badger), the gym rats (Crow).

## The ways out, proved

| Way | Bot (`escapes.ts`, seed 61) | Day 1 |
|---|---|---|
| Raft | uniform, keys yellow/purple/cyan/red; the power off, the deer fence cut on the bank (7 s), launched off the jetty | out 23:35 |
| Tunnel | from the desk round the granite (11 tiles), west under the wall, dug with the **antler pick** | out 00:44 |
| Glider | the cell grate, the vents to the ladder, off the Trophy Hall's east gable on a west wind of 2 (7 tiles, over the river) | out 23:37 |
| Stowaway | the outfitter's truck, a quick-look day | out 14:31 |
| Bluff | green key, uniform, fake ID at the foot of the drive at the shift change | out 19:50 |
| Paperwork | the forged form at the gatehouse's release desk | out day 2 10:13 |
| Parole | `paroletest`'s model prisoner | |

The same routes run under every holiday (`holidaybotstest`) and every twist (`dailytest`).

**The outside** (`content/outside/six-hunter.ts`, final for the look's pass; redrawn after the review, which found
the first a copy of Stalag Flucht's): the wooded valley of the Hollowrun. The logging road runs north from the gate
over the river's bridge, through the sawmill's deer fence, to the siding where the timber train is loading (safety:
the whole yard by the rails). The river bends across the valley, a ford in each reach (wading washes the trail),
culverts under the road where the gullies cross, the woodcutters' track west and north to the hut, two wicket gates
in the fence, thickets along the banks. The Six as searchers: Harrow patrolling the fence's road gate and the east
wicket, Quiller the fence's west half; after the alarm Garrow with Duchess and Fell from the gate, Bracken and Larch
with Brutus from the siding; roadblocks at the bridge and below the fence; the county's helicopter late (12 s).
`hunttest`: the expert gets away from every start in every condition; the careful bot is caught 36% of the time in
all (wall 67%, sea 42%, glider 33%, van 25%, gate 13%), at the hard end of the outsides' range (San Pancho's gate
75%, Stalag Flucht's glider and Shankton's gate 67%).

**Snapshots accepted** (2.36, read line by line): every change is a line added for the Six Hunter or a total that
now counts it (`buttontest`'s presses, `hunttest`'s and `gossiptest`'s sums, the counts of items, recipes,
achievements, keys, lamps, small items, the drone's nights); no older prison's line moved, the escape, holiday,
Daily and economy bots byte-identical. Shared code changed only behind what the Six Hunter alone has (`kit`,
`state.recall`, its items, its job ids); `liftGuards` skips a guard whose kit fills his pockets (none elsewhere).

## Checklist: what the look and the finish still owe

Done in the core: the definition and folder, zones (append-only) and light rules (`kennels`, `smokehouse`,
`boathouse` lit indoors), the 3 jobs and props, the 10 items, 4 recipes and 3 tables, the behaviours in `k9.ts`,
`throwing.ts`, `actions.ts`, `Hunt.ts`, the horn's state field, day book, medals, parole, dinner, odd jobs,
achievements, gangs, the outside's data, the `forest` theme in every `Record<Theme>` (placeholders), the text in
English and French, the bots and tests, the map viewer's pictures and a first "In game" photo.

**The look** (owes): the forest theme's textures (`render/textures.ts`, `forest: {}` for now), its scenery trees,
ground, dust, lights and holiday pieces (`WorldView`, `View`, `ground.ts`, `Holidays.ts`); **the river's render**
(inland water draws as grass: only `Island.ts` draws water today), the jetty; models for the `trough`, `smoker`
and `netFrame` (first boxes in `render/props.ts`), the new items' shapes (stand-ins in `items.ts`), the hound
coats' look (`render/Dog.ts`), the kennels, the tally board (a notice board for now), hunting stands; sound
(`soundAmbience.ts`: pines, owls, a horn at dawn, hounds), the horn's and the drag line's events (`horn`,
`dragLine`) in the view; the manhunt outside's 3D as a forest (`huntTown.ts`, `huntLand.ts`); the map photos
retaken (`mapshot.ts`).

**The finish** (owes): the prison select's sixth card and its stars (`ui/screens/prisons.ts`, `daily.ts` draw 5;
`13-campaign.css` lays out 5), the card art (`.theme-forest .pc-scene`); a How to play topic (`helpTopics.ts`,
`prison: 'six-hunter'`) and its picture (`helpshot.ts`); the drawhash, perfprobe and hitchprobe scenes and
`perfbudget.json`; the README's screenshot; a lesson or first-day hints for the horn and the drag line if wanted;
the screens swept at the eight sizes in both languages.

## The finish as built

Claude's picks (the user's goal of 2026-11-07), also in `POLISH.md`'s row:
- **Level 6 shown as beyond the scale:** the Six Hunter's card has six stars, the sixth in the Hunters' red, and a red
  level badge (`starsOf` in `prisons.ts`, shared with the Daily's card, which still never draws it); the other five
  keep five.
- **Six cards:** in a row of posters from 1180 px across (the card up to 1320), three to a row from 980 to 1179, two
  to a row on a phone on its side (three rows: no odd one out), one on a phone upright; the ways out's pips wrap
  at every size and the stars go under the name on a narrow card (the 130% interface on a 412 phone).
- **How to play:** "Hounds and the river" (`hunters`, the prisons group, shown once the Six Hunter is open): the pack,
  the kennel hand's trust and its cap, the four recipes, the fog, the river and the wall, the ways out as hints. The
  delivery, bluff, grounds and dogs pages name the Six Hunter where they list prisons.
- **The first day:** the pack fed by the quota said once (`toast.packFed`, the event's `pack`), with a hint the first
  time on the cap (`hint.kennels`); a trout said as a trout; the drag line and the horn explained the first time
  one is in hand; the smokehouse's job icon a fish; the "already fed" warning for a trout as for jerky.
- **French:** a name that comes with its article contracts in `t()` ("évadé des Six Veneurs", "aux Six Veneurs",
  "Direction les Six Veneurs"); the unlock line "Prison ouverte : {name}" (no agreement to get wrong).
