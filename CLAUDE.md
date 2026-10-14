# Working on Prison Escape 3D

An Escapists-like 3D prison escape for the browser (phone and desktop). Built from
web-game-starter with the **web-game-playbook** and **web-sim-game-playbook** skills.

- **The plan**: `docs/PLAN.md` (phases, decisions, conflicts resolved). The design source of
  truth is `docs/the_escapists_3d_complete_game_design_document.md` (GDD); `docs/tech_plan.md`
  fills engineering gaps only. A new conflict goes into PLAN.md §2 in the same commit.
- **Vertical slices**: every phase ships sim + render + phone/desktop UI + i18n + tests, then
  a release.

Rules that matter every time:
- **The simulation is deterministic** (`src/sim/`): fixed 20 Hz steps, integer positions
  (`UNIT` per tile), PRNG in the state, no `Math.random`/`Date`/DOM/Three.js. Every input is a
  packed command (`src/sim/command.ts`) — keyboard, touch and bots alike. New state fields go
  at the end and load as optional. Systems run in the order written in `Sim.step`.
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
- **Dev server**: `npm run dev` on port 5310.
- **Release**: build + tests green (gate on the exit code, never `npm test | tail`) → commit →
  `npm version patch|minor` → `git push --follow-tags origin main` → poll the live JS bundle
  for the new version.
