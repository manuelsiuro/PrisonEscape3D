# Phases: Sports grounds and gardens (P31–P33, v2.7–v2.9)

A finished roadmap, kept as it was planned and built: its rows from `PLAN.md` §4's phase table and, where it had one, its own section of `PLAN.md`, moved word for word on 2026-11-06. What was released is in `docs/history/`; the decisions taken on the way, in `docs/decisions/`.

## The phases

| Phase | Version | Content | Proof |
|---|---|---|---|
| **P31 Grounds** | 2.7 | Center Perks and the Training Block rebuilt (`PrisonDef.map` 1): `sports` and `garden` zones with gates open by the hour (`OPEN_HOURS`, `zonesOf`), `systems/grounds.ts` (`laps`, `freshMeals`), `content/grounds.ts` (`cornersOf`, `onTrack`), props `pullup`, `bleachers`, `planter`, `toolShed`, `crate`; the `gardener` machine job; `render/Grounds.ts` (track, court paint, growing crops); joggers; saves from an older map start over (`rebuiltSince`); lessons `laps`, `gardener` | groundstest; maptest (gates open by the hour); escapetest: the four other prisons byte-identical, Center Perks' seven escapes still won |
| **P32 Grounds II** | 2.8 | Stalag Flucht and Shankton rebuilt (`map` 1): Stalag's sports ground in the guards' compound's south end behind its own electric fence (gate from the dirt road), solitary halved, the garden along the north wire behind cabin B; Shankton's open-sky rec ground in the kitchen's old block, the kitchen, laundry and janitor's closet behind the canteen, the stage moved with the canteen, a walled garden plot in the courtyard, roll call regrouped; the gardener job in both; exercise posts, beats and the drone drop moved | groundstest (four rebuilt prisons; no plain fence between the new places and the perimeter); escapetest: every escape still won (Shankton's cutout bot now seen once on the way, heat 20%); teamtest (no roll-call spot on any pitch); economytest (every inmate holding a job at work at 14:59, every campaign prison); match goal rates measured on both pitches. Reviews: the bunting's poles off the pitch, the track and doorways and its strings across the camera; a fence junction drawn in halves; a gate's second leaf on the ground; Shankton's track and planters clear of the walls that hide rows; Stalag's beds along the wire; French « nouveau plan » for a rebuilt prison; Briggs off a roll-call spot |
| **P33 Grounds III** | 2.9 | San Pancho and Irongate rebuilt (`map` 1), every prison now rebuilt: San Pancho's sports ground in the plaza's south half behind the yard's fence, the canteen and gym through the wings' lobbies, the gym and showers in one room, the walled dirt garden in the showers' old place, the road out through the generator room; Irongate's sports ground on turf in the yard's west third down to the main corridor, the yard's east two thirds the 5-deep chasm with the garden at their end, the middle block narrower and moved east, the janitor's closet by the control room; the gardener job in both; beats, posts, stage, quiz, drone drop and visits moved | groundstest (every prison rebuilt; saves made now load as ever); sanpanchotest (the road out through the generator room); maptest; escapetest: every escape still won, Irongate's takeover bot holding its chokepoint (the lobby) till the prison falls (chased into the yard, three guards came at once); k9test's treat thrown where the dog stands with room round her. Reviews: the sports-day bunting strung along x only over a sports ground (Irongate's ran down the pitch edge on; the Training Block's too) and its poles a tile from any prop; San Pancho's sweeper through the sports ground and the garden (no guard ever went there); Irongate's canteen guard's beat off the yard's door, the takeover bot's fifth cup on whoever is nearest (it won only from one tile of the lobby); lamps at the grounds' north corners; stations and decor out of the rows walls hide; the job board clear of the weights; help texts without "where there is one" now every prison has the places. Accepted: San Pancho's snipers reach part of the garden (a wanted player there can be shot); Irongate's bluff bot is recognized once on the way (heat 20%), and still out |

## Sports grounds & gardens (P31–P33) (PLAN.md §10 before 2026-11-06)

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
