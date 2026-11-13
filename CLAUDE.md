# Working on Prison Escape 3D

An Escapists-like 3D prison escape for the browser (phone and desktop), started from web-game-starter.
The general playbooks (`web-game-playbook`, `web-sim-game-playbook`) aren't needed to work here: this
file and the project's skills are; lessons go back into them only at the user's word.

- **The plan**: `docs/README.md` says where to find what; read only the file you need. `docs/PLAN.md`
  (decisions, architecture, tests; §8 the status). The design source of truth is
  `docs/source/the_escapists_3d_complete_game_design_document.md` (GDD); `docs/source/tech_plan.md` fills
  engineering gaps only. A new conflict goes into its area's file in `docs/decisions/` in the same
  commit. **Writing to the docs** (a feature, a fix, a release, the memory): the `docs-upkeep` skill,
  which says where each fact goes; `docstest` checks it.
- **Vertical slices**: every phase ships sim + render + phone/desktop UI + i18n + tests, then
  a release.

Reworking, polishing or reviewing any part of the gameplay: use the `polish-gameplay` skill. It starts
from `docs/POLISH.md`, the record of what's been done, the user's choices and the known limits, and ends by
updating it.

**City Escape** (`src/city/`, v2.46 on) is a second mode with its own simulation, generator and screens,
built in four stages (on the title since 2.49): its design is `docs/source/city_escape_design.md`, its roadmap and the
seams it shares with the prison game `docs/phases/10-city-escape.md`. It adds nothing to the prisons'
lists or state; dev builds expose `window.__city()`.

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
  (`-u` to accept, after reading the diff, then run it all again and gate on exit 0). Keep snapshot
  output platform-independent. The escape bots are knife-edge: after a map change, also
  `ONLY=<prison> npx tsx scripts/escapetest.ts`.
- **Lint and layout**: `npm run typecheck` (`src/` and `scripts/`), `npm run lint` (oxlint,
  type-aware) and `npm run format` (Prettier; `src/i18n/` left out) before committing; CI fails on
  any of them. A rule turned off says why in `.oxlintrc.json`; a line excused says why after `--`.
- **Storage** only through `src/game/storage.ts` (prefix `pe3d.`, never throws, migrations).
- **Text** goes through `t()` (`src/i18n/`, English and French; `i18ntest` checks French covers
  every key, every zone and prison has a name). The one exception: the loading screen's lines, in
  `index.html` in both languages (shown before the game's text is in). French is fetched on demand:
  `loadLang` before using it outside the game (tests, dev tools).
- **Keys** the player can change (`src/input/bindings.ts`): a handler reads `keyCode(e.code)`, never
  `e.code`, for an action's key; a text names a key as `%KeyE%` or `%Space%` (the player's key, labelled),
  never in words; a cache of drawn text keys on `textStamp()`, not the language alone (`keystest`).
- **UI**: screens are functions returning a Promise; no colour written where it's used: a token on `:root`
  (in `src/styles/01-base.css` if more than one file uses it, else at its file's top; translucent:
  `rgba(var(--x-rgb), 0.4)`), which `tokentest` checks; check desktop, phone portrait (412×915) and
  phone landscape (915×412), and after a layout change `scripts/dev/screensweep.ts` at its eight sizes
  (`docs/TOOLS.md`).
- **Browser tests in an isolated browser context** (chrome-devtools `isolatedContext`).
  Dev builds expose `window.__game()`, `__view`, `__sound`, `__firstDay` and `__offerUpdate`; `scripts/dev/playat.ts` puts the game at any
  prison and moment and drives it by real keys; `scripts/dev/fakepad.ts` plugs in a pretend gamepad. A render change is measured: `drawhash` (meant to draw
  nothing new), `perfprobe` (draws more), `hitchprobe` (slow frames, memory); how, in `docs/TOOLS.md`.
- **The real phone** (an Android phone on USB, adb): testing, measuring or playing by touch on it, the
  `real-phone` skill (`scripts/dev/phone.ts`).
- **Dev server**: `npm run dev` on port 5310, the game at `http://localhost:5310/` (not
  `/PrisonEscape3D/`, where public files come back as the page). One may already be running from an
  earlier session: reuse it. In dev builds `]` fast-forwards the clock ×30.
- **Map viewer** (`assets/maps/index.html`): keep it in step with the prisons. A phase that changes a
  map or places something new on it (props, decor, guards, a new `PrisonDef` field) brings it up to date
  and commits the pictures with it: the steps in `docs/TOOLS.md`.
- **How to play**: a new feature gets a topic in `src/ui/screens/helpTopics.ts` with its
  `help.<id>.*` parts (`helptest` checks the French has as many lines, the icons and pictures).
  Its picture is a `SHOTS` entry in `scripts/dev/helpshot.ts` (`docs/TOOLS.md`), retaken when what
  it shows changes.
- **Release**: build, `npm run check` green (gate on the exit code, never `npm test | tail`) → commit →
  `npm version patch|minor` → `git push --follow-tags origin main` → `npm run released` in the
  background (waits for CI on HEAD, then the live bundle; exits 1 on a failed run or a timeout).
  Read what it printed, not only its exit code: a timeout with the deploy still running is checked
  by fetching the live bundle as `released.sh` does, not with a hand-written polling loop.
  Once it's live, `npm run docs:released` (the history entry marked released, the status line, the map
  viewer), then commit and push what it lists.
- **Bots pass what people fail**: lessons and minigames are also played by hand in the browser
  at the three sizes before a release.
