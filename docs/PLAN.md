# PrisonEscape3D: Project Plan

A 3D web take on *The Escapists*. It is built with the **web-game-playbook** and
**web-sim-game-playbook** skills, starting from `~/ClaudeProjects/web-game-starter`.

Sources:
- `docs/source/the_escapists_3d_complete_game_design_document.md` (**GDD, the source of truth**);
- `docs/source/game_idea.md` (feature list);
- `docs/source/tech_plan.md` (engineering details, used where the GDD says nothing).

The history of every release (what changed, what the reviews found, what was accepted) is in
[`docs/HISTORY.md`](HISTORY.md), an index of `docs/history/`; §8 below gives the status. Where to find
what: [`docs/README.md`](README.md).

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

Where the GDD and `tech_plan.md` disagree, or say nothing, what was decided (the GDD wins unless a row says why not), one file per area in `docs/decisions/` (moved there word for word on 2026-11-06):

- [The campaign and the six prisons](decisions/prisons.md): what each prison has and where: maps, rooms, themes, the grounds (21 rows)
- [The daily routine](decisions/routine.md): the clock, roll call, meals, showers, Lights Out and sleep, lockdowns, sitting, the day's events (18 rows)
- [Guards and security](decisions/guards.md): seeing and being caught, solitary, shakedowns, the generator, cameras, detectors, searchlights, snipers, guard dogs, noise (23 rows)
- [Damage, tunnels and the layers](decisions/digging.md): chipping, digging, covers, the vents and the roofs, cave-ins (9 rows)
- [Fights](decisions/combat.md): weapons, damage, lock-on, knockouts, grudges (12 rows)
- [Items, crafting and smuggling](decisions/items.md): the item list, keys, desks restocked, recipes learnt, things brought in (5 rows)
- [Jobs, money and favours](decisions/jobs-money.md): jobs and the Work Period, cash, merchants, favours, the vending machine (12 rows)
- [Energy, health and attributes](decisions/attributes.md): the bars, training at the gym and in the library, decay (8 rows)
- [Ways out](decisions/escapes.md): every escape route, the takeover, the getaways, parole and the paperwork (16 rows)
- [Inmates, talk and crews](decisions/people.md): cells and visitors, opinion, followers, speech, the crew, the pet rat (6 rows)
- [Free time and games](decisions/free-time.md): the side games, cards, long games, football, the tattoo parlour, stage nights (6 rows)
- [Modes, progress and saves](decisions/modes.md): saving, the campaign's unlocks, achievements, lessons, the Daily Escape, replays (7 rows)

Any further conflict found during the build is added to its area's file in the same commit.

## 3. Architecture

Starter layout (base playbook §2), as it stands (checked at v2.42):

