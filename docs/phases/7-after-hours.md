# Phases: Parole, odd jobs, the manhunt, holidays (P39–P42, v2.18–v2.21)

A finished roadmap, kept as it was planned and built: its rows from `PLAN.md` §4's phase table and, where it had one, its own section of `PLAN.md`, moved word for word on 2026-11-06. What was released is in `docs/history/`; the decisions taken on the way, in `docs/decisions/`.

## The phases

| Phase | Version | Content | Proof |
|---|---|---|---|
| **P39 The parole board** | 2.18 | `systems/parole.ts`: apply at the release desk (or the lawyer by phone), the record read from the ledger, a hearing of three questions 7 days on, granted → released through P36's desk; route `parole` | `paroletest`, `parolebots.ts` (every prison), lesson `parole` |
| **P40 The odd jobs board** | 2.19 | `systems/oddjobs.ts`, `content/oddjobs.ts`, `PrisonDef.board`: three jobs a day by `roll()` plus the fixer's, twelve kinds, a three-step story per prison, cash, rare items or a debt | `oddjobstest`, lesson `oddjob` |
| **P41 The manhunt** | 2.20 | `src/sim/hunt/` (its own sim), `content/outside/` (60×56 per prison), `render/Hunt.ts`, `huntTown.ts`, `huntPrison.ts`: searchers, dogs, roadblocks, the helicopter, cover, fords, Lou's car; the clean getaway star; legal releases have no hunt | `manhunttest`, `hunttest` (the balance gauge), lesson `manhunt`, the map viewer's Outside 3D |
| **P42 Holidays** | 2.21 | `systems/holiday.ts`, `content/holidays.ts`, `render/Holidays.ts`: Easter, summer, Halloween, Christmas and New Year by the real date (kept in the state; a setting); decor, 6 items, 5 achievements | `holidaytest`, `holidaybotstest` (every escape bot under each holiday), `holidayruntest` |

## Parole, odd jobs, the manhunt, holidays (P39–P42) (PLAN.md §13 before 2026-11-06)
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
