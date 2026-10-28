# Working on Prison Escape 3D

An Escapists-like 3D prison escape for the browser (phone and desktop). Built from
web-game-starter with the **web-game-playbook** and **web-sim-game-playbook** skills.

- **The plan**: `docs/PLAN.md` (phases, decisions, conflicts resolved). The design source of
  truth is `docs/the_escapists_3d_complete_game_design_document.md` (GDD); `docs/tech_plan.md`
  fills engineering gaps only. A new conflict goes into PLAN.md §2 in the same commit.
  `docs/HISTORY.md` holds every release (what changed, what reviews found, what was accepted);
  PLAN.md §8 has the status.
- **Vertical slices**: every phase ships sim + render + phone/desktop UI + i18n + tests, then
  a release.

Rules that matter every time:
- **The simulation is deterministic** (`src/sim/`): fixed 20 Hz steps, integer positions
  (`UNIT` per tile), PRNG in the state, no `Math.random`/`Date`/DOM/Three.js. Every input is a
  packed command (`src/sim/command.ts`) — keyboard, touch and bots alike. New state fields go
  at the end and load as optional. Systems run in the order written in `Sim.advance`.
- **Old runs replay as they were**: a rule change that would alter a logged run goes behind a
  `Sim` flag that `runlog.ts` sets for older logs (`rules250`, `rules215`, `noQueue`). A new
  feature is opt-in or starts after day 1, so the escape bots stay byte-identical; a change in
  `escapetest`'s snapshot is a regression until proven otherwise.
- **Content is data** (`src/content/`): prisons are ASCII maps (`L0.map.ts`, legend in
  `src/sim/world/tiles.ts`) plus zones, cells and props. `maptest` validates every map
  (reachability, containment, props on floor, zones on every floor tile).
- **`npm test`** runs `scripts/*test*.ts` against golden outputs in `scripts/snapshots/`
  (`-u` to accept, after reading the diff). Keep snapshot output platform-independent.
- **Storage** only through `src/game/storage.ts` (prefix `pe3d.`, never throws, migrations).
- **Text** goes through `t()` (`src/i18n/`, English and French; `i18ntest` checks French covers
  every key, every zone and prison has a name).
- **UI**: screens are functions returning a Promise; tokens in `src/styles/01-base.css`;
  check desktop, phone portrait (412×915) and phone landscape (915×412).
- **Browser tests in an isolated browser context** (chrome-devtools `isolatedContext`).
  Dev builds expose `window.__game()` and `window.__view`.
- **Dev server**: `npm run dev` on port 5310. In dev builds `]` fast-forwards the clock ×30.
- **Map viewer** (`assets/maps/index.html`): keep it in step with the prisons. When a phase
  changes a map or adds something placed on it (props, decor, guards, a new `PrisonDef` field
  such as `comms`), draw the new data in `scripts/dev/mapimage.ts` (picture, legend and the
  tile info in `tileData`), then run `npm run maps`. If the change shows in 3D, also retake
  the "In game" photos with `scripts/dev/mapshot.ts` in the dev build (`send()` writes them to
  `assets/maps/` through `scripts/dev/shotsink.ts`; a change to the manhunt's outside: `send(true)`,
  its "Outside 3D" photos). Check that the new
  thing appears: a group the title screen hides needs showing in `View.mapShot`. Then run
  `npm run maps` again, and commit the pictures with the phase.
- **How to play**: a new feature gets a topic in `src/ui/screens/helpTopics.ts` with its
  `help.<id>.*` parts (`helptest` checks the French has as many lines, the icons and pictures).
  Its picture is a `SHOTS` entry in `scripts/dev/helpshot.ts` (a bot's run or a lesson replayed
  in the dev build, posted to `public/help/` through the shot sink); a topic seen from the start
  is pictured at Center Perks. Retake a picture when what it shows changes.
- **Release**: build + tests green (gate on the exit code, never `npm test | tail`) → commit →
  `npm version patch|minor` → `git push --follow-tags origin main` → `npm run released` in the
  background (waits for CI on HEAD, then the live bundle; exits 1 on a failed run or a timeout).
  Then add the release to the end of `docs/HISTORY.md`.
- **Bots pass what people fail**: lessons and minigames are also played by hand in the browser
  at the three sizes before a release.