```
src/
  sim/                the rules: deterministic, no DOM, clock, Math.random or Three.js
    Sim.ts            step(cmd) in a fixed system order (below), events, snapshot/load
    state.ts          freshState, the state layout (new fields appended), snapshots
    events.ts         SimEvent (what a step reports) and the names shared with the state
    load.ts           loadState: a snapshot loaded, old fields filled in, damage put right
    context.ts        what the systems see of the Sim: state, world, the step's events
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
  tutorial/           the lessons as data (lessons*.ts, CHAPTERS), their kit (kit.ts: step
                      types, scene setup, goal and failure checks) and progress rules
  game/               storage (the only localStorage), saves, settings, records, trophies,
                      stats, replays, the campaign
  replay/             the scout worker and the replay runner
  audio/, app/        synthesized sound; haptics, quality, PWA and install
  i18n/               en.ts, fr.ts, barks/, keyboard labels
  styles/             CSS, one file per part (shared colour tokens in 01-base.css, dialogs in 14-dialogs.css)
scripts/
  test.ts             runs every *test*.ts in parallel against scripts/snapshots/
  *test*.ts           the tests (§6; their count in §8); bots.ts, escapes.ts, parolebots.ts, holidaybots.ts and
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
release with `npm version`. Visual checks are done at desktop size, 412×915 and 915×412 (the sweep's
eight sizes after a layout change, `scripts/dev/screensweep.ts`).
A phase that changes a map or places something new on it also brings the map viewer
(`assets/maps/`) up to date: drawn in `scripts/dev/mapimage.ts`, `npm run maps`, and the
"In game" photos retaken when it shows in 3D ([`TOOLS.md`](TOOLS.md), the map viewer).

Every phase is built and released. The plans, phase by phase with what each shipped and how it was proved, are kept in `docs/phases/`, one file per roadmap (moved there word for word on 2026-11-06):

- [The five-prison campaign (P0–P12, v0.1–v1.6)](phases/1-campaign.md): P0 Kickoff, P1 Routine, P2 Items, P3 Guards, P4 Layers, P5 Combat, P6 Economy, P7 Security & escapes, P8 Level 1 complete, P8+ Polish and foundations, P9 Stalag Flucht, P10 Shankton, P11 San Pancho, P12 HMP Irongate
- [Prison Life (P13–P26, v1.7–v2.1)](phases/2-prison-life.md): P13 Voices, P14 Noise & distractions, P15 Guard ways, P16 Achievements & you, P17 The day, P18 Delivery day, P19 Guard dogs, P20 The pet rat, P21 Smuggling, P22 Side games, P23 Crew & specialists, P24 Bluff & glider, Tutorial: Prison life, Tutorial: Ways out, Tutorial: Getting by, P26 Daily Escape, P25 Escape replays
- [Free time (P27–P30, v2.2–v2.6)](phases/3-free-time.md): P27 Card sharks, P28 Long games, P29 Team & ink, P30 Stage nights, P23–P30 polish
- [Sports grounds and gardens (P31–P33, v2.7–v2.9)](phases/4-grounds.md): P31 Grounds, P32 Grounds II, P33 Grounds III
- [Phone and kiosk (P34–P36, v2.10–v2.12)](phases/5-phone-kiosk.md): P34 The pay phone, P35 The internet kiosk, P36 The paperwork escape
- [How to play, laid out again (P37–P38, v2.13–v2.17)](phases/6-how-to-play.md): P37 How to play, laid out again, P38 How to play II, The day's card, easier games, Share
- [Parole, odd jobs, the manhunt, holidays (P39–P42, v2.18–v2.21)](phases/7-after-hours.md): P39 The parole board, P40 The odd jobs board, P41 The manhunt, P42 Holidays
- [The Six Hunter (v2.36)](phases/9-six-hunter.md): the sixth prison past the five, its pack of six, jobs, items, ways out, its look and its finish, as built
- [Reviews and the gameplay polish series (v2.21.1 on)](phases/8-polish.md): every review and polish pass, one row each with the snapshots it moved (each area's choices and limits: `POLISH.md`)

## 5. Mapping the GDD to phases

Kept with the campaign's phases: [`phases/1-campaign.md`](phases/1-campaign.md).

## 6. Tests

All tests are `scripts/*test*.ts` (their count in §8), run in parallel by `scripts/test.ts`, each
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
- **The action button** (`buttontest`, v2.34.2): in every prison, at a time in each block, beside every
  prop and person, every plan pressed: it does what it says (or says why not), with its verb in both
  languages and its highlight in reach.
- **Render without a GPU** (`rendertest`, `budgettest`, `pitchframetest`, `playclocktest`):
  geometry rules, draw-call budgets per prison, camera framing, the play clock.

**Lint and layout** (v2.34.2): `npm run typecheck` checks `src/` and, through `scripts/tsconfig.json`,
the tests and tools; `npm run lint` is oxlint with its type-aware rules (`.oxlintrc.json` says
which are off and why); `npm run format` is Prettier (the text tables in `src/i18n/` left out).

A bot passing is not a person passing: lessons and minigames are also played by hand in the
browser at the three sizes (§4).

## 7. Release routine

The steps are `CLAUDE.md`'s Release rule; the docs step after it (`npm run docs:released`) is the
`docs-upkeep` skill's. Then report what changed, what wasn't verified (sound, vibration, real touch
feel) and the known limits.

## 8. Progress

**Status (2026-11-11): v2.42.0.** Every planned roadmap is built and released (§4: P0–P42 and the Six
Hunter), with its reviews, the improvement queue (`BACKLOG.md` §4) and the gameplay polish series
(`POLISH.md`); what each release did is in [`docs/HISTORY.md`](HISTORY.md). In numbers: 6 prisons and the Training Block,
45 ways out, 165 items, 64 recipes, 144 achievements, 70 lessons in 5 chapters, 68 help topics,
5,450 text keys in English and French, 83 test scripts.

What's open (the areas not polished yet, the checks only a person can do, the ideas the user
parked): [`BACKLOG.md`](BACKLOG.md).
